// Lot 8 — the main Core's Lab files in the production selection (MAIN_CORE_LAB_MIGRATIONS), on a real, disposable
// Postgres: a blank database, a database migrated by the previous production selection WITH data in the tables the
// new files alter, a staging database (the four extras already applied), an interrupted installation resumed.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import {
  MAIN_CORE_LAB_MIGRATIONS,
  MIGRATION_SCOPES,
  type MigrationScopes,
  STAGING_EXTRA_LAB_MIGRATIONS,
} from '../src/db/migration-scopes.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const OLD_PROD: MigrationScopes = { ...MIGRATION_SCOPES, mainCore: [] };

describe.skipIf(!isLocal)('main Core migrations, real Postgres', () => {
  let db: Db;
  let unlock: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    db = createPgDb(url!);
  }, LOCK_WAIT_MS);
  beforeEach(async () => {
    await db.query('drop schema public cascade; create schema public;');
  });
  afterAll(async () => {
    await db.close();
    await unlock?.();
  });
  const n = async (sql: string) =>
    Number(
      (await db.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!.n,
    );

  it('blank: the whole production selection once; again: nothing', async () => {
    expect((await migrate(db, 'prod')).length).toBe(50);
    expect(await migrate(db, 'prod')).toEqual([]);
    expect(
      await n(
        "pg_tables where tablename in ('cmd_steps', 'word_game_words', 'mini_game_duels', 'lab_moderation_requests')",
      ),
    ).toBe(4);
  });

  it('existing production database with data: only the main Core files, data kept, constraints widened', async () => {
    expect((await migrate(db, 'prod', undefined, OLD_PROD)).length).toBe(34);
    // Rows the new files touch: a Lab ledger kind (constraint redefined), a stream session (column added), a Bonk
    // interaction (salve columns added).
    await db.query(
      `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, actor, created_at)
       values ('1', '2', 'raffle_win', 'tokens', 500, 'system', now()), ('1', '2', 'admin', 'tokens', 5, 'studio', now())`,
    );
    await db.query(
      `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
       values (gen_random_uuid(), '1', now(), 'twitch', 'bot')`,
    );
    expect(await migrate(db, 'prod')).toEqual([...MAIN_CORE_LAB_MIGRATIONS]);
    expect(await n('lab_wallet_ledger')).toBe(2);
    expect(await n('lab_stream_sessions where twitch_stream_id is null')).toBe(
      1,
    );
    // The widened ledger kinds accept the games and « Accorder des crédits » (main Core in Lab mode).
    for (const kind of ['word_game', 'mini_game', 'channel_points'])
      await db.query(
        `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, actor, created_at)
         values ('1', '2', $1, 'tokens', 1, 'system', now())`,
        [kind],
      );
    expect(await migrate(db, 'prod')).toEqual([]);
  });

  it('staging database: the four extras are never applied again', async () => {
    const OLD_STAGING: MigrationScopes = {
      ...OLD_PROD,
      stagingExtra: STAGING_EXTRA_LAB_MIGRATIONS,
    };
    expect((await migrate(db, 'staging', undefined, OLD_STAGING)).length).toBe(
      38,
    );
    expect(await migrate(db, 'prod')).toEqual(
      MAIN_CORE_LAB_MIGRATIONS.filter(
        (f) => !STAGING_EXTRA_LAB_MIGRATIONS.includes(f),
      ),
    );
    expect(await migrate(db, 'staging')).toEqual([]);
  });

  it('interrupted installation (stopped after Commands V2): the run resumes with the remaining files, in order', async () => {
    const partial: MigrationScopes = {
      ...MIGRATION_SCOPES,
      mainCore: MAIN_CORE_LAB_MIGRATIONS.slice(0, 4),
    };
    await migrate(db, 'prod', undefined, partial);
    expect(await migrate(db, 'prod')).toEqual(
      MAIN_CORE_LAB_MIGRATIONS.slice(4),
    );
    // A failing file never stays half applied: one transaction per file.
    const recorded = await n('schema_migrations');
    expect(recorded).toBe(50);
  });
});
