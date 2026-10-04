import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';
import {
  MIGRATION_SCOPES,
  selectMigrations,
  type MigrationScope,
  type MigrationScopes,
} from './migration-scopes.js';

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../../supabase/migrations', import.meta.url),
);

/** Serializes migrators of the same database (ASTRA-P2-007): advisory lock, per database. */
const MIGRATION_LOCK = 2_007_008;

/** Content fingerprint of a migration file, line endings normalized (CRLF / LF checkouts agree). */
export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** An applied migration whose file changed since (ASTRA-P2-008): nothing is applied. */
export class MigrationModifiedError extends Error {
  constructor(readonly file: string) {
    super(
      `migration ${file} was modified after it was applied: restore it and add a new migration instead`,
    );
  }
}

/**
 * Applies every not-yet-applied migration of `scope` (see migration-scopes.ts), in name order, each
 * in its own transaction. The scope is mandatory: the production path passes `prod` and never gets
 * a Lab migration added after the boundary; an unclassified file stops the run before anything is
 * applied.
 */
export async function migrate(
  db: Db,
  scope: MigrationScope,
  dir = DEFAULT_MIGRATIONS_DIR,
  scopes: MigrationScopes = MIGRATION_SCOPES,
): Promise<string[]> {
  const files = selectMigrations(await readdir(dir), scope, scopes);
  // Every step below holds the same transaction-level advisory lock: two migrators of one database
  // never interleave, and the lock is released by commit, rollback or a lost connection.
  await db.tx(async (q) => {
    await q.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await q.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    // ASTRA-P2-008: fingerprint of each migration applied from now on. Rows written before this
    // column existed stay null: « applied, not verifiable » — never filled in retroactively (that
    // would certify a content nobody checked at the time).
    await q.query(
      'alter table schema_migrations add column if not exists checksum text',
    );
  });
  const sqlOf = async (file: string) => readFile(join(dir, file), 'utf8');
  // Integrity first: an applied file whose content changed stops the run before anything is applied.
  const recorded = new Map(
    (
      await db.query<{ name: string; checksum: string | null }>(
        'select name, checksum from schema_migrations',
      )
    ).map((r) => [r.name, r.checksum]),
  );
  for (const file of files) {
    const checksum = recorded.get(file);
    if (checksum && migrationChecksum(await sqlOf(file)) !== checksum)
      throw new MigrationModifiedError(file);
  }
  const newlyApplied: string[] = [];

  for (const file of files) {
    if (recorded.has(file)) continue;
    const sql = await sqlOf(file);
    const applied = await db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
      // Under the lock: another migrator may have applied it meanwhile.
      const done = await q.query(
        'select 1 from schema_migrations where name = $1',
        [file],
      );
      if (done.length) return false;
      await q.query(sql);
      await q.query(
        'insert into schema_migrations (name, checksum) values ($1, $2)',
        [file, migrationChecksum(sql)],
      );
      return true;
    });
    if (applied) newlyApplied.push(file);
  }
  return newlyApplied;
}
