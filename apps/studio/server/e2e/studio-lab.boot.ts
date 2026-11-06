import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { isolate } from './isolation.js';

// Acceptance of the Lab on the real Core against a REAL Studio server (dist/index.js, the whole boot: runtime, Postgres,
// preparation, the main Core process), not the test stack. Started by hand, isolated, then:
//   E2E_BOOT=1 E2E_PORT=<its port> npx playwright test
// Real overlay and players (pages), fictional OBS, fictional Twitch, nothing leaves the machine.

const STUDIO = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

test('the Lab says what it is: profile, services, the main Core, fictional OBS', async ({
  request,
}) => {
  const runtime = (await (
    await request.get('/api/runtime/status', { headers: STUDIO })
  ).json()) as { services: { id: string; state: string; label: string }[] };
  for (const s of runtime.services)
    expect(s.state, `${s.id}: ${s.label}`).toBe('ready');
  expect(runtime.services.find((s) => s.id === 'labcore')?.label).toContain(
    'Core principal',
  );
  const bonk = (await (
    await request.get('/api/bonk-lab/status', { headers: STUDIO })
  ).json()) as { obs: boolean; obs_fictional: boolean };
  expect(bonk).toMatchObject({ obs: true, obs_fictional: true });
});

test('protections: no real OBS, no Test Lab bot, no real chat, no Twitch authorization', async ({
  request,
}) => {
  const post = (path: string, data: unknown = {}) =>
    request.post(path, { headers: STUDIO, data });
  // What Electron does at start with the saved OBS connection.
  const obs = await post('/api/bonk-lab/connect', {
    port: 4455,
    password: 'x',
  });
  expect(obs.ok()).toBe(false);
  expect(await obs.text()).toContain('lab_obs_fictional');
  for (const action of ['bot/start', 'core/start', 'start-all'])
    expect((await post(`/api/test-lab/${action}`)).status(), action).toBe(409);
  expect(
    (await post('/api/lab-chat/ingress', { enabled: true })).status(),
  ).toBe(409);
  expect((await post('/api/lab-chat/output', { enabled: true })).status()).toBe(
    409,
  );
});

const PAGES = [
  'centre',
  'regie',
  'moderation',
  'modules',
  'alerts',
  'systeme',
  'tombola',
  'extension-lab',
];
test('Studio: the main pages draw, with no page error and nothing leaving', async ({
  page,
}) => {
  const { outside } = await isolate(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const p of PAGES) {
    await page.goto(`/?p=${p}`);
    await page.waitForTimeout(800);
    await expect(page.locator('body')).not.toContainText(
      'Serveur Studio injoignable',
    );
  }
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});

async function openBonk(page: Page) {
  await page.goto('/ext/mobile.html?labRole=viewer');
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page
    .getByRole('button', { name: /^Bonk/ })
    .filter({ visible: true })
    .first()
    .click();
}

test('a Bonk from the extension reaches the REAL overlay page and is settled by the Core', async ({
  browser,
  request,
}) => {
  const { overlayUrl } = (await (
    await request.get('/api/bonk-lab/status', { headers: STUDIO })
  ).json()) as { overlayUrl: string };
  const overlay = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  await overlay.goto(overlayUrl);
  await expect
    .poll(
      async () =>
        (
          (await (
            await request.get('/api/bonk-lab/status', { headers: STUDIO })
          ).json()) as { ready: boolean }
        ).ready,
      { timeout: 20_000 },
    )
    .toBe(true);

  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  const { outside } = await isolate(page);
  await openBonk(page);
  await page.getByRole('button', { name: 'Passer' }).click();
  // A fictional 7TV emote (the Core's fictional catalog), loaded and fired.
  await page
    .getByRole('button', { name: 'PepoFictif', exact: true })
    .first()
    .click();
  await page.locator('[data-bkc="cta"]').click();
  await expect
    .poll(
      async () => {
        const s = (await (
          await request.get('/api/bonk-lab/status', { headers: STUDIO })
        ).json()) as { interactions: { status: string }[] };
        return s.interactions.map((i) => i.status).join(',');
      },
      { timeout: 30_000 },
    )
    .toMatch(/played|completed/);
  expect(outside).toEqual([]);
  await overlay.close();
  await page.close();
});

const jwtOf = async (request: APIRequestContext) =>
  (
    (await (await request.get('/ext-lab/token?role=viewer')).json()) as {
      token: string;
    }
  ).token;

test('a sound and a TTS bought in the extension are played by the REAL player pages', async ({
  browser,
  request,
}) => {
  const status = async (path: string) =>
    (await (await request.get(path, { headers: STUDIO })).json()) as {
      ready: boolean;
      playerUrl?: string;
      overlayUrl?: string;
      interactions?: { status: string }[];
      queue?: unknown;
    };
  const sound = await browser.newPage();
  await sound.goto((await status('/api/sound-lab/status')).playerUrl!);
  await sound.getByRole('button', { name: 'Activer le son' }).click();
  const tts = await browser.newPage();
  // Headless Chromium has no voice: Web Speech answers here (the page, its stage and its reports are the real ones).
  await tts.addInitScript(() => {
    class Utterance {
      onstart?: () => void;
      onend?: () => void;
      onboundary?: () => void;
      constructor(public text: string) {}
    }
    (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance =
      Utterance;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [
          {
            name: 'Voix Lab',
            lang: 'fr-FR',
            voiceURI: 'lab',
            default: true,
            localService: true,
          },
        ],
        addEventListener: () => {},
        cancel: () => {},
        speak(u: Utterance) {
          setTimeout(() => u.onstart?.(), 10);
          setTimeout(() => u.onend?.(), 50);
        },
      },
    });
  });
  const ttsUrl = new URL((await status('/api/tts-lab/status')).overlayUrl!);
  ttsUrl.searchParams.set('mute', '1');
  await tts.goto(ttsUrl.href);
  await expect
    .poll(async () => (await status('/api/sound-lab/status')).ready, {
      timeout: 20_000,
    })
    .toBe(true);
  await expect
    .poll(async () => (await status('/api/tts-lab/status')).ready, {
      timeout: 20_000,
    })
    .toBe(true);

  const headers = (key: string, jwt: string) => ({
    authorization: `Bearer ${jwt}`,
    'idempotency-key': `boot-${key}-${Date.now()}`,
  });
  const jwt = await jwtOf(request);
  const session = (await (
    await request.get('/ext-lab/api/session', {
      headers: { authorization: `Bearer ${jwt}` },
    })
  ).json()) as {
    wallet: { available: number };
    modules: { id: string; sounds?: { id: string; enabled?: boolean }[] }[];
  };
  const soundId = session.modules
    .find((m) => m.id === 'soundboard')!
    .sounds!.find((s) => s.id !== 'random' && s.enabled !== false)!.id;
  await request.post('/ext-lab/api/actions/tokens', {
    headers: headers('sound', jwt),
    data: { module_id: 'soundboard', payload: { sound_id: soundId } },
  });
  await expect
    .poll(
      async () =>
        (await status('/api/sound-lab/status')).interactions
          ?.map((i) => i.status)
          .join(','),
      { timeout: 30_000 },
    )
    .toMatch(/played|completed/);
  const buyTts = await request.post('/ext-lab/api/actions/tokens', {
    headers: headers('tts', jwt),
    data: { module_id: 'tts', payload: { text: 'Bonjour le Lab' } },
  });
  expect(buyTts.status(), await buyTts.text()).toBe(200);
  await expect
    .poll(
      async () =>
        JSON.stringify(
          await (
            await request.get('/ext-lab/api/tts/state', {
              headers: { authorization: `Bearer ${jwt}` },
            })
          ).json(),
        ),
      { timeout: 30_000 },
    )
    .toMatch(/completed|played/);
  await sound.close();
  await tts.close();
});
