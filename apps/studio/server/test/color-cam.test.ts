import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  COLOR_CAM,
  COLOR_CAM_PRESETS,
  colorCamSettings,
  FX_CAM,
  resolveColorCam,
} from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { systemClock } from '../../../core-api/src/clock.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import { ObsActions, type ObsLike } from '../src/channel-points/obs-actions.js';
import { ChannelPointsRuntime } from '../src/channel-points/runtime.js';
import { ColorCam, easeInOut } from '../src/interactions/color-cam.js';
import { FxCam } from '../src/interactions/fx-cam.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';

// Couleur Cam (P0.2, docs/EFFECTS_PLAYER.md § 12) on a SIMULATED OBS (the real OBS is never touched) with a virtual
// clock: the 26 SAMMI presets, the viewer's text, the 2 s In/Out transition from the filter's current values, the
// latest request winning, start condition, missing / disabled filter, OBS outage, manual change, Studio restart,
// coexistence with the FX Cam shaders, then the chain from Points de chaîne with the real Lab Core.

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'colorcam-'));
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

type Settings = Record<string, number>;
const COLOR = `${COLOR_CAM.source}|${COLOR_CAM.filter}`;

/** A tiny OBS: program scene, the Couleur Cam filter (defaults: OBS stores no key) and the FX Cam shader filters. */
class FakeObs implements ObsLike {
  connected = true;
  program = 'Scène Fullscreen';
  filters = new Map<string, { enabled: boolean; settings: Settings }>([
    [COLOR, { enabled: true, settings: {} }],
    ...FX_CAM.effects.map(
      (f) =>
        [`${FX_CAM.source}|${f}`, { enabled: false, settings: {} }] as const,
    ),
  ]);
  /** Every settings write of the colour filter (its full settings after the write). */
  writes: { t: number; s: Settings }[] = [];
  log: string[] = [];
  constructor(private readonly c: { now: () => number }) {}
  async request(type: string, d: Record<string, unknown>) {
    if (!this.connected) throw new Error('obs_offline');
    const f = () => {
      const x = this.filters.get(`${d.sourceName}|${d.filterName}`);
      if (!x) throw Object.assign(new Error('x'), { code: 600 });
      return x;
    };
    switch (type) {
      case 'GetCurrentProgramScene':
        return { currentProgramSceneName: this.program };
      case 'GetSourceFilter':
        return { filterEnabled: f().enabled, filterSettings: f().settings };
      case 'SetSourceFilterSettings': {
        const x = f();
        expect(d.overlay).toBe(true);
        x.settings = { ...x.settings, ...(d.filterSettings as Settings) };
        if (`${d.sourceName}|${d.filterName}` === COLOR)
          this.writes.push({ t: this.c.now(), s: { ...x.settings } });
        else this.log.push(`settings ${d.filterName}`);
        return {};
      }
      case 'SetSourceFilterEnabled':
        f().enabled = d.filterEnabled === true;
        this.log.push(`${d.filterEnabled ? 'on' : 'off'} ${d.filterName}`);
        return {};
    }
    throw new Error(`unexpected ${type}`);
  }
  get color() {
    return this.filters.get(COLOR)!.settings;
  }
}

async function setup() {
  const c = clock();
  const obs = new FakeObs(c);
  const actions = await ObsActions.open(
    join(await tmp(), 'obs-reverts.json'),
    () => obs,
    c.now,
  );
  const cc = new ColorCam({ obs: actions, now: c.now, sleep: c.sleep });
  return { c, obs, actions, cc };
}

const target = (name: string) => colorCamSettings(name);

describe('Couleur Cam — the 26 SAMMI presets and the viewer text (Core)', () => {
  it('names and values exactly as the SAMMI button lists (index by index)', () => {
    // The five lists of SAMMI ID45 « Couleur Shushu », copied as they are.
    const names =
      'saumon,fuschia,magenta,violet,myrtille,bleu sombre,bleu,cyan,turquoise,orange,gold,jaune,lime,vert pomme,vert,emeraude,rouge,ivoire,gris,canard,marron,givre,rose,beige,bleu ciel,noir'.split(
        ',',
      );
    const num = (s: string) => s.split(',').map(Number);
    const hue = num(
      '2.09,31,55,80,100.47,100.47,144.42,163.26,180,-18.84,-29.30,-49,-73,-89,-108.84,-144.42,0,0,0,-180,-23.02,173.72,52.33,-8.37,-180,100',
    );
    const contrast = num(
      '2.40,1.08,0.38,-0.58,-0.58,-0.17,-0.21,-0.21,0,0.08,0.38,-0.08,-0.08,-0.37,0.04,-0.42,-0.42,2.83,0,0,-0.67,3,1.96,1.96,1.96,-0.67',
    );
    const brightness = num(
      '-0.1163,-0.0233,-0.0233,-0.0233,0.0465,-0.1279,-0.0349,-0.0349,-0.0116,0.0233,0.0233,0.0233,0.0233,-0.0581,-0.2209,0,0,0.0465,-0.0233,-0.0233,-0.0233,-0.0233,-0.0233,-0.0233,-0.0233,-0.1279',
    );
    const saturation = num(
      '-0.53,-0.28,0,1.97,1.06,0.63,3.19,3.19,2.22,1.50,5,3.59,1.97,2.91,1.38,2.28,1.97,-1,-1,-0.53,-0.47,-0.78,-0.72,-0.72,-0.72,-1',
    );
    expect(COLOR_CAM_PRESETS).toHaveLength(26);
    expect(
      COLOR_CAM_PRESETS.map((p) => [
        p.name,
        p.hue_shift,
        p.contrast,
        p.brightness,
        p.saturation,
      ]),
    ).toEqual(
      names.map((n, i) => [
        n,
        hue[i],
        contrast[i],
        brightness[i],
        saturation[i],
      ]),
    );
    expect(target('rouge')).toEqual({
      gamma: 0.47,
      contrast: -0.42,
      brightness: 0,
      saturation: 1.97,
      hue_shift: 0,
    });
  });

  it('case, accents and extra spaces ignored; « aléatoire » / « random » drawn; anything else refused', () => {
    for (const t of ['rouge', 'ROUGE', '  Rouge ', 'rouge\n'])
      expect(resolveColorCam(t)).toBe('rouge');
    expect(resolveColorCam('  Bleu   Ciel ')).toBe('bleu ciel');
    expect(resolveColorCam('Émeraude')).toBe('emeraude');
    expect(resolveColorCam('aléatoire', () => 0)).toBe('saumon');
    expect(resolveColorCam('Aleatoire', () => 0.999_999)).toBe('noir');
    expect(resolveColorCam('random', () => 0.5)).toBe('vert pomme');
    for (const t of [
      '',
      undefined,
      'pourpre',
      'bleuciel',
      'rouge!',
      '#ff0000',
      '0,0,0',
    ])
      expect(resolveColorCam(t)).toBeNull();
  });
});

describe('Couleur Cam — transition on OBS', () => {
  it('rouge from a neutral filter: 2 s smooth In/Out, about 30 steps a second, exact preset at the end, then kept', async () => {
    const { obs, cc } = await setup();
    expect(await cc.start('rouge').end).toEqual({ event: 'completed' });
    const w = obs.writes;
    expect(w[0]).toEqual({
      t: 0,
      s: { gamma: 0, contrast: 0, brightness: 0, saturation: 0, hue_shift: 0 },
    });
    expect(w.at(-1)).toEqual({ t: 2013, s: target('rouge') });
    expect(w.length).toBeGreaterThanOrEqual(60);
    expect(w.length).toBeLessThanOrEqual(62);
    // Steps ~33 ms apart; the eased progress only grows (saturation 0 → 1.97).
    for (let i = 1; i < w.length; i++) {
      expect(w[i]!.t - w[i - 1]!.t).toBeLessThanOrEqual(33);
      expect(w[i]!.s.saturation!).toBeGreaterThanOrEqual(
        w[i - 1]!.s.saturation!,
      );
    }
    const mid = w.find((x) => x.t === 990)!;
    expect(mid.s.saturation).toBeCloseTo(1.97 * easeInOut(990 / 2000), 6);
    // Slow start and slow end (In/Out): the first and last quarter move less than the middle half.
    const at = (t: number) => w.find((x) => x.t >= t)!.s.saturation!;
    expect(at(500) - at(0)).toBeLessThan(at(1500) - at(500));
    // Kept: no reset afterwards.
    expect(obs.color).toEqual(target('rouge'));
  });

  it('two colours one after the other: the second starts from the first (no jump)', async () => {
    const { obs, cc } = await setup();
    await cc.start('rouge').end;
    const n = obs.writes.length;
    expect(await cc.start('bleu').end).toEqual({ event: 'completed' });
    expect(obs.writes[n]!.s).toEqual(target('rouge'));
    expect(obs.color).toEqual(target('bleu'));
  });

  it('a colour asked during a transition takes over from the values reached; the older one never writes again', async () => {
    const { c, obs, cc } = await setup();
    let bleu!: Promise<unknown>;
    let firstBleu = -1;
    c.at(1000, async () => {
      firstBleu = obs.writes.length;
      bleu = cc.start('bleu').end;
      await bleu;
    });
    expect(await cc.start('rouge').end).toEqual({ event: 'completed' });
    expect(await bleu).toEqual({ event: 'completed' });
    const reached = obs.writes[firstBleu - 1]!.s;
    // Bleu's first step = the values rouge had reached (not neutral, not rouge's target).
    expect(obs.writes[firstBleu]!.s).toEqual(reached);
    expect(reached.saturation).toBeGreaterThan(0);
    expect(reached.saturation).toBeLessThan(1.97);
    // Every write after bleu started goes towards bleu (hue 0 → 144.42 only grows): rouge never wrote again.
    for (let i = firstBleu + 1; i < obs.writes.length; i++)
      expect(obs.writes[i]!.s.hue_shift!).toBeGreaterThanOrEqual(
        obs.writes[i - 1]!.s.hue_shift!,
      );
    expect(obs.color).toEqual(target('bleu'));
  });

  it('manual change kept as the start: the transition goes from the values set by hand', async () => {
    const { obs, cc } = await setup();
    obs.filters.get(COLOR)!.settings = {
      hue_shift: 50,
      contrast: 1,
      gamma: 0.47,
    };
    await cc.start('gris').end;
    expect(obs.writes[0]!.s).toMatchObject({
      hue_shift: 50,
      contrast: 1,
      gamma: 0.47,
    });
    expect(obs.color).toEqual(target('gris'));
  });

  it('start condition: only from Dessin or Fullscreen — elsewhere nothing written', async () => {
    const { obs, cc } = await setup();
    obs.program = 'Just Chatting';
    expect(await cc.start('rouge').end).toEqual({
      event: 'failed',
      error:
        'Couleur Cam refusée : pas de caméra sur la scène « Just Chatting » (aucun remboursement possible : récompense créée par SAMMI)',
    });
    obs.program = 'Scène Dessin';
    expect(await cc.start('rouge').end).toEqual({ event: 'completed' });
  });

  it('filter missing or disabled in OBS: readable reason, nothing written', async () => {
    const { obs, cc } = await setup();
    obs.filters.get(COLOR)!.enabled = false;
    expect(await cc.start('rouge').end).toEqual({
      event: 'failed',
      error:
        'Couleur Cam : filtre « Raptoru — Couleur Cam » désactivé dans OBS',
    });
    obs.filters.delete(COLOR);
    expect(await cc.start('rouge').end).toEqual({
      event: 'failed',
      error:
        'le filtre « Raptoru — Couleur Cam » de « Overlay Shushu » introuvable dans OBS',
    });
    expect(obs.writes).toEqual([]);
  });

  it('OBS lost during the transition: said in the history, the colour reached stays; the next one starts from it', async () => {
    const { c, obs, cc } = await setup();
    c.at(700, () => {
      obs.connected = false;
    });
    expect(await cc.start('jaune').end).toEqual({
      event: 'failed',
      error:
        'Couleur « jaune » interrompue : OBS non connecté (couleur atteinte conservée)',
    });
    const reached = { ...obs.color };
    obs.connected = true;
    await cc.start('jaune').end;
    expect(obs.writes.find((x) => x.t > 700)!.s).toEqual(reached);
    expect(obs.color).toEqual(target('jaune'));
  });

  it('Studio restarted during a transition: nothing replayed; the next colour starts from the values reached', async () => {
    const { c, obs, actions } = await setup();
    let stopped!: () => void;
    const reached = new Promise<void>((r) => (stopped = r));
    const first = new ColorCam({
      obs: actions,
      now: c.now,
      // Studio « stops » after one second of transition.
      sleep: (ms) => {
        if (c.t + ms <= 1000) return c.sleep(ms);
        stopped();
        return new Promise(() => {});
      },
    });
    void first.start('violet').end;
    await reached;
    const half = { ...obs.color };
    const restarted = new ColorCam({
      obs: actions,
      now: c.now,
      sleep: c.sleep,
    });
    const n = obs.writes.length;
    await restarted.start('orange').end;
    expect(obs.writes[n]!.s).toEqual(half);
    expect(obs.color).toEqual(target('orange'));
  });

  it('with FX Cam: a shader effect and a colour change at the same time, each on its own filter', async () => {
    const { c, obs, actions, cc } = await setup();
    const fx = new FxCam({ obs: actions, now: c.now, sleep: c.sleep });
    c.at(500, async () => {
      await cc.start('cyan').end;
    });
    expect(await fx.start('rage').end).toEqual({ event: 'completed' });
    expect(obs.log).toEqual(['on rage', 'off rage']);
    expect(obs.color).toEqual(target('cyan'));
    expect(obs.filters.get(`${FX_CAM.source}|rage`)!.settings).toEqual({});
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

describe('Couleur Cam from Points de chaîne — chain with the real Lab Core (simulated OBS)', () => {
  it('text → colour per redemption (test and real Twitch redemption), unknown refused in Core, colour applied', async () => {
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
      twitch: () => ({ scope: true, adapter_running: true }),
    });
    cleanups.push(async () => rt!.stop());
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
    const settle = async () => {
      let state = await api('/state');
      for (let i = 0; i < 80 && state.recent[0].status === 'pending'; i++) {
        await new Promise((r) => setTimeout(r, 50));
        state = await api('/state');
      }
      return state;
    };
    await core('/v1/lab/channel-points/rewards', {
      channel_id: '900100',
      rewards: [
        {
          id: 'reward-color',
          title: 'Couleur Cam',
          cost: 100,
          is_enabled: true,
          user_input_required: true,
        },
      ],
    });
    expect(
      await api('/rules/reward-color', {
        enabled: true,
        actions: [
          { type: 'interaction', interaction: 'color_cam', color: 'noir' },
        ],
      }),
    ).toMatchObject({ version: 1 });

    await api('/test', { reward_id: 'reward-color', user_input: '  ROUGE ' });
    expect(await rt.once()).toBe(true);
    let state = await settle();
    expect(state.recent[0]).toMatchObject({
      user_input: '  ROUGE ',
      status: 'done',
      actions: [
        { type: 'interaction', interaction: 'color_cam', color: 'rouge' },
      ],
    });
    expect(obs.color).toEqual(target('rouge'));

    await api('/test', { reward_id: 'reward-color', user_input: 'pourpre' });
    expect(await rt.once()).toBe(false);
    state = await api('/state');
    expect(state.recent[0]).toMatchObject({
      status: 'failed',
      results: [{ status: 'failed', error: 'color_cam_unknown' }],
    });
    expect(state.recent[0].actions[0].color).toBeUndefined();

    // « aléatoire »: drawn by Core, the history names the colour applied.
    await api('/test', { reward_id: 'reward-color', user_input: 'aléatoire' });
    expect(await rt.once()).toBe(true);
    state = await settle();
    const drawn = state.recent[0].actions[0].color;
    expect(COLOR_CAM_PRESETS.map((p) => p.name)).toContain(drawn);
    expect(obs.color).toEqual(target(drawn));

    // A real redemption (switch ON): its own text; a redelivery runs nothing.
    await api('/settings', { enabled: true });
    const redeem = () =>
      core('/v1/lab/channel-points/redemptions', {
        channel_id: '900100',
        source: 'twitch',
        redemption_id: 'r-color-1',
        reward: { id: 'reward-color', title: 'Couleur Cam', cost: 100 },
        user: { id: '11', login: 'v11', display_name: 'V11' },
        user_input: 'Bleu Ciel',
        twitch_status: 'unfulfilled',
        redeemed_at: new Date().toISOString(),
      });
    await redeem();
    expect(await redeem()).toMatchObject({ outcome: 'duplicate' });
    expect(await rt.once()).toBe(true);
    expect(await rt.once()).toBe(false);
    state = await settle();
    expect(state.recent[0]).toMatchObject({
      source: 'twitch',
      user_input: 'Bleu Ciel',
      status: 'done',
      actions: [{ color: 'bleu ciel' }],
    });
    expect(obs.color).toEqual(target('bleu ciel'));
  }, 30_000);
});
