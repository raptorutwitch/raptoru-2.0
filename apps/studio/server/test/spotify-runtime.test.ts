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
import { SIM_CATALOG, SpotifySim } from '../src/spotify/sim.js';

// Spotify V2 in Studio against the Lab simulator and a scripted Core: jobs (search → queue, read-back, refusals,
// skip), the watch (Spotify read only when Core says so), the FIFO auto-skip (once, reserved, survives a restart).

const NUMB = SIM_CATALOG.find((t) => t.name === 'Numb')!;
const BRIGHT = SIM_CATALOG.find((t) => t.name === 'Mr. Brightside')!;
// eslint-friendly loose views of what Studio sent.
type Body = Record<string, unknown> & { candidates?: { id: string }[] };
type Sync = { status: { limited_until: string | null }; playback?: unknown };
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function harness(opts: { reservationsFile?: string; t0?: number } = {}) {
  const clock = { t: opts.t0 ?? 1_000_000 };
  const now = () => clock.t;
  const sleep = async (ms: number) => void (clock.t += ms);
  const sim = new SpotifySim(now);
  const events: string[] = [];
  const api = new SpotifyApi({
    auth: simulatedAuth,
    stateFile: join(await mkdtemp(join(tmpdir(), 'sp-rt-')), 'l.json'),
    fetch: ((input: URL | string, init?: RequestInit) => {
      events.push(
        `spotify ${init?.method ?? 'GET'} ${new URL(String(input)).pathname.replace('/v1/', '')}`,
      );
      return sim.fetch(input, init);
    }) as typeof fetch,
    now,
    sleep,
    random: () => 0,
  });
  const core = {
    answer: {
      enabled: true,
      jobs: [],
      queue: [],
      current_request_id: null,
      watch: false,
    } as SpotifySyncAnswer,
    syncs: [] as Sync[],
    reports: [] as { job: string; body: Body }[],
    autoSkips: [] as Body[],
    started: new Set<string>(),
    /** Called with each sync's body before Core answers (a change « at the last moment »). */
    onSync: null as ((body: Sync) => void) | null,
  };
  const call = async (path: string, body?: unknown): Promise<unknown> => {
    if (path.endsWith('/studio')) {
      core.syncs.push(body as Sync);
      const pb = (body as { playback?: { track?: { title?: string } | null } })
        .playback;
      events.push(
        `core sync${pb ? ` (lecture : ${pb.track?.title ?? 'rien'})` : ''}`,
      );
      core.onSync?.(body as Sync);
      const a = core.answer;
      core.answer = { ...a, jobs: [] }; // jobs handed once
      return a;
    }
    const start = /\/jobs\/([0-9a-f-]+)\/start$/.exec(path);
    if (start) {
      if (core.started.has(start[1]!))
        throw Object.assign(new Error('job_taken'), { status: 409 });
      core.started.add(start[1]!);
      return {};
    }
    const rep = /\/jobs\/([0-9a-f-]+)\/report$/.exec(path);
    if (rep)
      return void core.reports.push({ job: rep[1]!, body: body as Body });
    if (path.endsWith('/auto-skips')) {
      events.push('core auto-skip');
      return void core.autoSkips.push(body as Body);
    }
    throw new Error(`unexpected ${path}`);
  };
  const reservationsFile =
    opts.reservationsFile ??
    join(await mkdtemp(join(tmpdir(), 'sp-res-')), 'r.json');
  const logs: string[] = [];
  const rt = await SpotifyRuntime.open({
    core: call as never,
    environment: 'lab',
    channelId: '1',
    api,
    auth: simulatedAuth,
    sim,
    reservationsFile,
    now,
    sleep,
    log: (line) => logs.push(line),
  });
  const job = (j: SpotifyJob) => {
    core.answer = { ...core.answer, jobs: [j] };
  };
  return {
    rt,
    events,
    logs,
    sim,
    api,
    core,
    clock,
    job,
    reservationsFile,
    report: () => core.reports.at(-1)?.body,
  };
}

const songJob = (n: number, query: string, max = 600_000): SpotifyJob => ({
  kind: 'song_request',
  job_id: id(n),
  request_id: id(100 + n),
  reference: { kind: 'search', query },
  max_duration_ms: max,
});
const entry = (
  n: number,
  uri: string,
  auto_skip = false,
  state: SpotifyQueueEntry['state'] = 'QUEUED',
): SpotifyQueueEntry => ({
  request_id: id(100 + n),
  track_uri: uri,
  state: auto_skip ? 'CANCELED' : state,
  auto_skip,
  queued_at: new Date(0).toISOString(),
});

describe('Spotify runtime (Studio)', () => {
  it('a request: search, score, duration, device, queue (204) — candidates and confidence reported', async () => {
    const h = await harness();
    h.job(songJob(1, 'numb linkin park'));
    await h.rt.once();
    expect(h.report()).toMatchObject({
      kind: 'song_request',
      outcome: 'queued',
      confirmation: 'http_204',
      track: {
        id: NUMB.id,
        uri: `spotify:track:${NUMB.id}`,
        title: 'Numb',
        artists: ['Linkin Park'],
        duration_ms: 185_000,
      },
    });
    expect(h.report()!.candidates![0]!.id).toBe(NUMB.id);
    expect(h.sim.view().queue).toEqual(['Numb']);
    // Never run twice: the same job handed again is refused by Core's start.
    h.job(songJob(1, 'numb linkin park'));
    await h.rt.once();
    expect(h.core.reports).toHaveLength(1);
    expect(h.sim.view().queue).toEqual(['Numb']);
  });

  it('diagnostic search (read-only): which fields each result carries; nothing queued, nothing reported to Core', async () => {
    const h = await harness();
    const out = (await h.rt.api('POST', '/diagnostic/search', async () => ({
      q: 'numb linkin park',
    }))) as {
      count: number;
      fields: Record<string, number>;
      items: { id: string; name: string; artists: string[] }[];
    };
    expect(out.count).toBeGreaterThan(0);
    expect(out.items[0]).toMatchObject({
      name: 'Numb',
      artists: ['Linkin Park'],
    });
    expect(Object.keys(out.fields).sort()).toEqual([
      'album_name',
      'album_type',
      'isrc',
      'popularity',
      'release_date',
    ]);
    expect(h.sim.view().queue).toEqual([]);
    expect(h.core.reports).toHaveLength(0);
    await expect(
      h.rt.api('POST', '/diagnostic/search', async () => ({ q: ' ' })),
    ).rejects.toThrow('empty_query');
  });

  it('a request costs 2 Spotify calls when Spotify answers 204 (search, add): no duration re-read, no device list', async () => {
    const h = await harness();
    h.job(songJob(1, 'numb linkin park'));
    await h.rt.once();
    expect(h.report()).toMatchObject({
      outcome: 'queued',
      confirmation: 'http_204',
    });
    expect(h.sim.calls).toEqual(['GET search', 'POST me/player/queue']);
    // An exact link still reads the track (its only source of title and duration).
    h.job({
      ...songJob(2, 'x'),
      reference: { kind: 'exact', track_id: BRIGHT.id },
    } as SpotifyJob);
    await h.rt.once();
    expect(h.sim.calls.slice(2)).toEqual([
      `GET tracks/${BRIGHT.id}`,
      'POST me/player/queue',
    ]);
    // No active device: Spotify refuses the add (404) — a certain refusal, nothing queued.
    h.sim.deviceActive = false;
    h.job(songJob(3, 'shape of you ed sheeran'));
    await h.rt.once();
    expect(h.report()).toMatchObject({
      outcome: 'refused',
      reason: 'NO_DEVICE',
    });
    expect(h.sim.view().queue).toEqual(['Numb', 'Mr. Brightside']);
  });

  it('refusals: ambiguous, not found, too long, no device — nothing queued', async () => {
    const h = await harness();
    const cases: [string, string, () => void][] = [
      ['numb', 'AMBIGUOUS', () => {}],
      ['zzzz qqqq', 'NOT_FOUND', () => {}],
      ['long test track raptoru fixtures', 'TOO_LONG', () => {}],
      [
        'mr brightside the killers',
        'NO_DEVICE',
        () => void (h.sim.deviceActive = false),
      ],
    ];
    let n = 1;
    for (const [q, reason, before] of cases) {
      before();
      h.job(songJob(n++, q));
      await h.rt.once();
      expect(h.report(), q).toMatchObject({ outcome: 'refused', reason });
    }
    expect(h.sim.view().queue).toEqual([]);
  });

  it('an exact link to an unknown track: NOT_FOUND', async () => {
    const h = await harness();
    h.job({
      ...songJob(1, 'x'),
      reference: { kind: 'exact', track_id: 'Z'.repeat(22) },
    } as SpotifyJob);
    await h.rt.once();
    expect(h.report()).toMatchObject({
      outcome: 'refused',
      reason: 'NOT_FOUND',
    });
  });

  it('Spotify answers 200 (maybe sent): the queue is read back → queued by read-back; a 500 not found → unknown', async () => {
    const h = await harness();
    h.sim.queueAnswer = 200;
    h.job(songJob(1, 'numb linkin park'));
    await h.rt.once();
    expect(h.report()).toMatchObject({
      outcome: 'queued',
      confirmation: 'queue_readback',
    });
    h.sim.queueAnswer = 500;
    h.job(songJob(2, 'mr brightside the killers'));
    await h.rt.once();
    expect(h.report()).toMatchObject({
      outcome: 'unknown',
      reason: 'QUEUE_RESULT_UNKNOWN',
    });
    // Never resent: only Numb reached the queue.
    expect(h.sim.view().queue).toEqual(['Numb']);
  });

  it('skip job: one next, the skipped track reported', async () => {
    const h = await harness();
    h.job({ kind: 'skip', job_id: id(9), request_id: null });
    await h.rt.once();
    expect(h.report()).toMatchObject({
      kind: 'skip',
      outcome: 'skipped',
      skipped_track: { title: 'Lofi Stream Beat' },
    });
    expect(h.sim.view().current).toContain('Chill Loop');
  });

  it('after a skip, one reading even with nothing left to watch; « Actualiser » at most every 5 s', async () => {
    const h = await harness();
    h.job({ kind: 'skip', job_id: id(9), request_id: null });
    await h.rt.once();
    const reads = () => h.sim.calls.filter((c) => c === 'GET me/player').length;
    const before = reads();
    h.clock.t += 1_100;
    await h.rt.once();
    expect(reads()).toBe(before + 1);
    // The reading reached Core with the next sync.
    h.clock.t += 1_000;
    await h.rt.once();
    expect(
      h.core.syncs.at(-1)!.playback ?? h.core.syncs.at(-2)!.playback,
    ).toBeTruthy();
    for (let i = 0; i < 5; i++) {
      h.clock.t += 1_000;
      await h.rt.once();
    }
    expect(reads()).toBe(before + 1);
    // Panel « Actualiser »: one reading, then throttled for 5 s.
    h.clock.t += 2_000;
    expect(await h.rt.api('POST', '/refresh', async () => ({}))).toEqual({
      read: true,
    });
    expect(await h.rt.api('POST', '/refresh', async () => ({}))).toEqual({
      read: false,
    });
    h.clock.t += 5_000;
    expect(await h.rt.api('POST', '/refresh', async () => ({}))).toEqual({
      read: true,
    });
  });

  it('timing lines in the Studio log: each song job step, and the auto-skip (playback progress when read, delays)', async () => {
    const h = await harness();
    h.sim.queueAnswer = 200;
    h.job(songJob(1, 'numb linkin park'));
    await h.rt.once();
    const job = h.logs.find((l) => l.includes('[spotify] demande'));
    expect(job).toMatch(
      /→ queued : Core \(prise\) \d+ ms · recherche \d+ ms · ajout \(réponse non 204\) \d+ ms · relecture \(\+250 ms d'attente\) \d+ ms · Core \(rapport\) \d+ ms · total \d+ ms/,
    );
    h.core.answer = {
      ...h.core.answer,
      queue: [entry(1, `spotify:track:${NUMB.id}`, true)],
      watch: true,
    };
    await h.rt.once();
    await h.rt.api('POST', '/sim/near-end', async () => ({}));
    for (let i = 0; i < 12 && h.core.autoSkips.length === 0; i++) {
      h.clock.t += 300;
      await h.rt.once();
    }
    expect(h.logs.find((l) => l.includes('auto-skip'))).toMatch(
      /SKIPPED · lu à \d+ ms du début \(suivi (rapide|normal)\) · décision \+\d+ ms après la lecture · skip envoyé \+\d+ ms · réponse Spotify \d+ ms/,
    );
  });

  it('a canceled request starting to play: skipped on the fresh reading BEFORE the sync, reported only AFTER Core saw it', async () => {
    const h = await harness();
    const uri = `spotify:track:${NUMB.id}`;
    h.job(songJob(1, 'numb linkin park'));
    await h.rt.once();
    h.core.answer = {
      ...h.core.answer,
      queue: [entry(1, uri, true)],
      watch: true,
    };
    await h.rt.once();
    await h.rt.api('POST', '/sim/near-end', async () => ({}));
    for (let i = 0; i < 12 && h.core.autoSkips.length === 0; i++) {
      h.clock.t += 300;
      await h.rt.once();
    }
    const e = h.events;
    const skip = e.indexOf('spotify POST me/player/next');
    const seen = e.indexOf('core sync (lecture : Numb)');
    const report = e.indexOf('core auto-skip');
    expect(skip).toBeGreaterThan(-1);
    // The skip went out before the sync carrying that reading; the report came after it.
    expect(skip).toBeLessThan(seen);
    expect(report).toBeGreaterThan(seen);
    expect(e.filter((x) => x === 'spotify POST me/player/next')).toHaveLength(
      1,
    );
  });

  it('canceled at the last moment (the last answer did not know it yet): no early decision, skipped right after the sync', async () => {
    const h = await harness();
    const uri = `spotify:track:${NUMB.id}`;
    h.job(songJob(1, 'numb linkin park'));
    await h.rt.once();
    // Live until the very sync that carries the reading where it starts: then Core says it is canceled.
    h.core.answer = { ...h.core.answer, queue: [entry(1, uri)], watch: true };
    h.core.onSync = (body) => {
      const pb = (body as { playback?: { track?: { uri?: string } | null } })
        .playback;
      if (pb?.track?.uri === uri)
        h.core.answer = { ...h.core.answer, queue: [entry(1, uri, true)] };
    };
    await h.rt.once();
    await h.rt.api('POST', '/sim/near-end', async () => ({}));
    for (let i = 0; i < 40 && h.core.autoSkips.length === 0; i++) {
      h.clock.t += 300;
      await h.rt.once();
    }
    const e = h.events;
    expect(e.indexOf('core sync (lecture : Numb)')).toBeLessThan(
      e.indexOf('spotify POST me/player/next'),
    );
    expect(h.core.autoSkips).toHaveLength(1);
  });

  it('after a skip, a canceled request next is read fast (~200 ms) and skipped within about a second', async () => {
    const h = await harness();
    const uri = `spotify:track:${NUMB.id}`;
    h.job(songJob(1, 'numb linkin park'));
    await h.rt.once();
    h.core.answer = {
      ...h.core.answer,
      queue: [entry(1, uri, true)],
      watch: true,
    };
    await h.rt.once();
    // A moderator skips the track outside the requests: Numb (canceled) starts right away.
    h.job({ kind: 'skip', job_id: id(9), request_id: null });
    await h.rt.once();
    const skippedAt = h.clock.t;
    for (let i = 0; i < 20 && h.core.autoSkips.length === 0; i++) {
      h.clock.t += 100;
      await h.rt.once();
    }
    expect(h.core.autoSkips).toHaveLength(1);
    expect(h.clock.t - skippedAt).toBeLessThanOrEqual(1_500);
  });

  it('a canceled request next behind a track outside the requests: read at the active pace (2.5 s), not every 30 s', async () => {
    const h = await harness();
    h.core.answer = {
      ...h.core.answer,
      queue: [entry(1, `spotify:track:${NUMB.id}`, true)],
      watch: true,
    };
    // 20 s in steps of 1 s: at the active pace (2.5 s, i.e. every 3 s with these steps) ~7 reads; at 30 s, one.
    for (let i = 0; i < 21; i++) {
      await h.rt.once();
      h.clock.t += 1_000;
    }
    const reads = h.events.filter((x) => x === 'spotify GET me/player').length;
    expect(reads).toBeGreaterThanOrEqual(6);
    expect(reads).toBeLessThanOrEqual(8);
  });

  it('adds without a clear success never pass as success: 404 no device and 403 refused (nothing queued), 500 unknown', async () => {
    const h = await harness();
    h.sim.deviceActive = false;
    h.job(songJob(1, 'numb linkin park'));
    await h.rt.once();
    expect(h.report()).toMatchObject({
      outcome: 'refused',
      reason: 'NO_DEVICE',
    });
    h.sim.deviceActive = true;
    h.sim.queueAnswer = 403;
    h.job(songJob(2, 'mr brightside the killers'));
    await h.rt.once();
    expect(h.report()).toMatchObject({
      outcome: 'refused',
      reason: 'SPOTIFY_UNAVAILABLE',
    });
    h.sim.queueAnswer = 500;
    h.job(songJob(3, 'shape of you ed sheeran'));
    await h.rt.once();
    expect(h.report()).toMatchObject({
      outcome: 'unknown',
      reason: 'QUEUE_RESULT_UNKNOWN',
    });
    expect(h.sim.view().queue).toEqual([]);
    // Nothing was resent: one add per job.
    expect(
      h.events.filter((x) => x === 'spotify POST me/player/queue'),
    ).toHaveLength(3);
  });

  it('no watch: Spotify is never read (only the sync to Core)', async () => {
    const h = await harness();
    for (let i = 0; i < 5; i++) await h.rt.once();
    expect(h.sim.calls).toEqual([]);
    expect(h.core.syncs).toHaveLength(5);
    expect(h.core.syncs[0]!.status).toMatchObject({
      auth: 'ok',
      limited_until: null,
    });
  });

  it('a canceled request reaching playback is skipped once (FIFO), reported, never twice — even after a restart', async () => {
    const h = await harness();
    const uri = `spotify:track:${NUMB.id}`;
    h.job(songJob(1, 'numb linkin park'));
    await h.rt.once();
    // Viewer canceled it: Core lists it as a tombstone, watch on.
    h.core.answer = {
      ...h.core.answer,
      queue: [entry(1, uri, true)],
      watch: true,
    };
    await h.rt.once(); // reads the playlist track (no skip)
    await h.rt.api('POST', '/sim/near-end', async () => ({}));
    for (let i = 0; i < 12 && h.core.autoSkips.length === 0; i++) {
      h.clock.t += 300;
      await h.rt.once();
    }
    expect(h.core.autoSkips).toEqual([
      expect.objectContaining({ request_id: id(101), result: 'SKIPPED' }),
    ]);
    expect(h.sim.calls.filter((c) => c === 'POST me/player/next')).toHaveLength(
      1,
    );
    expect(h.sim.view().current).not.toContain('Numb');
    // A restarted Studio with Core still listing it (report not yet applied): no second skip.
    const again = await harness({ reservationsFile: h.reservationsFile });
    again.core.answer = {
      ...again.core.answer,
      queue: [entry(1, uri, true)],
      watch: true,
    };
    again.sim.queueAnswer = 204;
    await again.rt.once();
    expect(
      again.sim.calls.filter((c) => c === 'POST me/player/next'),
    ).toHaveLength(0);
  });

  it('FIFO: the same track queued twice, the FIRST one live and the second canceled → no skip', async () => {
    const h = await harness();
    const uri = `spotify:track:${NUMB.id}`;
    h.job(songJob(1, 'numb linkin park'));
    await h.rt.once();
    h.core.answer = {
      ...h.core.answer,
      queue: [entry(1, uri), entry(2, uri, true)],
      watch: true,
    };
    await h.rt.once();
    await h.rt.api('POST', '/sim/near-end', async () => ({}));
    for (let i = 0; i < 10; i++) {
      h.clock.t += 300;
      await h.rt.once();
    }
    expect(h.sim.view().current).toContain('Numb');
    expect(h.sim.calls).not.toContain('POST me/player/next');
    expect(h.core.autoSkips).toEqual([]);
    // Core then attributes it (PLAYING): a later reading of that same occurrence never skips it.
    h.core.answer = {
      ...h.core.answer,
      queue: [entry(1, uri, false, 'PLAYING'), entry(2, uri, true)],
      current_request_id: id(101),
    };
    for (let i = 0; i < 5; i++) {
      h.clock.t += 3_000;
      await h.rt.once();
    }
    expect(h.sim.calls).not.toContain('POST me/player/next');
  });

  it('a 429 while watching: the sync still reaches Core with « limité jusqu’à », no further Spotify call', async () => {
    const h = await harness();
    h.core.answer = {
      ...h.core.answer,
      queue: [entry(1, `spotify:track:${BRIGHT.id}`)],
      watch: true,
    };
    await h.rt.once();
    h.sim.rateLimit(60);
    h.clock.t += 3_000;
    await h.rt.once();
    const calls = h.sim.calls.length;
    expect(h.core.syncs.at(-1)!.status.limited_until).not.toBeNull();
    for (let i = 0; i < 10; i++) {
      h.clock.t += 2_500;
      await h.rt.once();
    }
    expect(h.sim.calls.length).toBe(calls);
    expect(h.core.syncs.at(-1)!.status.limited_until).not.toBeNull();
  });
});
