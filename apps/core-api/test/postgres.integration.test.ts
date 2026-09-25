// Real Postgres, real connection pool: proves the claim is safe under true parallelism.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCore } from '../src/app.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { FakeClock, paris, viewer } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
// Local URL AND a database name containing "test": never the shadow-run database (raptoru).
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);

describe.skipIf(!isLocal)('Core on a real Postgres', () => {
  let db: Db;

  beforeAll(async () => {
    db = createPgDb(url!);
    await db.query('drop schema public cascade; create schema public;');
    await migrate(db);
  });
  afterAll(() => db?.close());

  it('parallel claims over several connections pay exactly once per viewer', async () => {
    const clock = new FakeClock(paris('2026-09-24', 20));
    const provider = new DevFakeCreditProvider();
    // Two Core instances on the same database, like a rolling restart.
    const a = createCore(db, clock, provider);
    const b = createCore(createPgDb(url!), clock, provider);
    await Promise.all([
      a.streams.online({ streamId: 's1', startedAt: paris('2026-09-24', 20) }),
      b.streams.online({ streamId: 's1', startedAt: paris('2026-09-24', 20) }),
    ]);
    clock.set(paris('2026-09-24', 21));

    const viewers = ['1', '2', '3', '4', '5'].map((id) => viewer(id, `V${id}`));
    const results = await Promise.all(
      viewers.flatMap((v) =>
        Array.from({ length: 8 }, (_, i) =>
          (i % 2 ? a : b).daily.claim({
            viewer: v,
            requestId: `${v.twitchUserId}-${i}`,
          }),
        ),
      ),
    );

    expect(results.filter((r) => r.outcome === 'claimed')).toHaveLength(5);
    expect(provider.credited.map((c) => c.login).sort()).toEqual([
      'v1',
      'v2',
      'v3',
      'v4',
      'v5',
    ]);
    const sessions = await db.query<{ n: number }>(
      'select count(*)::int as n from stream_sessions',
    );
    expect(sessions[0]!.n).toBe(1);
  });

  it('presence: two Core instances and two racing workers never double count', async () => {
    const clock = new FakeClock(paris('2026-09-26', 20));
    const provider = new DevFakeCreditProvider();
    const a = createCore(db, clock, provider);
    const b = createCore(createPgDb(url!), clock, provider);
    await a.streams.online({
      streamId: 'p1',
      startedAt: paris('2026-09-26', 20),
    });

    const chatters = Array.from({ length: 300 }, (_, i) => ({
      twitchUserId: String(10_000 + i),
      login: `c${i}`,
      displayName: `C${i}`,
    }));
    for (let cycle = 0; cycle < 5; cycle++) {
      const observedAt = new Date(
        paris('2026-09-26', 20).getTime() + cycle * 120_000,
      );
      clock.set(observedAt);
      // Both workers race for the lease and both report the same instant.
      await Promise.all([
        a.presence.acquireLease({ workerId: 'wa', streamId: 'p1' }),
        b.presence.acquireLease({ workerId: 'wb', streamId: 'p1' }),
      ]);
      await Promise.all(
        [
          [a, 'wa'],
          [b, 'wb'],
        ].map(([core, workerId]) =>
          (core as typeof a).presence.record({
            cycleId: `${workerId}-${cycle}`,
            workerId: workerId as string,
            streamId: 'p1',
            observedAt: observedAt.toISOString(),
            durationMs: 100,
            liveStateAgeSeconds: 5,
            snapshot: { status: 'ok', chatters, reportedTotal: 300, pages: 1 },
          }),
        ),
      );
    }

    const rows = await db.query<{ s: number; n: number; workers: number }>(
      `select min(estimated_watch_seconds)::int as s, count(*)::int as n,
         (select count(distinct worker_id)::int from presence_cycles) as workers
       from presence_viewer_streams`,
    );
    expect(rows[0]).toEqual({ s: 480, n: 300, workers: 1 });
    // Presence never pays: the only credits are the 5 from the Daily test above.
    const credits = await db.query<{ n: number }>(
      'select count(*)::int as n from daily_credits',
    );
    expect(credits[0]!.n).toBe(5);
  });

  it('wallet: 3 Core instances, 600 concurrent credits/spends/transfers + cross-instance retries', async () => {
    const clock = new FakeClock(paris('2026-09-26', 20));
    const provider = new DevFakeCreditProvider();
    const cores = [db, createPgDb(url!), createPgDb(url!)].map((d) =>
      createCore(d, clock, provider),
    );
    const viewers = Array.from({ length: 20 }, (_, i) =>
      viewer(String(50_000 + i), `W${i}`),
    );
    await Promise.all(
      viewers.map((v, i) =>
        cores[i % 3]!.wallet.wallet.credit({
          key: `seed-${v.twitchUserId}`,
          viewer: v,
          amount: 1000,
          source: 'seed',
        }),
      ),
    );

    // Deterministic pseudo-random mix.
    let seed = 42;
    const rand = (n: number) => (
      (seed = (seed * 1103515245 + 12345) % 2 ** 31),
      seed % n
    );
    const ops = Array.from({ length: 600 }, (_, i) => {
      const kind = rand(3);
      const from = viewers[rand(20)]!;
      const to = viewers[rand(20)]!;
      const amount = 1 + rand(400);
      return { key: `op-${i}`, kind, from, to, amount };
    });
    const run = (op: (typeof ops)[number], core: (typeof cores)[number]) =>
      op.kind === 0
        ? core.wallet.wallet.credit({
            key: op.key,
            viewer: op.from,
            amount: op.amount,
            source: 'itest',
          })
        : op.kind === 1
          ? core.wallet.wallet.spend({
              key: op.key,
              viewer: op.from,
              amount: op.amount,
              source: 'itest',
            })
          : core.wallet.wallet.transfer({
              key: op.key,
              from: op.from,
              to: op.to,
              amount: op.amount,
              source: 'itest',
            });
    // Every 5th operation is also retried at the same time by another instance.
    const results = await Promise.all(
      ops.flatMap((op, i) => [
        run(op, cores[i % 3]!),
        ...(i % 5 === 0 ? [run(op, cores[(i + 1) % 3]!)] : []),
      ]),
    );

    const originals = results.filter((r) => !r.replayed);
    expect(originals).toHaveLength(600); // each operation applied or refused exactly once
    expect(results.filter((r) => r.replayed)).toHaveLength(120);

    const q = <T>(sql: string) => db.query<T>(sql);
    const [negative] = await q<{ n: number }>(
      'select count(*)::int as n from wallets where balance < 0',
    );
    expect(negative!.n).toBe(0); // no impossible balance
    const drift = await q(
      'select w.twitch_user_id from wallets w left join wallet_transactions t using (twitch_user_id, currency_id) group by w.twitch_user_id, w.currency_id, w.balance having w.balance <> coalesce(sum(t.amount), 0)',
    );
    expect(drift).toEqual([]); // ledger == balances
    const [ops2] = await q<{ n: number }>(
      "select count(*)::int as n from wallet_operations where idempotency_key like 'op-%'",
    );
    expect(ops2!.n).toBe(600); // nothing lost, nothing doubled
    const applied = originals.filter((r) => r.status === 'applied');
    const legs = applied.reduce((sum, r) => sum + r.amounts.length, 0);
    const [txs] = await q<{ n: number }>(
      "select count(*)::int as n from wallet_transactions where source = 'itest'",
    );
    expect(txs!.n).toBe(legs);
    const moved = applied
      .flatMap((r) => r.amounts)
      .reduce((sum, a) => sum + a.amount, 0);
    const [total] = await q<{ n: number }>(
      "select sum(balance)::bigint as n from wallets where twitch_user_id like '5%'",
    );
    expect(Number(total!.n)).toBe(20 * 1000 + moved); // transfers conserve funds exactly
  });
});
