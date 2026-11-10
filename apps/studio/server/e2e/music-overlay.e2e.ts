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
  // « Afficher » in announce mode arms it: told so, nothing shows before the next track (a Masquer / Afficher is not
  // a new track); the next track shows it.
  await expect(
    admin.getByText(/Armé · .* 3 s à chaque nouveau titre/),
  ).toBeVisible();
  await admin.locator('[data-act="mox-visible"]').click();
  await expect(admin.getByText(/Masqué · .* aucune apparition/)).toBeVisible();
  await admin.locator('[data-act="mox-visible"]').click();
  await expect(admin.getByText(/Armé ·/)).toBeVisible();
  await obs.waitForTimeout(2_000);
  await expect(obs.locator('.mo-anchor.is-shown')).toHaveCount(0);
  await api(admin, '/api/spotify/sim/skip', {});
  await expect(obs.locator('.mo-anchor.is-shown')).toHaveCount(1, {
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

test('Overlay musique editor: open sections stay open, focus, slider and scroll kept while it saves; the request tab in the preview; variants kept', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await browser.newPage({
    viewport: { width: 1600, height: 920 },
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const API = '/api/spotify/overlays';
  type Settings = Record<string, unknown> & {
    font?: string;
    weight?: string;
  };
  type St = {
    variants: { id: string; name: string; settings: Settings }[];
    builtins: { id: string; settings: Settings }[];
  };
  const clean = async () => {
    for (const v of (await api<St>(page, API)).variants)
      await api(page, `${API}/variant/delete`, { id: v.id });
  };
  await clean();
  await page.goto('/?p=music-overlay');
  await expect(page.locator('.mox-sethead')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-pick="jeu"]').click();
  await expect(page.locator('.mox-sethead h2')).toHaveText('Jeu chargé');

  const set = page.locator('[data-z="set"]');
  const saved = page.locator('.mox-saved');
  const section = (name: string) =>
    set.locator('details.mox-adv', {
      has: page.locator('summary', { hasText: name }),
    });
  const openOnes = () =>
    set.locator('details.mox-adv[open] > summary').allTextContents();
  const FOUR = [
    'Couleurs en détail',
    'Typographie',
    'Disposition',
    'Animation',
  ];
  // Several sections open at once.
  for (const n of FOUR) await section(n).locator('summary').click();
  expect((await openOnes()).sort()).toEqual([...FOUR].sort());

  // 1. A choice on a model: « Mon Jeu chargé » is created and saved — the sections stay open.
  await section('Typographie')
    .locator('[data-seg="weight"][data-v="black"]')
    .click();
  await expect(page.locator('.mox-sethead h2')).toHaveText('Mon Jeu chargé');
  await expect(saved).toContainText('Enregistré', { timeout: 8_000 });
  expect((await openOnes()).sort()).toEqual([...FOUR].sort());

  // 2. A list: its value and its focus stay through the save.
  const font = section('Typographie').locator('select[data-pick-set="font"]');
  await font.focus(); // as a click on the list does (selectOption alone does not focus)
  await font.selectOption('condensee');
  await expect(saved).toContainText('Enregistré', { timeout: 8_000 });
  await page.waitForTimeout(600);
  await expect(font).toBeFocused();
  await expect(font).toHaveValue('condensee');

  // 3. A slider held: six steps one after another, the saves in between never take it away.
  const ts = section('Typographie').locator('input[data-num="title_scale"]');
  await ts.focus();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(260);
  }
  await expect(saved).toContainText('Enregistré', { timeout: 8_000 });
  await page.waitForTimeout(600);
  await expect(ts).toBeFocused();
  await expect(ts).toHaveValue('140');

  // 4. A colour, the panel scrolled: the scroll does not move, the sections stay open, the preview follows.
  const artist = section('Couleurs en détail').locator(
    'input[data-color="colors.artist"]',
  );
  await artist.scrollIntoViewIfNeeded();
  const top = await set.evaluate((e) => e.scrollTop);
  expect(top).toBeGreaterThan(0);
  await artist.fill('#ffcc00');
  await expect(saved).toContainText('Enregistré', { timeout: 8_000 });
  await page.waitForTimeout(600);
  expect(await set.evaluate((e) => e.scrollTop)).toBe(top);
  expect((await openOnes()).sort()).toEqual([...FOUR].sort());
  const frame = page.frameLocator('.mox-screen iframe');
  await expect
    .poll(() =>
      frame
        .locator('.mo-anchor')
        .evaluate((e) =>
          (e as HTMLElement).style.getPropertyValue('--mo-artist'),
        ),
    )
    .toBe('rgba(255,204,0,1)');

  // 5. Readability in one click: « Contraste maximal » applies, nothing closes.
  await set.getByRole('button', { name: 'Contraste maximal' }).click();
  await expect(saved).toContainText('Enregistré', { timeout: 8_000 });
  expect((await openOnes()).sort()).toEqual([...FOUR].sort());

  // 6. The request tab, in the preview (demo: never sent to the stream): out with the name, absent for a personal track.
  await page.getByRole('button', { name: 'Démo' }).click();
  await page.locator('[data-demo="request"]').click();
  await expect(frame.locator('.mo-tabclip.is-out')).toHaveCount(1, {
    timeout: 5_000,
  });
  await expect(frame.locator('.mo-tab')).toContainText('@Viewer_Lab');
  await expect(frame.locator('.mo .mo-req')).toHaveCount(0); // never also in the text
  await page.locator('[data-demo="normal"]').click();
  await expect(frame.locator('.mo-tabclip.is-out')).toHaveCount(0, {
    timeout: 5_000,
  });

  // (The shell's TTS stage is not served by this test stack: its import error is not the editor's.)
  expect(errors.filter((e) => !e.includes('/tts-lab/'))).toEqual([]);
  // 7. Saved: after a reload, the variant holds every change; the model is untouched.
  await page.reload();
  await expect(page.locator('.mox-sethead')).toBeVisible({ timeout: 20_000 });
  let st = await api<St>(page, API);
  const v = st.variants.find((x) => x.name === 'Mon Jeu chargé')!;
  const jeu = st.builtins.find((b) => b.id === 'jeu')!.settings;
  expect(v.settings).toMatchObject({
    weight: 'black',
    font: 'condensee',
    title_scale: 140,
    colors: { opacity: 90, text: '#ffffff' },
  });
  expect(jeu.weight).toBe('bold');

  // 8. Rename, duplicate, back to the defaults.
  await page.locator('.mox-var', { hasText: 'Mon Jeu chargé' }).click();
  page.once('dialog', (d) => void d.accept('Mon bandeau'));
  await set.getByRole('button', { name: 'Renommer' }).click();
  await expect(page.locator('.mox-sethead h2')).toHaveText('Mon bandeau');
  await set.getByRole('button', { name: 'Dupliquer' }).click();
  await expect(page.locator('.mox-sethead h2')).toHaveText(
    'Mon bandeau (copie)',
  );
  await set.getByRole('button', { name: 'Valeurs par défaut' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Revenir aux valeurs par défaut' })
    .click();
  await expect
    .poll(async () => {
      st = await api<St>(page, API);
      return st.variants.find((x) => x.name === 'Mon bandeau (copie)')
        ?.settings;
    })
    .toEqual(jeu);
  expect(st.variants.find((x) => x.name === 'Mon bandeau')!.settings.font).toBe(
    'condensee',
  );
  await clean();
});
