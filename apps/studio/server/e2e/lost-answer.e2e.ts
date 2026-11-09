import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Audit 09/11 (P1) — a purchase whose ANSWER is lost (mobile network): Core committed the debit and the sound, the
// browser saw a network error, the viewer clicks « Envoyer » again. Before: a new Idempotency-Key → a second debit and a
// second sound. Now the same key is re-sent: Core answers the first purchase, the Jetons go down once.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const STUDIO = { id: 'studio', role: 'broadcaster', via: 'studio' };
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
  return { status: r.status, body: (await r.json()) as { tokens?: number } };
};
const tokens = async () =>
  (await labCore('/v1/lab/wallet/900100/900101')).body.tokens ?? -1;

test('Soundboard: the answer of a paid send is lost, the viewer sends again — debited once', async ({
  browser,
}) => {
  await labCore('/v1/lab/wallet/900100', {
    actor: STUDIO,
    viewer_id: '900101',
    op: 'set',
    tokens: 20_000,
  });
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.goto('/ext/mobile.html?labRole=viewer');
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page
    .getByRole('button', { name: /^Soundboard|^Sons/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.locator('.sbx-status.is-online')).toBeAttached({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Sélectionner Boop' }).click();
  const send = page
    .locator('.sbx-dock')
    .getByRole('button', { name: /^Envoyer/ });
  await expect(send).toBeEnabled({ timeout: 15_000 });

  // The purchase reaches Core (committed), its answer never reaches the page (the client's own retry too).
  const keys: string[] = [];
  let cut = 0;
  await page.route('**/actions/tokens', async (route) => {
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    if (cut < 2) {
      cut++;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await send.click();
  await expect.poll(tokens, { timeout: 15_000 }).toBeLessThan(20_000);
  const once = await tokens();
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Envoyé au stream' }),
  ).toBeVisible({ timeout: 15_000 });
  // The second click re-sent the same key: Core replayed the first purchase, nothing more was debited.
  expect(new Set(keys).size).toBe(1);
  await page.waitForTimeout(1_000);
  expect(await tokens()).toBe(once);
  await page.close();
});
