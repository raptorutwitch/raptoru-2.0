import { z } from 'zod';

// Boutique d'événement (Halloween 2026, docs/HALLOWEEN.md): viewers spend the event currency (Bonbons) on effects that
// Studio's overlay plays on the streamer's own screen (a screamer video with its sound, an apparition, a drawn effect).
// The Core decides everything (catalogue, prices, limits, balances); Studio only plays what it claimed. The event
// currency has its own ledger (never the Jetons Wallet); the capped conversion is the only bridge with the Jetons.

const Id = z.string().regex(/^\d+$/).max(32);
const Key = z.string().min(1).max(128);
const Instance = z.string().min(1).max(64);
const Viewer = z.strictObject({
  id: Id,
  display_name: z.string().min(1).max(64),
});
export const EventSeason = z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/);
export const EventItemId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/** Effects the overlay draws itself (no media). */
export const EVENT_EFFECTS = [
  'blink',
  'fog',
  'glitch',
  'tunnel',
  'eyes',
  'silhouette',
  // Chaos (screen): the game window captured and redrawn flipped / blurred over itself (docs/HALLOWEEN.md § 4 bis).
  'flip',
  'blur',
] as const;
export const EventEffect = z.enum(EVENT_EFFECTS);
export type EventEffect = z.infer<typeof EventEffect>;

/**
 * - screamer: a sudden video with its sound (one at a time, the rarest and dearest);
 * - apparition: something crosses or shows up (a video, sometimes silent);
 * - effect: drawn by the overlay (blink, fog…).
 */
export const EventItemKind = z.enum(['screamer', 'apparition', 'effect']);
export type EventItemKind = z.infer<typeof EventItemKind>;

/** The event's rules (Studio): earning, conversion, and the limits that keep the stream playable. */
const BallonPool = z.array(z.number().int().min(1).max(4)).min(1).max(4);

export const EventShopRules = z.strictObject({
  /**
   * REMOVED 30/10 (Antoni: the Jetons → Bonbons exchange is abandoned): kept only so that saved rules still read;
   * the Core never converts any more, whatever these say.
   */
  conversion_rate: z.number().int().min(1).max(1_000_000),
  conversion_cap_per_hour: z.number().int().min(0).max(10_000),
  /** Bonbons for a sub (the subscriber; also Prime / resub while those are null). */
  sub_reward: z.number().int().min(0).max(10_000),
  /** Bonbons for a Prime sub; null = the sub's amount. */
  prime_reward: z.number().int().min(0).max(10_000).nullable(),
  /** Bonbons for a resub (its chat message); null = the sub's amount. */
  resub_reward: z.number().int().min(0).max(10_000).nullable(),
  /**
   * Presence (30/10): `presence_bonbons` Bonbons for every `presence_every_min` minutes of VALIDATED watching (the
   * presence tracker's intervals, the same as the Jetons'); 0 = off. Counted per viewer over the season.
   */
  presence_every_min: z.number().int().min(0).max(1440),
  presence_bonbons: z.number().int().min(1).max(10_000),
  /** Bits (Twitch cheer events only): `bits_bonbons` Bonbons per full `bits_step` Bits; 0 = off. */
  bits_step: z.number().int().min(0).max(1_000_000),
  bits_bonbons: z.number().int().min(1).max(10_000),
  /**
   * Donations (StreamElements tips relayed by Studio in « active » mode): Bonbons per whole euro, euros only, from
   * `donation_min_cents`; the donor is the viewer whose Twitch name is EXACTLY the tip's name. 0 = off.
   */
  donation_per_euro: z.number().int().min(0).max(10_000),
  donation_min_cents: z.number().int().min(0).max(1_000_000),
  /** Bonbons for the giver, per gifted sub (targeted or community gift; an anonymous gift pays nobody). */
  gift_giver_per_sub: z.number().int().min(0).max(10_000),
  /** Bonbons for each recipient of a gifted sub. */
  gift_recipient: z.number().int().min(0).max(10_000),
  /** A viewer waits this long between two purchases. */
  viewer_gap_ms: z.number().int().min(0).max(3_600_000),
  /** Two screamers (whoever buys them) are at least this far apart. */
  screamer_gap_ms: z.number().int().min(0).max(3_600_000),
  /** 31/10: between two screamers bought by the SAME viewer (any screamer). 0 = off (only viewer_gap_ms applies). */
  viewer_screamer_gap_ms: z.number().int().min(0).max(86_400_000),
  /** At most this many screamers within any rolling hour (0 = screamers closed). */
  screamers_per_hour: z.number().int().min(0).max(120),
  /**
   * The OBS dock shows a Halloween purchase this long AFTER it started on the streamer's screen (he lives the scare
   * before he sees who sent it); 0 = as soon as it starts. Never before it starts.
   */
  dock_reveal_ms: z.number().int().min(0).max(600_000),
  /**
   * Who sees « Événements » in the Extension: everyone, or only the listed testers (Twitch ids) — a progressive opening
   * with the published Extension (Hosted Test would hide the Extension from everybody else on the live channel). The
   * chat commands and the Bonbons rewards stay open to all.
   */
  extension_audience: z.enum(['all', 'testers']),
  extension_testers: z.array(z.string().regex(/^\d{1,32}$/)).max(500),
  /**
   * Halloween alert profile (30/10): Twitch alerts take their Halloween variants (Miss Minute follow, Ballon sub /
   * Prime / resub, Jerry gifts) instead of the usual ones; off = the usual alerts, untouched. Independent of the shop
   * being open. A Halloween variant whose media Studio lacks plays the usual one.
   */
  halloween_alerts: z.boolean(),
  /** Which of the 4 Ballon animations each event may draw (equal chances among the chosen ones). */
  halloween_ballon: z.strictObject({
    sub: BallonPool,
    prime: BallonPool,
    resub: BallonPool,
  }),
});
export type EventShopRules = z.infer<typeof EventShopRules>;

export const DEFAULT_EVENT_RULES: EventShopRules = Object.freeze({
  conversion_rate: 1000,
  conversion_cap_per_hour: 0,
  sub_reward: 10,
  prime_reward: null,
  resub_reward: null,
  presence_every_min: 0,
  presence_bonbons: 1,
  bits_step: 0,
  bits_bonbons: 1,
  donation_per_euro: 0,
  donation_min_cents: 100,
  gift_giver_per_sub: 5,
  gift_recipient: 3,
  viewer_gap_ms: 120_000,
  screamer_gap_ms: 180_000,
  viewer_screamer_gap_ms: 0,
  screamers_per_hour: 6,
  dock_reveal_ms: 5_000,
  extension_audience: 'all',
  extension_testers: [],
  halloween_alerts: false,
  halloween_ballon: {
    sub: [1, 2, 3, 4],
    prime: [1, 2, 3, 4],
    resub: [1, 2, 3, 4],
  },
});

export const EventShopSettings = z.strictObject({
  season: EventSeason,
  /** Event open: viewers see the shop, earn and spend. Closed: nothing is earned or spent (balances kept). */
  enabled: z.boolean(),
  rules: EventShopRules,
});
export type EventShopSettings = z.infer<typeof EventShopSettings>;

export const EventShopItem = z.strictObject({
  item_id: EventItemId,
  kind: EventItemKind,
  media_id: EventItemId.nullable(),
  effect: EventEffect.nullable(),
  label: z.string().min(1).max(40),
  description: z.string().max(120),
  price: z.number().int().min(1).max(100_000),
  cooldown_ms: z.number().int().min(0).max(86_400_000),
  enabled: z.boolean(),
  sort: z.number().int().min(-10_000).max(10_000),
  /** Effect parameters (duration, intensity…), checked by the overlay against its own limits. */
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
});
export type EventShopItem = z.infer<typeof EventShopItem>;

/** What Studio may change on an item (the id, kind and media / effect are fixed). */
export const EventShopItemUpdate = EventShopItem.pick({
  label: true,
  description: true,
  price: true,
  cooldown_ms: true,
  enabled: true,
  sort: true,
  params: true,
}).partial();
export type EventShopItemUpdate = z.infer<typeof EventShopItemUpdate>;

/** A purchase (the extension, through the Core frontier: the viewer is the JWT's). */
export const EventShopPurchaseRequest = z.strictObject({
  idempotency_key: Key,
  channel_id: Id,
  viewer: Viewer,
  item_id: EventItemId,
  /** `extension`: from the Extension (its audience applies); absent: the chat. */
  via: z.enum(['extension']).optional(),
});
export type EventShopPurchaseRequest = z.infer<typeof EventShopPurchaseRequest>;

/** Jetons → Bonbons, capped per viewer and rolling hour. */
export const EventShopConvertRequest = z.strictObject({
  idempotency_key: Key,
  channel_id: Id,
  viewer: Viewer,
  bonbons: z.number().int().min(1).max(10_000),
  via: z.enum(['extension']).optional(),
});
export type EventShopConvertRequest = z.infer<typeof EventShopConvertRequest>;

/** Studio: give or take Bonbons by hand (Tombola winners, a gesture, a correction). Never below 0. */
export const EventShopGrantRequest = z.strictObject({
  /** One key per click: a retried request never moves twice. */
  idempotency_key: z.uuid(),
  channel_id: Id,
  /** The viewer's Twitch login or display name (as the streamer types it), or their id. */
  viewer: z.string().min(1).max(64),
  amount: z
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((n) => n !== 0, 'amount must not be 0'),
  reason: z.enum(['grant', 'raffle']),
  note: z.string().max(200).optional(),
});
export type EventShopGrantRequest = z.infer<typeof EventShopGrantRequest>;

// --- Studio's executor (the overlay engine) ------------------------------------------------------------------------

export const EventShopHeartbeat = z.strictObject({
  studio_instance_id: Instance,
  channel_id: Id,
  /** The overlay is up on a screen and answers: purchases can be admitted. */
  engine_ready: z.boolean(),
  /** Media ids Studio holds (an item whose media is missing is not sold). */
  media: z.array(EventItemId).max(500),
});
export type EventShopHeartbeat = z.infer<typeof EventShopHeartbeat>;

export const EventShopClaimRequest = z.strictObject({
  studio_instance_id: Instance,
  channel_id: Id,
});
export type EventShopClaimRequest = z.infer<typeof EventShopClaimRequest>;

export const EventShopAckRequest = z.strictObject({
  studio_instance_id: Instance,
  attempt_id: z.uuid(),
  event: z.enum(['started', 'completed', 'failed']),
  /** `failed`: whether the play had started (started → no refund: it was probably seen). */
  started: z.boolean().optional(),
  error: z.string().max(120).optional(),
});
export type EventShopAckRequest = z.infer<typeof EventShopAckRequest>;

export const EventPurchaseStatus = z.enum([
  'queued',
  'executing',
  'completed',
  'failed',
  'unknown',
]);
export type EventPurchaseStatus = z.infer<typeof EventPurchaseStatus>;
