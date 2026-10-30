import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ProgressionRelay } from '../src/progression/relay.js';

// Progression native (docs/PROGRESSION.md) — Studio's relay: the Studio header, the profile's Core paths (Lab or
// Production), errors passed through, the admin paths, and the WizeBot import (read by the Core itself).

let server: Server | null = null;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((r) => (server ? server.close(r) : r(null)));
  server = null;
});

async function start(relay: ProgressionRelay) {
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
    }).then(async (r) => ({
      status: r.status,
      body: (await r.json()) as Record<string, unknown>,
    }));
}

describe('relay', () => {
  it('Studio header required; Lab paths; Production paths; Core errors passed through', async () => {
    const calls: [string, unknown][] = [];
    const core = (async (path: string, body?: unknown) => {
      calls.push([path, body]);
      if (path.endsWith('/revoke'))
        throw Object.assign(new Error('not_owned'), {
          status: 404,
          body: { error: 'not_owned' },
        });
      return { ok: true, path };
    }) as never;
    let call = await start(new ProgressionRelay({ core, environment: 'lab' }));
    expect(
      (await call('/api/progression/state', undefined, false)).status,
    ).toBe(403);
    expect((await call('/api/progression/state')).body.path).toBe(
      '/v1/lab/progression/settings',
    );
    await call('/api/progression/grant', { reward_id: 'x', viewers: ['1'] });
    expect(calls.at(-1)).toEqual([
      '/v1/lab/progression/grant',
      { reward_id: 'x', viewers: ['1'] },
    ]);
    expect(
      await call('/api/progression/revoke', {
        reward_id: 'x',
        viewer: '1',
        reason: 'r',
      }),
    ).toEqual({ status: 404, body: { error: 'not_owned' } });
    await call('/api/progression/viewers?q=an%25');
    expect(calls.at(-1)![0]).toBe('/v1/lab/progression/viewers?q=an%25');
    server!.closeAllConnections();
    await new Promise((r) => server!.close(r));
    call = await start(
      new ProgressionRelay({ core, environment: 'production' }),
    );
    expect((await call('/api/progression/viewers/42')).body.path).toBe(
      '/v1/studio/progression/viewers/42',
    );
    expect((await call('/api/progression/nope')).status).toBe(404);
  });

  it('the new admin paths and the WizeBot import: one Core call (the Core reads WizeBot), long timeout, dry run flagged', async () => {
    const calls: [string, unknown, unknown][] = [];
    const core = (async (path: string, body?: unknown, o?: unknown) => {
      calls.push([path, body, o]);
      return { ok: true };
    }) as never;
    const call = await start(
      new ProgressionRelay({ core, environment: 'production' }),
    );
    await call('/api/progression/import/status');
    await call('/api/progression/import/waiting?q=old');
    await call('/api/progression/viewers/42/history');
    await call('/api/progression/adjust', { viewer: '42' });
    await call('/api/progression/import/attach', { login: 'x' });
    await call('/api/progression/import/resolve', {});
    await call('/api/progression/level-v2');
    await call('/api/progression/levelups');
    await call('/api/progression/level-v2/activate', { confirm: 'x' });
    await call('/api/progression/level-v2/revert', { confirm: 'x' });
    await call('/api/progression/viewers/42/notify', {
      level_up_notify: 'text',
    });
    expect(calls.map((c) => c[0])).toEqual([
      '/v1/studio/progression/import/status',
      '/v1/studio/progression/import/waiting?q=old',
      '/v1/studio/progression/viewers/42/history',
      '/v1/studio/progression/adjust',
      '/v1/studio/progression/import/attach',
      '/v1/studio/progression/import/resolve',
      '/v1/studio/progression/level-v2',
      '/v1/studio/progression/levelups',
      '/v1/studio/progression/level-v2/activate',
      '/v1/studio/progression/level-v2/revert',
      '/v1/studio/progression/viewers/42/notify',
    ]);
    calls.length = 0;
    await call('/api/progression/import/wizebot/dry-run', {});
    await call('/api/progression/import/wizebot', {});
    expect(calls).toEqual([
      [
        '/v1/studio/progression/import/wizebot',
        { dry_run: true },
        { timeoutMs: 180_000 },
      ],
      [
        '/v1/studio/progression/import/wizebot',
        { dry_run: false },
        { timeoutMs: 180_000 },
      ],
    ]);
  });
});
