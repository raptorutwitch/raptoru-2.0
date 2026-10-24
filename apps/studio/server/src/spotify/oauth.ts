import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SpotifyApiError, type SpotifyAuthSource } from './api.js';

// Spotify V2 — the broadcaster's Spotify connection, on this PC only (docs/SPOTIFY_V2.md § 5–6). Authorization code
// with PKCE (no client secret to keep): the Client ID of Raptoru's Spotify app is typed in Studio, the redirect is
// Studio's own loopback (Spotify refuses « localhost »). The refresh token is stored ONLY encrypted by Windows (DPAPI,
// like the historical secrets.js), the access token stays in memory. A refused refresh (`invalid_grant`: revoked, or
// expired — 6 months since 2026) → « reconnexion nécessaire »; nothing retries it.

export const SPOTIFY_OAUTH = {
  authorizeUrl: 'https://accounts.spotify.com/authorize',
  tokenUrl: 'https://accounts.spotify.com/api/token',
  /** The historical two, plus user-read-private (the account's Premium shown in Studio). */
  scopes: [
    'user-modify-playback-state',
    'user-read-playback-state',
    'user-read-private',
  ],
  stateTtlMs: 10 * 60_000,
  timeoutMs: 10_000,
} as const;

/** Encrypts a secret for this Windows user (DPAPI) — or, in tests, anything reversible. */
export interface SecretBox {
  protect(plain: string): Promise<string>;
  unprotect(sealed: string): Promise<string>;
}

function powershell(script: string, input: string) {
  return new Promise<string>((ok, ko) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c));
    child.once('error', ko);
    child.once('close', (code) =>
      code === 0 ? ok(out.trim()) : ko(new Error('dpapi_failed')),
    );
    child.stdin.end(input);
  });
}

const LOAD = `$m = Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'; Import-Module -Name $m -ErrorAction Stop;`;

/** The historical DPAPI store (spotify-v2/secrets.js): ConvertFrom-SecureString for the current Windows user. */
export const dpapiBox: SecretBox = {
  protect: (plain) =>
    powershell(
      `${LOAD} $v = [Console]::In.ReadToEnd(); if ([string]::IsNullOrWhiteSpace($v)) { exit 2 }; ConvertTo-SecureString -String $v -AsPlainText -Force | ConvertFrom-SecureString`,
      plain,
    ),
  unprotect: (sealed) =>
    powershell(
      `${LOAD} $e = [Console]::In.ReadToEnd().Trim(); $s = ConvertTo-SecureString -String $e; $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }`,
      sealed,
    ),
};

interface Stored {
  client_id: string;
  /** DPAPI-sealed refresh token; absent = never connected. */
  refresh_sealed?: string;
  /** A refresh was refused (invalid_grant): reconnect. */
  needs_reauth?: boolean;
  account?: { name: string; product: string | null };
}

const b64url = (b: Buffer) => b.toString('base64url');

export interface SpotifyAuthDeps {
  file: string;
  redirectUri: string;
  box?: SecretBox;
  fetch?: typeof fetch;
  now?: () => number;
}

export class SpotifyAuth implements SpotifyAuthSource {
  private stored: Stored | null = null;
  private access: { token: string; until: number } | null = null;
  private refreshing: Promise<string> | null = null;
  private readonly pending = new Map<
    string,
    { verifier: string; until: number; clientId: string }
  >();
  private readonly box: SecretBox;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  private constructor(private readonly d: SpotifyAuthDeps) {
    this.box = d.box ?? dpapiBox;
    this.fetch = d.fetch ?? fetch;
    this.now = d.now ?? Date.now;
  }

  static async open(d: SpotifyAuthDeps) {
    const a = new SpotifyAuth(d);
    try {
      const s = JSON.parse(await readFile(d.file, 'utf8')) as Stored;
      if (typeof s.client_id === 'string') a.stored = s;
    } catch {
      /* never configured */
    }
    return a;
  }

  private async save(s: Stored | null) {
    this.stored = s;
    if (!s) return unlink(this.d.file).catch(() => {});
    await mkdir(dirname(this.d.file), { recursive: true });
    await writeFile(`${this.d.file}.tmp`, JSON.stringify(s), { mode: 0o600 });
    await rename(`${this.d.file}.tmp`, this.d.file);
  }

  /** ok / not_configured / needs_reauth (SpotifyStudioStatus.auth) and what the panel shows (never a token). */
  view() {
    const s = this.stored;
    return {
      auth: !s?.refresh_sealed
        ? ('not_configured' as const)
        : s.needs_reauth
          ? ('needs_reauth' as const)
          : ('ok' as const),
      client_id: s?.client_id ?? null,
      account: s?.account ?? null,
      redirect_uri: this.d.redirectUri,
    };
  }

  /** Step 1 (the broadcaster's click): the Spotify consent URL, with a one-time state and PKCE challenge. */
  authorizeUrl(clientId: string) {
    if (!/^[0-9a-f]{32}$/i.test(clientId))
      throw Object.assign(new Error('invalid_client_id'), { status: 400 });
    const now = this.now();
    for (const [k, v] of this.pending)
      if (v.until <= now) this.pending.delete(k);
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(48));
    this.pending.set(state, {
      verifier,
      until: now + SPOTIFY_OAUTH.stateTtlMs,
      clientId,
    });
    const u = new URL(SPOTIFY_OAUTH.authorizeUrl);
    u.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: this.d.redirectUri,
      scope: SPOTIFY_OAUTH.scopes.join(' '),
      state,
      code_challenge_method: 'S256',
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    }).toString();
    return u.toString();
  }

  /** Step 2 (Spotify's redirect): one-time state, code exchanged, refresh token sealed. */
  async callback(params: URLSearchParams) {
    const state = params.get('state') ?? '';
    const p = this.pending.get(state);
    this.pending.delete(state);
    if (!p || p.until <= this.now()) throw new Error('state_invalide');
    if (params.get('error'))
      throw new Error(
        params.get('error') === 'access_denied' ? 'refusé' : 'erreur_spotify',
      );
    const code = params.get('code');
    if (!code) throw new Error('code_absent');
    const t = await this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.d.redirectUri,
      client_id: p.clientId,
      code_verifier: p.verifier,
    });
    if (!t.refresh_token) throw new Error('refresh_absent');
    await this.save({
      client_id: p.clientId,
      refresh_sealed: await this.box.protect(t.refresh_token),
    });
    this.access = {
      token: t.access_token,
      until: this.now() + t.expires_in * 1000 - 60_000,
    };
  }

  /** The account read once after connecting (name + Premium), kept for the panel. */
  async setAccount(account: { name: string; product: string | null }) {
    if (this.stored) await this.save({ ...this.stored, account });
  }

  async disconnect() {
    this.access = null;
    await this.save(null);
  }

  async accessToken() {
    if (this.access && this.access.until > this.now()) return this.access.token;
    return this.refresh();
  }

  refresh() {
    this.refreshing ??= this.doRefresh().finally(
      () => (this.refreshing = null),
    );
    return this.refreshing;
  }

  private async doRefresh() {
    const s = this.stored;
    if (!s?.refresh_sealed) throw new SpotifyApiError('AUTH_NOT_CONFIGURED');
    if (s.needs_reauth) throw new SpotifyApiError('AUTH_REQUIRED');
    let refresh: string;
    try {
      refresh = await this.box.unprotect(s.refresh_sealed);
    } catch {
      throw new SpotifyApiError('AUTH_NOT_CONFIGURED');
    }
    let t: Awaited<ReturnType<SpotifyAuth['token']>>;
    try {
      t = await this.token({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: s.client_id,
      });
    } catch (e) {
      if ((e as Error).message === 'invalid_grant') {
        this.access = null;
        await this.save({ ...s, needs_reauth: true });
        throw new SpotifyApiError('AUTH_REQUIRED');
      }
      throw new SpotifyApiError('SPOTIFY_UNAVAILABLE');
    }
    // Spotify may rotate the refresh token (PKCE): keep the new one.
    if (t.refresh_token && t.refresh_token !== refresh)
      await this.save({
        ...s,
        refresh_sealed: await this.box.protect(t.refresh_token),
      });
    this.access = {
      token: t.access_token,
      until: this.now() + t.expires_in * 1000 - 60_000,
    };
    return t.access_token;
  }

  private async token(form: Record<string, string>) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), SPOTIFY_OAUTH.timeoutMs);
    try {
      const res = await this.fetch(SPOTIFY_OAUTH.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
        signal: ctl.signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
      };
      if (!res.ok || !body.access_token)
        throw new Error(
          body.error === 'invalid_grant' ? 'invalid_grant' : 'token_refused',
        );
      return {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_in: body.expires_in ?? 3600,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** For the Lab simulator: always connected, no PC secret involved. */
export const simulatedAuth: SpotifyAuthSource & {
  view(): ReturnType<SpotifyAuth['view']>;
} = {
  accessToken: async () => 'simulated',
  refresh: async () => 'simulated',
  view: () => ({
    auth: 'ok',
    client_id: null,
    account: { name: 'Simulateur Spotify (Lab)', product: 'premium' },
    redirect_uri: '',
  }),
};
