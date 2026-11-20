import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOMES, dealerDistribution, fullShoe, sideBetRtp } from '../src/odds.js';
import { SIDE_PAYS } from '../src/paytable.js';
import * as R from '../src/rules.js';
import { seeded } from '../src/rng.js';

test('loi exacte de la banque : somme 1, valeurs de référence (8 paquets, S17)', () => {
  const d = dealerDistribution(fullShoe(8));
  assert.ok(Math.abs(OUTCOMES.reduce((a, o) => a + d[o], 0) - 1) < 1e-12);
  // Références publiées (sabot infini, S17) : bust ≈ 28,2 %, blackjack ≈ 4,7 %, 20 ≈ 18 %.
  assert.ok(Math.abs(d.BUST - 0.2818) < 0.001, d.BUST);
  assert.ok(Math.abs(d.BJ - 2 * (32 / 416) * (128 / 415)) < 1e-12, 'BJ = 2·P(As)·P(10 | As) exactement');
  assert.ok(Math.abs(d[20] - 0.1797) < 0.001);
});

test('loi exacte sur une petite composition vérifiable à la main', () => {
  // Seulement des 10 et des 7 : 10+10=20, 10+7=17, 7+7=14 → +7=21 ou +10=24.
  const counts = Array(10).fill(0);
  counts[6] = 2; // deux 7
  counts[9] = 2; // deux 10
  const d = dealerDistribution(counts);
  // P(10,10)=2/4·1/3=1/6 → 20 ; P(10,7)+P(7,10)=2·(2/4·2/3)=2/3 → 17 ; P(7,7)=1/6 → 14 puis 10,10 restants → 24 bust.
  assert.ok(Math.abs(d[20] - 1 / 6) < 1e-12);
  assert.ok(Math.abs(d[17] - 2 / 3) < 1e-12);
  assert.ok(Math.abs(d.BUST - 1 / 6) < 1e-12);
});

test('grille : chaque pari sur la banque rend entre 89 et 96 % (jamais favorable), cotes a:b sans virgule', () => {
  const rtp = sideBetRtp(dealerDistribution(fullShoe(8)), SIDE_PAYS);
  for (const o of OUTCOMES) assert.ok(rtp[o] > 0.89 && rtp[o] < 0.96, `${o} : ${rtp[o]}`);
});

test('ESTIMATION : les décisions des joueurs ne changent pas la loi de la banque (échangeabilité)', () => {
  // Des joueurs « gourmands » qui tirent jusqu'à 19 ; 40 000 manches ; tolérance 4 σ.
  const exact = dealerDistribution(fullShoe(8));
  const rng = seeded(11);
  let shoe = R.newShoe(rng);
  const n = 40_000;
  const seen = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  for (let r = 0; r < n; r++) {
    if (R.shoeNeedsShuffle(shoe)) shoe = R.newShoe(rng);
    const hands = Array.from({ length: 6 }, () => [R.draw(shoe)]);
    const dealer = [R.draw(shoe)];
    hands.forEach((h) => h.push(R.draw(shoe)));
    dealer.push(R.draw(shoe));
    if (!(R.dealerPeeks(dealer[0]) && R.isNatural(dealer))) for (const h of hands) while (R.total(h).total < 19) h.push(R.draw(shoe));
    while (!R.isNatural(dealer) && R.dealerHits(dealer)) dealer.push(R.draw(shoe));
    seen[R.dealerOutcome(dealer)]++;
  }
  for (const o of OUTCOMES) {
    const sd = Math.sqrt((exact[o] * (1 - exact[o])) / n);
    assert.ok(Math.abs(seen[o] / n - exact[o]) < 4 * sd, `${o} : ${seen[o] / n} vs ${exact[o]}`);
  }
});
