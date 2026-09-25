import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../../supabase/migrations', import.meta.url),
);

/** Applies every not-yet-applied `*.sql` file in name order, each in its own transaction. */
export async function migrate(
  db: Db,
  dir = DEFAULT_MIGRATIONS_DIR,
): Promise<string[]> {
  await db.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const applied = new Set(
    (
      await db.query<{ name: string }>('select name from schema_migrations')
    ).map((r) => r.name),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
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
