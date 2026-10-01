import { z } from 'zod';
import { LabActor } from './lab-moderation.js';

// Tombola V2 (Lab) — configuration, commands and chat ingress. Core is the only source of truth: it
// owns the round, its phases, its reward and currency, the entries, the draw, the payouts and the
// audit. Studio, the extension, the overlay and the chat adapter only send intentions and display.

const Id = z.string().regex(/^\d{1,32}$/);
const Reason = z.string().trim().max(200).optional();
/** A chat command: « ! » + 1–24 letters, digits or « _ » (compared case-insensitively). */
const Command = z
  .string()
  .trim()
  .regex(/^![\p{L}\p{N}_]{1,24}$/u)
  .transform((c) => c.toLowerCase());
const CurrencyId = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);

/** One band of the random jackpot: `pct` % of the rounds fall in [from, to], rarer towards `to`. */
export const RaffleAmountBand = z.strictObject({
  from: z.number().int().min(0),
  to: z.number().int().min(1),
  pct: z.number().min(0).max(100),
});

/** Display durations of the overlay / extension (business durations only, never micro-animations). */
export const RaffleDisplay = z.strictObject({
  /** Opening announcement before the countdown starts. */
  intro_s: z.number().int().min(0).max(15),
  /** « Tirage en cours » before the reveal starts. */
  drawing_s: z.number().int().min(1).max(15),
  /** How long one « Pseudo ✓ » entry feedback stays on screen. */
  join_feedback_ms: z.number().int().min(600).max(5000),
  result_normal_s: z.number().int().min(5).max(120),
  result_super_s: z.number().int().min(5).max(120),
  result_full_s: z.number().int().min(5).max(120),
  result_giveaway_s: z.number().int().min(5).max(120),
  cancelled_s: z.number().int().min(2).max(30),
  /** Stream delay margin: the extension shows the result this long after the overlay reveal ends. */
  stream_margin_s: z.number().int().min(0).max(60),
  /** Extension: result (or cancellation) shown this long before going back to « Aucune Tombola ». */
  extension_idle_return_s: z.number().int().min(3).max(300),
});
export type RaffleDisplay = z.infer<typeof RaffleDisplay>;

/** Automatic launches during a stream (presets, or « Personnalisé » with its own values). */
export const RaffleScheduler = z.strictObject({
  enabled: z.boolean(),
  preset: z.enum([
    'rare',
    'occasional',
    'normal',
    'frequent',
    'very_frequent',
    'custom',
  ]),
  /** Custom only (a preset brings its own values). Delay before the first automatic round. */
  first_delay_s: z
    .number()
    .int()
    .min(0)
    .max(4 * 3600),
  mode: z.enum(['fixed', 'random']),
  interval_s: z
    .number()
    .int()
    .min(60)
    .max(6 * 3600),
  interval_min_s: z
    .number()
    .int()
    .min(60)
    .max(6 * 3600),
  interval_max_s: z
    .number()
    .int()
    .min(60)
    .max(6 * 3600),
});
export type RaffleScheduler = z.infer<typeof RaffleScheduler>;

/**
 * A launch sound imported by Studio into its own managed storage (never a path of the user's
 * disk): content-addressed asset (SHA-256), format, display name, dedicated volume.
 */
export const RaffleSound = z.strictObject({
  asset_id: z.string().regex(/^[0-9a-f]{64}$/),
  format: z.enum(['mp3', 'wav', 'ogg']),
  name: z.string().trim().min(1).max(80),
  size_bytes: z
    .number()
    .int()
    .min(1)
    .max(5 * 1024 * 1024),
  volume: z.number().int().min(0).max(100),
});
export type RaffleSound = z.infer<typeof RaffleSound>;

export const RaffleConfig = z.strictObject({
  /** Registered Lab currency of a normal round (random or fixed amount). */
  currency_id: CurrencyId,
  amount_mode: z.enum(['random', 'fixed', 'giveaway']),
  fixed_amount: z.number().int().min(1).max(10_000_000),
  /** Giveaway: free text prize (no wallet credit). */
  prize: z.string().trim().min(1).max(80),
  random: z.strictObject({
    step: z.number().int().min(1).max(100_000),
    bands: z.array(RaffleAmountBand).min(1).max(8),
  }),
  duration_s: z.number().int().min(10).max(3600),
  winners_mode: z.enum(['auto', 'custom']),
  winners_custom: z.number().int().min(1).max(50),
  full: z.strictObject({
    enabled: z.boolean(),
    chance_pct: z.number().min(0).max(100),
  }),
  super: z.strictObject({
    enabled: z.boolean(),
    /** Chance of a SUPER round: 1 in `one_in`. */
    one_in: z.number().int().min(2).max(1_000_000),
    jackpot: z.number().int().min(1).max(10_000_000),
    currency_id: CurrencyId,
  }),
  /** Entry commands: « !join » and « !enter » always, plus Studio aliases. */
  join_aliases: z.array(Command).max(10),
  /** Moderator-only cancel command and its aliases. */
  cancel_commands: z.array(Command).min(1).max(5),
  extension_button: z.boolean(),
  /** Overlay instruction text: display only, never changes the real commands. */
  overlay_hint: z.strictObject({
    mode: z.enum(['none', 'join', 'custom']),
    text: z.string().trim().max(60),
  }),
  display: RaffleDisplay,
  scheduler: RaffleScheduler,
  /**
   * Opening sound per announced type (SUPER / Giveaway fall back to the normal one when unset).
   * Never a FULL OSEILLE sound: FULL is decided at the draw and must stay a surprise.
   */
  launch_sounds: z.strictObject({
    normal: RaffleSound.nullable(),
    super: RaffleSound.nullable(),
    giveaway: RaffleSound.nullable(),
  }),
});
export type RaffleConfig = z.infer<typeof RaffleConfig>;

/** Studio / moderation commands on the Tombola (Core checks every permission). */
export const RaffleCommand = z.discriminatedUnion('action', [
  /** Opens a round with the current configuration (`super` forces a SUPER round). */
  z.strictObject({
    action: z.literal('launch'),
    kind: z.enum(['auto', 'super']).default('auto'),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('extend'),
    seconds: z.number().int().min(5).max(600),
    reason: Reason,
  }),
  z.strictObject({ action: z.literal('draw_now'), reason: Reason }),
  z.strictObject({ action: z.literal('pause'), reason: Reason }),
  z.strictObject({ action: z.literal('resume'), reason: Reason }),
  z.strictObject({ action: z.literal('cancel'), reason: Reason }),
  /**
   * Manual entry by moderation: goes through a global / module pause (deliberate action), never
   * through an individual Tombola block unless `force` is explicitly set (audited).
   */
  z.strictObject({
    action: z.literal('add_participant'),
    viewer_id: Id,
    display_name: z.string().trim().min(1).max(64),
    force: z.boolean().default(false),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('remove_participant'),
    viewer_id: Id,
    reason: Reason,
  }),
  /** Pays again a winner whose payout failed (never twice: Core keeps one credit per winner). */
  z.strictObject({
    action: z.literal('retry_payout'),
    raffle_id: z.uuid(),
    viewer_id: Id,
    reason: Reason,
  }),
  z.strictObject({ action: z.literal('config'), config: RaffleConfig }),
  /** Automatic scheduler: pause / resume (the remaining time is kept). */
  z.strictObject({ action: z.literal('scheduler_pause'), reason: Reason }),
  z.strictObject({ action: z.literal('scheduler_resume'), reason: Reason }),
  /** Stream session (simulated in the Lab): the viewer history shows the current stream only. */
  z.strictObject({ action: z.literal('stream_start'), reason: Reason }),
  z.strictObject({ action: z.literal('stream_end'), reason: Reason }),
]);
export type RaffleCommand = z.infer<typeof RaffleCommand>;

export const RaffleActionRequest = z.strictObject({
  actor: LabActor,
  command: RaffleCommand,
});
export type RaffleActionRequest = z.infer<typeof RaffleActionRequest>;

/** Extension entry (free, one per viewer and per round). */
export const RaffleExtensionJoin = z.strictObject({
  channel_id: Id,
  viewer: z.strictObject({ id: Id, display_name: z.string().min(1).max(64) }),
  idempotency_key: z.string().min(8).max(128),
});

/**
 * One chat message, from the Twitch chat adapter or the Studio chat simulator. Core decides whether
 * it is an entry command, a cancel command (moderator or above) or nothing.
 */
export const RaffleChatMessage = z.strictObject({
  channel_id: Id,
  message_id: z.string().min(1).max(128),
  text: z.string().max(500),
  chatter: z.strictObject({
    id: Id,
    login: z.string().min(1).max(64),
    display_name: z.string().min(1).max(64),
    /** From the Twitch badges (broadcaster / moderator); Core computes the effective role. */
    role: z.enum(['broadcaster', 'moderator', 'viewer']),
  }),
  source: z.enum(['twitch', 'simulator']),
});
export type RaffleChatMessage = z.infer<typeof RaffleChatMessage>;
