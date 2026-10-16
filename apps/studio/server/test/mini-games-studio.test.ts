import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { miniGamesRelay } from '../src/mini-games/relay.js';

// Roulette and Slot V1 in Studio: the switch « Mini-jeux » relayed to Core (no game logic here).

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function setup(
  core: (path: string, body?: unknown) => Promise<unknown> = async () => ({
    channel_id: '900100',
    enabled: false,
    recent: [],
  }),
) {
  const calls: { path: string; body?: unknown }[] = [];
  const relay = miniGamesRelay((async (path: string, body?: unknown) => {
    calls.push({ path, body });
    return core(path, body);
  }) as never);
  server = createServer((req, res) => {
    void relay(req, res, new URL(req.url ?? '/', 'http://x')).then((h) => {
      if (!h) res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const studio = (path: string, init: RequestInit = {}) =>
    fetch(base + path, {
      ...init,
      headers: { 'x-raptoru-studio': '1', ...(init.headers ?? {}) },
    });
  return { base, calls, studio };
}

describe('mini-games relay', () => {
  it('GET state relays Core; POST settings sends only the switch', async () => {
    const s = await setup();
    expect(
      await (await s.studio('/api/mini-games/state')).json(),
    ).toMatchObject({
      enabled: false,
    });
    const res = await s.studio('/api/mini-games/settings', {
      method: 'POST',
      body: JSON.stringify({ enabled: true, channel_id: '666', actor: 'x' }),
    });
    expect(res.status).toBe(200);
    expect(s.calls).toEqual([
      { path: '/v1/lab/mini-games/900100/state', body: undefined },
      { path: '/v1/lab/mini-games/900100/settings', body: { enabled: true } },
    ]);
  });

  it('refuses a call without the Studio header; keeps Core’s refusal status', async () => {
    const s = await setup(async () => {
      throw Object.assign(new Error('http 400'), {
        status: 400,
        body: { error: 'invalid_request' },
      });
    });
    expect((await fetch(`${s.base}/api/mini-games/state`)).status).toBe(403);
    const res = await s.studio('/api/mini-games/settings', {
      method: 'POST',
      body: JSON.stringify({ enabled: 'yes' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
    expect((await s.studio('/api/mini-games/other')).status).toBe(404);
    expect((await fetch(`${s.base}/api/other`)).status).toBe(404);
  });
});
