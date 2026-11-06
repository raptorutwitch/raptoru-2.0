import { expect, test, type Page } from '@playwright/test';
import { isolate } from './isolation.js';

// The target Lab (decision of 05/11/2026): the production extension on the MAIN Core's real /v1/ext, through Studio
// (e2e/core-lab-stack.ts). Studio only signs the Lab JWT and relays; the session, the balance, the modules and every
// refusal are the Core's, as in Production. No Studio player is connected: what needs one is refused (Studio closed).

const token = async (page: Page, role: string) =>
  (
    (await (await page.request.get(`/ext-lab/token?role=${role}`)).json()) as {
      token: string;
    }
  ).token;

async function open(page: Page, role: 'viewer' | 'moderator', identity = true) {
  await page.setViewportSize({ width: 400, height: 800 });
  const iso = await isolate(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const session = page.waitForResponse((r) =>
    r.url().endsWith('/ext-lab/api/session'),
  );
  await page.goto(
    `/ext/mobile.html?labRole=${role}${identity ? '' : '&labIdentity=0'}`,
  );
  const res = await session;
  return { ...iso, errors, session: res };
}

test('viewer: the session is the main Core’s (Lab environment), authenticated by a Twitch-format JWT', async ({
  page,
}) => {
  const { outside, errors, session } = await open(page, 'viewer');
  expect(session.status()).toBe(200);
  // A real Extension JWT (header.payload.signature), never the historical « lab. » token.
  expect(await session.request().headerValue('authorization')).toMatch(
    /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,
  );
  const body = (await session.json()) as Record<string, unknown>;
  expect(body).toMatchObject({
    environment: 'lab',
    channel_id: '900100',
    viewer_login: 'Viewer Lab',
    moderation_v2: true,
  });
  expect((body.wallet as { available: number }).available).toBe(20_000);
  // The Hub shows the Core's modules and balance.
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  for (const tile of [/^TTS/, /^Soundboard|^Sons/, /^Bonk/, /^Tombola/])
    await expect(
      page
        .getByRole('button', { name: tile })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});

test('Studio closed: the TTS says it is unavailable and nothing is debited (the Core refuses, not Studio)', async ({
  page,
}) => {
  const { outside, errors } = await open(page, 'viewer');
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page
    .getByRole('button', { name: /^TTS/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.locator('.ttsv2')).toHaveCount(1);
  await expect(
    page.getByText('TTS indisponible pour le moment').first(),
  ).toBeVisible({
    timeout: 15_000,
  });
  // A purchase sent anyway (as a stale page would): the Core refuses it — no Studio player — and debits nothing.
  const buy = await page.request.post('/ext-lab/api/actions/tokens', {
    headers: {
      authorization: `Bearer ${await token(page, 'viewer')}`,
      'idempotency-key': `e2e-core-lab-${Date.now()}`,
    },
    data: { module_id: 'tts', payload: { text: 'Bonjour le Lab' } },
  });
  expect(buy.status()).toBeGreaterThanOrEqual(400);
  expect(((await buy.json()) as { error: string }).error).toMatch(
    /studio_offline|player_offline/,
  );
  // The balance is still the Core's, untouched.
  const state = await page.request.get('/ext-lab/api/state', {
    headers: { authorization: `Bearer ${await token(page, 'viewer')}` },
  });
  expect(
    ((await state.json()) as { wallet: { available: number } }).wallet
      .available,
  ).toBe(20_000);
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});

test('moderator: the D4 console of the Core; viewer without shared identity: no balance, no purchase', async ({
  page,
}) => {
  const mod = await open(page, 'moderator');
  expect(((await mod.session.json()) as { role: string }).role).toBe(
    'moderator',
  );
  await page.getByRole('button', { name: 'Voir tous les modules' }).click();
  await page
    .getByRole('button', { name: /^Modération/ })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.locator('.modv2')).toHaveCount(1);
  expect(mod.errors).toEqual([]);

  const anon = await open(page, 'viewer', false);
  const body = (await anon.session.json()) as Record<string, unknown>;
  expect(body.identity_shared).toBe(false);
  expect(body.twitch_user_id).toBeNull();
  await expect(
    page.getByRole('button', { name: 'Activer mes actions' }),
  ).toBeVisible();
  expect(anon.outside).toEqual([]);
});

test('the relay adds nothing: a token not signed with the Lab Core’s secret is refused by the Core', async ({
  request,
}) => {
  const forged = await request.get('/ext-lab/api/session', {
    headers: { authorization: 'Bearer lab.eyJyb2xlIjoidmlld2VyIn0' },
  });
  expect(forged.status()).toBe(401);
  const token = (await (
    await request.get('/ext-lab/token?role=viewer')
  ).json()) as {
    token: string;
  };
  const [h, p] = token.token.split('.');
  const tampered = await request.get('/ext-lab/api/session', {
    headers: { authorization: `Bearer ${h}.${p}.${'A'.repeat(43)}` },
  });
  expect(tampered.status()).toBe(401);
  // The token Studio signs for the Lab account: accepted.
  const ok = await request.get('/ext-lab/api/session', {
    headers: { authorization: `Bearer ${token.token}` },
  });
  expect(ok.status()).toBe(200);
});

test('Studio open: a TTS bought in the extension is played by Studio’s PRODUCTION worker and settled by the Core', async ({
  request,
}) => {
  const control = `http://127.0.0.1:${Number(process.env.E2E_CORE_LAB_PORT ?? 4389) + 1}`;
  const jwt = (
    (await (await request.get('/ext-lab/token?role=viewer')).json()) as {
      token: string;
    }
  ).token;
  const auth = { authorization: `Bearer ${jwt}` };
  const balance = async () =>
    (
      (await (
        await request.get('/ext-lab/api/state', { headers: auth })
      ).json()) as {
        wallet: { available: number };
      }
    ).wallet.available;
  const before = await balance();
  await request.post(`${control}/studio/open`);
  try {
    // Accepted once Studio's worker and its player have reported to the Core (a few heartbeats).
    let bought: Record<string, unknown> | null = null;
    await expect
      .poll(
        async () => {
          const r = await request.post('/ext-lab/api/actions/tokens', {
            headers: {
              ...auth,
              'idempotency-key': `e2e-core-lab-buy-${Date.now()}`,
            },
            data: { module_id: 'tts', payload: { text: 'Bonjour le Lab' } },
          });
          if (r.ok()) bought = (await r.json()) as Record<string, unknown>;
          return r.status();
        },
        { timeout: 20_000, intervals: [500] },
      )
      .toBe(200);
    expect(bought).toMatchObject({ ok: true });
    // The Core debited its own price once…
    const after = await balance();
    expect(after).toBeLessThan(before);
    // …and the interaction ends « played » (the worker handed it to the player, which reported it read).
    await expect
      .poll(
        async () =>
          JSON.stringify(
            await (
              await request.get('/ext-lab/api/tts/state', { headers: auth })
            ).json(),
          ),
        { timeout: 20_000 },
      )
      .toMatch(/completed|played/);
    expect(await balance()).toBe(after); // settled, never refunded nor debited twice
  } finally {
    await request.post(`${control}/studio/close`);
  }
});

// --- The Lab's own tools on the main Core ------------------------------------------------------------------------------
const STUDIO = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

test('Extension Lab page: wallets, module switches and the Tombola are the Core’s, read and commanded from the panel', async ({
  request,
}) => {
  const state = async () =>
    (await (
      await request.get('/api/ext-lab/state', { headers: STUDIO })
    ).json()) as {
      wallets: Record<string, number>;
      modules: Record<string, boolean>;
      raffle: { open: boolean; participants: number; core: boolean };
    };
  const control = (name: string, data: unknown) =>
    request.post(`/api/ext-lab/control/${name}`, { headers: STUDIO, data });
  const jwt = (
    (await (await request.get('/ext-lab/token?role=viewer')).json()) as {
      token: string;
    }
  ).token;
  const session = async () =>
    (await (
      await request.get('/ext-lab/api/session', {
        headers: { authorization: `Bearer ${jwt}` },
      })
    ).json()) as {
      wallet: { available: number };
      module_states: Record<string, { enabled: boolean }>;
    };

  expect(
    (await control('wallet', { role: 'moderator', amount: 777 })).ok(),
  ).toBe(true);
  expect((await state()).wallets.moderator).toBe(777);

  expect((await control('module', { id: 'bonk', enabled: false })).ok()).toBe(
    true,
  );
  expect((await state()).modules.bonk).toBe(false);
  expect((await session()).module_states.bonk?.enabled).toBe(false);
  expect((await control('module', { id: 'bonk', enabled: true })).ok()).toBe(
    true,
  );

  expect(
    (await control('raffle-open', { seconds: 60, jackpot: 1000 })).ok(),
  ).toBe(true);
  expect((await state()).raffle).toMatchObject({ open: true, core: true });
  expect((await control('raffle-close', {})).ok()).toBe(true);
  expect((await state()).raffle.open).toBe(false);
  await control('raffle-draw', {});
});

test('chat simulator: a message reaches the Core’s modules; the real Twitch chat cannot be switched on', async ({
  request,
}) => {
  const identities = (await (
    await request.get('/api/lab-chat/identities', { headers: STUDIO })
  ).json()) as { identities?: { id: string; login: string }[] };
  expect(JSON.stringify(identities)).toContain('lab_modo');
  const sent = await request.post('/api/lab-chat/simulate', {
    headers: STUDIO,
    data: {
      viewer_id: '900101',
      login: 'lab_viewer',
      display_name: 'Viewer Lab',
      text: 'salut le Lab',
    },
  });
  expect(sent.ok()).toBe(true);
  const recent = await (
    await request.get('/api/lab-chat/recent', { headers: STUDIO })
  ).text();
  expect(recent).toContain('salut le Lab');
  // No adapter, no token: the switch is refused, nothing connects to Twitch.
  const on = await request.post('/api/lab-chat/ingress', {
    headers: STUDIO,
    data: { enabled: true },
  });
  expect(on.status()).toBe(409);
  const output = await request.post('/api/lab-chat/output', {
    headers: STUDIO,
    data: { enabled: true },
  });
  expect(output.status()).toBe(409);
});

test('Spotify simulator: on the fictional Spotify, never a real account', async ({
  request,
}) => {
  const state = (await (
    await request.get('/api/spotify/state', { headers: STUDIO })
  ).json()) as {
    connection: { simulated: boolean };
    sim: unknown;
  };
  expect(state.connection.simulated).toBe(true);
  expect(state.sim).not.toBeNull();
});

test('Roue du Sub simulators: live, presence and a simulated sub reach the Core; the wheel records its spin', async ({
  request,
}) => {
  const post = (path: string, data: unknown) =>
    request.post(`/api/sub-wheel${path}`, { headers: STUDIO, data });
  expect((await post('/lab/live', { on: true })).ok()).toBe(true);
  expect(
    (await post('/lab/presence', { readings: true, viewers: [] })).status(),
  ).toBeLessThan(500);
  const sub = await post('/lab/simulate', {
    kind: 'sub',
    viewer: { id: '900101', name: 'Viewer Lab' },
    tier: 1,
  });
  expect(sub.status(), await sub.text()).toBe(200);
  const state = await request.get('/api/sub-wheel/state', { headers: STUDIO });
  expect(state.ok()).toBe(true);
  await post('/lab/live', { on: false });
});
