import { expect, test } from '@playwright/test';

// Studio › Progression (docs/PROGRESSION.md), the real panel on the Lab Core of the e2e stack: turn it on, create an
// event badge, find a viewer the channel has seen (Kirito_TV, seeded), grant it, see it in the inventory, revoke it
// with a reason.

test('Progression: on, an event badge created, a viewer found, granted, then revoked with a reason', async ({
  page,
}) => {
  await page.goto('/?tab=progression');
  const tab = page.locator('#tab-progression');
  await tab.getByRole('button', { name: 'Activer' }).click();
  await expect(tab).toContainText('Active');

  const form = tab.locator('[data-role="reward-form"]');
  await form.locator('[data-f="reward_id"]').fill('citrouille-2026');
  await form.locator('[data-f="kind"]').selectOption('badge');
  await form.locator('[data-f="label"]').fill('Citrouille 2026');
  await form.locator('[data-f="rarity"]').selectOption('event');
  await form.getByRole('button', { name: 'Créer / mettre à jour' }).click();
  await expect(tab.locator('table')).toContainText('Citrouille 2026');

  await tab.locator('[data-role="q"]').fill('kir');
  await tab.getByRole('button', { name: 'Chercher' }).click();
  await tab.getByRole('button', { name: 'Kirito_TV' }).click();
  await expect(tab).toContainText('Inventaire vide.');
  await tab.locator('[data-role="grant-source"]').selectOption('event');
  await tab.locator('[data-role="grant-ref"]').fill('halloween-2026');
  await tab.getByRole('button', { name: 'Attribuer' }).click();
  await expect(tab).toContainText('Attribué.');
  await expect(tab.locator('.detail')).toContainText('Citrouille 2026');
  await expect(tab.locator('.detail')).toContainText('halloween-2026');

  page.once('dialog', (d) => void d.accept('test e2e'));
  await tab.getByRole('button', { name: 'Retirer' }).click();
  await expect(tab).toContainText('Retiré.');
  await expect(tab.locator('.detail')).toContainText('Inventaire vide.');

  // Manual XP: applied, journaled with its reason; below zero refused.
  await tab.locator('[data-role="adj-mode"]').selectOption('add');
  await tab.locator('[data-role="adj-value"]').fill('100');
  await tab.locator('[data-role="adj-reason"]').fill('test e2e ajout');
  await tab.getByRole('button', { name: 'Appliquer' }).click();
  await expect(tab).toContainText('XP ajustée.');
  await expect(tab.locator('.detail')).toContainText('+100 XP');
  await expect(tab.locator('.detail')).toContainText('test e2e ajout');
  await tab.locator('[data-role="adj-mode"]').selectOption('remove');
  await tab.locator('[data-role="adj-value"]').fill('1000');
  await tab.locator('[data-role="adj-reason"]').fill('trop');
  await tab.getByRole('button', { name: 'Appliquer' }).click();
  await expect(tab).toContainText('Refusé : below_zero');
});
