import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Post-live 11/11 (Aouh: « 6 participants, 5 lignes ») — the Tombola's open screen lists EVERY participant: no cap of
// five rows hidden behind « Tout voir »; when the panel is short, the screen scrolls and the last row is reachable.
// Long names, the « Chat » and « Extension » badges, a participant arriving while the screen is open. 318 / 400 / 565 px,
// normal and reduced heights, no horizontal scroll. Captures in .lab-data/tombola-captures.

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
  // Five from the chat (one very long name), the Lab viewer joins from the extension in the first test: six.
  const names = [
    'Jinai_',
    'Goz___',
    'PsyCoWiNi',
    'happybearman',
    'Un_Pseudo_Vraiment_Tres_Long_',
  ];
  for (const [i, name] of names.entries())
    expect((await chatJoin(String(900_500 + i), name)).status).toBe(200);
});

test.afterAll(async () => {
  await labCore('/v1/lab/raffle/900100/actions', {
    actor: STUDIO,
    command: { action: 'cancel' },
  });
});

test('six participants: six rows at every width and height, the last one reachable, both badges, no horizontal scroll; a seventh appears live', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const first = await browser.newPage({
    viewport: { width: 400, height: 800 },
  });
  await first.goto('/ext/mobile.html?shell=v2&labRole=viewer');
  await openTombola(first);
  const joinBtn = first.locator('.tmbx [data-act="join"]');
  await expect(joinBtn).toBeVisible({ timeout: 15_000 });
  await joinBtn.click();
  await expect(first.locator('.tmbx [data-slot="count"]')).toContainText(
    '6 participants',
    { timeout: 15_000 },
  );
  await first.close();

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
    const rows = page.locator('.tmbx [data-slot="rows"] .row');
    await expect(rows, `${width}×${height}`).toHaveCount(6, {
      timeout: 15_000,
    });
    await expect(page.locator('.tmbx [data-slot="pcount"]')).toContainText('6');
    // The last participant is reachable (the screen scrolls when the panel is short).
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

  // Live: a seventh joins from the chat while the screen is open.
  const live = await browser.newPage({ viewport: { width: 400, height: 420 } });
  await live.goto('/ext/mobile.html?shell=v2&labRole=viewer');
  await openTombola(live);
  await expect(live.locator('.tmbx [data-slot="rows"] .row')).toHaveCount(6, {
    timeout: 15_000,
  });
  expect((await chatJoin('900599', 'Septieme')).status).toBe(200);
  await expect(live.locator('.tmbx [data-slot="rows"] .row')).toHaveCount(7, {
    timeout: 20_000,
  });
  await expect(live.locator('.tmbx [data-slot="count"]')).toContainText(
    '7 participants',
  );
  await live.close();
});
