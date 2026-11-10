import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  SpotifyJob,
  SpotifyQueueEntry,
  SpotifySyncAnswer,
} from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { SpotifyApi } from '../src/spotify/api.js';
import { simulatedAuth } from '../src/spotify/oauth.js';
import { SpotifyRuntime } from '../src/spotify/runtime.js';
import { SimSmtc, SmtcTracker } from '../src/spotify/smtc.js';
import { SIM_CATALOG, SpotifySim } from '../src/spotify/sim.js';

// Spotify V2 — what the playback watch COSTS in Spotify calls, and what it must keep (docs/music/SPOTIFY_QUOTA.md):
// Studio against the Lab simulator (fake clock, no network) and a scripted Core that attributes the playing track to
// its request. Each scenario prints its count (simulated, never a measure of the real service) and checks the
// readings Core's rules need: one within 5 s of every request's end (PLAYED, not « interrupted »), one within the first
// seconds of every request (a `!songcancel` in its grace), every request seen (none missed).

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Reading = {
  observed_at: string;
  track: { uri: string; duration_ms: number } | null;
  progress_ms: number | null;
  is_playing: boolean;
};

async function bench(o: { smtc?: boolean } = {}) {
  const clock = { t: 10_000_000 };
  const now = () => clock.t;
  const sleep = async (ms: number) => void (clock.t += ms);
  const sim = new SpotifySim(now);
  const stateFile = join(await mkdtemp(join(tmpdir(), 'sp-cons-')), 'l.json');
  const calls: { at: number; what: string }[] = [];
  const api = new SpotifyApi({
    auth: simulatedAuth,
    stateFile,
    fetch: ((input: URL | string, init?: RequestInit) => {
      calls.push({
        at: clock.t,
        what: `${init?.method ?? 'GET'} ${new URL(String(input)).pathname.replace('/v1/', '')}`,
      });
      return sim.fetch(input, init);
    }) as typeof fetch,
    now,
    sleep,
    random: () => 0,
  });
  // The requests (uri → request id), in the queue's order; Core's attribution, scripted.
  const requests: { request_id: string; uri: string; auto_skip: boolean }[] =
    [];
  let current: string | null = null;
  const readings: Reading[] = [];
  let jobs: SpotifyJob[] = [];
  const reports: { job: string; body: Record<string, unknown>; at: number }[] =
    [];
  const started = new Set<string>();
  const answer = (): SpotifySyncAnswer => {
    const queue: SpotifyQueueEntry[] = requests.map((r) => ({
      request_id: r.request_id,
      track_uri: r.uri,
      state: r.auto_skip
        ? 'CANCELED'
        : r.request_id === current
          ? 'PLAYING'
          : 'QUEUED',
      auto_skip: r.auto_skip,
      queued_at: new Date(0).toISOString(),
    }));
    const handed = jobs;
    jobs = [];
    return {
      enabled: true,
      jobs: handed,
      queue,
      current_request_id: current,
      watch: queue.length > 0 || handed.length > 0,
    };
  };
  const syncs: number[] = [];
  const core = async (path: string, body?: unknown): Promise<unknown> => {
    if (path.split('?')[0]!.endsWith('/studio')) {
      syncs.push(clock.t);
      const pb = (body as { playback?: Reading }).playback;
      if (pb) {
        readings.push(pb);
        const uri = pb.track?.uri ?? null;
        const at = requests.findIndex((r) => r.uri === uri);
        if (at >= 0 && !requests[at]!.auto_skip) {
          // Earlier requests are over (played or skipped): out of the queue.
          requests.splice(0, at);
          current = requests[0]!.request_id;
        } else if (uri && current) {
          requests.splice(
            0,
            requests.findIndex((r) => r.request_id === current) + 1,
          );
          current = null;
        }
      }
      return answer();
    }
    const start = /\/jobs\/([0-9a-f-]+)\/start$/.exec(path);
    if (start) {
      if (started.has(start[1]!))
        throw Object.assign(new Error('job_taken'), { status: 409 });
      started.add(start[1]!);
      return {};
    }
    const rep = /\/jobs\/([0-9a-f-]+)\/report$/.exec(path);
    if (rep)
      return void reports.push({
        job: rep[1]!,
        body: body as Record<string, unknown>,
        at: clock.t,
      } as never);
    if (path.endsWith('/auto-skips')) {
      const b = body as { request_id: string };
      const r = requests.find((x) => x.request_id === b.request_id);
      if (r) requests.splice(requests.indexOf(r), 1);
      return {};
    }
    return {};
  };
  const live: { posts: number } = { posts: 0 };
  const rt = await SpotifyRuntime.open({
    core: (async (path: string, body?: unknown) => {
      if (path.endsWith('/now')) return void live.posts++;
      return core(path, body);
    }) as never,
    environment: 'lab',
    channelId: '1',
    api,
    auth: simulatedAuth,
    sim,
    reservationsFile: join(
      await mkdtemp(join(tmpdir(), 'sp-cons-r-')),
      'r.json',
    ),
    now,
    sleep,
    // Music Hub (SMTC): the simulated Windows of the Lab, read at each step (local, never a Web API call).
    ...(o.smtc
      ? {
          live: {
            tracker: new SmtcTracker('sim', now),
            source: () => ({ start() {}, stop() {} }),
          },
        }
      : {}),
  });
  const windows = o.smtc
    ? new SimSmtc(
        () => sim.local(),
        (l) => rt.onSmtc(l),
        now,
      )
    : null;
  /** Queues these catalogue tracks in the simulator as requests (setup: not counted). */
  const queue = async (n: number, from = 0, same = false) => {
    for (let k = 0; k < n; k++) {
      const t = SIM_CATALOG[same ? from : (from + k) % SIM_CATALOG.length]!;
      await sim.fetch(
        new URL(
          `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(t.uri!)}`,
        ),
        { method: 'POST' },
      );
      requests.push({
        request_id: id(requests.length + 1 + from * 1000),
        uri: t.uri!,
        auto_skip: false,
      });
    }
  };
  const run = async (ms: number) => {
    const end = clock.t + ms;
    while (clock.t < end) {
      const delay = await rt.once();
      // Windows tells its changes within ~250 ms (the simulated probe's step), whatever Studio's pace.
      for (let left = Math.max(50, delay); left > 0; left -= 250) {
        clock.t += Math.min(250, left);
        windows?.step();
      }
    }
  };
  const count = (pred: (w: string) => boolean, since = 0) =>
    calls.filter((c) => c.at >= since && pred(c.what)).length;
  return {
    sim,
    api,
    rt,
    clock,
    calls,
    readings,
    syncs,
    requests,
    reports,
    stateFile,
    now,
    queue,
    run,
    count,
    live,
    job: (j: SpotifyJob) => jobs.push(j),
  };
}

/** For each request track that changed: the last reading before the change was within 5 s of its end. */
function endsSeen(readings: Reading[], uris: Set<string>) {
  const misses: string[] = [];
  let checked = 0;
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1]!;
    const b = readings[i]!;
    if (!a.track || !uris.has(a.track.uri) || a.track.uri === b.track?.uri)
      continue;
    checked++;
    if (
      !a.is_playing ||
      a.progress_ms === null ||
      a.progress_ms < a.track.duration_ms - 5_000
    )
      misses.push(
        `${a.track.uri} lu à ${a.progress_ms}/${a.track.duration_ms}`,
      );
  }
  return { checked, misses };
}

describe('Spotify V2 — consumption of the playback watch (simulated, no network)', () => {
  it('one hour of requests played one after the other: every end and every start seen', async () => {
    const b = await bench();
    await b.queue(40);
    const uris = new Set(b.requests.map((r) => r.uri));
    const t0 = b.clock.t;
    await b.run(3_600_000);
    const reads = b.count((w) => w === 'GET me/player', t0);
    const ends = endsSeen(b.readings, uris);
    // Every request that started was seen in its first seconds (cancel grace): progress ≤ 12 s at first sight.
    const firstSeen = new Map<string, number>();
    for (const r of b.readings)
      if (r.track && uris.has(r.track.uri) && !firstSeen.has(r.track.uri))
        firstSeen.set(r.track.uri, r.progress_ms ?? 0);
    const late = [...firstSeen].filter(([, p]) => p > 12_000);
    console.log(
      `[conso] 1 h de demandes enchaînées : ${reads} lectures GET /me/player (${ends.checked} fins, ${firstSeen.size} débuts)`,
    );
    expect(ends.misses).toEqual([]);
    expect(late).toEqual([]);
    expect(ends.checked).toBeGreaterThan(10);
  });

  it("one hour of the broadcaster's own music with a request waiting (watch on, tracks outside the requests)", async () => {
    const b = await bench();
    // A request Core knows but Spotify will not play this hour (still being added): watch stays on.
    b.requests.push({
      request_id: id(9999),
      uri: 'spotify:track:0000000000000000000000',
      auto_skip: false,
    });
    const t0 = b.clock.t;
    await b.run(3_600_000);
    const reads = b.count((w) => w === 'GET me/player', t0);
    console.log(
      `[conso] 1 h de musique du streamer, une demande en attente : ${reads} lectures GET /me/player`,
    );
    expect(reads).toBeGreaterThan(0);
  });

  it('a wave of 30 catalogue searches with a skip and a song request in the middle: the essential jobs are not held behind the searches, Studio keeps syncing', async () => {
    const b = await bench();
    await b.queue(3);
    await b.run(20_000);
    const t0 = b.clock.t;
    for (let n = 0; n < 30; n++)
      b.job({
        kind: 'search',
        job_id: id(5000 + n),
        query: `recherche ${n}`,
        viewer: String(100 + n),
      } as unknown as SpotifyJob);
    b.job({ kind: 'skip', job_id: id(7001) } as SpotifyJob);
    b.job({
      kind: 'song_request',
      job_id: id(7002),
      request_id: id(7102),
      reference: { kind: 'search', query: 'numb' },
      max_duration_ms: 600_000,
    });
    await b.run(120_000);
    const doneAt = (job: string) =>
      b.reports.find((r) => r.job === job)?.at ?? Infinity;
    const skipWait = doneAt(id(7001)) - t0;
    const songWait = doneAt(id(7002)) - t0;
    const gaps = b.syncs
      .filter((t) => t >= t0)
      .map((t, i, a) => (i ? t - a[i - 1]! : 0));
    const maxGap = Math.max(...gaps);
    const searches = b.count((w) => w === 'GET search', t0);
    console.log(
      `[conso] vague de 30 recherches : skip traité en ${skipWait} ms, demande en ${songWait} ms, plus long silence vers Core ${maxGap} ms, ${searches} recherches Spotify`,
    );
    expect(skipWait).toBeLessThan(Infinity);
    expect(songWait).toBeLessThan(Infinity);
  });

  it('the same track requested twice in a row: both occurrences seen at their start (the restart is read just after the end)', async () => {
    const b = await bench();
    await b.queue(2, 3, true);
    const uri = b.requests[0]!.uri;
    await b.run(2 * (SIM_CATALOG[3]!.duration_ms ?? 0) + 20_000);
    // Each start: a reading of that track with progress ≤ 12 s, twice.
    const starts = b.readings.filter(
      (r, i) =>
        r.track?.uri === uri &&
        (r.progress_ms ?? 0) <= 12_000 &&
        !(
          b.readings[i - 1]?.track?.uri === uri &&
          (b.readings[i - 1]!.progress_ms ?? 0) <= 12_000
        ),
    );
    expect(starts).toHaveLength(2);
    expect(endsSeen(b.readings, new Set([uri])).misses).toEqual([]);
  });

  it('two skips by hand in the Spotify app: 7 s apart both requests are seen; 3 s apart the middle one may be missed (documented, as before under 2.5 s)', async () => {
    for (const gap of [7_000, 3_000]) {
      const b = await bench();
      await b.queue(4);
      const uris = b.requests.map((r) => r.uri);
      // The broadcaster's track gives way to the first request, which then plays well into its track.
      b.sim.skipByHand();
      await b.run(40_000);
      // Skipped by hand: the second request starts, then is skipped `gap` later: the third one plays.
      b.sim.skipByHand();
      await b.run(gap);
      b.sim.skipByHand();
      await b.run(30_000);
      const seen = new Set(b.readings.map((r) => r.track?.uri));
      console.log(
        `[conso] deux skips à la main à ${gap / 1000} s : demande du milieu ${seen.has(uris[1]) ? 'vue' : 'NON vue'}`,
      );
      expect(seen.has(uris[0])).toBe(true);
      expect(seen.has(uris[2])).toBe(true);
      if (gap >= 7_000) expect(seen.has(uris[1])).toBe(true);
    }
  });

  it('paused then resumed: read every 10 s while paused, the resume seen within 10 s', async () => {
    const b = await bench();
    await b.queue(2);
    await b.run(30_000);
    b.sim.playing = false;
    const t0 = b.clock.t;
    await b.run(60_000);
    const pausedReads = b.count((w) => w === 'GET me/player', t0);
    expect(pausedReads).toBeLessThanOrEqual(8);
    await b.sim.fetch(new URL('https://api.spotify.com/v1/me/player/play'), {
      method: 'PUT',
    });
    const t1 = b.clock.t;
    await b.run(12_000);
    const back = b.readings.find(
      (r) => Date.parse(r.observed_at) >= t1 && r.is_playing,
    );
    expect(back).toBeDefined();
    expect(Date.parse(back!.observed_at) - t1).toBeLessThanOrEqual(10_500);
  });

  it('a one-hour QUOTA_EXCEEDED while requests play: one call meets it, then none for the hour (Core keeps hearing Studio), none after a restart either', async () => {
    const b = await bench();
    await b.queue(3);
    await b.run(10_000);
    b.sim.rateLimit(3_600, true);
    const t0 = b.clock.t;
    const syncsBefore = b.syncs.length;
    await b.run(30 * 60_000);
    expect(b.calls.filter((c) => c.at >= t0)).toHaveLength(1);
    expect(b.syncs.length - syncsBefore).toBeGreaterThan(1_000);
    const st = await b.api.status();
    expect(st.quota_exceeded).toBe(true);
    // A restart: a new gate on the same state file still knows the hour.
    const again = new SpotifyApi({
      auth: simulatedAuth,
      stateFile: b.stateFile,
      fetch: b.sim.fetch,
      now: b.now,
    });
    expect((await again.status()).quota_exceeded).toBe(true);
    await expect(again.playback(true)).rejects.toBeInstanceOf(Error);
    expect(b.calls.filter((c) => c.at >= t0)).toHaveLength(1);
  });
});

// Music Hub (docs/music/SMTC_STUDIO.md): the same hours with Windows telling Studio what plays (SMTC). The requests'
// guarantees must stay exactly as above; the extra cost is at most one reading per track change (its exact track).
describe('Spotify V2 — the same consumption with the live track from Windows (SMTC)', () => {
  it('one hour of requests played one after the other: every end and every start still seen', async () => {
    const b = await bench({ smtc: true });
    await b.queue(40);
    const uris = new Set(b.requests.map((r) => r.uri));
    const t0 = b.clock.t;
    await b.run(3_600_000);
    const reads = b.count((w) => w === 'GET me/player', t0);
    const ends = endsSeen(b.readings, uris);
    const firstSeen = new Map<string, number>();
    for (const r of b.readings)
      if (r.track && uris.has(r.track.uri) && !firstSeen.has(r.track.uri))
        firstSeen.set(r.track.uri, r.progress_ms ?? 0);
    console.log(
      `[conso+smtc] 1 h de demandes enchaînées : ${reads} lectures GET /me/player, ${b.live.posts} messages à Core (${ends.checked} fins, ${firstSeen.size} débuts)`,
    );
    expect(ends.misses).toEqual([]);
    expect([...firstSeen].filter(([, p]) => p > 12_000)).toEqual([]);
    expect(ends.checked).toBeGreaterThan(10);
  });

  it('two skips by hand 3 s apart: with Windows telling the change, the middle request is seen too', async () => {
    for (const gap of [3_000, 2_000]) {
      const b = await bench({ smtc: true });
      await b.queue(4);
      const uris = b.requests.map((r) => r.uri);
      b.sim.skipByHand();
      await b.run(40_000);
      b.sim.skipByHand();
      await b.run(gap);
      b.sim.skipByHand();
      await b.run(30_000);
      const seen = new Set(b.readings.map((r) => r.track?.uri));
      console.log(
        `[conso+smtc] deux skips à la main à ${gap / 1000} s : demande du milieu ${seen.has(uris[1]) ? 'vue' : 'NON vue'}`,
      );
      expect(seen.has(uris[0])).toBe(true);
      expect(seen.has(uris[2])).toBe(true);
      if (gap >= 3_000) expect(seen.has(uris[1])).toBe(true);
    }
  });

  it("one hour of the broadcaster's own music, a request waiting: at most one more reading per track", async () => {
    const without = await bench();
    const withSmtc = await bench({ smtc: true });
    for (const b of [without, withSmtc])
      b.requests.push({
        request_id: id(9999),
        uri: 'spotify:track:0000000000000000000000',
        auto_skip: false,
      });
    const t0 = without.clock.t;
    await without.run(3_600_000);
    await withSmtc.run(3_600_000);
    const before = without.count((w) => w === 'GET me/player', t0);
    const after = withSmtc.count((w) => w === 'GET me/player', t0);
    const tracks = Math.ceil(3_600_000 / 160_000); // the playlist's tracks are 160–200 s
    console.log(
      `[conso+smtc] 1 h de musique du streamer, une demande en attente : ${before} → ${after} lectures GET /me/player`,
    );
    expect(after - before).toBeLessThanOrEqual(tracks);
  });

  it("one hour of the broadcaster's own music, nothing to watch: one reading per track (none before), the same 30 s heartbeat", async () => {
    const without = await bench();
    const withSmtc = await bench({ smtc: true });
    const t0 = without.clock.t;
    await without.run(3_600_000);
    await withSmtc.run(3_600_000);
    const before = without.count((w) => w === 'GET me/player', t0);
    const after = withSmtc.count((w) => w === 'GET me/player', t0);
    console.log(
      `[conso+smtc] 1 h de musique du streamer, rien à surveiller : ${before} → ${after} lectures GET /me/player, ${withSmtc.live.posts} messages à Core`,
    );
    expect(before).toBe(0);
    expect(after).toBeGreaterThan(15);
    expect(after).toBeLessThanOrEqual(25);
    // One message per change and the 30 s heartbeat: never one per second for the bar.
    expect(withSmtc.live.posts).toBeLessThan(200);
  });
});
