import { describe, expect, it } from 'vitest';
import {
  BASE_W,
  BASE_H,
  BJ_BASE,
  MIN,
  scaleFor,
} from '../extension/app/fit.js';
import { computeLayout } from '../extension/app/layout.js';

// Le composant vidéo réduit le Casino d'un bloc (app/fit.js) : la disposition validée à 651 × 434, juste plus petite.
describe('uniform scale of the video component (Casino)', () => {
  it('1 from the reference up (never enlarged), proportional below, MIN at the smallest', () => {
    expect([BASE_W, BASE_H]).toEqual([651, 434]);
    expect(scaleFor(651, 434)).toBe(1);
    expect(scaleFor(1053, 702)).toBe(1);
    expect(scaleFor(563, 376)).toBeCloseTo(0.865, 2); // a normal Twitch player, component at 65 % (22/11)
    expect(scaleFor(520, 347)).toBeCloseTo(0.8, 2); // the same at 60 % (Antoni's captures of 22/11)
    expect(scaleFor(452, 301)).toBeCloseTo(0.694, 2);
    expect(scaleFor(200, 133)).toBe(MIN);
  });

  it('the composition seen by the shell under that scale is the reference: the normal profile, not the compact one', () => {
    const z = scaleFor(520, 347);
    expect(
      computeLayout({ w: Math.round(520 / z), h: Math.round(347 / z) }).profile,
    ).toBe('normal');
    expect(computeLayout({ w: 520, h: 347 }).profile).toBe('compact'); // what it was before: the squeezed layouts
  });
});

describe('Blackjack base', () => {
  it('lays the table out natively from the normal player (563 × 376) and only scales below', () => {
    expect(scaleFor(563, 376, BJ_BASE)).toBe(1);
    expect(scaleFor(651, 434, BJ_BASE)).toBe(1);
    expect(scaleFor(490, 326, BJ_BASE)).toBeCloseTo(0.867, 2);
    expect(scaleFor(390, 260, BJ_BASE)).toBeCloseTo(0.691, 2);
  });
});
