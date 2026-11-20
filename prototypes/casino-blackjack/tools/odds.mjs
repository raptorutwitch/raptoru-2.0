// Blackjack Raptoru — les chiffres de la grille (README § Paris sur la banque).
//   node tools/odds.mjs            → valeurs EXACTES (sabot plein) + estimations par simulation
//   node tools/odds.mjs --quick    → moins de simulation
// EXACT = énumération complète des tirages de la banque (src/odds.js). ESTIMÉ = simulation (écart-type affiché).
import { DECKS, SHOE_SIZE, actions, basicStrategy, dealerHits, dealerOutcome, dealerPeeks, draw, isNatural, newHand, newShoe, settleHand, total, valueOf } from '../src/rules.js';
import { OUTCOMES, dealerDistribution, fullShoe, sideBetRtp } from '../src/odds.js';
import { SIDE_PAYS } from '../src/paytable.js';
import { seeded } from '../src/rng.js';

const quick = process.argv.includes('--quick');
const pct = (x, d = 2) => `${(100 * x).toFixed(d)} %`;

// 1. EXACT : la loi du résultat final de la banque depuis un sabot plein de 8 paquets, et le RTP de chaque pari.
const dist = dealerDistribution(fullShoe(DECKS));
const rtp = sideBetRtp(dist, SIDE_PAYS);
console.log(`\n1. EXACT — résultat final de la banque (8 paquets, reste sur 17 souple, termine toujours sa main)`);
console.log('   résultat   probabilité   paiement brut   RTP       avantage maison');
for (const o of OUTCOMES) console.log(`   ${String(o).padEnd(9)}  ${pct(dist[o], 4).padStart(10)}    ×${String(SIDE_PAYS[o]).padEnd(13)} ${pct(rtp[o]).padStart(8)}  ${pct(1 - rtp[o]).padStart(8)}`);
console.log(`   somme des probabilités : ${Object.values(dist).reduce((a, b) => a + b, 0).toFixed(12)}`);

// 2. ESTIMÉ — une table complète jouée avec la stratégie de base : RTP du jeu principal, et vérification que les
//    décisions des joueurs ne changent pas la loi de la banque (README : échangeabilité).
/** Une manche à `nPlayers` mains de 10, la banque terminant sa main sauf blackjack (dans ce cas, elle a fini). */
function round(shoe, nPlayers, greedy) {
  const firsts = Array.from({ length: nPlayers }, () => [draw(shoe)]);
  const up = draw(shoe);
  firsts.forEach((h) => h.push(draw(shoe)));
  const dealer = [up, draw(shoe)];
  const dNat = dealerPeeks(up) && isNatural(dealer);
  const seats = firsts.map((c) => [newHand(c, 10)]);
  let staked = 10 * nPlayers;
  if (!dNat) {
    for (const seat of seats) {
      for (let i = 0; i < seat.length; i++) {
        const h = seat[i];
        if (h.cards.length === 1) h.cards.push(draw(shoe));
        if (h.splitAces) { h.done = true; continue; }
        while (!h.done) {
          const a = actions(h, { handsCount: seat.length });
          if (!a.stand) { h.done = true; break; }
          const m = greedy ? (total(h.cards).total < 19 ? 'hit' : 'stand') : basicStrategy(h, up, a);
          if (m === 'stand') h.done = true;
          else if (m === 'hit') h.cards.push(draw(shoe));
          else if (m === 'double') { staked += h.stake; h.stake *= 2; h.doubled = true; h.cards.push(draw(shoe)); h.done = true; }
          else {
            const aces = valueOf(h.cards[0]) === 1;
            const other = newHand([h.cards.pop()], h.stake, { fromSplit: true, splitAces: aces });
            staked += h.stake;
            h.fromSplit = true; h.splitAces = aces;
            h.cards.push(draw(shoe));
            seat.splice(i + 1, 0, other);
            if (aces) { other.cards.push(draw(shoe)); other.done = true; h.done = true; }
          }
        }
      }
    }
  }
  while (!dNat && dealerHits(dealer)) dealer.push(draw(shoe));
  let paid = 0;
  for (const seat of seats) for (const h of seat) paid += settleHand(h, dealer).payout;
  return { outcome: dealerOutcome(dealer), staked, paid };
}

function simulate({ rounds, players, greedy, seed }) {
  const rng = seeded(seed);
  let shoe = newShoe(rng);
  const seen = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  let staked = 0;
  let paid = 0;
  for (let r = 0; r < rounds; r++) {
    if (shoe.pos >= shoe.cut) shoe = newShoe(rng);
    const x = round(shoe, players, greedy);
    seen[x.outcome]++;
    staked += x.staked;
    paid += x.paid;
  }
  return { seen, rtpMain: paid / staked, rounds };
}
const N = quick ? 60_000 : 400_000;
console.log(`\n2. ESTIMÉ (simulation, ${N.toLocaleString('fr-FR')} manches à 7 joueurs, stratégie de base, coupe à 25 %)`);
const sim = simulate({ rounds: N, players: 7, greedy: false, seed: 1 });
const hands = N * 7;
const sdMain = 1.15 / Math.sqrt(hands); // écart-type d'une main de blackjack ≈ 1,15 mise
console.log(`   RTP du jeu principal ≈ ${pct(sim.rtpMain)} (± ${pct(2 * sdMain)} à 95 %) — avantage maison ≈ ${pct(1 - sim.rtpMain)}`);
console.log('   résultat de la banque : simulé vs exact');
for (const o of OUTCOMES) {
  const p = sim.seen[o] / N;
  const sd = Math.sqrt((dist[o] * (1 - dist[o])) / N);
  console.log(`   ${String(o).padEnd(5)} ${pct(p, 3).padStart(9)} vs ${pct(dist[o], 3).padStart(9)}   écart ${((p - dist[o]) / sd).toFixed(2)} σ`);
}
const g = simulate({ rounds: N, players: 7, greedy: true, seed: 2 });
console.log('   avec des joueurs qui tirent jusqu’à 19 (la banque doit rester identique) :');
for (const o of OUTCOMES) {
  const p = g.seen[o] / N;
  const sd = Math.sqrt((dist[o] * (1 - dist[o])) / N);
  console.log(`   ${String(o).padEnd(5)} ${pct(p, 3).padStart(9)}   écart ${((p - dist[o]) / sd).toFixed(2)} σ`);
}

// 3. EXACT par manche, ESTIMÉ sur les sabots : ce qu'un compteur parfait (qui connaît toutes les cartes sorties)
//    pourrait gagner en ne misant sur la banque que lorsque c'est favorable.
function counting(cut, shoes, seed) {
  const rng = seeded(seed);
  const st = Object.fromEntries(OUTCOMES.map((o) => [o, { pos: 0, max: -1, gain: 0 }]));
  let rounds = 0;
  for (let k = 0; k < shoes; k++) {
    const shoe = newShoe(rng);
    shoe.cut = Math.round(SHOE_SIZE * cut);
    while (shoe.pos < shoe.cut) {
      const counts = fullShoe(DECKS);
      for (let i = 0; i < shoe.pos; i++) counts[valueOf(shoe.cards[i]) - 1]--;
      const d = dealerDistribution(counts);
      rounds++;
      for (const o of OUTCOMES) {
        const ev = d[o] * SIDE_PAYS[o] - 1;
        if (ev > 0) (st[o].pos++, (st[o].gain += ev));
        st[o].max = Math.max(st[o].max, ev);
      }
      round(shoe, 7, false);
    }
  }
  return { st, rounds };
}
const SHOES = quick ? 150 : 800;
for (const cut of [0.25, 0.5]) {
  const { st, rounds } = counting(cut, SHOES, 3);
  console.log(`\n3. Compteur parfait, coupe à ${cut * 100} % (${SHOES} sabots, ${rounds} manches à 7 joueurs) — EXACT manche par manche`);
  console.log('   pari    manches favorables   meilleur cas   gain moyen par manche (s’il ne mise QUE dans ces cas)');
  for (const o of OUTCOMES) console.log(`   ${String(o).padEnd(6)}  ${pct(st[o].pos / rounds).padStart(10)}          ${pct(st[o].max).padStart(8)}      ${pct(st[o].gain / rounds, 3)} de la mise`);
}
