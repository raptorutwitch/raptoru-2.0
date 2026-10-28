import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import { HalloweenRuntime } from '../src/halloween/runtime.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';

// Halloween (docs/HALLOWEEN.md) — the whole chain in Chromium, with nothing simulated but the media: the REAL Lab Core
// (in-memory PGlite) sells, the REAL Studio runtime claims and hands over, the REAL overlay page plays (a 1 s VP9 media
// with sound from test/fixtures) and reports; the Core ends the purchase. No Twitch, no OBS, no real Jeton or Bonbon.

const here = dirname(fileURLToPath(import.meta.url));
const CH = '900100';
const PORT = Number(process.env.E2E_HALLOWEEN_PORT ?? 4396);
const origin = `http://127.0.0.1:${PORT}`;
const VIEWER = { id: '910001', display_name: 'Ana' };

let core: Server;
let studio: Server;
let rt: HalloweenRuntime;
let dir = '';
let coreCall: ReturnType<typeof localLabCoreClient>;
let closeDb: () => Promise<void>;

test.describe.configure({ mode: 'serial' });
test.use({
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
});

test.beforeAll(async () => {
  const pg = new PGlite();
  const db = createPgliteDb(pg);
  closeDb = () => pg.close();
  await migrate(db, 'lab');
  const secret = randomBytes(32).toString('hex');
  core = createLabCore({ db, clock: systemClock, secret }).server;
  await new Promise<void>((r) => core.listen(0, '127.0.0.1', r));
  coreCall = localLabCoreClient(
    `http://127.0.0.1:${(core.address() as AddressInfo).port}`,
    secret,
  );
  // Studio's media: one short screamer (a fixture with sound) under a media id of the catalogue.
  dir = await mkdtemp(join(tmpdir(), 'halloween-e2e-'));
  await mkdir(join(dir, 'media'), { recursive: true });
  await copyFile(
    join(here, '..', 'test', 'fixtures', 'alerts', 'video-1s-sound.webm'),
    join(dir, 'media', 'foxy.webm'),
  );
  await writeFile(
    join(dir, 'media', 'manifest.json'),
    JSON.stringify({
      media: [
        {
          id: 'foxy',
          label: 'Foxy',
          kind: 'screamer',
          file: 'foxy.webm',
          duration_ms: 1000,
          width: 64,
          height: 36,
          alpha: true,
          audio: true,
        },
      ],
    }),
  );
  rt = new HalloweenRuntime({
    origin,
    dir,
    pageDir: join(here, '..', 'halloween-overlay'),
    core: coreCall,
    environment: 'lab',
    channelId: CH,
    studioId: 'studio-e2e',
    fromMain: () => false,
  });
  await rt.start();
  studio = createServer(async (req, res) => {
    const url = new URL(req.url!, origin);
    if (!(await rt.handle(req, res, url))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => studio.listen(PORT, '127.0.0.1', r));
  // The shop: open, short limits for the test, Bonbons for Ana (a Studio grant).
  await coreCall(`/v1/lab/events/channels/${CH}/settings`, {
    enabled: true,
    rules: { viewer_gap_ms: 0, screamer_gap_ms: 0 },
  });
  await coreCall('/v1/lab/events/grant', {
    idempotency_key: randomUUID(),
    channel_id: CH,
    viewer: VIEWER.id,
    amount: 30,
    reason: 'grant',
  });
});

test.afterAll(async () => {
  rt?.stop();
  await new Promise((r) => studio?.close(r));
  studio?.closeAllConnections();
  await new Promise((r) => core?.close(r));
  core?.closeAllConnections();
  await closeDb?.();
  await rm(dir, { recursive: true, force: true });
});

const admin = () =>
  coreCall<{
    purchases: {
      item_id: string;
      status: string;
      refund_status: string;
      error: string | null;
    }[];
  }>(`/v1/lab/events/channels/${CH}/admin`);
const buy = (item_id: string) =>
  coreCall<{ purchase: { status: string }; balance: number }>(
    '/v1/lab/events/purchase',
    {
      idempotency_key: randomUUID(),
      channel_id: CH,
      viewer: VIEWER,
      item_id,
    },
  );
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return (e as Error).message;
  }
};
const openOverlay = async (page: Page) => {
  await page.goto(rt.overlayUrl());
  // The page polls, Studio heartbeats « ready » to the Core.
  await expect.poll(() => rt.ready, { timeout: 10_000 }).toBe(true);
  await expect
    .poll(
      async () =>
        (
          await coreCall<{ engine_ready: boolean }>(
            `/v1/lab/events/channels/${CH}/state`,
          )
        ).engine_ready,
      {
        timeout: 10_000,
      },
    )
    .toBe(true);
};

test('no overlay: nothing is sold (no Bonbon spent for nothing)', async () => {
  expect(await refusal(buy('blink'))).toBe('engine_offline');
});

test('a screamer bought: claimed, played with its sound on the overlay page, ended in the Core, Bonbons debited once', async ({
  page,
}) => {
  const played: string[] = [];
  await page.exposeFunction('noteMedia', (src: string) => played.push(src));
  await page.addInitScript(() => {
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as unknown as { noteMedia: (s: string) => void }).noteMedia(
        this.currentSrc || this.src,
      );
      return orig.call(this);
    };
  });
  await openOverlay(page);
  const r = await buy('s-foxy');
  expect(r).toMatchObject({ balance: 20, purchase: { status: 'queued' } });
  await expect
    .poll(async () => (await admin()).purchases[0]?.status, { timeout: 15_000 })
    .toBe('completed');
  expect(played.some((s) => s.includes('/halloween/media/foxy.webm'))).toBe(
    true,
  );
  expect((await admin()).purchases[0]).toMatchObject({
    refund_status: 'none',
    error: null,
  });
  // Back to empty: nothing stays on the screen.
  await expect
    .poll(() =>
      page.evaluate(() => document.getElementById('stage')!.children.length),
    )
    .toBe(0);
});

test('a drawn effect (blink) plays and ends; the next purchase waits for nothing (one at a time)', async ({
  page,
}) => {
  await openOverlay(page);
  await buy('blink');
  // While it plays, another purchase is refused (no queue).
  expect(await refusal(buy('fog'))).toBe('busy');
  await expect
    .poll(async () => (await admin()).purchases[0]?.status, { timeout: 15_000 })
    .toBe('completed');
});

test('STOP ALL during a play: the page is emptied at once; the Core ends it as stopped, no refund for what was seen', async ({
  page,
}) => {
  await openOverlay(page);
  await buy('fog');
  await expect
    .poll(async () => (await admin()).purchases[0]?.status, { timeout: 10_000 })
    .toBe('executing');
  await rt.stopAll();
  await expect
    .poll(() =>
      page.evaluate(() => document.getElementById('stage')!.children.length),
    )
    .toBe(0);
  const p = (await admin()).purchases[0]!;
  expect(p.status).toBe('failed');
  expect(p.error).toBe('stopped');
  expect(p.refund_status).toBe('none');
});

test('the overlay page closed: Studio stops saying « ready » and the Core stops selling', async ({
  page,
}) => {
  await openOverlay(page);
  await page.close();
  await expect.poll(() => rt.ready, { timeout: 20_000 }).toBe(false);
  await expect
    .poll(async () => refusal(buy('eyes')), { timeout: 20_000 })
    .toBe('engine_offline');
});

test('OBS dock: the purchase shows only 5 s after its effect really started — never before', async ({
  page,
}) => {
  await rt.stopAll(); // what an earlier test left pending
  await openOverlay(page);
  await buy('tunnel');
  const tunnelShown = async () =>
    (
      await coreCall<{
        activities: {
          type: string;
          data: { actor: { name: string }; effect?: { id: string } };
        }[];
      }>(`/v1/lab/dock/${CH}/activity?limit=50`)
    ).activities.some(
      (a) =>
        a.type === 'halloween' &&
        a.data.effect?.id === 'tunnel' &&
        a.data.actor.name === 'Ana',
    );
  // Its effect starts on the page (the Core knows it): from then on, the dock must wait ~5 s.
  await expect
    .poll(async () => (await admin()).purchases[0]?.status, { timeout: 10_000 })
    .toBe('executing');
  const started = Date.now();
  expect(await tunnelShown()).toBe(false);
  // The dock keeps reading (its projector scans while read): the line appears after the delay.
  await expect
    .poll(tunnelShown, { timeout: 15_000, intervals: [250] })
    .toBe(true);
  expect(Date.now() - started).toBeGreaterThanOrEqual(4_000);
});
