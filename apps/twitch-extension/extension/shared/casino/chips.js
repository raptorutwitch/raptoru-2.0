// Ported from the validated casino prototype (prototypes/casino-v8 · chips.js); docs/CASINO.md.
// Display only: every result comes from the Core.
// Change from the prototype: each roulette bet is a multiple of 20 (Antoni, 18/11), so the 50 and 250 chips became
// 40 and 200 (same colours, same places in the row), and ALL-IN / the custom chip follow the Core's step.
// Roulette — les jetons proposés selon la richesse du joueur, et le jeton libre.
// Les règles économiques réelles sont celles du Core (jeton ≥ 20 et multiple de 20, plafond par tour, jamais plus que
// le solde) : on choisit seulement les six valeurs affichées, pour qu'un petit solde ait les petites mises sous la main
// et qu'un gros solde atteigne une grosse mise en deux ou trois touches.


/** Toutes les valeurs de jeton possibles (une couleur chacune), toutes multiples de 20. */
const LADDER = [20, 40, 100, 200, 500, 1000, 2500, 5000, 10000, 25000, 50000];

/** Paliers de richesse : à partir de `from` Jetons, ces six jetons. */
const TIERS = [
  { id: 'modeste', label: 'Modeste', from: 0, chips: [20, 40, 100, 200, 500, 1000] },
  { id: 'standard', label: 'Standard', from: 10000, chips: [20, 100, 500, 1000, 5000, 25000] },
  { id: 'riche', label: 'Riche', from: 250000, chips: [100, 500, 1000, 5000, 25000, 50000] },
];
const tierFor = (balance) => TIERS.slice().reverse().find((t) => balance >= t.from);

/** Le jeton d'une pile : la plus grosse valeur de l'échelle qu'elle contient (sa couleur). */
const tone = (v) => LADDER.slice().reverse().find((c) => v >= c) || LADDER[0];

/** Pourquoi un montant de jeton libre est refusé (null : accepté). `step` : chaque mise en est un multiple. */
function customError(v, { min, maxTotal, balance, step = 1 }) {
  if (!Number.isInteger(v) || v <= 0) return 'invalid';
  if (v % step) return 'step';
  if (v < min) return 'min';
  if (v > maxTotal) return 'max';
  if (v > balance) return 'balance';
  return null;
}

/**
 * ALL-IN : tout ce qui reste LÉGALEMENT engageable sur ce tour — le solde, dans la limite du plafond par tour, moins
 * les jetons déjà posés sur le tapis, arrondi AU-DESSOUS au multiple de `step`. amount = 0 s'il reste moins d'un jeton
 * minimum (pas de mise invalide). capped : c'est le plafond par tour (et non le solde) qui limite.
 */
function allIn({ balance, staked, maxTotal, min, step = 1 }) {
  const room = Math.floor(Math.max(0, Math.min(balance, maxTotal) - staked) / step) * step;
  return { amount: room >= min ? room : 0, capped: maxTotal < balance };
}

export const ArcadeChips = { LADDER, TIERS, tierFor, tone, customError, allIn };
