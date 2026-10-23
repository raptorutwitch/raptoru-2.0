import { z } from 'zod';

// Votekick V2 in production (docs/VOTEKICK_V2.md § 9): the rules of votekick.ts run by ONE Core module (Lab Core and
// main Core), its state in the database. Like Caution / Random Ban, the Twitch executor is the bot (it reads the
// target and the moderators, then applies the timeout); the broadcaster's mute is a task for Studio (its OBS mute
// controller). Core holds the truth; the executor and Studio only report.

export const VOTEKICK_EXEC = {
  /** A `!votekick` the executor does not pick up within this delay fails (bot absent): nothing opened. */
  pickupMs: 15_000,
  /** The executor's lease on the target / moderators read. */
  readLeaseMs: 20_000,
  /** A verdict's timeout not reported within this delay: never claimed → not applied; claimed → « uncertain ». */
  timeoutLeaseMs: 30_000,
  /** The broadcaster's mute not started by Studio within this delay → announced as impossible (OBS). */
  mutePickupMs: 10_000,
  /** Reads that never reported (executor lost): offered again, at most this many times. */
  maxAttempts: 3,
  /** `!votekick` alone: one help answer per viewer at most every 30 s (same as `!caution`). */
  helpCooldownMs: 30_000,
} as const;

export const VotekickStatus = z.enum([
  'checking', // waiting for the executor: the target and the moderators to read
  'reading', // the executor reads Twitch
  'open', // the 60 s vote
  'sanctioning', // verdict given, the executor applies the timeout
  'done', // ended (verdict, sanction applied or not: see `applied`)
  'refused', // never opened (unknown target, moderator, self…)
  'failed', // never opened: Twitch unreadable or no executor
]);
export type VotekickStatus = z.infer<typeof VotekickStatus>;

/** One vote at a time per channel: these statuses (a DB index too). */
export const VOTEKICK_RUNNING: readonly VotekickStatus[] = [
  'checking',
  'reading',
  'open',
];

const TwitchId = z.string().regex(/^\d{1,32}$/);
const Login = z.string().min(1).max(64);
const ExecutorId = z.string().min(1).max(64);

export const VotekickUser = z.strictObject({
  id: TwitchId,
  login: Login,
  name: z.string().min(1).max(64),
});
export type VotekickUser = z.infer<typeof VotekickUser>;

/** The executor asks for work, with what its tokens allow. */
export const VotekickClaimRequest = z.strictObject({
  executor_id: ExecutorId,
  login: Login,
  /** Get Users (LeCroupier_) + Get Moderators (broadcaster: moderation:read). */
  can_read: z.boolean(),
  /** Ban User with a duration (LeCroupier_: moderator:manage:banned_users). */
  can_timeout: z.boolean(),
  missing: z.array(z.string().max(120)).max(10),
});
export type VotekickClaimRequest = z.infer<typeof VotekickClaimRequest>;

const Attempt = { executor_id: ExecutorId, attempt_id: z.uuid() };

/** The target found by its login (null: no such user) and whether it moderates the channel; or what could not be read. */
export const VotekickCheckReport = z.union([
  z.strictObject({
    ...Attempt,
    target: VotekickUser.nullable(),
    moderator: z.boolean(),
  }),
  z.strictObject({
    ...Attempt,
    error: z.string().min(1).max(300),
    /** user: the target could not be looked up · moderators: the list could not be read (vote refused for safety). */
    stage: z.enum(['user', 'moderators']),
  }),
]);
export type VotekickCheckReport = z.infer<typeof VotekickCheckReport>;

/** The verdict's timeout: confirmed by Twitch · refused (4xx: certainly not applied) · uncertain (no answer, 5xx). */
export const VotekickTimeoutReport = z.strictObject({
  ...Attempt,
  event: z.enum(['confirmed', 'refused', 'uncertain']),
  error: z.string().max(300).optional(),
});
export type VotekickTimeoutReport = z.infer<typeof VotekickTimeoutReport>;

/** Studio's mute controller: started (OBS muted) · failed (OBS absent: never muted) · ended (OBS restored). */
export const VotekickMuteReport = z.strictObject({
  event: z.enum(['started', 'failed', 'ended']),
  error: z.string().max(300).optional(),
});
export type VotekickMuteReport = z.infer<typeof VotekickMuteReport>;
