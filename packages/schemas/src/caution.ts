import { z } from 'zod';

// Caution (docs/CAUTION.md) — the SAMMI buttons CAUTION_START / CONFIRM / FINISH as a Core module: `!caution pseudo`
// quotes the release of an active Twitch timeout (1 000 Jetons per started minute, votekick.ts `cautionPrice`), the
// payer answers `oui` / `non` within 30 s, the Jetons are debited only after a fresh Twitch read, then the Twitch
// executor (the bot, like Random Ban) lifts the timeout. Core holds the truth; the executor only reads Twitch and
// unbans, journaling before every call.

export const CAUTION_EXEC = {
  /** A request the executor does not pick up within this delay fails (bot absent): nothing was debited. */
  pickupMs: 20_000,
  /** The executor's lease on a Twitch read (the quote, the re-check before the debit). */
  readLeaseMs: 20_000,
  /** The lease between the debit and the release result (after it: « uncertain », never sent again). */
  releaseLeaseMs: 30_000,
  /** Reads that never reported (executor lost before any debit): offered again, at most this many times. */
  maxAttempts: 3,
  /** `!caution` alone: one help answer per viewer at most every 30 s. */
  helpCooldownMs: 30_000,
} as const;

export const CautionStatus = z.enum([
  'checking', // waiting for the executor: target and sanction to read
  'quoting', // the executor reads Twitch
  'quoted', // price told, waiting for the payer's `oui` / `non`
  'confirmed', // `oui` received, waiting for the executor's re-check (nothing debited yet)
  'rechecking', // the executor re-reads the sanction (nothing debited yet)
  'releasing', // DEBITED, the executor lifts the timeout
  'released',
  'refused', // ended before any debit (no timeout, permanent ban, not enough Jetons…)
  'cancelled',
  'expired',
  'failed', // ended: nothing debited, or debited then refunded (see `refund`)
  'uncertain', // debited, the release may or may not have happened: to verify, never refunded automatically
]);
export type CautionStatus = z.infer<typeof CautionStatus>;

export const CAUTION_OPEN: readonly CautionStatus[] = [
  'checking',
  'quoting',
  'quoted',
  'confirmed',
  'rechecking',
  'releasing',
];

const TwitchId = z.string().regex(/^\d{1,32}$/);
const Login = z.string().min(1).max(64);
const ExecutorId = z.string().min(1).max(64);

export const CautionUser = z.strictObject({
  id: TwitchId,
  login: Login,
  name: z.string().min(1).max(64),
});
export type CautionUser = z.infer<typeof CautionUser>;

/** A Twitch sanction as read by the executor: an end (ISO) for a timeout. */
export const CautionSanction = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('timeout'),
    ends_at: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({ kind: z.literal('permanent') }),
  z.strictObject({ kind: z.literal('none') }),
]);
export type CautionSanction = z.infer<typeof CautionSanction>;

/** The executor asks for work, with what its tokens allow. */
export const CautionClaimRequest = z.strictObject({
  executor_id: ExecutorId,
  login: Login,
  /** Get Users (LeCroupier_) + Get Banned Users (broadcaster: moderation:read). */
  can_read: z.boolean(),
  /** Unban User (LeCroupier_: moderator:manage:banned_users). */
  can_release: z.boolean(),
  missing: z.array(z.string().max(120)).max(10),
});
export type CautionClaimRequest = z.infer<typeof CautionClaimRequest>;

const Attempt = {
  executor_id: ExecutorId,
  attempt_id: z.uuid(),
};

/** Quote phase: the target found by its login (null: no such user) and its sanction; or Twitch unreadable. */
export const CautionCheckReport = z.union([
  z.strictObject({
    ...Attempt,
    target: CautionUser.nullable(),
    sanction: CautionSanction,
  }),
  z.strictObject({ ...Attempt, error: z.string().min(1).max(300) }),
]);
export type CautionCheckReport = z.infer<typeof CautionCheckReport>;

/** Release phase, before anything is debited: the target's sanction now (or Twitch unreadable). */
export const CautionRecheckReport = z.union([
  z.strictObject({ ...Attempt, sanction: CautionSanction }),
  z.strictObject({ ...Attempt, error: z.string().min(1).max(300) }),
]);
export type CautionRecheckReport = z.infer<typeof CautionRecheckReport>;

/**
 * The release:
 * - released: Twitch lifted it (or a check after an ambiguous answer shows it lifted);
 * - not_applied: certainly not lifted (Twitch refused, or the request never left) → refunded once;
 * - not_banned: the timeout had already ended when the unban arrived → refunded once;
 * - uncertain: may or may not be lifted (no answer, unreadable check) → to verify, never refunded automatically.
 */
export const CautionReleaseReport = z.strictObject({
  ...Attempt,
  event: z.enum(['released', 'not_applied', 'not_banned', 'uncertain']),
  error: z.string().max(300).optional(),
  verified: z.boolean().optional(),
});
export type CautionReleaseReport = z.infer<typeof CautionReleaseReport>;
