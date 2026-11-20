import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/rules.js';
import { SIDE_PAYS, sidePayout } from '../src/paytable.js';

// Des cartes par VALEUR (1 = As, 10 = dix) : l'identité 0…415 d'une carte de cette valeur.
const C = (v, k = 0) => (v === 10 ? 9 + (k % 4) : v - 1) + 13 * (k % 4);
const H = (...vs) => vs.map((v, k) => C(v, k));

test('valeurs : As 1 ou 11, figures 10', () => {
  assert.equal(R.valueOf(C(1)), 1);
  for (const k of [0, 1, 2, 3]) assert.equal(R.valueOf(9 + k), 10); // 10, V, D, R
  assert.deepEqual(R.total(H(1, 6)), { total: 17, soft: true });
  assert.deepEqual(R.total(H(1, 6, 10)), { total: 17, soft: false });
  assert.deepEqual(R.total(H(1, 1, 9)), { total: 21, soft: true });
  assert.deepEqual(R.total(H(1, 1, 1, 1)), { total: 14, soft: true });
  assert.deepEqual(R.total(H(10, 10, 2)), { total: 22, soft: false });
});

test('blackjack naturel : deux cartes, jamais après un split', () => {
  assert.equal(R.isNatural(H(1, 10)), true);
  assert.equal(R.isNatural(H(10, 1)), true);
  assert.equal(R.isNatural(H(1, 10), true), false);
  assert.equal(R.isNatural(H(7, 7, 7)), false);
});

test('la banque reste sur tous les 17, souples compris (S17)', () => {
  assert.equal(R.dealerHits(H(1, 6)), false);
  assert.equal(R.dealerHits(H(10, 6)), true);
  assert.equal(R.dealerHits(H(1, 5)), true);
  assert.equal(R.dealerHits(H(1, 5, 1)), false); // 17 souple
});

test('résultat de la banque : BJ et 21 non naturel distincts', () => {
  assert.equal(R.dealerOutcome(H(1, 10)), 'BJ');
  assert.equal(R.dealerOutcome(H(7, 4, 10)), 21);
  assert.equal(R.dealerOutcome(H(10, 6, 9)), 'BUST');
  assert.equal(R.dealerOutcome(H(10, 8)), 18);
});

test('actions : doubler et splitter selon les règles', () => {
  const pair8 = R.newHand(H(8, 8), 100);
  assert.deepEqual(R.actions(pair8, { handsCount: 1, balance: 1000 }), { hit: true, stand: true, double: true, split: true });
  assert.equal(R.actions(pair8, { handsCount: 4, balance: 1000 }).split, false, 'limite de 4 mains');
  assert.equal(R.actions(pair8, { balance: 99 }).split, false, 'il faut la mise en plus');
  assert.equal(R.actions(pair8, { balance: 99 }).double, false);
  const kq = R.newHand([C(10, 0), 11], 100); // 10 et Dame : même valeur
  assert.equal(R.actions(kq).split, true);
  const three = R.newHand(H(5, 3, 2), 100);
  assert.equal(R.actions(three).double, false, 'doubler : sur deux cartes seulement');
  const aces = R.newHand(H(1, 1), 100, { fromSplit: true, splitAces: true });
  assert.deepEqual(R.actions(aces), { hit: false, stand: true, double: false, split: false }, 'As splittés : rien');
  const das = R.newHand(H(5, 6), 100, { fromSplit: true });
  assert.equal(R.actions(das).double, true, 'double après split');
  assert.deepEqual(R.actions(R.newHand(H(10, 1), 100)), { hit: false, stand: false, double: false, split: false }, '21 : fini');
});

test('règlement : 3:2, 1:1, égalité, bust, blackjack de la banque', () => {
  const s = (p, d, opts) => R.settleHand(Object.assign(R.newHand(H(...p), 100, opts)), H(...d));
  assert.deepEqual(s([1, 10], [10, 9]), { verdict: 'blackjack', payout: 250 });
  assert.deepEqual(s([1, 10], [1, 10]), { verdict: 'push', payout: 100 });
  assert.deepEqual(s([10, 10], [1, 10]), { verdict: 'lose', payout: 0 });
  assert.deepEqual(s([7, 4, 10], [1, 10]), { verdict: 'lose', payout: 0 }, '21 en 3 cartes perd contre un blackjack');
  assert.deepEqual(s([1, 10], [10, 7, 4], { fromSplit: true }), { verdict: 'push', payout: 100 }, 'A+10 après split = 21, pas BJ : égalité avec un 21');
  assert.deepEqual(s([1, 10], [10, 1], { fromSplit: true }), { verdict: 'lose', payout: 0 }, 'et il perd contre un vrai blackjack');
  assert.deepEqual(s([1, 10], [10, 9], { fromSplit: true }), { verdict: 'win', payout: 200 }, 'payé 1:1 seulement');
  assert.deepEqual(s([10, 8], [10, 6, 10]), { verdict: 'win', payout: 200 });
  assert.deepEqual(s([10, 6, 10], [10, 6, 10]), { verdict: 'bust', payout: 0 }, 'le joueur saute d’abord');
  assert.deepEqual(s([10, 8], [10, 8]), { verdict: 'push', payout: 100 });
  assert.deepEqual(s([10, 7], [10, 8]), { verdict: 'lose', payout: 0 });
});

test('paiements entiers pour toute mise en multiples de 10', () => {
  for (let stake = 10; stake <= 5000; stake += 10) {
    assert.ok(Number.isInteger((stake * 5) / 2));
    for (const spot of Object.keys(SIDE_PAYS)) {
      const p = sidePayout(spot, stake, spot === 'BJ' || spot === 'BUST' ? spot : Number(spot));
      assert.ok(Number.isInteger(p) && p === Math.round(stake * SIDE_PAYS[spot]), `${spot} ${stake} → ${p}`);
    }
  }
  assert.equal(sidePayout('21', 100, 'BJ'), 0, '21 ne gagne pas sur un blackjack');
  assert.equal(sidePayout('BJ', 100, 21), 0, 'BJ ne gagne pas sur un 21');
  assert.equal(sidePayout('17', 10, 17), 65, '11:2 : 10 rendent 65');
  assert.equal(sidePayout('BUST', 50, 'BUST'), 170, '12:5 : 50 rendent 170');
});

test('sabot : 416 cartes, 8 de chaque carte, coupe à 104', () => {
  let x = 7;
  const shoe = R.newShoe({ int: (n) => ((x = (x * 48271) % 2147483647), x % n) });
  assert.equal(shoe.cards.length, 416);
  assert.equal(new Set(shoe.cards).size, 416);
  const byCard = new Map();
  for (const c of shoe.cards) byCard.set(c % 52, (byCard.get(c % 52) ?? 0) + 1);
  assert.ok([...byCard.values()].every((n) => n === 8));
  assert.equal(shoe.cut, 104);
});

test('banque bust : toute main vivante gagne, jamais d’égalité ; une main bust perd quand même', () => {
  const s = (p, d, opts = {}) => {
    const h = R.newHand(H(...p), 100, opts);
    if (opts.doubled) Object.assign(h, { stake: 200, doubled: true });
    return R.settleHand(h, H(...d));
  };
  const busts = [[10, 6, 10], [10, 2, 10], [9, 7, 6], [6, 6, 10], [1, 5, 10, 10]]; // 26, 22, 22, 22, 26 (As compté 1)
  for (const d of busts) {
    assert.ok(R.total(H(...d)).total > 21);
    // Toutes les mains vivantes de 4 à 21, en 2 ou 3 cartes : gagnées 1:1 (le blackjack : 3:2).
    for (const p of [[2, 2], [10, 2], [10, 6], [10, 7], [9, 9], [10, 10], [7, 4, 10], [5, 5, 1], [10, 6, 5]]) {
      assert.deepEqual(s(p, d), { verdict: 'win', payout: 200 }, `${p} contre banque ${d}`);
    }
    assert.deepEqual(s([1, 10], d), { verdict: 'blackjack', payout: 250 }, 'blackjack contre banque bust : 3:2');
    assert.deepEqual(s([10, 6, 10], d), { verdict: 'bust', payout: 0 }, 'le joueur bust perd même si la banque saute');
    assert.deepEqual(s([5, 6, 2], d, { doubled: true }), { verdict: 'win', payout: 400 }, 'main doublée (200) : retour 400');
    assert.deepEqual(s([1, 10], d, { fromSplit: true }), { verdict: 'win', payout: 200 }, '21 après split : 1:1');
    assert.deepEqual(s([8, 3, 10], d, { fromSplit: true, doubled: true }), { verdict: 'win', payout: 400 }, 'double après split');
  }
});

test('règlement : égalité normale, double, split contre une banque qui reste', () => {
  const s = (p, d, opts = {}) => {
    const h = R.newHand(H(...p), 100, opts);
    if (opts.doubled) Object.assign(h, { stake: 200, doubled: true });
    return R.settleHand(h, H(...d));
  };
  assert.deepEqual(s([10, 9], [10, 9]), { verdict: 'push', payout: 100 }, '19 contre 19 : mise rendue');
  assert.deepEqual(s([10, 7], [10, 7]), { verdict: 'push', payout: 100 }, '17 contre 17');
  assert.deepEqual(s([10, 6, 5], [10, 1]), { verdict: 'lose', payout: 0 }, '21 en 3 cartes contre blackjack de la banque');
  assert.deepEqual(s([5, 6, 9], [10, 10], { doubled: true }), { verdict: 'push', payout: 200 }, 'double à 20 contre 20 : les 200 rendus');
  assert.deepEqual(s([5, 6, 10], [10, 10], { doubled: true }), { verdict: 'win', payout: 400 });
  assert.deepEqual(s([5, 6, 2], [10, 7], { doubled: true }), { verdict: 'lose', payout: 0 });
  assert.deepEqual(s([8, 10], [10, 8], { fromSplit: true }), { verdict: 'push', payout: 100 }, 'main de split à égalité');
});

test('assurance : seulement face à un As ; moitié de la mise au plus ; 2:1 si blackjack, perdue sinon', () => {
  assert.equal(R.offersInsurance(C(1)), true);
  for (const v of [2, 5, 9, 10]) assert.equal(R.offersInsurance(C(v)), false, `pas d'assurance face à ${v}`);
  assert.equal(R.insuranceMax(100), 50);
  assert.equal(R.insuranceMax(250), 125);
  assert.equal(R.insurancePayout(50, H(1, 10)), 150, 'payée 2:1 : 50 → retour 150 (+100)');
  assert.equal(R.insurancePayout(50, H(1, 9)), 0, 'pas de blackjack : perdue');
  assert.equal(R.insurancePayout(50, H(1, 5, 5)), 0, '21 en 3 cartes : ce n’est pas un blackjack');
});
