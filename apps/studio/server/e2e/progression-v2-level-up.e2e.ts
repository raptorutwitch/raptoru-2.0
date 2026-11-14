import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

// Level Up V2 in the Lab, end to end in real browsers (docs/PROGRESSION.md): Studio activates the 1 000 XP levels (typed
// confirmation) and the announcements; « Viewer Lab » chooses « Sonore » in the production Extension (kept by Core across
// a reload); Kirito_TV one XP short of level 2 sends one chat message → Core records the level-up →
// Studio's OBS « Level Up » source shows « Kirito_TV passe niveau 2 ! » with the sound; Studio lists it. Isolated stack:
// no Twitch, no real data.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const core = () =>
  JSON.parse(
    readFileSync(join(tmpdir(), `raptoru-e2e-core-${PORT}.json`), 'utf8'),
  ) as { url: string; secret: string };
const labCore = async (path: string, body: unknown) => {
  const { url, secret } = core();
  const r = await fetch(url + path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};

test('Level Up V2: activated in Studio, « Sonore » chosen in the extension, a chat message crosses level 2, the OBS source shows it with its sound', async ({
  page,
  browser,
}) => {
  // Studio: progression on, Level Up V2 (typed confirmation), announcements on.
  await page.goto('/?tab=progression');
  const tab = page.locator('#tab-progression');
  // Progression on (it may already be: the stack is shared with the other tests).
  const on = tab.getByRole('button', { name: 'Activer', exact: true });
  if (await on.isVisible()) await on.click();
  await expect(
    tab.getByRole('button', { name: 'Désactiver', exact: true }),
  ).toBeVisible();
  page.once('dialog', (d) => void d.accept('NORMALISER LES NIVEAUX'));
  await tab.getByRole('button', { name: 'Activer Level Up V2…' }).click();
  await expect(tab).toContainText('Level Up V2 activé.');
  await expect(tab).toContainText('fixe, 1 000 XP par niveau');
  await tab.getByRole('button', { name: 'Activer les annonces' }).click();
  await expect(tab).toContainText('Couper les annonces');

  // The viewer chooses « Sonore » in the production Extension (Lab EBS → Lab Core, kept by Core).
  const ext = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await ext.goto('/ext/mobile.html?labRole=viewer');
  await ext.locator('.jdm-viewer-preferences-toggle').first().click();
  await ext.getByRole('radio', { name: 'Sonore' }).check();
  await expect(ext.getByRole('radio', { name: 'Sonore' })).toBeChecked();
  await ext.reload();
  await ext.locator('.jdm-viewer-preferences-toggle').first().click();
  await expect(ext.getByRole('radio', { name: 'Sonore' })).toBeChecked(); // persisted by Core

  // The OBS « Level Up » source (its URL from Studio's panel).
  const state = await (
    await page.request.get('/api/level-up/state', {
      headers: { 'x-raptoru-studio': '1' },
    })
  ).json();
  const obs = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const sound = obs.waitForRequest((r) => r.url().endsWith('/level-up/sound'));
  await obs.goto(state.player_url.replace(/^http:\/\/[^/]+/, ''));

  // Kirito_TV (a viewer the Lab channel has seen) one XP short of level 2, « Sonore » (set from
  // Studio's viewer panel route); one chat message (5 XP) crosses level 2.
  // No Lab live is started (the other modules' tests share this stack): chat XP outside a live, for this test only.
  await labCore('/v1/lab/progression/settings', {
    rules: { live_only: false },
  });
  await labCore('/v1/lab/progression/adjust', {
    viewer: '57012345',
    mode: 'set_xp',
    value: 999,
    reason: 'e2e : juste avant le niveau 2',
    request_id: 'e2e-level-up-0002',
  });
  await labCore('/v1/lab/progression/viewers/57012345/notify', {
    level_up_notify: 'sound',
  });
  await labCore('/v1/lab/chat', {
    channel_id: '900100',
    message_id: randomUUID(),
    text: 'bonsoir tout le monde',
    chatter: {
      id: '57012345',
      login: 'kirito_tv',
      display_name: 'Kirito_TV',
      role: 'viewer',
    },
    source: 'simulator',
  });

  await expect(obs.locator('#stage')).toContainText(
    'Kirito_TV passe niveau 2 !',
    {
      timeout: 15_000,
    },
  );
  await sound;

  // Studio lists it: shown, with its sound.
  await page.reload();
  await expect(tab).toContainText('Kirito_TV');
  await expect(tab).toContainText('affiché 🔊');

  await labCore('/v1/lab/progression/settings', { rules: { live_only: true } });
});
