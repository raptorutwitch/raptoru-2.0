import { randomBytes } from 'node:crypto';
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
import { ObsActions, type ObsLike } from '../src/channel-points/obs-actions.js';
import { ChannelPointsRuntime } from '../src/channel-points/runtime.js';
import type { EffectsPlayer } from '../src/effects/player.js';
import { CREEPY, Interactions } from '../src/interactions/creepy.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';

// Creepy (P0.2, docs/EFFECTS_PLAYER.md § 9) on a SIMULATED OBS (the real OBS is never touched by a test) with a virtual
// clock: the SAMMI timeline (media + source at 0, sound at 0.5 s, scene at 0.8 s, source hidden at 4 s, back at 5 s,
// next Creepy after 6 s), the start condition, the temporary scene of the shared revert mechanism (manual change kept,
// OBS outage, Studio restart), no duplicate sound / visual, then the chain from Points de chaîne with the real Lab Core.

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'creepy-'));
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

const SCENES = [
  'Scène Fullscreen',
  'Just Chatting',
  'Scène PS5',
  'Scène Dessin',
  'Creepy Effect',
  'Waiting screen',
];

/** A tiny OBS: program scene, the « Prowler Effect » item of « Alerte complète », media restarts; every write logged. */
class FakeObs implements ObsLike {
  connected = true;
  program = 'Just Chatting';
  prowler = false;
  log: { t: number; what: string }[] = [];
  constructor(private readonly c: { now: () => number }) {}
  private fail(): never {
    throw Object.assign(new Error('obs_request_failed'), { code: 600 });
  }
  async request(type: string, d: Record<string, unknown>) {
    if (!this.connected) throw new Error('obs_offline');
    const note = (what: string) => this.log.push({ t: this.c.now(), what });
    switch (type) {
      case 'GetCurrentProgramScene':
        return { currentProgramSceneName: this.program };
      case 'SetCurrentProgramScene':
        if (!SCENES.includes(String(d.sceneName))) this.fail();
        this.program = String(d.sceneName);
        note(`scene ${this.program}`);
        return {};
      case 'TriggerMediaInputAction':
        if (d.inputName !== 'Prowler Effect') this.fail();
        note(`restart ${d.inputName}`);
        return {};
      case 'GetSceneItemId':
        if (
          d.sceneName !== 'Alerte complète' ||
          d.sourceName !== 'Prowler Effect'
        )
          this.fail();
        return { sceneItemId: 7 };
      case 'GetSceneItemEnabled':
        return { sceneItemEnabled: this.prowler };
      case 'SetSceneItemEnabled':
        this.prowler = d.sceneItemEnabled === true;
        note(`prowler ${this.prowler ? 'shown' : 'hidden'}`);
        return {};
    }
    throw new Error(`unexpected ${type}`);
  }
}

/** The effects player as Creepy sees it: records the sounds asked. */
function fakeEffects(c: { now: () => number }, ok = true) {
  const sounds: { t: number; id: string; volume: number }[] = [];
  const effects = {
    play: async (e: { kind: string; id: string; volume: number }) => {
      if (!ok) throw new Error('effects_player_offline');
      sounds.push({ t: c.now(), id: e.id, volume: e.volume });
      return { end: Promise.resolve({ event: 'completed' as const }) };
    },
    // What the Studio tab reads / routes (not under test here).
    handle: async () => false,
    status: () => ({ url: '', connected: true, audio: true, playing: 0 }),
    sounds: () => [],
    videos: () => [],
    interactionMedia: () => [],
  } as unknown as EffectsPlayer;
  return { effects, sounds };
}

async function setup(effectsOk = true) {
  const c = clock();
  const obs = new FakeObs(c);
  const file = join(await tmp(), 'obs-reverts.json');
  const actions = await ObsActions.open(file, () => obs, c.now);
  const { effects, sounds } = fakeEffects(c, effectsOk);
  const creepy = new Interactions({
    obs: actions,
    effects,
    now: c.now,
    sleep: c.sleep,
  });
  return { c, obs, actions, file, creepy, sounds };
}

describe('Creepy — SAMMI timeline on OBS', () => {
  it('from an allowed scene: media + source at 0, sound at 0.5 s (29 %), scene at 0.8 s, source hidden at 4 s, back at 5 s; once each', async () => {
    const { obs, creepy, sounds, actions } = await setup();
    obs.program = 'Scène Fullscreen';
    expect(await creepy.start('creepy').end).toEqual({ event: 'completed' });
    expect(obs.log).toEqual([
      { t: 0, what: 'restart Prowler Effect' },
      { t: 0, what: 'prowler shown' },
      { t: 800, what: 'scene Creepy Effect' },
      { t: 4030, what: 'prowler hidden' },
      { t: 5030, what: 'scene Scène Fullscreen' },
    ]);
    // One sound, the SAMMI one; nothing else is played or animated by Studio (OBS does the scene's look).
    expect(sounds).toEqual([{ t: 500, id: 'prowler-effect', volume: 29 }]);
    expect(actions.pending).toBe(0);
  });

  it('start condition: only from Fullscreen, Just Chatting, PS5 or Dessin — elsewhere nothing happens (readable reason)', async () => {
    for (const scene of CREEPY.from) {
      const { obs, creepy } = await setup();
      obs.program = scene;
      expect(await creepy.start('creepy').end).toEqual({ event: 'completed' });
      expect(obs.program).toBe(scene);
    }
    for (const scene of ['Waiting screen', 'Creepy Effect']) {
      const { obs, creepy, sounds } = await setup();
      obs.program = scene;
      expect(await creepy.start('creepy').end).toEqual({
        event: 'failed',
        error: `Creepy ignoré : scène « ${scene} » non prévue`,
      });
      expect(obs.log).toEqual([]);
      expect(sounds).toEqual([]);
    }
  });

  it('a manual scene change during the effect is kept (no return); the source is still hidden', async () => {
    const { c, obs, creepy } = await setup();
    // The streamer switches at 2 s (between the scene switch and the return).
    c.at(2000, () => (obs.program = 'Scène Dessin'));
    await creepy.start('creepy').end;
    expect(obs.program).toBe('Scène Dessin');
    expect(obs.prowler).toBe(false);
    expect(obs.log.map((l) => l.what)).not.toContain('scene Just Chatting');
  });

  it('two Creepy close together: the second runs after the first (SAMMI queue, 6 s), each returns to the starting scene; more than 4 waiting refused', async () => {
    const { obs, creepy, sounds } = await setup();
    const first = creepy.start('creepy').end;
    const second = creepy.start('creepy').end;
    await Promise.all([first, second]);
    expect(sounds.map((s) => s.t)).toEqual([500, 6500]);
    expect(
      obs.log
        .filter((l) => l.what.startsWith('scene'))
        .map((l) => [l.t, l.what]),
    ).toEqual([
      [800, 'scene Creepy Effect'],
      [5030, 'scene Just Chatting'],
      [6800, 'scene Creepy Effect'],
      [11030, 'scene Just Chatting'],
    ]);
    const { creepy: busy } = await setup();
    const runs = [0, 1, 2, 3, 4].map(() => busy.start('creepy').end);
    expect(() => busy.start('creepy')).toThrow('Creepy déjà en attente');
    await Promise.all(runs);
  });

  it('effects player absent: the visual still runs (as SAMMI), reported « sans son »', async () => {
    const { obs, creepy } = await setup(false);
    expect(await creepy.start('creepy').end).toEqual({
      event: 'failed',
      error: 'creepy_no_sound',
    });
    expect(obs.log.map((l) => l.what)).toContain('scene Creepy Effect');
    expect(obs.program).toBe('Just Chatting');
  });

  it('OBS lost during the effect: reported, nothing replayed; the return waits for OBS and is applied only if still on « Creepy Effect »', async () => {
    const { c, obs, creepy, actions } = await setup();
    c.at(1000, () => (obs.connected = false));
    expect((await creepy.start('creepy').end).event).toBe('completed'); // all its writes were done before the outage
    expect(actions.pending).toBe(2); // hide + return, kept for later
    obs.connected = true;
    await actions.tick();
    expect(obs.program).toBe('Just Chatting');
    expect(obs.prowler).toBe(false);
    expect(
      obs.log.filter((l) => l.what === 'restart Prowler Effect'),
    ).toHaveLength(1);
  });

  it('Studio restarted during the effect: only what is due is restored (from obs-reverts.json), nothing replayed', async () => {
    const { c, obs, file } = await setup();
    const actions = await ObsActions.open(file, () => obs, c.now);
    const creepy = new Interactions({
      obs: actions,
      effects: fakeEffects(c).effects,
      now: c.now,
      // Studio « stops » at 2 s: the run never wakes up again (its writes and their saved reverts are done).
      sleep: (ms) => {
        if (c.t + ms <= 2000) return c.sleep(ms);
        stopped();
        return new Promise(() => {});
      },
    });
    let stopped!: () => void;
    const reached = new Promise<void>((r) => (stopped = r));
    void creepy.start('creepy').end;
    await reached;
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveLength(2);
    // New Studio process at 6 s: same file, the due reverts applied once, no second sound / media / scene switch.
    c.t = 6000;
    const restarted = await ObsActions.open(file, () => obs, c.now);
    await restarted.tick();
    expect(obs.program).toBe('Just Chatting');
    expect(obs.prowler).toBe(false);
    expect(obs.log.map((l) => l.what)).toEqual([
      'restart Prowler Effect',
      'prowler shown',
      'scene Creepy Effect',
      'prowler hidden',
      'scene Just Chatting',
    ]);
    expect(restarted.pending).toBe(0);
  });
});

describe('Temporary scene (shared revert mechanism)', () => {
  it('rule « scene for a while »: back when due; over another temporary scene: back to the original one; a revert added during a check is kept', async () => {
    const { c, obs, actions } = await setup();
    await actions.run({
      type: 'obs_scene',
      scene: 'Waiting screen',
      duration_ms: 3000,
    });
    c.t = 1000;
    await actions.run({
      type: 'obs_scene',
      scene: 'Creepy Effect',
      duration_ms: 1000,
    });
    c.t = 2000;
    await actions.tick();
    expect(obs.program).toBe('Creepy Effect'); // its end follows the longer one (never stuck on a temporary)
    c.t = 3000;
    await actions.tick();
    expect(obs.program).toBe('Just Chatting');
    // An action run while a check is in progress is not lost.
    await actions.run({
      type: 'obs_scene',
      scene: 'Scène PS5',
      duration_ms: 500,
    });
    c.t = 4000;
    const checking = actions.tick();
    await actions.run({
      type: 'obs_source',
      scene: 'Alerte complète',
      source: 'Prowler Effect',
      visible: true,
      duration_ms: 1000,
    });
    await checking;
    expect(actions.pending).toBe(1);
    c.t = 5000;
    await actions.tick();
    expect(obs.prowler).toBe(false);
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

describe('Creepy from Points de chaîne — chain with the real Lab Core (real time, simulated OBS)', () => {
  it('rule « Interaction : Creepy » saved; « Tester » runs it once (en cours → exécutée) and the scene comes back', async () => {
    const core = await labCore();
    const obs = new FakeObs({ now: Date.now });
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
    rt.obs.start();
    cleanups.push(async () => rt!.obs.stop());
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
        { id: 'reward-creepy', title: 'Creepy', cost: 700, is_enabled: true },
      ],
    });
    expect(
      await api('/rules/reward-creepy', {
        enabled: true,
        actions: [{ type: 'interaction', interaction: 'creepy' }],
      }),
    ).toMatchObject({ version: 1 });
    await api('/test', { reward_id: 'reward-creepy' });
    expect(await rt.once()).toBe(true);
    expect((await api('/state')).recent[0]).toMatchObject({
      status: 'pending',
      results: [{ status: 'pending', progress: 'playing' }],
    });
    expect(await rt.once()).toBe(false); // not replayed
    let state = await api('/state');
    for (let i = 0; i < 80 && state.recent[0].status === 'pending'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      state = await api('/state');
    }
    expect(state.recent[0]).toMatchObject({
      status: 'done',
      results: [{ status: 'done' }],
    });
    expect(obs.log.map((l) => l.what)).toEqual([
      'restart Prowler Effect',
      'prowler shown',
      'scene Creepy Effect',
      'prowler hidden',
      'scene Just Chatting',
    ]);
  }, 20_000);
});
