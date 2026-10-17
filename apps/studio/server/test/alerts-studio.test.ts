import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AlertMediaStore } from '../src/alerts/media-store.js';
import { AlertPlacementStore } from '../src/alerts/placement-store.js';
import { AlertsRuntime } from '../src/alerts/runtime.js';

// Twitch alerts V1 (A2) in Studio: media storage (exact copies, originals only read) and the routes (OBS source
// files / media / claim / reports behind its token, the tab's API behind the Studio header). Core is a fake here:
// the queue rules themselves are Core's (apps/core-api/test/alerts-service.test.ts) and the browser chain is
// e2e/alerts.e2e.ts.

const CH = '900400';
const FIX = join(import.meta.dirname, 'fixtures', 'alerts');
const PLAYER_DIR = join(import.meta.dirname, '..', 'alerts-player');
const hash = async (p: string) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex');

let server: Server | null = null;
const dirs: string[] = [];
afterEach(async () => {
  server?.close();
  server = null;
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'alerts-'));
  dirs.push(d);
  return d;
};

describe('AlertMediaStore', () => {
  it('copies exactly, leaves the originals untouched, deduplicates, reports missing files', async () => {
    const src = await tmp();
    await copyFile(join(FIX, 'video-1s.webm'), join(src, 'Raid Titan.webm'));
    const before = {
      hash: await hash(join(src, 'Raid Titan.webm')),
      mtime: (await stat(join(src, 'Raid Titan.webm'))).mtimeMs,
    };
    const store = await AlertMediaStore.open(join(await tmp(), 'media'));
    const report = await store.import([
      { name: 'Raid Titan.webm', from: join(src, 'Raid Titan.webm') },
      { name: 'Alerte Bits.webm', from: join(src, 'Raid Titan.webm') },
      { name: 'MoneyTest.webm', from: join(src, 'absent.webm') },
    ]);
    expect(report.map((r) => r.result)).toEqual([
      'copied',
      'unchanged',
      'missing',
    ]);
    const copy = store.path('Raid Titan.webm')!;
    expect(copy).toBe(join(store.dir, `${before.hash}.webm`));
    expect(await hash(copy)).toBe(before.hash);
    expect(await hash(join(src, 'Raid Titan.webm'))).toBe(before.hash);
    expect((await stat(join(src, 'Raid Titan.webm'))).mtimeMs).toBe(
      before.mtime,
    );
    // Same content under two names: one file.
    expect(
      (await readdir(store.dir)).filter((f) => f.endsWith('.webm')),
    ).toHaveLength(1);
    expect(store.path('MoneyTest.webm')).toBeNull();
    const status = store.status();
    expect(status.find((s) => s.name === 'Raid Titan.webm')?.available).toBe(
      true,
    );
    expect(status.find((s) => s.name === 'MoneyTest.webm')?.available).toBe(
      false,
    );
    // Re-opened from its manifest (Studio restart).
    const again = await AlertMediaStore.open(store.dir);
    expect(again.path('Raid Titan.webm')).toBe(copy);
    expect(
      (
        await again.import([
          { name: 'Raid Titan.webm', from: join(src, 'Raid Titan.webm') },
        ])
      )[0]!.result,
    ).toBe('unchanged');
  });

  it('a stored file that disappeared is reported missing', async () => {
    const store = await AlertMediaStore.open(join(await tmp(), 'media'));
    await store.import([
      { name: 'Alerte Bits.webm', from: join(FIX, 'video-1s.webm') },
    ]);
    await rm(store.path('Alerte Bits.webm')!);
    expect(store.path('Alerte Bits.webm')).toBeNull();
  });
});

const VARIANT = {
  id: 'raid_default',
  type: 'raid',
  video: 'Raid Titan.webm',
  audio: 'Raptoru_Alerte_Raid_Sound.mp3',
};
const CLAIMED = {
  alert_id: '11111111-1111-4111-8111-111111111111',
  attempt_id: '22222222-2222-4222-8222-222222222222',
  variant: VARIANT,
  data: { pseudo: 'A', viewers: 3 },
  status: 'claimed',
};

const IDENTITY_PLACEMENT = {
  media: { x: 0, y: 0, scale: 1 },
  text: { x: 0, y: 0, scale: 1 },
};

describe('AlertPlacementStore (calibration, Studio storage)', () => {
  const P = {
    media: { x: -320.5, y: 140, scale: 0.75 },
    text: { x: 12, y: -8, scale: 1.2 },
  };

  it('saves per variant atomically, survives a restart, keeps variants independent; identity = removed', async () => {
    const file = join(await tmp(), 'alerts', 'placement.json');
    const store = await AlertPlacementStore.open(file);
    expect(store.get('bits_default')).toEqual(IDENTITY_PLACEMENT);
    await store.save('bits_default', P);
    await store.save('raid_default', { media: { x: 5, y: 0, scale: 1 } });
    const again = await AlertPlacementStore.open(file);
    expect(again.get('bits_default')).toEqual(P);
    expect(again.get('raid_default')).toEqual({
      media: { x: 5, y: 0, scale: 1 },
      text: { x: 0, y: 0, scale: 1 },
    });
    expect(again.get('follow_dofus_ebene')).toEqual(IDENTITY_PLACEMENT);
    // Text blocks (bits badge / sentence) are kept per id; one back at its layout place is not stored.
    const withParts = {
      ...IDENTITY_PLACEMENT,
      parts: {
        bitsBadge: { x: 0, y: -60, scale: 1.2 },
        bitsMessage: { x: 0, y: 0, scale: 1 },
      },
    };
    expect(await again.save('bits_alt', withParts)).toEqual({
      ...IDENTITY_PLACEMENT,
      parts: { bitsBadge: { x: 0, y: -60, scale: 1.2 } },
    });
    expect(
      (await AlertPlacementStore.open(file)).get('bits_alt').parts,
    ).toEqual({ bitsBadge: { x: 0, y: -60, scale: 1.2 } });
    await again.save('bits_alt', IDENTITY_PLACEMENT);
    await again.save('raid_default', IDENTITY_PLACEMENT);
    expect(Object.keys(again.all())).toEqual(['bits_default']);
    expect((await AlertPlacementStore.open(file)).get('bits_default')).toEqual(
      P,
    );
    expect((await readdir(join(file, '..'))).sort()).toEqual([
      'placement.json',
    ]);
  });

  it('refuses invalid values without changing anything; a corrupt or partly invalid file falls back per entry', async () => {
    const file = join(await tmp(), 'placement.json');
    const store = await AlertPlacementStore.open(file);
    await store.save('bits_default', P);
    for (const bad of [
      { media: { x: 'a' } },
      { media: { x: 99999 } },
      { media: { scale: 0 } },
      { text: { scale: 50 } },
      null,
    ])
      await expect(store.save('bits_default', bad)).rejects.toThrow(
        'invalid_placement',
      );
    await expect(store.save('../x', P)).rejects.toThrow('bad_variant');
    await expect(
      store.save('bits_default', { ...P, parts: { 'bad id': P.media } }),
    ).rejects.toThrow('invalid_placement');
    await expect(
      store.save('bits_default', { ...P, parts: { bitsBadge: { scale: 99 } } }),
    ).rejects.toThrow('invalid_placement');
    expect(store.get('bits_default')).toEqual(P);
    await writeFile(file, '{ not json');
    expect((await AlertPlacementStore.open(file)).all()).toEqual({});
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        variants: {
          bits_default: P,
          raid_default: { media: { scale: -1 } },
          'bad id': P,
        },
      }),
    );
    expect((await AlertPlacementStore.open(file)).all()).toEqual({
      bits_default: P,
    });
  });
});

async function setup(
  core: (path: string, body?: unknown) => unknown,
  media: string[] = ['Raid Titan.webm', 'Raptoru_Alerte_Raid_Sound.mp3'],
) {
  const store = await AlertMediaStore.open(join(await tmp(), 'media'));
  await store.import(
    media.map((name) => ({
      name,
      from: join(
        FIX,
        name.endsWith('.mp3') ? 'audio-2_5s.mp3' : 'video-1s.webm',
      ),
    })),
  );
  const calls: { path: string; body?: unknown }[] = [];
  server = createServer();
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const rt = await AlertsRuntime.create({
    channelId: CH,
    core: (async (path: string, body?: unknown) => {
      calls.push({ path, body });
      return core(path, body);
    }) as never,
    origin,
    dir: await tmp(),
    playerDir: PLAYER_DIR,
    media: store,
  });
  server.on('request', (req, res) => {
    void rt.handle(req, res, new URL(req.url!, origin)).then((done) => {
      if (!done) res.writeHead(404).end();
    });
  });
  const token = new URL(rt.playerUrl).hash.slice(1);
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { origin, rt, token, calls, post };
}

describe('AlertsRuntime', () => {
  it('serves the OBS source / preview files with a strict CSP, nothing else', async () => {
    const { origin, rt } = await setup(() => ({}));
    expect(rt.playerUrl).toMatch(/\/alerts\/player\.html#[a-f0-9]{32}$/);
    for (const f of [
      'player.html',
      'preview.html',
      'engine.js',
      'timeline.js',
      'alerts.css',
    ]) {
      const res = await fetch(`${origin}/alerts/${f}`);
      expect(res.status, f).toBe(200);
      expect(res.headers.get('content-security-policy')).toContain(
        "script-src 'self'",
      );
    }
    expect((await fetch(`${origin}/alerts/../src/index.ts`)).status).toBe(404);
    expect((await fetch(`${origin}/alerts/manifest.json`)).status).toBe(404);
  });

  it('serves the stored media with byte ranges; a missing one is a 404', async () => {
    const { origin } = await setup(() => ({}));
    const url = `${origin}/alerts/media/${encodeURIComponent('Raid Titan.webm')}`;
    const full = await fetch(url);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/webm');
    const bytes = Buffer.from(await full.arrayBuffer());
    expect(bytes.equals(await readFile(join(FIX, 'video-1s.webm')))).toBe(true);
    const part = await fetch(url, { headers: { range: 'bytes=10-19' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(
      `bytes 10-19/${bytes.length}`,
    );
    expect(
      Buffer.from(await part.arrayBuffer()).equals(bytes.subarray(10, 20)),
    ).toBe(true);
    expect(
      (await fetch(url, { headers: { range: `bytes=${bytes.length + 5}-` } }))
        .status,
    ).toBe(416);
    const missing = await fetch(`${origin}/alerts/media/MoneyTest.webm`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'media_missing' });
  });

  it('claims for the OBS source only with its token, under its consumer id', async () => {
    const { token, calls, post } = await setup((path) =>
      path.endsWith('/claim') ? { alert: CLAIMED } : {},
    );
    expect(
      (
        await post('/alerts/next', {
          token: 'f'.repeat(32),
          consumer_id: 'obs-1',
        })
      ).status,
    ).toBe(403);
    expect(calls).toHaveLength(0);
    const res = await post('/alerts/next', { token, consumer_id: 'obs-1' });
    expect(await res.json()).toEqual({
      alert: {
        alert_id: CLAIMED.alert_id,
        attempt_id: CLAIMED.attempt_id,
        variant: VARIANT,
        data: CLAIMED.data,
        placement: IDENTITY_PLACEMENT,
      },
    });
    expect(calls).toEqual([
      { path: `/v1/lab/alerts/${CH}/claim`, body: { consumer_id: 'obs-1' } },
    ]);
  });

  it('an alert whose media is missing is reported failed (media_missing) and never handed to the source', async () => {
    let claims = 0;
    const { token, calls, post } = await setup(
      (path) =>
        path.endsWith('/claim')
          ? { alert: claims++ ? null : CLAIMED }
          : { status: 'failed' },
      ['Raid Titan.webm'],
    );
    const res = await post('/alerts/next', { token, consumer_id: 'obs-1' });
    expect(await res.json()).toEqual({ alert: null });
    expect(calls[1]).toEqual({
      path: `/v1/lab/alerts/items/${CLAIMED.alert_id}/ack`,
      body: {
        consumer_id: 'obs-1',
        attempt_id: CLAIMED.attempt_id,
        event: 'failed',
        error: 'media_missing: Raptoru_Alerte_Raid_Sound.mp3',
      },
    });
  });

  it('relays the source reports as they are (Core keeps them idempotent); Core refusals pass through', async () => {
    const { token, calls, post } = await setup((path, body) => {
      if ((body as { event?: string }).event === 'completed')
        throw Object.assign(new Error('alert_ended'), {
          status: 409,
          body: { error: 'alert_ended' },
        });
      return { status: 'playing' };
    });
    const ack = {
      token,
      consumer_id: 'obs-1',
      alert_id: CLAIMED.alert_id,
      attempt_id: CLAIMED.attempt_id,
    };
    expect(
      (await post('/alerts/ack', { ...ack, event: 'started' })).status,
    ).toBe(200);
    expect(calls[0]).toEqual({
      path: `/v1/lab/alerts/items/${CLAIMED.alert_id}/ack`,
      body: {
        consumer_id: 'obs-1',
        attempt_id: CLAIMED.attempt_id,
        event: 'started',
      },
    });
    const late = await post('/alerts/ack', { ...ack, event: 'completed' });
    expect(late.status).toBe(409);
    expect(
      (
        await post('/alerts/ack', {
          ...ack,
          alert_id: '../x',
          event: 'started',
        })
      ).status,
    ).toBe(400);
    expect(
      (await post('/alerts/ack', { ...ack, token: 'nope', event: 'started' }))
        .status,
    ).toBe(403);
  });

  it('tab API: Studio header required; state adds media + URLs; catalogue flags missing media', async () => {
    const { origin, rt, calls } = await setup(
      (path) =>
        path.endsWith('/catalog')
          ? {
              variants: [
                VARIANT,
                {
                  id: 'don_moneytest',
                  type: 'donation',
                  video: 'MoneyTest.webm',
                  audio: 'Son Alerte Don.mp3',
                },
              ],
            }
          : { in_flight: [], queued: [], recent: [] },
      ['Raid Titan.webm', 'Raptoru_Alerte_Raid_Sound.mp3'],
    );
    expect((await fetch(`${origin}/api/alerts/state`)).status).toBe(403);
    const H = { 'x-raptoru-studio': '1' };
    const state = (await (
      await fetch(`${origin}/api/alerts/state`, { headers: H })
    ).json()) as Record<string, unknown>;
    expect(state).toMatchObject({
      queued: [],
      player_url: rt.playerUrl,
      preview_url: '/alerts/preview.html',
    });
    expect(
      (state.media as { name: string; available: boolean }[])
        .filter((m) => m.available)
        .map((m) => m.name),
    ).toEqual(['Raid Titan.webm', 'Raptoru_Alerte_Raid_Sound.mp3']);
    const cat = (await (
      await fetch(`${origin}/api/alerts/catalog`, { headers: H })
    ).json()) as { variants: { id: string; missing: string[] }[] };
    expect(cat.variants.map((v) => [v.id, v.missing])).toEqual([
      ['raid_default', []],
      ['don_moneytest', ['MoneyTest.webm', 'Son Alerte Don.mp3']],
    ]);
    expect(calls.map((c) => c.path)).toEqual([
      `/v1/lab/alerts/${CH}/state`,
      '/v1/lab/alerts/catalog',
    ]);
  });

  it('calibration: tab API behind the Studio header; the OBS source gets the SAVED placement with each claim', async () => {
    const { origin, token, post } = await setup((path) =>
      path.endsWith('/claim') ? { alert: CLAIMED } : {},
    );
    const H = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
    const put = (
      id: string,
      body: unknown,
      headers: Record<string, string> = H,
    ) =>
      fetch(`${origin}/api/alerts/placement/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
    const P = {
      media: { x: 100, y: -50, scale: 0.5 },
      text: { x: 0, y: 20, scale: 1 },
    };
    expect(
      (await put('raid_default', P, { 'content-type': 'application/json' }))
        .status,
    ).toBe(403);
    expect((await put('raid_default', { media: { scale: 9 } })).status).toBe(
      400,
    );
    const next = async () =>
      (
        (await (
          await post('/alerts/next', { token, consumer_id: 'obs-1' })
        ).json()) as { alert: { placement: unknown } }
      ).alert.placement;
    expect(await next()).toEqual(IDENTITY_PLACEMENT);
    expect(await (await put('raid_default', P)).json()).toEqual({
      placement: P,
    });
    expect(
      await (
        await fetch(`${origin}/api/alerts/placement`, { headers: H })
      ).json(),
    ).toEqual({ variants: { raid_default: P } });
    // Read at claim time: the next alert of the variant uses it.
    expect(await next()).toEqual(P);
  });

  it('test event: a simulation through Core, only the event fields, a fresh id each time', async () => {
    const { origin, calls } = await setup(() => ({ outcome: 'queued' }));
    const send = () =>
      fetch(`${origin}/api/alerts/test`, {
        method: 'POST',
        headers: {
          'x-raptoru-studio': '1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'raid',
          actor: { display_name: 'R' },
          viewers: 7,
          source: 'twitch',
          channel_id: '1',
        }),
      });
    expect(await (await send()).json()).toEqual({ outcome: 'queued' });
    await send();
    const [a, b] = calls.map((c) => c.body as Record<string, unknown>);
    expect(a).toMatchObject({
      channel_id: CH,
      source: 'simulation',
      type: 'raid',
      actor: { display_name: 'R' },
      viewers: 7,
    });
    expect(a!.source_event_id).toMatch(/^studio-test-/);
    expect(a!.source_event_id).not.toBe(b!.source_event_id);
  });

  it('refuses another host or origin (DNS rebinding / foreign page)', async () => {
    const { origin, token, post } = await setup(() => ({ alert: null }));
    expect(
      (
        await post(
          '/alerts/next',
          { token, consumer_id: 'x' },
          { origin: 'http://evil.example' },
        )
      ).status,
    ).toBe(403);
    // fetch cannot override Host: a raw request does.
    const status = await new Promise<number>((ok) =>
      request(
        `${origin}/alerts/player.html`,
        { headers: { host: 'evil.example' } },
        (r) => ok(r.statusCode!),
      ).end(),
    );
    expect(status).toBe(403);
  });
});
