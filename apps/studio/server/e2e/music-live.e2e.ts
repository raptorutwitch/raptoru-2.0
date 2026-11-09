import { expect, test, type Browser, type Page } from '@playwright/test';

// Music Hub — the live track and the stream's music history, end to end (docs/music/SMTC_STUDIO.md): the Lab's simulated
// Spotify Desktop seen through the Lab's simulated Windows (SMTC) → Studio (tracker, one Web API reading per change for
// its exact track) → the main Core in its Lab environment (/now, the history in the module host's tables) → Studio's
// page and the extension's music module (shell v2). The simulated live opens the history. No Twitch, no real Spotify.

interface Live {
  state: string;
  gen: number;
  track: { title: string } | null;
  link: { uri: string } | null;
}

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
  (await api<{ live: Live | null }>(page, '/api/spotify/live')).live;
const sim = (page: Page, what: string) =>
  api(page, `/api/spotify/sim/${what}`, {});

/** The live track Studio holds, once it is this one and its exact track is read (the link). */
async function nowPlaying(page: Page, not?: string) {
  let l: Live | null = null;
  await expect
    .poll(
      async () => {
        l = await live(page);
        return !!l?.track && !!l.link && l.track.title !== not;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return l!;
}

async function music(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  await page.goto('/ext/mobile.html?shell=v2&labRole=viewer');
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Musique/ }).click();
  await expect(page.locator('.mh')).toHaveCount(1);
  return page;
}

test('Music Hub live: Windows says what plays — Studio and the extension follow it, the bar runs alone, the stream history lists every track (requests recognised, « Skippé » only on a command)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const admin = await browser.newPage();
  await api(admin, '/api/spotify/settings', {
    enabled: true,
    extension_enabled: true,
  });
  // A clean simulated live (another spec may have left one open), Spotify open and playing.
  await admin.request.fetch('/api/raffle/actions', {
    method: 'POST',
    headers: { 'x-raptoru-studio': '1' },
    data: { command: { action: 'stream_end' } },
  });
  await sim(admin, 'app-open');
  const s0 = await api<{ sim: { playing?: boolean } }>(
    admin,
    '/api/spotify/state',
  );
  if (s0.sim?.playing === false) await sim(admin, 'pause-hand');
  await api(admin, '/api/raffle/actions', {
    command: { action: 'stream_start' },
  });

  // The track playing, linked to its exact Spotify track by ONE reading (never by its title).
  const before = await live(admin);
  await sim(admin, 'skip'); // a fresh track, started during the live
  const first = await nowPlaying(admin, before?.track?.title);
  expect(first.state).toBe('playing');

  // Studio's page: « en cours » from Windows, the bar moving by itself.
  await admin.goto('/?p=spotify');
  const title = admin.locator('.spo-now .spo-title');
  await expect(title).toHaveText(first.track!.title, { timeout: 15_000 });
  await expect(admin.locator('.spo-now')).toContainText('Windows simulé');
  const t0 = await admin.locator('.spo-now [data-t0]').textContent();
  await admin.waitForTimeout(2_200);
  expect(await admin.locator('.spo-now [data-t0]').textContent()).not.toBe(t0);

  // The extension: the same track, its time moving between two readings.
  const viewer = await music(browser);
  const now = viewer.locator('.mh-now');
  await expect(now).toContainText(first.track!.title, { timeout: 15_000 });
  const p0 = await viewer.locator('.mh-ptime').textContent();
  await viewer.waitForTimeout(2_200);
  expect(await viewer.locator('.mh-ptime').textContent()).not.toBe(p0);

  // A skip BY HAND in the Spotify app (no Raptoru command): both follow; the history will say « Interrompu », never
  // « Skippé ».
  await viewer.waitForTimeout(4_000); // listened long enough to be listed (more than a glimpse)
  await sim(admin, 'skip');
  const second = await nowPlaying(admin, first.track!.title);
  await expect(title).toHaveText(second.track!.title, { timeout: 5_000 });
  await expect(now).toContainText(second.track!.title, { timeout: 8_000 });

  // Paused in the app: shown paused, the bar frozen.
  await sim(admin, 'pause-hand');
  await expect(viewer.locator('.mh-now.is-paused')).toHaveCount(1, {
    timeout: 8_000,
  });
  const frozen = await viewer.locator('.mh-ptime').textContent();
  await viewer.waitForTimeout(2_000);
  expect(await viewer.locator('.mh-ptime').textContent()).toBe(frozen);
  await sim(admin, 'pause-hand');
  await expect(viewer.locator('.mh-now.is-paused')).toHaveCount(0, {
    timeout: 8_000,
  });

  // A skip COMMAND of Raptoru (Studio's « Passer la musique »): this one is « Skippé ».
  await viewer.waitForTimeout(4_000);
  await admin.locator('[data-act="sp-skip"]').click();
  await admin
    .getByRole('dialog')
    .getByRole('button', { name: 'Passer la musique' })
    .click();
  await nowPlaying(admin, second.track!.title);

  // Studio: « Musiques du stream » — every track of the live, newest first, with how each left.
  await admin.getByRole('button', { name: 'Musiques du stream' }).click();
  const row = (t: string) => admin.locator('.spo-p', { hasText: t }).first();
  await expect(row(second.track!.title)).toContainText('Skippé', {
    timeout: 15_000,
  });
  await expect(row(first.track!.title)).toContainText('Interrompu');
  await expect(row(first.track!.title)).not.toContainText('Skippé');
  await expect(admin.locator('.spo-p').first()).toContainText('En cours');
  await expect(admin.locator('.spo-psess').first()).toContainText('Live du');

  // The extension's history: the same tracks, the broadcaster's without a viewer.
  await viewer.locator('.mh-clock').click();
  const hrow = (t: string) =>
    viewer.locator('.mh-hrow', { hasText: t }).first();
  await expect(hrow(second.track!.title)).toContainText('Skippé', {
    timeout: 15_000,
  });
  await expect(hrow(first.track!.title)).toContainText('Interrompu');
  await expect(hrow(first.track!.title)).not.toContainText('@');

  // Spotify closed: nothing shown as playing; reopened: back. The track it closed on ends « unknown » (no badge).
  await sim(admin, 'app-close');
  await expect
    .poll(async () => (await live(admin))?.state, { timeout: 10_000 })
    .toBe('lost');
  await expect(admin.locator('.spo-now .spo-title')).toHaveText(
    'Spotify Desktop est fermé',
    { timeout: 5_000 },
  );
  await sim(admin, 'app-open');
  const reopened = await nowPlaying(admin);

  // The live over: what plays next is shown, never recorded.
  await api(admin, '/api/raffle/actions', {
    command: { action: 'stream_end' },
  });
  await sim(admin, 'skip');
  const after = await nowPlaying(admin, reopened.track!.title);
  await admin.waitForTimeout(2_000);
  const h = await api<{
    items: { title: string | null; end: string | null }[];
  }>(admin, '/api/spotify/history', {});
  // Nothing open in the history (the track after the live is not there, the one at its end is closed).
  expect(h.items.filter((i) => i.end === null)).toHaveLength(0);
  expect(
    h.items.some((i) => i.title === after.track!.title && i.end === null),
  ).toBe(false);
  await Promise.all([viewer.close(), admin.close()]);
});
