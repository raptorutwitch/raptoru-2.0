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
  await db.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const applied = new Set(
    (
      await db.query<{ name: string }>('select name from schema_migrations')
    ).map((r) => r.name),
  );
  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    await db.tx(async (q) => {
      await q.query(sql);
      await q.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    newlyApplied.push(file);
  }
  return newlyApplied;
}
