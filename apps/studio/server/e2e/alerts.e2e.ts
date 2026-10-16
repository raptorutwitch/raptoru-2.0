import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
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
    // MoneyTest.webm / Son Alerte Don.mp3 are left missing on purpose.
  ]);
  studio = studioServer();
  const port = await listen(studio);
  origin = `http://127.0.0.1:${port}`;
  rt = await AlertsRuntime.create({
    channelId: CH,
    core: localLabCoreClient(coreUrl, secret),
    origin,
    dir,
    playerDir: join(here, '..', 'alerts-player'),
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
});
