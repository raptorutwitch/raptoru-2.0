// Commands V2 admission on a real Postgres with a real pool: two Core instances admit concurrently and
// the quota is never exceeded (the command row lock serializes the counting).
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommandsAdmission } from '../src/commands/admission.js';
import { CommandsService } from '../src/commands/service.js';
import { CommandSteps } from '../src/commands/steps.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);

describe.skipIf(!isLocal)('Commands V2 admission on a real Postgres', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!); // never two schema wipes at once
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

  it('parallel messages over several connections never exceed the quota (aliases included)', async () => {
    const clock = new FakeClock(new Date('2026-10-04T18:00:00Z'));
    await new CommandsService(a, clock).create(
      '900100',
      { id: 'antoni', role: 'broadcaster', via: 'studio' },
      {
        name: 'hug',
        aliases: ['calin'],
        reply: { mode: 'normal', text: 'Câlin !', to: 'none' },
        cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'viewer' },
        quota: { enabled: true, max: 5, window: 'total', scope: 'global' },
      },
    );
    const admissions = [a, b].map((db) => new CommandsAdmission(db, clock));
    const out = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        admissions[i % 2]!.chat({
          channel_id: '900100',
          // Every message twice (redelivery): admitted once.
          message_id: `m-${i % 20}`,
          text: i % 3 ? '!hug' : '!calin',
          chatter: {
            id: String(800 + (i % 20)),
            login: `v${i % 20}`,
            display_name: `V${i % 20}`,
            role: 'viewer',
          },
          source: 'twitch',
        }).catch((e: Error) => ({ outcome: 'error', reason: e.message })),
      ),
    );
    const rows = await a.query<{ decision: string; n: number }>(
      'select decision, count(*)::int as n from cmd_invocations group by decision order by decision',
    );
    expect(rows).toEqual([
      { decision: 'accepted', n: 5 },
      { decision: 'rejected', n: 15 },
    ]);
    expect(out.filter((o) => o.outcome === 'accepted')).toHaveLength(5);
  });

  it('concurrent executors over several connections: each step handed out once, in order', async () => {
    const clock = new FakeClock(new Date('2026-10-04T18:00:00Z'));
    const studio = {
      id: 'antoni',
      role: 'broadcaster' as const,
      via: 'studio' as const,
    };
    await new CommandSteps(a, clock).setOutput('900100', studio, true);
    const before = await a.query<{ n: number }>(
      'select count(*)::int as n from cmd_steps',
    );
    expect(before[0]!.n).toBe(5);
    const workers = [a, b].flatMap((db, i) =>
      [0, 1, 2].map((j) => ({
        steps: new CommandSteps(db, clock),
        id: `w${i}${j}`,
      })),
    );
    const order: number[] = [];
    for (let round = 0; round < 5; round++) {
      const got = (
        await Promise.all(
          workers.map((w) =>
            w.steps.claim('900100', w.id).then((r) => ({ w, r })),
          ),
        )
      ).filter((x) => x.r.step);
      expect(got).toHaveLength(1);
      const { w, r } = got[0]!;
      const s = r.step!;
      order.push(
        (
          await a.query<{ seq_global: number }>(
            'select seq_global from cmd_steps where step_id = $1',
            [s.step_id],
          )
        )[0]!.seq_global,
      );
      await w.steps.ack('900100', s.step_id, {
        executor_id: w.id,
        attempt_id: s.attempt_id!,
        event: 'running',
      });
      await w.steps.ack('900100', s.step_id, {
        executor_id: w.id,
        attempt_id: s.attempt_id!,
        event: 'succeeded',
      });
    }
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });
});
