// Blackjack — ONE TABLE's state machine, pure and synchronous, ported from the validated prototype's simulated Core
// (prototypes/casino-blackjack/src/core-sim.js). The service (service.ts) loads the table's row under lock, calls one of
// these functions, applies the Wallet movements it asked for (keyed: a replay pays nothing more) and saves the row — all
// in one transaction. Nothing here reads a clock, a database or a random source by itself: everything comes from `ctx`.
//
// Timers: a table has at most ONE pending step (`t.next = { at, step, args }`), saved with it. The Core's ticker runs the
// due steps (service.tick); after a restart the saved steps simply run late — a past deadline applies its safe default
// (STAND, no insurance, betting closed with the ready players). An empty table has no step: it costs nothing.

import {
  actions,
  cardView,
  dealerHits,
  dealerOutcome,
  dealerPeeks,
  draw,
  insuranceMax,
  insurancePayout,
  isNatural,
  newHand,
  newShoe,
  offersInsurance,
  settleHand,
  shoeNeedsShuffle,
  total,
  valueOf,
  type Action,
  type Card,
  type Hand,
  type Outcome,
  type Shoe,
} from './rules.js';
import {
  betProblem,
  isSideSpot,
  sidePayout,
  type BlackjackLimits,
} from './paytable.js';

export const TIMING = Object.freeze({
  /** Betting has NO countdown: the deal starts when every present player is ready; this safety delay starts at the
   * first PRÊT and deals with the ready players (the others' bets are refunded). */
  betSafetyMs: 45_000,
  decisionFirstMs: 30_000,
  decisionMs: 20_000,
  decisionAbsentMs: 12_000,
  insuranceMs: 12_000,
  showMs: 8_000,
  graceMs: 1_000,
  dealCardMs: 170,
  cardMs: 380,
  revealMs: 650,
  dealerCardMs: 620,
  shuffleMs: 1_600,
  resultMs: 4_500,
  leftActMs: 450,
  /** While someone is ready, presence is re-checked this often (a vanished player never blocks the deal). */
  presenceCheckMs: 3_000,
  /** A seated player not in a round and not seen for this long loses the seat (the table never stays blocked). */
  goneAfterMs: 90_000,
  sweepMs: 20_000,
});
export type Timing = typeof TIMING;
export const TABLE_SEATS = 10;
/** A seat freed after this many rounds without playing. */
export const IDLE_ROUNDS_MAX = 2;
const HISTORY = 15;

export type Phase =
  | 'betting'
  | 'shuffle'
  | 'dealing'
  | 'insurance'
  | 'players'
  | 'dealer'
  | 'settled';

export interface Seat {
  user: string;
  name: string;
  avatar: string | null;
  status: 'seated' | 'left';
  inRound: boolean;
  hands: Hand[];
  bet: {
    main: number;
    side: Record<string, number>;
    ready: boolean;
    reserved: number;
  } | null;
  betRev: number;
  idle: number;
  timeouts: number;
  acted: boolean;
  absences: number;
  /** undefined = not offered; null = waiting; { stake } (0 = declined); { even } = even money. */
  ins?: { stake: number; even?: boolean } | null;
  result: SeatResult | null;
  joinedAt: number;
}
export interface SeatResult {
  staked: number;
  paid: number;
  net: number;
  side: Record<string, { stake: number; payout: number }>;
  insurance: { stake: number; payout: number } | null;
  even: boolean;
}
export interface Turn {
  seat: number;
  hand: number;
  token: string;
  startsAt: number;
  deadline: number;
}
export type Step =
  | 'closeBetting'
  | 'presence'
  | 'sweep'
  | 'deal'
  | 'afterDeal'
  | 'closeInsurance'
  | 'nextTurn'
  | 'auto'
  | 'dealerStep'
  | 'dealerNaturalSettle'
  | 'endRound';
export interface TableState {
  id: string;
  no: number;
  seats: (Seat | null)[];
  phase: Phase;
  betDeadline: number | null;
  round: number;
  roundId: string | null;
  dealer: Card[];
  turn: Turn | null;
  turnStep: number;
  shoe: Shoe;
  seq: number;
  outcome: Outcome | null;
  insDeadline: number | null;
  insDone: boolean;
  peeked: boolean | null;
  last: { seq: number; type: string; [k: string]: unknown } | null;
  history: HistoryRound[];
  next: { at: number; step: Step; args?: (number | string)[] } | null;
  /** This round's answered intents (`user|actionId` → reply): a resent action returns the same reply. */
  seen: Record<string, unknown>;
  rig: Rig | null;
}
export interface HistoryRound {
  round: number;
  outcome: Outcome;
  dealer: number;
  players: {
    user: string;
    name: string;
    net: number;
    staked: number;
    bj: boolean;
    main: number;
    mainPaid: number;
    hands: { total: number; verdict: string | undefined; doubled: boolean }[];
    side: { spot: string; stake: number; payout: number }[];
    insurance: { stake: number; payout: number } | null;
    even: boolean;
  }[];
}
/** Lab only: card VALUES for the next deal (never in Production: the service refuses it). */
export interface Rig {
  seats?: Record<string, (number | null)[]>;
  dealer?: (number | null)[];
  then?: (number | null)[];
}

export interface Ctx {
  now: number;
  int: (n: number) => number;
  T: Timing;
  L: BlackjackLimits;
  /** Spendable Jetons of a viewer (already minus this transaction's debits). */
  balance: (user: string) => number;
  debit: (user: string, amount: number, key: string, why: string) => void;
  credit: (user: string, amount: number, key: string, why: string) => void;
  /** Seen recently by the Core (the screen polls the table). */
  connected: (user: string) => boolean;
  /** The Wallet's balance cap (a bet that could exceed it with its largest win is refused before the deal). */
  maxBalance?: number;
}

export class BjError extends Error {
  constructor(
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
const err = (code: string, details: Record<string, unknown> = {}) =>
  new BjError(code, details);

export function newTable(
  id: string,
  no: number,
  int: (n: number) => number,
): TableState {
  return {
    id,
    no,
    seats: Array<Seat | null>(TABLE_SEATS).fill(null),
    phase: 'betting',
    betDeadline: null,
    round: 0,
    roundId: null,
    dealer: [],
    turn: null,
    turnStep: 0,
    shoe: newShoe(int),
    seq: 0,
    outcome: null,
    insDeadline: null,
    insDone: false,
    peeked: null,
    last: null,
    history: [],
    next: null,
    seen: {},
    rig: null,
  };
}

export const seatOf = (t: TableState, user: string) =>
  t.seats.findIndex((s) => s?.user === user);
const playing = (t: TableState) =>
  t.seats
    .map((s, i) => [s, i] as const)
    .filter((x): x is readonly [Seat, number] => !!x[0]?.inRound);

function emit(t: TableState, type: string, data: Record<string, unknown> = {}) {
  t.seq += 1;
  t.last = { seq: t.seq, type, ...data };
}
function schedule(
  t: TableState,
  at: number,
  step: Step,
  args?: (number | string)[],
) {
  t.next = { at, step, ...(args ? { args } : {}) };
}
function idleSchedule(t: TableState, ctx: Ctx) {
  // Betting with seated players: sweep the vanished ones now and then; an empty table has nothing to do.
  t.next = t.seats.some(Boolean)
    ? { at: ctx.now + ctx.T.sweepMs, step: 'sweep' }
    : null;
}

// --- Seats -----------------------------------------------------------------------------------------------------------
export function sit(
  t: TableState,
  ctx: Ctx,
  user: string,
  name: string,
  avatar: string | null,
  seat: number | null,
) {
  if (
    seat !== null &&
    (!Number.isInteger(seat) || seat < 0 || seat >= TABLE_SEATS)
  )
    throw err('bad_seat');
  if (seat !== null && t.seats[seat] !== null) throw err('seat_taken');
  const i = seat ?? t.seats.indexOf(null);
  if (i < 0) throw err('table_full');
  t.seats[i] = {
    user,
    name: String(name).slice(0, 24),
    avatar,
    status: 'seated',
    inRound: false,
    hands: [],
    bet: null,
    betRev: 0,
    idle: 0,
    timeouts: 0,
    acted: false,
    absences: 0,
    result: null,
    joinedAt: ctx.now,
  };
  emit(t, 'join', { seat: i });
  if (t.phase === 'betting' && !t.next) idleSchedule(t, ctx);
  return { seat: i, nextRound: t.phase !== 'betting' };
}
/** A player who left during their round comes back: their seat and hand, never a second one. */
export function resume(t: TableState, user: string) {
  const i = t.seats.findIndex((x) => x?.user === user && x.status === 'left');
  if (i < 0) return null;
  t.seats[i]!.status = 'seated';
  emit(t, 'rejoin', { seat: i });
  return i;
}

// --- Betting ---------------------------------------------------------------------------------------------------------
function openBetting(t: TableState, ctx: Ctx) {
  t.phase = 'betting';
  t.turn = null;
  t.dealer = [];
  t.outcome = null;
  t.roundId = null;
  t.peeked = null;
  t.insDeadline = null;
  t.insDone = false;
  t.seen = {};
  for (const s of t.seats)
    if (s)
      Object.assign(s, {
        inRound: false,
        hands: [],
        bet: null,
        result: null,
        timeouts: 0,
        acted: false,
        ins: undefined,
      });
  t.betDeadline = null;
  emit(t, 'betting');
  idleSchedule(t, ctx);
}
function present(t: TableState, ctx: Ctx) {
  return t.seats.filter(
    (x): x is Seat => !!x && x.status === 'seated' && ctx.connected(x.user),
  );
}
/** Every present player is ready: deal now. */
function maybeStart(t: TableState, ctx: Ctx) {
  if (t.phase !== 'betting') return;
  const p = present(t, ctx);
  if (p.length && p.every((x) => x.bet?.ready)) closeBetting(t, ctx);
}

/** Place (or change) one's bets for the coming round: the Wallet follows the difference (a reservation, never added
 * twice). `ready` = PRÊT: the bets are LOCKED for the round. */
export function placeBets(
  t: TableState,
  ctx: Ctx,
  user: string,
  {
    main,
    side = {},
    ready = false,
  }: { main: unknown; side?: Record<string, unknown>; ready?: boolean },
) {
  const i = seatOf(t, user);
  const s = t.seats[i];
  if (!s) throw err('not_seated');
  if (t.phase !== 'betting') throw err('betting_closed');
  if (s.status !== 'seated') throw err('not_seated');
  if (s.bet?.ready) throw err('bets_locked');
  const sides: Record<string, number> = {};
  for (const [k, v] of Object.entries(side ?? {}))
    if (v) sides[k] = v as number;
  const no = betProblem({ main, side: sides }, ctx.L);
  if (no) throw err(no.code, 'max' in no ? { max: no.max } : {});
  const want =
    (main as number) + Object.values(sides).reduce((x, y) => x + y, 0);
  const had = s.bet?.reserved ?? 0;
  s.betRev += 1;
  const key = `bet:${t.id}:${t.round + 1}:${user}:${s.betRev}`;
  if (want > had) {
    if (ctx.balance(user) < want - had)
      throw err('insufficient_tokens', {
        balance: ctx.balance(user),
        needed: want - had,
      });
    ctx.debit(user, want - had, key, 'mise réservée');
  } else if (want < had) ctx.credit(user, had - want, key, 'mise réduite');
  s.bet = { main: main as number, side: sides, ready: !!ready, reserved: want };
  s.idle = 0;
  if (ready && !t.betDeadline) {
    t.betDeadline = ctx.now + ctx.T.betSafetyMs;
    schedule(
      t,
      Math.min(t.betDeadline, ctx.now + ctx.T.presenceCheckMs),
      'presence',
    );
  }
  emit(t, ready ? 'ready' : 'bet', { seat: i });
  maybeStart(t, ctx);
  return { ok: true, reserved: want, ready: !!ready };
}
/** Remove one's bets BEFORE PRÊT (never engaged: refunded). */
export function clearBets(t: TableState, ctx: Ctx, user: string) {
  const i = seatOf(t, user);
  const s = t.seats[i];
  if (!s) throw err('not_seated');
  if (t.phase !== 'betting') throw err('betting_closed');
  if (s.bet?.ready) throw err('bets_locked');
  if (s.bet)
    ctx.credit(
      user,
      s.bet.reserved,
      `unbet:${t.id}:${t.round + 1}:${user}:${s.betRev}`,
      'mise retirée',
    );
  s.bet = null;
  emit(t, 'bet', { seat: i });
  return { ok: true };
}
function refundUnready(t: TableState, ctx: Ctx, s: Seat, why: string) {
  if (s.bet && !s.bet.ready)
    ctx.credit(
      s.user,
      s.bet.reserved,
      `unbet:${t.id}:${t.round + 1}:${s.user}:${s.betRev}`,
      why,
    );
  if (s.bet && !s.bet.ready) s.bet = null;
}
/** The deal: the READY players only; an unconfirmed bet is never engaged (refunded). */
function closeBetting(t: TableState, ctx: Ctx) {
  if (t.phase !== 'betting') return;
  for (const s of t.seats) {
    if (!s || s.status !== 'seated' || s.bet?.ready) continue;
    refundUnready(t, ctx, s, 'pas prêt à temps : mise rendue');
    s.idle += 1;
  }
  const bettors = t.seats.filter((s) => s?.bet?.ready);
  releaseIdle(t, ctx);
  if (!bettors.length) return openBetting(t, ctx);
  t.round += 1;
  t.roundId = `${t.id}:${t.round}`;
  t.betDeadline = null;
  t.seen = {};
  for (const s of t.seats)
    if (s?.bet?.ready)
      Object.assign(s, {
        inRound: true,
        hands: [],
        result: null,
        timeouts: 0,
        acted: false,
      });
  // ENGAGED from here: no refund any more (a leaver's hand is played by STAND and paid).
  if (shoeNeedsShuffle(t.shoe)) {
    t.shoe = newShoe(ctx.int);
    t.phase = 'shuffle';
    emit(t, 'shuffle');
    return schedule(t, ctx.now + ctx.T.shuffleMs, 'deal');
  }
  deal(t, ctx);
}

// --- The deal, insurance, the peek -------------------------------------------------------------------------------------
function deal(t: TableState, ctx: Ctx) {
  const order = playing(t);
  if (t.rig) applyRig(t, order.length);
  t.phase = 'dealing';
  const d = () => draw(t.shoe);
  for (const [s] of order) s.hands = [newHand([d()], s.bet!.main)];
  t.dealer = [d()];
  for (const [s] of order) s.hands[0]!.cards.push(d());
  t.dealer.push(d());
  emit(t, 'deal');
  schedule(
    t,
    ctx.now + (order.length * 2 + 2) * ctx.T.dealCardMs + 250,
    'afterDeal',
  );
}
/** After the deal: an Ace up → insurance first; then the dealer checks its blackjack (Ace or 10 up). */
function afterDeal(t: TableState, ctx: Ctx) {
  if (offersInsurance(t.dealer[0]!) && !t.insDone) return openInsurance(t, ctx);
  t.insDone = false;
  if (dealerPeeks(t.dealer[0]!) && isNatural(t.dealer))
    return dealerNatural(t, ctx);
  if (offersInsurance(t.dealer[0]!)) {
    t.peeked = false;
    emit(t, 'peek', { natural: false });
  }
  t.phase = 'players';
  nextTurn(t, ctx, 0, 0);
}
function openInsurance(t: TableState, ctx: Ctx) {
  t.phase = 'insurance';
  t.insDeadline = ctx.now + ctx.T.insuranceMs;
  for (const [s] of playing(t))
    s.ins =
      s.status === 'seated' && ctx.connected(s.user) ? null : { stake: 0 };
  emit(t, 'insurance');
  if (playing(t).every(([s]) => s.ins)) return closeInsurance(t, ctx);
  schedule(t, t.insDeadline + ctx.T.graceMs, 'closeInsurance');
}
function closeInsurance(t: TableState, ctx: Ctx) {
  if (t.phase !== 'insurance') return;
  for (const [s] of playing(t)) if (!s.ins) s.ins = { stake: 0 };
  t.insDone = true;
  t.insDeadline = null;
  afterDeal(t, ctx);
}
/** A player's answer: { stake } (0 = no thanks; at most half the main stake) or { even: true } (natural only). */
export function insure(
  t: TableState,
  ctx: Ctx,
  user: string,
  {
    stake = 0,
    even = false,
    actionId,
  }: { stake?: unknown; even?: boolean; actionId?: string },
) {
  const memo = actionId ? t.seen[`${user}|${actionId}`] : undefined;
  if (memo) return memo;
  const i = seatOf(t, user);
  const s = t.seats[i];
  if (!s) throw err('not_seated');
  if (t.phase !== 'insurance' || !s.inRound) throw err('no_insurance_now');
  if (s.ins) throw err('already_answered');
  if (even) {
    if (!isNatural(s.hands[0]!.cards)) throw err('not_allowed');
    s.ins = { stake: 0, even: true };
  } else {
    const max = insuranceMax(s.hands[0]!.stake);
    if (
      typeof stake !== 'number' ||
      !Number.isSafeInteger(stake) ||
      stake < 0 ||
      stake > max
    )
      throw err('bad_insurance', { max });
    if (stake) {
      if (ctx.balance(user) < stake)
        throw err('insufficient_tokens', {
          balance: ctx.balance(user),
          needed: stake,
        });
      ctx.debit(user, stake, `ins:${t.roundId}:${user}`, 'assurance');
    }
    s.ins = { stake };
  }
  s.acted = true;
  emit(t, 'insure', { seat: i });
  const res = { ok: true, ...s.ins };
  if (actionId) t.seen[`${user}|${actionId}`] = res;
  if (playing(t).every(([x]) => x.ins)) closeInsurance(t, ctx);
  return res;
}
function dealerNatural(t: TableState, ctx: Ctx) {
  if (offersInsurance(t.dealer[0]!)) t.peeked = true;
  for (const [s] of playing(t)) for (const h of s.hands) h.done = true;
  t.phase = 'dealer';
  emit(t, 'reveal', { natural: true });
  schedule(t, ctx.now + ctx.T.revealMs + 300, 'dealerNaturalSettle');
}

// --- Decisions -------------------------------------------------------------------------------------------------------
function nextTurn(t: TableState, ctx: Ctx, i: number, h: number) {
  t.turn = null;
  for (; i < TABLE_SEATS; i++, h = 0) {
    const s = t.seats[i];
    if (!s || !s.inRound) continue;
    for (; h < s.hands.length; h++) {
      const hand = s.hands[h]!;
      if (hand.cards.length === 1) {
        // A split hand gets its second card when it becomes active.
        hand.cards.push(draw(t.shoe));
        if (hand.splitAces) hand.done = true;
        emit(t, 'card', { seat: i, hand: h, auto: true });
        return schedule(t, ctx.now + ctx.T.cardMs, 'nextTurn', [i, h]);
      }
      if (hand.done) continue;
      if (
        isNatural(hand.cards, hand.fromSplit) ||
        total(hand.cards).total >= 21
      ) {
        hand.done = true;
        continue;
      }
      const startsAt = ctx.now;
      t.turnStep += 1;
      const ms =
        s.absences > 0
          ? ctx.T.decisionAbsentMs
          : hand.steps
            ? ctx.T.decisionMs
            : ctx.T.decisionFirstMs;
      t.turn = {
        seat: i,
        hand: h,
        token: `${t.roundId}:${i}:${h}:${t.turnStep}`,
        startsAt,
        deadline: startsAt + ms,
      };
      emit(t, 'turn', { seat: i, hand: h });
      if (s.status === 'left')
        return schedule(t, ctx.now + ctx.T.leftActMs, 'auto', ['left']);
      return schedule(t, t.turn.deadline + ctx.T.graceMs, 'auto', ['timeout']);
    }
  }
  dealerPlays(t, ctx);
}
/** No answer (time out, left, disconnected): STAND — always possible, never a bet raised in someone's name. */
function auto(t: TableState, ctx: Ctx, why: string) {
  if (t.phase !== 'players' || !t.turn) return;
  const s = t.seats[t.turn.seat]!;
  if (why === 'timeout') s.timeouts += 1;
  doAction(t, ctx, t.turn.seat, 'stand', why);
}
/** A player's intent: `token` = the turn it targets; `actionId` = the same for a double click or a resend. */
export function act(
  t: TableState,
  ctx: Ctx,
  user: string,
  {
    type,
    token,
    actionId,
  }: { type: unknown; token: unknown; actionId?: string },
) {
  const memo = actionId ? t.seen[`${user}|${actionId}`] : undefined;
  if (memo) return memo;
  const i = seatOf(t, user);
  if (i < 0) throw err('not_seated');
  if (t.phase !== 'players' || !t.turn) throw err('no_decision_now');
  if (t.turn.seat !== i) throw err('not_your_turn');
  if (token !== t.turn.token) throw err('stale_turn');
  if (ctx.now > t.turn.deadline + ctx.T.graceMs) throw err('too_late');
  if (
    type !== 'hit' &&
    type !== 'stand' &&
    type !== 'double' &&
    type !== 'split'
  )
    throw err('not_allowed');
  const res = doAction(t, ctx, i, type, 'player');
  if (actionId) t.seen[`${user}|${actionId}`] = res;
  return res;
}
function doAction(
  t: TableState,
  ctx: Ctx,
  i: number,
  type: Action,
  why: string,
) {
  const s = t.seats[i]!;
  const h = t.turn!.hand;
  const hand = s.hands[h]!;
  const allowed = actions(hand, {
    handsCount: s.hands.length,
    balance: ctx.balance(s.user),
  });
  if (!allowed[type]) throw err('not_allowed');
  if (why === 'player') {
    s.acted = true;
    s.idle = 0;
    s.absences = 0;
  }
  hand.steps = (hand.steps ?? 0) + 1;
  if (type === 'stand') {
    hand.done = true;
    emit(t, 'stand', { seat: i, hand: h, why });
    nextTurn(t, ctx, i, h + 1);
    return { ok: true };
  }
  if (type === 'hit') {
    hand.cards.push(draw(t.shoe));
    if (total(hand.cards).total >= 21) hand.done = true;
    emit(t, 'card', { seat: i, hand: h });
    t.turn = null;
    schedule(t, ctx.now + ctx.T.cardMs, 'nextTurn', [i, h]);
    return { ok: true };
  }
  if (type === 'double') {
    ctx.debit(
      s.user,
      hand.stake,
      `double:${t.roundId}:${s.user}:${h}`,
      'double',
    );
    hand.stake *= 2;
    hand.doubled = true;
    hand.cards.push(draw(t.shoe));
    hand.done = true;
    emit(t, 'card', { seat: i, hand: h, double: true });
    t.turn = null;
    schedule(t, ctx.now + ctx.T.cardMs, 'nextTurn', [i, h + 1]);
    return { ok: true };
  }
  // split
  const n = s.hands.length;
  ctx.debit(s.user, hand.stake, `split:${t.roundId}:${s.user}:${n}`, 'split');
  const aces = valueOf(hand.cards[0]!) === 1;
  const other = newHand([hand.cards.pop()!], hand.stake, {
    fromSplit: true,
    splitAces: aces,
  });
  hand.fromSplit = true;
  hand.splitAces = aces;
  s.hands.splice(h + 1, 0, other);
  hand.cards.push(draw(t.shoe));
  if (aces) hand.done = true;
  emit(t, 'split', { seat: i, hand: h });
  t.turn = null;
  schedule(t, ctx.now + ctx.T.cardMs * 2, 'nextTurn', [i, h]);
  return { ok: true };
}

// --- The dealer: it ALWAYS completes its hand (the bank bets always resolve) -------------------------------------------
function dealerPlays(t: TableState, ctx: Ctx) {
  t.turn = null;
  t.phase = 'dealer';
  emit(t, 'reveal');
  schedule(t, ctx.now + ctx.T.revealMs, 'dealerStep');
}
function dealerStep(t: TableState, ctx: Ctx) {
  if (dealerHits(t.dealer)) {
    t.dealer.push(draw(t.shoe));
    emit(t, 'dealer_card');
    return schedule(t, ctx.now + ctx.T.dealerCardMs, 'dealerStep');
  }
  settle(t, ctx);
}

/** The settlement: every credit has its key (replayed, it never pays twice). */
function settle(t: TableState, ctx: Ctx) {
  t.outcome = dealerOutcome(t.dealer);
  for (const [s] of playing(t)) {
    let staked = 0;
    let paid = 0;
    s.hands.forEach((h, k) => {
      const r =
        s.ins?.even && k === 0
          ? { verdict: 'even' as const, payout: h.stake * 2 }
          : settleHand(h, t.dealer);
      h.verdict = r.verdict;
      h.payout = r.payout;
      staked += h.stake;
      paid += r.payout;
      if (r.payout)
        ctx.credit(
          s.user,
          r.payout,
          `pay:${t.roundId}:${s.user}:${k}`,
          `main ${k + 1} : ${r.verdict}`,
        );
    });
    const side: SeatResult['side'] = {};
    for (const [spot, v] of Object.entries(s.bet!.side)) {
      const p = isSideSpot(spot) ? sidePayout(spot, v, t.outcome) : 0;
      side[spot] = { stake: v, payout: p };
      staked += v;
      paid += p;
      if (p)
        ctx.credit(
          s.user,
          p,
          `side:${t.roundId}:${s.user}:${spot}`,
          `banque ${spot}`,
        );
    }
    let insurance: SeatResult['insurance'] = null;
    if (s.ins?.stake) {
      const p = insurancePayout(s.ins.stake, t.dealer);
      insurance = { stake: s.ins.stake, payout: p };
      staked += s.ins.stake;
      paid += p;
      if (p)
        ctx.credit(
          s.user,
          p,
          `insp:${t.roundId}:${s.user}`,
          'assurance payée 2:1',
        );
    }
    s.result = {
      staked,
      paid,
      net: paid - staked,
      side,
      insurance,
      even: !!s.ins?.even,
    };
    if (s.timeouts && !s.acted) s.idle += 1;
    if (s.timeouts) s.absences += 1;
  }
  if (!t.history.some((x) => x.round === t.round)) {
    const ps = playing(t).map(([x]) => x);
    t.history.push({
      round: t.round,
      outcome: t.outcome,
      dealer: total(t.dealer).total,
      players: ps.map((x) => ({
        user: x.user,
        name: x.name,
        net: x.result!.net,
        staked: x.result!.staked,
        bj: x.hands.some((h) => h.verdict === 'blackjack'),
        main: x.hands.reduce((a, h) => a + h.stake, 0),
        mainPaid: x.hands.reduce((a, h) => a + (h.payout ?? 0), 0),
        hands: x.hands.map((h) => ({
          total: total(h.cards).total,
          verdict: h.verdict,
          doubled: h.doubled,
        })),
        side: Object.entries(x.result!.side).map(([spot, r]) => ({
          spot,
          stake: r.stake,
          payout: r.payout,
        })),
        insurance: x.result!.insurance,
        even: x.result!.even,
      })),
    });
    if (t.history.length > HISTORY) t.history.shift();
  }
  t.phase = 'settled';
  emit(t, 'settle', { outcome: t.outcome });
  schedule(t, ctx.now + ctx.T.resultMs, 'endRound');
}
function endRound(t: TableState, ctx: Ctx) {
  for (let i = 0; i < t.seats.length; i++)
    if (t.seats[i]?.status === 'left') free(t, i, 'left');
  releaseIdle(t, ctx);
  openBetting(t, ctx);
}
function releaseIdle(t: TableState, ctx: Ctx) {
  t.seats.forEach((s, i) => {
    if (!s || s.inRound) return;
    const gone =
      !ctx.connected(s.user) && ctx.now - s.joinedAt > ctx.T.goneAfterMs;
    if (s.idle >= IDLE_ROUNDS_MAX || gone) {
      if (t.phase === 'betting')
        refundUnready(t, ctx, s, 'place libérée : mise rendue');
      free(t, i, gone ? 'gone' : 'absent');
    }
  });
}
function free(t: TableState, i: number, reason: string) {
  const s = t.seats[i]!;
  t.seats[i] = null;
  emit(t, 'seat_free', { seat: i, reason, name: s.name });
}

/** Leave. Before the deal: bets refunded (never engaged). During a round: the seat stays until the settlement, its hands
 * are played by STAND and paid normally; nothing is refunded or erased. */
export function leave(t: TableState, ctx: Ctx, user: string) {
  const i = seatOf(t, user);
  const s = t.seats[i];
  if (!s) throw err('not_seated');
  if (t.phase === 'betting' || !s.inRound) {
    const had = !!s.bet;
    if (s.bet && t.phase === 'betting')
      ctx.credit(
        user,
        s.bet.reserved,
        `unbet:${t.id}:${t.round + 1}:${user}:${s.betRev}`,
        'départ avant la donne',
      );
    free(t, i, 'left');
    maybeStart(t, ctx);
    if (t.phase === 'betting' && !t.betDeadline) idleSchedule(t, ctx);
    return { ok: true, refunded: had };
  }
  s.status = 'left';
  if (t.phase === 'insurance' && !s.ins) s.ins = { stake: 0 };
  emit(t, 'leave', { seat: i });
  if (t.phase === 'insurance' && playing(t).every(([x]) => x.ins))
    closeInsurance(t, ctx);
  else if (t.turn?.seat === i)
    schedule(t, ctx.now + ctx.T.leftActMs, 'auto', ['left']);
  return { ok: true, engaged: true };
}

/** The ticker: run the table's due step (one at a time; a step may schedule the next). */
export function runDue(t: TableState, ctx: Ctx): boolean {
  const n = t.next;
  if (!n || n.at > ctx.now) return false;
  t.next = null;
  const [a, b] = n.args ?? [];
  switch (n.step) {
    case 'presence':
      if (t.phase !== 'betting') break;
      if (t.betDeadline !== null && ctx.now >= t.betDeadline)
        closeBetting(t, ctx);
      else {
        maybeStart(t, ctx);
        if (t.phase === 'betting' && t.betDeadline !== null)
          schedule(
            t,
            Math.min(t.betDeadline, ctx.now + ctx.T.presenceCheckMs),
            'presence',
          );
      }
      break;
    case 'closeBetting':
      closeBetting(t, ctx);
      break;
    case 'sweep':
      if (t.phase !== 'betting') break;
      releaseIdleGone(t, ctx);
      if (t.phase === 'betting' && !t.next) idleSchedule(t, ctx);
      break;
    case 'deal':
      deal(t, ctx);
      break;
    case 'afterDeal':
      afterDeal(t, ctx);
      break;
    case 'closeInsurance':
      closeInsurance(t, ctx);
      break;
    case 'nextTurn':
      nextTurn(t, ctx, Number(a), Number(b));
      break;
    case 'auto':
      auto(t, ctx, String(a));
      break;
    case 'dealerStep':
      dealerStep(t, ctx);
      break;
    case 'dealerNaturalSettle':
      settle(t, ctx);
      break;
    case 'endRound':
      endRound(t, ctx);
      break;
  }
  return true;
}
/** Betting, nobody ready: the vanished players (no screen for goneAfterMs) lose their seat, their bet refunded. */
function releaseIdleGone(t: TableState, ctx: Ctx) {
  t.seats.forEach((s, i) => {
    if (
      !s ||
      s.inRound ||
      ctx.connected(s.user) ||
      ctx.now - s.joinedAt <= ctx.T.goneAfterMs
    )
      return;
    refundUnready(t, ctx, s, 'place libérée : mise rendue');
    free(t, i, 'gone');
  });
  maybeStart(t, ctx);
}

/** Lab: forced card VALUES for the next deal (swaps cards inside the shoe: its composition never changes). */
function applyRig(t: TableState, n: number) {
  const rig = t.rig!;
  t.rig = null;
  const sh = t.shoe;
  const order = playing(t).map(([, i]) => i);
  const want = new Map<number, number>();
  order.forEach((seat, k) => {
    const v = rig.seats?.[String(seat)];
    if (v?.[0]) want.set(sh.pos + k, v[0]);
    if (v?.[1]) want.set(sh.pos + n + 1 + k, v[1]);
  });
  if (rig.dealer?.[0]) want.set(sh.pos + n, rig.dealer[0]);
  if (rig.dealer?.[1]) want.set(sh.pos + 2 * n + 1, rig.dealer[1]);
  (rig.then ?? []).forEach((v, j) => v && want.set(sh.pos + 2 * n + 2 + j, v));
  for (const [pos, v] of [...want].sort((x, y) => x[0] - y[0])) {
    const j = sh.cards.findIndex(
      (c, k) => k >= pos && valueOf(c) === v && !(want.has(k) && k !== pos),
    );
    if (j < 0) continue;
    [sh.cards[pos], sh.cards[j]] = [sh.cards[j]!, sh.cards[pos]!];
  }
}

// --- What a client sees (redacted) -------------------------------------------------------------------------------------
export function view(
  t: TableState,
  viewer: string | null,
  ctx: Pick<Ctx, 'now' | 'T' | 'L' | 'connected'>,
) {
  const hidden =
    t.phase === 'players' || t.phase === 'dealing' || t.phase === 'insurance';
  const done = t.phase === 'settled';
  const handView = (h: Hand) => ({
    cards: h.cards.map(cardView),
    ...total(h.cards),
    stake: h.stake,
    doubled: h.doubled,
    fromSplit: h.fromSplit,
    splitAces: h.splitAces,
    done: h.done,
    natural: isNatural(h.cards, h.fromSplit),
    verdict: h.verdict ?? null,
    payout: h.payout ?? null,
  });
  const seats = t.seats.map(
    (s, i) =>
      s && {
        seat: i,
        user: s.user,
        name: s.name,
        avatar: s.avatar,
        me: s.user === viewer,
        status: s.status,
        inRound: s.inRound,
        connected: ctx.connected(s.user),
        idle: s.idle,
        bet: s.bet ? { main: s.bet.main, ready: s.bet.ready } : null,
        absences: s.absences,
        // Others' bank bets: visible once resolved only.
        side: s.bet && (s.user === viewer || done) ? { ...s.bet.side } : null,
        sideCount: s.bet ? Object.keys(s.bet.side).length : 0,
        hands: s.hands.map(handView),
        result: done ? s.result : null,
        timeouts: s.timeouts,
        insurance: s.ins === undefined ? undefined : s.ins && { ...s.ins },
      },
  );
  const dealer = t.dealer.map((c, i) =>
    i === 1 && hidden ? { id: `hole-${t.roundId}`, hidden: true } : cardView(c),
  );
  const visible = t.dealer.filter((_, i) => !(i === 1 && hidden));
  return {
    table: t.id,
    no: t.no,
    seq: t.seq,
    now: ctx.now,
    phase: t.phase,
    round: t.round,
    roundId: t.roundId,
    betDeadline: t.betDeadline,
    ready: t.seats.filter((x) => x?.bet?.ready).length,
    waiting: t.seats.filter(
      (x) =>
        x && x.status === 'seated' && ctx.connected(x.user) && !x.bet?.ready,
    ).length,
    history: t.history.slice(-12),
    seats,
    dealer: {
      cards: dealer,
      ...(visible.length ? total(visible) : { total: 0, soft: false }),
      natural: !hidden && isNatural(t.dealer),
    },
    outcome: done ? t.outcome : null,
    turn: t.turn && {
      seat: t.turn.seat,
      hand: t.turn.hand,
      token: t.turn.token,
      startsAt: t.turn.startsAt,
      deadline: t.turn.deadline,
    },
    insurance: t.phase === 'insurance' ? { deadline: t.insDeadline } : null,
    peeked: t.peeked,
    // The shoe's ORDER never leaves the Core: only how many cards are left.
    shoe: {
      dealt: t.shoe.pos,
      size: t.shoe.cards.length,
      cut: t.shoe.cut,
      shuffling: t.phase === 'shuffle',
    },
    last: t.last,
    limits: ctx.L,
    timing: {
      betSafetyMs: ctx.T.betSafetyMs,
      showMs: ctx.T.showMs,
      graceMs: ctx.T.graceMs,
    },
  };
}
export type TableView = ReturnType<typeof view>;
