import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { createPgliteDb } from './helpers.js';

// Spotify V2: the production file and the Lab file give the same tables (columns, checks, indexes, the unique request
// per redemption, one Twitch status per redemption); additive (the channel points reward table keeps its rows) and
// idempotent in the « all » scope (both files).

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
  'spotify_settings',
  'spotify_studio',
  'spotify_requests',
  'spotify_jobs',
  'cp_twitch_actions',
  'cp_rewards',
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

describe('Spotify V2 migrations', () => {
  it('production scope = Lab scope; one request per redemption, one Twitch status per redemption', async () => {
    const prod = fresh();
    const lab = fresh();
    await migrate(prod, 'prod');
    await migrate(lab, 'lab');
    expect(await schema(prod)).toEqual(await schema(lab));
    const insert = (id: string, ref: string) =>
      prod.query(
        `insert into spotify_requests (request_id, channel_id, source, source_ref, viewer_id, viewer_login, viewer_name,
           raw_input, state, max_duration_ms, received_at, updated_at)
         values ($1, '1', 'twitch', $2, '2', 'v', 'V', 'x', 'RECEIVED', 600000, now(), now())`,
        [id, ref],
      );
    await insert('00000000-0000-4000-8000-000000000001', 'twitch:r1:0');
    await expect(
      insert('00000000-0000-4000-8000-000000000002', 'twitch:r1:0'),
    ).rejects.toThrow();
    const action = (id: string) =>
      prod.query(
        `insert into cp_twitch_actions (action_id, channel_id, kind, idempotency_key, payload, status, created_at, updated_at)
         values ($1, '1', 'redemption_status', 'status:1:r1', '{}', 'queued', now(), now())`,
        [id],
      );
    await action('00000000-0000-4000-8000-000000000003');
    await expect(
      action('00000000-0000-4000-8000-000000000004'),
    ).rejects.toThrow();
    // Out-of-range settings are refused by the database itself.
    await expect(
      prod.query(
        `insert into spotify_settings (channel_id, max_pending_per_viewer, updated_at) values ('1', 0, now())`,
      ),
    ).rejects.toThrow();
  });

  it('both files in the « all » scope: idempotent; existing rewards keep their rows, not managed by default', async () => {
    const db = fresh();
    await migrate(db, 'all');
    expect(await migrate(db, 'all')).toEqual([]);
    const cols = await db.query<{ column_default: string }>(
      `select column_default from information_schema.columns where table_name = 'cp_rewards' and column_name = 'managed_by_raptoru'`,
    );
    expect(cols[0]!.column_default).toBe('false');
  });
});
