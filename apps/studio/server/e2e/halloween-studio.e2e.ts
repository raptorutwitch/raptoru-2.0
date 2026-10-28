import { expect, test } from '@playwright/test';

// Studio › Halloween (docs/HALLOWEEN.md): find a real Twitch viewer the channel has seen (never given any Bonbons),
// credit them — a double click credits once —, see the new balance and the movement in their history.

test('« Trouver un viewer » → Créditer: a real Twitch name, credited once, balance and trace shown', async ({
  browser,
}) => {
  const s = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  await s.goto('/?tab=halloween');
  const finder = s.locator('#tab-halloween [data-role="viewer"]');
  await finder.getByPlaceholder('Pseudo Twitch ou id').fill('kirito');
  await finder.getByRole('button', { name: 'Chercher' }).click();
  await finder.getByRole('button', { name: /Kirito_TV/ }).click();
  await expect(finder.locator('.hw-balance')).toHaveText('0 🍬');
  await finder.getByRole('button', { name: 'Créditer' }).click();
  const form = s.locator('#tab-halloween [data-form="grant"]');
  await expect(form.locator('input[name="viewer"]')).toHaveValue('57012345');
  await form.locator('input[name="amount"]').fill('7');
  await form.locator('input[name="note"]').fill('concours e2e');
  // A double click: one credit.
  await form.getByRole('button', { name: 'Attribuer' }).dblclick();
  await expect(finder.locator('.hw-balance')).toHaveText('7 🍬', {
    timeout: 10_000,
  });
  await expect(finder).toContainText('+7 🍬');
  await expect(finder).toContainText('concours e2e');
  await s.waitForTimeout(1500);
  await finder.getByRole('button', { name: 'Chercher' }).click();
  await expect(finder.getByRole('button', { name: /Kirito_TV/ })).toContainText(
    '7 🍬',
  );
});
