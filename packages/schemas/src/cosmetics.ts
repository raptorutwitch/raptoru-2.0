import { z } from 'zod';

// Boutique cosmétique V1 (docs/COSMETIC_SHOP.md): the titles and badges of the progression, given a look, sold by
// offers (Jetons or Bonbons), bought on raptoru.fr, awarded by modules. Every look is DATA checked here — colours and
// a preset effect — never CSS, HTML or script typed by a person.

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Key = z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/);
const RewardId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/);
const TwitchId = z.string().regex(/^\d{1,32}$/);

/** The preset effects (the Core's stylesheet defines them; nothing else can be drawn). */
export const COSMETIC_EFFECTS = [
  'none',
  'glow',
  'shine',
  'pulse',
  'rainbow',
  'sparkle',
] as const;

export const CosmeticStyle = z.strictObject({
  /** Text colour (a title) or ring colour (a badge). */
  color: Hex.nullable().default(null),
  /** A two-colour gradient over the text, at an angle. */
  gradient: z
    .strictObject({
      from: Hex,
      to: Hex,
      angle: z.number().int().min(0).max(360).default(90),
    })
    .nullable()
    .default(null),
  effect: z.enum(COSMETIC_EFFECTS).default('none'),
  weight: z.enum(['normal', 'bold']).default('bold'),
});
export type CosmeticStyle = z.infer<typeof CosmeticStyle>;

export const COSMETIC_STATUSES = [
  'draft',
  'published',
  'hidden',
  'archived',
] as const;

/** Studio's editor: one title or badge (its id is fixed once it left the draft state). */
export const CosmeticItemInput = z.strictObject({
  reward_id: RewardId,
  kind: z.enum(['title', 'badge']),
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).default(''),
  rarity: z
    .enum(['common', 'rare', 'epic', 'legendary', 'event'])
    .default('common'),
  category: z
    .string()
    .regex(/^[a-z0-9_-]{1,32}$/)
    .default('general'),
  unlock_level: z.number().int().min(1).max(10_000).nullable().default(null),
  sort: z.number().int().min(-1000).max(1000).default(0),
  status: z.enum(COSMETIC_STATUSES).default('draft'),
  style: CosmeticStyle.default({
    color: null,
    gradient: null,
    effect: 'none',
    weight: 'bold',
  }),
  /** A badge's image (an id returned by the upload); null: the badge shows its label only. */
  image_id: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .default(null),
  event_key: Key.nullable().default(null),
});
export type CosmeticItemInput = z.infer<typeof CosmeticItemInput>;

/** A draft's new id (never once it was published), or a copy of any item as a new draft. */
export const CosmeticRenameRequest = z.strictObject({ to: RewardId });
export const CosmeticDuplicateRequest = z.strictObject({
  to: RewardId,
  label: z.string().trim().min(1).max(60).optional(),
});

/** A badge image: PNG or still WebP, ≤ 40 Ko, ≤ 128 × 128 (checked again by the Core on the bytes). */
export const CosmeticImageUpload = z.strictObject({
  data_base64: z.string().min(16).max(56_000),
});

/** How an item is sold. Publication (the item), visibility (its status) and sale (this offer) are separate. */
export const CosmeticOfferInput = z.strictObject({
  offer_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  reward_id: RewardId,
  currency: z.enum(['main', 'bonbons']),
  price: z.number().int().min(1).max(100_000_000),
  enabled: z.boolean().default(false),
  /** ISO 8601 with its offset (Studio sends Europe/Paris times); null: no limit. */
  opens_at: z.iso.datetime({ offset: true }).nullable().default(null),
  closes_at: z.iso.datetime({ offset: true }).nullable().default(null),
  /** Sold only while this event is open (the event shop of that season). */
  event_key: Key.nullable().default(null),
  sort: z.number().int().min(-1000).max(1000).default(0),
});
export type CosmeticOfferInput = z.infer<typeof CosmeticOfferInput>;

/** raptoru.fr → Core (site token): the SIGNED-IN viewer buys one offer. Price and balance are the Core's own. */
export const CosmeticPurchaseRequest = z.strictObject({
  viewer: TwitchId,
  viewer_name: z.string().trim().min(1).max(64),
  offer_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  /** One per click: a double click or a replay is the same purchase. */
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
});

export const CosmeticRefundRequest = z.strictObject({
  reason: z.string().trim().min(3).max(200),
});

/**
 * A module's reward (a mini-game, an event, Studio): one item, Bonbons or Jetons, once per key. The stable contract
 * future modules use — nothing in the shop changes to plug one in.
 */
export const CosmeticAwardRequest = z.strictObject({
  module: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
  /** The module's own key (a round, a match…): the same key never awards twice. */
  key: z.string().min(3).max(120),
  viewer: TwitchId,
  viewer_name: z.string().trim().min(1).max(64),
  item: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('reward'), reward_id: RewardId }),
    z.strictObject({
      kind: z.literal('bonbons'),
      amount: z.number().int().min(1).max(100_000),
    }),
    z.strictObject({
      kind: z.literal('jetons'),
      amount: z.number().int().min(1).max(1_000_000),
    }),
  ]),
  reference: z.string().max(80).nullable().default(null),
});
export type CosmeticAwardRequest = z.infer<typeof CosmeticAwardRequest>;
