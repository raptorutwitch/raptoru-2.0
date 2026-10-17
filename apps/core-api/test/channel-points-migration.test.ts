import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { createPgliteDb } from './helpers.js';

// Points de chaîne V1: the production migration gives exactly the tables the Lab file gives (columns, constraints,
// indexes), including the widened Soundboard checks; idempotent on a database that already has them (« all » scope).

const fresh = () =>
  createPgliteDb(
    new PGlite({
      parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
    }),
  );
const TABLES = [
  'cp_settings',
  'cp_rewards',
  'cp_rules',
  'cp_redemptions',
  'cp_jobs',
];

async function schema(db: ReturnType<typeof fresh>) {
  return {
    columns: await db.query(
      `select table_name, column_name, data_type, is_nullable, column_default, is_identity
       from information_schema.columns where table_name = any($1) order by table_name, column_name`,
      [TABLES],
    ),
    checks: await db.query(
      `select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid::regclass::text = any($1) order by 1, 2, 3`,
      [[...TABLES, 'sound_lab_interactions']],
    ),
    indexes: await db.query(
      'select indexname, indexdef from pg_indexes where tablename = any($1) order by indexname',
      [TABLES],
    ),
  };
}

describe('channel points migrations', () => {
  it('production scope = Lab scope for the channel points tables and the Soundboard checks', async () => {
    const prod = fresh();
    const lab = fresh();
    await migrate(prod, 'prod');
    await migrate(lab, 'lab');
    const p = await schema(prod);
    expect(p.columns.length).toBeGreaterThan(40);
    expect(JSON.stringify(p.checks)).toContain("'channel_points'");
    expect(p).toEqual(await schema(lab));
    await prod.close();
    await lab.close();
  });

  it('idempotent: the « all » scope (Lab file, then the production file) migrates', async () => {
    const db = fresh();
    await expect(migrate(db, 'all')).resolves.toContain(
      '20261025130000_channel_points.sql',
    );
    await db.close();
  });
});
