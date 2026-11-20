import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMING, TABLE, createCore, createWallet } from '../src/core-sim.js';
import * as R from '../src/rules.js';
import { SIDE_PAYS } from '../src/paytable.js';

/** Une horloge simulée : rien ne s'écoule tant que le test n'avance pas le temps. */
function fakeClock() {
  let now = 1_000_000;
  let id = 0;
  let q = [];
  return {
    now: () => now,
    setTimeout(fn, ms) {
      q.push({ h: ++id, at: now + ms, fn });
      return id;
    },
    clearTimeout(h) {
      q = q.filter((x) => x.h !== h);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at);
        const x = q[0];
        if (!x || x.at > end) break;
        q.shift();
        now = x.at;
        x.fn();
      }
      now = end;
    },
  };
}
const START = 100_000;
function setup(users = ['a', 'b', 'c'], opts = {}) {
  const clock = fakeClock();
  const wallet = createWallet(Object.fromEntries(users.map((u) => [u, opts.balance ?? START])));
  const core = createCore({ wallet, clock, seed: opts.seed ?? 42, lab: true });
  for (const u of users) core.join(u, u.toUpperCase(), opts.table ? { tableId: opts.table } : {});
  const table = core.tableOf(users[0]);
  const v = (u = users[0]) => core.view(core.tableOf(u) ?? table, u);
  /** Avance jusqu'à ce que `pred(view)` soit vrai (tours d'horloge de 50 ms). */
  const until = (pred, max = 120_000, who = users[0]) => {
    for (let t = 0; t < max; t += 50) {
      if (pred(core.view(table, who))) return core.view(table, who);
      clock.advance(50);
    }
    throw new Error(`jamais atteint (phase ${core.view(table, who).phase})`);
  };
  const turnOf = (u) => until((x) => x.phase === 'settled' || (x.turn && x.seats[x.turn.seat]?.user === u));
  return { clock, wallet, core, table, v, until, turnOf };
}
/** La somme des soldes + ce que la banque a gagné = la somme de départ (aucun Jeton créé ni perdu). */
function conserved(wallet, users, initial) {
  const house = -wallet.ops().reduce((a, o) => a + o.delta, 0);
  const sum = users.reduce((a, u) => a + wallet.balance(u), 0);
  assert.equal(sum + house, initial, 'Jetons conservés');
}

test('une manche complète : mises réservées, banque jusqu’à 17, paiements une seule fois et justes', () => {
  const users = ['a', 'b', 'c'];
  const { core, wallet, until, table } = setup(users);
  core.placeBets('a', { main: 100, side: { 20: 50, BUST: 20 }, ready: true });
  core.placeBets('b', { main: 200, ready: true });
  core.placeBets('c', { main: 100, ready: true });
  assert.equal(wallet.balance('a'), START - 170, 'débit réservé dès la mise');
  // Tout le monde prêt : la donne part sans attendre la fin de la fenêtre.
  let x = until((v) => v.phase === 'players' || v.phase === 'dealer' || v.phase === 'settled');
  while (x.phase === 'players') {
    if (x.turn) core.act(x.seats[x.turn.seat].user, { type: 'stand', token: x.turn.token, actionId: `s-${x.turn.token}` });
    x = until((v) => v.phase !== 'players' || (v.turn && v.turn.token !== x.turn?.token));
  }
  x = until((v) => v.phase === 'settled');
  const internal = core._internal(table);
  const out = R.dealerOutcome(internal.dealer);
  assert.ok(R.isNatural(internal.dealer) || R.total(internal.dealer).total >= 17, 'la banque a fini');
  for (const s of x.seats.filter(Boolean)) {
    const exp = s.hands.reduce((a, h) => a + R.settleHand({ ...h, cards: h.cards.map((c) => c.id) }, internal.dealer).payout, 0);
    const side = Object.values(s.result.side).reduce((a, r) => a + r.payout, 0);
    assert.equal(s.result.paid, exp + side);
  }
  const a = x.seats.find((s) => s?.user === 'a');
  assert.equal(a.result.side['20'].payout, out === 20 ? 50 * SIDE_PAYS[20] : 0);
  assert.equal(a.result.side.BUST.payout, out === 'BUST' ? 20 * SIDE_PAYS.BUST : 0);
  // Un deuxième règlement (reprise après interruption) ne paie rien de plus.
  const before = users.map((u) => wallet.balance(u));
  core._settleAgain(table);
  assert.deepEqual(users.map((u) => wallet.balance(u)), before, 'aucun double paiement');
  conserved(wallet, users, START * 3);
});

test('la carte cachée et le sabot ne sortent jamais avant leur moment', () => {
  const { core, until, table } = setup(['a', 'b']);
  core.placeBets('a', { main: 100, ready: true });
  core.placeBets('b', { main: 100, ready: true });
  const x = until((v) => v.phase === 'players' || v.phase === 'dealer');
  const hole = core._internal(table).dealer[1];
  if (x.phase === 'players') {
    const json = JSON.stringify(core.view(table, 'a'));
    assert.ok(x.dealer.cards[1].hidden, 'cachée');
    assert.ok(!json.includes(`"id":${hole},`) && !json.includes(`"id":${hole}}`), 'son identité n’est pas envoyée');
    assert.equal(x.dealer.total, R.total([core._internal(table).dealer[0]]).total, 'total de la carte visible seulement');
    assert.ok(!('cards' in x.shoe), 'le sabot n’est jamais envoyé');
  }
});

test('idempotence : double clic, réponse perdue, action hors tour ou périmée', () => {
  const { core, until, table } = setup(['a', 'b']);
  core.rig(table, { seats: { 0: [10, 2], 1: [10, 3] }, dealer: [9, 8], then: [2] });
  core.placeBets('a', { main: 100, ready: true });
  core.placeBets('b', { main: 100, ready: true });
  const x = until((v) => !!v.turn);
  const u = x.seats[x.turn.seat].user;
  assert.equal(u, 'a');
  const other = u === 'a' ? 'b' : 'a';
  assert.throws(() => core.act(other, { type: 'hit', token: x.turn.token, actionId: 'z' }), /not_your_turn/);
  assert.throws(() => core.act('nobody', { type: 'hit', token: x.turn.token }), /not_seated/, 'un spectateur ne peut pas agir');
  const n = core.view(x.table, u).seats[x.turn.seat].hands[0].cards.length;
  const r1 = core.act(u, { type: 'hit', token: x.turn.token, actionId: 'h1' });
  const r2 = core.act(u, { type: 'hit', token: x.turn.token, actionId: 'h1' }); // le même clic renvoyé
  assert.deepEqual(r1, r2);
  assert.equal(core.view(x.table, u).seats[x.turn.seat].hands[0].cards.length, n + 1, 'une seule carte');
  assert.throws(() => core.act(u, { type: 'hit', token: x.turn.token, actionId: 'h2' }), /no_decision_now|stale_turn/, 'deuxième clic distinct sur le même tour');
});

test('timer : sans réponse, RESTER à l’échéance + tolérance ; une action après est refusée', () => {
  const { core, until, clock } = setup(['a']);
  core.rig(core.tableOf('a'), { seats: { 0: [10, 2] }, dealer: [9, 8], then: [2] }); // 12 contre 9, puis 14
  core.placeBets('a', { main: 100, ready: true });
  const x = until((v) => !!v.turn);
  assert.equal(x.turn.deadline - x.turn.startsAt, TIMING.decisionFirstMs, 'première décision : la fenêtre longue');
  clock.advance(TIMING.decisionFirstMs + TIMING.graceMs - 100);
  assert.equal(core.view(x.table, 'a').turn?.token, x.turn.token, 'toujours son tour pendant la tolérance');
  core.act('a', { type: 'hit', token: x.turn.token, actionId: 'late-but-ok' }); // dans la tolérance : accepté
  const y = until((v) => !!v.turn || v.phase !== 'players');
  assert.ok(y.turn, '14 : encore une décision');
  assert.equal(y.seats[0].hands[0].total, 14);
  assert.equal(y.turn.deadline - y.turn.startsAt, TIMING.decisionMs, 'décision suivante : 20 s');
  clock.advance(TIMING.decisionMs + TIMING.graceMs + 10);
  assert.throws(() => core.act('a', { type: 'hit', token: y.turn.token }), /stale_turn|no_decision_now|too_late/);
  const z = core.view(x.table, 'a');
  assert.ok(z.seats[0].hands[0].done, 'main terminée par RESTER');
  assert.equal(z.seats[0].hands[0].cards.length, 3, 'aucune carte tirée à sa place');
  assert.equal(z.seats[0].timeouts, 1);
});

test('départ pendant la manche : mise jamais remboursée, main jouée par RESTER, gains crédités, place libérée après', () => {
  const users = ['a', 'b'];
  const { core, wallet, until, table } = setup(users);
  core.rig(table, { seats: { 0: [10, 10], 1: [10, 9] }, dealer: [10, 6], then: [10] }); // la banque saute (26)
  core.placeBets('a', { main: 100, ready: true });
  core.placeBets('b', { main: 100, ready: true });
  until((v) => v.phase === 'players');
  const r = core.leave('a');
  assert.equal(r.engaged, true);
  assert.equal(wallet.balance('a'), START - 100, 'rien de remboursé');
  const x = until((v) => v.phase === 'settled', 120_000, 'b');
  const a = x.seats.find((s) => s?.user === 'a');
  assert.equal(a.status, 'left');
  assert.equal(a.result.paid, 200, '20 contre une banque qui saute : gagné, crédité');
  assert.equal(wallet.balance('a'), START + 100);
  until((v) => v.phase === 'betting', 120_000, 'b');
  assert.ok(!core.view(table, 'b').seats.some((s) => s?.user === 'a'), 'place libérée');
  conserved(wallet, users, START * 2);
});

test('départ AVANT la donne : la mise (non engagée) est remboursée', () => {
  const { core, wallet } = setup(['a', 'b']);
  core.placeBets('a', { main: 300, side: { BJ: 20 }, ready: false });
  assert.equal(wallet.balance('a'), START - 320);
  core.leave('a');
  assert.equal(wallet.balance('a'), START);
});

test('revenir pendant la manche : il retrouve SA place et sa main (une seule participation)', () => {
  const { core, until, table } = setup(['a', 'b']);
  core.rig(table, { seats: { 0: [10, 2], 1: [10, 2] }, dealer: [9, 8] });
  core.placeBets('a', { main: 100, ready: true });
  core.placeBets('b', { main: 100, ready: true });
  until((v) => v.phase === 'players');
  core.leave('a');
  const j = core.join('a', 'A');
  assert.equal(j.resumed, true);
  assert.equal(j.table, table);
  assert.equal(core.view(table, 'a').seats.filter((s) => s?.user === 'a').length, 1);
  assert.equal(core.join('a', 'A').already, true, 'rejoindre encore : la même place');
});

test('déconnexion : la table continue, les décisions suivent le même timer', () => {
  const { core, until, clock, table } = setup(['a', 'b']);
  core.rig(table, { seats: { 0: [10, 2], 1: [10, 3] }, dealer: [9, 8] });
  core.placeBets('a', { main: 100, ready: true });
  core.placeBets('b', { main: 100, ready: true });
  until((v) => !!v.turn);
  core.setConnected('a', false);
  assert.equal(core.view(table, 'b').seats[0].connected, false);
  clock.advance(TIMING.decisionFirstMs + TIMING.graceMs + 50);
  const x = until((v) => v.turn?.seat === 1 || v.phase === 'settled', 120_000, 'b');
  assert.ok(x.seats[0].hands[0].done, 'sa main a été terminée (RESTER)');
  core.setConnected('a', true); // reprise : il voit l'état réel, la manche a continué
  assert.equal(core.view(table, 'a').seats[0].connected, true);
});

test('absent répété : la place est libérée après 2 manches sans jouer', () => {
  const { core, until, table, clock } = setup(['a', 'b']);
  for (let round = 0; round < 3; round++) {
    core.placeBets('b', { main: 100, ready: true });
    until((v) => v.phase === 'settled', 200_000, 'b');
    clock.advance(TIMING.resultMs + 10);
  }
  assert.equal(core.tableOf('a'), null, 'A libéré');
  assert.ok(core.view(table, 'b').seats.some((s) => s?.user === 'b'));
});

test('split : mise égale débitée, re-split jusqu’à 4 mains, double après split', () => {
  const { core, wallet, until, table } = setup(['a']);
  core.rig(table, { seats: { 0: [8, 8] }, dealer: [6, 10], then: [8, 8, 3, 10, 8, 10, 10, 10] });
  core.placeBets('a', { main: 100, ready: true });
  let x = until((v) => !!v.turn);
  core.act('a', { type: 'split', token: x.turn.token, actionId: 'sp1' });
  x = until((v) => !!v.turn);
  assert.equal(x.seats[0].hands.length, 2);
  core.act('a', { type: 'split', token: x.turn.token, actionId: 'sp2' }); // 8 + 8 : re-split
  x = until((v) => !!v.turn);
  core.act('a', { type: 'split', token: x.turn.token, actionId: 'sp3' });
  x = until((v) => !!v.turn);
  assert.equal(x.seats[0].hands.length, 4, 'quatre mains');
  assert.equal(wallet.balance('a'), START - 400, '4 mises');
  // La main active (8 + 3 = 11) : double après split.
  const h = x.seats[0].hands[x.turn.hand];
  assert.deepEqual([h.cards.length, h.total], [2, 11]);
  core.act('a', { type: 'double', token: x.turn.token, actionId: 'dbl' });
  assert.equal(wallet.balance('a'), START - 500);
  // Une main suivante en 8 + 8 : la 5e main est refusée.
  x = until((v) => !!v.turn);
  const nxt = x.seats[0].hands[x.turn.hand];
  assert.equal(nxt.cards.length, 2);
  assert.deepEqual(nxt.cards.map((c) => R.valueOf(c.id)), [8, 8], 'une paire…');
  assert.throws(() => core.act('a', { type: 'split', token: x.turn.token, actionId: 'sp4' }), /not_allowed/, '…mais pas de 5e main');
  // Le reste : RESTER partout.
  for (;;) {
    x = until((v) => !!v.turn || v.phase === 'settled');
    if (x.phase === 'settled') break;
    core.act('a', { type: 'stand', token: x.turn.token, actionId: `st-${x.turn.token}` });
  }
  conserved(wallet, ['a'], START);
});

test('As splittés : une carte chacun, pas de re-split, A + 10 vaut 21 payé 1:1 (pas 3:2)', () => {
  const { core, wallet, until, table } = setup(['a']);
  core.rig(table, { seats: { 0: [1, 1] }, dealer: [9, 8], then: [10, 10] });
  core.placeBets('a', { main: 100, ready: true });
  const x = until((v) => !!v.turn);
  core.act('a', { type: 'split', token: x.turn.token, actionId: 'spA' });
  const y = until((v) => v.phase === 'settled');
  assert.equal(y.seats[0].hands.length, 2);
  for (const h of y.seats[0].hands) {
    assert.equal(h.cards.length, 2, 'une seule carte par As');
    assert.equal(h.total, 21);
    assert.equal(h.natural, false);
    assert.equal(h.verdict, 'win');
    assert.equal(h.payout, 200, '1:1');
  }
  assert.equal(wallet.balance('a'), START + 200);
});

test('blackjack de la banque : vérifié avant les décisions ; BJ joueur = égalité ; paris BJ payés, 21 non', () => {
  const { core, wallet, until, table } = setup(['a', 'b']);
  core.rig(table, { seats: { 0: [1, 10], 1: [10, 9] }, dealer: [1, 10] });
  core.placeBets('a', { main: 100, side: { BJ: 50, 21: 50 }, ready: true });
  core.placeBets('b', { main: 100, ready: true });
  const x = until((v) => v.phase === 'settled' || !!v.turn);
  assert.equal(x.turn, null, 'aucune décision proposée');
  assert.equal(x.phase, 'settled');
  assert.equal(x.outcome, 'BJ');
  const a = x.seats[0];
  assert.equal(a.hands[0].verdict, 'push');
  assert.equal(a.result.side.BJ.payout, 50 * SIDE_PAYS.BJ);
  assert.equal(a.result.side['21'].payout, 0);
  assert.equal(x.seats[1].hands[0].verdict, 'lose');
  assert.equal(wallet.balance('a'), START - 200 + 100 + 50 * SIDE_PAYS.BJ);
});

test('tous les joueurs sautent : la banque termine quand même sa main, les paris sur la banque se résolvent', () => {
  const { core, until, table } = setup(['a']);
  core.rig(table, { seats: { 0: [10, 6] }, dealer: [10, 2], then: [10, 3, 4] }); // A saute (26) ; banque 12 → 15 → 19
  core.placeBets('a', { main: 100, side: { 19: 100 }, ready: true });
  const x = until((v) => !!v.turn);
  core.act('a', { type: 'hit', token: x.turn.token, actionId: 'bust' });
  const y = until((v) => v.phase === 'settled');
  assert.equal(y.seats[0].hands[0].verdict, 'bust');
  assert.equal(y.dealer.cards.length, 4, 'la banque a tiré');
  assert.equal(y.outcome, 19);
  assert.equal(y.seats[0].result.side['19'].payout, 100 * SIDE_PAYS[19]);
});

test('limites : minimum 100, aucun plafond fixe, gain potentiel borné (doubles et splits compris), refus avant la donne', () => {
  const { core, wallet, until, table } = setup(['a'], { balance: 2_000_000 });
  assert.throws(() => core.placeBets('a', { main: 50 }), /bad_main_bet/, 'minimum 100');
  assert.throws(() => core.placeBets('a', { main: 155 }), /bad_main_bet/, 'multiple de 10');
  // Gain max 1 000 000 net : pire cas 8 mises (3 splits + 4 doubles) → la mise principale va jusqu'à 125 000.
  core.placeBets('a', { main: 125_000 });
  const e = (() => { try { core.placeBets('a', { main: 125_010 }); } catch (x) { return x; } })();
  assert.equal(e.code, 'max_win');
  assert.equal(e.max, 125_000, 'la raison donne la mise maximale encore possible');
  // Les paris sur la banque comptent dans l'exposition (un seul peut gagner : le meilleur retour).
  const f = (() => { try { core.placeBets('a', { main: 125_000, side: { BJ: 100 } }); } catch (x) { return x; } })();
  assert.equal(f.code, 'max_win');
  assert.throws(() => core.placeBets('a', { main: 1000, side: { BJ: 6000 } }), /side_max_return/, 'retour banque 114 000 > 100 000 (18:1)');
  assert.throws(() => core.placeBets('a', { main: 1000, side: { 99: 10 } }), /bad_side_spot/);
  assert.throws(() => core.placeBets('a', { main: 1000, side: { 17: 15 } }), /bad_side_bet/);
  core.clearBets('a');
  assert.equal(wallet.balance('a'), 2_000_000);
  // Doubler sans le solde : refusé (jamais un double partiel).
  const w2 = setup(['z'], { balance: 150 });
  w2.core.rig(w2.table, { seats: { 0: [5, 6] }, dealer: [9, 8] });
  w2.core.placeBets('z', { main: 100, ready: true });
  const x = w2.until((v) => !!v.turn);
  assert.throws(() => w2.core.act('z', { type: 'double', token: x.turn.token, actionId: 'd' }), /not_allowed/, '50 restants < 100');
  void until;
  void table;
});

test('Lab : les limites fictives se changent (gain max 100 000 → mise max 12 500)', () => {
  const { core } = setup(['a'], { balance: 1_000_000 });
  core.setLimits({ maxWin: 100_000 });
  assert.throws(() => core.placeBets('a', { main: 12_510 }), /max_win/);
  core.placeBets('a', { main: 12_500 });
});

test('PRÊT : mise principale + plusieurs paris banque, un seul débit chacun, puis verrouillé', () => {
  const { core, wallet } = setup(['a', 'b']);
  core.placeBets('a', { main: 500, side: { 17: 100, BJ: 100 } });
  assert.equal(wallet.balance('a'), START - 700, 'total engagé 700');
  core.placeBets('a', { main: 500, side: { 17: 100, BJ: 100 } }); // le même envoi rejoué
  assert.equal(wallet.balance('a'), START - 700, 'jamais débité deux fois');
  core.placeBets('a', { main: 400, side: { 17: 100, BJ: 100, BUST: 50 } }); // retirer un jeton, ajouter un pari
  assert.equal(wallet.balance('a'), START - 650);
  core.placeBets('a', { main: 400, side: { 17: 100, BJ: 100, BUST: 50 }, ready: true });
  assert.throws(() => core.placeBets('a', { main: 1000 }), /bets_locked/, 'verrouillé après PRÊT');
  assert.throws(() => core.clearBets('a'), /bets_locked/);
  const v = core.view(core.tableOf('a'), 'a');
  assert.equal(v.ready, 1);
  assert.equal(v.waiting, 1, 'B pas encore prêt');
  assert.equal(v.phase, 'betting', 'on attend B');
});

test('mises : aucun compte à rebours tant que personne n’est prêt ; la table attend calmement', () => {
  const { core, clock, table } = setup(['a', 'b']);
  core.placeBets('a', { main: 100 });
  clock.advance(10 * 60_000);
  const v = core.view(table, 'a');
  assert.equal(v.phase, 'betting');
  assert.equal(v.betDeadline, null);
});

test('délai de secours : un joueur pas prêt est exclu, sa réservation rendue, la manche part avec les prêts', () => {
  const { core, wallet, clock, table } = setup(['a', 'b', 'c']);
  core.placeBets('a', { main: 300, ready: true });
  core.placeBets('b', { main: 200, side: { 20: 50 } }); // posé, jamais confirmé
  const v = core.view(table, 'a');
  assert.equal(v.betDeadline - clock.now(), TIMING.betSafetyMs);
  clock.advance(TIMING.betSafetyMs + 10);
  const x = core.view(table, 'b');
  assert.notEqual(x.phase, 'betting');
  assert.equal(x.seats[0].inRound, true);
  assert.equal(x.seats[1].inRound, false, 'B exclu');
  assert.equal(x.seats[2].inRound, false, 'C (rien posé) exclu');
  assert.equal(wallet.balance('b'), START, 'jamais engagé : rendu');
  assert.equal(x.seats[1].idle, 1);
});

test('un déconnecté pas prêt ne bloque pas la donne ; un spectateur ne peut rien engager', () => {
  const { core, wallet, table } = setup(['a', 'b']);
  core.placeBets('b', { main: 100 });
  core.placeBets('a', { main: 100, ready: true });
  core.setConnected('b', false);
  assert.notEqual(core.view(table, 'a').phase, 'betting');
  wallet.apply('init:s', 'spect', 5000);
  assert.throws(() => core.placeBets('spect', { main: 100, ready: true }), /not_seated/);
  assert.equal(wallet.balance('spect'), 5000);
});

test('fenêtre réduite pour un joueur qui a laissé filer le timer la manche d’avant, rétablie dès qu’il joue', () => {
  const { core, until, clock, table } = setup(['a']);
  core.rig(table, { seats: { 0: [10, 2] }, dealer: [9, 8] });
  core.placeBets('a', { main: 100, ready: true });
  let x = until((v) => !!v.turn);
  clock.advance(TIMING.decisionFirstMs + TIMING.graceMs + 10); // absent
  until((v) => v.phase === 'settled');
  clock.advance(TIMING.resultMs + 10);
  core.rig(table, { seats: { 0: [10, 2] }, dealer: [9, 8] });
  core.placeBets('a', { main: 100, ready: true });
  x = until((v) => !!v.turn);
  assert.equal(x.turn.deadline - x.turn.startsAt, TIMING.decisionAbsentMs);
  core.act('a', { type: 'stand', token: x.turn.token, actionId: 'back' });
  assert.equal(core.view(table, 'a').seats[0].absences, 0, 'il est revenu');
});

test('historique : les résultats de la manche, produits par le Core, limités aux manches récentes', () => {
  const { core, until, clock, table } = setup(['a', 'b']);
  for (let r = 0; r < 17; r++) {
    core.rig(table, { seats: { 0: [10, 9], 1: [10, 5] }, dealer: [10, 8] });
    core.placeBets('a', { main: 100, side: { 18: 10 }, ready: true });
    core.placeBets('b', { main: 200, ready: true });
    for (;;) {
      const x = until((v) => !!v.turn || v.phase === 'settled');
      if (x.phase === 'settled') break;
      core.act(x.seats[x.turn.seat].user, { type: 'stand', token: x.turn.token, actionId: `h${r}${x.turn.token}` });
    }
    clock.advance(TIMING.resultMs + 10);
  }
  const h = core._internal(table).history;
  assert.equal(h.length, 15, '15 manches gardées');
  const last = core.view(table, 'b').history.at(-1);
  assert.equal(last.outcome, 18);
  assert.deepEqual(last.players.map((p) => [p.name, p.net]), [['A', 100 - 10 + 65], ['B', -200]], 'main +100, pari banque 18 : 10 → 65');
  assert.deepEqual(last.sides, [{ name: 'A', spot: '18', stake: 10, payout: 65 }]);
  // Le détail de l'historique : mise principale et ce qu'elle a rendu, chaque main, chaque pari (misé, retour brut).
  const [a, b] = last.players;
  assert.deepEqual([a.main, a.mainPaid, a.hands, a.side], [100, 200, [{ total: 19, verdict: 'win', doubled: false }], [{ spot: '18', stake: 10, payout: 65 }]]);
  assert.deepEqual([b.main, b.mainPaid, b.hands[0].verdict], [200, 0, 'lose']);
  assert.equal(a.net, a.mainPaid - a.main + a.side[0].payout - a.side[0].stake, 'net = payé − misé, partout');
  assert.equal(core.view(table, 'spectateur').history.length, 12, 'le même historique pour un spectateur');
});

test('mises concurrentes (deux onglets) : la réservation suit la dernière, jamais additionnée', () => {
  const { core, wallet } = setup(['a', 'b']);
  core.placeBets('a', { main: 500, ready: false });
  core.placeBets('a', { main: 500, ready: false }); // le même envoi rejoué
  assert.equal(wallet.balance('a'), START - 500);
  core.placeBets('a', { main: 200, ready: false }); // l'autre onglet réduit
  assert.equal(wallet.balance('a'), START - 200);
});

test('salon : une table se remplit jusqu’à 7 avant d’en ouvrir une autre, 10 places au plus, une place par joueur', () => {
  const clock = fakeClock();
  const users = Array.from({ length: 20 }, (_, i) => `u${i}`);
  const core = createCore({ wallet: createWallet(Object.fromEntries(users.map((u) => [u, 1000]))), clock, seed: 1 });
  users.forEach((u) => core.join(u, u));
  const t = core.tables();
  assert.deepEqual(t.map((x) => x.players), [7, 7, 6]);
  assert.equal(core.join('u0', 'u0').already, true);
  // Rejoindre une table précise (en attente) jusqu'à 10.
  const more = ['x1', 'x2', 'x3', 'x4'];
  for (const u of more.slice(0, 3)) core.join(u, u, { tableId: t[0].id });
  assert.equal(core.tables()[0].players, 10);
  assert.throws(() => core.join('x4', 'x4', { tableId: t[0].id }), /table_full/);
  assert.equal(TABLE.seats, 10);
});

test('rejoindre une table en pleine manche : il joue la suivante', () => {
  const { core, until, table, wallet } = setup(['a']);
  core.placeBets('a', { main: 100, ready: true });
  until((v) => v.phase !== 'betting');
  wallet.apply('init:z', 'z', 1000);
  const j = core.join('z', 'Z', { tableId: table });
  assert.equal(j.nextRound, true);
  assert.throws(() => core.placeBets('z', { main: 100, ready: true }), /betting_closed/);
  const x = core.view(table, 'z');
  assert.equal(x.seats[j.seat].inRound, false);
});

test('interruption du Core : rien n’est accepté pendant, la manche reprend, un seul paiement', () => {
  const users = ['a'];
  const { core, wallet, until, clock, table } = setup(users);
  core.rig(table, { seats: { 0: [10, 9] }, dealer: [10, 7] });
  core.placeBets('a', { main: 100, ready: true });
  const x = until((v) => !!v.turn);
  core.crash();
  assert.throws(() => core.act('a', { type: 'stand', token: x.turn.token }), /core_unavailable/);
  clock.advance(60_000); // le Core est tombé longtemps : aucun timer n'a joué
  assert.equal(core.view(table, 'a').phase, 'players');
  core.resume(); // l'échéance est passée : RESTER s'applique, la manche se termine
  const y = until((v) => v.phase === 'settled');
  assert.equal(y.seats[0].hands[0].verdict, 'win');
  core._settleAgain(table);
  assert.equal(wallet.balance('a'), START + 100, 'payé une fois');
  conserved(wallet, users, START);
});

test('remélange : au passage de la coupe, entre deux manches, jamais pendant', () => {
  const { core, until, table, clock } = setup(['a']);
  let shuffles = 0;
  core.subscribe(table, 'a', (v) => v.last?.type === 'shuffle' && shuffles++);
  for (let r = 0; r < 40; r++) {
    core.placeBets('a', { main: 100, ready: true });
    const x = until((v) => v.phase === 'players' || v.phase === 'settled');
    if (x.turn) core.act('a', { type: 'stand', token: x.turn.token, actionId: `r${r}` });
    until((v) => v.phase === 'settled');
    assert.ok(core._internal(table).shoe.pos < R.SHOE_SIZE);
    clock.advance(TIMING.resultMs + 10);
  }
  assert.ok(shuffles >= 1, `remélangé ${shuffles} fois`);
});

test('choisir sa place : la place demandée, et un refus si elle vient d’être prise', () => {
  const clock = fakeClock();
  const core = createCore({ wallet: createWallet({ a: 1000, b: 1000 }), clock, seed: 2 });
  const t = core.ensureTable();
  assert.equal(core.join('a', 'A', { tableId: t, seat: 7 }).seat, 7);
  assert.throws(() => core.join('b', 'B', { tableId: t, seat: 7 }), /seat_taken/);
  assert.equal(core.join('b', 'B', { tableId: t, seat: 2 }).seat, 2);
  assert.deepEqual(core.tables()[0].taken.map((x, i) => (x ? i : -1)).filter((i) => i >= 0), [2, 7]);
});

test('banque bust (Core) : les mains vivantes gagnent, la main bust perd, aucune égalité', () => {
  const { core, until, table, wallet } = setup(['a', 'b', 'c']);
  // a reste sur 12, b reste sur 20, c tire sur 15 et saute ; la banque 6 + 10 tire un 10 : 26.
  core.rig(table, { seats: { 0: [10, 2], 1: [10, 10], 2: [10, 5] }, dealer: [6, 10], then: [10, 10, 10] });
  core.placeBets('a', { main: 100, side: { BUST: 10 }, ready: true });
  core.placeBets('b', { main: 200, ready: true });
  core.placeBets('c', { main: 100, ready: true });
  for (;;) {
    const x = until((v) => v.phase === 'settled' || !!v.turn);
    if (x.phase === 'settled') break;
    const u = x.seats[x.turn.seat].user;
    core.act(u, { type: u === 'c' ? 'hit' : 'stand', token: x.turn.token, actionId: `${x.turn.token}` });
  }
  const x = core.view(table, 'a');
  assert.equal(x.outcome, 'BUST');
  const by = (u) => x.seats.find((p) => p?.user === u);
  assert.deepEqual(by('a').hands.map((h) => h.verdict), ['win'], '12 contre banque bust : gagné');
  assert.deepEqual(by('b').hands.map((h) => h.verdict), ['win']);
  assert.deepEqual(by('c').hands.map((h) => h.verdict), ['bust'], 'c a sauté avant la banque : perdu');
  assert.equal(by('a').result.net, 100 + 24, 'main +100, pari BUST 10 → 34 (+24)');
  assert.equal(wallet.balance('b'), START + 200);
  assert.ok(x.seats.every((p) => !p || p.hands.every((h) => h.verdict !== 'push')), 'aucune égalité');
});

/** La donne jusqu'à l'assurance (As visible). */
function toInsurance(rig) {
  const ctx = setup(['a', 'b']);
  ctx.core.rig(ctx.table, rig);
  ctx.core.placeBets('a', { main: 100, ready: true });
  ctx.core.placeBets('b', { main: 200, ready: true });
  const x = ctx.until((v) => v.phase === 'insurance' || v.phase === 'players' || v.phase === 'settled');
  return { ...ctx, x };
}
const standAll = (core, until) => {
  for (;;) {
    const y = until((v) => v.phase === 'settled' || !!v.turn);
    if (y.phase === 'settled') return y;
    core.act(y.seats[y.turn.seat].user, { type: 'stand', token: y.turn.token });
  }
};
test('assurance : As visible et blackjack de la banque → assurance payée 2:1', () => {
  const { core, until, x, wallet, table } = toInsurance({ seats: { 0: [10, 9], 1: [10, 8] }, dealer: [1, 10] });
  assert.equal(x.phase, 'insurance', 'un As visible : l’assurance est proposée');
  assert.equal(x.dealer.cards[1].hidden, true, 'la carte cachée reste cachée');
  assert.equal(x.seats[0].insurance, null, 'en attente de réponse');
  assert.throws(() => core.insure('a', { stake: 60 }), /bad_insurance/, 'plus de la moitié : refusé');
  assert.throws(() => core.insure('a', { even: true }), /not_allowed/, 'even money : seulement avec un blackjack');
  core.insure('a', { stake: 50, actionId: 'i1' });
  assert.deepEqual(core.insure('a', { stake: 50, actionId: 'i1' }), { ok: true, stake: 50 }, 'renvoyée : la même réponse');
  assert.throws(() => core.insure('a', { stake: 0 }), /already_answered/);
  core.insure('b', { stake: 0 });
  const end = until((v) => v.phase === 'settled');
  assert.equal(end.peeked, true);
  const a = end.seats[0].result;
  assert.deepEqual(a.insurance, { stake: 50, payout: 150 }, '50 assurés → 150 rendus (+100)');
  assert.equal(a.net, 0, 'main perdue (−100), assurance +100 : net 0');
  assert.equal(wallet.balance('a'), START);
  assert.equal(end.seats[1].result.net, -200, 'b n’a pas assuré : −200');
  assert.equal(wallet.ops().filter((o) => o.key.startsWith('ins')).length, 2, 'un débit, un paiement');
  assert.deepEqual(core.view(table, 'a').history.at(-1).players[0].insurance, { stake: 50, payout: 150 });
});
test('assurance : As visible sans blackjack → assurance perdue, la main continue normalement', () => {
  const { core, until, x } = toInsurance({ seats: { 0: [10, 9], 1: [10, 8] }, dealer: [1, 7] });
  assert.equal(x.phase, 'insurance');
  core.insure('a', { stake: 50 });
  core.insure('b', { stake: 100 });
  const p = until((v) => v.phase === 'players');
  assert.equal(p.peeked, false, 'la banque a vérifié : pas de blackjack');
  const end = standAll(core, until);
  assert.equal(end.outcome, 18);
  assert.deepEqual(end.seats[0].result.insurance, { stake: 50, payout: 0 });
  assert.equal(end.seats[0].result.net, 100 - 50, '19 bat 18 : +100, assurance perdue −50');
  assert.equal(end.seats[1].result.net, -100, '18 contre 18 : égalité (0), assurance perdue −100');
});
test('assurance : pas de réponse = pas d’assurance ; jamais face à un 10', () => {
  const { until, x } = toInsurance({ seats: { 0: [10, 9], 1: [10, 8] }, dealer: [1, 7] });
  assert.equal(x.phase, 'insurance');
  const p = until((v) => v.phase === 'players');
  assert.deepEqual([p.seats[0].insurance, p.seats[1].insurance], [{ stake: 0 }, { stake: 0 }], 'temps écoulé : refusée, rien débité');
  const ten = toInsurance({ seats: { 0: [10, 9], 1: [10, 8] }, dealer: [10, 7] });
  assert.equal(ten.x.phase, 'players', 'un 10 visible : pas d’assurance');
  const tenBJ = toInsurance({ seats: { 0: [10, 9], 1: [10, 8] }, dealer: [10, 1] });
  assert.notEqual(tenBJ.x.phase, 'insurance', 'blackjack de la banque avec un 10 visible : réglé sans assurance');
});
test('even money : mon blackjack contre un As est payé 1:1, que la banque ait blackjack ou non', () => {
  for (const hole of [10, 9]) {
    const { core, until, wallet } = toInsurance({ seats: { 0: [1, 10], 1: [10, 8] }, dealer: [1, hole] });
    core.insure('a', { even: true });
    core.insure('b', { stake: 0 });
    const end = standAll(core, until);
    assert.equal(end.seats[0].hands[0].verdict, 'even');
    assert.equal(end.seats[0].result.net, 100, `banque ${hole === 10 ? 'blackjack' : 'sans blackjack'} : +100`);
    assert.equal(wallet.balance('a'), START + 100);
  }
  // Sans even money, le blackjack contre le blackjack de la banque : égalité.
  const { core, until } = toInsurance({ seats: { 0: [1, 10], 1: [10, 8] }, dealer: [1, 10] });
  core.insure('a', { stake: 0 });
  core.insure('b', { stake: 0 });
  assert.equal(until((v) => v.phase === 'settled').seats[0].hands[0].verdict, 'push');
});
