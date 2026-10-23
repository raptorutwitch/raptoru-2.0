import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { createPgliteDb } from './helpers.js';

// Caution: the production file and the Lab file give the same table (columns, checks, indexes — the partial unique
// index « one open caution per channel » included); idempotent in the « all » scope (both files).

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});
const fresh = () => {
  const db = createPgliteDb(new PGlite());
  closers.push(() => db.close());
  return db;
};
const schema = async (db: ReturnType<typeof fresh>) => ({
  columns: await db.query(
    `select column_name, data_type, is_nullable, column_default, is_identity from information_schema.columns
     where table_name = 'caution_requests' order by column_name`,
  ),
  checks: await db.query(
    `select conname, pg_get_constraintdef(oid) as def from pg_constraint
     where conrelid::regclass::text = 'caution_requests' order by 1`,
  ),
  indexes: await db.query(
    `select indexname, indexdef from pg_indexes where tablename = 'caution_requests' order by indexname`,
  ),
});

describe('Caution migrations', () => {
  it('production scope = Lab scope; one open caution per channel enforced by the database', async () => {
    const prod = fresh();
    const lab = fresh();
    await migrate(prod, 'prod');
    await migrate(lab, 'lab');
    const p = await schema(prod);
    expect(p.columns.length).toBe(29);
    expect(p).toEqual(await schema(lab));
    expect(
      p.indexes.map((i) => (i as { indexname: string }).indexname),
    ).toContain('caution_one_open');
    const insert = (id: string, ref: string, status: string) =>
      prod.query(
        `insert into caution_requests (request_id, channel_id, source_ref, payer_id, payer_login, payer_name,
           target_input, status, created_at, updated_at) values ($1, '1', $2, '2', 'p', 'P', 't', $3, now(), now())`,
        [id, ref, status],
      );
    await insert('00000000-0000-4000-8000-000000000001', 'a', 'quoted');
    await expect(
      insert('00000000-0000-4000-8000-000000000002', 'b', 'checking'),
    ).rejects.toThrow();
    await insert('00000000-0000-4000-8000-000000000003', 'c', 'released'); // an ended one never blocks
  });

  it('both files in the « all » scope: idempotent', async () => {
    const all = fresh();
    await expect(migrate(all, 'all')).resolves.toEqual(
      expect.arrayContaining([
        '20261105120000_caution_lab.sql',
        '20261105130000_caution.sql',
      ]),
    );
  });
});
