import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { isolate } from './isolation.js';

// The modules' lifecycle contract in the production Extension (mobile) on the isolated Lab stack, for every role:
// - one view per open module, nothing left behind by the module just closed (Hub → module → Hub → other → back);
// - a closed module stops its own reads (its timers and polling are released, measured over two host reads);
// - after a network cut, the open module catches up with what changed meanwhile (one view, no page error).
// No request leaves the machine (the 7TV/BTTV/FFZ CDN images are served locally, anything else is aborted and counted).

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
  return {
    status: r.status,
    body: (await r.json()) as Record<string, unknown>,
  };
};

/** Each module's own root in the page (its view, never two). */
const ROOTS = {
  tts: '.ttsv2',
  raffle: '.tmbx',
  soundboard: '.jdm-module__body .sbx-grid',
  bonk: '.rl-bonk-picker',
  moderation: '.modv2',
} as const;
type Mod = keyof typeof ROOTS;
const TILES: Record<Mod, RegExp> = {
  tts: /^TTS/,
  raffle: /^Tombola/,
  soundboard: /^Soundboard|^Sons/,
  bonk: /^Bonk/,
  moderation: /^Modération/,
};
/** What a module reads by itself while it is open (its own polling). */
const OWN_READS: Partial<Record<Mod, RegExp>> = {
  tts: /\/api\/tts\/state/,
  raffle: /\/api\/raffle\/state/,
  moderation: /\/api\/moderation\/v2\//,
};

async function preparePage(page: Page) {
  const { outside } = await isolate(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const requests: { at: number; url: string }[] = [];
  page.on('request', (r) => requests.push({ at: Date.now(), url: r.url() }));
  return { outside, errors, requests };
}
// Each closed module is watched over three host reads (a few seconds each): these journeys take a few minutes.
test.describe.configure({ timeout: 300_000 });

const hostRead = (page: Page) =>
  page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/api/state'),
    {
      timeout: 30_000,
    },
  );

async function open(page: Page, mod: Mod) {
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page
    .getByRole('button', { name: TILES[mod] })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.locator(ROOTS[mod])).toHaveCount(1, { timeout: 15_000 });
  // Bonk (visited once per test, so always a first visit): its tutorial modal opens shortly after; skipped as a viewer would.
  if (mod === 'bonk')
    await page.getByRole('button', { name: 'Passer' }).click();
  // TTS: wait for the settled screen (the view shows the viewer's current TTS after its first composer).
  if (mod === 'tts')
    await expect(page.locator('.ttsv2[data-recovered]')).toHaveCount(1, {
      timeout: 15_000,
    });
  for (const other of Object.keys(ROOTS) as Mod[])
    if (other !== mod) await expect(page.locator(ROOTS[other])).toHaveCount(0);
}
/** Back to the Hub; then the closed module must not read anything by itself over the next two host reads. */
async function leave(
  page: Page,
  mod: Mod,
  requests: { at: number; url: string }[],
) {
  if (mod === 'raffle')
    await page.locator('.tmbx [data-act="back"]').first().click();
  else
    await page.getByRole('button', { name: 'Retour au Hub' }).first().click();
  await expect(page.locator(ROOTS[mod])).toHaveCount(0);
  const own = OWN_READS[mod];
  if (!own) return;
  // A read already on its way may still land; what counts is a NEW one started after the first host read.
  await hostRead(page);
  const from = Date.now();
  await hostRead(page);
  await hostRead(page);
  expect(
    requests.filter((r) => r.at >= from && own.test(r.url)).map((r) => r.url),
  ).toEqual([]);
}

test('viewer: TTS → Tombola → Soundboard → Bonk → TTS without reloading: one view each, closed modules stop reading', async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  const { outside, errors, requests } = await preparePage(page);
  await page.goto('/ext/mobile.html?labRole=viewer');
  for (const mod of [
    'tts',
    'raffle',
    'soundboard',
    'bonk',
    'tts',
    'soundboard',
  ] as Mod[]) {
    await open(page, mod);
    await leave(page, mod, requests);
  }
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
  await page.close();
});

for (const role of ['moderator', 'broadcaster'] as const) {
  test(`${role}: D4 → TTS → Tombola → Soundboard → Bonk → D4 without reloading: one view each, closed modules stop reading`, async ({
    browser,
  }) => {
    const page = await browser.newPage({
      viewport: { width: 400, height: 800 },
    });
    const { outside, errors, requests } = await preparePage(page);
    await page.goto(`/ext/mobile.html?labRole=${role}`);
    for (const mod of [
      'moderation',
      'tts',
      'raffle',
      'soundboard',
      'bonk',
      'moderation',
    ] as Mod[]) {
      await open(page, mod);
      await leave(page, mod, requests);
    }
    expect(errors).toEqual([]);
    expect(outside).toEqual([]);
    await page.close();
  });
}

test('viewer, network cut: what changed meanwhile reaches the open module once back online (TTS price, Soundboard balance)', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 400, height: 800 },
  });
  const page = await context.newPage();
  const { outside, errors } = await preparePage(page);
  const rules = (await labCore('/v1/lab/tts/rules')).body.rules as {
    tiers: { price: number }[];
  };
  await page.goto('/ext/mobile.html?labRole=viewer');
  await open(page, 'tts');
  const again = page.locator('.ttsv2 [data-act="tts-again"]').first();
  if (await again.isVisible()) await again.click();
  await page.locator('.ttsv2 [data-msg]').fill('Hors ligne');
  const pay = page.locator('.ttsv2 [data-act="confirm"]');
  await expect(pay).toContainText(/7\D?500/);
  // Cut: the view's own read fails (deterministic: we wait for that failure), the price changes meanwhile.
  const failed = page.waitForEvent('requestfailed', {
    predicate: (r) => /\/api\/tts\/state/.test(r.url()),
    timeout: 30_000,
  });
  await context.setOffline(true);
  await failed;
  expect(
    (
      await labCore('/v1/lab/tts/rules', {
        actor: STUDIO,
        rules: {
          ...rules,
          tiers: rules.tiers.map((t, i) =>
            i === 0 ? { ...t, price: 8_000 } : t,
          ),
        },
      })
    ).status,
  ).toBe(200);
  await context.setOffline(false);
  await expect(pay).toContainText(/8\D?000/, { timeout: 20_000 });
  await expect(page.locator(ROOTS.tts)).toHaveCount(1);
  expect(await page.locator('.ttsv2 [data-msg]').inputValue()).toBe(
    'Hors ligne',
  ); // the typed text survived the cut
  await labCore('/v1/lab/tts/rules', { actor: STUDIO, rules });

  // Soundboard: the balance set while offline shows once back.
  await page.getByRole('button', { name: 'Retour au Hub' }).first().click();
  await open(page, 'soundboard');
  const hostFailed = page.waitForEvent('requestfailed', {
    predicate: (r) => new URL(r.url()).pathname.endsWith('/api/state'),
    timeout: 30_000,
  });
  await context.setOffline(true);
  await hostFailed;
  await labCore('/v1/lab/wallet/900100', {
    actor: STUDIO,
    viewer_id: '900101',
    op: 'set',
    tokens: 12_340,
  });
  await context.setOffline(false);
  await expect(
    page.getByRole('button', { name: /Jetons · 12 340 jetons/ }).first(),
  ).toBeAttached({
    timeout: 20_000,
  });
  await expect(page.locator(ROOTS.soundboard)).toHaveCount(1);
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
  await context.close();
});
