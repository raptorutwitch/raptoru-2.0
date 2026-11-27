import { expect, test, type Page } from '@playwright/test';

// Casino (docs/CASINO.md) on the main Core of the Lab stack: Studio › Casino opens and closes it (module settings),
// says why nothing plays (closed, out of the live), lists the rounds the Core recorded and the refused ones. A viewer's
// spin goes through the extension's door (/ext-lab/api, the Lab viewer's token); Studio never spins.

const STUDIO = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

async function viewerToken(page: Page) {
  return (
    (await (await page.request.get('/ext-lab/token?role=viewer')).json()) as {
      token: string;
    }
  ).token;
}
async function spin(page: Page, key: string, bet: number) {
  const token = await viewerToken(page);
  return page.request.post('/ext-lab/api/casino/slot/spin', {
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    data: { bet },
  });
}

test('Studio › Casino: open, the live, a round recorded, a refusal counted; Studio never spins', async ({
  page,
}) => {
  await page.goto('/?p=casino');
  const tab = page.locator('#tab-casino');
  await expect(tab).toContainText('Machine à sous', { timeout: 15_000 });
  // Closed by default: a spin is refused before any payment, and Studio shows the refusal
  const closed = await spin(page, 'e2e-casino-closed-1', 100);
  expect(closed.status()).toBe(409);
  expect(((await closed.json()) as { error: string }).error).toBe(
    'casino_closed',
  );
  await expect(tab.locator('[data-z="refusals"]')).toContainText(
    'Casino fermé',
    { timeout: 10_000 },
  );
  // Open it from Studio (module setting casino.open)
  await page.request.post('/api/module-settings', {
    headers: STUDIO,
    data: { key: 'casino.open', value: 1 },
  });
  // The Lab follows its simulated live: off live, nothing plays
  const offline = await spin(page, 'e2e-casino-offline-1', 100);
  expect(((await offline.json()) as { error: string }).error).toBe(
    'stream_offline',
  );
  await page.goto('/?p=simulation');
  await page
    .locator('#tab-simulation')
    .getByRole('button', { name: 'Démarrer' })
    .click();
  await expect(page.locator('.sim-widget')).toContainText(
    'Live fictif en cours',
  );
  // A real round: paid on the Lab wallet, recorded, listed in Studio
  const ok = await spin(page, 'e2e-casino-ok-1', 100);
  expect(ok.status()).toBe(200);
  const round = ((await ok.json()) as { round: { round_id: string } }).round;
  const again = await spin(page, 'e2e-casino-ok-1', 100);
  expect(
    ((await again.json()) as { round: { round_id: string } }).round.round_id,
  ).toBe(round.round_id);
  await page.goto('/?p=casino');
  await expect(tab.locator('[data-z="list"]')).toContainText('Machine', {
    timeout: 10_000,
  });
  await expect(tab.locator('[data-z="day"]')).toContainText('Machine');
  // « Dernières parties » by player: two more rounds of the same viewer → still one line; opened, their whole history.
  expect((await spin(page, 'e2e-casino-ok-2', 100)).status()).toBe(200);
  expect((await spin(page, 'e2e-casino-ok-3', 200)).status()).toBe(200);
  const players = tab.locator('[data-z="list"] .cz-pl');
  await expect(players).toHaveCount(1, { timeout: 10_000 });
  await expect(players.first()).toContainText('3 parties récentes', {
    timeout: 10_000,
  });
  await players.first().locator('.cz-pl__row').click();
  await expect(players.first().locator('.cz-op')).toHaveCount(3, {
    timeout: 10_000,
  });
  await expect(players.first()).toContainText('3 parties au total');
  await expect(players.first()).toContainText('mise −200');
  await page.screenshot({
    path: test.info().outputPath('studio-casino-players.png'),
    fullPage: true,
  });
  await page.screenshot({
    path: test.info().outputPath('studio-casino.png'),
    fullPage: true,
  });
  // Studio never plays for a viewer: the cockpit refuses every casino path but admin/…
  const forbidden = await page.request.post('/api/casino/state', {
    headers: STUDIO,
    data: {},
  });
  expect(forbidden.status()).toBe(404);
  await page.goto('/?p=simulation');
  await page
    .locator('#tab-simulation')
    .getByRole('button', { name: 'Terminer' })
    .click();
});
