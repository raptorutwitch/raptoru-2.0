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
      return {
        cursor: Number(u.searchParams.get('after')),
        activities: [],
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
