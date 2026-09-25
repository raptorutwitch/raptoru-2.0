import { describe, expect, it, vi } from 'vitest';
import {
  CORE_UNAVAILABLE_MESSAGE,
  handleChatMessage,
  parseCommand,
} from '../src/chat-commands.js';
import type { CoreClient } from '../src/core-client.js';

const chatter = { twitchUserId: '1001', login: 'alice', displayName: 'Alice' };

function fakeCore(overrides: Partial<CoreClient> = {}): CoreClient {
  return {
    streamOnline: vi.fn(),
    streamOffline: vi.fn(),
    streamSync: vi.fn(),
    dailyClaim: vi.fn(async () => ({ message: 'core says claimed' }) as never),
    dailyStreak: vi.fn(async () => ({ message: 'core says streak' }) as never),
    presenceLease: vi.fn(),
    presenceObservation: vi.fn(),
    ...overrides,
  };
}

describe('chat commands', () => {
  it('recognises !daily and !streak as the first word only', () => {
    expect(parseCommand('!daily')).toBe('daily');
    expect(parseCommand('  !DAILY please')).toBe('daily');
    expect(parseCommand('!streak')).toBe('streak');
    expect(parseCommand('hello !daily')).toBeNull();
    expect(parseCommand('!dailyx')).toBeNull();
  });

  it('forwards identity + Twitch message id to Core and posts the Core reply verbatim', async () => {
    const core = fakeCore();
    const say = vi.fn(async () => {});
    await handleChatMessage(
      { messageId: 'msg-1', text: '!daily', chatter },
      { core, say },
    );

    expect(core.dailyClaim).toHaveBeenCalledWith({
      viewer: chatter,
      requestId: 'msg-1',
    });
    expect(say).toHaveBeenCalledWith('core says claimed');
  });

  it('!streak calls the read-only endpoint', async () => {
    const core = fakeCore();
    const say = vi.fn(async () => {});
    await handleChatMessage(
      { messageId: 'msg-2', text: '!streak', chatter },
      { core, say },
    );
    expect(core.dailyStreak).toHaveBeenCalledWith({ viewer: chatter });
    expect(core.dailyClaim).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith('core says streak');
  });

  it('ignores other messages and fails fast when Core is down', async () => {
    const say = vi.fn(async () => {});
    await handleChatMessage(
      { messageId: 'm', text: 'salut', chatter },
      { core: fakeCore(), say },
    );
    expect(say).not.toHaveBeenCalled();

    const down = fakeCore({
      dailyClaim: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });
    await handleChatMessage(
      { messageId: 'm', text: '!daily', chatter },
      { core: down, say, log: () => {} },
    );
    expect(say).toHaveBeenCalledWith(CORE_UNAVAILABLE_MESSAGE);
  });
});
