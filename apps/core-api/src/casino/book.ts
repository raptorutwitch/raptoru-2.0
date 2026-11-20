import { seededRng, type IntRng } from './rng.js';

// Casino — the emote machine (« machine à émotes », docs/CASINO.md § 13), ported unchanged from the validated prototype
// (prototypes/casino-emotes/src/engine.js; RTP 95.23 % exact, tools/rtp.mjs). 5 × 3, the fruit machine's 10 lines,
// left to right, one win per line (the best). 9 paying symbols (4 strong from 2, 5 common from 3) + BONUS (Qilby): WILD
// on the lines AND scatter (2 / 20 / 200 × the total bet, anywhere). 3+ BONUS: 10 free spins, same bet; one paying symbol
// drawn uniformly becomes EXPANDING for the whole feature: on a free spin, on enough reels (2 for a strong one, 3 for a
// common one), it fills them and pays its value for that many reels × the 10 lines, ON TOP of the spin's normal wins.
// 3 BONUS during the free spins: +10 spins, same symbol. The whole round (base + every free spin) is drawn at once, in
// the Core, before any animation: a reload, a second device or a spectator never changes a Jeton.

/** Pays in « × the bet PER LINE » (total bet = 10 lines). */
export const PAYS: Readonly<Record<string, Readonly<Record<number, number>>>> =
  {
    p1: { 2: 10, 3: 100, 4: 1000, 5: 5000 },
    p2: { 2: 5, 3: 40, 4: 400, 5: 2000 },
    p3: { 2: 5, 3: 30, 4: 100, 5: 750 },
    p4: { 2: 5, 3: 30, 4: 100, 5: 750 },
    c1: { 3: 5, 4: 40, 5: 150 },
    c2: { 3: 5, 4: 40, 5: 150 },
    c3: { 3: 5, 4: 25, 5: 100 },
    c4: { 3: 5, 4: 25, 5: 100 },
    c5: { 3: 5, 4: 25, 5: 100 },
  };
/** BONUS anywhere, in « × the TOTAL bet ». */
export const SCATTER_PAYS: Readonly<Record<number, number>> = {
  3: 2,
  4: 20,
  5: 200,
};
export const BONUS = 'bonus';
export const PAYING = Object.keys(PAYS);
export const FREE_GAMES = 10;
/** Technical bound of a feature (probability < 10⁻²⁰). */
export const MAX_FREE_GAMES = 500;
export const minCount = (id: string) => (PAYS[id]![2] ? 2 : 3);

export const LINES: readonly { name: string; rows: readonly number[] }[] = [
  { name: 'Haut', rows: [0, 0, 0, 0, 0] },
  { name: 'Milieu', rows: [1, 1, 1, 1, 1] },
  { name: 'Bas', rows: [2, 2, 2, 2, 2] },
  { name: 'V', rows: [0, 1, 2, 1, 0] },
  { name: 'V inversé', rows: [2, 1, 0, 1, 2] },
  { name: 'Creux', rows: [1, 2, 2, 2, 1] },
  { name: 'Bosse', rows: [1, 0, 0, 0, 1] },
  { name: 'Montée', rows: [2, 2, 1, 0, 0] },
  { name: 'Descente', rows: [0, 0, 1, 2, 2] },
  { name: 'Rampe', rows: [2, 1, 1, 1, 0] },
];

/** The calibrated strips of the audit (33 stops per reel, one BONUS each). */
export const STRIPS: readonly (readonly string[])[] = [
  [
    'bonus',
    'p4',
    'c1',
    'c5',
    'c3',
    'c2',
    'c5',
    'p1',
    'c3',
    'p4',
    'p3',
    'c2',
    'c1',
    'c5',
    'c4',
    'c1',
    'c3',
    'p3',
    'c1',
    'c5',
    'c2',
    'c5',
    'c3',
    'p2',
    'c4',
    'c5',
    'c3',
    'c5',
    'c1',
    'c3',
    'c1',
    'c4',
    'c5',
  ],
  [
    'c3',
    'c5',
    'p2',
    'c4',
    'c5',
    'c4',
    'p3',
    'c4',
    'c5',
    'c4',
    'p2',
    'c1',
    'c5',
    'c1',
    'c2',
    'c3',
    'c2',
    'c4',
    'c2',
    'p1',
    'p4',
    'c4',
    'c2',
    'c3',
    'c1',
    'c4',
    'p3',
    'c5',
    'bonus',
    'p4',
    'c2',
    'c5',
    'c2',
  ],
  [
    'c4',
    'c2',
    'c1',
    'c3',
    'p2',
    'c5',
    'c1',
    'c4',
    'c3',
    'c2',
    'c3',
    'p4',
    'c3',
    'bonus',
    'c1',
    'c5',
    'c4',
    'c1',
    'p3',
    'c2',
    'c5',
    'p3',
    'p4',
    'c2',
    'c5',
    'p1',
    'c3',
    'c2',
    'c1',
    'c5',
    'c3',
    'c1',
    'c2',
  ],
  [
    'c2',
    'c3',
    'c4',
    'c3',
    'c4',
    'p3',
    'c2',
    'p3',
    'c3',
    'c4',
    'c3',
    'p2',
    'p1',
    'c1',
    'c2',
    'c1',
    'c3',
    'p4',
    'c2',
    'c4',
    'c3',
    'c5',
    'c4',
    'c5',
    'p2',
    'c5',
    'c2',
    'p4',
    'c2',
    'bonus',
    'c1',
    'c4',
    'c5',
  ],
  [
    'bonus',
    'c5',
    'c4',
    'c2',
    'p4',
    'c2',
    'c1',
    'c3',
    'c2',
    'c4',
    'c5',
    'c4',
    'c1',
    'c4',
    'p4',
    'c1',
    'c3',
    'c5',
    'c1',
    'p2',
    'p1',
    'c5',
    'c4',
    'c5',
    'c4',
    'c5',
    'c3',
    'p3',
    'c5',
    'c1',
    'p2',
    'c1',
    'p3',
  ],
];

export const windowAt = (stops: readonly number[]) =>
  STRIPS.map((s, r) =>
    [0, 1, 2].map((row) => s[(stops[r]! + row) % s.length]!),
  );

export interface BookLine {
  line: number;
  symbol: string;
  count: number;
  pay: number;
  cells: [number, number][];
  wilds: [number, number][];
  win: number;
}
export interface BookEval {
  lines: BookLine[];
  scatter: { count: number; cells: [number, number][]; win: number };
  lineWin: number;
  total: number;
}
/** A grid's wins (grid[reel][row]) for a TOTAL bet: lines (each rounded down) + BONUS anywhere. */
export function evaluate(grid: string[][], bet: number): BookEval {
  const lines: BookLine[] = [];
  LINES.forEach((L, li) => {
    const ids = L.rows.map((row, r) => grid[r]![row]!);
    let k = 0;
    while (k < 5 && ids[k] === BONUS) k++;
    if (k === 5) return;
    const sym = ids[k]!;
    let n = k;
    while (n < 5 && (ids[n] === sym || ids[n] === BONUS)) n++;
    const pay = PAYS[sym]![n];
    if (!pay) return;
    const cells: [number, number][] = [];
    const wilds: [number, number][] = [];
    for (let r = 0; r < n; r++) {
      cells.push([r, L.rows[r]!]);
      if (ids[r] === BONUS) wilds.push([r, L.rows[r]!]);
    }
    lines.push({
      line: li,
      symbol: sym,
      count: n,
      pay,
      cells,
      wilds,
      win: Math.floor((pay * bet) / 10),
    });
  });
  const cells: [number, number][] = [];
  for (let r = 0; r < 5; r++)
    for (let row = 0; row < 3; row++)
      if (grid[r]![row] === BONUS) cells.push([r, row]);
  const count = cells.length;
  const scatter = {
    count,
    cells,
    win: count >= 3 ? Math.floor(SCATTER_PAYS[Math.min(count, 5)]! * bet) : 0,
  };
  const lineWin = lines.reduce((a, w) => a + w.win, 0);
  return { lines, scatter, lineWin, total: lineWin + scatter.win };
}

/** A free spin's expansion: the reels showing `sym` (any row) and its win, or null. */
export function expansionOf(grid: string[][], sym: string, bet: number) {
  const reels: number[] = [];
  for (let r = 0; r < 5; r++) if (grid[r]!.includes(sym)) reels.push(r);
  if (reels.length < minCount(sym)) return null;
  const pay = PAYS[sym]![reels.length]!;
  return {
    symbol: sym,
    reels,
    n: reels.length,
    pay,
    win: Math.floor(pay * bet),
  };
}

/** Lab scenarios: REAL strip positions chosen to show a feature (never an invented win). */
export interface BookTest {
  bonus?: 3 | 4 | 5;
  symbol?: string;
  expand?: number;
  retrigger?: boolean;
  big?: boolean;
}
const stopsWith = (r: number, pred: (w: string[]) => boolean) =>
  STRIPS[r]!.map((_, i) => i).filter((i) =>
    pred([0, 1, 2].map((j) => STRIPS[r]![(i + j) % STRIPS[r]!.length]!)),
  );
const pick = <T>(rng: IntRng, a: T[]) => a[rng.int(a.length)]!;
function shuffle<T>(rng: IntRng, a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
export function forcedStops(
  rng: IntRng,
  {
    sym,
    k,
    avoidBonus = true,
  }: { sym: string; k: number; avoidBonus?: boolean },
) {
  const chosen = shuffle(rng, [0, 1, 2, 3, 4]).slice(0, k);
  return [0, 1, 2, 3, 4].map((r) => {
    const want = chosen.includes(r);
    const ok = stopsWith(
      r,
      (w) =>
        (want ? w.includes(sym) : !w.includes(sym)) &&
        (!avoidBonus || sym === BONUS || !w.includes(BONUS)),
    );
    return pick(
      rng,
      ok.length
        ? ok
        : stopsWith(r, (w) => (want ? w.includes(sym) : !w.includes(sym))),
    );
  });
}
const randomStops = (rng: IntRng) => STRIPS.map((s) => rng.int(s.length));

export interface FreeSpin {
  i: number;
  stops: number[];
  grid: string[][];
  eval: BookEval;
  expansion: ReturnType<typeof expansionOf>;
  retrigger: boolean;
  win: number;
  total: number;
  left: number;
  series: number;
}
export interface BookFeature {
  symbol: string;
  spins: FreeSpin[];
  total: number;
  games: number;
  series: number;
}
export interface BookRound {
  bet: number;
  base: { stops: number[]; grid: string[][]; eval: BookEval };
  feature: BookFeature | null;
  payout: number;
  test: BookTest | null;
}

/** A whole round, decided before any animation: the base spin and, if it triggers, the symbol and every free spin. */
export function playRound(
  rng: IntRng,
  bet: number,
  test: BookTest | null = null,
): BookRound {
  const tr = test ? seededRng((rng.int(2 ** 31) ^ 0x5bd1e995) >>> 0) : null;
  const baseStops = test?.bonus
    ? forcedStops(tr!, { sym: BONUS, k: test.bonus })
    : randomStops(rng);
  const baseGrid = windowAt(baseStops);
  const base = {
    stops: baseStops,
    grid: baseGrid,
    eval: evaluate(baseGrid, bet),
  };
  const feature =
    base.eval.scatter.count >= 3 ? drawFeature(rng, bet, test, tr) : null;
  return {
    bet,
    base,
    feature,
    payout: base.eval.total + (feature?.total ?? 0),
    test: test ? { ...test } : null,
  };
}
export function drawFeature(
  rng: IntRng,
  bet: number,
  test: BookTest | null = null,
  tr: IntRng | null = null,
): BookFeature {
  const symbol =
    test?.symbol && PAYS[test.symbol]
      ? test.symbol
      : PAYING[rng.int(PAYING.length)]!;
  const spins: FreeSpin[] = [];
  let left = FREE_GAMES;
  let total = 0;
  let series = 1;
  while (left > 0 && spins.length < MAX_FREE_GAMES) {
    left--;
    const i = spins.length;
    let stops: number[];
    if (test && tr && i === 0 && (test.expand || test.big))
      stops = forcedStops(tr, { sym: symbol, k: test.big ? 5 : test.expand! });
    else if (test?.retrigger && tr && i === 1)
      stops = forcedStops(tr, { sym: BONUS, k: 3 });
    else stops = randomStops(rng);
    const grid = windowAt(stops);
    const ev = evaluate(grid, bet);
    const expansion = expansionOf(grid, symbol, bet);
    const retrigger = ev.scatter.count >= 3;
    if (retrigger) {
      left += FREE_GAMES;
      series++;
    }
    const win = ev.total + (expansion?.win ?? 0);
    total += win;
    spins.push({
      i,
      stops,
      grid,
      eval: ev,
      expansion,
      retrigger,
      win,
      total,
      left,
      series,
    });
  }
  return { symbol, spins, total, games: spins.length, series };
}
