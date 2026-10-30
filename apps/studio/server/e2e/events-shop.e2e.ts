import { expect, test } from '@playwright/test';

// Halloween shop (docs/HALLOWEEN.md): the production Extension (mobile surface) → Lab EBS → Lab Core. The stack opens
// the shop, grants 12 Bonbons to « Viewer Lab » and gives them 5 000 test Jetons; no overlay is connected.

test('a viewer opens « Événements » (Halloween 2026): balance, offline engine, nothing sellable; ways to earn, no Jetons exchange', async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.goto('/ext/mobile.html?labRole=viewer');
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Événements/ }).click();

  const shop = page.locator('.evs');
  await expect(shop.locator('.evs-pill')).toHaveText('🍬 12');
  await expect(shop).toContainText('Halloween 2026');
  await expect(shop).toContainText('pas prêt à avoir peur');
  // Offline: every card refuses (no Bonbon spent for nothing).
  const blink = shop.getByRole('button', { name: /^Acheter Clignement/ });
  await expect(blink).toBeDisabled();

  // « Bonbons »: the ways to earn; the Jetons exchange is gone (30/10).
  await shop.getByRole('tab', { name: 'Bonbons' }).click();
  await expect(shop).toContainText('+10 à chaque sub');
  await expect(shop).not.toContainText('Jetons');
  await expect(shop.locator('[data-convert]')).toHaveCount(0);
  await expect(shop.locator('.evs-pill')).toHaveText('🍬 12');
});

test('the 565×376 video component scrolls the module (wheel), its section tabs staying at hand', async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 565, height: 376 } });
  await page.goto('/ext/video_component.html?labRole=viewer');
  const all = page.getByRole('button', { name: 'Voir tous les modules' });
  await all.first().click();
  await page
    .getByRole('button', { name: /^Événements/ })
    .first()
    .click();
  await expect(page.locator('.evs-item').first()).toBeVisible();
  const body = page.locator('.jdm-module__body');
  const box = (await page.locator('.evs-list').first().boundingBox())!;
  await page.mouse.move(box.x + 30, 300);
  await page.mouse.wheel(0, 900);
  await expect
    .poll(() => body.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(300);
  await page.getByRole('tab', { name: 'Bonbons' }).click();
  await page.mouse.wheel(0, 900);
  await expect(page.locator('.evs-ways').first()).toBeInViewport();
});
