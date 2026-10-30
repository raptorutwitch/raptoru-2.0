// « Chaudron des subs » OBS page (halloween-overlay/cauldron.js): the potion's level for a progress.
import { describe, expect, it } from 'vitest';
import { levelOf } from '../halloween-overlay/cauldron.js';

describe('Chaudron des subs — OBS page', () => {
  it('the potion: a little even at 0, full at the goal, never past it', () => {
    expect(levelOf(0, 50)).toBeCloseTo(0.08);
    expect(levelOf(25, 50)).toBeCloseTo(0.54);
    expect(levelOf(80, 50)).toBe(1);
    expect(levelOf(3, 0)).toBeCloseTo(0.08);
  });
});
