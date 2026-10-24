import { randomUUID } from 'node:crypto';
import type {
  CpRedemptionInput,
  LabChatMessage,
  SpotifyPlayback,
  SpotifyStudioStatus,
  SpotifyTrack,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { spotifyRoutes } from '../src/http/spotify-routes.js';
import { SpotifyChat } from '../src/spotify/chat.js';
import { setup } from './helpers.js';

// Spotify V2, Core side (docs/SPOTIFY_V2.md): the historical rules (spotify-v2/service.js, moderation.js, scheduler.js)
// and texts, with Studio played by its syncs / job reports and the bot by its Twitch actions.

const CH = '83603689';
const REWARD = 'reward-song';
const SKIP_REWARD = 'reward-skip';
const ID = (n: number) =>
  `${'A'.repeat(21)}${String.fromCharCode(64 + n)}`.slice(0, 22);
const track = (
  n: number,
  title = `Titre ${n}`,
  artists = [`Artiste ${n}`],
  duration_ms = 200_000,
): SpotifyTrack => ({
  id: ID(n),
  uri: `spotify:track:${ID(n)}`,
  title,
  artists,
  duration_ms,
});
const OK: SpotifyStudioStatus = {
  auth: 'ok',
  limited_until: null,
  quota_exceeded: false,
  device: { name: 'ANTONI-PC', type: 'Computer' },
  calls_last_minute: 3,
};
const viewer = (n: number) => ({
  id: String(9000 + n),
  login: `viewer${n}`,
  display_name: `Viewer${n}`,
});
let msgSeq = 0;

async function lab(options: { managed?: boolean; enabled?: boolean } = {}) {
  const core = await setup();
  core.clock.set(new Date('2026-10-25T20:00:00Z'));
  const { spotify, channelPoints: cp } = core;
  await cp.syncRewards({
    channel_id: CH,
    rewards: [
      {
        id: REWARD,
        title: 'Choisi la prochaine musique !',
        cost: 1000,
        is_enabled: true,
      },
      {
        id: SKIP_REWARD,
        title: 'Skip la musique',
        cost: 2000,
        is_enabled: true,
      },
    ],
  });
  await cp.saveRule(CH, REWARD, {
    enabled: true,
    actions: [{ type: 'interaction', interaction: 'song_request' }],
  });
  await cp.saveRule(CH, SKIP_REWARD, {
    enabled: true,
    actions: [{ type: 'interaction', interaction: 'song_skip' }],
  });
  await cp.setEnabled(CH, true, 'test');
  if (options.enabled !== false)
    await spotify.saveSettings(CH, { enabled: true }, 'test');
  if (options.managed)
    await core.db.query(
      'update cp_rewards set managed_by_raptoru = true where channel_id = $1',
      [CH],
    );
  const chat = new SpotifyChat(spotify);

  const sync = (
    playback?: SpotifyPlayback | null,
    status: SpotifyStudioStatus = OK,
  ) =>
    spotify.sync(CH, {
      status,
      ...(playback !== undefined ? { playback } : {}),
    });
  const playing = (
    t: SpotifyTrack | null,
    progress_ms = 1_000,
    is_playing = true,
  ): SpotifyPlayback => ({
    observed_at: core.clock.now().toISOString(),
    track: t,
    progress_ms: t ? progress_ms : null,
    is_playing,
  });
  const redeem = (
    n: number,
    input: string,
    over: Partial<CpRedemptionInput> = {},
  ) =>
    cp.receive({
      channel_id: CH,
      source: 'twitch',
      redemption_id: randomUUID(),
      reward: {
        id: REWARD,
        title: 'Choisi la prochaine musique !',
        cost: 1000,
      },
      user: viewer(n),
      user_input: input,
      twitch_status: 'unfulfilled',
      redeemed_at: core.clock.now().toISOString(),
      ...over,
    });
  /** Studio runs the pending song request job of this request (search + queue) with this result. */
  const studio = async (
    outcome: 'queued' | 'refused' | 'unknown',
    t?: SpotifyTrack,
    reason?: 'NOT_FOUND' | 'AMBIGUOUS' | 'TOO_LONG' | 'NO_DEVICE',
  ) => {
    const ans = await sync();
    const job = ans.jobs.find((j) => j.kind === 'song_request')!;
    const attempt = randomUUID();
    await spotify.startJob(CH, job.job_id, attempt);
    await spotify.reportJob(CH, job.job_id, {
      kind: 'song_request',
      attempt_id: attempt,
      outcome,
      ...(t ? { track: t } : {}),
      ...(reason ? { reason } : {}),
      ...(outcome === 'queued'
        ? { confirmation: 'queue_readback' as const }
        : {}),
    });
    return job;
  };
  const runJob = async (
    kind: 'skip' | 'read_playback',
    report: Record<string, unknown>,
  ) => {
    const ans = await sync();
    const job = ans.jobs.find((j) => j.kind === kind)!;
    expect(job).toBeTruthy();
    const attempt = randomUUID();
    await spotify.startJob(CH, job.job_id, attempt);
    await spotify.reportJob(CH, job.job_id, {
      kind,
      attempt_id: attempt,
      ...report,
    } as never);
    return job;
  };
  const say = (
    n: number,
    text: string,
    role: 'viewer' | 'moderator' | 'broadcaster' = 'viewer',
  ) =>
    chat.chat({
      channel_id: CH,
      message_id: `m-${++msgSeq}`,
      text,
      chatter: { ...viewer(n), role },
      source: 'twitch',
    } satisfies LabChatMessage);
  const replies = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'spotify:%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  const requests = () =>
    core.db.query<{
      request_id: string;
      state: string;
      reason: string | null;
      viewer_id: string;
      twitch_status: string | null;
      auto_skip: boolean;
      auto_skip_consumed_at: Date | null;
      skipped_by: string | null;
    }>('select * from spotify_requests where channel_id = $1 order by seq', [
      CH,
    ]);
  const actions = () =>
    core.db.query<{
      kind: string;
      payload: { status?: string; redemption_id?: string };
      status: string;
    }>(
      'select kind, payload, status from cp_twitch_actions where channel_id = $1 order by created_at',
      [CH],
    );
  return {
    core,
    spotify,
    cp,
    chat,
    sync,
    playing,
    redeem,
    studio,
    runJob,
    say,
    replies,
    requests,
    actions,
  };
}

describe('Spotify V2 — a song request (« Choisi la prochaine musique ! »)', () => {
  it('Studio absent: refused before any search, the historical « indisponible » text, nothing for Studio', async () => {
    const t = await lab();
    const out = await t.redeem(1, 'Daft Punk One More Time');
    expect(out.redemption.results[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('STUDIO_UNAVAILABLE'),
    });
    expect(await t.replies()).toEqual([
      '@Viewer1 → Spotify est momentanément indisponible.',
    ]);
    expect((await t.requests())[0]).toMatchObject({
      state: 'FAILED',
      reason: 'STUDIO_UNAVAILABLE',
      twitch_status: 'unmanaged',
    });
    expect((await t.sync()).jobs).toEqual([]);
  });

  it('module OFF (default): refused, never searched', async () => {
    const t = await lab({ enabled: false });
    await t.sync();
    await t.redeem(1, 'One More Time');
    expect((await t.requests())[0]).toMatchObject({
      state: 'FAILED',
      reason: 'MODULE_DISABLED',
    });
  });

  it('accepted: one job for Studio; queued → the historical success line, QUEUED, the redemption done', async () => {
    const t = await lab();
    await t.sync();
    const out = await t.redeem(1, 'Daft Punk One More Time');
    expect(out.redemption.status).toBe('pending');
    const job = await t.studio(
      'queued',
      track(1, 'One More Time', ['Daft Punk']),
    );
    expect(job).toMatchObject({
      kind: 'song_request',
      reference: { kind: 'search', query: 'Daft Punk One More Time' },
      max_duration_ms: 600_000,
    });
    expect(await t.replies()).toEqual([
      '@Viewer1 → One More Time — Daft Punk ajouté à la file !',
    ]);
    expect((await t.requests())[0]).toMatchObject({
      state: 'QUEUED',
      reason: 'QUEUED',
    });
    const cp = await t.cp.state(CH);
    expect(cp.recent[0]!.results[0]).toMatchObject({
      status: 'done',
      detail: 'One More Time — Daft Punk ajoutée à la file Spotify',
    });
    // The same job is never handed out twice.
    await expect(
      t.spotify.startJob(CH, job.job_id, randomUUID()),
    ).rejects.toMatchObject({ code: 'job_taken' });
  });

  it('a link or a URI is an exact track; an album or another site is refused; an empty text too', async () => {
    const t = await lab();
    await t.core.spotify.saveSettings(
      CH,
      { viewer_cooldown_seconds: 0, max_pending_per_viewer: 10 },
      'test',
    );
    await t.sync();
    await t.redeem(1, `https://open.spotify.com/intl-fr/track/${ID(5)}?si=abc`);
    await t.redeem(2, 'https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa');
    await t.redeem(3, 'https://youtube.com/watch?v=x');
    await t.redeem(4, '   ');
    const jobs = (await t.sync()).jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      reference: { kind: 'exact', track_id: ID(5) },
    });
    expect(await t.replies()).toEqual([
      '@Viewer2 → La référence Spotify doit être une piste.',
      '@Viewer3 → La référence Spotify doit être une piste.',
      '@Viewer4 → La demande est invalide.',
    ]);
  });

  it('Studio refuses (not found, ambiguous, too long, no device): the historical texts, the right states', async () => {
    const t = await lab();
    await t.core.spotify.saveSettings(
      CH,
      { viewer_cooldown_seconds: 0 },
      'test',
    );
    await t.sync();
    for (const [n, reason] of [
      [1, 'NOT_FOUND'],
      [2, 'AMBIGUOUS'],
      [3, 'TOO_LONG'],
      [4, 'NO_DEVICE'],
    ] as const) {
      await t.redeem(n, 'quelque chose');
      await t.studio('refused', undefined, reason);
    }
    expect((await t.requests()).map((r) => [r.state, r.reason])).toEqual([
      ['FAILED', 'NOT_FOUND'],
      ['AMBIGUOUS', 'AMBIGUOUS'],
      ['TOO_LONG', 'TOO_LONG'],
      ['FAILED', 'NO_DEVICE'],
    ]);
    expect(await t.replies()).toEqual([
      '@Viewer1 → Aucune piste suffisamment proche n’a été trouvée.',
      '@Viewer2 → Plusieurs pistes sont suffisamment proches ; aucune n’a été ajoutée.',
      '@Viewer3 → La piste dépasse la durée maximale configurée.',
      '@Viewer4 → Aucun appareil Spotify actif et disponible n’a été trouvé.',
    ]);
  });

  it('cooldown 10 min while the previous request waits (historical text); it falls when that one starts playing', async () => {
    const t = await lab();
    await t.sync();
    await t.redeem(1, 'premier');
    await t.studio('queued', track(1));
    t.core.clock.advance(3 * 60_000);
    await t.sync();
    await t.redeem(1, 'deuxième');
    expect((await t.replies())[1]).toBe(
      '@Viewer1 → attends encore 7 min avant une nouvelle demande.',
    );
    t.core.clock.advance(6 * 60_000 + 30_000);
    await t.sync();
    await t.redeem(1, 'troisième');
    expect((await t.replies())[2]).toBe(
      '@Viewer1 → attends encore moins d’une minute avant une nouvelle demande.',
    );
    // The first one plays: no cooldown any more.
    await t.sync(t.playing(track(1)));
    await t.redeem(1, 'quatrième');
    expect((await t.sync()).jobs).toHaveLength(1);
  });

  it('a request being searched counts as queued for the cooldown (one viewer, two redemptions at once)', async () => {
    const t = await lab();
    await t.sync();
    await Promise.all([t.redeem(1, 'a'), t.redeem(1, 'b')]);
    const states = (await t.requests()).map((r) => r.state).sort();
    expect(states).toEqual(['RECEIVED', 'VIEWER_COOLDOWN']);
  });

  it("at most 2 pending per viewer (in Spotify's queue or being searched); the song playing does not count", async () => {
    const t = await lab();
    await t.core.spotify.saveSettings(
      CH,
      { viewer_cooldown_seconds: 0 },
      'test',
    );
    await t.sync();
    await t.redeem(1, 'a');
    await t.studio('queued', track(1));
    await t.redeem(1, 'b');
    await t.studio('queued', track(2));
    await t.redeem(1, 'c');
    expect((await t.replies())[2]).toBe(
      '@Viewer1 → La limite de demandes en attente est atteinte.',
    );
    await t.sync(t.playing(track(1)));
    await t.redeem(1, 'd');
    expect((await t.requests()).at(-1)!.state).toBe('RECEIVED');
  });

  it('an uncertain addition: never retried, never refunded; settled by hand from Studio', async () => {
    const t = await lab({ managed: true });
    await t.sync();
    const out = await t.redeem(1, 'x');
    await t.studio('unknown', track(1));
    expect((await t.requests())[0]).toMatchObject({
      state: 'UNKNOWN',
      reason: 'QUEUE_RESULT_UNKNOWN',
      twitch_status: null,
    });
    expect(await t.replies()).toEqual([
      '@Viewer1 → Le résultat de l’ajout à la file est inconnu ; aucune nouvelle tentative automatique.',
    ]);
    expect(await t.actions()).toEqual([]);
    expect((await t.cp.state(CH)).recent[0]!.results[0]).toMatchObject({
      status: 'unknown',
    });
    const id = (await t.requests())[0]!.request_id;
    await t.spotify.settle(CH, id, 'refund');
    expect(await t.actions()).toEqual([
      {
        kind: 'redemption_status',
        payload: expect.objectContaining({
          status: 'CANCELED',
          redemption_id: out.redemption.redemption_id,
        }),
        status: 'queued',
      },
    ]);
    await expect(t.spotify.settle(CH, id, 'keep')).rejects.toMatchObject({
      code: 'already_settled',
    });
    // « Garder »: nothing sent to Twitch (the redemption stays PENDING), settled once.
    await t.redeem(2, 'y');
    await t.studio('unknown', track(2));
    const kept = (await t.requests())[1]!.request_id;
    await t.spotify.settle(CH, kept, 'keep');
    expect((await t.requests())[1]).toMatchObject({ twitch_status: 'kept' });
    expect(await t.actions()).toHaveLength(1);
    await expect(t.spotify.settle(CH, kept, 'refund')).rejects.toMatchObject({
      code: 'already_settled',
    });
    expect((await t.spotify.state(CH)).to_verify).toEqual([]);
  });

  it('a redelivered redemption creates nothing more', async () => {
    const t = await lab();
    await t.sync();
    const e: CpRedemptionInput = {
      channel_id: CH,
      source: 'twitch',
      redemption_id: randomUUID(),
      reward: {
        id: REWARD,
        title: 'Choisi la prochaine musique !',
        cost: 1000,
      },
      user: viewer(1),
      user_input: 'x',
      twitch_status: 'unfulfilled',
      redeemed_at: t.core.clock.now().toISOString(),
    };
    await t.cp.receive(e);
    await t.cp.receive(e);
    expect(await t.requests()).toHaveLength(1);
    expect((await t.sync()).jobs).toHaveLength(1);
  });

  it('a late redemption (after an outage) is refused and refunded, never searched', async () => {
    const t = await lab({ managed: true });
    await t.sync();
    await t.redeem(1, 'x', {
      redeemed_at: new Date(
        t.core.clock.now().getTime() - 10 * 60_000,
      ).toISOString(),
    });
    expect((await t.requests())[0]).toMatchObject({
      state: 'FAILED',
      reason: 'LATE',
      twitch_status: 'cancel_requested',
    });
    expect((await t.sync()).jobs).toEqual([]);
  });
});

describe('Spotify V2 — refunds on Twitch (only a reward created by Raptoru)', () => {
  it('a reward Raptoru created: refused → CANCELED once (points back, « remboursée » said); queued → nothing yet', async () => {
    const t = await lab({ managed: true });
    await t.sync();
    await t.redeem(1, 'a');
    await t.studio('queued', track(1));
    t.core.clock.advance(60_000);
    await t.sync();
    await t.redeem(1, 'b');
    expect((await t.replies())[1]).toBe(
      '@Viewer1 → attends encore 9 min avant une nouvelle demande ; récompense remboursée.',
    );
    const a = await t.actions();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      kind: 'redemption_status',
      payload: { status: 'CANCELED' },
    });
  });

  it('accepted, queued, played, interrupted, skipped: the redemption stays PENDING — never FULFILLED, never refunded', async () => {
    const t = await lab({ managed: true });
    await t.core.spotify.saveSettings(
      CH,
      { viewer_cooldown_seconds: 0, max_pending_per_viewer: 5 },
      'test',
    );
    await t.sync();
    for (let i = 1; i <= 3; i++) {
      await t.redeem(i, `x${i}`);
      await t.studio('queued', track(i));
    }
    // 1 plays to its end; 2 starts, then is interrupted by 3; 3 is skipped by a moderator.
    await t.sync(t.playing(track(1), 1_000));
    t.core.clock.advance(198_000);
    await t.sync(t.playing(track(1), 197_000));
    t.core.clock.advance(4_000);
    await t.sync(t.playing(track(2), 1_000));
    t.core.clock.advance(30_000);
    await t.sync(t.playing(track(3), 1_000));
    await t.say(50, '!songskip', 'moderator');
    await t.runJob('skip', { outcome: 'skipped', skipped_track: track(3) });
    expect(
      (await t.requests()).map((r) => [r.state, r.reason, r.twitch_status]),
    ).toEqual([
      ['PLAYED', 'PLAYED', null],
      ['UNKNOWN', 'INTERRUPTED', null],
      ['SKIPPED', 'SKIPPED', null],
    ]);
    expect(await t.actions()).toEqual([]);
    // A request that played (even interrupted) is not « à vérifier » and cannot be refunded from Studio.
    expect((await t.spotify.state(CH)).to_verify).toEqual([]);
    const interrupted = (await t.requests())[1]!.request_id;
    await expect(
      t.spotify.settle(CH, interrupted, 'refund'),
    ).rejects.toMatchObject({ code: 'not_uncertain' });
    expect(await t.actions()).toEqual([]);
  });

  it('the bot runs each action once: claim, report; an unreported claim is « unknown », never replayed', async () => {
    const t = await lab({ managed: true });
    await t.sync();
    await t.redeem(1, 'https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa');
    const first = await t.core.cpTwitch.claim(CH);
    expect(first.action).toMatchObject({
      kind: 'redemption_status',
      status: 'CANCELED',
      reward_id: REWARD,
    });
    expect((await t.core.cpTwitch.claim(CH)).action).toBeNull();
    await t.core.cpTwitch.report(CH, first.action!.action_id, {
      attempt_id: first.action!.attempt_id,
      outcome: 'done',
      http_status: 200,
    });
    expect((await t.actions())[0]).toMatchObject({ status: 'done' });
    // A second one, never reported.
    await t.redeem(2, '');
    const second = await t.core.cpTwitch.claim(CH);
    t.core.clock.advance(31_000);
    expect((await t.core.cpTwitch.claim(CH)).action).toBeNull();
    expect((await t.actions())[1]).toMatchObject({ status: 'unknown' });
    await expect(
      t.core.cpTwitch.report(CH, second.action!.action_id, {
        attempt_id: randomUUID(),
        outcome: 'done',
      }),
    ).rejects.toMatchObject({ code: 'stale_attempt' });
  });

  it("creating Raptoru's reward: one at a time, run by the bot, the new reward recorded as managed", async () => {
    const t = await lab();
    await t.core.cpTwitch.createReward(CH, {
      title: 'Choisi la prochaine musique !',
      cost: 1000,
      prompt: 'Titre + artiste',
      is_user_input_required: true,
    });
    await expect(
      t.core.cpTwitch.createReward(CH, {
        title: 'x',
        cost: 1,
        prompt: '',
        is_user_input_required: false,
      }),
    ).rejects.toMatchObject({ code: 'reward_create_in_progress' });
    const { action } = await t.core.cpTwitch.claim(CH);
    expect(action).toMatchObject({
      kind: 'reward_create',
      reward: {
        title: 'Choisi la prochaine musique !',
        cost: 1000,
        is_user_input_required: true,
      },
    });
    await t.core.cpTwitch.report(CH, action!.action_id, {
      attempt_id: action!.attempt_id,
      outcome: 'done',
      reward_id: 'new-reward',
    });
    const r = await t.core.db.query<{
      managed_by_raptoru: boolean;
      title: string;
    }>(
      `select managed_by_raptoru, title from cp_rewards where reward_id = 'new-reward'`,
    );
    expect(r[0]).toEqual({
      managed_by_raptoru: true,
      title: 'Choisi la prochaine musique !',
    });
  });
});

describe('Spotify V2 — what Spotify plays (historical scheduler rules)', () => {
  it('PLAYING when its track plays; PLAYED when the change comes within 5 s of the end; interrupted otherwise', async () => {
    const t = await lab();
    await t.core.spotify.saveSettings(
      CH,
      { viewer_cooldown_seconds: 0 },
      'test',
    );
    await t.sync();
    await t.redeem(1, 'a');
    await t.studio('queued', track(1));
    await t.redeem(2, 'b');
    await t.studio('queued', track(2));
    await t.sync(t.playing(track(1), 2_000));
    expect((await t.sync()).current_request_id).toBe(
      (await t.requests())[0]!.request_id,
    );
    await t.sync(t.playing(track(1), 100_000));
    await t.sync(t.playing(track(2), 500)); // track 1 left at 100 s of 200: interrupted by another request
    const rows = await t.requests();
    expect(rows.map((r) => [r.state, r.reason])).toEqual([
      ['UNKNOWN', 'INTERRUPTED'],
      ['PLAYING', 'PLAYING'],
    ]);
    await t.sync(t.playing(track(8), 500)); // a track outside the requests
    expect((await t.requests())[1]).toMatchObject({
      state: 'UNKNOWN',
      reason: 'INTERRUPTED_EXTERNAL',
    });
  });

  it('the same track twice: FIFO (the first request plays first, then the second)', async () => {
    const t = await lab();
    await t.core.spotify.saveSettings(
      CH,
      { viewer_cooldown_seconds: 0 },
      'test',
    );
    await t.sync();
    await t.redeem(1, 'a');
    await t.studio('queued', track(1));
    await t.redeem(2, 'a encore');
    await t.studio('queued', track(1));
    const [first, second] = await t.requests();
    await t.sync(t.playing(track(1), 1_000));
    expect((await t.sync()).current_request_id).toBe(first!.request_id);
    await t.sync(t.playing(track(1), 198_000));
    await t.sync(t.playing(track(1), 1_000)); // restarted: the next occurrence
    expect((await t.requests()).map((r) => r.state)).toEqual([
      'PLAYED',
      'PLAYING',
    ]);
    expect((await t.sync()).current_request_id).toBe(second!.request_id);
  });

  it('paused, then the same occurrence resumes after a gap without any track: still the same request', async () => {
    const t = await lab();
    await t.sync();
    await t.redeem(1, 'a');
    await t.studio('queued', track(1));
    await t.sync(t.playing(track(1), 30_000));
    await t.sync(t.playing(null));
    await t.sync(t.playing(track(1), 31_000));
    expect((await t.requests())[0]).toMatchObject({ state: 'PLAYING' });
  });
});

describe('Spotify V2 — chat commands (historical texts)', () => {
  async function queueOf(t: Awaited<ReturnType<typeof lab>>, n: number) {
    await t.core.spotify.saveSettings(
      CH,
      { viewer_cooldown_seconds: 0, max_pending_per_viewer: 5 },
      'test',
    );
    await t.sync();
    for (let i = 1; i <= n; i++) {
      await t.redeem(i <= 2 ? 1 : i, `x${i}`);
      await t.studio('queued', track(i));
    }
  }

  it("!songqueue: the next 3 and +N; !mysong: the position of one's next request", async () => {
    const t = await lab();
    await queueOf(t, 5);
    await t.say(1, '!songqueue');
    await t.say(1, '!mysong');
    await t.say(7, '!mysong');
    await t.say(1, '!songqueue maintenant'); // strict syntax: not a command
    const r = await t.replies();
    expect(r.slice(-3)).toEqual([
      '🎶 À suivre : #1 Titre 1 — @viewer1 • #2 Titre 2 — @viewer1 • #3 Titre 3 — @viewer3 • +2',
      '🎵 @Viewer1, ta prochaine demande Titre 1 — Artiste 1 est #1 dans la file. Tu as 2 demandes en attente.',
      "🎵 @Viewer7, tu n'as aucune musique en attente.",
    ]);
    await t.sync(t.playing(track(1)));
    await t.say(1, '!mysong');
    expect((await t.replies()).at(-1)).toBe(
      '🎵 @Viewer1, ta musique est en cours : Titre 1 — Artiste 1',
    );
  });

  it('!song: one playback read by Studio; « demandé par » only for the request Core attributes', async () => {
    const t = await lab();
    await queueOf(t, 1);
    await t.sync(t.playing(track(1)));
    await t.say(5, '!song');
    await t.runJob('read_playback', { playback: t.playing(track(1), 5_000) });
    await t.say(5, '!song');
    await t.runJob('read_playback', {
      playback: t.playing(track(9, 'Autre', ['Quelqu’un'])),
    });
    await t.say(5, '!song');
    await t.runJob('read_playback', { playback: null });
    expect((await t.replies()).slice(-3)).toEqual([
      '🎵 En cours : Titre 1 — Artiste 1 • demandé par @viewer1',
      '🎵 En cours : Autre — Quelqu’un',
      '🎵 Aucune musique en cours.',
    ]);
  });

  it("!songcancel: the next request canceled, refunded, left in Spotify's queue to be skipped when it plays", async () => {
    const t = await lab({ managed: true });
    await queueOf(t, 2);
    await t.say(1, '!songcancel');
    expect((await t.replies()).at(-1)).toBe(
      '🎵 @Viewer1, ta demande "Titre 1 — Artiste 1" est annulée et remboursée. Il t’en reste 1.',
    );
    const ans = await t.sync();
    expect(ans.queue.find((q) => q.auto_skip)).toMatchObject({
      track_uri: track(1).uri,
      state: 'CANCELED',
    });
    // Spotify plays it: Studio skips it and reports; the tombstone is consumed (never a second skip).
    const tomb = ans.queue.find((q) => q.auto_skip)!;
    await t.sync(t.playing(track(1), 300));
    expect((await t.sync()).current_request_id).toBeNull();
    await t.spotify.autoSkip(CH, {
      request_id: tomb.request_id,
      result: 'SKIPPED',
      at: t.core.clock.now().toISOString(),
    });
    expect((await t.sync()).queue.find((q) => q.auto_skip)).toBeUndefined();
    await t.say(1, '!songcancel');
    await t.say(1, '!songcancel');
    expect((await t.replies()).slice(-2)).toEqual([
      '🎵 @Viewer1, ta demande "Titre 2 — Artiste 2" est annulée et remboursée.',
      '🎵 @Viewer1, cette demande est déjà annulée.',
    ]);
    await t.say(4, '!songcancel');
    expect((await t.replies()).at(-1)).toBe(
      '🎵 @Viewer4, tu n’as aucune demande annulable.',
    );
  });

  it('!songcancel / !songremove refund only their own request, once; the others stay PENDING', async () => {
    const t = await lab({ managed: true });
    await queueOf(t, 4); // viewer1: 1, 2 ; viewer3: 3 ; viewer4: 4
    const red = async () =>
      Object.fromEntries(
        (
          await t.core.db.query<{ request_id: string; redemption_id: string }>(
            'select request_id, redemption_id from spotify_requests where channel_id = $1',
            [CH],
          )
        ).map((r) => [r.request_id, r.redemption_id]),
      );
    const byId = await red();
    const refunded = async () =>
      (await t.actions()).map((a) => a.payload.redemption_id);
    const [r1, r2, r3, r4] = (await t.requests()).map((r) => r.request_id);
    // viewer1 cancels their NEXT request (1), not request 2.
    await t.say(1, '!songcancel');
    expect(await refunded()).toEqual([byId[r1!]]);
    // A moderator removes viewer4's request.
    await t.say(50, '!songremove @viewer4', 'moderator');
    expect(await refunded()).toEqual([byId[r1!], byId[r4!]]);
    // Repeated commands never refund twice; the other requests are untouched.
    await t.say(50, '!songremove @viewer4', 'moderator');
    expect(await refunded()).toEqual([byId[r1!], byId[r4!]]);
    const after = await t.requests();
    expect(after.map((r) => [r.state, r.twitch_status])).toEqual([
      ['CANCELED', 'cancel_requested'],
      ['QUEUED', null],
      ['QUEUED', null],
      ['REMOVED_BY_MOD', 'cancel_requested'],
    ]);
    // viewer1's next is now request 2: cancelling it refunds request 2 only.
    await t.say(1, '!songcancel');
    expect(await refunded()).toEqual([byId[r1!], byId[r4!], byId[r2!]]);
    expect((await t.requests())[2]).toMatchObject({
      request_id: r3,
      twitch_status: null,
    });
  });

  it("!songcancel on one's song playing: within 10 s → canceled and skipped at once; later → too late", async () => {
    const t = await lab({ managed: true });
    await queueOf(t, 1);
    await t.sync(t.playing(track(1), 4_000));
    await t.say(1, '!songcancel');
    expect((await t.replies()).at(-1)).toBe(
      '🎵 @Viewer1, ta demande "Titre 1 — Artiste 1" est annulée et remboursée.',
    );
    expect(await t.actions()).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ status: 'CANCELED' }),
      }),
    ]);
    const skip = (await t.sync()).jobs.find((j) => j.kind === 'skip');
    expect(skip).toMatchObject({
      request_id: (await t.requests())[0]!.request_id,
    });

    const u = await lab();
    await queueOf(u, 1);
    await u.sync(u.playing(track(1), 12_000));
    await u.say(1, '!songcancel');
    expect((await u.replies()).at(-1)).toBe(
      '🎵 @Viewer1, trop tard pour annuler cette demande : la lecture a déjà commencée.',
    );
    expect(await u.actions()).toEqual([]);
  });

  it('!songremove (moderators): by position, by viewer, the one playing refused, usage; a viewer is ignored', async () => {
    const t = await lab();
    await queueOf(t, 4);
    await t.sync(t.playing(track(1)));
    await t.say(2, '!songremove 2', 'viewer'); // not a moderator: nothing
    await t.say(50, '!songremove 2', 'moderator');
    await t.say(50, '!songremove @Viewer4', 'moderator');
    await t.say(50, '!songremove @viewer1', 'moderator'); // viewer1's next is playing
    await t.say(50, '!songremove 9', 'moderator');
    await t.say(50, '!songremove', 'moderator');
    expect((await t.replies()).slice(-5)).toEqual([
      '🗑️ Demande #2 supprimée : Titre 3 — Artiste 3 (@Viewer3)',
      '🗑️ Demande de @Viewer4 supprimée : Titre 4 — Artiste 4',
      '🎵 Cette demande est déjà en lecture. Utilise !songskip.',
      '🗑️ Aucune demande à la position #9.',
      '🗑️ Utilisation : !songremove <position> ou !songremove @viewer.',
    ]);
    expect(
      (await t.requests())
        .filter((r) => r.state === 'REMOVED_BY_MOD')
        .map((r) => r.auto_skip),
    ).toEqual([true, true]);
  });

  it('!songskip (moderators): Studio skips; the request playing becomes SKIPPED with the moderator; historical text', async () => {
    const t = await lab();
    await queueOf(t, 1);
    await t.sync(t.playing(track(1)));
    await t.say(3, '!songskip'); // a viewer: ignored
    await t.say(50, '!songskip', 'moderator');
    await t.runJob('skip', { outcome: 'skipped', skipped_track: track(1) });
    expect((await t.requests())[0]).toMatchObject({
      state: 'SKIPPED',
      skipped_by: 'Viewer50',
    });
    expect((await t.replies()).at(-1)).toBe(
      '⏭️ Musique passée : Titre 1 — Artiste 1 (@viewer1)',
    );
    // A track outside the requests.
    await t.sync(t.playing(track(9)));
    await t.say(50, '!songskip', 'moderator');
    await t.runJob('skip', { outcome: 'unknown' });
    expect((await t.replies()).at(-1)).toBe(
      '@Viewer50 → Le résultat du skip est inconnu ; aucune nouvelle tentative automatique.',
    );
  });

  it('the « Skip la musique » reward: Studio skips; its historical text', async () => {
    const t = await lab();
    await t.sync(t.playing(track(9)));
    await t.cp.receive({
      channel_id: CH,
      source: 'twitch',
      redemption_id: randomUUID(),
      reward: { id: SKIP_REWARD, title: 'Skip la musique', cost: 2000 },
      user: viewer(6),
      twitch_status: 'unfulfilled',
      redeemed_at: t.core.clock.now().toISOString(),
    });
    await t.runJob('skip', { outcome: 'skipped' });
    expect((await t.replies()).at(-1)).toBe(
      '@Viewer6 → La musique en cours a été passée !',
    );
    expect((await t.cp.state(CH)).recent[0]!.results[0]).toMatchObject({
      status: 'done',
    });
  });

  it('the « Skip la musique » reward of Raptoru: done → stays PENDING; failed for sure → CANCELED once; unknown → PENDING', async () => {
    const t = await lab({ managed: true });
    await t.sync(t.playing(track(9)));
    const skipReward = (n: number) =>
      t.cp.receive({
        channel_id: CH,
        source: 'twitch',
        redemption_id: `skip-${n}`,
        reward: { id: SKIP_REWARD, title: 'Skip la musique', cost: 2000 },
        user: viewer(n),
        twitch_status: 'unfulfilled',
        redeemed_at: t.core.clock.now().toISOString(),
      });
    await skipReward(1);
    await t.runJob('skip', { outcome: 'skipped' });
    expect(await t.actions()).toEqual([]);
    await skipReward(2);
    await t.runJob('skip', { outcome: 'unknown' });
    expect(await t.actions()).toEqual([]);
    await skipReward(3);
    await t.runJob('skip', { outcome: 'failed', reason: 'NO_DEVICE' });
    expect(await t.actions()).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          status: 'CANCELED',
          redemption_id: 'skip-3',
        }),
      }),
    ]);
  });
});

describe('Spotify V2 — Studio leases and absence', () => {
  it('a job Studio took but never reported: UNKNOWN (it may have queued), never handed out again', async () => {
    const t = await lab();
    await t.sync();
    await t.redeem(1, 'a');
    const job = (await t.sync()).jobs[0]!;
    await t.spotify.startJob(CH, job.job_id, randomUUID());
    t.core.clock.advance(31_000);
    await t.spotify.tickAll();
    expect((await t.requests())[0]).toMatchObject({
      state: 'UNKNOWN',
      reason: 'STUDIO_LOST',
    });
    expect((await t.sync()).jobs).toEqual([]);
  });

  it('a request Studio never took (Studio gone): refused and refunded after 20 s', async () => {
    const t = await lab({ managed: true });
    await t.sync();
    await t.redeem(1, 'a');
    t.core.clock.advance(21_000);
    await t.spotify.tickAll();
    expect((await t.requests())[0]).toMatchObject({
      state: 'FAILED',
      reason: 'STUDIO_UNAVAILABLE',
      twitch_status: 'cancel_requested',
    });
    expect((await t.replies()).at(-1)).toBe(
      '@Viewer1 → Spotify est momentanément indisponible.',
    );
  });

  it('Spotify limited (429) or to reconnect: refused at once with the historical texts', async () => {
    const t = await lab();
    await t.sync(undefined, {
      ...OK,
      limited_until: new Date(
        t.core.clock.now().getTime() + 3_600_000,
      ).toISOString(),
    });
    await t.redeem(1, 'a');
    await t.sync(undefined, { ...OK, auth: 'needs_reauth' });
    await t.redeem(2, 'b');
    expect(await t.replies()).toEqual([
      '@Viewer1 → Spotify est momentanément indisponible.',
      '@Viewer2 → Spotify nécessite une nouvelle autorisation.',
    ]);
  });
});

describe("Spotify V2 — per-viewer exceptions, chat origin, Raptoru's reward", () => {
  it("a viewer's exception replaces the global limits for them only; back to the global values when removed", async () => {
    const t = await lab();
    await t.sync();
    await t.spotify.saveOverride(
      CH,
      {
        viewer_login: 'viewer1',
        max_pending_per_viewer: 3,
        viewer_cooldown_seconds: 0,
      },
      'test',
    );
    // viewer1: no cooldown, 3 pending; viewer2 keeps the global 10 min cooldown.
    for (const input of ['a', 'b', 'c', 'd']) {
      await t.redeem(1, input);
      if (input !== 'd')
        await t.studio('queued', track(input.charCodeAt(0) - 96));
    }
    await t.redeem(2, 'x');
    await t.studio('queued', track(9));
    await t.redeem(2, 'y');
    expect((await t.requests()).map((r) => [r.viewer_id, r.state])).toEqual([
      ['9001', 'QUEUED'],
      ['9001', 'QUEUED'],
      ['9001', 'QUEUED'],
      ['9001', 'VIEWER_LIMIT'],
      ['9002', 'QUEUED'],
      ['9002', 'VIEWER_COOLDOWN'],
    ]);
    // Only the cooldown overridden: the pending limit follows the global 2.
    expect(
      await t.spotify.saveOverride(
        CH,
        {
          viewer_login: 'viewer1',
          max_pending_per_viewer: null,
          viewer_cooldown_seconds: 0,
        },
        'test',
      ),
    ).toEqual([
      expect.objectContaining({
        viewer_login: 'viewer1',
        max_pending_per_viewer: null,
        viewer_cooldown_seconds: 0,
      }),
    ]);
    // Both null: the exception is removed.
    expect(
      await t.spotify.saveOverride(
        CH,
        {
          viewer_login: 'viewer1',
          max_pending_per_viewer: null,
          viewer_cooldown_seconds: null,
        },
        'test',
      ),
    ).toEqual([]);
    await t.redeem(1, 'e');
    expect((await t.requests()).at(-1)).toMatchObject({
      state: 'VIEWER_COOLDOWN',
    });
    expect((await t.spotify.state(CH)).overrides).toEqual([]);
  });

  it('the override route: login normalized (@, case), invalid values refused', async () => {
    const t = await lab();
    const route = spotifyRoutes(t.spotify, t.core.cpTwitch).find((r) =>
      String(r.pattern).includes('overrides'),
    )!;
    const out = (await route.handle({
      params: [CH],
      body: {
        viewer_login: '@Viewer7',
        max_pending_per_viewer: 5,
        viewer_cooldown_seconds: null,
      },
    } as never)) as { overrides: { viewer_login: string }[] };
    expect(out.overrides.map((o) => o.viewer_login)).toEqual(['viewer7']);
    await expect(
      route.handle({
        params: [CH],
        body: {
          viewer_login: 'viewer7',
          max_pending_per_viewer: 50,
          viewer_cooldown_seconds: null,
        },
      } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('the music answers have their own origin in the chat queue', async () => {
    const t = await lab();
    await t.sync();
    await t.redeem(1, 'a');
    await t.studio('queued', track(1));
    const origins = await t.core.db.query<{ origin: string }>(
      `select distinct origin from cmd_steps where idempotency_key like 'spotify:%'`,
    );
    expect(origins).toEqual([{ origin: 'music' }]);
  });

  it("Raptoru's reward: price chosen before creation; never a second one once it exists", async () => {
    const t = await lab();
    const route = spotifyRoutes(t.spotify, t.core.cpTwitch).find(
      (r) => String(r.pattern).includes('reward') && r.method === 'POST',
    )!;
    // Default: Antoni's title (unique on the channel: the SAMMI one ends with « ! ») and price.
    await route.handle({
      params: [CH],
      body: { prompt: 'Titre + artiste' },
    } as never);
    expect((await t.actions())[0]).toMatchObject({
      kind: 'reward_create',
      payload: expect.objectContaining({
        title: 'Choisi la prochaine musique',
        cost: 1500,
        is_user_input_required: true,
      }),
    });
    // While it is being created: refused.
    await expect(
      route.handle({ params: [CH], body: { prompt: 'x' } } as never),
    ).rejects.toMatchObject({ status: 409 });
    // Once it exists (managed by Raptoru): refused too.
    await t.core.db.query(
      `update cp_twitch_actions set status = 'done' where channel_id = $1`,
      [CH],
    );
    await t.core.db.query(
      `insert into cp_rewards (channel_id, reward_id, title, cost, source, last_seen_at, managed_by_raptoru)
       values ($1, 'new-song', 'Choisi la prochaine musique', 1500, 'twitch_api', now(), true)`,
      [CH],
    );
    for (const title of [undefined, ' choisi la PROCHAINE musique '])
      await expect(
        route.handle({
          params: [CH],
          body: { prompt: 'x', ...(title ? { title } : {}) },
        } as never),
      ).rejects.toMatchObject({
        status: 409,
        body: { error: 'reward_exists' },
      });
    // Another title (e.g. a future skip reward) stays possible; a title over Twitch's 45 characters is refused.
    await route.handle({
      params: [CH],
      body: { prompt: 'x', title: 'Autre récompense', cost: 2000 },
    } as never);
    expect((await t.actions()).at(-1)).toMatchObject({
      payload: expect.objectContaining({
        title: 'Autre récompense',
        cost: 2000,
      }),
    });
    await expect(
      route.handle({
        params: [CH],
        body: { prompt: 'x', title: 'x'.repeat(46) },
      } as never),
    ).rejects.toMatchObject({ status: 400 });
  });
});
