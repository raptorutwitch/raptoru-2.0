import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CmdConfig } from '@raptoru/schemas';
import { expect, test, type Page } from '@playwright/test';

// Commandes Chat V2.1 end to end in real browsers (docs/COMMANDS_V2_STATUS.md), on the main Core's Lab: a sound command
// set in Studio's editor to « Message contenant une expression » (« ao »), reserved to « Aouh » (the Lab viewer 900101)
// and editable by her from the extension. In the chat (simulator): her sentence with « ao » → one sound in the OBS source;
// without it, or by another viewer → none. In the extension (shell v2, as packaged for Production): she changes the
// expression, switches it off and on; the other viewer sees nothing to edit and the Core refuses him, and her own
// requests can never touch the sound, the audience or the rest. Fictional data only: no Twitch, no real chat.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const CHANNEL = '900100';
const AOUH = { id: '900101', login: 'lab_viewer' };
const LUNA = { id: '900201', login: 'luna_lab' };
const core = () =>
  JSON.parse(
    readFileSync(join(tmpdir(), `raptoru-e2e-core-${PORT}.json`), 'utf8'),
  ) as { url: string; secret: string };
const labCore = async (path: string, body?: unknown) => {
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
  return r.json() as Promise<Record<string, unknown>>;
};
/** A short Lab placeholder sound (a silent 16-bit mono WAV), made here. */
const placeholderWav = () => {
  const samples = 2205;
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(22050, 24);
  b.writeUInt32LE(44100, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(samples * 2, 40);
  return b;
};
const say = (who: { id: string; login: string }, text: string) =>
  labCore('/v1/lab/chat', {
    channel_id: CHANNEL,
    message_id: randomUUID(),
    text,
    chatter: {
      id: who.id,
      login: who.login,
      display_name: who.login,
      role: 'viewer',
    },
    source: 'simulator',
  });
/** The Lab JWT Studio signs for a fictional viewer, as the extension gets it. */
const extToken = async (page: Page, viewer: string) =>
  (
    (await (
      await page.request.get(
        `/ext-lab/token?role=viewer&identity=1&viewer=${viewer}`,
      )
    ).json()) as { token: string }
  ).token;
const ext = async (token: string, path: string, body?: unknown) => {
  // The main Core's real viewer frontier (core-lab-stack.ts: port + 3), as the extension reaches it through Studio.
  const r = await fetch(`http://127.0.0.1:${PORT + 3}/v1/ext${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return {
    status: r.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
    body: (text ? JSON.parse(text) : {}) as Record<string, any>,
  };
};
/** Opens « Commandes » in the extension (mobile surface, shell v2) as a fictional viewer. */
async function openCommands(page: Page, viewer: string) {
  await page.goto(
    `/ext/mobile.html?labRole=viewer&labViewer=${viewer}&shell=v2`,
  );
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page.getByRole('button', { name: /^Commandes/ }).click();
  await expect(page.locator('.cmdx--public')).toBeVisible();
}

test('Commandes V2.1: « ao » in Aouh’s sentence plays its sound once; she edits her command from the extension; nobody else can', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const studio = { 'x-raptoru-studio': '1' };
  const imported = await page.request.post(
    '/api/level-up/command-sounds?name=Ao.wav',
    { headers: studio, data: placeholderWav() },
  );
  expect(imported.ok(), await imported.text()).toBe(true);
  const sound = (await imported.json()) as { id: string; label: string };
  // A sound command for Aouh (by her Twitch id), no chat message, no cooldown.
  const created = await page.request.post('/api/commands', {
    headers: studio,
    data: {
      config: {
        name: 'aocmd',
        reply: { mode: 'silent', text: '', to: 'none' },
        audience: {
          groups: [],
          allow: [],
          allow_ids: [{ id: AOUH.id, name: 'Aouh' }],
          deny: [],
        },
        actions: [
          {
            type: 'sound',
            v: 1,
            id: randomUUID(),
            on_error: 'continue',
            sound: sound.id,
            label: sound.label,
          },
        ],
        cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'viewer' },
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const commandId = ((await created.json()) as { command_id: string })
    .command_id;

  // Studio's editor: « Déclenchement » → message containing « ao »; « Modification déléguée » → Aouh (her id).
  await page.goto('/?tab=commands');
  await page.locator('.cdx-li', { hasText: 'aocmd' }).click();
  /** One of the editor's rule panels, by its title. */
  const pop = (title: string) =>
    page.locator('.d-pop:popover-open', { hasText: title });
  await page.locator('[data-rule="trigger"]').click();
  await pop('Déclenchement').locator('[data-tmode="keywords"]').click();
  await pop('Déclenchement').locator('[data-chipin="kw"]').fill('ao');
  await pop('Déclenchement').locator('[data-chipin="kw"]').press('Enter');
  await expect(pop('Déclenchement')).toContainText('Mot entier');
  await expect(pop('Déclenchement').locator('.d-tag')).toContainText(['ao']);
  await page.keyboard.press('Escape');
  await page.locator('[data-rule="editors"]').click();
  await pop('Modification déléguée')
    .locator('[data-chipin="editor"]')
    .fill(AOUH.id);
  await pop('Modification déléguée')
    .locator('[data-chipin="editor"]')
    .press('Enter');
  await expect(pop('Modification déléguée')).toContainText(
    'peut la modifier depuis l’extension',
  );
  await page.keyboard.press('Escape');
  await page.locator('[data-save]').click();
  await expect(page.locator('.cdx-li', { hasText: 'aocmd' })).toContainText(
    'Message contenant « ao »',
  );
  const saved = (await (
    await page.request.get(`/api/commands/${commandId}`, { headers: studio })
  ).json()) as { config: CmdConfig };
  expect(saved.config.trigger).toEqual({
    mode: 'keywords',
    keywords: ['ao'],
    match: 'word',
  });
  expect(saved.config.editors).toEqual([
    { id: AOUH.id, name: expect.any(String) },
  ]);

  // The invisible OBS sound source: every sound it starts is recorded.
  const state = await (
    await page.request.get('/api/level-up/state', { headers: studio })
  ).json();
  const obs = await browser.newPage();
  await obs.addInitScript(() => {
    const Real = window.Audio;
    (window as unknown as { __played: string[] }).__played = [];
    window.Audio = function (src?: string) {
      (window as unknown as { __played: string[] }).__played.push(String(src));
      return new Real(src);
    } as unknown as typeof Audio;
  });
  await obs.goto(state.player_url.replace(/^http:\/\/[^/]+/, ''));
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get('/api/level-up/state', { headers: studio })
          ).json()
        ).sources,
    )
    .toBeGreaterThan(0);
  const played = async () =>
    (
      await obs.evaluate(
        () => (window as unknown as { __played: string[] }).__played,
      )
    ).filter((s) => s.includes(`/level-up/cmd/${sound.id}`)).length;
  /** The number of plays after a message (the source takes the queue every 2 s). */
  const expectPlayed = async (n: number) => {
    await expect.poll(played, { timeout: 15_000 }).toBe(n);
    await obs.waitForTimeout(2500);
    expect(await played()).toBe(n);
  };

  await say(AOUH, "Franchement ao c'est trop drôle");
  await expectPlayed(1);
  await say(AOUH, 'chaos, aouh, rien à voir');
  await say(LUNA, 'AO !');
  await say(AOUH, 'ao ao ao, trois fois ao');
  await expectPlayed(2); // one sound for the message with « ao » four times, none for the others

  // The extension, as Aouh: « Mes commandes modifiables » with her command and its expression.
  await openCommands(page, AOUH.id);
  const card = page.locator('.cmine__c', { hasText: 'aocmd' });
  await expect(page.locator('.cmine')).toContainText(
    'Mes commandes modifiables',
  );
  await expect(card.locator('.chip')).toHaveText(['ao']);
  // Nothing about the sound, its volume, who can use it or the delays.
  await expect(card.locator('select, input[type="range"]')).toHaveCount(0);
  await expect(page.locator('.cmine')).not.toContainText(
    /Volume|Délai|Cooldown|Ao\.wav/,
  );
  await card.getByRole('button', { name: 'Retirer ao' }).click();
  await card.locator('[data-mine-in]').fill('ouaf');
  await card.locator('[data-mine-in]').press('Enter');
  await card.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(card.locator('.cmine__st')).toContainText('Enregistré');
  await expect(card.locator('.chip')).toHaveText(['ouaf']);
  await say(AOUH, 'ao');
  await say(AOUH, 'Ouaf ouaf');
  await expectPlayed(3); // the new expression works, the old one no longer

  // Off → nothing; on again → it works.
  await card.getByRole('switch', { name: 'Activer aocmd' }).click();
  await card.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(card).toHaveClass(/is-off/);
  await expect(card.locator('.cmine__st')).toContainText('Enregistré');
  await say(AOUH, 'ouaf');
  await expectPlayed(3);
  await card.getByRole('switch', { name: 'Activer aocmd' }).click();
  await card.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(card).not.toHaveClass(/is-off/);
  await say(AOUH, 'ouaf');
  await expectPlayed(4);

  // Her requests straight to the API: only on / off and expressions exist; a stale version is refused.
  const aouh = await extToken(page, AOUH.id);
  const mine = await ext(aouh, '/commands/mine');
  expect(mine.status).toBe(200);
  const cur = mine.body.commands[0];
  expect(Object.keys(cur).sort()).toEqual(
    [
      'command_id',
      'editable',
      'enabled',
      'name',
      'trigger',
      'updated_at',
      'version',
    ].sort(),
  );
  const sneaky = await ext(aouh, `/commands/mine/${commandId}`, {
    expected_version: cur.version,
    actions: [],
    sound: '0000000000000000',
    audience: { groups: ['everyone'], allow: [], deny: [] },
    cooldown: { enabled: true, seconds: 60, unit: 's', scope: 'viewer' },
    editors: [{ id: LUNA.id, name: 'Luna' }],
  });
  expect(sneaky.status).toBe(200); // nothing it may change was asked: unchanged
  const stale = await ext(aouh, `/commands/mine/${commandId}`, {
    expected_version: cur.version - 1,
    enabled: false,
  });
  expect([stale.status, stale.body.error]).toEqual([409, 'version_conflict']);
  const after = (await (
    await page.request.get(`/api/commands/${commandId}`, { headers: studio })
  ).json()) as { version: number; config: CmdConfig };
  expect(after.version).toBe(cur.version);
  expect(after.config.actions).toEqual(saved.config.actions);
  expect(after.config.audience).toEqual(saved.config.audience);
  expect(after.config.cooldown.enabled).toBe(false);
  expect(after.config.editors).toEqual(saved.config.editors);

  // Another viewer: nothing to edit in the extension, and the Core refuses his requests.
  const other = await browser.newPage({
    viewport: { width: 400, height: 800 },
  });
  await openCommands(other, LUNA.id);
  // The public list (Lab) shows the commands to type, never a keyword command nor its expressions.
  await expect(
    other.locator('.cmdx--public .lst, .cmdx--public .empty').first(),
  ).toBeVisible();
  await expect(other.locator('.cmdx--public')).not.toContainText('aocmd');
  await expect(other.locator('.cmine')).toBeHidden();
  const luna = await extToken(page, LUNA.id);
  expect((await ext(luna, '/commands/mine')).body.commands).toEqual([]);
  const refused = await ext(luna, `/commands/mine/${commandId}`, {
    expected_version: after.version,
    enabled: false,
  });
  expect([refused.status, refused.body.error]).toEqual([404, 'not_found']);

  // Studio's journal: her changes, as a delegated editor from the extension.
  await page.goto('/?tab=commands');
  await page.getByRole('button', { name: 'Journal' }).click();
  await page.locator('[data-jtab="changes"]').click();
  await expect(
    page.locator('.cdx-j', { hasText: 'modification déléguée' }).first(),
  ).toBeVisible();

  // The Studio test panel's « Streamer » is the channel itself (identity): a Streamer-only command is accepted.
  const streamerOnly = await page.request.post('/api/commands', {
    headers: studio,
    data: {
      config: {
        name: 'streameronly',
        reply: { mode: 'normal', text: 'ok', to: 'none' },
        audience: { groups: ['broadcaster'], allow: [], deny: [] },
      },
    },
  });
  const list = (await (
    await page.request.get('/api/commands', { headers: studio })
  ).json()) as {
    channel_id: string;
  };
  const tested = await page.request.post('/api/commands/test', {
    headers: studio,
    data: {
      message: '!streameronly',
      command_id: ((await streamerOnly.json()) as { command_id: string })
        .command_id,
      viewer: {
        id: list.channel_id,
        login: 'raptoru_',
        display_name: 'Raptoru_',
        role: 'broadcaster',
        badges: ['broadcaster'],
      },
    },
  });
  expect(((await tested.json()) as { decision: string }).decision).toBe(
    'accepted',
  );
  await other.close();
  await obs.close();
});
