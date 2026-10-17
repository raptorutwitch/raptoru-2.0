import { randomBytes } from 'node:crypto';
import { appendFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { expect, test, type Page } from '@playwright/test';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { systemClock } from '../../../core-api/src/clock.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { ALERT_VARIANTS } from '../../../core-api/src/alerts/variants.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import { AlertMediaStore } from '../src/alerts/media-store.js';
import { AlertsRuntime } from '../src/alerts/runtime.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';

// Twitch alerts V1 (A2) — the browser chain in Chromium: the REAL Lab Core alert queue (in-memory PGlite), the REAL
// Studio alert routes and the REAL OBS source / preview pages (shared engine), with tiny generated media
// (test/fixtures/alerts: 1 s VP9 + alpha video, 2.5 s MP3, a broken file). No Twitch, no OBS, nothing on disk kept.

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, '..', 'test', 'fixtures', 'alerts');
const CH = '900100';

// OBS plays sound without a click: same for the test browser.
test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
});
test.describe.configure({ mode: 'serial' });

let core: Server;
let studio: Server;
let rt: AlertsRuntime;
let origin = '';
let secret = '';
let coreUrl = '';
let dir = '';
// A copy of the OBS source files: the stale-source tests change one to make a new version.
let playerDir = '';
let closeDb: () => Promise<void>;

const listen = (s: Server, port = 0) =>
  new Promise<number>((r) =>
    s.listen(port, '127.0.0.1', () => r((s.address() as AddressInfo).port)),
  );
const close = (s: Server) =>
  new Promise<void>((r) => {
    s.close(() => r());
    s.closeAllConnections();
  });

function studioServer() {
  return createServer((req, res) => {
    void rt.handle(req, res, new URL(req.url!, origin)).then((done) => {
      if (!done) res.writeHead(404).end();
    });
  });
}

test.beforeAll(async () => {
  const db = createPgliteDb(
    new PGlite({
      parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
    }),
  );
  closeDb = () => db.close();
  await migrate(db, 'lab');
  secret = randomBytes(32).toString('hex');
  core = createLabCore({ db, clock: systemClock, secret }).server;
  coreUrl = `http://127.0.0.1:${await listen(core)}`;
  dir = await mkdtemp(join(tmpdir(), 'alerts-e2e-'));
  const media = await AlertMediaStore.open(join(dir, 'media'));
  await media.import([
    { name: 'Raid Titan.webm', from: join(FIX, 'video-1s.webm') },
    {
      name: 'Raptoru_Alerte_Raid_Sound.mp3',
      from: join(FIX, 'audio-2_5s.mp3'),
    },
    { name: 'Alerte Sub 5.webm', from: join(FIX, 'video-1s.webm') },
    // Like the legacy Bits / MoneyTest: VP8 + alpha with a single keyframe (Chromium cannot jump inside it).
    { name: 'Dofus Ebène Son.webm', from: join(FIX, 'vp8-one-keyframe.webm') },
    { name: 'Alerte follow Eren.webm', from: join(FIX, 'video-1s-sound.webm') },
    // A broken file under a real name: the player reports the error.
    { name: 'Alerte Bits.webm', from: join(FIX, 'broken.webm') },
    // Every follow variant (the follow is drawn at random), for the families tests.
    {
      name: 'Alerte follow Discord monsieur.webm',
      from: join(FIX, 'video-1s.webm'),
    },
    { name: 'Dofus Eliatrope Son.webm', from: join(FIX, 'video-1s.webm') },
    { name: 'Dofus Emeraude Son.webm', from: join(FIX, 'video-1s.webm') },
    { name: 'son_follow_discord.mp3', from: join(FIX, 'audio-2_5s.mp3') },
    { name: 'son_follow_eren.mp3', from: join(FIX, 'audio-2_5s.mp3') },
    // MoneyTest.webm / Son Alerte Don.mp3 are left missing on purpose.
  ]);
  playerDir = join(dir, 'player');
  await cp(join(here, '..', 'alerts-player'), playerDir, { recursive: true });
  studio = studioServer();
  const port = await listen(studio);
  origin = `http://127.0.0.1:${port}`;
  rt = await AlertsRuntime.create({
    channelId: CH,
    core: localLabCoreClient(coreUrl, secret),
    origin,
    dir,
    playerDir,
    media,
  });
});

test.afterAll(async () => {
  await close(studio);
  await close(core);
  await closeDb();
  await rm(dir, { recursive: true, force: true });
});

type Item = {
  alert_id: string;
  status: string;
  attempts: number;
  type: string;
  started_at: string | null;
  ended_at: string | null;
  failure: { message?: string } | null;
};
type State = { in_flight: Item[]; queued: Item[]; recent: Item[] };

const coreCall = async <T>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(coreUrl + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json()) as T;
};
const state = () => coreCall<State>(`/v1/lab/alerts/${CH}/state`);
let seq = 0;
const event = (e: Record<string, unknown>) =>
  coreCall<{ outcome: string; alert?: { alert_id: string } }>(
    '/v1/lab/alerts/events',
    {
      channel_id: CH,
      source: 'simulation',
      source_event_id: `e2e-${++seq}`,
      ...e,
    },
  );
const item = async (id: string) =>
  [
    ...(await state()).recent,
    ...(await state()).in_flight,
    ...(await state()).queued,
  ].find((i) => i.alert_id === id);
const until = async (id: string, statuses: string[], timeout = 15_000) => {
  await expect
    .poll(async () => (await item(id))?.status, { timeout, intervals: [200] })
    .toMatch(new RegExp(`^(${statuses.join('|')})$`));
  return (await item(id))!;
};

/** Times at which the page reloaded itself (main frame navigations after this call). */
function watchReloads(page: Page) {
  const at: number[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) at.push(Date.now());
  });
  return at;
}
const pageVersion = (page: Page) =>
  page.locator('meta[name="alerts-player-version"]').getAttribute('content');

/** The preview page alone: its messages to « the parent » (itself here) are recorded. */
async function preview(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { msgs: unknown[] }).msgs = [];
    window.addEventListener('message', (e) => {
      if ((e.data as { source?: string })?.source === 'alerts-preview')
        (window as unknown as { msgs: unknown[] }).msgs.push(e.data);
    });
  });
  await page.goto(`${origin}/alerts/preview.html`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { msgs: { type: string }[] }).msgs.some(
          (m) => m.type === 'ready',
        ),
      ),
    )
    .toBe(true);
  return {
    play: (variant: unknown, data: unknown) =>
      page.evaluate(
        ([v, d]) =>
          window.postMessage(
            { type: 'play', variant: v, data: d, volume: 0 },
            location.origin,
          ),
        [variant, data] as const,
      ),
    stop: () =>
      page.evaluate(() =>
        window.postMessage({ type: 'stop' }, location.origin),
      ),
    /** Timeline: freezes the alert at `ms`, resolves the preview's frame reply. */
    seek: async (variant: unknown, data: unknown, ms: number) => {
      const before = await page.evaluate(
        () => (window as unknown as { msgs: unknown[] }).msgs.length,
      );
      await page.evaluate(
        ([v, d, t]) =>
          window.postMessage(
            { type: 'seek', variant: v, data: d, ms: t },
            location.origin,
          ),
        [variant, data, ms] as const,
      );
      await expect
        .poll(() =>
          page.evaluate(
            (n) =>
              (window as unknown as { msgs: { type: string }[] }).msgs
                .slice(n)
                .some((m) => m.type === 'frame'),
            before,
          ),
        )
        .toBe(true);
      return page.evaluate(
        (n) =>
          (
            window as unknown as {
              msgs: {
                type: string;
                ms: number;
                lengthMs: number;
                marks: unknown[];
              }[];
            }
          ).msgs
            .slice(n)
            .find((m) => m.type === 'frame')!,
        before,
      );
    },
    ended: () =>
      expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (
                  window as unknown as {
                    msgs: { state?: string; reason?: string; ms?: number }[];
                  }
                ).msgs
                  .filter((m) => m.state === 'ended')
                  .at(-1) ?? null,
            ),
          { timeout: 15_000 },
        )
        .not.toBeNull()
        .then(() =>
          page.evaluate(() =>
            (
              window as unknown as {
                msgs: { state?: string; reason?: string; ms?: number }[];
              }
            ).msgs
              .filter((m) => m.state === 'ended')
              .at(-1)!,
          ),
        ),
  };
}

test('preview: same engine, never touches the queue; Stop ends at once', async ({
  page,
}) => {
  const queued = await event({
    type: 'raid',
    actor: { display_name: 'Raider' },
    viewers: 12,
  });
  expect(queued.outcome).toBe('queued');
  const p = await preview(page);
  await p.play(ALERT_VARIANTS.raid_default, { pseudo: 'Raider', viewers: 12 });
  await expect(page.locator('#alertVideo')).toHaveCSS('visibility', 'visible');
  await p.stop();
  expect((await p.ended()).reason).toBe('stopped');
  await expect(page.locator('#alertVideo')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#pseudoText')).toHaveText('');
  // The queued alert was never claimed by the preview.
  const it = (await item(queued.alert!.alert_id))!;
  expect(it).toMatchObject({ status: 'queued', attempts: 0 });
});

test('preview: raid ends when its sound ends (keepAudio), hostile pseudo shown as text', async ({
  page,
}) => {
  const p = await preview(page);
  const hostile = '<img src=x onerror="window.pwned=1">';
  await p.play(ALERT_VARIANTS.raid_default, { pseudo: hostile, viewers: 42 });
  await expect(page.locator('#pseudoText .zone-name')).toHaveText(hostile, {
    timeout: 5000,
  });
  await expect(page.locator('#pseudoText .zone-number')).toHaveText('42');
  expect(await page.locator('#stage img').count()).toBe(0);
  const end = await p.ended();
  // 1 s video, 2.5 s sound: the alert lasts until the sound's end.
  expect(end.reason).toBe('audio-ended');
  expect(end.ms).toBeGreaterThan(2300);
  expect(
    await page.evaluate(() => (window as unknown as { pwned?: number }).pwned),
  ).toBeUndefined();
});

test('preview: gift counter reaches N; anonymous gifter; long Dofus name shrinks', async ({
  page,
}) => {
  const p = await preview(page);
  await p.play(
    {
      ...ALERT_VARIANTS.subgift_5,
      duration: 4000,
      showAt: 100,
      fadeOutAt: 3500,
      hideAt: 3800,
    },
    { pseudo: 'Un généreux anonyme', count: 37, anonymous: true },
  );
  await expect(page.locator('.gift-name')).toHaveText('Un généreux anonyme');
  await expect(page.locator('.gift-count')).toHaveText('37', { timeout: 3000 });
  expect((await p.ended()).reason).toBe('duration');
  await p.play(
    {
      ...ALERT_VARIANTS.follow_dofus_ebene,
      video: 'Alerte follow Eren.webm',
      audio: null,
      duration: 1500,
      showAt: 50,
    },
    { pseudo: 'UnPseudoTresTresLong_28chars' },
  );
  await expect(page.locator('#pseudoText .letter')).toHaveCount(28);
  const size = await page
    .locator('#pseudoText')
    .evaluate((e) => getComputedStyle(e).fontSize);
  // Legacy: base × 14 / length (the variant's own maximum size).
  const base = ALERT_VARIANTS.follow_dofus_ebene!.maxFontSize ?? 44;
  expect(size).toBe(`${Math.round(base * (14 / 28) * 10) / 10}px`);
  await p.ended();
});

test('preview timeline: frozen real image + texts at the instant, no sound, never the queue', async ({
  page,
}) => {
  const p = await preview(page);
  const raid = {
    ...ALERT_VARIANTS.raid_default,
    showAt: 200,
    fadeOutAt: 600,
    hideAt: 800,
  };
  const data = { pseudo: '<b>Raider</b>', viewers: 7 };
  const video = page.locator('#alertVideo');
  const opacity = () =>
    page
      .locator('#pseudoText')
      .evaluate((e) => Number(getComputedStyle(e).opacity));

  const f = await p.seek(raid, data, 100);
  // 1 s fixture video; the timeline covers the image (the sound that plays on is not drawn).
  expect(f.lengthMs).toBeGreaterThanOrEqual(990);
  expect(f.marks).toEqual([
    { at: 200, action: 'text-show' },
    { at: 600, action: 'text-fade' },
    { at: 800, action: 'text-clear' },
  ]);
  await expect(page.locator('#pseudoText')).toHaveText('');
  expect(
    await video.evaluate((v: HTMLVideoElement) => [v.paused, v.currentTime]),
  ).toEqual([true, 0.1]);
  await expect(video).toHaveCSS('visibility', 'visible');

  await p.seek(raid, data, 500);
  await expect(page.locator('#pseudoText .zone-name')).toHaveText(
    '<b>Raider</b>',
  );
  expect(await opacity()).toBe(1);
  expect(
    await video.evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeCloseTo(0.5, 3);

  // Inside the 200 ms fade: the paused animation sits halfway, ±0.01 s moves it.
  await p.seek(raid, data, 700);
  const mid = await opacity();
  expect(mid).toBeGreaterThan(0.2);
  expect(mid).toBeLessThan(0.8);
  await p.seek(raid, data, 710);
  expect(await opacity()).toBeLessThan(mid);

  await p.seek(raid, data, 900);
  await expect(page.locator('#pseudoText')).toHaveText('');
  // After the video end (no imposed duration): nothing on screen, as during play.
  await p.seek(raid, data, 1500);
  await expect(video).toHaveCSS('visibility', 'hidden');
  expect(
    await page
      .locator('#alertAudio')
      .evaluate((a: HTMLAudioElement) => a.paused),
  ).toBe(true);

  // The gift counter follows the virtual clock: partway, then N.
  const gift = {
    ...ALERT_VARIANTS.subgift_5,
    duration: 4000,
    showAt: 100,
    fadeOutAt: 3500,
    hideAt: 3800,
  };
  await p.seek(gift, { pseudo: 'Gifter', count: 37 }, 400);
  const partial = Number(await page.locator('.gift-count').textContent());
  expect(partial).toBeGreaterThan(0);
  expect(partial).toBeLessThan(37);
  await p.seek(gift, { pseudo: 'Gifter', count: 37 }, 2000);
  await expect(page.locator('.gift-count')).toHaveText('37');
  // Imposed duration: past the 1 s video, its last image stays.
  await expect(video).toHaveCSS('visibility', 'visible');

  // Single-keyframe VP8 (like the legacy Bits / MoneyTest): the decode-from-start path gives the right instant,
  // forward and back, without error. (The corrupt image itself only showed with the real legacy files: checked on
  // them in Chromium, see docs/TWITCH_ALERTS_PARITY_2026-10.md § 15; this tiny fixture does not reproduce it.)
  const vp8 = {
    ...ALERT_VARIANTS.don_moneytest,
    video: 'Dofus Ebène Son.webm',
    audio: null,
    fps: 12,
    duration: 1900,
    videoFade: { in: 800, out: 300, outAt: 1000 },
  };
  for (const at of [0, 1500, 1583, 1250]) {
    const frame = await p.seek(vp8, { pseudo: 'X', amount: '5' }, at);
    expect(frame.ms).toBe(at);
    expect(
      await video.evaluate(
        (v: HTMLVideoElement, t) => [
          v.error,
          Math.abs(v.currentTime - t / 1000) <= 1 / 12 + 0.02,
        ],
        at,
      ),
    ).toEqual([null, true]);
  }
  // Fade-out started after the fade-in: it starts from the real opacity (100 ms into 300 ms → 2/3).
  await p.seek(vp8, { pseudo: 'X', amount: '5' }, 1100);
  expect(
    await video.evaluate((v) => Number(getComputedStyle(v).opacity)),
  ).toBeCloseTo(2 / 3, 2);

  await p.stop();
  await expect(video).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#pseudoText')).toHaveText('');
  expect((await state()).in_flight).toEqual([]);
});

test('OBS source: claims, reports started then completed; one at a time with two sources; no replay', async ({
  browser,
}) => {
  // The raid queued by the first test is still waiting: it is played first (oldest, same priority).
  const before = (await state()).queued.map((i) => i.alert_id);
  const ids = [
    ...before,
    ...(await Promise.all(
      [1, 2].map(
        async (n) =>
          (
            await event({
              type: 'raid',
              actor: { display_name: `R${n}` },
              viewers: n,
            })
          ).alert!.alert_id,
      ),
    )),
  ];
  const a = await browser.newPage();
  const b = await browser.newPage();
  await a.goto(rt.playerUrl);
  await b.goto(rt.playerUrl);
  let maxInFlight = 0;
  const watch = setInterval(async () => {
    maxInFlight = Math.max(maxInFlight, (await state()).in_flight.length);
  }, 150);
  for (const id of ids) {
    const done = await until(id, ['completed', 'failed', 'expired'], 20_000);
    expect(done).toMatchObject({ status: 'completed', attempts: 1 });
    expect(done.started_at).not.toBeNull();
    // Ended with the sound (2.5 s), not with the 1 s video.
    expect(
      Date.parse(done.ended_at!) - Date.parse(done.started_at!),
    ).toBeGreaterThan(2000);
  }
  clearInterval(watch);
  expect(maxInFlight).toBeLessThanOrEqual(1);
  // Reloaded sources: nothing is played again.
  await a.reload();
  await b.reload();
  await new Promise((r) => setTimeout(r, 2500));
  const after = await state();
  expect(after.in_flight).toEqual([]);
  expect(after.queued).toEqual([]);
  for (const id of ids) expect((await item(id))!.attempts).toBe(1);
  await a.close();
  await b.close();
});

test('OBS source: missing media → failed media_missing; broken video → failed video-error', async ({
  page,
}) => {
  await page.goto(rt.playerUrl);
  const don = await event({
    type: 'donation',
    actor: { display_name: 'Donateur' },
    amount: { value: 500, decimal_place: 2, currency: 'EUR' },
  });
  const failed = await until(don.alert!.alert_id, [
    'completed',
    'failed',
    'expired',
  ]);
  expect(failed.status).toBe('failed');
  expect(failed.started_at).toBeNull();
  expect(failed.failure?.message).toBe(
    'media_missing: MoneyTest.webm, Son Alerte Don.mp3',
  );
  const bits = await event({
    type: 'bits',
    actor: { display_name: 'Cheerer' },
    bits: 100,
  });
  const broken = await until(bits.alert!.alert_id, [
    'completed',
    'failed',
    'expired',
  ]);
  expect(broken.status).toBe('failed');
  expect(broken.failure?.message).toMatch(/^video-(error|play-error)$/);
});

test('OBS source: Studio restarting meanwhile — the source picks up again by itself', async ({
  page,
}) => {
  await page.goto(rt.playerUrl);
  const reloads = watchReloads(page);
  const port = Number(new URL(origin).port);
  await close(studio);
  const queued = await event({
    type: 'raid',
    actor: { display_name: 'Pendant' },
    viewers: 1,
  });
  await new Promise((r) => setTimeout(r, 2000));
  expect((await item(queued.alert!.alert_id))!.status).toBe('queued');
  studio = studioServer();
  await listen(studio, port);
  const done = await until(
    queued.alert!.alert_id,
    ['completed', 'failed', 'expired'],
    20_000,
  );
  expect(done).toMatchObject({ status: 'completed', attempts: 1 });
  // Same files before and after the restart: the page never reloaded (unreachable Studio is not a new version).
  expect(reloads).toEqual([]);
});

test('calibration: the OBS source draws the SAVED placement, never changes an alert already playing, no editor frame', async ({
  page,
}) => {
  const P1 = {
    media: { x: 100, y: -50, scale: 0.5 },
    text: { x: 0, y: 40, scale: 1.25 },
  };
  const P2 = {
    media: { x: -200, y: 0, scale: 0.75 },
    text: { x: 0, y: 0, scale: 1 },
  };
  await rt.placement.save('raid_default', P1);
  await page.goto(rt.playerUrl);
  const first = await event({
    type: 'raid',
    actor: { display_name: 'Calibre' },
    viewers: 3,
  });
  await until(first.alert!.alert_id, ['playing']);
  const place = page.locator('#alertPlace');
  await expect(place).toHaveAttribute(
    'style',
    /transform: translate\(100px, -50px\) scale\(0\.5\)/,
  );
  await expect(page.locator('#textPlace')).toHaveAttribute(
    'style',
    /transform: translate\(0px, 40px\) scale\(1\.25\)/,
  );
  // The calibration transform sits on the wrappers only: the text keeps its own animation, the video its class.
  await expect(page.locator('#alertPlace > #alertVideo')).toHaveCount(1);
  await expect(
    page.locator('#alertPlace > #textPlace > #pseudoText'),
  ).toHaveCount(1);
  // Saved again while it plays: this alert does not move.
  await rt.placement.save('raid_default', P2);
  await page.waitForTimeout(400);
  await expect(place).toHaveAttribute('style', /translate\(100px, -50px\)/);
  expect(await page.locator('.al-box, .al-h, .al-calib-layer').count()).toBe(0);
  await until(first.alert!.alert_id, ['completed']);
  // The next alert of the variant uses the new values.
  const second = await event({
    type: 'raid',
    actor: { display_name: 'Calibre2' },
    viewers: 4,
  });
  await until(second.alert!.alert_id, ['playing']);
  await expect(place).toHaveAttribute(
    'style',
    /translate\(-200px, 0px\) scale\(0\.75\)/,
  );
  await until(second.alert!.alert_id, ['completed']);
  await rt.placement.save('raid_default', {
    media: { x: 0, y: 0, scale: 1 },
    text: { x: 0, y: 0, scale: 1 },
  });
});

test('calibration: the preview draws the same transform (shared engine); a frozen image follows the placement', async ({
  page,
}) => {
  const p = await preview(page);
  const P = {
    media: { x: 100, y: -50, scale: 0.5 },
    text: { x: 0, y: 40, scale: 1.25 },
  };
  await page.evaluate(
    ([v, d, pl]) =>
      window.postMessage(
        { type: 'seek', variant: v, data: d, ms: 500, placement: pl },
        location.origin,
      ),
    [ALERT_VARIANTS.raid_default, { pseudo: 'X', viewers: 1 }, P] as const,
  );
  await expect(page.locator('#alertPlace')).toHaveAttribute(
    'style',
    /transform: translate\(100px, -50px\) scale\(0\.5\)/,
  );
  // Live editor update (unsaved values): applied at once, without replaying.
  await page.evaluate(
    (pl) =>
      window.postMessage({ type: 'place', placement: pl }, location.origin),
    { media: { x: 0, y: 0, scale: 1 }, text: { x: 5, y: 0, scale: 1 } },
  );
  await expect(page.locator('#alertPlace')).not.toHaveAttribute(
    'style',
    /translate/,
  );
  await expect(page.locator('#textPlace')).toHaveAttribute(
    'style',
    /translate\(5px, 0px\)/,
  );
  // No placement at all: drawn as before calibration existed.
  await p.seek(ALERT_VARIANTS.raid_default, { pseudo: 'X', viewers: 1 }, 500);
  await expect(page.locator('#textPlace')).not.toHaveAttribute(
    'style',
    /translate/,
  );
});

test('calibration: bits badge and sentence placed on their own, after the font fit, around their centre', async ({
  page,
}) => {
  await preview(page);
  // The bits layout on a playable fixture (the e2e « Alerte Bits.webm » is a broken file on purpose).
  const bits = {
    ...ALERT_VARIANTS.bits_default,
    video: 'Raid Titan.webm',
    loop: false,
  };
  const P = {
    media: { x: 0, y: 0, scale: 1 },
    text: { x: 0, y: 0, scale: 1 },
    parts: { bitsBadge: { x: 300, y: 120, scale: 1.5 } },
  };
  const seekWith = (pl: unknown) =>
    page.evaluate(
      ([v, pl2]) =>
        window.postMessage(
          {
            type: 'seek',
            variant: v,
            data: { pseudo: 'Mangeur', amount: '500' },
            ms: 1500,
            placement: pl2,
          },
          location.origin,
        ),
      [bits, pl] as const,
    );
  await seekWith(null);
  const badge = page.locator('[data-part="bitsBadge"]');
  const message = page.locator('[data-part="bitsMessage"]');
  await expect(badge).toContainText('× 500');
  await expect(message).toContainText('Mangeur');
  const fontBefore = await page
    .locator('#pseudoText')
    .evaluate((e) => getComputedStyle(e).getPropertyValue('--bits-font-size'));
  const before = await message.boundingBox();
  await seekWith(P);
  await expect(badge).toHaveAttribute(
    'style',
    /transform: translate\(300px, 120px\) scale\(1\.5\)/,
  );
  // The sentence did not move, the fitted size did not change (block placed after the fit).
  expect(await message.boundingBox()).toEqual(before);
  expect(
    await page
      .locator('#pseudoText')
      .evaluate((e) =>
        getComputedStyle(e).getPropertyValue('--bits-font-size'),
      ),
  ).toBe(fontBefore);
  // Live editor update of the sentence only.
  await page.evaluate(
    (pl) =>
      window.postMessage({ type: 'place', placement: pl }, location.origin),
    { ...P, parts: { ...P.parts, bitsMessage: { x: -40, y: 0, scale: 1 } } },
  );
  await expect(message).toHaveAttribute('style', /translate\(-40px, 0px\)/);
  await expect(badge).toHaveAttribute('style', /translate\(300px, 120px\)/);
});

test('families: follow, subscription and raid play together in ONE source; each family strictly one after the other', async ({
  page,
}) => {
  await page.goto(rt.playerUrl);
  // Watch the layers the source draws: family, z-index, and whether the raid's sound is still playing.
  await page.evaluate(() => {
    const w = window as unknown as {
      samples: {
        families: string[];
        z: Record<string, string>;
        raidAudio: boolean | null;
      }[];
    };
    w.samples = [];
    setInterval(() => {
      const layers = [
        ...document.querySelectorAll<HTMLElement>('.alert-layer'),
      ];
      const raid = layers.find((l) => l.dataset.family === 'raid');
      w.samples.push({
        families: layers.map((l) => l.dataset.family!),
        z: Object.fromEntries(
          layers.map((l) => [l.dataset.family!, l.style.zIndex]),
        ),
        raidAudio: raid
          ? (() => {
              const a = raid.querySelector('audio')!;
              return !a.paused || a.ended; // still playing, or played to its end: never cut
            })()
          : null,
      });
    }, 50);
  });
  const raid = await event({
    type: 'raid',
    actor: { display_name: 'Titan' },
    viewers: 9,
  });
  await until(raid.alert!.alert_id, ['playing']);
  const follows = [];
  for (const name of ['F1', 'F2', 'F3'])
    follows.push(
      (await event({ type: 'follow', actor: { display_name: name } })).alert!
        .alert_id,
    );
  const gifts = [];
  for (const name of ['G1', 'G2'])
    gifts.push(
      (
        await event({
          type: 'gift_community',
          actor: { display_name: name },
          count: 5,
        })
      ).alert!.alert_id,
    );
  const items = [];
  for (const id of [raid.alert!.alert_id, ...follows, ...gifts])
    items.push(await until(id, ['completed', 'failed', 'expired'], 30_000));
  for (const it of items)
    expect(it).toMatchObject({ status: 'completed', attempts: 1 });
  const samples = await page.evaluate(
    () =>
      (
        window as unknown as {
          samples: {
            families: string[];
            z: Record<string, string>;
            raidAudio: boolean | null;
          }[];
        }
      ).samples,
  );
  // Never two layers of one family; at some point three families at once.
  for (const s of samples)
    expect(new Set(s.families).size).toBe(s.families.length);
  expect(Math.max(...samples.map((s) => s.families.length))).toBe(3);
  // Deterministic stacking: follow 1 < subscription 2 < raid 5, whatever the arrival order.
  const z = Object.assign({}, ...samples.map((s) => s.z));
  expect(z).toMatchObject({ follow: '1', subscription: '2', raid: '5' });
  // The raid's sound kept playing while the follows / gifts came and went.
  const withOthers = samples.filter(
    (s) => s.families.includes('raid') && s.families.length > 1,
  );
  expect(withOthers.length).toBeGreaterThan(0);
  expect(withOthers.every((s) => s.raidAudio === true)).toBe(true);
  // Inside a family: arrival order, each one after the previous one ended.
  const byId = new Map(items.map((i) => [i.alert_id, i]));
  for (const group of [follows, gifts])
    for (let i = 1; i < group.length; i++)
      expect(
        Date.parse(byId.get(group[i]!)!.started_at!),
      ).toBeGreaterThanOrEqual(Date.parse(byId.get(group[i - 1]!)!.ended_at!));
  // Families overlapped in time: the first follow started before the raid ended.
  expect(Date.parse(byId.get(follows[0]!)!.started_at!)).toBeLessThan(
    Date.parse(byId.get(raid.alert!.alert_id)!.ended_at!),
  );
  // Each alert cleaned its own layer.
  await expect(page.locator('.alert-layer')).toHaveCount(0);
});

test('families: the preview overlap test plays other families beside the edited one, never the queue', async ({
  page,
}) => {
  const queued = await event({
    type: 'raid',
    actor: { display_name: 'Attend' },
    viewers: 1,
  });
  const p = await preview(page);
  await p.play(ALERT_VARIANTS.raid_default, { pseudo: 'Edit', viewers: 2 });
  await page.evaluate(
    (items) =>
      window.postMessage(
        { type: 'overlay', volume: 0, items },
        location.origin,
      ),
    [
      {
        variant: ALERT_VARIANTS.subgift_5,
        data: { pseudo: 'Gifter', count: 5 },
        placement: {
          media: { x: 40, y: 0, scale: 0.5 },
          text: { x: 0, y: 0, scale: 1 },
        },
      },
      // Same family as the edited raid: ignored (one per family).
      {
        variant: ALERT_VARIANTS.raid_default,
        data: { pseudo: 'X', viewers: 1 },
      },
    ],
  );
  await expect(page.locator('.alert-layer')).toHaveCount(2);
  await expect(
    page.locator('.alert-layer[data-family="subscription"] #alertPlace'),
  ).toHaveAttribute('style', /translate\(40px, 0px\) scale\(0\.5\)/);
  await expect(
    page.locator('.alert-layer[data-family="raid"] #alertVideo'),
  ).toHaveCSS('visibility', 'visible');
  // Different name colours side by side.
  const colors = await page.$$eval('.alert-layer', (ls) =>
    ls.map((l) => (l as HTMLElement).style.getPropertyValue('--name-color')),
  );
  expect(new Set(colors).size).toBe(2);
  await p.stop();
  await expect(page.locator('.alert-layer')).toHaveCount(1); // the edited alert's own layer stays
  expect((await item(queued.alert!.alert_id))!).toMatchObject({
    status: 'queued',
    attempts: 0,
  });
  // Leave the queue empty for the next tests.
  await page.goto(rt.playerUrl);
  await until(
    queued.alert!.alert_id,
    ['completed', 'failed', 'expired'],
    20_000,
  );
});

test('stale source: a new version waits for every family and its reports, claims nothing meanwhile, then reloads once', async ({
  page,
}) => {
  await page.goto(rt.playerUrl);
  expect(await pageVersion(page)).toBe(await rt.playerVersion());
  const reloads = watchReloads(page);
  const raid = await event({
    type: 'raid',
    actor: { display_name: 'Long' },
    viewers: 2,
  });
  await until(raid.alert!.alert_id, ['playing']);
  const follow = await event({
    type: 'follow',
    actor: { display_name: 'Court' },
  });
  const gift = await event({
    type: 'gift_community',
    actor: { display_name: 'G' },
    count: 5,
  });
  await until(follow.alert!.alert_id, ['playing', 'completed']);
  await until(gift.alert!.alert_id, ['playing', 'completed']);
  // A new version of the files while three families play, then an alert queued during the transition.
  await appendFile(join(playerDir, 'engine.js'), '\n// new version\n');
  const v2 = await rt.playerVersion();
  const late = await event({
    type: 'follow',
    actor: { display_name: 'Apres' },
  });
  await expect.poll(() => reloads.length, { timeout: 20_000 }).toBe(1);
  // Every alert played to its end and was reported before the reload (a family that ended first did not trigger it).
  for (const e of [raid, follow, gift]) {
    const it = (await item(e.alert!.alert_id))!;
    expect(it).toMatchObject({ status: 'completed', attempts: 1 });
    expect(Date.parse(it.ended_at!)).toBeLessThanOrEqual(reloads[0]!);
  }
  expect(await pageVersion(page)).toBe(v2);
  // The alert queued meanwhile was never reserved by the old page: the reloaded one plays it, once.
  const done = await until(
    late.alert!.alert_id,
    ['completed', 'failed', 'expired'],
    20_000,
  );
  expect(done).toMatchObject({ status: 'completed', attempts: 1 });
  expect(Date.parse(done.started_at!)).toBeGreaterThan(reloads[0]!);
  await page.waitForTimeout(2500);
  expect(reloads).toHaveLength(1);
});

test('stale source: a page that still comes back old (cache) reloads once, not in a loop, and keeps playing', async ({
  page,
}) => {
  await page.goto(rt.playerUrl);
  // From now on the page always comes back as it is (a stale cache).
  const old = await (await fetch(`${origin}/alerts/player.html`)).text();
  await page.route('**/alerts/player.html', (r) =>
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: old }),
  );
  const reloads = watchReloads(page);
  await appendFile(join(playerDir, 'timeline.js'), '\n// newer\n');
  await expect.poll(() => reloads.length, { timeout: 10_000 }).toBe(1);
  const f = await event({ type: 'follow', actor: { display_name: 'Cache' } });
  expect(
    await until(f.alert!.alert_id, ['completed', 'failed', 'expired'], 20_000),
  ).toMatchObject({ status: 'completed', attempts: 1 });
  await page.waitForTimeout(3000);
  expect(reloads).toHaveLength(1);
  expect(await pageVersion(page)).not.toBe(await rt.playerVersion());
});

test('donation: a long public donor name shrinks until it fits its line, a short one keeps the legacy size; text only', async ({
  page,
}) => {
  const p = await preview(page);
  const don = {
    ...ALERT_VARIANTS.don_moneytest,
    video: 'Raid Titan.webm',
    audio: null,
    tts: null,
  };
  const nameBox = page.locator('.don-name');
  const measure = () =>
    nameBox.evaluate((el: HTMLElement) => ({
      fits: el.scrollWidth <= el.clientWidth,
      size: parseFloat(getComputedStyle(el).fontSize),
      text: el.textContent,
    }));
  await p.seek(don, { pseudo: 'Bob', amount: '5', currency: 'EUR' }, 3000);
  expect(await measure()).toEqual({ fits: true, size: 46, text: 'Bob' });
  const long = 'Le Pigeon Voyageur Qui A Traversé Tout 🐦';
  await p.seek(don, { pseudo: long, amount: '19.99', currency: 'EUR' }, 3000);
  const m = await measure();
  expect(m.text).toBe(long);
  expect(m.fits).toBe(true);
  expect(m.size).toBeLessThan(46);
  expect(m.size).toBeGreaterThanOrEqual(12);
  // Its own line above the amount, the box stays inside the 1080 p frame.
  await expect(page.locator('.don-line-main')).toHaveClass(/don-stacked/);
  const box = await page
    .locator('.don-text-box')
    .evaluate((el) => el.getBoundingClientRect().bottom);
  expect(box).toBeLessThan(1080);
  // Short name: legacy line (name beside the amount).
  await p.seek(don, { pseudo: 'Bob', amount: '5' }, 3000);
  await expect(page.locator('.don-line-main')).not.toHaveClass(/don-stacked/);
  // Hostile name: shown as text, no element created from it.
  await p.seek(
    don,
    { pseudo: '<img src=x onerror=alert(1)>', amount: '1' },
    3000,
  );
  await expect(nameBox).toHaveText('<img src=x onerror=alert(1)>');
  expect(await page.locator('.don-name img').count()).toBe(0);
  await p.stop();
});
