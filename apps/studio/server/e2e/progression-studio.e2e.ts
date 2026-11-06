import { expect, test } from '@playwright/test';

// Studio › Progression (docs/PROGRESSION.md), the real panel on the Lab Core of the e2e stack: turn it on, create an
// event badge, find a viewer the channel has seen (Kirito_TV, seeded), grant it, see it in the inventory, revoke it
// with a reason.

test('Progression: on, an event badge created, a viewer found, granted, then revoked with a reason', async ({
  page,
}) => {
  await page.goto('/?tab=progression');
  const tab = page.locator('#tab-progression');
  const toasts = page.locator('.d-toasts');
  await tab.getByRole('button', { name: 'Activer' }).click();
  await expect(tab.locator('.d-state')).toContainText('Active');

  await tab.getByRole('button', { name: 'Titres et badges' }).click();
  const form = tab.locator('[data-role="reward-form"]');
  await form.locator('[data-rkind="badge"]').click();
  await form.locator('[data-f="reward_id"]').fill('citrouille-2026');
  await form.locator('[data-f="label"]').fill('Citrouille 2026');
  await form.locator('[data-rarity="event"]').click();
  await form.getByRole('button', { name: 'Créer' }).click();
  await expect(tab.locator('[data-z="items"]')).toContainText(
    'Citrouille 2026',
  );

  await tab.getByRole('button', { name: 'Viewers' }).click();
  await tab.locator('[data-role="q"]').fill('kir');
  await tab.getByRole('button', { name: 'Kirito_TV' }).click();
  await expect(tab).toContainText('Inventaire vide.');
  await tab.locator('[data-act="grant-pick"]').click();
  await page.locator('.pg-opt', { hasText: 'Citrouille 2026' }).click();
  await tab.locator('[data-grant-source="event"]').click();
  await tab.locator('[data-role="grant-ref"]').fill('halloween-2026');
  await tab.locator('[data-act="grant"]').click();
  await expect(toasts).toContainText('Attribué.');
  await expect(tab.locator('.detail')).toContainText('Citrouille 2026');
  await expect(tab.locator('.detail')).toContainText('halloween-2026');

  await tab.getByRole('button', { name: 'Retirer…' }).click();
  await page.locator('.d-dlg textarea').fill('test e2e');
  await page.locator('.d-dlg [data-yes]').click();
  await expect(toasts).toContainText('Retiré.');
  await expect(tab.locator('.detail')).toContainText('Inventaire vide.');

  // Manual XP: applied, journaled with its reason; below zero refused.
  await tab.locator('[data-adj-mode="add"]').click();
  await tab.locator('[data-role="adj-value"]').fill('100');
  await tab.locator('[data-role="adj-reason"]').fill('test e2e ajout');
  await tab.locator('[data-act="adjust"]').click();
  await expect(toasts).toContainText('XP ajustée.');
  await expect(tab.locator('.detail')).toContainText('+100 XP');
  await expect(tab.locator('.detail')).toContainText('test e2e ajout');
  await tab.locator('[data-adj-mode="remove"]').click();
  await tab.locator('[data-role="adj-value"]').fill('1000');
  await tab.locator('[data-role="adj-reason"]').fill('trop');
  await tab.locator('[data-act="adjust"]').click();
  await expect(toasts).toContainText('ne peut pas passer sous 0');
});
