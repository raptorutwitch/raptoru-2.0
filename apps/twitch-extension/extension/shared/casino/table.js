// Ported unchanged from the validated casino prototype (prototypes/casino-v8 · table.js); docs/CASINO.md.
// Display only: every result comes from the Core.
// Roulette européenne à paris multiples — tirage et paiement, sans affichage.
// 37 cases (0-36) dans l'ordre réel de la roue. Plusieurs paris par tour, comme des jetons posés sur un tapis :
//   numéro plein ×36 · colonne ×3 · douzaine ×3 · rouge/noir, pair/impair, 1-18/19-36 ×2 (paiement BRUT, mise comprise).
// Le 0 fait perdre tout sauf le pari sur le 0. RTP de chaque pari = 36/37 ≈ 97,30 %.


const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const color = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

/** Chaque emplacement du tapis : ce qu'il couvre et ce qu'il paie. */
const SPOTS = {
  red: { label: 'Rouge', short: 'R', pays: 2, covers: (n) => color(n) === 'red' },
  black: { label: 'Noir', short: 'N', pays: 2, covers: (n) => color(n) === 'black' },
  even: { label: 'Pair', short: 'P', pays: 2, covers: (n) => n !== 0 && n % 2 === 0 },
  odd: { label: 'Impair', short: 'I', pays: 2, covers: (n) => n % 2 === 1 },
  low: { label: '1–18', short: '1–18', pays: 2, covers: (n) => n >= 1 && n <= 18 },
  high: { label: '19–36', short: '19–36', pays: 2, covers: (n) => n >= 19 },
  d1: { label: '1–12', short: '1er 12', pays: 3, covers: (n) => n >= 1 && n <= 12 },
  d2: { label: '13–24', short: '2e 12', pays: 3, covers: (n) => n >= 13 && n <= 24 },
  d3: { label: '25–36', short: '3e 12', pays: 3, covers: (n) => n >= 25 },
  c1: { label: 'Colonne 1', short: '2:1', pays: 3, covers: (n) => n > 0 && n % 3 === 1 },
  c2: { label: 'Colonne 2', short: '2:1', pays: 3, covers: (n) => n > 0 && n % 3 === 2 },
  c3: { label: 'Colonne 3', short: '2:1', pays: 3, covers: (n) => n > 0 && n % 3 === 0 },
};
for (let n = 0; n <= 36; n++) SPOTS[`n${n}`] = { label: `N° ${n}`, short: String(n), pays: 36, number: n, covers: (x) => x === n };

const LIMITS = { chipMin: 20, maxTotal: 100000 };
const CHIPS = [20, 100, 500, 1000, 5000, 25000];

const total = (bets) => Object.values(bets).reduce((s, v) => s + v, 0);

/** Pourquoi un ensemble de paris est refusé (null : accepté). */
function error(bets, balance) {
  if (!bets || typeof bets !== 'object' || Array.isArray(bets)) return 'empty';
  const ids = Object.keys(bets);
  if (!ids.length) return 'empty';
  for (const id of ids) {
    // V7 (audit) : une case PROPRE du tapis — « __proto__ » ou « constructor » existent sur tout objet et passaient.
    if (!Object.prototype.hasOwnProperty.call(SPOTS, id)) return 'unknown_spot';
    const v = bets[id];
    if (!Number.isInteger(v) || v < LIMITS.chipMin) return 'min';
  }
  const t = total(bets);
  if (t > LIMITS.maxTotal) return 'max';
  if (t > balance) return 'balance';
  return null;
}

/** Le résultat d'une case tirée pour ces paris. */
function settle(bets, number) {
  const wins = [];
  let gross = 0;
  for (const [id, amount] of Object.entries(bets)) {
    if (SPOTS[id].covers(number)) {
      const g = amount * SPOTS[id].pays;
      wins.push({ id, amount, gross: g });
      gross += g;
    }
  }
  const stake = total(bets);
  return { stake, gross, net: gross - stake, wins };
}

/** Un tour, décidé ENTIÈREMENT ici avant l'animation. `opts.pocket` : case imposée (démonstration seulement). */
function play(bets, balance, rng, opts = {}) {
  const err = error(bets, balance);
  if (err) return { error: err };
  const pocket = opts.pocket !== undefined ? opts.pocket : rng.int(ORDER.length);
  const number = ORDER[pocket];
  return { pocket, number, color: color(number), bets: { ...bets }, ...settle(bets, number) };
}

export const ArcadeTable = { ORDER, RED, color, SPOTS, LIMITS, CHIPS, total, error, settle, play };
