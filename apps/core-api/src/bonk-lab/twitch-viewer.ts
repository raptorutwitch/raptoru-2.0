import { randomBytes } from 'node:crypto';
import type {
  BonkLabCatalog,
  BonkLabTwitchEmote,
  BonkLabTwitchOwner,
  BonkLabViewer,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import { openToken, sealToken } from './token-crypto.js';

// Bonk — Twitch viewer identity and personal emote catalog. Read-only: the only scope is
// user:read:emotes, the only Twitch data calls are Get User Emotes and Get Users. One OAuth system for
// the local Lab Core (Studio loopback redirect) and the public Core (/v1/ext, HTTPS redirect, viewer
// of the extension JWT, tokens encrypted at rest). No route returns a token. Core builds every emote
// URL itself from the emote id (the client never supplies a URL).

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
      | 'oauth_wrong_account'
      | 'oauth_unavailable'
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

/** Emotes of a viewer as the extension shows them (Bonk source « Twitch »). */
export type TwitchEmotesStatus =
  'not_linked' | 'syncing' | 'ready' | 'stale' | 'reauth_required';

export interface TwitchViewerOptions {
  /** OAuth redirect: the Studio loopback (default, Lab Core), an HTTPS URL (public Core), or null = no linking. */
  redirectUri?: string | null;
  /** EXT_TOKEN_KEY (32 bytes): tokens encrypted at rest. Null = stored as they are (local Lab Core). */
  tokenKey?: Buffer | null;
}

/** CDN URL built only from a validated Twitch emote id (dark theme, largest scale). */
export function twitchEmoteUrl(id: string, format: 'static' | 'animated') {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(id))
    throw new Error('invalid_twitch_emote_id');
  return `https://static-cdn.jtvnw.net/emoticons/v2/${id}/${format}/dark/3.0`;
}

export class TwitchViewerCatalog {
  private readonly redirectUri: string | null;
  private readonly tokenKey: Buffer | null;
  /** Background catalog reloads in flight, and the last one's error (per viewer, this process). */
  private readonly syncs = new Map<string, Promise<void>>();
  private readonly syncErrors = new Map<string, string>();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly app: { clientId: string; clientSecret: string },
    private readonly fetchImpl: Fetch = fetch,
    options: TwitchViewerOptions = {},
  ) {
    this.redirectUri =
      options.redirectUri === undefined
        ? VIEWER_REDIRECT_URI
        : options.redirectUri;
    this.tokenKey = options.tokenKey ?? null;
  }

  // --- OAuth ---------------------------------------------------------------------------------------

  /** Linking possible (a redirect is configured). */
  get canLink() {
    return this.redirectUri !== null;
  }

  /**
   * @param viewerId Twitch user id the authorization is for (public frontier: the JWT's). The
   *   account authorized at Twitch must be this one. Null = Lab (the Studio's own viewer).
   */
  async startAuth(
    viewerId: string | null = null,
  ): Promise<{ authorization_url: string }> {
    if (!this.redirectUri) throw new TwitchViewerError('oauth_unavailable');
    const state = randomBytes(24).toString('hex');
    const now = this.clock.now();
    await this.db.query(
      'insert into bonk_lab_oauth_states (state, created_at, expires_at, viewer_id) values ($1, $2, $3, $4)',
      [state, now, new Date(now.getTime() + STATE_TTL_MS), viewerId],
    );
    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: this.app.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: VIEWER_SCOPES.join(' '),
      state,
      force_verify: 'true', // always show the account picker: authorize the intended account
    }).toString();
    return { authorization_url: url.href };
  }

  async completeAuth(code: string, state: string): Promise<BonkLabViewer> {
    const now = this.clock.now();
    if (!this.redirectUri) throw new TwitchViewerError('oauth_unavailable');
    const used = await this.db.query<{ viewer_id: string | null }>(
      `update bonk_lab_oauth_states set used_at = $2
       where state = $1 and used_at is null and expires_at > $2 returning viewer_id`,
      [state, now],
    );
    if (!used.length) throw new TwitchViewerError('oauth_state_invalid');

    const token = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    }).catch(() => {
      throw new TwitchViewerError('oauth_exchange_failed');
    });
    const info = await this.validate(token.access_token);
    if (info.client_id !== this.app.clientId)
      throw new TwitchViewerError('oauth_wrong_client');
    // Public frontier: the authorized account must be the viewer the link was started for (JWT).
    const expected = used[0]!.viewer_id;
    if (expected && info.user_id !== expected) {
      await this.revoke(token.access_token);
      throw new TwitchViewerError('oauth_wrong_account');
    }
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
        sealToken(token.access_token, this.tokenKey),
        sealToken(token.refresh_token, this.tokenKey),
        scopes,
        new Date(now.getTime() + token.expires_in * 1000),
        now,
      ],
    );
    await this.db.query(
      'delete from bonk_lab_viewer_catalogs where user_id = $1',
      [info.user_id],
    );
    await this.db.query(
      'delete from bonk_lab_viewer_reauth where user_id = $1',
      [info.user_id],
    );
    this.syncErrors.delete(info.user_id);
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

  /** The viewer's own choice: revoked at Twitch, forgotten here (not linked, no reconnection asked). */
  async disconnect(userId: string): Promise<{ disconnected: boolean }> {
    const row = await this.tokenRow(userId);
    if (row) await this.revoke(row.access_token);
    const removed = await this.db.query(
      'delete from bonk_lab_viewer_tokens where user_id = $1 returning 1',
      [userId],
    );
    await this.db.query(
      'delete from bonk_lab_viewer_reauth where user_id = $1',
      [userId],
    );
    this.syncErrors.delete(userId);
    return { disconnected: removed.length > 0 };
  }

  /**
   * What the extension shows for this viewer: the stored catalog at once (never an empty screen when
   * one exists), a reload in the background when it is missing or older than 10 min.
   * - ready: fresh catalog; syncing: reload in progress (the stored catalog, if any, is shown);
   * - stale: Twitch unreachable on the last reload, a catalog of less than 1 h is kept (same rule as the
   *   Bonk admission); reauth_required: Twitch refused the authorization (revoked / invalid);
   * - not_linked: never linked, or unlinked by the viewer.
   * `waitMs`: how long to wait for the reload before answering (forced refresh).
   */
  async emotesState(
    userId: string,
    { force = false, waitMs = 0 } = {},
  ): Promise<{
    status: TwitchEmotesStatus;
    viewer: { user_id: string; login: string; display_name: string } | null;
    catalog: BonkLabCatalog | null;
  }> {
    const linked = async () =>
      (
        await this.db.query<{
          user_id: string;
          login: string;
          display_name: string;
        }>(
          'select user_id, login, display_name from bonk_lab_viewer_tokens where user_id = $1',
          [userId],
        )
      )[0] ?? null;
    const notLinked = async () => {
      const reauth = (
        await this.db.query<{
          user_id: string;
          login: string;
          display_name: string;
        }>(
          'select user_id, login, display_name from bonk_lab_viewer_reauth where user_id = $1',
          [userId],
        )
      )[0];
      return {
        status: reauth ? ('reauth_required' as const) : ('not_linked' as const),
        viewer: reauth ?? null,
        catalog: null,
      };
    };
    if (!(await linked())) return notLinked();
    const before = await this.storedCatalog(userId);
    const age = (c: BonkLabCatalog | null) =>
      c ? this.clock.now().getTime() - Date.parse(c.fetched_at) : Infinity;
    if (force || age(before) >= CATALOG_FRESH_MS) {
      let sync = this.syncs.get(userId);
      if (!sync) {
        sync = this.fetchCatalog(userId)
          .then(() => void this.syncErrors.delete(userId))
          .catch((error: unknown) => {
            this.syncErrors.set(
              userId,
              error instanceof TwitchViewerError
                ? error.code
                : 'catalog_unavailable',
            );
          })
          .finally(() => this.syncs.delete(userId));
        this.syncs.set(userId, sync);
      }
      if (waitMs > 0)
        await Promise.race([
          sync,
          new Promise((r) => setTimeout(r, waitMs).unref?.()),
        ]);
    }
    const viewer = await linked();
    if (!viewer) return notLinked(); // refused during the reload
    const catalog = await this.storedCatalog(userId);
    let status: TwitchEmotesStatus;
    if (this.syncs.has(userId)) status = 'syncing';
    else if (age(catalog) < CATALOG_FRESH_MS) status = 'ready';
    else if (catalog && age(catalog) < CATALOG_MAX_AGE_MS) status = 'stale';
    else status = 'syncing'; // Twitch unreachable and nothing recent: the next read tries again
    return {
      status,
      viewer,
      catalog: catalog && age(catalog) < CATALOG_MAX_AGE_MS ? catalog : null,
    };
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
        sealToken(token.access_token, this.tokenKey),
        sealToken(token.refresh_token, this.tokenKey),
        expiresAt,
        this.clock.now(),
      ],
    );
    return { ...row, ...token, expires_at: expiresAt };
  }

  /** Refused/revoked authorization: forget the token, remember that the viewer must reconnect. */
  private async unlink(userId: string) {
    const gone = await this.db.query<{ login: string; display_name: string }>(
      'delete from bonk_lab_viewer_tokens where user_id = $1 returning login, display_name',
      [userId],
    );
    if (gone[0])
      await this.db.query(
        `insert into bonk_lab_viewer_reauth (user_id, login, display_name, at) values ($1, $2, $3, $4)
         on conflict (user_id) do update set login = excluded.login, display_name = excluded.display_name, at = excluded.at`,
        [userId, gone[0].login, gone[0].display_name, this.clock.now()],
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

  /** The stored token, decrypted. Unreadable (key changed / missing): the viewer must reconnect. */
  private async tokenRow(userId: string): Promise<TokenRow | null> {
    const row =
      (
        await this.db.query<TokenRow>(
          'select user_id, login, display_name, access_token, refresh_token, scopes, expires_at from bonk_lab_viewer_tokens where user_id = $1',
          [userId],
        )
      )[0] ?? null;
    if (!row) return null;
    const access = openToken(row.access_token, this.tokenKey);
    const refresh = openToken(row.refresh_token, this.tokenKey);
    if (access === null || refresh === null) throw await this.unlink(userId);
    return { ...row, access_token: access, refresh_token: refresh };
  }
}
