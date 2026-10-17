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

async function studio(video?: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'effects-e2e-'));
  const src = join(dir, 'src');
  await (await import('node:fs/promises')).mkdir(src);
  await writeFile(join(src, 'ErenScream.ogg'), wav(600));
  await writeFile(join(src, 'Tiens bon !.ogg'), wav(900));
  if (video) await writeFile(join(src, 'Fuck You.webm'), video);
  const media = await AlertMediaStore.open(join(dir, 'media'));
  await media.import([
    { name: 'ErenScream.ogg', from: join(src, 'ErenScream.ogg') },
    { name: 'Tiens bon !.ogg', from: join(src, 'Tiens bon !.ogg') },
    ...(video
      ? [{ name: 'Fuck You.webm', from: join(src, 'Fuck You.webm') }]
      : []),
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
        s.player.play({ kind: 'sound', id: 'eren-scream', volume: 100 }),
        s.player.play({ kind: 'sound', id: 'tiens-bon', volume: 41 }),
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
        s.player.play({ kind: 'sound', id: 'eren-scream', volume: 100 }),
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
        s.player.play({ kind: 'sound', id: 'eren-scream', volume: 100 }),
      ).rejects.toThrow('effects_player_muted');
      await page.locator('#enable').click();
      await connected(s.player, true);
      const { end } = await s.player.play({
        kind: 'sound',
        id: 'eren-scream',
        volume: 100,
      });
      expect(await end).toEqual({ event: 'completed' });
    } finally {
      await close();
      await s.close();
    }
  });
});

/** A real WebM (VP8 + Opus, `ms` long) recorded by Chromium itself: a moving canvas and a tone. */
async function recordWebm(page: Page, ms: number) {
  const bytes = await page.evaluate(async (duration) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const g = canvas.getContext('2d')!;
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const out = audio.createMediaStreamDestination();
    tone.connect(out);
    tone.start();
    const stream = new MediaStream([
      ...canvas.captureStream(30).getVideoTracks(),
      ...out.stream.getAudioTracks(),
    ]);
    const rec = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8,opus',
    });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    let f = 0;
    const draw = setInterval(() => {
      g.fillStyle = `hsl(${(f += 12) % 360} 80% 50%)`;
      g.fillRect(0, 0, 320, 180);
    }, 33);
    rec.start();
    await new Promise((r) => setTimeout(r, duration));
    await new Promise((r) => {
      rec.onstop = r;
      rec.stop();
    });
    clearInterval(draw);
    return [...new Uint8Array(await new Blob(parts).arrayBuffer())];
  }, ms);
  return Buffer.from(bytes);
}

test.describe('Effects player — NTM video (as in OBS)', () => {
  test('five NTM at once: all shown full frame, rise in, mirrored by chance (35 %), ducked (4 heard at 1,25 %, the 5th muted), each ends and is removed', async () => {
    const { page, close } = await obsLike();
    // Real VP8/Opus WebM recorded by Chromium (no user file); the page's random draws are fixed for the mirror check.
    await page.goto('about:blank');
    const s = await studio(await recordWebm(page, 3000));
    try {
      await page.addInitScript(() => {
        const draws = [0.1, 0.9, 0.2, 0.5, 0.3];
        Math.random = () => draws.shift() ?? 0.99;
      });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(s.player.url);
      await connected(s.player, true);
      const plays = await Promise.all(
        [0, 1, 2, 3, 4].map(() =>
          s.player.play({ kind: 'video', id: 'fuck-you', volume: 10 }),
        ),
      );
      expect(s.player.status().playing).toBe(5);
      await page.waitForTimeout(700); // ducking ramps (450 ms)
      const videos = await page.$$eval('#stage video', (els) =>
        (els as HTMLVideoElement[]).map((v) => ({
          mirror: v.classList.contains('mirror'),
          in: v.classList.contains('in'),
          muted: v.muted,
          volume: Math.round(v.volume * 10000) / 10000,
          box: [v.offsetLeft, v.offsetTop, v.offsetWidth, v.offsetHeight],
          fit: getComputedStyle(v).objectFit,
        })),
      );
      expect(videos).toHaveLength(5);
      expect(videos.map((v) => v.mirror)).toEqual([
        true,
        false,
        true,
        false,
        true,
      ]);
      expect(videos.every((v) => v.in && v.fit === 'contain')).toBe(true);
      expect(videos[0]!.box).toEqual([0, 0, 1920, 1080]);
      // max(0.1 × 0.125, 0.1 − 4 × 0.1 × 0.25) = 0.0125 for the 4 oldest; the 5th muted.
      expect(videos.map((v) => [v.muted, v.volume])).toEqual([
        [false, 0.0125],
        [false, 0.0125],
        [false, 0.0125],
        [false, 0.0125],
        [true, 0],
      ]);
      for (const p of plays)
        expect(await p.end).toEqual({ event: 'completed' });
      expect(await page.$$eval('#stage video', (els) => els.length)).toBe(0);
      expect(s.player.status().playing).toBe(0);
    } finally {
      await close();
      await s.close();
    }
  });

  test('one NTM alone: legacy volume 10 % (0,2 × 0,5), not mirrored when the draw is ≥ 0,35, fades out before its end', async () => {
    const { page, close } = await obsLike();
    await page.goto('about:blank');
    const s = await studio(await recordWebm(page, 2500));
    try {
      await page.addInitScript(() => {
        Math.random = () => 0.35;
      });
      await page.goto(s.player.url);
      await connected(s.player, true);
      const { end } = await s.player.play({
        kind: 'video',
        id: 'fuck-you',
        volume: 10,
      });
      await page.waitForTimeout(600);
      expect(
        await page.$eval('#stage video', (v) => [
          (v as HTMLVideoElement).volume,
          v.classList.contains('mirror'),
          v.classList.contains('out'),
        ]),
      ).toEqual([0.1, false, false]);
      await page.waitForTimeout(1700); // past duration − 500 ms
      expect(
        await page.$eval('#stage video', (v) => v.classList.contains('out')),
      ).toBe(true);
      expect(await end).toEqual({ event: 'completed' });
    } finally {
      await close();
      await s.close();
    }
  });
});
