import { randomUUID } from 'node:crypto';
import {
  SpotifyLiveNow,
  type SpotifyPlayback,
  type SpotifyStudioStatus,
  type SpotifyTrack,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { SpotifyService } from '../src/spotify/service.js';
import { classifyEnd } from '../src/spotify/live-music.js';
import { setup } from './helpers.js';

// Music Hub — the live track (Windows SMTC via Studio) and the stream's music history (docs/music/SMTC_STUDIO.md).
// Display only: these tests also prove nothing here decides a request, and a requester is shown only through the exact
// uri of the occurrence and Core's own attribution — never a title.

const CH = '83603689';
const ID = (n: number) => `LIVEMUSIC${String(n).padStart(13, '0')}`;
const sp = (n: number, title = `Titre ${n}`): SpotifyTrack => ({
  id: ID(n),
  uri: `spotify:track:${ID(n)}`,
  title,
  artists: [`Artiste ${n}`],
  duration_ms: 200_000,
});
const OK: SpotifyStudioStatus = {
  auth: 'ok',
  limited_until: null,
  quota_exceeded: false,
  device: { name: 'PC', type: 'Computer' },
  calls_last_minute: 1,
};

async function studio(o: { live?: boolean } = {}) {
  const core = await setup();
  core.clock.set(new Date('2026-11-09T20:00:00Z'));
  const { spotify } = core;
  await spotify.saveSettings(CH, { enabled: true }, 'test');
  await spotify.sync(CH, { status: OK });
  if (o.live !== false)
    await core.streams.online({
      streamId: 'live-1',
      startedAt: core.clock.now(),
    });
  let seq = 0;
  let boot = 'boot-aaaa-0001';
  let bootAt = '2026-11-09T19:00:00.000Z';
  /** One message of Studio (its boot, the next seq). */
  const say = (over: Partial<SpotifyLiveNow> & { gen: number }) =>
    spotify.liveNow(
      CH,
      SpotifyLiveNow.parse({
        boot,
        boot_at: bootAt,
        seq: ++seq,
        state: 'playing',
        track: {
          title: `Titre ${over.gen}`,
          artists: [`Artiste ${over.gen}`],
          album: 'Album',
          duration_ms: 200_000,
        },
        position_ms: 0,
        link: null,
        ended: null,
        ...over,
      }),
    );
  const track = (title: string, duration_ms = 200_000) => ({
    title,
    artists: ['Artiste'],
    album: 'Album',
    duration_ms,
  });
  const restart = (b: string, at: string) => {
    boot = b;
    bootAt = at;
    seq = 0;
  };
  const history = (
    before: string | null = null,
    viewerId: string | null = null,
  ) => spotify.extensionHistory(CH, viewerId, before);
  const wait = (ms: number) => core.clock.advance(ms);
  const playing = (
    t: SpotifyTrack | null,
    progress_ms = 1_000,
  ): SpotifyPlayback => ({
    observed_at: core.clock.now().toISOString(),
    track: t,
    progress_ms: t ? progress_ms : null,
    is_playing: !!t,
  });
  /** A request of the reward (exact link), queued by Studio, then seen playing by Core (its own attribution). */
  const request = async (n: number, t: SpotifyTrack) => {
    await spotify.admit({
      channel_id: CH,
      source: 'simulation',
      source_ref: `simulation:test-${randomUUID()}`,
      reward_id: 'lab-simulated',
      redemption_id: `r-${randomUUID()}`,
      viewer: { id: String(9300 + n), login: `fan${n}`, name: `Fan${n}` },
      user_input: t.uri,
    });
    const a = await spotify.sync(CH, { status: OK });
    const job = a.jobs.find((j) => j.kind === 'song_request')!;
    const attempt_id = randomUUID();
    await spotify.startJob(CH, job.job_id, attempt_id);
    await spotify.reportJob(CH, job.job_id, {
      kind: 'song_request',
      attempt_id,
      outcome: 'queued',
      track: t,
      confirmation: 'http_204',
    });
  };
  return {
    core,
    spotify,
    say,
    track,
    restart,
    history,
    wait,
    playing,
    request,
  };
}

describe('the end of an occurrence (display only)', () => {
  it('natural within 15 s of the end, interrupted earlier, unknown without a change or a position', () => {
    const d = 200_000;
    expect(
      classifyEnd({ duration_ms: d, position_ms: 199_000, cause: 'change' }),
    ).toBe('natural');
    expect(
      classifyEnd({ duration_ms: d, position_ms: 186_000, cause: 'change' }),
    ).toBe('natural');
    expect(
      classifyEnd({ duration_ms: d, position_ms: 120_000, cause: 'change' }),
    ).toBe('interrupted');
    expect(
      classifyEnd({ duration_ms: d, position_ms: 30_000, cause: 'replay' }),
    ).toBe('interrupted');
    for (const cause of ['lost', 'off', 'restart', 'live_end', 'gap'] as const)
      expect(classifyEnd({ duration_ms: d, position_ms: 30_000, cause })).toBe(
        'unknown',
      );
    expect(
      classifyEnd({ duration_ms: d, position_ms: null, cause: 'change' }),
    ).toBe('unknown');
    expect(
      classifyEnd({ duration_ms: null, position_ms: 30_000, cause: 'change' }),
    ).toBe('unknown');
  });
});

describe('the stream music history', () => {
  it('records nothing outside a live; the live track is still shown', async () => {
    const s = await studio({ live: false });
    await s.say({ gen: 1 });
    s.wait(60_000);
    await s.say({
      gen: 2,
      ended: { gen: 1, position_ms: 60_000, playing: true, cause: 'change' },
    });
    expect((await s.history()).items).toEqual([]);
    const st = await s.spotify.extensionState(CH, null, false);
    expect(st.now_playing).toMatchObject({
      title: 'Titre 2',
      kind: 'broadcaster',
      source: 'live',
    });
  });

  it('one entry per occurrence: duplicates and older messages never add one; natural end and interruption', async () => {
    const s = await s0();
    await s.say({ gen: 1 });
    s.wait(195_000);
    await s.say({
      gen: 2,
      ended: { gen: 1, position_ms: 195_000, playing: true, cause: 'change' },
    });
    // Studio's same message again (a retry) and an older one: refused, nothing written.
    expect(
      await s.spotify.liveNow(
        CH,
        SpotifyLiveNow.parse({
          boot: 'boot-aaaa-0001',
          boot_at: '2026-11-09T19:00:00.000Z',
          seq: 1,
          gen: 1,
          state: 'playing',
          track: s.track('Titre 1'),
          position_ms: 0,
          link: null,
          ended: null,
        }),
      ),
    ).toEqual({ accepted: false });
    s.wait(40_000);
    await s.say({
      gen: 3,
      ended: { gen: 2, position_ms: 40_000, playing: true, cause: 'change' },
    });
    const h = await s.history();
    expect(h.live).toBe(true);
    expect(h.items.map((i) => [i.title, i.end])).toEqual([
      ['Titre 3', null], // playing now
      ['Titre 2', 'interrupted'], // probable — never « skipped » without a command
      ['Titre 1', 'natural'],
    ]);
    expect(
      h.items.every((i) => i.kind === 'track' && i.requested_by === null),
    ).toBe(true);
  });

  async function s0() {
    return studio();
  }

  it('the same track played again is a new entry; a glimpse (< 5 s) is never listed', async () => {
    const s = await studio();
    await s.say({ gen: 1, track: s.track('Encore') });
    s.wait(80_000);
    await s.say({
      gen: 2,
      track: s.track('Encore'),
      ended: { gen: 1, position_ms: 80_000, playing: true, cause: 'replay' },
    });
    s.wait(3_000);
    await s.say({
      gen: 3,
      track: s.track('Survol'),
      ended: { gen: 2, position_ms: 3_000, playing: true, cause: 'change' },
    });
    s.wait(2_000);
    await s.say({
      gen: 4,
      track: s.track('Après'),
      ended: { gen: 3, position_ms: 2_000, playing: true, cause: 'change' },
    });
    const titles = (await s.history()).items.map((i) => i.title);
    // « Encore » twice? The second one lasted 3 s: a glimpse — so once, and « Survol » (2 s) neither.
    expect(titles).toEqual(['Après', 'Encore']);
    s.wait(60_000);
    await s.say({
      gen: 5,
      track: s.track('Encore'),
      ended: { gen: 4, position_ms: 60_000, playing: true, cause: 'change' },
    });
    s.wait(60_000);
    await s.say({
      gen: 6,
      track: s.track('Fin'),
      ended: { gen: 5, position_ms: 60_000, playing: true, cause: 'change' },
    });
    expect((await s.history()).items.map((i) => i.title)).toEqual([
      'Fin',
      'Encore',
      'Après',
      'Encore',
    ]);
  });

  it('a pause is not an end; a track opened paused is not recorded until it plays; listened time counts the playing only', async () => {
    const s = await studio();
    await s.say({ gen: 1, state: 'paused', position_ms: 42_000 });
    expect((await s.history()).items).toEqual([]);
    s.wait(10_000);
    await s.say({ gen: 1, state: 'playing', position_ms: 42_000 });
    s.wait(20_000);
    await s.say({ gen: 1, state: 'paused', position_ms: 62_000 });
    s.wait(600_000); // a long pause
    await s.say({ gen: 1, state: 'playing', position_ms: 62_000 });
    s.wait(10_000);
    await s.say({
      gen: 2,
      ended: { gen: 1, position_ms: 72_000, playing: true, cause: 'change' },
    });
    const [now, first] = (await s.history()).items;
    expect(now!.end).toBeNull();
    expect(first).toMatchObject({
      title: 'Titre 1',
      end: 'interrupted',
      listened_ms: 30_000,
    });
  });

  it('Spotify closed, Studio stopped, or the live over: the end is unknown, never a skip', async () => {
    const s = await studio();
    await s.say({ gen: 1 });
    s.wait(30_000);
    await s.say({
      gen: 1,
      state: 'lost',
      track: null,
      position_ms: null,
      ended: { gen: 1, position_ms: 30_000, playing: true, cause: 'lost' },
    });
    await s.say({ gen: 2 });
    s.wait(30_000);
    await s.say({ gen: 2, state: 'off', track: null, position_ms: null });
    await s.say({ gen: 3 });
    s.wait(30_000);
    await s.core.streams.offline();
    await s.say({ gen: 3, position_ms: 30_000 }); // the heartbeat after the live
    s.wait(60_000);
    await s.say({
      gen: 4,
      ended: { gen: 3, position_ms: 90_000, playing: true, cause: 'change' },
    });
    expect((await s.history()).items.map((i) => [i.title, i.end])).toEqual([
      ['Titre 3', 'unknown'],
      ['Titre 2', 'unknown'],
      ['Titre 1', 'unknown'],
    ]);
  });

  it('a skip command of this exact track is a confirmed skip — before or after the change, linked late too', async () => {
    const s = await studio();
    const link = (n: number) => ({
      uri: sp(n).uri,
      cover_url: 'https://i.scdn.co/image/ab67616d00001e02' + n,
      artists: [`Artiste ${n}`],
    });
    const skip = async (n: number) => {
      await s.spotify.sync(CH, { status: OK }); // Studio seen (Core refuses a skip without it)
      await s.spotify.skip(CH, `skip-${randomUUID()}`, null);
      const a = await s.spotify.sync(CH, { status: OK });
      const job = a.jobs.find((j) => j.kind === 'skip')!;
      const attempt_id = randomUUID();
      await s.spotify.startJob(CH, job.job_id, attempt_id);
      await s.spotify.reportJob(CH, job.job_id, {
        kind: 'skip',
        attempt_id,
        outcome: 'skipped',
        skipped_track: sp(n),
      });
    };
    // 1: linked, skipped, then the change.
    await s.say({ gen: 1, link: link(1) });
    s.wait(40_000);
    await skip(1);
    await s.say({
      gen: 2,
      ended: { gen: 1, position_ms: 40_000, playing: true, cause: 'change' },
    });
    // 2: the change first, the skip's report a moment later.
    await s.say({ gen: 2, link: link(2) });
    s.wait(40_000);
    await s.say({
      gen: 3,
      ended: { gen: 2, position_ms: 40_000, playing: true, cause: 'change' },
    });
    s.wait(1_000);
    await skip(2);
    // 3: skipped before Studio could read its exact track; linked afterwards.
    s.wait(40_000);
    await skip(3);
    await s.say({ gen: 3, link: link(3) });
    await s.say({
      gen: 4,
      ended: { gen: 3, position_ms: 41_000, playing: true, cause: 'change' },
    });
    // 4: a skip of ANOTHER track (not this one): nothing.
    s.wait(40_000);
    await s.say({ gen: 4, link: link(4) });
    await skip(9);
    await s.say({
      gen: 5,
      ended: { gen: 4, position_ms: 40_000, playing: true, cause: 'change' },
    });
    expect((await s.history()).items.map((i) => [i.title, i.end])).toEqual([
      ['Titre 5', null],
      ['Titre 4', 'interrupted'],
      ['Titre 3', 'skipped'],
      ['Titre 2', 'skipped'],
      ['Titre 1', 'skipped'],
    ]);
  });

  it('a request is recognised by its exact uri and Core attribution only — never by its title', async () => {
    const s = await studio();
    await s.request(1, sp(1, 'Même Titre'));
    await s.spotify.sync(CH, {
      status: OK,
      playback: s.playing(sp(1, 'Même Titre'), 1_000),
    });
    // The occurrence of the request (its exact uri).
    await s.say({
      gen: 1,
      track: s.track('Même Titre'),
      position_ms: 1_000,
      link: { uri: sp(1).uri, cover_url: null, artists: ['Artiste 1'] },
    });
    const st = await s.spotify.extensionState(
      CH,
      { id: '9301', login: 'fan1' },
      false,
    );
    expect(st.now_playing).toMatchObject({
      kind: 'request',
      requested_by: 'Fan1',
      own: true,
      title: 'Même Titre',
    });
    s.wait(199_000);
    await s.spotify.sync(CH, {
      status: OK,
      playback: s.playing(sp(2, 'Même Titre'), 500),
    });
    // The same TITLE right after, another track (another uri): the broadcaster's — no requester.
    await s.say({
      gen: 2,
      track: s.track('Même Titre'),
      position_ms: 500,
      link: { uri: sp(2).uri, cover_url: null, artists: ['Autre'] },
      ended: { gen: 1, position_ms: 199_000, playing: true, cause: 'change' },
    });
    const st2 = await s.spotify.extensionState(CH, null, false);
    expect(st2.now_playing).toMatchObject({
      kind: 'broadcaster',
      requested_by: null,
    });
    // Unlinked (Studio could not read the exact track): never a requester either.
    s.wait(60_000);
    await s.say({
      gen: 3,
      track: s.track('Même Titre'),
      ended: { gen: 2, position_ms: 60_000, playing: true, cause: 'change' },
    });
    const h = await s.history(null, '9301');
    expect(
      h.items.map((i) => [i.title, i.kind, i.requested_by, i.own, i.end]),
    ).toEqual([
      ['Même Titre', 'track', null, false, null],
      ['Même Titre', 'track', null, false, 'interrupted'],
      ['Même Titre', 'request', 'Fan1', true, 'natural'], // Core: PLAYED (its own end)
    ]);
    // The request is listed once (carried by its occurrence), not again from the requests.
    expect(h.items.filter((i) => i.kind === 'request')).toHaveLength(1);
  });

  it('the requests Core saw play without any live message (no SMTC) are still listed', async () => {
    const s = await studio();
    await s.request(2, sp(2));
    await s.spotify.sync(CH, { status: OK, playback: s.playing(sp(2), 1_000) });
    s.wait(196_000);
    await s.spotify.sync(CH, {
      status: OK,
      playback: s.playing(sp(2), 197_000), // Core's « played to its end » needs a reading within 5 s of it
    });
    s.wait(3_500);
    await s.spotify.sync(CH, { status: OK, playback: s.playing(sp(3), 500) });
    const h = await s.history();
    expect(h.items).toHaveLength(1);
    expect(h.items[0]).toMatchObject({
      title: 'Titre 2',
      kind: 'request',
      requested_by: 'Fan2',
      end: 'natural',
    });
  });

  it('a Studio restart on the same track continues its entry; on another track the old one ends unknown', async () => {
    const s = await studio();
    await s.say({ gen: 1, position_ms: 10_000 });
    s.wait(30_000);
    s.restart('boot-bbbb-0002', '2026-11-09T20:00:20.000Z');
    // The new Studio's source not heard yet (off / stale): nothing closed.
    await s.say({ gen: 0, state: 'off', track: null, position_ms: null });
    await s.say({ gen: 0, state: 'stale', track: null, position_ms: null });
    await s.say({ gen: 1, position_ms: 40_500 }); // same track, same start (± 20 s)
    s.wait(30_000);
    s.restart('boot-cccc-0003', '2026-11-09T20:01:00.000Z');
    await s.say({ gen: 1, track: s.track('Autre'), position_ms: 5_000 });
    // An older Studio still talking (its boot started before): ignored.
    s.restart('boot-aaaa-0001', '2026-11-09T19:00:00.000Z');
    expect(await s.say({ gen: 9, track: s.track('Fantôme') })).toEqual({
      accepted: false,
    });
    expect((await s.history()).items.map((i) => [i.title, i.end])).toEqual([
      ['Autre', null],
      ['Titre 1', 'unknown'],
    ]);
  });

  it('survives a Core restart (persisted), pages by 20, 30 days at most', async () => {
    const s = await studio();
    for (let g = 1; g <= 25; g++) {
      await s.say({
        gen: g,
        ...(g > 1
          ? {
              ended: {
                gen: g - 1,
                position_ms: 60_000,
                playing: true,
                cause: 'change' as const,
              },
            }
          : {}),
      });
      s.wait(60_000);
    }
    // Another Core process on the same database.
    const again = new SpotifyService(
      s.core.db,
      s.core.clock,
      undefined as never,
    );
    const p1 = await again.extensionHistory(CH, null, null);
    expect(p1.items).toHaveLength(20);
    expect(p1.items[0]!.title).toBe('Titre 25');
    const p2 = await again.extensionHistory(CH, null, p1.next);
    expect(p2.items.map((i) => i.title)).toEqual([
      'Titre 5',
      'Titre 4',
      'Titre 3',
      'Titre 2',
      'Titre 1',
    ]);
    expect(p2.next).toBeNull();
    expect((await again.musicHistory(CH, null)).items).toHaveLength(25);
    s.wait(31 * 86_400_000);
    expect((await again.extensionHistory(CH, null, null)).items).toEqual([]);
  });
});

describe('the history per Daily (decided 09/11: a new Daily = an empty visible history)', () => {
  it('a stream across midnight keeps its history; the next Daily starts empty, the old rows stay stored', async () => {
    const s = await studio(); // live from 21:00 Paris, Daily 2026-11-09
    await s.say({ gen: 1 });
    s.wait(60_000);
    await s.say({
      gen: 2,
      ended: { gen: 1, position_ms: 60_000, playing: true, cause: 'change' },
    });
    // 00:30 Paris, the same live: still the Daily of 09/11.
    s.core.clock.set(new Date('2026-11-09T23:30:00Z'));
    await s.say({
      gen: 3,
      ended: { gen: 2, position_ms: 60_000, playing: true, cause: 'change' },
    });
    let h = await s.history();
    expect(h.daily).toBe('2026-11-09');
    expect(h.items.map((i) => i.title)).toEqual([
      'Titre 3',
      'Titre 2',
      'Titre 1',
    ]);
    // The live ends; the next afternoon after 16:00 Paris: a new Daily, nothing visible.
    s.wait(60_000);
    await s.core.streams.offline();
    await s.say({ gen: 3, position_ms: 120_000 });
    s.core.clock.set(new Date('2026-11-10T15:30:00Z'));
    h = await s.history();
    expect(h.daily).toBe('2026-11-10');
    expect(h.items).toEqual([]);
    // Before 16:00 the previous Daily is still the one shown (its window runs until then).
    s.core.clock.set(new Date('2026-11-10T14:00:00Z'));
    expect((await s.history()).items).toHaveLength(3);
    // A new live of the new Daily: only its own tracks.
    s.core.clock.set(new Date('2026-11-10T18:00:00Z'));
    await s.core.streams.online({
      streamId: 'live-2',
      startedAt: s.core.clock.now(),
    });
    await s.spotify.sync(CH, { status: OK });
    await s.say({ gen: 4, track: s.track('Nouveau Daily') });
    h = await s.history();
    expect(h.items.map((i) => i.title)).toEqual(['Nouveau Daily']);
    const stored = await s.core.db.query(
      `select count(*)::int as n from module_activity where module_id = 'music_history'`,
    );
    expect((stored[0] as { n: number }).n).toBe(4);
  });
});

describe('one play, one line', () => {
  it('an occurrence Studio could not identify and the request Core saw start with it: the request only — never attributed', async () => {
    const s = await studio();
    await s.request(5, sp(5));
    await s.spotify.sync(CH, { status: OK, playback: s.playing(sp(5), 1_000) });
    // Windows announced it, but Studio never read its exact track (no link).
    await s.say({ gen: 1, track: s.track('Titre 5'), position_ms: 1_000 });
    s.wait(196_000);
    await s.spotify.sync(CH, {
      status: OK,
      playback: s.playing(sp(5), 197_000),
    });
    s.wait(3_500);
    await s.spotify.sync(CH, { status: OK, playback: s.playing(sp(6), 500) });
    await s.say({
      gen: 2,
      track: s.track('Autre'),
      position_ms: 500,
      ended: { gen: 1, position_ms: 199_000, playing: true, cause: 'change' },
    });
    const h = await s.history();
    expect(h.items.map((i) => [i.title, i.kind, i.requested_by])).toEqual([
      ['Autre', 'track', null],
      ['Titre 5', 'request', 'Fan5'],
    ]);
    // A track of the broadcaster that merely started near a request (different start): kept.
  });
});

describe('the live track in the extension', () => {
  it('position extrapolated on Core’s clock, frozen in pause, stale flagged, dropped after 90 s of silence', async () => {
    const s = await studio({ live: false });
    await s.say({
      gen: 1,
      position_ms: 20_000,
      link: {
        uri: sp(1).uri,
        cover_url: 'https://i.scdn.co/image/abc',
        artists: ['Exact'],
      },
    });
    s.wait(5_000);
    let np = (await s.spotify.extensionState(CH, null, false)).now_playing!;
    expect(np).toMatchObject({
      progress_ms: 25_000,
      is_playing: true,
      image_url: 'https://i.scdn.co/image/abc',
      artists: ['Exact'],
      stale: false,
    });
    await s.say({ gen: 1, state: 'paused', position_ms: 25_000 });
    s.wait(30_000);
    np = (await s.spotify.extensionState(CH, null, false)).now_playing!;
    expect(np).toMatchObject({ progress_ms: 25_000, is_playing: false });
    await s.say({ gen: 1, state: 'stale', position_ms: 25_000 });
    expect(
      (await s.spotify.extensionState(CH, null, false)).now_playing!.stale,
    ).toBe(true);
    await s.say({ gen: 1, state: 'playing', position_ms: 199_000 });
    s.wait(30_000);
    // Never past its end.
    expect(
      (await s.spotify.extensionState(CH, null, false)).now_playing!
        .progress_ms,
    ).toBe(200_000);
    await s.say({ gen: 1, state: 'lost', track: null, position_ms: null });
    expect(
      (await s.spotify.extensionState(CH, null, false)).now_playing,
    ).toBeNull();
    await s.say({ gen: 2 });
    s.wait(91_000);
    // Studio silent for too long: back to the Web API's reading (none fresh here).
    expect(
      (await s.spotify.extensionState(CH, null, false)).now_playing,
    ).toBeNull();
  });

  it('refuses a message that is not Studio’s shape (an image from elsewhere, a fake uri)', () => {
    const base = {
      boot: 'boot-aaaa-0001',
      boot_at: '2026-11-09T19:00:00.000Z',
      seq: 1,
      gen: 1,
      state: 'playing',
      track: null,
      position_ms: null,
      ended: null,
    };
    expect(
      SpotifyLiveNow.safeParse({
        ...base,
        link: {
          uri: sp(1).uri,
          cover_url: 'https://evil.example/x.png',
          artists: [],
        },
      }).success,
    ).toBe(false);
    expect(
      SpotifyLiveNow.safeParse({
        ...base,
        link: { uri: 'spotify:track:nope', cover_url: null, artists: [] },
      }).success,
    ).toBe(false);
    expect(
      SpotifyLiveNow.safeParse({ ...base, link: null, extra: 1 }).success,
    ).toBe(false);
    expect(SpotifyLiveNow.safeParse({ ...base, link: null }).success).toBe(
      true,
    );
  });
});
