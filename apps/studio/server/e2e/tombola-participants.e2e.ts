import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Post-live 11/11 (Aouh: « 6 participants, 5 lignes ») — the Tombola's open screen lists EVERY participant up to 30:
// no cap of five rows hidden behind « Tout voir »; when the panel is short, the screen scrolls and the last row is
// reachable. Beyond 30, the first 30 and « +N · Tout voir » (the full list). One round, growing: 0 → 1 (the viewer,
// from the extension) → 6 → 7 (live) → 29 → 30 → 31 → 120. Long names, « Chat » / « Extension » badges, 318 / 400 /
// 565 px, normal and reduced heights, zoom 150 %, no horizontal scroll. Captures in .lab-data/tombola-captures.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const SHOTS = resolve(process.cwd(), '../../../.lab-data/tombola-captures');
mkdirSync(SHOTS, { recursive: true });
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
const chatJoin = (id: string, name: string) =>
  labCore('/v1/lab/chat', {
    channel_id: '900100',
    message_id: `e2e-tmb-${id}-${Date.now()}`,
    text: '!join',
    chatter: {
      id,
      login: name.toLowerCase().slice(0, 25),
      display_name: name,
      role: 'viewer',
    },
    source: 'simulator',
  });
let joined = 1; // the Lab viewer, from the extension (first test)
/** Chat joins until the round counts `total` participants. */
async function joinUntil(total: number) {
  for (; joined < total; joined++)
    expect(
      (await chatJoin(String(900_500 + joined), `Viewer_${joined}`)).status,
    ).toBe(200);
}

async function openTombola(page: Page) {
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page
    .getByRole('button', { name: /^Tombola/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.locator('.tmbx')).toHaveCount(1);
}
const overflowX = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
const rowsOf = (page: Page) => page.locator('.tmbx [data-slot="rows"] .row');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await expect
    .poll(
      async () => {
        const opened = await labCore('/v1/lab/raffle/900100/actions', {
          actor: STUDIO,
          command: { action: 'launch', kind: 'auto' },
        });
        return opened.body.error === 'raffle_already_open'
          ? 'waiting'
          : opened.status;
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toBe(200);
  // The round lasts its default 60 s; the whole file can take longer under load (local run after lifecycle): it is
  // extended by 10 min so it can never draw in the middle of a check (CI 11/11).
  await expect
    .poll(
      async () =>
        (
          await labCore('/v1/lab/raffle/900100/actions', {
            actor: STUDIO,
            command: { action: 'extend', seconds: 600 },
          })
        ).status,
      { timeout: 30_000, intervals: [1000] },
    )
    .toBe(200);
});

test.afterAll(async () => {
  await labCore('/v1/lab/raffle/900100/actions', {
    actor: STUDIO,
    command: { action: 'cancel' },
  });
});

test('0 then 1: nobody yet, then the viewer joins from the extension and is marked « (toi) »', async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await page.goto('/ext/mobile.html?shell=v2&labRole=viewer');
  await openTombola(page);
  await expect(page.locator('.tmbx [data-slot="rows"]')).toContainText(
    'En attente des premières inscriptions',
    { timeout: 15_000 },
  );
  const joinBtn = page.locator('.tmbx [data-act="join"]');
  await expect(joinBtn).toBeVisible({ timeout: 15_000 });
  await joinBtn.click();
  await expect(rowsOf(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(rowsOf(page).first()).toContainText('(toi)');
  await page.close();
});

test('six: six rows at every width and height, the last one reachable, both badges, no horizontal scroll; a seventh appears live', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  // Five from the chat, one with a very long name: six with the viewer.
  for (const [i, name] of [
    'Jinai_',
    'Goz___',
    'PsyCoWiNi',
    'happybearman',
    'Un_Pseudo_Vraiment_Tres_Long_',
  ].entries())
    expect((await chatJoin(String(900_400 + i), name)).status).toBe(200);
  joined = 6;

  for (const [width, height] of [
    [318, 800],
    [318, 420],
    [400, 800],
    [400, 420],
    [565, 376],
    [565, 800],
  ] as const) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto('/ext/mobile.html?shell=v2&labRole=viewer');
    await openTombola(page);
    const rows = rowsOf(page);
    await expect(rows, `${width}×${height}`).toHaveCount(6, {
      timeout: 15_000,
    });
    await expect(page.locator('.tmbx [data-slot="pcount"]')).toContainText('6');
    await rows.last().scrollIntoViewIfNeeded();
    await expect(rows.last(), `${width}×${height}`).toBeInViewport();
    await expect(
      page.locator('.tmbx [data-slot="rows"]').getByText('Chat').first(),
    ).toBeVisible();
    await expect(
      page.locator('.tmbx [data-slot="rows"]').getByText('Extension').first(),
    ).toBeVisible();
    expect(await overflowX(page), `${width}×${height}`).toBe(false);
    await page.screenshot({
      path: join(SHOTS, `tombola-6-${width}x${height}.png`),
    });
    await page.close();
  }

  const live = await browser.newPage({ viewport: { width: 400, height: 420 } });
  await live.goto('/ext/mobile.html?shell=v2&labRole=viewer');
  await openTombola(live);
  await expect(rowsOf(live)).toHaveCount(6, { timeout: 15_000 });
  await joinUntil(7);
  await expect(rowsOf(live)).toHaveCount(7, { timeout: 20_000 });
  await expect(live.locator('.tmbx [data-slot="count"]')).toContainText(
    '7 participants',
  );
  await live.close();
});

test('29, 30, 31, 120: up to 30 rows in the screen, then « +N · Tout voir » and the full list; zoom 150 %', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await browser.newPage({ viewport: { width: 318, height: 420 } });
  await page.goto('/ext/mobile.html?shell=v2&labRole=viewer');
  await openTombola(page);
  const more = page.locator('.tmbx [data-slot="more"]');

  await joinUntil(29);
  await expect(rowsOf(page)).toHaveCount(29, { timeout: 20_000 });
  await expect(more).toHaveText('Tout voir');
  await joinUntil(30);
  await expect(rowsOf(page)).toHaveCount(30, { timeout: 20_000 });
  await expect(more).toHaveText('Tout voir');
  await joinUntil(31);
  await expect(more).toHaveText('+1 · Tout voir', { timeout: 20_000 });
  await expect(rowsOf(page)).toHaveCount(30);
  await rowsOf(page).last().scrollIntoViewIfNeeded();
  await expect(rowsOf(page).last()).toBeInViewport();
  expect(await overflowX(page)).toBe(false);
  await page.screenshot({ path: join(SHOTS, 'tombola-31-318x420.png') });

  await joinUntil(120);
  await expect(more).toHaveText('+90 · Tout voir', { timeout: 30_000 });
  await expect(rowsOf(page)).toHaveCount(30);
  // The full list: everyone, scrollable, its filters.
  await more.click();
  await expect(rowsOf(page)).toHaveCount(120, { timeout: 15_000 });
  // Drawn once: the next reads, with nothing changed (the Lab has no avatars to bring), rewrite no row — the 120 rows
  // used to be rebuilt at the first read after opening, under the viewer's scroll (CI 11/11: « not attached »).
  await rowsOf(page)
    .last()
    .evaluate((e) => e.setAttribute('data-e2e-kept', '1'));
  for (let i = 0; i < 3; i++)
    await page.waitForResponse((r) => r.url().includes('/raffle/state'));
  await expect(
    page.locator('.tmbx [data-slot="rows"] .row[data-e2e-kept="1"]'),
  ).toHaveCount(1);
  await rowsOf(page).last().scrollIntoViewIfNeeded();
  await expect(rowsOf(page).last()).toBeInViewport();
  expect(await overflowX(page)).toBe(false);
  await page.screenshot({ path: join(SHOTS, 'tombola-120-list-318x420.png') });
  await page.close();

  // Zoom 150 % (a 565 px panel seen at 1.5×): still no horizontal scroll, the last row reachable.
  const zoom = await browser.newPage({
    viewport: { width: 377, height: 400 },
    deviceScaleFactor: 1.5,
  });
  await zoom.goto('/ext/mobile.html?shell=v2&labRole=viewer');
  await openTombola(zoom);
  await expect(rowsOf(zoom)).toHaveCount(30, { timeout: 15_000 });
  await rowsOf(zoom).last().scrollIntoViewIfNeeded();
  await expect(rowsOf(zoom).last()).toBeInViewport();
  expect(await overflowX(zoom)).toBe(false);
  await zoom.screenshot({ path: join(SHOTS, 'tombola-120-zoom150.png') });
  await zoom.close();
});
