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
import { ObsActions, type ObsLike } from '../src/channel-points/obs-actions.js';
import { ChannelPointsRuntime } from '../src/channel-points/runtime.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';

// Points de chaîne V1 in Studio: the typed OBS executor (on a SIMULATED OBS — the real OBS is never touched by a
// test), conditional reverts that survive a restart, and the whole chain with the real Lab Core (PGlite):
// rewards → rule → redemption → OBS job executed by Studio → per-action results; master switch OFF by default.

const CH = '900100';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'cp-studio-'));
  cleanups.push(() => rm(d, { recursive: true, force: true }));
  return d;
};

/** A tiny OBS: scenes with items (visible flag), sources with filters (enabled flag), the program scene. */
class FakeObs implements ObsLike {
  connected = true;
  program = 'Jeu';
  calls: string[] = [];
  items = new Map<string, boolean>([
    ['Jeu|Creepy', false],
    ['Jeu|Cam', true],
  ]);
  filters = new Map<string, boolean>([['Cam|Flou', false]]);
  private fail(): never {
    throw Object.assign(new Error('obs_request_failed'), { code: 600 });
  }
  async request(type: string, d: Record<string, unknown>) {
    if (!this.connected) throw new Error('obs_offline');
    this.calls.push(type);
    const item = `${d.sceneName}|${d.sourceName ?? ''}`;
    switch (type) {
      case 'GetSceneItemId':
        if (!this.items.has(item)) this.fail();
        return { sceneItemId: [...this.items.keys()].indexOf(item) + 1 };
      case 'GetSceneItemEnabled':
      case 'SetSceneItemEnabled': {
        const k = [...this.items.keys()][Number(d.sceneItemId) - 1]!;
        if (type === 'SetSceneItemEnabled')
          this.items.set(k, d.sceneItemEnabled === true);
        return { sceneItemEnabled: this.items.get(k) };
      }
      case 'GetSourceFilter':
      case 'SetSourceFilterEnabled': {
        const k = `${d.sourceName}|${d.filterName}`;
        if (!this.filters.has(k)) this.fail();
        if (type === 'SetSourceFilterEnabled')
          this.filters.set(k, d.filterEnabled === true);
        return { filterEnabled: this.filters.get(k) };
      }
      case 'SetCurrentProgramScene':
        if (d.sceneName !== 'Jeu' && d.sceneName !== 'BRB') this.fail();
        this.program = String(d.sceneName);
        return {};
      case 'GetSceneList':
        return { scenes: [{ sceneName: 'BRB' }, { sceneName: 'Jeu' }] };
      case 'GetSceneItemList':
        return {
          sceneItems: [{ sourceName: 'Creepy' }, { sourceName: 'Cam' }],
        };
      case 'GetSourceFilterList':
        return { filters: [{ filterName: 'Flou' }] };
    }
    throw new Error(`unexpected ${type}`);
  }
}

describe('OBS executor (simulated OBS)', () => {
  it('show / hide, filter, scene; readable errors (missing item, OBS absent); no other request type', async () => {
    const obs = new FakeObs();
    const a = await ObsActions.open(join(await tmp(), 'r.json'), () => obs);
    await a.run({
      type: 'obs_source',
      scene: 'Jeu',
      source: 'Creepy',
      visible: true,
    });
    expect(obs.items.get('Jeu|Creepy')).toBe(true);
    await a.run({
      type: 'obs_filter',
      source: 'Cam',
      filter: 'Flou',
      enabled: true,
    });
    expect(obs.filters.get('Cam|Flou')).toBe(true);
    await a.run({ type: 'obs_scene', scene: 'BRB' });
    expect(obs.program).toBe('BRB');
    await expect(
      a.run({
        type: 'obs_source',
        scene: 'Jeu',
        source: 'Nope',
        visible: true,
      }),
    ).rejects.toThrow(
      'la source « Nope » de la scène « Jeu » introuvable dans OBS',
    );
    await expect(
      a.run({ type: 'obs_scene', scene: 'Supprimée' }),
    ).rejects.toThrow('introuvable');
    obs.connected = false;
    await expect(a.run({ type: 'obs_scene', scene: 'BRB' })).rejects.toThrow(
      'OBS non connecté',
    );
    expect(new Set(obs.calls)).toEqual(
      new Set([
        'GetSceneItemId',
        'SetSceneItemEnabled',
        'SetSourceFilterEnabled',
        'SetCurrentProgramScene',
      ]),
    );
  });

  it('temporary action: reverted when it ends only if unchanged; a second redemption extends it; never a blind restore', async () => {
    const obs = new FakeObs();
    let now = 0;
    const a = await ObsActions.open(
      join(await tmp(), 'r.json'),
      () => obs,
      () => now,
    );
    await a.run({
      type: 'obs_source',
      scene: 'Jeu',
      source: 'Creepy',
      visible: true,
      duration_ms: 3000,
    });
    now = 2000;
    await a.run({
      type: 'obs_source',
      scene: 'Jeu',
      source: 'Creepy',
      visible: true,
      duration_ms: 3000,
    });
    expect(a.pending).toBe(1);
    now = 3500;
    await a.tick();
    expect(obs.items.get('Jeu|Creepy')).toBe(true); // extended to 5000
    now = 5000;
    await a.tick();
    expect(obs.items.get('Jeu|Creepy')).toBe(false);
    // The streamer changed it meanwhile: kept as is.
    await a.run({
      type: 'obs_filter',
      source: 'Cam',
      filter: 'Flou',
      enabled: true,
      duration_ms: 1000,
    });
    obs.filters.set('Cam|Flou', false);
    obs.filters.set('Cam|Flou', true); // toggled off and on again by hand → equal to the set state: reverted
    now = 6000;
    await a.tick();
    expect(obs.filters.get('Cam|Flou')).toBe(false);
    await a.run({
      type: 'obs_source',
      scene: 'Jeu',
      source: 'Cam',
      visible: false,
      duration_ms: 1000,
    });
    obs.items.set('Jeu|Cam', true); // shown again by the streamer: not hidden back, not touched
    now = 7000;
    await a.tick();
    expect(obs.items.get('Jeu|Cam')).toBe(true);
    expect(a.pending).toBe(0);
    // Already in the wanted state: nothing to revert.
    await a.run({
      type: 'obs_source',
      scene: 'Jeu',
      source: 'Cam',
      visible: true,
      duration_ms: 1000,
    });
    expect(a.pending).toBe(0);
  });

  it('pending reverts survive a Studio restart; OBS absent → kept; stale after an hour → dropped', async () => {
    const dir = await tmp();
    const obs = new FakeObs();
    let now = 0;
    const first = await ObsActions.open(
      join(dir, 'r.json'),
      () => obs,
      () => now,
    );
    await first.run({
      type: 'obs_source',
      scene: 'Jeu',
      source: 'Creepy',
      visible: true,
      duration_ms: 3000,
    });
    expect(
      JSON.parse(await readFile(join(dir, 'r.json'), 'utf8')),
    ).toHaveLength(1);
    // Restart while OBS is closed.
    obs.connected = false;
    const second = await ObsActions.open(
      join(dir, 'r.json'),
      () => obs,
      () => now,
    );
    now = 4000;
    await second.tick();
    expect(second.pending).toBe(1);
    obs.connected = true;
    await second.tick();
    expect(obs.items.get('Jeu|Creepy')).toBe(false);
    await second.run({
      type: 'obs_source',
      scene: 'Jeu',
      source: 'Creepy',
      visible: true,
      duration_ms: 1000,
    });
    obs.connected = false;
    now = 4000 + 1000 + 60 * 60_000 + 1;
    await second.tick();
    expect(second.pending).toBe(0);
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
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Studio's real Lab Core client (its route allow-list included).
  return localLabCoreClient(url, secret);
}

describe('Points de chaîne — Studio chain with the real Lab Core', () => {
  it('switch OFF by default; Studio test runs the rule on OBS; switch ON: real redemption executed once; results visible', async () => {
    const core = await labCore();
    const obs = new FakeObs();
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
      channelId: CH,
      origin,
      dir: await tmp(),
      obs: () => obs,
      twitch: () => ({ scope: false, adapter_running: true }),
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
      return { status: res.status, body: (await res.json()) as any };
    };
    // The bot / adapter lists the rewards (read only).
    await core('/v1/lab/channel-points/rewards', {
      channel_id: CH,
      rewards: [
        { id: 'reward-creepy', title: 'Creepy', cost: 2000, is_enabled: true },
      ],
    });
    let state = (await api('/state')).body;
    expect(state).toMatchObject({
      settings: { enabled: false },
      environment: 'lab',
      obs: { connected: true },
      twitch: { scope: false },
      rewards: [{ id: 'reward-creepy', title: 'Creepy', rule: null }],
    });
    expect((await api('/obs?scene=Jeu&source=Cam')).body).toEqual({
      scenes: ['Jeu', 'BRB'],
      sources: ['Creepy', 'Cam'],
      filters: ['Flou'],
    });
    expect(
      (
        await api('/rules/reward-creepy', {
          enabled: true,
          actions: [
            {
              type: 'obs_source',
              scene: 'Jeu',
              source: 'Creepy',
              visible: true,
            },
            {
              type: 'obs_filter',
              source: 'Cam',
              filter: 'Absent',
              enabled: true,
            },
          ],
        })
      ).body,
    ).toMatchObject({ version: 1 });
    // A real redemption while OFF: recorded, nothing for OBS.
    const real = (id: string) => ({
      channel_id: CH,
      source: 'twitch',
      redemption_id: id,
      reward: { id: 'reward-creepy', title: 'Creepy', cost: 2000 },
      user: { id: '9001', login: 'cooler_user', display_name: 'Cooler_User' },
      redeemed_at: new Date().toISOString(),
    });
    await core('/v1/lab/channel-points/redemptions', real(randomUUID()));
    expect(await rt.once()).toBe(false);
    expect(obs.items.get('Jeu|Creepy')).toBe(false);
    // Studio « Tester »: runs even with the switch OFF.
    expect(
      (await api('/test', { reward_id: 'reward-creepy' })).body.outcome,
    ).toBe('pending');
    expect(await rt.once()).toBe(true);
    expect(obs.items.get('Jeu|Creepy')).toBe(true);
    state = (await api('/state')).body;
    expect(state.recent[0]).toMatchObject({
      source: 'simulation',
      status: 'partial',
      results: [
        { index: 0, status: 'done' },
        {
          index: 1,
          status: 'failed',
          error: 'le filtre « Absent » de « Cam » introuvable dans OBS',
        },
      ],
    });
    expect(state.recent[1]).toMatchObject({
      source: 'twitch',
      status: 'ignored',
      reason: 'automations_off',
    });
    // Switch ON: a real redemption runs once, its redelivery does nothing.
    expect((await api('/settings', { enabled: true })).body).toMatchObject({
      enabled: true,
    });
    obs.items.set('Jeu|Creepy', false);
    const id = randomUUID();
    await core('/v1/lab/channel-points/redemptions', real(id));
    expect(
      (
        (await core('/v1/lab/channel-points/redemptions', real(id))) as {
          outcome: string;
        }
      ).outcome,
    ).toBe('duplicate');
    expect(await rt.once()).toBe(true);
    expect(await rt.once()).toBe(false);
    expect(obs.items.get('Jeu|Creepy')).toBe(true);
    // OBS closed: the action fails with a readable reason, nothing else happens.
    obs.connected = false;
    await core('/v1/lab/channel-points/redemptions', real(randomUUID()));
    expect(await rt.once()).toBe(true);
    expect((await api('/state')).body.recent[0]).toMatchObject({
      status: 'failed',
      results: [{ error: 'OBS non connecté' }, { error: 'OBS non connecté' }],
    });
    // The tab API needs the Studio header.
    expect((await fetch(`${origin}/api/channel-points/state`)).status).toBe(
      403,
    );
  });
});
