import { describe, expect, it, vi } from 'vitest';
import { createEventSubRouter } from '../src/twitch/eventsub.js';

const frame = (
  id: string,
  type: string,
  payload: object,
  subscriptionType?: string,
) =>
  JSON.stringify({
    metadata: {
      message_id: id,
      message_type: type,
      subscription_type: subscriptionType,
    },
    payload,
  });

const welcome = (id: string) =>
  frame(id, 'session_welcome', {
    session: { id: 'sess', keepalive_timeout_seconds: 10, reconnect_url: null },
  });

describe('EventSub routing', () => {
  it('subscribes on a fresh welcome only (not after a server-requested reconnect)', async () => {
    const subscribe = vi.fn(async () => {});
    const route = createEventSubRouter({ subscribe, notification: vi.fn() });

    expect(await route(welcome('w1'), true)).toEqual({
      kind: 'welcome',
      keepaliveSeconds: 10,
    });
    await route(welcome('w2'), false);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith('sess');
  });

  it('delivers each notification once even if Twitch sends it twice', async () => {
    const notification = vi.fn(async () => {});
    const route = createEventSubRouter({ subscribe: vi.fn(), notification });
    const online = frame(
      'n1',
      'notification',
      { event: { id: '317', started_at: 'x' } },
      'stream.online',
    );

    await route(online, true);
    await route(online, true);
    expect(notification).toHaveBeenCalledTimes(1);
    expect(notification).toHaveBeenCalledWith(
      'stream.online',
      { id: '317', started_at: 'x' },
      'n1',
      expect.any(String),
    );
  });

  it('returns the reconnect URL', async () => {
    const route = createEventSubRouter({
      subscribe: vi.fn(),
      notification: vi.fn(),
    });
    const reconnect = frame('r1', 'session_reconnect', {
      session: {
        id: 's',
        keepalive_timeout_seconds: null,
        reconnect_url: 'wss://x',
      },
    });
    expect(await route(reconnect, false)).toEqual({
      kind: 'reconnect',
      url: 'wss://x',
    });
  });
});
