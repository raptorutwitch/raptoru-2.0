import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreConfig } from '../src/config.js';
import { createPublicFrontier } from '../src/ext/public-frontier.js';
import { createApp } from '../src/http/server.js';
import { createCoreChatBridge } from '../../twitch-bot/src/core-chat-bridge.js';
import type { AlertOutboxEvent } from '../../twitch-bot/src/lab-alerts-ingest.js';
import { memoryOutbox } from '../../twitch-bot/src/loyalty-outbox.js';
import { createEventSubRouter } from '../../twitch-bot/src/twitch/eventsub.js';
import {
  BROADCASTER,
  EVENTS,
  frame,
  READER,
} from '../../twitch-bot/test/fixtures/eventsub-alerts.js';
import { count, setup } from './helpers.js';

// Lot 8, end to end in one process: the production bot's bridge (core-chat-bridge.ts, the Lab adapter's modules)
// → a real HTTP main Core (bot secret, /v1/bot/*). Twitch EventSub frames in, nothing sent to Twitch.

const BOT = 'bot-bridge-secret-0123456789abcdef';
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0))
    await new Promise((r) => s.close(() => r(null)));
});

async function fixture() {
  const core = await setup();
  const frontier = createPublicFrontier(core, core.db, core.clock, {
    TWITCH_CHANNEL_ID: BROADCASTER,
    TWITCH_CHANNEL_LOGIN: 'raptoru_',
    CORE_ENVIRONMENT: 'staging',
  } as CoreConfig)!;
  let base = '';
  const start = async () => {
    const server = createApp({
      ...core,
      ...frontier.deps,
      labRoutes: false,
      botSecret: BOT,
      studioSecret: 'studio-bridge-secret-0123456789',
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return server;
  };
  // As src/index.ts of the bot: POST with the bot secret; the Lab adapter's error shape.
  const call = async (path: string, body: unknown) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${BOT}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as unknown };
  };
  const outbox = memoryOutbox<AlertOutboxEvent>();
  const bridge = createCoreChatBridge({
    post: async (path, body) => {
      const r = await call(path, body).catch(() => ({
        status: 503,
        body: null,
      }));
      if (r.status < 200 || r.status >= 300)
        throw new Error(`lab_core_${r.status}`);
      return r.body;
    },
    call,
    channelId: BROADCASTER,
    broadcasterId: BROADCASTER,
    tokenUserId: READER,
    scopes: ['user:read:chat'],
    games: true,
    alertsMode: 'active',
    alertsOutbox: outbox,
    runtimeChat: false,
    subscribe: async () => {},
    getStream: async () => ({ id: '4242' }) as never,
    log: () => {},
  });
  const route = createEventSubRouter({
    subscribe: (s) => bridge.subscribe(s),
    notification: (t, e, id, ts) => bridge.notification(t, e, id, ts),
    log: () => {},
  });
  const deliver = (type: string, event: object, id: string) =>
    route(frame(type, '1', event as Record<string, unknown>, id), true);
  return { core, frontier, bridge, outbox, start, deliver };
}

describe('production bot bridge → main Core (real HTTP)', () => {
  it('chat, stream state and a sub reach the main Core once; Core down → kept, delivered once after its restart', async () => {
    const f = await fixture();
    const first = await f.start();
    await f.core.subWheel.setEnabled(BROADCASTER, true);
    // On (re)connection: the live stream is read and sent (Tombola / Jeu des mots session).
    await f.bridge.subscribe('s1');
    expect(
      await count(f.core.db, 'lab_stream_sessions where ended_at is null'),
    ).toBe(1);
    const chat = {
      ...EVENTS.sub,
      chatter_user_id: '4145994',
      chatter_user_login: 'viewer32',
      chatter_user_name: 'viewer32',
      message_id: 'chat-1',
      message: { text: '!mots', fragments: [] },
      badges: [],
      cheer: null,
    };
    await f.deliver('channel.chat.message', chat, 'm1');
    await f.deliver('channel.chat.message', chat, 'm1'); // EventSub redelivery
    expect(
      f.frontier.deps.chatIngress!.router.recent(BROADCASTER).messages,
    ).toHaveLength(1);
    await f.deliver('channel.chat.notification', EVENTS.sub, 'm2');
    expect(await count(f.core.db, 'alert_events')).toBe(1);
    expect(await count(f.core.db, 'sw_spins')).toBe(1);
    // Core down: the resub is kept in the outbox, then delivered once to the restarted Core.
    await new Promise((r) => first.close(() => r(null)));
    await f.deliver('channel.chat.notification', EVENTS.resub, 'm3');
    expect(f.bridge.alertsPending()).toBe(1);
    await f.start();
    // Its retry timer (backoff) delivers it; a resume meanwhile never sends it twice.
    await f.bridge.resumePending();
    await vi.waitFor(() => expect(f.bridge.alertsPending()).toBe(0), {
      timeout: 5000,
    });
    expect(await count(f.core.db, 'alert_events')).toBe(2);
    expect(await count(f.core.db, 'sw_spins')).toBe(2);
    f.bridge.close();
  });
});
