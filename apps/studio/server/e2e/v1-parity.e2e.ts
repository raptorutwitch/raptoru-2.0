import { expect, test, type Page } from '@playwright/test';
import { isolate } from './isolation.js';

// Parity of the V1 screens the production extension still carries (TTS V1, Tombola V1, moderation V1): shown whenever a
// backend does not announce the V2 (`tts_v2`, `raffle_v2`, `moderation_v2`) — a Lab without Core, the calibration build,
// the TTS of a Core whose config is unreachable. Written BEFORE their extraction from ui.js: the same expectations must
// hold after. The extension runs in DEMO mode (shared/runtime-config.js answered here): every answer comes from its own
// local fixtures (demo-data.js); the stack only serves the files. No request leaves.

const DEMO_RUNTIME = `export const RUNTIME = Object.freeze({ mode: 'demo', apiBase: '', siteUrl: '', buildId: 'e2e-demo' });`;

async function demo(page: Page, scenario = 'paid', width = 400) {
  await page.setViewportSize({ width, height: 800 });
  const iso = await isolate(page);
  await page.route('**/shared/runtime-config.js', (route) =>
    route.fulfill({ body: DEMO_RUNTIME, contentType: 'text/javascript' }),
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`/ext/mobile.html?demoScenario=${scenario}`);
  return { ...iso, errors };
}
async function openModule(page: Page, tile: RegExp) {
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page
    .getByRole('button', { name: tile })
    .filter({ visible: true })
    .first()
    .click();
}
const back = (page: Page) =>
  page.getByRole('button', { name: 'Retour au Hub' }).click();
const flash = (page: Page) => page.locator('.jdm-flash--ok');

test('TTS V1 (viewer): quote, send in tokens, draft kept across visits, credits, unavailable states', async ({
  page,
}) => {
  const { outside, errors } = await demo(page);
  await openModule(page, /^TTS/);
  const field = page.getByRole('textbox', { name: 'Message TTS' });
  await expect(field).toBeVisible();
  await expect(page.locator('.jdm-tts-help')).toHaveText(
    'Écris du texte pour le faire lire à l’oral sur le stream.',
  );
  await expect(page.locator('.jdm-tts-actions')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await expect(page.locator('.jdm-tts-credit-hint')).toContainText(
    /1\s000 points/,
  );
  // A draft survives a visit of the Hub.
  await field.fill('Bonjour le chat');
  await expect(page.locator('.jdm-counter')).toHaveText('15/800');
  await expect(page.locator('.jdm-tts-help')).toHaveText('15 caractères');
  await back(page);
  await openModule(page, /^TTS/);
  await expect(field).toHaveValue('Bonjour le chat');
  // Tokens: the CTA carries the price; the wallet shows the tokens.
  const cta = page.locator('.rl-pay--tts [aria-label^="Envoyer pour"]');
  await expect(cta).toHaveAttribute(
    'aria-label',
    /^Envoyer pour 7\s500 jetons$/,
  );
  await expect(
    page.locator('.jdm-module-screen').locator('[data-wallet-mode]').first(),
  ).toHaveAttribute('data-wallet-mode', 'tokens');
  await cta.click();
  await expect(flash(page)).toHaveText(
    /Action envoyée ✓|Action mise en file ✓/,
  );
  await expect(field).toHaveValue('');
  // Credits: one pending TTS reward = one use.
  await field.fill('Avec un crédit');
  await page
    .locator('.rl-pay--tts')
    .getByRole('button', { name: /crédit/i })
    .first()
    .click();
  await expect(page.locator('.jdm-module__body')).toHaveAttribute(
    'data-payment-method',
    'credits',
  );
  // The header wallet follows: it shows the TTS credits (one pending reward = 1).
  const headerWallet = page.locator(
    '.jdm-module__screen-head [data-wallet-mode]',
  );
  await expect(headerWallet).toHaveAttribute('data-wallet-mode', 'credits');
  await expect(headerWallet).toHaveAttribute('data-wallet-exact-value', '1');
  await expect(
    page.locator('.rl-pay--tts [aria-label^="Envoyer pour"]'),
  ).toHaveAttribute('aria-label', 'Envoyer pour 1 crédit');
  await page.locator('.rl-pay--tts [aria-label^="Envoyer pour"]').click();
  await expect(flash(page)).toBeVisible();
  await expect(field).toHaveValue('');
  // No credit left: the method stays chosen, the CTA says why it is unavailable.
  await field.fill('Encore');
  await expect(page.locator('.rl-pay--tts')).toContainText(
    'Crédits TTS indisponibles',
  );
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});

test('TTS V1: too few tokens disables the CTA with its reason', async ({
  page,
}) => {
  const { outside, errors } = await demo(page, 'empty');
  await openModule(page, /^TTS/);
  await page.getByRole('textbox', { name: 'Message TTS' }).fill('Pas assez');
  await expect(page.locator('.rl-pay--tts')).toContainText(
    'Jetons insuffisants ou solde indisponible',
  );
  await expect(
    page.locator('.rl-pay--tts [aria-label^="Envoyer pour"]'),
  ).toBeDisabled();
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});

test('Tombola V1 (viewer): open window, countdown, join once, history drawer with Escape, closed state', async ({
  page,
}) => {
  const { outside, errors } = await demo(page);
  await openModule(page, /^Tombola/);
  const screen = page.locator('.jdm-raffle-screen');
  await expect(screen).toHaveAttribute('data-raffle-state', 'active');
  await expect(page.locator('[data-raffle-status="open"]')).toHaveText(
    /Ouverte/,
  );
  const timer = page.locator('.jdm-raffle-timer');
  const first = Number(await timer.getAttribute('data-seconds'));
  expect(first).toBeGreaterThan(30);
  await expect
    .poll(async () => Number(await timer.getAttribute('data-seconds')), {
      timeout: 4000,
    })
    .toBeLessThan(first);
  // Join: confirmed once, the button stays « Inscrit ✓ » across the host's redraws.
  await page.getByRole('button', { name: 'S’inscrire à la Tombola' }).click();
  await expect(
    page.getByRole('button', { name: 'Participation confirmée' }),
  ).toBeDisabled();
  await expect(flash(page)).toHaveText('Inscription confirmée ✓');
  await back(page);
  await openModule(page, /^Tombola/);
  await expect(
    page.getByRole('button', { name: 'Participation confirmée' }),
  ).toBeDisabled();
  // History drawer: opens, Escape closes it and gives the focus back to its toggle.
  await page
    .getByRole('button', { name: 'Ouvrir l’historique Tombola' })
    .click();
  const panel = page.locator('#raffle-history-panel');
  await expect(panel).toHaveClass(/is-open/);
  await expect(panel).toContainText(/@MisterJDM · 5\s000/);
  await page.keyboard.press('Escape');
  await expect(panel).not.toHaveClass(/is-open/);
  await expect(
    page.getByRole('button', { name: 'Ouvrir l’historique Tombola' }),
  ).toBeFocused();
  // Leaving the module stops the countdown and forgets the drawer.
  await page
    .getByRole('button', { name: 'Ouvrir l’historique Tombola' })
    .click();
  await back(page);
  await openModule(page, /^Tombola/);
  await expect(page.locator('#raffle-history-panel')).not.toHaveClass(
    /is-open/,
  );
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});

test('Tombola V1: a closed raffle shows its last result', async ({ page }) => {
  const { outside, errors } = await demo(page, 'raffle_result');
  await openModule(page, /^Tombola/);
  await expect(page.locator('.jdm-raffle-screen')).toHaveAttribute(
    'data-raffle-state',
    'inactive',
  );
  await expect(page.locator('[data-raffle-status="closed"]')).toHaveText(
    /Fermée/,
  );
  await expect(page.locator('.jdm-raffle-result')).toHaveAttribute(
    'data-result-state',
    'revealed',
  );
  await expect(page.locator('.jdm-raffle-timer')).toHaveAttribute(
    'data-seconds',
    '0',
  );
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});

test('moderation V1 (moderator): tabs by keyboard, TTS controls confirmed, pending decision, users, modules, history', async ({
  page,
}) => {
  const { outside, errors } = await demo(page, 'moderator');
  await openModule(page, /^Modération/);
  const console_ = page.getByRole('region', { name: 'Console de modération' });
  await expect(console_).toBeVisible();
  // Tabs: arrows move the selection (roving tablist).
  const tab = (name: string) => page.getByRole('tab', { name });
  await tab('TTS urgence').click();
  await expect(tab('TTS urgence')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.jdm-moderation__tts-status')).toHaveText(
    'Actif · 1 en attente',
  );
  await tab('TTS urgence').press('ArrowRight');
  await expect(tab('Historique')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('Historique')).toBeFocused();
  await tab('Historique').press('ArrowLeft');
  await expect(tab('TTS urgence')).toHaveAttribute('aria-selected', 'true');
  // TTS controls: accepted, then confirmed by the control status.
  await page.getByRole('button', { name: 'Pause TTS' }).click();
  await expect(console_.locator('.jdm-flash--ok')).toHaveText('TTS en pause ✓');
  await expect(page.locator('.jdm-moderation__tts-status')).toHaveText(
    'En pause · 1 en attente',
  );
  await page.getByRole('button', { name: 'Reprendre le TTS' }).click();
  await expect(console_.locator('.jdm-flash--ok')).toHaveText('TTS repris ✓');
  await page.getByRole('button', { name: 'Stop TTS' }).click();
  await expect(console_.locator('.jdm-flash--ok')).toHaveText('TTS arrêté ✓');
  await expect(
    page.getByRole('group', { name: 'Actions TTS pour @viewer_test' }),
  ).toBeVisible();
  // The other tabs draw their panels.
  await tab('Historique').click();
  await expect(page.locator('#moderation-panel')).toContainText('viewer_test');
  await tab('Utilisateurs').click();
  await expect(page.locator('#moderation-panel')).toBeVisible();
  await tab('Modules').click();
  await expect(page.locator('#moderation-panel')).toContainText('Soundboard');
  // The selected tab survives a visit of the Hub (host memory of the panel).
  await back(page);
  await openModule(page, /^Modération/);
  await expect(tab('Modules')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});

test('moderation V1 (moderator): find a user, adjust credits, user history drawer closes on Escape (focus back)', async ({
  page,
}) => {
  const { outside, errors } = await demo(page, 'moderator');
  page.on('dialog', (d) => d.accept());
  await openModule(page, /^Modération/);
  await page.getByRole('tab', { name: 'Utilisateurs' }).click();
  await page
    .getByRole('searchbox', { name: 'Rechercher un utilisateur' })
    .or(page.getByRole('textbox', { name: 'Rechercher un utilisateur' }))
    .fill('viewer');
  await page
    .getByRole('button', { name: 'Rechercher cet utilisateur' })
    .click();
  await page
    .getByRole('button', { name: 'Ouvrir le profil de @viewer_test' })
    .click();
  const card = page
    .getByRole('group', { name: 'Actions pour @viewer_test' })
    .or(page.getByLabel('Actions pour @viewer_test'));
  await expect(card.first()).toBeVisible();
  await page
    .getByRole('button', { name: 'Ajouter des crédits Soundboard' })
    .click();
  await expect(page.locator('.jdm-flash--error')).toHaveCount(0);
  // The user's history: a drawer; Escape closes it and gives the focus back to its toggle.
  const toggle = page.getByRole('button', {
    name: 'Afficher l’historique de @viewer_test',
  });
  await toggle.click();
  const drawer = page.getByRole('dialog', {
    name: 'Historique de @viewer_test',
  });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(toggle).toBeFocused();
  // The selected user is the console's, not the visit's: still there after a Hub visit.
  await back(page);
  await openModule(page, /^Modération/);
  await expect(
    page.getByRole('button', { name: 'Afficher l’historique de @viewer_test' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});
