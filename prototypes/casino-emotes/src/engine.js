// Machine n°2 — LE MOTEUR (pur : aucun DOM, utilisable dans le navigateur et dans Node pour le calcul du RTP).
//
// Mécaniques de Book of Ra Deluxe telles que documentées par l'audit du 19/11 (Claude Doc « Raptoru 2.0 — Audit : Book of
// Ra Deluxe et notre machine à sous ») : 5 × 3, 10 lignes fixes (celles de notre machine à fruits), gains de gauche à
// droite, une ligne = un gain (le meilleur). 9 symboles payants (4 forts dès 2, 5 communs dès 3) + le BONUS, qui est à
// la fois WILD (remplace tous les symboles sur une ligne) et scatter (2 / 20 / 200 × la mise totale, n'importe où).
// 3 BONUS ou plus : 10 tours gratuits, même mise ; un symbole payant tiré au hasard (uniforme, 1 sur 9) devient
// extensible pour tout le bonus. Pendant un tour gratuit, s'il est sur assez de rouleaux (2 pour un fort, 3 pour un
// commun, voisins ou non), ces rouleaux se remplissent de lui et il paie sa valeur pour ce nombre de rouleaux × les 10
// lignes, EN PLUS des gains normaux du tour. 3 BONUS pendant les tours gratuits : +10 tours, même symbole.
//
// Les vraies bandes de Novomatic sont inconnues : ces bandes (33 cases, 1 BONUS par rouleau) sont le modèle calibré de
// l'audit. Le RTP réel de CE moteur est calculé exactement par tools/rtp.mjs (README). Tirages indépendants : rien ne
// force un bonus après un nombre de tours.

/** Gains en « × la mise PAR LIGNE » (mise totale = 10 lignes). */
export const PAYS = {
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
/** Le BONUS n'importe où, en « × la mise TOTALE ». */
export const SCATTER_PAYS = { 3: 2, 4: 20, 5: 200 };
export const BONUS = 'bonus';
export const PAYING = Object.keys(PAYS);
export const FREE_GAMES = 10;
/** Borne technique d'un bonus (le vrai jeu n'en annonce aucune) : atteinte avec une probabilité négligeable (< 10⁻²⁰). */
export const MAX_FREE_GAMES = 500;
export const minCount = (id) => (PAYS[id][2] ? 2 : 3);

/** Nos 10 lignes (les mêmes que la machine à fruits) : la rangée (0 haut, 1 milieu, 2 bas) sur chaque rouleau. */
export const LINES = [
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

/** Les bandes calibrées de l'audit (33 cases par rouleau : 1 BONUS, 1 p1, 1–2 p2, 2 p3, 2 p4, 3 à 8 de chaque commun). */
export const STRIPS = [
  ['bonus', 'p4', 'c1', 'c5', 'c3', 'c2', 'c5', 'p1', 'c3', 'p4', 'p3', 'c2', 'c1', 'c5', 'c4', 'c1', 'c3', 'p3', 'c1', 'c5', 'c2', 'c5', 'c3', 'p2', 'c4', 'c5', 'c3', 'c5', 'c1', 'c3', 'c1', 'c4', 'c5'],
  ['c3', 'c5', 'p2', 'c4', 'c5', 'c4', 'p3', 'c4', 'c5', 'c4', 'p2', 'c1', 'c5', 'c1', 'c2', 'c3', 'c2', 'c4', 'c2', 'p1', 'p4', 'c4', 'c2', 'c3', 'c1', 'c4', 'p3', 'c5', 'bonus', 'p4', 'c2', 'c5', 'c2'],
  ['c4', 'c2', 'c1', 'c3', 'p2', 'c5', 'c1', 'c4', 'c3', 'c2', 'c3', 'p4', 'c3', 'bonus', 'c1', 'c5', 'c4', 'c1', 'p3', 'c2', 'c5', 'p3', 'p4', 'c2', 'c5', 'p1', 'c3', 'c2', 'c1', 'c5', 'c3', 'c1', 'c2'],
  ['c2', 'c3', 'c4', 'c3', 'c4', 'p3', 'c2', 'p3', 'c3', 'c4', 'c3', 'p2', 'p1', 'c1', 'c2', 'c1', 'c3', 'p4', 'c2', 'c4', 'c3', 'c5', 'c4', 'c5', 'p2', 'c5', 'c2', 'p4', 'c2', 'bonus', 'c1', 'c4', 'c5'],
  ['bonus', 'c5', 'c4', 'c2', 'p4', 'c2', 'c1', 'c3', 'c2', 'c4', 'c5', 'c4', 'c1', 'c4', 'p4', 'c1', 'c3', 'c5', 'c1', 'p2', 'p1', 'c5', 'c4', 'c5', 'c4', 'c5', 'c3', 'p3', 'c5', 'c1', 'p2', 'c1', 'p3'],
];

export function windowAt(stops) {
  return STRIPS.map((s, r) => [0, 1, 2].map((row) => s[(stops[r] + row) % s.length]));
}

/** Un générateur : crypto dans le navigateur (tirages réels), ou une graine (tests, scénarios Lab). */
export function cryptoRng() {
  const buf = new Uint32Array(1);
  return { int: (n) => (globalThis.crypto.getRandomValues(buf), buf[0] % n), float: () => (globalThis.crypto.getRandomValues(buf), buf[0] / 2 ** 32) };
}
export function seededRng(seed = 1) {
  let a = seed >>> 0 || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  return { int: (n) => Math.floor(next() * n), float: next };
}

/**
 * Les gains d'une grille (grid[reel][row]) pour une mise totale `bet` (Jetons) : lignes + BONUS. Chaque gain de ligne
 * est arrondi à l'inférieur (mise par ligne = bet / 10). Le BONUS remplace tout sur une ligne ; une ligne de BONUS seuls
 * ne paie pas en ligne (elle paie en scatter).
 */
export function evaluate(grid, bet) {
  const lines = [];
  LINES.forEach((L, li) => {
    const ids = L.rows.map((row, r) => grid[r][row]);
    let k = 0;
    while (k < 5 && ids[k] === BONUS) k++;
    if (k === 5) return;
    const sym = ids[k];
    let n = k;
    while (n < 5 && (ids[n] === sym || ids[n] === BONUS)) n++;
    const pay = PAYS[sym][n];
    if (!pay) return;
    const cells = [];
    const wilds = [];
    for (let r = 0; r < n; r++) {
      cells.push([r, L.rows[r]]);
      if (ids[r] === BONUS) wilds.push([r, L.rows[r]]);
    }
    lines.push({ line: li, symbol: sym, count: n, pay, cells, wilds, win: Math.floor((pay * bet) / 10) });
  });
  const cells = [];
  for (let r = 0; r < 5; r++) for (let row = 0; row < 3; row++) if (grid[r][row] === BONUS) cells.push([r, row]);
  const count = cells.length;
  const scatter = { count, cells, win: count >= 3 ? Math.floor(SCATTER_PAYS[Math.min(count, 5)] * bet) : 0 };
  const lineWin = lines.reduce((a, w) => a + w.win, 0);
  return { lines, scatter, lineWin, total: lineWin + scatter.win };
}

/** L'extension d'un tour gratuit : les rouleaux qui montrent `sym` (n'importe quelle rangée), et son gain. */
export function expansionOf(grid, sym, bet) {
  const reels = [];
  for (let r = 0; r < 5; r++) if (grid[r].includes(sym)) reels.push(r);
  if (reels.length < minCount(sym)) return null;
  const pay = PAYS[sym][reels.length];
  return { symbol: sym, reels, n: reels.length, pay, win: Math.floor(pay * bet) };
}

// --- Les scénarios de test du Lab : des positions RÉELLES des bandes, choisies (jamais un gain inventé) ------------
const stopsWith = (r, pred) => STRIPS[r].map((_, i) => i).filter((i) => pred([0, 1, 2].map((j) => STRIPS[r][(i + j) % STRIPS[r].length])));
const pick = (rng, a) => a[rng.int(a.length)];
/**
 * Des positions dont la grille a exactement `k` rouleaux avec `sym` (et, sauf `bonusToo`, aucun BONUS ailleurs) ;
 * `reels` impose lesquels. Construit, pas tiré au sort : seulement pour les scénarios.
 */
export function forcedStops(rng, { sym, k, reels = null, avoidBonus = true }) {
  const chosen = reels ?? shuffle(rng, [0, 1, 2, 3, 4]).slice(0, k);
  return [0, 1, 2, 3, 4].map((r) => {
    const want = chosen.includes(r);
    const ok = stopsWith(r, (w) => (want ? w.includes(sym) : !w.includes(sym)) && (!avoidBonus || sym === BONUS || !w.includes(BONUS)));
    return pick(rng, ok.length ? ok : stopsWith(r, (w) => (want ? w.includes(sym) : !w.includes(sym))));
  });
}
function shuffle(rng, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const randomStops = (rng) => STRIPS.map((s) => rng.int(s.length));

/**
 * Un tour complet, décidé EN ENTIER avant toute animation (comme le Coffre) : le tour de base, et s'il déclenche le
 * bonus, le symbole extensible et chaque tour gratuit (positions, gains, extension, prolongation). `test` : un
 * scénario du Lab (les tours ordinaires n'en tiennent jamais compte).
 *   test = { bonus: 3|4|5, symbol: 'p1', expand: 2..5, retrigger: true, big: true }
 */
export function playRound(rng, bet, test = null) {
  const tr = test ? seededRng((rng.int(2 ** 31) ^ 0x5bd1e995) >>> 0) : null; // les choix d'un scénario : à part
  const baseStops = test?.bonus ? forcedStops(tr, { sym: BONUS, k: test.bonus }) : randomStops(rng);
  const baseGrid = windowAt(baseStops);
  const base = { stops: baseStops, grid: baseGrid, eval: evaluate(baseGrid, bet) };
  let feature = null;
  if (base.eval.scatter.count >= 3) feature = drawFeature(rng, bet, test, tr);
  const payout = base.eval.total + (feature?.total ?? 0);
  return { bet, base, feature, payout, test: test ? { ...test } : null };
}

/** Le bonus entier : le symbole (uniforme), puis les tours gratuits jusqu'au dernier, prolongations comprises. */
export function drawFeature(rng, bet, test = null, tr = null) {
  const symbol = test?.symbol && PAYS[test.symbol] ? test.symbol : PAYING[rng.int(PAYING.length)];
  const spins = [];
  let left = FREE_GAMES;
  let total = 0;
  let series = 1;
  while (left > 0 && spins.length < MAX_FREE_GAMES) {
    left--;
    const i = spins.length;
    let stops;
    if (test && i === 0 && (test.expand || test.big)) stops = forcedStops(tr, { sym: symbol, k: test.big ? 5 : test.expand });
    else if (test?.retrigger && i === 1) stops = forcedStops(tr, { sym: BONUS, k: 3 });
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
    spins.push({ i, stops, grid, eval: ev, expansion, retrigger, win, total, left, series });
  }
  return { symbol, spins, total, games: spins.length, series };
}
