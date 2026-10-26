import { z } from 'zod';

// Moderation V2 (Lab, parity D4) — commands sent by Studio (the broadcaster's cockpit) or by the
// extension (moderators), executed by Core, which is the only source of truth and decides every
// permission. TTS configuration, the Lab test wallet tools and the Tombola controls are Studio's.

const Id = z.string().regex(/^\d{1,32}$/);
const Reason = z.string().trim().max(200).optional();

/** Modules with a state (Tombola included); queues exist for TTS and Soundboard only. */
export const LabModuleId = z.enum(['tts', 'soundboard', 'bonk', 'raffle']);
export type LabModuleId = z.infer<typeof LabModuleId>;
export const LabQueueModule = z.enum(['tts', 'soundboard']);
export const LabRole = z.enum([
  'broadcaster',
  'supermod',
  'moderator',
  'viewer',
]);
export type LabRole = z.infer<typeof LabRole>;
export const LabModuleState = z.enum(['active', 'paused', 'disabled']);

/**
 * Permissions granted per moderator (supermods and the broadcaster have all of them): the 6 of D4,
 * plus « Gérer la Tombola » (Tombola V2: more time, pause, immediate draw, manual entry, payouts),
 * plus the Roue du Sub V2's « Tirer » / « Accorder un tour » (R-7).
 */
export const LabGrant = z.enum([
  'wallet',
  'modules',
  'globalPause',
  'perms',
  'sensitive',
  'words',
  'raffle',
  'subWheelDraw',
  'subWheelGrant',
]);
export type LabGrant = z.infer<typeof LabGrant>;

export const LabActor = z.strictObject({
  /** Twitch user id (extension) or the Studio operator name. */
  id: z.string().min(1).max(64),
  login: z.string().max(64).optional(),
  display_name: z.string().max(64).optional(),
  /** Claimed role (Lab JWT role); Core computes the effective role (Studio = broadcaster). */
  role: LabRole,
  via: z.enum(['studio', 'extension']),
});
export type LabActor = z.infer<typeof LabActor>;

/** Personal cooldown span (D4 « Pendant ») : seconds, or the current stream. */
const CooldownSpan = z.union([
  z
    .number()
    .int()
    .min(60)
    .max(7 * 86_400),
  z.literal('stream'),
]);

export const LabModerationCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('module_state'),
    module: LabModuleId,
    state: LabModuleState,
    /** Pause / disable: keep the waiting queue (default) or cancel it, with or without refund. */
    waiting: z.enum(['keep', 'cancel', 'cancel_refund']).default('keep'),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('stop_current'),
    module: z.literal('tts'),
    refund: z.boolean(),
    reason: Reason,
  }),
  /** Remove a waiting request or stop one being played (TTS, Soundboard). */
  z.strictObject({
    action: z.literal('cancel'),
    module: LabQueueModule,
    interaction_id: z.uuid(),
    refund: z.boolean(),
    reason: Reason,
  }),
  /** Soundboard « Stop tous les sons » : every sound being played; the queue is not touched. */
  z.strictObject({
    action: z.literal('stop_all'),
    module: z.literal('soundboard'),
    refund: z.boolean(),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('purge'),
    module: LabQueueModule,
    refund: z.boolean(),
    reason: Reason,
  }),
  /** Refund of a finished interaction (addition to D4: « Admin Wallet »). */
  z.strictObject({
    action: z.literal('refund'),
    module: z.enum(['tts', 'soundboard', 'bonk']),
    interaction_id: z.uuid(),
    reason: Reason,
  }),
  /** « Laisser passer » a TTS held for review (watched words). */
  z.strictObject({
    action: z.literal('allow'),
    module: z.literal('tts'),
    interaction_id: z.uuid(),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('block_viewer'),
    viewer_id: Id,
    module: z.enum(['all', 'tts', 'soundboard', 'bonk', 'raffle']),
    /** null = until unblocked (addition to D4, sensitive sanction). */
    duration_s: z
      .number()
      .int()
      .min(1)
      .max(30 * 86_400)
      .nullable(),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('unblock_viewer'),
    viewer_id: Id,
    module: z.enum(['all', 'tts', 'soundboard', 'bonk', 'raffle']),
    reason: Reason,
  }),
  /** D4 personal cooldown: « délai imposé » between two uses, « pendant » a span. */
  z.strictObject({
    action: z.literal('set_cooldown'),
    viewer_id: Id,
    module: z.enum(['tts', 'soundboard', 'bonk']),
    delay_s: z.number().int().min(1).max(86_400),
    span: CooldownSpan,
    reason: Reason,
  }),
  /** Removes the personal cooldown (and, for TTS, the running cooldown of the last TTS). */
  z.strictObject({
    action: z.literal('clear_cooldown'),
    viewer_id: Id,
    module: z.enum(['tts', 'soundboard', 'bonk']),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('global_pause'),
    paused: z.boolean(),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('set_permission'),
    viewer_id: Id,
    permission: LabGrant,
    granted: z.boolean(),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('set_staff'),
    viewer_id: Id,
    role: z.enum(['supermod']).nullable(),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('add_note'),
    viewer_id: Id,
    text: z.string().trim().min(1).max(140),
  }),
  z.strictObject({
    action: z.literal('add_word'),
    word: z.string().trim().min(1).max(40),
    kind: z.enum(['watch', 'block']),
  }),
  z.strictObject({
    action: z.literal('remove_word'),
    word_id: z.number().int().positive(),
  }),
  /** Wallet admin (D4 « Créditer » / « Débiter ») on the Lab test wallet. */
  z.strictObject({
    action: z.literal('wallet_adjust'),
    viewer_id: Id,
    currency: z.enum(['tokens', 'credits_tts', 'credits_soundboard']),
    delta: z
      .number()
      .int()
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .refine((v) => v !== 0, 'delta must not be 0'),
    reason: Reason,
  }),
  /** Tombola (« Ouverture, tirage et fermeture : Studio »). */
  z.strictObject({
    action: z.literal('raffle_open'),
    jackpot: z.number().int().min(0).max(10_000_000),
    duration_s: z.number().int().min(10).max(3_600),
    winners: z.number().int().min(1).max(10).default(1),
    reason: Reason,
  }),
  z.strictObject({ action: z.literal('raffle_close'), reason: Reason }),
  z.strictObject({ action: z.literal('raffle_draw'), reason: Reason }),
]);
export type LabModerationCommand = z.infer<typeof LabModerationCommand>;

export const LabModerationRequest = z.strictObject({
  actor: LabActor,
  command: LabModerationCommand,
  /** The client's Idempotency-Key, carried to Core: a retried action is never applied twice. */
  idempotency_key: z.string().min(8).max(128).optional(),
});
export type LabModerationRequest = z.infer<typeof LabModerationRequest>;

/** Lab-only test wallet tools (Studio « Wallet de test »: set values, reset to defaults). */
export const LabWalletRequest = z.strictObject({
  actor: LabActor,
  viewer_id: Id,
  op: z.enum(['set', 'adjust', 'reset']),
  tokens: z.number().int().min(-1_000_000_000).max(1_000_000_000).optional(),
  credits_tts: z.number().int().min(-100_000).max(100_000).optional(),
  credits_soundboard: z.number().int().min(-100_000).max(100_000).optional(),
});
export type LabWalletRequest = z.infer<typeof LabWalletRequest>;

/** Tombola entry from the extension (free, one per viewer and per round). */
export const LabRaffleJoinRequest = z.strictObject({
  channel_id: Id,
  viewer: z.strictObject({ id: Id, display_name: z.string().min(1).max(64) }),
  idempotency_key: z.string().min(8).max(128),
});
export type LabRaffleJoinRequest = z.infer<typeof LabRaffleJoinRequest>;

/** TTS → Configuration (Studio). Core validates the coherence (ranges, gaps, bounds). */
export const TtsEditableRules = z.strictObject({
  tiers: z
    .array(
      z.strictObject({
        min: z.number().int(),
        max: z.number().int().nullable(),
        price: z.number().int(),
        credit_cost: z.number().int(),
        cooldown_seconds: z.number().int(),
      }),
    )
    .min(1)
    .max(12),
  max_chars: z.number().int(),
  max_waiting_global: z.number().int(),
  max_waiting_weight_ms: z.number().int().nullable(),
  transition_gap_ms: z.number().int(),
  max_per_viewer: z.number().int(),
});
export type TtsEditableRules = z.infer<typeof TtsEditableRules>;

export const TtsRulesUpdate = z.strictObject({
  actor: LabActor,
  rules: TtsEditableRules,
  reason: Reason,
});
export const TtsRulesReset = z.strictObject({
  actor: LabActor,
  reason: Reason,
});
