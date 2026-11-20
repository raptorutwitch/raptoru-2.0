// Casino V1 blackjack (docs/CASINO.md § 12) on a real Postgres with TWO Cores (two pools, two services): the races a
// browser can cause — two first players opening an empty blackjack at once, the same seat clicked by two viewers, the
// same intent sent from two tabs, both Cores' tickers running the same due step — end with ONE table n°1, ONE seat
// holder, ONE debit, ONE settlement; Jetons are conserved.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npx vitest run test/casino-blackjack.integration.test.ts
// The database is wiped: only local URLs to a database whose name contains "test" are accepted. Fictional data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlackjackService } from '../src/casino/blackjack/service.js';
import { CASINO_SETTINGS, CasinoService } from '../src/casino/service.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { labEconomy } from '../src/economy/economy.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { ModuleSettings } from '../src/module-settings/service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '900551';
const P = Array.from({ length: 12 }, (_, i) => ({
  id: String(900560 + i),
  display_name: `Fictif${i}`,
}));

describe.skipIf(!isLocal)('blackjack, real Postgres, two Cores', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;
  const clock = new FakeClock(new Date('2026-12-01T20:00:00Z'));
  const settingsOf = (db: Db) => {
    const s = new ModuleSettings(db, clock);
    s.register(
      Object.fromEntries(
        Object.entries(CASINO_SETTINGS).map(([k, v]) => [`casino.${k}`, v]),
      ),
    );
    return s;
  };
  const bj = (db: Db) => {
    const casino = new CasinoService(db, clock, labEconomy, settingsOf(db));
    casino.labEnvironment = true;
    return new BlackjackService(db, clock, labEconomy, casino);
  };
  const sum = async () =>
    Number(
      (
        await a.query<{ s: string }>(
          'select coalesce(sum(tokens), 0) as s from lab_wallets where channel_id = $1',
          [CH],
        )
      )[0]!.s,
    );
  const house = async () =>
    -Number(
      (
        await a.query<{ s: string }>(
          "select coalesce(sum(amount), 0) as s from lab_wallet_ledger where channel_id = $1 and reason like 'casino:bj:%'",
          [CH],
        )
      )[0]!.s,
    );

  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    b = createPgDb(url!);
    await settingsOf(a).set(CH, 'casino.open', 1, 'test');
    await a.query(
      `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
       values (gen_random_uuid(), $1, $2, 'simulated', 'test')`,
      [CH, clock.now()],
    );
    for (const p of P)
      await editWallet(
        a,
        clock.now(),
        CH,
        p.id,
        'set',
        { tokens: 10_000 },
        'test',
      );
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    await b?.close();
    await a?.close();
    await unlock?.();
  });

  it('12 viewers open an empty blackjack at once from two Cores: ONE table n°1 (10 seats), then n°2', async () => {
    const [A, B] = [bj(a), bj(b)];
    const out = await Promise.all(
      P.map((p, i) => (i % 2 ? A : B).join(CH, p, {})),
    );
    const tables = await a.query<{
      table_no: number;
      state: { seats: unknown[] };
    }>(
      'select table_no, state from casino_bj_tables where channel_id = $1 order by table_no',
      [CH],
    );
    expect(
      tables.map((t) => [t.table_no, t.state.seats.filter(Boolean).length]),
    ).toEqual([
      [1, 10],
      [2, 2],
    ]);
    expect(out.filter((o) => o.created)).toHaveLength(2);
    // Every viewer holds exactly one seat, every seat one viewer.
    const seats = tables.flatMap((t) =>
      (t.state.seats as ({ user: string } | null)[])
        .filter(Boolean)
        .map((s) => s!.user),
    );
    expect(new Set(seats).size).toBe(12);
  });

  it('the same free seat clicked from two Cores: one holder, the other « seat_taken »', async () => {
    const t = (
      await a.query<{ table_id: string; state: { seats: unknown[] } }>(
        'select table_id, state from casino_bj_tables where table_no = 2',
      )
    )[0]!;
    const free = (t.state.seats as unknown[]).findIndex((s) => !s);
    // The two viewers of table 2 leave it, then both try the same seat on it again.
    const [x, y] = (t.state.seats as ({ user: string } | null)[])
      .filter(Boolean)
      .map((s) => P.find((p) => p.id === s!.user)!) as [
      (typeof P)[number],
      (typeof P)[number],
    ];
    await bj(a).leave(CH, x);
    await bj(a).leave(CH, y);
    const out = await Promise.allSettled([
      bj(a).join(CH, x, { table_id: t.table_id, seat: free }),
      bj(b).join(CH, y, { table_id: t.table_id, seat: free }),
    ]);
    expect(out.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      out
        .filter((r) => r.status === 'rejected')
        .map((r) => (r as PromiseRejectedResult).reason.code),
    ).toEqual(['seat_taken']);
  });

  it('PRÊT from two tabs, an action sent 6 times from two Cores, both tickers on the same step: paid once, Jetons conserved', async () => {
    const before = await sum();
    const row = (
      await a.query<{
        table_id: string;
        state: { seats: ({ user: string } | null)[] };
      }>('select table_id, state from casino_bj_tables where table_no = 1')
    )[0]!;
    const t = row.table_id;
    const [A, B] = [bj(a), bj(b)];
    // The ten viewers really seated at table n°1 (the simultaneous joins seated them in no particular order).
    const seated = row.state.seats
      .filter(Boolean)
      .map((s) => P.find((p) => p.id === s!.user)!);
    expect(seated).toHaveLength(10);
    // Every player bets 100 + PRÊT, each request sent from both Cores at once.
    await Promise.all(
      seated.flatMap((p) =>
        [
          A.bet(CH, p, { main: 100, ready: true }),
          B.bet(CH, p, { main: 100, ready: true }),
        ].map((x) => x.catch((e: { code: string }) => e.code)),
      ),
    );
    expect(before - (await sum())).toBe(1_000);
    // Both Cores keep the players present and tick; every decision is a STAND sent 3 times from each Core.
    for (let k = 0; k < 3000; k++) {
      const s = (await A.state(CH, t, seated[0]!)).state;
      for (const p of seated) await (k % 2 ? A : B).state(CH, t, p);
      if (s.phase === 'settled') break;
      if (s.turn) {
        const who = seated.find((p) => p.id === s.seats[s.turn!.seat]!.user)!;
        await Promise.allSettled(
          Array.from({ length: 6 }, (_, i) =>
            (i % 2 ? A : B).act(CH, who, {
              type: 'stand',
              token: s.turn!.token,
              action_id: `${s.turn!.token}:stand`,
            }),
          ),
        );
      }
      await Promise.all([A.tick(), B.tick()]);
      clock.advance(200);
    }
    const end = (await A.state(CH, t, seated[0]!)).state;
    expect(end.phase === 'settled' || end.phase === 'betting').toBe(true);
    // Settled once: one history row per player, one payment key per winning hand, Jetons conserved.
    const rows = await a.query<{ n: number }>(
      "select count(*)::int as n from casino_rounds where game = 'blackjack'",
    );
    expect(rows[0]!.n).toBe(10);
    const dup = await a.query(
      "select reason from lab_wallet_ledger where reason like 'casino:bj:%' group by reason having count(*) > 1",
    );
    expect(dup).toHaveLength(0);
    // Nothing created or lost: the players' Jetons + what the house kept = what the players had.
    expect((await sum()) + (await house())).toBe(before);
  });
});
