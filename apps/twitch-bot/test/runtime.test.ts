import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotConfig } from '../src/config.js';
import type { CoreClient } from '../src/core-client.js';
import { createBotRuntime } from '../src/runtime.js';
import type { Helix } from '../src/twitch/helix.js';

const baseConfig: BotConfig = {
  CORE_API_URL: 'http://core',
  BOT_SECRET: 'secret-secret-secret',
  TWITCH_CLIENT_ID: 'client',
  TWITCH_CLIENT_SECRET: 'secret',
  TWITCH_TOKEN_FILE: 'unused.json',
  TWITCH_BROADCASTER_ID: '100',
  STREAM_SYNC_INTERVAL_MS: 60_000,
  BOT_HOST: 'pc',
  BOT_LEASE_OPTIONAL: 'false',
  TWITCH_BROADCASTER_TOKEN_FILE: 'unused-broadcaster.json',
  LOYALTY_OUTBOX_FILE: 'unused-outbox.json',
  CHANNEL_POINTS_OUTBOX_FILE: 'unused-cp-outbox.json',
  CHAT_GAMES: 'false',
  CHAT_GAMES_OUTPUT: 'false',
  CHAT_GAMES_OUTPUT_RATE: 20,
  CHAT_GAMES_JOURNAL_FILE: 'unused-journal.json',
  ALERTS_MODE: 'off',
  ALERTS_FOLLOW: 'false',
  ALERTS_OUTBOX_FILE: 'unused-alerts-outbox.json',
  RANDOM_BAN_JOURNAL_FILE: 'unused-random-ban-journal.json',
  CAUTION: 'false',
  CAUTION_JOURNAL_FILE: 'unused-caution-journal.json',
  DAILY_CHAT_COMMANDS: 'false',
  LOYALTY_TWITCH_EVENTS: 'false',
  LOYALTY_CHAT_COMMANDS: 'false',
  PRESENCE_SHADOW: 'true',
  LAB_CHAT_INGEST: 'false',
  LAB_CHAT_OUTPUT: 'false',
  LAB_ALERTS_FOLLOW: 'false',
  CHANNEL_POINTS_EVENTS: 'false',
  RANDOM_BAN: 'false',
  LAB_CHAT_JOURNAL_FILE: '.lab-chat-journal.json',
  LAB_RANDOM_BAN_JOURNAL_FILE: '.lab-random-ban-journal.json',
  LAB_CAUTION_JOURNAL_FILE: '.lab-caution-journal.json',
};

let messageSeq = 0;
/** Delivers an EventSub notification with a unique message id, like the real router. */
const notify = (
  runtime: ReturnType<typeof createBotRuntime>,
  type: string,
  event: Record<string, unknown>,
) =>
  runtime.eventSub.notification(
    type,
    event,
    'msg-' + ++messageSeq,
    new Date().toISOString(),
  );

function build(config: Partial<BotConfig> = {}) {
  const helix = {
    getStream: vi.fn<Helix['getStream']>(async () => null),
    getChattersPage: vi.fn<Helix['getChattersPage']>(async () => ({
      chatters: [],
      cursor: null,
      total: 0,
    })),
    sendChatMessage: vi.fn<Helix['sendChatMessage']>(async () => {}),
    subscribe: vi.fn<Helix['subscribe']>(async () => {}),
    getUserByLogin: vi.fn<Helix['getUserByLogin']>(async () => null),
  };
  const core = {
    streamOnline: vi.fn(async () => ({})),
    streamOffline: vi.fn(async () => ({})),
    streamSync: vi.fn(async () => ({})),
    dailyClaim: vi.fn(async () => ({ message: 'x' })),
    dailyStreak: vi.fn(async () => ({ message: 'x' })),
    presenceLease: vi.fn(async () => ({
      granted: true,
      holder: 'w',
      expiresAt: new Date().toISOString(),
    })),
    presenceObservation: vi.fn(async () => ({
      accepted: true,
      rejection: null,
      creditedSeconds: 0,
      creditedViewers: 0,
      gapReason: null,
    })),
    walletBalance: vi.fn(async () => ({
      message: 'balance reply',
      result: null,
    })),
    walletTransfer: vi.fn(async () => ({
      message: 'transfer reply',
      result: null,
    })),
    walletAdmin: vi.fn(async () => ({ message: 'admin reply', result: null })),
    loyaltyEvent: vi.fn(),
    subscriptionSnapshot: vi.fn(),
  };
  const runtime = createBotRuntime({
    config: { ...baseConfig, ...config },
    tokenUserId: '200',
    helix,
    core: core as unknown as CoreClient,
    workerId: 'w',
    log: () => {},
  });
  return { runtime, helix, core };
}

const chatEvent = {
  message_id: 'm1',
  message: { text: '!daily' },
  chatter_user_id: '300',
  chatter_user_login: 'viewer',
  chatter_user_name: 'Viewer',
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('bot runtime in presence shadow mode', () => {
  it('subscribes to stream events only and can never read commands or write in chat', async () => {
    const { runtime, helix, core } = build();
    await runtime.eventSub.subscribe('sess');
    expect(helix.subscribe.mock.calls.map((c) => c[0])).toEqual([
      'stream.online',
      'stream.offline',
    ]);

    await notify(runtime, 'channel.chat.message', chatEvent);
    expect(core.dailyClaim).not.toHaveBeenCalled();
    expect(helix.sendChatMessage).not.toHaveBeenCalled();
  });

  it('starts one worker on stream.online, ignores duplicates, stops on stream.offline', async () => {
    const { runtime, helix, core } = build();
    const online = { id: '555', started_at: '2026-09-26T18:00:00Z' };
    await notify(runtime, 'stream.online', online);
    await notify(runtime, 'stream.online', online);
    await vi.advanceTimersByTimeAsync(0);

    expect(runtime.presence?.activeStreamId).toBe('555');
    expect(helix.getChattersPage).toHaveBeenCalledTimes(1);
    expect(helix.getChattersPage.mock.calls[0]!.slice(0, 3)).toEqual([
      '100',
      '200',
      null,
    ]);
    expect(vi.getTimerCount()).toBe(1);

    await notify(runtime, 'stream.offline', {});
    expect(runtime.presence?.activeStreamId).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(core.streamOffline).toHaveBeenCalledTimes(1);
    expect(helix.sendChatMessage).not.toHaveBeenCalled();
  });

  it('does not start the worker if Core did not record the live', async () => {
    const { runtime, core } = build();
    core.streamOnline.mockRejectedValue(new Error('core down'));
    await notify(runtime, 'stream.online', {
      id: '555',
      started_at: '2026-09-26T18:00:00Z',
    });
    expect(runtime.presence?.activeStreamId).toBeNull();
  });

  it('starts from the Helix snapshot at startup (restart during a live)', async () => {
    const { runtime, helix } = build();
    helix.getStream.mockResolvedValue({
      id: '777',
      started_at: '2026-09-26T18:00:00Z',
    } as never);
    await runtime.streams.sync();
    expect(runtime.presence?.activeStreamId).toBe('777');
    runtime.presence?.stop();
  });

  it('without PRESENCE_SHADOW there is no worker; chat commands stay a separate opt-in', async () => {
    const { runtime, helix } = build({
      PRESENCE_SHADOW: 'false',
      DAILY_CHAT_COMMANDS: 'true',
    });
    expect(runtime.presence).toBeNull();
    await runtime.eventSub.subscribe('sess');
    expect(helix.subscribe.mock.calls.map((c) => c[0])).toContain(
      'channel.chat.message',
    );
  });

  it('loyalty commands are off by default: !solde and !give are never read nor answered', async () => {
    const { runtime, helix, core } = build({ DAILY_CHAT_COMMANDS: 'true' });
    for (const text of ['!solde', '!give @Bob 500']) {
      await notify(runtime, 'channel.chat.message', {
        ...chatEvent,
        message: { text },
      });
    }
    expect(core.walletBalance).not.toHaveBeenCalled();
    expect(core.walletTransfer).not.toHaveBeenCalled();
    expect(helix.sendChatMessage).not.toHaveBeenCalled();
  });

  it('with LOYALTY_CHAT_COMMANDS only: Daily stays off, loyalty uses the mention identity', async () => {
    const { runtime, helix, core } = build({ LOYALTY_CHAT_COMMANDS: 'true' });
    await runtime.eventSub.subscribe('sess');
    expect(helix.subscribe.mock.calls.map((c) => c[0])).toContain(
      'channel.chat.message',
    );
    await notify(runtime, 'channel.chat.message', {
      ...chatEvent,
      message: {
        text: '!give @Bob 500',
        fragments: [
          { type: 'text', text: '!give ' },
          {
            type: 'mention',
            text: '@Bob',
            mention: { user_id: '400', user_login: 'bob', user_name: 'Bob' },
          },
        ],
      },
    });
    await notify(runtime, 'channel.chat.message', chatEvent); // !daily
    expect(core.walletTransfer).toHaveBeenCalledWith({
      requestId: 'm1',
      from: { twitchUserId: '300', login: 'viewer', displayName: 'Viewer' },
      to: { twitchUserId: '400', login: 'bob', displayName: 'Bob' },
      amount: 500,
    });
    expect(core.dailyClaim).not.toHaveBeenCalled();
    expect(helix.sendChatMessage).toHaveBeenCalledWith(
      '100',
      '200',
      'transfer reply',
    );
  });
});
