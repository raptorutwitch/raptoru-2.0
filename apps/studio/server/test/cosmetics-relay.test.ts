import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CosmeticsRelay } from '../src/cosmetics/relay.js';

// Boutique cosmétique V1 (docs/COSMETIC_SHOP.md) — Studio's relay: the Studio header on the API, the profile's Core
// paths (Lab or Production), errors passed through, and the preview's assets (the Core's stylesheet, checked images).

let server: Server | null = null;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((r) => (server ? server.close(r) : r(null)));
  server = null;
});

async function start(relay: CosmeticsRelay) {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://studio');
    if (!(await relay.handle(req, res, url))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return (path: string, body?: unknown, studio = true) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(studio ? { 'x-raptoru-studio': '1' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

describe('cosmetics relay', () => {
  it('Studio header required; Lab and Production paths; Core errors passed through', async () => {
    const calls: [string, unknown][] = [];
    const core = (async (path: string, body?: unknown) => {
      calls.push([path, body]);
      if (path.endsWith('/refund'))
        throw Object.assign(new Error('already_refunded'), {
          status: 409,
          body: { error: 'already_refunded' },
        });
      return { ok: true, path };
    }) as never;
    let call = await start(new CosmeticsRelay({ core, environment: 'lab' }));
    expect((await call('/api/cosmetics/items', undefined, false)).status).toBe(
      403,
    );
    expect(await (await call('/api/cosmetics/items')).json()).toMatchObject({
      path: '/v1/lab/cosmetics/items',
    });
    await call('/api/cosmetics/items/roi/duplicate', { new_id: 'roi-2' });
    expect(calls.at(-1)).toEqual([
      '/v1/lab/cosmetics/items/roi/duplicate',
      { new_id: 'roi-2' },
    ]);
    const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
    const r = await call(`/api/cosmetics/purchases/${id}/refund`, {
      reason: 'test',
    });
    expect([r.status, await r.json()]).toEqual([
      409,
      { error: 'already_refunded' },
    ]);
    expect(
      (await call('/api/cosmetics/items/Bad%20Id/rename', {})).status,
    ).toBe(404);
    expect((await call('/api/cosmetics/viewers/abc')).status).toBe(404);
    server!.closeAllConnections();
    await new Promise((res) => server!.close(res));
    call = await start(new CosmeticsRelay({ core, environment: 'production' }));
    await call('/api/cosmetics/offers', { offer_id: 'roi-j' });
    expect(calls.at(-1)![0]).toBe('/v1/studio/cosmetics/offers');
  });

  it('no Core → 503; the preview gets the Core stylesheet and only PNG/WebP images', async () => {
    let call = await start(
      new CosmeticsRelay({ core: null, environment: null }),
    );
    expect((await call('/api/cosmetics/items')).status).toBe(503);
    server!.closeAllConnections();
    await new Promise((res) => server!.close(res));
    const core = (async (path: string) => {
      if (path === '/v1/cosmetics/style.json') return { css: '.rc-title{}' };
      if (path.endsWith('a'.repeat(64)))
        return { mime: 'image/png', data_base64: PNG.toString('base64') };
      return { mime: 'image/svg+xml', data_base64: 'PHN2Zz4=' };
    }) as never;
    call = await start(new CosmeticsRelay({ core, environment: 'lab' }));
    const css = await call('/cosmetics/style.css', undefined, false);
    expect([css.headers.get('content-type'), await css.text()]).toEqual([
      'text/css; charset=utf-8',
      '.rc-title{}',
    ]);
    const img = await call(
      `/cosmetics/images/${'a'.repeat(64)}`,
      undefined,
      false,
    );
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
    expect(
      (await call(`/cosmetics/images/${'b'.repeat(64)}`, undefined, false))
        .status,
    ).toBe(415);
    expect(
      (await call('/cosmetics/images/../x', undefined, false)).status,
    ).toBe(404);
  });
});
