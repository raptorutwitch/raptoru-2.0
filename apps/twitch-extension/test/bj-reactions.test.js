import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REACTIONS,
  PAGES,
  DEALER,
} from '../extension/assets/casino/reactions/reactions.js';
import {
  BURST,
  REFILL_MS,
  createBucket,
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
    hands: p.hands ?? p.verdicts.map((verdict) => ({ verdict })),
    result: { net: p.net },
  })),
  ...over,
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '../extension/assets/casino/reactions');

describe('reactions manifest', () => {
  it('10 classic reactions in Antoni’s order of 22/11 (ptn last), each with a packaged picture, a name and a fallback', () => {
    const page = (n) =>
      PAGES[n - 1].map((id) => REACTIONS.find((r) => r.id === id));
    expect(page(1).map((r) => [r.id, r.label])).toEqual([
      ['r1', 'Sourire'],
      ['r8', 'Sourire avec sueur'],
      ['r9', 'Pleurs'],
      ['r2', 'Visage rougissant'],
      ['r4', 'Lunettes de soleil'],
      ['r3', 'Colère'],
      ['r11', 'Câlin'],
      ['r12', 'Surprise'],
      ['r13', 'Crâne'],
      ['r7', 'ptn'],
    ]);
    // The nine emojis are Discord’s: the bundled Twemoji (licensed CC-BY 4.0, attribution in assets/twemoji).
    expect(
      page(1)
        .slice(0, 9)
        .map((r) => r.src.match(/svg\/(\w+)\.svg$/)?.[1]),
    ).toEqual([
      '1f642',
      '1f605',
      '1f62d',
      '1f633',
      '1f60e',
      '1f621',
      '1f917',
      '1f62e',
      '1f480',
    ]);
    // The subscribers’ page: Antoni’s 9 emotes + ptn (on both pages), 128 × 128 PNGs in the package.
    expect(page(2).map((r) => r.id)).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5',
      's6',
      's7',
      's8',
      's9',
      'r7',
    ]);
    for (const r of page(2).slice(0, 9)) {
      const png = readFileSync(join(ASSETS, r.src));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([128, 128]);
      expect(png.length).toBeLessThan(50_000);
    }
    for (const r of REACTIONS) {
      expect(r.src).toMatch(/^[\w./-]+\.(svg|png|gif|webp)$/);
      expect(existsSync(join(ASSETS, r.src))).toBe(true); // inside the extension package, never a remote URL
      expect(r.glyph).toBeTruthy();
    }
    expect(existsSync(join(ASSETS, '../../twemoji/license-graphics.txt'))).toBe(
      true,
    );
  });

  it('exactly the ids the Core accepts — the earlier ones (r4–r6) still shown when they arrive, never reused', () => {
    const core = readFileSync(
      join(HERE, '../../core-api/src/casino/blackjack/reactions.ts'),
      'utf8',
    );
    const list = (name) =>
      [
        ...core
          .slice(core.indexOf(name))
          .split('] as const')[0]
          .matchAll(/'(\w+)'/g),
      ].map((m) => m[1]);
    expect(REACTIONS.map((r) => r.id).sort()).toEqual(
      [...list('REACTION_IDS = ['), ...list('SUB_REACTION_IDS = [')].sort(),
    );
    expect(
      REACTIONS.filter((r) => !PAGES.flat().includes(r.id)).map((r) => r.id),
    ).toEqual(['r10', 'r5', 'r6']);
  });

  it('the animated emote is the original GIF (every frame kept, transparent), never a still', () => {
    const g = readFileSync(join(ASSETS, 'ptn.gif'));
    expect(g.toString('latin1', 0, 6)).toBe('GIF89a');
    // NETSCAPE2.0 (loop) + several image descriptors after graphic-control blocks with the transparency flag.
    expect(g.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);
    expect(g.length).toBeGreaterThan(100_000);
  });

  it('every bank situation points to a real reaction with a probability (both configurable) — an emote only, no text', () => {
    const ids = new Set(REACTIONS.map((r) => r.id));
    expect(Object.keys(DEALER).sort()).toEqual([
      'big_loss',
      'big_win',
      'blackjack',
      'bust',
      'dealer_bj',
      'dealer_bust',
      'dealer_win',
      'double_lose',
      'double_win',
      'push',
      'split',
      'win',
    ]);
    for (const [kind, d] of Object.entries(DEALER)) {
      for (const r of d.r) expect(ids.has(r), kind).toBe(true);
      expect(d.chance).toBeGreaterThanOrEqual(0);
      expect(d.chance).toBeLessThanOrEqual(0.6);
      expect(d.lines, kind).toBeUndefined();
    }
  });
});

describe('the reactions’ pace (the Core’s: reactions.ts), mirrored for an immediate answer', () => {
  it('a burst of 5, then one more every 2 s; never more than 5 saved up', () => {
    const b = createBucket();
    expect([BURST, REFILL_MS]).toEqual([5, 2000]);
    let t = 1_000_000;
    for (let k = 0; k < 5; k++) expect(b.take(t)).toBe(true);
    expect(b.take(t)).toBe(false);
    expect(b.wait(t)).toBe(2000);
    t += 1999;
    expect(b.take(t)).toBe(false);
    t += 1;
    expect(b.take(t)).toBe(true);
    t += 60_000; // a long pause refills to 5, not more
    for (let k = 0; k < 5; k++) expect(b.take(t)).toBe(true);
    expect(b.take(t)).toBe(false);
  });

  it('a refusal from the Core empties it for exactly the time the Core asked', () => {
    const b = createBucket();
    b.empty(500, 1500);
    expect(b.wait(500)).toBe(1500);
    expect(b.take(1999)).toBe(false);
    expect(b.take(2000)).toBe(true);
  });
});

describe('pickDealerReaction', () => {
  it('nothing outside a settled round, nothing without a player', () => {
    expect(pickDealerReaction({ ...settled(), phase: 'players' })).toBeNull();
    expect(pickDealerReaction(settled({}, []))).toBeNull();
    // An ordinary round: rarely (« win », 12 %), never something else.
    for (let round = 1; round <= 100; round++)
      expect([null, 'win']).toContain(
        pickDealerReaction(settled({ round }))?.kind ?? null,
      );
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
    expect(
      kinds(settled({ outcome: 20 }, [{ net: -5000, verdicts: ['lose'] }])),
    ).toEqual(['big_loss']);
    const one = (net, hands) => settled({ outcome: 19 }, [{ net, hands }]);
    expect(kinds(one(200, [{ verdict: 'win', doubled: true }]))).toEqual([
      'double_win',
    ]);
    expect(kinds(one(-200, [{ verdict: 'lose', doubled: true }]))).toEqual([
      'double_lose',
    ]);
    expect(
      kinds(
        one(0, [
          { verdict: 'win', fromSplit: true },
          { verdict: 'lose', fromSplit: true },
        ]),
      ),
    ).toEqual(['split']);
    expect(kinds(one(0, [{ verdict: 'push' }]))).toEqual(['push']);
    expect(kinds(one(100, [{ verdict: 'win' }]))).toEqual(['win']);
  });

  it('the bank may use every reaction of the project, the ones no longer offered and the subscribers’ included', () => {
    const used = new Set(Object.values(DEALER).flatMap((d) => d.r));
    for (const id of ['r6', 'r10', 'r5', 's4', 's2'])
      expect(used.has(id)).toBe(true);
  });

  it('the emote comes from the configurable association; a probability of 0 silences a situation', () => {
    const s = settled({ outcome: 'BUST' });
    const always = { dealer_bust: { r: ['r6'], chance: 1 } };
    expect(pickDealerReaction(s, 100, always)).toEqual({
      kind: 'dealer_bust',
      r: 'r6',
    });
    expect(
      pickDealerReaction(s, 100, {
        dealer_bust: { ...always.dealer_bust, chance: 0 },
      }),
    ).toBeNull();
    expect(
      pickDealerReaction(s, 100, {
        dealer_bust: { ...always.dealer_bust, r: ['r99'] },
      }),
    ).toBeNull(); // an unknown emote: nothing rather than a broken picture
    for (let round = 1; round <= 300; round++) {
      const got = pickDealerReaction({ ...s, round });
      if (got) expect(DEALER.dealer_bust.r).toContain(got.r);
    }
  });

  it('occasional: about 40 % of the rounds where the bank busts, 25 % with a bust, never every round', () => {
    const rate = (s) => {
      let n = 0;
      for (let round = 1; round <= 2000; round++)
        if (pickDealerReaction({ ...s, table: `t${round % 7}`, round })) n += 1;
      return n / 2000;
    };
    expect(rate(settled({ outcome: 'BUST' }))).toBeGreaterThan(0.35);
    expect(rate(settled({ outcome: 'BUST' }))).toBeLessThan(0.45);
    expect(
      rate(settled({ outcome: 20 }, [{ net: -100, verdicts: ['bust'] }])),
    ).toBeGreaterThan(0.2);
    expect(
      rate(settled({ outcome: 20 }, [{ net: -100, verdicts: ['bust'] }])),
    ).toBeLessThan(0.3);
  });

  it('unit() spreads evenly between 0 and 1', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => unit(`k${i}`));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(xs.filter((x) => x < 0.5).length).toBeGreaterThan(420);
    expect(xs.filter((x) => x < 0.5).length).toBeLessThan(580);
  });
});
