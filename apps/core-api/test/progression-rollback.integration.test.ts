// The progression migration's rollback (docs/PROGRESSION.md), proven on a real Postgres: the production migrator
// applies 20261113130000_progression.sql, it is used, then the SQL written in the migration's header is run — the schema
// is back to before (no progression_* table or function, the migration forgotten) and nothing else moved; the migrator
// applies it again cleanly. Opt-in like every real-Postgres suite (TEST_DATABASE_URL, local, a database whose name
// contains « test »; it is wiped).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { DEFAULT_MIGRATIONS_DIR, migrate } from '../src/db/migrate.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const FILE = '20261113130000_progression.sql';

/** The rollback SQL as written in the migration's header (the « -- Rollback: » comment lines, marks removed). */
function rollbackSql() {
  const raw = readFileSync(join(DEFAULT_MIGRATIONS_DIR, FILE), 'utf8').split(
    /\r?\n/,
  );
  const start = raw.findIndex((l) => l.startsWith('-- Rollback:'));
  const lines: string[] = [];
  for (let i = start; i < raw.length && raw[i]!.startsWith('--'); i++)
    lines.push(raw[i]!.replace(/^--\s?/, ''));
  return lines.join(' ').slice('Rollback:'.length).trim();
}

describe.skipIf(!isLocal)(
  'Progression migration rollback, real Postgres',
  () => {
    let db: Db;
    let unlock: (() => Promise<void>) | undefined;
    beforeAll(async () => {
      unlock = await lockDestructiveSuite(url!);
      db = createPgDb(url!);
      await db.query('drop schema public cascade; create schema public;');
    }, LOCK_WAIT_MS);
    afterAll(async () => {
      await db?.close();
      await unlock?.();
    });

    const tables = async () =>
      (
        await db.query<{ t: string }>(
          "select table_name as t from information_schema.tables where table_schema = 'public' order by 1",
        )
      ).map((r) => r.t);
    it('applied, used, rolled back by its header SQL to exactly the previous schema, then applied again', async () => {
      await migrate(db, 'prod');
      const all = await tables();
      expect(all).toContain('progression_ledger');
      await db.query(
        `insert into progression_settings (channel_id, enabled, rules, updated_at) values ('1', true, '{}', now())`,
      );
      await db.query(
        `insert into progression_ledger (channel_id, twitch_user_id, kind, amount, key, actor, created_at)
       values ('1', '9', 'presence', 2, 'k1', 'test', now())`,
      );
      await expect(
        db.query("update progression_ledger set amount = 3 where key = 'k1'"),
      ).rejects.toThrow(/append-only/);
      const sql = rollbackSql();
      expect(sql).toMatch(
        /^drop table progression_history, progression_equipped/,
      );
      await db.query(sql);
      const after = await tables();
      expect(after.filter((t) => t.startsWith('progression_'))).toEqual([]);
      expect(after).toEqual(all.filter((t) => !t.startsWith('progression_')));
      expect(
        (
          await db.query(
            "select 1 from pg_proc where proname = 'progression_ledger_immutable'",
          )
        ).length,
      ).toBe(0);
      expect(
        (
          await db.query('select 1 from schema_migrations where name = $1', [
            FILE,
          ])
        ).length,
      ).toBe(0);
      await migrate(db, 'prod');
      expect(await tables()).toEqual(all);
    });
  },
);
