// Pure streak rules. Only stream-days that actually aired exist, so calendar gaps never matter.

export interface StreakInput {
  storedStreak: number;
  lastClaimDay: string | null;
}

/** Streak after claiming on a stream-day whose previous aired stream-day is `previousAiredDay`. */
export function streakAfterClaim(
  stats: StreakInput,
  previousAiredDay: string | null,
): number {
  return previousAiredDay !== null && stats.lastClaimDay === previousAiredDay
    ? stats.storedStreak + 1
    : 1;
}

export interface EffectiveStreakInput extends StreakInput {
  latestAiredDay: string | null;
  previousAiredDay: string | null;
  /** The latest aired stream-day can still be claimed (live, or its window is not over). */
  latestDayOpen: boolean;
}

/** Streak as it stands now: 0 as soon as an aired stream-day ended without a claim. */
export function effectiveStreak(input: EffectiveStreakInput): number {
  if (!input.lastClaimDay || input.storedStreak === 0) return 0;
  if (input.lastClaimDay === input.latestAiredDay) return input.storedStreak;
  if (input.latestDayOpen && input.lastClaimDay === input.previousAiredDay) {
    return input.storedStreak;
  }
  return 0;
}
