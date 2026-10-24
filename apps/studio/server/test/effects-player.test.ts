import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { systemClock } from '../../../core-api/src/clock.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import { AlertMediaStore } from '../src/alerts/media-store.js';
import type { ObsLike } from '../src/channel-points/obs-actions.js';
import { ChannelPointsRuntime } from '../src/channel-points/runtime.js';
import { EffectsPlayer } from '../src/effects/player.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';

// Effects player P0.1 (docs/EFFECTS_PLAYER.md): Studio hands an effect sound to ONE page at once (never two), waits for
// its start, follows its end; refuses with a readable code when the page is absent / muted, the media is not imported
// or too many effects play; nothing replayed after a restart. Then the whole chain with the real Lab Core: a reward
// with an effect sound → Studio job → page → « playing » → « done ». The page is simulated over HTTP here (the real
// page runs in Playwright: e2e/players.e2e.ts); no OBS, no Twitch.

const CH = '900100';
const PLAYER_DIR = join(import.meta.dirname, '..', 'effects-player');
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'effects-'));
  cleanups.push(() => rm(d, { recursive: true, force: true }));
  return d;
};

/** A media store with fake copies of some catalogue files (bytes only: the page is simulated). */
async function store(
  dir: string,
  files = ['ErenScream.ogg', 'Tiens bon !.ogg'],
) {
  const src = await tmp();
  for (const f of files) await writeFile(join(src, f), `OggS fake ${f}`);
  const s = await AlertMediaStore.open(join(dir, 'media'));
  await s.import(files.map((name) => ({ name, from: join(src, name) })));
  return s;
}

/** A Studio HTTP server around a handler (same host / origin checks as Studio). */
async function serve(
  handle: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
    url: URL,
  ) => Promise<boolean>,
) {
  let origin = '';
  const server: Server = createServer((req, res) => {
    void handle(req, res, new URL(req.url!, origin)).then((done) => {
      if (!done) res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => server.close(() => r(undefined))));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return origin;
}

/** A simulated player page (what player.js does over HTTP), running the files Studio serves unless `version` says otherwise. */
function page(
  origin: string,
  token: string,
  id = randomUUID(),
  version?: string,
) {
  let v = version ?? '';
  const call = async (path: string, body: object = {}) => {
    const res = await fetch(`${origin}/effects/player/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-effects-token': token },
      body: JSON.stringify({ player: id, version: v, ...body }),
    });
    return { status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return {
    heartbeat: async (audio = true) => {
      // The real page gets its version from player.html: here from Studio's answer (unless forced).
      const first = await call('heartbeat', { audio });
      if (
        version !== undefined ||
        !first.body.version ||
        first.body.version === v
      )
        return first;
      v = first.body.version;
      return call('heartbeat', { audio });
    },
    next: async () =>
      (await call('next')).body.effects as {
        delivery_id: string;
        url: string;
        volume: number;
        kind: string;
      }[],
    report: (delivery_id: string, event: string, error?: string) =>
      call('report', { delivery_id, event, ...(error ? { error } : {}) }),
  };
}

async function player(rules = {}) {
  const dir = await tmp();
  let p: EffectsPlayer | null = null;
  const origin = await serve((req, res, url) => p!.handle(req, res, url));
  p = await EffectsPlayer.create({
    dir,
    origin,
    media: await store(dir),
    playerDir: PLAYER_DIR,
    rules,
  });
  const token = p.url.split('#')[1]!;
  return { p, origin, token, dir };
}

/** Waits until the page took something (play() hands it over asynchronously). */
async function taken(pg: ReturnType<typeof page>, n = 1) {
  const out = [];
  for (let i = 0; i < 50 && out.length < n; i++) {
    out.push(...(await pg.next()));
    if (out.length < n) await new Promise((r) => setTimeout(r, 10));
  }
  return out;
}

describe('Effects player', () => {
  it('readable refusals: page absent, page muted, media not imported, unknown sound', async () => {
    const { p, origin, token } = await player();
    await expect(
      p.play({ kind: 'sound', id: 'eren-scream', volume: 100 }),
    ).rejects.toThrow('effects_player_offline');
    const pg = page(origin, token);
    await pg.heartbeat(false);
    await expect(
      p.play({ kind: 'sound', id: 'eren-scream', volume: 100 }),
    ).rejects.toThrow('effects_player_muted');
    await pg.heartbeat(true);
    await expect(
      p.play({ kind: 'sound', id: 'glory-holes', volume: 100 }),
    ).rejects.toThrow('effect_media_missing');
    await expect(
      p.play({ kind: 'sound', id: 'nope', volume: 100 }),
    ).rejects.toThrow('effect_unknown');
    expect(p.status()).toMatchObject({
      connected: true,
      audio: true,
      playing: 0,
    });
    expect(
      p
        .sounds()
        .filter((s) => s.available)
        .map((s) => s.id),
    ).toEqual(['eren-scream', 'tiens-bon']);
  });

  it('immediate hand-over to ONE page, volume given, start awaited, end followed; two sounds overlap', async () => {
    const { p, origin, token } = await player();
    const a = page(origin, token);
    const b = page(origin, token);
    await a.heartbeat();
    const first = p.play({ kind: 'sound', id: 'eren-scream', volume: 100 });
    const second = p.play({ kind: 'sound', id: 'tiens-bon', volume: 41 });
    const got = await taken(a, 2);
    expect(await b.next()).toEqual([]); // never a second page
    expect(got.map((x) => [x.url, x.volume, x.kind])).toEqual([
      ['media/eren-scream', 1, 'sound'],
      ['media/tiens-bon', 0.41, 'sound'],
    ]);
    // Another page cannot report for them.
    await b.report(got[0]!.delivery_id, 'started');
    await a.report(got[0]!.delivery_id, 'started');
    await a.report(got[1]!.delivery_id, 'started');
    const [one, two] = await Promise.all([first, second]);
    expect(p.status().playing).toBe(2); // both at once
    await a.report(got[1]!.delivery_id, 'completed');
    expect(await two.end).toEqual({ event: 'completed' });
    await a.report(got[0]!.delivery_id, 'failed', 'playback_error');
    expect(await one.end).toEqual({ event: 'failed', error: 'playback_error' });
    expect(p.status().playing).toBe(0);
  });

  it('not taken in time → player absent; taken, never started → start timeout; started, no end → unknown; cap', async () => {
    const { p, origin, token } = await player({
      pickupMs: 50,
      startMs: 50,
      endMs: 80,
      maxActive: 1,
    });
    const pg = page(origin, token);
    await pg.heartbeat();
    await expect(
      p.play({ kind: 'sound', id: 'eren-scream', volume: 100 }),
    ).rejects.toThrow('effects_player_offline');
    const blocked = p.play({ kind: 'sound', id: 'eren-scream', volume: 100 });
    await taken(pg);
    await expect(blocked).rejects.toThrow('effect_start_timeout');
    const lost = p.play({ kind: 'sound', id: 'eren-scream', volume: 100 });
    const [x] = await taken(pg);
    await pg.report(x!.delivery_id, 'started');
    const { end } = await lost;
    await expect(
      p.play({ kind: 'sound', id: 'tiens-bon', volume: 50 }),
    ).rejects.toThrow('effects_busy');
    expect(await end).toEqual({
      event: 'unknown',
      error: 'playback_not_confirmed',
    });
  });

  it('page token required; media served for catalogue sounds only; a restart keeps the token and replays nothing', async () => {
    const { p, origin, token, dir } = await player();
    const bad = page(origin, 'f'.repeat(32));
    expect((await bad.heartbeat()).status).toBe(403);
    const media = await fetch(`${origin}/effects/media/eren-scream`);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('audio/ogg');
    expect(await media.text()).toBe('OggS fake ErenScream.ogg');
    expect((await fetch(`${origin}/effects/media/glory-holes`)).status).toBe(
      404,
    );
    expect(
      (await fetch(`${origin}/effects/media/..%2Fplayer-token`)).status,
    ).toBe(404);
    const html = await fetch(`${origin}/effects/player.html`);
    expect(html.headers.get('content-security-policy')).toContain(
      "media-src 'self'",
    );
    // An effect handed over, then Studio restarts: the new instance has the same OBS URL and nothing to hand out.
    const pg = page(origin, token);
    await pg.heartbeat();
    void p
      .play({ kind: 'sound', id: 'eren-scream', volume: 100 })
      .catch(() => {});
    const again = await EffectsPlayer.create({
      dir,
      origin,
      media: await AlertMediaStore.open(join(dir, 'media')),
      playerDir: PLAYER_DIR,
    });
    expect(again.url).toBe(p.url);
    expect((await readFile(join(dir, 'player-token'), 'utf8')).trim()).toBe(
      token,
    );
    expect(again.status().playing).toBe(0);
  });
});

describe('Effects player — stale OBS page (BRB fix)', () => {
  it('a page without the current version gets nothing and Studio says « à recharger » (never invalid_effect); current / stale_ok pages play', async () => {
    const { p, origin, token } = await player();
    // The OBS page loaded before an update (older code: no version in its calls).
    const old = page(origin, token, randomUUID(), '');
    await old.heartbeat();
    expect(p.status()).toMatchObject({
      connected: true,
      audio: true,
      current: false,
    });
    await expect(
      p.play({ kind: 'sound', id: 'eren-scream', volume: 100 }),
    ).rejects.toThrow('effects_player_outdated');
    expect(await old.next()).toEqual([]);
    // The served page carries the version it runs; Studio answers the current one.
    const html = await (await fetch(`${origin}/effects/player.html`)).text();
    const version =
      /name="effects-player-version" content="([a-f0-9]{16})"/.exec(html)?.[1];
    expect(version).toBe(await p.playerVersion());
    const fresh = page(origin, token, randomUUID(), version);
    expect((await fresh.heartbeat()).body.version).toBe(version);
    expect(p.status().current).toBe(true);
    const playing = p.play({ kind: 'sound', id: 'eren-scream', volume: 100 });
    const [x] = await taken(fresh);
    await fresh.report(x!.delivery_id, 'started');
    await playing;
  });
});

describe('Effects player — effect videos (NTM)', () => {
  it('a video is handed with its legacy presentation and volume; streamed as video/webm; kinds never mixed', async () => {
    const dir = await tmp();
    let p: EffectsPlayer | null = null;
    const origin = await serve((req, res, url) => p!.handle(req, res, url));
    p = await EffectsPlayer.create({
      dir,
      origin,
      media: await store(dir, ['Fuck You.webm']),
      playerDir: PLAYER_DIR,
    });
    expect(p.videos()).toEqual([
      { id: 'fuck-you', label: 'NTM — Fuck You', volume: 10, available: true },
    ]);
    const pg = page(origin, p.url.split('#')[1]!);
    await pg.heartbeat();
    await expect(
      p.play({ kind: 'video', id: 'eren-scream', volume: 10 }),
    ).rejects.toThrow('effect_unknown');
    await expect(
      p.play({ kind: 'sound', id: 'fuck-you', volume: 10 }),
    ).rejects.toThrow('effect_unknown');
    const playing = p.play({ kind: 'video', id: 'fuck-you', volume: 10 });
    const [x] = await taken(pg);
    expect(x).toMatchObject({
      kind: 'video',
      effect_id: 'fuck-you',
      url: 'media/fuck-you',
      volume: 0.1,
      presentation: {
        mirror: 0.35,
        rise: true,
        ducking: { audible: 4, step: 0.25, min: 0.125 },
      },
    });
    await pg.report(x!.delivery_id, 'started');
    const { end } = await playing;
    await pg.report(x!.delivery_id, 'completed');
    expect(await end).toEqual({ event: 'completed' });
    const media = await fetch(`${origin}/effects/media/fuck-you`);
    expect(media.headers.get('content-type')).toBe('video/webm');
    expect(await media.text()).toBe('OggS fake Fuck You.webm');
  });
});

async function labCore() {
  const db = createPgliteDb(
    new PGlite({
      parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
    }),
  );
  await migrate(db, 'lab');
  const secret = randomBytes(32).toString('hex');
  const server: Server = createLabCore({
    db,
    clock: systemClock,
    secret,
  }).server;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(async () => {
    server.close();
    await db.close();
  });
  return localLabCoreClient(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    secret,
  );
}

describe('Points de chaîne → effects player — chain with the real Lab Core', () => {
  it('rule saved and kept; « Tester » plays the effect once (playing → done); player absent = readable failure; no Soundboard', async () => {
    const core = await labCore();
    const dir = await tmp();
    let rt: ChannelPointsRuntime | null = null;
    const origin = await serve((req, res, url) => rt!.handle(req, res, url));
    const effects = await EffectsPlayer.create({
      dir,
      origin,
      media: await store(dir),
      playerDir: PLAYER_DIR,
    });
    const obs: ObsLike = {
      connected: true,
      request: async () => {
        throw new Error('OBS must not be called');
      },
    };
    rt = await ChannelPointsRuntime.create({
      core,
      environment: 'lab',
      channelId: CH,
      origin,
      dir,
      obs: () => obs,
      effects,
      twitch: () => ({ scope: true, adapter_running: true }),
    });
    const api = async (path: string, body?: unknown) => {
      const res = await fetch(`${origin}/api/channel-points${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'x-raptoru-studio': '1',
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    await core('/v1/lab/channel-points/rewards', {
      channel_id: CH,
      rewards: [
        { id: 'reward-eren', title: 'Eren cri', cost: 1500, is_enabled: true },
      ],
    });
    expect(
      (
        await api('/rules/reward-eren', {
          enabled: true,
          actions: [
            { type: 'effect_sound', sound_id: 'eren-scream', volume: 100 },
          ],
        })
      ).body,
    ).toMatchObject({ version: 1 });
    let state = (await api('/state')).body;
    expect(state.rewards[0].rule).toMatchObject({
      enabled: true,
      actions: [{ type: 'effect_sound', sound_id: 'eren-scream', volume: 100 }],
    });
    expect(state.effects).toMatchObject({ connected: false, playing: 0 });
    expect(state.effects.url).toBe(effects.url);
    // Player absent: the test fails with a readable reason, nothing waits.
    await api('/test', { reward_id: 'reward-eren' });
    expect(await rt.once()).toBe(true);
    expect((await api('/state')).body.recent[0]).toMatchObject({
      status: 'failed',
      results: [{ status: 'failed', error: 'effects_player_offline' }],
    });
    // The page is open: played once, done when it reports the end.
    const pg = page(origin, effects.url.split('#')[1]!);
    await pg.heartbeat();
    await api('/test', { reward_id: 'reward-eren' });
    const ran = rt.once();
    const [x] = await taken(pg);
    expect(x).toMatchObject({ url: 'media/eren-scream', volume: 1 });
    await pg.report(x!.delivery_id, 'started');
    expect(await ran).toBe(true);
    state = (await api('/state')).body;
    expect(state.recent[0]).toMatchObject({
      status: 'pending',
      results: [{ status: 'pending', progress: 'playing' }],
    });
    expect(state.effects.playing).toBe(1);
    expect(await rt.once()).toBe(false); // nothing replayed
    await pg.report(x!.delivery_id, 'completed');
    for (let i = 0; i < 50; i++) {
      state = (await api('/state')).body;
      if (state.recent[0].status !== 'pending') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(state.recent[0]).toMatchObject({
      status: 'done',
      results: [{ status: 'done' }],
    });
    expect(await pg.next()).toEqual([]);
  });
});

describe('Effects player: a sound imported from Studio (Votekick launch sound)', () => {
  it('imported by its bytes (content-addressed), played and served like a catalogue sound; anything else refused', async () => {
    const dir = await tmp();
    let p: EffectsPlayer | null = null;
    const origin = await serve((req, res, url) => p!.handle(req, res, url));
    p = await EffectsPlayer.create({
      dir,
      origin,
      media: await store(dir),
      playerDir: PLAYER_DIR,
      uploadsDir: join(dir, 'uploads'),
    });
    const mp3 = Buffer.concat([Buffer.from('ID3'), randomBytes(64)]);
    const up = await p.importSound(mp3, 'lancement\u0007.mp3');
    expect(up.id).toMatch(/^upload:[a-f0-9]{64}\.mp3$/);
    expect(up.name).toBe('lancement.mp3'); // control characters dropped
    expect((await p.importSound(mp3, 'x.mp3')).id).toBe(up.id); // same bytes, same file
    await expect(
      p.importSound(Buffer.from('<html>not a sound</html>'), 'x.mp3'),
    ).rejects.toThrow('unsupported_audio');
    await expect(p.importSound(Buffer.alloc(0), 'x.mp3')).rejects.toThrow(
      'empty_file',
    );

    const res = await fetch(`${origin}/effects/media/${up.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await res.arrayBuffer()).equals(mp3)).toBe(true);
    // Never a path of the disk: only `upload:<sha256>.<ext>`.
    for (const bad of [
      'upload:../../secret.mp3',
      `upload:${'a'.repeat(64)}.exe`,
      `upload:${'b'.repeat(64)}.mp3`,
    ])
      expect((await fetch(`${origin}/effects/media/${bad}`)).status).not.toBe(
        200,
      );

    const pg = page(origin, p.url.split('#')[1]!);
    await pg.heartbeat();
    const playing = p.play({ kind: 'sound', id: up.id, volume: 55 });
    const [got] = await taken(pg);
    expect([got!.url, got!.volume]).toEqual([`media/${up.id}`, 0.55]);
    await pg.report(got!.delivery_id, 'started');
    await playing;
    await expect(
      p.play({ kind: 'sound', id: `upload:${'c'.repeat(64)}.mp3`, volume: 50 }),
    ).rejects.toThrow('effect_unknown');
  });

  it('through Studio’s HTTP routes: own origin only, the raw file imported, too big refused, settings read', async () => {
    const dir = await tmp();
    let rt: ChannelPointsRuntime | null = null;
    const origin = await serve((req, res, url) => rt!.handle(req, res, url));
    const core = (async (path: string) => {
      if (path === `/v1/lab/votekick/${'83603689'}/settings`)
        return { vote_seconds: 40 };
      throw Object.assign(new Error('not_found'), { status: 404 });
    }) as never;
    rt = await ChannelPointsRuntime.create({
      core,
      environment: 'lab',
      channelId: '83603689',
      origin,
      dir,
      obs: () => null,
      effects: await EffectsPlayer.create({
        dir,
        origin,
        media: await store(dir),
        playerDir: PLAYER_DIR,
        uploadsDir: join(dir, 'uploads'),
      }),
      twitch: () => ({ scope: true, adapter_running: true }),
      votekickOverlayDir: join(import.meta.dirname, '..', 'votekick-overlay'),
    });
    const send = (
      body: Buffer,
      headers: Record<string, string> = { 'x-raptoru-studio': '1' },
    ) =>
      fetch(`${origin}/api/votekick/sounds`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-sound-name': encodeURIComponent('Gong été.wav'),
          ...headers,
        },
        body: new Uint8Array(body),
      });
    const wav = Buffer.concat([Buffer.from('RIFF0000WAVE'), randomBytes(32)]);
    expect((await send(wav, {})).status).toBe(403); // not Studio's page
    expect(
      (
        await send(wav, {
          'x-raptoru-studio': '1',
          origin: 'http://evil.example',
        })
      ).status,
    ).toBe(403);
    const ok = await send(wav);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      id: expect.stringMatching(/^upload:[a-f0-9]{64}\.wav$/),
      name: 'Gong été.wav',
    });
    const big = await send(
      Buffer.concat([Buffer.from('ID3'), Buffer.alloc(5 * 1024 * 1024)]),
    );
    expect(big.status).toBe(413);
    const bad = await send(Buffer.from('MZ not a sound at all'));
    expect([bad.status, (await bad.json()).error]).toEqual([
      400,
      'unsupported_audio',
    ]);
    const settings = await fetch(`${origin}/api/votekick/settings`, {
      headers: { 'x-raptoru-studio': '1' },
    });
    expect(await settings.json()).toMatchObject({
      available: true,
      vote_seconds: 40,
      launch_sound: { enabled: false, sound: null },
    });
  });

  it('a Studio without an uploads folder refuses the import', async () => {
    const { p } = await player();
    await expect(
      p.importSound(Buffer.from('ID3 0123456789'), 'x.mp3'),
    ).rejects.toThrow('uploads_unavailable');
  });
});
