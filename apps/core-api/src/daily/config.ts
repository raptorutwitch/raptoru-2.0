import { DailyConfig } from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';

// The legacy raptoru.fr table (api/sammi/daily.js DAILY_REWARD_STEPS), kept as is: 2000 from the 10th stream.
export const LEGACY_DAILY_STEPS = [
  500, 700, 900, 1100, 1300, 1500, 1600, 1700, 1850, 2000,
];
export const DEFAULT_DAILY_CONFIG: DailyConfig = {
  reward: { base: 500, perStreak: 0, max: 2000, steps: LEGACY_DAILY_STEPS },
};

export function rewardForStreak(streak: number, config: DailyConfig): number {
  return dailyRewardBreakdown(streak, config).final;
}

/** Reward calculation as stored with each claim (frozen: a later config never changes it). */
export function dailyRewardBreakdown(streak: number, config: DailyConfig) {
  const { base, perStreak, max, steps } = config.reward;
  if (steps) {
    const final = steps[Math.min(Math.max(1, streak), steps.length) - 1]!;
    return {
      streak,
      base: steps[0]!,
      steps,
      max: steps.at(-1)!,
      bonus: final - steps[0]!,
      capped: streak > steps.length,
      final,
    };
  }
  const uncapped = base + perStreak * (Math.max(1, streak) - 1);
  const final = Math.min(max, uncapped);
  return {
    streak,
    base,
    perStreak,
    max,
    bonus: final - base,
    capped: uncapped > max,
    final,
  };
}

/** Stored config (edited later from Studio) or the defaults. Invalid stored config fails loudly. */
export async function loadDailyConfig(q: Queryable): Promise<DailyConfig> {
  const row = (
    await q.query<{ config: unknown }>(
      'select config from daily_config where id = 1',
    )
  )[0];
  return row ? DailyConfig.parse(row.config) : DEFAULT_DAILY_CONFIG;
}
