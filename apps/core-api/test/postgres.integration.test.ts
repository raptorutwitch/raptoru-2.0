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

  it('loyalty credit mode: presence ticks + duplicated events on 3 Cores, concurrent crediting, config change', async () => {
    const clock = new FakeClock(paris('2026-09-27', 20));
    const provider = new DevFakeCreditProvider();
    const modes = { preview: false, passiveCredits: true, eventCredits: true };
    const cores = [db, createPgDb(url!), createPgDb(url!)].map((d) =>
      createCore(d, clock, provider, modes),
    );
    const [a, , c] = cores as [
      (typeof cores)[0],
      (typeof cores)[0],
      (typeof cores)[0],
    ];
    const people = Array.from({ length: 20 }, (_, i) =>
      viewer(String(70_000 + i), `L${i}`),
    );

    await a.streams.online({
      streamId: 'L1',
      startedAt: paris('2026-09-27', 20),
    });
    await a.loyalty.applySubscriptionSnapshot({
      fetchedAt: clock.now().toISOString(),
      subscribers: people.slice(0, 6).map((v, i) => ({
        viewer: v,
        tier: (['t1', 't2', 't3'] as const)[i % 3]!,
        isGift: false,
      })),
    });

    // Presence: one worker (lease), 13 cycles = 24 validated minutes = 4 ticks per viewer.
    const presence = (async () => {
      for (let m = 0; m <= 24; m += 2) {
        clock.set(new Date(paris('2026-09-27', 20).getTime() + m * 60_000));
        await a.presence.acquireLease({ workerId: 'wl', streamId: 'L1' });
        await a.presence.record({
          cycleId: `loyalty-${m}`,
          workerId: 'wl',
          streamId: 'L1',
          observedAt: clock.now().toISOString(),
          durationMs: 5,
          liveStateAgeSeconds: 1,
          snapshot: {
            status: 'ok',
            chatters: people,
            reportedTotal: 20,
            pages: 1,
          },
        });
      }
    })();

    // Events: each delivered to two different Cores at the same time (EventSub redelivery).
    const events = Array.from({ length: 60 }, (_, i) => {
      const v = people[i % 20]!;
      const kind = i % 4;
      return kind === 0
        ? {
            type: 'bits' as const,
            eventId: `lb-${i}`,
            viewer: v,
            bits: 100 + i * 17,
          }
        : kind === 1
          ? {
              type: 'resub' as const,
              eventId: `lr-${i}`,
              viewer: v,
              tier: 't1' as const,
            }
          : kind === 2
            ? {
                type: 'subgift' as const,
                eventId: `lg-${i}`,
                gifter: v,
                tier: 't1' as const,
                count: 1 + (i % 12),
              }
            : { type: 'follow' as const, eventId: `lf-${i}`, viewer: v };
    });
    const sent = Promise.all(
      events.flatMap((e, i) => [
        cores[i % 3]!.loyalty.handleEvent(e),
        cores[(i + 1) % 3]!.loyalty.handleEvent(e),
      ]),
    );
    const configChange = c.loyalty
      .getConfig()
      .then((cfg) =>
        c.loyalty.setConfig({ ...cfg, follow: { amount: 600 } }, 'itest'),
      );
    await Promise.all([presence, sent, configChange]);
    await Promise.all(cores.map((core) => core.loyalty.processPending())); // concurrent crediting
    await Promise.all(cores.map((core) => core.loyalty.processPending())); // and again: no-op

    const q = <T>(sql: string) => db.query<T>(sql);
    const [ticks] = await q<{ n: number }>(
      "select count(*)::int as n from loyalty_rewards where source = 'passive_watch' and stream_id = 'L1'",
    );
    expect(ticks!.n).toBe(20 * 4);
    const notCredited = await q(
      "select id, status from loyalty_rewards where status <> 'credited' and (stream_id = 'L1' or idempotency_key like 'follow:7%' or idempotency_key like 'twitch:%:l%')",
    );
    expect(notCredited).toEqual([]);
    // One Wallet operation per credited reward: nothing lost, nothing paid twice.
    const [pairs] = await q<{ rewards: number; ops: number }>(
      `select (select count(*)::int from loyalty_rewards where status = 'credited' and twitch_user_id like '7%') as rewards,
              (select count(*)::int from wallet_operations where idempotency_key like 'loyalty:%' and status = 'applied') as ops`,
    );
    expect(pairs!.ops).toBe(pairs!.rewards);
    const mismatch = await q(
      `select r.twitch_user_id from loyalty_rewards r join wallets w on w.twitch_user_id = r.twitch_user_id and w.currency_id = 'main'
       where r.twitch_user_id like '7%' group by r.twitch_user_id, w.balance having w.balance <> sum(r.amount)`,
    );
    expect(mismatch).toEqual([]); // each wallet = exactly the sum of its credited rewards
    const [follows] = await q<{ n: number }>(
      "select count(*)::int as n from loyalty_rewards where source = 'follow' and twitch_user_id like '7%'",
    );
    expect(follows!.n).toBe(5); // 15 follow events but only 5 distinct viewers: refollows are replays
  });
});
