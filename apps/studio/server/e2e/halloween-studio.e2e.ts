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
  // A double click: one confirmation (accepted), one credit.
  const asked: string[] = [];
  s.on('dialog', (d) => {
    asked.push(d.message());
    void d.accept();
  });
  await form.getByRole('button', { name: 'Attribuer' }).dblclick();
  await expect(finder.locator('.hw-balance')).toHaveText('7 🍬', {
    timeout: 10_000,
  });
  await expect(finder).toContainText('+7 🍬');
  await expect(finder).toContainText('concours e2e');
  expect(asked).toEqual(['Donner 7 Bonbons à 57012345 ?']);
  await s.waitForTimeout(1500);
  await finder.getByRole('button', { name: 'Chercher' }).click();
  await expect(finder.getByRole('button', { name: /Kirito_TV/ })).toContainText(
    '7 🍬',
  );
});

test('« Testeurs seulement »: the Extension module hides for the others, shows once Studio adds the viewer', async ({
  browser,
}) => {
  const s = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  await s.goto('/?tab=halloween');
  const hub = async () => {
    const v = await browser.newPage({ viewport: { width: 400, height: 800 } });
    await v.goto('/ext/mobile.html?labRole=viewer');
    await v.getByRole('button', { name: 'Voir tous les modules' }).click();
    const n = await v.getByRole('button', { name: /^Événements/ }).count();
    await v.close();
    return n;
  };
  await expect.poll(hub).toBeGreaterThan(0);
  await s.getByRole('button', { name: 'Testeurs seulement' }).click();
  await expect(s.locator('#tab-halloween')).toContainText('0 testeur');
  await expect.poll(hub, { timeout: 15_000 }).toBe(0);
  const finder = s.locator('#tab-halloween [data-role="viewer"]');
  await finder.getByPlaceholder('Pseudo Twitch ou id').fill('900101');
  await finder.getByRole('button', { name: 'Chercher' }).click();
  await finder
    .getByRole('button', { name: /900101/ })
    .first()
    .click();
  await finder.getByRole('button', { name: '+ Testeur extension' }).click();
  await expect(
    finder.getByRole('button', { name: '✓ Testeur extension' }),
  ).toBeVisible();
  await expect.poll(hub, { timeout: 15_000 }).toBeGreaterThan(0);
  // Back to everyone (the other specs share the stack).
  await s.getByRole('button', { name: 'Tous les viewers' }).click();
  await expect(s.locator('#tab-halloween')).toContainText(
    'Tous les viewers de l’extension publiée',
  );
});
