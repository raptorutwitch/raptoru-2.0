import { expect, test, type Browser, type Page } from '@playwright/test';

// Mission 11/11 — a Music Hub purchase in the moderation: listed (title, « Musique » filter), refunded once with the
// « Portefeuille » permission, locked without it; Studio's own moderation opens it. Its own file, run AFTER music-hub
// and music-live: it leaves a « retirée par la modération » notice on the Lab viewer that those specs count.

test.describe.configure({ mode: 'serial' });

async function openModeration(browser: Browser, role: string) {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.goto(`/ext/mobile.html?labRole=${role}`);
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Modération/ }).click();
  await expect(page.locator('.modv2')).toHaveCount(1);
  return page;
}

const H = { 'x-raptoru-studio': '1' };
async function spotify(page: Page, path: string, body?: object) {
  const r = await page.request.fetch(`/api/spotify${path}`, {
    method: body ? 'POST' : 'GET',
    headers: H,
    ...(body ? { data: body } : {}),
  });
  expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBe(true);
  return r.json();
}
const tokens = async (page: Page, id: string) =>
  (
    (await (
      await page.request.get(`/api/lab/wallet/${id}`, { headers: H })
    ).json()) as { tokens: number }
  ).tokens;
async function openMusic(browser: Browser, role: string) {
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  await page.goto(`/ext/mobile.html?shell=v2&labRole=${role}`);
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Musique/ }).click();
  await expect(page.locator('.mh')).toHaveCount(1);
  return page;
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await spotify(page, '/settings', {
    extension_enabled: false,
    viewer_cooldown_seconds: 600,
  });
  await page.close();
});

test('Music Hub purchase: in the history, « Rembourser » once (Portefeuille), the Jetons back; locked without the permission', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = await browser.newPage();
  await spotify(admin, '/settings', {
    enabled: true,
    extension_enabled: true,
    viewer_cooldown_seconds: 0,
  });
  // The viewer buys a song; a moderator removes it WITHOUT refund (the case Aouh had to fix by hand).
  const viewer = await openMusic(browser, 'viewer');
  await viewer
    .getByLabel('Rechercher un titre ou un artiste, ou coller un lien Spotify')
    .fill('tempete radio');
  const hit = viewer
    .locator('.mh-hit', { hasText: 'Tempête (Radio Edit)' })
    .first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();
  await viewer.locator('.mh-buy [data-act="confirm"]').click();
  const mod = await openMusic(browser, 'moderator');
  const row = mod.locator('.mh-row', { hasText: 'Tempête (Radio Edit)' });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.locator('[data-act="menu"]').click();
  await mod.getByRole('menuitem', { name: 'Retirer sans rembourser' }).click();
  await mod
    .getByRole('menuitem', { name: 'Confirmer : sans remboursement' })
    .click();
  await mod.close();
  await viewer.close();
  await expect
    .poll(async () => {
      const st = (await spotify(admin, '/state')) as {
        recent: {
          track?: { title?: string };
          refund_status?: string | null;
        }[];
      };
      return st.recent.find((r) => r.track?.title === 'Tempête (Radio Edit)')
        ?.refund_status;
    })
    .toBe('kept');
  const before = await tokens(admin, '900101');

  // A moderator WITHOUT « Portefeuille »: the purchase is there, the refund locked.
  const plain = await openModeration(browser, 'moderator');
  await plain.getByRole('button', { name: 'Historique' }).click();
  const line = plain.locator('[data-act="open-ix"]', { hasText: 'Tempête' });
  await expect(line.first()).toBeVisible({ timeout: 15_000 });
  await line.first().click();
  const sheetP = plain.locator('.sheet').last();
  await expect(sheetP).toContainText('Musique · Tempête (Radio Edit)', {
    timeout: 15_000,
  });
  await expect(
    sheetP.locator('[data-act="locked"]', { hasText: 'Rembourser' }),
  ).toBeVisible();
  await plain.close();

  // The broadcaster: Historique › the purchase › Rembourser — once.
  const page = await openModeration(browser, 'broadcaster');
  await page.getByRole('button', { name: 'Historique' }).click();
  // The « Musique » filter of the history: the Music Hub purchases only.
  await page.getByRole('button', { name: 'Musique', exact: true }).click();
  const item = page.locator('[data-act="open-ix"]', { hasText: 'Tempête' });
  await expect(item.first()).toBeVisible({ timeout: 15_000 });
  await item.first().click();
  const sheet = page.locator('.sheet').last();
  await expect(sheet).toContainText('Retirée par la modération', {
    timeout: 15_000,
  });
  await expect(sheet).toContainText('500 J');
  await sheet.locator('[data-act="refund"]').click();
  await expect(sheet).toContainText('Remboursé', { timeout: 15_000 });
  await expect(sheet.locator('[data-act="refund"]')).toHaveCount(0);
  expect(await tokens(admin, '900101')).toBe(before + 500);
  await page.screenshot({
    path: `${process.cwd()}/../../../.lab-data/tombola-captures/moderation-music-refunded.png`,
  });
  await page.close();
  await admin.close();
});

test('Studio › Modération › Historique: the Music Hub purchase is listed and opens without error', async ({
  browser,
}) => {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?p=moderation');
  const tab = page.locator('#tab-moderation');
  await tab.getByRole('button', { name: 'Historique' }).first().click();
  const row = tab.locator('.mj-r', { hasText: 'Tempête' }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('Musique');
  await row.click();
  await expect(
    page.getByText('Musique · Tempête (Radio Edit)').first(),
  ).toBeVisible({
    timeout: 15_000,
  });
  // Script errors only (the 0.1.29 crash was a TypeError on the unknown module); an unbuilt Lab asset is not one.
  const crashes = errors.filter((e) => !/dynamically imported module/.test(e));
  expect(crashes, crashes.join(' | ')).toEqual([]);
  await page.close();
});
