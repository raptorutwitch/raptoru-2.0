import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { HalloweenRuntime } from '../src/halloween/runtime.js';

// Halloween (docs/HALLOWEEN.md § 4 bis, § 6 bis) in Chromium, with the REAL Studio runtime and pages:
// - « Ambiance Halloween » OBS source: nothing while off; Studio's switches act at once; « Lancer un vol » plays the bats
//   once; a source with ?layers=spider shows the spider only; the decor is never sold nor tested on the screen;
// - Chaos without a game window to capture (a plain browser has no Electron handler): the effect fails cleanly, nothing
//   stays on the overlay. No Core, no Twitch, no OBS (the source is the page OBS loads).

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_HALLOWEEN_AMBIANCE_PORT ?? 4397);
const origin = `http://127.0.0.1:${PORT}`;

let studio: Server;
let rt: HalloweenRuntime;
let dir = '';

test.describe.configure({ mode: 'serial' });
test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
});

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'halloween-ambiance-e2e-'));
  await mkdir(join(dir, 'media'), { recursive: true });
  const fixture = join(
    here,
    '..',
    'test',
    'fixtures',
    'alerts',
    'video-1s-sound.webm',
  );
  for (const id of ['decor-araignee-cam', 'decor-chauves-souris', 'foxy'])
    await copyFile(fixture, join(dir, 'media', `${id}.webm`));
  const entry = (id: string, kind: string) => ({
    id,
    label: id,
    kind,
    file: `${id}.webm`,
    duration_ms: 1000,
    width: 64,
    height: 36,
    alpha: true,
    audio: false,
  });
  await writeFile(
    join(dir, 'media', 'manifest.json'),
    JSON.stringify({
      media: [
        entry('decor-araignee-cam', 'decor'),
        entry('decor-chauves-souris', 'decor'),
        entry('foxy', 'screamer'),
      ],
    }),
  );
  rt = new HalloweenRuntime({
    origin,
    dir,
    pageDir: join(here, '..', 'halloween-overlay'),
    core: null,
    environment: null,
    channelId: '900100',
    studioId: 'studio-e2e',
    fromMain: () => false,
  });
  await rt.start();
  studio = createServer(async (req, res) => {
    const url = new URL(req.url!, origin);
    if (!(await rt.handle(req, res, url))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => studio.listen(PORT, '127.0.0.1', r));
});

test.afterAll(async () => {
  rt?.stop();
  studio?.closeAllConnections();
  await new Promise((r) => studio?.close(r));
  await rm(dir, { recursive: true, force: true });
});

const api = async (path: string, body?: unknown) => {
  const r = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read answers
  return { status: r.status, body: (await r.json()) as any };
};
const opacity = (page: Page, id: string) =>
  page.locator(`#${id}`).evaluate((e) => Number(getComputedStyle(e).opacity));

test('Ambiance: nothing while off; the switches act at once; one flight on demand; a spider-only source', async ({
  page,
  browser,
}) => {
  const status = (await api('/api/halloween/status')).body;
  expect(status.ambiance).toMatchObject({
    connected: false,
    spider_ready: true,
    bats_ready: true,
    settings: { enabled: false },
  });
  // The decor is never sold nor played on the streamer's screen.
  expect(status.media.map((m: { id: string }) => m.id)).toEqual(['foxy']);

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(status.ambiance.url);
  await expect
    .poll(
      async () => (await api('/api/halloween/status')).body.ambiance.connected,
    )
    .toBe(true);
  await page.waitForTimeout(500);
  for (const id of ['vignette', 'spider', 'bats'])
    expect(await opacity(page, id)).toBe(0);
  expect((await api('/api/halloween/ambiance/bats', {})).body.error).toBe(
    'ambiance_off',
  );

  // On: vignette at its strength, the spider looping.
  await api('/api/halloween/settings', {
    ambiance: { enabled: true, vignette_strength: 0.6, bats_every_min: 0 },
  });
  await expect
    .poll(() => opacity(page, 'vignette'), { timeout: 6000 })
    .toBe(0.6);
  await expect.poll(() => opacity(page, 'spider'), { timeout: 6000 }).toBe(1);
  expect(
    await page.locator('#spider').evaluate((v: HTMLVideoElement) => !v.paused),
  ).toBe(true);
  expect(await opacity(page, 'bats')).toBe(0);

  // One flight now (the bats show, then go once their video ends).
  expect((await api('/api/halloween/ambiance/bats', {})).status).toBe(200);
  // (the test video lasts 1 s, less than the fade: visible, not necessarily fully opaque)
  await expect
    .poll(() => opacity(page, 'bats'), { timeout: 6000 })
    .toBeGreaterThan(0.3);
  await expect.poll(() => opacity(page, 'bats'), { timeout: 8000 }).toBe(0);

  // A source with the spider only (placed over the webcam in OBS).
  const cam = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  await cam.goto(status.ambiance.url.replace('#', '?layers=spider#'));
  await expect.poll(() => opacity(cam, 'spider'), { timeout: 6000 }).toBe(1);
  expect(await opacity(cam, 'vignette')).toBe(0);

  // One layer off, then everything off: nothing stays on the stream.
  await api('/api/halloween/settings', { ambiance: { spider: false } });
  await expect.poll(() => opacity(page, 'spider'), { timeout: 6000 }).toBe(0);
  expect(await opacity(page, 'vignette')).toBe(0.6);
  await api('/api/halloween/settings', { ambiance: { enabled: false } });
  await expect.poll(() => opacity(page, 'vignette'), { timeout: 6000 }).toBe(0);
  expect(errors).toEqual([]);
});

test('Chaos without a game window to capture: the effect fails cleanly, the overlay stays empty', async ({
  page,
}) => {
  const status = (await api('/api/halloween/status')).body;
  expect(status.effects).toEqual(expect.arrayContaining(['flip', 'blur']));
  await page.goto(
    `${origin}/halloween/overlay.html#${status.ambiance.url.split('#')[1]}`,
  );
  await expect
    .poll(async () => (await api('/api/halloween/status')).body.engine_ready)
    .toBe(true);
  // The decor is never played on the streamer's screen.
  expect(
    (await api('/api/halloween/test', { media_id: 'decor-araignee-cam' }))
      .status,
  ).toBe(400);
  expect(
    (
      await api('/api/halloween/test', {
        effect: 'flip',
        params: { mode: 'rotate', durationMs: 4000 },
      })
    ).status,
  ).toBe(200);
  await expect
    .poll(
      async () =>
        (await api('/api/halloween/status')).body.events[0]?.text as string,
      { timeout: 10_000 },
    )
    .toMatch(/^flip : échec \((no_game_window|capture_unsupported)\)$/);
  expect((await api('/api/halloween/status')).body.current).toBeNull();
  expect(await page.locator('#stage > *').count()).toBe(0);
});
