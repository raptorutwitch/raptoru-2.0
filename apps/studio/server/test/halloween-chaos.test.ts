import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ObsActions, ObsLike } from '../src/channel-points/obs-actions.js';
import {
  CHAOS_FILTERS,
  chaosFilterOf,
  prepareChaosFilters,
} from '../src/halloween/chaos-obs.js';
import { HalloweenRuntime } from '../src/halloween/runtime.js';
import {
  CHAOS_DEFAULT,
  chaosCard,
  chaosParams,
  obsLine,
  readChaos,
} from '../../web/src/halloween-chaos.js';

// Halloween Chaos (docs/HALLOWEEN.md § 4 bis): « Écran retourné » / « Flou » on the whole monitor. The Chaos window (the
// overlay page in its « chaos » role, excluded from captures by Electron) takes the Chaos effects, the overlay page the
// rest; a test needs the Chaos window; the viewers' OBS filter goes on when the effect starts and off at its end or on
// STOP ALL; the filters are prepared once, disabled, never overwritten. No Core, no payment.

let dir = '';
let server: Server | null = null;
let rt: HalloweenRuntime | null = null;
afterEach(async () => {
  rt?.stop();
  server?.closeAllConnections();
  await new Promise((r) => (server ? server.close(r) : r(null)));
  server = null;
  await rm(dir, { recursive: true, force: true });
});

type Reply = { status: number; body: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A fake OBS: filters per source, every request recorded. */
function fakeObs() {
  const filters = new Map<
    string,
    { kind: string; enabled: boolean; settings: object }
  >();
  const calls: [string, Record<string, unknown>][] = [];
  const obs: ObsLike = {
    connected: true,
    async request(type, data) {
      const d = data as Record<string, unknown>;
      calls.push([type, d]);
      if (type === 'GetInputList')
        return { inputs: [{ inputName: 'Capture écran' }] };
      if (type === 'GetSourceFilterList')
        return {
          filters: [...filters].map(([filterName, f]) => ({
            filterName,
            filterEnabled: f.enabled,
          })),
        };
      if (type === 'GetSourceFilterDefaultSettings')
        return { defaultFilterSettings: { radius: 5, passes: 1 } };
      if (type === 'CreateSourceFilter') {
        filters.set(String(d.filterName), {
          kind: String(d.filterKind),
          enabled: true,
          settings: d.filterSettings as object,
        });
        return {};
      }
      if (type === 'SetSourceFilterEnabled') {
        const f = filters.get(String(d.filterName));
        if (f) f.enabled = d.filterEnabled === true;
        return {};
      }
      return {};
    },
  };
  return { obs, filters, calls };
}

async function start(withObs = false) {
  dir = await mkdtemp(join(tmpdir(), 'halloween-chaos-'));
  let origin = '';
  server = createServer((req, res) => {
    void rt!.handle(req, res, new URL(req.url!, origin)).then((done) => {
      if (!done) res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const fake = fakeObs();
  const runs: Record<string, unknown>[] = [];
  const actions = {
    run: async (a: Record<string, unknown>) => {
      runs.push(a);
      await fake.obs.request('SetSourceFilterEnabled', {
        sourceName: a.source,
        filterName: a.filter,
        filterEnabled: a.enabled,
      });
    },
  } as unknown as ObsActions;
  rt = new HalloweenRuntime({
    origin,
    dir,
    pageDir: dir,
    core: null,
    environment: null,
    channelId: '900100',
    studioId: 'studio-test',
    fromMain: (req) => req.headers['x-raptoru-main'] === 'main',
    ...(withObs ? { obs: () => fake.obs, obsActions: () => actions } : {}),
  });
  await rt.start();
  const call = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> =>
    fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'x-raptoru-studio': '1',
        'content-type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({
      status: r.status,
      body: (await r.json()) as Reply['body'],
    }));
  const token = rt.overlayUrl().split('#')[1]!;
  const page = (path: string, body?: unknown) =>
    call(path, body, { 'x-overlay-token': token });
  return { call, page, fake, runs };
}

describe('Chaos — Studio runtime', () => {
  it('Electron gets the Chaos window’s URL; a test needs that window; the Chaos effect goes to it, not to the overlay', async () => {
    const { call, page } = await start();
    const cfg = (
      await call('/api/halloween/overlay-config', undefined, {
        'x-raptoru-main': 'main',
      })
    ).body;
    expect(cfg.chaos_url).toMatch(/\/halloween\/overlay\.html\?role=chaos#/);
    await page('/halloween/overlay/next?ready=1&epoch=-1');
    expect(
      (await call('/api/halloween/test', { effect: 'flip' })).body.error,
    ).toBe('chaos_absent');
    await page('/halloween/overlay/next?ready=1&epoch=-1&role=chaos');
    expect((await call('/api/halloween/status')).body.chaos.connected).toBe(
      true,
    );
    await call('/api/halloween/test', {
      effect: 'blur',
      params: chaosParams('blur', { ...CHAOS_DEFAULT, blurSeconds: 4 }),
    });
    // The overlay page is offered nothing; the Chaos window takes it.
    expect(
      (await page('/halloween/overlay/next?ready=1&epoch=0')).body.delivery,
    ).toBeNull();
    const next = (
      await page('/halloween/overlay/next?ready=1&epoch=0&role=chaos')
    ).body;
    expect(next.delivery).toMatchObject({
      effect: 'blur',
      params: { intensity: 'medium', durationMs: 4000 },
    });
    // A drawn effect stays the overlay page's.
    await call('/api/halloween/stop', {});
    await call('/api/halloween/test', { effect: 'fog' });
    expect(
      (await page('/halloween/overlay/next?ready=1&epoch=1&role=chaos')).body
        .delivery,
    ).toBeNull();
    expect(
      (await page('/halloween/overlay/next?ready=1&epoch=1')).body.delivery
        .effect,
    ).toBe('fog');
  });

  it('the viewers’ OBS filter: on when the effect starts (timed), off at its end and on STOP ALL; without OBS the effect still plays', async () => {
    const { call, page, runs } = await start(true);
    await call('/api/halloween/settings', {
      obs_chaos_source: 'Capture écran',
    });
    await page('/halloween/overlay/next?ready=1&epoch=-1');
    await page('/halloween/overlay/next?ready=1&epoch=-1&role=chaos');
    await call('/api/halloween/test', {
      effect: 'flip',
      params: { mode: 'mirror', durationMs: 5000 },
    });
    const d = (await page('/halloween/overlay/next?ready=1&epoch=0&role=chaos'))
      .body.delivery;
    await page('/halloween/overlay/report', {
      delivery_id: d.delivery_id,
      event: 'started',
      detail: 'Écran 1',
    });
    expect(runs.at(-1)).toEqual({
      type: 'obs_filter',
      source: 'Capture écran',
      filter: CHAOS_FILTERS.mirror,
      enabled: true,
      duration_ms: 8000,
    });
    const s = (await call('/api/halloween/status')).body;
    expect(s.chaos.last).toMatchObject({ screen: 'Écran 1' });
    expect(s.chaos.last.obs).toContain('oui');
    await page('/halloween/overlay/report', {
      delivery_id: d.delivery_id,
      event: 'ended',
    });
    expect(runs.at(-1)).toMatchObject({
      enabled: false,
      filter: CHAOS_FILTERS.mirror,
    });
    // STOP ALL during a blur: the filter off at once.
    await call('/api/halloween/test', {
      effect: 'blur',
      params: { intensity: 'high' },
    });
    const b = (await page('/halloween/overlay/next?ready=1&epoch=0&role=chaos'))
      .body.delivery;
    await page('/halloween/overlay/report', {
      delivery_id: b.delivery_id,
      event: 'started',
    });
    expect(runs.at(-1)).toMatchObject({
      enabled: true,
      filter: CHAOS_FILTERS.high,
    });
    await call('/api/halloween/stop', {});
    expect(runs.at(-1)).toMatchObject({
      enabled: false,
      filter: CHAOS_FILTERS.high,
    });
  });

  it('OBS: the screen captures listed; the filters created disabled, once, never overwritten', async () => {
    const { call, fake } = await start(true);
    expect((await call('/api/halloween/obs/prepare', {})).body.error).toBe(
      'no_obs_source',
    );
    await call('/api/halloween/settings', {
      obs_chaos_source: 'Capture écran',
    });
    const listed = (await call('/api/halloween/obs')).body;
    expect(listed.sources).toEqual(['Capture écran']);
    expect(
      Object.values(listed.filters).every(
        (f) => !(f as { present: boolean }).present,
      ),
    ).toBe(true);
    const out = (await call('/api/halloween/obs/prepare', {})).body;
    expect(out.created).toHaveLength(6);
    for (const f of fake.filters.values()) expect(f.enabled).toBe(false);
    expect(fake.filters.get(CHAOS_FILTERS.rotate)).toMatchObject({
      kind: 'shader_filter',
      settings: { from_file: false },
    });
    expect(fake.filters.get(CHAOS_FILTERS.high)).toMatchObject({
      kind: 'obs_composite_blur',
      settings: { blur_algorithm: 1, blur_type: 1, radius: 55 },
    });
    expect((await call('/api/halloween/obs/prepare', {})).body.created).toEqual(
      [],
    );
  });

  it('the filter for a play: flip mode and blur intensity (defaults when absent)', async () => {
    expect(chaosFilterOf('flip', {})).toBe('rotate');
    expect(chaosFilterOf('flip', { mode: 'vertical' })).toBe('vertical');
    expect(chaosFilterOf('blur', { intensity: 'low' })).toBe('low');
    expect(chaosFilterOf('blur', {})).toBe('medium');
    expect(chaosFilterOf('fog', {})).toBeNull();
    const { obs } = fakeObs();
    expect((await prepareChaosFilters(obs, 'S')).created).toHaveLength(6);
  });
});

describe('Chaos — Studio card', () => {
  it('params for the overlay; choices bounded like the overlay’s limits', () => {
    expect(chaosParams('flip', CHAOS_DEFAULT)).toEqual({
      mode: 'rotate',
      durationMs: 10000,
    });
    let c = readChaos(CHAOS_DEFAULT, 'flipSeconds', '999');
    c = readChaos(c, 'blurSeconds', '1');
    c = readChaos(c, 'blurIntensity', 'nuclear');
    c = readChaos(c, 'flipMode', 'mirror');
    expect(c).toEqual({
      flipMode: 'mirror',
      flipSeconds: 60,
      blurIntensity: 'medium',
      blurSeconds: 2,
    });
  });
  it('says the real state: the monitor, OBS absent or not prepared; no game-window choice any more', () => {
    const s = {
      settings: { display_id: 2, obs_chaos_source: 'Capture <écran>' },
      displays: [
        {
          id: 2,
          label: 'XB273U',
          bounds: { width: 2560, height: 1440 },
          primary: true,
        },
      ],
      chaos: {
        connected: true,
        obs_source: 'Capture <écran>',
        obs_connected: true,
        last: null,
      },
    };
    const html = chaosCard(s, CHAOS_DEFAULT, {
      sources: [],
      source: 'Capture <écran>',
      filters: { rotate: { present: false, enabled: false } },
    });
    expect(html).toContain('tout l’écran « XB273U (2560×1440) »');
    expect(html).toContain('Capture &lt;écran&gt; (introuvable dans OBS)');
    expect(html).not.toContain('Fenêtre du jeu');
    expect(
      obsLine({ ...s, chaos: { ...s.chaos, obs_connected: false } }, null),
    ).toContain('OBS non connecté');
    expect(
      obsLine(s, {
        sources: [],
        source: 'x',
        filters: { a: { present: true, enabled: false } },
      }),
    ).toContain('prêts');
  });
});
