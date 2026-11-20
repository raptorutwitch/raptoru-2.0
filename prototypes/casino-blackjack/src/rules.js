// Blackjack Raptoru — LES RÈGLES, sans affichage ni état de table (docs : README.md § Règles).
// Ce fichier est le futur cœur du Core (à porter en TypeScript tel quel) : des fonctions pures, testées
// (test/rules.test.mjs). Il ne tire aucun hasard : le sabot lui est donné.
//
// Règles retenues (V1) :
//   - Sabot de 8 paquets (416 cartes), remélangé entre deux manches dès que la carte de coupe (104e carte) est passée.
//   - As = 1 ou 11 ; figures = 10. Blackjack naturel = As + carte de valeur 10 en DEUX cartes, hors main splittée.
//   - La banque tire jusqu'à 16 et reste à partir de 17, 17 souple compris (S17).
//   - La banque vérifie son blackjack (As ou 10 visible) AVANT toute décision : blackjack de la banque = la manche
//     s'arrête, aucune mise ne peut avoir été augmentée (doubler, split).
//   - La banque TERMINE TOUJOURS sa main (jusqu'à 17+ ou bust), même si tous les joueurs ont sauté ou sont partis :
//     les paris sur la banque se résolvent donc toujours, et leur probabilité ne dépend d'aucune décision.
//   - Blackjack payé 3:2 (brut ×2,5), victoire 1:1 (brut ×2), égalité = mise rendue. Mises en multiples de 10 :
//     tous les paiements sont des entiers (arrondi inférieur au Jeton par sécurité, jamais atteint).
//   - Doubler : sur ses deux premières cartes, une seule carte de plus, mise doublée ; autorisé après un split, sauf
//     sur des As splittés.
//   - Split : deux cartes de même VALEUR (K + Q oui), mise égale ; jusqu'à 4 mains par joueur (3 splits). As
//     splittés : une seule carte chacun, pas de re-split, pas de double ; un 21 après split n'est jamais un blackjack.
//   - Banque bust : toute main encore vivante (non bust) GAGNE 1:1 (ou 3:2 si blackjack) ; jamais d'égalité contre une
//     banque bust. Une main bust perd toujours, même si la banque saute ensuite.
//   - Assurance (20/11) : proposée seulement si la carte visible de la banque est un As ; au plus la moitié de la mise
//     principale ; payée 2:1 si la banque a blackjack, perdue sinon (la main continue). Even money pour un joueur qui a
//     un blackjack face à un As : sa main payée 1:1 tout de suite. Pas d'abandon.

export const DECKS = 8;
export const SHOE_SIZE = 52 * DECKS;
export const MAX_HANDS = 4;
// Remélange entre deux manches dès que 25 % du sabot (104 cartes) est distribué. Pas 50 ou 75 % : le pari « Banque :
// blackjack » dépend fortement de la densité d'As et de 10 restants ; à 50 %, un compteur parfait le trouverait
// favorable dans 25 % des manches (tools/odds-result.txt § 3). À 25 % (et payé ×19), dans 4 %, +0,12 % de la mise.
export const CUT_FRACTION = 0.25;

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** Une carte du sabot : un entier 0…415 (son identité, jamais réutilisée dans le sabot). */
export const rankOf = (c) => (c % 13) + 1; // 1 = As … 13 = Roi
export const suitOf = (c) => Math.floor(c / 13) % 4;
export const valueOf = (c) => Math.min(10, rankOf(c)); // As = 1 ici (le 11 se décide dans total())
export const label = (c) => `${RANKS[rankOf(c) - 1]}${SUITS[suitOf(c)]}`;
export const isRed = (c) => suitOf(c) === 1 || suitOf(c) === 2;
export const cardView = (c) => ({ id: c, rank: RANKS[rankOf(c) - 1], suit: SUITS[suitOf(c)], red: isRed(c) });

/** Total d'une main : le meilleur ≤ 21, et s'il est « souple » (un As compte 11). */
export function total(cards) {
  let t = 0;
  let aces = 0;
  for (const c of cards) {
    const v = valueOf(c);
    t += v;
    if (v === 1) aces++;
  }
  const soft = aces > 0 && t + 10 <= 21;
  return { total: soft ? t + 10 : t, soft };
}
export const isBust = (cards) => total(cards).total > 21;
/** Blackjack naturel : deux cartes, 21, et jamais sur une main issue d'un split. */
export const isNatural = (cards, fromSplit = false) => !fromSplit && cards.length === 2 && total(cards).total === 21;

/** Une main de joueur. */
export function newHand(cards, stake, { fromSplit = false, splitAces = false } = {}) {
  return { cards: [...cards], stake, doubled: false, fromSplit, splitAces, done: false };
}

/**
 * Ce qu'une main peut faire maintenant. `handsCount` : nombre de mains du joueur ; `balance` : son solde DISPONIBLE
 * (doubler et splitter demandent la même mise en plus). Une main finie ne peut plus rien.
 */
export function actions(hand, { handsCount = 1, balance = Infinity } = {}) {
  const none = { hit: false, stand: false, double: false, split: false };
  if (hand.done) return none;
  const t = total(hand.cards).total;
  if (t >= 21) return none; // 21 ou bust : la main se termine seule
  const two = hand.cards.length === 2;
  const pair = two && valueOf(hand.cards[0]) === valueOf(hand.cards[1]);
  const aces = pair && valueOf(hand.cards[0]) === 1;
  return {
    hit: !hand.splitAces,
    stand: true,
    double: two && !hand.splitAces && balance >= hand.stake,
    split: pair && handsCount < MAX_HANDS && !(aces && hand.fromSplit) && !hand.splitAces && balance >= hand.stake,
  };
}

/** La banque doit-elle tirer ? (S17 : elle reste sur tous les 17, souples compris.) */
export const dealerHits = (cards) => total(cards).total < 17;

/** Le résultat final de la banque, pour les paris secondaires : 'BJ' | 'BUST' | 17…21. */
export function dealerOutcome(cards) {
  if (isNatural(cards)) return 'BJ';
  const t = total(cards).total;
  if (t > 21) return 'BUST';
  return t; // 17…21 (la banque ne s'arrête jamais en dessous de 17)
}

/**
 * Le paiement BRUT d'une main (mise comprise ; 0 = perdue) et son verdict, la banque ayant fini.
 * 'blackjack' ×2,5 · 'win' ×2 · 'push' ×1 · 'lose' / 'bust' ×0.
 */
export function settleHand(hand, dealerCards) {
  const p = total(hand.cards).total;
  const natural = isNatural(hand.cards, hand.fromSplit);
  const dNatural = isNatural(dealerCards);
  const d = total(dealerCards).total;
  if (p > 21) return { verdict: 'bust', payout: 0 };
  if (dNatural) return natural ? { verdict: 'push', payout: hand.stake } : { verdict: 'lose', payout: 0 };
  if (natural) return { verdict: 'blackjack', payout: Math.floor((hand.stake * 5) / 2) };
  if (d > 21 || p > d) return { verdict: 'win', payout: hand.stake * 2 };
  if (p === d) return { verdict: 'push', payout: hand.stake };
  return { verdict: 'lose', payout: 0 };
}

/** L'assurance : proposée seulement face à un As visible ; au plus la moitié de la mise ; payée 2:1 (brut ×3). */
export const offersInsurance = (up) => valueOf(up) === 1;
export const insuranceMax = (stake) => Math.floor(stake / 2);
export const insurancePayout = (stake, dealerCards) => (isNatural(dealerCards) ? stake * 3 : 0);

/** La banque affiche un As ou un 10 : elle vérifie son blackjack avant les décisions. */
export const dealerPeeks = (up) => valueOf(up) === 1 || valueOf(up) === 10;

/** Le sabot neuf, mélangé par `rng` (Fisher-Yates ; rng.int(n) → 0…n-1). La coupe : CUT_FRACTION du sabot. */
export function newShoe(rng) {
  const cards = Array.from({ length: SHOE_SIZE }, (_, i) => i);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return { cards, pos: 0, cut: Math.round(SHOE_SIZE * CUT_FRACTION) };
}
export const shoeNeedsShuffle = (shoe) => shoe.pos >= shoe.cut;
export function draw(shoe) {
  if (shoe.pos >= shoe.cards.length) throw new Error('shoe_empty'); // impossible : coupe à 104, une manche ≤ ~80 cartes
  return shoe.cards[shoe.pos++];
}

/**
 * La stratégie de base (8 paquets, S17, double après split) : sert aux joueurs simulés et au conseil du Lab.
 * Retourne 'hit' | 'stand' | 'double' | 'split' parmi ce qui est permis.
 */
export function basicStrategy(hand, up, allowed) {
  const u = valueOf(up) === 1 ? 11 : valueOf(up);
  const { total: t, soft } = total(hand.cards);
  if (allowed.split) {
    const v = valueOf(hand.cards[0]);
    const split =
      v === 1 || v === 8 ||
      (v === 9 && ![7, 10, 11].includes(u)) ||
      (v === 7 && u <= 7) ||
      (v === 6 && u <= 6) ||
      (v === 4 && (u === 5 || u === 6)) ||
      ((v === 2 || v === 3) && u <= 7);
    if (split) return 'split';
  }
  const dbl = (cond) => (cond && allowed.double ? 'double' : null);
  if (soft) {
    if (t >= 20) return 'stand';
    if (t === 19) return dbl(u === 6) ?? 'stand';
    if (t === 18) return dbl(u >= 2 && u <= 6) ?? (u >= 9 ? 'hit' : 'stand');
    if (t === 17) return dbl(u >= 3 && u <= 6) ?? 'hit';
    if (t >= 15) return dbl(u >= 4 && u <= 6) ?? 'hit';
    return dbl(u === 5 || u === 6) ?? 'hit';
  }
  if (t >= 17) return 'stand';
  if (t >= 13) return u <= 6 ? 'stand' : 'hit';
  if (t === 12) return u >= 4 && u <= 6 ? 'stand' : 'hit';
  if (t === 11) return dbl(u <= 10) ?? 'hit';
  if (t === 10) return dbl(u <= 9) ?? 'hit';
  if (t === 9) return dbl(u >= 3 && u <= 6) ?? 'hit';
  return 'hit';
}
