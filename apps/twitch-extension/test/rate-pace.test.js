import { describe, expect, it } from 'vitest';
import { createAutoPacer } from '../extension/shared/casino/rate-pace.js';

// Rapide + Auto outrunning the Core's quota (audit SLOT-01, 21/11/2026): the pacer mirrors the Core's bucket
// (60 capacity, +4/s, 11 units/round) so Auto waits instead of firing into a 429.

describe('createAutoPacer', () => {
  it('starts full: no wait for the first rounds', () => {
    const p = createAutoPacer();
    expect(p.waitMs()).toBe(0);
  });

  it('200 chained rounds, clock advancing only by waitMs: matches the Core budget (steady throughput, no overrun)', () => {
    let t = 0;
    const p = createAutoPacer({ now: () => t });
    for (let i = 0; i < 200; i++) {
      t += p.waitMs(); // Auto would wait exactly this long before firing the next round
      p.spend();
    }
    // 200 rounds * 11 units, refilled at 4/s, minus the 60-token head start the bucket began with.
    const expectedMs = ((200 * 11 - 60) / 4) * 1000;
    expect(t).toBeGreaterThanOrEqual(expectedMs);
    expect(t).toBeLessThan(expectedMs + 200 * 1000); // ceil() rounding, not a slow leak
  });

  it('a burst empties the bucket, then recovers over real time', () => {
    let t = 0;
    const p = createAutoPacer({ now: () => t });
    for (let i = 0; i < 6; i++) p.spend(); // 6 * 11 = 66 > 60: the bucket cannot be negative
    expect(p.waitMs()).toBeGreaterThan(0);
    t += 15_000; // 15 s * 4/s = 60: fully refilled
    expect(p.waitMs()).toBe(0);
  });

  it('a lower cost (a GET-only refresh) asks for a shorter wait than a full round', () => {
    let t = 0;
    const cheap = createAutoPacer({ cost: 1, now: () => t });
    const costly = createAutoPacer({ cost: 11, now: () => t });
    for (let i = 0; i < 6; i++) {
      cheap.spend();
      costly.spend();
    }
    expect(cheap.waitMs()).toBeLessThanOrEqual(costly.waitMs());
  });
});
