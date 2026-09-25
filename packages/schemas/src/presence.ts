import { z } from 'zod';

// Presence tracker (shadow mode): the bot observes Get Chatters, Core decides what counts.

/** Nominal delay between two chatter snapshots. */
export const PRESENCE_INTERVAL_SECONDS = 120;

export const PresenceLeaseRequest = z.object({
  workerId: z.string().min(1).max(128),
  streamId: z.string().min(1).max(64),
});
export type PresenceLeaseRequest = z.infer<typeof PresenceLeaseRequest>;

export const PresenceLeaseResponse = z.object({
  granted: z.boolean(),
  holder: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type PresenceLeaseResponse = z.infer<typeof PresenceLeaseResponse>;

export const Chatter = z.object({
  twitchUserId: z.string().regex(/^\d+$/),
  login: z.string().min(1).max(25),
  displayName: z.string().min(1).max(50),
});
export type Chatter = z.infer<typeof Chatter>;

export const PresenceErrorKind = z.enum([
  'timeout',
  'network',
  'http_error',
  'rate_limited',
  'auth',
  'pagination',
]);
export type PresenceErrorKind = z.infer<typeof PresenceErrorKind>;

export const PresenceSnapshot = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    chatters: z.array(Chatter).max(100_000),
    reportedTotal: z.number().int().nonnegative().nullable(),
    pages: z.number().int().positive(),
  }),
  z.object({
    status: z.literal('error'),
    errorKind: PresenceErrorKind,
    httpStatus: z.number().int().nullable(),
    message: z.string().max(500),
  }),
]);
export type PresenceSnapshot = z.infer<typeof PresenceSnapshot>;

export const PresenceObservationRequest = z.object({
  /** Client-generated id: a retried POST replays the stored outcome. */
  cycleId: z.string().min(1).max(128),
  workerId: z.string().min(1).max(128),
  streamId: z.string().min(1).max(64),
  /** When the snapshot started (bot clock). */
  observedAt: z.iso.datetime({ offset: true }),
  durationMs: z.number().int().nonnegative(),
  /** Age of the bot's last live confirmation (EventSub or Helix). */
  liveStateAgeSeconds: z.number().int().nonnegative().nullable(),
  snapshot: PresenceSnapshot,
});
export type PresenceObservationRequest = z.infer<
  typeof PresenceObservationRequest
>;

export const PresenceObservationResponse = z.object({
  accepted: z.boolean(),
  /** Why the observation was refused (nothing recorded). */
  rejection: z
    .enum(['lease_held', 'stream_not_live', 'out_of_order'])
    .nullable(),
  creditedSeconds: z.number().int(),
  creditedViewers: z.number().int(),
  /** Why no interval was credited for this cycle, if none. */
  gapReason: z
    .enum([
      'first_snapshot',
      'previous_failed',
      'gap_too_long',
      'worker_changed',
      'snapshot_failed',
    ])
    .nullable(),
});
export type PresenceObservationResponse = z.infer<
  typeof PresenceObservationResponse
>;
