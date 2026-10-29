import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { DockHub } from '../src/dock/hub.js';
import { DockKey, DockServer } from '../src/dock/server.js';

// Dock OBS V1.2 (docs/OBS_DOCK.md) — the REAL dock page and the REAL Studio dock relay and server in Chromium, fed by
// a scripted Core (fixed activities, a slow replay endpoint that counts its calls). No Core database, no Twitch, no
// OBS. Checks what only a browser shows: one-click replay with a late answer, Ctrl / Shift selection, hiding into the
// display trash (kept after a reload, restorable), the detailed preferences (kept after a reload).

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_DOCK_PORT ?? 4398);
const T = Date.now();
const at = (sec: number) => new Date(T - sec * 1000).toISOString();
let seq = 0;
const alert = (type: string, sec: number, name: string) => ({
  activity_key: `alert:twitch:${type}-${++seq}`,
  kind: 'alert',
  type,
  occurred_at: at(sec),
  data: {
    actor: { id: `u${seq}`, login: name.toLowerCase(), display_name: name },
  },
  state: {
    outcome: 'queued',
    alert_id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    alert_status: 'completed',
  },
  seq,
});
const ix = (type: string, sec: number, name: string, data = {}) => ({
  activity_key: `ix:${type}:${++seq}`,
  kind: 'interaction',
  type,
  occurred_at: at(sec),
  data: { actor: { id: `v-${name}`, name }, ...data },
  state: { status: 'completed', refund_status: 'none' },
  seq,
});
const reward = (sec: number, id: string, title: string) => ({
  activity_key: `cp:twitch:${++seq}`,
  kind: 'channel_points',
  type: 'reward',
  occurred_at: at(sec),
  data: {
    actor: { id: 'u-r', login: 'bob', name: 'Bob' },
    reward: { id, title, cost: 500 },
  },
  state: { status: 'done', twitch_status: 'FULFILLED' },
  seq,
});
const ACTIVITIES = [
  alert('follow', 400, 'AresTeod'),
  reward(300, 'rw-hydrate', 'Hydrate-toi'),
  ix('raffle', 250, 'Kev'),
  ix('random_ban', 240, 'Zed', { target: 'Lucie' }),
  ix('bonk', 200, 'jongdaess', { emote: { glyph: '😀' } }),
  ix('bonk', 195, 'jongdaess', { emote: { glyph: '😀' } }),
  ix('bonk', 190, 'Nina', { emote: { glyph: '😀' } }),
  ix('tts', 100, 'Ana', { message: 'Salut' }),
  ix('tts', 95, 'Bob', { message: 'Coucou' }),
  ix('soundboard', 60, 'Kev', { sound: { id: 'boop', label: 'Boop' } }),
  ix('soundboard', 55, 'Kev', { sound: { id: 'boop', label: 'Boop' } }),
  alert('sub', 30, 'Laniyelle'),
];
const replays: { replay_key?: string }[] = [];
/** New events the scripted Core hands out at its next « changes » answer. */
const pending: { seq: number }[] = [];

let server: DockServer;
let dir = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dock-e2e-'));
  const core = async <T>(path: string, body?: unknown): Promise<T> => {
    const u = new URL(`http://core${path}`);
    if (u.pathname.endsWith('/activity'))
      return {
        cursor: seq,
        activities: [...ACTIVITIES].reverse(),
        more: false,
      } as T;
    if (u.pathname.endsWith('/changes')) {
      await new Promise((r) => setTimeout(r, 500));
      const activities = pending.splice(0);
      return {
        cursor: Math.max(
          Number(u.searchParams.get('after')),
          ...activities.map((a) => a.seq),
        ),
        activities,
      } as T;
    }
    // The replay: a slow answer (the user may click again meanwhile).
    replays.push((body ?? {}) as { replay_key?: string });
    await new Promise((r) => setTimeout(r, 1_000));
    return { replay_alert_id: 'r', created: true } as T;
  };
  const hub = new DockHub({ core, environment: 'production', channelId: '1' });
  server = new DockServer({
    hub,
    key: await DockKey.open(join(dir, 'key.json')),
    port: PORT,
    pageDir: join(here, '..', 'dock-page'),
  });
  await server.listen();
});

test.afterAll(async () => {
  await server?.close();
  await rm(dir, { recursive: true, force: true });
});

const open = async (page: Page) => {
  await page.goto(server.url());
  await expect(page.locator('li.row').first()).toBeVisible();
};
const rows = (page: Page) => page.locator('#list > li.row');

test('rows: one per event except Bonks (one salve); families and labels', async ({
  page,
}) => {
  await open(page);
  // 12 activities: the 3 Bonks share one row; the two TTS (two viewers) and the two identical sounds stay apart.
  await expect(rows(page)).toHaveCount(10);
  await expect(page.locator('li.row.f-bonk')).toHaveCount(1);
  await expect(page.locator('li.row.f-bonk')).toContainText('Bonk × 3');
  await expect(page.locator('li.row.f-tts')).toHaveCount(2);
  await expect(page.locator('li.row.f-soundboard')).toHaveCount(2);
  await expect(page.locator('li.row.f-soundboard').first()).toContainText(
    'Soundboard',
  );
  await expect(page.locator('li.row.f-follow')).toContainText('AresTeod');
  await expect(page.locator('li.row.f-random_ban')).toHaveCount(1);
  await expect(page.locator('li.row.f-raffle')).toHaveCount(1);
});

test('replay: one click asks once; a double click and a click while the answer is late ask nothing more', async ({
  page,
}) => {
  await open(page);
  const sub = page.locator('li.row.f-sub');
  await sub.hover();
  const before = replays.length;
  await sub.locator('[data-replay]').dblclick();
  await sub
    .locator('[data-replay]')
    .click({ force: true })
    .catch(() => {});
  await expect(sub.locator('[data-replay]')).toHaveClass(/sent/, {
    timeout: 5_000,
  });
  expect(replays.length - before).toBe(1);
  expect(replays.at(-1)).toMatchObject({
    replay_key: expect.any(String),
  });
  await expect(page.locator('#toast')).toContainText('Rejeu demandé');
});

test('selection: Ctrl + clic, Shift + clic; hide → trash (kept after a reload); undo and restore', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => localStorage.clear());
  await open(page);
  const r = rows(page);
  await r.nth(0).click({ modifiers: ['Control'] });
  await r.nth(2).click({ modifiers: ['Control'] });
  await r.nth(4).click({ modifiers: ['Shift'] });
  await expect(page.locator('li.row.selected')).toHaveCount(4); // 0, 2, 3, 4
  await expect(page.locator('#selcount')).toHaveText('4 lignes sélectionnées');
  // A plain click while selecting toggles, never opens.
  await r.nth(3).click();
  await expect(page.locator('li.row.selected')).toHaveCount(3);
  await page.click('#hide');
  await expect(rows(page)).toHaveCount(7);
  await expect(page.locator('#bincount')).toHaveText('3');
  // Undo from the toast.
  await page.click('#toast-act');
  await expect(rows(page)).toHaveCount(10);
  await expect(page.locator('#bincount')).toBeHidden();
  // Hide the Bonk salve: its three Bonks go to the trash; kept after a reload.
  await page.locator('li.row.f-bonk').click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');
  await expect(page.locator('li.row.f-bonk')).toHaveCount(0);
  await expect(page.locator('#bincount')).toHaveText('3');
  await page.reload();
  await expect(rows(page)).toHaveCount(9);
  await expect(page.locator('#bincount')).toHaveText('3');
  // The trash: the salve with its Bonks; restore one Bonk only, then the rest.
  await page.click('#bin');
  await expect(page.locator('#trash-list .t-row')).toHaveCount(1);
  await page.locator('#trash-list [data-tkey]').first().check();
  await page.click('#t-restore');
  await expect(page.locator('li.row.f-bonk')).toHaveCount(1);
  await expect(page.locator('#bincount')).toHaveText('2');
  await page.click('#t-all');
  await expect(page.locator('li.row.f-bonk')).toContainText('Bonk × 3');
  await expect(page.locator('#bincount')).toBeHidden();
});

test('preferences: Random Ban without Tombola, one reward by id; kept after a reload; reset', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => localStorage.clear());
  await open(page);
  await page.click('#gear');
  await page.uncheck('input[data-filter="random_ban"]');
  await page.locator('details.rewards summary').click();
  await page.uncheck('input[data-reward="rw-hydrate"]');
  await expect(page.locator('details.rewards')).toHaveAttribute('open', '');
  await expect(page.locator('li.row.f-random_ban')).toHaveCount(0);
  await expect(page.locator('li.row.f-raffle')).toHaveCount(1);
  await expect(page.locator('li.row.f-reward')).toHaveCount(0);
  await page.reload();
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator('li.row.f-random_ban')).toHaveCount(0);
  await expect(page.locator('li.row.f-reward')).toHaveCount(0);
  await page.click('#gear');
  await page.click('#reset');
  await expect(page.locator('li.row.f-random_ban')).toHaveCount(1);
  await expect(page.locator('li.row.f-reward')).toHaveCount(1);
});

/** The first row in view and its offset from the top of the list's view. */
const firstVisible = (page: Page) =>
  page.evaluate(() => {
    const top = document.querySelector('.scroll')!.getBoundingClientRect().top;
    for (const li of document.querySelectorAll<HTMLElement>('#list > li')) {
      const r = li.getBoundingClientRect();
      if (r.bottom > top)
        return { key: li.dataset.key, offset: Math.round(r.top - top) };
    }
    return null;
  });

test('live feedback 29/10 — reading below the top: new events and the 30 s refresh never move the view; at the top, new events show', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 300 });
  await page.clock.install({ time: new Date(T) });
  await open(page);
  const scroller = page.locator('.scroll');
  // A row clicked earlier keeps the focus; then the streamer reads further down.
  await rows(page).nth(1).focus();
  await scroller.evaluate((el) => (el.scrollTop = 220));
  const before = await firstVisible(page);
  expect(before).not.toBeNull();
  pending.push(
    ix('tts', 1, 'Neo', { message: 'nouveau' }),
    alert('follow', 1, 'Zoe'),
  );
  await expect(page.locator('#pill')).toContainText('2 nouveaux');
  // The same row at the same place (± 1 px: scrollTop is a whole pixel).
  const still = async () => {
    const now = await firstVisible(page);
    expect(now?.key).toBe(before!.key);
    expect(Math.abs(now!.offset - before!.offset)).toBeLessThanOrEqual(1);
  };
  await still();
  // The relative times and the « just arrived » glow age (rows rebuilt, the focused one too): nothing moves.
  await page.clock.runFor(61_000);
  await still();
  // At the top (the live flow): a new event shows at once, the view stays at the top.
  await page.locator('#pill').click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
  pending.push(alert('raid', -61, 'Kai')); // the page's clock went 61 s on
  await expect(rows(page).first()).toContainText('Kai');
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
});

test('live feedback 29/10 — display size: Moyen by default (the V1.2 look); Minimaliste shows more rows, Gros / Géant bigger; kept after a reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 420 });
  await open(page);
  const height = () =>
    rows(page)
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
  const whoSize = () =>
    page
      .locator('#list .who')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await expect(page.locator('body')).toHaveClass(/d-mid/);
  const mid = await height();
  await page.locator('#gear').click();
  await page.getByText('Minimaliste', { exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/d-min/);
  const min = await height();
  expect(min).toBeLessThan(mid - 8);
  expect(await whoSize()).toBeGreaterThanOrEqual(12); // more room, never tiny text
  await page.getByText('Gros', { exact: true }).click();
  const big = await height();
  expect(big).toBeGreaterThan(mid + 4);
  await page.getByText('Géant', { exact: true }).click();
  expect(await height()).toBeGreaterThan(big + 4);
  await page.reload();
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/d-xl/);
  // « Réinitialiser » resets the events shown, not the size.
  await page.locator('#gear').click();
  await page.locator('#reset').click();
  await expect(page.locator('body')).toHaveClass(/d-xl/);
});
