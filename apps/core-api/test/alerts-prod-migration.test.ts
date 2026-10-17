import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { AlertsService } from '../src/alerts/service.js';
import { migrate } from '../src/db/migrate.js';
import { createPgliteDb, FakeClock } from './helpers.js';

// Twitch alerts V1, production schema (§ 22): the production migration gives exactly the tables the Lab database
// ends with (columns, constraints, indexes), the canonical service runs on it, and it is idempotent (no-op where the
// tables already exist — the « all » test scope applies the Lab files first).

const fresh = () =>
  createPgliteDb(
    new PGlite({
      parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
    }),
  );

async function schema(db: ReturnType<typeof fresh>) {
  const tables = ['alert_events', 'alert_channels', 'alert_items'];
  return {
    columns: await db.query(
      `select table_name, column_name, data_type, is_nullable, column_default, is_identity
       from information_schema.columns where table_name = any($1) order by table_name, column_name`,
      [tables],
    ),
    checks: (
      await db.query<{ table: string; def: string }>(
        `select conrelid::regclass::text as table, pg_get_constraintdef(oid) as def
         from pg_constraint where conrelid::regclass::text = any($1) order by 1, 2`,
        [tables],
      )
    ).map((c) => `${c.table}: ${c.def}`),
    indexes: (
      await db.query<{ indexdef: string }>(
        `select indexdef from pg_indexes where tablename = any($1) order by indexname`,
        [tables],
      )
    ).map((i) => i.indexdef),
  };
}

describe('alerts production migration', () => {
  it('production scope = the same alerts schema as the Lab scope', async () => {
    const prod = fresh();
    const lab = fresh();
    await migrate(prod, 'prod');
    await migrate(lab, 'lab');
    const p = await schema(prod);
    expect(p.columns.length).toBeGreaterThan(20);
    expect(p).toEqual(await schema(lab));
    await prod.close();
    await lab.close();
  });

  it('the canonical service runs on it: dedup, families side by side', async () => {
    const db = fresh();
    await migrate(db, 'prod');
    const alerts = new AlertsService(
      db,
      new FakeClock(new Date('2026-10-17T20:00:00Z')),
      () => 0,
    );
    const ev = (id: string, type: string) =>
      alerts.receive({
        channel_id: '83603689',
        source: 'simulation',
        source_event_id: id,
        type: type as 'follow',
        actor: { display_name: 'X' },
        ...(type === 'bits' ? { bits: 100 } : {}),
      });
    expect((await ev('a', 'follow')).outcome).toBe('queued');
    expect((await ev('a', 'follow')).outcome).toBe('duplicate');
    await ev('b', 'follow');
    await ev('c', 'bits');
    const first = await alerts.claim('83603689', 'obs-1');
    const second = await alerts.claim('83603689', 'obs-1');
    expect([first?.family, second?.family].sort()).toEqual(['bits', 'follow']);
    expect(await alerts.claim('83603689', 'obs-1')).toBeNull();
    await db.close();
  });

  it('idempotent: the « all » scope (Lab files, then this one) migrates', async () => {
    const db = fresh();
    await expect(migrate(db, 'all')).resolves.toContain(
      '20261024120000_alerts.sql',
    );
    await db.close();
  });
});
