import { expect, test, type Browser, type Page } from '@playwright/test';

// The modularity of the foundation, end to end on the main Core in its Lab environment: a module of the host is only its
// own file (Core) and its own view (extension). Studio's catalogue, page, search and settings, the extension's Hub, the
// purchase, the journal, the fictional player and the refund come from the host. No line of this module exists in the
// Studio registry. Its delay between two chests (one setting, one rule) shows an existing module evolving the same way.

const STUDIO = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

async function viewer(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.goto('/ext/mobile.html?labRole=viewer');
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page
    .getByRole('button', { name: /^Coffre mystère/ })
    .filter({ visible: true })
    .first()
    .click();
  return page;
}
const balance = async (page: Page) => {
  const token = (
    (await (await page.request.get('/ext-lab/token?role=viewer')).json()) as {
      token: string;
    }
  ).token;
  const session = (await (
    await page.request.get('/ext-lab/api/session', {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json()) as { wallet: { available: number } };
  return session.wallet.available;
};
const buy = async (page: Page) => {
  const cta = page.locator('.rp-coffre .rl-pay__cta');
  await expect(cta).toContainText('150 Jetons', { timeout: 15_000 });
  await cta.click();
  await cta.click();
};
const setSetting = async (page: Page, key: string, value: string) => {
  await page.locator(`[data-ms-input="${key}"]`).fill(value);
  await page.locator(`[data-ms-save="${key}"]`).click();
  // Un prix est une règle d'économie : Studio dit l'effet et demande.
  await page.locator('dialog.d-dlg [data-yes]').click();
  await expect(page.locator(`[data-setting="${key}"]`)).toContainText(
    'modifié',
  );
};

test('a module of the host appears everywhere from its own file, and its rules are the Core’s', async ({
  page,
  browser,
  request,
}) => {
  // Catalogue: there by itself, with its real state (off on purpose).
  await page.goto('/?p=modules');
  const row = page.locator('a.cat-m', { hasText: 'Coffre mystère' });
  await expect(row).toContainText('Coupé', { timeout: 15_000 });
  await row.click();
  await expect(page).toHaveURL(/p=coffre-mystere/);
  await expect(
    page.getByRole('heading', { level: 1, name: /Coffre mystère/ }),
  ).toBeVisible();
  // The search finds it too.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('coffre');
  await expect(page.locator('.rs-pal-list')).toContainText('Coffre mystère');
  await page.keyboard.press('Escape');

  // Studio sets it: switch, price, and the delay added by the module's own file.
  const on = page.locator('[data-ms-toggle="coffre_mystere.enabled"]');
  await on.check();
  await expect(page.locator('[data-module="coffre_mystere"]')).toContainText(
    'Activé',
  );
  await setSetting(page, 'coffre_mystere.prix', '150');
  await setSetting(page, 'coffre_mystere.delai_s', '600');

  // The extension: a purchase debits what Studio set.
  const ext = await viewer(browser);
  const before = await balance(ext);
  await buy(ext);
  await expect(ext.locator('.rp-feedback')).toContainText('Coffre acheté');
  await expect.poll(() => balance(ext)).toBe(before - 150);

  // The delay is the Core's: refused, nothing is debited.
  await buy(ext);
  await expect(ext.locator('.rp-feedback')).toContainText('Cooldown');
  expect(await balance(ext)).toBe(before - 150);

  // Studio: the journal, the fictional player (the door of a real OBS executor), a failure refunds once.
  await page.goto('/?p=coffre-mystere');
  await expect(page.locator('[data-role="activity"]')).toContainText(
    'Viewer Lab',
    { timeout: 15_000 },
  );
  await page
    .getByRole('button', { name: 'Prendre la prochaine action' })
    .click();
  await page.getByRole('button', { name: 'Échec (rembourse)' }).click();
  await expect(page.locator('.d-toast').last()).toContainText(
    'remboursée une fois',
  );
  await expect.poll(() => balance(ext)).toBe(before);
  await ext.close();

  // Back to its initial state: the module stays a Lab demonstration.
  for (const [key, value] of [
    ['coffre_mystere.delai_s', 0],
    ['coffre_mystere.prix', 100],
    ['coffre_mystere.enabled', 0],
  ] as const)
    await request.post('/api/module-settings', {
      headers: STUDIO,
      data: { key, value },
    });
});
