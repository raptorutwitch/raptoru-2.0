import { expect, test, type Browser } from '@playwright/test';

// Tombola in Bonbons (docs/HALLOWEEN.md), the whole Lab path as Antoni does it: Studio › Tombola sets a fixed reward in
// Bonbons (never a Jetons-sized amount by mistake) and 2 winners, launches; two viewers join from the Extension; the
// round draws by itself; each winner's Bonbons (« Événements » in the Extension) went up by the share, once.

async function bonbons(browser: Browser, role: string) {
  const v = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await v.goto(`/ext/mobile.html?labRole=${role}`);
  await v.getByRole('button', { name: 'Voir tous les modules' }).click();
  await v
    .getByRole('button', { name: /^Événements/ })
    .first()
    .click();
  const pill = v.locator('.evs-pill');
  await expect(pill).toHaveText(/🍬 \d+/);
  const n = Number((await pill.innerText()).replace(/\D/g, ''));
  await v.close();
  return n;
}

test('Studio launches a Tombola in Bonbons; the winners joined from the Extension get their share, once', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const before = {
    viewer: await bonbons(browser, 'viewer'),
    moderator: await bonbons(browser, 'moderator'),
  };
  const s = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  await s.goto('/?tab=tombola');
  await s
    .getByRole('button', { name: /Montant fixe/ })
    .first()
    .click();
  await s
    .getByRole('button', { name: /^Bonbons/ })
    .first()
    .click();
  // Bonbons are counted in units: the Jetons-sized amount became 10, « Aléatoire » is off, the presets are small.
  await expect(s.locator('[data-cfg="fixed_amount"]')).toHaveValue('10');
  await expect(s.getByRole('button', { name: /Aléatoire/ })).toBeDisabled();
  // Each setting saved before the next (a click during the previous save would be overwritten by its answer).
  await s.locator('[data-fixed="20"]').click();
  await expect(s.locator('[data-cfg="fixed_amount"]')).toHaveValue('20');
  await s.waitForTimeout(800);
  await s
    .getByRole('button', { name: /Nombre fixe/ })
    .first()
    .click();
  await expect(s.locator('#tab-tombola')).toContainText('Nombre de gagnants');
  const count = s
    .getByText('Nombre de gagnants')
    .locator('..')
    .locator('input');
  await count.fill('2');
  await count.blur();
  await s.waitForTimeout(800);
  await s.getByRole('button', { name: '60 s' }).click();
  await s.waitForTimeout(800);
  await expect(s.locator('[data-cfg="fixed_amount"]')).toHaveValue('20');
  await expect(s.locator('#tab-tombola')).toContainText('Bonbons');
  await s
    .getByRole('button', { name: /Lancer la Tombola/ })
    .first()
    .click();
  // Two viewers join from the Extension.
  for (const role of ['viewer', 'moderator']) {
    const v = await browser.newPage({ viewport: { width: 400, height: 800 } });
    await v.goto(`/ext/mobile.html?labRole=${role}`);
    await v.getByRole('button', { name: 'Voir tous les modules' }).click();
    await v
      .getByRole('button', { name: /^Tombola/ })
      .first()
      .click();
    await v.getByRole('button', { name: 'Je participe' }).click();
    await expect(v.getByRole('button', { name: 'Je participe' })).toHaveCount(
      0,
      { timeout: 10_000 },
    );
    await v.close();
  }
  // The round closes and draws by itself (60 s); each of the 2 winners gets 20 / 2 = 10 Bonbons.
  await expect
    .poll(async () => (await bonbons(browser, 'viewer')) - before.viewer, {
      timeout: 120_000,
      intervals: [3000],
    })
    .toBe(10);
  expect((await bonbons(browser, 'moderator')) - before.moderator).toBe(10);
  // Read again later: still credited once.
  await s.waitForTimeout(4000);
  expect((await bonbons(browser, 'viewer')) - before.viewer).toBe(10);
});
