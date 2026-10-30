import { z } from 'zod';

// Twitch alerts V1 (Lab) — the normalized event contract (docs/TWITCH_ALERTS_PARITY_2026-10.md). The Twitch Bot
// (single EventSub consumer), a future donation provider adapter or the Studio simulator post these events; Core
// deduplicates them, picks the legacy variant and queues ONE alert. Every text field is untrusted viewer data
// (escape it when displayed). Alerts never touch the economy.

export const ALERT_TYPES = [
  'follow',
  'sub',
  'resub',
  /** A gift to one viewer (not part of a community gift). */
  'gift_targeted',
  /** A community gift (one alert for the whole batch). */
  'gift_community',
  /** One recipient of a community gift (absorbed: never an alert of its own). */
  'gift_recipient',
  'bits',
  'raid',
  'donation',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/**
 * Alert families (17/10/2026): one FIFO queue each, one alert playing per family, families play side by side. Sub and
 * gifts share `subscription` (a gift never plays over a sub). The order is also the stacking order of the OBS source,
 * bottom to top (visual only, never a queue priority).
 */
export const ALERT_FAMILIES = [
  'follow',
  'subscription',
  'bits',
  'donation',
  'raid',
] as const;
export type AlertFamily = (typeof ALERT_FAMILIES)[number];

/** The family of an event type (never of a variant or a video). */
export function alertFamilyOf(type: AlertType): AlertFamily {
  switch (type) {
    case 'follow':
      return 'follow';
    case 'sub':
    case 'resub':
    case 'gift_targeted':
    case 'gift_community':
    case 'gift_recipient':
      return 'subscription';
    case 'bits':
    case 'raid':
    case 'donation':
      return type;
  }
}

const Name = z.string().trim().min(1).max(64);
const Person = z.strictObject({
  id: z
    .string()
    .regex(/^\d{1,32}$/)
    .optional(),
  login: z.string().max(64).optional(),
  display_name: Name,
});

export const AlertEventInput = z.strictObject({
  channel_id: z.string().regex(/^\d{1,32}$/),
  source: z.enum(['twitch', 'external', 'simulation']),
  /** Stable id of the source event (EventSub message id, donation id…): the idempotency key. */
  source_event_id: z.string().min(1).max(128),
  type: z.enum(ALERT_TYPES),
  occurred_at: z.iso.datetime().optional(),
  /** The follower, subscriber, gifter, cheerer, raider or donor. Absent when anonymous. */
  actor: Person.optional(),
  /** Twitch did not give the gifter / donor identity. */
  anonymous: z.boolean().optional(),
  /** A targeted gift's recipient. */
  recipient: Person.optional(),
  /** Gifts in a community gift. */
  count: z.number().int().min(1).max(10_000).optional(),
  /** Links a recipient to its community gift (Twitch `community_gift_id` / community `id`). */
  community_gift_id: z.string().min(1).max(128).optional(),
  tier: z.enum(['1000', '2000', '3000', 'prime']).optional(),
  months: z.number().int().min(0).max(1000).optional(),
  bits: z.number().int().min(1).max(10_000_000).optional(),
  viewers: z.number().int().min(0).max(10_000_000).optional(),
  /** Donation amount in minor units (value / 10^decimal_place). */
  amount: z
    .strictObject({
      value: z.number().int().min(0),
      decimal_place: z.number().int().min(0).max(6),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .optional(),
  provider: z.string().max(32).optional(),
  message: z.string().max(500).optional(),
  /**
   * Studio's tests only (`source: simulation`, ignored otherwise): play this simulated event with the Halloween alert
   * profile while the channel's profile stays as it is (docs/HALLOWEEN.md § 14).
   */
  test_profile: z.literal('halloween').optional(),
});
export type AlertEventInput = z.infer<typeof AlertEventInput>;

export type AlertStatus =
  'queued' | 'claimed' | 'playing' | 'completed' | 'failed' | 'expired';

/** What Core did with an event. */
export type AlertEventOutcome =
  'queued' | 'duplicate' | 'absorbed' | 'below_threshold';

/**
 * Lot 9: the production bot's alerts reception, reported to the main Core (at each EventSub (re)connection and every
 * minute) so Studio can show it. Its mode is the bot's ALERTS_MODE (set on the bot, never from Studio).
 */
export const AlertReceptionReport = z.strictObject({
  channel_id: z.string().regex(/^\d{1,32}$/),
  mode: z.enum(['off', 'test', 'active']),
  /** EventSub alert subscriptions created on the bot's last connection / refused by Twitch. */
  subscriptions: z.array(z.string().max(64)).max(10),
  refused: z.array(z.string().max(64)).max(10),
  /** Alerts kept in the bot's outbox, not yet acknowledged by Core. */
  pending: z.number().int().min(0).max(1_000_000),
});
export type AlertReceptionReport = z.infer<typeof AlertReceptionReport>;

export const AlertClaimRequest = z.strictObject({
  consumer_id: z.string().min(1).max(64),
});

export const AlertAckRequest = z.strictObject({
  consumer_id: z.string().min(1).max(64),
  attempt_id: z.uuid(),
  event: z.enum(['started', 'completed', 'failed']),
  error: z.string().max(200).optional(),
  /** The family the player played it in: checked against the alert when given. */
  family: z.enum(ALERT_FAMILIES).optional(),
});
export type AlertAckRequest = z.infer<typeof AlertAckRequest>;
