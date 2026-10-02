import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RaffleRuntime, soundFormat } from '../src/raffle-lab/runtime.js';

// Tombola V2 in Studio: relay to Core (no state here), launch sounds in Studio's own storage, the
// single OBS source behind its token (the chat goes through the Lab chat ingress, lab-chat.test.ts).

const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200, 7)]);
const WAV = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WAVE'),
  Buffer.alloc(64, 1),
]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64, 2)]);

let server: Server | null = null;
let dir = '';
afterEach(async () => {
  server?.close();
  server = null;
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function setup(overlayDir?: string) {
  dir = await mkdtemp(join(tmpdir(), 'raffle-lab-'));
  const calls: { path: string; body?: unknown }[] = [];
  server = createServer();
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const make = () =>
    RaffleRuntime.create({
      core: (async (path: string, body?: unknown) => {
        calls.push({ path, body });
        if (path.endsWith('/settings'))
          return { config: {}, scheduler: { state: 'stopped' } };
        return { ok: true, path };
      }) as never,
      origin,
      dir: join(dir, 'raffle-lab'),
      overlayDir: overlayDir ?? join(dir, 'overlay'),
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
    get rt() {
      return rt;
    },
    reload: async () => {
      rt = await make();
      return rt;
    },
    calls,
    studio,
  };
}

describe('Tombola launch sounds (Studio storage)', () => {
  it('recognizes MP3 / WAV / OGG by their bytes, never by the name', () => {
    expect(soundFormat(MP3)).toBe('mp3');
    expect(
      soundFormat(Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(20)])),
    ).toBe('mp3');
    expect(soundFormat(WAV)).toBe('wav');
    expect(soundFormat(OGG)).toBe('ogg');
    expect(soundFormat(Buffer.from('<html>pas un son</html>'))).toBeNull();
  });

  it('imports a copy (content-addressed), serves it to the overlay, prunes it once no longer used', async () => {
    const f = await setup();
    const up = await f.studio('/api/raffle/sounds', {
      method: 'POST',
      body: MP3,
      headers: {
        'x-sound-name': encodeURIComponent('Fanfare d’ouverture.mp3'),
      },
    });
    const sound = (await up.json()) as {
      asset_id: string;
      format: string;
      name: string;
      size_bytes: number;
      volume: number;
    };
    expect(sound).toMatchObject({
      format: 'mp3',
      name: 'Fanfare d’ouverture.mp3',
      size_bytes: MP3.length,
      volume: 80,
    });
    expect(sound.asset_id).toMatch(/^[a-f0-9]{64}$/);
    // Same bytes → same asset, one file.
    await f.studio('/api/raffle/sounds', { method: 'POST', body: MP3 });
    expect(await readdir(join(dir, 'raffle-lab', 'sounds'))).toEqual([
      `${sound.asset_id}.mp3`,
    ]);
    const served = await fetch(
      `${f.origin}/raffle-lab/sounds/${sound.asset_id}.mp3`,
    );
    expect(served.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await served.arrayBuffer())).toEqual(MP3);
    // Not audio, too big, empty: refused, nothing stored.
    expect(
      (
        await f.studio('/api/raffle/sounds', {
          method: 'POST',
          body: Buffer.from('MZ binaire exe'),
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await f.studio('/api/raffle/sounds', {
          method: 'POST',
          body: Buffer.alloc(5 * 1024 * 1024 + 10, 1),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await f.studio('/api/raffle/sounds', {
          method: 'POST',
          body: Buffer.alloc(0),
        })
      ).status,
    ).toBe(400);
    // Replaced / removed in the configuration → the stored copy is pruned after Core accepted it.
    await f.studio('/api/raffle/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        command: {
          action: 'config',
          config: {
            launch_sounds: { normal: null, super: null, giveaway: null },
          },
        },
      }),
    });
    expect(await readdir(join(dir, 'raffle-lab', 'sounds'))).toEqual([]);
  });
});

describe('Tombola single OBS source', () => {
  it('serves the page (placeholder until the overlay is ported), the snapshot only with its token', async () => {
    const f = await setup();
    const page = await fetch(f.rt.overlayUrl.split('#')[0]!);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'self'",
    );
    expect((await fetch(`${f.origin}/raffle-lab/snapshot`)).status).toBe(403);
    const snap = await fetch(`${f.origin}/raffle-lab/snapshot`, {
      headers: { 'x-raffle-token': f.rt.token },
    });
    expect(snap.status).toBe(200);
    expect(f.calls.at(-1)!.path).toBe('/v1/lab/raffle/900100/snapshot');
    // The token survives a Studio restart (the OBS URL does not change).
    const token = f.rt.token;
    expect((await f.reload()).token).toBe(token);
    // The real overlay files win over the placeholder once present.
    await mkdir(join(dir, 'overlay'), { recursive: true });
    await writeFile(
      join(dir, 'overlay', 'overlay.html'),
      '<p>vrai overlay</p>',
    );
    expect(
      await (await fetch(`${f.origin}/raffle-lab/overlay.html`)).text(),
    ).toBe('<p>vrai overlay</p>');
  });

  it('serves the real overlay (page, module scripts, generated stylesheet) from raffle-overlay/', async () => {
    const f = await setup(join(import.meta.dirname, '..', 'raffle-overlay'));
    const page = await fetch(`${f.origin}/raffle-lab/overlay.html`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<script type="module" src="overlay.js">');
    expect(html).not.toContain('phase F');
    for (const [file, type] of [
      ['overlay.js', 'text/javascript'],
      ['model.js', 'text/javascript'],
      ['kit.js', 'text/javascript'],
      ['overlay.css', 'text/css'],
    ])
      expect(
        (await fetch(`${f.origin}/raffle-lab/${file}`)).headers.get(
          'content-type',
        ),
      ).toContain(type);
    expect((await fetch(`${f.origin}/raffle-lab/other.js`)).status).toBe(404);
  });

  it('refuses another origin and the API without the Studio header', async () => {
    const f = await setup();
    expect((await fetch(`${f.origin}/api/raffle/status`)).status).toBe(403);
    expect(
      (
        await fetch(`${f.origin}/api/raffle/status`, {
          headers: { 'x-raptoru-studio': '1', origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
  });
});

describe('Tombola Studio relay', () => {
  it('relays actions as the Studio operator; exposes the OBS URL in its status', async () => {
    const f = await setup();
    await f.studio('/api/raffle/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: { action: 'launch', kind: 'auto' } }),
    });
    expect(f.calls.at(-1)).toEqual({
      path: '/v1/lab/raffle/900100/actions',
      body: {
        actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
        command: { action: 'launch', kind: 'auto' },
      },
    });
    const st = (await (await f.studio('/api/raffle/status')).json()) as {
      overlay_url: string;
      ingest?: unknown;
    };
    expect(st.overlay_url).toBe(f.rt.overlayUrl);
    expect(st.ingest).toBeUndefined();
  });
});
