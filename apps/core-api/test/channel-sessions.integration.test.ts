// ASTRA-P1-007 lot 1 on a real Postgres with real parallel connections (PGlite serializes every
// transaction and cannot prove the per-channel session lock): concurrent Twitch events and Studio
// simulations never create two sessions for one live, nor two open sessions, nor a unique violation.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { RaffleLabService } from '../src/raffle-lab/raffle-lab-service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const STUDIO = {
  id: 'antoni',
  role: 'broadcaster' as const,
  via: 'studio' as const,
};

describe.skipIf(!isLocal)('channel stream sessions on a real Postgres', () => {
  const pools: Db[] = [];
  let unlock: (() => Promise<void>) | undefined;
  const pool = () => {
    const db = createPgDb(url!);
    pools.push(db);
    return db;
  };
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    const db = pool();
    await db.query('drop schema public cascade; create schema public;');
    await migrate(db, 'all');
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    for (const db of pools) await db.close();
    await unlock?.();
  });

  /** Three Lab Cores (three pools) on the same database, one channel each test. */
  function cores(channel: string) {
    const clock = new FakeClock(new Date());
    const services = [pool(), pool(), pool()].map(
      (db) => new RaffleLabService(db, clock),
    );
    const sessions = () =>
      pools[0]!.query<{
        source: string;
        twitch_stream_id: string | null;
        ended_at: Date | null;
      }>(
        'select source, twitch_stream_id, ended_at from lab_stream_sessions where channel_id = $1 order by started_at',
        [channel],
      );
    const online = (i: number, id: string) =>
      services[i % 3]!.streamEvent({
        channel_id: channel,
        event: 'online',
        twitch_stream_id: id,
      });
    return { services, sessions, online };
  }

  it('12 concurrent « online » of the same live over 3 connections: one session, no error', async () => {
    const c = cores('910101');
    const out = await Promise.all(
      Array.from({ length: 12 }, (_, i) => c.online(i, '5001')),
    );
    expect(new Set(out.map((o) => o.session_id)).size).toBe(1);
    expect(out.filter((o) => o.changed)).toHaveLength(1);
    expect(await c.sessions()).toEqual([
      { source: 'twitch', twitch_stream_id: '5001', ended_at: null },
    ]);
  });

  it('two lives racing (lost offline) + offlines + a Studio simulation, concurrently: never two open sessions, never a duplicate per live', async () => {
    const c = cores('910102');
    await c.online(0, '6001');
    const results = await Promise.allSettled([
      c.online(0, '6002'),
      c.online(1, '6002'),
      c.online(2, '6001'),
      c.services[1]!.streamEvent({ channel_id: '910102', event: 'offline' }),
      c.services[2]!.act('910102', {
        actor: STUDIO,
        command: { action: 'stream_start' },
      } as never),
      c.online(0, '6002'),
    ]);
    // Only a business refusal is acceptable (simulation while a live is open), never a DB error.
    for (const r of results)
      if (r.status === 'rejected')
        expect((r.reason as { code?: string }).code).toBe(
          'stream_already_live',
        );
    const rows = await c.sessions();
    expect(rows.filter((r) => r.ended_at === null).length).toBeLessThanOrEqual(
      1,
    );
    const ids = rows.map((r) => r.twitch_stream_id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
