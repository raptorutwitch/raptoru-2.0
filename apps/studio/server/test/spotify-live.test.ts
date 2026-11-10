import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpotifyLiveNow, type SpotifySyncAnswer } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { SpotifyApi } from '../src/spotify/api.js';
import { simulatedAuth } from '../src/spotify/oauth.js';
import { SpotifyRuntime } from '../src/spotify/runtime.js';
import { SpotifySim } from '../src/spotify/sim.js';
import { SimSmtc, SmtcTracker, type SmtcLine } from '../src/spotify/smtc.js';

// Music Hub — the live track from Windows (SMTC) in Studio (docs/music/SMTC_STUDIO.md): the tracker (pure), then the
// runtime against the Lab simulator and a scripted Core — one Web API reading per track change at most (never during a
// 429), the exact track linked only to ITS occurrence, the state sent to Core on a change and every 30 s only.

const line = (over: Partial<SmtcLine> = {}): SmtcLine => ({
  kind: 'PISTE',
  source: 'media',
  title: 'Obsesion',
  artist: 'Aventura',
  album: 'We Broke The Rules',
  status: 'Playing',
  position_ms: 0,
  end_ms: 254_720,
  thumb_bytes: -1,
  ...over,
});

function tracker() {
  const clock = { t: 1_000_000 };
  const tr = new SmtcTracker('smtc', () => clock.t);
  return { tr, clock, wait: (ms: number) => void (clock.t += ms) };
}

describe('SMTC tracker', () => {
  it('a track change is a new occurrence; duplicates, transitions and older lines change nothing', () => {
    const { tr, wait } = tracker();
    expect(tr.view().state).toBe('off'); // nothing heard yet
    expect(tr.feed({ kind: 'TROUVÉE', t: 1 })).toBe('none');
    expect(
      tr.feed(
        line({ kind: 'EN COURS', source: 'start', t: 2, position_ms: 24_366 }),
      ),
    ).toBe('track');
    expect(tr.view()).toMatchObject({
      state: 'playing',
      gen: 1,
      position_ms: 24_366,
    });
    wait(1_000);
    expect(tr.view().position_ms).toBe(25_366); // the clock moves the bar
    // Spotify sends the media event twice: the second is a duplicate.
    expect(tr.feed(line({ kind: 'DOUBLON', t: 3, position_ms: 25_370 }))).toBe(
      'none',
    );
    // An empty title for an instant (Spotify changing tracks): ignored.
    expect(tr.feed(line({ t: 4, title: '', artist: '' }))).toBe('none');
    wait(60_000);
    const seq = tr.seq;
    expect(
      tr.feed(
        line({
          t: 6,
          title: 'Sweet Dreams',
          artist: 'Eurythmics',
          album: 'Sweet Dreams',
          position_ms: 11,
          end_ms: 216_933,
        }),
      ),
    ).toBe('track');
    expect(tr.view()).toMatchObject({
      gen: 2,
      track: {
        title: 'Sweet Dreams',
        artists: ['Eurythmics'],
        duration_ms: 216_933,
      },
    });
    expect(tr.seq).toBe(seq + 1);
    // How the previous one ended (Studio's clock at the change): 24.4 s + 61 s.
    expect(tr.ended).toEqual({
      gen: 1,
      position_ms: 85_366,
      playing: true,
      cause: 'change',
    });
    // A line older than the last one (out of order): ignored.
    expect(tr.feed(line({ t: 5, title: 'Obsesion' }))).toBe('none');
    expect(tr.view().gen).toBe(2);
  });

  it('pause / resume keep the occurrence (the bar freezes), a seek moves it, a replay from the start is new', () => {
    const { tr, wait } = tracker();
    tr.feed(line({ position_ms: 0 }));
    wait(30_000);
    expect(
      tr.feed(
        line({
          kind: 'PAUSE',
          source: 'playback',
          status: 'Paused',
          position_ms: 30_000,
        }),
      ),
    ).toBe('state');
    wait(15_000); // (the probe's local reading every 5 s keeps it fresh; 20 s of silence would be « stale »)
    expect(tr.view()).toMatchObject({
      state: 'paused',
      gen: 1,
      position_ms: 30_000,
    });
    expect(
      tr.feed(
        line({ kind: 'LECTURE', source: 'playback', position_ms: 30_000 }),
      ),
    ).toBe('state');
    wait(5_000);
    expect(
      tr.feed(line({ kind: 'CONTRÔLE', source: 'check', position_ms: 35_200 })),
    ).toBe('none'); // drift < 2.5 s
    expect(
      tr.feed(
        line({ kind: 'POSITION', source: 'timeline', position_ms: 120_000 }),
      ),
    ).toBe('seek');
    expect(tr.view()).toMatchObject({ gen: 1, position_ms: 120_000 });
    expect(tr.feed(line({ kind: 'REJOUÉ', position_ms: 400 }))).toBe('replay');
    expect(tr.view().gen).toBe(2);
    expect(tr.ended).toMatchObject({
      gen: 1,
      position_ms: 120_000,
      cause: 'replay',
    });
  });

  it('Spotify closed then reopened; a missing album / artist / duration; the source gone', () => {
    const { tr, wait } = tracker();
    tr.feed(line({ position_ms: 10_000 }));
    wait(5_000);
    expect(tr.feed({ kind: 'PERDUE' })).toBe('session');
    expect(tr.view()).toMatchObject({ state: 'lost', track: null });
    expect(tr.ended).toMatchObject({
      gen: 1,
      position_ms: 15_000,
      cause: 'lost',
    });
    tr.feed({ kind: 'TROUVÉE' });
    expect(tr.view().state).toBe('waiting');
    expect(
      tr.feed(
        line({
          kind: 'EN COURS',
          source: 'start',
          artist: '',
          album: '',
          end_ms: 0,
          position_ms: 3_000,
        }),
      ),
    ).toBe('track');
    wait(10_000);
    expect(tr.view()).toMatchObject({
      state: 'playing',
      gen: 2,
      track: { title: 'Obsesion', artists: [], album: null, duration_ms: null },
      position_ms: 13_000,
    });
    tr.off('probe_stopped');
    expect(tr.view()).toMatchObject({
      state: 'off',
      track: null,
      reason: 'probe_stopped',
    });
    expect(tr.ended).toMatchObject({ gen: 2, cause: 'off' });
    // Back: the next line is heard again.
    expect(tr.feed(line({ position_ms: 20_000 }))).toBe('track');
    expect(tr.view().state).toBe('playing');
  });

  it('stale when Windows stops telling (20 s of silence) or a track plays 15 s past its end; never past the end', () => {
    const { tr, wait } = tracker();
    tr.feed(line({ position_ms: 250_000 }));
    wait(10_000);
    expect(tr.view()).toMatchObject({ state: 'playing', position_ms: 254_720 }); // capped
    wait(11_000);
    expect(tr.view().state).toBe('stale'); // 20 s past the end, and 21 s of silence
    tr.feed(
      line({
        kind: 'CONTRÔLE',
        source: 'check',
        status: 'Paused',
        position_ms: 254_720,
      }),
    );
    expect(tr.view().state).toBe('paused');
  });

  it('the cover: kept once sent, reused when the probe does not resend it, unknown on a change read without it', () => {
    const { tr } = tracker();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString(
      'base64',
    );
    tr.feed(line({ thumb: png, thumb_bytes: 7 }));
    const first = tr.view().cover;
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(tr.cover?.type).toBe('image/png');
    // Same album, next track: the probe does not resend the same bytes.
    tr.feed(line({ title: 'Ella Y Yo', thumb_bytes: 7 }));
    expect(tr.view().cover).toBe(first);
    // A change seen by the local check (no cover read): unknown until the media event.
    tr.feed(line({ kind: 'MANQUÉ', source: 'check', title: 'Otra' }));
    expect(tr.view().cover).toBeNull();
    // A track without a cover.
    tr.feed(line({ title: 'Sans pochette', thumb_bytes: -1 }));
    expect(tr.view().cover).toBeNull();
  });
});

describe('the Lab’s simulated Windows', () => {
  it('reports the simulator like the probe: start, each change twice, pause, replay, closed and reopened', () => {
    const clock = { t: 1_000_000 };
    const sim = new SpotifySim(() => clock.t);
    const tr = new SmtcTracker('sim', () => clock.t);
    const lines: SmtcLine[] = [];
    const src = new SimSmtc(
      () => sim.local(),
      (l) => (lines.push(l), tr.feed(l)),
      () => clock.t,
    );
    src.step();
    expect(tr.view()).toMatchObject({
      state: 'playing',
      gen: 1,
      track: { title: 'Lofi Stream Beat' },
    });
    expect(tr.cover?.type).toBe('image/svg+xml');
    clock.t += 10_000;
    sim.skipByHand();
    src.step();
    expect(lines.slice(-2).map((l) => l.kind)).toEqual(['PISTE', 'DOUBLON']);
    expect(tr.view()).toMatchObject({ gen: 2, track: { title: 'Chill Loop' } });
    sim.pauseByHand();
    src.step();
    expect(tr.view().state).toBe('paused');
    sim.pauseByHand();
    clock.t += 20_000;
    src.step();
    sim.replay();
    src.step();
    expect(tr.view().gen).toBe(3);
    sim.closeApp(true);
    src.step();
    expect(tr.view().state).toBe('lost');
    sim.closeApp(false);
    src.step();
    expect(tr.view()).toMatchObject({ state: 'playing', gen: 4 });
    // Never through the fake Web API: not one call counted.
    expect(sim.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------- the runtime

async function harness(o: { coreLive?: 'ok' | '404' } = {}) {
  const clock = { t: 5_000_000 };
  const now = () => clock.t;
  const sleep = async (ms: number) => void (clock.t += ms);
  const sim = new SpotifySim(now);
  const reads: number[] = [];
  const api = new SpotifyApi({
    auth: simulatedAuth,
    stateFile: join(await mkdtemp(join(tmpdir(), 'sp-live-')), 'l.json'),
    fetch: ((input: URL | string, init?: RequestInit) => {
      if (new URL(String(input)).pathname === '/v1/me/player')
        reads.push(clock.t);
      return sim.fetch(input, init);
    }) as typeof fetch,
    now,
    sleep,
    random: () => 0,
  });
  const core = {
    answer: {
      enabled: false,
      jobs: [],
      queue: [],
      current_request_id: null,
      watch: false,
    } as SpotifySyncAnswer,
    live: [] as SpotifyLiveNow[],
    state: {} as Record<string, unknown>,
    syncs: 0,
  };
  const call = async (path: string, body?: unknown): Promise<unknown> => {
    if (path.split('?')[0]!.endsWith('/studio')) {
      core.syncs++;
      return core.answer;
    }
    if (path.endsWith('/state')) return core.state;
    if (path.endsWith('/now')) {
      if (o.coreLive === '404')
        throw Object.assign(new Error('not_found'), { status: 404 });
      // What Core accepts (the strict schema of the route).
      core.live.push(SpotifyLiveNow.parse(body));
      return { accepted: true };
    }
    throw new Error(`unexpected ${path}`);
  };
  const tracker = new SmtcTracker('sim', now);
  const rt = await SpotifyRuntime.open({
    core: call as never,
    environment: 'lab',
    channelId: '1',
    api,
    auth: simulatedAuth,
    sim,
    reservationsFile: join(
      await mkdtemp(join(tmpdir(), 'sp-live-r-')),
      'r.json',
    ),
    now,
    sleep,
    live: { tracker, source: () => ({ start() {}, stop() {} }) },
  });
  const src = new SimSmtc(
    () => sim.local(),
    (l) => rt.onSmtc(l),
    now,
  );
  /** Studio's loop for `ms`: one cycle, then as the runtime asks. */
  const run = async (ms: number) => {
    const end = clock.t + ms;
    while (clock.t < end) {
      src.step();
      const delay = await rt.once();
      clock.t += Math.max(100, Math.min(delay, end - clock.t));
    }
  };
  return { rt, sim, src, core, reads, clock, run, tracker, api };
}

describe('Studio: the live track', () => {
  it('nothing watched: ONE reading per track change gives its exact track; the state goes to Core on a change and every 30 s', async () => {
    const h = await harness();
    await h.run(5_000);
    expect(h.reads).toHaveLength(1); // the first track's link
    const first = h.core.live.at(-1)!;
    expect(first).toMatchObject({
      gen: 1,
      state: 'playing',
      track: { title: 'Lofi Stream Beat' },
      link: { uri: 'spotify:track:1SIMext0playlist0trak1' },
    });
    const posts = h.core.live.length;
    await h.run(20_000);
    expect(h.reads).toHaveLength(1); // no reading without a change
    expect(h.core.live.length).toBe(posts); // nothing new to say yet
    await h.run(15_000);
    expect(h.core.live.length).toBe(posts + 1); // the 30 s heartbeat
    expect(h.core.live.at(-1)!.seq).toBeGreaterThan(first.seq);
    h.sim.skipByHand();
    await h.run(5_000);
    expect(h.reads).toHaveLength(2);
    const after = h.core.live.at(-1)!;
    expect(after).toMatchObject({
      gen: 2,
      track: { title: 'Chill Loop' },
      link: { uri: 'spotify:track:1SIMext0playlist0trak2' },
      ended: null, // already delivered
    });
    // How the first one ended went to Core once, with the change.
    const ended = h.core.live.filter((m) => m.ended);
    expect(ended).toHaveLength(1);
    expect(ended[0]!.ended).toMatchObject({
      gen: 1,
      playing: true,
      cause: 'change',
    });
    // A pause in the app: told to Core at once, no reading.
    h.sim.pauseByHand();
    await h.run(1_000);
    expect(h.core.live.at(-1)!.state).toBe('paused');
    expect(h.reads).toHaveLength(2);
    expect(h.rt.liveView()!.counters).toMatchObject({
      link_reads: 2,
      linked: 2,
      link_misses: 0,
    });
  });

  it('during a 429 no more reading: the live state still goes, without its exact track', async () => {
    const h = await harness();
    h.sim.rateLimit(3_600, true);
    await h.run(10_000);
    // One call meets the 429 (Spotify says so), then not one more — even across track changes.
    expect(h.reads.length).toBeLessThanOrEqual(1);
    const met = h.reads.length;
    h.sim.skipByHand();
    await h.run(5_000);
    h.sim.skipByHand();
    await h.run(5_000);
    expect(h.reads).toHaveLength(met);
    expect(h.core.live.at(-1)).toMatchObject({
      gen: 3,
      link: null,
      track: { title: 'Late Night Drive' },
    });
  });

  it('a track change while Spotify limits us: the link is given up, the loop never spins (no cycle at 0 ms)', async () => {
    const h = await harness();
    await h.run(3_000);
    h.sim.rateLimit(3_600, true);
    await h.api.playback(true).catch(() => null); // Studio meets the 429 (it knows it is limited)
    const syncs = h.core.syncs;
    h.sim.skipByHand();
    h.src.step();
    const delays: number[] = [];
    for (let n = 0; n < 10; n++) {
      const d = await h.rt.once();
      delays.push(d);
      h.clock.t += d;
      h.src.step();
    }
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(1_000);
    expect(h.core.syncs - syncs).toBe(10);
    expect(h.core.live.at(-1)).toMatchObject({
      track: { title: 'Chill Loop' },
      link: null,
    });
  });

  it('the API still on the previous track: once more 2 s later, then never again for that occurrence', async () => {
    const h = await harness();
    await h.run(3_000);
    // Windows says a track the Web API never shows (another app's metadata, a desync): no false link.
    h.rt.onSmtc(
      line({ title: 'Jamais lue', artist: 'X', album: 'Y', t: 999_999 }),
    );
    // (the simulated Windows keeps telling the real track; stop it for this case)
    const reads = h.reads.length;
    for (let n = 0; n < 40; n++) {
      const delay = await h.rt.once();
      h.clock.t += Math.max(100, delay);
    }
    expect(h.reads.length - reads).toBe(2);
    expect(h.rt.liveView()!).toMatchObject({
      track: { title: 'Jamais lue' },
      link: null,
    });
    expect(h.rt.liveView()!.counters.link_misses).toBe(1);
    expect(h.core.live.at(-1)!.link).toBeNull();
  });

  it('a Studio that just started says nothing before Windows spoke (Core keeps the track playing open)', async () => {
    const h = await harness();
    await h.rt.once();
    await h.rt.once();
    expect(h.core.live).toHaveLength(0);
    h.src.step();
    await h.rt.once();
    expect(h.core.live.at(-1)).toMatchObject({ state: 'playing', gen: 1 });
  });

  it('the overlay: the requester only when Core’s request is THIS exact track (its uri), its name read once', async () => {
    const h = await harness();
    await h.run(3_000);
    const uri = h.rt.liveView()!.link!.uri;
    const entry = (request_id: string, track_uri: string) => ({
      request_id,
      track_uri,
      state: 'PLAYING' as const,
      auto_skip: false,
      queued_at: new Date(0).toISOString(),
    });
    // Core attributes ANOTHER track to the request playing: no requester on the overlay.
    h.core.answer = {
      ...h.core.answer,
      queue: [entry('r-1', 'spotify:track:0000000000000000000000')],
      current_request_id: 'r-1',
    };
    await h.run(1_000);
    expect(h.rt.overlayLive()).toMatchObject({
      state: 'playing',
      request: null,
      track: { title: 'Lofi Stream Beat' },
    });
    // This exact track: a request, its name once Core's state is read.
    h.core.state = {
      current: { request_id: 'r-2', viewer: { name: 'Fan2', login: 'fan2' } },
    };
    h.core.answer = {
      ...h.core.answer,
      queue: [entry('r-2', uri)],
      current_request_id: 'r-2',
    };
    await h.run(1_000);
    expect(h.rt.overlayLive().request).toEqual({ by: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.rt.overlayLive().request).toEqual({ by: 'Fan2' });
  });

  it('an older Core without the live route: not asked again for 10 min (never a loop)', async () => {
    const h = await harness({ coreLive: '404' });
    await h.run(60_000);
    expect(h.core.live).toHaveLength(0);
    expect(h.core.syncs).toBeGreaterThan(5); // the rest of Studio goes on
  });
});
