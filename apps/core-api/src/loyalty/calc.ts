import type { LoyaltyConfig, SubTier, TierStatus } from '@raptoru/schemas';
import { loyaltyMultiplier } from '../wallet/loyalty.js';

// Pure reward calculations. Every result is an integer rounded UP, with a breakdown that is stored
// as-is (never recomputed from a later config).

/** Rounds up to an integer, ignoring float noise (50 × 2.2 = 110.00000000000001 → 110). */
export function roundUp(value: number): number {
  return Math.ceil(Math.round(value * 1e6) / 1e6);
}

export interface PassiveBreakdown {
  source: 'passive_watch';
  intervalMinutes: number;
  base: number;
  tier: TierStatus;
  tierMultiplier: number | null;
  personalOverride: number | null;
  effectiveMultiplier: number | null;
  final: number | null;
  excluded: boolean;
  /** When the tier is unknown: what each tier would have given (information only). */
  candidates?: Record<'none' | SubTier, number>;
}

/**
 * Passive tick: base × (personal override ?? tier multiplier). The personal override replaces the
 * tier multiplier (T1 ×2 with override ×3 → ×3, never ×6).
 */
export function passiveReward(
  config: LoyaltyConfig,
  tier: TierStatus,
  personalOverride: number | null,
  excluded: boolean,
): PassiveBreakdown {
  const { baseAmount: base, intervalMinutes, tierMultipliers } = config.passive;
  const common = {
    source: 'passive_watch' as const,
    intervalMinutes,
    base,
    tier,
    personalOverride,
    excluded,
  };
  if (excluded) {
    return {
      ...common,
      tierMultiplier: null,
      effectiveMultiplier: null,
      final: 0,
    };
  }
  if (tier === 'unknown' && personalOverride === null) {
    const candidates = {
      none: roundUp(base * tierMultipliers.none),
      t1: roundUp(base * tierMultipliers.t1),
      t2: roundUp(base * tierMultipliers.t2),
      t3: roundUp(base * tierMultipliers.t3),
    };
    return {
      ...common,
      tierMultiplier: null,
      effectiveMultiplier: null,
      final: null,
      candidates,
    };
  }
  const tierMultiplier = tier === 'unknown' ? null : tierMultipliers[tier];
  const effective = loyaltyMultiplier({
    personalRate: personalOverride,
    standardRate: tierMultiplier ?? undefined,
    boost: null,
  });
  return {
    ...common,
    tierMultiplier,
    effectiveMultiplier: effective,
    final: roundUp(base * effective),
  };
}

export function subReward(config: LoyaltyConfig, tier: SubTier) {
  return { base: config.sub[tier], tier, final: roundUp(config.sub[tier]) };
}

/** Gifter reward: tier value × count, then the bonus of the highest threshold reached by this action. */
export function subgiftReward(
  config: LoyaltyConfig,
  tier: SubTier,
  count: number,
) {
  const unit = config.sub[tier];
  const base = unit * count;
  const reached =
    config.subgift.bonusTiers.filter((t) => count >= t.minGifts).at(-1) ?? null;
  const bonusPercent = reached?.bonusPercent ?? 0;
  return {
    tier,
    count,
    unitValue: unit,
    base,
    bonusThreshold: reached?.minGifts ?? null,
    bonusPercent,
    final: roundUp(base * (1 + bonusPercent / 100)),
  };
}

/**
 * Progressive brackets: unit #k is priced by the bracket with the largest `from` <= k, so a higher
 * bracket never re-prices the lower units (1200 bits ≠ 1200 × top rate).
 */
export function progressiveReward(
  units: number,
  brackets: { from: number; per100: number }[],
) {
  const parts = brackets.map((b, i) => {
    const end = brackets[i + 1] ? brackets[i + 1]!.from - 1 : Infinity;
    const count = Math.max(0, Math.min(units, end) - b.from + 1);
    return {
      from: b.from,
      to: end === Infinity ? null : end,
      units: count,
      per100: b.per100,
      amount: (count * b.per100) / 100,
    };
  });
  const exact = parts.reduce((sum, p) => sum + p.amount, 0);
  return {
    units,
    parts: parts.filter((p) => p.units > 0),
    exact,
    final: roundUp(exact),
  };
}
