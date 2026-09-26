import { z } from 'zod';
import { Viewer } from './daily.js';
import { CurrencyId } from './wallet.js';

// Loyalty Engine: turns business events (validated presence, Twitch subs/bits/follows, tips) into
// computed rewards. Explicit structured configuration only: no rule engine, no expressions.

export const SubTier = z.enum(['t1', 't2', 't3']);
export type SubTier = z.infer<typeof SubTier>;

/** Resolved economic status of a viewer: `unknown` is never silently treated as `none`. */
export type TierStatus = SubTier | 'none' | 'unknown';

const Bracket = z.object({
  /** 1-based unit number where this bracket starts (e.g. bit #500, cent #500). */
  from: z.number().int().min(1),
  /** Reward per 100 units (e.g. Jetons per 100 bits, Jetons per €). */
  per100: z.number().min(0),
});

const Brackets = z
  .array(Bracket)
  .min(1)
  .refine((b) => b[0]!.from === 1, { message: 'first bracket must start at 1' })
  .refine((b) => b.every((x, i) => i === 0 || x.from > b[i - 1]!.from), {
    message: 'brackets must be sorted by from',
  });

export const LoyaltyConfig = z.object({
  currencyId: CurrencyId,
  passive: z.object({
    intervalMinutes: z.number().int().min(1).max(120),
    baseAmount: z.number().min(0),
    /** Passive-only multipliers. Never applied implicitly to any other source. */
    tierMultipliers: z.object({
      none: z.number().positive(),
      t1: z.number().positive(),
      t2: z.number().positive(),
      t3: z.number().positive(),
    }),
  }),
  /** One-off sub/resub reward, never multiplied by the passive rate. */
  sub: z.object({
    t1: z.number().min(0),
    t2: z.number().min(0),
    t3: z.number().min(0),
  }),
  subgift: z.object({
    /** Bonus by number of subs gifted in one action (highest reached threshold applies). */
    bonusTiers: z
      .array(
        z.object({
          minGifts: z.number().int().min(1),
          bonusPercent: z.number().min(0),
        }),
      )
      .refine(
        (t) => t.every((x, i) => i === 0 || x.minGifts > t[i - 1]!.minGifts),
        {
          message: 'bonus tiers must be sorted by minGifts',
        },
      ),
  }),
  /** Progressive brackets per bit (per100 = Jetons per 100 bits). */
  bits: z.object({ brackets: Brackets }),
  /** Progressive brackets per euro cent (per100 = Jetons per €). */
  tips: z.object({ brackets: Brackets }),
  follow: z.object({ amount: z.number().int().min(0) }),
});
export type LoyaltyConfig = z.infer<typeof LoyaltyConfig>;

// --- events forwarded by twitch-bot (or a future tip provider) --------------------------------

const EventId = z.string().min(1).max(128);

export const LoyaltyEvent = z.discriminatedUnion('type', [
  /** New subscription (channel.subscribe). Gift recipients arrive with isGift=true. */
  z.object({
    type: z.literal('sub'),
    eventId: EventId,
    viewer: Viewer,
    tier: SubTier,
    isGift: z.boolean(),
  }),
  /** Resubscription message (channel.subscription.message). */
  z.object({
    type: z.literal('resub'),
    eventId: EventId,
    viewer: Viewer,
    tier: SubTier,
  }),
  /** One gifting action (channel.subscription.gift): `gifter` null when anonymous. */
  z.object({
    type: z.literal('subgift'),
    eventId: EventId,
    gifter: Viewer.nullable(),
    tier: SubTier,
    count: z.number().int().min(1).max(1000),
  }),
  z.object({
    type: z.literal('subscription_end'),
    eventId: EventId,
    viewer: Viewer,
  }),
  z.object({
    type: z.literal('bits'),
    eventId: EventId,
    viewer: Viewer.nullable(),
    bits: z.number().int().min(1),
  }),
  z.object({ type: z.literal('follow'), eventId: EventId, viewer: Viewer }),
  /** Contract only: no tip provider is connected yet. */
  z.object({
    type: z.literal('tip'),
    eventId: EventId,
    viewer: Viewer.nullable(),
    amountCents: z.number().int().min(1),
    currency: z.literal('EUR'),
    provider: z.string().min(1).max(40),
  }),
]);
export type LoyaltyEvent = z.infer<typeof LoyaltyEvent>;

export const LoyaltyEventResponse = z.object({
  rewardId: z.number().int().nullable(),
  status: z.enum([
    'preview',
    'pending',
    'credited',
    'excluded',
    'tier_unknown',
    'rejected',
    'skipped',
  ]),
  amount: z.number().int().nullable(),
  replayed: z.boolean(),
  reason: z.string().nullable(),
});
export type LoyaltyEventResponse = z.infer<typeof LoyaltyEventResponse>;

/** Complete list of current subscribers (Get Broadcaster Subscriptions, all pages). */
export const SubscriptionSnapshot = z.object({
  fetchedAt: z.iso.datetime({ offset: true }),
  subscribers: z
    .array(z.object({ viewer: Viewer, tier: SubTier, isGift: z.boolean() }))
    .max(100_000),
});
export type SubscriptionSnapshot = z.infer<typeof SubscriptionSnapshot>;
