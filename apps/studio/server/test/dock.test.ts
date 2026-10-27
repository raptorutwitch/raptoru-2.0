import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DOCK_HUB,
  DockHub,
  type DockActivity,
  type DockHubEvent,
} from '../src/dock/hub.js';
import { DockKey, DockServer } from '../src/dock/server.js';
import { dockStudioApi } from '../src/dock/studio-api.js';

// Dock OBS V1 (docs/OBS_DOCK.md) — Studio side, against a fake Core: the ONE feed follower (snapshot, changes in
// order, reset, Core unreachable then back, bounded cache, stops without docks) and the dock's own local server (its
// host only, the key on every call, strict headers, the stream, the replay's origin / JSON / uuid checks, a new key
// closing the open docks). No real Core, OBS or Twitch.

const CH = '83603689';
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const act = (
  key: string,
  seq: number,
  at = '2026-10-27T20:00:00.000Z',
  state: Record<string, unknown> = {},
): DockActivity => ({
  activity_key: key,
  kind: 'alert',
  type: 'follow',
  occurred_at: at,
  data: { actor: { login: key, display_name: key } },
  state,
  seq,
});

/** A fake Core feed: rows by seq, answers like /v1/studio/dock/*. */
function fakeCore() {
  const rows: DockActivity[] = [];
  let down = false;
  const calls: string[] = [];
  const replays: unknown[] = [];
  let cursor = 0;
  const core = async <T>(path: string, body?: unknown): Promise<T> => {
    calls.push(path);
    if (down)
      throw Object.assign(new Error('core_unavailable'), { status: 503 });
    const u = new URL(`http://core${path}`);
    if (u.pathname.endsWith('/activity')) {
      const latest = new Map<string, DockActivity>();
      for (const r of rows) latest.set(r.activity_key, r);
      return {
        cursor,
        activities: [...latest.values()].reverse(),
        more: false,
      } as T;
    }
    if (u.pathname.endsWith('/changes')) {
      const after = Number(u.searchParams.get('after'));
      if (after > cursor) return { cursor, activities: [], reset: true } as T;
      const out = rows.filter((r) => r.seq > after);
      if (!out.length) await new Promise((r) => setTimeout(r, 5));
      return { cursor: out.at(-1)?.seq ?? after, activities: out } as T;
    }
    if (u.pathname.endsWith('/replay')) {
      replays.push({ path: u.pathname, body });
      if (u.pathname.includes('00000000-0000-4000-8000-00000000dead'))
        throw Object.assign(new Error('original_not_played_yet'), {
          status: 409,
          body: { error: 'original_not_played_yet' },
        });
      return { replay_alert_id: randomUUID(), created: true } as T;
    }
    throw new Error(`unexpected ${path}`);
  };
  return {
    core,
    calls,
    replays,
    push: (r: DockActivity) => {
      cursor = Math.max(cursor, r.seq);
      rows.push(r);
    },
    setDown: (v: boolean) => (down = v),
    rewind: () => {
      cursor = 0;
      rows.length = 0;
    },
  };
}

/** A real (tiny) pause: the hub's backoff must yield to the event loop. */
const tick = () => new Promise<void>((r) => setTimeout(r, 1));

const until = async (check: () => boolean, ms = 2_000) => {
  const t = Date.now();
  while (!check()) {
    if (Date.now() - t > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('DockHub — one follower of the Core feed for every dock', () => {
  it('snapshot first, then each change once, in order; a newer copy replaces the older one', async () => {
    const f = fakeCore();
    f.push(act('a', 1));
    const hub = new DockHub({
      core: f.core,
      environment: 'production',
      channelId: CH,
      sleep: tick,
    });
    const events: DockHubEvent[] = [];
    const stop = hub.subscribe((e) => events.push(e));
    await until(() => events.some((e) => e.type === 'snapshot'));
    expect(f.calls[0]).toBe(
      `/v1/studio/dock/${CH}/activity?limit=${DOCK_HUB.snapshotLimit}`,
    );
    f.push(act('b', 2));
    f.push(act('a', 3, undefined, { alert_status: 'completed' }));
    await until(
      () =>
        hub.snapshot().activities.find((a) => a.activity_key === 'a')?.seq ===
        3,
    );
    const ups = events
      .filter((e) => e.type === 'upsert')
      .flatMap((e) => (e.type === 'upsert' ? e.activities : []));
    expect(ups.map((a) => `${a.activity_key}@${a.seq}`)).toEqual([
      'b@2',
      'a@3',
    ]);
    expect(hub.status.state).toBe('live');
    // A late dock gets the current state at once.
    const late: DockHubEvent[] = [];
    const stop2 = hub.subscribe((e) => late.push(e));
    expect(late[0]).toMatchObject({ type: 'snapshot' });
    expect(
      late[0]!.type === 'snapshot' &&
        late[0]!.activities.map((a) => a.activity_key).sort(),
    ).toEqual(['a', 'b']);
    stop();
    stop2();
  });

  it('Core unreachable: stale (cache kept), then live again and caught up; cursor ahead: a fresh snapshot', async () => {
    const f = fakeCore();
    f.push(act('a', 1));
    const hub = new DockHub({
      core: f.core,
      environment: 'lab',
      channelId: CH,
      sleep: tick,
    });
    const stop = hub.subscribe(() => {});
    await until(() => hub.status.state === 'live');
    expect(f.calls[0]).toContain('/v1/lab/dock/');
    f.setDown(true);
    await until(() => hub.status.state === 'stale');
    expect(hub.snapshot().activities).toHaveLength(1);
    f.push(act('b', 2));
    f.setDown(false);
    await until(
      () =>
        hub.status.state === 'live' && hub.snapshot().activities.length === 2,
    );
    // The Core's feed was rebuilt (cursor back to 0): the hub starts again from a snapshot.
    f.rewind();
    f.push(act('c', 1));
    await until(
      () =>
        hub
          .snapshot()
          .activities.map((a) => a.activity_key)
          .join() === 'c',
    );
    stop();
  });

  it('the cache is bounded (newest kept, older pages from the Core)', async () => {
    const f = fakeCore();
    const hub = new DockHub({
      core: f.core,
      environment: 'production',
      channelId: CH,
      sleep: tick,
    });
    const stop = hub.subscribe(() => {});
    await until(() => hub.status.state === 'live');
    for (let i = 1; i <= DOCK_HUB.cacheMax + 20; i++)
      f.push(
        act(
          `k${i}`,
          i,
          new Date(Date.UTC(2026, 9, 27, 20, 0, i)).toISOString(),
        ),
      );
    await until(
      () =>
        hub.snapshot().activities[0]?.activity_key ===
        `k${DOCK_HUB.cacheMax + 20}`,
      5_000,
    );
    const s = hub.snapshot();
    expect(s.activities).toHaveLength(DOCK_HUB.cacheMax);
    expect(s.more).toBe(true);
    stop();
  });

  it('no dock: it stops following after the grace delay', async () => {
    const f = fakeCore();
    let now = 0;
    const hub = new DockHub({
      core: f.core,
      environment: 'production',
      channelId: CH,
      sleep: tick,
      now: () => now,
    });
    const stop = hub.subscribe(() => {});
    await until(() => hub.status.state === 'live');
    stop();
    now += DOCK_HUB.idleStopMs + 1;
    await until(() => hub.status.state === 'idle');
  });
});

describe('DockServer — the dock’s own local server', () => {
  async function serve() {
    const dir = await mkdtemp(join(tmpdir(), 'dock-'));
    dirs.push(dir);
    await writeFile(
      join(dir, 'index.html'),
      '<!doctype html><title>Dock</title>',
    );
    await writeFile(join(dir, 'dock.js'), 'export {}');
    await writeFile(join(dir, 'dock-view.js'), 'export {}');
    await writeFile(join(dir, 'dock.css'), 'body{}');
    const f = fakeCore();
    f.push(act('a', 1));
    const hub = new DockHub({
      core: f.core,
      environment: 'production',
      channelId: CH,
      sleep: tick,
    });
    const key = await DockKey.open(join(dir, 'key.json'));
    const port = 47_000 + Math.floor(Math.random() * 2_000);
    const server = new DockServer({ hub, key, port, pageDir: dir });
    await server.listen();
    const call = (
      path: string,
      o: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      } = {},
    ) =>
      new Promise<{
        status: number;
        headers: Record<string, unknown>;
        body: string;
      }>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path,
            method: o.method ?? 'GET',
            headers: { host: `127.0.0.1:${port}`, ...o.headers },
          },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () =>
              resolve({ status: res.statusCode!, headers: res.headers, body }),
            );
          },
        );
        req.on('error', reject);
        if (o.body) req.write(o.body);
        req.end();
      });
    return { dir, f, hub, key, port, server, call };
  }

  it('the page: strict headers; any API call without the key, or another Host, is refused', async () => {
    const s = await serve();
    const page = await s.call('/');
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toContain(
      "script-src 'self'",
    );
    expect(page.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect((await s.call('/api/stream')).status).toBe(401);
    expect(
      (await s.call('/api/stream', { headers: { 'x-dock-key': 'nope' } }))
        .status,
    ).toBe(401);
    expect(
      (await s.call('/', { headers: { host: 'evil.example' } })).status,
    ).toBe(421);
    expect((await s.call('/../key.json')).status).toBe(404);
    expect((await s.call('/key.json')).status).toBe(404);
    // Studio's own API is not here.
    expect(
      (
        await s.call('/api/alerts/state', {
          headers: { 'x-dock-key': s.key.value },
        })
      ).status,
    ).toBe(404);
    await s.server.close();
  });

  it('the stream: the snapshot, then the changes; a new key closes it and the old key stops working', async () => {
    const s = await serve();
    const chunks: string[] = [];
    let closed = false;
    const req = request(
      {
        host: '127.0.0.1',
        port: s.port,
        path: '/api/stream',
        headers: { host: `127.0.0.1:${s.port}`, 'x-dock-key': s.key.value },
      },
      (res) => {
        expect(res.headers['content-type']).toContain('text/event-stream');
        res.on('data', (c) => chunks.push(String(c)));
        res.on('close', () => (closed = true));
      },
    );
    req.on('error', () => (closed = true));
    req.end();
    await until(() => chunks.join('').includes('event: snapshot'));
    s.f.push(act('b', 2));
    await until(() => chunks.join('').includes('"activity_key":"b"'));
    expect(s.server.clients).toBe(1);
    const old = s.key.value;
    await s.server.regenerateKey();
    await until(() => closed);
    expect(
      (await s.call('/api/stream', { headers: { 'x-dock-key': old } })).status,
    ).toBe(401);
    await s.server.close();
  });

  it('the replay: the page’s origin, JSON, two uuids only — then the Core decides (its refusal passed on)', async () => {
    const s = await serve();
    const origin = `http://127.0.0.1:${s.port}`;
    const ok = {
      'x-dock-key': s.key.value,
      origin,
      'content-type': 'application/json',
    };
    const body = (o: unknown) => JSON.stringify(o);
    const alertId = randomUUID();
    const replayKey = randomUUID();
    expect(
      (
        await s.call('/api/replay', {
          method: 'POST',
          headers: { ...ok, origin: 'http://evil.example' },
          body: body({ alert_id: alertId, replay_key: replayKey }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await s.call('/api/replay', {
          method: 'POST',
          headers: { ...ok, 'content-type': 'text/plain' },
          body: body({ alert_id: alertId, replay_key: replayKey }),
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await s.call('/api/replay', {
          method: 'POST',
          headers: ok,
          body: body({ alert_id: 'x', replay_key: replayKey }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await s.call('/api/replay', {
          method: 'POST',
          headers: ok,
          body: body({
            alert_id: alertId,
            replay_key: replayKey,
            economy: true,
          }),
        })
      ).status,
    ).toBe(400);
    expect(s.f.replays).toEqual([]);
    const r = await s.call('/api/replay', {
      method: 'POST',
      headers: ok,
      body: body({ alert_id: alertId, replay_key: replayKey }),
    });
    expect(r.status).toBe(200);
    expect(s.f.replays).toEqual([
      {
        path: `/v1/studio/dock/${CH}/alerts/${alertId}/replay`,
        body: { replay_key: replayKey },
      },
    ]);
    const refused = await s.call('/api/replay', {
      method: 'POST',
      headers: ok,
      body: body({
        alert_id: '00000000-0000-4000-8000-00000000dead',
        replay_key: randomUUID(),
      }),
    });
    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.body)).toEqual({
      error: 'original_not_played_yet',
    });
    await s.server.close();
  });

  it('history pages are validated and go to the Core; the Studio panel API gives the URL and a new key', async () => {
    const s = await serve();
    expect(
      (
        await s.call('/api/history?before=nope', {
          headers: { 'x-dock-key': s.key.value },
        })
      ).status,
    ).toBe(400);
    const h = await s.call(
      '/api/history?before=2026-10-27T20:00:00.000Z&before_seq=3',
      { headers: { 'x-dock-key': s.key.value } },
    );
    expect(h.status).toBe(200);
    expect(s.f.calls.at(-1)).toContain(
      'before=2026-10-27T20%3A00%3A00.000Z&before_seq=3',
    );
    const rt = { server: s.server, hub: s.hub, error: null };
    const info = (await dockStudioApi(
      rt,
      { method: 'GET' } as never,
      new URL('http://x/api/dock'),
    ))!;
    expect(info.body).toMatchObject({
      available: true,
      url: `http://127.0.0.1:${s.port}/#key=${s.key.value}`,
    });
    const before = s.key.value;
    const again = (await dockStudioApi(
      rt,
      { method: 'POST' } as never,
      new URL('http://x/api/dock/key'),
    ))!;
    expect((again.body as { url: string }).url).not.toContain(before);
    expect(
      await dockStudioApi(
        rt,
        { method: 'GET' } as never,
        new URL('http://x/api/other'),
      ),
    ).toBeNull();
    expect(
      (await dockStudioApi(
        null,
        { method: 'GET' } as never,
        new URL('http://x/api/dock'),
      ))!.body,
    ).toMatchObject({ available: false });
    await s.server.close();
  });
});
