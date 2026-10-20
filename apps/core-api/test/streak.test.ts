import { DailyConfig } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DAILY_CONFIG, rewardForStreak } from '../src/daily/config.js';
import { effectiveStreak, streakAfterClaim } from '../src/daily/streak.js';

describe('streak rules', () => {
  it('continues only when the last claim is the previous aired stream-day', () => {
    expect(
      streakAfterClaim(
        { storedStreak: 4, lastClaimDay: '2026-09-20' },
        '2026-09-20',
      ),
    ).toBe(5);
    expect(
      streakAfterClaim(
        { storedStreak: 4, lastClaimDay: '2026-09-18' },
        '2026-09-20',
      ),
    ).toBe(1);
    expect(
      streakAfterClaim({ storedStreak: 0, lastClaimDay: null }, null),
    ).toBe(1);
  });

  it('shows a pending streak while the next stream-day is still open, 0 once it is missed', () => {
    const base = {
      storedStreak: 7,
      lastClaimDay: '2026-09-20',
      latestAiredDay: '2026-09-21',
      previousAiredDay: '2026-09-20',
    };
    expect(effectiveStreak({ ...base, latestDayOpen: true })).toBe(7);
    expect(effectiveStreak({ ...base, latestDayOpen: false })).toBe(0);
    expect(
      effectiveStreak({
        ...base,
        lastClaimDay: '2026-09-21',
        latestDayOpen: false,
      }),
    ).toBe(7);
  });
});

describe('default reward curve', () => {
  it('is the legacy raptoru.fr table: 500 … 1850, then 2000 from the 10th stream', () => {
    const rewards = Array.from({ length: 12 }, (_, i) =>
      rewardForStreak(i + 1, DEFAULT_DAILY_CONFIG),
    );
    expect(rewards).toEqual([
      500, 700, 900, 1100, 1300, 1500, 1600, 1700, 1850, 2000, 2000, 2000,
    ]);
    expect(rewardForStreak(227, DEFAULT_DAILY_CONFIG)).toBe(2000);
    expect(rewardForStreak(0, DEFAULT_DAILY_CONFIG)).toBe(500);
    expect(DailyConfig.parse(DEFAULT_DAILY_CONFIG)).toEqual(
      DEFAULT_DAILY_CONFIG,
    );
  });

  it('a stored config without steps keeps its linear curve', () => {
    const stored = DailyConfig.parse({
      reward: { base: 1000, perStreak: 150, max: 2000 },
    });
    expect([1, 2, 3, 8].map((s) => rewardForStreak(s, stored))).toEqual([
      1000, 1150, 1300, 2000,
    ]);
  });
});
