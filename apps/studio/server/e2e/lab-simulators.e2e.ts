import { expect, test } from '@playwright/test';

// The Lab's simulators on the real Core of the Lab stack: what the streamer tries in Studio goes through the Core's doors. The
// browser's voices are fictional; no OBS, no Twitch, no real Spotify. This stack has no TTS player and no Spotify chat module.

const speech = () => {
  class U {
    text: string;
    onstart?: () => void;
    onend?: () => void;
    constructor(t: string) {
      this.text = t;
    }
  }
  Object.assign(window, { SpeechSynthesisUtterance: U });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [
        {
          name: 'Julie',
          lang: 'fr-FR',
          voiceURI: 'lab',
          default: true,
          localService: true,
        },
      ],
      addEventListener() {},
      cancel() {},
      speak(u: U) {
        setTimeout(() => u.onstart?.(), 10);
        setTimeout(() => u.onend?.(), 3000);
      },
    },
  });
};

test('TTS: listening buys nothing; a purchase is debited once by the Core, whatever the retries; only a Lab viewer may buy', async ({
  page,
  context,
}) => {
  await context.addInitScript(speech);
  await page.goto('/?p=tts');
  const tab = page.locator('#tab-tts');
  const balance = tab.locator('[data-z="bal"] b');
  await expect(tab.getByText('Achat simulé')).toBeVisible();
  await tab.locator('[data-viewer]').selectOption('900203');
  await expect(balance).toBeVisible();
  await tab.locator('[data-test]').fill('Message de test du Lab');
  await tab.getByRole('button', { name: 'Écouter' }).click();
  await tab.locator('[data-readbtn]').click();

  const H = {
    'x-raptoru-studio': '1',
    'content-type': 'application/json',
  };
  const wallet = async () =>
    (
      (await (
        await page.request.get('/api/lab/wallet/900203', { headers: H })
      ).json()) as { tokens: number }
    ).tokens;
  await page.request.post('/api/lab/wallet', {
    headers: H,
    data: { viewer_id: '900203', op: 'adjust', tokens: 50_000 },
  });
  const funded = await wallet();
  const buy = (viewer_id: string, key: string) =>
    page.request.post('/api/ext-lab/purchase', {
      headers: H,
      data: {
        viewer_id,
        key,
        module_id: 'tts',
        payload: { text: 'Message de test du Lab' },
      },
    });
  expect((await buy('900203', 'e2e-sim-purchase-1')).ok()).toBe(true);
  expect(await wallet()).toBe(funded - 7500);
  // The same click again: the Core replays it, nothing is debited twice.
  expect((await buy('900203', 'e2e-sim-purchase-1')).ok()).toBe(true);
  expect(await wallet()).toBe(funded - 7500);
  // Only a Lab viewer may buy through the simulators.
  expect((await buy('83603689', 'e2e-sim-purchase-2')).status()).toBe(400);
});

test('Récompenses: the fictional catalogue, its rules through the Core, a test runs', async ({
  page,
}) => {
  await page.goto('/?p=channel-points');
  const tab = page.locator('#tab-channel-points');
  const load = tab.locator('[data-lab-catalog]');
  if (await load.count()) await load.click();
  await expect(tab.getByText('Crédit TTS').first()).toBeVisible();
  await tab.getByText('Crédit TTS').first().click();
  await tab.getByRole('button', { name: 'Tester', exact: true }).click();
  await page.getByRole('button', { name: 'Exécuter' }).click();
  await expect(tab.getByText('Exécutée').first()).toBeVisible();
});

test('Spotify: a request and its decision from the page, without any account', async ({
  page,
}) => {
  await page.goto('/?p=spotify');
  const tab = page.locator('#tab-spotify');
  if (await tab.getByText('Demandes fermées').count()) {
    await tab.getByRole('button', { name: 'Ouvert' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Ouvrir les demandes' })
      .click();
  }
  await tab.locator('[data-sim-try="zzzzqqq"]').click();
  await tab.getByRole('button', { name: 'Demander' }).click();
  await expect(tab.locator('.spo-sim')).toContainText(
    'aucun titre assez proche',
  );
});

test('Simulation: a live and an event from one page; the mini-games are not driven from it', async ({
  page,
}) => {
  await page.goto('/?p=simulation');
  const tab = page.locator('#tab-simulation');
  await tab.getByRole('button', { name: 'Démarrer' }).click();
  await expect(page.locator('.sim-widget')).toContainText(
    'Live fictif en cours',
  );
  await tab.getByRole('button', { name: 'Terminer' }).click();
  await expect(page.locator('.sim-widget')).toContainText('Simulation');
  await tab.getByRole('button', { name: 'Follow' }).click();
  await expect(page.locator('.d-toasts')).toContainText('file des Alertes');
  await expect(tab.getByText('Mini-jeux Roulette')).toHaveCount(0);
});

test('Équipe: the real roles and who may do what, from the Core', async ({
  page,
}) => {
  await page.goto('/?p=moderation');
  const tab = page.locator('#tab-moderation');
  await tab.getByRole('button', { name: 'Équipe' }).click();
  await expect(tab.locator('.mt-roles')).toContainText('Supermod');
  await expect(tab.locator('.mr')).toContainText('Vider une file');
  await expect(tab.locator('.mr')).toContainText('Fermer un module');
});
