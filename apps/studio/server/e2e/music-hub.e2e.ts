import { expect, test, type Browser, type Page } from '@playwright/test';

// Music Hub (docs/music/MUSIC_HUB_STATE.md) — the extension's music module on the existing Spotify V2 queue, end to end:
// Production Extension (shell v2, mobile) → Studio's Lab relay → the main Core's /v1/ext/music (Lab only) → the Spotify
// V2 queue and its jobs → Studio's Spotify runtime → the Lab's simulated Spotify (fictional catalogue). Jetons of the
// Lab only; no Twitch, no real Spotify. Final design (08/11): the search curtain, the economics band, ONE list
// (« en cours » first), the withdrawal confirmation, the supermods' player under « en cours », « Musiques de la soirée ».

interface Req {
  request_id: string;
  source: string;
  state: string;
  payment?: string;
  refund_status?: string | null;
  track: { title: string } | null;
}
interface St {
  queue: Req[];
  recent: Req[];
  studio: { playback: { is_playing: boolean } | null } | null;
  sim: { playing?: boolean; volume?: number } | null;
}

async function studio(page: Page, path: string, body?: object) {
  const r = await page.request.fetch(`/api/spotify${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-raptoru-studio': '1' },
    ...(body ? { data: body } : {}),
  });
  expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBe(true);
  return (await r.json()) as St;
}

async function music(
  browser: Browser,
  role: 'viewer' | 'moderator' | 'supermod',
) {
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  await page.goto(`/ext/mobile.html?shell=v2&labRole=${role}`);
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Musique/ }).click();
  await expect(page.locator('.mh')).toHaveCount(1);
  return page;
}

const field = (page: Page) =>
  page.getByLabel(
    'Rechercher un titre ou un artiste, ou coller un lien Spotify',
  );

/** Search, choose the exact version in the curtain, confirm the price. */
async function choose(page: Page, query: string, title: string) {
  await field(page).fill(query);
  const hit = page.locator('.mh-hit', { hasText: title }).first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();
  await page.locator('.mh-buy [data-act="confirm"]').click();
}
async function request(page: Page, query: string, title: string) {
  await choose(page, query, title);
  await expect(page.locator('.mh-toast')).toContainText(/demand|file/i, {
    timeout: 15_000,
  });
  await expect(page.locator('.mh-curtain.is-open')).toHaveCount(0);
}

const settled = async (page: Page, title: string) => {
  let last: Req | undefined;
  await expect
    .poll(
      async () => {
        last = (await studio(page, '/state')).recent.find(
          (r) => r.track?.title === title && r.source === 'extension',
        );
        return last?.refund_status ?? null;
      },
      { timeout: 20_000 },
    )
    .not.toBeNull();
  return last!;
};

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await studio(page, '/settings', {
    extension_enabled: false,
    player_controls: false,
    viewer_cooldown_seconds: 600,
  });
  await page.close();
});

test('Music Hub: search the Lab catalogue (text, pasted link), request in Jetons, one list with « en cours » first, withdrawal confirmed and refunded once, a moderator removes (the viewer is told), the supermod drives the player, the evening history', async ({
  browser,
}) => {
  const admin = await browser.newPage();
  await studio(admin, '/settings', {
    enabled: true,
    extension_enabled: true,
    player_controls: true,
  });

  // A viewer: the Hub offers « Musique »; the band says the price and the requests left (Core's rules).
  const viewer = await music(browser, 'viewer');
  const states: string[] = [];
  viewer.on('request', (r) => {
    if (r.url().includes('/music/')) states.push(new URL(r.url()).pathname);
  });
  await expect(viewer.locator('.mh-seg--price')).toContainText('500', {
    timeout: 15_000,
  });
  await viewer.locator('.mh-seg--quota').click();
  await expect(viewer.locator('.mh-tip')).toContainText(
    /Tu peux encore demander \d musique/,
  );
  await viewer.keyboard.press('Escape');
  await expect(viewer.locator('.mh-tip')).toHaveCount(0);

  // Search, confirm the price: the request enters the one Spotify V2 queue, paid in Jetons, on the viewer's list.
  await request(viewer, 'nuit bl', 'Nuit Blanche (Live à Lyon)');
  await expect
    .poll(
      async () =>
        (await studio(admin, '/state')).queue.find(
          (r) => r.track?.title === 'Nuit Blanche (Live à Lyon)',
        )?.payment,
      { timeout: 20_000 },
    )
    .toBe('tokens');
  const mine = viewer.locator('.mh-row.is-mine', {
    hasText: 'Nuit Blanche (Live à Lyon)',
  });
  await expect(mine).toBeVisible({ timeout: 15_000 });
  // Withdrawal: a confirmation (« Conserver » keeps it), then gone at once, refunded exactly once.
  await mine.locator('[data-act="withdraw"]').click();
  await expect(viewer.getByRole('alertdialog')).toContainText(
    'Jetons te seront rendus',
  );
  await viewer.getByRole('button', { name: 'Conserver' }).click();
  await expect(mine).toBeVisible();
  await mine.locator('[data-act="withdraw"]').click();
  await viewer.locator('[data-act="confirm-withdraw"]').click();
  await expect(
    viewer.locator('.mh-row', { hasText: 'Nuit Blanche (Live à Lyon)' }),
  ).toHaveCount(0);
  expect(
    (await settled(admin, 'Nuit Blanche (Live à Lyon)')).refund_status,
  ).toBe('refunded');

  // The delay between two requests is Spotify V2's own rule: a withdrawn request still counts. The band shows it; a
  // request is refused with how long, the Jetons not taken.
  await expect(viewer.locator('.mh-seg--wait')).toBeVisible({
    timeout: 15_000,
  });
  await choose(viewer, 'tempete radio', 'Tempête (Radio Edit)');
  await expect(viewer.locator('.mh-buy__err')).toContainText(
    /possible dans \d+:\d\d\./,
    { timeout: 15_000 },
  );
  await viewer.locator('[data-act="unpick"]').click();
  await viewer.keyboard.press('Escape');
  await studio(admin, '/settings', { viewer_cooldown_seconds: 0 });

  // A pasted Spotify link finds that exact track (the reward's reference rules); an album link is refused.
  await field(viewer).fill(
    'https://open.spotify.com/intl-fr/track/LABMUSIC00000000000029?si=e2e',
  );
  await expect(viewer.locator('.mh-hit')).toHaveCount(1, { timeout: 15_000 });
  await expect(viewer.locator('.mh-hit')).toContainText(
    'Néon Sauvage (Nightcore)',
  );
  await field(viewer).fill(
    'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy',
  );
  await expect(viewer.locator('.mh-msg')).toContainText(
    'n’est pas celui d’un titre',
    { timeout: 15_000 },
  );
  await viewer.locator('[data-act="clear"]').click();
  // A viewer has no team tools and no player.
  await expect(viewer.locator('[data-act="sup"]')).toHaveCount(0);
  await expect(viewer.locator('[data-act="menu"]')).toHaveCount(0);

  // A second request; the moderator removes it without refund (two clicks) — the player is not theirs. The viewer is
  // told (module toast + the notification centre, once).
  await request(viewer, 'tempete radio', 'Tempête (Radio Edit)');
  const mod = await music(browser, 'moderator');
  await expect(mod.locator('[data-act="sup"]')).toHaveCount(0);
  const row = mod.locator('.mh-row', { hasText: 'Tempête (Radio Edit)' });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.locator('[data-act="menu"]').click();
  await mod.getByRole('menuitem', { name: 'Retirer sans rembourser' }).click();
  await mod
    .getByRole('menuitem', { name: 'Confirmer : sans remboursement' })
    .click();
  expect((await settled(admin, 'Tempête (Radio Edit)')).refund_status).toBe(
    'kept',
  );
  await expect(viewer.locator('.mh-toast')).toContainText(
    'retirée par la modération',
    { timeout: 15_000 },
  );
  // The extension's notification centre (its stored list): this outcome once, still once after more readings.
  const centre = () =>
    viewer.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith('raptoru-live:notification-center'))
        .map((k) => localStorage.getItem(k) ?? '')
        .join('\n'),
    );
  const once = async () =>
    (await centre()).split('retirée par la modération').length - 1;
  await expect.poll(once, { timeout: 10_000 }).toBe(1);
  await viewer.waitForTimeout(9_000);
  expect(await once()).toBe(1);

  // « En cours »: the track the player confirms is the first row of the list, before the queue.
  await request(viewer, 'velours', 'Velours');
  const sup = await music(browser, 'supermod');
  await expect(sup.locator('.mh-now')).toBeVisible({ timeout: 20_000 });
  // The supermod (Core's grade: lab_staff, « Supermod Lab ») opens the player under « en cours », pauses, resumes.
  await sup.locator('.mh-now [data-act="sup"]').click();
  await sup.locator('.mh-sup [data-act="pause"]').click();
  await expect
    .poll(async () => (await studio(admin, '/state')).sim?.playing, {
      timeout: 20_000,
    })
    .toBe(false);
  await expect(sup.locator('.mh-now.is-paused')).toContainText('En pause', {
    timeout: 20_000,
  });
  await sup.locator('.mh-sup [data-act="resume"]').click();
  await expect
    .poll(async () => (await studio(admin, '/state')).sim?.playing, {
      timeout: 20_000,
    })
    .toBe(true);
  // A transition: « Passer » until the viewer's request plays — « ta demande » on « en cours », then it leaves.
  for (let n = 0; n < 6; n++) {
    if ((await viewer.locator('.mh-now', { hasText: 'Velours' }).count()) > 0)
      break;
    await sup.locator('.mh-sup [data-act="skip"]').click();
    await expect(sup.locator('.mh-toast')).toContainText(
      /passée|répondu|confirmé/i,
      {
        timeout: 20_000,
      },
    );
    await viewer.waitForTimeout(4_500);
  }
  await expect(viewer.locator('.mh-now', { hasText: 'Velours' })).toContainText(
    'ta demande',
    { timeout: 20_000 },
  );
  await sup.locator('.mh-sup [data-act="skip"]').click();
  await expect(viewer.locator('.mh-now', { hasText: 'Velours' })).toHaveCount(
    0,
    {
      timeout: 20_000,
    },
  );

  // « Musiques de la soirée »: the requests that really played (Core), « toi » for the viewer's own.
  await viewer.locator('.mh-clock').click();
  const played = viewer.locator('.mh-hrow', { hasText: 'Velours' });
  await expect(played).toBeVisible({ timeout: 15_000 });
  await expect(played).toContainText('toi');
  await viewer.locator('.mh-back').click();

  // No reading more than the module's own: its state every ~4 s, the history only when asked (once here).
  states.length = 0;
  await viewer.waitForTimeout(12_500);
  const reads = states.filter((p) => p.endsWith('/music/state')).length;
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(reads).toBeLessThanOrEqual(4);
  expect(states.filter((p) => p.includes('/music/history'))).toHaveLength(0);

  // Studio's Spotify page: the extension's settings in the panel, the requests tagged with their payment.
  await admin.goto('/?p=spotify');
  await expect(admin.locator('[data-sp-flag="extension_enabled"]')).toHaveCount(
    1,
    { timeout: 15_000 },
  );
  // Music Hub V2: the OBS music card's settings (the effects player's « Effets » source), saved in Studio.
  await expect(admin.locator('[data-ov="enabled"]')).toHaveCount(1, {
    timeout: 15_000,
  });
  const ov = await admin.request.fetch('/api/spotify/overlay', {
    method: 'POST',
    headers: { 'x-raptoru-studio': '1' },
    data: {
      enabled: false,
      on_request: true,
      on_start: true,
      sound: null,
      sound_name: null,
      volume: 50,
      duration_s: 5,
      position: 'bottom-right',
    },
  });
  expect(ov.ok(), `${ov.status()} ${await ov.text()}`).toBe(true);
  expect(
    ((await ov.json()) as { config: { position: string } }).config.position,
  ).toBe('bottom-right');
  await admin.getByRole('button', { name: 'Dernières décisions' }).click();
  await expect(
    admin.locator('.spo-h', { hasText: 'Extension' }).first(),
  ).toBeVisible();
  await Promise.all([viewer.close(), mod.close(), sup.close(), admin.close()]);
});
