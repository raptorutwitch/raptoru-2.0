import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// The latency of a command sound (docs/COMMANDS_V2_STATUS.md): from the chat message posted to the Core to the OBS
// source's audio actually playing, for « !lat » and a keyword. Studio's claim waits on the Core (long-poll): the sound
// leaves as soon as the admission committed it — never after a polling interval (it used to wait 0–2 s). Each step is
// printed (this machine's clocks: Core admission, queue → Studio → source, audio start). Fictional data only.

const PORT = Number(process.env.E2E_PORT ?? 4399);
const CHANNEL = '900100';
const VIEWER = { id: '900101', login: 'lab_viewer' };
const core = () =>
  JSON.parse(
    readFileSync(join(tmpdir(), `raptoru-e2e-core-${PORT}.json`), 'utf8'),
  ) as { url: string; secret: string };
const say = async (text: string) => {
  const { url, secret } = core();
  const r = await fetch(`${url}/v1/lab/chat`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      channel_id: CHANNEL,
      message_id: randomUUID(),
      text,
      chatter: { ...VIEWER, display_name: VIEWER.login, role: 'viewer' },
      source: 'simulator',
    }),
  });
  expect(r.ok, await r.text()).toBe(true);
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
type Played = { created: number; playing?: number };

test('a command sound plays at once: chat → Core → Studio (waiting claim) → OBS source playing, exact and keyword', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const studio = { 'x-raptoru-studio': '1' };
  const imported = await page.request.post(
    '/api/level-up/command-sounds?name=Lat.wav',
    { headers: studio, data: placeholderWav() },
  );
  const sound = (await imported.json()) as { id: string; label: string };
  const action = () => ({
    type: 'sound',
    v: 1,
    id: randomUUID(),
    on_error: 'continue',
    sound: sound.id,
    label: sound.label,
  });
  const base = {
    reply: { mode: 'silent', text: '', to: 'none' },
    audience: { groups: ['everyone'], allow: [], deny: [] },
    cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'viewer' },
  };
  for (const config of [
    { name: 'lat', ...base, actions: [action()] },
    {
      name: 'latkw',
      ...base,
      actions: [action()],
      trigger: { mode: 'keywords', keywords: ['zzlat'], match: 'word' },
    },
  ])
    expect(
      (
        await page.request.post('/api/commands', {
          headers: studio,
          data: { config },
        })
      ).ok(),
    ).toBe(true);

  // The invisible OBS sound source: when each sound is created and when it actually plays.
  const state = await (
    await page.request.get('/api/level-up/state', { headers: studio })
  ).json();
  const obs = await browser.newPage();
  await obs.addInitScript(() => {
    const Real = window.Audio;
    const w = window as unknown as { __t: Played[] };
    w.__t = [];
    window.Audio = function (src?: string) {
      const a = new Real(src);
      const rec: Played = { created: Date.now() };
      w.__t.push(rec);
      a.addEventListener('playing', () => (rec.playing = Date.now()));
      return a;
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
  const played = () =>
    obs.evaluate(() => (window as unknown as { __t: Played[] }).__t);

  for (let i = 0; i < 6; i++) {
    const keyword = i % 2 === 1;
    // Any moment (a polling interval would show up as a random wait).
    await obs.waitForTimeout(250 + Math.floor(Math.random() * 1700));
    const t0 = Date.now();
    await say(keyword ? `franchement zzlat ${i}` : '!lat');
    const t1 = Date.now();
    await expect
      .poll(async () => (await played()).filter((r) => r.playing).length, {
        timeout: 10_000,
        intervals: [20],
      })
      .toBe(i + 1);
    const r = (await played())[i]!;
    const line = `${keyword ? 'keyword' : 'exact  '} core=${t1 - t0}ms queue+studio=${r.created - t1}ms audio=${r.playing! - r.created}ms total=${r.playing! - t0}ms`;
    console.log(line);
    expect(r.playing! - t0, line).toBeLessThan(1000);
  }
  await obs.close();
});
