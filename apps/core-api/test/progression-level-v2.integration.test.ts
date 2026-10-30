import { afterAll, beforeAll, describe } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { resetTestDb } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';
import { levelV2Suite } from './progression-level-v2.suite.js';

// Level Up V2 on a REAL Postgres (locks, unique keys, concurrent replays): the same suite as on PGlite. Opt-in like every
// real-Postgres suite (TEST_DATABASE_URL, local, a database whose name contains « test »; it is wiped).
const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);

describe.skipIf(!isLocal)('Level Up V2, real Postgres', () => {
  let db: Db;
  let unlock: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    db = createPgDb(url!);
    await db.query('drop schema public cascade; create schema public;');
    await migrate(db, 'all');
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    await db?.close();
    await unlock?.();
  });
  levelV2Suite(() => resetTestDb(db));
});
