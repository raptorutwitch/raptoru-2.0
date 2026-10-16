import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WordGameRuntime } from '../src/word-game/runtime.js';

// Jeu des mots V1 in Studio (Lot 4): the panel's relay to Core (no game logic here) and the OBS sound
// source behind its token (docs/WORD_GAME_PARITY.md §§ 14, 18).

const CH = '900400';
const PLAYER_DIR = join(import.meta.dirname, '..', 'word-game-player');

let server: Server | null = null;
let dir = '';
afterEach(async () => {
  server?.close();
  server = null;
  if (dir) await rm(dir, { recursive: true, force: true });
});

const STATE = {
  channel_id: CH,
  live: true,
  session_id: 's-1',
  running: true,
  stopped: false,
  next_word_at: null,
  active: [],
  streak: { holder_id: null, holder_name: null, count: 0 },
  recent: [
    {
      message_id: 'tw-2',
      viewer_id: '1',
      viewer_display_name: 'Alice',
      words: [{ word: 'angle', points: 500, fast: false, golden: false }],
      combo: 0,
      breaker: 0,
      total: 500,
      created_at: '2026-10-16T20:01:00.000Z',
    },
  ],
};

async function setup(
  core: (path: string, body?: unknown) => Promise<unknown> = async () => STATE,
) {
  dir = await mkdtemp(join(tmpdir(), 'word-game-'));
  const calls: { path: string; body?: unknown }[] = [];
  server = createServer();
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const make = () =>
    WordGameRuntime.create({
      channelId: CH,
      core: (async (path: string, body?: unknown) => {
        calls.push({ path, body });
        return core(path, body);
      }) as never,
      origin,
      dir: join(dir, 'word-game'),
      playerDir: PLAYER_DIR,
    });
  let rt = await make();
  server.on('request', (req, res) => {
    void rt
      .handle(req, res, new URL(req.url ?? '/', origin))
      .then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      });
  });
  const studio = (path: string, init: RequestInit = {}) =>
    fetch(origin + path, {
      ...init,
      headers: { 'x-raptoru-studio': '1', ...(init.headers ?? {}) },
    });
  return {
    origin,
    calls,
    studio,
    get rt() {
      return rt;
    },
    reload: async () => (rt = await make()),
  };
}

describe('panel relay', () => {
  it('GET state relays Core state as is, plus the OBS source URL', async () => {
    const s = await setup();
    const res = await s.studio('/api/word-game/state');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject(STATE);
    expect(body.player_url).toMatch(
      new RegExp(`^${s.origin}/word-game/player\\.html#[a-f0-9]{32}$`),
    );
    expect(s.calls).toEqual([
      { path: `/v1/lab/word-game/${CH}/state`, body: undefined },
    ]);
  });

  it('POST actions relays stop / start / new_word with only the action fields', async () => {
    const s = await setup(async (_path, body) => ({ ...STATE, echoed: body }));
    for (const body of [
      { action: 'stop', actor: { id: 'evil' } },
      { action: 'start' },
      {
        action: 'new_word',
        request_id: '6b0f7c2e-8f0e-4c3a-9a1e-0b6f8e2d1c3a',
      },
    ])
      expect(
        (
          await s.studio('/api/word-game/actions', {
            method: 'POST',
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(200);
    expect(s.calls.map((c) => [c.path, c.body])).toEqual([
      [`/v1/lab/word-game/${CH}/actions`, { action: 'stop' }],
      [`/v1/lab/word-game/${CH}/actions`, { action: 'start' }],
      [
        `/v1/lab/word-game/${CH}/actions`,
        {
          action: 'new_word',
          request_id: '6b0f7c2e-8f0e-4c3a-9a1e-0b6f8e2d1c3a',
        },
      ],
    ]);
  });

  it("Core's refusal keeps its status (409 offline)", async () => {
    const s = await setup(async () => {
      throw Object.assign(new Error('lab_core_409'), {
        status: 409,
        body: { error: 'offline' },
      });
    });
    const res = await s.studio('/api/word-game/actions', {
      method: 'POST',
      body: JSON.stringify({
        action: 'new_word',
        request_id: '6b0f7c2e-8f0e-4c3a-9a1e-0b6f8e2d1c3a',
      }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'offline' });
  });

  it('refuses a call without the Studio header or from another host', async () => {
    const s = await setup();
    expect((await fetch(`${s.origin}/api/word-game/state`)).status).toBe(403);
    const other = await fetch(`${s.origin}/api/word-game/state`, {
      headers: { 'x-raptoru-studio': '1', origin: 'http://evil.example' },
    });
    expect(other.status).toBe(403);
    expect(s.calls).toEqual([]);
  });
});

describe('OBS sound source', () => {
  it('serves the page, its scripts and the legacy sound (byte copy)', async () => {
    const s = await setup();
    const page = await fetch(`${s.origin}/word-game/player.html`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain(
      "media-src 'self'",
    );
    expect(await page.text()).toContain('player.js');
    expect((await fetch(`${s.origin}/word-game/model.js`)).status).toBe(200);
    const sound = await fetch(`${s.origin}/word-game/ShuffleWordsSong.ogg`);
    expect(sound.headers.get('content-type')).toBe('audio/ogg');
    expect(
      Buffer.from(await sound.arrayBuffer()).equals(
        await readFile(join(PLAYER_DIR, 'ShuffleWordsSong.ogg')),
      ),
    ).toBe(true);
    expect((await fetch(`${s.origin}/word-game/../src/index.ts`)).status).toBe(
      404,
    );
  });

  it('feed: token required; only the ids and times of the recent wins', async () => {
    const s = await setup();
    expect((await fetch(`${s.origin}/word-game/feed`)).status).toBe(403);
    const token = new URL(s.rt.playerUrl).hash.slice(1);
    const res = await fetch(`${s.origin}/word-game/feed`, {
      headers: { 'x-word-game-token': token },
    });
    expect(await res.json()).toEqual({
      recent: [{ message_id: 'tw-2', created_at: '2026-10-16T20:01:00.000Z' }],
    });
  });

  it('the source URL (token) survives a Studio restart', async () => {
    const s = await setup();
    const before = s.rt.playerUrl;
    await s.reload();
    expect(s.rt.playerUrl).toBe(before);
  });
});
