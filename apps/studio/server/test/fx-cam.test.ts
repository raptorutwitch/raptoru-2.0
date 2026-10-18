import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { FX_CAM, resolveFxCam } from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { systemClock } from '../../../core-api/src/clock.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import { ObsActions, type ObsLike } from '../src/channel-points/obs-actions.js';
import { ChannelPointsRuntime } from '../src/channel-points/runtime.js';
import { FxCam } from '../src/interactions/fx-cam.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';

// FX Cam (P0.2, docs/EFFECTS_PLAYER.md § 11) on a SIMULATED OBS (the real OBS is never touched) with a virtual clock:
// the viewer's text resolved by Core, the filter enabled then disabled after 10 s through the revert mechanism, start
// condition, same effect refused / different effects stacked, manual changes kept, missing filter, OBS outage, Studio
// restart, then the chain from Points de chaîne with the real Lab Core (text kept per redemption, no double run).

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'fxcam-'));
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

/** A tiny OBS: program scene and the filters of « overlay cam shushu » (as in the real collection); actions logged. */
class FakeObs implements ObsLike {
  connected = true;
  program = 'Scène Fullscreen';
  filters = new Map<string, boolean>(
    [...FX_CAM.effects, 'mute', 'Votekick Zoom', 'Votekick Mute'].map((f) => [
      f,
      false,
    ]),
  );
  log: { t: number; what: string }[] = [];
  constructor(private readonly c: { now: () => number }) {}
  async request(type: string, d: Record<string, unknown>) {
    if (!this.connected) throw new Error('obs_offline');
    const filter = () => {
      if (
        d.sourceName !== FX_CAM.source ||
        !this.filters.has(String(d.filterName))
      )
        throw Object.assign(new Error('x'), { code: 600 });
      return String(d.filterName);
    };
    switch (type) {
      case 'GetCurrentProgramScene':
        return { currentProgramSceneName: this.program };
      case 'GetSourceFilter':
        return { filterEnabled: this.filters.get(filter()) };
      case 'SetSourceFilterEnabled': {
        const f = filter();
        this.filters.set(f, d.filterEnabled === true);
        this.log.push({
          t: this.c.now(),
          what: `${d.filterEnabled ? 'on' : 'off'} ${f}`,
        });
        return {};
      }
    }
    throw new Error(`unexpected ${type}`);
  }
}

async function setup() {
  const c = clock();
  const obs = new FakeObs(c);
  const file = join(await tmp(), 'obs-reverts.json');
  const actions = await ObsActions.open(file, () => obs, c.now);
  const fx = new FxCam({ obs: actions, now: c.now, sleep: c.sleep });
  return { c, obs, actions, file, fx };
}

describe('FX Cam — viewer text → allowed effect (Core)', () => {
  it('as SAMMI: case and spaces ignored; anything else refused (no other filter, no alias)', () => {
    for (const t of ['rage', 'RAGE', '  rage ', 'Rage\n', 'r a g e'])
      expect(resolveFxCam(t)).toBe('rage');
    expect(resolveFxCam('Big Head')).toBe('bighead');
    for (const t of [
      '',
      undefined,
      'fire',
      'mute',
      'Votekick Zoom',
      'pixel|drunk',
      '|rage|',
      'colere',
      'rage!',
    ])
      expect(resolveFxCam(t)).toBeNull();
    expect(FX_CAM.effects).toEqual([
      'prison',
      'bighead',
      'pixel',
      'drunk',
      'glitch',
      'rage',
    ]);
  });
});

describe('FX Cam — filter on OBS', () => {
  it('rage: filter enabled at 0, disabled at 10 s (after every shader animation), nothing else touched', async () => {
    const { obs, fx, actions } = await setup();
    expect(await fx.start('rage').end).toEqual({ event: 'completed' });
    expect(obs.log).toEqual([
      { t: 0, what: 'on rage' },
      // Due at 10 s; the forced check runs 30 ms after (the periodic 250 ms check would do it otherwise).
      { t: 10_030, what: 'off rage' },
    ]);
    expect(actions.pending).toBe(0);
  });

  it('start condition: only from Dessin or Fullscreen — elsewhere nothing, the refund impossibility said', async () => {
    const { obs, fx } = await setup();
    for (const scene of ['Just Chatting', 'Scène PS5', 'Creepy Effect']) {
      obs.program = scene;
      expect(await fx.start('rage').end).toEqual({
        event: 'failed',
        error: `FX Cam refusé : pas de caméra sur la scène « ${scene} » (aucun remboursement possible : récompense créée par SAMMI)`,
      });
    }
    obs.program = 'Scène Dessin';
    expect(await fx.start('pixel').end).toEqual({ event: 'completed' });
    expect(obs.log.map((l) => l.what)).toEqual(['on pixel', 'off pixel']);
  });

  it('the same effect while it runs is refused at once; different effects stack, each ends on its own', async () => {
    const { c, obs, actions } = await setup();
    // Ends driven by hand: each effect sleeps until woken, its revert is due on the virtual clock.
    const wake: (() => void)[] = [];
    const fx = new FxCam({
      obs: actions,
      now: c.now,
      sleep: () => new Promise<void>((r) => wake.push(r)),
    });
    const until = async (f: () => boolean) => {
      for (let n = 0; n < 400 && !f(); n++)
        await new Promise((r) => setTimeout(r, 5));
    };
    const rage = fx.start('rage').end;
    await until(() => wake.length === 1);
    expect(() => fx.start('rage')).toThrow('FX « rage » déjà actif');
    c.t = 3000;
    const pixel = fx.start('pixel').end;
    await until(() => wake.length === 2);
    c.t = 10_000;
    await actions.tick();
    c.t = 13_000;
    await actions.tick();
    for (const w of wake) w();
    expect(await rage).toEqual({ event: 'completed' });
    expect(await pixel).toEqual({ event: 'completed' });
    expect(obs.log).toEqual([
      { t: 0, what: 'on rage' },
      { t: 3000, what: 'on pixel' },
      { t: 10_000, what: 'off rage' },
      { t: 13_000, what: 'off pixel' },
    ]);
    // After its end, the same effect runs again.
    wake.length = 0;
    const again = fx.start('rage').end;
    await until(() => wake.length === 1);
    wake[0]!();
    expect(await again).toEqual({ event: 'completed' });
  });

  it('already enabled in OBS (by hand, or left on): refused, the filter left as it is', async () => {
    const { obs, fx } = await setup();
    obs.filters.set('glitch', true);
    expect(await fx.start('glitch').end).toEqual({
      event: 'failed',
      error: 'FX « glitch » déjà actif dans OBS',
    });
    expect(obs.log).toEqual([]);
    expect(obs.filters.get('glitch')).toBe(true);
  });

  it('manual change kept: filter disabled by hand during the effect is not touched again', async () => {
    const { c, obs, fx } = await setup();
    c.at(2000, () => obs.filters.set('drunk', false));
    expect(await fx.start('drunk').end).toEqual({ event: 'completed' });
    expect(obs.log.map((l) => l.what)).toEqual(['on drunk']);
    expect(obs.filters.get('drunk')).toBe(false);
  });

  it('filter missing in OBS: readable reason, nothing done', async () => {
    const { obs, fx } = await setup();
    obs.filters.delete('prison');
    expect(await fx.start('prison').end).toEqual({
      event: 'failed',
      error:
        'le filtre « prison » de « overlay cam shushu » introuvable dans OBS',
    });
    expect(obs.log).toEqual([]);
  });

  it('OBS lost during the effect: said in the history; the filter is disabled when OBS is back', async () => {
    const { c, obs, fx, actions } = await setup();
    c.at(4000, () => {
      obs.connected = false;
    });
    expect(await fx.start('bighead').end).toEqual({
      event: 'failed',
      error:
        'FX « bighead » joué ; OBS déconnecté avant la fin (filtre désactivé au retour d’OBS)',
    });
    expect(obs.filters.get('bighead')).toBe(true);
    expect(actions.pending).toBe(1);
    obs.connected = true;
    await actions.tick();
    expect(obs.filters.get('bighead')).toBe(false);
    expect(actions.pending).toBe(0);
  });

  it('OBS absent at the start: readable reason, nothing pending', async () => {
    const { obs, fx, actions } = await setup();
    obs.connected = false;
    expect(await fx.start('rage').end).toEqual({
      event: 'failed',
      error: 'OBS non connecté',
    });
    expect(actions.pending).toBe(0);
  });

  it('Studio restarted during the effect: disabled from obs-reverts.json when due, never replayed; meanwhile the same effect is refused', async () => {
    const { c, obs, file } = await setup();
    const actions = await ObsActions.open(file, () => obs, c.now);
    let stopped!: () => void;
    const reached = new Promise<void>((r) => (stopped = r));
    const fx = new FxCam({
      obs: actions,
      now: c.now,
      // Studio « stops » right after enabling the filter.
      sleep: () => {
        stopped();
        return new Promise(() => {});
      },
    });
    void fx.start('rage').end;
    await reached;
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveLength(1);
    c.t = 5000;
    const restarted = await ObsActions.open(file, () => obs, c.now);
    const again = new FxCam({ obs: restarted, now: c.now, sleep: c.sleep });
    expect(await again.start('rage').end).toEqual({
      event: 'failed',
      error: 'FX « rage » déjà actif dans OBS',
    });
    await restarted.tick();
    expect(obs.filters.get('rage')).toBe(true);
    c.t = 10_000;
    await restarted.tick();
    expect(obs.filters.get('rage')).toBe(false);
    expect(obs.log.map((l) => l.what)).toEqual(['on rage', 'off rage']);
    expect(restarted.pending).toBe(0);
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

describe('FX Cam from Points de chaîne — chain with the real Lab Core (simulated OBS)', () => {
  it('text → effect per redemption (tests and real Twitch redemptions), unknown refused in Core, no double run', async () => {
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
    await core('/v1/lab/channel-points/rewards', {
      channel_id: '900100',
      rewards: [
        {
          id: 'reward-fx',
          title: 'FX cam',
          cost: 500,
          is_enabled: true,
          user_input_required: true,
        },
      ],
    });
    // A value in a rule is never used: the effect only comes from the viewer's text.
    expect(
      await api('/rules/reward-fx', {
        enabled: true,
        actions: [
          { type: 'interaction', interaction: 'fx_cam', effect: 'prison' },
        ],
      }),
    ).toMatchObject({ version: 1 });

    // « Tester » with a viewer text: resolved by Core, only the effect id reaches Studio.
    await api('/test', { reward_id: 'reward-fx', user_input: '  RAGE ' });
    expect(await rt.once()).toBe(true);
    expect(obs.filters.get('rage')).toBe(true);
    let state = await api('/state');
    expect(state.recent[0]).toMatchObject({
      user_input: '  RAGE ',
      status: 'pending',
      actions: [{ type: 'interaction', interaction: 'fx_cam', effect: 'rage' }],
      results: [{ status: 'pending', progress: 'playing' }],
    });

    // Unknown text: refused in Core, nothing sent to Studio, OBS untouched.
    for (const text of ['fire', 'Votekick Zoom', undefined]) {
      await api('/test', {
        reward_id: 'reward-fx',
        ...(text ? { user_input: text } : {}),
      });
      expect(await rt.once()).toBe(false);
      state = await api('/state');
      expect(state.recent[0]).toMatchObject({
        status: 'failed',
        actions: [{ type: 'interaction', interaction: 'fx_cam' }],
        results: [{ status: 'failed', error: 'fx_cam_unknown' }],
      });
      expect(state.recent[0].actions[0].effect).toBeUndefined();
    }

    // Real redemptions (switch ON), two at once from two viewers: each one its own text; a redelivery runs nothing.
    await api('/settings', { enabled: true });
    const redeem = (id: string, user: string, text: string) =>
      core('/v1/lab/channel-points/redemptions', {
        channel_id: '900100',
        source: 'twitch',
        redemption_id: id,
        reward: { id: 'reward-fx', title: 'FX cam', cost: 500 },
        user: { id: user, login: `v${user}`, display_name: `V${user}` },
        user_input: text,
        twitch_status: 'unfulfilled',
        redeemed_at: new Date().toISOString(),
      });
    await Promise.all([
      redeem('r-1', '11', 'pixel'),
      redeem('r-2', '22', 'Glitch'),
      redeem('r-3', '33', 'rage'),
    ]);
    expect(await redeem('r-1', '11', 'pixel')).toMatchObject({
      outcome: 'duplicate',
    });
    while (await rt.once());
    state = await api('/state');
    const byId = Object.fromEntries(
      state.recent.map((r: any) => [r.redemption_id, r]), // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    expect(byId['r-1']).toMatchObject({
      user: { id: '11' },
      user_input: 'pixel',
      actions: [{ effect: 'pixel' }],
      results: [{ status: 'pending', progress: 'playing' }],
    });
    expect(byId['r-2']).toMatchObject({
      user: { id: '22' },
      actions: [{ effect: 'glitch' }],
      results: [{ status: 'pending', progress: 'playing' }],
    });
    // rage still on from the test: refused (same effect).
    expect(byId['r-3']).toMatchObject({
      actions: [{ effect: 'rage' }],
      status: 'failed',
      results: [{ status: 'failed', error: 'FX « rage » déjà actif' }],
    });
    expect([...obs.filters].filter(([, on]) => on)).toEqual([
      ['pixel', true],
      ['glitch', true],
      ['rage', true],
    ]);
    // Each filter enabled once (no double run).
    expect(obs.log[0]!.what).toBe('on rage');
    expect(obs.log.map((l) => l.what).sort()).toEqual([
      'on glitch',
      'on pixel',
      'on rage',
    ]);
  }, 20_000);
});
