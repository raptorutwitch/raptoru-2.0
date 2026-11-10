import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Music Hub — what each role sees on « en cours », after the real-account test (10/11): the supermod / streamer get
// Pause (or Reprendre) and Passer right there, explicit icons and names, the volume behind a speaker (no ambiguous
// settings icon); a moderator gets no player button; a viewer gets the paid skip. Compact at every width (no
// horizontal scroll). The Lab serves the same extension files as the Hosted Test zip (shell v2). Captures in
// .lab-data/music-hub-captures/roles.

const H = { 'x-raptoru-studio': '1' };
const SHOTS = resolve(
  process.cwd(),
  '../../../.lab-data/music-hub-captures/roles',
);
mkdirSync(SHOTS, { recursive: true });

async function api(page: Page, path: string, body?: object) {
  const r = await page.request.fetch(`/api/spotify${path}`, {
    method: body ? 'POST' : 'GET',
    headers: H,
    ...(body ? { data: body } : {}),
  });
  expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBe(true);
}

async function music(browser: Browser, role: string, width: number) {
  const page = await browser.newPage({ viewport: { width, height: 760 } });
  await page.goto(`/ext/mobile.html?shell=v2&labRole=${role}`);
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Musique/ }).click();
  await expect(page.locator('.mh-now')).toBeVisible({ timeout: 20_000 });
  return page;
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await api(page, '/settings', {
    enabled: true,
    extension_enabled: true,
    player_controls: true,
  });
  await api(page, '/music-rules', { viewer_skip_enabled: true });
  await api(page, '/sim/app-open', {});
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await api(page, '/music-rules', { viewer_skip_enabled: false });
  await api(page, '/settings', {
    extension_enabled: false,
    player_controls: false,
  });
  await page.close();
});

for (const width of [318, 400, 565])
  test(`« en cours » per role at ${width} px: supermod Pause / Passer / Volume visible, moderator none, viewer the paid skip`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const sup = await music(browser, 'supermod', width);
    const now = sup.locator('.mh-now');
    const pp = now.getByRole('button', {
      name: /Mettre en pause|Reprendre la lecture/,
    });
    await expect(pp).toBeVisible();
    await expect(pp).toBeInViewport();
    await expect(
      now.getByRole('button', { name: 'Passer cette musique' }),
    ).toBeInViewport();
    const vol = now.getByRole('button', { name: 'Volume du lecteur' });
    await expect(vol).toBeInViewport();
    // An explicit speaker, never the settings sliders.
    expect(await vol.innerHTML()).not.toContain('circle');
    // The timeline is the seek (asked, then confirmed).
    await expect(now.locator('[data-act="seek-pick"]')).toBeVisible();
    await shot(sup, `supermod-${width}`);
    expect(await overflow(sup)).toBe(false);

    const mod = await music(browser, 'moderator', width);
    // A simple moderator: no free player button (pause, free skip, volume); like any viewer, the paid skip.
    await expect(
      mod.locator('.mh-now').getByRole('button', {
        name: /^(Mettre en pause|Reprendre la lecture|Passer cette musique|Volume du lecteur)$/,
      }),
    ).toHaveCount(0);
    await expect(mod.locator('.mh-now [data-act="vskip"]')).toBeInViewport();
    await shot(mod, `moderator-${width}`);
    expect(await overflow(mod)).toBe(false);

    const viewer = await music(browser, 'viewer', width);
    await expect(viewer.locator('.mh-now [data-act="vskip"]')).toBeInViewport();
    await expect(
      viewer
        .locator('.mh-now')
        .getByRole('button', { name: /Mettre en pause|Volume du lecteur/ }),
    ).toHaveCount(0);
    await shot(viewer, `viewer-${width}`);
    expect(await overflow(viewer)).toBe(false);
    for (const p of [sup, mod, viewer]) await p.close();
  });

const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(SHOTS, `${name}.png`) });
/** A horizontal scroll anywhere in the module (a row wider than the panel). */
const overflow = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('.mh, .mh *')].some(
        (e) =>
          e.scrollWidth > e.clientWidth + 1 &&
          getComputedStyle(e).overflowX !== 'hidden' &&
          getComputedStyle(e).overflowX !== 'clip' &&
          e.clientWidth > 0 &&
          ['auto', 'scroll'].includes(getComputedStyle(e).overflowX),
      ) ||
      document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
  );
