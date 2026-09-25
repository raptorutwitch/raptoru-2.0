import { DailyConfig } from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';

// 500, 650, 800 … +150 per consecutive stream, capped at 2000 from the 11th stream.
export const DEFAULT_DAILY_CONFIG: DailyConfig = {
  reward: { base: 500, perStreak: 150, max: 2000 },
};

export function rewardForStreak(streak: number, config: DailyConfig): number {
  const { base, perStreak, max } = config.reward;
  return Math.min(max, base + perStreak * (Math.max(1, streak) - 1));
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
