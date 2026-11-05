import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/app.js';
import type { CoreConfig } from '../src/config.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { createPublicFrontier } from '../src/ext/public-frontier.js';
import { createApp } from '../src/http/server.js';
import { createTestDb, FakeClock } from './helpers.js';

// The bot's chat door of the main Core (/v1/bot/chat). Production: Twitch messages only — Studio's simulator never
// reaches it (once the Wallet is canonical, its chat would move real money). The Lab environment (fictional Jetons):
// the simulator plays the bot on this same door, and reads the recent messages back.

const CHANNEL = '900100';
const BOT = 'bot-test-secret-0123456789';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function core(environment: 'staging' | 'lab') {
  const db = await createTestDb();
  const clock = new FakeClock(new Date());
  const c = createCore(
    db,
    clock,
    new DevFakeCreditProvider(),
    undefined,
    null,
    undefined,
    {
      broadcasterId: CHANNEL,
    },
  );
  const frontier = createPublicFrontier(c, db, clock, {
    TWITCH_CHANNEL_ID: CHANNEL,
    TWITCH_CHANNEL_LOGIN: 'raptoru_lab',
    TWITCH_EXTENSION_SECRET: randomBytes(32).toString('base64'),
    CORE_ENVIRONMENT: environment,
  } as CoreConfig)!;
  const server = createApp({
    ...c,
    botSecret: BOT,
    studioSecret: 'studio-test-secret-0123456',
    labRoutes: false,
    ...frontier.deps,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (path: string, body?: unknown) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${BOT}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const message = (source: 'twitch' | 'simulator') => ({
  channel_id: CHANNEL,
  message_id: `m-${source}-${Math.random()}`,
  text: 'bonjour le chat',
  chatter: {
    id: '900101',
    login: 'lab_viewer',
    display_name: 'Viewer Lab',
    role: 'viewer',
  },
  source,
});

describe('bot chat door: the simulator in the Lab environment only', () => {
  it('Production (any non-lab environment): a simulated message is refused, no recent-messages route', async () => {
    const call = await core('staging');
    const r = await call('/v1/bot/chat', message('simulator'));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'twitch_source_required' });
    expect((await call(`/v1/bot/chat/${CHANNEL}/recent`)).status).toBe(404);
    expect((await call('/v1/bot/chat', message('twitch'))).status).toBe(200);
  });

  it('Lab: the simulator plays the bot on the same door; its message is in the recent ones', async () => {
    const call = await core('lab');
    expect((await call('/v1/bot/chat', message('simulator'))).status).toBe(200);
    const recent = (await (
      await call(`/v1/bot/chat/${CHANNEL}/recent`)
    ).json()) as {
      messages: { text: string }[];
    };
    expect(recent.messages.map((m) => m.text)).toContain('bonjour le chat');
  });
});
