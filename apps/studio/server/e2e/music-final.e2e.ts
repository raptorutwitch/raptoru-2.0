import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Music Hub — final pass (docs/music/MUSIC_HUB_STATE.md § 14), end to end on the Lab stack (simulated Spotify, Lab
// Jetons, no Twitch): the supermods' Pause / Passer right on « en cours », the seek on the timeline (asked, then sent),
// a viewer's PAID skip (25 000 → 50 000, Core's price shown before the confirmation, Jetons debited once), the Open Bar
// (free requests, back to the price at its closing) from Studio's Spotify page. Captures for the visual check.

const H = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };
const SHOTS = resolve(
  process.cwd(),
  '../../../.lab-data/music-hub-captures/final',
);
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(SHOTS, `${name}.png`) });

interface Rules {
  viewer_skip: {
    price: number;
    recent?: { status: string; price: number }[];
  };
  open_bar: { on: boolean };
}

async function api<T>(page: Page, path: string, body?: object) {
  const r = await page.request.fetch(`/api/spotify${path}`, {
    method: body ? 'POST' : 'GET',
    headers: H,
    ...(body ? { data: body } : {}),
  });
  expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBe(true);
  return (await r.json()) as T;
}
const tokens = async (page: Page, id: string) =>
  (
    (await (
      await page.request.get(`/api/lab/wallet/${id}`, { headers: H })
    ).json()) as { tokens: number }
  ).tokens;

async function music(
  browser: Browser,
  role: 'viewer' | 'moderator' | 'supermod',
  width = 400,
) {
  const page = await browser.newPage({ viewport: { width, height: 860 } });
  await page.goto(`/ext/mobile.html?shell=v2&labRole=${role}`);
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Musique/ }).click();
  await expect(page.locator('.mh')).toHaveCount(1);
  await expect(page.locator('.mh-now')).toBeVisible({ timeout: 20_000 });
  return page;
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await api(page, '/music-rules', {
    viewer_skip_enabled: false,
    open_bar: false,
  });
  await api(page, '/settings', {
    extension_enabled: false,
    player_controls: false,
  });
  await page.close();
});

test('Music Hub final pass: direct player controls, a confirmed seek, the paid skip (25 000 → 50 000), the Open Bar', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const admin = await browser.newPage();
  await api(admin, '/settings', {
    enabled: true,
    extension_enabled: true,
    player_controls: true,
  });
  await api(admin, '/music-rules', { viewer_skip_enabled: true });
  // A simulated live (the stream history follows it), a fresh track started during it, its exact track read.
  const raffle = (action: string) =>
    admin.request.post('/api/raffle/actions', {
      headers: H,
      data: { command: { action } },
    });
  await raffle('stream_end');
  await raffle('stream_start');
  await admin.request.post('/api/spotify/sim/skip', { headers: H, data: {} });
  await expect
    .poll(
      async () =>
        !!(await api<{ live: { link: unknown } | null }>(admin, '/live')).live
          ?.link,
      { timeout: 20_000 },
    )
    .toBe(true);

  // The supermod: Pause / Passer on the « en cours » row itself, no hidden panel.
  const sup = await music(browser, 'supermod');
  const now = sup.locator('.mh-now');
  await expect(now.locator('[data-act="pause"]')).toBeVisible();
  await expect(now.locator('[data-act="skip"]')).toBeVisible();
  await expect(now.locator('.mh-ico--paid')).toHaveCount(0); // its own skip is the free one
  await shot(sup, 'ext-supermod-controls');
  await now.locator('[data-act="pause"]').click();
  await expect(sup.locator('.mh-now.is-paused')).toBeVisible({
    timeout: 20_000,
  });
  await expect(sup.locator('.mh-toast')).toContainText('pause', {
    timeout: 20_000,
  });
  await sup.locator('.mh-now [data-act="resume"]').click();
  await expect(sup.locator('.mh-now:not(.is-paused)')).toBeVisible({
    timeout: 20_000,
  });

  // The timeline: a click asks where to go; nothing is sent before « Aller »; a seek is never a new track.
  const title = await sup.locator('.mh-now .mh-tx b').textContent();
  const bar = sup.locator('.mh-prog.is-seek');
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  await sup.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await expect(sup.locator('.mh-seek')).toContainText('Aller à');
  await shot(sup, 'ext-seek-confirm');
  await sup.locator('[data-act="seek-cancel"]').click();
  await expect(sup.locator('.mh-seek')).toHaveCount(0);
  await sup.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await sup.locator('[data-act="seek-go"]').click();
  await expect(sup.locator('.mh-toast')).toContainText('Lecture déplacée', {
    timeout: 20_000,
  });
  await expect(sup.locator('.mh-now .mh-tx b')).toHaveText(title!);

  // A moderator (not a supermod): no player buttons — the paid skip like any viewer.
  const mod = await music(browser, 'moderator');
  await expect(mod.locator('.mh-now [data-act="pause"]')).toHaveCount(0);
  await expect(mod.locator('.mh-now .mh-ico--paid')).toHaveCount(1);
  await mod.close();

  // A viewer pays to skip: the price before the confirmation, debited once, the next price doubled.
  await admin.request.post('/api/lab/wallet', {
    headers: H,
    data: { viewer_id: '900101', op: 'adjust', tokens: 200_000 },
  });
  const viewer = await music(browser, 'viewer');
  const before = await tokens(admin, '900101');
  const skipTitle = await viewer.locator('.mh-now .mh-tx b').textContent();
  await viewer.locator('.mh-now .mh-ico--paid').click();
  const dialog = viewer.locator('.mh-dialog');
  await expect(dialog).toContainText('◆ 25 000 Jetons');
  await expect(dialog).toContainText('Le prix double');
  await shot(viewer, 'ext-paid-skip-confirm');
  await dialog.locator('[data-act="vskip-go"]').click();
  await expect(viewer.locator('.mh-toast')).toContainText('Musique passée', {
    timeout: 30_000,
  });
  await expect(viewer.locator('.mh-toast')).toContainText('50 000');
  expect(await tokens(admin, '900101')).toBe(before - 25_000);
  await expect(viewer.locator('.mh-now .mh-tx b')).not.toHaveText(skipTitle!, {
    timeout: 20_000,
  });
  const rules = await api<Rules>(admin, '/music-rules');
  expect(rules.viewer_skip.price).toBe(50_000);
  expect(rules.viewer_skip.recent?.[0]).toMatchObject({
    status: 'done',
    price: 25_000,
  });
  await viewer.locator('.mh-now .mh-ico--paid').click();
  await expect(viewer.locator('.mh-dialog')).toContainText('◆ 50 000 Jetons');
  await viewer.locator('.mh-dialog [data-act="keep"]').click();
  await expect(viewer.locator('.mh-dialog')).toHaveCount(0);
  // « Musiques de la soirée »: the paid skip marks the track « Skippé ».
  await viewer.locator('.mh-clock').click();
  await expect(
    viewer.locator('.mh-hrow', { hasText: skipTitle! }).first(),
  ).toContainText('Skippé', { timeout: 15_000 });
  await viewer.locator('.mh-back').click();

  // The Open Bar from Studio's Spotify page: the band says it, a request is free, the closing brings the price back.
  await admin.goto('/?p=spotify');
  const open = admin.locator('[data-act="sp-bar"]');
  await expect(open).toHaveText('Ouvrir l’Open Bar', { timeout: 15_000 });
  await shot(admin, 'studio-open-bar-closed');
  await open.click();
  await admin.getByRole('button', { name: 'Ouvrir l’Open Bar' }).last().click();
  await expect(admin.locator('.spo-bar.is-on')).toBeVisible({
    timeout: 15_000,
  });
  await shot(admin, 'studio-open-bar-open');
  await expect(viewer.locator('.mh-seg--bar')).toContainText('Open Bar', {
    timeout: 15_000,
  });
  await shot(viewer, 'ext-open-bar');
  // The free request by the supermod (900103), withdrawn by itself at the end: the Lab viewer keeps no delay nor notice
  // for the other specs.
  const asker = sup;
  const free = await tokens(admin, '900103');
  await asker
    .getByLabel('Rechercher un titre ou un artiste, ou coller un lien Spotify')
    .fill('velours');
  await asker.locator('.mh-hit', { hasText: 'Velours' }).first().click();
  await expect(asker.locator('.mh-buy [data-act="confirm"]')).toContainText(
    'gratuit',
  );
  await shot(asker, 'ext-open-bar-request');
  await asker.locator('.mh-buy [data-act="confirm"]').click();
  await expect(asker.locator('.mh-toast')).toContainText(/demand|file/i, {
    timeout: 15_000,
  });
  expect(await tokens(admin, '900103')).toBe(free);
  await admin.locator('[data-act="sp-bar"]').click();
  await expect(admin.locator('.spo-bar.is-on')).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(viewer.locator('.mh-seg--price')).toContainText('500', {
    timeout: 15_000,
  });

  // Clean first (the next specs share this Lab): the supermod withdraws its free request (nothing to refund, no notice).
  await sup.locator('[data-act="withdraw"]').first().click();
  await sup.locator('[data-act="confirm-withdraw"]').click();
  await expect(sup.locator('.mh-row', { hasText: 'Velours' })).toHaveCount(0, {
    timeout: 15_000,
  });

  // Studio's panel: the paid skip's switches and its last decisions (the panel redraws: the scroll is retried).
  await admin.getByRole('button', { name: /Réglages/ }).click();
  await expect(async () => {
    await admin
      .locator('[data-sp-rule="viewer_skip_enabled"]')
      .scrollIntoViewIfNeeded({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await expect(admin.locator('.spo-vs li').first()).toContainText('passée');
  await shot(admin, 'studio-panel-paid-skip');

  // The player's controls switched off in Studio: shown disabled, with the reason — never a fake « demandé ».
  await api(admin, '/settings', { player_controls: false });
  await expect(sup.locator('.mh-now [data-act="skip"]')).toBeDisabled({
    timeout: 15_000,
  });
  await expect(sup.locator('.mh-sup__why')).toContainText(
    'désactivées dans Studio',
  );
  await expect(sup.locator('.mh-prog.is-seek')).toHaveCount(0);
  await shot(sup, 'ext-supermod-disabled');

  await raffle('stream_end');
  await Promise.all([viewer.close(), sup.close(), admin.close()]);
});
