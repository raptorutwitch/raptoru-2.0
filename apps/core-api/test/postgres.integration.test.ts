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

describe.skipIf(!isLocal)('Daily on a real Postgres', () => {
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
});
