import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '../extension/assets/casino/reactions');

describe('reactions manifest', () => {
  it('seven ids in Antoni’s order (r1 … r7, the ones the Core accepts), each with a packaged picture, a name and a fallback', () => {
    expect(REACTIONS.map((r) => [r.id, r.label])).toEqual([
      ['r1', 'Sourire'],
      ['r2', 'Visage attendri'],
      ['r3', 'Colère'],
      ['r4', 'Lunettes de soleil'],
      ['r5', 'Sourire en coin'],
      ['r6', 'ICANT'],
      ['r7', 'ptn'],
    ]);
    for (const r of REACTIONS) {
      expect(r.src).toMatch(/^[\w./-]+\.(svg|png|gif|webp)$/);
      expect(existsSync(join(ASSETS, r.src))).toBe(true); // inside the extension package, never a remote URL
      expect(r.glyph).toBeTruthy();
    }
    // The five Discord emojis are the bundled Twemoji (licensed CC-BY 4.0, attribution in assets/twemoji).
    expect(
      REACTIONS.slice(0, 5).every((r) =>
        r.src.startsWith('../../twemoji/svg/'),
      ),
    ).toBe(true);
    expect(existsSync(join(ASSETS, '../../twemoji/license-graphics.txt'))).toBe(
      true,
    );
  });

  it('the animated emote is the original GIF (every frame kept, transparent), never a still', () => {
    const g = readFileSync(join(ASSETS, 'ptn.gif'));
    expect(g.toString('latin1', 0, 6)).toBe('GIF89a');
    // NETSCAPE2.0 (loop) + several image descriptors after graphic-control blocks with the transparency flag.
    expect(g.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);
    expect(g.length).toBeGreaterThan(100_000);
  });

  it('every bank situation points to a real reaction, with a probability and lines (all configurable)', () => {
    const ids = new Set(REACTIONS.map((r) => r.id));
    for (const [kind, d] of Object.entries(DEALER)) {
      expect(ids.has(d.r), kind).toBe(true);
      expect(d.chance).toBeGreaterThanOrEqual(0);
      expect(d.chance).toBeLessThanOrEqual(0.6);
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
      kinds(settled({ outcome: 'BUST' }, [{ net: 5000, verdicts: ['win'] }])),
    ).toEqual(['big_win']);
    expect(kinds(settled({ outcome: 'BUST' }))).toEqual(['dealer_bust']);
    expect(
      kinds(settled({ outcome: 20 }, [{ net: -100, verdicts: ['bust'] }])),
    ).toEqual(['bust']);
    expect(
      kinds(settled({ outcome: 20 }, [{ net: -100, verdicts: ['lose'] }])),
    ).toEqual(['dealer_win']);
  });

  it('the emote comes from the configurable association; a probability of 0 silences a situation', () => {
    const s = settled({ outcome: 'BUST' });
    const always = { dealer_bust: { r: 'r6', chance: 1, lines: ['Hop'] } };
    expect(pickDealerReaction(s, 100, always)).toEqual({
      kind: 'dealer_bust',
      r: 'r6',
      line: 'Hop',
    });
    expect(
      pickDealerReaction(s, 100, {
        dealer_bust: { ...always.dealer_bust, chance: 0 },
      }),
    ).toBeNull();
    expect(
      pickDealerReaction(s, 100, {
        dealer_bust: { ...always.dealer_bust, r: 'r99' },
      }),
    ).toBeNull(); // an unknown emote: nothing rather than a broken picture
    for (let round = 1; round <= 300; round++) {
      const got = pickDealerReaction({ ...s, round });
      if (got) expect(got.r).toBe(DEALER.dealer_bust.r);
    }
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
