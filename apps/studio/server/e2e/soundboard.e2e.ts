import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Parity of the Soundboard in the production Extension (mobile) → Lab EBS → Lab Core, with the Studio sound worker and a
// FICTIONAL player (no page, never any sound): written BEFORE its extraction from ui.js — the same expectations must hold
// after. Every role. Fictional data.

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

async function openModule(page: Page, tile: RegExp) {
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page
    .getByRole('button', { name: tile })
    .filter({ visible: true })
    .first()
    .click();
}
const back = (page: Page) =>
  page.getByRole('button', { name: 'Retour au Hub' }).click();
const grid = (page: Page) => page.locator('.jdm-module__body .sbx-grid');
const cards = (page: Page) =>
  page.locator('.jdm-module__body .sbx-card:visible');
/** Deterministic readiness: the player reported in (the status is in the DOM, hidden on mobile by design). */
const ready = (page: Page) =>
  expect(page.locator('.sbx-status.is-online')).toBeAttached({
    timeout: 20_000,
  });

test('viewer: search, favourite, preview, buy once (debit, recents), leave and come back without reloading', async ({
  browser,
}) => {
  expect(
    (
      await labCore('/v1/lab/wallet/900100', {
        actor: STUDIO,
        viewer_id: '900101',
        op: 'set',
        tokens: 20_000,
      })
    ).status,
  ).toBe(200);
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/ext/mobile.html?labRole=viewer');
  await openModule(page, /^Soundboard|^Sons/);
  await ready(page);
  await expect(grid(page)).toHaveCount(1);
  const all = await cards(page).count();
  expect(all).toBeGreaterThan(5);
  // Search narrows, clearing restores.
  await page
    .getByRole('searchbox', { name: 'Rechercher un son' })
    .or(page.locator('.sbx-search input'))
    .first()
    .fill('boop');
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Effacer la recherche' }).click();
  await expect(cards(page)).toHaveCount(all);
  // Favourite: the filter counts it and shows it alone.
  await page.getByRole('button', { name: 'Ajouter Boop aux favoris' }).click();
  await expect(page.locator('[data-view="favorites"]')).toContainText('1');
  await page.locator('[data-view="favorites"]').click();
  await expect(cards(page)).toHaveCount(1);
  await page.locator('[data-view="all"]').click();
  // Local preview: the button answers (never a viewer purchase).
  await page.getByRole('button', { name: 'Écouter Boop' }).click();
  // Buy: select, send; the balance goes down once and the sound is in the recents.
  await page.getByRole('button', { name: 'Sélectionner Boop' }).click();
  const send = page
    .locator('.sbx-dock')
    .getByRole('button', { name: /^Envoyer/ });
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  await expect(page.locator('[data-view="recents"]')).toContainText('1', {
    timeout: 15_000,
  });
  await expect
    .poll(async () => {
      const w = await labCore('/v1/lab/wallet/900100/900101');
      return (w.body as { tokens?: number }).tokens;
    })
    .toBeLessThan(20_000);
  // Leave, another module, come back: one grid, the favourite and the recent kept.
  await back(page);
  await expect(grid(page)).toHaveCount(0);
  await openModule(page, /^Commandes$/);
  await back(page);
  await openModule(page, /^Soundboard|^Sons/);
  await expect(grid(page)).toHaveCount(1);
  await expect(page.locator('[data-view="favorites"]')).toContainText('1');
  await expect(page.locator('[data-view="recents"]')).toContainText('1');
  expect(errors).toEqual([]);
  await page.close();
});

for (const role of ['moderator', 'broadcaster'] as const) {
  test(`${role}: the Soundboard draws (one grid, player status, sounds), Hub and back, no page error`, async ({
    browser,
  }) => {
    const page = await browser.newPage({
      viewport: { width: 400, height: 800 },
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`/ext/mobile.html?labRole=${role}`);
    await openModule(page, /^Soundboard|^Sons/);
    await ready(page);
    await expect(grid(page)).toHaveCount(1);
    expect(await cards(page).count()).toBeGreaterThan(5);
    await back(page);
    await openModule(page, /^Soundboard|^Sons/);
    await expect(grid(page)).toHaveCount(1);
    expect(errors).toEqual([]);
    await page.close();
  });
}
