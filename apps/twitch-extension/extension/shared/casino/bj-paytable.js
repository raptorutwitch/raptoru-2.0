// Casino V1 — the bank bets' grid for the SCREEN (odds, the exposure check that explains a refusal before sending):
// a copy of the validated prototype (prototypes/casino-blackjack/src/paytable.js). The Core re-checks every bet.
// Blackjack Raptoru — la grille des paris sur la banque, les limites et la règle d'exposition (partagée : le Core
// décide, l'écran applique la même règle AVANT d'envoyer pour expliquer un refus).
// La grille V3 (19/11) se lit comme au casino : « paye a:b » (gain net pour une mise de b), sans virgule. Les cotes
// ont des dénominateurs 1, 2 ou 5 : toute mise en multiple de 10 paie un nombre entier de Jetons.
// RTP EXACTS depuis un sabot plein (src/odds.js, tools/odds.mjs) : de 89,9 à 95,8 % (avantage maison 4 à 10 %,
// comme les paris commerciaux du même type) ; README § Paris sur la banque pour l'avant/après et l'anti-comptage.
export const SIDE_ODDS = Object.freeze({ 17: [11, 2], 18: [11, 2], 19: [6, 1], 20: [4, 1], 21: [12, 1], BJ: [18, 1], BUST: [12, 5] });
/** Multiplicateur BRUT (mise comprise), dérivé des cotes : 11:2 → 6,5. */
export const SIDE_PAYS = Object.freeze(Object.fromEntries(Object.entries(SIDE_ODDS).map(([k, [a, b]]) => [k, 1 + a / b])));
export const oddsText = (k) => SIDE_ODDS[k].join(':');
export const SIDE_LABEL = Object.freeze({ 17: '17', 18: '18', 19: '19', 20: '20', 21: '21', BJ: 'Blackjack', BUST: 'Bust' });
export const SIDE_SPOTS = Object.freeze(Object.keys(SIDE_PAYS));

/** Réglages du prototype (FICTIFS, modifiables : Lab › Économie). Au Core : réglages Studio du Casino. */
export const LIMITS = Object.freeze({
  step: 10, // toute mise est un multiple de 10 : le 3:2 et les retours au dixième tombent toujours juste
  mainMin: 100, // mise principale minimum ; aucun maximum fixe : c'est le gain potentiel qui est borné
  sideMin: 10,
  maxWin: 1_000_000, // gain NET potentiel maximum d'un joueur sur une manche (pire cas : 4 mains doublées gagnées)
  sideMaxReturn: 100_000, // retour maximum des paris sur la banque d'un joueur, sur une manche
});
/** Le pire cas de la mise principale : 3 splits puis 4 doubles = 8 mises engagées, toutes gagnées 1:1. */
export const MAIN_EXPOSURE = 8;

// Calcul en entiers : aucun flottant sur des Jetons.
/** Le retour (mise comprise) d'un pari sur la banque s'il gagne : mise + mise × a / b, en entiers. */
export const sideReturn = (spot, stake) => stake + Math.floor((stake * SIDE_ODDS[spot][0]) / SIDE_ODDS[spot][1]);
/** Le paiement brut d'un pari sur la banque (0 si perdu). */
export const sidePayout = (spot, stake, outcome) => (String(spot) === String(outcome) ? sideReturn(spot, stake) : 0);

/**
 * Pourquoi ces mises sont refusées (null : acceptées). Jamais de gain plafonné après coup : ce qui pourrait dépasser
 * la limite est refusé AVANT la donne, avec la mise maximale encore possible (`max`).
 */
export function betProblem({ main, side = {} }, limits = LIMITS) {
  const ok = (v, min) => Number.isSafeInteger(v) && v >= min && v % limits.step === 0;
  if (!ok(main, limits.mainMin)) return { code: 'bad_main_bet' };
  let staked = 0;
  let best = 0;
  for (const [k, v] of Object.entries(side ?? {})) {
    if (!SIDE_SPOTS.includes(k)) return { code: 'bad_side_spot' };
    if (!ok(v, limits.sideMin)) return { code: 'bad_side_bet' };
    staked += v;
    best = Math.max(best, sideReturn(k, v)); // les résultats sont exclusifs : un seul pari banque peut gagner
  }
  if (best > limits.sideMaxReturn) return { code: 'side_max_return', max: limits.sideMaxReturn };
  const sideNet = Math.max(0, best - staked);
  if (MAIN_EXPOSURE * main + sideNet > limits.maxWin) {
    return { code: 'max_win', max: Math.floor((limits.maxWin - sideNet) / MAIN_EXPOSURE / limits.step) * limits.step };
  }
  return null;
}
