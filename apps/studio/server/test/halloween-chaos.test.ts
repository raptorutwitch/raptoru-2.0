import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HalloweenRuntime } from '../src/halloween/runtime.js';
import {
  CHAOS_DEFAULT,
  chaosCard,
  chaosParams,
  readChaos,
} from '../../web/src/halloween-chaos.js';

// Halloween Chaos (docs/HALLOWEEN.md § 4 bis): Studio's side of « Écran retourné » / « Flou » — the game window chosen
// in Studio reaches Electron main, the windows Electron lists reach the panel, a free test carries its duration and
// intensity to the overlay page, and the window really captured is written in the journal. No Core, no payment.

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

async function start() {
  dir = await mkdtemp(join(tmpdir(), 'halloween-chaos-'));
  let origin = '';
  server = createServer((req, res) => {
    void rt!.handle(req, res, new URL(req.url!, origin)).then((done) => {
      if (!done) res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  rt = new HalloweenRuntime({
    origin,
    dir,
    pageDir: dir,
    core: null,
    environment: null,
    channelId: '900100',
    studioId: 'studio-test',
    fromMain: (req) => req.headers['x-raptoru-main'] === 'main',
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
  return { call, page };
}

describe('Chaos — Studio runtime', () => {
  it('the game window: chosen in Studio, read by Electron main; the list comes from main only', async () => {
    const { call } = await start();
    const main = { 'x-raptoru-main': 'main' };
    expect(
      (await call('/api/halloween/windows', { windows: ['x'] })).status,
    ).toBe(403);
    await call(
      '/api/halloween/windows',
      { windows: ['Dofus - Raptoru', 42, '', 'Spotify'] },
      main,
    );
    await call('/api/halloween/settings', {
      capture_window: '  Dofus - Raptoru ',
    });
    const s = (await call('/api/halloween/status')).body;
    expect(s.windows).toEqual(['Dofus - Raptoru', 'Spotify']);
    expect(s.settings.capture_window).toBe('Dofus - Raptoru');
    expect(s.effects).toEqual(expect.arrayContaining(['flip', 'blur']));
    expect(
      (await call('/api/halloween/overlay-config', undefined, main)).body
        .capture_window,
    ).toBe('Dofus - Raptoru');
    await call('/api/halloween/settings', { capture_window: '' });
    expect(
      (await call('/api/halloween/status')).body.settings.capture_window,
    ).toBeNull();
  });

  it('a free test carries its duration and intensity; the captured window goes to the journal; STOP ALL clears it', async () => {
    const { call, page } = await start();
    // The page is there (one quick poll), then a test.
    await page('/halloween/overlay/next?ready=1&epoch=-1');
    expect(
      (
        await call('/api/halloween/test', {
          effect: 'blur',
          params: chaosParams('blur', { ...CHAOS_DEFAULT, blurSeconds: 4 }),
        })
      ).status,
    ).toBe(200);
    const next = (await page('/halloween/overlay/next?ready=1&epoch=0')).body;
    expect(next.delivery).toMatchObject({
      effect: 'blur',
      params: { intensity: 'medium', durationMs: 4000 },
      duration_ms: 4000,
    });
    // A second one while it plays: refused (one at a time).
    expect(
      (await call('/api/halloween/test', { effect: 'flip' })).body.error,
    ).toBe('busy');
    await page('/halloween/overlay/report', {
      delivery_id: next.delivery.delivery_id,
      event: 'started',
      detail: 'Dofus - Raptoru',
    });
    const s = (await call('/api/halloween/status')).body;
    expect(s.last_capture.name).toBe('Dofus - Raptoru');
    expect(s.events[0].text).toBe(
      'blur : fenêtre capturée « Dofus - Raptoru »',
    );
    expect((await call('/api/halloween/stop', {})).body.stopped).toBe(1);
    expect((await call('/api/halloween/status')).body.current).toBeNull();
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
  it('shows the real state: the windows listed, a chosen one that closed, the last capture', () => {
    const html = chaosCard(
      {
        settings: { capture_window: 'Elden Ring' },
        windows: ['Dofus <3'],
        last_capture: { at: '2026-10-31T20:00:00Z', name: 'Dofus <3' },
      },
      CHAOS_DEFAULT,
    );
    expect(html).toContain('Elden Ring (fermée)');
    expect(html).toContain('Dofus &lt;3');
    expect(html).not.toContain('Dofus <3');
    expect(html).toContain('Dernière capture');
  });
});
