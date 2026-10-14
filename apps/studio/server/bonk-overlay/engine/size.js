// Bonk VNext lot 1 — projectile size. The mean is dominant: 80 % within ±10 px, 94 % within ±20 px;
// bigger ones are rare and capped at +26 px, the extremes are on the small side (audit §8).

export const SIZE_MEAN = 140;

/** Standard normal sample from two uniform draws (Box-Muller). */
export function gaussian(random) {
  const u = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** Offset (px) from the mean, before `variance` scaling. */
export function sizeOffset(random) {
  const band = random();
  if (band < 0.8) return Math.max(-10, Math.min(10, gaussian(random) * 5));
  if (band < 0.94) return (random() < 0.6 ? -1 : 1) * (10 + random() * 10);
  if (band < 0.98) return -(20 + random() * 12);
  if (band < 0.995) return 20 + random() * 6;
  return -(32 + random() * 12);
}

/** Size in px. `variance` scales the offsets only (never the mean). */
export function sampleSize(random, { mean = SIZE_MEAN, variance = 1 } = {}) {
  return Math.round(mean + sizeOffset(random) * variance);
}
