import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LevelUpRuntime, synthChime } from '../src/level-up/runtime.js';

// Commands « sound » actions in Studio: the sounds imported from Studio (format checked by their bytes), served to the
// invisible OBS sound source, the Core's queue claimed while a source listens, each sound pushed once as `event: sound`
// (a page of an older Studio ignores it), an unknown sound never played, « Écouter dans OBS ».

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

async function start(queue: { id: number; sound: string }[][]) {
  dir = await mkdtemp(join(tmpdir(), 'cmd-sounds-'));
  const claims: [string, unknown][] = [];
  const core = (async () => ({ notices: [] })) as never;
  const commands = (async (path: string, body?: unknown) => {
    claims.push([path, body]);
    return { sounds: queue.shift() ?? [] };
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
    commandSounds: { core: commands, channelId: '83603689' },
  });
  const token = runtime.playerUrl.split('#')[1]!;
  const studio = (path: string, init: RequestInit = {}) =>
    fetch(origin + path, {
      ...init,
      headers: { 'x-raptoru-studio': '1', ...(init.headers ?? {}) },
    });
  return { origin, token, claims, studio };
}

/** Reads the SSE stream until `n` events of `kind` arrived. */
async function read(origin: string, token: string, kind: string, n: number) {
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
      if (new RegExp(`^event: ${kind}$`, 'm').test(block) && data)
        out.push(JSON.parse(data));
    }
  }
  ac.abort();
  return out;
}

describe('Commands sounds on the OBS sound source', () => {
  it('a sound imported from Studio (its bytes checked), listed, served; a non-sound or too big file refused', async () => {
    const { origin, studio } = await start([]);
    const bad = await studio('/api/level-up/command-sounds?name=x.mp3', {
      method: 'POST',
      body: Buffer.from('not a sound at all'),
    });
    expect(bad.status).toBe(415);
    const big = await studio('/api/level-up/command-sounds?name=x.wav', {
      method: 'POST',
      body: Buffer.alloc(2 * 1024 * 1024 + 10),
    });
    expect(big.status).toBe(413);
    const ok = await studio(
      '/api/level-up/command-sounds?name=Gros%20lot.wav',
      {
        method: 'POST',
        body: new Uint8Array(synthChime()),
      },
    );
    const sound = (await ok.json()) as { id: string; label: string };
    expect(sound).toMatchObject({ label: 'Gros lot', format: 'wav' });
    expect(sound.id).toMatch(/^[a-f0-9]{16}$/);
    expect(
      await (await studio('/api/level-up/command-sounds')).json(),
    ).toMatchObject({ sounds: [{ id: sound.id, label: 'Gros lot' }] });
    const file = await fetch(`${origin}/level-up/cmd/${sound.id}`);
    expect([file.status, file.headers.get('content-type')]).toEqual([
      200,
      'audio/wav',
    ]);
    expect(Buffer.from(await file.arrayBuffer()).equals(synthChime())).toBe(
      true,
    );
    expect(
      (await fetch(`${origin}/level-up/cmd/0000000000000000`)).status,
    ).toBe(404);
    // Without the Studio header, nothing is imported or listed.
    expect((await fetch(`${origin}/api/level-up/command-sounds`)).status).toBe(
      403,
    );
    expect(
      (
        await studio(`/api/level-up/command-sounds/${sound.id}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(200);
    expect((await fetch(`${origin}/level-up/cmd/${sound.id}`)).status).toBe(
      404,
    );
  });

  it('the Core queue claimed only while a source listens; each sound pushed once as « sound »; an unknown sound never played', async () => {
    const pending: { id: number; sound: string }[][] = [];
    const { origin, token, claims, studio } = await start(pending);
    const sound = (await (
      await studio('/api/level-up/command-sounds?name=groslot.wav', {
        method: 'POST',
        body: new Uint8Array(synthChime()),
      })
    ).json()) as { id: string };
    await new Promise((r) => setTimeout(r, 80));
    expect(claims).toEqual([]); // no source: never claimed
    pending.push([
      { id: 7, sound: 'ffffffffffffffff' }, // not on this PC: skipped
      { id: 8, sound: sound.id },
    ]);
    const got = await read(origin, token, 'sound', 1);
    expect(got).toEqual([
      { id: 'cmd-8', src: `/level-up/cmd/${sound.id}`, volume: 0.7 },
    ]);
    expect(claims[0]).toEqual([
      '/v1/lab/commands/83603689/sounds/claim',
      { consumer: expect.stringMatching(/^studio-lu-/) },
    ]);
    // « Écouter dans OBS »: the same push, no Core.
    const tries = read(origin, token, 'sound', 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(
      (
        await studio(`/api/level-up/command-sounds/${sound.id}/test`, {
          method: 'POST',
        })
      ).status,
    ).toBe(200);
    expect((await tries)[0]).toMatchObject({
      src: `/level-up/cmd/${sound.id}`,
    });
  });
});
