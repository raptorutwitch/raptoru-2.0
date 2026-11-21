// Casino — client-side pacing for Auto spins (audit SLOT-01, 21/11/2026). The Core limits each viewer to a 60-token
// bucket refilled at 4/s, a POST costing 3 and a GET costing 1 (http/server.ts): about 11 units per ordinary spin
// (spin POST + progress result POST + progress end POST + a host-refresh GET + a casino/state GET). Rapide + Auto
// chained faster than that budget recharges, so the Core's own 429 cut Auto off with a red toast every 20-30 tours.
// This never raises the Core's limit (it protects live play): it only makes Auto wait for its own mirrored budget,
// and survives a 429 by pausing briefly instead of stopping.
const CAPACITY = 60;
const REFILL_PER_S = 4;
export const ROUND_COST = 11;

/** One bucket per game screen; `spend()` once a round's requests have actually gone out. */
export function createAutoPacer({ capacity = CAPACITY, refillPerS = REFILL_PER_S, cost = ROUND_COST, now = () => Date.now() } = {}) {
  let tokens = capacity;
  let last = now();
  const refill = () => {
    const t = now();
    tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerS);
    last = t;
  };
  return {
    /** ms to wait before another round fits the budget without a 429. */
    waitMs() {
      refill();
      return tokens >= cost ? 0 : Math.ceil(((cost - tokens) / refillPerS) * 1000);
    },
    spend() {
      refill();
      tokens = Math.max(0, tokens - cost);
    },
  };
}
