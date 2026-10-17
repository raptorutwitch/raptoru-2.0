import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { AlertsService } from '../src/alerts/service.js';
import { DEFAULT_MIGRATIONS_DIR, migrate } from '../src/db/migrate.js';
import { createPgliteDb, FakeClock } from './helpers.js';

// Twitch alerts — the families migration on a Lab database that already holds the A1 queue (rows waiting and one in
// flight): every row gets its family from its event type, the in-flight alert keeps its lease, and the queue then
// serves the other families at once.

const FAMILIES = '20261023120000_alerts_lab_families.sql';
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe('alerts families migration', () => {
  it('classifies the existing rows and lets the other families start beside the alert in flight', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'alerts-mig-'));
    dirs.push(dir);
    for (const f of await readdir(DEFAULT_MIGRATIONS_DIR))
      if (f.endsWith('.sql') && f !== FAMILIES)
        await copyFile(join(DEFAULT_MIGRATIONS_DIR, f), join(dir, f));
    const db = createPgliteDb(
      new PGlite({
        parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
      }),
    );
    await migrate(db, 'lab', dir);
    // The A1 schema: one in flight per channel, no family column.
    const T0 = new Date('2026-10-17T20:00:00Z');
    const rows: [string, string, string][] = [
      ['11111111-1111-4111-8111-000000000001', 'sub', 'playing'],
      ['11111111-1111-4111-8111-000000000002', 'gift_community', 'queued'],
      ['11111111-1111-4111-8111-000000000003', 'follow', 'queued'],
      ['11111111-1111-4111-8111-000000000004', 'raid', 'queued'],
      ['11111111-1111-4111-8111-000000000005', 'donation', 'completed'],
    ];
    for (const [id, type, status] of rows)
      await db.query(
        `insert into alert_items (alert_id, channel_id, type, variant_id, variant, data, priority, status, attempt_id,
           lease_expires_at, consumer_id, attempts, created_at)
         values ($1, '900900', $2, 'v', '{}'::jsonb, '{}'::jsonb, 10, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          type,
          status,
          status === 'playing' ? '22222222-2222-4222-8222-000000000001' : null,
          status === 'playing' ? new Date(T0.getTime() + 60_000) : null,
          status === 'playing' ? 'obs-1' : null,
          status === 'queued' ? 0 : 1,
          T0,
        ],
      );
    await copyFile(join(DEFAULT_MIGRATIONS_DIR, FAMILIES), join(dir, FAMILIES));
    expect(await migrate(db, 'lab', dir)).toEqual([FAMILIES]);
    expect(
      await db.query<{ type: string; family: string }>(
        'select type, family from alert_items order by alert_id',
      ),
    ).toEqual([
      { type: 'sub', family: 'subscription' },
      { type: 'gift_community', family: 'subscription' },
      { type: 'follow', family: 'follow' },
      { type: 'raid', family: 'raid' },
      { type: 'donation', family: 'donation' },
    ]);
    const alerts = new AlertsService(db, new FakeClock(T0));
    const got: string[] = [];
    for (;;) {
      const a = await alerts.claim('900900', 'obs-2');
      if (!a) break;
      got.push(a.type);
    }
    // The gift waits for the sub still playing; follow and raid start beside it.
    expect(got.sort()).toEqual(['follow', 'raid']);
    await expect(
      db.query(
        `insert into alert_items (alert_id, channel_id, type, family, variant_id, variant, data, priority, status,
           attempt_id, lease_expires_at, created_at)
         values ('11111111-1111-4111-8111-000000000009', '900900', 'resub', 'subscription', 'v', '{}', '{}', 10,
           'claimed', '22222222-2222-4222-8222-000000000009', now(), now())`,
      ),
    ).rejects.toThrow(); // a second subscription in flight: refused by the database itself
    await db.close();
  });
});
