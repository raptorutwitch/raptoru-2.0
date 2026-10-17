import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../core-api/src/http/server.js';
import {
  sha256,
  STUDIO_PROTOCOL_HEADER,
} from '../../../core-api/src/studio/installations.js';
import { setup } from '../../../core-api/test/helpers.js';
import { AlertMediaStore } from '../src/alerts/media-store.js';
import { AlertsRuntime } from '../src/alerts/runtime.js';
import { SeTipsLink } from '../src/alerts/se-tips.js';
import { FAKE_JWT, SE_TIP_EXAMPLE } from './fixtures/se-tips.js';

// Twitch alerts V1 in the Production profile (§ 22): the SAME Studio runtime, on the production Core's
// /v1/studio/alerts routes (installation credential, the Core's channel), not the Lab Core. The production client is
// emulated over plain HTTP (prodCoreClient itself only speaks HTTPS; its credential / protocol headers are the same).

const CHANNEL = '83603689';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function productionCore() {
  const core = await setup();
  core.clock.set(new Date());
  const app: Server = createApp({
    ...core,
    labRoutes: false,
    botSecret: 'bot-test-secret',
    studioSecret: 'studio-test-secret',
    cockpit: {
      core: () => Promise.reject(new Error('unused')),
      channelId: CHANNEL,
    },
  });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => app.close(() => r(undefined))));
  const url = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  await core.studioInstallations.register(`${id}.${sha256(secret)}`, 'PC test');
  const paths: string[] = [];
  const call = async (path: string, body?: unknown) => {
    paths.push(path);
    const res = await fetch(url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer rsi_${id}.${secret}`,
        [STUDIO_PROTOCOL_HEADER]: '1',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await res.json()) as Record<string, unknown>;
    if (!res.ok)
      throw Object.assign(new Error(String(out.error ?? res.status)), {
        status: res.status,
      });
    return out;
  };
  return { call: call as never, paths };
}

describe('alerts in the Production profile', () => {
  it('simulation, OBS source claim / reports and StreamElements donations all go to /v1/studio/alerts', async () => {
    const prod = await productionCore();
    const dir = await mkdtemp(join(tmpdir(), 'alerts-prod-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    let rt: AlertsRuntime | null = null;
    const studio = createServer((req, res) => {
      void rt!.handle(req, res, new URL(req.url!, origin)).then((d) => {
        if (!d) res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => studio.listen(0, '127.0.0.1', r));
    cleanups.push(() => new Promise((r) => studio.close(() => r(undefined))));
    const origin = `http://127.0.0.1:${(studio.address() as AddressInfo).port}`;
    const sockets: { onmessage: ((e: { data: unknown }) => void) | null }[] =
      [];
    const se = await SeTipsLink.open({
      dir: join(dir, 'production', 'alerts'),
      environment: 'production',
      channelId: CHANNEL,
      core: prod.call,
      fromMain: () => true,
      socket: () => {
        const s = {
          send() {},
          close() {},
          onmessage: null,
          onclose: null,
          onerror: null,
        };
        sockets.push(s);
        return s;
      },
      log: () => {},
    });
    rt = await AlertsRuntime.create({
      channelId: CHANNEL,
      core: prod.call,
      environment: 'production',
      origin,
      dir: join(dir, 'alerts'),
      playerDir: join(import.meta.dirname, '..', 'alerts-player'),
      media: await AlertMediaStore.open(join(dir, 'media')),
      se,
    });
    const api = (path: string, body?: unknown) =>
      fetch(`${origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'x-raptoru-studio': '1',
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
      }).then((r) => r.json() as Promise<Record<string, any>>);
    // Studio tab: catalogue, simulated event, state.
    expect((await api('/api/alerts/catalog')).variants.length).toBeGreaterThan(
      10,
    );
    expect(
      (
        await api('/api/alerts/test', {
          type: 'raid',
          actor: { display_name: 'Simu' },
          viewers: 2,
        })
      ).outcome,
    ).toBe('queued');
    // StreamElements donation (ACTIVE chosen explicitly) through the same production Core.
    se.setToken('jwt', FAKE_JWT, null);
    await se.setMode('active');
    sockets.at(-1)!.onmessage!({
      data: JSON.stringify({ type: 'welcome', data: {} }),
    });
    sockets.at(-1)!.onmessage!({ data: JSON.stringify(SE_TIP_EXAMPLE) });
    await new Promise((r) => setTimeout(r, 300));
    const state = await api('/api/alerts/state');
    expect(
      state.queued.map((q: { family: string }) => q.family).sort(),
    ).toEqual(['donation', 'raid']);
    // The OBS source (token) claims and reports through Studio → production Core. Raid media are not imported here:
    // Studio reports it failed (media_missing) at once, as in the Lab.
    const token = new URL(rt.playerUrl).hash.slice(1);
    const next = await fetch(`${origin}/alerts/next`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        consumer_id: 'obs-1',
        version: await rt.playerVersion(),
      }),
    }).then((r) => r.json());
    expect(next.alert).toBeNull();
    const recent = (await api('/api/alerts/state')).recent as {
      status: string;
      failure: { message?: string } | null;
    }[];
    expect(recent.map((r) => r.status)).toEqual(['failed', 'failed']);
    // Twitch real events are not available in this profile (production bot not wired yet).
    expect(await api('/api/alerts/twitch')).toMatchObject({
      environment: 'production',
      available: false,
    });
    expect(await api('/api/alerts/se')).toMatchObject({
      environment: 'production',
      mode: 'active',
    });
    // Every call went to the production routes, none to the Lab.
    expect(prod.paths.every((p) => p.startsWith('/v1/studio/alerts/'))).toBe(
      true,
    );
    expect(prod.paths).toEqual(
      expect.arrayContaining([
        '/v1/studio/alerts/catalog',
        '/v1/studio/alerts/events',
        `/v1/studio/alerts/${CHANNEL}/state`,
        `/v1/studio/alerts/${CHANNEL}/claim`,
      ]),
    );
    se.close();
  });
});
