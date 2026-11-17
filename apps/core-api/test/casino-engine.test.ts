import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COFFRE_MAX,
  coffreBoards,
  generateCoffre,
  type CoffreScript,
} from '../src/casino/coffre.js';
import { seededFloat, seededRng } from '../src/casino/rng.js';
import {
  ORDER,
  rouletteError,
  settleRoulette,
  type RouletteBets,
} from '../src/casino/roulette.js';
import { drawStops, evaluate, STRIPS, windowAt } from '../src/casino/slot.js';

// The Core's casino engines = the validated prototype engines (= the bonus study's model), proved on a fixture the
// prototype built (test/fixtures/casino-parity.json): the same strips, the same wins on 201 500 grids, the same 33 000
// Coffre scenarios seed by seed, the same roulette settlements on the 37 numbers.
const F = JSON.parse(
  readFileSync(
    new URL('./fixtures/casino-parity.json', import.meta.url),
    'utf8',
  ),
) as {
  strips: string[][];
  grids: {
    stops: number[];
    bet: number;
    total: number;
    scatter: number;
    lines: [number, string, number, number][];
  }[];
  gridsDigest: string;
  coffreDigest: string;
  coffreTotals: number[];
  coffreWithCellsDigest: string;
  roulette: [number, number, number, number, [string, number][]][];
  order: number[];
};
const sha = (x: unknown) =>
  createHash('sha256').update(JSON.stringify(x)).digest('hex');
const canon = (s: CoffreScript) => [
  s.k,
  s.start.map((x) => [x.cell, x.v]),
  s.steps.map((st) => [
    st.coins.map((c) => [c.cell, c.kind, c.v]),
    st.cols,
    st.doubled ? 1 : 0,
    st.counter,
    st.filled,
    st.total,
  ]),
  s.full ? 1 : 0,
  s.total,
];

describe('casino engines = the validated prototype (the study model)', () => {
  it('same reel strips', () => {
    expect(STRIPS).toEqual(F.strips);
  });

  it('same wins on 1 500 grids (two bets, one that rounds) and on 200 000 more (digest)', () => {
    for (const g of F.grids) {
      const ev = evaluate(windowAt(g.stops), g.bet);
      expect(ev.total).toBe(g.total);
      expect(ev.scatter.count).toBe(g.scatter);
      expect(ev.lines.map((l) => [l.line, l.symbol, l.count, l.win])).toEqual(
        g.lines,
      );
    }
    const rng = seededRng(99);
    const big: number[] = [];
    for (let i = 0; i < 200_000; i++) {
      const ev = evaluate(windowAt(drawStops(rng)), 100);
      big.push(ev.total, ev.scatter.count);
    }
    expect(sha(big)).toBe(F.gridsDigest);
  });

  it('same Coffre scenarios, seed by seed (30 000 drawn as the study, 3 000 from real start cells)', () => {
    const scripts: unknown[] = [];
    const totals: number[] = [];
    for (let seed = 1; seed <= 30_000; seed++) {
      const s = generateCoffre(3 + (seed % 3), seededFloat(seed));
      scripts.push(canon(s));
      if (seed <= 400) totals.push(s.total);
    }
    expect(totals).toEqual(F.coffreTotals);
    expect(sha(scripts)).toBe(F.coffreDigest);
    const withCells: unknown[] = [];
    for (let seed = 1; seed <= 3000; seed++) {
      const cells = [0, 4, 8, 10, 14].slice(0, 3 + (seed % 3));
      withCells.push(
        canon(generateCoffre(cells.length, seededFloat(seed * 7), cells)),
      );
    }
    expect(sha(withCells)).toBe(F.coffreWithCellsDigest);
  });

  it('same roulette: wheel order and settlement of the 37 numbers', () => {
    expect(ORDER).toEqual(F.order);
    const sets: RouletteBets[] = [
      { red: 100, n17: 20, c2: 40 },
      { black: 1000, d3: 500, odd: 20, n0: 20 },
      { low: 60, high: 60, even: 80, c1: 20, c3: 20, d1: 40, d2: 40 },
    ];
    let i = 0;
    for (const b of sets)
      for (let n = 0; n <= 36; n++) {
        const r = settleRoulette(b, n);
        expect([
          n,
          r.stake,
          r.gross,
          r.net,
          r.wins.map((w) => [w.id, w.gross]),
        ]).toEqual(F.roulette[i++]);
      }
  });
});

describe('casino rules', () => {
  it('Coffre distribution = the study (300 000): mean ×25,7, median ×15,5, max ≤ ×2 560; boards add up', () => {
    const rnd = seededFloat(2026);
    const N = 300_000;
    const t = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const u = rnd();
      const k = u < 0.0081 / 0.00856 ? 3 : u < 0.00855 / 0.00856 ? 4 : 5;
      const s = generateCoffre(k, rnd);
      t[i] = s.total;
      if (i < 2000) {
        // the grid the extension paints after each respin adds up to the script's total
        const boards = coffreBoards(s);
        boards.forEach((b, j) =>
          expect(b.reduce((a, x) => a + (x ? x.v : 0), 0)).toBe(
            s.steps[j]!.total,
          ),
        );
      }
    }
    t.sort();
    const mean = t.reduce((a, x) => a + x, 0) / N;
    expect(Math.abs(mean - 25.65)).toBeLessThan(0.5);
    expect(t[N >> 1]).toBe(15.5);
    expect(t[N - 1]!).toBeLessThanOrEqual(COFFRE_MAX);
  });

  it('RTP of the machine ≈ 95,1 % (1 000 000 spins: lines + Coffre)', () => {
    const rng = seededRng(7);
    const rnd = seededFloat(8);
    const N = 1_000_000;
    let lines = 0;
    let coffre = 0;
    let triggers = 0;
    for (let i = 0; i < N; i++) {
      const ev = evaluate(windowAt(drawStops(rng)), 100);
      lines += ev.total;
      if (ev.scatter.count >= 3) {
        triggers++;
        coffre += Math.floor(generateCoffre(ev.scatter.count, rnd).total * 100);
      }
    }
    const base = lines / (N * 100);
    const total = (lines + coffre) / (N * 100);
    expect(Math.abs(base - 0.7312)).toBeLessThan(0.008); // exact enumeration: 73,12 %
    expect(Math.abs(total - 0.9508)).toBeLessThan(0.02); // exact: 95,08 % (the Coffre's tail is wide)
    expect(Math.abs(N / triggers - 116.8)).toBeLessThan(6);
  });

  it('roulette refuses what is not a bet of the mat', () => {
    expect(rouletteError({ red: 20 }, 100_000)).toBeNull();
    expect(rouletteError({}, 100_000)).toBe('empty');
    expect(rouletteError([], 100_000)).toBe('empty');
    expect(rouletteError(null, 100_000)).toBe('empty');
    expect(rouletteError(JSON.parse('{"__proto__": 20}'), 100_000)).toBe(
      'unknown_spot',
    );
    expect(rouletteError({ constructor: 20 }, 100_000)).toBe('unknown_spot');
    expect(rouletteError({ n37: 20 }, 100_000)).toBe('unknown_spot');
    expect(rouletteError({ red: 10 }, 100_000)).toBe('invalid_amount');
    expect(rouletteError({ red: 30 }, 100_000)).toBe('not_multiple');
    expect(rouletteError({ red: 20.5 }, 100_000)).toBe('invalid_amount');
    expect(rouletteError({ red: '20' }, 100_000)).toBe('invalid_amount');
    expect(rouletteError({ red: -20 }, 100_000)).toBe('invalid_amount');
    expect(rouletteError({ red: 60_000, black: 60_000 }, 100_000)).toBe(
      'above_max',
    );
    // every pocket: the gross of any set of bets is ≤ 36 × the stake, and the 0 pays only the 0
    for (let n = 0; n <= 36; n++) {
      const r = settleRoulette({ red: 20, black: 20, n0: 20, d1: 40 }, n);
      expect(r.gross).toBeLessThanOrEqual(36 * r.stake);
      if (n === 0) expect(r.wins.map((w) => w.id)).toEqual(['n0']);
    }
  });
});
