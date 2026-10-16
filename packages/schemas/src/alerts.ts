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
});
export type AlertEventInput = z.infer<typeof AlertEventInput>;

export type AlertStatus =
  'queued' | 'claimed' | 'playing' | 'completed' | 'failed' | 'expired';

/** What Core did with an event. */
export type AlertEventOutcome =
  'queued' | 'duplicate' | 'absorbed' | 'below_threshold';

export const AlertClaimRequest = z.strictObject({
  consumer_id: z.string().min(1).max(64),
});

export const AlertAckRequest = z.strictObject({
  consumer_id: z.string().min(1).max(64),
  attempt_id: z.uuid(),
  event: z.enum(['started', 'completed', 'failed']),
  error: z.string().max(200).optional(),
});
export type AlertAckRequest = z.infer<typeof AlertAckRequest>;
