import { describe, expect, it } from 'vitest';
import { chatRole, createLabChatIngest } from '../src/lab-chat-ingest.js';

// Lab chat ingestion: forwards, never decides (Core recognizes the commands and the roles).

function setup(live: { id: string; started_at: string } | null = null) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const subs: string[] = [];
  const ingest = createLabChatIngest({
    lab: async (path, body) => {
      calls.push({ path, body: body as Record<string, unknown> });
      return { ok: true };
    },
    labChannelId: '900100',
    broadcasterId: '83603689',
    tokenUserId: '111',
    subscribe: async (type) => {
      subs.push(type);
    },
    getStream: async () => live,
    log: () => {},
  });
  return { ingest, calls, subs };
}

const chat = (over: Record<string, unknown> = {}) => ({
  message_id: 'm-1',
  chatter_user_id: '222',
  chatter_user_login: 'viewer',
  chatter_user_name: 'Viewer',
  message: { text: '!join' },
  badges: [],
  ...over,
});

describe('Lab chat ingestion (Twitch → Lab Core, every module)', () => {
  it('subscribes to the chat and the stream state of the channel', async () => {
    const { ingest, subs } = setup();
    await ingest.handlers.subscribe('s-1');
    expect(subs).toEqual([
      'stream.online',
      'stream.offline',
      'channel.chat.message',
    ]);
  });

  it('forwards chat commands with the badge role; ignores plain messages and its own', async () => {
    const { ingest, calls } = setup();
    await ingest.handlers.notification(
      'channel.chat.message',
      chat(),
      'e-1',
      't',
    );
    await ingest.handlers.notification(
      'channel.chat.message',
      chat({
        message_id: 'm-2',
        message: { text: '!annuletombola' },
        badges: [{ set_id: 'moderator' }],
      }),
      'e-2',
      't',
    );
    await ingest.handlers.notification(
      'channel.chat.message',
      chat({ message: { text: 'salut' } }),
      'e-3',
      't',
    );
    await ingest.handlers.notification(
      'channel.chat.message',
      chat({ chatter_user_id: '111' }),
      'e-4',
      't',
    );
    expect(calls).toEqual([
      {
        path: '/v1/lab/chat',
        body: {
          channel_id: '900100',
          message_id: 'm-1',
          text: '!join',
          chatter: {
            id: '222',
            login: 'viewer',
            display_name: 'Viewer',
            role: 'viewer',
          },
          source: 'twitch',
        },
      },
      expect.objectContaining({
        body: expect.objectContaining({
          chatter: expect.objectContaining({ role: 'moderator' }),
        }),
      }),
    ]);
  });

  it('offline → live / live → offline open and end the Lab stream session; start-up syncs the real state', async () => {
    const { ingest, calls } = setup({
      id: '317823244002',
      started_at: '2026-10-01T18:00:00Z',
    });
    await ingest.handlers.notification(
      'stream.online',
      { id: '4242' },
      'e-1',
      't',
    );
    await ingest.handlers.notification('stream.offline', {}, 'e-2', 't');
    expect(await ingest.syncStream()).toBe(true);
    expect(calls.map((c) => c.body)).toEqual([
      { channel_id: '900100', event: 'online', twitch_stream_id: '4242' },
      { channel_id: '900100', event: 'offline' },
      {
        channel_id: '900100',
        event: 'online',
        twitch_stream_id: '317823244002',
      },
    ]);
  });

  it('a Lab Core failure is logged, never thrown into the EventSub loop', async () => {
    const { ingest } = createFailing();
    await expect(
      ingest.handlers.notification('channel.chat.message', chat(), 'e-1', 't'),
    ).resolves.toBeUndefined();
  });

  it('badges → role', () => {
    expect(
      chatRole([{ set_id: 'broadcaster' }, { set_id: 'subscriber' }]),
    ).toBe('broadcaster');
    expect(chatRole([{ set_id: 'moderator' }])).toBe('moderator');
    expect(chatRole([{ set_id: 'vip' }])).toBe('viewer');
    expect(chatRole(undefined)).toBe('viewer');
  });
});

function createFailing() {
  return {
    ingest: createLabChatIngest({
      lab: async () => {
        throw new Error('lab_core_503');
      },
      labChannelId: '900100',
      broadcasterId: '83603689',
      tokenUserId: '111',
      subscribe: async () => {},
      getStream: async () => null,
      log: () => {},
    }),
  };
}
