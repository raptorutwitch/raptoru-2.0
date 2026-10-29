import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ProgressionRelay, wizebotRows } from '../src/progression/relay.js';

// Progression native (docs/PROGRESSION.md) — Studio's relay: the Studio header, the profile's Core paths (Lab or
// Production), errors passed through, and the WizeBot import built from raptoru.fr's public rankings.

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

describe('WizeBot rows', () => {
  it('one row per viewer from the levels ranking, watchtime and messages joined by pseudo, Twitch id when known', () => {
    const rows = wizebotRows(
      [
        { username: 'Chechay', value: 135, twitch_user_id: '225526114' },
        { username: 'aouh', value: 90 },
        { username: 'bad name!', value: 3 },
        { username: 'zero', value: 0 },
      ],
      [
        { username: 'chechay', value: 12_468_784 },
        { username: 'aouh', value: 5000, twitch_user_id: '413481355' },
      ],
      [{ username: 'aouh', value: 126_371 }],
    );
    expect(rows).toEqual([
      {
        twitch_user_id: '225526114',
        login: 'chechay',
        level: 135,
        watch_seconds: 12_468_784,
        messages: 0,
      },
      {
        twitch_user_id: '413481355',
        login: 'aouh',
        level: 90,
        watch_seconds: 5000,
        messages: 126_371,
      },
    ]);
  });
});

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

  it('the WizeBot import reads the three public rankings and sends one import; nothing to read: an explicit error', async () => {
    const sent: unknown[] = [];
    const core = (async (_path: string, body?: unknown) => {
      sent.push(body);
      return { imported: 1, already: 0, unresolved: ['aouh'] };
    }) as never;
    const pages: Record<string, unknown> = {
      ranks: {
        players: [
          { username: 'chechay', value: 135, twitch_user_id: '1' },
          { username: 'aouh', value: 90 },
        ],
      },
      uptime: { players: [{ username: 'chechay', value: 60 }] },
      message: { players: [] },
    };
    const call = await start(
      new ProgressionRelay({
        core,
        environment: 'lab',
        fetchJson: async (u) => pages[new URL(u).searchParams.get('type')!],
      }),
    );
    const r = await call('/api/progression/import/wizebot', {});
    expect(r.body).toEqual({
      read: 2,
      imported: 1,
      already: 0,
      unresolved: ['aouh'],
    });
    expect((sent[0] as { rows: unknown[] }).rows).toHaveLength(2);
    pages.ranks = { players: [] };
    expect((await call('/api/progression/import/wizebot', {})).status).toBe(
      502,
    );
  });
});
