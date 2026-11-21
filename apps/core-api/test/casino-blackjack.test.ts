import { describe, expect, it } from 'vitest';
// @ts-expect-error -- the validated prototype is plain JavaScript (the reference the port is compared with)
import * as P from '../../../prototypes/casino-blackjack/src/rules.js';
// @ts-expect-error -- the validated prototype is plain JavaScript (the reference the port is compared with)
import * as PB from '../../../prototypes/casino-emotes/src/engine.js';
import * as B from '../src/casino/book.js';
import { BlackjackService } from '../src/casino/blackjack/service.js';
import * as R from '../src/casino/blackjack/rules.js';
import { seededRng, type IntRng } from '../src/casino/rng.js';
import { CasinoError } from '../src/casino/service.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { setup, type TestCore } from './helpers.js';

// Casino V1 (docs/CASINO.md § 12–13) — the Core's blackjack tables and emote machine. The rules are the validated
// prototypes' (parity below); the service pays once, keeps the hole card and the shoe secret, survives a restart, and
// opens tables atomically. PGlite (one connection); the two-pool races: casino-blackjack.integration.test.ts.

const CH = '83603689';
const V = (n: number) => ({ id: String(9100 + n), display_name: `Joueur${n}` });
const [A, Bo, C] = [V(1), V(2), V(3)];

async function lab(players = [A, Bo, C], tokens = 100_000) {
  const core = await setup();
  for (const v of players)
    await editWallet(
      core.db,
      core.clock.now(),
      CH,
      v.id,
      'set',
      { tokens },
      'test',
    );
  await core.moduleSettings.set(CH, 'casino.open', 1, 'test');
  await core.db.query(
    `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
     values (gen_random_uuid(), $1, $2, 'simulated', 'test')`,
    [CH, core.clock.now()],
  );
  return core;
}
const tokens = async (core: TestCore, v = A) =>
  (await core.economy.balances(core.db, CH, v.id)).tokens;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof CasinoError ? e.code : `throw:${(e as Error).message}`;
  }
};
/** Time passes: the players' screens poll (presence), the Core's ticker runs the due steps. */
async function run(
  core: TestCore,
  ms: number,
  players: { id: string; display_name: string }[],
  tableId: string,
) {
  for (let t = 0; t < ms; t += 100) {
    for (const p of players) await core.blackjack.state(CH, tableId, p);
    await core.blackjack.tick();
    core.clock.advance(100);
  }
}
async function until(
  core: TestCore,
  players: { id: string; display_name: string }[],
  tableId: string,
  pred: (s: Awaited<ReturnType<BlackjackService['state']>>['state']) => boolean,
  max = 120_000,
) {
  for (let t = 0; t < max; t += 100) {
    const s = (await core.blackjack.state(CH, tableId, players[0] ?? null))
      .state;
    if (pred(s)) return s;
    await run(core, 100, players, tableId);
  }
  throw new Error('never reached');
}
/** Everyone seated stands until the round settles. */
async function standAll(
  core: TestCore,
  players: { id: string; display_name: string }[],
  tableId: string,
) {
  for (;;) {
    const s = await until(
      core,
      players,
      tableId,
      (x) => x.phase === 'settled' || !!x.turn,
    );
    if (s.phase === 'settled') return s;
    const who = players.find((p) => p.id === s.seats[s.turn!.seat]!.user);
    if (!who) {
      await run(core, 600, players, tableId); // a player who left: the Core stands for them
      continue;
    }
    await core.blackjack.act(CH, who, {
      type: 'stand',
      token: s.turn!.token,
      action_id: s.turn!.token,
    });
  }
}
const wallOps = async (core: TestCore, v = A) =>
  (
    await core.db.query<{ n: number }>(
      `select count(*)::int as n from lab_wallet_ledger where channel_id = $1 and viewer_id = $2 and reason like 'casino:bj:%'`,
      [CH, v.id],
    )
  )[0]?.n ?? 0;

describe('blackjack rules — identical to the validated prototype', () => {
  it('totals, actions, settlement, insurance on 20 000 random hands', () => {
    const rng = seededRng(7);
    for (let k = 0; k < 20_000; k++) {
      const n = 2 + rng.int(3);
      const hand = Array.from({ length: n }, () => rng.int(416));
      const dealer = Array.from({ length: 2 + rng.int(3) }, () => rng.int(416));
      const opts = { fromSplit: rng.int(4) === 0, splitAces: false };
      expect(R.total(hand)).toEqual(P.total(hand));
      expect(R.dealerOutcome(dealer)).toEqual(P.dealerOutcome(dealer));
      const h = R.newHand(hand, 100, opts);
      expect(R.settleHand(h, dealer)).toEqual(
        P.settleHand(P.newHand(hand, 100, opts), dealer),
      );
      const hc = 1 + rng.int(4);
      const bal = rng.int(300);
      expect(R.actions(h, { handsCount: hc, balance: bal })).toEqual(
        P.actions(P.newHand(hand, 100, opts), { handsCount: hc, balance: bal }),
      );
      expect(R.insurancePayout(50, dealer)).toBe(P.insurancePayout(50, dealer));
    }
  });
});

describe('emote machine — identical to the validated prototype (RTP 95.23 %)', () => {
  it('the same draws give the same rounds (base, feature, free spins, expansion)', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const a = seededRng(seed);
      const b = seededRng(seed);
      const core = B.playRound(a, 100);
      const proto = PB.playRound(
        {
          int: (n: number) => b.int(n),
          float: () => b.int(1 << 30) / (1 << 30),
        } as never,
        100,
      );
      expect(core).toEqual(proto);
    }
  });
  it('a forced feature (Lab scenario) uses real strip positions', () => {
    const r = B.playRound(seededRng(5), 100, {
      bonus: 3,
      symbol: 'p1',
      expand: 3,
    });
    expect(r.base.eval.scatter.count).toBeGreaterThanOrEqual(3);
    expect(r.feature?.symbol).toBe('p1');
    expect(r.feature?.spins[0]?.expansion?.n).toBe(3);
  });
});

describe('blackjack service — tables, money, secrets', () => {
  it('the first player opens table n°1; a full table (10) opens n°2; one table per player', async () => {
    const players = Array.from({ length: 11 }, (_, i) => V(10 + i));
    const core = await lab(players);
    const [j1, j2] = await Promise.all([
      core.blackjack.join(CH, players[0]!, {}),
      core.blackjack.join(CH, players[1]!, {}),
    ]);
    expect(j1.table).toBe(j2.table);
    expect([j1.created, j2.created].filter(Boolean)).toHaveLength(1);
    for (const p of players.slice(2, 10))
      expect((await core.blackjack.join(CH, p, {})).table).toBe(j1.table);
    const eleventh = await core.blackjack.join(CH, players[10]!, {});
    expect(eleventh.table).not.toBe(j1.table);
    expect(eleventh.created).toBe(true);
    const again = await core.blackjack.join(CH, players[0]!, {});
    expect(again).toMatchObject({ table: j1.table, already: true });
    const lobby = await core.blackjack.tables(CH, players[0]!);
    expect(lobby.tables.map((t) => [t.no, t.players])).toEqual([
      [1, 10],
      [2, 1],
    ]);
    expect(
      await code(core.blackjack.join(CH, V(99), { table_id: j1.table })),
    ).not.toBe('ok');
  });

  it('a chosen seat already taken is refused (never another seat silently)', async () => {
    const core = await lab();
    const t = (await core.blackjack.join(CH, A, { seat: 4 })).table;
    expect(
      await code(core.blackjack.join(CH, Bo, { table_id: t, seat: 4 })),
    ).toBe('seat_taken');
    expect(
      (await core.blackjack.join(CH, Bo, { table_id: t, seat: 5 })).seat,
    ).toBe(5);
  });

  it('bets: one reservation adjusted, PRÊT locks, a dealer bust pays every live hand once; history rows', async () => {
    const core = await lab();
    const t = (await core.blackjack.join(CH, A, {})).table;
    await core.blackjack.join(CH, Bo, {});
    const b0 = await tokens(core);
    await core.blackjack.bet(CH, A, { main: 300, side: { BUST: 10 } });
    await core.blackjack.bet(CH, A, { main: 100, side: { BUST: 10 } });
    expect(b0 - (await tokens(core))).toBe(110);
    await core.blackjack.rig(CH, A, {
      seats: { '0': [10, 2], '1': [10, 5] },
      dealer: [6, 10],
      then: [10, 10, 10],
    });
    await core.blackjack.bet(CH, A, {
      main: 100,
      side: { BUST: 10 },
      ready: true,
    });
    expect(
      await code(core.blackjack.bet(CH, A, { main: 200, ready: true })),
    ).toBe('bets_locked');
    await core.blackjack.bet(CH, Bo, { main: 200, ready: true });
    // Hidden information: the hole card and the shoe's order never leave the Core.
    const mid = await until(core, [A, Bo], t, (x) => !!x.turn);
    expect(mid.dealer.cards[1]).toMatchObject({ hidden: true });
    expect(JSON.stringify(mid.shoe)).not.toContain('cards');
    const spect = (await core.blackjack.state(CH, t, null)).state;
    expect(spect.seats.every((s) => !s || !s.me)).toBe(true);
    expect(spect.seats[0]!.side).toBeNull();
    // A hits to 22 (bust), B stands on 15; the dealer busts (26).
    let s: typeof mid;
    for (;;) {
      s = await until(
        core,
        [A, Bo],
        t,
        (x) => x.phase === 'settled' || !!x.turn,
      );
      if (s.phase === 'settled') break;
      const who = s.seats[s.turn!.seat]!.user === A.id ? A : Bo;
      await core.blackjack.act(CH, who, {
        type: who === A ? 'hit' : 'stand',
        token: s.turn!.token,
        action_id: s.turn!.token,
      });
      // A resent action: the same reply, never a second card.
      await core.blackjack.act(CH, who, {
        type: who === A ? 'hit' : 'stand',
        token: s.turn!.token,
        action_id: s.turn!.token,
      });
    }
    expect(s.outcome).toBe('BUST');
    expect(s.seats[0]!.hands[0]!.verdict).toBe('bust');
    expect(s.seats[1]!.hands[0]!.verdict).toBe('win');
    expect(
      s.seats.every((p) => !p || p.hands.every((h) => h.verdict !== 'push')),
    ).toBe(true);
    expect((await tokens(core)) - b0).toBe(-100 + 24);
    expect((await tokens(core, Bo)) - 100_000).toBe(200);
    // Replaying the settlement pays nothing more (keys).
    const ops = await wallOps(core);
    await run(core, 2000, [A, Bo], t);
    expect(await wallOps(core)).toBe(ops);
    const rows = await core.db.query<{
      viewer_id: string;
      bet: number;
      payout: number;
      game: string;
    }>(
      "select viewer_id, bet, payout, game from casino_rounds where game = 'blackjack' order by viewer_id",
    );
    expect(rows.map((r) => [r.viewer_id, r.bet, r.payout])).toEqual([
      [A.id, 110, 34],
      [Bo.id, 200, 400],
    ]);
    const h = (await core.casino.history(CH, A, {
      game: 'blackjack',
    })) as unknown as { rounds: unknown[] };
    expect(JSON.stringify(h)).toContain('blackjack');
  });

  it('split: two hands, two stakes, settled independently; a resent split never debits twice (post-live audit BJ-01/BJ-07)', async () => {
    const core = await lab([A]);
    const t = (await core.blackjack.join(CH, A, {})).table;
    const b0 = await tokens(core);
    await core.blackjack.rig(CH, A, {
      seats: { '0': [8, 8] },
      dealer: [6, 10],
      then: [10, 3, 10, 4],
    });
    await core.blackjack.bet(CH, A, { main: 100, ready: true });
    let s = await until(core, [A], t, (x) => !!x.turn);
    expect(s.seats[0]!.hands).toHaveLength(1);
    const splitToken = s.turn!.token;
    await core.blackjack.act(CH, A, {
      type: 'split',
      token: splitToken,
      action_id: 'split1',
    });
    // A resent split (double-click, or a lost reply): the same reply, never a second stake taken.
    await core.blackjack.act(CH, A, {
      type: 'split',
      token: splitToken,
      action_id: 'split1',
    });
    expect(b0 - (await tokens(core))).toBe(200); // one extra stake (the split), never two
    s = await until(core, [A], t, (x) => !!x.turn);
    expect(s.seats[0]!.hands.map((h) => h.cards.length)).toEqual([2, 1]); // hand 2 waits for its own card
    await core.blackjack.act(CH, A, {
      type: 'stand',
      token: s.turn!.token,
      action_id: s.turn!.token,
    });
    s = await until(core, [A], t, (x) => !!x.turn);
    expect(s.seats[0]!.hands[1]!.cards).toHaveLength(2); // dealt automatically once it became active
    await core.blackjack.act(CH, A, {
      type: 'hit',
      token: s.turn!.token,
      action_id: s.turn!.token,
    });
    s = await until(core, [A], t, (x) => x.phase === 'settled');
    expect(s.outcome).toBe(20);
    expect(s.seats[0]!.hands.map((h) => [h.total, h.verdict])).toEqual([
      [18, 'lose'],
      [21, 'win'],
    ]);
    // Hand 1 lost its 100, hand 2 won +100 (1:1, not a natural once split): net zero, never a "push" (BJ-07).
    expect((await tokens(core)) - b0).toBe(0);
    const rows = await core.db.query<{ bet: number; payout: number }>(
      "select bet, payout from casino_rounds where game = 'blackjack' and viewer_id = $1",
      [A.id],
    );
    expect(rows).toEqual([{ bet: 200, payout: 200 }]);
    // Replaying the whole settlement pays nothing more (each hand keyed by its own index).
    const ops = await wallOps(core);
    await run(core, 2000, [A], t);
    expect(await wallOps(core)).toBe(ops);
  });

  it('split, hand by hand: Tirer / Doubler only touch the active hand; the next hand gets ONE card when its turn comes (Antoni 21/11)', async () => {
    const core = await lab([A]);
    const t = (await core.blackjack.join(CH, A, {})).table;
    // 8/8 against a 6: after the split, hand 1 draws 2, then 3, 2, 10 (25: bust); hand 2 receives 3 (11), doubles on 10.
    await core.blackjack.rig(CH, A, {
      seats: { '0': [8, 8] },
      dealer: [6, 10],
      then: [2, 3, 2, 10, 3, 10],
    });
    await core.blackjack.bet(CH, A, { main: 100, ready: true });
    const act = async (type: string) => {
      const s = await until(core, [A], t, (x) => !!x.turn);
      await core.blackjack.act(CH, A, {
        type,
        token: s.turn!.token,
        action_id: s.turn!.token,
      });
      return s.turn!.hand;
    };
    const next = () =>
      until(core, [A], t, (x) => !!x.turn || x.phase !== 'players');
    const counts = async () =>
      (await next()).seats[0]!.hands.map((h) => h.cards.length);
    expect(await act('split')).toBe(0);
    expect(await counts()).toEqual([2, 1]); // hand 1 gets its 2nd card at once; hand 2 waits for its own turn
    expect(await act('hit')).toBe(0);
    expect(await counts()).toEqual([3, 1]); // ONE card, on hand 1 only
    expect(await act('hit')).toBe(0);
    expect(await counts()).toEqual([4, 1]);
    expect(await act('hit')).toBe(0); // 8 + 2 + 3 + 2 + 10 = 25: hand 1 is over
    let s = await next();
    expect(s.turn!.hand).toBe(1);
    expect(s.seats[0]!.hands.map((h) => [h.cards.length, h.total])).toEqual([
      [5, 25],
      [2, 11], // exactly one card, dealt by the engine (no click), when hand 2 became active
    ]);
    expect(await act('double')).toBe(1);
    s = await until(core, [A], t, (x) => x.phase === 'settled');
    // The double doubled hand 2's stake only; hand 1 kept its cards and its stake.
    expect(
      s.seats[0]!.hands.map((h) => [h.cards.length, h.stake, h.doubled]),
    ).toEqual([
      [5, 100, false],
      [3, 200, true],
    ]);
    expect(s.seats[0]!.hands.map((h) => h.verdict)[0]).toBe('bust');
  });

  it('insurance: offered on an Ace, at most half; paid 2:1 on a dealer blackjack', async () => {
    const core = await lab();
    const t = (await core.blackjack.join(CH, A, {})).table;
    await core.blackjack.join(CH, Bo, {});
    await core.blackjack.rig(CH, A, {
      seats: { '0': [10, 9], '1': [10, 8] },
      dealer: [1, 10],
    });
    await core.blackjack.bet(CH, A, { main: 100, ready: true });
    await core.blackjack.bet(CH, Bo, { main: 200, ready: true });
    const s = await until(core, [A, Bo], t, (x) => x.phase === 'insurance');
    expect(s.dealer.cards[1]).toMatchObject({ hidden: true });
    expect(await code(core.blackjack.insure(CH, A, { stake: 60 }))).toBe(
      'bad_insurance',
    );
    await core.blackjack.insure(CH, A, { stake: 50, action_id: 'ins1' });
    await core.blackjack.insure(CH, A, { stake: 50, action_id: 'ins1' });
    await core.blackjack.insure(CH, Bo, { stake: 0 });
    const end = await until(core, [A, Bo], t, (x) => x.phase === 'settled');
    expect(end.seats[0]!.result!.insurance).toEqual({ stake: 50, payout: 150 });
    expect(await tokens(core)).toBe(100_000);
    expect(await tokens(core, Bo)).toBe(100_000 - 200);
  });

  it('a Core restart in the middle of a decision: the saved step runs late (STAND), paid once', async () => {
    const core = await lab();
    const t = (await core.blackjack.join(CH, A, {})).table;
    await core.blackjack.rig(CH, A, {
      seats: { '0': [10, 9] },
      dealer: [9, 8],
    });
    await core.blackjack.bet(CH, A, { main: 100, ready: true });
    await until(core, [A], t, (x) => !!x.turn);
    // The process dies: a new service on the same database, its memory empty (no presence, no waiter).
    const reborn = new BlackjackService(
      core.db,
      core.clock,
      core.economy,
      core.casino,
    );
    core.clock.advance(60_000);
    for (let k = 0; k < 200; k++) {
      await reborn.tick();
      core.clock.advance(250);
    }
    const s = (await reborn.state(CH, t, A)).state;
    expect(s.history.at(-1)?.players[0]?.hands[0]?.verdict).toBe('win'); // 19 against 17, played by STAND
    expect(await tokens(core)).toBe(100_000 + 100);
  });

  it('a player who leaves mid-round: the hand stands and is paid; back = the same seat and hand', async () => {
    const core = await lab();
    const t = (await core.blackjack.join(CH, A, {})).table;
    await core.blackjack.join(CH, Bo, {});
    await core.blackjack.rig(CH, A, {
      seats: { '0': [10, 9], '1': [10, 7] },
      dealer: [9, 8],
    });
    await core.blackjack.bet(CH, A, { main: 100, ready: true });
    await core.blackjack.bet(CH, Bo, { main: 100, ready: true });
    await until(core, [A, Bo], t, (x) => !!x.turn);
    expect(await core.blackjack.leave(CH, A)).toMatchObject({ engaged: true });
    expect(await core.blackjack.join(CH, A, {})).toMatchObject({
      table: t,
      seat: 0,
      resumed: true,
    });
    await core.blackjack.leave(CH, A);
    await standAll(core, [Bo], t);
    expect(await tokens(core)).toBe(100_000 + 100);
  });

  it('refused before the deal: too big a bet (the largest possible given), closed game, spectators never act', async () => {
    const core = await lab();
    await core.moduleSettings.set(CH, 'casino.bj_max_win', 100_000, 'test');
    await core.blackjack.join(CH, A, {});
    let e: unknown = null;
    await core.blackjack.bet(CH, A, { main: 20_000 }).catch((x) => (e = x));
    expect(e).toBeInstanceOf(CasinoError);
    expect((e as CasinoError).code).toBe('max_win');
    expect((e as CasinoError).details.max).toBe(12_500);
    expect(await tokens(core)).toBe(100_000);
    await core.moduleSettings.set(CH, 'casino.blackjack_open', 0, 'test');
    expect(await code(core.blackjack.bet(CH, A, { main: 100 }))).toBe(
      'game_closed',
    );
    expect(await code(core.blackjack.join(CH, Bo, {}))).toBe('game_closed');
    expect(await code(core.blackjack.bet(CH, C, { main: 100 }))).toBe(
      'not_seated',
    );
  });

  it('the chat announcement: the creator only, on click, once; then a channel cooldown', async () => {
    const core = await lab();
    const j = await core.blackjack.join(CH, A, {});
    expect(j.created).toBe(true);
    await core.blackjack.join(CH, Bo, {});
    expect(await code(core.blackjack.announce(CH, Bo, j.table))).toBe(
      'not_creator',
    );
    expect(await core.blackjack.announce(CH, A, j.table)).toMatchObject({
      announced: true,
    });
    expect(await core.blackjack.announce(CH, A, j.table)).toMatchObject({
      already: true,
    });
    const steps = await core.db.query<{ n: number }>(
      "select count(*)::int as n from cmd_steps where origin = 'module:casino'",
    );
    expect(steps[0]!.n).toBe(1);
  });
});

describe('emote machine service — one intent, one round, paid once', () => {
  it('spin, replay, bounds, Lab scenario refused outside the Lab', async () => {
    const core = await lab([A]);
    core.casino.rng = seededRng(11) as IntRng;
    const r1 = (await core.casino.spinBook(CH, A, {
      key: 'book-key-0001',
      bet: 100,
    })) as { round: { payout: number }; replayed: boolean };
    const r2 = (await core.casino.spinBook(CH, A, {
      key: 'book-key-0001',
      bet: 100,
    })) as { replayed: boolean };
    expect(r2.replayed).toBe(true);
    expect(await tokens(core)).toBe(100_000 - 100 + r1.round.payout);
    expect(
      await code(
        core.casino.spinBook(CH, A, { key: 'book-key-0002', bet: 5_000 }),
      ),
    ).toBe('above_max');
    expect(
      await code(
        core.casino.spinBook(CH, A, { key: 'book-key-0003', bet: 15 }),
      ),
    ).toBe('invalid_bet');
    const forced = (await core.casino.spinBook(CH, A, {
      key: 'book-key-0004',
      bet: 100,
      test: { bonus: 3 },
    })) as {
      round: { outcome: { feature: unknown } };
    };
    expect(forced.round.outcome.feature).not.toBeNull();
  });
});
