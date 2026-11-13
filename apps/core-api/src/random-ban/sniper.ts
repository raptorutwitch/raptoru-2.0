import type { Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';

// Random Ban — the Sniper (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 4): a PREDICTION, never a targeting. The wished
// viewer is frozen on the request at purchase (Twitch id, checked against the viewers present) and NEVER handed to the
// draw (the executor's claim carries the buyer only). At the result, under the request's row lock:
// - rewardable = no other COUNTED Random Ban of the buyer (any source; failed / canceled / Studio tests never count)
//   created in the window (30 min) before this one — read with the FINAL statuses (the queue runs one request at a
//   time), so a previous request that failed and was refunded never takes the chance away;
// - hit = the drawn target is the wished one; a hit that is rewardable pays the bonus ONCE (ledger key
//   `rb:sniper:<request_id>`), in the same transaction;
// - a request that did nothing (failed, uncertain, canceled) is `void`: no bonus, never later.

export interface RbCandidate {
  id: string;
  login: string;
  name: string;
}

/** The viewers a buyer may aim at (present now): presence in Production, the Lab's fictional chatters in the Lab. */
export type RbCandidates = (
  q: Queryable,
  channelId: string,
) => Promise<RbCandidate[]>;

/** Present = seen by the presence worker in the open stream within 5 min (Get Chatters every 120 s), with its name. */
export const presenceCandidates: RbCandidates = async (q) => {
  const ok = (
    await q.query<{ ok: boolean }>(
      `select to_regclass('presence_viewer_streams') is not null and to_regclass('stream_sessions') is not null
         and to_regclass('viewers') is not null as ok`,
    )
  )[0]?.ok;
  if (!ok) return [];
  return q.query<RbCandidate>(
    `select v.twitch_user_id as id, v.login, v.display_name as name from presence_viewer_streams p
       join viewers v on v.twitch_user_id = p.twitch_user_id
      where p.stream_id = (select stream_id from stream_sessions where ended_at is null order by started_at desc limit 1)
        and p.last_seen_at > now() - interval '5 minutes'
      order by lower(v.display_name) limit 300`,
  );
};

/** What the buyer typed, cleaned: trimmed, « @ » dropped, at most 40 characters (null: nothing). */
export function cleanWishText(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.trim().replace(/^@+/, '').trim().slice(0, 40);
  return t || null;
}

/**
 * The ONE account a typed name designates for sure: the login or the display name, case-insensitive (Twitch logins are
 * unique). Nothing else is ever guessed: a typo stays unresolved, for a moderator to settle.
 */
export function exactWish<T extends RbCandidate>(pool: T[], text: string) {
  const t = text.toLowerCase();
  const byLogin = pool.find((c) => c.login.toLowerCase() === t);
  if (byLogin) return byLogin;
  const byName = pool.filter((c) => c.name.toLowerCase() === t);
  return byName.length === 1 ? byName[0]! : null;
}

/** Counted for the Sniper window: a real trigger of the buyer that did something or still may (not test, failed, canceled). */
const COUNTED = `source <> 'test' and status not in ('failed', 'canceled')`;

/**
 * Is a Sniper attempt created at `at` rewardable (no other counted Random Ban of the buyer in the window before it)?
 * `ready_at`: when the next attempt becomes rewardable (null: now).
 */
export async function sniperWindow(
  q: Queryable,
  channelId: string,
  buyerId: string,
  at: Date,
  windowMs: number,
  exclude: string | null = null,
) {
  const last = (
    await q.query<{ created_at: Date }>(
      // Only the requests registered BEFORE this one (seq order: two purchases in the same millisecond never count
      // each other both ways); at purchase (no row yet), every request already there.
      `select created_at from rb_requests where channel_id = $1 and buyer_id = $2 and ${COUNTED}
         and created_at <= $3
         and ($4::uuid is null or seq < (select seq from rb_requests where request_id = $4::uuid))
       order by seq desc limit 1`,
      [channelId, buyerId, at, exclude],
    )
  )[0];
  const until = last ? new Date(last.created_at).getTime() + windowMs : 0;
  return {
    ready: until <= at.getTime(),
    ready_at: until > at.getTime() ? new Date(until).toISOString() : null,
  };
}

const FINAL = [
  'confirmed',
  'flop',
  'failed',
  'uncertain',
  'canceled',
  'simulated',
];

/**
 * Decides the Sniper of one ended request, once (row lock; only `armed` — a prediction not decided yet — is open). Returns the bonus
 * paid now (0 otherwise). No economy here (a Core without one): left open, decided by a later pass.
 */
export async function settleSniper(
  q: Queryable,
  requestId: string,
  o: {
    economy: EconomyPort | null;
    bonus: number;
    windowMs: number;
    now: Date;
  },
): Promise<number> {
  const r = (
    await q.query<{
      request_id: string;
      channel_id: string;
      buyer_id: string;
      buyer_name: string;
      status: string;
      sniper: string;
      wish_id: string | null;
      target_id: string | null;
      created_at: Date;
    }>(
      `select request_id, channel_id, buyer_id, buyer_name, status, sniper, wish_id, target_id, created_at
         from rb_requests where request_id = $1 for update`,
      [requestId],
    )
  )[0];
  if (!r || !FINAL.includes(r.status)) return 0;
  // An unresolved prediction (a typed name, no sure account) waits for a moderator — unless nothing happened.
  if (r.sniper === 'unresolved') {
    if (['failed', 'uncertain', 'canceled'].includes(r.status))
      await q.query(
        `update rb_requests set sniper = 'void', updated_at = $2 where request_id = $1`,
        [requestId, o.now],
      );
    return 0;
  }
  if (!r.wish_id || r.sniper !== 'armed') return 0;
  const set = (sniper: string, bonus = 0) =>
    q.query(
      `update rb_requests set sniper = $2, updated_at = $3,
         stats = case when $4::int > 0 then coalesce(stats, '{}'::jsonb) || jsonb_build_object('sniper_bonus', $4::int)
                 else stats end
       where request_id = $1`,
      [requestId, sniper, o.now, bonus],
    );
  if (['failed', 'uncertain', 'canceled'].includes(r.status)) {
    await set('void');
    return 0;
  }
  const { ready } = await sniperWindow(
    q,
    r.channel_id,
    r.buyer_id,
    new Date(r.created_at),
    o.windowMs,
    r.request_id,
  );
  const hit =
    (r.status === 'confirmed' || r.status === 'simulated') &&
    r.target_id === r.wish_id;
  if (!hit) {
    await set(ready ? 'miss' : 'glory');
    return 0;
  }
  if (!ready || o.bonus <= 0) {
    await set('glory_hit');
    return 0;
  }
  if (!o.economy) return 0;
  await o.economy.move(q, o.now, {
    channelId: r.channel_id,
    viewerId: r.buyer_id,
    currency: 'tokens',
    amount: o.bonus,
    kind: 'mini_game',
    key: `rb:sniper:${requestId}`,
    moduleId: 'random_ban',
  });
  await set('hit', o.bonus);
  return o.bonus;
}

/**
 * A moderator settles an UNRESOLVED prediction (Studio › Modération › Random Ban): the account the typed name meant, or
 * none. Under the request's row lock and only from `unresolved` (a second resolution finds it decided: refused). The
 * draw is untouched (its target was frozen long before); a resolved hit pays through settleSniper, once per request
 * (ledger key `rb:sniper:<request_id>`).
 */
export async function resolveSniper(
  q: Queryable,
  requestId: string,
  account: RbCandidate | null,
  o: {
    economy: EconomyPort | null;
    bonus: number;
    windowMs: number;
    now: Date;
  },
): Promise<{ sniper: string; bonus: number }> {
  const r = (
    await q.query<{ sniper: string; buyer_id: string }>(
      `select sniper, buyer_id from rb_requests where request_id = $1 for update`,
      [requestId],
    )
  )[0];
  if (!r)
    throw Object.assign(new Error('random_ban_not_found'), { status: 404 });
  if (r.sniper !== 'unresolved')
    throw Object.assign(new Error('sniper_not_unresolved'), { status: 409 });
  if (account && account.id === r.buyer_id)
    throw Object.assign(new Error('wish_self'), { status: 400 });
  if (!account) {
    await q.query(
      `update rb_requests set sniper = 'void', updated_at = $2 where request_id = $1`,
      [requestId, o.now],
    );
    return { sniper: 'void', bonus: 0 };
  }
  await q.query(
    `update rb_requests set wish_id = $2, wish_login = $3, wish_name = $4, sniper = 'armed', updated_at = $5
       where request_id = $1`,
    [requestId, account.id, account.login, account.name, o.now],
  );
  const bonus = await settleSniper(q, requestId, o);
  const after = (
    await q.query<{ sniper: string }>(
      'select sniper from rb_requests where request_id = $1',
      [requestId],
    )
  )[0]!;
  return { sniper: after.sniper, bonus };
}
