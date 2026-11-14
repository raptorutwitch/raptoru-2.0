import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LevelUpRuntime, synthChime } from '../src/level-up/runtime.js';

// Level Up V2 — Studio's own OBS source (docs/PROGRESSION.md): token-protected page and events, Core asked ONLY while a
// source listens (an unseen level-up expires in Core, never shown late), each notice pushed once, a local test that never
// reaches Core, the volume, the default chime or the streamer's own sound.

const PLAYER_DIR = join(import.meta.dirname, '..', 'level-up-player');
let server: Server | null = null;
let runtime: LevelUpRuntime | null = null;
let dir = '';
afterEach(async () => {
  runtime?.stop();
  server?.closeAllConnections();
  await new Promise((r) => (server ? server.close(r) : r(null)));
  server = null;
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function start(notices: unknown[][]) {
  dir = await mkdtemp(join(tmpdir(), 'level-up-'));
  const calls: [string, unknown][] = [];
  const core = (async (path: string, body?: unknown) => {
    calls.push([path, body]);
    return { notices: notices.shift() ?? [] };
  }) as never;
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://studio');
    if (!(await runtime!.handle(req, res, url))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  runtime = await LevelUpRuntime.create({
    core,
    environment: 'production',
    origin,
    dir,
    playerDir: PLAYER_DIR,
    claimEveryMs: 20,
  });
  const token = runtime.playerUrl.split('#')[1]!;
  const api = (path: string, body?: unknown) =>
    fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (r) => ({
      status: r.status,
      body: (await r.json()) as Record<string, unknown>,
    }));
  return { origin, token, calls, api };
}

/** Reads the SSE stream until `n` level-up events arrived. */
async function read(origin: string, token: string, n: number) {
  const ac = new AbortController();
  const res = await fetch(`${origin}/level-up/events?t=${token}`, {
    signal: ac.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const out: Record<string, unknown>[] = [];
  while (out.length < n) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (let i; (i = buf.indexOf('\n\n')) >= 0;) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (/^event: levelup$/m.test(block) && data) out.push(JSON.parse(data));
    }
  }
  ac.abort();
  return out;
}

describe('Level Up OBS source', () => {
  it('nothing asked from Core without a source; with one: the notices pushed once, with the volume; wrong token refused', async () => {
    const { origin, token, calls, api } = await start([
      [
        {
          id: 7,
          twitchUserId: '1',
          displayName: 'Ana',
          level: 12,
          fromLevel: 11,
          sound: true,
        },
      ],
    ]);
    await new Promise((r) => setTimeout(r, 80));
    expect(calls).toEqual([]); // no source: never claimed
    expect((await fetch(`${origin}/level-up/events?t=nope`)).status).toBe(403);
    const got = await read(origin, token, 1);
    expect(got).toEqual([
      { id: 7, name: 'Ana', level: 12, sound: true, volume: 0.7 },
    ]);
    expect(calls[0]).toEqual([
      '/v1/studio/progression/levelups/claim',
      { consumer: expect.stringMatching(/^studio-lu-/) },
    ]);
    expect((await api('/api/level-up/volume', { volume: 101 })).status).toBe(
      400,
    );
    expect((await api('/api/level-up/volume', { volume: 40 })).body).toEqual({
      volume: 40,
    });
    expect((await api('/api/level-up/state')).body).toMatchObject({
      volume: 40,
      custom_sound: false,
    });
  });

  it('the local test reaches the connected sources only (never Core); without a source: refused', async () => {
    const { origin, token, calls, api } = await start([]);
    expect((await api('/api/level-up/test', { sound: true })).status).toBe(409);
    const reading = read(origin, token, 1);
    await new Promise((r) => setTimeout(r, 50));
    expect((await api('/api/level-up/test', { sound: true })).body).toEqual({
      sent: true,
    });
    expect(await reading).toMatchObject([
      { id: 0, name: 'Test Raptoru', level: 42, sound: true },
    ]);
    expect(calls.every(([p]) => p.endsWith('/levelups/claim'))).toBe(true);
    // The Studio header is required for the panel API.
    expect((await fetch(`${origin}/api/level-up/state`)).status).toBe(403);
  });

  it('the page files, the default chime (a short WAV), the streamer’s own sound first', async () => {
    const { origin } = await start([]);
    expect((await fetch(`${origin}/level-up/player.html`)).status).toBe(200);
    const wav = Buffer.from(
      await (await fetch(`${origin}/level-up/sound`)).arrayBuffer(),
    );
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    const seconds = (wav.length - 44) / (22_050 * 2);
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(4);
    expect(wav.equals(synthChime())).toBe(true);
    await writeFile(join(dir, 'sound.mp3'), Buffer.from('ID3fake'));
    const own = await fetch(`${origin}/level-up/sound`);
    expect([own.headers.get('content-type'), await own.text()]).toEqual([
      'audio/mpeg',
      'ID3fake',
    ]);
  });
});
