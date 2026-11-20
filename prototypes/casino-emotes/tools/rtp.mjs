// Le RTP RÉEL du moteur de la machine n°2 : calcul exact (toutes les positions des bandes) + simulation du moteur lui-même.
//   node tools/rtp.mjs [bonus simulés = 300000] [tours simulés = 2000000]
// 1. Parité : l'évaluateur rapide ci-dessous donne exactement les gains de engine.evaluate / expansionOf (200 000 grilles).
// 2. Exact : jeu de base (lignes + BONUS), déclenchement, et pour chaque symbole extensible l'espérance d'un tour
//    gratuit ; nombre moyen de tours gratuits (prolongations comprises) = 10 / (1 − 10·p), p = P(3 BONUS) par tour.
// 3. Monte-Carlo de engine.playRound (le code que joue la page) : RTP observé, distribution des bonus, séries sans bonus.
// Les gains sont calculés en « × la mise » sans arrondi (l'arrondi à l'inférieur des Jetons, pour une mise multiple de 10,
// ne change rien ; pour une autre mise, il retire au plus un Jeton par ligne).
import { BONUS, evaluate, expansionOf, LINES, minCount, PAYING, PAYS, playRound, SCATTER_PAYS, seededRng, STRIPS, windowAt } from '../src/engine.js';

const NB = Number(process.argv[2] ?? 300_000);
const NS = Number(process.argv[3] ?? 2_000_000);
const ids = [...PAYING, BONUS];
const B = PAYING.length;
const code = Object.fromEntries(ids.map((s, i) => [s, i]));
const PAY = PAYING.map((s) => [0, 1, 2, 3, 4, 5].map((n) => PAYS[s][n] ?? 0));
const MIN = PAYING.map(minCount);
const SC = (n) => (n >= 3 ? SCATTER_PAYS[Math.min(n, 5)] : 0);
const R = STRIPS.map((s) => {
  const L = s.length, win = new Int8Array(L * 3), mask = new Int32Array(L), books = new Int8Array(L);
  for (let i = 0; i < L; i++)
    for (let j = 0; j < 3; j++) {
      const c = code[s[(i + j) % L]];
      win[i * 3 + j] = c;
      if (c === B) books[i]++;
      else mask[i] |= 1 << c;
    }
  return { L, win, mask, books };
});
const LR = LINES.map((l) => Int8Array.from(l.rows));
const ids5 = new Int8Array(5);
function lineSum(st) {
  let tot = 0;
  for (const l of LR) {
    for (let r = 0; r < 5; r++) ids5[r] = R[r].win[st[r] * 3 + l[r]];
    let k = 0;
    while (k < 5 && ids5[k] === B) k++;
    if (k === 5) continue;
    const s = ids5[k];
    let m = k;
    while (m < 5 && (ids5[m] === s || ids5[m] === B)) m++;
    tot += PAY[s][m];
  }
  return tot / 10; // × la mise totale
}

// 1. Parité avec le moteur (mise 1000 : arrondis exacts)
{
  const rng = seededRng(99);
  let bad = 0;
  for (let i = 0; i < 200_000; i++) {
    const st = STRIPS.map((s) => rng.int(s.length));
    const g = windowAt(st);
    const ev = evaluate(g, 1000);
    const fast = Math.round(lineSum(st) * 1000);
    const nb = st.reduce((a, s, r) => a + R[r].books[s], 0);
    if (fast !== ev.lineWin || Math.round(SC(nb) * 1000) !== ev.scatter.win) bad++;
    for (const sym of PAYING) {
      const e = expansionOf(g, sym, 1000);
      const reels = st.reduce((a, s, r) => a + (R[r].mask[s] & (1 << code[sym]) ? 1 : 0), 0);
      const want = reels >= minCount(sym) ? PAYS[sym][reels] * 1000 : 0;
      if ((e?.win ?? 0) !== want) bad++;
    }
  }
  console.log(`Parité évaluateur rapide / moteur : ${bad === 0 ? 'identique' : `${bad} ÉCARTS`} sur 200 000 grilles`);
  if (bad) process.exit(1);
}

// 2. Exact
const st = [0, 0, 0, 0, 0];
let n = 0, base = 0, scat = 0, trig = 0, hits = 0;
const exp = new Float64Array(B);
const counts = [0, 0, 0, 0, 0, 0];
for (st[0] = 0; st[0] < R[0].L; st[0]++)
  for (st[1] = 0; st[1] < R[1].L; st[1]++)
    for (st[2] = 0; st[2] < R[2].L; st[2]++)
      for (st[3] = 0; st[3] < R[3].L; st[3]++)
        for (st[4] = 0; st[4] < R[4].L; st[4]++) {
          n++;
          const lw = lineSum(st);
          const nb = R[0].books[st[0]] + R[1].books[st[1]] + R[2].books[st[2]] + R[3].books[st[3]] + R[4].books[st[4]];
          counts[nb]++;
          base += lw;
          scat += SC(nb);
          if (lw > 0 || nb >= 3) hits++;
          if (nb >= 3) trig++;
          const m = [R[0].mask[st[0]], R[1].mask[st[1]], R[2].mask[st[2]], R[3].mask[st[3]], R[4].mask[st[4]]];
          for (let s = 0; s < B; s++) {
            const bit = 1 << s;
            const k = (m[0] & bit ? 1 : 0) + (m[1] & bit ? 1 : 0) + (m[2] & bit ? 1 : 0) + (m[3] & bit ? 1 : 0) + (m[4] & bit ? 1 : 0);
            if (k >= MIN[s]) exp[s] += PAY[s][k];
          }
        }
const p = trig / n;
const nFree = 10 / (1 - 10 * p); // tours gratuits joués en moyenne (les tours gratuits utilisent les mêmes bandes)
const perFree = (base + scat) / n; // lignes + BONUS d'un tour gratuit
const perExp = PAYING.map((s, i) => exp[i] / n);
const meanExp = perExp.reduce((a, b) => a + b, 0) / B;
const featureMean = nFree * (perFree + meanExp);
const exact = {
  positions: n,
  rtp: base / n + scat / n + p * featureMean,
  base: base / n,
  scatter: scat / n,
  feature: p * featureMean,
  trigger: 1 / p,
  hit: hits / n,
  freeGames: nFree,
  featureMean,
  perSymbol: Object.fromEntries(PAYING.map((s, i) => [s, nFree * (perFree + perExp[i])])),
  bonusCounts: { 3: counts[3] / n, 4: counts[4] / n, 5: counts[5] / n },
};

// 3. Monte-Carlo du moteur
const rng = seededRng(20261119);
const feats = [];
let won = 0, bet = 0, trigs = 0, gap = 0, maxGap = 0, longest = 0, retrig = 0;
const gaps = [];
for (let i = 0; i < NS; i++) {
  const r = playRound(rng, 1000);
  bet += 1000;
  won += r.payout;
  gap++;
  if (r.feature) {
    trigs++;
    feats.push(r.feature.total / 1000);
    gaps.push(gap);
    maxGap = Math.max(maxGap, gap);
    gap = 0;
    longest = Math.max(longest, r.feature.games);
    if (r.feature.series > 1) retrig++;
  }
}
// bonus seuls (plus nombreux, pour la distribution)
for (let i = feats.length; i < NB; i++) {
  const r = playRound(rng, 1000, { bonus: 3 });
  feats.push(r.feature.total / 1000);
}
feats.sort((a, b) => a - b);
const q = (x) => feats[Math.min(feats.length - 1, Math.floor(x * feats.length))];
const share = (t) => feats.filter((v) => v >= t).length / feats.length;
const noBonus = (k) => (1 - p) ** k;
const out = {
  exact,
  simulated: {
    spins: NS,
    rtp: won / bet,
    trigger: NS / trigs,
    withRetrigger: retrig / trigs,
    longestFeature: longest,
    longestGapSeen: maxGap,
  },
  feature: {
    n: feats.length,
    mean: feats.reduce((a, b) => a + b, 0) / feats.length,
    median: q(0.5),
    p10: q(0.1),
    p90: q(0.9),
    p99: q(0.99),
    max: feats.at(-1),
    under5: 1 - share(5),
    over100: share(100),
    over500: share(500),
    over1000: share(1000),
  },
  noBonusFor: Object.fromEntries([10, 50, 100, 150, 200].map((k) => [k, noBonus(k)])),
};
const pc = (x) => `${(x * 100).toFixed(2)} %`;
console.log(`
RTP EXACT du moteur : ${pc(exact.rtp)}  (jeu de base ${pc(exact.base)} · BONUS scatter ${pc(exact.scatter)} · tours gratuits ${pc(exact.feature)})
Bonus : 1 tour sur ${exact.trigger.toFixed(1)} · ${exact.freeGames.toFixed(2)} tours gratuits en moyenne · bonus moyen ${exact.featureMean.toFixed(1)} × la mise
Tours gagnants : ${pc(exact.hit)} · ${exact.positions.toLocaleString('fr-FR')} positions énumérées
Simulation du moteur (${NS.toLocaleString('fr-FR')} tours) : RTP ${pc(out.simulated.rtp)}, bonus 1 sur ${out.simulated.trigger.toFixed(1)}, prolongé ${pc(out.simulated.withRetrigger)}
Bonus (${feats.length.toLocaleString('fr-FR')}) : médiane ${out.feature.median} ×, moyenne ${out.feature.mean.toFixed(1)} ×, 90 % sous ${out.feature.p90} ×, max ${out.feature.max} × ; < 5 × : ${pc(out.feature.under5)} ; ≥ 100 × : ${pc(out.feature.over100)} ; ≥ 1 000 × : ${pc(out.feature.over1000)}
Aucun bonus pendant 10 / 50 / 100 / 150 / 200 tours : ${[10, 50, 100, 150, 200].map((k) => pc(noBonus(k))).join(' / ')}`);
(await import('node:fs')).writeFileSync(new URL('../rtp-result.json', import.meta.url), JSON.stringify(out, null, 1));
