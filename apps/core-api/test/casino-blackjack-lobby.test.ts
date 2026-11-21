import { describe, expect, it } from 'vitest';
import {
  BASE_TABLES,
  closable,
  createPolicy,
  EMPTY_CLOSE_MS,
  MAX_TABLES,
  nextTableNo,
} from '../src/casino/blackjack/lobby.js';
import {
  REACTION_BURST,
  REACTION_GAP_MS,
  REACTION_KEEP_MS,
  TableReactions,
} from '../src/casino/blackjack/reactions.js';
import { CasinoError } from '../src/casino/service.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { setup, type TestCore } from './helpers.js';

// Blackjack tables and reactions (docs/CASINO.md § 18, Antoni's mandate of 21/11): the « new table » policy, the closing
// of durably empty tables, the players' reactions (allowed ids, pace, transmission with the table's state). PGlite; the
// two-Core races of the lobby: casino-blackjack.integration.test.ts.

const CH = '83603689';
const V = (n: number) => ({ id: String(9300 + n), display_name: `Joueur${n}` });

async function lab(n = 12) {
  const core = await setup();
  for (let i = 0; i < n; i++)
    await editWallet(
      core.db,
      core.clock.now(),
      CH,
      V(i).id,
      'set',
      { tokens: 50_000 },
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
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof CasinoError ? e.code : `throw:${(e as Error).message}`;
  }
};
const lobby = (core: TestCore, v = V(0)) => core.blackjack.tables(CH, v);
const tokens = async (core: TestCore, v = V(0)) =>
  (await core.economy.balances(core.db, CH, v.id)).tokens;

describe('table policy (lobby.ts)', () => {
  it('5 tables, +1 per busy table (6 players or more), 8 at most; an empty table is reused', () => {
    const t = (no: number, players: number) => ({ no, players });
    expect(createPolicy([])).toMatchObject({ allowed: true, cap: BASE_TABLES });
    const five = [1, 2, 3, 4, 5].map((no) => t(no, 1));
    expect(createPolicy(five)).toMatchObject({
      allowed: false,
      reason: 'tables_cap',
      cap: 5,
      open: 5,
    });
    expect(createPolicy([...five.slice(1), t(1, 6)])).toMatchObject({
      allowed: true,
      cap: 6,
    });
    expect(createPolicy([t(1, 3), t(2, 0), t(3, 0)])).toMatchObject({
      allowed: true,
      reuse: 2,
    });
    const eight = Array.from({ length: MAX_TABLES }, (_, i) => t(i + 1, 10));
    expect(createPolicy(eight)).toMatchObject({
      allowed: false,
      reason: 'casino_full',
      cap: MAX_TABLES,
    });
  });

  it('a new table takes the smallest free number', () => {
    expect(nextTableNo([])).toBe(1);
    expect(nextTableNo([1, 2, 4])).toBe(3);
    expect(nextTableNo([2, 3])).toBe(1);
  });

  it('closes a table empty for 10 min with no pending step — never the lowest-numbered one', () => {
    const now = 1_000_000_000;
    const old = now - EMPTY_CLOSE_MS;
    const tb = (
      id: string,
      no: number,
      players: number,
      since: number,
      pending = false,
    ) => ({ id, no, players, since, pending });
    expect(
      closable(
        [
          tb('a', 1, 0, old), // the lowest: kept
          tb('b', 2, 0, old), // closed
          tb('c', 3, 0, now - EMPTY_CLOSE_MS + 1), // not yet 10 min
          tb('d', 4, 1, old), // someone (even a player who left a round in progress)
          tb('e', 5, 0, old, true), // a pending step
        ],
        now,
      ),
    ).toEqual(['b']);
  });
});

describe('reactions (reactions.ts)', () => {
  it('numbers follow the clock and never go back; a screen gets their age', () => {
    const r = new TableReactions();
    const n1 = r.push('t', 'u1', 0, 'r1', 1000);
    const n2 = r.push('t', 'u2', 3, 'r5', 1000);
    expect(n2).toBeGreaterThan(n1);
    expect(n1).toBeGreaterThanOrEqual(1000);
    expect(r.seq('t')).toBe(n2);
    expect(r.view('t', 1400)).toEqual({
      seq: n2,
      list: [
        { n: n1, seat: 0, r: 'r1', age_ms: 400 },
        { n: n2, seat: 3, r: 'r5', age_ms: 400 },
      ],
    });
    expect(r.view('t', 1000 + REACTION_KEEP_MS).list).toEqual([]);
    expect(r.seq('other')).toBe(0);
  });

  it('one reaction per 1.5 s per viewer, 8 per 30 s at most', () => {
    const r = new TableReactions();
    r.push('t', 'u', 0, 'r1', 0);
    let err: unknown;
    try {
      r.push('t', 'u', 0, 'r2', REACTION_GAP_MS - 1);
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({
      code: 'react_rate',
      status: 429,
      details: { retry_in_ms: 1 },
    });
    let t = 0;
    for (let k = 1; k < REACTION_BURST; k++)
      r.push('t', 'u', 0, 'r1', (t += REACTION_GAP_MS));
    expect(() => r.push('t', 'u', 0, 'r1', (t += REACTION_GAP_MS))).toThrow(
      'react_rate',
    );
    expect(() => r.push('t', 'other', 1, 'r1', t)).not.toThrow(); // another viewer: his own pace
  });
});

describe('blackjack: « new table », closing empty tables (service, PGlite)', () => {
  it('a player opens a table of his own while table 1 has free seats; the lobby says what « new table » would do', async () => {
    const core = await lab();
    const a = await core.blackjack.join(CH, V(0), {});
    expect(a).toMatchObject({ created: true, no: 1 });
    expect((await lobby(core)).create).toEqual({
      allowed: true,
      reason: null,
      cap: 5,
      open: 1,
    });
    const b = await core.blackjack.join(CH, V(1), { new_table: true });
    expect(b).toMatchObject({ created: true, no: 2 });
    const l = await lobby(core, V(2));
    expect(l.tables.map((t) => [t.no, t.players])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    // Public and joinable: anyone may sit at table 2.
    expect(
      await core.blackjack.join(CH, V(2), { table_id: b.table }),
    ).toMatchObject({ table: b.table });
    // One player, one table: a seated player asking for a new table stays where he is.
    expect(
      await core.blackjack.join(CH, V(0), { new_table: true }),
    ).toMatchObject({ already: true, table: a.table });
    expect((await lobby(core)).tables).toHaveLength(2);
  });

  it('never two empty tables: asking for a new one while one is empty seats you there', async () => {
    const core = await lab();
    await core.blackjack.join(CH, V(0), {});
    const b = await core.blackjack.join(CH, V(1), { new_table: true });
    await core.blackjack.leave(CH, V(1)); // table 2 is empty now
    const c = await core.blackjack.join(CH, V(2), { new_table: true });
    expect(c).toMatchObject({
      table: b.table,
      reused: true,
      created: false,
      no: 2,
    });
    expect((await lobby(core)).tables).toHaveLength(2);
  });

  it('the ceiling: 5 tables of one player; a 6th « new table » is refused (find a seat still works); a busy table raises it', async () => {
    const core = await lab();
    for (let i = 0; i < 5; i++)
      await core.blackjack.join(CH, V(i), i ? { new_table: true } : {});
    expect(await code(core.blackjack.join(CH, V(5), { new_table: true }))).toBe(
      'tables_cap',
    );
    expect((await lobby(core, V(5))).create).toMatchObject({
      allowed: false,
      reason: 'tables_cap',
      cap: 5,
      open: 5,
    });
    const j = await core.blackjack.join(CH, V(5), {});
    expect(j.created).toBe(false);
    // Table 1 fills up to 6 players: one more table is allowed.
    const t1 = (await lobby(core)).tables.find((t) => t.no === 1)!.id;
    for (let i = 6; i < 11 && (await lobby(core)).tables[0]!.players < 6; i++)
      await core.blackjack.join(CH, V(i), { table_id: t1 });
    expect((await lobby(core, V(11))).create).toMatchObject({
      allowed: true,
      cap: 6,
    });
    expect(
      await core.blackjack.join(CH, V(11), { new_table: true }),
    ).toMatchObject({ created: true, no: 6 });
  });

  it('a table empty for 10 minutes closes (not table 1); a spectator gets « no_table »; its numbers are reused; no Jetons move', async () => {
    const core = await lab();
    const a = await core.blackjack.join(CH, V(0), {});
    const b = await core.blackjack.join(CH, V(1), { new_table: true });
    await core.blackjack.leave(CH, V(1));
    await core.blackjack.leave(CH, V(0)); // table 1 empty too: it stays (the lowest)
    const before = await tokens(core, V(1));
    core.clock.advance(EMPTY_CLOSE_MS - 1000);
    await core.blackjack.sweep();
    expect((await lobby(core)).tables).toHaveLength(2); // not yet
    core.clock.advance(61_000);
    expect(await core.blackjack.sweep()).toBe(1);
    const l = await lobby(core);
    expect(l.tables.map((t) => t.no)).toEqual([1]);
    expect(await code(core.blackjack.state(CH, b.table, null))).toBe(
      'no_table',
    );
    expect(await tokens(core, V(1))).toBe(before);
    // The freed number 2 is the next table's.
    await core.blackjack.join(CH, V(0), { table_id: a.table });
    expect(
      await core.blackjack.join(CH, V(2), { new_table: true }),
    ).toMatchObject({ created: true, no: 2 });
  });

  it('a table with a round still pending is never closed, even with every player gone', async () => {
    const core = await lab();
    await core.blackjack.join(CH, V(0), {});
    const b = await core.blackjack.join(CH, V(1), { new_table: true });
    await core.blackjack.bet(CH, V(1), { main: 100, ready: true });
    // The deal is pending (next_at set): leaving keeps the seat as « left » until the round settles.
    await core.blackjack.leave(CH, V(1));
    core.clock.advance(EMPTY_CLOSE_MS + 120_000);
    await core.blackjack.sweep();
    expect((await lobby(core)).tables.map((t) => t.id)).toContain(b.table);
  });
});

describe('blackjack: reactions (service, PGlite)', () => {
  it('a seated player reacts; every screen of the table receives it with the state; no Jetons, no database row', async () => {
    const core = await lab();
    const a = await core.blackjack.join(CH, V(0), {});
    await core.blackjack.join(CH, V(1), { table_id: a.table });
    const before = await tokens(core);
    expect(await code(core.blackjack.react(CH, V(5), { r: 'r1' }))).toBe(
      'not_seated',
    );
    expect(await code(core.blackjack.react(CH, V(0), { r: 'hello' }))).toBe(
      'bad_reaction',
    );
    expect(await code(core.blackjack.react(CH, V(0), { r: '<b>' }))).toBe(
      'bad_reaction',
    );
    const r = await core.blackjack.react(CH, V(0), { r: 'r3' });
    expect(r.ok).toBe(true);
    const spect = await core.blackjack.state(CH, a.table, null);
    expect(spect.reactions).toMatchObject({
      on: true,
      dealer: true,
      ids: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
      seq: r.n,
      list: [
        {
          n: r.n,
          seat: spect.state.seats.findIndex((s) => s?.user === V(0).id),
          r: 'r3',
        },
      ],
    });
    expect(await code(core.blackjack.react(CH, V(0), { r: 'r4' }))).toBe(
      'react_rate',
    );
    core.clock.advance(REACTION_GAP_MS);
    expect(await code(core.blackjack.react(CH, V(0), { r: 'r4' }))).toBe('ok');
    expect(await tokens(core)).toBe(before);
    const rows = await core.db.query<{ n: number }>(
      `select count(*)::int as n from lab_wallet_ledger where channel_id = $1 and viewer_id = $2`,
      [CH, V(0).id],
    );
    expect(rows[0]!.n).toBe(1); // the test's own wallet set only
  });

  it('the long-poll answers for a new reaction (rx), not only for a new state', async () => {
    const core = await lab();
    const a = await core.blackjack.join(CH, V(0), {});
    const first = await core.blackjack.state(CH, a.table, V(1));
    const seq = first.state.seq;
    const rx = first.reactions.seq;
    const t0 = Date.now();
    const waiting = core.blackjack.state(CH, a.table, V(1), seq, 5_000, rx);
    setTimeout(() => void core.blackjack.react(CH, V(0), { r: 'r6' }), 50);
    const got = await waiting;
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(got.state.seq).toBe(seq);
    expect(got.reactions.list.map((x) => x.r)).toEqual(['r6']);
  });

  it('the streamer turns them off: refused, and the screens are told (no « Réagir » button)', async () => {
    const core = await lab();
    const a = await core.blackjack.join(CH, V(0), {});
    await core.moduleSettings.set(CH, 'casino.bj_reactions', 0, 'test');
    await core.moduleSettings.set(CH, 'casino.bj_dealer_reactions', 0, 'test');
    expect(await code(core.blackjack.react(CH, V(0), { r: 'r1' }))).toBe(
      'reactions_off',
    );
    expect(
      (await core.blackjack.state(CH, a.table, null)).reactions,
    ).toMatchObject({
      on: false,
      dealer: false,
      ids: [],
    });
  });

  it('the table announcement is off by default (an explicit choice of the streamer to offer it)', async () => {
    const core = await lab();
    expect((await core.casino.limits(core.db, CH)).bj_announce).toBe(false);
  });
});
