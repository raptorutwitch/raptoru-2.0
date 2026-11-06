import { expect, test } from '@playwright/test';

// Studio › Défis (docs/CHALLENGES.md), the real page on the Lab Core of the e2e stack. Everything here is FICTIONAL test
// data: the stack seeds three finished Random Ban of Fictif_Defis (yesterday); the test creates a test title in the
// Boutique, then a retroactive draft « 2 Random Ban » rewarded by it: checked (who would complete it now), saved,
// activated after a confirmation stating its real scope (Fictif_Defis completes it at once and receives the title),
// its condition frozen, followed, recounted (confirmed, nothing paid twice), suspended.

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

  // The legacy address still opens the page.
  await page.goto('/?tab=challenges');
  const tab = page.locator('#tab-challenges');
  const toasts = page.locator('.d-toasts');
  const dialog = page.locator('.d-dlg');
  await expect(tab.locator('[data-role="empty"]')).toContainText(
    'Aucun défi pour l’instant',
  );
  await tab
    .locator('[data-role="empty"]')
    .getByRole('button', { name: 'Créer un défi' })
    .click();

  // The historical Lab has no canonical Wallet and no Daily: those metrics cannot be chosen there. The main Core has them.
  if (process.env.E2E_STACK === 'legacy')
    await expect(tab.locator('[data-metric="daily_claims"]')).toBeDisabled();

  await tab.locator('[data-f="challenge_id"]').fill('fictif-e2e');
  await tab.locator('[data-f="title"]').fill('Défi fictif (test e2e)');
  await tab.locator('[data-metric="random_ban_sent"]').click();
  await expect(tab.locator('[data-role="metric-note"]')).toContainText(
    'rb_requests',
  );
  await tab.locator('[data-tok="target"]').click();
  await tab.locator('[data-f="target"]').fill('2');
  await tab.locator('[data-f="retroactive"]').check();
  await tab.locator('[data-tok="reward"]').click();
  await tab.locator('[data-rw="reward"]').click();
  await tab.locator('[data-rw-item="fictif-e2e-titre"]').click();
  await expect(tab.locator('[data-role="summary"]')).toContainText(
    'Titre fictif e2e',
  );

  await tab.getByRole('button', { name: 'Vérifier et prévisualiser' }).click();
  const preview = tab.locator('[data-role="preview"]');
  await expect(preview).toContainText('Condition valide.');
  await expect(preview.locator('[data-role="completing"]')).toHaveText('1');
  await expect(preview).toContainText('Fictif_Defis (3)');

  await tab.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(toasts).toContainText('Enregistré.');
  await expect(tab.locator('[data-role="summary"]')).toContainText('Brouillon');

  // Activation: the confirmation states the frozen rule, the retroactive effect and the last dry-run.
  await tab
    .locator('[data-role="editor"]')
    .getByRole('button', { name: 'Activer…' })
    .click();
  await expect(dialog).toContainText('Règle figée');
  await expect(dialog).toContainText('Rétroactif');
  await expect(dialog).toContainText('1 viewer(s)');
  await dialog.locator('[data-yes]').click();
  await expect(tab.locator('[data-role="summary"]')).toContainText('Actif');

  // Activated: the condition is frozen in the form (the Core refuses it anyway).
  await expect(tab.locator('[data-tok="target"]')).toBeDisabled();
  await expect(tab).toContainText('sa condition et sa récompense sont figées');

  await tab.getByRole('button', { name: 'Tous les défis' }).click();
  const row = tab.locator('[data-row="fictif-e2e"]');
  await expect(row).toContainText('Actif');
  await expect(row).toContainText('1 versée');

  await row.getByRole('button', { name: 'Suivi' }).click();
  const detail = tab.locator('[data-role="detail"]');
  await expect(detail).toContainText('Fictif_Defis');
  await expect(detail).toContainText('3 / 2');
  await expect(detail).toContainText('versée');
  await expect(detail).toContainText('Terminé');
  await tab.getByRole('button', { name: 'Tous les défis' }).click();

  // A recount is confirmed with its real scope; a second one changes nothing (still one award).
  await tab.getByRole('button', { name: 'Recompter et verser…' }).click();
  await expect(dialog).toContainText('verse réellement');
  await dialog.locator('[data-yes]').click();
  await expect(toasts).toContainText('Recomptage terminé.');
  await expect(row).toContainText('1 versée');

  await row.locator('[data-more]').click();
  await page
    .locator('.d-menu')
    .getByRole('button', { name: 'Suspendre' })
    .click();
  await dialog.locator('[data-yes]').click();
  await expect(row).toContainText('Suspendu');
});
