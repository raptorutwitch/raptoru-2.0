import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
import { ObsActions, type ObsLike } from '../src/channel-points/obs-actions.js';
import { ChannelPointsRuntime } from '../src/channel-points/runtime.js';
import { EffectsPlayer } from '../src/effects/player.js';
import { BRB, Brb } from '../src/interactions/brb.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';

// BRB (P0.2, docs/EFFECTS_PLAYER.md § 10) on a SIMULATED OBS (the real OBS is never touched: no real capture, no real
// mute) with a virtual clock: the SAMMI timeline (screen capture at 0, camera at 0.6 s, layer + mutes at 1.2 s, unmute at
// 7.2 s), captures handed to the effects player and dropped at the end, start condition, safe unmute (manual change,
// error, Studio restart, OBS outage), one BRB at a time, then the chain from Points de chaîne with the real Lab Core.

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'brb-'));
  cleanups.push(() => rm(d, { recursive: true, force: true }));
  return d;
};

/** Virtual time: sleeping advances it at once; `at(ms, fn)` runs fn when the time passes ms (deterministic). */
function clock() {
  const hooks: { t: number; fn: () => unknown }[] = [];
  const c = {
    t: 0,
    now: () => c.t,
    at: (t: number, fn: () => unknown) => {
      hooks.push({ t, fn });
      hooks.sort((a, b) => a.t - b.t);
    },
    sleep: async (ms: number) => {
      const target = c.t + ms;
      while (hooks.length && hooks[0]!.t <= target) {
        const h = hooks.shift()!;
        c.t = Math.max(c.t, h.t);
        await h.fn();
      }
      c.t = target;
      await Promise.resolve();
    },
  };
  return c;
}

/** A PNG-like payload naming its source and time (the capture content check). */
const shot = (source: string, t: number) =>
  Buffer.from(`PNG ${source} @${t}`).toString('base64');

/** A tiny OBS: program scene, screenshots of the two sources, mute state of the audio inputs; every action logged. */
class FakeObs implements ObsLike {
  connected = true;
  program = 'Scène Fullscreen';
  muted = new Map<string, boolean>([
    ['Micro', false],
    ['Musique Isolée', false],
  ]);
  log: { t: number; what: string }[] = [];
  constructor(private readonly c: { now: () => number }) {}
  async request(type: string, d: Record<string, unknown>) {
    if (!this.connected) throw new Error('obs_offline');
    const note = (what: string) => this.log.push({ t: this.c.now(), what });
    switch (type) {
      case 'GetCurrentProgramScene':
        return { currentProgramSceneName: this.program };
      case 'GetSourceScreenshot':
        if (!['Écran', 'overlay cam shushu'].includes(String(d.sourceName)))
          throw Object.assign(new Error('x'), { code: 600 });
        note(`capture ${d.sourceName}`);
        return {
          imageData: `data:image/png;base64,${shot(String(d.sourceName), this.c.now())}`,
        };
      case 'GetInputMute':
        if (!this.muted.has(String(d.inputName)))
          throw Object.assign(new Error('x'), { code: 600 });
        return { inputMuted: this.muted.get(String(d.inputName)) };
      case 'SetInputMute':
        this.muted.set(String(d.inputName), d.inputMuted === true);
        note(`${d.inputMuted ? 'mute' : 'unmute'} ${d.inputName}`);
        return {};
    }
    throw new Error(`unexpected ${type}`);
  }
}

/** The effects player as BRB sees it: ready or not; records what it is asked to show. */
function fakeEffects(c: { now: () => number }, ready = true) {
  const shown: { t: number; screen: string; cam: string }[] = [];
  const effects = {
    status: () => ({ url: '', connected: ready, audio: ready, playing: 0 }),
    // The video plays to its end (the page part is tested with the real player and in Playwright).
    play: async (e: { kind: string; screen: Buffer; cam: Buffer }) => {
      shown.push({
        t: c.now(),
        screen: e.screen.toString(),
        cam: e.cam.toString(),
      });
      return { end: Promise.resolve({ event: 'completed' as const }) };
    },
    handle: async () => false,
    sounds: () => [],
    videos: () => [],
    interactionMedia: () => [],
  } as unknown as EffectsPlayer;
  return { effects, shown };
}

async function setup(ready = true) {
  const c = clock();
  const obs = new FakeObs(c);
  const file = join(await tmp(), 'obs-reverts.json');
  const actions = await ObsActions.open(file, () => obs, c.now);
  const fx = fakeEffects(c, ready);
  const brb = new Brb({
    obs: actions,
    effects: fx.effects,
    now: c.now,
    sleep: c.sleep,
  });
  return { c, obs, actions, file, brb, fx };
}

describe('BRB — SAMMI timeline on OBS', () => {
  it('screen captured at 0, camera at 0.6 s, layer with BOTH captures + Micro and Musique Isolée muted at 1.2 s, unmuted at 7.2 s', async () => {
    const { obs, brb, fx, actions } = await setup();
    expect(await brb.start().end).toEqual({ event: 'completed' });
    expect(obs.log).toEqual([
      { t: 0, what: 'capture Écran' },
      { t: 600, what: 'capture overlay cam shushu' },
      { t: 1200, what: 'mute Micro' },
      { t: 1200, what: 'mute Musique Isolée' },
      { t: 7230, what: 'unmute Micro' },
      { t: 7230, what: 'unmute Musique Isolée' },
    ]);
    // The images are the ones taken at those instants (no stale capture).
    expect(fx.shown).toEqual([
      {
        t: 1200,
        screen: 'PNG Écran @0',
        cam: 'PNG overlay cam shushu @600',
      },
    ]);
    expect(actions.pending).toBe(0);
  });

  it('start condition: only from Dessin, Fullscreen or PS5 — elsewhere nothing (no capture, no mute), the refund impossibility said', async () => {
    for (const scene of BRB.from) {
      const { obs, brb } = await setup();
      obs.program = scene;
      expect((await brb.start().end).event).toBe('completed');
    }
    const { obs, brb, fx } = await setup();
    obs.program = 'Just Chatting';
    expect(await brb.start().end).toEqual({
      event: 'failed',
      error:
        'BRB refusé : scène « Just Chatting » non prévue (aucun remboursement possible : récompense créée par SAMMI)',
    });
    expect(obs.log).toEqual([]);
    expect(fx.shown).toEqual([]);
  });

  it('effects player absent: nothing done (no capture, no mute without the animation)', async () => {
    const { obs, brb } = await setup(false);
    expect(await brb.start().end).toEqual({
      event: 'failed',
      error:
        'BRB annulé : lecteur d’effets non ouvert (aucune capture, aucune coupure)',
    });
    expect(obs.log).toEqual([]);
  });

  it('one BRB at a time: a second one during the effect is refused; the next one after the end runs', async () => {
    const { brb } = await setup();
    const first = brb.start().end;
    expect(() => brb.start()).toThrow('BRB déjà en cours');
    await first;
    const { brb: other } = await setup();
    expect((await other.start().end).event).toBe('completed');
  });

  it('manual change kept: Micro unmuted by hand during the effect is not touched; an input muted BEFORE stays muted', async () => {
    const { c, obs, brb } = await setup();
    obs.muted.set('Musique Isolée', true); // muted before BRB
    c.at(3000, () => obs.muted.set('Micro', false)); // the streamer unmutes the mic by hand
    await brb.start().end;
    expect(obs.muted.get('Musique Isolée')).toBe(true);
    expect(obs.muted.get('Micro')).toBe(false);
    expect(obs.log.map((l) => l.what)).toEqual([
      'capture Écran',
      'capture overlay cam shushu',
      'mute Micro',
      'mute Musique Isolée', // already muted: no change, and never unmuted after
    ]);
  });

  it('missing audio input: the effect still runs (as SAMMI), the history names the input not muted', async () => {
    const { obs, brb } = await setup();
    obs.muted.delete('Musique Isolée');
    expect(await brb.start().end).toEqual({
      event: 'failed',
      error: 'BRB joué, coupure impossible : Musique Isolée',
    });
    expect(obs.muted.get('Micro')).toBe(false); // restored
  });

  it('OBS error: capture refused → stopped before any mute; OBS lost after the mutes → unmuted when OBS is back', async () => {
    const { obs, brb } = await setup();
    const real = obs.request.bind(obs);
    obs.request = async (t, d) => {
      if (t === 'GetSourceScreenshot' && d.sourceName === 'overlay cam shushu')
        throw Object.assign(new Error('x'), { code: 600 });
      return real(t, d);
    };
    expect(await brb.start().end).toEqual({
      event: 'failed',
      error: 'la source « overlay cam shushu » introuvable dans OBS',
    });
    expect(obs.log.map((l) => l.what)).toEqual(['capture Écran']);
    const lost = await setup();
    lost.c.at(2000, () => (lost.obs.connected = false));
    await lost.brb.start().end;
    expect(lost.obs.muted.get('Micro')).toBe(true);
    expect(lost.actions.pending).toBe(2);
    lost.obs.connected = true;
    await lost.actions.tick();
    expect(lost.obs.muted.get('Micro')).toBe(false);
    expect(lost.obs.muted.get('Musique Isolée')).toBe(false);
  });

  it('Studio restarted during the effect: the mutes are undone from obs-reverts.json, nothing replayed (no new capture)', async () => {
    const { c, obs, file } = await setup();
    const actions = await ObsActions.open(file, () => obs, c.now);
    let stopped!: () => void;
    const reached = new Promise<void>((r) => (stopped = r));
    const brb = new Brb({
      obs: actions,
      effects: fakeEffects(c).effects,
      now: c.now,
      // Studio « stops » at 2 s.
      sleep: (ms) => {
        if (c.t + ms <= 2000) return c.sleep(ms);
        stopped();
        return new Promise(() => {});
      },
    });
    void brb.start().end;
    await reached;
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveLength(2);
    c.t = 8000;
    const restarted = await ObsActions.open(file, () => obs, c.now);
    await restarted.tick();
    expect([...obs.muted.values()]).toEqual([false, false]);
    expect(obs.log.filter((l) => l.what.startsWith('capture'))).toHaveLength(2);
    expect(restarted.pending).toBe(0);
  });
});

/** The real effects player with a simulated page (HTTP), media from a temp store. */
async function realPlayer() {
  const dir = await tmp();
  const src = await tmp();
  await (
    await import('node:fs/promises')
  ).writeFile(join(src, "We'll be right back_3.webm"), 'webm');
  const media = await AlertMediaStore.open(join(dir, 'media'));
  await media.import([
    {
      name: "We'll be right back_3.webm",
      from: join(src, "We'll be right back_3.webm"),
    },
  ]);
  let p: EffectsPlayer | null = null;
  let origin = '';
  const server: Server = createServer((req, res) => {
    void p!.handle(req, res, new URL(req.url!, origin)).then((done) => {
      if (!done) res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => server.close(() => r(undefined))));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  p = await EffectsPlayer.create({
    dir,
    origin,
    media,
    playerDir: join(import.meta.dirname, '..', 'effects-player'),
  });
  const token = p.url.split('#')[1]!;
  const pageId = randomUUID();
  const call = async (path: string, body: object = {}) =>
    (await (
      await fetch(`${origin}/effects/player/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-effects-token': token,
        },
        body: JSON.stringify({
          player: pageId,
          version: await p!.playerVersion(),
          ...body,
        }),
      })
    ).json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  // The real page carries the version of the files it runs.
  const version = await p.playerVersion();
  await call('heartbeat', { audio: true, version });
  return { p, origin, call };
}

describe('Effects player — BRB layer with in-memory captures', () => {
  it('captures served to the page only during the effect (PNG), then dropped; BRB video at volume 1', async () => {
    const { p, origin, call } = await realPlayer();
    expect(p.interactionMedia()).toEqual([
      { id: 'brb-video', label: 'BRB — We’ll be right back', available: true },
    ]);
    const playing = p.play({
      kind: 'wbrb',
      screen: Buffer.from('SCREEN'),
      cam: Buffer.from('CAM'),
    });
    let got: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let i = 0; i < 50 && !got.length; i++)
      got = (await call('next')).effects;
    const x = got[0];
    expect(x).toMatchObject({
      kind: 'wbrb',
      url: 'media/brb-video',
      volume: 1,
    });
    const screen = await fetch(`${origin}/effects/${x.images.screen}`);
    expect(screen.headers.get('content-type')).toBe('image/png');
    expect(await screen.text()).toBe('SCREEN');
    expect(
      await (await fetch(`${origin}/effects/${x.images.cam}`)).text(),
    ).toBe('CAM');
    expect(p.capturesHeld).toBe(2);
    await call('report', { delivery_id: x.delivery_id, event: 'started' });
    const { end } = await playing;
    await call('report', { delivery_id: x.delivery_id, event: 'completed' });
    expect(await end).toEqual({ event: 'completed' });
    expect(p.capturesHeld).toBe(0);
    expect((await fetch(`${origin}/effects/${x.images.screen}`)).status).toBe(
      404,
    );
    // A BRB that never starts (no page took it) leaves nothing either.
    const lonely = await realPlayer();
    await expect(
      lonely.p.play({
        kind: 'wbrb',
        screen: Buffer.from('S'),
        cam: Buffer.from('C'),
      }),
    ).rejects.toThrow('effects_player_offline');
    expect(lonely.p.capturesHeld).toBe(0);
  }, 15_000);
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

describe('BRB from Points de chaîne — chain with the real Lab Core (simulated OBS)', () => {
  it('rule « Interaction : BRB » saved; « Tester » refused from a wrong scene with the reason; a second one while running refused', async () => {
    const core = await labCore();
    const obs = new FakeObs({ now: Date.now });
    obs.program = 'Just Chatting';
    let rt: ChannelPointsRuntime | null = null;
    const studio = createServer((req, res) => {
      void rt!.handle(req, res, new URL(req.url!, origin)).then((d) => {
        if (!d) res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => studio.listen(0, '127.0.0.1', r));
    cleanups.push(() => new Promise((r) => studio.close(() => r(undefined))));
    const origin = `http://127.0.0.1:${(studio.address() as AddressInfo).port}`;
    rt = await ChannelPointsRuntime.create({
      core,
      environment: 'lab',
      channelId: '900100',
      origin,
      dir: await tmp(),
      obs: () => obs,
      effects: fakeEffects({ now: Date.now }).effects,
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
      return (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    await core('/v1/lab/channel-points/rewards', {
      channel_id: '900100',
      rewards: [
        {
          id: 'reward-brb',
          title: 'Be Right Back',
          cost: 1500,
          is_enabled: true,
        },
      ],
    });
    expect(
      await api('/rules/reward-brb', {
        enabled: true,
        actions: [{ type: 'interaction', interaction: 'brb' }],
      }),
    ).toMatchObject({ version: 1 });
    await api('/test', { reward_id: 'reward-brb' });
    expect(await rt.once()).toBe(true);
    let state = await api('/state');
    for (let i = 0; i < 50 && state.recent[0].status === 'pending'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      state = await api('/state');
    }
    expect(state.recent[0]).toMatchObject({
      status: 'failed',
      results: [
        {
          status: 'failed',
          error:
            'BRB refusé : scène « Just Chatting » non prévue (aucun remboursement possible : récompense créée par SAMMI)',
        },
      ],
    });
    expect(obs.log).toEqual([]);
    // From Fullscreen: it runs (its end comes later); a second test meanwhile is refused at once.
    obs.program = 'Scène Fullscreen';
    await api('/test', { reward_id: 'reward-brb' });
    expect(await rt.once()).toBe(true);
    await api('/test', { reward_id: 'reward-brb' });
    expect(await rt.once()).toBe(true);
    state = await api('/state');
    expect(state.recent[0]).toMatchObject({
      status: 'failed',
      results: [{ status: 'failed', error: 'BRB déjà en cours' }],
    });
    expect(state.recent[1]).toMatchObject({
      status: 'pending',
      results: [{ status: 'pending', progress: 'playing' }],
    });
  }, 20_000);
});
