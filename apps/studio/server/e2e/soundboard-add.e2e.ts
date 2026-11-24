import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Studio › Soundboard › « Ajouter un son » (docs/SOUNDBOARD.md § Ajouter un son): a local file, its waveform, the two
// handles, the exact listening of the cut, name and price, publication; the viewer then sees it in the extension,
// previews it (the Core's file, as a blob) and buys it; the sound is re-cut from its kept original, then removed.
// Isolated Lab stack, fictional data; the file is one of the extension's own MP3s.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const STUDIO = { id: 'studio', role: 'broadcaster', via: 'studio' };
const MP3 = join(
  import.meta.dirname,
  '../../../twitch-extension/extension/assets/sounds/erenscream.mp3',
);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read answers
  return { status: r.status, body: (await r.json()) as Record<string, any> };
};
type Sound = {
  id: string;
  label: string;
  source: string;
  file_id: string | null;
  token_cost: number;
  credit_cost: number;
  duration_ms: number;
};
const added = async () =>
  ((await labCore('/v1/lab/sound/config')).body.sounds as Sound[]).find(
    (s) => s.source === 'studio',
  );

async function openSoundboard(page: Page) {
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page
    .getByRole('button', { name: /^Soundboard|^Sons/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.locator('.sbx-status.is-online')).toBeAttached({
    timeout: 20_000,
  });
}
const cards = (page: Page) =>
  page.locator('.jdm-module__body .sbx-card:visible');

test('Studio: add a sound (cut, listen, name, price, publish) → the viewer previews and buys it → re-cut from its original → removed', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?tab=soundboard');
  const tab = page.locator('#tab-soundboard');
  const toasts = page.locator('.d-toasts');
  const dlg = page.locator('dialog.sbe');

  // --- Add ----------------------------------------------------------------------------------------------------------
  await tab.getByRole('button', { name: 'Ajouter un son' }).click();
  await expect(dlg).toBeVisible();
  await dlg.locator('[data-file]').setInputFiles(MP3);
  await expect(dlg.locator('[data-srcname]')).toContainText('erenscream.mp3');
  await expect(dlg.locator('[data-name]')).toHaveValue('erenscream');
  // A 10,6 s file: the whole of it is selected (under 20 s).
  await expect(dlg.locator('[data-t="start"]')).toHaveValue('0.00');
  expect(Number(await dlg.locator('[data-t="end"]').inputValue())).toBeCloseTo(
    10.56,
    1,
  );
  // Start typed, end dragged with the mouse, then nudged with the keyboard (Shift + → = 100 ms).
  await dlg.locator('[data-t="start"]').fill('1');
  await dlg.locator('[data-t="start"]').press('Tab');
  await expect(dlg.locator('[data-t="start"]')).toHaveValue('1.00');
  const wave = (await dlg.locator('[data-wave]').boundingBox())!;
  const handle = (await dlg.locator('[data-h="end"]').boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(wave.x + wave.width * 0.3, wave.y + wave.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  const dragged = Number(await dlg.locator('[data-t="end"]').inputValue());
  expect(dragged).toBeGreaterThan(2.6);
  expect(dragged).toBeLessThan(3.8);
  await dlg.locator('[data-h="end"]').press('Shift+ArrowRight');
  const end = Number(await dlg.locator('[data-t="end"]').inputValue());
  expect(end).toBeCloseTo(dragged + 0.1, 2);
  await expect(dlg.locator('[data-len]')).toContainText(
    `${(end - 1).toFixed(2).replace('.', ',')} s`,
  );
  // Listen to exactly the cut: the playhead runs, and stops on demand.
  await dlg.getByRole('button', { name: 'Écouter l’extrait' }).click();
  await expect(dlg.locator('[data-head]')).toBeVisible();
  await dlg.getByRole('button', { name: 'Arrêter l’écoute' }).click();
  await expect(dlg.locator('[data-head]')).toBeHidden();
  // Name and price (the bank's usual price is proposed), then publish.
  await expect(dlg.locator('[data-price="token_cost"]')).toHaveValue('500');
  await expect(dlg.locator('[data-price="credit_cost"]')).toHaveValue('1');
  await dlg.locator('[data-name]').fill('Eren court');
  await dlg.locator('[data-price="token_cost"]').fill('750');
  await dlg.getByRole('button', { name: 'Publier le son' }).click();
  await expect(toasts).toContainText('« Eren court » publié');
  await expect(dlg).toHaveCount(0);
  // Studio shows it, selected; Core has it with a file cut for real (its duration is the cut's).
  await expect(tab.locator('.sb-deck [data-f="label"]')).toHaveValue(
    'Eren court',
  );
  await expect(tab.locator('.sb-deck')).toContainText('Ajouté dans Studio');
  const sound = (await added())!;
  expect(sound).toMatchObject({
    label: 'Eren court',
    token_cost: 750,
    credit_cost: 1,
  });
  expect(Math.abs(sound.duration_ms - (end - 1) * 1000)).toBeLessThan(15);

  // --- The viewer: in the catalogue, previewed from the Core, bought ------------------------------------------------
  expect(
    (
      await labCore('/v1/lab/wallet/900100', {
        actor: STUDIO,
        viewer_id: '900101',
        op: 'set',
        tokens: 20_000,
      })
    ).status,
  ).toBe(200);
  const viewer = await browser.newPage({
    viewport: { width: 400, height: 800 },
  });
  viewer.on('pageerror', (e) => errors.push(String(e)));
  await viewer.addInitScript(() =>
    localStorage.setItem('raptoru-live:soundboard-preview-volume', '30'),
  );
  await viewer.goto('/ext/mobile.html?labRole=viewer');
  await openSoundboard(viewer);
  await viewer.locator('.sbx-search input').first().fill('Eren court');
  await expect(cards(viewer)).toHaveCount(1);
  await expect(cards(viewer).first()).toContainText(
    `${((end - 1) as number).toFixed(1).replace('.', ',')} s`,
  );
  const file = viewer.waitForResponse((r) =>
    r.url().includes(`/sound-files/${sound.file_id}.wav`),
  );
  await viewer.getByRole('button', { name: 'Écouter Eren court' }).click();
  const answer = await file;
  expect(answer.status()).toBe(200);
  expect(answer.headers()['content-type']).toBe('audio/wav');
  await expect(viewer.locator('.jdm-module__body')).not.toContainText(
    'Aperçu indisponible',
  );
  await viewer.getByRole('button', { name: 'Sélectionner Eren court' }).click();
  await expect(viewer.locator('.sbx-dock')).toContainText('750');
  const send = viewer
    .locator('.sbx-dock')
    .getByRole('button', { name: /^Envoyer/ });
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  await expect
    .poll(
      async () =>
        (
          (await labCore('/v1/lab/sound/channels/900100/interactions?limit=10'))
            .body.interactions as { sound_id: string; sound_url: string }[]
        ).find((i) => i.sound_id === sound.id)?.sound_url,
      { timeout: 15_000 },
    )
    .toBe(`sound-files/${sound.file_id}.wav`);
  await expect
    .poll(
      async () =>
        (await labCore('/v1/lab/wallet/900100/900101')).body.tokens as number,
    )
    .toBe(20_000 - 750);

  // --- Re-cut from the kept original ---------------------------------------------------------------------------------
  await tab.getByRole('button', { name: 'Modifier l’extrait' }).click();
  await expect(dlg.locator('[data-srcname]')).toContainText('erenscream.mp3');
  await expect(dlg.locator('[data-t="start"]')).toHaveValue('1.00');
  await dlg.locator('[data-t="end"]').fill('2.5');
  await dlg.locator('[data-t="end"]').press('Tab');
  await dlg.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(toasts).toContainText('« Eren court » enregistré');
  const recut = (await added())!;
  expect(recut.id).toBe(sound.id);
  expect(recut.file_id).not.toBe(sound.file_id);
  expect(Math.abs(recut.duration_ms - 1500)).toBeLessThan(15);

  // --- Removed: gone from Studio and from the extension ---------------------------------------------------------------
  await tab.getByRole('button', { name: 'Modifier l’extrait' }).click();
  await dlg.getByRole('button', { name: 'Supprimer' }).click();
  await page.locator('dialog.d-dlg:not(.sbe) [data-yes]').click();
  await expect(toasts).toContainText('Son supprimé');
  expect(await added()).toBeUndefined();
  await viewer.reload();
  await openSoundboard(viewer);
  await viewer.locator('.sbx-search input').first().fill('Eren court');
  await expect(cards(viewer)).toHaveCount(0);
  // This stack has no TTS runtime: Studio's TTS stage module is absent here (not this spec's concern).
  expect(errors.filter((e) => !e.includes('/tts-lab/'))).toEqual([]);
  await viewer.close();
});
