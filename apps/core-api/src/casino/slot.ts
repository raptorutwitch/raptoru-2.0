import { seededRng, type IntRng } from './rng.js';

// Casino — the slot machine's rules (docs/CASINO.md § 2), ported from the validated prototype (prototypes/casino-v8,
// shared/slots.js) with the pay table that funds the Coffre (the bonus study: base game 73.12 % + Coffre 21.96 % =
// 95.08 %). No animation, no wallet: the service decides a spin here, then pays it in one transaction.
//
// 5 reels × 3 rows, 10 fixed lines. A line pays the same symbols CONSECUTIVE from the left reel, 3 at least (7 and
// Diamant from 2). WILD replaces every paying symbol, never BONUS (a BONUS stops a line); a line pays ONE combination,
// the best one (the symbol completed by WILDs, or the WILDs alone if they pay more). BONUS (scatter) is counted anywhere:
// 3, 4 or 5 open the Coffre (it pays nothing by itself). Pays are hundredths of the bet; each line is rounded down.

export const REELS = 5;
export const ROWS = 3;

export interface SlotSymbol {
  id: string;
  name: string;
  /** Hundredths of the bet for n identical on a line. */
  pays: Readonly<Record<number, number>>;
  wild?: true;
  scatter?: true;
}

/** The final pay table (prototype V8 = the study's budget « L »: small fruits trimmed, BONUS without a direct pay). */
export const SYMBOLS: readonly SlotSymbol[] = [
  { id: 'cerise', name: 'Cerise', pays: { 3: 40, 4: 115, 5: 350 } },
  { id: 'citron', name: 'Citron', pays: { 3: 35, 4: 115, 5: 350 } },
  { id: 'raisin', name: 'Raisin', pays: { 3: 65, 4: 225, 5: 700 } },
  { id: 'cloche', name: 'Cloche', pays: { 3: 175, 4: 550, 5: 1750 } },
  { id: 'bar', name: 'BAR', pays: { 3: 350, 4: 1250, 5: 4500 } },
  {
    id: 'diamant',
    name: 'Diamant',
    pays: { 2: 25, 3: 750, 4: 3000, 5: 10000 },
  },
  { id: 'sept', name: '7', pays: { 2: 50, 3: 1500, 4: 6000, 5: 25000 } },
  {
    id: 'wild',
    name: 'WILD',
    wild: true,
    pays: { 3: 1000, 4: 5000, 5: 50000 },
  },
  { id: 'bonus', name: 'BONUS', scatter: true, pays: {} },
];
const BY_ID: Readonly<Record<string, SlotSymbol>> = Object.fromEntries(
  SYMBOLS.map((s) => [s.id, s]),
);
const WILD = 'wild';
const SCATTER = 'bonus';

/** Antoni's 10 lines: the row (0 top, 1 middle, 2 bottom) on each reel. */
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

/** Reel composition (cells per symbol): with the pay table, it fixes the RTP. */
const REEL_COUNTS: Readonly<Record<string, number>> = {
  cerise: 8,
  citron: 7,
  raisin: 6,
  cloche: 3,
  bar: 2,
  diamant: 1,
  sept: 1,
  wild: 1,
  bonus: 1,
};

/** A reel's strip: a reproducible shuffle, never two equal symbols side by side (the prototype's buildStrip). */
function buildStrip(seed: number): string[] {
  const rng = seededRng(seed);
  const bag: string[] = [];
  for (const [id, n] of Object.entries(REEL_COUNTS))
    for (let i = 0; i < n; i++) bag.push(id);
  for (let attempt = 0; attempt < 20000; attempt++) {
    for (let i = bag.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
    const L = bag.length;
    let ok = true;
    for (let i = 0; i < L && ok; i++) {
      if (bag[i] === bag[(i + 1) % L]) ok = false;
      if (bag[i] === SCATTER && bag[(i + 2) % L] === SCATTER) ok = false;
    }
    if (ok) return bag.slice();
  }
  throw new Error('strip_unbuildable');
}

/** The five strips (30 cells each), fixed: the same as the prototype's, so its exact enumeration still holds. */
export const STRIPS: readonly (readonly string[])[] = [0, 1, 2, 3, 4].map((i) =>
  buildStrip(9001 + i * 7919),
);

export type Grid = string[][];

/** The 3 visible symbols of each reel for given stops: grid[reel][row]. */
export function windowAt(stops: readonly number[]): Grid {
  return STRIPS.map((strip, r) => {
    const L = strip.length;
    return [0, 1, 2].map((row) => strip[(stops[r]! + row) % L]!);
  });
}

/** The best combination of one line (5 ids, reel 1 → 5), or null. */
export function lineWin(
  ids: readonly string[],
): { symbol: string; count: number; pay: number } | null {
  let kw = 0;
  while (kw < ids.length && ids[kw] === WILD) kw++;
  let best: { symbol: string; count: number; pay: number } | null = null;
  const wildPay = kw > 0 ? (BY_ID[WILD]!.pays[kw] ?? 0) : 0;
  if (wildPay) best = { symbol: WILD, count: kw, pay: wildPay };
  const first = ids[kw];
  if (first !== undefined && first !== SCATTER) {
    let k = kw + 1;
    while (k < ids.length && (ids[k] === first || ids[k] === WILD)) k++;
    const pay = BY_ID[first]!.pays[k];
    if (pay && (!best || pay > best.pay))
      best = { symbol: first, count: k, pay };
  }
  return best;
}

export interface LineHit {
  line: number;
  symbol: string;
  count: number;
  cells: [number, number][];
  wilds: [number, number][];
  pay: number;
  win: number;
}
export interface SlotEval {
  lines: LineHit[];
  scatter: { count: number; cells: [number, number][] };
  /** Jetons won on the lines (the Coffre is paid on top). */
  total: number;
}

export function evaluate(grid: Grid, bet: number): SlotEval {
  const lines: LineHit[] = [];
  LINES.forEach((line, li) => {
    const ids = line.rows.map((row, reel) => grid[reel]![row]!);
    const w = lineWin(ids);
    if (!w) return;
    const cells = line.rows
      .slice(0, w.count)
      .map((row, reel) => [reel, row] as [number, number]);
    lines.push({
      line: li,
      symbol: w.symbol,
      count: w.count,
      cells,
      wilds: cells.filter(([reel, row]) => grid[reel]![row] === WILD),
      pay: w.pay,
      win: Math.floor((bet * w.pay) / 100),
    });
  });
  const cells: [number, number][] = [];
  grid.forEach((col, reel) =>
    col.forEach((id, row) => {
      if (id === SCATTER) cells.push([reel, row]);
    }),
  );
  return {
    lines,
    scatter: { count: cells.length, cells },
    total: lines.reduce((s, l) => s + l.win, 0),
  };
}

/** The stops of a spin (one uniform draw per reel). */
export function drawStops(rng: IntRng): number[] {
  return STRIPS.map((s) => rng.int(s.length));
}

/** What the extension needs to show the machine (symbols, pays, lines, strips): display only, never a decision. */
export function slotTable() {
  return {
    symbols: SYMBOLS.map((s) => ({
      id: s.id,
      name: s.name,
      pays: s.pays,
      ...(s.wild ? { wild: true } : {}),
      ...(s.scatter ? { scatter: true } : {}),
    })),
    lines: LINES,
    strips: STRIPS,
  };
}
