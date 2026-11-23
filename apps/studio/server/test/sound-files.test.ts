import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler } from '../../../core-api/src/http/server.js';
import { setup } from '../../../core-api/test/helpers.js';
import { SoundFiles } from '../src/sound-lab/files.js';
import { SoundRuntime } from '../src/sound-lab/runtime.js';
import { localSoundCoreClient } from '../src/sound-lab/worker.js';
// @ts-expect-error plain JS module of the player page
import { soundSource } from '../sound-player/sound-source.js';

// Soundboard: a sound added in Studio (docs/SOUNDBOARD.md § Ajouter un son) — Studio page → Studio server → Core, and
// the published file back to Studio's player.

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function wav(ms: number, seed = 1) {
  const data = Buffer.alloc(Math.round(44.1 * ms) * 2);
  for (let i = 0; i < data.length / 2; i++)
    data.writeInt16LE(((i * 31 + seed * 97) % 1800) - 900, i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFFxxxxWAVEfmt ', 0, 'ascii');
  h.writeUInt32LE(36 + data.length, 4);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(44100, 24);
  h.writeUInt32LE(88200, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function listen(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function fixture() {
  const core = await setup();
  const coreUrl = await listen(
    createHandler({
      ...core,
      botSecret: 'bot-secret',
      studioSecret: 'studio-secret',
    }),
  );
  const dir = await mkdtemp(join(process.cwd(), '.runtime-sound-files-test-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  let runtime: SoundRuntime | null = null;
  const origin = await listen((req, res) => {
    void runtime!
      .handle(req, res, new URL(req.url ?? '/', 'http://studio'))
      .then((done) => done || res.writeHead(404).end());
  });
  // The Lab Core through the production wiring's shape (its config routes are the Lab ones here).
  runtime = await SoundRuntime.create(origin, {
    core: localSoundCoreClient(coreUrl, 'studio-secret'),
    journal: join(dir, 'journal.json'),
    transport: {
      base: '/v1/lab/sound',
      studioId: 'studio-1',
      channel: '900100',
      configBase: '/v1/lab/sound',
    },
  });
  const studio = (path: string, init: RequestInit = {}) =>
    fetch(origin + path, {
      ...init,
      headers: { 'x-raptoru-studio': '1', ...(init.headers ?? {}) },
    });
  const json = async (path: string, body?: unknown) => {
    const r = await studio(
      path,
      body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) },
    );
    return {
      status: r.status,
      body: (await r.json()) as Record<string, unknown>,
    };
  };
  const upload = async (bytes: Buffer) => {
    const r = await studio('/api/sound-lab/files', {
      method: 'POST',
      body: new Uint8Array(bytes),
      headers: { 'content-type': 'application/octet-stream' },
    });
    return {
      status: r.status,
      body: (await r.json()) as Record<string, unknown>,
    };
  };
  return { core, dir, origin, runtime: runtime!, studio, json, upload };
}

describe('Soundboard — adding a sound from Studio', () => {
  it('publishes the file to Core, keeps the same bytes locally, creates the sound, serves it to the player', async () => {
    const f = await fixture();
    const bytes = wav(900);
    const up = await f.upload(bytes);
    expect(up).toEqual({
      status: 200,
      body: {
        file_id: sha(bytes),
        mime: 'audio/wav',
        duration_ms: 900,
        size: bytes.length,
      },
    });
    expect(existsSync(join(f.dir, 'sound-files', `${sha(bytes)}.wav`))).toBe(
      true,
    );
    let changed = 0;
    f.runtime.onConfigChange = () => changed++;
    const created = await f.json('/api/sound-lab/sounds', {
      id: 'yes-123abc',
      label: 'Yes',
      file_id: sha(bytes),
      token_cost: 500,
      credit_cost: 1,
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      id: 'yes-123abc',
      source: 'studio',
      preview_url: `sound-files/${sha(bytes)}.wav`,
    });
    expect(changed).toBe(1);
    const config = await f.json('/api/sound-lab/config');
    expect((config.body.sounds as { id: string }[]).at(-1)!.id).toBe(
      'yes-123abc',
    );
    // The player's URL for the interaction's sound_url, and the bytes behind it.
    const src = soundSource(`sound-files/${sha(bytes)}.wav`);
    expect(src).toBe(`/sound-lab/files/${sha(bytes)}.wav`);
    const played = await fetch(f.origin + src);
    expect(played.headers.get('content-type')).toBe('audio/wav');
    expect(Buffer.from(await played.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('Core refusals reach the page with their details (incomplete file, duplicate extract)', async () => {
    const f = await fixture();
    const bytes = wav(700);
    expect(await f.upload(bytes.subarray(0, 300))).toMatchObject({
      status: 400,
      body: { error: 'incomplete_file' },
    });
    expect(existsSync(join(f.dir, 'sound-files'))).toBe(false); // nothing kept from a refused file
    expect(await f.upload(Buffer.alloc(5 * 1024 * 1024))).toMatchObject({
      status: 413,
      body: { error: 'file_too_large' },
    });
    await f.upload(bytes);
    await f.json('/api/sound-lab/sounds', {
      id: 'a-111111',
      label: 'A',
      file_id: sha(bytes),
      token_cost: 500,
      credit_cost: 1,
    });
    expect(
      await f.json('/api/sound-lab/sounds', {
        id: 'b-222222',
        label: 'B',
        file_id: sha(bytes),
        token_cost: 500,
        credit_cost: 1,
      }),
    ).toMatchObject({
      status: 409,
      body: { error: 'duplicate_file', sound_id: 'a-111111', label: 'A' },
    });
  });

  it('a missing local copy is fetched from Core once and checked; removal takes the sound out', async () => {
    const f = await fixture();
    const bytes = wav(500, 3);
    // Published by another Studio: only Core has it.
    const { file_id } = await f.core.soundLab.uploadFile(
      bytes.toString('base64'),
    );
    await f.core.soundLab.createSound({
      id: 'ailleurs-abcabc',
      label: 'Ailleurs',
      file_id,
      token_cost: 500,
      credit_cost: 1,
    });
    const got = await fetch(`${f.origin}/sound-lab/files/${file_id}.wav`);
    expect(Buffer.from(await got.arrayBuffer()).equals(bytes)).toBe(true);
    expect(existsSync(join(f.dir, 'sound-files', `${file_id}.wav`))).toBe(true);
    expect(
      (await fetch(`${f.origin}/sound-lab/files/${'c'.repeat(64)}.wav`)).status,
    ).toBe(404);
    // Another host (a page of another origin through DNS rebinding): refused.
    const foreign = await new Promise<number>((resolve, reject) =>
      request(
        `${f.origin}/sound-lab/files/${file_id}.wav`,
        { headers: { host: 'evil.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      )
        .on('error', reject)
        .end(),
    );
    expect(foreign).toBe(403);
    expect(
      await f.json('/api/sound-lab/sounds/ailleurs-abcabc/delete', {}),
    ).toMatchObject({ status: 200, body: { ok: true } });
    const config = await f.json('/api/sound-lab/config');
    expect(
      (config.body.sounds as { id: string }[]).some(
        (s) => s.id === 'ailleurs-abcabc',
      ),
    ).toBe(false);
    // Admin routes need Studio's header.
    expect(
      (
        await fetch(`${f.origin}/api/sound-lab/sounds/x-000000/delete`, {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(403);
  });

  it('a downloaded file whose bytes do not match its name is never kept', async () => {
    const dir = await mkdtemp(
      join(process.cwd(), '.runtime-sound-files-test-'),
    );
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const files = new SoundFiles(dir, async () => Buffer.from('tampered'));
    await expect(files.get('d'.repeat(64))).rejects.toThrow('file_mismatch');
    expect(existsSync(join(dir, `${'d'.repeat(64)}.wav`))).toBe(false);
  });

  it('the player only plays the two shapes Core resolves', () => {
    expect(soundSource('assets/sounds/boop.mp3')).toBe(
      '/ext/assets/sounds/boop.mp3',
    );
    expect(soundSource('sound-files/../../x.wav')).toBeNull();
    expect(soundSource(`sound-files/${'a'.repeat(64)}.mp3`)).toBeNull();
    expect(soundSource('https://evil.example/a.mp3')).toBeNull();
  });

  it('the original of a published extract stays on this PC, with its cut, to re-cut the sound later', async () => {
    const f = await fixture();
    const original = Buffer.from('ID3 any original file of a few bytes');
    const fileId = 'e'.repeat(64);
    const put = await f.studio(
      `/api/sound-lab/sources?file_id=${fileId}&name=Meme.mp3&start_ms=850&end_ms=3200`,
      {
        method: 'POST',
        body: new Uint8Array(original),
      },
    );
    expect(put.status).toBe(200);
    const got = await f.studio(`/api/sound-lab/sources/${fileId}`);
    expect(
      JSON.parse(decodeURIComponent(got.headers.get('x-raptoru-cut')!)),
    ).toEqual({ name: 'Meme.mp3', start_ms: 850, end_ms: 3200 });
    expect(Buffer.from(await got.arrayBuffer()).equals(original)).toBe(true);
    expect(
      (await f.studio(`/api/sound-lab/sources/${'f'.repeat(64)}`)).status,
    ).toBe(404);
    expect(
      (
        await f.studio(`/api/sound-lab/sources?file_id=x&start_ms=0&end_ms=1`, {
          method: 'POST',
          body: 'a',
        })
      ).status,
    ).toBe(409);
    expect(
      (await fetch(`${f.origin}/api/sound-lab/sources/${fileId}`)).status,
    ).toBe(403);
  });
});
