import { expect, test } from '@playwright/test';

// Studio › Roue du Sub on the Lab Core of the e2e stack: « Tester dans OBS » sends the wheel shown on the stage (band,
// tier) to the effects player through the test route, never a gain. It used to open the settings panel only.

test('« Tester dans OBS » sends the wheel shown (band, tier) to the effects player, no gain', async ({
  page,
}) => {
  await page.goto('/?p=sub-wheel');
  await page.locator('[data-band="12"]').click();
  await page.locator('[data-tier="3"]').click();
  const sent = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith('/api/sub-wheel/test'),
  );
  const answered = page.waitForResponse((r) =>
    r.url().endsWith('/api/sub-wheel/test'),
  );
  await page.getByRole('button', { name: 'Tester dans OBS' }).click();
  // A test played on the stream: confirmed by default (Studio preference).
  await page.locator('.d-dlg [data-yes]').click();
  expect((await sent).postDataJSON()).toMatchObject({ tier: 3, months: 12 });
  expect((await answered).status()).toBe(200);
  await expect(page.locator('.d-toasts')).toContainText(
    'Roue envoyée au lecteur d’effets (aucun gain)',
  );
});
