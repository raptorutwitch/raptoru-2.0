import { expect, test, type Page } from '@playwright/test';

// Music Hub — the OBS music overlays end to end (docs/music/MUSIC_OVERLAYS.md): the page OBS would load (its token in
// the hash) follows the Lab's simulated Spotify through Studio; the editor shows / hides it, puts a preset on air, and
// its demo data never reaches it. No OBS here (the assistant says so); no Twitch, no real Spotify.

async function api<T>(page: Page, path: string, body?: object) {
  const r = await page.request.fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-raptoru-studio': '1' },
    ...(body ? { data: body } : {}),
  });
  expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBe(true);
  return (await r.json()) as T;
}
const live = async (page: Page) =>
  (
    await api<{
      live: { track: { title: string } | null; link: unknown } | null;
    }>(page, '/api/spotify/live')
  ).live;

test('Overlay musique: the OBS page follows the real track, shown / hidden and restyled from the editor, never the demo', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = await browser.newPage({
    viewport: { width: 1600, height: 920 },
  });
  await api(admin, '/api/spotify/sim/app-open', {});
  const st = await api<{ url: string; visible: boolean }>(
    admin,
    '/api/spotify/overlays',
  );
  if (st.visible)
    await api(admin, '/api/spotify/overlays/visible', { visible: false });
  await api(admin, '/api/spotify/overlays/active', { id: 'clean' });

  // The OBS browser source: Studio's URL (token in the hash), 1920 × 1080, transparent.
  const obs = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  await obs.goto(st.url.replace(/^https?:\/\/[^/]+/, ''));
  expect(
    await obs.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)');
  // Hidden until shown from Studio.
  await obs.waitForTimeout(1_500);
  await expect(obs.locator('.mo-anchor.is-shown')).toHaveCount(0);

  // The editor: « Afficher ».
  await admin.goto('/?p=music-overlay');
  await expect(admin.locator('.mox-sethead')).toBeVisible({ timeout: 20_000 });
  await admin.locator('[data-act="mox-visible"]').click();
  await expect(admin.locator('[data-act="mox-visible"]')).toContainText(
    'Masquer',
  );
  await expect(obs.locator('.mo-anchor.is-shown')).toHaveCount(1, {
    timeout: 8_000,
  });
  let now = await live(admin);
  await expect(obs.locator('.mo .mo-title')).toContainText(now!.track!.title, {
    timeout: 8_000,
  });
  await expect(obs.locator('.mo--clean')).toHaveCount(1);

  // The track changes in Spotify: the page follows (long poll), with the progress moving by itself.
  const before = now!.track!.title;
  await api(admin, '/api/spotify/sim/skip', {});
  await expect
    .poll(async () => (await live(admin))?.track?.title, { timeout: 10_000 })
    .not.toBe(before);
  now = await live(admin);
  await expect(
    obs.locator('.mo-body:not(.mo-swap-out) .mo-title'),
  ).toContainText(now!.track!.title, {
    timeout: 8_000,
  });
  const t0 = await obs
    .locator('.mo-body:not(.mo-swap-out) [data-time]')
    .first()
    .textContent();
  await obs.waitForTimeout(2_200);
  expect(
    await obs
      .locator('.mo-body:not(.mo-swap-out) [data-time]')
      .first()
      .textContent(),
  ).not.toBe(t0);

  // The editor's demo (a fake request, a fake title) stays in the editor's frame.
  await admin.getByRole('button', { name: 'Démo' }).click();
  await admin.getByRole('button', { name: 'Demande viewer' }).click();
  await admin.waitForTimeout(1_500);
  await expect(obs.locator('.mo-title')).not.toContainText('Raptor Run');
  await expect(obs.locator('.mo-req')).toHaveCount(0);

  // Another model, edited: a variant is created and saved, then put on air — the page changes composition.
  await admin.locator('[data-pick="neon"]').click();
  await admin.locator('[data-palette="givre"]').click();
  await expect(admin.locator('.mox-saved')).toContainText('Enregistré', {
    timeout: 8_000,
  });
  await expect(admin.locator('.mox-var')).toHaveCount(1);
  await admin.locator('[data-act="mox-onair"]').click();
  await expect(obs.locator('.mo--neon')).toHaveCount(1, { timeout: 8_000 });
  expect(
    await obs
      .locator('.mo-anchor')
      .evaluate((e) =>
        getComputedStyle(e).getPropertyValue('--mo-accent').trim(),
      ),
  ).toBe('#7dd3fc');

  // « Annonce » mode (3 s): shown at a new track, then gone.
  await admin.locator('[data-seg="display.mode"][data-v="announce"]').click();
  await admin
    .locator('[data-num="display.announce_s"]')
    .evaluate((e: HTMLInputElement) => {
      e.value = '3';
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    });
  await expect(admin.locator('.mox-saved')).toContainText('Enregistré', {
    timeout: 8_000,
  });
  await api(admin, '/api/spotify/sim/skip', {});
  await expect(obs.locator('.mo-anchor.is-shown')).toHaveCount(1, {
    timeout: 8_000,
  });
  await expect(obs.locator('.mo-anchor.is-shown')).toHaveCount(0, {
    timeout: 8_000,
  });

  // Spotify closed: nothing shown (« Rien ne joue : Cacher »).
  await admin.locator('[data-seg="display.mode"][data-v="always"]').click();
  await expect(admin.locator('.mox-saved')).toContainText('Enregistré', {
    timeout: 8_000,
  });
  await expect(obs.locator('.mo-anchor.is-shown')).toHaveCount(1, {
    timeout: 8_000,
  });
  await api(admin, '/api/spotify/sim/app-close', {});
  await expect(obs.locator('.mo-anchor.is-shown')).toHaveCount(0, {
    timeout: 8_000,
  });
  await api(admin, '/api/spotify/sim/app-open', {});
  await expect(obs.locator('.mo-anchor.is-shown')).toHaveCount(1, {
    timeout: 8_000,
  });

  // « Masquer »: gone from the stream.
  await admin.locator('[data-act="mox-visible"]').click();
  await expect(obs.locator('.mo-anchor.is-shown')).toHaveCount(0, {
    timeout: 8_000,
  });

  // No OBS in the Lab: the assistant says so and offers nothing it cannot do.
  await admin.locator('#tab-music-overlay [data-panel]').click();
  await expect(admin.locator('.mox-obs')).toContainText('Non connecté', {
    timeout: 8_000,
  });
  await expect(admin.locator('[data-act="mox-obs-install"]')).toBeDisabled();

  await api(admin, '/api/spotify/overlays/active', { id: 'clean' });
  await Promise.all([obs.close(), admin.close()]);
});
