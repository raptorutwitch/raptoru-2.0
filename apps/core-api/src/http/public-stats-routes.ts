import type { Db } from '../db/db.js';

type Queryable = Pick<Db, 'query'>;
import { HttpError, limitParam, type Route } from './server.js';

// Public read contract for raptoru.fr (docs/RAPTORU_FR.md): the Jeu des mots and Tombola rankings, aggregated from the
// Core's own tables (the source of truth since the 20/10/2026 cutover). Read-only, no secret, nothing per message:
// totals per viewer only, like the Wallet and Daily leaderboards. A Core without these tables answers 404.

const PERIODS = ['semaine', 'mois', 'all'] as const;
type Period = (typeof PERIODS)[number];

/** Start of the period, Paris time (the site's historical rule: Monday 00:00, the 1st 00:00, or everything). */
const SINCE: Record<Period, string> = {
  semaine:
    "(date_trunc('week', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')",
  mois: "(date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')",
  all: "'-infinity'::timestamptz",
};

/** `?viewer=<twitch id>`: that viewer's own row (its rank in the whole ranking), or no row. */
function viewerParam(url: URL): string | null {
  const v = url.searchParams.get('viewer');
  if (v === null) return null;
  if (!/^\d{1,32}$/.test(v))
    throw new HttpError(400, { error: 'invalid_viewer' });
  return v;
}

async function hasTables(db: Queryable, tables: string[]) {
  const r = await db.query<{ ok: boolean }>(
    `select ${tables.map((_, i) => `to_regclass($${i + 1}) is not null`).join(' and ')} as ok`,
    tables,
  );
  return r[0]?.ok === true;
}

/** Public and uncredentialed: one aggregate per key every 30 s at most, whatever the traffic. */
const CACHE_MS = 30_000;

export function publicStatsRoutes(db: Queryable): Route[] {
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();
  const cached = (key: string, compute: () => Promise<unknown>) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = compute();
    if (cache.size > 2000) cache.clear(); // one key per viewer asked: never an unbounded map
    cache.set(key, { at: Date.now(), value });
    value.catch(() => cache.delete(key));
    return value;
  };
  return [
    {
      method: 'GET',
      pattern: /^\/v1\/word-game\/leaderboard$/,
      auth: 'public',
      handle: async ({ url }) =>
        cached(
          `wg:${url.searchParams.get('period')}:${url.searchParams.get('limit')}:${viewerParam(url)}`,
          async () => {
            if (!(await hasTables(db, ['word_game_finds'])))
              throw new HttpError(404, { error: 'not_available' });
            const p = url.searchParams.get('period') ?? 'semaine';
            const period: Period = (PERIODS as readonly string[]).includes(p)
              ? (p as Period)
              : 'semaine';
            const limit = limitParam(url, 100, 200);
            const rows = await db.query<{
              rank: string | number;
              twitch_user_id: string;
              login: string | null;
              display_name: string;
              points: string | number;
              words: string | number;
              fast_words: string | number;
            }>(
              `select * from (
             select row_number() over (order by sum(f.points) desc, count(*) desc, f.viewer_id) as rank,
               f.viewer_id as twitch_user_id, v.login,
               coalesce(v.display_name, max(f.viewer_display_name)) as display_name,
               sum(f.points) as points, count(*) as words, count(*) filter (where f.fast) as fast_words
             from word_game_finds f left join viewers v on v.twitch_user_id = f.viewer_id
             where f.created_at >= ${SINCE[period]}
             group by f.viewer_id, v.login, v.display_name
           ) x where $2::text is null or x.twitch_user_id = $2
           order by x.rank limit $1`,
              [limit, viewerParam(url)],
            );
            const first = await db.query<{ at: Date | null }>(
              'select min(created_at) as at from word_game_finds',
            );
            return {
              period,
              /** Where the Core's own history starts (older finds: the site's archive). */
              firstFindAt: first[0]?.at
                ? new Date(first[0].at).toISOString()
                : null,
              entries: rows.map((r) => ({
                rank: Number(r.rank),
                twitchUserId: r.twitch_user_id,
                login: r.login,
                displayName: r.display_name,
                points: Number(r.points),
                words: Number(r.words),
                fastWords: Number(r.fast_words),
              })),
            };
          },
        ),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/raffle\/leaderboard$/,
      auth: 'public',
      handle: async ({ url }) =>
        cached(
          `rf:${url.searchParams.get('limit')}:${viewerParam(url)}`,
          async () => {
            if (
              !(await hasTables(db, [
                'lab_raffles',
                'lab_raffle_entries',
                'lab_raffle_winners',
              ]))
            )
              throw new HttpError(404, { error: 'not_available' });
            const limit = limitParam(url, 100, 200);
            // Rounds that really ended (drawn); a cancelled or running round counts for nobody. Jetons won: paid
            // winnings in Jetons only (Bonbons and giveaways count as a win, never as Jetons).
            const rows = await db.query<{
              rank: string | number;
              twitch_user_id: string;
              login: string | null;
              display_name: string;
              participations: string | number;
              wins: string | number;
              total_won: string | number;
            }>(
              `with done as (select raffle_id from lab_raffles where status = 'finished'),
           part as (
             select e.viewer_id, count(*) as participations, max(e.viewer_display_name) as name
             from lab_raffle_entries e join done using (raffle_id)
             where e.removed_at is null group by e.viewer_id
           ),
           won as (
             select w.viewer_id, count(*) as wins,
               coalesce(sum(w.amount) filter (where w.currency_id = 'tokens' and w.payout_status = 'paid'), 0)
                 as total_won
             from lab_raffle_winners w join done using (raffle_id) group by w.viewer_id
           )
           select * from (
             select row_number() over (order by coalesce(w.wins, 0) desc, coalesce(w.total_won, 0) desc,
                 p.participations desc, p.viewer_id) as rank,
               p.viewer_id as twitch_user_id, v.login, coalesce(v.display_name, p.name) as display_name,
               p.participations, coalesce(w.wins, 0) as wins, coalesce(w.total_won, 0) as total_won
             from part p left join won w using (viewer_id) left join viewers v on v.twitch_user_id = p.viewer_id
           ) x where $2::text is null or x.twitch_user_id = $2
           order by x.rank limit $1`,
              [limit, viewerParam(url)],
            );
            return {
              entries: rows.map((r) => {
                const participations = Number(r.participations);
                const wins = Number(r.wins);
                return {
                  rank: Number(r.rank),
                  twitchUserId: r.twitch_user_id,
                  login: r.login,
                  displayName: r.display_name,
                  participations,
                  wins,
                  losses: Math.max(0, participations - wins),
                  totalWon: Number(r.total_won),
                };
              }),
            };
          },
        ),
    },
  ];
}
