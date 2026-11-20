import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

// Level Up V2 in the Lab, end to end in real browsers (docs/LEVEL_UP_V2.md): Studio › Progression › Level Up activates the
// 1 000 XP levels (typed confirmation), turns the chat announcements and the sound on, imports two numbered badge pictures
// (Lab placeholders, never the streamer's art); the production Extension shows « Mon niveau » and its sound checkbox
// (unchecked by default, kept by the Core); Kirito_TV (sound turned on) one message short of level 10 sends one chat
// message → nothing at once (the grouping window, 30 s here); at its end the INVISIBLE OBS source plays ONE sound (it
// draws nothing) and ONE real Twitch announcement (mode announce, no @) is due exactly 3 s after it on the commands
// outbox; no badge at level 10 (one every 25 levels since 20/11); Studio lists it, and lists Kirito_TV among the viewers who turned the
// sound on; Studio's test announcement takes the same path. Isolated stack: no Twitch, no real data.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const CHANNEL = '900100';
const KIRITO = '57012345';
// A Lab placeholder picture (a plain 4 × 4 PNG made here): the test never uses the streamer's badges.
const placeholder = (shade: number) => {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(16, shade)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat([row, row, row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
const core = () =>
  JSON.parse(
    readFileSync(join(tmpdir(), `raptoru-e2e-core-${PORT}.json`), 'utf8'),
  ) as { url: string; secret: string };
const labCore = async <T = Record<string, unknown>>(
  path: string,
  body?: unknown,
): Promise<T> => {
  const { url, secret } = core();
  const r = await fetch(url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
};

test('Level Up V2: activated in Studio, the grouped announcement for everyone, the sound only when turned on (nothing drawn), no badge before level 25', async ({
  page,
  browser,
}) => {
  // The grouping window (30 s, its minimum) and the Core's 30 s tick.
  test.setTimeout(240_000);
  await page.goto('/?tab=progression');
  const tab = page.locator('#tab-progression');
  const toasts = page.locator('.d-toasts');
  // Progression on (it may already be: the stack is shared with the other tests).
  const on = tab.getByRole('button', { name: 'Activer', exact: true });
  if (await on.isVisible()) await on.click();
  await expect(tab.locator('.d-state')).toContainText('Activée');

  // Studio › Level Up: the typed confirmation activates 1 000 XP per level.
  await tab.getByRole('button', { name: 'Level Up', exact: true }).click();
  const lu = tab.locator('.pg-lu');
  await lu.getByRole('button', { name: 'Simuler' }).click();
  await expect(lu).toContainText('Simulation : rien n’a été écrit');
  await lu.getByRole('button', { name: 'Activer Level Up V2…' }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.locator('[data-text]').fill('NORMALISER LES NIVEAUX');
  await dlg.getByRole('button', { name: 'Activer' }).click();
  await expect(toasts).toContainText('Level Up V2 activé.');
  await expect(lu).toContainText('Fixe : 1 000 XP par niveau');

  // The chat announcements and the sound on; « Sortie chat réelle » on for this Lab channel.
  await lu
    .locator('input[data-lu-rule="level_up_chat"]')
    .check({ force: true });
  await expect(toasts).toContainText('Activé.');
  await lu
    .locator('input[data-lu-rule="level_up_sound"]')
    .check({ force: true });
  await labCore(`/v1/lab/commands/${CHANNEL}/output`, {
    actor: { id: 'e2e' },
    enabled: true,
  });

  // Two numbered pictures (placeholders) → the badges of levels 25 and 50 (every 25 since 20/11), with their image.
  const folder = mkdtempSync(join(tmpdir(), 'e2e-badges-'));
  writeFileSync(join(folder, '1. Premier.png'), placeholder(0x40));
  writeFileSync(join(folder, '2. Second.png'), placeholder(0xc0));
  await lu.locator('[data-lu-badges]').setInputFiles(folder);
  await expect(lu).toContainText('Tes badges sub trouvés');
  await lu.getByRole('button', { name: 'Importer 2 badges' }).click();
  await expect(toasts).toContainText('2 badges importés.');
  await expect(lu).toContainText('Niveau 50');

  // The extension's mini-profile (docs/MINI_PROFIL.md): its level, and the sound switch in its Préférences (⚙) — off by
  // default, kept by the Core.
  const ext = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await ext.goto('/ext/mobile.html?labRole=viewer');
  await ext.locator('.mp-avatar-btn').click();
  await expect(ext.locator('.mp-lvl')).toContainText('1');
  await ext.locator('.mp-gear').click();
  const sfx = ext.getByRole('switch', {
    name: 'Jouer un son lorsque je monte de niveau',
  });
  await expect(sfx).toHaveAttribute('aria-checked', 'false');
  await expect(sfx).toBeEnabled();
  await sfx.click();
  await expect(sfx).toHaveAttribute('aria-checked', 'true');
  await ext.reload();
  await ext.locator('.mp-avatar-btn').click();
  await ext.locator('.mp-gear').click();
  await expect(
    ext.getByRole('switch', {
      name: 'Jouer un son lorsque je monte de niveau',
    }),
  ).toHaveAttribute('aria-checked', 'true'); // kept by the Core

  // The invisible OBS « Level Up » source (its URL from Studio's panel).
  const state = await (
    await page.request.get('/api/level-up/state', {
      headers: { 'x-raptoru-studio': '1' },
    })
  ).json();
  const obs = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const sound = obs.waitForRequest((r) => r.url().endsWith('/level-up/sound'), {
    timeout: 90_000,
  });
  await obs.goto(state.player_url.replace(/^http:\/\/[^/]+/, ''));

  // Kirito_TV turned the sound on; one message short of level 10 (3 XP a message). No Lab live is started (the stack is
  // shared): chat XP outside a live, for this test only.
  await labCore('/v1/lab/progression/settings', {
    rules: { live_only: false, level_up_chat_interval_s: 30 },
  });
  await labCore(`/v1/lab/progression/viewers/${KIRITO}/notify`, {
    level_up_notify: 'sound',
  });
  await labCore('/v1/lab/progression/adjust', {
    viewer: KIRITO,
    mode: 'set_xp',
    value: 8_997,
    reason: 'e2e : juste avant le niveau 10',
    request_id: 'e2e-level-up-0010',
  });
  await labCore('/v1/lab/chat', {
    channel_id: CHANNEL,
    message_id: randomUUID(),
    text: 'bonsoir tout le monde',
    chatter: {
      id: KIRITO,
      login: 'kirito_tv',
      display_name: 'Kirito_TV',
      role: 'viewer',
    },
    source: 'simulator',
  });

  // Nothing at the level-up itself: it waits for the end of its window.
  type Step = {
    origin: string;
    available_at: string;
    params: { mode: string; text: string };
  };
  const steps = async () =>
    (await labCore<{ steps: Step[] }>(`/v1/lab/commands/${CHANNEL}/steps`))
      .steps;
  expect((await steps()).filter((x) => x.origin === 'module:level_up')).toEqual(
    [],
  );
  // On stream, at the end of the window: ONE sound, and nothing at all is drawn.
  await sound;
  expect((await obs.locator('body').innerText()).trim()).toBe('');
  expect(await obs.locator('body *:not(script)').count()).toBe(0);

  // In chat: at the end of the window, ONE real announcement on the commands outbox (LeCroupier_ sends it with Send Chat
  // Announcement), the pseudo without @ and unable to mention (a word joiner after its first letter).
  const announced = async () =>
    (await steps()).filter(
      (x) => x.origin === 'module:level_up' && !x.params.text.startsWith('['),
    );
  await expect
    .poll(async () => (await announced()).map((x) => x.params), {
      timeout: 90_000,
      intervals: [2_000],
    })
    .toEqual([
      expect.objectContaining({
        mode: 'announce',
        text: '🚀 LEVEL UP — K⁠irito_TV (10)',
      }),
    ]);
  // The banner leaves exactly 3 s (Studio's lead) after the sound was played.
  type Ann = { test: boolean; sound: { status: string }; playedAt: string };
  const lastAnn = async (test: boolean) =>
    (await labCore<Ann[]>('/v1/lab/progression/announcements')).find(
      (a) => a.test === test,
    )!;
  const real = await lastAnn(false);
  expect(real.sound.status).toBe('played');
  expect(
    Date.parse((await announced())[0]!.available_at) -
      Date.parse(real.playedAt),
  ).toBe(3000);

  // Level 10: no level badge yet (the first one, id niveau-10, unlocks at level 25 since 20/11).
  const kirito = await labCore<{
    inventory: { id: string; kind: string }[];
  }>(`/v1/lab/progression/viewers/${KIRITO}`);
  expect(kirito.inventory.filter((i) => i.kind === 'badge')).toEqual([]);

  // The Core: the level-up's sound played with its announcement, its chat line given to LeCroupier_.
  const ev = (
    await labCore<
      {
        twitchUserId: string;
        status: string;
        sound: boolean;
        chat: { status: string };
      }[]
    >('/v1/lab/progression/levelups')
  ).find((e) => e.twitchUserId === KIRITO);
  expect(ev).toMatchObject({
    status: 'delivered',
    sound: true,
    chat: { status: 'sent' },
  });
  // Studio lists it (its tab back in front: a background tab's timers are slowed): sent in chat, the sound played.
  await page.bringToFront();
  await expect(lu.locator('.pg-lu-t').last()).toContainText('Kirito_TV', {
    timeout: 15_000,
  });
  await expect(lu.locator('.pg-lu-t').last()).toContainText('envoyé');
  await expect(lu.locator('.pg-lu-t').last()).toContainText('joué 🔊', {
    timeout: 15_000,
  });
  // « Viewers avec son activé »: Kirito_TV, who turned it on (read-only list).
  await expect(lu.locator('[data-lz="listeners"]')).toContainText('Kirito_TV');
  await expect(lu.locator('[data-lz="listeners"]')).toContainText(
    'l’extension actuelle',
  );

  // « Tester un Level Up » (Studio): the sound through the same OBS source, the line previewed only — no XP, no level,
  // no event, nothing in the chat; then the real « [TEST] » line, only after its typed confirmation.
  const kiritoBefore = await labCore<{ xp: number; level: number }>(
    `/v1/lab/progression/viewers/${KIRITO}`,
  );
  const stepsBefore = JSON.stringify(
    await labCore(`/v1/lab/commands/${CHANNEL}/steps`),
  );
  const tested = obs.waitForRequest((r) => r.url().endsWith('/level-up/sound'));
  await expect(lu.locator('[data-lz="test"]')).toContainText('connectée');
  await expect(lu.locator('[data-lu-test-line]')).toHaveText(
    '🚀 LEVEL UP — Raptoru (25)',
  );
  await lu.getByRole('button', { name: 'Tester un Level Up' }).click();
  await tested;
  await expect(toasts).toContainText('Son joué dans OBS');
  expect(await obs.locator('body *:not(script)').count()).toBe(0);
  const kiritoAfter = await labCore<{ xp: number; level: number }>(
    `/v1/lab/progression/viewers/${KIRITO}`,
  );
  expect([kiritoAfter.xp, kiritoAfter.level]).toEqual([
    kiritoBefore.xp,
    kiritoBefore.level,
  ]);
  expect(
    JSON.stringify(await labCore(`/v1/lab/commands/${CHANNEL}/steps`)),
  ).toBe(stepsBefore);
  // The real test: the same path as the live — the sound in OBS first, the « [TEST] » banner 3 s after it.
  const testSound = obs.waitForRequest((r) =>
    r.url().endsWith('/level-up/sound'),
  );
  await lu
    .getByRole('button', { name: 'Envoyer une vraie annonce test…' })
    .click();
  const confirmTest = page.locator('dialog[open]');
  await confirmTest.locator('[data-text]').fill('ENVOYER LE TEST');
  await confirmTest.getByRole('button', { name: 'Envoyer' }).click();
  await expect(toasts).toContainText('Annonce test confiée au bot');
  await testSound;
  const testStep = (await steps()).find((x) =>
    x.params.text.startsWith('[TEST]'),
  );
  expect(testStep?.params).toMatchObject({
    mode: 'announce',
    text: '[TEST] 🚀 LEVEL UP — R⁠aptoru (25)',
  });
  await expect
    .poll(async () => (await lastAnn(true)).sound.status, { timeout: 10_000 })
    .toBe('played');
  const tst = await lastAnn(true);
  expect(
    Date.parse(
      (await steps()).find((x) => x.params.text.startsWith('[TEST]'))!
        .available_at,
    ) - Date.parse(tst.playedAt),
  ).toBe(3000);
  await expect(lu.locator('[data-lu-last-test]')).toContainText('son joué à', {
    timeout: 10_000,
  });

  await labCore('/v1/lab/progression/settings', {
    rules: { live_only: true, level_up_chat_interval_s: 300 },
  });
  await labCore(`/v1/lab/commands/${CHANNEL}/output`, {
    actor: { id: 'e2e' },
    enabled: false,
  });
});
