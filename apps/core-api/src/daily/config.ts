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

/** Refonte H14 (decided 05/11): the steps Studio may set — bounded; the reset hour stays fixed (16:00 Paris). */
export const DAILY_STEPS_BOUNDS = { maxSteps: 30, maxValue: 20_000 } as const;

export class DailyConfigError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * Refonte H14: new steps for the next claims. 1–30 integers, 0–20 000 each, never decreasing from one to the next.
 * A claim keeps the amount computed at its time (dailyRewardBreakdown is frozen with it): nothing is paid or taken back
 * retroactively.
 */
export async function saveDailySteps(q: Queryable, steps: unknown) {
  if (
    !Array.isArray(steps) ||
    steps.length < 1 ||
    steps.length > DAILY_STEPS_BOUNDS.maxSteps ||
    steps.some(
      (v, i) =>
        typeof v !== 'number' ||
        !Number.isInteger(v) ||
        v < 0 ||
        v > DAILY_STEPS_BOUNDS.maxValue ||
        (i > 0 && v < (steps[i - 1] as number)),
    )
  )
    throw new DailyConfigError('invalid_steps');
  const s = steps as number[];
  const config = DailyConfig.parse({
    reward: { base: s[0]!, perStreak: 0, max: s.at(-1)!, steps: s },
  });
  await q.query(
    `insert into daily_config (id, config, updated_at) values (1, $1, now())
     on conflict (id) do update set config = $1, updated_at = now()`,
    [JSON.stringify(config)],
  );
  return config;
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
