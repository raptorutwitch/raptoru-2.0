import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';

// Twitch profile pictures of the Tombola participants. A background refresh (Lab Core tick) fills a
// cache; reads never call Twitch. No picture (none, error, not fetched yet) = the initials fallback
// of the prototype, so a reveal never waits for an avatar.

/** Looks up Twitch users by id (Helix Get Users, at most 100 ids per call). */
export type TwitchUserLookup = (
  ids: string[],
) => Promise<{ id: string; profile_image_url: string }[]>;

const OK_TTL_MS = 24 * 3600_000;
const RETRY_MS = 3600_000;
const AVATAR_URL = /^https:\/\/static-cdn\.jtvnw\.net\/[^\s"'<>]+$/;

export async function avatarUrls(
  q: Queryable,
  ids: string[],
): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await q.query<{ viewer_id: string; url: string }>(
    `select viewer_id, url from lab_viewer_avatars where viewer_id = any($1::text[]) and status = 'ok'`,
    [ids],
  );
  return new Map(rows.map((r) => [r.viewer_id, r.url]));
}

export class AvatarCache {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly lookup: TwitchUserLookup | null,
  ) {}

  /**
   * Fetches the missing / stale pictures of the viewers of the running and recent rounds (one batch
   * of at most 100 per call). Returns how many viewers were looked up.
   */
  async refresh(): Promise<number> {
    if (!this.lookup) return 0;
    const now = this.clock.now();
    const due = (
      await this.db.query<{ viewer_id: string }>(
        `select distinct e.viewer_id from lab_raffle_entries e
         join lab_raffles r on r.raffle_id = e.raffle_id
         left join lab_viewer_avatars a on a.viewer_id = e.viewer_id
         where (r.status not in ('cancelled', 'finished') or r.opened_at > $1)
           and (a.viewer_id is null or (a.status = 'ok' and a.fetched_at < $2) or (a.status <> 'ok' and a.fetched_at < $3))
         limit 100`,
        [
          new Date(now.getTime() - 6 * 3600_000),
          new Date(now.getTime() - OK_TTL_MS),
          new Date(now.getTime() - RETRY_MS),
        ],
      )
    ).map((r) => r.viewer_id);
    if (!due.length) return 0;
    let found: { id: string; profile_image_url: string }[];
    try {
      found = await this.lookup(due);
    } catch {
      await this.store(
        due.map((id) => ({ id, url: null, status: 'error' })),
        now,
      );
      return due.length;
    }
    const byId = new Map(found.map((u) => [u.id, u.profile_image_url]));
    await this.store(
      due.map((id) => {
        const url = byId.get(id) ?? '';
        return AVATAR_URL.test(url)
          ? { id, url, status: 'ok' }
          : { id, url: null, status: 'missing' };
      }),
      now,
    );
    return due.length;
  }

  private async store(
    rows: { id: string; url: string | null; status: string }[],
    now: Date,
  ) {
    for (const r of rows)
      await this.db.query(
        `insert into lab_viewer_avatars (viewer_id, url, status, fetched_at) values ($1, $2, $3, $4)
         on conflict (viewer_id) do update set url = excluded.url, status = excluded.status, fetched_at = excluded.fetched_at`,
        [r.id, r.url, r.status, now],
      );
  }
}

/** Helix Get Users with an app access token (client credentials, no user scope needed). */
export function twitchAppUserLookup(
  app: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): TwitchUserLookup {
  let token: { value: string; until: number } | null = null;
  const appToken = async () => {
    if (token && token.until > Date.now() + 60_000) return token.value;
    const res = await fetchImpl('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'client_credentials',
      }),
    });
    if (!res.ok) throw new Error(`twitch_app_token_${res.status}`);
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    token = {
      value: body.access_token,
      until: Date.now() + body.expires_in * 1000,
    };
    return token.value;
  };
  return async (ids) => {
    const url = new URL('https://api.twitch.tv/helix/users');
    for (const id of ids.slice(0, 100)) url.searchParams.append('id', id);
    const res = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${await appToken()}`,
        'client-id': app.clientId,
      },
    });
    if (!res.ok) throw new Error(`twitch_users_${res.status}`);
    return (
      (await res.json()) as {
        data: { id: string; profile_image_url: string }[];
      }
    ).data;
  };
}
