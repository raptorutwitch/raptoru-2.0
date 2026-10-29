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
  rules: ProgressionRulesSchema.partial().optional(),
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

/** WizeBot history: one row per viewer, by Twitch id when known, else by login (resolved by the Core). */
export const ProgressionImportRequest = z.strictObject({
  source: z.literal('wizebot'),
  /** Count only, write nothing. */
  dry_run: z.boolean().default(false),
  rows: z
    .array(
      z.strictObject({
        twitch_user_id: TwitchId.nullable().default(null),
        login: z
          .string()
          .regex(/^[a-z0-9_]{1,25}$/)
          .nullable()
          .default(null),
        level: z.number().int().min(1).max(10_000),
        watch_seconds: z.number().int().min(0).max(10_000_000_000).default(0),
        messages: z.number().int().min(0).max(100_000_000).default(0),
      }),
    )
    .min(1)
    .max(10_000),
});
