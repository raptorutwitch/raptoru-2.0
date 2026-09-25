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
  it('starts at 500, grows by 150 per consecutive stream and caps at 2000', () => {
    const rewards = Array.from({ length: 13 }, (_, i) =>
      rewardForStreak(i + 1, DEFAULT_DAILY_CONFIG),
    );
    expect(rewards).toEqual([
      500, 650, 800, 950, 1100, 1250, 1400, 1550, 1700, 1850, 2000, 2000, 2000,
    ]);
  });
});
