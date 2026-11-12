import type { Queryable } from '../db/db.js';
import type { ModuleSettings } from '../module-settings/service.js';

// Random Ban — the progressive Jetons price (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 2, decided by Antoni 12/11/2026).
// One level per Twitch account, shared by the extension and `!rb` (never the channel points):
// - a counted purchase pays the tier of the level that applies just before it, then the level rises by one (capped);
// - one level comes back every `stepMs` without a new counted purchase:
//     level(t) = max(0, min(top, level_paid_last + 1) − ⌊(t − t_last) / stepMs⌋)
// - derived from the LAST counted purchase only (its `series_level` and `created_at`): no counter that could drift. A
//   purchase that ends `failed` (nothing done, refunded) or `canceled` stops counting by itself.
// The Core computes it, under the buyer's lock, with the server clock; the extension only projects the gauge.

export interface RbPricing {
  /** Jetons per level, increasing; [0] = normal price. */
  tiers: number[];
  /** One level back per this many ms of calm (0: flat price, the progressive price is off). */
  stepMs: number;
  /** Requests still open per buyer (queued → timeout_requested), all sources. */
  maxPending: number;
  /** Channel points: one accepted redemption per buyer per this many ms. */
  cpCooldownMs: number;
  /** Sniper: the bonus of a rewardable hit, and the calm before an attempt is rewardable (all sources). */
  sniperBonus: number;
  sniperWindowMs: number;
  /** Le Viseur: reel before the timeout (`reveal_first`) or the historical order (ban, then video), and the strike's
   * extra delay after the reel stops (the stream's latency, measured with Antoni). */
  revealFirst: boolean;
  strikeOffsetMs: number;
}

export const RB_PRICING_DEFAULT: RbPricing = Object.freeze({
  tiers: [25_000, 30_000, 50_000, 75_000, 100_000],
  stepMs: 5 * 60_000,
  maxPending: 2,
  cpCooldownMs: 10 * 60_000,
  sniperBonus: 2_000,
  sniperWindowMs: 30 * 60_000,
  revealFirst: false,
  strikeOffsetMs: 3_000,
});

/** The module settings behind the pricing (module `random_ban`, modules/status-adapters.ts declares them). */
export function randomBanPricing(settings: ModuleSettings) {
  return async (q: Queryable, ch: string): Promise<RbPricing> => {
    const get = (k: string) => settings.get(q, ch, `random_ban.${k}`);
    const tiers = [
      await get('price'),
      await get('price_2'),
      await get('price_3'),
      await get('price_4'),
      await get('price_5'),
    ];
    // A tier set below the previous one never makes a series cheaper than the purchase before it.
    for (let i = 1; i < tiers.length; i++)
      tiers[i] = Math.max(tiers[i]!, tiers[i - 1]!);
    return {
      tiers,
      stepMs: (await get('tier_step_min')) * 60_000,
      maxPending: await get('max_pending'),
      cpCooldownMs: (await get('cp_cooldown_min')) * 60_000,
      sniperBonus: await get('sniper_bonus'),
      sniperWindowMs: (await get('sniper_window_min')) * 60_000,
      revealFirst: (await get('sequence')) === 1,
      strikeOffsetMs: (await get('strike_offset_s')) * 1000,
    };
  };
}

export interface LastPurchase {
  series_level: number;
  created_at: Date;
}

export interface RbQuote {
  /** 0 = normal price. */
  level: number;
  price: number;
  normal_price: number;
  /** The next lower price and when it applies (null at the normal price). */
  next_price: number | null;
  next_drop_at: string | null;
  /** When the normal price is back without a new purchase (null: already). */
  normal_at: string | null;
  /** The level after a purchase now (what the next one would pay). */
  price_after: number;
  server_now: string;
}

export function quote(
  p: RbPricing,
  last: LastPurchase | null,
  now: Date,
): RbQuote {
  const top = p.tiers.length - 1;
  let level = 0;
  let after = 0;
  if (last && p.stepMs > 0) {
    after = Math.min(top, last.series_level + 1);
    const since = now.getTime() - new Date(last.created_at).getTime();
    level = Math.max(0, after - Math.floor(Math.max(0, since) / p.stepMs));
  }
  const base = last ? new Date(last.created_at).getTime() : 0;
  const drops = after - level;
  return {
    level,
    price: p.tiers[level]!,
    normal_price: p.tiers[0]!,
    next_price: level > 0 ? p.tiers[level - 1]! : null,
    next_drop_at:
      level > 0 ? new Date(base + (drops + 1) * p.stepMs).toISOString() : null,
    normal_at:
      level > 0 ? new Date(base + after * p.stepMs).toISOString() : null,
    price_after: p.tiers[p.stepMs > 0 ? Math.min(top, level + 1) : 0]!,
    server_now: now.toISOString(),
  };
}

/** Counted for the price: a Jetons purchase (extension, `!rb`) that is neither failed nor canceled. */
export async function lastCounted(
  q: Queryable,
  channelId: string,
  buyerId: string,
): Promise<LastPurchase | null> {
  return (
    (
      await q.query<LastPurchase>(
        `select series_level, created_at from rb_requests
          where channel_id = $1 and buyer_id = $2 and source in ('chat', 'extension') and series_level is not null
            and status not in ('failed', 'canceled')
          order by seq desc limit 1`,
        [channelId, buyerId],
      )
    )[0] ?? null
  );
}

/** « 4 min 10 s » / « 45 s » (chat). */
export function waitText(ms: number) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} min${s % 60 ? ` ${s % 60} s` : ''}` : `${s} s`;
}
