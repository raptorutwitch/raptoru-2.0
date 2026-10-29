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

  it('the WizeBot import: the three public rankings (WizeBot forced), batches the Cores accept, a duplicated id set aside first, a dry run that writes nothing', async () => {
    const sent: {
      url: string;
      body: { dry_run: boolean; rows: { login: string }[] };
    }[] = [];
    const core = (async (path: string, body?: unknown) => {
      const b = body as { dry_run: boolean; rows: { login: string }[] };
      sent.push({ url: path, body: b });
      return {
        [b.dry_run ? 'would_import' : 'imported']: b.rows.length,
        already: 0,
        by_id: 0,
        by_login: b.rows.length,
        unresolved: [],
        ambiguous: [],
        conflicts: [],
      };
    }) as never;
    const many = Array.from({ length: 130 }, (_, i) => ({
      username: `v${i}`,
      value: 5,
    }));
    const pages: Record<string, unknown> = {
      ranks: {
        players: [
          ...many,
          { username: 'twin_a', value: 3, twitch_user_id: '9' },
          { username: 'twin_b', value: 4, twitch_user_id: '9' },
        ],
      },
      uptime: { players: [] },
      message: { players: [] },
    };
    const asked: string[] = [];
    const call = await start(
      new ProgressionRelay({
        core,
        environment: 'lab',
        fetchJson: async (u) => {
          asked.push(u);
          return pages[new URL(u).searchParams.get('type')!];
        },
      }),
    );
    const dry = await call('/api/progression/import/wizebot/dry-run', {});
    expect(dry.body).toMatchObject({
      dry_run: true,
      read: 132,
      would_import: 130,
      conflicts: ['twin_a', 'twin_b'],
    });
    expect(sent.every((x) => x.body.dry_run === true)).toBe(true);
    expect(sent.map((x) => x.body.rows.length)).toEqual([60, 60, 10]); // under the Lab Core's 8 KB per request
    expect(sent.every((x) => JSON.stringify(x.body).length < 8192)).toBe(true);
    expect(
      asked.every((u) => new URL(u).searchParams.get('source') === 'wizebot'),
    ).toBe(true);
    sent.length = 0;
    const real = await call('/api/progression/import/wizebot', {});
    expect(real.body).toMatchObject({ dry_run: false, imported: 130 });
    expect(sent.every((x) => x.body.dry_run === false)).toBe(true);
    pages.ranks = { players: [] };
    expect((await call('/api/progression/import/wizebot', {})).status).toBe(
      502,
    );
  });
});
