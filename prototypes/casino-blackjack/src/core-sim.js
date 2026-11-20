// Blackjack Raptoru — SIMULATEUR DU CORE (prototype). ⚠ Tourne dans la page : Jetons FICTIFS, aucun lien avec le vrai
// Wallet ni le vrai Core. Il fixe le CONTRAT que le Core devra tenir (README § Ce qui reste au Core) :
//   - l'autorité : le sabot, l'ordre des cartes, les tours, les timers, les gains et la validation des mises ne sont
//     décidés qu'ici ; un client n'envoie que des intentions (miser, tirer, rester, doubler, splitter, partir) ;
//   - l'argent : chaque mouvement du Wallet a une CLÉ unique (bet:, double:, split:, ins:, pay:, side:…) et ne s'applique
//     qu'une fois, même si le règlement est rejoué après une interruption ;
//   - l'idempotence : une action porte un identifiant (double clic, réponse perdue → la même réponse) et le jeton du
//     tour qu'elle vise (une action hors tour ou périmée est refusée) ;
//   - le secret : la carte cachée de la banque et le sabot ne sortent jamais d'ici avant leur moment (view()).
// Toutes les opérations sont synchrones et atomiques (JavaScript : un seul fil) ; le Core le fera sous verrou de
// ligne (SELECT … FOR UPDATE sur la table de jeu) avec une version.
import * as R from './rules.js';
import { LIMITS, betProblem, sidePayout } from './paytable.js';
import { seeded } from './rng.js';

export const TIMING = Object.freeze({
  // Mises : PAS de compte à rebours. La donne part quand tous les joueurs présents sont PRÊTS. Le délai de secours
  // ne démarre qu'au premier PRÊT ; à son terme, les non-prêts sont exclus de la manche (réservation rendue).
  betSafetyMs: 45_000,
  // Décisions : des fenêtres calmes, mais une vraie limite serveur (un absent ne bloque pas neuf joueurs).
  decisionFirstMs: 30_000, // première décision d'une main
  decisionMs: 20_000, // décisions suivantes de la même main
  decisionAbsentMs: 12_000, // joueur qui a laissé filer le timer à la manche précédente
  showMs: 8_000, // l'écran n'affiche le temps qu'à partir de là (le délai de secours des mises : 15 s)
  graceMs: 1_000, // tolérance de latence acceptée après l'échéance affichée
  dealCardMs: 170, // rythme de distribution (le serveur attend l'animation avant de lancer un timer)
  cardMs: 380, // une carte tirée
  revealMs: 650, // la carte cachée retournée
  insuranceMs: 12_000, // la banque montre un As : le temps de prendre (ou non) l'assurance ; fin dès que tous ont répondu
  dealerCardMs: 620, // une carte de la banque
  shuffleMs: 1_600,
  resultMs: 4_500, // les résultats restent affichés
  leftActMs: 450, // une main d'un joueur parti : RESTER, sans attendre de timer
});
export const TABLE = Object.freeze({ seats: 10, softCap: 7, maxTables: 8, idleRoundsMax: 2 });

const err = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
const HISTORY = 15; // manches récentes gardées par table

/** Le Wallet FICTIF du prototype : soldes + journal de mouvements à clé unique (le vrai Core : son Wallet). */
export function createWallet(initial = {}) {
  const bal = new Map(Object.entries(initial));
  const ops = new Map();
  const listeners = new Set();
  return {
    balance: (u) => bal.get(u) ?? 0,
    has: (key) => ops.has(key),
    /** Un mouvement, une seule fois par clé (un rejeu rend le premier). Un débit sans le solde est refusé. */
    apply(key, user, delta, why = '') {
      if (ops.has(key)) return ops.get(key);
      if (!Number.isSafeInteger(delta)) throw err('bad_amount');
      if (delta < 0 && (bal.get(user) ?? 0) + delta < 0) throw err('insufficient_balance');
      bal.set(user, (bal.get(user) ?? 0) + delta);
      const op = { key, user, delta, why };
      ops.set(key, op);
      for (const l of listeners) l(op);
      return op;
    },
    ops: () => [...ops.values()],
    onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    dump: () => ({ bal: [...bal], ops: [...ops] }),
    load(d) {
      bal.clear();
      ops.clear();
      for (const [k, v] of d.bal) bal.set(k, v);
      for (const [k, v] of d.ops) ops.set(k, v);
    },
  };
}

/** L'horloge réelle (le Lab) ; les tests passent une horloge simulée { now, setTimeout, clearTimeout }. */
export const realClock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };

/**
 * Le Core simulé : un salon de tables. `wallet` : createWallet() ; `clock` ; `seed` (hasard rejouable du prototype) ;
 * `timing` : TIMING remplacé en partie (tests : tout à 0) ; `lab` : autorise les scénarios forcés (JAMAIS au Core).
 */
export function createCore({ wallet, clock = realClock, seed = Date.now(), timing = {}, limits = {}, lab = false } = {}) {
  const T = { ...TIMING, ...timing };
  let L = { ...LIMITS, ...limits };
  const rng = seeded(seed);
  const tables = new Map(); // id → table
  const where = new Map(); // userId → tableId (une seule participation active)
  const subs = new Map(); // tableId → Set<{ viewer, cb }>
  const timers = new Map(); // tableId → handle
  const seen = new Map(); // `${user}|${actionId}` → réponse (idempotence)
  let nextTable = 1;
  let down = false; // Lab : le Core « interrompu »

  // --- Tables ---------------------------------------------------------------------------------------------------------
  function newTable() {
    const id = `T${nextTable++}`;
    const t = { id, no: tables.size + 1, seats: Array(TABLE.seats).fill(null), phase: 'betting', betDeadline: null, round: 0, roundId: null, dealer: [], turn: null, shoe: R.newShoe(rng), seq: 0, sides: null, outcome: null, rig: null, last: null, history: [] };
    tables.set(id, t);
    return t;
  }
  const seatOf = (t, user) => t.seats.findIndex((s) => s && s.user === user);
  const playing = (t) => t.seats.map((s, i) => [s, i]).filter(([s]) => s && s.inRound);

  /** Où s'asseoir : la table précisée, sinon celle en attente la plus remplie sous le plafond doux (7), sinon une
   * nouvelle table, sinon (salon plein) n'importe quelle place libre jusqu'à 10. */
  function pickTable(tableId) {
    if (tableId) {
      const t = tables.get(tableId);
      if (!t) throw err('no_table');
      if (!t.seats.includes(null)) throw err('table_full');
      return t;
    }
    const open = [...tables.values()].filter((t) => t.seats.includes(null));
    const count = (t) => t.seats.filter(Boolean).length;
    const soft = open.filter((t) => count(t) < TABLE.softCap).sort((a, b) => count(b) - count(a) || (a.phase === 'betting' ? -1 : 1));
    if (soft.length) return soft[0];
    if (tables.size < TABLE.maxTables) return newTable();
    if (open.length) return open.sort((a, b) => count(a) - count(b))[0];
    throw err('casino_full');
  }

  // --- Ce que voit un client (redacté) ------------------------------------------------------------------------------
  function view(t, viewer) {
    const hidden = t.phase === 'players' || t.phase === 'dealing' || t.phase === 'insurance';
    const done = t.phase === 'settled';
    const handView = (h) => ({ cards: h.cards.map(R.cardView), ...R.total(h.cards), stake: h.stake, doubled: h.doubled, fromSplit: h.fromSplit, splitAces: h.splitAces, done: h.done, natural: R.isNatural(h.cards, h.fromSplit), verdict: h.verdict ?? null, payout: h.payout ?? null });
    const seats = t.seats.map((s, i) =>
      s && {
        seat: i,
        user: s.user,
        name: s.name,
        avatar: s.avatar,
        me: s.user === viewer,
        status: s.status, // 'seated' | 'left'
        inRound: s.inRound,
        connected: s.connected,
        idle: s.idle,
        bet: s.bet ? { main: s.bet.main, ready: s.bet.ready } : null,
        absences: s.absences ?? 0,
        // Les paris sur la banque des autres : visibles une fois résolus seulement.
        side: s.bet && (s.user === viewer || done) ? { ...s.bet.side } : null,
        sideCount: s.bet ? Object.keys(s.bet.side).length : 0,
        hands: (s.hands ?? []).map(handView),
        result: done ? s.result ?? null : null,
        timeouts: s.timeouts,
        // L'assurance : undefined = pas proposée ; null = en attente ; { stake } (0 = refusée) ; { even: true } = even money.
        insurance: s.ins === undefined ? undefined : s.ins && { ...s.ins },
      },
    );
    const dealer = t.dealer.map((c, i) => (i === 1 && hidden ? { id: `hole-${t.roundId}`, hidden: true } : R.cardView(c)));
    const visible = t.dealer.filter((_, i) => !(i === 1 && hidden));
    return {
      table: t.id,
      no: t.no,
      seq: t.seq,
      now: clock.now(),
      phase: t.phase,
      round: t.round,
      roundId: t.roundId,
      betDeadline: t.betDeadline, // délai de secours des mises (null tant que personne n'est prêt)
      ready: t.seats.filter((x) => x?.bet?.ready).length,
      waiting: t.seats.filter((x) => x && x.status === 'seated' && x.connected && !x.bet?.ready).length,
      history: t.history.slice(-12),
      seats,
      dealer: { cards: dealer, ...(visible.length ? R.total(visible) : { total: 0, soft: false }), natural: !hidden && R.isNatural(t.dealer) },
      outcome: done ? t.outcome : null,
      turn: t.turn && { seat: t.turn.seat, hand: t.turn.hand, token: t.turn.token, startsAt: t.turn.startsAt, deadline: t.turn.deadline },
      insurance: t.phase === 'insurance' ? { deadline: t.insDeadline } : null,
      peeked: t.peeked ?? null, // après l'assurance : la banque a vérifié (true = blackjack, false = pas de blackjack)
      shoe: { dealt: t.shoe.pos, size: t.shoe.cards.length, cut: t.shoe.cut, shuffling: t.phase === 'shuffle' },
      last: t.last, // le dernier événement (indice d'animation pour les clients)
      limits: L,
      timing: { betSafetyMs: T.betSafetyMs, showMs: T.showMs, graceMs: T.graceMs },
    };
  }
  function emit(t, type, data = {}) {
    t.seq += 1;
    t.last = { seq: t.seq, type, ...data };
    for (const s of subs.get(t.id) ?? []) s.cb(view(t, s.viewer));
  }

  // --- Minuteries serveur : une échéance par table --------------------------------------------------------------------
  function schedule(t, at, fn) {
    if (timers.has(t.id)) clock.clearTimeout(timers.get(t.id));
    timers.set(t.id, clock.setTimeout(() => {
      timers.delete(t.id);
      if (down) return; // reprise : resume() réarme
      fn();
    }, Math.max(0, at - clock.now())));
    t.next = { at, fn: fn.name || null };
  }

  // --- Mises -----------------------------------------------------------------------------------------------------
  function openBetting(t) {
    t.phase = 'betting';
    t.turn = null;
    t.dealer = [];
    t.sides = null;
    t.outcome = null;
    t.roundId = null;
    for (const s of t.seats) if (s) Object.assign(s, { inRound: false, hands: [], bet: null, result: null, timeouts: 0, acted: false, ins: undefined });
    t.peeked = null;
    t.betDeadline = null; // pas de compte à rebours : le délai de secours ne démarre qu'au premier PRÊT
    if (timers.has(t.id)) clock.clearTimeout(timers.get(t.id));
    timers.delete(t.id);
    t.next = null;
    emit(t, 'betting');
  }
  /** Tous les joueurs présents (assis, connectés) sont prêts : la donne part tout de suite. */
  function maybeStart(t) {
    if (t.phase !== 'betting') return;
    const present = t.seats.filter((x) => x && x.status === 'seated' && x.connected);
    if (present.length && present.every((x) => x.bet?.ready)) closeBetting(t);
  }

  /**
   * Pose (ou change) ses mises de la manche à venir : la réservation suit le Wallet (débit ou remboursement de la
   * différence, jamais additionnée). `ready` : PRÊT — les mises sont alors VERROUILLÉES pour la manche.
   */
  function placeBets(user, { main, side = {}, ready = false }) {
    if (down) throw err('core_unavailable');
    const t = tableOf(user);
    const i = seatOf(t, user);
    const s = t.seats[i];
    if (t.phase !== 'betting') throw err('betting_closed');
    if (s.status !== 'seated') throw err('not_seated');
    if (s.bet?.ready) throw err('bets_locked');
    const sides = Object.fromEntries(Object.entries(side ?? {}).filter(([, v]) => v));
    const no = betProblem({ main, side: sides }, L);
    if (no) throw err(no.code, { max: no.max });
    const want = main + Object.values(sides).reduce((x, y) => x + y, 0);
    const had = s.bet?.reserved ?? 0;
    const rev = (s.betRev = (s.betRev ?? 0) + 1);
    if (want !== had) wallet.apply(`bet:${t.id}:${t.round + 1}:${user}:${rev}`, user, -(want - had), want > had ? 'mise réservée' : 'mise réduite');
    s.bet = { main, side: sides, ready: !!ready, reserved: want };
    s.idle = 0;
    // Le délai de secours démarre au premier PRÊT de la manche (personne n'est pressé avant).
    if (ready && !t.betDeadline) {
      t.betDeadline = clock.now() + T.betSafetyMs;
      schedule(t, t.betDeadline, () => closeBetting(t));
    }
    emit(t, ready ? 'ready' : 'bet', { seat: i });
    maybeStart(t);
    return { ok: true, reserved: want, ready: !!ready };
  }
  /** Retire ses mises AVANT PRÊT (jamais engagées : remboursées). */
  function clearBets(user) {
    if (down) throw err('core_unavailable');
    const t = tableOf(user);
    const s = t.seats[seatOf(t, user)];
    if (t.phase !== 'betting') throw err('betting_closed');
    if (s.bet?.ready) throw err('bets_locked');
    if (s.bet) wallet.apply(`unbet:${t.id}:${t.round + 1}:${user}:${s.betRev}`, user, s.bet.reserved, 'mise retirée');
    s.bet = null;
    emit(t, 'bet', { seat: seatOf(t, user) });
    return { ok: true };
  }

  /** La donne : avec les joueurs PRÊTS seulement. Une mise non confirmée n'est jamais engagée : elle est rendue. */
  function closeBetting(t) {
    if (t.phase !== 'betting') return;
    for (const s of t.seats) {
      if (!s || s.status !== 'seated' || s.bet?.ready) continue;
      if (s.bet) wallet.apply(`unbet:${t.id}:${t.round + 1}:${s.user}:${s.betRev}`, s.user, s.bet.reserved, 'pas prêt à temps : mise rendue');
      s.bet = null;
      s.idle += 1;
    }
    const bettors = t.seats.filter((s) => s && s.bet?.ready);
    releaseIdle(t);
    if (!bettors.length) return openBetting(t); // personne : la fenêtre se rouvre (les absents finissent libérés)
    t.round += 1;
    t.roundId = `${t.id}-${t.round}`;
    t.betDeadline = null;
    for (const s of t.seats) if (s && s.bet?.ready) Object.assign(s, { inRound: true, hands: [], result: null, timeouts: 0, acted: false });
    // ENGAGÉ : à partir d'ici, plus aucun remboursement (un départ laisse sa main jouée par RESTER).
    if (R.shoeNeedsShuffle(t.shoe)) {
      t.shoe = R.newShoe(rng);
      t.phase = 'shuffle';
      emit(t, 'shuffle');
      return schedule(t, clock.now() + T.shuffleMs, () => deal(t));
    }
    deal(t);
  }

  // --- La donne --------------------------------------------------------------------------------------------------
  function deal(t) {
    const order = playing(t);
    if (t.rig) applyRig(t, order.length);
    t.phase = 'dealing';
    const draw = () => R.draw(t.shoe);
    for (const [s] of order) s.hands = [R.newHand([draw()], s.bet.main)];
    t.dealer = [draw()];
    for (const [s] of order) s.hands[0].cards.push(draw());
    t.dealer.push(draw());
    const n = order.length * 2 + 2;
    emit(t, 'deal');
    const at = clock.now() + n * T.dealCardMs + 250;
    schedule(t, at, () => afterDeal(t));
  }
  /** Après la donne : un As visible → l'assurance d'abord ; puis la banque vérifie son blackjack (As ou 10 visible),
   * avant toute décision (aucune mise ne peut encore avoir été augmentée). */
  function afterDeal(t) {
    if (R.offersInsurance(t.dealer[0]) && !t.insDone) return openInsurance(t);
    t.insDone = false;
    if (R.dealerPeeks(t.dealer[0]) && R.isNatural(t.dealer)) return dealerNatural(t);
    if (R.offersInsurance(t.dealer[0])) {
      t.peeked = false; // pas de blackjack : les assurances sont perdues, la manche continue
      emit(t, 'peek', { natural: false });
    }
    t.phase = 'players';
    nextTurn(t, 0, 0);
  }

  // --- L'assurance (la banque montre un As) -------------------------------------------------------------------------
  // Chaque joueur de la manche peut assurer jusqu'à la MOITIÉ de sa mise principale (payée 2:1 si la banque a
  // blackjack, perdue sinon ; la main continue normalement). Un joueur qui a lui-même un blackjack se voit proposer
  // l'« even money » : sa main est payée 1:1 tout de suite, quoi qu'ait la banque (= assurer la moitié, mêmes gains).
  // Pas de réponse à l'échéance = pas d'assurance (jamais de mise prise à sa place).
  function openInsurance(t) {
    t.phase = 'insurance';
    t.insDeadline = clock.now() + T.insuranceMs;
    for (const [s] of playing(t)) s.ins = s.status === 'seated' && s.connected ? null : { stake: 0 };
    emit(t, 'insurance');
    if (playing(t).every(([s]) => s.ins)) return closeInsurance(t);
    schedule(t, t.insDeadline + T.graceMs, () => closeInsurance(t));
  }
  function closeInsurance(t) {
    if (t.phase !== 'insurance') return;
    for (const [s] of playing(t)) if (!s.ins) s.ins = { stake: 0 };
    t.insDone = true;
    t.insDeadline = null;
    afterDeal(t);
  }
  /** La réponse d'un joueur : { stake } (0 = non merci ; au plus la moitié de sa mise) ou { even: true }. */
  function insure(user, { stake = 0, even = false, actionId } = {}) {
    if (down) throw err('core_unavailable');
    const memo = actionId && seen.get(`${user}|${actionId}`);
    if (memo) return memo;
    const t = tableOf(user);
    const s = t.seats[seatOf(t, user)];
    if (t.phase !== 'insurance' || !s.inRound) throw err('no_insurance_now');
    if (s.ins) throw err('already_answered');
    const natural = R.isNatural(s.hands[0].cards);
    if (even) {
      if (!natural) throw err('not_allowed');
      s.ins = { stake: 0, even: true };
    } else {
      const max = R.insuranceMax(s.hands[0].stake);
      if (!Number.isSafeInteger(stake) || stake < 0 || stake > max) throw err('bad_insurance', { max });
      if (stake) wallet.apply(`ins:${t.roundId}:${user}`, user, -stake, 'assurance');
      s.ins = { stake };
    }
    s.acted = true;
    emit(t, 'insure', { seat: seatOf(t, user) });
    const res = { ok: true, ...s.ins };
    if (actionId) seen.set(`${user}|${actionId}`, res);
    if (playing(t).every(([x]) => x.ins)) closeInsurance(t);
    return res;
  }
  function dealerNatural(t) {
    if (R.offersInsurance(t.dealer[0])) t.peeked = true;
    for (const [s] of playing(t)) for (const h of s.hands) h.done = true;
    t.phase = 'dealer';
    emit(t, 'reveal', { natural: true });
    schedule(t, clock.now() + T.revealMs + 300, () => settle(t));
  }

  /** Le prochain à décider : la main `h` de la place `i`, ou la suivante qui a besoin d'une décision. */
  function nextTurn(t, i, h) {
    t.turn = null;
    for (; i < TABLE.seats; i++, h = 0) {
      const s = t.seats[i];
      if (!s || !s.inRound) continue;
      for (; h < s.hands.length; h++) {
        const hand = s.hands[h];
        if (hand.cards.length === 1) {
          // Main issue d'un split : sa deuxième carte arrive quand elle devient active.
          hand.cards.push(R.draw(t.shoe));
          if (hand.splitAces) hand.done = true;
          emit(t, 'card', { seat: i, hand: h, auto: true });
          return schedule(t, clock.now() + T.cardMs, () => nextTurn(t, i, h));
        }
        if (hand.done) continue;
        if (R.isNatural(hand.cards, hand.fromSplit) || R.total(hand.cards).total >= 21) {
          hand.done = true;
          continue;
        }
        const startsAt = clock.now();
        const step = (t.turnStep = (t.turnStep ?? 0) + 1);
        // Une première décision a plus de temps ; un joueur qui a laissé filer le timer à la manche d'avant, moins.
        const ms = s.absences > 0 ? T.decisionAbsentMs : hand.steps ? T.decisionMs : T.decisionFirstMs;
        t.turn = { seat: i, hand: h, token: `${t.roundId}:${i}:${h}:${step}`, startsAt, deadline: startsAt + ms };
        emit(t, 'turn', { seat: i, hand: h });
        // Un joueur parti : sa main reste (RESTER), sans faire attendre la table.
        if (s.status === 'left') return schedule(t, clock.now() + T.leftActMs, () => auto(t, 'left'));
        return schedule(t, t.turn.deadline + T.graceMs, () => auto(t, 'timeout'));
      }
    }
    dealerPlays(t);
  }
  /** Politique sans réponse (temps écoulé, joueur parti, déconnecté) : RESTER — toujours possible, jamais de mise
   * augmentée à sa place. */
  function auto(t, why) {
    if (t.phase !== 'players' || !t.turn) return;
    const s = t.seats[t.turn.seat];
    if (why === 'timeout') s.timeouts += 1;
    doAction(t, t.turn.seat, 'stand', why);
  }

  /** Une intention d'un joueur. `token` : le tour visé ; `actionId` : la même pour un double clic ou un renvoi. */
  function act(user, { type, token, actionId }) {
    if (down) throw err('core_unavailable');
    const memo = actionId && seen.get(`${user}|${actionId}`);
    if (memo) return memo;
    const t = tableOf(user);
    const i = seatOf(t, user);
    if (t.phase !== 'players' || !t.turn) throw err('no_decision_now');
    if (t.turn.seat !== i) throw err('not_your_turn');
    if (token !== t.turn.token) throw err('stale_turn');
    if (clock.now() > t.turn.deadline + T.graceMs) throw err('too_late');
    const res = doAction(t, i, type, 'player');
    if (actionId) seen.set(`${user}|${actionId}`, res);
    return res;
  }
  function doAction(t, i, type, why) {
    const s = t.seats[i];
    const h = t.turn.hand;
    const hand = s.hands[h];
    const allowed = R.actions(hand, { handsCount: s.hands.length, balance: wallet.balance(s.user) });
    if (!allowed[type]) throw err('not_allowed');
    if (why === 'player') {
      s.acted = true;
      s.idle = 0;
      s.absences = 0;
    }
    const key = `${t.roundId}:${s.user}:${h}`;
    hand.steps = (hand.steps ?? 0) + 1;
    if (type === 'stand') {
      hand.done = true;
      emit(t, 'stand', { seat: i, hand: h, why });
      nextTurn(t, i, h + 1);
      return { ok: true };
    }
    if (type === 'hit') {
      hand.cards.push(R.draw(t.shoe));
      const tot = R.total(hand.cards).total;
      if (tot >= 21) hand.done = true;
      emit(t, 'card', { seat: i, hand: h });
      t.turn = null;
      schedule(t, clock.now() + T.cardMs, () => nextTurn(t, i, h));
      return { ok: true };
    }
    if (type === 'double') {
      wallet.apply(`double:${key}`, s.user, -hand.stake, 'double');
      hand.stake *= 2;
      hand.doubled = true;
      hand.cards.push(R.draw(t.shoe));
      hand.done = true;
      emit(t, 'card', { seat: i, hand: h, double: true });
      t.turn = null;
      schedule(t, clock.now() + T.cardMs, () => nextTurn(t, i, h + 1));
      return { ok: true };
    }
    if (type === 'split') {
      const n = s.hands.length;
      wallet.apply(`split:${t.roundId}:${s.user}:${n}`, s.user, -hand.stake, 'split');
      const aces = R.valueOf(hand.cards[0]) === 1;
      const other = R.newHand([hand.cards.pop()], hand.stake, { fromSplit: true, splitAces: aces });
      hand.fromSplit = true;
      hand.splitAces = aces;
      s.hands.splice(h + 1, 0, other);
      hand.cards.push(R.draw(t.shoe));
      if (aces) hand.done = true; // As splittés : une carte chacun, rien d'autre
      emit(t, 'split', { seat: i, hand: h });
      t.turn = null;
      schedule(t, clock.now() + T.cardMs * 2, () => nextTurn(t, i, h));
      return { ok: true };
    }
    throw err('not_allowed');
  }

  // --- La banque : elle termine TOUJOURS sa main (les paris sur la banque se résolvent même si tous ont sauté) ----
  function dealerPlays(t) {
    t.turn = null;
    t.phase = 'dealer';
    emit(t, 'reveal');
    const step = () => {
      if (R.dealerHits(t.dealer)) {
        t.dealer.push(R.draw(t.shoe));
        emit(t, 'dealer_card');
        return schedule(t, clock.now() + T.dealerCardMs, step);
      }
      settle(t);
    };
    schedule(t, clock.now() + T.revealMs, step);
  }

  /** Le règlement : chaque crédit a sa clé — rejoué après une interruption, il ne paie jamais deux fois. */
  function settle(t) {
    t.outcome = R.dealerOutcome(t.dealer);
    for (const [s] of playing(t)) {
      let staked = 0;
      let paid = 0;
      s.hands.forEach((h, k) => {
        // Even money : le blackjack payé 1:1, que la banque ait blackjack ou non.
        const r = s.ins?.even && k === 0 ? { verdict: 'even', payout: h.stake * 2 } : R.settleHand(h, t.dealer);
        h.verdict = r.verdict;
        h.payout = r.payout;
        staked += h.stake;
        paid += r.payout;
        if (r.payout) wallet.apply(`pay:${t.roundId}:${s.user}:${k}`, s.user, r.payout, `main ${k + 1} : ${r.verdict}`);
      });
      const side = {};
      for (const [spot, v] of Object.entries(s.bet.side)) {
        const p = sidePayout(spot, v, t.outcome);
        side[spot] = { stake: v, payout: p };
        staked += v;
        paid += p;
        if (p) wallet.apply(`side:${t.roundId}:${s.user}:${spot}`, s.user, p, `banque ${spot}`);
      }
      let insurance = null;
      if (s.ins?.stake) {
        const p = R.insurancePayout(s.ins.stake, t.dealer);
        insurance = { stake: s.ins.stake, payout: p };
        staked += s.ins.stake;
        paid += p;
        if (p) wallet.apply(`insp:${t.roundId}:${s.user}`, s.user, p, 'assurance payée 2:1');
      }
      s.result = { staked, paid, net: paid - staked, side, insurance, even: !!s.ins?.even };
      if (s.timeouts && !s.acted) s.idle += 1; // toute la manche jouée par le timer : absent
      if (s.timeouts) s.absences = (s.absences ?? 0) + 1;
    }
    // L'historique de la table : les résultats qui comptent, produits ICI (les mêmes pour joueurs et spectateurs).
    if (!t.history.some((x) => x.round === t.round)) {
      const ps = playing(t).map(([x]) => x);
      t.history.push({
        round: t.round,
        outcome: t.outcome,
        dealer: R.total(t.dealer).total,
        // Par joueur : la mise principale (splits et doubles compris) et ce qu'elle a rendu, chaque main, chaque pari
        // banque (mise, retour brut) ; `net` = tout ce qui a été payé − tout ce qui a été misé.
        players: ps.map((x) => ({
          user: x.user,
          name: x.name,
          net: x.result.net,
          staked: x.result.staked,
          bj: x.hands.some((h) => h.verdict === 'blackjack'),
          main: x.hands.reduce((a, h) => a + h.stake, 0),
          mainPaid: x.hands.reduce((a, h) => a + h.payout, 0),
          hands: x.hands.map((h) => ({ total: R.total(h.cards).total, verdict: h.verdict, doubled: h.doubled })),
          side: Object.entries(x.result.side).map(([spot, r]) => ({ spot, stake: r.stake, payout: r.payout })),
          insurance: x.result.insurance,
          even: x.result.even,
        })),
        sides: ps.flatMap((x) => Object.entries(x.result.side).map(([spot, r]) => ({ name: x.name, spot, stake: r.stake, payout: r.payout }))),
      });
      if (t.history.length > HISTORY) t.history.shift();
    }
    t.phase = 'settled';
    emit(t, 'settle', { outcome: t.outcome });
    schedule(t, clock.now() + T.resultMs, () => endRound(t));
  }
  function endRound(t) {
    for (let i = 0; i < t.seats.length; i++) {
      const s = t.seats[i];
      if (s && s.status === 'left') free(t, i, 'left');
    }
    releaseIdle(t);
    openBetting(t);
  }
  /** Un absent répété ne garde pas sa place : libérée après TABLE.idleRoundsMax manches sans jouer. */
  function releaseIdle(t) {
    t.seats.forEach((s, i) => {
      if (s && !s.inRound && s.idle >= TABLE.idleRoundsMax) free(t, i, 'absent');
    });
  }
  function free(t, i, reason) {
    const s = t.seats[i];
    t.seats[i] = null;
    if (where.get(s.user) === t.id) where.delete(s.user);
    emit(t, 'seat_free', { seat: i, reason, name: s.name });
  }

  // --- Scénarios forcés (LAB SEULEMENT : n'existe pas au Core) -----------------------------------------------------
  /** Met des cartes de la VALEUR voulue aux positions de la prochaine donne, en échangeant des cartes du sabot (sa
   * composition ne change pas). rig = { seats: { [seatIndex]: [v1, v2] }, dealer: [up, hole], then: [v…] } (1 = As,
   * 10 = 10/figure ; null = au hasard). */
  function applyRig(t, n) {
    const rig = t.rig;
    t.rig = null;
    const sh = t.shoe;
    const order = playing(t).map(([, i]) => i);
    const want = new Map();
    order.forEach((seat, k) => {
      const v = rig.seats?.[seat];
      if (v?.[0]) want.set(sh.pos + k, v[0]);
      if (v?.[1]) want.set(sh.pos + n + 1 + k, v[1]);
    });
    if (rig.dealer?.[0]) want.set(sh.pos + n, rig.dealer[0]);
    if (rig.dealer?.[1]) want.set(sh.pos + 2 * n + 1, rig.dealer[1]);
    (rig.then ?? []).forEach((v, j) => v && want.set(sh.pos + 2 * n + 2 + j, v));
    for (const [pos, v] of [...want].sort((a, b) => a[0] - b[0])) {
      const j = sh.cards.findIndex((c, k) => k >= pos && R.valueOf(c) === v && !(want.has(k) && k !== pos));
      if (j < 0) continue;
      [sh.cards[pos], sh.cards[j]] = [sh.cards[j], sh.cards[pos]];
    }
  }

  // --- Salon ------------------------------------------------------------------------------------------------------
  function tableOf(user) {
    const id = where.get(user);
    if (!id) throw err('not_seated');
    return tables.get(id);
  }
  function join(user, name, { tableId = null, seat = null, avatar = null } = {}) {
    if (down) throw err('core_unavailable');
    if (where.has(user)) {
      const t = tables.get(where.get(user));
      return { table: t.id, seat: seatOf(t, user), already: true }; // une seule participation active
    }
    // Parti pendant une manche encore en cours : il reprend SA place (et sa main), jamais une deuxième.
    for (const t of tables.values()) {
      const i = t.seats.findIndex((x) => x && x.user === user && x.status === 'left');
      if (i < 0) continue;
      t.seats[i].status = 'seated';
      t.seats[i].connected = true;
      where.set(user, t.id);
      emit(t, 'rejoin', { seat: i });
      return { table: t.id, seat: i, resumed: true };
    }
    const t = pickTable(tableId);
    // Une place choisie : la sienne si elle est libre ; prise entre-temps → refus (jamais une autre en silence).
    if (seat !== null && (!Number.isInteger(seat) || seat < 0 || seat >= TABLE.seats)) throw err('bad_seat');
    if (seat !== null && t.seats[seat] !== null) throw err('seat_taken');
    const i = seat !== null ? seat : t.seats.indexOf(null);
    if (i < 0) throw err('table_full');
    // L'avatar : une URL Twitch (Core : profile_image_url en cache) ; jamais indispensable, l'écran a un remplacement.
    const av = typeof avatar === 'string' && avatar.length < 2000 && /^(https:\/\/|data:image\/)/.test(avatar) ? avatar : null;
    t.seats[i] = { user, name: String(name).slice(0, 24), avatar: av, status: 'seated', connected: true, inRound: false, hands: [], bet: null, idle: 0, timeouts: 0, acted: false };
    where.set(user, t.id);
    emit(t, 'join', { seat: i });
    return { table: t.id, seat: i, nextRound: t.phase !== 'betting' };
  }
  /** Partir. Avant la distribution : mises remboursées (jamais engagées). Pendant une manche : la place reste jusqu'au
   * règlement, ses mains sont jouées par RESTER et payées normalement ; rien n'est remboursé ni effacé. */
  function leave(user) {
    if (down) throw err('core_unavailable');
    const t = tableOf(user);
    const i = seatOf(t, user);
    const s = t.seats[i];
    if (t.phase === 'betting' || !s.inRound) {
      if (s.bet && t.phase === 'betting') wallet.apply(`unbet:${t.id}:${t.round + 1}:${user}:${s.betRev}`, user, s.bet.reserved, 'départ avant la donne');
      free(t, i, 'left');
      maybeStart(t); // les autres étaient peut-être tous prêts
      return { ok: true, refunded: !!s.bet };
    }
    s.status = 'left';
    where.delete(user); // il peut s'asseoir ailleurs ; cette main finit sans lui
    if (t.phase === 'insurance' && !s.ins) s.ins = { stake: 0 }; // parti : pas d'assurance
    emit(t, 'leave', { seat: i });
    if (t.phase === 'insurance' && playing(t).every(([x]) => x.ins)) closeInsurance(t);
    if (t.turn?.seat === i) schedule(t, clock.now() + T.leftActMs, () => auto(t, 'left'));
    return { ok: true, engaged: true };
  }
  function setConnected(user, on) {
    const id = where.get(user);
    if (!id) return;
    const t = tables.get(id);
    const s = t.seats[seatOf(t, user)];
    if (!s || s.connected === on) return;
    s.connected = on;
    emit(t, on ? 'reconnect' : 'disconnect', { seat: seatOf(t, user) });
    if (!on) maybeStart(t); // un déconnecté ne bloque pas la donne (sa mise non confirmée sera rendue)
  }

  return {
    TIMING: T,
    wallet,
    tables: () => [...tables.values()].map((t) => ({ id: t.id, no: t.no, players: t.seats.filter(Boolean).length, seats: TABLE.seats, taken: t.seats.map(Boolean), phase: t.phase, round: t.round })),
    tableOf: (user) => where.get(user) ?? null,
    join,
    leave,
    placeBets,
    clearBets,
    act,
    insure,
    setConnected,
    view: (tableId, viewer) => view(tables.get(tableId), viewer),
    subscribe(tableId, viewer, cb) {
      if (!subs.has(tableId)) subs.set(tableId, new Set());
      const sub = { viewer, cb };
      subs.get(tableId).add(sub);
      return () => subs.get(tableId)?.delete(sub);
    },
    limits: () => L,
    /** Lab : changer les limites économiques fictives (une manche déjà engagée garde les siennes). */
    setLimits(next) {
      if (!lab) throw err('lab_only');
      L = { ...L, ...next };
    },
    ensureTable: () => (tables.size ? [...tables.values()][0].id : newTable().id),
    // Lab
    rig(tableId, r) {
      if (!lab) throw err('lab_only');
      tables.get(tableId).rig = r;
    },
    /** Lab : une interruption du Core (aucune action acceptée ; les échéances passées s'appliquent à la reprise). */
    crash() {
      down = true;
      for (const h of timers.values()) clock.clearTimeout(h);
      timers.clear();
    },
    resume() {
      down = false;
      for (const t of tables.values()) {
        if (!t.next) continue;
        // On rejoue l'étape attendue : chaque étape est idempotente côté Wallet (clés uniques).
        const at = t.next.at;
        if (t.phase === 'betting' && t.betDeadline) schedule(t, at, () => closeBetting(t));
        else if (t.phase === 'players' && t.turn) schedule(t, t.turn.deadline + T.graceMs, () => auto(t, 'timeout'));
        else if (t.phase === 'players') schedule(t, at, () => nextTurn(t, 0, 0));
        else if (t.phase === 'dealing') schedule(t, at, () => afterDeal(t));
        else if (t.phase === 'insurance') schedule(t, t.insDeadline + T.graceMs, () => closeInsurance(t));
        else if (t.phase === 'shuffle') schedule(t, at, () => deal(t));
        else if (t.phase === 'dealer') schedule(t, at, () => (R.dealerHits(t.dealer) ? dealerPlays(t) : settle(t)));
        else if (t.phase === 'settled') schedule(t, at, () => endRound(t));
        emit(t, 'resume');
      }
    },
    isDown: () => down,
    /** Tests : l'état interne complet (le sabot compris) — JAMAIS exposé à un client. */
    _internal: (tableId) => tables.get(tableId),
    _settleAgain: (tableId) => settle(tables.get(tableId)),
  };
}
