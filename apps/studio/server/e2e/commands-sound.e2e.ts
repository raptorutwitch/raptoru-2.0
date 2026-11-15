import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

// Commands V2, the « sound » action, end to end in real browsers (docs/COMMANDS_V2_STATUS.md): a sound imported in
// Studio (a Lab placeholder made here, never the streamer's file), « !groslot » for Aouh only (by Twitch id), the sound
// only (no chat message); Aouh writes it → the invisible OBS sound source plays that file, nothing drawn; another viewer
// → nothing; the editor shows the sound step. Isolated stack: no Twitch, no real data.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const CHANNEL = '900100';
const AOUH = '57099001';
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
const say = (id: string, login: string) =>
  labCore('/v1/lab/chat', {
    channel_id: CHANNEL,
    message_id: randomUUID(),
    text: '!groslot',
    chatter: { id, login, display_name: login, role: 'viewer' },
    source: 'simulator',
  });

test('Commands: « !groslot » by Aouh plays its imported sound on the OBS sound source; nobody else; the editor shows it', async ({
  page,
  browser,
}) => {
  const studio = { 'x-raptoru-studio': '1' };
  // The sound, imported in Studio.
  const imported = await page.request.post(
    '/api/level-up/command-sounds?name=Gros%20lot.wav',
    { headers: studio, data: placeholderWav() },
  );
  expect(imported.ok(), await imported.text()).toBe(true);
  const sound = (await imported.json()) as { id: string; label: string };
  expect(sound.label).toBe('Gros lot');

  // « !groslot »: Aouh only (her Twitch id), the sound only, 30 s between two uses.
  const created = await page.request.post('/api/commands', {
    headers: studio,
    data: {
      config: {
        name: 'groslot',
        reply: { mode: 'silent', text: '', to: 'none' },
        audience: {
          groups: [],
          allow: [],
          allow_ids: [{ id: AOUH, name: 'Aouh' }],
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
        cooldown: { enabled: true, seconds: 30, unit: 's', scope: 'global' },
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);

  // The invisible OBS sound source (its URL from Studio).
  const state = await (
    await page.request.get('/api/level-up/state', { headers: studio })
  ).json();
  const obs = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const played: string[] = [];
  obs.on('request', (r) => {
    if (r.url().includes('/level-up/cmd/')) played.push(r.url());
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

  // Bob: refused, nothing played. Aouh: her sound, once.
  await say('57099002', 'bob');
  await say(AOUH, 'aouh');
  await expect.poll(() => played.length, { timeout: 15_000 }).toBe(1);
  expect(played[0]).toContain(`/level-up/cmd/${sound.id}`);
  await obs.waitForTimeout(3000);
  expect(played).toHaveLength(1);
  expect(await obs.locator('body *:not(script)').count()).toBe(0);

  // The editor: the sound step, with its name.
  await page.goto('/?tab=commands');
  await page.locator('.cdx-li', { hasText: '!groslot' }).click();
  await expect(page.locator('[data-asound]')).toHaveValue(sound.id);
  await expect(
    page.getByRole('button', { name: 'Ajouter un son' }),
  ).toBeVisible();
  await expect(page.locator('.cdx-li', { hasText: '!groslot' })).toContainText(
    'Uniquement Aouh',
  );
});
