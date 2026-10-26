import { SUB_WHEEL } from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';

// Roue du Sub V2, lot R3 (docs/SUB_WHEEL_V2_PLAN.md § 8): which right the next wheel draws, in mode v2. Read inside
// claimAnimation's transaction (channel lock held, one wheel at a time). Manual requests first (requested_at), then
// the automatic queue (acquired_at): live in progress, viewer PRESENT, its alert ended (or 20 s). A right under review
// (open / unresolved) is filtered HERE, in SQL: it never heads the queue, never blocks the next ones; draw() refuses it
// again anyway. Rows another transaction holds are skipped (taken at the next claim), never waited for.

/** Presence (§ 8): seen in an `ok` chatters reading of the current live less than 5 min ago. */
export const PRESENCE_FRESH_MS = 5 * 60_000;
export type Presence = 'present' | 'absent' | 'unknown';
/**
 * Where the live and the presence come from: tracked — production (the Daily's stream sessions, Get Chatters
 * readings) · lab_sim — the Lab's explicit simulator (Lab session, simulated readings; Lab database only) · none —
 * neither (presence always unknown: no automatic draw).
 */
export type PresenceMode = 'tracked' | 'lab_sim' | 'none';

const LIVE_STREAM =
  '(select stream_id from stream_sessions where ended_at is null order by started_at desc limit 1)';
const NOT_UNDER_REVIEW = `not exists (select 1 from sw_spin_reviews v
  where v.spin_id = s.spin_id and v.status in ('open', 'unresolved'))`;
const FIRST_AT =
  '(select min(p.occurred_at) from sw_spin_sources p where p.spin_id = s.spin_id) as first_at';
/** The requests of the viewer itself (command, chat answer, extension) wait for its presence: it sees its wheel. */
const VIEWER_REQUEST = `s.requested_via in ('command', 'chat_accept', 'extension')`;

/** « Live in progress and the viewer of row `s` present »; `$2` = the freshness bound (now − 5 min). */
function presentSql(mode: PresenceMode) {
  if (mode === 'tracked')
    return `exists (select 1 from presence_viewer_streams p
      where p.stream_id = ${LIVE_STREAM} and p.twitch_user_id = s.viewer_id and p.last_seen_at >= $2)`;
  if (mode === 'lab_sim')
    return `($2::timestamptz is not null
      and exists (select 1 from lab_stream_sessions l where l.channel_id = s.channel_id and l.ended_at is null)
      and exists (select 1 from lab_sw_presence_feed f where f.channel_id = s.channel_id and f.readings)
      and exists (select 1 from lab_sw_presence p
        where p.channel_id = s.channel_id and p.viewer_id = s.viewer_id and p.present))`;
  return '($2::timestamptz is null)';
}

export interface Candidate {
  spin_id: string;
  /** Twitch time of its first proof: the economic cutover boundary of its gain. */
  first_at: Date | null;
}

/**
 * Draws asked, oldest request first. Wheel on, mode v2. A request of the broadcaster or a moderator needs neither the
 * live nor the presence; a request of the viewer itself waits for its presence in the live.
 */
export async function requestedRights(
  q: Queryable,
  channelId: string,
  now: Date,
  mode: PresenceMode,
) {
  return q.query<Candidate>(
    `select s.spin_id, ${FIRST_AT} from sw_spins s
     where s.channel_id = $1 and s.status = 'requested' and ${NOT_UNDER_REVIEW}
       and (s.requested_via is null or not (${VIEWER_REQUEST}) or ${presentSql(mode)})
     order by s.requested_at, s.seq limit 20
     for update of s skip locked`,
    [channelId, new Date(now.getTime() - PRESENCE_FRESH_MS)],
  );
}

/** The automatic queue: auto owed rights of viewers present in the current live, in acquisition order (R-3, R-4). */
export async function autoRights(
  q: Queryable,
  channelId: string,
  now: Date,
  mode: PresenceMode,
) {
  if (mode === 'none') return [];
  return q.query<Candidate>(
    `select s.spin_id, ${FIRST_AT} from sw_spins s
     where s.channel_id = $1 and s.status = 'owed' and s.queue = 'auto' and ${NOT_UNDER_REVIEW}
       and ${presentSql(mode)}
       and (s.alert_id is null
         or exists (select 1 from alert_items a where a.alert_id = s.alert_id
           and a.status in ('completed', 'failed', 'expired'))
         or s.created_at <= $3)
     order by s.acquired_at, s.seq limit 20
     for update of s skip locked`,
    [
      channelId,
      new Date(now.getTime() - PRESENCE_FRESH_MS),
      new Date(now.getTime() - SUB_WHEEL.afterAlertMaxMs),
    ],
  );
}

/**
 * A wheel drawn but never shown for sure, due again (recovery `retry`, its delay over): the SAME draw shown again,
 * nothing credited again. The caller checked mode v2 and wheel on. Like its draw: a request of the broadcaster or a
 * moderator needs neither the live nor the presence; otherwise live and the viewer present (it sees its wheel). Oldest
 * due first.
 */
export async function retryDue(
  q: Queryable,
  channelId: string,
  now: Date,
  mode: PresenceMode,
) {
  return q.query<{ spin_id: string }>(
    `select s.spin_id from sw_spins s
     where s.channel_id = $1 and s.status = 'failed' and s.recovery = 'retry' and s.retry_at <= $3
       and ((s.requested_via is not null and not (${VIEWER_REQUEST})) or ${presentSql(mode)})
     order by s.retry_at, s.seq limit 1
     for update of s skip locked`,
    [channelId, new Date(now.getTime() - PRESENCE_FRESH_MS), now],
  );
}

/**
 * An OBS alert playing or about to (taken by the alerts player, or waiting less than SUB_WHEEL.afterAlertMaxMs): a V2
 * wheel never starts over it. Bounded: a lease ends, a waiting alert stops counting after that delay.
 */
export async function alertInFlight(
  q: Queryable,
  channelId: string,
  now: Date,
) {
  return (
    (
      await q.query(
        `select 1 from alert_items where channel_id = $1
           and ((status in ('claimed', 'playing') and lease_expires_at > $2) or (status = 'queued' and created_at > $3))
         limit 1`,
        [channelId, now, new Date(now.getTime() - SUB_WHEEL.afterAlertMaxMs)],
      )
    ).length > 0
  );
}

/**
 * Presence of these viewers (§ 8, three states): present · absent (fresh `ok` readings without them) · unknown (no
 * live, or no `ok` reading for 5 min: never taken for an absence). Lab: the simulator's readings.
 */
export async function presenceOf(
  q: Queryable,
  mode: PresenceMode,
  channelId: string,
  viewerIds: string[],
  now: Date,
): Promise<Map<string, Presence>> {
  const unknown = () =>
    new Map(viewerIds.map((id) => [id, 'unknown' as const]));
  if (mode === 'none' || !viewerIds.length) return unknown();
  if (mode === 'lab_sim') {
    const on = (
      await q.query<{ on: boolean }>(
        `select f.readings and exists (select 1 from lab_stream_sessions l
           where l.channel_id = f.channel_id and l.ended_at is null) as on
         from lab_sw_presence_feed f where f.channel_id = $1`,
        [channelId],
      )
    )[0]?.on;
    if (!on) return unknown();
    const present = new Set(
      (
        await q.query<{ id: string }>(
          `select viewer_id as id from lab_sw_presence
           where channel_id = $1 and viewer_id = any($2::text[]) and present`,
          [channelId, viewerIds],
        )
      ).map((r) => r.id),
    );
    return new Map(
      viewerIds.map((id) => [id, present.has(id) ? 'present' : 'absent']),
    );
  }
  const since = new Date(now.getTime() - PRESENCE_FRESH_MS);
  const fresh =
    (
      await q.query(
        `select 1 from presence_cycles where stream_id = ${LIVE_STREAM} and status = 'ok' and observed_at >= $1
         limit 1`,
        [since],
      )
    ).length > 0;
  const seen = new Set(
    (
      await q.query<{ id: string }>(
        `select twitch_user_id as id from presence_viewer_streams
         where stream_id = ${LIVE_STREAM} and twitch_user_id = any($1::text[]) and last_seen_at >= $2`,
        [viewerIds, since],
      )
    ).map((r) => r.id),
  );
  return new Map(
    viewerIds.map((id) => [
      id,
      seen.has(id) ? 'present' : fresh ? 'absent' : 'unknown',
    ]),
  );
}
