// Casino — the Coffre du Raptor, the slot machine's bonus (docs/CASINO.md § 3). An EXACT port of the model the bonus
// study recommended and the V8 prototype plays (prototypes/casino-v7/etude/concepts.js › coffre2, final settings
// concepts-sim.js › coffreF): same probabilities, same values, same rules, same order of the draws — the parity test
// replays the study's scenarios seed by seed (test/casino-engine.test.ts).
//
// The whole Coffre is drawn at the trigger, in the spin's transaction, and paid with it: a « script » (each respin, each
// cell, each value, the total). The extension only plays it; Passer, Rapide, Auto or a reload change nothing.
//
// Rules: the trigger's BONUS (one per reel, 3 to 5) become the starting coins ×1 (30 %) ×2 (35 %) ×3 (20 %) ×5 (15 %);
// 3 respins; each empty cell gets a coin with p = 4.93 % per respin; any new coin resets the counter to 3, none takes 1
// away; the FIRST respin always lands at least one coin. A new coin: MINI ×20 (2.5 %), MAJEUR ×100 (0.6 %), MÉGA ×500
// (0.1 %) — once each —, the DOUBLER (1.5 %, once), otherwise a value ×0.5 (36 %) ×1 (30 %) ×2 (18 %) ×3 (8 %) ×5 (5 %)
// ×10 (2.4 %) ×25 (0.6 %); a jackpot or doubler already won gives a value coin instead. End of a respin: a column just
// completed doubles its value coins (once per column), THEN the doubler of this respin doubles every value coin. The end:
// counter at 0, or 15 cells (GRAND ×1 000 on top). Exact maximum ×2 560.

interface Weighted<T> {
  items: readonly (T & { w: number })[];
  total: number;
}
const tbl = <T>(items: (T & { w: number })[]): Weighted<T> => ({
  items,
  total: items.reduce((s, e) => s + e.w, 0),
});
function pick<T>(table: Weighted<T>, rnd: () => number): T & { w: number } {
  let u = rnd() * table.total;
  for (const e of table.items) if ((u -= e.w) < 0) return e;
  return table.items[table.items.length - 1]!;
}

export type JackpotId = 'mini' | 'majeur' | 'mega';
export type CoinKind = 'value' | JackpotId | 'doubler';

/** The study's final settings (coffreF). Never change them without redoing the study. */
export const COFFRE_PARAMS = Object.freeze({
  p: 0.0493,
  respins: 3,
  start: tbl<{ v: number }>([
    { v: 1, w: 30 },
    { v: 2, w: 35 },
    { v: 3, w: 20 },
    { v: 5, w: 15 },
  ]),
  vals: tbl<{ v: number }>([
    { v: 0.5, w: 36 },
    { v: 1, w: 30 },
    { v: 2, w: 18 },
    { v: 3, w: 8 },
    { v: 5, w: 5 },
    { v: 10, w: 2.4 },
    { v: 25, w: 0.6 },
  ]),
  jacks: [
    { id: 'mini' as const, w: 0.025, v: 20 },
    { id: 'majeur' as const, w: 0.006, v: 100 },
    { id: 'mega' as const, w: 0.001, v: 500 },
  ],
  wDoubler: 0.015,
  grand: 1000,
});
/** The exact maximum of a Coffre (× the bet): 4 × (3 × 5 + 9 × 25) + 100 + 500 + 1 000. */
export const COFFRE_MAX = 2560;

export interface CoffreCoin {
  cell: number;
  kind: CoinKind;
  v: number;
}
export interface CoffreStep {
  coins: CoffreCoin[];
  /** Columns completed (and doubled) at this respin. */
  cols: number[];
  doubled: boolean;
  guaranteed?: true;
  counter: number;
  filled: number;
  /** Values + jackpots on the grid after this respin (× the bet, without the GRAND). */
  total: number;
}
export interface CoffreScript {
  k: number;
  start: { cell: number; v: number }[];
  steps: CoffreStep[];
  full: boolean;
  filled: number;
  jackpots: JackpotId[];
  doubler: boolean;
  cols: number;
  /** × the bet, GRAND included. */
  total: number;
}

/**
 * Draws a whole Coffre. `k` BONUS (3–5); `rnd` a uniform float in [0, 1); `startCells` the trigger's cells
 * (reel × 3 + row) from the real grid — without them, drawn as the study does (parity tests only).
 */
export function generateCoffre(
  k: number,
  rnd: () => number,
  startCells: number[] | null = null,
): CoffreScript {
  const P = COFFRE_PARAMS;
  const val = new Array<number>(15).fill(0);
  const kind = new Array<CoinKind | null>(15).fill(null);
  let cells = startCells;
  if (!cells) {
    const reels = [0, 1, 2, 3, 4];
    for (let i = 4; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      [reels[i], reels[j]] = [reels[j]!, reels[i]!];
    }
    cells = [];
    for (let i = 0; i < k; i++) {
      const c = reels[i]! * 3 + ((rnd() * 3) | 0);
      cells.push(c);
      kind[c] = 'value';
      val[c] = pick(P.start, rnd).v;
    }
  } else {
    for (const c of cells) {
      kind[c] = 'value';
      val[c] = pick(P.start, rnd).v;
    }
  }
  const start = cells.map((c) => ({ cell: c, v: val[c]! }));
  let filled = k;
  let jack = 0;
  const won: Partial<Record<JackpotId, true>> = {};
  const wonOrder: JackpotId[] = [];
  let doubler = false;
  let respins: number = P.respins;
  const colDone = [0, 0, 0, 0, 0];
  const wJ = P.jacks.reduce((s, j) => s + j.w, 0);
  const steps: CoffreStep[] = [];
  const sum = () => val.reduce((s, x) => s + x, 0) + jack;
  while (respins > 0 && filled < 15) {
    const coins: CoffreCoin[] = [];
    const cols: number[] = [];
    let doubleNow = false;
    let guaranteed = false;
    const land = (c: number) => {
      const u = rnd();
      if (u < wJ) {
        let acc = 0;
        for (const j of P.jacks) {
          acc += j.w;
          if (u < acc) {
            if (!won[j.id]) {
              won[j.id] = true;
              wonOrder.push(j.id);
              jack += j.v;
              kind[c] = j.id;
              coins.push({ cell: c, kind: j.id, v: j.v });
              return;
            }
            break;
          }
        }
      } else if (u < wJ + P.wDoubler && !doubler) {
        doubler = true;
        doubleNow = true;
        kind[c] = 'doubler';
        coins.push({ cell: c, kind: 'doubler', v: 0 });
        return;
      }
      kind[c] = 'value';
      val[c] = pick(P.vals, rnd).v;
      coins.push({ cell: c, kind: 'value', v: val[c]! });
    };
    for (let c = 0; c < 15; c++) if (!kind[c] && rnd() < P.p) land(c);
    if (!coins.length && steps.length === 0) {
      // the first respin is guaranteed: an empty cell at random gets a coin
      let e = 0;
      for (let c = 0; c < 15; c++) if (!kind[c]) e++;
      let r = (rnd() * e) | 0;
      for (let c = 0; c < 15; c++)
        if (!kind[c] && r-- === 0) {
          land(c);
          break;
        }
      guaranteed = true;
    }
    for (let col = 0; col < 5; col++) {
      if (
        colDone[col] ||
        !(kind[col * 3] && kind[col * 3 + 1] && kind[col * 3 + 2])
      )
        continue;
      colDone[col] = 1;
      cols.push(col);
      for (let c = col * 3; c < col * 3 + 3; c++) val[c]! *= 2;
    }
    if (doubleNow) for (let c = 0; c < 15; c++) val[c]! *= 2;
    filled += coins.length;
    respins = coins.length ? P.respins : respins - 1;
    steps.push({
      coins,
      cols,
      doubled: doubleNow,
      ...(guaranteed ? { guaranteed: true as const } : {}),
      counter: respins,
      filled,
      total: sum(),
    });
  }
  const full = filled === 15;
  return {
    k,
    start,
    steps,
    full,
    filled,
    jackpots: wonOrder,
    doubler,
    cols: colDone.reduce((s, x) => s + x, 0),
    total: sum() + (full ? P.grand : 0),
  };
}

/**
 * The grid after each respin, rebuilt from the script (what the extension paints): the coins and their values once the
 * respin's doublings are applied. Pure display; the total is the script's.
 */
export function coffreBoards(
  s: CoffreScript,
): ({ kind: CoinKind; v: number } | null)[][] {
  const b = new Array<{ kind: CoinKind; v: number } | null>(15).fill(null);
  for (const x of s.start) b[x.cell] = { kind: 'value', v: x.v };
  const out: ({ kind: CoinKind; v: number } | null)[][] = [];
  for (const st of s.steps) {
    for (const c of st.coins) b[c.cell] = { kind: c.kind, v: c.v };
    for (const col of st.cols)
      for (let c = col * 3; c < col * 3 + 3; c++)
        if (b[c]!.kind === 'value') b[c] = { kind: 'value', v: b[c]!.v * 2 };
    if (st.doubled)
      for (let c = 0; c < 15; c++)
        if (b[c]?.kind === 'value') b[c] = { kind: 'value', v: b[c]!.v * 2 };
    out.push(b.map((x) => (x ? { ...x } : null)));
  }
  return out;
}
