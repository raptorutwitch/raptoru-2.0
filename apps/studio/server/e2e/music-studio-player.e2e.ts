import { expect, test, type Page } from '@playwright/test';

// Music Hub — Studio's player card after a real-account test (10/11): an action (Pause, Reprendre) never rebuilds the
// card. The cover, the title and the buttons stay the SAME elements (no blink, focus kept), only what changed is
// rewritten; the action is confirmed (never « n'a pas confirmé » when the player did it). Lab: simulated Spotify and
// simulated Windows (the same live card as Production's).

const H = { 'x-raptoru-studio': '1' };
async function api<T>(page: Page, path: string, body?: object) {
  const r = await page.request.fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: H,
    ...(body ? { data: body } : {}),
  });
  expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBe(true);
  return (await r.json()) as T;
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await api(page, '/api/spotify/settings', { player_controls: false });
  await page.close();
});

test('Studio player card: Pause then Reprendre keep the same cover, title and buttons (no rebuild), focus kept, confirmed', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = await browser.newPage();
  await api(admin, '/api/spotify/settings', {
    enabled: true,
    player_controls: true,
  });
  await api(admin, '/api/spotify/sim/app-open', {});
  const s0 = await api<{ sim: { playing?: boolean } }>(
    admin,
    '/api/spotify/state',
  );
  if (s0.sim?.playing === false)
    await api(admin, '/api/spotify/sim/pause-hand', {});

  await admin.goto('/?p=spotify');
  const now = admin.locator('.spo-now');
  await expect(now.locator('.spo-title')).not.toHaveText(/Aucune/, {
    timeout: 20_000,
  });
  const play = now.locator('[data-act="sp-play"]');
  await expect(play).toHaveAttribute('data-play', 'pause', { timeout: 15_000 });

  await expect(now.locator('img.spo-cov')).toBeVisible({ timeout: 15_000 });
  // Remember the card's elements, and count every element removed from it from now on.
  await admin.evaluate(() => {
    const card = document.querySelector('.spo-now')!;
    const w = window as unknown as Record<string, unknown>;
    w.__cov = card.querySelector('.spo-cov');
    w.__title = card.querySelector('.spo-title');
    w.__play = card.querySelector('[data-act="sp-play"]');
    w.__skip = card.querySelector('[data-act="sp-skip"]');
    w.__removed = 0;
    new MutationObserver((list) => {
      for (const m of list)
        for (const n of m.removedNodes)
          if (
            n.nodeType === 1 &&
            (n as Element).matches('.spo-cov, .spo-title, button, input')
          )
            (w.__removed as number)++;
    }).observe(card, { childList: true, subtree: true });
  });
  const same = () =>
    admin.evaluate(() => {
      const card = document.querySelector('.spo-now')!;
      const w = window as unknown as Record<string, unknown>;
      return {
        cover: w.__cov === card.querySelector('.spo-cov'),
        title: w.__title === card.querySelector('.spo-title'),
        play: w.__play === card.querySelector('[data-act="sp-play"]'),
        skip: w.__skip === card.querySelector('[data-act="sp-skip"]'),
        removed: w.__removed,
        focused: document.activeElement === w.__play,
      };
    });

  await play.click();
  await expect(admin.locator('.d-toast').last()).toContainText(
    'Lecteur en pause',
    {
      timeout: 15_000,
    },
  );
  await expect(play).toHaveAttribute('data-play', 'resume', {
    timeout: 10_000,
  });
  await expect(play).toHaveText(/Reprendre/);
  expect(await same()).toEqual({
    cover: true,
    title: true,
    play: true,
    skip: true,
    removed: 0,
    focused: true,
  });

  await play.click();
  await expect(admin.locator('.d-toast').last()).toContainText(
    'Lecture reprise',
    {
      timeout: 15_000,
    },
  );
  await expect(play).toHaveAttribute('data-play', 'pause', { timeout: 10_000 });
  expect(await same()).toEqual({
    cover: true,
    title: true,
    play: true,
    skip: true,
    removed: 0,
    focused: true,
  });
  expect(await admin.locator('.d-toast', { hasText: 'confirmé' }).count()).toBe(
    0,
  );
});
