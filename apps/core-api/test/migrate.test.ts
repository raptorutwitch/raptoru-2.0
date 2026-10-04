import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import {
  migrate,
  migrationChecksum,
  MigrationModifiedError,
} from '../src/db/migrate.js';
import type { MigrationScopes } from '../src/db/migration-scopes.js';
import { createPgliteDb } from './helpers.js';

// ASTRA-P2-008: applied migrations carry a fingerprint; a modified applied file stops the run.
const A = '20990101000000_a.sql';
const B = '20990102000000_b.sql';
const scopes = (...lab: string[]): MigrationScopes => ({
  prod: [],
  lab,
  legacyLabInProd: [],
});

async function folder(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'migrate-'));
  for (const [name, sql] of Object.entries(files))
    await writeFile(join(dir, name), sql);
  return dir;
}
const rows = (db: ReturnType<typeof createPgliteDb>) =>
  db.query<{ name: string; checksum: string | null }>(
    'select name, checksum from schema_migrations order by name',
  );

describe('migration integrity (ASTRA-P2-008)', () => {
  it('records the fingerprint of every migration it applies; an unchanged restart is a no-op', async () => {
    const sql = 'create table a (id int);';
    const dir = await folder({ [A]: sql });
    const db = createPgliteDb(new PGlite());
    expect(await migrate(db, 'lab', dir, scopes(A))).toEqual([A]);
    expect(await rows(db)).toEqual([
      { name: A, checksum: migrationChecksum(sql) },
    ]);
    expect(await migrate(db, 'lab', dir, scopes(A))).toEqual([]);
  });

  it('an applied file modified afterwards stops the run before anything is applied', async () => {
    const dir = await folder({ [A]: 'create table a (id int);' });
    const db = createPgliteDb(new PGlite());
    await migrate(db, 'lab', dir, scopes(A));
    await writeFile(join(dir, A), 'create table a (id int); drop table a;');
    await writeFile(join(dir, B), 'create table b (id int);');
    const error = await migrate(db, 'lab', dir, scopes(A, B)).catch((e) => e);
    expect(error).toBeInstanceOf(MigrationModifiedError);
    expect((error as MigrationModifiedError).file).toBe(A);
    expect(
      await db.query("select 1 from pg_tables where tablename = 'b'"),
    ).toEqual([]); // B not applied
  });

  it('line endings do not matter (a CRLF checkout of the same file is the same migration)', () => {
    expect(migrationChecksum('create table a (id int);\r\nselect 1;\r\n')).toBe(
      migrationChecksum('create table a (id int);\nselect 1;\n'),
    );
  });

  it('a row applied before fingerprints existed stays « applied, not verifiable »: kept, never re-run, never backfilled', async () => {
    const dir = await folder({
      [A]: 'create table a (id int);',
      [B]: 'create table b (id int);',
    });
    const db = createPgliteDb(new PGlite());
    // A database migrated by an older migrator: table without the checksum column, A applied.
    await db.query(
      'create table schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    await db.query('create table a (id int)');
    await db.query('insert into schema_migrations (name) values ($1)', [A]);
    await writeFile(join(dir, A), 'create table a (id int); -- edited later');
    expect(await migrate(db, 'lab', dir, scopes(A, B))).toEqual([B]);
    expect(await rows(db)).toEqual([
      { name: A, checksum: null }, // no invented proof
      { name: B, checksum: migrationChecksum('create table b (id int);') },
    ]);
  });
});
