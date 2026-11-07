import { expect, test } from '@playwright/test';
import { isolate } from './isolation.js';

// La page Alertes de Studio (direction D) : familles, scène sur le vrai moteur, timeline, inspecteur, file, panneau Sources. Sur la
// pile de test les médias sont absents : la page le dit et propose l'import, et tout ce qui ne dépend pas d'une image reste réglable.

test('Alertes: families, timeline, draft and save, queue, sources, keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { outside } = await isolate(page);
  await page.goto('/?p=alerts');
  const view = page.locator('#tab-alerts');
  const family = (id: string) => view.locator(`[data-fam="${id}"]`);

  // Huit familles, celle choisie est dite, sans onglets.
  for (const id of [
    'follow',
    'sub',
    'prime',
    'resub',
    'gift',
    'bits',
    'raid',
    'donation',
  ])
    await expect(family(id)).toBeVisible();
  await expect(family('follow')).toHaveAttribute('aria-pressed', 'true');
  await expect(view.getByRole('tab')).toHaveCount(0);
  await expect(view.getByText('Quand Follow arrive')).toBeVisible();
  await expect(view.getByText('Tirage au sort')).toBeVisible();

  // L'aperçu est le vrai moteur, à l'échelle de la scène.
  await expect
    .poll(() =>
      view.locator('[data-fit]').evaluate((e) => getComputedStyle(e).transform),
    )
    .toMatch(/^matrix\(0\.\d+/);

  // Le bloc de texte se règle sur la timeline : brouillon, puis enregistrement.
  await family('raid').click();
  await expect(view.getByText('Quand Raid arrive')).toBeVisible();
  const clip = view.locator('[data-clip="text"]');
  const box = (await clip.boundingBox())!;
  await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 60, box.y + box.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  await expect(view.getByText('Non enregistré')).toBeVisible();
  await view.getByRole('button', { name: 'Annuler' }).click();
  await expect(view.getByText('Non enregistré')).toHaveCount(0);

  // Une transition choisie reste un brouillon jusqu'à l'enregistrement.
  await clip.click();
  await view.locator('[data-fx-kind="textEnter"]').selectOption('rise');
  await expect(view.locator('[data-fx-ms="textEnter"]')).toHaveValue('400');
  await view.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(view.getByText('Non enregistré')).toHaveCount(0);
  await view.locator('[data-fx-kind="textEnter"]').selectOption('origin');
  await view.getByRole('button', { name: 'Enregistrer' }).click();
  await view.locator('[data-unsel]').first().click();

  // Le test passe par la vraie file du Core Lab et s'y voit.
  await family('bits').click();
  await view.getByRole('button', { name: 'Envoyer en file' }).click();
  await expect(view.locator('.alr-qp').first()).toBeVisible();
  await view.getByRole('button', { name: 'Vider', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Vider la file' })
    .click();
  await expect(view.locator('.alr-qp')).toHaveCount(0);
  await view.getByRole('button', { name: 'Historique' }).click();
  await expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Sources : Twitch, Dons, Médias, Dock, adresse OBS masquée.
  await view.locator('[data-panel]').click();
  for (const name of [
    'Source OBS',
    'Événements Twitch',
    'Dons StreamElements',
    'Médias',
    'Profil Halloween',
    'Dock OBS',
  ])
    await expect(view.getByRole('heading', { name })).toBeVisible();
  await expect(view.getByLabel('Adresse de la source OBS')).toHaveValue(/#•+$/);
  await view.locator('[data-pclose]').click();

  // Revenir sur Alertes retrouve la famille choisie.
  await page.locator('a.rs-nav[data-page="centre"]').click();
  await expect(
    page.getByRole('heading', { name: 'Centre de contrôle' }),
  ).toBeVisible();
  await page.locator('a.rs-nav[data-page="alerts"]').first().click();
  await expect(family('bits')).toHaveAttribute('aria-pressed', 'true');
  expect(outside).toEqual([]);
});
