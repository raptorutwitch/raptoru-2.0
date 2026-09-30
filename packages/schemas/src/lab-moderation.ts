import { z } from 'zod';

// Moderation V2 (Lab) — commands sent by Studio (the broadcaster's cockpit) or by the extension
// (moderators), executed by Core, which is the only source of truth. Lab test wallet and TTS
// configuration commands are Studio-only.

const Id = z.string().regex(/^\d{1,32}$/);
const Reason = z.string().trim().max(200).optional();

export const LabModuleId = z.enum(['tts', 'soundboard', 'bonk']);
export type LabModuleId = z.infer<typeof LabModuleId>;
export const LabRole = z.enum([
  'broadcaster',
  'supermod',
  'moderator',
  'viewer',
]);
export type LabRole = z.infer<typeof LabRole>;
export const LabModuleState = z.enum(['active', 'paused', 'disabled']);

export const LabActor = z.strictObject({
  /** Twitch user id (extension) or the Studio operator name. */
  id: z.string().min(1).max(64),
  login: z.string().max(64).optional(),
  /** Claimed role (Lab JWT role); Core computes the effective role (Studio = broadcaster). */
  role: LabRole,
  via: z.enum(['studio', 'extension']),
});
export type LabActor = z.infer<typeof LabActor>;

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
  z.strictObject({
    action: z.literal('cancel'),
    module: LabModuleId,
    interaction_id: z.uuid(),
    refund: z.boolean(),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('purge'),
    module: LabModuleId,
    refund: z.boolean(),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('refund'),
    module: LabModuleId,
    interaction_id: z.uuid(),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('block_viewer'),
    viewer_id: Id,
    module: z.enum(['all', 'tts', 'soundboard', 'bonk']),
    /** null = until unblocked. */
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
    module: z.enum(['all', 'tts', 'soundboard', 'bonk']),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('viewer_cooldown'),
    viewer_id: Id,
    module: LabModuleId,
    /** add: on top of the current one · replace: from now · clear: none. */
    mode: z.enum(['add', 'replace', 'clear']),
    seconds: z.number().int().min(0).max(86_400).default(0),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('set_staff'),
    viewer_id: Id,
    role: z.enum(['supermod']).nullable(),
    reason: Reason,
  }),
]);
export type LabModerationCommand = z.infer<typeof LabModerationCommand>;

export const LabModerationRequest = z.strictObject({
  actor: LabActor,
  command: LabModerationCommand,
});
export type LabModerationRequest = z.infer<typeof LabModerationRequest>;

/** Lab-only test wallet (Studio « Wallet de test »). */
export const LabWalletRequest = z.strictObject({
  actor: LabActor,
  viewer_id: Id,
  op: z.enum(['set', 'adjust', 'reset']),
  tokens: z.number().int().min(-1_000_000_000).max(1_000_000_000).optional(),
  credits_tts: z.number().int().min(-100_000).max(100_000).optional(),
  credits_soundboard: z.number().int().min(-100_000).max(100_000).optional(),
});
export type LabWalletRequest = z.infer<typeof LabWalletRequest>;

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
