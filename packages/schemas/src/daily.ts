import { z } from 'zod';

/** A stream-day is identified by the Paris date on which its 16:00 window opens. */
export const StreamDay = z.iso.date();

export const Viewer = z.object({
  twitchUserId: z.string().regex(/^\d+$/),
  login: z.string().min(1).max(25),
  displayName: z.string().min(1).max(50),
});
export type Viewer = z.infer<typeof Viewer>;

export const DailyClaimRequest = z.object({
  viewer: Viewer,
  /** Stable id of the triggering action (e.g. Twitch chat message id), used to replay retries. */
  requestId: z.string().min(1).max(128),
});
export type DailyClaimRequest = z.infer<typeof DailyClaimRequest>;

export const DailyStreakRequest = z.object({
  viewer: Viewer,
});
export type DailyStreakRequest = z.infer<typeof DailyStreakRequest>;

export const DailyLastClaim = z.object({
  streamDay: StreamDay,
  claimedAt: z.iso.datetime({ offset: true }),
  reward: z.number().int(),
});

/** Authoritative Daily view of one viewer. Consumers display it as-is and never recompute it. */
export const DailyStatus = z.object({
  twitchUserId: z.string(),
  login: z.string().nullable(),
  displayName: z.string().nullable(),
  totalDaily: z.number().int(),
  /** Effective streak: already 0 when an aired stream-day was missed. */
  currentStreak: z.number().int(),
  bestStreak: z.number().int(),
  live: z.boolean(),
  /** Stream-day that can currently be claimed, if any. */
  currentStreamDay: StreamDay.nullable(),
  claimedCurrentStreamDay: z.boolean(),
  lastClaim: DailyLastClaim.nullable(),
  /** Reward of the viewer's next claim if the streak is kept. */
  nextReward: z.number().int(),
});
export type DailyStatus = z.infer<typeof DailyStatus>;

export const DailyClaimOutcome = z.enum([
  'claimed',
  'already_claimed',
  'no_active_stream',
]);
export type DailyClaimOutcome = z.infer<typeof DailyClaimOutcome>;

export const DailyClaimResponse = z.object({
  outcome: DailyClaimOutcome,
  /** True when this response replays the original result of the same requestId. */
  replayed: z.boolean(),
  reward: z.number().int(),
  status: DailyStatus,
  /** Chat reply decided by Core. */
  message: z.string(),
});
export type DailyClaimResponse = z.infer<typeof DailyClaimResponse>;

export const DailyStreakResponse = z.object({
  status: DailyStatus,
  message: z.string(),
});
export type DailyStreakResponse = z.infer<typeof DailyStreakResponse>;

export const DailyClaimHistoryItem = z.object({
  streamDay: StreamDay,
  claimedAt: z.iso.datetime({ offset: true }),
  reward: z.number().int(),
  streakAfter: z.number().int(),
  totalAfter: z.number().int(),
  source: z.enum(['chat', 'import']),
  creditStatus: z
    .enum(['pending', 'sending', 'credited', 'failed', 'unknown'])
    .nullable(),
});
export type DailyClaimHistoryItem = z.infer<typeof DailyClaimHistoryItem>;

export const DailyLeaderboardEntry = z.object({
  rank: z.number().int(),
  twitchUserId: z.string(),
  login: z.string().nullable(),
  displayName: z.string().nullable(),
  value: z.number().int(),
});
export type DailyLeaderboardEntry = z.infer<typeof DailyLeaderboardEntry>;

export const DailyLeaderboard = z.object({
  total: z.array(DailyLeaderboardEntry),
  streak: z.array(DailyLeaderboardEntry),
  best: z.array(DailyLeaderboardEntry),
});
export type DailyLeaderboard = z.infer<typeof DailyLeaderboard>;

/** Streamer-editable Daily configuration. Reward = min(max, base + perStreak × (streak − 1)). */
export const DailyConfig = z.object({
  reward: z
    .object({
      base: z.number().int().min(0),
      perStreak: z.number().int().min(0),
      max: z.number().int().min(0),
    })
    .refine((r) => r.max >= r.base, { message: 'max must be >= base' }),
});
export type DailyConfig = z.infer<typeof DailyConfig>;
