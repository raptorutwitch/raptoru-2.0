import type { SwMode } from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';
import { RENEWAL_WINDOW_MS } from '../loyalty/engine.js';

// Roue du Sub V2, lot R1 (docs/SUB_WHEEL_V2_PLAN.md § 3–5): the identity of a right to a spin and its proofs.
// A right = one sw_spins row = one subscription month of one viewer. Every Twitch event announcing it is a proof
// (sw_spin_sources, unique per source event: a redelivery is the same proof). Twitch's cumulative months is the only
// CERTAIN month; anything else is an estimate (last certain month + 1, or 1 without history), corrected only by a proof
// of the same renewal — never by a date alone (§ 5.2). Every query here runs inside the caller's transaction, after
// lockViewer(): the acquisitions of one viewer are serialized.

export type SwSource =
  | 'chat_notification'
  | 'subscribe'
  | 'message'
  /** R7: a Helix subscribers snapshot (never a certain month). */
  | 'reconcile';
export type MonthSource =
  'twitch' | 'estimated' | 'estimated_no_history' | 'badge' | 'legacy';

/** One Twitch event announcing a subscription month. */
export interface SwEvidence {
  channelId: string;
  source: SwSource;
  /** The Twitch id of the event (EventSub message id): the proof's identity. */
  sourceEventId: string;
  /** Twitch time (EventSub message_timestamp), null when unknown: then never paired by time. */
  occurredAt: string | null;
  viewer: { id: string; login: string | null; name: string };
  type: 'sub' | 'resub';
  tier: 1 | 2 | 3;
  /** Twitch's cumulative months when the event carries them (certain), else null. */
  months: number | null;
  isGift: boolean;
  alertId?: string | null;
}

/** The mode and switch of the channel, read under a share lock: a mode change waits for (or is waited by) us. */
export async function readMode(
  q: Queryable,
  channelId: string,
): Promise<{ mode: SwMode; enabled: boolean }> {
  const r = (
    await q.query<{ mode: SwMode; enabled: boolean }>(
      'select mode, enabled from sw_settings where channel_id = $1 for share',
      [channelId],
    )
  )[0];
  return { mode: r?.mode ?? 'v1', enabled: r?.enabled ?? false };
}

export async function lockViewer(
  q: Queryable,
  channelId: string,
  viewerId: string,
): Promise<void> {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [
    `sw:${channelId}:${viewerId}`,
  ]);
}

/**
 * This proof if already recorded (a redelivered event): its right, or spin_id null for an orphan proof (recorded in v1
 * without a right — never turned into a right later). null: a new proof.
 */
export async function findProof(
  q: Queryable,
  ev: Pick<SwEvidence, 'channelId' | 'source' | 'sourceEventId'>,
): Promise<{ spin_id: string | null } | null> {
  return (
    (
      await q.query<{ spin_id: string | null }>(
        'select spin_id from sw_spin_sources where channel_id = $1 and source = $2 and source_event_id = $3',
        [ev.channelId, ev.source, ev.sourceEventId.slice(0, 200)],
      )
    )[0] ?? null
  );
}

/** Records the proof on a right, or orphan (spinId null: v1, no right) — idempotent: the key is the source event. */
export async function recordProof(
  q: Queryable,
  spinId: string | null,
  ev: SwEvidence,
  now: Date,
): Promise<void> {
  await q.query(
    `insert into sw_spin_sources (spin_id, channel_id, source, source_event_id, viewer_id, occurred_at, months, tier,
       is_gift, received_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (channel_id, source, source_event_id) do nothing`,
    [
      spinId,
      ev.channelId,
      ev.source,
      ev.sourceEventId.slice(0, 200),
      ev.viewer.id,
      ev.occurredAt,
      ev.months,
      ev.tier,
      ev.isGift,
      now,
    ],
  );
}

/**
 * The viewer's last CERTAIN month: V2 rights with Twitch's months, V1 resubs (their months are Twitch's cumulative
 * months) and the months carried by proofs. V1 subs (months = 1) are not certain (a Prime re-up can arrive as a sub).
 */
export async function lastCertainMonth(
  q: Queryable,
  channelId: string,
  viewerId: string,
  /**
   * R2: the event's Twitch time — only the certain months known BEFORE it count (a right's time: its first proof, else
   * its creation for V1 rows without proof). The estimate never depends on the order the Core processed the events.
   */
  before: string | null = null,
): Promise<number | null> {
  const m = (
    await q.query<{ m: number | string | null }>(
      `select max(m) as m from (
         select s.sub_month as m,
           coalesce((select min(p.occurred_at) from sw_spin_sources p where p.spin_id = s.spin_id), s.created_at) as t
         from sw_spins s
           where s.channel_id = $1 and s.viewer_id = $2 and s.month_source = 'twitch' and s.status <> 'merged'
         union all
         select s.months,
           coalesce((select min(p.occurred_at) from sw_spin_sources p where p.spin_id = s.spin_id), s.created_at)
         from sw_spins s
           where s.channel_id = $1 and s.viewer_id = $2 and s.month_source is null and s.source = 'twitch'
             and s.type = 'resub' and s.status <> 'merged'
         union all
         select months, occurred_at from sw_spin_sources
           where channel_id = $1 and viewer_id = $2 and months is not null
       ) x where $3::timestamptz is null or t is null or t < $3::timestamptz`,
      [channelId, viewerId, before],
    )
  )[0]?.m;
  return m === null || m === undefined ? null : Number(m);
}

/**
 * The right of the same renewal, locked, or null (§ 4.1, step 4):
 * 1. a certain month: the right already holding it (V2 certain, or a V1 resub of that cumulative month);
 * 2. a proof from ANOTHER source (subscribe, chat notification, resub message) of the same viewer within 10 min of
 *    Twitch time, on a right that has no proof of this event's source yet and no different certain month. A right
 *    holds at most one proof per source; orphan proofs (no right) are never candidates.
 */
export async function findRenewal<R>(
  q: Queryable,
  ev: SwEvidence,
): Promise<R | null> {
  if (ev.months !== null) {
    const certain = (
      await q.query<R>(
        `select * from sw_spins
         where channel_id = $1 and viewer_id = $2 and status <> 'merged'
           and ((month_source = 'twitch' and sub_month = $3)
             or (month_source is null and source = 'twitch' and type = 'resub' and months = $3))
         order by created_at limit 1 for update`,
        [ev.channelId, ev.viewer.id, ev.months],
      )
    )[0];
    if (certain) return certain;
  }
  if (!ev.occurredAt) return null;
  const near = (
    await q.query<{ spin_id: string }>(
      `select s.spin_id from sw_spin_sources p join sw_spins s using (spin_id)
       where p.channel_id = $1 and p.viewer_id = $2 and p.source <> $3 and p.occurred_at is not null
         and abs(extract(epoch from (p.occurred_at - $4::timestamptz))) * 1000 <= $5
         and s.status <> 'merged'
         and ($6::int is null or s.month_source is distinct from 'twitch' or s.sub_month = $6::int)
         and not exists (select 1 from sw_spin_sources o where o.spin_id = s.spin_id and o.source = $3)
       order by abs(extract(epoch from (p.occurred_at - $4::timestamptz))), s.created_at
       limit 1`,
      [
        ev.channelId,
        ev.viewer.id,
        ev.source,
        ev.occurredAt,
        RENEWAL_WINDOW_MS,
        ev.months,
      ],
    )
  )[0];
  if (!near) return null;
  return (
    (
      await q.query<R>('select * from sw_spins where spin_id = $1 for update', [
        near.spin_id,
      ])
    )[0] ?? null
  );
}

/**
 * A chat notice's right takes the orphan proofs of the same renewal recorded in v1 (subscribe / resub message without a
 * right): within 10 min of Twitch time or carrying the right's certain month, never a different certain month, one per
 * source. The right itself is not changed (no month, no gain): the proofs are only linked to it.
 */
export async function adoptOrphans(
  q: Queryable,
  ev: SwEvidence,
  right: {
    spin_id: string;
    sub_month: number | null;
    month_source: string | null;
  },
): Promise<void> {
  const certain = right.month_source === 'twitch' ? right.sub_month : null;
  if (!ev.occurredAt && certain === null) return;
  await q.query(
    `update sw_spin_sources set spin_id = $1 where id in (
       select distinct on (source) id from sw_spin_sources
       where channel_id = $2 and viewer_id = $3 and spin_id is null and source <> 'chat_notification'
         and source not in (select source from sw_spin_sources where spin_id = $1)
         and (months is null or $6::int is null or months = $6::int)
         and (($6::int is not null and months = $6::int)
           or ($4::timestamptz is not null and occurred_at is not null
             and abs(extract(epoch from (occurred_at - $4::timestamptz))) * 1000 <= $5))
       order by source, abs(extract(epoch from (occurred_at - coalesce($4::timestamptz, occurred_at)))), id)`,
    [
      right.spin_id,
      ev.channelId,
      ev.viewer.id,
      ev.occurredAt,
      RENEWAL_WINDOW_MS,
      certain,
    ],
  );
}
