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

export const SUB_WHEEL = {
  /** Legacy WHEEL_TIER_COEFS. */
  tierCoef: { 1: 1, 2: 2, 3: 3 } as Record<1 | 2 | 3, number>,
  /** The wheel starts once the sub alert ended (SAMMI waited 6 s after starting it); at the latest this long after. */
  afterAlertMaxMs: 20_000,
  /** An animation not shown within this delay is dropped (the gain stays recorded). */
  animationMaxAgeMs: 10 * 60_000,
  animationLeaseMs: 60_000,
} as const;

/** The gain of a segment (legacy: baseAmt = val × mult; amount = baseAmt × tier coefficient). */
export function subWheelAmount(
  months: number,
  tier: 1 | 2 | 3,
  segment: number,
) {
  const seg = subWheelLayout(months)[segment];
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
]);
export type SwStatus = z.infer<typeof SwStatus>;

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
});
export type SwAnimationReport = z.infer<typeof SwAnimationReport>;
