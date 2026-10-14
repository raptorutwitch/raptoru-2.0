// Real Postgres, real connection pool: proves the claim is safe under true parallelism.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import type { LoyaltyConfig, LoyaltyEvent } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCore } from '../src/app.js';
import {
  DevFakeCreditProvider,
  WalletCreditProvider,
} from '../src/daily/credits.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { progressiveReward } from '../src/loyalty/calc.js';
import { DEFAULT_LOYALTY_CONFIG } from '../src/loyalty/config.js';
import { LoyaltyIdempotencyError } from '../src/loyalty/engine.js';
import { FakeClock, paris, viewer } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
// Local URL AND a database name containing "test": never the shadow-run database (raptoru).
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);

describe.skipIf(!isLocal)('Core on a real Postgres', () => {
  let db: Db;
  let unlock: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!); // never two schema wipes at once
    db = createPgDb(url!);
    await db.query('drop schema public cascade; create schema public;');
    await migrate(db, 'all');
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    await db?.close();
    await unlock?.();
  });

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

  it('Daily → Wallet: preview writes nothing, test credit mode = exactly one Wallet operation per claim', async () => {
    const clock = new FakeClock(paris('2026-09-29', 20));
    const q = <T>(sql: string, params?: unknown[]) => db.query<T>(sql, params);
    const walletRows = async () =>
      Number(
        (
          await q<{ n: string }>(
            `select (select count(*) from wallet_operations) + (select count(*) from wallet_transactions)
               + (select count(*) from wallets) as n`,
          )
        )[0]!.n,
      );
    const setDailyBase = (base: number) =>
      q(
        `insert into daily_config (id, config) values (1, $1)
         on conflict (id) do update set config = excluded.config`,
        [JSON.stringify({ reward: { base, perStreak: 150, max: 2000 } })],
      );
    const people = Array.from({ length: 12 }, (_, i) =>
      viewer(String(60_000 + i), `D${i}`),
    );
    // Each viewer: 3 double clicks + the same message retried on another Core, all concurrent;
    // the Daily config changes in the middle.
    const storm = async (
      cores: ReturnType<typeof createCore>[],
      day: string,
      newBase: number,
    ) => {
      const calls = people.flatMap((v, i) => [
        ...[0, 1, 2].map(
          (k) => () =>
            cores[(i + k) % 3]!.daily.claim({
              viewer: v,
              requestId: `${day}-${v.twitchUserId}-click-${k}`,
            }),
        ),
        ...[0, 1].map(
          (k) => () =>
            cores[(i + k + 1) % 3]!.daily.claim({
              viewer: v,
              requestId: `${day}-${v.twitchUserId}-retry`,
            }),
        ),
      ]);
      const half = Math.floor(calls.length / 2);
      const first = await Promise.all(calls.slice(0, half).map((c) => c()));
      const [second] = await Promise.all([
        Promise.all(calls.slice(half).map((c) => c())),
        setDailyBase(newBase),
      ]);
      return [...first, ...second];
    };

    // --- Preview (DAILY_WALLET_CREDITS=false): real claims, zero Wallet write ---
    await setDailyBase(500);
    const walletBefore = await walletRows();
    // Two extra pools, shared by both phases and closed at the end.
    const pools = [db, createPgDb(url!), createPgDb(url!)];
    const previewCores = pools.map((d) =>
      createCore(d, clock, new DevFakeCreditProvider()),
    );
    await previewCores[0]!.streams.online({
      streamId: 'daily-w1',
      startedAt: paris('2026-09-29', 20),
    });
    clock.set(paris('2026-09-29', 21));
    const preview = await storm(previewCores, '2026-09-29', 800);
    expect(
      preview.filter((r) => r.outcome === 'claimed' && !r.replayed),
    ).toHaveLength(12);
    expect(await walletRows()).toBe(walletBefore);

    // --- Test credit mode (DAILY_WALLET_CREDITS=true) on the next stream-day ---
    const creditCores = pools.map((d) =>
      createCore(d, clock, new WalletCreditProvider(d)),
    );
    await setDailyBase(500);
    clock.set(paris('2026-09-30', 20));
    await creditCores[1]!.streams.online({
      streamId: 'daily-w2',
      startedAt: paris('2026-09-30', 20),
    });
    clock.set(paris('2026-09-30', 21));
    const credit = await storm(creditCores, '2026-09-30', 900);
    // Periodic retry sweeps on all Cores at once, twice: nothing left, nothing paid twice.
    await Promise.all(creditCores.map((c) => c.credits.retryTick()));
    await Promise.all(creditCores.map((c) => c.credits.retryTick()));
    expect(
      credit.filter((r) => r.outcome === 'claimed' && !r.replayed),
    ).toHaveLength(12);

    const rows = await q<{
      twitch_user_id: string;
      reward: number;
      status: string;
      ops: string;
      op_matches: boolean;
      breakdown: { streak: number; base: number; final: number };
    }>(
      `select c.twitch_user_id, c.reward, cr.status, c.breakdown,
         (select count(*) from wallet_operations o where o.idempotency_key = cr.idempotency_key) as ops,
         (select o.id from wallet_operations o where o.idempotency_key = cr.idempotency_key) = cr.wallet_operation_id as op_matches
       from daily_claims c join daily_credits cr on cr.claim_id = c.id
       where c.stream_id = 'daily-w2'`,
    );
    expect(rows).toHaveLength(12);
    for (const r of rows) {
      expect(r.status).toBe('credited');
      expect(Number(r.ops)).toBe(1); // exactly one Wallet operation per claim
      expect(r.op_matches).toBe(true);
      // streak 2 (consecutive aired days); base from whichever config the claim saw, frozen.
      expect(r.breakdown.streak).toBe(2);
      expect([500, 900]).toContain(r.breakdown.base);
      expect(r.reward).toBe(r.breakdown.base + 150);
      expect(r.reward).toBe(r.breakdown.final);
    }
    for (const p of people) {
      const [w] = await q<{ balance: string }>(
        "select balance from wallets where twitch_user_id = $1 and currency_id = 'main'",
        [p.twitchUserId],
      );
      const paid = rows.find(
        (r) => r.twitch_user_id === p.twitchUserId,
      )!.reward;
      expect(Number(w!.balance)).toBe(paid); // preview day paid nothing, credit day paid once
    }
    const [dailyTx] = await q<{ n: string }>(
      "select count(*) as n from wallet_transactions where source = 'daily'",
    );
    expect(Number(dailyTx!.n)).toBe(12);
    await Promise.all(pools.slice(1).map((p) => p.close()));
  });

  it('Bonk Lab: 3 Cores, concurrent admissions + retries, ordered claims, idempotent ACKs, zero Wallet', async () => {
    const clock = new FakeClock(paris('2026-09-30', 21));
    const pools = [db, createPgDb(url!), createPgDb(url!)];
    const cores = pools.map((d) =>
      createCore(d, clock, new DevFakeCreditProvider()),
    );
    try {
      const walletBefore = (
        await db.query<{ n: string }>(
          'select (select count(*) from wallet_operations) + (select count(*) from wallets) as n',
        )
      )[0]!.n;
      await cores[0]!.bonkLab.heartbeat({
        studio_instance_id: 'itest-studio',
        obs: 'connected',
        source_ready: true,
        overlay_ready: true,
      });
      const reqs = Array.from({ length: 30 }, (_, i) => ({
        idempotency_key: `bk-${i}`,
        channel_id: '990001',
        viewer: { id: String(990100 + (i % 4)), display_name: `B${i}` },
        lab_session_id: 'itest',
        emote: { provider: 'unicode' as const, id: 'unicode:1f600' },
      }));
      // Every admission sent twice, to two different Cores, at the same time.
      const results = await Promise.all(
        reqs.flatMap((r, i) => [
          cores[i % 3]!.bonkLab.admit(r),
          cores[(i + 1) % 3]!.bonkLab.admit(r),
        ]),
      );
      expect(results.filter((r) => !r.replayed)).toHaveLength(30);
      const seqs = results
        .filter((r) => !r.replayed)
        .map((r) => r.interaction.channel_sequence)
        .sort((a, b) => a - b);
      expect(seqs).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));

      // Claims race on 3 Cores: each Bonk is handed out once, in sequence order.
      const started: number[] = [];
      for (let round = 0; round < 30; round++) {
        const claimed = (
          await Promise.all(
            cores.map((c) => c.bonkLab.claim('itest-studio', '990001')),
          )
        ).filter((c) => c !== null);
        expect(claimed).toHaveLength(1);
        const c = claimed[0]!;
        started.push(c.channel_sequence);
        const a = {
          studio_instance_id: 'itest-studio',
          attempt_id: c.delivery.attempt_id!,
        };
        await Promise.all([
          cores[0]!.bonkLab.ack(c.interaction_id, { ...a, event: 'started' }),
          cores[1]!.bonkLab.ack(c.interaction_id, { ...a, event: 'started' }),
        ]);
        await cores[2]!.bonkLab.ack(c.interaction_id, {
          ...a,
          event: 'completed',
        });
      }
      expect(started).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
      const states = await db.query<{ status: string; n: string }>(
        "select status, count(*) as n from bonk_lab_interactions where channel_id = '990001' group by status",
      );
      expect(states.map((r) => [r.status, Number(r.n)])).toEqual([
        ['completed', 30],
      ]);
      const walletAfter = (
        await db.query<{ n: string }>(
          'select (select count(*) from wallet_operations) + (select count(*) from wallets) as n',
        )
      )[0]!.n;
      expect(walletAfter).toBe(walletBefore);
    } finally {
      await Promise.all(pools.slice(1).map((p) => p.close()));
    }
  });

  it('Bonk expiry sweep: 3 Cores ticking at once + a racing ACK, one refund per Bonk, no state regression', async () => {
    const clock = new FakeClock(paris('2026-10-14', 21));
    const pools = [db, createPgDb(url!), createPgDb(url!)];
    const cores = pools.map((d) =>
      createCore(d, clock, new DevFakeCreditProvider()),
    );
    try {
      await cores[0]!.bonkLab.heartbeat({
        studio_instance_id: 'itest-sweep',
        obs: 'connected',
        source_ready: true,
        overlay_ready: true,
      });
      for (let i = 0; i < 12; i++)
        await cores[i % 3]!.bonkLab.admit({
          idempotency_key: `sw-${i}`,
          channel_id: '990002',
          viewer: { id: String(990200 + (i % 3)), display_name: `S${i}` },
          lab_session_id: 'itest',
          emote: { provider: 'unicode', id: 'unicode:1f600' },
        });
      // One Bonk is executing on a Studio that then disappears; the other 11 were never claimed.
      const running = (await cores[0]!.bonkLab.claim('itest-sweep', '990002'))!;
      const attempt = {
        studio_instance_id: 'itest-sweep',
        attempt_id: running.delivery.attempt_id!,
      };
      await cores[1]!.bonkLab.ack(running.interaction_id, {
        ...attempt,
        event: 'started',
      });
      clock.set(new Date(clock.now().getTime() + 121_000));
      // Every Core ticks twice at the same time while the late Studio reports completion.
      const lateAck = cores[2]!.bonkLab
        .ack(running.interaction_id, { ...attempt, event: 'completed' })
        .then(
          () => 'completed',
          (e: Error) => e.message,
        );
      await Promise.all([
        ...cores.flatMap((c) => [
          c.bonkLab.sweepExpired(),
          c.bonkLab.sweepExpired(),
        ]),
        lateAck,
      ]);
      const states = await db.query<{ status: string; n: number }>(
        "select status, count(*)::int as n from bonk_lab_interactions where channel_id = '990002' and interaction_id <> $1 group by status",
        [running.interaction_id],
      );
      expect(states).toEqual([{ status: 'failed', n: 11 }]);
      // One refund per expired Bonk, exactly; none for the one that was shown.
      const refunds = await db.query<{ interaction_id: string; n: number }>(
        `select l.interaction_id, count(*)::int as n from lab_wallet_ledger l
           join bonk_lab_interactions i using (interaction_id)
         where i.channel_id = '990002' and l.kind = 'refund' group by l.interaction_id`,
      );
      expect(refunds).toHaveLength(11);
      expect(refunds.every((r) => r.n === 1)).toBe(true);
      expect(
        refunds.some((r) => r.interaction_id === running.interaction_id),
      ).toBe(false);
      // The racing ACK and the sweep serialize on the channel lock: whichever wins, the outcome is
      // final and consistent (completed before the sweep, or execution_unknown and the ACK refused).
      const final = await cores[0]!.bonkLab.get(running.interaction_id);
      expect(['completed', 'execution_unknown']).toContain(final.status);
      expect(await lateAck).toBe(
        final.status === 'completed'
          ? 'completed'
          : 'cannot complete from execution_unknown',
      );
    } finally {
      await Promise.all(pools.slice(1).map((p) => p.close()));
    }
  });

  it.each(['sound', 'tts'] as const)(
    '%s expiry sweep: 3 Cores ticking at once, one refund per expired item, no state regression',
    async (module) => {
      const clock = new FakeClock(paris('2026-10-14', 22));
      const pools = [db, createPgDb(url!), createPgDb(url!)];
      const cores = pools.map((d) =>
        createCore(d, clock, new DevFakeCreditProvider()),
      );
      const channel = module === 'sound' ? '990003' : '990004';
      const table = `${module}_lab_interactions`;
      try {
        const lab = module === 'sound' ? cores[0]!.soundLab : cores[0]!.ttsLab;
        await lab.heartbeat({
          studio_instance_id: 'itest-sweep',
          player_ready: true,
        });
        if (module === 'sound')
          await cores[0]!.soundLab.updateSound('akh', {
            playback_mode: 'queue',
          });
        // TTS keeps a short waiting line (max_waiting_global): 3 items are enough.
        const items = module === 'sound' ? 6 : 3;
        for (let i = 0; i < items; i++) {
          const base = {
            idempotency_key: `${module}-sw-${i}`,
            channel_id: channel,
            viewer: { id: String(990300 + i), display_name: `S${i}` },
            lab_session_id: 'itest',
            payment_method: 'tokens' as const,
          };
          if (module === 'sound')
            await cores[i % 3]!.soundLab.admit({ ...base, sound_id: 'akh' });
          else
            await cores[i % 3]!.ttsLab.admit({
              ...base,
              text: `Message de test numéro ${i}`,
            });
        }
        // The first item is playing on a Studio that then disappears; the others were never claimed.
        const playing = (await lab.claim('itest-sweep', channel))!;
        await lab.ack(playing.interaction_id, {
          studio_instance_id: 'itest-sweep',
          attempt_id: playing.delivery.attempt_id!,
          event: 'started',
        });
        clock.set(new Date(clock.now().getTime() + 40 * 60_000));
        await Promise.all(
          cores.flatMap((c) => {
            const s = module === 'sound' ? c.soundLab : c.ttsLab;
            return [s.sweepExpired(), s.sweepExpired()];
          }),
        );
        const states = await db.query<{ status: string; n: number }>(
          `select status, count(*)::int as n from ${table} where channel_id = $1 group by status order by status`,
          [channel],
        );
        expect(states).toEqual([
          { status: 'execution_unknown', n: 1 },
          { status: 'failed', n: items - 1 },
        ]);
        const refunds = await db.query<{ interaction_id: string; n: number }>(
          `select l.interaction_id, count(*)::int as n from lab_wallet_ledger l
             join ${table} i using (interaction_id)
           where i.channel_id = $1 and l.kind = 'refund' group by l.interaction_id`,
          [channel],
        );
        expect(refunds).toHaveLength(items - 1);
        expect(refunds.every((r) => r.n === 1)).toBe(true);
        expect(
          refunds.some((r) => r.interaction_id === playing.interaction_id),
        ).toBe(false);
      } finally {
        await Promise.all(pools.slice(1).map((p) => p.close()));
      }
    },
  );

  it('Rewards Twitch V1 in preview: 3 Cores, duplicates, conflicts, hot config change, zero Wallet write', async () => {
    const clock = new FakeClock(paris('2026-09-28', 20));
    const provider = new DevFakeCreditProvider();
    const modes = { preview: true, passiveCredits: false, eventCredits: false };
    const cores = [db, createPgDb(url!), createPgDb(url!)].map((d) =>
      createCore(d, clock, provider, modes),
    );
    await cores[0]!.loyalty.setConfig(DEFAULT_LOYALTY_CONFIG, 'itest');
    const q = <T>(sql: string) => db.query<T>(sql);
    const walletRows = async () =>
      (
        await q<{ n: number }>(
          `select (select count(*) from wallet_operations) + (select count(*) from wallet_transactions)
             + (select count(*) from wallets) as n`,
        )
      )[0]!.n;
    const walletBefore = Number(await walletRows());

    const people = Array.from({ length: 30 }, (_, i) =>
      viewer(String(80_000 + i), `R${i}`),
    );
    const minecraft = viewer('112568845', 'Minecraft');
    const tiers = ['t1', 't2', 't3'] as const;
    // Logical actions (one expected reward each, except skipped ones and repeated follows).
    const actions: LoyaltyEvent[] = [];
    for (let i = 0; i < 30; i++) {
      const v = people[i]!;
      const tier = tiers[i % 3]!;
      actions.push(
        { type: 'sub', eventId: `v-sub-${i}`, viewer: v, tier, isGift: false },
        { type: 'resub', eventId: `v-resub-${i}`, viewer: v, tier },
        {
          type: 'subgift',
          eventId: `v-gift-${i}`,
          gifter: v,
          tier,
          count: [1, 4, 5, 9, 10, 19, 20, 100][i % 8]!,
        },
        {
          type: 'bits',
          eventId: `v-bits-${i}`,
          viewer: v,
          bits: [1, 499, 500, 999, 1000, 1200][i % 6]!,
        },
        // Every viewer follows, then half of them refollow (new EventSub message id).
        { type: 'follow', eventId: `v-follow-${i}`, viewer: v },
        ...(i % 2
          ? [
              {
                type: 'follow' as const,
                eventId: `v-refollow-${i}`,
                viewer: v,
              },
            ]
          : []),
        // Gift recipients: tier state only, never a reward.
        {
          type: 'sub',
          eventId: `v-recipient-${i}`,
          viewer: viewer(String(90_000 + i), `G${i}`),
          tier,
          isGift: true,
        },
      );
    }
    actions.push(
      {
        type: 'subgift',
        eventId: 'v-anon',
        gifter: null,
        tier: 't1',
        count: 5,
      },
      { type: 'bits', eventId: 'v-anon-bits', viewer: null, bits: 500 },
      // Twitch-sponsored gift (Subtember): rewarded to the brand account like any gifter.
      {
        type: 'subgift',
        eventId: 'v-sponsor',
        gifter: minecraft,
        tier: 't1',
        count: 1,
      },
    );

    // Every action is delivered 2 or 3 times, to different Cores, concurrently (redeliveries,
    // Core restarts, bot retries), while the config changes in the middle.
    const deliveries = actions.flatMap((e, i) =>
      Array.from({ length: 2 + (i % 2) }, (_, k) => ({
        e,
        core: cores[(i + k) % 3]!,
      })),
    );
    const newConfig: LoyaltyConfig = {
      ...DEFAULT_LOYALTY_CONFIG,
      sub: { t1: 2500, t2: 4500, t3: 11000 },
      bits: { brackets: [{ from: 1, per100: 800 }] },
      follow: { amount: 600 },
    };
    const half = Math.floor(deliveries.length / 2);
    const run = (d: (typeof deliveries)[number]) =>
      d.core.loyalty.handleEvent(d.e);
    const first = await Promise.all(deliveries.slice(0, half).map(run));
    const [second] = await Promise.all([
      Promise.all(deliveries.slice(half).map(run)),
      cores[2]!.loyalty.setConfig(newConfig, 'itest'),
    ]);
    const results = [...first, ...second];

    // Same event id with a different payload: explicit conflict, nothing stored.
    let conflicts = 0;
    for (const e of [
      {
        ...(actions[3] as Extract<LoyaltyEvent, { type: 'bits' }>),
        bits: 5000,
      },
      {
        ...(actions[0] as Extract<LoyaltyEvent, { type: 'sub' }>),
        tier: 't3' as const,
      },
    ]) {
      await expect(cores[1]!.loyalty.handleEvent(e)).rejects.toBeInstanceOf(
        LoyaltyIdempotencyError,
      );
      conflicts++;
    }

    const rows = await q<{
      idempotency_key: string;
      source: string;
      twitch_user_id: string;
      amount: number;
      status: string;
      breakdown: Record<string, unknown>;
    }>(
      "select idempotency_key, source, twitch_user_id, amount, status, breakdown from loyalty_rewards where idempotency_key like 'twitch:%:v-%' or idempotency_key like 'follow:8%' or twitch_user_id = '112568845'",
    );

    // Exactly one reward per logical action.
    const expected = {
      sub: 30,
      resub: 30,
      subgift: 31, // 30 + sponsor; anonymous rewards nobody
      bits: 30, // anonymous rewards nobody
      follow: 30, // 45 follow events, 30 identities
    };
    const bySource = (s: string) => rows.filter((r) => r.source === s);
    for (const [source, n] of Object.entries(expected))
      expect(bySource(source), source).toHaveLength(n);
    expect(new Set(rows.map((r) => r.idempotency_key)).size).toBe(rows.length);
    expect(rows.every((r) => r.status === 'preview')).toBe(true);
    expect(rows.some((r) => r.twitch_user_id.startsWith('9'))).toBe(false); // recipients

    // Each amount = its frozen breakdown, computed from ONE config (old or new, never a mix).
    for (const r of rows) {
      const b = r.breakdown;
      expect(r.amount).toBe(b.final);
      expect(b.mode).toBe('preview');
      if (r.source === 'sub' || r.source === 'resub') {
        const tier = b.tier as 't1' | 't2' | 't3';
        expect([
          DEFAULT_LOYALTY_CONFIG.sub[tier],
          newConfig.sub[tier],
        ]).toContain(b.base);
      }
      if (r.source === 'bits') {
        const units = b.units as number;
        expect([
          progressiveReward(units, DEFAULT_LOYALTY_CONFIG.bits.brackets).final,
          progressiveReward(units, newConfig.bits.brackets).final,
        ]).toContain(r.amount);
      }
      if (r.source === 'follow') expect([500, 600]).toContain(r.amount);
    }
    // Replays: every delivery beyond the first of a stored action is a replay, nothing else.
    const stored = results.filter((r) => r.rewardId !== null);
    const originals = stored.filter((r) => !r.replayed);
    expect(originals).toHaveLength(rows.length);

    // Preview: not a single Wallet row written.
    expect(Number(await walletRows())).toBe(walletBefore);

    // Validation report per source.
    const report = Object.fromEntries(
      ['sub', 'resub', 'subgift', 'bits', 'follow'].map((source) => {
        // results[i] is the answer to deliveries[i].
        const res = results.filter((_, i) => deliveries[i]!.e.type === source);
        return [
          source,
          {
            received: res.length,
            rewards: bySource(source).length,
            duplicatesIgnored: res.filter((r) => r.replayed).length,
            skipped: res.filter((r) => r.status === 'skipped').length,
          },
        ];
      }),
    );
    console.log(
      '[rewards-v1 report]',
      JSON.stringify({ ...report, conflicts, walletWrites: 0 }, null, 1),
    );
  });
});
