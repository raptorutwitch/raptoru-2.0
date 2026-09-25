// Real Postgres, real connection pool: proves the claim is safe under true parallelism.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/… npm run test:integration
// The database is wiped: only local URLs are accepted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCore } from '../src/app.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { FakeClock, paris, viewer } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal = !!url && /@(localhost|127\.0\.0\.1)[:/]/.test(url);

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
});
