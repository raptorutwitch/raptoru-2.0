// Spotify V2 on a real Postgres with real pools (two Cores): the same redemption delivered to both, two redemptions of
// one viewer at once, a job taken twice, the bot's action claimed twice, a cancel and a removal of the same request at
// once — one request, one job run, one Twitch status (one refund at most), one final state.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomUUID } from 'node:crypto';
import type { SpotifyStudioStatus, SpotifyTrack } from '@raptoru/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CpTwitchActions } from '../src/channel-points/twitch-actions.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { SpotifyService } from '../src/spotify/service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const OK: SpotifyStudioStatus = {
  auth: 'ok',
  limited_until: null,
  quota_exceeded: false,
  device: null,
  calls_last_minute: 0,
};
const TRACK: SpotifyTrack = {
  id: 'AAAAAAAAAAAAAAAAAAAAAB',
  uri: 'spotify:track:AAAAAAAAAAAAAAAAAAAAAB',
  title: 'T',
  artists: ['A'],
  duration_ms: 180_000,
};

describe.skipIf(!isLocal)('Spotify V2 on a real Postgres (two Cores)', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;
  const clock = new FakeClock(new Date('2026-10-25T20:00:00Z'));
  let ch = 700;

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

  async function twoCores() {
    const channel = String(++ch);
    const A = new SpotifyService(a, clock, new CpTwitchActions(a, clock));
    const B = new SpotifyService(b, clock, new CpTwitchActions(b, clock));
    const TA = new CpTwitchActions(a, clock);
    const TB = new CpTwitchActions(b, clock);
    await a.query(
      `insert into cp_rewards (channel_id, reward_id, title, cost, source, last_seen_at, managed_by_raptoru)
       values ($1, 'song', 'Choisi la prochaine musique !', 1000, 'twitch_api', now(), true)`,
      [channel],
    );
    await A.saveSettings(channel, { enabled: true }, 'test');
    await A.sync(channel, { status: OK });
    const redemption = (viewer: string, input = 'x', id = randomUUID()) => ({
      channel_id: channel,
      source: 'twitch' as const,
      source_ref: `twitch:${id}:0`,
      reward_id: 'song',
      redemption_id: id,
      viewer: { id: viewer, login: `v${viewer}`, name: `V${viewer}` },
      user_input: input,
    });
    const n = async (sql: string, params: unknown[] = []) =>
      Number((await a.query<{ n: string }>(sql, params))[0]!.n);
    return { channel, A, B, TA, TB, redemption, n };
  }

  it('the same redemption on both Cores: one request, one job', async () => {
    const t = await twoCores();
    const e = t.redemption('1');
    const out = await Promise.all([t.A.admit(e), t.B.admit(e)]);
    expect(out.filter((o) => o.duplicate)).toHaveLength(1);
    expect(
      await t.n(
        'select count(*) as n from spotify_requests where channel_id = $1',
        [t.channel],
      ),
    ).toBe(1);
    expect(
      await t.n(
        'select count(*) as n from spotify_jobs where channel_id = $1',
        [t.channel],
      ),
    ).toBe(1);
  });

  it('two redemptions of one viewer at once on both Cores: one searched, the other refused (cooldown), one refund', async () => {
    const t = await twoCores();
    await Promise.all([
      t.A.admit(t.redemption('2')),
      t.B.admit(t.redemption('2')),
    ]);
    const states = (
      await a.query<{ state: string }>(
        'select state from spotify_requests where channel_id = $1 order by state',
        [t.channel],
      )
    ).map((r) => r.state);
    expect(states).toEqual(['RECEIVED', 'VIEWER_COOLDOWN']);
    expect(
      await t.n(
        `select count(*) as n from cp_twitch_actions where channel_id = $1`,
        [t.channel],
      ),
    ).toBe(1);
  });

  it('a job taken by both Cores at once: run once', async () => {
    const t = await twoCores();
    await t.A.admit(t.redemption('3'));
    const job = (await t.A.sync(t.channel, { status: OK })).jobs[0]!;
    const out = await Promise.allSettled([
      t.A.startJob(t.channel, job.job_id, randomUUID()),
      t.B.startJob(t.channel, job.job_id, randomUUID()),
    ]);
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  });

  it('the bot claims on both Cores at once: one action handed out', async () => {
    const t = await twoCores();
    await t.A.admit({
      ...t.redemption('4'),
      user_input: 'https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa',
    });
    const out = await Promise.all([
      t.TA.claim(t.channel),
      t.TB.claim(t.channel),
    ]);
    expect(out.filter((o) => o.action)).toHaveLength(1);
  });

  it('a viewer cancel and a moderator removal of the same request at once: one final state, one refund', async () => {
    const t = await twoCores();
    await t.A.admit(t.redemption('5'));
    const job = (await t.A.sync(t.channel, { status: OK })).jobs[0]!;
    const attempt = randomUUID();
    await t.A.startJob(t.channel, job.job_id, attempt);
    await t.A.reportJob(t.channel, job.job_id, {
      kind: 'song_request',
      attempt_id: attempt,
      outcome: 'queued',
      track: TRACK,
    });
    await Promise.all([
      t.A.cancel(t.channel, 'm-cancel', { id: '5', name: 'V5' }),
      t.B.remove(t.channel, 'm-remove', { position: 1 }, 'mod'),
    ]);
    const rows = await a.query<{ state: string }>(
      'select state from spotify_requests where channel_id = $1',
      [t.channel],
    );
    expect(['CANCELED', 'REMOVED_BY_MOD']).toContain(rows[0]!.state);
    expect(
      await t.n(
        `select count(*) as n from cp_twitch_actions where channel_id = $1 and payload->>'status' = 'CANCELED'`,
        [t.channel],
      ),
    ).toBe(1);
  });

  it('played to its end, seen by both Cores at once: PLAYED, nothing sent to Twitch (stays PENDING)', async () => {
    const t = await twoCores();
    await t.A.admit(t.redemption('6'));
    const job = (await t.A.sync(t.channel, { status: OK })).jobs[0]!;
    const attempt = randomUUID();
    await t.A.startJob(t.channel, job.job_id, attempt);
    await t.A.reportJob(t.channel, job.job_id, {
      kind: 'song_request',
      attempt_id: attempt,
      outcome: 'queued',
      track: TRACK,
    });
    const reading = (track: SpotifyTrack, progress_ms: number) => ({
      status: OK,
      playback: {
        observed_at: clock.now().toISOString(),
        track,
        progress_ms,
        is_playing: true,
      },
    });
    await t.A.sync(t.channel, reading(TRACK, 1_000));
    clock.advance(1_000);
    await t.A.sync(t.channel, reading(TRACK, 178_000));
    clock.advance(3_000);
    const next = {
      ...TRACK,
      id: 'AAAAAAAAAAAAAAAAAAAAAC',
      uri: 'spotify:track:AAAAAAAAAAAAAAAAAAAAAC',
    };
    await Promise.all([
      t.A.sync(t.channel, reading(next, 500)),
      t.B.sync(t.channel, reading(next, 500)),
    ]);
    const rows = await a.query<{ state: string; twitch_status: string | null }>(
      'select state, twitch_status from spotify_requests where channel_id = $1',
      [t.channel],
    );
    expect(rows).toEqual([{ state: 'PLAYED', twitch_status: null }]);
    expect(
      await t.n(
        'select count(*) as n from cp_twitch_actions where channel_id = $1',
        [t.channel],
      ),
    ).toBe(0);
  });

  it('« Rembourser » clicked on both Cores at once for an uncertain request: one refund', async () => {
    const t = await twoCores();
    await t.A.admit(t.redemption('7'));
    const job = (await t.A.sync(t.channel, { status: OK })).jobs[0]!;
    const attempt = randomUUID();
    await t.A.startJob(t.channel, job.job_id, attempt);
    await t.A.reportJob(t.channel, job.job_id, {
      kind: 'song_request',
      attempt_id: attempt,
      outcome: 'unknown',
      reason: 'QUEUE_RESULT_UNKNOWN',
      track: TRACK,
    });
    const id = (
      await a.query<{ request_id: string }>(
        'select request_id from spotify_requests where channel_id = $1',
        [t.channel],
      )
    )[0]!.request_id;
    const out = await Promise.allSettled([
      t.A.settle(t.channel, id, 'refund'),
      t.B.settle(t.channel, id, 'refund'),
    ]);
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(
      await t.n(
        `select count(*) as n from cp_twitch_actions where channel_id = $1 and payload->>'status' = 'CANCELED'`,
        [t.channel],
      ),
    ).toBe(1);
  });
});
