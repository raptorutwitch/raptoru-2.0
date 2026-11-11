import { expect, test, type Browser } from '@playwright/test';

// Post-live 11/11: « Portefeuille » in the extension's moderation (ex « Wallet admin ») — side link → viewer search
// (« @pseudo » accepted) → the viewer's sheet opened on their Portefeuille → credit. A moderator without the
// « Portefeuille » permission sees it locked (Core refuses anyway). Lab economy only.

async function openModeration(browser: Browser, role: string) {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.goto(`/ext/mobile.html?labRole=${role}`);
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Modération/ }).click();
  await expect(page.locator('.modv2')).toHaveCount(1);
  return page;
}

test('Portefeuille: side link, @pseudo search, the viewer sheet on their Portefeuille, a credit', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const page = await openModeration(browser, 'broadcaster');
  await page.getByRole('button', { name: 'Portefeuille', exact: true }).click();
  const drop = page.locator('.sdrop');
  await expect(drop.locator('.sdrop__label')).toHaveText('Portefeuille de…');
  await page.locator('[data-q]').fill('@viewer');
  const hit = drop.locator('[data-act="open-wallet"]').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();

  const sheet = page
    .locator('.sheet')
    .filter({ hasText: 'Portefeuille' })
    .last();
  await expect(sheet.getByRole('button', { name: '+ Créditer' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(sheet).toContainText(
    /Portefeuille de test du Lab|Jetons réels de la chaîne/,
  );
  await expect(sheet).not.toContainText('Wallet');
  const before = Number(
    (await sheet.locator('.wal b').first().innerText()).replace(/\D/g, ''),
  );

  await sheet.getByRole('button', { name: '+ Créditer' }).click();
  const dlg = page.locator('.dialog');
  await dlg.locator('[data-dlg="amount"]').fill('250');
  await dlg.locator('[data-dlg="reason"]').fill('e2e portefeuille');
  await dlg.getByRole('button', { name: 'Créditer' }).click();
  await expect
    .poll(
      async () =>
        Number(
          (await sheet.locator('.wal b').first().innerText()).replace(
            /\D/g,
            '',
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(before + 250);
  await page.close();
});

test('Portefeuille: locked for a moderator without the permission', async ({
  browser,
}) => {
  const page = await openModeration(browser, 'moderator');
  await page.getByRole('button', { name: 'Portefeuille', exact: true }).click();
  await page.locator('[data-q]').fill('viewer');
  const hit = page.locator('.sdrop [data-act="open-wallet"]').first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();
  const sheet = page
    .locator('.sheet')
    .filter({ hasText: 'Portefeuille' })
    .last();
  await expect(sheet).toContainText(
    'Réservé à la permission « Portefeuille ».',
    { timeout: 15_000 },
  );
  await expect(sheet.getByRole('button', { name: '+ Créditer' })).toHaveCount(
    0,
  );
  await page.close();
});
