import { z } from 'zod';

// Roue du Sub (18/10/2026, docs/SUB_WHEEL.md) — the SAMMI button ID1 « Roue Sub » + the wheel of Alerte_system.html.
// Historical rules kept as they are (Antoni, 18/10/2026): a sub, a resub or a Prime sub, tiers 1 to 3, spins the wheel
// once (never a gift, targeted or community: SAMMI's sub trigger had them off); the wheel layout depends on the
// months, the segment is drawn uniformly, its value × its multiplier × the tier coefficient (T1 1, T2 2, T3 3) is the
// gain in Jetons. The gain is RECORDED (pending), never credited automatically: the economy is wired later.

/** The legacy `buildWheelLayout(months)`, values copied as they are (Alerte_system.html). */
export function subWheelLayout(months: number) {
  const m = Math.trunc(months) || 0;
  if (m >= 20)
    return [
      { val: 1000, mult: 1 },
      { val: 2000, mult: 1 },
      { val: 3000, mult: 1 },
      { val: 5000, mult: 2 },
      { val: 5000, mult: 1 },
      { val: 7500, mult: 2 },
      { val: 10000, mult: 1 },
      { val: 10000, mult: 3 },
      { val: 15000, mult: 2 },
      { val: 25000, mult: 1 },
      { val: 50000, mult: 1 },
      { val: 5000, mult: 5 },
    ];
  if (m >= 12)
    return [
      { val: 500, mult: 1 },
      { val: 750, mult: 1 },
      { val: 1000, mult: 1 },
      { val: 1500, mult: 2 },
      { val: 2000, mult: 1 },
      { val: 3000, mult: 1 },
      { val: 3000, mult: 2 },
      { val: 5000, mult: 1 },
      { val: 7500, mult: 1 },
      { val: 10000, mult: 1 },
      { val: 15000, mult: 1 },
      { val: 2000, mult: 3 },
    ];
  if (m >= 4)
    return [
      { val: 200, mult: 1 },
      { val: 300, mult: 1 },
      { val: 500, mult: 1 },
      { val: 750, mult: 1 },
      { val: 1000, mult: 1 },
      { val: 1500, mult: 1 },
      { val: 2000, mult: 1 },
      { val: 3000, mult: 1 },
      { val: 5000, mult: 1 },
      { val: 1500, mult: 2 },
    ];
  return [
    { val: 200, mult: 1 },
    { val: 300, mult: 1 },
    { val: 500, mult: 1 },
    { val: 750, mult: 1 },
    { val: 1000, mult: 1 },
    { val: 1500, mult: 1 },
    { val: 2000, mult: 1 },
    { val: 5000, mult: 1 },
  ];
}

/** Barème versions: 1 = the legacy SAMMI wheel (every draw made before V3, kept as it is), 3 = Roue du Sub V3. */
export const SW_GRIDS = [1, 3] as const;
export type SwGrid = (typeof SW_GRIDS)[number];

/**
 * Roue du Sub V3 (16/11/2026, docs/SUB_WHEEL_V3.md § 13): 12 parts of equal chance, FOUR amounts — 5 small, 3 medium,
 * 3 good, 1 jackpot — placed so that two equal amounts never touch. One tier every 3 months of CONFIRMED seniority
 * (1–3 months: tier 1, 4–6: tier 2…): the amounts of tier p are `base` × (p + 1) up to 60 months (tier 20), then a
 * quarter of that step per tier, rounded to the hundred. The Twitch tier multiplies the part afterwards (×1 / ×2 / ×3).
 */
export const SUB_WHEEL_V3 = {
  base: [1500, 2000, 2500, 3000] as const,
  /** The level of each part around the wheel: 0 small, 1 medium, 2 good, 3 jackpot (5 / 3 / 3 / 1). */
  pattern: [3, 0, 1, 0, 2, 0, 1, 0, 2, 1, 0, 2] as const,
  /** Up to this tier (60 months) a full step per tier; beyond, a quarter of it. */
  fullStepTiers: 20,
} as const;

/** The V3 tier of a seniority: 1–3 months → 1, 4–6 → 2… */
export const subWheelV3Tier = (months: number) =>
  Math.max(1, Math.ceil(Math.max(1, Math.trunc(months) || 1) / 3));

/** The four V3 amounts (small, medium, good, jackpot) of a seniority, before the Twitch tier. */
export function subWheelV3Amounts(months: number): number[] {
  const p = subWheelV3Tier(months);
  const full = SUB_WHEEL_V3.fullStepTiers;
  const factor = p <= full ? p + 1 : full + 1 + (p - full) / 4;
  return SUB_WHEEL_V3.base.map((b) => Math.round((b * factor) / 100) * 100);
}

export const SUB_WHEEL = {
  /** Legacy WHEEL_TIER_COEFS. */
  tierCoef: { 1: 1, 2: 2, 3: 3 } as Record<1 | 2 | 3, number>,
  /** The wheel starts once the sub alert ended (SAMMI waited 6 s after starting it); at the latest this long after. */
  afterAlertMaxMs: 20_000,
  /** An animation not shown within this delay is dropped (the gain stays recorded). */
  animationMaxAgeMs: 10 * 60_000,
  animationLeaseMs: 60_000,
  /**
   * A wheel never shown for sure (its player never started it) is shown again automatically — the same draw, nothing
   * credited again — at most this many times, the n-th not before retryBaseMs × 2^(n−1) (capped at retryMaxDelayMs).
   */
  retryMax: 5,
  /**
   * V3 seniority (§ 13.3): a right whose month is only ESTIMATED waits this long for a certain month (the resub share,
   * the chat badge) before an automatic draw; a right whose month is UNKNOWN (no history) is never drawn before it is
   * confirmed (chat badge, a later share, or Studio).
   */
  monthConfirmMs: 10 * 60_000,
  retryBaseMs: 15_000,
  retryMaxDelayMs: 5 * 60_000,
} as const;

/** The wheel of a barème: the legacy layout (grid 1) or the V3 parts (grid 3, each part's multiplier is 1). */
export function subWheelGrid(months: number, grid: SwGrid = 1) {
  if (grid !== 3) return subWheelLayout(months);
  const a = subWheelV3Amounts(months);
  return SUB_WHEEL_V3.pattern.map((level) => ({ val: a[level]!, mult: 1 }));
}

/** The gain of a segment (legacy: baseAmt = val × mult; amount = baseAmt × tier coefficient — the same in V3). */
export function subWheelAmount(
  months: number,
  tier: 1 | 2 | 3,
  segment: number,
  grid: SwGrid = 1,
) {
  const seg = subWheelGrid(months, grid)[segment];
  if (!seg) throw new Error('segment_out_of_range');
  return seg.val * seg.mult * SUB_WHEEL.tierCoef[tier];
}

/** Media of the wheel copied into Studio's effects storage (originals in the legacy overlay folder, untouched). */
export const SUB_WHEEL_MEDIA = [
  {
    id: 'sw-incr',
    label: 'Roue du Sub — incrémentation',
    file: 'Incrémentation Son.mp3',
  },
  {
    id: 'sw-fin',
    label: 'Roue du Sub — fin casino',
    file: 'Fin casino son.mp3',
  },
] as const;

export const SwStatus = z.enum([
  /** The wheel was off: recorded, nothing drawn, nothing owed. */
  'ignored',
  'queued',
  'playing',
  'shown',
  /** The animation could not be shown (the gain stays as recorded). */
  'failed',
  'skipped',
  /** V2 (docs/SUB_WHEEL_V2_PLAN.md): a right acquired, nothing drawn yet (kept until drawn; never expires). */
  'owed',
  /** V2: a manual draw asked (subWheelDraw), drawn by the next wheel before the automatic queue. */
  'requested',
  /** V2: absorbed by the right of the same certain month (never drawn). */
  'merged',
]);
export type SwStatus = z.infer<typeof SwStatus>;

/** Who draws: v1 (today) · v2_acquire (rights kept, V1 still draws) · v2 (V2 draws at display: lot R3). Broadcaster only. */
export const SwMode = z.enum(['v1', 'v2_acquire', 'v2']);
export type SwMode = z.infer<typeof SwMode>;
export const SwModeInput = z.strictObject({ mode: SwMode });

/**
 * The gain: pending (owed, never credited yet) · awarded (credited by an economy adapter, its reference) · manual
 * (credited by hand, noted) · cancelled · test (a Studio test: never attributable) · none (ignored).
 */
export const SwAwardStatus = z.enum([
  'none',
  'pending',
  'awarded',
  'manual',
  'cancelled',
  'test',
]);
export type SwAwardStatus = z.infer<typeof SwAwardStatus>;

export const SwSettingsInput = z.strictObject({ enabled: z.boolean() });

/** The barème of the draws from now on (the broadcaster, journaled): a right acquired before keeps the barème it had. */
export const SwGridInput = z.strictObject({
  grid: z.union([z.literal(1), z.literal(3)]),
});

/** Studio « Confirmer l'ancienneté »: the real cumulative months of a right whose month is not certain. */
export const SwMonthsConfirm = z.strictObject({
  months: z.number().int().min(1).max(1000),
  note: z.string().trim().min(1).max(200).optional(),
});

/** « Accorder un tour » (R3, subWheelGrant): a manual right. `key`: the same grant retried is the same right. */
export const SwGrantInput = z.strictObject({
  key: z.uuid(),
  /** Without its id: the pseudo is enough when the channel knows exactly one viewer by that login or name. */
  viewer: z.strictObject({
    id: z
      .string()
      .regex(/^\d{1,32}$/)
      .optional(),
    login: z.string().max(64).optional(),
    name: z.string().trim().min(1).max(64),
  }),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** The wheel shown (legacy layout of the months). */
  months: z.number().int().min(1).max(200),
  note: z.string().trim().min(1).max(200),
});
export type SwGrantInput = z.infer<typeof SwGrantInput>;

/** R9: natural invitations ON / OFF (broadcaster). */
export const SwInvitationsInput = z.strictObject({ enabled: z.boolean() });

/**
 * RV2-2 « Relancer un tirage » (the broadcaster, Studio): an exceptional NEW draw after the draw `spin_id`, paid on its
 * own. `key`: one per confirmation (a repeated click is the same new draw); `note`: why (kept in the history).
 */
export const SwRedrawInput = z.strictObject({
  key: z.uuid(),
  spin_id: z.uuid(),
  note: z.string().trim().min(1).max(200),
});
export type SwRedrawInput = z.infer<typeof SwRedrawInput>;

/** RV2-1: the winner announcement's delay after the end of the animation, in seconds (broadcaster). */
export const SwAnnounceDelayInput = z.strictObject({
  seconds: z.number().int().min(0).max(60),
});

/** Lab simulator (Lab Core only): simulated chatters readings and viewers present / absent. */
export const SwLabPresenceInput = z.strictObject({
  readings: z.boolean().optional(),
  viewers: z
    .array(
      z.strictObject({
        id: z.string().regex(/^\d{1,32}$/),
        name: z.string().trim().min(1).max(64),
        present: z.boolean(),
      }),
    )
    .max(50)
    .optional(),
});

/**
 * Lab simulator: a subscription as Twitch announces it — sub (notice + channel.subscribe), resub (notice + message,
 * cumulative months), prime (notice + channel.subscribe), subscribe alone (an unshared re-sub), message alone.
 */
export const SwLabSimulate = z.strictObject({
  kind: z.enum(['sub', 'resub', 'prime', 'subscribe', 'message']),
  viewer: z.strictObject({
    id: z.string().regex(/^\d{1,32}$/),
    login: z.string().max(64).optional(),
    name: z.string().trim().min(1).max(64),
  }),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  months: z.number().int().min(1).max(200).optional(),
});

/** « À vérifier » (R4): two distinct months · merge the duplicate (never credited) · leave it blocked. Note required. */
export const SwReviewDecision = z.enum(['distinct', 'merge', 'unresolved']);
export type SwReviewDecision = z.infer<typeof SwReviewDecision>;
export const SwReviewResolve = z.strictObject({
  decision: SwReviewDecision,
  note: z.string().trim().min(1).max(200),
});

/** Studio « Tester »: never a real gain. `full`: through the alerts queue (the sub alert then the wheel). */
export const SwTestRequest = z.strictObject({
  name: z.string().trim().min(1).max(25).optional(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  months: z.number().int().min(1).max(200).optional(),
  full: z.boolean().optional(),
});
export type SwTestRequest = z.infer<typeof SwTestRequest>;

/** A gain settled outside Raptoru (reconciliation): never an automatic credit. */
export const SwAwardUpdate = z.strictObject({
  status: z.enum(['manual', 'cancelled']),
  note: z.string().trim().min(1).max(200),
});

export const SwAnimationClaim = z.strictObject({
  consumer_id: z.string().min(1).max(64),
});
export const SwAnimationReport = z.strictObject({
  consumer_id: z.string().min(1).max(64),
  event: z.enum(['completed', 'failed', 'unknown']),
  error: z.string().max(200).optional(),
  /**
   * Did the player START it? false: never started, nothing seen nor heard (shown again automatically). Absent (a Studio
   * older than this field): told from the error code.
   */
  started: z.boolean().optional(),
});
export type SwAnimationReport = z.infer<typeof SwAnimationReport>;
