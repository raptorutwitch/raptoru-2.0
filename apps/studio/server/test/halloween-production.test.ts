import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HalloweenRuntime } from '../src/halloween/runtime.js';
import { CHANNEL, pairedStudio, type Cleanups } from './prod-fixture.js';

// Halloween in the PRODUCTION profile (docs/HALLOWEEN.md): Studio's runtime against the real main Core over HTTPS
// with a paired installation — /v1/studio/events/* (heartbeat, claim, ack), the installation id as Studio's id, the
// Core's own channel. The overlay page is simulated over HTTP exactly as overlay.js speaks (long-poll + reports).
// What the Lab e2e cannot prove: the production routes, credential and channel binding.

const cleanups: Cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const VIEWER = { id: '930001', display_name: 'Ana' };

async function stack() {
  const p = await pairedStudio(cleanups);
  const shop = p.core.eventShop;
  await shop.updateSettings(CHANNEL, {
    enabled: true,
    rules: { viewer_gap_ms: 0, screamer_gap_ms: 0 },
  });
  await shop.grant(
    {
      idempotency_key: randomUUID(),
      channel_id: CHANNEL,
      viewer: VIEWER.id,
      amount: 50,
      reason: 'grant',
    },
    'test',
  );
  // Studio's media: one screamer of the catalogue (the bytes do not matter: the page is simulated).
  await mkdir(join(p.dir, 'halloween', 'media'), { recursive: true });
  await writeFile(join(p.dir, 'halloween', 'media', 'foxy.webm'), 'webm');
  await writeFile(
    join(p.dir, 'halloween', 'media', 'manifest.json'),
    JSON.stringify({
      media: [
        {
          id: 'foxy',
          label: 'Foxy',
          kind: 'screamer',
          file: 'foxy.webm',
          duration_ms: 1000,
          width: 64,
          height: 36,
          alpha: true,
          audio: true,
        },
      ],
    }),
  );
  // The server needs the runtime, the runtime needs the server's origin.
  const ref: { rt?: HalloweenRuntime } = {};
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, origin);
    if (!(await ref.rt!.handle(req, res, url))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const rt = (ref.rt = new HalloweenRuntime({
    origin,
    dir: join(p.dir, 'halloween'),
    pageDir: join(import.meta.dirname, '..', 'halloween-overlay'),
    core: p.client(),
    environment: 'production',
    channelId: CHANNEL,
    studioId: p.installation.installationId,
    fromMain: () => false,
  }));
  await rt.start();
  cleanups.push(async () => rt.stop());
  const token = rt.overlayUrl().split('#')[1]!;

  // The overlay page, as overlay.js: long-poll « next » (ready, stop epoch), then reports.
  let running = true;
  cleanups.push(async () => {
    running = false;
  });
  const deliveries: { delivery_id: string; label: string }[] = [];
  const page = (async () => {
    let epoch = 0;
    while (running) {
      const r = await fetch(
        `${origin}/halloween/overlay/next?wait=1&ready=1&epoch=${epoch}`,
        { headers: { 'x-overlay-token': token } },
      ).catch(() => null);
      if (!r?.ok) continue;
      const v = (await r.json()) as {
        stop_epoch: number;
        delivery?: { delivery_id: string; label: string };
      };
      epoch = v.stop_epoch;
      if (v.delivery) deliveries.push(v.delivery);
    }
  })();
  cleanups.push(async () => {
    running = false;
    await Promise.race([page, new Promise((r) => setTimeout(r, 50))]);
  });
  const report = (delivery_id: string, event: string) =>
    fetch(`${origin}/halloween/overlay/report`, {
      method: 'POST',
      headers: { 'x-overlay-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ delivery_id, event }),
    });
  const until = async <T>(f: () => Promise<T> | T, ok: (v: T) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const v = await f();
      if (ok(v)) return v;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('timeout');
  };
  const last = async () => (await shop.admin(CHANNEL)).purchases[0];
  const buy = (item_id: string) =>
    shop.purchase({
      idempotency_key: randomUUID(),
      channel_id: CHANNEL,
      viewer: VIEWER,
      item_id,
    });
  // Studio's « Halloween » tab (panel API, relayed to the production Core).
  const panel = async (path: string, body?: unknown) => {
    const r = await fetch(`${origin}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      body: (await r.json()) as Record<string, unknown>,
    };
  };
  return { rt, shop, deliveries, report, until, last, buy, panel };
}

describe('Halloween — production profile (main Core, paired installation, HTTPS)', () => {
  it('Studio says « ready » to the Core; a purchase is claimed, played, ended, paid once', async () => {
    const s = await stack();
    await s.until(
      async () => (await s.shop.viewerState(CHANNEL, VIEWER.id)).engine_ready,
      (v) => v,
    );
    expect(s.rt.status().core).toMatchObject({ connected: true });
    await s.buy('s-foxy');
    const d = await s.until(
      () => s.deliveries[0]!,
      (v) => !!v,
    );
    expect(d.label).toBe('Foxy');
    await s.report(d.delivery_id, 'started');
    await s.until(s.last, (v) => v?.status === 'executing');
    await s.report(d.delivery_id, 'ended');
    const p = await s.until(s.last, (v) => v?.status === 'completed');
    expect(p).toMatchObject({ refund_status: 'none', error: null });
    expect((await s.shop.viewerState(CHANNEL, VIEWER.id)).balance).toBe(40);
    // The Studio tab reads the shop and gives Bonbons on the production Core (its own channel only).
    const admin = await s.panel('/api/halloween/admin');
    expect(admin.status).toBe(200);
    expect((admin.body.purchases as unknown[]).length).toBe(1);
    const g = await s.panel('/api/halloween/admin/grant', {
      idempotency_key: randomUUID(),
      viewer: VIEWER.id,
      amount: 5,
      reason: 'raffle',
    });
    expect(g).toMatchObject({ status: 200, body: { balance: 45 } });
  }, 30_000);

  it('STOP ALL in Studio during a play: the screen is cleared and the Core ends it as stopped, without refund', async () => {
    const s = await stack();
    await s.until(
      async () => (await s.shop.viewerState(CHANNEL, VIEWER.id)).engine_ready,
      (v) => v,
    );
    await s.buy('fog');
    const d = await s.until(
      () => s.deliveries[0]!,
      (v) => !!v,
    );
    await s.report(d.delivery_id, 'started');
    await s.until(s.last, (v) => !!v?.started_at);
    await s.rt.stopAll();
    const p = await s.until(s.last, (v) => v?.status === 'failed');
    expect(p).toMatchObject({ error: 'stopped', refund_status: 'none' });
  }, 30_000);

  it('« Fermer la boutique » during a play: one click — closed, the screen cleared at once (like STOP ALL), nothing more handed over; « Ouvrir » again: the same balance', async () => {
    const s = await stack();
    await s.until(
      async () => (await s.shop.viewerState(CHANNEL, VIEWER.id)).engine_ready,
      (v) => v,
    );
    await s.buy('fog');
    const d = await s.until(
      () => s.deliveries[0]!,
      (v) => !!v,
    );
    await s.report(d.delivery_id, 'started');
    await s.until(s.last, (v) => !!v?.started_at);
    const before = (await s.shop.viewerState(CHANNEL, VIEWER.id)).balance;
    const off = await s.panel('/api/halloween/admin/settings', {
      enabled: false,
    });
    expect(off).toMatchObject({ status: 200, body: { enabled: false } });
    const p = await s.until(s.last, (v) => v?.status === 'failed');
    expect(p).toMatchObject({ error: 'stopped', refund_status: 'none' });
    expect((await s.shop.viewerState(CHANNEL, VIEWER.id)).enabled).toBe(false);
    const on = await s.panel('/api/halloween/admin/settings', {
      enabled: true,
    });
    expect(on.body).toMatchObject({ enabled: true });
    expect((await s.shop.viewerState(CHANNEL, VIEWER.id)).balance).toBe(before);
  }, 30_000);
});
