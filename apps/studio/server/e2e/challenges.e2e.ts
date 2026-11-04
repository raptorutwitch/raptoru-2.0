import { expect, test } from '@playwright/test';

// Studio › Défis (docs/CHALLENGES.md), the real tab on the Lab Core of the e2e stack. Everything here is FICTIONAL test
// data: the stack seeds three finished Random Ban of Fictif_Defis (yesterday); the test creates a test title in the
// Boutique, then a retroactive draft « 2 Random Ban » rewarded by it: checked (who would complete it now), saved,
// activated (Fictif_Defis completes it at once and receives the title), its condition frozen, followed, suspended.

const H = { 'x-raptoru-studio': '1' };

test('Défis: a fictional retroactive challenge checked, saved, activated, completed and paid once, then frozen and suspended', async ({
  page,
}) => {
  const item = await page.request.post('/api/cosmetics/items', {
    headers: H,
    data: {
      reward_id: 'fictif-e2e-titre',
      kind: 'title',
      label: 'Titre fictif e2e',
      status: 'published',
      style: { color: '#ff8a00' },
    },
  });
  expect(item.ok()).toBe(true);

  await page.goto('/?tab=challenges');
  const tab = page.locator('#tab-challenges');
  await expect(tab).toContainText('Aucun défi. Crée le premier ci-dessous.');
  // The Lab has no canonical Wallet and no Daily: those metrics cannot be chosen here.
  await expect(
    tab.locator('[data-f="metric"] option[value="daily_claims"]'),
  ).toHaveAttribute('disabled', '');

  await tab.locator('[data-f="challenge_id"]').fill('fictif-e2e');
  await tab.locator('[data-f="title"]').fill('Défi fictif (test e2e)');
  await tab.locator('[data-f="metric"]').selectOption('random_ban_sent');
  await expect(tab.locator('[data-role="metric-note"]')).toContainText(
    'rb_requests',
  );
  await tab.locator('[data-f="target"]').fill('2');
  await tab.locator('[data-f="retroactive"]').check();
  await tab.locator('[data-f="reward_kind"]').selectOption('reward');
  await tab.locator('[data-f="reward_id"]').selectOption('fictif-e2e-titre');

  await tab.getByRole('button', { name: 'Vérifier et prévisualiser' }).click();
  const preview = tab.locator('[data-role="preview"]');
  await expect(preview).toContainText('Condition valide.');
  await expect(preview.locator('[data-role="completing"]')).toHaveText('1');
  await expect(preview).toContainText('Fictif_Defis (3)');

  await tab.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(tab).toContainText('Enregistré.');
  const row = tab.locator('tr[data-row="fictif-e2e"]');
  await expect(row).toContainText('Brouillon');

  page.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'Activer' }).click();
  await expect(row).toContainText('Actif');
  await expect(row).toContainText('1 versée(s)');

  // Published: the condition is frozen in the form (the Core refuses it anyway).
  await row.getByRole('button', { name: 'Modifier' }).click();
  await expect(tab.locator('[data-f="target"]')).toBeDisabled();
  await expect(tab).toContainText('sa condition et sa récompense sont figées');

  await row.getByRole('button', { name: 'Suivi' }).click();
  const detail = tab.locator('[data-role="detail"]');
  await expect(detail).toContainText('Fictif_Defis');
  await expect(detail).toContainText('3 / 2');
  await expect(detail).toContainText('versée');
  await expect(detail).toContainText('Terminé');

  // A second recount changes nothing (still one award).
  await tab.getByRole('button', { name: 'Recompter maintenant' }).click();
  await expect(tab).toContainText('Recomptage terminé.');
  await expect(row).toContainText('1 versée(s)');

  page.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'Suspendre' }).click();
  await expect(row).toContainText('Suspendu');
});
