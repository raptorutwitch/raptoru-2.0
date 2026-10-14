// Bonk VNext lot 1 — screen density (audit §11). A paid projectile is never dropped: past the soft
// limit new ones are shorter and the oldest leave faster; at the hard limit a new one waits for a
// free slot (bounded wait, then it plays anyway).

export const DENSITY = Object.freeze({
  soft: 18,
  hard: 30,
  /** Longest wait for a free slot (well under the 30 s claim lease). */
  maxWaitMs: 4000,
  /** Accelerated exit of an old projectile. */
  fastExitMs: 250,
});

/**
 * @param {number} alive projectiles on screen (exiting ones included)
 * @param {number} waitedMs how long the new one has already waited
 * @returns {{wait: boolean, reduced: boolean, accelerate: number}}
 */
export function densityDecision(alive, waitedMs = 0, limits = DENSITY) {
  if (alive >= limits.hard && waitedMs < limits.maxWaitMs)
    return { wait: true, reduced: true, accelerate: 1 };
  if (alive >= limits.soft)
    return { wait: false, reduced: true, accelerate: 1 };
  return { wait: false, reduced: false, accelerate: 0 };
}
