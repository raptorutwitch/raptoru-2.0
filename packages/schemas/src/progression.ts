import { z } from 'zod';

// Progression native (docs/PROGRESSION.md): XP, levels, titles and badges, the Core as the source of truth.

export const ProgressionRulesSchema = z.strictObject({
  /** Presence: XP per minute of VALIDATED presence (seen in two consecutive chatters readings, live only). */
  xp_per_minute: z.number().min(0).max(100),
  /** Chat: XP per rewarded message; at most one rewarded message per viewer per cooldown. */
  message_xp: z.number().int().min(0).max(1000),
  message_cooldown_s: z.number().int().min(5).max(3600),
  /** A message shorter than this (trimmed) earns nothing; commands (« ! ») never do. */
  message_min_chars: z.number().int().min(1).max(100),
  /** Only while the stream is live (anti-farming off stream). */
  live_only: z.boolean(),
  /** Level curve: total XP to reach level L = round(curve_base × (L − 1) ^ curve_exponent). */
  curve_base: z.number().min(1).max(100_000),
  curve_exponent: z.number().min(1).max(3),
  /** Accounts that never earn XP (bots); the broadcaster neither. */
  excluded_logins: z.array(z.string().regex(/^[a-z0-9_]{1,25}$/)).max(50),
  /**
   * Level Up V2 (docs/PROGRESSION.md): `curve` (the first model) or `fixed` (curve_base XP per level, exponent 1),
   * switched only by the guarded normalization — never by a rules patch.
   */
  level_model: z.enum(['curve', 'fixed']),
  /** Level Up notifications on stream (the viewers' own choice still applies); OFF until Antoni turns them on. */
  level_up_notifications: z.boolean(),
  /** One level-up SOUND at most per this delay, whole channel (written notices are never held back by it). */
  level_up_sound_cooldown_s: z.number().int().min(0).max(86_400),
  /** A notification not shown within this delay is dropped (never an old level-up much later). */
  level_up_max_age_s: z.number().int().min(10).max(3600),
  /**
   * The frozen WizeBot normalization (set once by the activation; null before): every WizeBot history, attached now or
   * months later, gets the same level — newLevel = floor(1 + (target_max − 1) × ((L − 1) / (max_level − 1)) ^ exponent).
   */
  wizebot_normalization: z
    .strictObject({
      version: z.number().int().min(1),
      exponent: z.number().min(0.1).max(1),
      max_level: z.number().int().min(1),
      target_max: z.number().int().min(2),
      applied_at: z.string(),
      /** The curve before the activation (its undo). */
      previous_curve: z.strictObject({
        curve_base: z.number(),
        curve_exponent: z.number(),
      }),
    })
    .nullable(),
});
export type ProgressionRules = z.infer<typeof ProgressionRulesSchema>;

export const DEFAULT_PROGRESSION_RULES: ProgressionRules = {
  xp_per_minute: 1,
  message_xp: 5,
  message_cooldown_s: 60,
  message_min_chars: 4,
  live_only: true,
  curve_base: 60,
  curve_exponent: 1.6,
  level_model: 'curve',
  level_up_notifications: false,
  level_up_sound_cooldown_s: 300,
  level_up_max_age_s: 120,
  wizebot_normalization: null,
  excluded_logins: [
    'lecroupier_',
    'viewerumobilu',
    'streamelements',
    'wizebot',
    'nightbot',
    'streamlabs',
  ],
};

export const ProgressionSettingsPatch = z.strictObject({
  enabled: z.boolean().optional(),
  // The level model and the normalization change only through the guarded Level Up V2 activation.
  rules: ProgressionRulesSchema.omit({
    level_model: true,
    wizebot_normalization: true,
  })
    .partial()
    .optional(),
});

/** Level Up V2: the normalization parameters chosen on the real data of 29/10/2026 (docs/PROGRESSION.md). */
export const LEVEL_V2 = {
  version: 1,
  xpPerLevel: 1000,
  exponent: 0.7,
  targetMax: 50,
} as const;

/** A viewer's level-up notification: none (default), written, or written with a short sound. */
export const LevelUpNotifyMode = z.enum(['off', 'text', 'sound']);
export type LevelUpNotifyMode = z.infer<typeof LevelUpNotifyMode>;

/** The extension's preferences: the 3-way mode; the first extension's boolean is still read (true = sound). */
export const ViewerPrefsRequest = z
  .strictObject({
    level_up_notify: LevelUpNotifyMode.optional(),
    level_up_sfx_opt_in: z.boolean().optional(),
  })
  .refine(
    (b) =>
      b.level_up_notify !== undefined || b.level_up_sfx_opt_in !== undefined,
    { message: 'empty' },
  );

/** Studio: switch every level to Level Up V2 — once, with a typed confirmation. */
export const LevelV2ActivateRequest = z.strictObject({
  confirm: z.literal('NORMALISER LES NIVEAUX'),
});

/** Studio's OBS level-up source: the next notifications to show. */
export const LevelUpClaimRequest = z.strictObject({
  consumer: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

export const RewardId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/);
export const RewardKind = z.enum(['title', 'badge']);
export const RewardRarity = z.enum([
  'common',
  'rare',
  'epic',
  'legendary',
  'event',
]);

export const ProgressionRewardInput = z.strictObject({
  reward_id: RewardId,
  kind: RewardKind,
  label: z.string().trim().min(1).max(60),
  description: z.string().max(200).default(''),
  rarity: RewardRarity.default('common'),
  category: z
    .string()
    .regex(/^[a-z0-9_-]{1,32}$/)
    .default('general'),
  /** Granted automatically to every viewer reaching this level (null: event / manual only). */
  unlock_level: z.number().int().min(1).max(10_000).nullable().default(null),
  active: z.boolean().default(true),
  sort: z.number().int().min(-1000).max(1000).default(0),
});

const TwitchId = z.string().regex(/^\d{1,32}$/);

/** Grant one reward to viewers (Studio, an event, a mini-game): idempotent per viewer and reward. */
export const ProgressionGrantRequest = z.strictObject({
  reward_id: RewardId,
  viewers: z.array(TwitchId).min(1).max(500),
  source: z.enum(['event', 'manual']).default('manual'),
  /** What it is for (« halloween-2026 », a round id…): kept with the grant. */
  reference: z.string().max(80).nullable().default(null),
});

export const ProgressionRevokeRequest = z.strictObject({
  reward_id: RewardId,
  viewer: TwitchId,
  reason: z.string().trim().min(1).max(200),
});

export const ProgressionEquipRequest = z.strictObject({
  viewer: TwitchId,
  title_id: RewardId.nullable(),
  badge_ids: z.array(RewardId).max(3),
});

/** One WizeBot viewer, by Twitch id when the source gives one, always under its pseudo (resolved by the Core). */
export const ProgressionHistoryRow = z.strictObject({
  twitch_user_id: TwitchId.nullable().default(null),
  /** wizebot: WizeBot's own user id (exact); legacy: a dated (id, pseudo) pair of the legacy site; ambiguous:
   *  the legacy data saw several holders of this pseudo (never attached by pseudo). */
  id_source: z
    .enum(['wizebot', 'legacy', 'ambiguous'])
    .nullable()
    .default(null),
  /** The pseudo in the source (lowercase): every row is kept under it, attached or not. */
  login: z.string().regex(/^[a-z0-9_]{1,25}$/),
  /** 1 when WizeBot has no level for this viewer (watchtime / messages only). */
  level: z.number().int().min(1).max(10_000),
  watch_seconds: z.number().int().min(0).max(10_000_000_000).default(0),
  messages: z.number().int().min(0).max(100_000_000).default(0),
});

/** WizeBot history sent as rows (tests, a manual file). */
export const ProgressionImportRequest = z.strictObject({
  source: z.literal('wizebot'),
  /** Count only, write nothing. */
  dry_run: z.boolean().default(false),
  /** When the source was read (default: now). */
  measured_at: z.string().datetime().nullable().default(null),
  rows: z.array(ProgressionHistoryRow).max(20_000),
});

/** raptoru.fr's WizeBot export (GET /api/wizebot?export=1), read by the Core itself: the whole reading at once. */
export const WizebotExport = z.object({
  measured_at: z.string().datetime(),
  rows: z.array(ProgressionHistoryRow).max(20_000),
});

/** Studio: read WizeBot (through raptoru.fr) and import, or simulate. */
export const ProgressionWizebotImportRequest = z.strictObject({
  dry_run: z.boolean().default(false),
});

/** Studio: attach the stored rows still waiting (no new reading). */
export const ProgressionResolveRequest = z.strictObject({
  source: z.literal('wizebot').default('wizebot'),
  dry_run: z.boolean().default(false),
});

/** Studio: attach one waiting WizeBot row to a viewer (a human decision, journaled). */
export const ProgressionAttachRequest = z.strictObject({
  source: z.literal('wizebot').default('wizebot'),
  login: z.string().regex(/^[a-z0-9_]{1,25}$/),
  viewer: TwitchId,
  reason: z.string().trim().min(3).max(200),
});

/** Studio: add / remove XP, or set the XP or the level of one viewer — always with a reason (journaled). */
export const ProgressionAdjustRequest = z.strictObject({
  viewer: TwitchId,
  mode: z.enum(['add', 'remove', 'set_xp', 'set_level']),
  value: z.number().int().min(0).max(100_000_000),
  reason: z.string().trim().min(3).max(200),
  /** One id per click: a repeated request is the same adjustment. */
  request_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
