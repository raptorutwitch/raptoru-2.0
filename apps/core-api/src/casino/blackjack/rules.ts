// Blackjack (docs/CASINO.md § 12) — THE RULES, pure functions, ported unchanged from the validated prototype
// (prototypes/casino-blackjack/src/rules.js, tests test/casino-blackjack-rules.test.ts):
//   - 8 decks (416 cards), reshuffled between two rounds once the cut card (25 %, 104th card) has passed;
//   - Ace 1 or 11, faces 10; a natural = 2 cards, 21, never on a split hand;
//   - the dealer draws to 16 and stands on every 17, soft included (S17); it peeks (Ace or 10 up) before any decision;
//     it ALWAYS completes its hand, so the bank bets always resolve;
//   - blackjack 3:2, win 1:1, push = stake back; dealer bust: every live hand wins, a busted hand stays lost;
//   - double on the first two cards (after a split too, not on split Aces); split up to 4 hands, split Aces one card;
//   - insurance only on an Ace up: at most half the main stake, paid 2:1 if the dealer has blackjack; even money for a
//     natural against an Ace. No surrender.

export const DECKS = 8;
export const SHOE_SIZE = 52 * DECKS;
export const MAX_HANDS = 4;
/** Reshuffle once 25 % of the shoe is dealt (the « Banque : blackjack » bet would be countable later). */
export const CUT_FRACTION = 0.25;

const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
] as const;

/** A card is an integer 0…415 (its identity in the shoe). */
export type Card = number;
export const rankOf = (c: Card) => (c % 13) + 1;
export const suitOf = (c: Card) => Math.floor(c / 13) % 4;
export const valueOf = (c: Card) => Math.min(10, rankOf(c));
export const isRed = (c: Card) => suitOf(c) === 1 || suitOf(c) === 2;
export const cardView = (c: Card) => ({
  id: c,
  rank: RANKS[rankOf(c) - 1]!,
  suit: SUITS[suitOf(c)]!,
  red: isRed(c),
});

export function total(cards: readonly Card[]) {
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
export const isNatural = (cards: readonly Card[], fromSplit = false) =>
  !fromSplit && cards.length === 2 && total(cards).total === 21;

export interface Hand {
  cards: Card[];
  stake: number;
  doubled: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  done: boolean;
  steps?: number;
  verdict?: Verdict;
  payout?: number;
}
export type Verdict = 'blackjack' | 'even' | 'win' | 'push' | 'lose' | 'bust';

export function newHand(
  cards: Card[],
  stake: number,
  { fromSplit = false, splitAces = false } = {},
): Hand {
  return {
    cards: [...cards],
    stake,
    doubled: false,
    fromSplit,
    splitAces,
    done: false,
  };
}

export type Action = 'hit' | 'stand' | 'double' | 'split';
/** What a hand may do now; `balance` = what the player can still debit (double and split need the stake again). */
export function actions(
  hand: Pick<Hand, 'cards' | 'stake' | 'fromSplit' | 'splitAces' | 'done'>,
  { handsCount = 1, balance = Infinity } = {},
): Record<Action, boolean> {
  const none = { hit: false, stand: false, double: false, split: false };
  if (hand.done) return none;
  const t = total(hand.cards).total;
  if (t >= 21) return none;
  const two = hand.cards.length === 2;
  const pair = two && valueOf(hand.cards[0]!) === valueOf(hand.cards[1]!);
  const aces = pair && valueOf(hand.cards[0]!) === 1;
  return {
    hit: !hand.splitAces,
    stand: true,
    double: two && !hand.splitAces && balance >= hand.stake,
    split:
      pair &&
      handsCount < MAX_HANDS &&
      !(aces && hand.fromSplit) &&
      !hand.splitAces &&
      balance >= hand.stake,
  };
}

export const dealerHits = (cards: readonly Card[]) => total(cards).total < 17;

export type Outcome = 'BJ' | 'BUST' | 17 | 18 | 19 | 20 | 21;
export function dealerOutcome(cards: readonly Card[]): Outcome {
  if (isNatural(cards)) return 'BJ';
  const t = total(cards).total;
  if (t > 21) return 'BUST';
  return t as Outcome;
}

/** A hand's GROSS payout (stake included; 0 = lost) and verdict, once the dealer has finished. */
export function settleHand(hand: Hand, dealerCards: readonly Card[]) {
  const p = total(hand.cards).total;
  const natural = isNatural(hand.cards, hand.fromSplit);
  const dNatural = isNatural(dealerCards);
  const d = total(dealerCards).total;
  if (p > 21) return { verdict: 'bust' as const, payout: 0 };
  if (dNatural)
    return natural
      ? { verdict: 'push' as const, payout: hand.stake }
      : { verdict: 'lose' as const, payout: 0 };
  if (natural)
    return {
      verdict: 'blackjack' as const,
      payout: Math.floor((hand.stake * 5) / 2),
    };
  if (d > 21 || p > d)
    return { verdict: 'win' as const, payout: hand.stake * 2 };
  if (p === d) return { verdict: 'push' as const, payout: hand.stake };
  return { verdict: 'lose' as const, payout: 0 };
}

export const offersInsurance = (up: Card) => valueOf(up) === 1;
export const insuranceMax = (stake: number) => Math.floor(stake / 2);
export const insurancePayout = (stake: number, dealerCards: readonly Card[]) =>
  isNatural(dealerCards) ? stake * 3 : 0;
export const dealerPeeks = (up: Card) =>
  valueOf(up) === 1 || valueOf(up) === 10;

export interface Shoe {
  cards: Card[];
  pos: number;
  cut: number;
}
/** A fresh shoe shuffled by `int(n)` (Fisher–Yates; crypto in the Core). */
export function newShoe(int: (n: number) => number): Shoe {
  const cards = Array.from({ length: SHOE_SIZE }, (_, i) => i);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = int(i + 1);
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  return { cards, pos: 0, cut: Math.round(SHOE_SIZE * CUT_FRACTION) };
}
export const shoeNeedsShuffle = (shoe: Shoe) => shoe.pos >= shoe.cut;
export function draw(shoe: Shoe): Card {
  if (shoe.pos >= shoe.cards.length) throw new Error('shoe_empty');
  return shoe.cards[shoe.pos++]!;
}

/** Basic strategy (8 decks, S17, DAS) — the Lab's simulated players. */
export function basicStrategy(
  hand: Pick<Hand, 'cards'>,
  up: Card,
  allowed: Record<Action, boolean>,
): Action {
  const u = valueOf(up) === 1 ? 11 : valueOf(up);
  const { total: t, soft } = total(hand.cards);
  if (allowed.split) {
    const v = valueOf(hand.cards[0]!);
    const split =
      v === 1 ||
      v === 8 ||
      (v === 9 && ![7, 10, 11].includes(u)) ||
      (v === 7 && u <= 7) ||
      (v === 6 && u <= 6) ||
      (v === 4 && (u === 5 || u === 6)) ||
      ((v === 2 || v === 3) && u <= 7);
    if (split) return 'split';
  }
  const dbl = (cond: boolean): Action | null =>
    cond && allowed.double ? 'double' : null;
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
