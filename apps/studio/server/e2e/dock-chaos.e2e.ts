import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { loadChaosSummary } from '../src/dock/chaos-summary.js';
import { DockHub } from '../src/dock/hub.js';
import { DockKey, DockServer } from '../src/dock/server.js';

// Chaos purchases in the OBS dock (docs/OBS_DOCK.md), in a real browser on the real dock page and server, the Core
// scripted: one compact line per purchase — the viewer, the effect, its setting worded by the extension's catalogue,
// the duration and the price — whose state changes on that same line (never a second one).

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_DOCK_CHAOS_PORT ?? 4395);
const SHOTS = process.env.DOCK_CHAOS_SHOTS ?? '';
const T = Date.now();
const at = (sec: number) => new Date(T - sec * 1000).toISOString();
let seq = 0;
const purchase = (
  id: string,
  sec: number,
  name: string,
  effect: { id: string; label: string },
  choice: Record<string, unknown>,
  duration_s: number,
  price: number,
  status: string,
  refund_status = 'none',
) => ({
  activity_key: `ix:chaos:${id}`,
  kind: 'interaction',
  type: 'chaos',
  occurred_at: at(sec),
  data: {
    actor: { id: `v-${name}`, name },
    effect,
    choice,
    duration_s,
    price,
    payment: 'jetons',
  },
  state: { status, refund_status },
  seq: ++seq,
});
const BLINK = { id: 'blink', label: 'Paupières' };
const ACTIVITIES = [
  purchase(
    'a',
    300,
    'Ana',
    { id: 'color', label: 'Couleur' },
    { style: 'sepia' },
    20,
    1800,
    'chaos_played',
  ),
  purchase(
    'b',
    200,
    'Zed',
    { id: 'vhs', label: 'VHS / glitch' },
    { style: 'abimee' },
    10,
    2600,
    'chaos_interrupted',
    'refunded',
  ),
  purchase(
    'c',
    120,
    'Nina',
    { id: 'fog', label: 'Brouillard' },
    { style: 'nappes', level: 'marque' },
    20,
    3400,
    'chaos_unplayed',
    'refunded',
  ),
  purchase(
    'd',
    30,
    'jongdaess',
    BLINK,
    { style: 'fatigue', level: 'extreme' },
    10,
    2400,
    'chaos_queued',
  ),
];
const pending: unknown[] = [];

let server: DockServer;
let dir = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dock-chaos-e2e-'));
  const core = async <T>(path: string): Promise<T> => {
    const u = new URL(`http://core${path}`);
    if (u.pathname.endsWith('/activity'))
      return {
        cursor: seq,
        activities: [...ACTIVITIES].reverse(),
        more: false,
      } as T;
    await new Promise((r) => setTimeout(r, 300));
    const activities = pending.splice(0) as { seq: number }[];
    return {
      cursor: Math.max(
        Number(u.searchParams.get('after')),
        ...activities.map((a) => a.seq),
      ),
      activities,
    } as T;
  };
  const hub = new DockHub({
    core,
    environment: 'production',
    channelId: '1',
    decorate: await loadChaosSummary(
      join(
        here,
        '..',
        '..',
        '..',
        'twitch-extension',
        'extension',
        'modules',
        'interactions',
        'catalog.js',
      ),
    ),
  });
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
const chaos = (page: Page) => page.locator('#list > li.row.f-chaos');

test('one compact line per purchase: viewer, effect, setting, duration, price, state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await open(page);
  await expect(chaos(page)).toHaveCount(4);
  const blink = chaos(page).filter({ hasText: 'jongdaess' });
  await expect(blink.locator('.lab-t')).toHaveText('Paupières');
  await expect(blink.locator('.note')).toHaveAttribute(
    'title',
    /^10 s · 2\s400 Jetons · Somnolence · Complètement$/,
  );
  await expect(blink.locator('.st')).toHaveAttribute('title', 'En attente');
  await expect(
    chaos(page).filter({ hasText: 'Ana' }).locator('.note'),
  ).toHaveAttribute('title', /^20 s · 1\s800 Jetons · Sépia$/);
  await expect(
    chaos(page).filter({ hasText: 'Zed' }).locator('.st'),
  ).toHaveAttribute('title', 'Interrompu · remboursé');
  await expect(
    chaos(page).filter({ hasText: 'Nina' }).locator('.st'),
  ).toHaveAttribute('title', 'Remboursé');
  if (SHOTS) {
    for (const d of ['mid', 'min']) {
      await page.evaluate((x) => {
        document.body.className = document.body.className.replace(
          /\bd-\w+/g,
          '',
        );
        document.body.classList.add(`d-${x}`);
      }, d);
      await page.screenshot({ path: join(SHOTS, `dock-chaos-${d}-360.png`) });
    }
    await page.setViewportSize({ width: 300, height: 420 });
    await page.screenshot({ path: join(SHOTS, 'dock-chaos-min-300.png') });
  }
});

test('its state changes on the same line: waiting → playing → played, never a second line', async ({
  page,
}) => {
  await open(page);
  const line = chaos(page).filter({ hasText: 'jongdaess' });
  await expect(line.locator('.st')).toHaveAttribute('title', 'En attente');
  const next = (status: string) => {
    const d = ACTIVITIES[3]!;
    pending.push({
      ...d,
      state: { status, refund_status: 'none' },
      seq: ++seq,
    });
  };
  next('chaos_playing');
  await expect(line.locator('.st')).toHaveAttribute('title', 'En cours');
  next('chaos_played');
  await expect(line.locator('.st')).toHaveAttribute('title', 'Terminé');
  await expect(chaos(page)).toHaveCount(4);
});
