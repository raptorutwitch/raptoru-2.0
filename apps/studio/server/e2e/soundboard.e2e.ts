import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { isolate } from './isolation.js';

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
  // Local preview: never a purchase; muted by default (Twitch), it says how to hear it.
  await page.getByRole('button', { name: 'Écouter Boop' }).click();
  await expect(page.locator('.jdm-module__body')).toContainText(
    'Monte le volume des aperçus',
  );
  // Buy: select, send; the balance goes down once and the sound is in the recents.
  await page.getByRole('button', { name: 'Sélectionner Boop' }).click();
  const send = page
    .locator('.sbx-dock')
    .getByRole('button', { name: /^Envoyer/ });
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  // Post-purchase feedback: a polite status toast, gone by itself (it never stays over the grid).
  const toast = page
    .getByRole('status')
    .filter({ hasText: 'Envoyé au stream' });
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
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

test('viewer: volume popover (kept across a new state, Escape closes it), Escape clears the search, a click beside the cards deselects, a drag holds a new state until the drop', async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/ext/mobile.html?labRole=viewer');
  await openModule(page, /^Soundboard|^Sons/);
  await ready(page);
  const nextState = () =>
    page.waitForResponse(
      (r) => new URL(r.url()).pathname.endsWith('/api/state'),
      { timeout: 30_000 },
    );
  let tokens = 21_000;
  const changeBalance = () =>
    labCore('/v1/lab/wallet/900100', {
      actor: STUDIO,
      viewer_id: '900101',
      op: 'set',
      tokens: (tokens += 7),
    });

  // A marker on the grid element: a host redraw (new state) replaces it.
  const markGrid = () =>
    page.evaluate(() => {
      (window as unknown as { __grid: Element | null }).__grid =
        document.querySelector('.jdm-module__body .sbx-grid');
    });
  const gridAlive = () =>
    page.evaluate(() => {
      const g = (window as unknown as { __grid: Element | null }).__grid;
      return !!g && document.contains(g);
    });

  // Volume: opened from the header, still open after a redraw (new balance), Escape closes it.
  await page
    .getByRole('button', { name: 'Régler le volume des aperçus' })
    .click();
  await expect(page.locator('.sbx-vol.is-open')).toHaveCount(1);
  // Its controls answer a mouse click (the popover must not close under the pointer).
  await page.locator('.sbx-vol__mute').click();
  await expect(page.locator('.sbx-vol.is-open')).toHaveCount(1);
  await expect(page.locator('.sbx-vol__value')).toHaveText(/60/);
  await page.locator('.sbx-vol__mute').click();
  await expect(page.locator('.sbx-vol__value')).toHaveText('Muet');
  await markGrid();
  await changeBalance();
  await expect.poll(gridAlive, { timeout: 20_000 }).toBe(false); // redrawn
  await expect(page.locator('.sbx-vol.is-open')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sbx-vol.is-open')).toHaveCount(0);

  // Escape clears the search.
  const all = await cards(page).count();
  const search = page.locator('.sbx-search input').first();
  await search.fill('boop');
  await expect(cards(page)).toHaveCount(1);
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(cards(page)).toHaveCount(all);

  // A click in the module beside the cards deselects.
  await page.getByRole('button', { name: 'Sélectionner Boop' }).click();
  await expect(page.locator('.sbx-card.is-selected')).toHaveCount(1);
  await grid(page).click({ position: { x: 2, y: 2 } });
  await expect(page.locator('.sbx-card.is-selected')).toHaveCount(0);

  // Drag (long press on a card): a new state during the gesture never rebuilds the grid under the pointer.
  await markGrid();
  const first = cards(page).nth(0);
  const firstId = await first.getAttribute('data-sound-id');
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(grid(page)).toHaveClass(/is-dragging/); // the long press began the drag
  // The host's reads are sequential (the next one is scheduled after the previous state was applied): once the read
  // AFTER the one carrying the new balance has arrived, that state has reached the page for sure.
  const expected = String(tokens + 7); // the balance changeBalance() is about to set
  const carrying = page.waitForResponse(
    async (r) =>
      new URL(r.url()).pathname.endsWith('/api/state') &&
      JSON.stringify(await r.json().catch(() => null)).includes(expected),
    { timeout: 30_000 },
  );
  await changeBalance();
  await carrying;
  await nextState();
  expect(await gridAlive()).toBe(true); // held: same grid, still dragging
  await expect(grid(page)).toHaveClass(/is-dragging/);
  const shown = (n: number) =>
    page.getByRole('button', {
      name: new RegExp(
        `Jetons · ${String(n).replace(/(\d)(?=(\d{3})+$)/g, '$1.?')} jetons`,
      ),
    });
  await expect(shown(tokens)).toHaveCount(0); // the new balance waits for the drop
  const target = (await cards(page).nth(2).boundingBox())!;
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    {
      steps: 8,
    },
  );
  await page.mouse.up();
  // Dropped: the order changed, then the held state is drawn (a new grid).
  await expect(cards(page).nth(0)).not.toHaveAttribute(
    'data-sound-id',
    firstId!,
  );
  await expect.poll(gridAlive, { timeout: 10_000 }).toBe(false);
  await expect(shown(tokens).first()).toBeAttached(); // …and shows once the card is dropped
  await expect(grid(page)).toHaveCount(1);
  expect(errors).toEqual([]);
  await page.close();
});

test('viewer: pay with a Soundboard credit (dock and header follow the choice, one credit used, Jetons untouched); sort, filter, selection and currency kept across visits', async ({
  browser,
}) => {
  expect(
    (
      await labCore('/v1/lab/wallet/900100', {
        actor: STUDIO,
        viewer_id: '900101',
        op: 'set',
        tokens: 20_000,
        credits_soundboard: 2,
      })
    ).status,
  ).toBe(200);
  const wallet = async () =>
    (await labCore('/v1/lab/wallet/900100/900101')).body as {
      tokens: number;
      credits_soundboard: number;
    };
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  const { outside } = await isolate(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/ext/mobile.html?labRole=viewer');
  await openModule(page, /^Soundboard|^Sons/);
  await ready(page);
  const bar = page.locator('.sbx-bar');
  await page.getByRole('button', { name: 'Sélectionner Boop' }).click();
  await expect(bar).toHaveAttribute('data-method', 'tokens');
  await expect(page.locator('.sbx-price__unit')).toHaveText('jetons');
  // The dock's switch: credits; the header's switch follows.
  await page.locator('.sbx-wallet .rl-cswitch__chip').click();
  await expect(bar).toHaveAttribute('data-method', 'credits');
  await expect(page.locator('.rl-cswitch--header')).toHaveAttribute(
    'data-method',
    'credits',
  );
  await expect(page.locator('.sbx-price__unit')).toHaveText('crédit');
  const send = page
    .locator('.sbx-dock')
    .getByRole('button', { name: /^Envoyer/ });
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Envoyé au stream' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await wallet()).credits_soundboard).toBe(1);
  expect((await wallet()).tokens).toBe(20_000);

  // Sort « A → Z », the « Récents » filter, a selection: kept when the viewer comes back.
  await page.getByRole('button', { name: 'Trier le catalogue' }).click();
  await page.getByRole('menuitemradio', { name: 'A → Z' }).click();
  await expect(
    page.locator('.sbx-menu__item[data-sort="alpha"]'),
  ).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-view="recents"]').click();
  await page.getByRole('button', { name: 'Sélectionner Boop' }).click();
  await expect(page.locator('.sbx-card.is-selected')).toHaveCount(1);
  await back(page);
  await openModule(page, /^Commandes$/);
  await back(page);
  await openModule(page, /^Soundboard|^Sons/);
  await expect(
    page.locator('.sbx-menu__item[data-sort="alpha"]'),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-view="recents"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.sbx-card.is-selected')).toHaveAttribute(
    'data-sound-id',
    /boop/i,
  );
  await expect(bar).toHaveAttribute('data-method', 'credits');
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
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

test('an Escape the Soundboard uses (volume, search) stays in the panel; the page still gets the other ones (the Video Overlay closes its drawer on a page Escape)', async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  const { outside } = await isolate(page);
  await page.goto('/ext/mobile.html?labRole=viewer');
  // What overlay.js does: a page-level Escape listener.
  await page.evaluate(() => {
    (window as unknown as { __pageEscapes: number }).__pageEscapes = 0;
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape')
        (window as unknown as { __pageEscapes: number }).__pageEscapes += 1;
    });
  });
  const pageEscapes = () =>
    page.evaluate(
      () => (window as unknown as { __pageEscapes: number }).__pageEscapes,
    );
  await openModule(page, /^Soundboard|^Sons/);
  await ready(page);
  await page
    .getByRole('button', { name: 'Régler le volume des aperçus' })
    .click();
  await expect(page.locator('.sbx-vol.is-open')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sbx-vol.is-open')).toHaveCount(0);
  await page.locator('.sbx-search input').first().fill('boop');
  await expect(cards(page)).toHaveCount(1);
  // Focus on a control of the panel, off the field (a card, not selected).
  await page.getByRole('button', { name: 'Sélectionner Boop' }).focus();
  await page.keyboard.press('Escape');
  await expect(cards(page)).not.toHaveCount(1); // the search was cleared
  expect(await pageEscapes()).toBe(0); // neither Escape left the panel
  // Back on the Hub, nothing of the Soundboard listens any more: an Escape reaches the page, as before.
  await back(page);
  await page.getByRole('button', { name: 'Voir tous les modules' }).focus();
  await page.keyboard.press('Escape');
  await expect.poll(pageEscapes).toBe(1);
  expect(outside).toEqual([]);
  await page.close();
});
