import type { Queryable } from '../db/db.js';
import type { ModuleSettings } from '../module-settings/service.js';

// Random Ban — fixed prices and personal charges (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 2, V5 decided by Antoni
// 13/11/2026; it replaces the progressive Jetons price of 12/11, never deployed):
// - the extension and `!rb` cost `price` Jetons (25 000), the channel points reward costs what Twitch charges (3 000);
// - each viewer holds at most `chargesMax` charges (3), shared by the three ways; one comes back every `rechargeMs`
//   (10 min), continuously, without the viewer opening anything; an accepted Random Ban uses one;
// - derived from the buyer's ACCEPTED requests only (no counter that could drift or be duplicated by a second
//   connection): a refusal creates no request, a request that ends `failed` / `canceled` or an `uncertain` one
//   refunded stops counting by itself, a moderator's refill marks the buyer's requests `charge = false`;
// - computed by the Core under the buyer's lock with the server clock (several Cores: the same rows, the same lock);
//   the extension only projects the gauge.
// Bucket replay: `full` = when the buyer is back to `chargesMax`; each counted request at t: full = max(full, t) + R
// (never more than chargesMax·R ahead of t: a forced use never digs below zero).

export interface RbPricing {
  /** Jetons price of a Random Ban (extension and `!rb`). */
  price: number;
  /** Personal charges: at most this many (0: no charge limit), one back every `rechargeMs`. */
  chargesMax: number;
  rechargeMs: number;
  /** Channel-wide: at most `channelMax` accepted Random Ban per `channelWindowMs`, all buyers (0: no limit). */
  channelMax: number;
  channelWindowMs: number;
  /** Requests still open per buyer (queued → timeout_requested), all sources. */
  maxPending: number;
  /** Sniper: the bonus of a rewardable hit, and the calm before an attempt is rewardable (all sources). */
  sniperBonus: number;
  sniperWindowMs: number;
  /** Le Viseur: reel before the timeout (`reveal_first`) or the historical order (ban, then video), and the strike's
   * extra delay after the reel stops (the stream's latency, measured with Antoni). */
  revealFirst: boolean;
  strikeOffsetMs: number;
}

export const RB_PRICING_DEFAULT: RbPricing = Object.freeze({
  price: 25_000,
  chargesMax: 3,
  rechargeMs: 10 * 60_000,
  channelMax: 0,
  channelWindowMs: 10 * 60_000,
  maxPending: 3,
  sniperBonus: 2_000,
  sniperWindowMs: 30 * 60_000,
  revealFirst: false,
  strikeOffsetMs: 3_000,
});

/** The module settings behind the rules (module `random_ban`, modules/random-ban.ts declares them). */
export function randomBanPricing(settings: ModuleSettings) {
  return async (q: Queryable, ch: string): Promise<RbPricing> => {
    const get = (k: string) => settings.get(q, ch, `random_ban.${k}`);
    return {
      price: await get('price'),
      chargesMax: await get('charges_max'),
      rechargeMs: (await get('recharge_min')) * 60_000,
      channelMax: await get('channel_max'),
      channelWindowMs: (await get('channel_window_min')) * 60_000,
      maxPending: await get('max_pending'),
      sniperBonus: await get('sniper_bonus'),
      sniperWindowMs: (await get('sniper_window_min')) * 60_000,
      revealFirst: (await get('sequence')) === 1,
      strikeOffsetMs: (await get('strike_offset_s')) * 1000,
    };
  };
}

export interface RbCharges {
  /** Whole charges usable now. */
  available: number;
  /** 0: no charge limit. */
  max: number;
  recharge_ms: number;
  /** The next charge back and the reserve full again (null: already full). */
  next_at: string | null;
  full_at: string | null;
  server_now: string;
}

/** The charges at `now` from the buyer's counted requests (oldest first). Pure. */
export function charges(
  p: Pick<RbPricing, 'chargesMax' | 'rechargeMs'>,
  used: Date[],
  now: Date,
): RbCharges {
  const max = p.chargesMax;
  const R = Math.max(1, p.rechargeMs);
  let full = -Infinity;
  for (const u of used) {
    const at = new Date(u).getTime();
    full = Math.min(Math.max(full, at) + R, at + max * R);
  }
  const t = now.getTime();
  const missing = max > 0 ? Math.min(max, Math.max(0, full - t) / R) : 0;
  const lost = Math.ceil(missing - 1e-9);
  return {
    available: max - lost,
    max,
    recharge_ms: R,
    next_at: lost > 0 ? new Date(full - (lost - 1) * R).toISOString() : null,
    full_at: lost > 0 ? new Date(full).toISOString() : null,
    server_now: now.toISOString(),
  };
}

/**
 * Counted for the charges: an accepted request of any source but a Studio test, not failed / canceled / refunded,
 * not refilled by a moderator. ponytail: replays the last 24 h only — older requests count as recovered (a buyer would
 * need 24 h of non-stop buying at the full recharge rate for the cut to matter).
 */
export async function chargesOf(
  q: Queryable,
  p: RbPricing,
  channelId: string,
  buyerId: string,
  now: Date,
) {
  if (p.chargesMax <= 0) return charges(p, [], now);
  const rows = await q.query<{ created_at: Date }>(
    `select created_at from rb_requests
      where channel_id = $1 and buyer_id = $2 and source <> 'test' and charge and created_at > $3
        and status not in ('failed', 'canceled') and not (status = 'uncertain' and refund <> 'to_verify')
      order by created_at`,
    [channelId, buyerId, new Date(now.getTime() - 24 * 3_600_000)],
  );
  return charges(
    p,
    rows.map((r) => r.created_at),
    now,
  );
}

/** « 4 min 10 s » / « 45 s » (chat). */
export function waitText(ms: number) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} min${s % 60 ? ` ${s % 60} s` : ''}` : `${s} s`;
}
