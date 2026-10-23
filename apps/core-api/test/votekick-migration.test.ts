import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { createPgliteDb } from './helpers.js';

// Votekick V2: the production file and the Lab file give the same tables (columns, checks, indexes — « one vote
// running per channel » and « one mute per channel » included); idempotent in the « all » scope (both files).

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});
const fresh = () => {
  const db = createPgliteDb(new PGlite());
  closers.push(() => db.close());
  return db;
};
const TABLES = [
  'votekick_votes',
  'votekick_ballots',
  'votekick_cooldowns',
  'votekick_mutes',
];
const schema = async (db: ReturnType<typeof fresh>) => ({
  columns: await db.query(
    `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
     where table_name = any($1::text[]) order by table_name, column_name`,
    [TABLES],
  ),
  checks: await db.query(
    `select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
     where conrelid::regclass::text = any($1::text[]) order by 1, 2`,
    [TABLES],
  ),
  indexes: await db.query(
    `select tablename, indexname, indexdef from pg_indexes where tablename = any($1::text[]) order by 1, 2`,
    [TABLES],
  ),
});

describe('Votekick migrations', () => {
  it('production scope = Lab scope; one running vote and one mute per channel enforced by the database', async () => {
    const prod = fresh();
    const lab = fresh();
    await migrate(prod, 'prod');
    await migrate(lab, 'lab');
    const p = await schema(prod);
    expect(p).toEqual(await schema(lab));
    const names = p.indexes.map((i) => (i as { indexname: string }).indexname);
    expect(names).toEqual(
      expect.arrayContaining(['votekick_one_running', 'votekick_one_mute']),
    );
    const insert = (id: string, ref: string, status: string) =>
      prod.query(
        `insert into votekick_votes (vote_id, channel_id, source_ref, status, initiator_id, initiator_login,
           initiator_name, target_input, created_at, updated_at) values ($1, '1', $2, $3, '2', 'i', 'I', 't', now(), now())`,
        [id, ref, status],
      );
    await insert('00000000-0000-4000-8000-000000000001', 'a', 'open');
    await expect(
      insert('00000000-0000-4000-8000-000000000002', 'b', 'checking'),
    ).rejects.toThrow();
    await insert('00000000-0000-4000-8000-000000000003', 'c', 'done'); // an ended one never blocks
    const mute = (id: string, status: string) =>
      prod.query(
        `insert into votekick_mutes (mute_id, channel_id, vote_id, seconds, status, created_at, updated_at)
         values ($1, '1', '00000000-0000-4000-8000-000000000003', 60, $2, now(), now())`,
        [id, status],
      );
    await mute('mute:a', 'active');
    await expect(mute('mute:b', 'pending')).rejects.toThrow();
    await mute('mute:c', 'ended');
  });

  it('both files in the « all » scope: idempotent', async () => {
    const all = fresh();
    await expect(migrate(all, 'all')).resolves.toEqual(
      expect.arrayContaining([
        '20261106120000_votekick_lab.sql',
        '20261106130000_votekick.sql',
      ]),
    );
  });
});
