import { z } from 'zod';

// TTS V2 — Lab slice (Extension Lab → Core → Studio TTS worker → local player / OBS overlay).
// Test only: `test_mode` and `payment_mode` are imposed by Core and never accepted from a caller.
// The caller sends the text and the payment method only: Core decides the price, the cooldown,
// the queue position and the cast (character + voice), once, at admission.

const Id = z.string().regex(/^\d+$/).max(32);
const Key = z.string().min(1).max(128);
const StudioId = z.string().min(1).max(64);

export const TtsLabPaymentMethod = z.enum(['tokens', 'credits']);
export type TtsLabPaymentMethod = z.infer<typeof TtsLabPaymentMethod>;

/** Module state (moderation primitive): paused keeps the queue, disabled refuses everything. */
export const TtsLabModuleState = z.enum(['active', 'paused', 'disabled']);
export type TtsLabModuleState = z.infer<typeof TtsLabModuleState>;

/**
 * queued → starting (claimed by the player) → playing (ACK started) → completed
 *                                           ↘ failed (never started: refunded automatically)
 * playing → failed / execution_unknown (may have been heard: not refunded automatically)
 * queued / starting → cancelled (moderation: purge / cancel, refund decided by the moderator)
 */
export const TtsLabStatus = z.enum([
  'queued',
  'starting',
  'playing',
  'completed',
  'failed',
  'execution_unknown',
  'cancelled',
]);
export type TtsLabStatus = z.infer<typeof TtsLabStatus>;

export const TtsLabRefundStatus = z.enum(['none', 'refunded']);
export type TtsLabRefundStatus = z.infer<typeof TtsLabRefundStatus>;

/** The cast decided by Core at admission (never by the client, never redrawn). */
export const TtsLabCast = z.object({
  character_id: z.string(),
  voice_profile_id: z.string(),
  /** Voice category of the pool entry (normal / japanese / variant). */
  voice_category: z.enum(['normal', 'japanese', 'variant']),
});
export type TtsLabCast = z.infer<typeof TtsLabCast>;

export const TtsLabAdmitRequest = z.strictObject({
  idempotency_key: Key,
  channel_id: Id,
  viewer: z.strictObject({
    id: Id,
    display_name: z.string().min(1).max(64),
  }),
  lab_session_id: z.string().min(1).max(64),
  text: z.string().min(1).max(8000),
  payment_method: TtsLabPaymentMethod,
});
export type TtsLabAdmitRequest = z.infer<typeof TtsLabAdmitRequest>;

export const TtsLabError = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type TtsLabError = z.infer<typeof TtsLabError>;

export const TtsLabDelivery = z.object({
  studio_instance_id: z.string().nullable(),
  attempt_id: z.string().nullable(),
  lease_expires_at: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});
export type TtsLabDelivery = z.infer<typeof TtsLabDelivery>;

export const TtsLabInteraction = z.object({
  interaction_id: z.string(),
  idempotency_key: z.string(),
  source: z.literal('extension_lab'),
  channel_id: z.string(),
  viewer_id: z.string(),
  viewer_display_name: z.string(),
  type: z.literal('tts'),
  /** Normalized text (what is read). */
  message: z.string(),
  length: z.number().int(),
  tier_id: z.string(),
  cast: TtsLabCast,
  estimated_duration_ms: z.number().int(),
  /** Queue weight used for capacity and wait estimates (= estimated duration, configurable later). */
  estimated_weight: z.number().int(),
  cooldown_seconds: z.number().int(),
  created_at: z.string(),
  channel_sequence: z.number().int(),
  test_mode: z.literal(true),
  payment_mode: z.literal('simulated'),
  payment_method: TtsLabPaymentMethod,
  simulated_cost: z.number().int(),
  simulated_currency: z.string(),
  real_debited: z.literal(0),
  refund_status: TtsLabRefundStatus,
  refunded_at: z.string().nullable(),
  /** Watched words (D4): `pending` = held, never handed to the player until « Laisser passer ». */
  review_status: z.enum(['none', 'pending', 'allowed']),
  /** Watched / blocked words found in the message, with their position (highlight). */
  review_hits: z.array(
    z.object({ word: z.string(), start: z.number(), end: z.number() }),
  ),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  status: TtsLabStatus,
  lab_session_id: z.string(),
  expires_at: z.string(),
  error: TtsLabError.nullable(),
  delivery: TtsLabDelivery,
});
export type TtsLabInteraction = z.infer<typeof TtsLabInteraction>;

/** Queue position and wait, computed from what is really in the queue (durations). */
export const TtsLabQueueInfo = z.object({
  /** 1 = next to play; null once playing or finished. */
  position: z.number().int().nullable(),
  /** Estimated wait before this message starts, in ms (null once started or finished). */
  wait_ms: z.number().int().nullable(),
});
export type TtsLabQueueInfo = z.infer<typeof TtsLabQueueInfo>;

export const TtsLabAdmitResponse = z.object({
  interaction: TtsLabInteraction,
  queue: TtsLabQueueInfo,
  replayed: z.boolean(),
});
export type TtsLabAdmitResponse = z.infer<typeof TtsLabAdmitResponse>;

/** Studio readiness: a fresh heartbeat with a live player page (OBS overlay or Studio preview). */
export const TtsLabHeartbeat = z.strictObject({
  studio_instance_id: StudioId,
  player_ready: z.boolean(),
});
export type TtsLabHeartbeat = z.infer<typeof TtsLabHeartbeat>;

export const TtsLabClaimRequest = z.strictObject({
  studio_instance_id: StudioId,
  channel_id: Id,
});
export type TtsLabClaimRequest = z.infer<typeof TtsLabClaimRequest>;

export const TtsLabAckRequest = z.strictObject({
  studio_instance_id: StudioId,
  attempt_id: z.string().min(1).max(64),
  event: z.enum(['started', 'completed', 'failed', 'execution_unknown']),
  error: z
    .strictObject({
      code: z.string().min(1).max(64),
      message: z.string().max(300),
    })
    .optional(),
});
export type TtsLabAckRequest = z.infer<typeof TtsLabAckRequest>;

/** Viewer-facing state of the module (extension): availability decided by Core before payment. */
export const TtsLabViewerState = z.object({
  module_state: TtsLabModuleState,
  /** True when the Studio player is not live: nothing can be bought. */
  player_offline: z.boolean(),
  queue_full: z.boolean(),
  blocked: z.boolean(),
  /** Moderation « Pause globale »: every new interaction is refused. */
  global_paused: z.boolean(),
  /** A TTS of this viewer is waiting or playing (legacy: one at a time). */
  viewer_busy: z.boolean(),
  cooldown_remaining_ms: z.number().int(),
  queue_length: z.number().int(),
  queue_wait_ms: z.number().int(),
  /** This viewer's latest TTS (recovery after refresh / reopening). */
  current: z
    .object({ interaction: TtsLabInteraction, queue: TtsLabQueueInfo })
    .nullable(),
});
export type TtsLabViewerState = z.infer<typeof TtsLabViewerState>;

/** Moderation primitives (API only for now; Moderation V2 will use them). */
export const TtsLabModerationRequest = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('pause'),
    actor: z.string().min(1).max(64),
  }),
  z.strictObject({
    action: z.literal('resume'),
    actor: z.string().min(1).max(64),
  }),
  z.strictObject({
    action: z.literal('disable'),
    actor: z.string().min(1).max(64),
  }),
  z.strictObject({
    action: z.literal('stop_current'),
    actor: z.string().min(1).max(64),
    refund: z.boolean().default(false),
  }),
  z.strictObject({
    action: z.literal('purge'),
    actor: z.string().min(1).max(64),
    refund: z.boolean().default(false),
  }),
  z.strictObject({
    action: z.literal('cancel'),
    actor: z.string().min(1).max(64),
    interaction_id: z.uuid(),
    refund: z.boolean().default(false),
  }),
  z.strictObject({
    action: z.literal('refund'),
    actor: z.string().min(1).max(64),
    interaction_id: z.uuid(),
  }),
  z.strictObject({
    action: z.literal('block_viewer'),
    actor: z.string().min(1).max(64),
    viewer_id: Id,
    until: z.iso.datetime().nullable().default(null),
  }),
  z.strictObject({
    action: z.literal('unblock_viewer'),
    actor: z.string().min(1).max(64),
    viewer_id: Id,
  }),
  z.strictObject({
    action: z.literal('set_viewer_cooldown'),
    actor: z.string().min(1).max(64),
    viewer_id: Id,
    /** New cooldown end (null clears the cooldown). */
    until: z.iso.datetime().nullable(),
  }),
]);
export type TtsLabModerationRequest = z.infer<typeof TtsLabModerationRequest>;
