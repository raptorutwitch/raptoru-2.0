import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, expect, test, type Page } from '@playwright/test';

// Chatbox Raptoru end to end (docs/CHATBOX.md): the OBS page Studio serves, fed by the simulator. Zero-width 7TV stacks,
// roles (the Aouh case), filtered messages hidden on stream but explained in the preview, moderation, settings and
// placements applied WITHOUT a reload, presets switched at once, the idle disappearance. The demo feed never reaches a
// live page. No OBS, no Twitch: the emote providers are answered locally (e2e/core-lab-stack.ts), their images here.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="#f90"/></svg>';

// The editor's payload, read loosely (host.ts types it).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
interface View {
  demo: { token: string };
  scenes: {
    id: string;
    profile: string;
    placement: { x: number; y: number; w: number; h: number; zoom: number };
  }[];
  profiles: { id: string; settings: Loose }[];
}

async function api<T>(page: Page, path: string, body?: object) {
  const r = await page.request.fetch(`/api/chatbox${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-raptoru-studio': '1' },
    ...(body ? { data: body } : {}),
  });
  expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBe(true);
  return (await r.json()) as T;
}

async function openPage(page: Page, token: string, q: Record<string, string>) {
  for (const host of [
    'cdn.7tv.app',
    'cdn.betterttv.net',
    'static-cdn.jtvnw.net',
  ])
    await page.route(`https://${host}/**`, (r) =>
      r.fulfill({ body: PNG, contentType: 'image/png' }),
    );
  await page.route('https://cdn.jsdelivr.net/**', (r) =>
    r.fulfill({ body: SVG, contentType: 'image/svg+xml' }),
  );
  await page.goto(`/chatbox/player.html?${new URLSearchParams(q)}#${token}`);
  await page.waitForFunction(
    () =>
      document.getElementById('box')!.style.getPropertyValue('--text-size') !==
      '',
  );
}

/** Every page a test opens is closed after it: an OBS page left open would keep animating and streaming for the
 *  rest of the run (and slow the next specs down). */
const pages: Page[] = [];
const open = async (
  browser: Browser,
  opts?: Parameters<Browser['newPage']>[0],
) => {
  const p = await browser.newPage(opts);
  pages.push(p);
  return p;
};
test.afterEach(async () => {
  await Promise.all(pages.splice(0).map((p) => p.context().close()));
});

const send = (page: Page, id: string) =>
  api<{ id: string }>(page, '/demo', { case: id });

test('Chatbox: the OBS page renders, filters, moderates and follows Studio without a reload', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = await open(browser);
  const view = await api<View>(admin, '');
  const token = view.demo.token;
  await api(admin, '/demo', { clear: true });

  const live = await open(browser, {
    viewport: { width: 1920, height: 1080 },
  });
  await openPage(live, token, {
    profile: 'just-chatting',
    scene: 'just-chatting',
  });
  const obs = await open(browser, {
    viewport: { width: 1920, height: 1080 },
  });
  await openPage(obs, token, {
    profile: 'just-chatting',
    scene: 'just-chatting',
    feed: 'demo',
  });
  const preview = await open(browser, {
    viewport: { width: 1920, height: 1080 },
  });
  await openPage(preview, token, {
    profile: 'just-chatting',
    scene: 'just-chatting',
    feed: 'demo',
    explain: '1',
  });
  // The page is placed by Studio on the full 1920 × 1080 frame, at the scene's historical zone.
  const jc = view.scenes.find((s) => s.id === 'just-chatting')!.placement;
  expect(
    await obs.evaluate(() => document.getElementById('box')!.style.left),
  ).toBe(`${jc.x}px`);
  expect(
    await obs.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)');

  // Zero-width 7TV emotes stack over the previous emote (P03); a BTTV emote alone is an emote-only message (P06).
  await send(admin, 'P03');
  const stack = obs
    .locator('.msg .stack')
    .filter({ has: obs.locator('img.zero') });
  await expect(stack).toHaveCount(1);
  await expect(stack.locator('img.base')).toHaveAttribute('alt', '199Pray');
  await expect(stack.locator('img.zero')).toHaveCount(2);
  await send(admin, 'P06b');
  await expect(obs.locator('.msg.is-emote-only')).toHaveCount(1);

  // Roles: a Lead Moderator and a Raptoru supermod without a Twitch badge both get the green bar (the Aouh case).
  await send(admin, 'P12b');
  await send(admin, 'P12c');
  await expect(obs.locator('.msg.role-moderator')).toHaveCount(3); // P03 is Modo_Lead too
  // An announcement is highlighted with its tag.
  await send(admin, 'S01');
  await expect(obs.locator('.msg.is-hl .tag')).toHaveText('Annonce');

  // A recognised command never reaches the stream; `!!!!!` does; the preview shows the hidden one struck, with its rule.
  await send(admin, 'P19a');
  await send(admin, 'P19b');
  await expect(obs.locator('.msg', { hasText: '!!!!!' })).toHaveCount(1);
  await expect(obs.locator('.msg', { hasText: '!roue' })).toHaveCount(0);
  await expect(
    preview.locator('.msg.is-hidden', { hasText: '!roue' }).locator('.why'),
  ).toContainText('commande Roue du Sub (!roue)');
  // The demo never reaches a live page.
  expect(await live.locator('.msg').count()).toBe(0);

  // Moderation: a deleted message and a viewer's messages disappear.
  const doomed = await send(admin, 'P11a');
  await expect(obs.locator(`.msg[data-id="${doomed.id}"]`)).toHaveCount(1);
  await api(admin, '/demo', { delete: doomed.id });
  await expect(obs.locator(`.msg[data-id="${doomed.id}"]`)).toHaveCount(0);
  await api(admin, '/demo', { clearUser: '9000003' });
  await expect(obs.locator('.msg.role-moderator')).toHaveCount(1);

  // Settings and placement saved in Studio apply at once, without a reload.
  await obs.evaluate(() => ((window as unknown as { keep: number }).keep = 1));
  const settings = structuredClone(
    view.profiles.find((p) => p.id === 'just-chatting')!.settings,
  );
  settings.text.size = 31;
  await api(admin, '/profile', { profile: 'just-chatting', settings });
  await expect
    .poll(() =>
      obs.evaluate(() =>
        document.getElementById('box')!.style.getPropertyValue('--text-size'),
      ),
    )
    .toBe('31px');
  await api(admin, '/placement', {
    scene: 'just-chatting',
    placement: { ...jc, x: 1200 },
  });
  await expect
    .poll(() => obs.evaluate(() => document.getElementById('box')!.style.left))
    .toBe('1200px');
  expect(
    await obs.evaluate(() => (window as unknown as { keep?: number }).keep),
  ).toBe(1);

  // A preset compared at once (the demonstration): « Origine » brings the widgets' screen sizes back.
  await obs.evaluate(() =>
    window.postMessage(
      { type: 'chatbox:preset', preset: 'origine' },
      location.origin,
    ),
  );
  await expect
    .poll(() =>
      obs.evaluate(() =>
        document.getElementById('box')!.style.getPropertyValue('--text-size'),
      ),
    )
    .toBe('26.2px');

  // React's idle disappearance: the whole chat fades out after its delay of silence.
  const react = structuredClone(
    view.profiles.find((p) => p.id === 'react')!.settings,
  );
  react.presence.seconds = 1;
  await api(admin, '/profile', { profile: 'react', settings: react });
  const ps5 = await open(browser, {
    viewport: { width: 1920, height: 1080 },
  });
  await openPage(ps5, token, { profile: 'react', scene: 'ps5', feed: 'demo' });
  await send(admin, 'P01');
  await expect(ps5.locator('#box')).not.toHaveClass(/is-idle-hidden/);
  await expect(ps5.locator('#box')).toHaveClass(/is-idle-hidden/, {
    timeout: 5000,
  });

  // Back to the initial state for the next specs.
  await api(admin, '/preset/apply', {
    profile: 'just-chatting',
    preset: 'modernisee',
  });
  await api(admin, '/preset/apply', { profile: 'react', preset: 'modernisee' });
  await api(admin, '/placement/reset', { scene: 'just-chatting' });
});

// --- The real chain and the animations -------------------------------------------------------------------------------

const PORT = Number(process.env.E2E_PORT ?? 4399);
const CHANNEL = '900100';
/** The specs' door to the Lab Core (e2e/core-lab-stack.ts): its simulated chat goes through the real router. */
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
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<Record<string, unknown>>;
};
const chat = (text: string) =>
  labCore('/v1/lab/chat', {
    channel_id: CHANNEL,
    message_id: randomUUID(),
    text,
    chatter: {
      id: '57099012',
      login: 'chatbox_e2e',
      display_name: 'Chatbox_E2E',
      role: 'viewer',
    },
    source: 'simulator',
  });

test('Chatbox: the real chain — the Lab chat reaches the live OBS page through the Core, filtered by the command catalogue', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = await open(browser);
  const view = await api<
    View & {
      live: { linked: boolean };
      commands: { key: string; words: string[]; module: string }[];
      rules: Loose;
    }
  >(admin, '');
  expect(view.live.linked).toBe(true);
  // Every command the project knows: Commands V2, the modules' words, the bot's own (Daily, Jetons), aliases together.
  const words = view.commands.flatMap((c) => c.words);
  for (const w of [
    'roue',
    'rb',
    'tts',
    'fxcam',
    'song',
    'daily',
    'solde',
    'caution',
    'votekick',
  ])
    expect(words, w).toContain(w);
  const solde = view.commands.find((c) => c.words.includes('solde'))!;
  expect(solde.words).toEqual(['solde', 'balance', 'compte']);

  const live = await open(browser, {
    viewport: { width: 1920, height: 1080 },
  });
  await openPage(live, view.demo.token, {
    profile: 'just-chatting',
    scene: 'just-chatting',
  });
  await expect
    .poll(
      async () =>
        (await api<{ live: { connected: boolean } }>(admin, '')).live.connected,
    )
    .toBe(true);
  await chat('Bonjour la chaîne 🔥');
  await chat('!roue');
  await chat('!!!!!');
  await expect(
    live.locator('.msg', { hasText: 'Bonjour la chaîne' }),
  ).toHaveCount(1);
  await expect(live.locator('.msg', { hasText: '!!!!!' })).toHaveCount(1);
  await expect(live.locator('.msg', { hasText: '!roue' })).toHaveCount(0);

  // One command shown from now on (its aliases with it): the page re-decides at once, no reload.
  const roue = view.commands.find((c) => c.words.includes('roue'))!;
  const rules = structuredClone(view.rules);
  rules.commands.rules[roue.key] = { message: 'normal' };
  await api(admin, '/rules', { rules });
  await expect(live.locator('.msg', { hasText: '!roue' })).toHaveCount(1);
  rules.commands.rules = {};
  await api(admin, '/rules', { rules });
});

test('Chatbox: React and Dessin — a new message pushes the stack, never overlaps it (arrival, burst, deletion)', async ({
  browser,
}) => {
  const admin = await open(browser);
  const view = await api<View>(admin, '');
  await api(admin, '/demo', { clear: true });
  for (const profile of ['react', 'dessin']) {
    const page = await open(browser, {
      viewport: { width: 1920, height: 1080 },
    });
    await openPage(page, view.demo.token, { profile, feed: 'demo' });
    // Every animation frame for 2.5 s: two neighbours never overlap (the stack moves as one block).
    const watch = page.evaluate(async () => {
      let worst = 0;
      const end = performance.now() + 2500;
      while (performance.now() < end) {
        await new Promise((r) => requestAnimationFrame(r));
        const r = [...document.querySelectorAll('#log > .msg')].map((e) =>
          e.getBoundingClientRect(),
        );
        for (let i = 1; i < r.length; i++)
          worst = Math.max(worst, r[i - 1]!.bottom - r[i]!.top);
      }
      return worst;
    });
    const first = await send(admin, 'P01');
    await page.waitForTimeout(150);
    for (const c of ['P02', 'P05', 'P07', 'P12d']) await send(admin, c);
    await page.waitForTimeout(500);
    await api(admin, '/demo', { delete: first.id });
    expect(await watch, `${profile}: overlap in px`).toBeLessThanOrEqual(1);
    await api(admin, '/demo', { clear: true });
  }
});
