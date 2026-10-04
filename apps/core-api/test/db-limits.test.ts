import { createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createPgDb, type DbLimits } from '../src/db/db.js';

// ASTRA-P1-004: a server process never waits for ever on PostgreSQL.
const TINY: DbLimits = {
  connectMs: 300,
  statementMs: 1_000,
  lockMs: 300,
  idleInTxMs: 5_000,
};

describe('PostgreSQL time budgets', () => {
  it('a database that accepts the connection but never answers fails within the connect budget', async () => {
    const sockets: Socket[] = [];
    const silent = createServer((s) => void sockets.push(s));
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    const port = (silent.address() as AddressInfo).port;
    const db = createPgDb(`postgres://u:p@127.0.0.1:${port}/x`, TINY);
    const t0 = Date.now();
    await expect(db.query('select 1')).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(3_000);
    await db.close().catch(() => {});
    for (const s of sockets) s.destroy();
    silent.close();
  });
});

// Opt-in, read-only (a sleep and an advisory lock, no table touched): any LOCAL database.
const url = process.env.TEST_DATABASE_URL;
const isLocal = !!url && /@(localhost|127\.0\.0\.1)[:/]/.test(url);
describe.skipIf(!isLocal)('PostgreSQL time budgets on a real server', () => {
  it('a statement over budget is cancelled; a lock wait over budget fails and frees the client', async () => {
    const db = createPgDb(url!, TINY);
    const holder = createPgDb(url!);
    let release = () => {};
    try {
      await expect(db.query('select pg_sleep(2)')).rejects.toMatchObject({
        code: '57014',
      });
      const held = new Promise<void>((r) => (release = r));
      const holding = holder.tx(async (q) => {
        await q.query('select pg_advisory_xact_lock(424242)');
        await held;
      });
      await new Promise((r) => setTimeout(r, 100));
      await expect(
        db.tx((q) => q.query('select pg_advisory_xact_lock(424242)')),
      ).rejects.toMatchObject({ code: '55P03' });
      release();
      await holding;
      // The client went back to the pool: the next query works.
      expect(await db.query<{ ok: number }>('select 1 as ok')).toEqual([
        { ok: 1 },
      ]);
    } finally {
      release();
      await db.close();
      await holder.close();
    }
  });
});
