import { z } from 'zod';
import { EffectSoundId, EffectVolume } from './effects.js';
import { SoundLabSoundId } from './sound-lab.js';

// Points de chaîne V1 (17/10/2026) — Twitch channel points custom rewards → Core rules → typed, allow-listed actions.
// Twitch identifiers are the stable keys (never a reward title). Raptoru only READS the redemptions: Twitch lets only
// the app that created a reward fulfil / cancel its redemptions, and the existing rewards were not created by
// Raptoru (docs/CHANNEL_POINTS_V1.md). Every text field is untrusted viewer data.

const ChannelId = z.string().regex(/^\d{1,32}$/);
const TwitchId = z.string().regex(/^\d{1,32}$/);
/** Twitch reward / redemption ids (UUIDs in practice; not assumed). */
const ExternalId = z.string().regex(/^[A-Za-z0-9-]{1,128}$/);
/** An OBS scene, source or filter name (as typed in OBS). */
const ObsName = z.string().trim().min(1).max(256);
/** A temporary action is reverted after this long (only if nobody changed it meanwhile). */
const DurationMs = z.number().int().min(500).max(600_000);

/** The allow-list of V1 actions. Nothing else can ever be executed (no script, no system command). */
export const CpAction = z.discriminatedUnion('type', [
  /** A Soundboard sound, through the Soundboard queue and player (paid by the channel points). */
  z.strictObject({ type: z.literal('sound'), sound_id: SoundLabSoundId }),
  /** An effect sound, played at once by Studio's effects player (outside the Soundboard: no queue, price, cooldown). */
  z.strictObject({
    type: z.literal('effect_sound'),
    sound_id: EffectSoundId,
    volume: EffectVolume,
  }),
  /** Show or hide one source of one scene; optionally for a while. */
  z.strictObject({
    type: z.literal('obs_source'),
    scene: ObsName,
    source: ObsName,
    visible: z.boolean(),
    duration_ms: DurationMs.optional(),
  }),
  /** Enable or disable one filter of one source; optionally for a while. */
  z.strictObject({
    type: z.literal('obs_filter'),
    source: ObsName,
    filter: ObsName,
    enabled: z.boolean(),
    duration_ms: DurationMs.optional(),
  }),
  /** Switch the program scene (explicitly configured only). */
  z.strictObject({ type: z.literal('obs_scene'), scene: ObsName }),
]);
export type CpAction = z.infer<typeof CpAction>;
export const CP_MAX_ACTIONS = 5;

/** A rule: one Twitch reward → up to 5 actions, run in order. */
export const CpRuleInput = z.strictObject({
  enabled: z.boolean(),
  actions: z.array(CpAction).min(1).max(CP_MAX_ACTIONS),
  /** Optimistic concurrency: the version the editor started from (absent = new rule). */
  expected_version: z.number().int().min(1).optional(),
});
export type CpRuleInput = z.infer<typeof CpRuleInput>;

/** One redemption, normalized by the bot (or a Studio test). */
export const CpRedemptionInput = z.strictObject({
  channel_id: ChannelId,
  source: z.enum(['twitch', 'simulation']),
  /** Twitch redemption id: the idempotency key. */
  redemption_id: ExternalId,
  reward: z.strictObject({
    id: ExternalId,
    title: z.string().min(1).max(200),
    cost: z.number().int().min(0).max(100_000_000),
    prompt: z.string().max(500).optional(),
  }),
  user: z.strictObject({
    id: TwitchId,
    login: z.string().min(1).max(64),
    display_name: z.string().min(1).max(64),
  }),
  user_input: z.string().max(500).optional(),
  /** Twitch status at reception (unfulfilled, fulfilled when the reward skips the queue…). */
  twitch_status: z
    .enum(['unknown', 'unfulfilled', 'fulfilled', 'canceled'])
    .optional(),
  redeemed_at: z.iso.datetime({ offset: true }),
});
export type CpRedemptionInput = z.infer<typeof CpRedemptionInput>;

/** The broadcaster's custom rewards as Twitch lists them (Get Custom Reward, read only). */
export const CpRewardsSync = z.strictObject({
  channel_id: ChannelId,
  rewards: z
    .array(
      z.strictObject({
        id: ExternalId,
        title: z.string().min(1).max(200),
        cost: z.number().int().min(0).max(100_000_000),
        prompt: z.string().max(500).optional(),
        is_enabled: z.boolean(),
        is_paused: z.boolean().optional(),
        user_input_required: z.boolean().optional(),
      }),
    )
    .max(50),
});
export type CpRewardsSync = z.infer<typeof CpRewardsSync>;

export const CpSettingsInput = z.strictObject({ enabled: z.boolean() });

export const CpClaimRequest = z.strictObject({
  consumer_id: z.string().min(1).max(64),
});

/** Result of one action of a job (Studio executor). */
export const CpActionResult = z.strictObject({
  index: z
    .number()
    .int()
    .min(0)
    .max(CP_MAX_ACTIONS - 1),
  ok: z.boolean(),
  error: z.string().max(200).optional(),
  /** Effect actions: the player started it (ok) — still pending until its end is reported (CpEffectReport). */
  playing: z.literal(true).optional(),
});
export type CpActionResult = z.infer<typeof CpActionResult>;

/** Studio's report of the end of an effect it started for a job (after the job's own `completed`). */
export const CpEffectReport = z.strictObject({
  consumer_id: z.string().min(1).max(64),
  index: z
    .number()
    .int()
    .min(0)
    .max(CP_MAX_ACTIONS - 1),
  /** completed: the player played it to the end · failed: stopped by an error · unknown: no end reported. */
  event: z.enum(['completed', 'failed', 'unknown']),
  error: z.string().max(200).optional(),
});
export type CpEffectReport = z.infer<typeof CpEffectReport>;

export const CpAckRequest = z.strictObject({
  consumer_id: z.string().min(1).max(64),
  attempt_id: z.uuid(),
  event: z.enum(['started', 'completed', 'failed']),
  results: z.array(CpActionResult).max(CP_MAX_ACTIONS).optional(),
  error: z.string().max(200).optional(),
});
export type CpAckRequest = z.infer<typeof CpAckRequest>;

/** What Core did with a redemption. */
export type CpRedemptionStatus =
  'ignored' | 'pending' | 'done' | 'partial' | 'failed';
