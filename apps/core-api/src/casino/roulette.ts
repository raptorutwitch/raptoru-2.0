// Casino — European roulette with several bets per spin (docs/CASINO.md § 4), ported from the validated prototype
// (prototypes/casino-v8, shared/table.js, audited). 37 pockets in the real wheel order. Payouts are GROSS (stake
// included): straight ×36 · column ×3 · dozen ×3 · red/black, even/odd, 1-18/19-36 ×2. The 0 loses every bet but the
// bet on 0. RTP of every bet = 36/37 ≈ 97.30 %. Each bet is a multiple of 20 Jetons (Antoni, 18/11).

export const ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);
export const colorOf = (n: number) =>
  n === 0 ? 'green' : RED.has(n) ? 'red' : 'black';

interface Spot {
  pays: number;
  covers(n: number): boolean;
}
export const SPOTS: Readonly<Record<string, Spot>> = (() => {
  const s: Record<string, Spot> = {
    red: { pays: 2, covers: (n) => colorOf(n) === 'red' },
    black: { pays: 2, covers: (n) => colorOf(n) === 'black' },
    even: { pays: 2, covers: (n) => n !== 0 && n % 2 === 0 },
    odd: { pays: 2, covers: (n) => n % 2 === 1 },
    low: { pays: 2, covers: (n) => n >= 1 && n <= 18 },
    high: { pays: 2, covers: (n) => n >= 19 },
    d1: { pays: 3, covers: (n) => n >= 1 && n <= 12 },
    d2: { pays: 3, covers: (n) => n >= 13 && n <= 24 },
    d3: { pays: 3, covers: (n) => n >= 25 },
    c1: { pays: 3, covers: (n) => n > 0 && n % 3 === 1 },
    c2: { pays: 3, covers: (n) => n > 0 && n % 3 === 2 },
    c3: { pays: 3, covers: (n) => n > 0 && n % 3 === 0 },
  };
  for (let n = 0; n <= 36; n++)
    s[`n${n}`] = { pays: 36, covers: (x) => x === n };
  return Object.freeze(s);
})();

export const BET_STEP = 20;

export type RouletteBets = Record<string, number>;
export type RouletteRefusal =
  | 'empty'
  | 'unknown_spot'
  | 'invalid_amount'
  | 'not_multiple'
  | 'too_many_bets'
  | 'above_max';

/**
 * Why a set of bets is refused (null: accepted). Only the mat's OWN spots (never `__proto__`, `constructor`…); each
 * amount a whole multiple of 20; the total under the per-spin maximum. The balance is checked by the wallet.
 */
export function rouletteError(
  bets: unknown,
  maxTotal: number,
): RouletteRefusal | null {
  if (!bets || typeof bets !== 'object' || Array.isArray(bets)) return 'empty';
  const ids = Object.keys(bets);
  if (!ids.length) return 'empty';
  if (ids.length > 49) return 'too_many_bets';
  let total = 0;
  for (const id of ids) {
    if (!Object.prototype.hasOwnProperty.call(SPOTS, id)) return 'unknown_spot';
    const v = (bets as Record<string, unknown>)[id];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < BET_STEP)
      return 'invalid_amount';
    if (v % BET_STEP !== 0) return 'not_multiple';
    total += v;
  }
  if (total > maxTotal) return 'above_max';
  return null;
}

export const stakeOf = (bets: RouletteBets) =>
  Object.values(bets).reduce((s, v) => s + v, 0);

/** The result of a pocket for these bets. */
export function settleRoulette(bets: RouletteBets, number: number) {
  const wins: { id: string; amount: number; gross: number }[] = [];
  let gross = 0;
  for (const [id, amount] of Object.entries(bets)) {
    if (SPOTS[id]!.covers(number)) {
      const g = amount * SPOTS[id]!.pays;
      wins.push({ id, amount, gross: g });
      gross += g;
    }
  }
  const stake = stakeOf(bets);
  return { stake, gross, net: gross - stake, wins };
}
