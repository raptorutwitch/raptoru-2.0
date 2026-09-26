import { LoyaltyConfig } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import {
  passiveReward,
  progressiveReward,
  roundUp,
  subgiftReward,
  subReward,
} from '../src/loyalty/calc.js';
import { DEFAULT_LOYALTY_CONFIG as C } from '../src/loyalty/config.js';

describe('passive reward', () => {
  it('50 per 6 minutes × tier multiplier; 6 hours = 60 ticks', () => {
    const tick = (tier: 'none' | 't1' | 't2' | 't3') =>
      passiveReward(C, tier, null, false).final!;
    expect([tick('none'), tick('t1'), tick('t2'), tick('t3')]).toEqual([
      50, 100, 125, 200,
    ]);
    expect(
      [tick('none'), tick('t1'), tick('t2'), tick('t3')].map((t) => t * 60),
    ).toEqual([3000, 6000, 7500, 12000]);
  });

  it('the personal override replaces the tier multiplier (T1 ×2 with override ×3 → ×3)', () => {
    expect(passiveReward(C, 't1', 3, false)).toMatchObject({
      tierMultiplier: 2,
      personalOverride: 3,
      effectiveMultiplier: 3,
      final: 150,
    });
  });

  it('rounds up any fraction, never down', () => {
    expect(roundUp(125.1)).toBe(126);
    expect(roundUp(50 * 2.2)).toBe(110); // float noise ignored
    expect(passiveReward(C, 'none', 2.502, false).final).toBe(126);
  });

  it('excluded viewers get 0; an unknown tier is never guessed', () => {
    expect(passiveReward(C, 't3', null, true)).toMatchObject({
      excluded: true,
      final: 0,
    });
    expect(passiveReward(C, 'unknown', null, false)).toMatchObject({
      final: null,
      tierMultiplier: null,
      candidates: { none: 50, t1: 100, t2: 125, t3: 200 },
    });
    // A personal override does not depend on the tier.
    expect(passiveReward(C, 'unknown', 3, false).final).toBe(150);
  });
});

describe('Twitch one-off rewards', () => {
  it('sub / resub grid, never multiplied by the passive rate', () => {
    expect([
      subReward(C, 't1').final,
      subReward(C, 't2').final,
      subReward(C, 't3').final,
    ]).toEqual([2000, 4000, 10000]);
  });

  it('subgift: tier value × count, bonus from the highest threshold of this action', () => {
    const t1 = (n: number) => subgiftReward(C, 't1', n);
    expect([1, 4, 5, 9, 10, 19, 20, 50].map((n) => t1(n).final)).toEqual([
      2000, 8000, 10500, 18900, 22000, 41800, 48000, 120000,
    ]);
    // T2/T3 use their own unit value; large actions keep the 20+ bonus.
    expect([
      subgiftReward(C, 't2', 5).final,
      subgiftReward(C, 't3', 20).final,
      t1(100).final,
      t1(1000).final,
    ]).toEqual([21000, 240000, 240000, 2400000]);
    expect(t1(10)).toMatchObject({
      unitValue: 2000,
      base: 20000,
      bonusThreshold: 10,
      bonusPercent: 10,
    });
    const custom = {
      ...C,
      subgift: { bonusTiers: [{ minGifts: 3, bonusPercent: 50 }] },
    };
    expect([
      subgiftReward(custom, 't2', 2).final,
      subgiftReward(custom, 't2', 3).final,
    ]).toEqual([8000, 18000]);
  });

  it('bits: progressive per unit, higher brackets never re-price lower bits', () => {
    const bits = (n: number) => progressiveReward(n, C.bits.brackets).final;
    expect(bits(1)).toBe(7);
    expect(bits(100)).toBe(700);
    expect(bits(499)).toBe(3493);
    expect(bits(500)).toBe(3502);
    expect(bits(999)).toBe(7993); // 499×7 + 500×9
    expect(bits(1000)).toBe(8003);
    // 1200 bits = 499×7 + 500×9 + 201×10, not 1200 × 10.
    expect(progressiveReward(1200, C.bits.brackets)).toMatchObject({
      final: 10003,
      parts: [
        { from: 1, to: 499, units: 499 },
        { from: 500, to: 999, units: 500 },
        { from: 1000, to: null, units: 201 },
      ],
    });
  });

  it('tips use the same progressive calculator (per euro cent)', () => {
    const tip = (cents: number) =>
      progressiveReward(cents, C.tips.brackets).final;
    expect(tip(100)).toBe(500);
    expect(tip(499)).toBe(2495);
    expect(tip(1000)).toBe(5502); // 4.99 € ×500 + 5.00 € ×600 + 0.01 € ×700
    expect(tip(1)).toBe(5);
  });
});

describe('config validation (explicit structure, no DSL)', () => {
  it('accepts the defaults and rejects unsorted or misplaced brackets', () => {
    expect(LoyaltyConfig.parse(C)).toEqual(C);
    expect(() =>
      LoyaltyConfig.parse({
        ...C,
        bits: {
          brackets: [
            { from: 1, per100: 1 },
            { from: 1, per100: 2 },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      LoyaltyConfig.parse({
        ...C,
        bits: { brackets: [{ from: 10, per100: 1 }] },
      }),
    ).toThrow();
    expect(() =>
      LoyaltyConfig.parse({
        ...C,
        passive: {
          ...C.passive,
          tierMultipliers: { ...C.passive.tierMultipliers, t3: 0 },
        },
      }),
    ).toThrow();
  });
});
