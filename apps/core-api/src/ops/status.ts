import type { BotStatus } from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';
import type { ActiveSession } from '../stream/stream-sessions.js';

// Ops status (docs/CICD.md): what a deployment reads before and after touching Production — the commit this Core runs,
// whether the channel is live from two independent sources (the stream session, fed by Twitch EventSub through the
// bot, and Twitch Helix asked directly with the Core's app credentials), the bot lease with its Twitch / EventSub
// health and version, the migrations recorded. Read-only, behind its own token (OPS_TOKEN): without it the route does
// not exist. A source that cannot answer is reported as unknown (live: null), never as « offline ».

export type HelixLive = () => Promise<{
  live: boolean;
  startedAt: string | null;
}>;

export interface OpsDeps {
  session: () => Promise<ActiveSession | null>;
  helix: HelixLive | null;
  bot: (() => Promise<BotStatus>) | null;
  db: Queryable;
  commit: string | null;
  startedAt: Date;
  now: () => Date;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };
const settle = async <T>(f: () => Promise<T>): Promise<Settled<T>> => {
  try {
    return { ok: true, value: await f() };
  } catch (e) {
    return { ok: false, error: String((e as Error).message).slice(0, 120) };
  }
};

export async function opsStatus(d: OpsDeps) {
  const [session, helix, bot, migrations] = await Promise.all([
    settle(d.session),
    d.helix ? settle(d.helix) : null,
    d.bot ? settle(d.bot) : null,
    settle(() =>
      d.db.query<{ name: string }>(
        'select name from schema_migrations order by name',
      ),
    ),
  ]);
  return {
    service: 'core-api',
    commit: d.commit,
    started_at: d.startedAt.toISOString(),
    now: d.now().toISOString(),
    live: {
      session: session.ok
        ? {
            live: session.value !== null,
            since: session.value?.startedAt.toISOString() ?? null,
          }
        : { live: null, error: session.error },
      helix: !helix
        ? { live: null, error: 'not_configured' }
        : helix.ok
          ? { live: helix.value.live, since: helix.value.startedAt }
          : { live: null, error: helix.error },
    },
    bot: !bot
      ? null
      : bot.ok
        ? {
            state: bot.value.state,
            version: bot.value.active?.version ?? null,
            since: bot.value.active?.since ?? null,
            last_seen_at:
              bot.value.active?.lastSeenAt ??
              bot.value.lastSeen?.lastSeenAt ??
              null,
            health: bot.value.active?.health ?? null,
            standby: bot.value.standby.length,
          }
        : { state: 'unknown', error: bot.error },
    migrations: migrations.ok ? migrations.value.map((r) => r.name) : null,
  };
}

/** Helix « Get Streams » for one channel with the app's client credentials (token cached until a minute before expiry). */
export function helixLive(
  app: { clientId: string; clientSecret: string },
  channelId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5_000,
): HelixLive {
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
      signal: AbortSignal.timeout(timeoutMs),
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
  return async () => {
    const url = new URL('https://api.twitch.tv/helix/streams');
    url.searchParams.set('user_id', channelId);
    const res = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${await appToken()}`,
        'client-id': app.clientId,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) token = null;
    if (!res.ok) throw new Error(`twitch_streams_${res.status}`);
    const data =
      (
        (await res.json()) as {
          data?: { type?: string; started_at?: string }[];
        }
      ).data ?? [];
    const stream = data.find((s) => s.type === 'live');
    return { live: Boolean(stream), startedAt: stream?.started_at ?? null };
  };
}
