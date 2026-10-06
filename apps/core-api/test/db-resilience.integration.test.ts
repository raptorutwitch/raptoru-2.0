// A hosted Core survives its database dropping connections (restart, failover, admin termination):
// found while running the Core image against a throw-away Postgres (staging preparation, P1-019) —
// an unhandled pool 'error' event used to kill the process. Real Postgres, opt-in:
// TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
import { afterAll, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);

describe.skipIf(!isLocal)('database connections dropped by the server', () => {
  const pools: Db[] = [];
  const pool = () => {
    const db = createPgDb(url!);
    pools.push(db);
    return db;
  };
  afterAll(async () => {
    for (const db of pools) await db.close().catch(() => undefined);
  });

  /**
   * Terminates ONE given backend (what a restart / failover does to it) — never the connections of
   * the other integration suites running on the same database.
   */
  const terminate = (admin: Db, pid: number) =>
    admin.query('select pg_terminate_backend($1)', [pid]);
  const pidOf = async (q: Pick<Db, 'query'>) =>
    (await q.query<{ pid: number }>('select pg_backend_pid() as pid'))[0]!.pid;

  it('an idle pooled connection killed by the server: no crash, the next query works', async () => {
    const db = pool();
    const admin = pool();
    const pid = await pidOf(db); // the pool's only (now idle) connection
    await terminate(admin, pid);
    await new Promise((r) => setTimeout(r, 300)); // the pool sees the termination (idle client error)
    expect(await db.query('select 2 as ok')).toEqual([{ ok: 2 }]);
  });

  it('a connection killed inside a transaction: the transaction fails cleanly, the pool recovers', async () => {
    const db = pool();
    const admin = pool();
    await expect(
      db.tx(async (q) => {
        await terminate(admin, await pidOf(q));
        await new Promise((r) => setTimeout(r, 200));
        await q.query('select 2');
      }),
    ).rejects.toThrow();
    expect(await db.query('select 3 as ok')).toEqual([{ ok: 3 }]);
  });
});
