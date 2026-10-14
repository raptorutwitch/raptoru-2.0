import { expect, test, type Browser, type Page } from '@playwright/test';

// Critical chain (ASTRA-P1-018): the production Extension (mobile surface) → Lab EBS → Lab Core →
// Core's public projection, both ways. The stack seeds one public command, `!e2etest`.

/** Opens a module of the Hub as a user does: « Voir tous les modules » → tile (opens it directly). */
async function openModule(browser: Browser, role: string, tile: RegExp) {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.goto(`/ext/mobile.html?labRole=${role}`);
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: tile }).click();
  return page;
}

const publicList = (page: Page) => page.locator('.cmdx--public');

test('viewer sees the public command; a moderator disables it; the viewer list follows Core', async ({
  browser,
}) => {
  // Viewer: « Commandes » shows the seeded command from Core's public projection (viewer fields only).
  const viewer = await openModule(browser, 'viewer', /^Commandes$/);
  await expect(publicList(viewer)).toContainText('e2etest');
  await expect(publicList(viewer)).toContainText('Commande du test E2E');
  await expect(publicList(viewer)).toContainText('Tout le monde');
  // No admin data in the viewer surface.
  await expect(publicList(viewer)).not.toContainText('Désactivées');
  await viewer.close();

  // Moderator: Modération › Commandes, disable it (Extension → EBS → Core, the moderator's rights).
  const mod = await openModule(browser, 'moderator', /^Modération/);
  await mod.getByRole('button', { name: 'Commandes', exact: true }).click();
  const toggle = mod.getByRole('switch', { name: 'Activer !e2etest' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(
    mod.getByRole('button', { name: /^Désactivées 1/ }),
  ).toBeVisible();
  await mod.close();

  // Viewer again: a disabled command is no longer public (Core decided, the projection says so).
  const again = await openModule(browser, 'viewer', /^Commandes$/);
  await expect(publicList(again)).toContainText(
    'Aucune commande publique pour l’instant.',
  );
  await expect(publicList(again)).not.toContainText('e2etest');
});
