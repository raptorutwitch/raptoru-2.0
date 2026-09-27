import { randomBytes } from 'node:crypto';
import type {
  BonkLabCatalog,
  BonkLabTwitchEmote,
  BonkLabTwitchOwner,
  BonkLabViewer,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';

// Bonk V2 Lab — Twitch viewer identity and personal emote catalog. Read-only: the only scope is
// user:read:emotes, the only Twitch data calls are Get User Emotes and Get Users. The OAuth token
// lives in the local Lab database; no route returns it. Core builds every emote URL itself from the
// emote id (the client never supplies a URL).

export const VIEWER_SCOPES = ['user:read:emotes'];
/** Already registered on the Raptoru 2.0 Twitch application (see twitch-bot `twitch:auth`). */
export const VIEWER_REDIRECT_URI = 'http://localhost:3789/callback';
const CATALOG_FRESH_MS = 10 * 60_000;
/** A stored catalog may still validate an admission if Twitch is briefly unreachable. */
export const CATALOG_MAX_AGE_MS = 60 * 60_000;
const STATE_TTL_MS = 10 * 60_000;
const MAX_PAGES = 50;

export class TwitchViewerError extends Error {
  constructor(
    readonly code:
      | 'oauth_state_invalid'
      | 'oauth_exchange_failed'
      | 'oauth_wrong_scopes'
      | 'oauth_wrong_client'
      | 'reauth_required'
      | 'viewer_not_linked'
      | 'catalog_unavailable',
    message: string = code,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

interface TokenRow {
  user_id: string;
  login: string;
  display_name: string;
  access_token: string;
  refresh_token: string;
  scopes: string[];
  expires_at: Date;
}

interface HelixEmote {
  id: string;
  name: string;
  emote_type: string;
  emote_set_id: string;
  owner_id: string;
  format: string[];
}

/** CDN URL built only from a validated Twitch emote id (dark theme, largest scale). */
export function twitchEmoteUrl(id: string, format: 'static' | 'animated') {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(id))
    throw new Error('invalid_twitch_emote_id');
  return `https://static-cdn.jtvnw.net/emoticons/v2/${id}/${format}/dark/3.0`;
}

export class TwitchViewerCatalog {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly app: { clientId: string; clientSecret: string },
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  // --- OAuth ---------------------------------------------------------------------------------------

  async startAuth(): Promise<{ authorization_url: string }> {
    const state = randomBytes(24).toString('hex');
    const now = this.clock.now();
    await this.db.query(
      'insert into bonk_lab_oauth_states (state, created_at, expires_at) values ($1, $2, $3)',
      [state, now, new Date(now.getTime() + STATE_TTL_MS)],
    );
    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: this.app.clientId,
      redirect_uri: VIEWER_REDIRECT_URI,
      response_type: 'code',
      scope: VIEWER_SCOPES.join(' '),
      state,
      force_verify: 'true', // always show the account picker: authorize the intended account
    }).toString();
    return { authorization_url: url.href };
  }

  async completeAuth(code: string, state: string): Promise<BonkLabViewer> {
    const now = this.clock.now();
    const used = await this.db.query(
      `update bonk_lab_oauth_states set used_at = $2
       where state = $1 and used_at is null and expires_at > $2 returning state`,
      [state, now],
    );
    if (!used.length) throw new TwitchViewerError('oauth_state_invalid');

    const token = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: VIEWER_REDIRECT_URI,
    }).catch(() => {
      throw new TwitchViewerError('oauth_exchange_failed');
    });
    const info = await this.validate(token.access_token);
    if (info.client_id !== this.app.clientId)
      throw new TwitchViewerError('oauth_wrong_client');
    const scopes = [...(info.scopes ?? [])].sort();
    // Exactly the read-only scope: a token with more rights is refused (and revoked).
    if (JSON.stringify(scopes) !== JSON.stringify([...VIEWER_SCOPES].sort())) {
      await this.revoke(token.access_token);
      throw new TwitchViewerError(
        'oauth_wrong_scopes',
        `scopes: ${scopes.join(' ')}`,
      );
    }
    const user = (await this.getUsers(token.access_token, [info.user_id]))[0];
    await this.db.query(
      `insert into bonk_lab_viewer_tokens (user_id, login, display_name, access_token, refresh_token, scopes, expires_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (user_id) do update set login = excluded.login, display_name = excluded.display_name,
         access_token = excluded.access_token, refresh_token = excluded.refresh_token, scopes = excluded.scopes,
         expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      [
        info.user_id,
        info.login,
        user?.display_name ?? info.login,
        token.access_token,
        token.refresh_token,
        scopes,
        new Date(now.getTime() + token.expires_in * 1000),
        now,
      ],
    );
    await this.db.query(
      'delete from bonk_lab_viewer_catalogs where user_id = $1',
      [info.user_id],
    );
    return {
      user_id: info.user_id,
      login: info.login,
      display_name: user?.display_name ?? info.login,
      scopes,
    };
  }

  async viewers(): Promise<BonkLabViewer[]> {
    return this.db.query<BonkLabViewer>(
      'select user_id, login, display_name, scopes from bonk_lab_viewer_tokens order by updated_at desc',
    );
  }

  async disconnect(userId: string): Promise<{ disconnected: boolean }> {
    const row = await this.tokenRow(userId);
    if (!row) return { disconnected: false };
    await this.revoke(row.access_token);
    await this.db.query(
      'delete from bonk_lab_viewer_tokens where user_id = $1',
      [userId],
    );
    return { disconnected: true };
  }

  // --- catalog -------------------------------------------------------------------------------------

  /** Fresh catalog (≤ 10 min), fetched from Get User Emotes when needed. */
  async catalog(
    userId: string,
    { force = false } = {},
  ): Promise<BonkLabCatalog> {
    const stored = await this.storedCatalog(userId);
    const age = stored
      ? this.clock.now().getTime() - Date.parse(stored.fetched_at)
      : Infinity;
    if (stored && !force && age < CATALOG_FRESH_MS) return stored;
    try {
      return await this.fetchCatalog(userId);
    } catch (error) {
      if (
        error instanceof TwitchViewerError &&
        error.code !== 'catalog_unavailable'
      )
        throw error;
      // Twitch briefly unreachable: a recent stored catalog stays authoritative, never an old one.
      if (stored && age < CATALOG_MAX_AGE_MS) return stored;
      throw new TwitchViewerError('catalog_unavailable');
    }
  }

  async storedCatalog(
    userId: string,
    q: Queryable = this.db,
  ): Promise<BonkLabCatalog | null> {
    const row = (
      await q.query<{
        fetched_at: Date;
        emotes: BonkLabTwitchEmote[];
        owners: BonkLabTwitchOwner[];
      }>(
        'select fetched_at, emotes, owners from bonk_lab_viewer_catalogs where user_id = $1',
        [userId],
      )
    )[0];
    return row
      ? {
          user_id: userId,
          fetched_at: new Date(row.fetched_at).toISOString(),
          emotes: row.emotes,
          owners: row.owners,
        }
      : null;
  }

  private async fetchCatalog(userId: string): Promise<BonkLabCatalog> {
    const raw: HelixEmote[] = [];
    let after: string | null = null;
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES)
        throw new TwitchViewerError('catalog_unavailable', 'too many pages');
      const qs = new URLSearchParams({ user_id: userId });
      if (after) qs.set('after', after);
      const res = await this.helix(userId, `/chat/emotes/user?${qs}`);
      const body = (await res.json()) as {
        data?: HelixEmote[];
        pagination?: { cursor?: string };
      };
      raw.push(...(body.data ?? []));
      after = body.pagination?.cursor || null;
      if (!after) break;
    }
    const ownerIds = [
      ...new Set(
        raw.map((e) => e.owner_id).filter((id) => /^[1-9]\d*$/.test(id)),
      ),
    ];
    const token = (await this.tokenRow(userId))!;
    const owners: BonkLabTwitchOwner[] = [];
    for (let i = 0; i < ownerIds.length; i += 100)
      owners.push(
        ...(await this.getUsers(
          token.access_token,
          ownerIds.slice(i, i + 100),
        )),
      );
    const byOwner = new Map(owners.map((o) => [o.id, o]));
    const seen = new Set<string>();
    const emotes: BonkLabTwitchEmote[] = [];
    for (const e of raw) {
      if (!/^[A-Za-z0-9_]{1,64}$/.test(String(e.id)) || seen.has(e.id))
        continue;
      seen.add(e.id);
      const formats = Array.isArray(e.format)
        ? e.format.map(String)
        : ['static'];
      const animated = formats.includes('animated');
      const owner = byOwner.get(String(e.owner_id));
      emotes.push({
        provider: 'twitch',
        id: String(e.id),
        name: String(e.name),
        emote_type: String(e.emote_type ?? ''),
        emote_set_id: String(e.emote_set_id ?? ''),
        owner_id: String(e.owner_id ?? ''),
        owner_login: owner?.login ?? null,
        owner_display_name: owner?.display_name ?? null,
        formats,
        animated,
        url: twitchEmoteUrl(e.id, animated ? 'animated' : 'static'),
        static_url: twitchEmoteUrl(e.id, 'static'),
      });
    }
    const fetchedAt = this.clock.now();
    await this.db.query(
      `insert into bonk_lab_viewer_catalogs (user_id, fetched_at, emotes, owners) values ($1, $2, $3, $4)
       on conflict (user_id) do update set fetched_at = excluded.fetched_at, emotes = excluded.emotes, owners = excluded.owners`,
      [userId, fetchedAt, JSON.stringify(emotes), JSON.stringify(owners)],
    );
    return {
      user_id: userId,
      fetched_at: fetchedAt.toISOString(),
      emotes,
      owners,
    };
  }

  // --- Twitch HTTP ---------------------------------------------------------------------------------

  /** Helix GET with the viewer token: refreshes an expired token, retries once after a 401. */
  private async helix(
    userId: string,
    path: string,
    retried = false,
  ): Promise<Response> {
    let row = await this.tokenRow(userId);
    if (!row) throw new TwitchViewerError('viewer_not_linked');
    if (
      new Date(row.expires_at).getTime() - 60_000 <=
      this.clock.now().getTime()
    )
      row = await this.refresh(row);
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.twitch.tv/helix${path}`, {
        headers: {
          authorization: `Bearer ${row.access_token}`,
          'client-id': this.app.clientId,
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new TwitchViewerError('catalog_unavailable');
    }
    if (res.status === 401 && !retried) {
      await this.refresh(row);
      return this.helix(userId, path, true);
    }
    if (res.status === 401) throw await this.unlink(userId);
    if (!res.ok)
      throw new TwitchViewerError('catalog_unavailable', `helix ${res.status}`);
    return res;
  }

  private async refresh(row: TokenRow): Promise<TokenRow> {
    let token: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    try {
      token = await this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: row.refresh_token,
      });
    } catch (error) {
      // Only a definitive refusal from Twitch forgets the token; a network error keeps it.
      if (
        (error as { status?: number }).status === 400 ||
        (error as { status?: number }).status === 401
      )
        throw await this.unlink(row.user_id);
      throw new TwitchViewerError(
        'catalog_unavailable',
        'token refresh unreachable',
      );
    }
    const expiresAt = new Date(
      this.clock.now().getTime() + token.expires_in * 1000,
    );
    await this.db.query(
      `update bonk_lab_viewer_tokens set access_token = $2, refresh_token = $3, expires_at = $4, updated_at = $5
       where user_id = $1`,
      [
        row.user_id,
        token.access_token,
        token.refresh_token,
        expiresAt,
        this.clock.now(),
      ],
    );
    return { ...row, ...token, expires_at: expiresAt };
  }

  /** Refused/revoked authorization: forget the token, ask the viewer to reconnect. */
  private async unlink(userId: string) {
    await this.db.query(
      'delete from bonk_lab_viewer_tokens where user_id = $1',
      [userId],
    );
    return new TwitchViewerError('reauth_required');
  }

  private async tokenRequest(params: Record<string, string>) {
    const res = await this.fetchImpl('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: this.app.clientId,
        client_secret: this.app.clientSecret,
        ...params,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok)
      throw Object.assign(new Error(`token endpoint ${res.status}`), {
        status: res.status,
      });
    const body = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!body.access_token || !body.refresh_token)
      throw new Error('incomplete token');
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_in: Number(body.expires_in ?? 3600),
    };
  }

  private async validate(accessToken: string) {
    const res = await this.fetchImpl('https://id.twitch.tv/oauth2/validate', {
      headers: { authorization: `OAuth ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok)
      throw new TwitchViewerError(
        'oauth_exchange_failed',
        `validate ${res.status}`,
      );
    const info = (await res.json()) as {
      client_id: string;
      login: string;
      user_id: string;
      scopes?: string[];
    };
    if (!/^\d+$/.test(String(info.user_id)))
      throw new TwitchViewerError('oauth_exchange_failed');
    return info;
  }

  private async revoke(accessToken: string) {
    await this.fetchImpl('https://id.twitch.tv/oauth2/revoke', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: this.app.clientId,
        token: accessToken,
      }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => undefined);
  }

  private async getUsers(
    accessToken: string,
    ids: string[],
  ): Promise<BonkLabTwitchOwner[]> {
    if (!ids.length) return [];
    const qs = new URLSearchParams(ids.map((id) => ['id', id]));
    const res = await this.fetchImpl(
      `https://api.twitch.tv/helix/users?${qs}`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          'client-id': this.app.clientId,
        },
        signal: AbortSignal.timeout(8000),
      },
    ).catch(() => null);
    if (!res?.ok) return []; // owner names are presentation only: never block the catalog
    const body = (await res.json()) as {
      data?: {
        id: string;
        login: string;
        display_name: string;
        profile_image_url?: string;
      }[];
    };
    return (body.data ?? []).map((u) => ({
      id: String(u.id),
      login: String(u.login),
      display_name: String(u.display_name || u.login),
      profile_image_url:
        u.profile_image_url &&
        /^https:\/\/static-cdn\.jtvnw\.net\//.test(u.profile_image_url)
          ? u.profile_image_url
          : null,
    }));
  }

  private async tokenRow(userId: string): Promise<TokenRow | null> {
    return (
      (
        await this.db.query<TokenRow>(
          'select user_id, login, display_name, access_token, refresh_token, scopes, expires_at from bonk_lab_viewer_tokens where user_id = $1',
          [userId],
        )
      )[0] ?? null
    );
  }
}
