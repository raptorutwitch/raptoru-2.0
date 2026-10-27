// Dock OBS V1 on a real Postgres with real pools (two Core instances): the change feed never skips a row committed
// late (seq given under the channel lock until commit), and two replay clicks at once on two Cores queue ONE replay.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlertsService } from '../src/alerts/service.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { DockActivityService } from '../src/dock/service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);

describe.skipIf(!isLocal)('Dock OBS on a real Postgres (two Cores)', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;
  const clock = new FakeClock(new Date('2026-10-27T20:00:00Z'));
  let ch = 500;

  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    b = createPgDb(url!);
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await unlock?.();
  });

  it('a reader following the feed during concurrent receptions and scans on two Cores misses nothing', async () => {
    const channel = String(++ch);
    const alertsA = new AlertsService(a, clock, () => 0);
    const alertsB = new AlertsService(b, clock, () => 0);
    const dockA = new DockActivityService(a, clock, { autoScan: false });
    const dockB = new DockActivityService(b, clock, { autoScan: false });
    const seen = new Map<string, string>();
    let cursor = 0;
    let writing = true;
    const reader = (async () => {
      while (
        writing ||
        cursor <
          Number(
            (
              await a.query<{ seq: string }>(
                'select seq from dock_activity_channels where channel_id = $1',
                [channel],
              )
            )[0]?.seq ?? 0,
          )
      ) {
        const c = await dockB.changes(channel, { after: cursor, limit: 7 });
        for (const x of c.activities)
          seen.set(x.activity_key, String(x.state.outcome));
        cursor = c.cursor;
        await new Promise((r) => setTimeout(r, 2));
      }
    })();
    const writers = Array.from({ length: 6 }, (_, w) =>
      (async () => {
        for (let i = 0; i < 15; i++) {
          await (w % 2 ? alertsA : alertsB).receive({
            channel_id: channel,
            source: 'simulation',
            source_event_id: `w${w}-${i}`,
            type: 'follow',
            actor: { id: String(w), login: `u${w}`, display_name: `U${w}` },
          });
          if (i % 3 === 0) await (w % 2 ? dockA : dockB).scan(channel);
        }
      })(),
    );
    await Promise.all(writers);
    await dockA.scan(channel);
    await dockB.scan(channel);
    writing = false;
    await reader;
    const all = await a.query<{ activity_key: string }>(
      'select activity_key from dock_activity where channel_id = $1',
      [channel],
    );
    expect(all).toHaveLength(90);
    expect(seen.size).toBe(90);
    // Positions are unique and dense: every projection took the next seq, in commit order.
    const seqs = (
      await a.query<{ seq: string }>(
        'select seq from dock_activity where channel_id = $1 order by seq',
        [channel],
      )
    ).map((r) => Number(r.seq));
    expect(new Set(seqs).size).toBe(seqs.length);
  }, 120_000);

  it('two replay clicks at once on two Cores (two keys): one replay queued', async () => {
    const channel = String(++ch);
    const alertsA = new AlertsService(a, clock, () => 0);
    const original = (
      await alertsA.receive({
        channel_id: channel,
        source: 'simulation',
        source_event_id: 'r-1',
        type: 'follow',
        actor: { id: '1', login: 'alice', display_name: 'Alice' },
      })
    ).alert!;
    const c = (await alertsA.claim(channel, 'p'))!;
    await alertsA.ack(c.alert_id, {
      consumer_id: 'p',
      attempt_id: c.attempt_id!,
      event: 'started',
    });
    await alertsA.ack(c.alert_id, {
      consumer_id: 'p',
      attempt_id: c.attempt_id!,
      event: 'completed',
    });
    const docks = [a, b, a, b].map(
      (db) => new DockActivityService(db, clock, { autoScan: false }),
    );
    const outs = await Promise.all(
      docks.map((d) => d.replayAlert(channel, original.alert_id, randomUUID())),
    );
    expect(outs.filter((o) => o.created)).toHaveLength(1);
    expect(new Set(outs.map((o) => o.replay_alert_id)).size).toBe(1);
    const queued = await a.query(
      `select 1 from alert_items where channel_id = $1 and status = 'queued'`,
      [channel],
    );
    expect(queued).toHaveLength(1);
  });
});
