// Votekick V2 on a real Postgres with real pools (two Core instances): the same deliveries, ballots, ticks and
// executor reports at once on both — one vote per channel, one ballot per voter, one verdict, one timeout job (on the
// right person), one mute; the broadcaster's Caution and the mute's end never both win.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import type { LabChatMessage } from '@raptoru/schemas';
import { VOTEKICK } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { VotekickService } from '../src/votekick/service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const EXEC = { executor_id: 'bot-1', login: 'lecroupier_' };
const u = (id: string) => ({ id, login: `u${id}`, name: `U${id}` });

describe.skipIf(!isLocal)('Votekick on a real Postgres (two Cores)', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;
  const clock = new FakeClock(new Date('2026-10-23T20:00:00Z'));
  let ch = 500;
  let m = 0;

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

  async function twoCores(broadcaster = '1') {
    const channel = String(++ch);
    const A = new VotekickService(
      a,
      clock,
      () => broadcaster,
      () => 0,
    );
    const B = new VotekickService(
      b,
      clock,
      () => broadcaster,
      () => 0,
    );
    const exec = { ...EXEC, can_read: true, can_timeout: true, missing: [] };
    for (const c of [A, B]) await c.claim(channel, exec);
    const msg = (
      who: ReturnType<typeof u>,
      text: string,
      id = `m${++m}`,
    ): LabChatMessage => ({
      channel_id: channel,
      message_id: id,
      text,
      chatter: {
        id: who.id,
        login: who.login,
        display_name: who.name,
        role: 'viewer',
      },
      source: 'twitch',
    });
    const n = async (sql: string, params: unknown[] = []) =>
      Number((await a.query<{ n: string }>(sql, params))[0]!.n);
    /** Opened by u10 against `target` through Core A. */
    async function open(target = u('20')) {
      await A.chat(msg(u('10'), `!votekick ${target.login}`));
      const job = (await A.claim(channel, exec)).job!;
      await A.check(job.vote_id, {
        ...EXEC,
        attempt_id: job.attempt_id,
        target,
        moderator: false,
      });
      return job.vote_id;
    }
    return { channel, A, B, exec, msg, n, open };
  }

  it('the same `!votekick` on both Cores, and two different ones at once: one vote', async () => {
    const t = await twoCores();
    const same = t.msg(u('10'), '!votekick u20', 'same-delivery');
    const outs = await Promise.all([
      t.A.chat(same),
      t.B.chat(same),
      t.A.chat(t.msg(u('11'), '!votekick u21')),
      t.B.chat(t.msg(u('12'), '!votekick u22')),
    ]);
    expect(outs.filter((o) => o.outcome === 'checking')).toHaveLength(1);
    expect(
      await t.n(
        'select count(*) as n from votekick_votes where channel_id = $1',
        [t.channel],
      ),
    ).toBe(1);
  });

  it('ballots at once on both Cores: one per voter; the end ticked by both: one verdict, one timeout job', async () => {
    const t = await twoCores();
    const id = await t.open();
    await Promise.all([
      t.A.chat(t.msg(u('30'), '!kick')),
      t.B.chat(t.msg(u('30'), '!kick')),
      t.A.chat(t.msg(u('31'), '!kick')),
      t.B.chat(t.msg(u('31'), '!save')),
      t.A.chat(t.msg(u('32'), '!kick')),
    ]);
    expect(
      await t.n(
        'select count(*) as n from votekick_ballots where vote_id = $1',
        [id],
      ),
    ).toBe(3);
    clock.advance(VOTEKICK.voteMs + VOTEKICK.finishGraceMs);
    await Promise.all([t.A.tick(), t.B.tick(), t.A.tick(), t.B.tick()]);
    const v = (
      await a.query<{ status: string; punished_id: string; seq: number }>(
        'select status, punished_id, seq from votekick_votes where vote_id = $1',
        [id],
      )
    )[0]!;
    expect(v).toMatchObject({ status: 'sanctioning', punished_id: '20' });
    const jobs = await Promise.all([
      t.A.claim(t.channel, t.exec),
      t.B.claim(t.channel, t.exec),
    ]);
    const handed = jobs.filter((j) => j.job);
    expect(handed).toHaveLength(1);
    expect(handed[0]!.job).toMatchObject({ phase: 'timeout', target_id: '20' });
    const job = handed[0]!.job as { vote_id: string; attempt_id: string };
    const reports = await Promise.allSettled([
      t.A.timeoutResult(job.vote_id, {
        ...EXEC,
        attempt_id: job.attempt_id,
        event: 'confirmed',
      }),
      t.B.timeoutResult(job.vote_id, {
        ...EXEC,
        attempt_id: job.attempt_id,
        event: 'confirmed',
      }),
    ]);
    expect(reports.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    clock.advance(VOTEKICK.resultMs);
  });

  it('the vote length set in Studio: saved at once on both Cores (one row), applied to the next vote only', async () => {
    const t = await twoCores();
    await Promise.all([
      t.A.saveSettings(t.channel, { vote_seconds: 40 }, 'studio'),
      t.B.saveSettings(t.channel, { vote_seconds: 50 }, 'studio'),
    ]);
    expect(
      await t.n(
        'select count(*) as n from votekick_settings where channel_id = $1',
        [t.channel],
      ),
    ).toBe(1);
    await t.A.saveSettings(t.channel, { vote_seconds: 30 }, 'studio');
    expect((await t.B.settings(t.channel)).vote_seconds).toBe(30);
    const length = async (id: string) =>
      t.n(
        'select extract(epoch from (ends_at - opened_at))::int as n from votekick_votes where vote_id = $1',
        [id],
      );
    const vote = await t.open();
    expect(await length(vote)).toBe(30);
    // Changed while it is open: the open vote keeps its 30 s.
    await t.B.saveSettings(t.channel, { vote_seconds: 120 }, 'studio');
    expect(await length(vote)).toBe(30);
    expect(
      await t.n(
        'select vote_seconds as n from votekick_settings where channel_id = $1',
        [t.channel],
      ),
    ).toBe(120);
    await expect(
      a.query('insert into votekick_settings values ($1, 10, now(), null)', [
        `${t.channel}9`,
      ]),
    ).rejects.toThrow(); // the database refuses a length out of 15–300 too
    clock.advance(30_000 + VOTEKICK.finishGraceMs + VOTEKICK.resultMs);
    await t.A.tick();
  });

  it('the broadcaster muted: one mute; his Caution end and the mute expiry at once: ended once', async () => {
    const t = await twoCores('40');
    await t.open(u('40'));
    await t.A.chat(t.msg(u('30'), '!kick'));
    await t.B.chat(t.msg(u('31'), '!kick'));
    clock.advance(VOTEKICK.voteMs + VOTEKICK.finishGraceMs);
    await Promise.all([t.A.tick(), t.B.tick()]);
    expect(
      await t.n(
        `select count(*) as n from votekick_mutes where channel_id = $1`,
        [t.channel],
      ),
    ).toBe(1);
    const task = await t.A.studio(t.channel);
    await Promise.all([
      t.A.muteReport(t.channel, task.mute!.mute_id, { event: 'started' }),
      t.B.muteReport(t.channel, task.mute!.mute_id, { event: 'started' }),
    ]);
    const started = (
      await a.query<{ ends_at: Date }>(
        'select ends_at from votekick_mutes where mute_id = $1',
        [task.mute!.mute_id],
      )
    )[0]!.ends_at;
    clock.set(new Date(new Date(started).getTime()));
    await Promise.all([
      a.tx((q) => t.A.end(q, t.channel, task.mute!.mute_id)),
      t.B.tick(),
    ]);
    const rows = await a.query<{ status: string; end_reason: string }>(
      'select status, end_reason from votekick_mutes where mute_id = $1',
      [task.mute!.mute_id],
    );
    expect(rows[0]!.status).toBe('ended');
    expect(['caution', 'expired']).toContain(rows[0]!.end_reason);
    clock.advance(VOTEKICK.resultMs);
  });
});
