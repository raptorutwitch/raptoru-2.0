import { expect, test, type Browser, type Page } from '@playwright/test';

// Music Hub (docs/music/MUSIC_HUB_STATE.md) — the extension's music module on the existing Spotify V2 queue, end to end:
// Production Extension (shell v2, mobile) → Studio's Lab relay → the main Core's /v1/ext/music (Lab only) → the Spotify
// V2 queue and its jobs → Studio's Spotify runtime → the Lab's simulated Spotify (fictional catalogue). Jetons of the
// Lab only; no Twitch, no real Spotify.

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

async function music(browser: Browser, role: 'viewer' | 'moderator') {
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  await page.goto(`/ext/mobile.html?shell=v2&labRole=${role}`);
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Musique/ }).click();
  await expect(page.locator('.mh')).toHaveCount(1);
  return page;
}

async function request(page: Page, query: string, title: string) {
  await page.getByRole('tab', { name: /^Rechercher/ }).click();
  await page.getByLabel('Rechercher un titre ou un artiste').fill(query);
  const row = page.locator('.mh-row', { hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await page.locator('[data-act="confirm"]').click();
  await expect(page.locator('.mh-toast')).toContainText(/demande|file/i, {
    timeout: 15_000,
  });
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

test('Music Hub: search the Lab catalogue, request in Jetons, the shared queue, withdrawal refunded once; the team removes without refund and drives the player', async ({
  browser,
}) => {
  const admin = await browser.newPage();
  await studio(admin, '/settings', {
    enabled: true,
    extension_enabled: true,
    player_controls: true,
  });

  // A viewer: the Hub offers « Musique »; search, confirm the price, the request enters the one Spotify V2 queue.
  const viewer = await music(browser, 'viewer');
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
  await viewer.getByRole('tab', { name: /^File/ }).click();
  const mine = viewer.locator('.mh-q.is-own', {
    hasText: 'Nuit Blanche (Live à Lyon)',
  });
  await expect(mine).toBeVisible({ timeout: 15_000 });
  // Withdrawal: refunded exactly once (the Core records it on the request).
  await mine.getByRole('button', { name: 'Retirer' }).click();
  expect(
    (await settled(admin, 'Nuit Blanche (Live à Lyon)')).refund_status,
  ).toBe('refunded');

  // The delay between two requests is Spotify V2's own rule, the reward's: a request the viewer withdrew still counts
  // (no withdraw-and-ask-again). The refusal says how long; the Jetons are not taken.
  await viewer.getByRole('tab', { name: /^Rechercher/ }).click();
  await viewer
    .getByLabel('Rechercher un titre ou un artiste')
    .fill('tempete radio');
  await viewer
    .locator('.mh-row', { hasText: 'Tempête (Radio Edit)' })
    .first()
    .click();
  await viewer.locator('[data-act="confirm"]').click();
  await expect(viewer.locator('.mh-sheet__err')).toContainText(
    /possible dans \d+:\d\d\./,
    {
      timeout: 15_000,
    },
  );
  await viewer.locator('[data-act="sheet-close"]').click();
  await studio(admin, '/settings', { viewer_cooldown_seconds: 0 });

  // A second request; the moderator removes it without refund (two clicks), then pauses and resumes the player.
  await request(viewer, 'tempete radio', 'Tempête (Radio Edit)');
  const mod = await music(browser, 'moderator');
  await mod.getByRole('tab', { name: /^File/ }).click();
  const row = mod.locator('.mh-q', { hasText: 'Tempête (Radio Edit)' });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Modérer cette demande' }).click();
  await mod.getByRole('menuitem', { name: 'Retirer sans rembourser' }).click();
  await mod
    .getByRole('menuitem', { name: 'Confirmer : sans remboursement' })
    .click();
  expect((await settled(admin, 'Tempête (Radio Edit)')).refund_status).toBe(
    'kept',
  );

  await mod.locator('.mh-ctl [data-act="pause"]').click();
  await expect
    .poll(async () => (await studio(admin, '/state')).sim?.playing, {
      timeout: 20_000,
    })
    .toBe(false);
  await expect(mod.locator('.mh-ctl [data-act="resume"]')).toBeVisible({
    timeout: 20_000,
  });
  await mod.locator('.mh-ctl [data-act="resume"]').click();
  await expect
    .poll(async () => (await studio(admin, '/state')).sim?.playing, {
      timeout: 20_000,
    })
    .toBe(true);

  // Studio's Spotify page: the extension's settings in the panel, the requests tagged with their payment.
  await admin.goto('/?p=spotify');
  await expect(admin.locator('[data-sp-flag="extension_enabled"]')).toHaveCount(
    1,
    { timeout: 15_000 },
  );
  await admin.getByRole('button', { name: 'Dernières décisions' }).click();
  await expect(
    admin.locator('.spo-h', { hasText: 'Extension' }).first(),
  ).toBeVisible();
  await Promise.all([viewer.close(), mod.close(), admin.close()]);
});
