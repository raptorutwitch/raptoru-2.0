import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Parity of TTS V2 and Tombola V2 in the production Extension (mobile surface) → Lab EBS → Lab Core, the way a viewer
// uses them: open from the Hub, act, leave, come back without reloading; events that land while the screen is not shown
// or while it is open. Written BEFORE their extraction from ui.js (the same expectations must hold after). Fictional data.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const labCore = async (path: string, body?: unknown) => {
  const { url, secret } = JSON.parse(
    readFileSync(join(tmpdir(), `raptoru-e2e-core-${PORT}.json`), 'utf8'),
  ) as { url: string; secret: string };
  const r = await fetch(url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: r.status,
    body: (await r.json()) as Record<string, unknown>,
  };
};
const STUDIO = { id: 'studio', role: 'broadcaster', via: 'studio' };

async function open(page: Page, tile: RegExp) {
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  // The visible tile of the list (a Hub carousel card with the same name may be hidden behind it).
  await page.getByRole('button', { name: tile }).filter({ visible: true }).first().click();
}
const back = (page: Page) =>
  page.getByRole('button', { name: 'Retour au Hub' }).click();

test('TTS V2: open, send a message, leave and come back without reloading — one view, the request still shown', async ({
  browser,
}) => {
  // The Lab viewer (900101) gets enough fictional Jetons, as Studio's « Wallet de test » does.
  const funded = await labCore('/v1/lab/wallet/900100', {
    actor: STUDIO,
    viewer_id: '900101',
    op: 'set',
    tokens: 50_000,
  });
  expect(funded.status).toBe(200);
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.goto('/ext/mobile.html?labRole=viewer');
  await open(page, /^TTS/);
  await expect(page.locator('.ttsv2')).toHaveCount(1);
  await page.locator('.ttsv2 [data-msg]').fill('Bonjour la parité');
  // Available once the (fictional) player has reported in: a viewer waits for the enabled button too.
  const confirm = page.locator('.ttsv2 [data-act="confirm"]');
  await expect(confirm).toBeEnabled({ timeout: 15_000 });
  await confirm.click();
  await expect(
    page.getByRole('button', { name: 'Envoyer un autre message' }).first(),
  ).toBeVisible({
    timeout: 15_000,
  });
  await back(page);
  await expect(page.locator('.ttsv2')).toHaveCount(0);
  await open(page, /^Commandes$/);
  await back(page);
  await open(page, /^TTS/);
  await expect(page.locator('.ttsv2')).toHaveCount(1); // one view, never two
  await page.close();
});

test('Tombola V2: a round opened while away shows on return; join once; a chat !join arrives live; Hub and back keep it', async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.goto('/ext/mobile.html?labRole=viewer');
  await open(page, /^Tombola/);
  await expect(page.locator('.tmbx')).toHaveCount(1);
  await back(page);
  // While the viewer is on the Hub: Studio opens a round (Lab Core, as Studio's Tombola tab does).
  const opened = await labCore('/v1/lab/raffle/900100/actions', {
    actor: STUDIO,
    command: { action: 'launch', kind: 'auto' },
  });
  expect(opened.status).toBe(200);
  await open(page, /^Tombola/);
  const join = page.locator('.tmbx [data-act="join"]');
  await expect(join).toBeVisible({ timeout: 15_000 });
  await join.click();
  await expect(
    page.locator('.tmbx').getByText('Tu participes').first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tmbx [data-slot="count"]')).toContainText(
    '1 participants',
  );
  // While the screen is open: another viewer joins from the chat.
  const chat = await labCore('/v1/lab/chat', {
    channel_id: '900100',
    message_id: `e2e-join-${Date.now()}`,
    text: '!join',
    chatter: {
      id: '900777',
      login: 'chatteur',
      display_name: 'Chatteur',
      role: 'viewer',
    },
    source: 'simulator',
  });
  expect(chat.status).toBe(200);
  await expect(page.locator('.tmbx [data-slot="count"]')).toContainText(
    '2 participants',
    { timeout: 20_000 },
  );
  await back(page);
  await open(page, /^Tombola/);
  await expect(page.locator('.tmbx')).toHaveCount(1);
  await expect(
    page.locator('.tmbx').getByText('Tu participes').first(),
  ).toBeVisible();
  await expect(page.locator('.tmbx [data-slot="count"]')).toContainText(
    '2 participants',
  );
  await labCore('/v1/lab/raffle/900100/actions', {
    actor: STUDIO,
    command: { action: 'cancel' },
  });
  await page.close();
});
