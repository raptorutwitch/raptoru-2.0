import { expect, test } from '@playwright/test';

// Halloween shop (docs/HALLOWEEN.md): the production Extension (mobile surface) → Lab EBS → Lab Core. The stack opens
// the shop, grants 12 Bonbons to « Viewer Lab » and gives them 5 000 test Jetons; no overlay is connected.

test('a viewer opens « Halloween »: balance, offline engine, nothing sellable; a Jetons exchange credits Bonbons', async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.goto('/ext/mobile.html?labRole=viewer');
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Halloween/ }).click();

  const shop = page.locator('.evs');
  await expect(shop.locator('.evs-balance b')).toHaveText('12');
  await expect(shop).toContainText('pas prêt à avoir peur');
  // Offline: every card refuses (no Bonbon spent for nothing).
  const blink = shop.getByRole('button', { name: /^Acheter Clignement/ });
  await expect(blink).toBeDisabled();

  // Exchange 2 Bonbons (the Core debits the Jetons, capped per hour).
  await shop.getByRole('button', { name: 'Plus' }).click();
  await shop.getByRole('button', { name: /Jetons → 2/ }).click();
  await expect(shop.locator('.evs-balance b')).toHaveText('14');
  await expect(shop).toContainText('encore 8 / 10');
});
