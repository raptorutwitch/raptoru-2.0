// The Halloween migration's rollback (docs/HALLOWEEN.md § 9), proven on a real Postgres rather than assumed: the
// production migrator applies 20261112130000_event_shop.sql (the Tombola's currency registry present, as in
// production), the shop is used, then the SQL written in the migration's header is run — the schema is back to before
// (no event_* table or function, no Bonbons currency, the migration forgotten) and nothing else moved; the migrator
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
const FILE = '20261112130000_event_shop.sql';

/** The rollback SQL as written in the migration's header (the « -- Rollback: » comment lines, marks removed). */
function rollbackSql() {
  const raw = readFileSync(join(DEFAULT_MIGRATIONS_DIR, FILE), 'utf8').split(
    /\r?\n/,
  );
  const start = raw.findIndex((l) => l.startsWith('-- Rollback:'));
  const lines: string[] = [];
  for (let i = start; i < raw.length && raw[i]!.startsWith('--'); i++)
    lines.push(raw[i]!.replace(/^--\s?/, ''));
  return lines
    .join(' ')
    .slice('Rollback:'.length)
    .replace(/\(only if no Tombola round used it\)/, '')
    .trim();
}

describe.skipIf(!isLocal)('Halloween migration rollback, real Postgres', () => {
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
  const currencies = async () =>
    (
      await db.query<{ id: string }>(
        'select currency_id as id from lab_currencies order by 1',
      )
    ).map((r) => r.id);

  it('applied, used, rolled back by its header SQL to exactly the previous schema, then applied again', async () => {
    await migrate(db, 'prod');
    const all = await tables();
    expect(all).toContain('event_shop_purchases');
    expect(await currencies()).toContain('bonbons');
    // Some use: settings, a wallet, a ledger row.
    await db.query(
      `insert into event_shop_settings (channel_id, season, enabled, rules, updated_at) values ('1', 'halloween-2026', false, '{}', now())`,
    );
    await db.query(
      `insert into event_wallets (season, channel_id, viewer_id, viewer_name, balance, updated_at) values ('halloween-2026', '1', '9', 'Ana', 5, now())`,
    );
    await db.query(
      `insert into event_ledger (season, channel_id, viewer_id, kind, amount, balance_after, key, actor, created_at)
       values ('halloween-2026', '1', '9', 'grant', 5, 5, 'k1', 'test', now())`,
    );

    const sql = rollbackSql();
    expect(sql).toMatch(/^delete from lab_currencies/);
    await db.query(sql);
    const after = await tables();
    expect(after.filter((t) => t.startsWith('event_'))).toEqual([]);
    // Nothing else moved: the same tables minus the event ones.
    expect(after).toEqual(all.filter((t) => !t.startsWith('event_')));
    expect(await currencies()).not.toContain('bonbons');
    expect(
      (
        await db.query(
          "select 1 from pg_proc where proname = 'event_ledger_immutable'",
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

    // The migrator applies it again (a re-delivery after a rollback).
    await migrate(db, 'prod');
    expect(await tables()).toEqual(all);
    expect(await currencies()).toContain('bonbons');
  });
});
