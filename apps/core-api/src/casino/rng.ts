import { randomInt } from 'node:crypto';

// Casino (docs/CASINO.md) — the draws. The game uses the crypto generator; the reproducible one (mulberry32) only builds
// the fixed reel strips and serves the tests. Both give a uniform integer in [0, n) without modulo bias (the prototypes'
// shared/rng.js, ported unchanged so the strips and the parity fixtures stay identical).

/** A uniform integer in [0, n). */
export interface IntRng {
  int(n: number): number;
}

function uniform(next32: () => number, n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32)
    throw new Error('bad_range');
  const limit = 2 ** 32 - (2 ** 32 % n); // beyond it the modulo would be biased: draw again
  for (;;) {
    const x = next32();
    if (x < limit) return x % n;
  }
}

/** The game's generator: node:crypto, one call per draw. */
export const cryptoIntRng: IntRng = { int: (n) => randomInt(0, n) };

/** mulberry32, reproducible: the strips and the tests, never a real draw. */
export function seededRng(seed: number): IntRng {
  let a = seed >>> 0;
  const next32 = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return { int: (n) => uniform(next32, n) };
}

/** A float in [0, 1) for the Coffre (the prototype's `floatFrom`: 2^30 steps). */
export const floatFrom = (rng: IntRng) => () => rng.int(1 << 30) / (1 << 30);

/** The study's float generator (mulberry32 as a float), used by the Coffre parity tests. */
export function seededFloat(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
