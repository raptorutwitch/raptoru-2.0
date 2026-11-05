import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Parity of Bonk in the production Extension (mobile) → Lab EBS → Lab Core, with the Studio Bonk worker, the Lab Core's
// FICTIONAL 7TV/BTTV/FFZ providers and a FICTIONAL overlay (no OBS, nothing drawn): written BEFORE any extraction of
// Bonk from ui.js — the same expectations must hold after. No request leaves the machine (the providers' CDN images
// are served locally below, anything else is aborted and counted).

const PORT = Number(process.env.E2E_PORT ?? 4399);
const STUDIO = { id: 'studio', role: 'broadcaster', via: 'studio' };
const labCore = async (path: string, body?: unknown) => {
  const { url, secret } = JSON.parse(
    readFileSync(join(tmpdir(), `raptoru-e2e-core-${PORT}.json`), 'utf8'),
  ) as { url: string; secret: string };
  const r = await fetch(url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: r.status,
    body: (await r.json()) as Record<string, unknown>,
  };
};
const setTokens = async (tokens: number) =>
  expect(
    (
      await labCore('/v1/lab/wallet/900100', {
        actor: STUDIO,
        viewer_id: '900101',
        op: 'set',
        tokens,
      })
    ).status,
  ).toBe(200);
const tokens = async () =>
  ((await labCore('/v1/lab/wallet/900100/900101')).body as { tokens: number })
    .tokens;

async function isolatedPage(page: Page) {
  const outside: string[] = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    if (
      /^https:\/\/cdn\.(7tv\.app|betterttv\.net|frankerfacez\.com)\//.test(url)
    )
      return route.fulfill({
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#7c3aed"/></svg>',
        contentType: 'image/svg+xml',
      });
    outside.push(url);
    return route.abort();
  });
  return outside;
}
async function openBonk(page: Page) {
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page
    .getByRole('button', { name: /^Bonk/ })
    .filter({ visible: true })
    .first()
    .click();
}
const back = (page: Page) =>
  page.getByRole('button', { name: 'Retour au Hub' }).click();
const emote = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true }).first();
const ammo = (page: Page) =>
  page.getByRole('list', { name: 'Munitions chargées' }).getByRole('listitem');
const ammoOf = (page: Page, name: string) =>
  page
    .getByRole('list', { name: 'Munitions chargées' })
    .getByRole('listitem', { name: new RegExp(`^${name} ·`) });
const cta = (page: Page) => page.locator('[data-bkc="cta"]');
/** The Bonk's own message slot (its last outcome). */
const status = (page: Page) => page.locator('.jdm-bonk-feedback');
const count = (page: Page) => page.locator('[data-bkc-count]');

test('viewer: sources, search, multi-click magazine, manual shot, favourite, Auto salve and reload, leave and come back', async ({
  browser,
}) => {
  await setTokens(10_000);
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  const outside = await isolatedPage(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/ext/mobile.html?labRole=viewer');
  await openBonk(page);
  await expect(page.locator('.rl-bonk-picker')).toHaveCount(1);
  // First visit: the tutorial, skippable.
  await page.getByRole('button', { name: 'Passer' }).click();
  // Every source of the channel (fictional 7TV / BTTV / FFZ through Lab Core) and the Unicode emoji.
  for (const name of [
    'PepoFictif',
    'CatJamFictif',
    'ClapFictif',
    'BttvFictif',
    'FfzFictif',
    'grinning face',
  ])
    await expect(emote(page, name)).toBeVisible();
  // Search narrows to the matching emotes, clearing restores.
  const search = page.getByRole('searchbox', { name: 'Emote ou chaîne…' });
  await search.fill('Fictif');
  await expect(emote(page, 'grinning face')).toHaveCount(0);
  await expect(emote(page, 'BttvFictif')).toBeVisible();
  await search.fill('');
  await expect(emote(page, 'grinning face')).toBeVisible();

  // Multi-click: each click is one more Bonk in the magazine (counts per emote, never a purchase by itself).
  await emote(page, 'PepoFictif').click();
  await emote(page, 'PepoFictif').click();
  await emote(page, 'grinning face').click();
  await expect(ammoOf(page, 'PepoFictif')).toHaveText('2');
  await expect(ammoOf(page, 'grinning face')).toHaveText('1');
  await expect(count(page)).toHaveText('3/3');
  expect(await tokens()).toBe(10_000);
  // A click on a loaded Bonk takes one back.
  await ammoOf(page, 'grinning face').click();
  await expect(ammoOf(page, 'grinning face')).toHaveCount(0);
  await expect(count(page)).toHaveText('2/2');

  // Manual: one shot, debited once by Core, the magazine goes down by one.
  await expect(cta(page)).toBeEnabled({ timeout: 15_000 }); // the (fictional) overlay is ready
  await expect(cta(page)).toHaveAttribute(
    'aria-label',
    /^Tirer 1 Bonk · ◆ 200/,
  );
  await cta(page).click();
  await expect(status(page)).toContainText('Bonk accepté', { timeout: 15_000 });
  await expect(count(page)).toHaveText('1/2');
  await expect.poll(tokens).toBe(9_800);

  // Favourite (keyboard F on the emote, as the star is armed only after a pause): its own section.
  await emote(page, 'PepoFictif').focus();
  await page.keyboard.press('f');
  await expect(page.getByRole('button', { name: /^Favoris 1/ })).toBeVisible();

  // Auto: speed, one salve for the rest of the magazine, then the magazine reloads (free).
  await page.getByRole('switch', { name: 'Manuel Auto' }).click();
  await expect(page.getByRole('switch', { name: 'Manuel Auto' })).toBeChecked();
  const speed = page.getByRole('button', { name: /^Vitesse/ });
  await expect(speed).toHaveAttribute('aria-label', /Moyen \(2\/4\)/);
  await speed.click();
  await expect(speed).toHaveAttribute('aria-label', /Rapide \(3\/4\)/);
  await expect(cta(page)).toHaveAttribute(
    'aria-label',
    /^Envoyer les 1 Bonk restants d’affilée · ◆ 200/,
  );
  await cta(page).click();
  await expect(status(page)).toContainText('Salve ×1 acceptée', {
    timeout: 15_000,
  });
  await expect.poll(tokens).toBe(9_600);
  // The magazine reloads by itself after a salve (free): the whole loadout is offered again.
  await expect(cta(page)).toHaveAttribute(
    'aria-label',
    /^Envoyer les 2 Bonk restants d’affilée · ◆ 400/,
  );
  await expect(count(page)).toHaveText('2/2');
  expect(await tokens()).toBe(9_600); // a reload is free

  // Empty the magazine.
  await page
    .getByRole('button', { name: 'Vider toutes les munitions' })
    .click();
  await expect(ammo(page)).toHaveCount(0);

  // Leave, another module, come back: one picker; recents (every emote loaded: 2), favourite and speed kept; the magazine and the mode are
  // reset on leaving (bonkChargeur.reset), the tutorial is not shown again.
  await emote(page, 'PepoFictif').click();
  await back(page);
  await expect(page.locator('.rl-bonk-picker')).toHaveCount(0);
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page
    .getByRole('button', { name: /^Commandes$/ })
    .filter({ visible: true })
    .first()
    .click();
  await back(page);
  await openBonk(page);
  await expect(page.locator('.rl-bonk-picker')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Récents 2/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Favoris 1/ })).toBeVisible();
  await expect(ammo(page)).toHaveCount(0);
  await expect(
    page.getByRole('switch', { name: 'Manuel Auto' }),
  ).not.toBeChecked();
  await expect(page.getByRole('button', { name: /^Vitesse/ })).toHaveAttribute(
    'aria-label',
    /Rapide \(3\/4\)/,
  );
  await expect(page.getByRole('button', { name: 'Passer' })).toHaveCount(0);
  // The last outcome belongs to the previous visit: not shown again on return.
  await expect(status(page)).toHaveText('');
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
  await page.close();
});

test('viewer without enough Jetons: Core refuses, said in words, magazine and balance kept', async ({
  browser,
}) => {
  await setTokens(100);
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  const outside = await isolatedPage(page);
  await page.goto('/ext/mobile.html?labRole=viewer');
  await openBonk(page);
  await page.getByRole('button', { name: 'Passer' }).click();
  await emote(page, 'PepoFictif').click();
  await expect(cta(page)).toBeEnabled({ timeout: 15_000 });
  await cta(page).click();
  await expect(status(page)).toContainText('Pas assez de jetons', {
    timeout: 15_000,
  });
  await expect(ammoOf(page, 'PepoFictif')).toHaveText('1');
  expect(await tokens()).toBe(100);
  expect(outside).toEqual([]);
  await page.close();
});

for (const role of ['moderator', 'broadcaster'] as const) {
  test(`${role}: Bonk draws (picker, magazine), Hub and back, no page error`, async ({
    browser,
  }) => {
    const page = await browser.newPage({
      viewport: { width: 400, height: 800 },
    });
    const outside = await isolatedPage(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`/ext/mobile.html?labRole=${role}`);
    await openBonk(page);
    // First visit: the tutorial opens (a modal), skipped as a viewer would.
    await page.getByRole('button', { name: 'Passer' }).click();
    await expect(page.locator('.rl-bonk-picker')).toHaveCount(1);
    await expect(page.locator('[data-bkc="cta"]')).toHaveCount(1);
    await back(page);
    await openBonk(page);
    await expect(page.locator('.rl-bonk-picker')).toHaveCount(1);
    expect(errors).toEqual([]);
    expect(outside).toEqual([]);
    await page.close();
  });
}
