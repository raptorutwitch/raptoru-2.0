import type { Queryable } from '../db/db.js';

// The event currency's ledger (docs/HALLOWEEN.md): one wallet per season, channel and viewer, one append-only row per
// movement. Every movement carries a unique key: the same key never moves twice (a replayed request, a redelivered
// Twitch event, a retried click) — it returns the first movement instead. A balance never goes below 0. Always used
// inside the caller's transaction, after `lock` (one viewer's movements are serialized by their wallet row).

export type LedgerKind =
  | 'grant'
  | 'remove'
  | 'sub_reward'
  | 'gift_reward'
  | 'convert'
  | 'purchase'
  | 'refund'
  | 'raffle'
  // 30/10: presence, Bits and donations (migration 20261117130000_halloween_economy.sql).
  | 'presence'
  | 'bits_reward'
  | 'donation_reward';

export class EventBalanceError extends Error {
  constructor(
    readonly balance: number,
    readonly needed: number,
  ) {
    super('insufficient_bonbons');
  }
}

export interface Movement {
  season: string;
  channelId: string;
  viewer: { id: string; name: string };
  kind: LedgerKind;
  /** Signed: a credit when positive, a debit when negative. */
  amount: number;
  key: string;
  reference?: string | null;
  actor: string;
  reason?: string | null;
  now: Date;
}

export interface MovementResult {
  id: number;
  amount: number;
  balance_after: number;
  /** The key had already moved: nothing new was written. */
  replayed: boolean;
}

/** Creates the wallet if needed and locks it until the end of the transaction; returns its balance. */
export async function lock(
  q: Queryable,
  season: string,
  channelId: string,
  viewer: { id: string; name: string },
  now: Date,
): Promise<number> {
  await q.query(
    `insert into event_wallets (season, channel_id, viewer_id, viewer_name, balance, updated_at)
     values ($1, $2, $3, $4, 0, $5) on conflict do nothing`,
    [season, channelId, viewer.id, viewer.name.slice(0, 64), now],
  );
  const rows = await q.query<{ balance: string }>(
    'select balance from event_wallets where season = $1 and channel_id = $2 and viewer_id = $3 for update',
    [season, channelId, viewer.id],
  );
  return Number(rows[0]!.balance);
}

/** The movement already recorded under this key, if any. */
export async function byKey(q: Queryable, key: string) {
  const rows = await q.query<{
    id: string;
    amount: string;
    balance_after: string;
    viewer_id: string;
  }>(
    'select id, amount, balance_after, viewer_id from event_ledger where key = $1',
    [key],
  );
  const r = rows[0];
  return r
    ? {
        id: Number(r.id),
        amount: Number(r.amount),
        balance_after: Number(r.balance_after),
        viewer_id: r.viewer_id,
      }
    : null;
}

/**
 * Applies one movement (wallet locked first). A key already used returns its first movement (`replayed`); a debit
 * beyond the balance throws EventBalanceError and writes nothing.
 */
export async function move(q: Queryable, m: Movement): Promise<MovementResult> {
  if (!Number.isInteger(m.amount) || m.amount === 0)
    throw new Error('invalid_amount');
  const balance = await lock(q, m.season, m.channelId, m.viewer, m.now);
  const prior = await byKey(q, m.key);
  if (prior)
    return {
      id: prior.id,
      amount: prior.amount,
      balance_after: prior.balance_after,
      replayed: true,
    };
  const after = balance + m.amount;
  if (after < 0) throw new EventBalanceError(balance, -m.amount);
  await q.query(
    `update event_wallets set balance = $4, viewer_name = $5, updated_at = $6
     where season = $1 and channel_id = $2 and viewer_id = $3`,
    [
      m.season,
      m.channelId,
      m.viewer.id,
      after,
      m.viewer.name.slice(0, 64),
      m.now,
    ],
  );
  const rows = await q.query<{ id: string }>(
    `insert into event_ledger (season, channel_id, viewer_id, kind, amount, balance_after, key, reference, actor, reason,
       created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [
      m.season,
      m.channelId,
      m.viewer.id,
      m.kind,
      m.amount,
      after,
      m.key,
      m.reference ?? null,
      m.actor.slice(0, 64),
      m.reason?.slice(0, 200) ?? null,
      m.now,
    ],
  );
  return {
    id: Number(rows[0]!.id),
    amount: m.amount,
    balance_after: after,
    replayed: false,
  };
}

/** A viewer's balance (0 when they never had a wallet this season). */
export async function balanceOf(
  q: Queryable,
  season: string,
  channelId: string,
  viewerId: string,
) {
  const rows = await q.query<{ balance: string }>(
    'select balance from event_wallets where season = $1 and channel_id = $2 and viewer_id = $3',
    [season, channelId, viewerId],
  );
  return rows[0] ? Number(rows[0].balance) : 0;
}

/** Bonbons a viewer obtained by conversion since `since` (the rolling-hour cap). */
export async function convertedSince(
  q: Queryable,
  season: string,
  channelId: string,
  viewerId: string,
  since: Date,
) {
  const rows = await q.query<{ n: string | null }>(
    `select coalesce(sum(amount), 0) as n from event_ledger
     where season = $1 and channel_id = $2 and viewer_id = $3 and kind = 'convert' and created_at > $4`,
    [season, channelId, viewerId, since],
  );
  return Number(rows[0]?.n ?? 0);
}

/** When the oldest conversion of the rolling hour leaves it (the cap frees up then). */
export async function oldestConversionSince(
  q: Queryable,
  season: string,
  channelId: string,
  viewerId: string,
  since: Date,
) {
  const rows = await q.query<{ at: Date | null }>(
    `select min(created_at) as at from event_ledger
     where season = $1 and channel_id = $2 and viewer_id = $3 and kind = 'convert' and created_at > $4`,
    [season, channelId, viewerId, since],
  );
  return rows[0]?.at ? new Date(rows[0].at) : null;
}
