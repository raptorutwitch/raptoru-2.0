import { expect, test } from '@playwright/test';
import { isolate } from './isolation.js';

// The Studio « Alertes » page in tabs (refonte, lot 5): every block of the former single column is still on the page
// (its loaders keep running), one tab shown at a time, keyboard tabs, the preview keeps its scale after a tab change.

const ROLES = [
  'category',
  'variant',
  'form',
  'calib',
  'queue',
  'obs-url',
  'source',
  'media',
  'dock',
  'twitch',
  'se',
  'variants',
];

test('Alertes: four tabs, every block kept once, keyboard, preview scale after a tab change', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { outside } = await isolate(page);
  await page.goto('/?p=alerts');
  const tab = (n: string) => page.getByRole('tab', { name: n });
  await expect(tab('Créer et tester')).toHaveAttribute('aria-selected', 'true');
  for (const role of ROLES)
    await expect(page.locator(`[data-role="${role}"]`), role).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Lancer' })).toBeVisible();
  await expect(page.locator('[data-role="twitch"]')).toBeHidden();
  const panels: [string, string][] = [
    ['File et OBS', 'queue'],
    ['Sources d’événements', 'twitch'],
    ['Variantes', 'variants'],
  ];
  for (const [name, role] of panels) {
    await tab(name).click();
    await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(page.locator(`[data-role="${role}"]`)).toBeAttached();
    await expect(page.getByRole('button', { name: 'Lancer' })).toBeHidden();
  }
  await tab('Variantes').press('ArrowLeft');
  await expect(tab('Sources d’événements')).toBeFocused();
  await expect(tab('Sources d’événements')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await tab('Sources d’événements').press('Home');
  await expect(tab('Créer et tester')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Lancer' })).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        await page
          .locator('.al-stage')
          .evaluate((e) => getComputedStyle(e).getPropertyValue('--al-scale')),
      ),
    )
    .toBeGreaterThan(0.2);
  // Back to Alertes later: the tab chosen is kept while Studio runs.
  await tab('File et OBS').click();
  await page.locator('a.rs-nav[data-page="centre"]').click();
  await expect(
    page.getByRole('heading', { name: 'Centre de contrôle' }),
  ).toBeVisible();
  await page.locator('a.rs-nav[data-page="alerts"]').first().click();
  await expect(tab('File et OBS')).toHaveAttribute('aria-selected', 'true');
  expect(outside).toEqual([]);
});
