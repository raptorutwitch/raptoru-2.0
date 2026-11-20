// Ported unchanged from the validated casino prototype (prototypes/casino-v8 · bets.js); docs/CASINO.md.
// Display only: every result comes from the Core.
// Mises : paliers progressifs des boutons + / −, saisie libre, contrôles. Commun à la machine à sous et à la roulette.
// + : le premier palier AU-DESSUS de la mise ; − : le premier palier EN DESSOUS (symétrique). Une mise saisie librement
// (ex. 37) reste valable : + / − la ramènent sur la grille des paliers (40 / 30).


/** [jusqu'à (exclu), pas] — 20→100 par 10, →500 par 50, →1 000 par 100, →5 000 par 500, puis 1 000, 5 000… */
const STEPS = [
  [100, 10],
  [500, 50],
  [1000, 100],
  [5000, 500],
  [10000, 1000],
  [50000, 5000],
  [100000, 10000],
  [Infinity, 50000],
];
const stepAt = (v) => STEPS.find(([lim]) => v < lim)[1];

function next(bet, dir, { min, max }) {
  let n;
  if (dir > 0) {
    const s = stepAt(bet);
    n = Math.floor(bet / s) * s + s;
  } else {
    const s = stepAt(bet - 1);
    n = Math.ceil(bet / s) * s - s;
  }
  return Math.max(min, Math.min(max, n));
}

/** « 1 500 », « 1500 », « 1,5k », « 2K », « 1.2 k » → entier ; sinon null. */
function parse(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/[\s\u00a0\u202f]/g, '');
  const m = /^(\d+(?:[.,]\d+)?)(k|m)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.')) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1);
  return Number.isInteger(v) && v > 0 ? v : null;
}

/** Pourquoi une mise est refusée (null : acceptée). */
function error(bet, { min, max, balance }) {
  if (!Number.isInteger(bet) || bet <= 0) return 'invalid';
  if (bet < min) return 'min';
  if (bet > max) return 'max';
  if (bet > balance) return 'balance';
  return null;
}

export const ArcadeBets = { STEPS, stepAt, next, parse, error };
