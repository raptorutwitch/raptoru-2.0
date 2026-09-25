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
  DAILY_CHAT_COMMANDS: 'false',
  PRESENCE_SHADOW: 'true',
};

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

    await runtime.eventSub.notification('channel.chat.message', chatEvent);
    expect(core.dailyClaim).not.toHaveBeenCalled();
    expect(helix.sendChatMessage).not.toHaveBeenCalled();
  });

  it('starts one worker on stream.online, ignores duplicates, stops on stream.offline', async () => {
    const { runtime, helix, core } = build();
    const online = { id: '555', started_at: '2026-09-26T18:00:00Z' };
    await runtime.eventSub.notification('stream.online', online);
    await runtime.eventSub.notification('stream.online', online);
    await vi.advanceTimersByTimeAsync(0);

    expect(runtime.presence?.activeStreamId).toBe('555');
    expect(helix.getChattersPage).toHaveBeenCalledTimes(1);
    expect(helix.getChattersPage.mock.calls[0]!.slice(0, 3)).toEqual([
      '100',
      '200',
      null,
    ]);
    expect(vi.getTimerCount()).toBe(1);

    await runtime.eventSub.notification('stream.offline', {});
    expect(runtime.presence?.activeStreamId).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(core.streamOffline).toHaveBeenCalledTimes(1);
    expect(helix.sendChatMessage).not.toHaveBeenCalled();
  });

  it('does not start the worker if Core did not record the live', async () => {
    const { runtime, core } = build();
    core.streamOnline.mockRejectedValue(new Error('core down'));
    await runtime.eventSub.notification('stream.online', {
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
});
