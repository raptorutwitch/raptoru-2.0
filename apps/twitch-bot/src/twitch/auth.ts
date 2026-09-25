import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

// Twitch user-token lifecycle (official OAuth authorization code flow + refresh tokens).
// Reusable by any Twitch feature of the bot; knows nothing about presence, Daily or chat.
//
// - one refresh at a time (concurrent callers share it);
// - proactive refresh shortly before expiry, reactive refresh after a Helix 401;
// - a rejected refresh is final for this process: no refresh loop, callers get an AuthError;
// - tokens are never logged.

export const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
export const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
export const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';

export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  /** Epoch ms. */
  expiresAt: number;
  userId: string;
  login: string;
}

export interface TokenStore {
  load(): Promise<StoredToken | null>;
  save(token: StoredToken): Promise<void>;
}

export type AuthErrorCode =
  | 'no_token'
  | 'missing_scopes'
  | 'refresh_rejected'
  | 'invalid_token'
  | 'twitch_unavailable';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** JSON file store. Writes go to a temp file then rename, so the file is never half-written. */
export function fileTokenStore(path: string): TokenStore {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8')) as StoredToken;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async save(token) {
      const tmp = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
      await writeFile(tmp, JSON.stringify(token, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      // Windows briefly refuses a rename over a file another process is replacing: retry shortly.
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(tmp, path);
          return;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (
            attempt >= 10 ||
            (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')
          )
            throw error;
          await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
        }
      }
    },
  };
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  scope?: string[];
}

export interface TwitchAuthOptions {
  clientId: string;
  clientSecret: string;
  store: TokenStore;
  requiredScopes: string[];
  fetch?: typeof fetch;
  now?: () => number;
  log?: (...args: unknown[]) => void;
  /** Refresh this long before expiry. */
  refreshMarginMs?: number;
}

export interface AuthStatus {
  state: 'ready' | 'failed' | 'uninitialized';
  login: string | null;
  userId: string | null;
  scopes: string[];
  expiresAt: string | null;
  hasRefreshToken: boolean;
  lastRefreshAt: string | null;
  error: string | null;
}

/** POST to the Twitch token endpoint (authorization_code or refresh_token grant). */
export async function requestToken(
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { ok: true; token: TokenResponse }
  | { ok: false; status: number; message: string }
> {
  const res = await fetchImpl(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      message = ((await res.json()) as { message?: string }).message ?? message;
    } catch {
      /* body without JSON */
    }
    return { ok: false, status: res.status, message };
  }
  return { ok: true, token: (await res.json()) as TokenResponse };
}

/** GET /oauth2/validate: null when Twitch says the token is invalid (401). */
export async function validateAccessToken(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
) {
  const res = await fetchImpl(TWITCH_VALIDATE_URL, {
    headers: { authorization: `OAuth ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) return null;
  if (!res.ok)
    throw new AuthError(
      'twitch_unavailable',
      `token validation failed (HTTP ${res.status})`,
    );
  return (await res.json()) as {
    login: string;
    user_id: string;
    expires_in: number;
    scopes: string[] | null;
  };
}

export class TwitchAuth {
  private token: StoredToken | null = null;
  private refreshing: Promise<StoredToken> | null = null;
  private failure: AuthError | null = null;
  private lastRefreshAt: number | null = null;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly log: (...args: unknown[]) => void;
  private readonly margin: number;

  constructor(private readonly options: TwitchAuthOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? console.log;
    this.margin = options.refreshMarginMs ?? 10 * 60 * 1000;
  }

  /** Loads, validates (refreshing if needed) and checks scopes. Throws AuthError when unusable. */
  async init(): Promise<AuthStatus> {
    const stored = await this.options.store.load();
    if (!stored)
      throw this.fail(
        'no_token',
        'no Twitch token stored: run `npm run twitch:auth -w @raptoru/twitch-bot`',
      );
    this.token = stored;
    await this.validate();
    return this.status();
  }

  /** Twitch requires hourly validation of user tokens; also detects revoked tokens and lost scopes. */
  async validate(): Promise<void> {
    this.throwIfFailed();
    const current = this.requireToken();
    let info = await validateAccessToken(current.accessToken, this.fetch);
    if (!info) {
      await this.refresh();
      info = await validateAccessToken(
        this.requireToken().accessToken,
        this.fetch,
      );
      if (!info)
        throw this.fail(
          'invalid_token',
          'Twitch rejects the freshly refreshed token',
        );
    }
    const scopes = info.scopes ?? [];
    const missing = this.options.requiredScopes.filter(
      (s) => !scopes.includes(s),
    );
    this.token = {
      ...this.requireToken(),
      scopes,
      userId: info.user_id,
      login: info.login,
      expiresAt: this.now() + info.expires_in * 1000,
    };
    if (missing.length) {
      throw this.fail(
        'missing_scopes',
        `token of ${info.login} lacks scopes: ${missing.join(', ')}`,
      );
    }
  }

  /** Current access token, refreshed first if it is about to expire. */
  async getAccessToken(): Promise<string> {
    this.throwIfFailed();
    const token = this.requireToken();
    if (token.expiresAt - this.now() <= this.margin)
      return (await this.refresh()).accessToken;
    return token.accessToken;
  }

  /** For Helix: after a 401, refresh once. Returns false when no new token could be obtained. */
  async handleUnauthorized(rejectedAccessToken: string): Promise<boolean> {
    if (this.failure) return false;
    if (this.token && this.token.accessToken !== rejectedAccessToken)
      return true; // already refreshed
    try {
      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  /** Single-flight refresh; the new token is persisted before being used. */
  refresh(): Promise<StoredToken> {
    this.throwIfFailed();
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  status(): AuthStatus {
    return {
      state: this.failure ? 'failed' : this.token ? 'ready' : 'uninitialized',
      login: this.token?.login ?? null,
      userId: this.token?.userId ?? null,
      scopes: this.token?.scopes ?? [],
      expiresAt: this.token
        ? new Date(this.token.expiresAt).toISOString()
        : null,
      hasRefreshToken: Boolean(this.token?.refreshToken),
      lastRefreshAt: this.lastRefreshAt
        ? new Date(this.lastRefreshAt).toISOString()
        : null,
      error: this.failure?.message ?? null,
    };
  }

  private async doRefresh(): Promise<StoredToken> {
    const current = this.requireToken();
    let result;
    try {
      result = await requestToken(
        {
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken,
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
        },
        this.fetch,
      );
    } catch (error) {
      // Network trouble: not final, the next call may retry.
      throw new AuthError(
        'twitch_unavailable',
        `token refresh unreachable: ${(error as Error).message}`,
      );
    }
    if (!result.ok) {
      if (result.status >= 500) {
        throw new AuthError(
          'twitch_unavailable',
          `token refresh failed (HTTP ${result.status})`,
        );
      }
      throw this.fail(
        'refresh_rejected',
        `Twitch rejected the refresh token (${result.message}): run twitch:auth again`,
      );
    }
    const next: StoredToken = {
      ...current,
      accessToken: result.token.access_token,
      refreshToken: result.token.refresh_token || current.refreshToken,
      scopes: result.token.scope ?? current.scopes,
      expiresAt: this.now() + (result.token.expires_in ?? 3600) * 1000,
    };
    await this.options.store.save(next);
    this.token = next;
    this.lastRefreshAt = this.now();
    this.log(
      `[twitch-auth] token refreshed for ${next.login}, valid ${Math.round((next.expiresAt - this.now()) / 60000)} min`,
    );
    return next;
  }

  private requireToken(): StoredToken {
    if (!this.token)
      throw new AuthError('no_token', 'TwitchAuth not initialized');
    return this.token;
  }

  private throwIfFailed(): void {
    if (this.failure) throw this.failure;
  }

  private fail(code: AuthErrorCode, message: string): AuthError {
    this.failure = new AuthError(code, message);
    this.log(`[twitch-auth] ${message}`);
    return this.failure;
  }
}
