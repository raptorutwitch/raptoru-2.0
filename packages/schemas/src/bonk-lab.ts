import { z } from 'zod';

// Bonk V2 — Lab slice (Extension Lab → Core → Studio → OBS). Test only: `test_mode` and
// `payment_mode` are imposed by Core and never accepted from a caller (strict objects reject them).

const Id = z.string().regex(/^\d+$/).max(32);
const Key = z.string().min(1).max(128);

/** Admission of one Bonk (one click = one interaction), sent by the Studio Lab façade. */
export const BonkLabAdmitRequest = z.strictObject({
  idempotency_key: Key,
  channel_id: Id,
  viewer: z.strictObject({ id: Id, display_name: z.string().min(1).max(64) }),
  lab_session_id: z.string().min(1).max(64),
  emote: z.strictObject({
    provider: z.enum(['unicode', 'twitch']),
    id: z.string().min(1).max(64),
    glyph: z.string().max(32).nullable().optional(),
  }),
});
export type BonkLabAdmitRequest = z.infer<typeof BonkLabAdmitRequest>;

export const BonkLabStatus = z.enum([
  'accepted',
  'queued',
  'executing',
  'completed',
  'failed',
  'execution_unknown',
]);
export type BonkLabStatus = z.infer<typeof BonkLabStatus>;

export const BonkLabError = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type BonkLabError = z.infer<typeof BonkLabError>;

/** Execution metadata, kept apart from the authoritative interaction. */
export const BonkLabDelivery = z.object({
  studio_instance_id: z.string().nullable(),
  attempt_id: z.string().nullable(),
  lease_expires_at: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});
export type BonkLabDelivery = z.infer<typeof BonkLabDelivery>;

export const BonkLabInteraction = z.object({
  interaction_id: z.string(),
  idempotency_key: z.string(),
  source: z.literal('extension_lab'),
  channel_id: z.string(),
  viewer_id: z.string(),
  viewer_display_name: z.string(),
  type: z.literal('bonk'),
  provider: z.enum(['unicode', 'twitch']),
  emote_id: z.string(),
  emote_glyph: z.string().nullable(),
  /** Resolved by Core; relative to the extension asset root (served locally by Studio). */
  emote_url: z.string(),
  emote_animated: z.boolean(),
  quantity: z.literal(1),
  created_at: z.string(),
  channel_sequence: z.number().int(),
  test_mode: z.literal(true),
  payment_mode: z.literal('simulated'),
  simulated_cost: z.number().int(),
  simulated_currency: z.string(),
  real_debited: z.literal(0),
  status: BonkLabStatus,
  lab_session_id: z.string(),
  expires_at: z.string(),
  error: BonkLabError.nullable(),
  delivery: BonkLabDelivery,
});
export type BonkLabInteraction = z.infer<typeof BonkLabInteraction>;

export const BonkLabAdmitResponse = z.object({
  interaction: BonkLabInteraction,
  replayed: z.boolean(),
});
export type BonkLabAdmitResponse = z.infer<typeof BonkLabAdmitResponse>;

/** Studio worker readiness, refreshed every few seconds. */
export const BonkLabHeartbeat = z.strictObject({
  studio_instance_id: z.string().min(1).max(64),
  obs: z.enum(['connected', 'offline']),
  source_ready: z.boolean(),
  overlay_ready: z.boolean(),
});
export type BonkLabHeartbeat = z.infer<typeof BonkLabHeartbeat>;

export const BonkLabClaimRequest = z.strictObject({
  studio_instance_id: z.string().min(1).max(64),
  channel_id: Id,
});
export type BonkLabClaimRequest = z.infer<typeof BonkLabClaimRequest>;

export const BonkLabClaimResponse = z.object({
  interaction: BonkLabInteraction.nullable(),
});
export type BonkLabClaimResponse = z.infer<typeof BonkLabClaimResponse>;

/**
 * Renderer/Studio outcome for one attempt. `released` = claimed but certainly never sent to the
 * renderer (safe to queue again); `execution_unknown` = sent, outcome not provable.
 */
export const BonkLabAckRequest = z.strictObject({
  studio_instance_id: z.string().min(1).max(64),
  attempt_id: z.string().min(1).max(64),
  event: z.enum([
    'started',
    'completed',
    'failed',
    'execution_unknown',
    'released',
  ]),
  error: z
    .strictObject({
      code: z.string().min(1).max(64),
      message: z.string().max(300),
    })
    .optional(),
});
export type BonkLabAckRequest = z.infer<typeof BonkLabAckRequest>;

// --- Twitch viewer identity & personal emote catalog (Lab) -----------------------------------------

export const BonkLabViewerAuthComplete = z.strictObject({
  code: z.string().min(1).max(512),
  state: z.string().min(1).max(128),
});
export type BonkLabViewerAuthComplete = z.infer<
  typeof BonkLabViewerAuthComplete
>;

/** Linked Twitch viewer (never includes a token). */
export const BonkLabViewer = z.object({
  user_id: z.string(),
  login: z.string(),
  display_name: z.string(),
  scopes: z.array(z.string()),
});
export type BonkLabViewer = z.infer<typeof BonkLabViewer>;

/** One Twitch emote as returned for this viewer, with the CDN URLs built by Core. */
export const BonkLabTwitchEmote = z.object({
  provider: z.literal('twitch'),
  id: z.string(),
  name: z.string(),
  emote_type: z.string(),
  emote_set_id: z.string(),
  owner_id: z.string(),
  owner_login: z.string().nullable(),
  owner_display_name: z.string().nullable(),
  formats: z.array(z.string()),
  animated: z.boolean(),
  url: z.string(),
  static_url: z.string(),
});
export type BonkLabTwitchEmote = z.infer<typeof BonkLabTwitchEmote>;

export const BonkLabTwitchOwner = z.object({
  id: z.string(),
  login: z.string(),
  display_name: z.string(),
  profile_image_url: z.string().nullable(),
});
export type BonkLabTwitchOwner = z.infer<typeof BonkLabTwitchOwner>;

export const BonkLabCatalog = z.object({
  user_id: z.string(),
  fetched_at: z.string(),
  emotes: z.array(BonkLabTwitchEmote),
  owners: z.array(BonkLabTwitchOwner),
});
export type BonkLabCatalog = z.infer<typeof BonkLabCatalog>;
