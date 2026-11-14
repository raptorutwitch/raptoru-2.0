import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

// Level Up V2 in the Lab, end to end in real browsers (docs/LEVEL_UP_V2.md): Studio › Progression › Level Up activates the
// 1 000 XP levels (typed confirmation), turns the chat and stream announcements on and creates the level-10 badge; the
// production Extension shows « Mon niveau » and keeps the viewer's mode (Core); Kirito_TV one message short of level 10
// sends one chat message → Core records the level-up → ONE chat line on the commands outbox, the badge in the inventory,
// Studio's OBS « Level Up » source shows « Kirito_TV passe niveau 10 » with the sound; Studio lists it. Isolated stack:
// no Twitch, no real data.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const CHANNEL = '900100';
const KIRITO = '57012345';
const core = () =>
  JSON.parse(
    readFileSync(join(tmpdir(), `raptoru-e2e-core-${PORT}.json`), 'utf8'),
  ) as { url: string; secret: string };
const labCore = async <T = Record<string, unknown>>(
  path: string,
  body?: unknown,
): Promise<T> => {
  const { url, secret } = core();
  const r = await fetch(url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
};

test('Level Up V2: activated in Studio, announced in chat and on stream, the level-10 badge given, « Mon niveau » in the extension', async ({
  page,
  browser,
}) => {
  await page.goto('/?tab=progression');
  const tab = page.locator('#tab-progression');
  const toasts = page.locator('.d-toasts');
  // Progression on (it may already be: the stack is shared with the other tests).
  const on = tab.getByRole('button', { name: 'Activer', exact: true });
  if (await on.isVisible()) await on.click();
  await expect(tab.locator('.d-state')).toContainText('Activée');

  // Studio › Level Up: the typed confirmation activates 1 000 XP per level.
  await tab.getByRole('button', { name: 'Level Up', exact: true }).click();
  const lu = tab.locator('.pg-lu');
  await lu.getByRole('button', { name: 'Activer Level Up V2…' }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.locator('[data-text]').fill('NORMALISER LES NIVEAUX');
  await dlg.getByRole('button', { name: 'Activer' }).click();
  await expect(toasts).toContainText('Level Up V2 activé.');
  await expect(lu).toContainText('Fixe : 1 000 XP par niveau');

  // The announcements on (chat and stream), « Sortie chat réelle » on for this Lab channel, the badge of level 10.
  await lu
    .locator('input[data-lu-rule="level_up_chat"]')
    .check({ force: true });
  await expect(toasts).toContainText('Activé.');
  await lu
    .locator('input[data-lu-rule="level_up_notifications"]')
    .check({ force: true });
  await labCore(`/v1/lab/commands/${CHANNEL}/output`, {
    actor: { id: 'e2e' },
    enabled: true,
  });
  await lu.locator('[data-lu-badge="10"]').click();
  await expect(toasts).toContainText('Badge du niveau 10 créé');
  await expect(lu).toContainText('sans image');

  // The extension: « Mon niveau » and the three-way choice, the default « Sonore », « Écrit » kept by Core.
  const ext = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await ext.goto('/ext/mobile.html?labRole=viewer');
  await ext.locator('.jdm-viewer-preferences-toggle').first().click();
  await expect(ext.locator('.jdm-viewer-level')).toContainText('Niveau 1');
  await expect(ext.getByRole('radio', { name: 'Sonore' })).toBeChecked();
  await ext.getByRole('radio', { name: 'Écrit' }).check();
  await ext.reload();
  await ext.locator('.jdm-viewer-preferences-toggle').first().click();
  await expect(ext.getByRole('radio', { name: 'Écrit' })).toBeChecked(); // kept by Core

  // The OBS « Level Up » source (its URL from Studio's panel).
  const state = await (
    await page.request.get('/api/level-up/state', {
      headers: { 'x-raptoru-studio': '1' },
    })
  ).json();
  const obs = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const sound = obs.waitForRequest((r) => r.url().endsWith('/level-up/sound'));
  await obs.goto(state.player_url.replace(/^http:\/\/[^/]+/, ''));

  // Kirito_TV (a viewer the Lab channel has seen, no mode chosen: the channel's default « Sonore ») one message short of
  // level 10; one chat message (5 XP) crosses it. No Lab live is started (the stack is shared): chat XP outside a live,
  // for this test only.
  await labCore('/v1/lab/progression/settings', {
    rules: { live_only: false },
  });
  await labCore('/v1/lab/progression/adjust', {
    viewer: KIRITO,
    mode: 'set_xp',
    value: 8_996,
    reason: 'e2e : juste avant le niveau 10',
    request_id: 'e2e-level-up-0010',
  });
  await labCore('/v1/lab/chat', {
    channel_id: CHANNEL,
    message_id: randomUUID(),
    text: 'bonsoir tout le monde',
    chatter: {
      id: KIRITO,
      login: 'kirito_tv',
      display_name: 'Kirito_TV',
      role: 'viewer',
    },
    source: 'simulator',
  });

  // On stream: the notice and its sound.
  await expect(obs.locator('#stage')).toContainText('Kirito_TV passe', {
    timeout: 15_000,
  });
  await expect(obs.locator('#stage')).toContainText('niveau 10');
  await sound;

  // In chat: one line on the commands outbox (LeCroupier_ sends it).
  const steps = await labCore(`/v1/lab/commands/${CHANNEL}/steps`);
  expect(JSON.stringify(steps)).toContain(
    'Kirito_TV vient d’atteindre le niveau 10 !',
  );

  // The badge of level 10, given by the level-up (no image yet).
  const kirito = await labCore<{ inventory: { id: string }[] }>(
    `/v1/lab/progression/viewers/${KIRITO}`,
  );
  expect(kirito.inventory.map((i) => i.id)).toContain('niveau-10');

  // Studio lists it: sent in chat, shown on stream with its sound.
  await expect(lu.locator('.pg-lu-t')).toContainText('Kirito_TV', {
    timeout: 10_000,
  });
  await expect(lu.locator('.pg-lu-t')).toContainText('envoyé');
  await expect(lu.locator('.pg-lu-t')).toContainText('affiché 🔊');

  await labCore('/v1/lab/progression/settings', { rules: { live_only: true } });
  await labCore(`/v1/lab/commands/${CHANNEL}/output`, {
    actor: { id: 'e2e' },
    enabled: false,
  });
});
