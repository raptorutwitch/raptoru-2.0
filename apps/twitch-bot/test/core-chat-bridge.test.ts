import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { botPath, createCoreChatBridge } from '../src/core-chat-bridge.js';
import type { AlertOutboxEvent, AlertsMode } from '../src/lab-alerts-ingest.js';
import { memoryJournal } from '../src/lab-chat-output.js';
import {
  fileOutbox,
  memoryOutbox,
  type Outbox,
} from '../src/loyalty-outbox.js';
import { createEventSubRouter } from '../src/twitch/eventsub.js';
import {
  BROADCASTER,
  cheer,
  EVENTS,
  frame,
  READER,
} from './fixtures/eventsub-alerts.js';

// Lot 8: the production bot → the main Core's chat games and real alerts, with the Lab adapter's modules unchanged
// (only /v1/lab/… → /v1/bot/…), on the bot's single EventSub connection. Nothing is sent to Twitch here.

function setup(
  o: {
    games?: boolean;
    alerts?: AlertsMode;
    runtimeChat?: boolean;
    scopes?: string[];
    down?: () => boolean;
    outbox?: Outbox<AlertOutboxEvent>;
    output?: boolean;
  } = {},
) {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const calls: string[] = [];
  const subs: string[] = [];
  const sent: string[] = [];
  const bridge = createCoreChatBridge({
    post: async (path, body) => {
      if (o.down?.()) throw new Error('lab_core_503');
      posts.push({ path, body: body as Record<string, unknown> });
      return path === '/v1/bot/alerts/events' ? { outcome: 'queued' } : {};
    },
    call: async (path) => {
      calls.push(path);
      return { status: 200, body: { step: null } };
    },
    channelId: BROADCASTER,
    broadcasterId: BROADCASTER,
    tokenUserId: READER,
    scopes: o.scopes ?? ['user:read:chat', 'user:write:chat'],
    games: o.games ?? true,
    alertsMode: o.alerts ?? 'active',
    alertsOutbox: o.outbox ?? memoryOutbox<AlertOutboxEvent>(),
    runtimeChat: o.runtimeChat ?? false,
    subscribe: async (type) => {
      subs.push(type);
    },
    getStream: async () => null,
    ...(o.output
      ? {
          output: {
            send: {
              chat: async (text: string) => {
                sent.push(text);
                return { message_id: 'x', is_sent: true, drop_reason: null };
              },
              announce: async () => {},
            },
            journal: memoryJournal(),
            ratePer30s: 20,
          },
        }
      : {}),
    log: () => {},
  });
  const route = createEventSubRouter({
    subscribe: (s) => bridge.subscribe(s),
    notification: (t, e, id, ts) => bridge.notification(t, e, id, ts),
    log: () => {},
  });
  const deliver = (type: string, event: object, id: string) =>
    route(frame(type, '1', event as Record<string, unknown>, id), true);
  return { bridge, posts, calls, subs, sent, deliver };
}

const chat = (id: string, text: string) => ({
  ...cheer(1, { messageId: id }),
  message: { text, fragments: [{ type: 'text', text }] },
  cheer: null,
});

describe('production bot → main Core (chat games, real alerts)', () => {
  it('the Lab paths become the bot doors', () => {
    expect(botPath('/v1/lab/chat')).toBe('/v1/bot/chat');
    expect(botPath('/v1/lab/commands/1/steps/claim')).toBe(
      '/v1/bot/commands/1/steps/claim',
    );
    expect(botPath('/v1/lab/alerts/events')).toBe('/v1/bot/alerts/events');
  });

  it('one subscription per type: chat.message only when the runtime does not already read the chat', async () => {
    const a = setup();
    await a.bridge.subscribe('s1');
    expect(a.subs).toEqual([
      'channel.chat.message',
      'channel.chat.notification',
    ]);
    const b = setup({
      runtimeChat: true,
      scopes: ['user:read:chat', 'moderator:read:followers'],
    });
    await b.bridge.subscribe('s1');
    expect(b.subs).toEqual(['channel.chat.notification', 'channel.follow']);
    const off = setup({ games: false, alerts: 'off', runtimeChat: true });
    await off.bridge.subscribe('s1');
    expect(off.subs).toEqual([]);
  });

  it('chat → /v1/bot/chat (Twitch source, the Core channel); a sub notice → /v1/bot/alerts/events with its Twitch time', async () => {
    const s = setup();
    await s.deliver('channel.chat.message', chat('c1', '!roulette 100'), 'm1');
    await s.deliver('channel.chat.notification', EVENTS.sub, 'm2');
    const toChat = s.posts.filter((p) => p.path === '/v1/bot/chat');
    expect(toChat).toEqual([
      {
        path: '/v1/bot/chat',
        body: expect.objectContaining({
          channel_id: BROADCASTER,
          message_id: 'c1',
          text: '!roulette 100',
          source: 'twitch',
        }),
      },
    ]);
    const alerts = s.posts.filter((p) => p.path === '/v1/bot/alerts/events');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body).toMatchObject({
      channel_id: BROADCASTER,
      source: 'twitch',
      type: 'sub',
    });
    expect(alerts[0]!.body.occurred_at).toBeTruthy();
    expect(s.posts.some((p) => p.path.startsWith('/v1/lab/'))).toBe(false);
  });

  it('alerts only (games off): the chat is not forwarded, a cheer is an alert', async () => {
    const s = setup({ games: false });
    await s.deliver('channel.chat.message', chat('c2', 'bonjour'), 'm1');
    await s.deliver(
      'channel.chat.message',
      cheer(100, { messageId: 'c3' }),
      'm2',
    );
    expect(s.posts.map((p) => p.path)).toEqual(['/v1/bot/alerts/events']);
    expect(s.posts[0]!.body).toMatchObject({ type: 'bits' });
  });

  it('Core down: the alert is kept on disk; after a restart it is sent once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-outbox-'));
    try {
      const file = join(dir, 'alerts.json');
      const first = setup({
        outbox: fileOutbox<AlertOutboxEvent>(file),
        down: () => true,
      });
      await first.deliver('channel.chat.notification', EVENTS.sub, 'm1');
      expect(first.bridge.alertsPending()).toBe(1);
      first.bridge.close();
      const second = setup({ outbox: fileOutbox<AlertOutboxEvent>(file) });
      await second.bridge.resumePending();
      await second.bridge.resumePending();
      expect(
        second.posts.filter((p) => p.path === '/v1/bot/alerts/events'),
      ).toHaveLength(1);
      expect(fileOutbox<AlertOutboxEvent>(file).pending()).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('chat answers: claimed on the bot door of the Core channel; nothing to send → nothing sent', async () => {
    const s = setup({ output: true });
    void s.bridge.run();
    await new Promise((r) => setTimeout(r, 30));
    s.bridge.close();
    expect(s.calls[0]).toBe(`/v1/bot/commands/${BROADCASTER}/steps/claim`);
    expect(s.sent).toEqual([]);
  });
});
