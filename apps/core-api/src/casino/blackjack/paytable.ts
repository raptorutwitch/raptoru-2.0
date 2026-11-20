// Blackjack — the bank bets' grid and the exposure rule, ported unchanged from the validated prototype
// (prototypes/casino-blackjack/src/paytable.js). « paye a:b » = a won for b staked (11:2: 100 → +550, back 650).
// Exact RTP from a full shoe (prototype tools/odds.mjs): 17 94.4 %, 18 90.6 %, 19 93.5 %, 20 89.9 %, 21 94.7 %,
// Blackjack 90.2 %, Bust 95.8 %.

export const SIDE_ODDS = Object.freeze({
  '17': [11, 2],
  '18': [11, 2],
  '19': [6, 1],
  '20': [4, 1],
  '21': [12, 1],
  BJ: [18, 1],
  BUST: [12, 5],
} as const satisfies Record<string, readonly [number, number]>);
export type SideSpot = keyof typeof SIDE_ODDS;
export const SIDE_SPOTS = Object.keys(SIDE_ODDS) as SideSpot[];
export const isSideSpot = (k: string): k is SideSpot => k in SIDE_ODDS;

export interface BlackjackLimits {
  /** Every bet is a multiple of this (3:2 and the odds always land on whole Jetons). */
  step: number;
  mainMin: number;
  sideMin: number;
  /** A player's largest possible NET win in one round (worst case: 4 hands doubled, all won, + the best bank bet). */
  maxWin: number;
  /** A player's largest bank-bet return (stake included) in one round. */
  sideMaxReturn: number;
}
/** The worst case of the main bet: 3 splits then 4 doubles = 8 stakes, all won 1:1. */
export const MAIN_EXPOSURE = 8;

export const sideReturn = (spot: SideSpot, stake: number) =>
  stake + Math.floor((stake * SIDE_ODDS[spot][0]) / SIDE_ODDS[spot][1]);
export const sidePayout = (
  spot: SideSpot,
  stake: number,
  outcome: string | number,
) => (String(spot) === String(outcome) ? sideReturn(spot, stake) : 0);

export type BetProblem =
  | { code: 'bad_main_bet' | 'bad_side_spot' | 'bad_side_bet' }
  | { code: 'side_max_return' | 'max_win'; max: number };

/** Why these bets are refused (null: accepted) — before the deal, with the largest bet still possible. */
export function betProblem(
  { main, side = {} }: { main: unknown; side?: Record<string, unknown> | null },
  L: BlackjackLimits,
): BetProblem | null {
  const ok = (v: unknown, min: number): v is number =>
    typeof v === 'number' &&
    Number.isSafeInteger(v) &&
    v >= min &&
    v % L.step === 0;
  if (!ok(main, L.mainMin)) return { code: 'bad_main_bet' };
  let staked = 0;
  let best = 0;
  for (const [k, v] of Object.entries(side ?? {})) {
    if (!isSideSpot(k)) return { code: 'bad_side_spot' };
    if (!ok(v, L.sideMin)) return { code: 'bad_side_bet' };
    staked += v;
    best = Math.max(best, sideReturn(k, v));
  }
  if (best > L.sideMaxReturn)
    return { code: 'side_max_return', max: L.sideMaxReturn };
  const sideNet = Math.max(0, best - staked);
  if (MAIN_EXPOSURE * main + sideNet > L.maxWin)
    return {
      code: 'max_win',
      max: Math.floor((L.maxWin - sideNet) / MAIN_EXPOSURE / L.step) * L.step,
    };
  return null;
}
