import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventSubRouter, runEventSub } from '../src/twitch/eventsub.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it('reports a subscription revocation without treating it as an active notification', async () => {
    const revocation = vi.fn();
    const notification = vi.fn();
    const route = createEventSubRouter({
      subscribe: vi.fn(),
      notification,
      revocation,
      log: vi.fn(),
    });
    await route(
      frame('revoke', 'revocation', {
        subscription: {
          type: 'channel.follow',
          status: 'authorization_revoked',
        },
      }),
      true,
    );
    expect(revocation).toHaveBeenCalledWith(
      'channel.follow',
      'authorization_revoked',
    );
    expect(notification).not.toHaveBeenCalled();
  });
});

class FakeSocket {
  static opened: FakeSocket[] = [];
  onmessage?: (event: { data: string }) => Promise<void>;
  onclose?: () => void;
  close = vi.fn(() => this.onclose?.());
  constructor(readonly url: string) {
    FakeSocket.opened.push(this);
  }
}

describe('EventSub lifecycle', () => {
  function setup() {
    vi.useFakeTimers();
    FakeSocket.opened = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    const revocation = vi.fn();
    const notification = vi.fn();
    const client = runEventSub({
      subscribe: vi.fn(),
      notification,
      revocation,
      log: vi.fn(),
    });
    return { client, revocation, notification };
  }

  it('stop closes sockets and cancels pending reconnects', async () => {
    const { client } = setup();
    const first = FakeSocket.opened[0]!;
    first.close();
    client.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.opened).toHaveLength(1);
  });

  it('stop closes both sockets during server reconnect and blocks subsequent notifications', async () => {
    const { client, notification } = setup();
    const first = FakeSocket.opened[0]!;
    await first.onmessage!({
      data: frame('reconnect', 'session_reconnect', {
        session: { reconnect_url: 'wss://next' },
      }),
    });
    expect(FakeSocket.opened).toHaveLength(2);
    client.stop();
    expect(
      FakeSocket.opened.every((s) => s.close.mock.calls.length === 1),
    ).toBe(true);
    await first.onmessage!({
      data: frame('late', 'notification', { event: {} }, 'stream.online'),
    });
    expect(notification).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.opened).toHaveLength(2);
  });

  it('revocation closes the consumer and never reconnects automatically', async () => {
    const { revocation } = setup();
    const first = FakeSocket.opened[0]!;
    await first.onmessage!({
      data: frame('revoke', 'revocation', {
        subscription: {
          type: 'channel.chat.message',
          status: 'authorization_revoked',
        },
      }),
    });
    expect(revocation).toHaveBeenCalledWith(
      'channel.chat.message',
      'authorization_revoked',
    );
    expect(first.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.opened).toHaveLength(1);
  });
});
