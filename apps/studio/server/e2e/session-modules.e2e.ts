import { expect, test, type Browser } from '@playwright/test';

// Session modules registered by their own files (module-registry.js, no branch in ui.js): the Hub offers them, each opens
// ITS view, leaving and coming back mounts it again (never two copies, never a stale one). Production Extension (mobile
// surface) → Lab EBS → Lab Core, fictional data.

async function hub(browser: Browser, role: string) {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.goto(`/ext/mobile.html?labRole=${role}`);
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  return page;
}

test('Roue du Sub and Commandes open their own view from the Hub; back and again: one view, fresh', async ({
  browser,
}) => {
  const page = await hub(browser, 'moderator');
  await page.getByRole('button', { name: /^Roue du Sub/ }).click();
  await expect(page.locator('.swx')).toHaveCount(1);
  // The host's intro is shown for the wheel (its option), not for Commandes (intro: false).
  await expect(page.locator('.jdm-module__intro')).toHaveCount(1);
  // In-page navigation (no reload): back to the Hub, then another session module.
  await page.getByRole('button', { name: 'Retour au Hub' }).click();
  await expect(page.locator('.swx')).toHaveCount(0);
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Commandes$/ }).click();
  await expect(page.locator('.cmdx--public')).toHaveCount(1);
  await expect(page.locator('.swx')).toHaveCount(0); // the wheel's view is gone
  await expect(page.locator('.jdm-module__intro')).toHaveCount(0);
  await expect(page.locator('[data-cmd-pub="1"]')).toHaveCount(1); // its bodyData
  // And the wheel again: a fresh view, mounted once.
  await page.getByRole('button', { name: 'Retour au Hub' }).click();
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Roue du Sub/ }).click();
  await expect(page.locator('.swx')).toHaveCount(1);
  await expect(page.locator('.cmdx--public')).toHaveCount(0);
  await page.close();
});

test('« Voir tous les modules » stays open when a new state arrives (here the balance) — it used to close under the viewer', async ({
  browser,
}) => {
  const { readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const PORT = Number(process.env.E2E_PORT ?? 4399);
  const core = JSON.parse(
    readFileSync(join(tmpdir(), `raptoru-e2e-core-${PORT}.json`), 'utf8'),
  ) as {
    url: string;
    secret: string;
  };
  const page = await hub(browser, 'viewer');
  const tile = page
    .getByRole('button', { name: /^Commandes$/ })
    .filter({ visible: true });
  await expect(tile).toHaveCount(1);
  await fetch(core.url + '/v1/lab/wallet/900100', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${core.secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
      viewer_id: '900101',
      op: 'set',
      tokens: 4_321,
    }),
  });
  // The Hub redraws with the new balance (proved by its balance button); the list the viewer opened is still there.
  await expect(page.locator('body')).toContainText(/4[\s  ]?321|4,3\s?K/, {
    timeout: 20_000,
  });
  await page.waitForTimeout(1_000);
  await expect(tile).toHaveCount(1);
  await page.close();
});
