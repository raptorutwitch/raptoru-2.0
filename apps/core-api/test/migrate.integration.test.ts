// Migrators racing on a real Postgres (ASTRA-P2-007 / P2-008), real connection pools.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate, migrationChecksum } from '../src/db/migrate.js';
import type { MigrationScopes } from '../src/db/migration-scopes.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const A = '20990101000000_counter.sql';
const B = '20990102000000_bump.sql';
const C = '20990103000000_slow_bump.sql';
const scopes = (...lab: string[]): MigrationScopes => ({
  prod: [],
  lab,
  legacyLabInProd: [],
});

describe.skipIf(!isLocal)('migrators on a real Postgres', () => {
  let unlock: (() => Promise<void>) | undefined;
  const pools: Db[] = [];
  const pool = () => {
    const db = createPgDb(url!);
    pools.push(db);
    return db;
  };
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    await pool().query('drop schema public cascade; create schema public;');
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    for (const db of pools) await db.close();
    await unlock?.();
  });

  it('two migrators started together: every migration applied exactly once, fingerprints recorded', async () => {
    // Non-idempotent migrations: a double application would add rows.
    const files = {
      [A]: 'create table counter (n int); insert into counter values (1);',
      [B]: 'insert into counter values (1);',
      [C]: 'select pg_sleep(0.3); insert into counter values (1);',
    };
    const dir = await mkdtemp(join(tmpdir(), 'migrate-race-'));
    for (const [name, sql] of Object.entries(files))
      await writeFile(join(dir, name), sql);
    const results = await Promise.all(
      [pool(), pool(), pool()].map((db) =>
        migrate(db, 'lab', dir, scopes(A, B, C)),
      ),
    );
    expect(results.flat().sort()).toEqual([A, B, C]); // each applied by exactly one migrator
    const db = pool();
    expect(
      Number(
        (await db.query<{ n: number }>('select count(*) as n from counter'))[0]!
          .n,
      ),
    ).toBe(3);
    expect(
      await db.query(
        'select name, checksum from schema_migrations order by name',
      ),
    ).toEqual(
      Object.entries(files).map(([name, sql]) => ({
        name,
        checksum: migrationChecksum(sql),
      })),
    );
  });

  it('a failing migration releases the lock: the next run applies once fixed', async () => {
    const D = '20990104000000_broken.sql';
    const dir = await mkdtemp(join(tmpdir(), 'migrate-fail-'));
    await writeFile(join(dir, D), 'select 1 / 0;');
    await expect(migrate(pool(), 'lab', dir, scopes(D))).rejects.toThrow(
      /division by zero/,
    );
    await writeFile(join(dir, D), 'insert into counter values (1);');
    const t0 = Date.now();
    expect(await migrate(pool(), 'lab', dir, scopes(D))).toEqual([D]);
    expect(Date.now() - t0).toBeLessThan(5_000); // no lock left behind
  });
});
