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

async function studio(
  video?: Buffer,
  playerDir = join(here, '..', 'effects-player'),
  /** More media of the catalogue (file name → content), e.g. the Random Ban videos. */
  extra: Record<string, Buffer> = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'effects-e2e-'));
  const src = join(dir, 'src');
  await (await import('node:fs/promises')).mkdir(src);
  await writeFile(join(src, 'ErenScream.ogg'), wav(600));
  await writeFile(join(src, 'Tiens bon !.ogg'), wav(900));
  if (video) await writeFile(join(src, 'Fuck You.webm'), video);
  // The BRB video (any real WebM: the layer around it is what is under test).
  if (video) await writeFile(join(src, "We'll be right back_3.webm"), video);
  for (const [name, data] of Object.entries(extra))
    await writeFile(join(src, name), data);
  const media = await AlertMediaStore.open(join(dir, 'media'));
  await media.import([
    ...Object.keys(extra).map((name) => ({ name, from: join(src, name) })),
    { name: 'ErenScream.ogg', from: join(src, 'ErenScream.ogg') },
    { name: 'Tiens bon !.ogg', from: join(src, 'Tiens bon !.ogg') },
    ...(video
      ? [
          { name: 'Fuck You.webm', from: join(src, 'Fuck You.webm') },
          {
            name: "We'll be right back_3.webm",
            from: join(src, "We'll be right back_3.webm"),
          },
        ]
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
    playerDir,
    // Sounds imported from Studio (Votekick launch sound).
    uploadsDir: join(dir, 'uploads'),
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

  test('a sound imported from Studio (upload:<sha256>.wav, the Votekick launch sound): played to its end, never « invalid_effect »', async () => {
    const s = await studio();
    const { page, close } = await obsLike();
    try {
      await page.goto(s.player.url);
      await connected(s.player, true);
      const up = await s.player.importSound(wav(700), 'Lancement votekick.wav');
      expect(up.id).toMatch(/^upload:[a-f0-9]{64}\.wav$/);
      const played = await s.player.play({
        kind: 'sound',
        id: up.id,
        volume: 80,
      });
      expect(await played.end).toEqual({ event: 'completed' });
      // Served only under that exact form: a path or another extension is refused by Studio.
      for (const bad of [
        'upload:../../secret.wav',
        `upload:${'a'.repeat(64)}.exe`,
      ])
        await expect(
          s.player.play({ kind: 'sound', id: bad, volume: 80 }),
        ).rejects.toThrow();
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

/** A real PNG drawn by Chromium (size and colour checked on the page). */
async function png(page: Page, w: number, h: number, colour: string) {
  const data = await page.evaluate(
    ([width, height, fill]) => {
      const c = document.createElement('canvas');
      c.width = width as number;
      c.height = height as number;
      const g = c.getContext('2d')!;
      g.fillStyle = fill as string;
      g.fillRect(0, 0, c.width, c.height);
      return c.toDataURL('image/png').split(',')[1]!;
    },
    [w, h, colour] as const,
  );
  return Buffer.from(data, 'base64');
}

test.describe('Effects player — BRB layer (as in OBS)', () => {
  test('screen + camera captures under the BRB video, legacy layout and timings, volume 1; removed 700 ms after the video, captures dropped', async () => {
    const { page, close } = await obsLike();
    await page.goto('about:blank');
    const video = await recordWebm(page, 2000);
    const screen = await png(page, 1920, 1080, '#3050a0');
    const cam = await png(page, 1920, 1080, '#a03050');
    const s = await studio(video);
    try {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(s.player.url);
      await connected(s.player, true);
      const { end } = await s.player.play({ kind: 'wbrb', screen, cam });
      expect(s.player.capturesHeld).toBe(2);
      await page.waitForTimeout(400);
      const layer = await page.$eval('#stage .wbrb', (l) => {
        const [bg, , camImg, v] = [...l.children] as [
          HTMLImageElement,
          HTMLElement,
          HTMLImageElement,
          HTMLVideoElement,
        ];
        const cs = getComputedStyle(camImg);
        return {
          classes: l.className,
          order: [...l.children].map(
            (c) => c.className || c.tagName.toLowerCase(),
          ),
          bg: [bg.naturalWidth, bg.naturalHeight, getComputedStyle(bg).filter],
          cam: [
            camImg.naturalWidth,
            cs.left,
            cs.top,
            cs.width,
            cs.height,
            cs.animationName,
            cs.animationDelay,
          ],
          video: [v.volume, v.muted, getComputedStyle(v).opacity !== '0'],
        };
      });
      expect(layer).toEqual({
        classes: 'wbrb video-ready',
        order: ['wbrb-bg', 'wbrb-bg-shade', 'wbrb-cam', 'video'],
        bg: [1920, 1080, 'saturate(0.8) contrast(1.04) brightness(0.78)'],
        cam: [
          1920,
          '506px',
          '-141px',
          '1766px',
          '1436px',
          'wbrbCamCurtain',
          '1s',
        ],
        video: [1, false, true],
      });
      expect(await end).toEqual({ event: 'completed' });
      expect(await page.$$eval('#stage .wbrb', (l) => l.length)).toBe(0);
      expect(s.player.capturesHeld).toBe(0);
    } finally {
      await close();
      await s.close();
    }
  });
});

test.describe('Effects player — stale OBS page (BRB fix)', () => {
  test('the files change while the OBS page runs: it gets nothing, reloads itself once idle, then accepts the real BRB payload', async () => {
    const { page, close } = await obsLike();
    await page.goto('about:blank');
    const video = await recordWebm(page, 1500);
    const screen = await png(page, 1920, 1080, '#3050a0');
    const cam = await png(page, 1920, 1080, '#a03050');
    // A copy of the page files, changed below like a Studio update would.
    const dir = await mkdtemp(join(tmpdir(), 'effects-page-'));
    for (const f of ['player.html', 'player.js', 'wheel.js'])
      await writeFile(
        join(dir, f),
        await (
          await import('node:fs/promises')
        ).readFile(join(here, '..', 'effects-player', f)),
      );
    const s = await studio(video, dir);
    try {
      await page.goto(s.player.url);
      await connected(s.player, true);
      expect(s.player.status().current).toBe(true);
      const loads: number[] = [];
      page.on('load', () => loads.push(Date.now()));
      // « Studio update »: the served files are new; the page still runs the old ones.
      await (
        await import('node:fs/promises')
      ).appendFile(join(dir, 'player.js'), '\n// update\n');
      await expect.poll(() => loads.length, { timeout: 10_000 }).toBe(1);
      await expect.poll(() => s.player.status().current).toBe(true);
      // The real payload, from the server to its acceptance by player.js: started, played, ended.
      const { end } = await s.player.play({ kind: 'wbrb', screen, cam });
      expect(await page.$$eval('#stage .wbrb', (l) => l.length)).toBe(1);
      expect(await end).toEqual({ event: 'completed' });
      expect(loads).toHaveLength(1); // one reload, no loop
    } finally {
      await close();
      await s.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test.describe('Effects player — Random Ban V2 layers (as in OBS)', () => {
  test('ban: legacy layer (mirror variant, volume 0,5, phrase with both names as text), ends at the video end or the legacy watchdog; CSC; flop text + trumpet', async () => {
    const { page, close } = await obsLike();
    await page.goto('about:blank');
    const short = await recordWebm(page, 1500);
    const long = await recordWebm(page, 4600);
    const s = await studio(undefined, undefined, {
      'Alerte R&M RB 1.webm': short,
      'RandomBan Classic.webm': long,
      'CSC bruité Fix.webm': short,
      'Fail Trumpet Sound Effect [TubeRipper.cc].ogg': wav(1200),
    });
    try {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(s.player.url);
      await connected(s.player, true);
      // R&M mirror: phrase of the « rm » pool, names as text (never HTML), shown at 500 ms.
      const t0 = Date.now();
      const rm = await s.player.play({
        kind: 'ban',
        animation: 'ban_rm_mirror',
        trigger: 'Buyer',
        banned: '<b>Target</b>',
      });
      await page.waitForTimeout(900);
      const layer = await page.$eval('#stage .rb', (l) => {
        const v = l.querySelector('video')!;
        const t = l.querySelector('.pseudo-ban')!;
        return {
          mirror: v.classList.contains('mirror'),
          transform: getComputedStyle(v).transform,
          volume: v.volume,
          muted: v.muted,
          shown: t.className,
          trigger: t.querySelector('.trigger')?.textContent,
          banned: t.querySelector('.banned')?.textContent,
          bold: t.querySelectorAll('b').length,
          text: t.textContent,
          color: getComputedStyle(t.querySelector('.banned')!).color,
        };
      });
      expect(layer).toMatchObject({
        mirror: true,
        transform: 'matrix(-1, 0, 0, 1, 0, 0)',
        volume: 0.5,
        muted: false,
        shown: 'pseudo-ban show',
        trigger: 'Buyer',
        banned: '<b>Target</b>',
        bold: 0,
        color: 'rgb(255, 77, 77)',
      });
      expect([
        'Buyer a dégommé <b>Target</b>',
        "<b>Target</b> s'est fait dégommer par Buyer",
        'Buyer a ouvert un portail et a fumé <b>Target</b>',
        "<b>Target</b> s'est pris un laser de Buyer",
      ]).toContain(layer.text);
      expect(await (await rm).end).toEqual({ event: 'completed' });
      // The 1,5 s video ends before the watchdog (4 s + 0,8 s): done at the video's end.
      expect(Date.now() - t0).toBeLessThan(3500);
      expect(await page.$$eval('#stage .rb', (l) => l.length)).toBe(0);
      // Classic, 4,6 s video: the legacy watchdog (3 s + 0,8 s) ends it first.
      const t1 = Date.now();
      const classic = await s.player.play({
        kind: 'ban',
        animation: 'ban_classic',
        trigger: 'A',
        banned: 'B',
      });
      expect(await (await classic).end).toEqual({ event: 'completed' });
      const took = Date.now() - t1;
      expect(took).toBeGreaterThan(3500);
      expect(took).toBeLessThan(4500);
      // CSC.
      const csc = await s.player.play({
        kind: 'ban',
        animation: 'ban_csc',
        trigger: 'Buyer',
        banned: 'Buyer',
      });
      await page.waitForTimeout(800);
      expect(await page.$eval('#stage .pseudo-ban', (t) => t.textContent)).toBe(
        'Buyer est une grosse merde',
      );
      expect(await (await csc).end).toEqual({ event: 'completed' });
      // Flop: the legacy text source (white Arial 256 px scaled at 647,316, faded in), the trumpet at 0,5.
      const t2 = Date.now();
      const flop = await s.player.play({ kind: 'flop', trigger: 'Buyer' });
      await page.waitForTimeout(800);
      const text = await page.$eval('#stage .rb-flop', (t) => {
        const cs = getComputedStyle(t);
        return {
          text: t.textContent,
          opacity: cs.opacity,
          left: cs.left,
          top: cs.top,
          size: cs.fontSize,
          color: cs.color,
          transform: cs.transform,
        };
      });
      expect(text).toMatchObject({
        text: 'Buyer a flop cheh !',
        opacity: '1',
        left: '647px',
        top: '316px',
        size: '256px',
        color: 'rgb(255, 255, 255)',
      });
      expect(text.transform).toMatch(
        /^matrix\(0\.2768\d*, 0, 0, 0\.2765\d*, 0, 0\)$/,
      );
      expect(await (await flop).end).toEqual({ event: 'completed' });
      expect(Date.now() - t2).toBeGreaterThan(2400);
      expect(await page.$$eval('#stage .rb-flop', (l) => l.length)).toBe(0);
    } finally {
      await close();
      await s.close();
    }
  });
});

test.describe('Effects player — Roue du Sub (as in OBS)', () => {
  test('legacy wheel: banner, segments of the months, lands on the recorded segment, « +N jetons », slides out; a mismatched amount never shows', async () => {
    const s = await studio(undefined, undefined, {
      'Incrémentation Son.mp3': wav(1500),
      'Fin casino son.mp3': wav(600),
    });
    const { page, close } = await obsLike();
    try {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(s.player.url);
      await connected(s.player, true);
      const layout = [
        { val: 500, mult: 1 },
        { val: 750, mult: 1 },
        { val: 1000, mult: 1 },
        { val: 1500, mult: 2 },
        { val: 2000, mult: 1 },
        { val: 3000, mult: 1 },
        { val: 3000, mult: 2 },
        { val: 5000, mult: 1 },
        { val: 7500, mult: 1 },
        { val: 10000, mult: 1 },
        { val: 15000, mult: 1 },
        { val: 2000, mult: 3 },
      ];
      const texts: string[] = [];
      const t0 = Date.now();
      const { end } = await s.player.play({
        kind: 'wheel',
        spin: {
          name: 'Viewer',
          type: 'resub',
          tier: 2,
          months: 14,
          layout,
          segment: 3,
          amount: 6000,
        },
      });
      await page.waitForTimeout(500);
      const banner = await page.$eval('#wheelContainer', (c) => ({
        pseudo: c.querySelector('#wheelPseudo')!.textContent,
        month: c.querySelector('#wheelMonth')!.textContent,
        tier: c.querySelector('#wheelTier')!.textContent,
        segments: c.querySelectorAll('#wheelSvg path').length,
        hub: (c.querySelector('#wheelHubMultHtml') as SVGTextElement)
          .textContent,
      }));
      // 12 segments + one outer band per multiplied segment (×2, ×2, ×3), as the legacy SVG draws them.
      expect(banner).toEqual({
        pseudo: 'Viewer',
        month: '14',
        tier: 'T2',
        segments: 15,
        hub: '×2',
      });
      const poll = setInterval(() => {
        void page
          .$eval('#wheelResult', (r) => r.textContent ?? '')
          .then((t) => t && texts.push(t))
          .catch(() => {});
      }, 100);
      expect(await end).toEqual({ event: 'completed' });
      clearInterval(poll);
      expect(Date.now() - t0).toBeGreaterThan(4000);
      expect(texts).toContain('+3000');
      expect(texts).toContain('+6000 jetons');
      // The pointer sits on the recorded segment: the rotation lands mid-segment 3 (of 12).
      const rot = await page.$eval('#wheelSvg', (w) =>
        Number(
          /rotate\(([-\d.]+)deg\)/.exec((w as SVGElement).style.transform)?.[1],
        ),
      );
      expect((((rot % 360) + 360) % 360).toFixed(2)).toBe(
        ((360 - (3 * 30 + 15)) % 360).toFixed(2),
      );
      const { end: bad } = await s.player.play({
        kind: 'wheel',
        spin: {
          name: 'X',
          type: 'resub',
          tier: 1,
          months: 14,
          layout,
          segment: 3,
          amount: 999,
        },
      });
      expect(await bad).toEqual({ event: 'failed', error: 'playback_error' });
    } finally {
      await close();
      await s.close();
    }
  });
});
