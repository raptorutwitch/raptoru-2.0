import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type Page, test } from '@playwright/test';
import { AlertMediaStore } from '../src/alerts/media-store.js';
import { EffectsPlayer } from '../src/effects/player.js';

// Effects player P0.1 — the REAL page (effects-player/player.js) in Chromium against the REAL Studio side
// (EffectsPlayer on a local HTTP server), with real audio files (generated WAV tones: no user file, no OBS, no
// Twitch). OBS lets a browser source play sound without a click: reproduced with Chromium's autoplay flag. Without it
// (a normal browser) the page shows « Activer le son », takes nothing, and Studio refuses with « muted ».

const here = dirname(fileURLToPath(import.meta.url));

/** A mono 16-bit PCM WAV tone of `ms` milliseconds (decodable by Chromium whatever the file name). */
function wav(ms: number) {
  const rate = 8000;
  const n = Math.round((rate * ms) / 1000);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(
      Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000),
      44 + i * 2,
    );
  return b;
}

async function studio() {
  const dir = await mkdtemp(join(tmpdir(), 'effects-e2e-'));
  const src = join(dir, 'src');
  await (await import('node:fs/promises')).mkdir(src);
  await writeFile(join(src, 'ErenScream.ogg'), wav(600));
  await writeFile(join(src, 'Tiens bon !.ogg'), wav(900));
  const media = await AlertMediaStore.open(join(dir, 'media'));
  await media.import([
    { name: 'ErenScream.ogg', from: join(src, 'ErenScream.ogg') },
    { name: 'Tiens bon !.ogg', from: join(src, 'Tiens bon !.ogg') },
  ]);
  let player: EffectsPlayer | null = null;
  let origin = '';
  const server: Server = createServer((req, res) => {
    void player!.handle(req, res, new URL(req.url!, origin)).then((done) => {
      if (!done) res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  player = await EffectsPlayer.create({
    dir,
    origin,
    media,
    playerDir: join(here, '..', 'effects-player'),
  });
  return {
    player,
    close: async () => {
      server.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Waits until Studio sees the page (its first heartbeat). */
async function connected(player: EffectsPlayer, audio: boolean) {
  await expect
    .poll(() => {
      const s = player.status();
      return s.connected && s.audio === audio;
    })
    .toBe(true);
}

/** A Chromium launched like an OBS browser source: sound allowed without a user gesture. */
async function obsLike(
  policy = 'no-user-gesture-required',
): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await chromium.launch({
    args: [`--autoplay-policy=${policy}`],
  });
  return { page: await browser.newPage(), close: () => browser.close() };
}

test.describe('Effects player — as in OBS (sound allowed without a click)', () => {
  test('two effects close together: both start at once (overlap), at their volume, and end; the page shows nothing', async () => {
    const s = await studio();
    const { page, close } = await obsLike();
    try {
      await page.goto(s.player.url);
      await connected(s.player, true);
      await expect(page.locator('#panel')).toBeHidden();
      const t0 = Date.now();
      const [a, b] = await Promise.all([
        s.player.play({ sound_id: 'eren-scream', volume: 100 }),
        s.player.play({ sound_id: 'tiens-bon', volume: 41 }),
      ]);
      expect(Date.now() - t0).toBeLessThan(1500); // started at once, not one after the other
      expect(s.player.status().playing).toBe(2);
      expect(await page.evaluate(() => document.body.dataset.playing)).toBe(
        '2',
      );
      expect(await a.end).toEqual({ event: 'completed' });
      expect(await b.end).toEqual({ event: 'completed' });
      expect(s.player.status().playing).toBe(0);
    } finally {
      await close();
      await s.close();
    }
  });

  test('a media that cannot be decoded: failed before any sound, readable code', async () => {
    const s = await studio();
    const { page, close } = await obsLike();
    try {
      await page.route('**/effects/media/**', (r) =>
        r.fulfill({ status: 200, contentType: 'audio/ogg', body: 'not audio' }),
      );
      await page.goto(s.player.url);
      await connected(s.player, true);
      await expect(
        s.player.play({ sound_id: 'eren-scream', volume: 100 }),
      ).rejects.toThrow('file_missing');
    } finally {
      await close();
      await s.close();
    }
  });
});

test.describe('Effects player — a normal browser (sound needs a click)', () => {
  test('muted page: « Activer le son » shown, Studio refuses (muted), nothing taken; one click and it plays', async () => {
    const s = await studio();
    // A normal browser: sound only after a click on the page.
    const { page, close } = await obsLike('document-user-activation-required');
    try {
      await page.goto(s.player.url);
      await connected(s.player, false);
      await expect(page.locator('#enable')).toBeVisible();
      await expect(
        s.player.play({ sound_id: 'eren-scream', volume: 100 }),
      ).rejects.toThrow('effects_player_muted');
      await page.locator('#enable').click();
      await connected(s.player, true);
      const { end } = await s.player.play({
        sound_id: 'eren-scream',
        volume: 100,
      });
      expect(await end).toEqual({ event: 'completed' });
    } finally {
      await close();
      await s.close();
    }
  });
});
