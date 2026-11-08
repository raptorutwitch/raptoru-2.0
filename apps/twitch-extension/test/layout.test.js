// Layout decision of the socle (app/layout.js, plan § 3.1–3.3): profiles, scales, hysteresis.
import { describe, expect, it } from 'vitest';
import { computeLayout } from '../extension/app/layout.js';

describe('computeLayout', () => {
  it.each([
    // plan § 3.3 — known sizes
    [651, 434, 'normal', 1, 1],
    [565, 376, 'normal', 0.866, 0.95],
    [521, 347, 'compact', 0.85, 0.95],
    [452, 301, 'compact', 0.85, 0.95],
    [377, 251, 'compact', 0.85, 0.95],
    [867, 578, 'large', 1.15, 1.1],
    [1053, 702, 'large', 1.15, 1.1],
    [318, 496, 'etroit', 1, 1],
    [390, 844, 'etroit', 1, 1],
    [844, 390, 'normal', 0.899, 0.95],
  ])('%ix%i → %s (kg %f, kt %f)', (w, h, profile, kg, kt) => {
    expect(computeLayout({ w, h })).toEqual({ profile, kg, kt });
  });

  it('keeps the previous profile within 8 px of the boundary (no flicker while resizing)', () => {
    // 0.85 × 434 = 368.9: 365 px high is compact when fresh, normal when coming from normal.
    expect(computeLayout({ w: 600, h: 365 }).profile).toBe('compact');
    expect(computeLayout({ w: 600, h: 365, prev: 'normal' }).profile).toBe('normal');
    expect(computeLayout({ w: 600, h: 355, prev: 'normal' }).profile).toBe('compact');
  });

  it('a narrow or portrait root is « étroit » with unit scales', () => {
    expect(computeLayout({ w: 359, h: 200 })).toEqual({ profile: 'etroit', kg: 1, kt: 1 });
    expect(computeLayout({ w: 500, h: 500 }).profile).toBe('etroit');
  });
});
