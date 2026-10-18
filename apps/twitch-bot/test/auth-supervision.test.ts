import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  superviseTwitchAuth,
  TOKEN_VALIDATION_INTERVAL_MS,
} from '../src/twitch/auth-supervision.js';
import type { AuthStatus } from '../src/twitch/auth.js';

afterEach(() => vi.useRealTimers());

function account(scopes: string[]) {
  const status = { state: 'ready', scopes } as AuthStatus;
  return {
    validate: vi.fn(async () => {}),
    status: () => status,
    current: status,
  };
}

describe('hourly user-token supervision', () => {
  it('validates both accounts hourly even without Helix calls, then cancels both timers', async () => {
    vi.useFakeTimers();
    const bot = account(['user:read:chat']);
    const broadcaster = account(['channel:manage:redemptions']);
    const unavailable = vi.fn();
    const a = superviseTwitchAuth(bot, unavailable);
    const b = superviseTwitchAuth(broadcaster, unavailable);
    await vi.advanceTimersByTimeAsync(TOKEN_VALIDATION_INTERVAL_MS * 2);
    expect(bot.validate).toHaveBeenCalledTimes(2);
    expect(broadcaster.validate).toHaveBeenCalledTimes(2);
    expect(unavailable).not.toHaveBeenCalled();
    a.stop();
    b.stop();
    await vi.advanceTimersByTimeAsync(TOKEN_VALIDATION_INTERVAL_MS);
    expect(bot.validate).toHaveBeenCalledTimes(2);
    expect(broadcaster.validate).toHaveBeenCalledTimes(2);
  });

  it('stops when an optional startup capability is lost and never advertises stale scopes', async () => {
    vi.useFakeTimers();
    const auth = account(['user:read:chat', 'moderator:manage:banned_users']);
    auth.validate.mockImplementation(async () => {
      auth.current.scopes = ['user:read:chat'];
    });
    const unavailable = vi.fn();
    superviseTwitchAuth(auth, unavailable);
    await vi.advanceTimersByTimeAsync(TOKEN_VALIDATION_INTERVAL_MS * 2);
    expect(unavailable).toHaveBeenCalledWith(
      'missing_scopes: moderator:manage:banned_users',
    );
    expect(auth.validate).toHaveBeenCalledTimes(1);
  });

  it('accepts read redemption capability covered by manage and retries transient validation failures', async () => {
    vi.useFakeTimers();
    const auth = account(['channel:read:redemptions']);
    auth.validate
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockImplementation(async () => {
        auth.current.scopes = ['channel:manage:redemptions'];
      });
    const unavailable = vi.fn();
    const log = vi.fn();
    const monitor = superviseTwitchAuth(auth, unavailable, { log });
    await vi.advanceTimersByTimeAsync(TOKEN_VALIDATION_INTERVAL_MS * 2);
    expect(auth.validate).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
    expect(unavailable).not.toHaveBeenCalled();
    monitor.stop();
  });

  it('stops on durable failure without retrying validation forever', async () => {
    vi.useFakeTimers();
    const auth = account(['user:read:chat']);
    auth.validate.mockImplementation(async () => {
      auth.current.state = 'failed';
      throw new Error('revoked');
    });
    const unavailable = vi.fn();
    superviseTwitchAuth(auth, unavailable);
    await vi.advanceTimersByTimeAsync(TOKEN_VALIDATION_INTERVAL_MS * 2);
    expect(auth.validate).toHaveBeenCalledTimes(1);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
});
