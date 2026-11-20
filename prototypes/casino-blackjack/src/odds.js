// Blackjack Raptoru — probabilités EXACTES du résultat final de la banque (énumération complète, aucune simulation).
// Entrée : la composition des cartes non vues (10 valeurs : As, 2…9, 10/figures). La banque tire de ces cartes jusqu'à
// 17 ou plus (S17), blackjack naturel compté à part. Sert à fixer la grille des paris sur la banque (paytable.js) et à
// mesurer ce qu'un compteur de cartes pourrait en tirer (tools/odds.mjs).
//
// Pourquoi « du haut d'un sabot plein » suffit au RTP : les paris sont posés AVANT la distribution, les cartes des
// joueurs sont tirées du même sabot mélangé, et leurs décisions (tirer ou rester) sont des temps d'arrêt : par
// échangeabilité, la loi des cartes de la banque ne dépend pas de ces décisions (théorème d'arrêt de Doob appliqué
// aux proportions du sabot). test/odds.test.mjs le vérifie par simulation avec des joueurs qui tirent.

export const OUTCOMES = [17, 18, 19, 20, 21, 'BJ', 'BUST'];

/** La composition d'un sabot plein de `decks` paquets : [As, 2, …, 9, 10/figures]. */
export const fullShoe = (decks = 8) => [...Array(9).fill(4 * decks), 16 * decks];

/** P(résultat final de la banque) depuis la composition `counts` (non modifiée). */
export function dealerDistribution(counts) {
  const c = counts.slice();
  const n0 = c.reduce((a, b) => a + b, 0);
  const out = { 17: 0, 18: 0, 19: 0, 20: 0, 21: 0, BJ: 0, BUST: 0 };
  // (hard sum with aces as 1, has ace, cards so far, remaining, probability)
  function rec(sum, ace, k, n, p) {
    const best = ace && sum + 10 <= 21 ? sum + 10 : sum;
    if (k >= 2) {
      if (k === 2 && best === 21) return void (out.BJ += p);
      if (best > 21) return void (out.BUST += p);
      if (best >= 17) return void (out[best] += p);
    }
    for (let v = 0; v < 10; v++) {
      if (!c[v]) continue;
      const q = p * (c[v] / n);
      c[v]--;
      rec(sum + v + 1, ace || v === 0, k + 1, n - 1, q);
      c[v]++;
    }
  }
  rec(0, false, 0, n0, 1);
  return out;
}

/** RTP de chaque pari sur la banque pour une grille { outcome: multiplicateur brut } et une loi des résultats. */
export function sideBetRtp(dist, pays) {
  return Object.fromEntries(OUTCOMES.map((o) => [o, dist[o] * pays[o]]));
}
