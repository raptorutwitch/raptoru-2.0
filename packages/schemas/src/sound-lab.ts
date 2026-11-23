import { z } from 'zod';

// Soundboard V2 — Lab slice (Extension Lab → Core → Studio → local audio player). Test only:
// `test_mode` and `payment_mode` are imposed by Core and never accepted from a caller (strict
// objects reject them). The caller sends a sound id only: Core resolves the file from its bank.

const Id = z.string().regex(/^\d+$/).max(32);
const Key = z.string().min(1).max(128);
export const SoundLabSoundId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/);

/**
 * How purchases of one sound are played:
 * - stack: every purchase plays at once, several instances may overlap;
 * - queue: purchases of this sound play one after the other;
 * - ignore_if_running: refused while this sound is waiting or playing.
 */
export const SoundLabPlaybackMode = z.enum([
  'stack',
  'queue',
  'ignore_if_running',
]);
export type SoundLabPlaybackMode = z.infer<typeof SoundLabPlaybackMode>;

/** Light attenuation of the Soundboard mix when several sounds play together. */
export const SoundLabVolumeProtection = z.enum(['off', 'light', 'medium']);
export type SoundLabVolumeProtection = z.infer<typeof SoundLabVolumeProtection>;

export const SoundLabPaymentMethod = z.enum(['tokens', 'credits']);
export type SoundLabPaymentMethod = z.infer<typeof SoundLabPaymentMethod>;

/** Admission of one sound (one click = one interaction), sent by the Studio Lab façade. */
export const SoundLabAdmitRequest = z.strictObject({
  idempotency_key: Key,
  channel_id: Id,
  viewer: z.strictObject({ id: Id, display_name: z.string().min(1).max(64) }),
  lab_session_id: z.string().min(1).max(64),
  sound_id: SoundLabSoundId,
  payment_method: SoundLabPaymentMethod,
});
export type SoundLabAdmitRequest = z.infer<typeof SoundLabAdmitRequest>;

export const SoundLabStatus = z.enum([
  'accepted',
  'queued',
  'executing',
  'completed',
  'failed',
  'execution_unknown',
  /** Removed (waiting) or stopped (playing) by moderation. */
  'cancelled',
]);
export type SoundLabStatus = z.infer<typeof SoundLabStatus>;

export const SoundLabError = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type SoundLabError = z.infer<typeof SoundLabError>;

export const SoundLabDelivery = z.object({
  studio_instance_id: z.string().nullable(),
  attempt_id: z.string().nullable(),
  lease_expires_at: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  /** The player confirmed it stopped the sound after a moderation stop. */
  stopped_at: z.string().nullable(),
});
export type SoundLabDelivery = z.infer<typeof SoundLabDelivery>;

export const SoundLabInteraction = z.object({
  interaction_id: z.string(),
  idempotency_key: z.string(),
  source: z.literal('extension_lab'),
  channel_id: z.string(),
  viewer_id: z.string(),
  viewer_display_name: z.string(),
  type: z.literal('sound'),
  requested_sound_id: z.string(),
  sound_id: z.string(),
  sound_label: z.string(),
  /**
   * Resolved by Core: `assets/sounds/<file>.mp3` (a bank file, relative to the extension asset root, served locally by
   * Studio) or `sound-files/<sha256>.wav` (a file published from Studio, held by Core, cached by Studio).
   */
  sound_url: z.string(),
  duration_ms: z.number().int(),
  playback_mode: SoundLabPlaybackMode,
  /** Per-sound volume (0–100) at admission. */
  volume: z.number().int(),
  created_at: z.string(),
  channel_sequence: z.number().int(),
  test_mode: z.literal(true),
  payment_mode: z.literal('simulated'),
  /** `channel_points`: played for a channel points reward (Points de chaîne V1) — paid on Twitch, never debited here. */
  payment_method: z.enum(['tokens', 'credits', 'channel_points']),
  simulated_cost: z.number().int(),
  simulated_currency: z.string(),
  real_debited: z.literal(0),
  /** The Lab test wallet was debited at admission; given back at most once. */
  refund_status: z.enum(['none', 'refunded']),
  refunded_at: z.string().nullable(),
  status: SoundLabStatus,
  lab_session_id: z.string(),
  expires_at: z.string(),
  error: SoundLabError.nullable(),
  delivery: SoundLabDelivery,
});
export type SoundLabInteraction = z.infer<typeof SoundLabInteraction>;

export const SoundLabAdmitResponse = z.object({
  interaction: SoundLabInteraction,
  replayed: z.boolean(),
});
export type SoundLabAdmitResponse = z.infer<typeof SoundLabAdmitResponse>;

/** Studio readiness: a fresh heartbeat with a live, audio-enabled player is required. */
export const SoundLabHeartbeat = z.strictObject({
  studio_instance_id: z.string().min(1).max(64),
  player_ready: z.boolean(),
  /** Channel this Studio serves: a Core of another channel refuses it (wrong_channel). Optional for older Studios. */
  channel_id: Id.optional(),
});
export type SoundLabHeartbeat = z.infer<typeof SoundLabHeartbeat>;

export const SoundLabClaimRequest = z.strictObject({
  studio_instance_id: z.string().min(1).max(64),
  channel_id: Id,
});
export type SoundLabClaimRequest = z.infer<typeof SoundLabClaimRequest>;

export const SoundLabAckRequest = z.strictObject({
  studio_instance_id: z.string().min(1).max(64),
  attempt_id: z.string().min(1).max(64),
  /** `stopped`: the player stopped a sound cancelled by moderation (proof, no status change). */
  event: z.enum([
    'started',
    'completed',
    'failed',
    'execution_unknown',
    'stopped',
  ]),
  error: z
    .strictObject({
      code: z.string().min(1).max(64),
      message: z.string().max(300),
    })
    .optional(),
});
export type SoundLabAckRequest = z.infer<typeof SoundLabAckRequest>;

/**
 * Sounds added (or re-cut) in Studio (docs/SOUNDBOARD.md § Ajouter un son): Studio cuts the extract and sends a WAV
 * (PCM 16-bit, mono or stereo); Core checks it is complete and within these bounds, stores it under the SHA-256 of
 * its bytes (immutable, deduplicated) and serves it to the extension and to Studio's player.
 */
export const SOUND_FILE_RULES = {
  maxBytes: 4 * 1024 * 1024,
  minDurationMs: 100,
  maxDurationMs: 20_000,
  /** Prices of a new sound: the bank's usual price of a short sound. */
  defaultTokenCost: 500,
  defaultCreditCost: 1,
} as const;
export const SoundFileId = z.string().regex(/^[0-9a-f]{64}$/);
export const SoundFileUpload = z.strictObject({
  data_base64: z
    .string()
    .min(1)
    .max(Math.ceil(SOUND_FILE_RULES.maxBytes / 3) * 4),
});
export type SoundFileUpload = z.infer<typeof SoundFileUpload>;
export const SoundFile = z.object({
  file_id: SoundFileId,
  mime: z.literal('audio/wav'),
  duration_ms: z.number().int(),
  size: z.number().int(),
});
export type SoundFile = z.infer<typeof SoundFile>;

/** A new sound (Studio): its id is chosen once by Studio, so a repeated click returns the same sound. */
export const SoundLabSoundCreate = z.strictObject({
  id: SoundLabSoundId,
  label: z.string().trim().min(1).max(40),
  file_id: SoundFileId,
  token_cost: z.number().int().min(0).max(1_000_000),
  credit_cost: z.number().int().min(0).max(100),
});
export type SoundLabSoundCreate = z.infer<typeof SoundLabSoundCreate>;

/** Streamer settings of one sound (Studio configuration panel). */
export const SoundLabSoundConfig = z.object({
  id: z.string(),
  /** `bank`: shipped with Raptoru (can be re-cut, never deleted for good); `studio`: added in Studio. */
  source: z.enum(['bank', 'studio']),
  /** The published file in use (added or re-cut in Studio); null = the bank's own file. */
  file_id: z.string().nullable(),
  /** Name shown to viewers: custom_label ?? default_label. */
  label: z.string(),
  /** Canonical name from the Core bank (read-only). */
  default_label: z.string(),
  /** Streamer rename, or null when the default name is used. */
  custom_label: z.string().nullable(),
  enabled: z.boolean(),
  token_cost: z.number().int(),
  credit_cost: z.number().int(),
  cooldown_ms: z.number().int(),
  playback_mode: SoundLabPlaybackMode,
  volume: z.number().int(),
  /** From the bank (read-only). */
  duration_ms: z.number().int().nullable(),
  preview_url: z.string().nullable(),
  variants: z.number().int(),
});
export type SoundLabSoundConfig = z.infer<typeof SoundLabSoundConfig>;

/** Partial update, validated by Core. */
export const SoundLabSoundUpdate = z
  .strictObject({
    /** Rename; an empty value, null or the default name removes the custom name. */
    label: z.union([z.string().trim().max(40), z.null()]),
    enabled: z.boolean(),
    token_cost: z.number().int().min(0).max(1_000_000),
    credit_cost: z.number().int().min(0).max(100),
    cooldown_ms: z.number().int().min(0).max(3_600_000),
    playback_mode: SoundLabPlaybackMode,
    volume: z.number().int().min(0).max(100),
    /** A published file (a new extract); null = back to the bank's own file (bank sounds only). */
    file_id: z.union([SoundFileId, z.null()]),
  })
  .partial()
  .refine((u) => Object.keys(u).length > 0, 'empty_update');
export type SoundLabSoundUpdate = z.infer<typeof SoundLabSoundUpdate>;

export const SoundLabSettings = z.strictObject({
  volume_protection: SoundLabVolumeProtection,
});
export type SoundLabSettings = z.infer<typeof SoundLabSettings>;

/** One sound as shown to the extension (live state included; Core stays authoritative). */
export const SoundLabSound = z.object({
  id: z.string(),
  label: z.string(),
  preview_url: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  token_cost: z.number().int(),
  credit_cost: z.number().int(),
  enabled: z.boolean(),
  playback_mode: SoundLabPlaybackMode,
  cooldown_ms: z.number().int(),
  /** Remaining cooldown at the time of the answer (0 = available). */
  cooldown_remaining_ms: z.number().int(),
  /** Waiting or playing now (relevant for ignore_if_running). */
  running: z.boolean(),
});
export type SoundLabSound = z.infer<typeof SoundLabSound>;
