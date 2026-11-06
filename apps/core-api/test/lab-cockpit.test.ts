import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { labEconomy } from '../src/economy/economy.js';
import { signExtensionJwt } from '../src/ext/twitch-jwt.js';
import { createMainCore, createMainServer } from '../src/main-server.js';
import { sha256, STUDIO_PROTOCOL_HEADER } from '../src/studio/installations.js';
import { createTestDb, FakeClock } from './helpers.js';

// The main Core in its environments, through its real doors. Lab (CORE_ENVIRONMENT=lab): the cockpit carries the whole Lab
// table (simulators, the chat simulator), the extension sees Commandes and the Roue, the Bonk has its fictional
// catalogs. Any other environment (Production): the cockpit keeps its closed list, nothing of this exists, no public
// consent page, the same session as before.

const CHANNEL = '900100';
const SECRET = randomBytes(32);
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function boot(environment: 'staging' | 'lab') {
  const db = await createTestDb();
  const clock = new FakeClock(new Date());
  const config = loadConfig({
    CORE_ENVIRONMENT: environment,
    DATABASE_URL: 'postgres://127.0.0.1/unused_lab',
    TWITCH_CHANNEL_ID: CHANNEL,
    TWITCH_CHANNEL_LOGIN: 'raptoru_lab',
    BOT_SECRET: 'b'.repeat(24),
    STUDIO_SECRET: 's'.repeat(24),
    TWITCH_EXTENSION_SECRET: SECRET.toString('base64'),
  });
  const core = createMainCore(
    db,
    clock,
    config,
    labEconomy,
    new DevFakeCreditProvider(),
  );
  const { server } = createMainServer(core, db, clock, config);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  await core.studioInstallations.register(
    `${id}.${sha256(secret)}`,
    'Studio test',
  );
  const cockpit = (path: string, body?: unknown) =>
    fetch(`${base}/v1/studio/cockpit/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer rsi_${id}.${secret}`,
        [STUDIO_PROTOCOL_HEADER]: '1',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const jwt = signExtensionJwt(
    {
      exp: Math.floor(Date.now() / 1000) + 600,
      opaque_user_id: 'U900101',
      user_id: '900101',
      channel_id: CHANNEL,
      role: 'viewer',
    },
    SECRET,
  );
  const session = async () =>
    (await (
      await fetch(`${base}/v1/ext/session`, {
        headers: { authorization: `Bearer ${jwt}` },
      })
    ).json()) as {
      commands_public: boolean;
      sub_wheel: boolean;
      modules: { id: string; emote_catalog?: { groups: unknown[] } }[];
    };
  return { base, cockpit, session };
}

const message = {
  channel_id: CHANNEL,
  message_id: 'm-1',
  text: 'bonjour le chat',
  chatter: {
    id: '900101',
    login: 'lab_viewer',
    display_name: 'Viewer Lab',
    role: 'viewer',
  },
  source: 'simulator',
};

describe('the main Core: Lab environment vs Production', () => {
  it('Production: closed cockpit list, no simulated chat, no consent page, the session as before', async () => {
    const { base, cockpit, session } = await boot('staging');
    expect((await cockpit(`wallet/${CHANNEL}/900101`)).status).toBe(200);
    expect((await cockpit(`spotify/${CHANNEL}/state`)).status).toBe(404);
    expect((await cockpit('chat', message)).status).toBe(404);
    expect(
      (await fetch(`${base}/v1/ext/lab/twitch-authorize`)).status,
    ).not.toBe(200);
    const s = await session();
    expect(s).toMatchObject({ commands_public: false, sub_wheel: false });
    expect(s.modules.find((m) => m.id === 'bonk')!.emote_catalog).toEqual({
      groups: [],
    });
  });

  it('Lab: the whole Lab table through the cockpit, the simulator, Commandes, the Roue, fictional emotes', async () => {
    const { cockpit, session } = await boot('lab');
    expect((await cockpit(`spotify/${CHANNEL}/state`)).status).toBe(200);
    expect((await cockpit(`sub-wheel/${CHANNEL}/state`)).status).toBe(200);
    expect((await cockpit('chat', message)).status).toBe(200);
    const recent = (await (await cockpit(`chat/${CHANNEL}/recent`)).json()) as {
      messages: { text: string }[];
    };
    expect(recent.messages.map((m) => m.text)).toContain('bonjour le chat');
    // Even in the Lab: the wrong door stays closed (a viewer's action never goes through the cockpit).
    expect(
      (await cockpit(`modules/${CHANNEL}/coffre_mystere/viewer`, {})).status,
    ).toBe(404);
    const s = await session();
    expect(s).toMatchObject({ commands_public: true, sub_wheel: true });
    expect(
      s.modules.find((m) => m.id === 'bonk')!.emote_catalog!.groups.length,
    ).toBeGreaterThan(0);
  });
});
