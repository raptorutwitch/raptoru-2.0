import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Halloween « Titres » (docs/COSMETIC_SHOP.md § 8), end to end in a real browser: Studio › Boutique creates a title and
// sells it in Bonbons; Studio › Halloween gives « Viewer Lab » Bonbons; the production extension's « Événements »
// module shows the « Titres » tab, the viewer buys it (two taps), the Bonbons go down once, the title is « Possédé »
// after a reload and in the inventory the site reads. Isolated stack: no Twitch, Lab data only.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const labCore = async (path: string) => {
  const { url, secret } = JSON.parse(
    readFileSync(join(tmpdir(), `raptoru-e2e-core-${PORT}.json`), 'utf8'),
  ) as { url: string; secret: string };
  const r = await fetch(url + path, {
    headers: { authorization: `Bearer ${secret}` },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read answers
  return (await r.json()) as Record<string, any>;
};

test('Titres: created in Studio, sold in Bonbons, bought once in the extension, kept in the inventory', async ({
  page,
  browser,
}) => {
  // Studio › Boutique: an orange title, published, on sale for 25 Bonbons.
  await page.goto('/?tab=shop');
  const tab = page.locator('#tab-shop');
  const form = tab.locator('[data-role="item-form"]');
  await tab.getByRole('button', { name: 'Nouveau titre / badge' }).click();
  await form.locator('[data-f="reward_id"]').fill('e2e-faucheuse');
  await form.locator('[data-f="label"]').fill('Faucheuse');
  await form.locator('[data-f="status"]').selectOption('published');
  await tab.locator('[data-l="use-color"]').check();
  await tab.locator('[data-act="save"]').click();
  await expect(tab).toContainText('Enregistré.');
  await tab.locator('[data-edit="e2e-faucheuse"]').click();
  const offer = tab.locator('[data-role="offer-form"]');
  await offer.locator('[data-o="offer_id"]').fill('e2e-faucheuse-bonbons');
  await offer.locator('[data-o="currency"]').selectOption('bonbons');
  await offer.locator('[data-o="price"]').fill('25');
  await offer.locator('[data-o="enabled"]').check();
  await offer.getByRole('button', { name: 'Enregistrer l’offre' }).click();
  await expect(tab).toContainText('Offre enregistrée.');

  // Studio › Halloween: 40 Bonbons for Viewer Lab (a Lab grant).
  const studio = await page.request.post('/api/halloween/admin/grant', {
    headers: { 'x-raptoru-studio': '1' },
    data: {
      idempotency_key: '00000000-0000-4000-8000-0000000071e5',
      viewer: '900101',
      amount: 40,
      reason: 'grant',
    },
  });
  expect(await studio.text()).toContain('balance');
  const balance = (await studio.json()).balance as number;

  // The extension, as Viewer Lab: « Titres » next to « Interactions » and « Bonbons ».
  const v = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await v.goto('/ext/mobile.html?labRole=viewer');
  await v.getByRole('button', { name: 'Voir tous les modules' }).click();
  await v.getByRole('button', { name: /^Événements/ }).click();
  const shop = v.locator('.evs');
  await shop.getByRole('tab', { name: 'Titres' }).click();
  await expect(shop).toContainText('Récompenses permanentes');
  const row = shop.locator('.evs-title-row', { hasText: 'Faucheuse' });
  await expect(row).toContainText('Disponible');
  // The look comes from the Core's style (a colour), applied to the name.
  await expect(row.locator('.evs-title-name')).not.toHaveCSS(
    'color',
    'rgb(0, 0, 0)',
  );
  const buy = row.getByRole('button', { name: /Acheter le titre Faucheuse/ });
  await buy.click();
  await row.getByRole('button', { name: /Confirmer l’achat/ }).click();
  await expect(shop).toContainText('Titre ajouté à ta collection');
  await expect(row).toContainText('Possédé ✓');
  await expect(shop.locator('.evs-pill')).toHaveText(`🍬 ${balance - 25}`);

  // Kept: after a reload, and in the inventory raptoru.fr reads (the Core's site routes).
  await v.reload();
  await v.getByRole('button', { name: 'Voir tous les modules' }).click();
  await v.getByRole('button', { name: /^Événements/ }).click();
  await v.locator('.evs').getByRole('tab', { name: 'Titres' }).click();
  await expect(
    v.locator('.evs-title-row', { hasText: 'Faucheuse' }),
  ).toContainText('Possédé ✓');
  const side = await labCore('/v1/site/cosmetics/viewers/900101');
  expect(side.owned).toContain('e2e-faucheuse');
  expect(side.balances.bonbons).toBe(balance - 25);
  // The interactions are still there.
  await v.locator('.evs').getByRole('tab', { name: 'Interactions' }).click();
  await expect(v.locator('.evs-item').first()).toBeVisible();
});
