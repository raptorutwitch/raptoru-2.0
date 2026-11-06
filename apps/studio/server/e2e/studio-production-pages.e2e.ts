import { expect, test, type Page } from '@playwright/test';

// The pages moved out of Système and of the Extension Lab, as Studio shows them in the PRODUCTION profile. Nothing real
// here: only the profile's answer is replaced in the browser, so the screens choose their Production wording and controls.

async function asProduction(page: Page) {
  await page.route('**/api/profile', (route) =>
    route.fulfill({
      json: {
        selected: 'production',
        effective: 'production',
        production: { state: 'connected', detail: null },
      },
    }),
  );
  // The players' runtimes, as a Production Studio reports them (this stack starts none).
  await page.route('**/api/tts-lab/status', (route) =>
    route.fulfill({
      json: { enabled: true, ready: true, overlayUrl: 'http://127.0.0.1/tts' },
    }),
  );
  await page.route('**/api/sound-lab/status', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        ready: false,
        playerUrl: '/sound-lab/player.html',
      },
    }),
  );
  await page.route('**/api/bonk-lab/status', (route) =>
    route.fulfill({
      json: { enabled: true, ready: true, overlayUrl: 'http://127.0.0.1/bonk' },
    }),
  );
}

test('TTS and Bonk have their page, with the Production card', async ({
  page,
}) => {
  await asProduction(page);
  await page.goto('/?p=tts');
  await expect(
    page.getByRole('heading', { level: 1, name: 'TTS' }),
  ).toBeVisible();
  await expect(
    page.getByRole('tab', { name: 'Prix et limites' }),
  ).toBeVisible();
  // Production: pause and stop stay in Modération; the Lab's buttons are absent.
  await expect(
    page.getByRole('button', { name: 'Pause', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('onglet « Modération »')).toBeVisible();
  await page.getByRole('tab', { name: 'Prix et limites' }).click();
  await expect(page.getByText('Paliers de prix')).toBeVisible();

  await page.goto('/?p=bonk');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Bonk' }),
  ).toBeVisible();
  const bonk = page.locator('#tab-bonk');
  await expect(bonk.getByText('Prix et délai')).toBeVisible();
  await bonk.getByRole('button', { name: 'Réglages' }).click();
  await expect(bonk.getByText('Connexion OBS', { exact: true })).toBeVisible();
  await expect(bonk.getByLabel('URL de la source OBS Bonk')).toBeVisible();
});

test('the Soundboard player is loaded at launch, whichever page opens first', async ({
  page,
}) => {
  await asProduction(page);
  await page.goto('/?p=centre');
  // Hidden with its page, but loaded: the Core refuses a purchase while it is absent.
  const player = page.locator(
    '#tab-soundboard iframe[title="Lecteur Soundboard"]',
  );
  await expect(player).toHaveAttribute('src', /sound-lab/, { timeout: 15_000 });
  await page.goto('/?p=soundboard');
  await expect(player).toBeVisible();
});

test('Système: the Lab tools are gone in Production, the tabs stay', async ({
  page,
}) => {
  await asProduction(page);
  await page.goto('/?p=systeme');
  await expect(page.getByRole('tab', { name: 'Services' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Outils' })).toBeHidden();
  await page.getByRole('tab', { name: 'Journal' }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Journal' })).toHaveAttribute(
    'aria-selected',
    'false',
  );
});
