import { describe, expect, it } from 'vitest';
import {
  REACTIONS,
  DEALER,
} from '../extension/assets/casino/reactions/reactions.js';
import {
  pickDealerReaction,
  unit,
} from '../extension/shared/casino/bj-reactions.js';

// Les réactions du Blackjack (docs/CASINO.md § 18) : le manifeste des visuels (identifiants fixes ↔ fichiers
// remplaçables) et les réactions de la banque — déterministes (même manche → même réaction chez tous les viewers),
// ponctuelles (au plus une par manche, ≈ 1 manche sur 4), jamais une IA.

const settled = (over = {}, players = [{ net: 100, verdicts: ['win'] }]) => ({
  phase: 'settled',
  table: 'tbl-1',
  round: 7,
  outcome: 19,
  seats: players.map((p, i) => ({
    seat: i,
    hands: p.verdicts.map((verdict) => ({ verdict })),
    result: { net: p.net },
  })),
  ...over,
});

describe('reactions manifest', () => {
  it('six ids, the ones the Core accepts (r1 … r6), each with a picture, a name and a fallback', () => {
    expect(REACTIONS.map((r) => r.id)).toEqual([
      'r1',
      'r2',
      'r3',
      'r4',
      'r5',
      'r6',
    ]);
    for (const r of REACTIONS) {
      expect(r.src).toMatch(/^[\w.-]+\.(svg|png|gif|webp)$/);
      expect(r.label).toBeTruthy();
      expect(r.glyph).toBeTruthy();
    }
    for (const d of Object.values(DEALER)) {
      expect(d.src).toMatch(/\.(svg|png|gif|webp)$/);
      expect(d.lines.length).toBeGreaterThan(0);
    }
  });
});

describe('pickDealerReaction', () => {
  it('nothing outside a settled round, nothing without a player', () => {
    expect(pickDealerReaction({ ...settled(), phase: 'players' })).toBeNull();
    expect(pickDealerReaction(settled({}, []))).toBeNull();
    expect(
      pickDealerReaction(settled({}, [{ net: 100, verdicts: ['win'] }])),
    ).toBeNull(); // an ordinary round
  });

  it('the same round gives the same reaction on every screen', () => {
    for (let round = 1; round <= 50; round++) {
      const s = settled({ round, outcome: 'BUST' });
      expect(pickDealerReaction(s)).toEqual(
        pickDealerReaction(JSON.parse(JSON.stringify(s))),
      );
    }
  });

  it('one situation per round, by priority: the bank’s blackjack, a player’s, a big win, the bank busts, a bust', () => {
    const kinds = (s) => {
      const seen = new Set();
      for (let round = 1; round <= 200; round++)
        seen.add(pickDealerReaction({ ...s, round })?.kind ?? null);
      seen.delete(null);
      return [...seen];
    };
    expect(
      kinds(settled({ outcome: 'BJ' }, [{ net: -100, verdicts: ['lose'] }])),
    ).toEqual(['dealer_bj']);
    expect(
      kinds(
        settled({ outcome: 'BUST' }, [{ net: 150, verdicts: ['blackjack'] }]),
      ),
    ).toEqual(['blackjack']);
    expect(
      kinds(
        settled({ outcome: 'BUST' }, [{ net: 5000, verdicts: ['win'] }]),
        100,
      ),
    ).toEqual(['big_win']);
    expect(kinds(settled({ outcome: 'BUST' }))).toEqual(['dealer_bust']);
    expect(
      kinds(settled({ outcome: 20 }, [{ net: -100, verdicts: ['bust'] }])),
    ).toEqual(['bust']);
  });

  it('occasional: about 35 % of the rounds where the bank busts, 20 % with a bust, never every round', () => {
    const rate = (s) => {
      let n = 0;
      for (let round = 1; round <= 2000; round++)
        if (pickDealerReaction({ ...s, table: `t${round % 7}`, round })) n += 1;
      return n / 2000;
    };
    expect(rate(settled({ outcome: 'BUST' }))).toBeGreaterThan(0.3);
    expect(rate(settled({ outcome: 'BUST' }))).toBeLessThan(0.4);
    expect(
      rate(settled({ outcome: 20 }, [{ net: -100, verdicts: ['bust'] }])),
    ).toBeGreaterThan(0.15);
    expect(
      rate(settled({ outcome: 20 }, [{ net: -100, verdicts: ['bust'] }])),
    ).toBeLessThan(0.25);
  });

  it('unit() spreads evenly between 0 and 1', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => unit(`k${i}`));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(xs.filter((x) => x < 0.5).length).toBeGreaterThan(420);
    expect(xs.filter((x) => x < 0.5).length).toBeLessThan(580);
  });
});
