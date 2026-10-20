import { LoyaltyConfig } from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';

// Defaults (editable without code: stored config wins). Passive decided by Antoni on 20/10/2026: 10 Jetons / 6 min,
// 20 for a subscriber of any tier (replaces the 10, never added); event bonuses below unchanged.
export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  currencyId: 'main',
  passive: {
    intervalMinutes: 6,
    baseAmount: 10,
    tierMultipliers: { none: 1, t1: 2, t2: 2, t3: 2 },
  },
  sub: { t1: 2000, t2: 4000, t3: 10000 },
  subgift: {
    bonusTiers: [
      { minGifts: 1, bonusPercent: 0 },
      { minGifts: 5, bonusPercent: 5 },
      { minGifts: 10, bonusPercent: 10 },
      { minGifts: 20, bonusPercent: 20 },
    ],
  },
  // Bits #1–499 at 700/100, #500–999 at 900/100, #1000+ at 1000/100.
  bits: {
    brackets: [
      { from: 1, per100: 700 },
      { from: 500, per100: 900 },
      { from: 1000, per100: 1000 },
    ],
  },
  // Cents #1–499 (up to 4.99 €) at 500/€, from 5 € at 600/€, from 10 € at 700/€.
  tips: {
    brackets: [
      { from: 1, per100: 500 },
      { from: 500, per100: 600 },
      { from: 1000, per100: 700 },
    ],
  },
  follow: { amount: 500 },
};

/** Read at every reward (no RAM cache): a change applies to the next rewards only. */
export async function loadLoyaltyConfig(q: Queryable): Promise<LoyaltyConfig> {
  const row = (
    await q.query<{ config: unknown }>(
      'select config from loyalty_config where id = 1',
    )
  )[0];
  return row ? LoyaltyConfig.parse(row.config) : DEFAULT_LOYALTY_CONFIG;
}

export async function saveLoyaltyConfig(
  q: Queryable,
  config: LoyaltyConfig,
  actor: string,
): Promise<LoyaltyConfig> {
  const valid = LoyaltyConfig.parse(config);
  await q.query(
    `insert into loyalty_config (id, config, updated_by) values (1, $1, $2)
     on conflict (id) do update set config = excluded.config, updated_by = excluded.updated_by, updated_at = now()`,
    [JSON.stringify(valid), actor],
  );
  return valid;
}
