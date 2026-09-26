import { describe, expect, it, vi } from 'vitest';
import {
  BROADCASTER_EVENT_SUBSCRIPTIONS,
  createBroadcasterEvents,
  fetchSubscriptionSnapshot,
  normalizeLoyaltyEvent,
  type SubscriptionsPage,
} from '../src/loyalty-events.js';

const user = { user_id: '42', user_login: 'aouh', user_name: 'Aouh' };
const aouh = { twitchUserId: '42', login: 'aouh', displayName: 'Aouh' };

describe('EventSub → Core loyalty event', () => {
  it('maps subs, resubs, gifts, ends, cheers and follows with the message id', () => {
    expect(
      normalizeLoyaltyEvent(
        'channel.subscribe',
        { ...user, tier: '3000', is_gift: false },
        'm1',
      ),
    ).toEqual({
      type: 'sub',
      eventId: 'm1',
      viewer: aouh,
      tier: 't3',
      isGift: false,
    });
    expect(
      normalizeLoyaltyEvent(
        'channel.subscription.message',
        { ...user, tier: '2000', cumulative_months: 7 },
        'm2',
      ),
    ).toEqual({
      type: 'resub',
      eventId: 'm2',
      viewer: aouh,
      tier: 't2',
    });
    expect(
      normalizeLoyaltyEvent(
        'channel.subscription.gift',
        { ...user, tier: '1000', total: 10, is_anonymous: false },
        'm3',
      ),
    ).toEqual({
      type: 'subgift',
      eventId: 'm3',
      gifter: aouh,
      tier: 't1',
      count: 10,
    });
    expect(
      normalizeLoyaltyEvent(
        'channel.subscription.end',
        { ...user, tier: '1000' },
        'm4',
      ),
    ).toEqual({
      type: 'subscription_end',
      eventId: 'm4',
      viewer: aouh,
    });
    expect(
      normalizeLoyaltyEvent(
        'channel.cheer',
        { ...user, bits: 1200, is_anonymous: false },
        'm5',
      ),
    ).toEqual({
      type: 'bits',
      eventId: 'm5',
      viewer: aouh,
      bits: 1200,
    });
    expect(
      normalizeLoyaltyEvent(
        'channel.follow',
        { ...user, followed_at: 'x' },
        'm6',
      ),
    ).toEqual({ type: 'follow', eventId: 'm6', viewer: aouh });
  });

  it('anonymous gifts/cheers carry no identity; unknown tiers are dropped, never guessed', () => {
    const anon = { user_id: null, user_login: null, user_name: null };
    expect(
      normalizeLoyaltyEvent(
        'channel.subscription.gift',
        { ...anon, tier: '1000', total: 5, is_anonymous: true },
        'a',
      ),
    ).toMatchObject({ gifter: null });
    expect(
      normalizeLoyaltyEvent(
        'channel.cheer',
        { ...anon, bits: 100, is_anonymous: true },
        'b',
      ),
    ).toMatchObject({ viewer: null });
    expect(
      normalizeLoyaltyEvent(
        'channel.subscribe',
        { ...user, tier: 'prime?' },
        'c',
      ),
    ).toBeNull();
    expect(normalizeLoyaltyEvent('channel.raid', {}, 'd')).toBeNull();
  });
});

describe('subscription snapshot', () => {
  const sub = (id: string, tier = '1000') => ({
    user_id: id,
    user_login: `u${id}`,
    user_name: `U${id}`,
    tier,
    is_gift: false,
  });

  it('follows every page and returns the complete list', async () => {
    const pages: Record<
      string,
      { subscriptions: ReturnType<typeof sub>[]; cursor: string | null }
    > = {
      start: { subscriptions: [sub('1'), sub('2', '3000')], cursor: 'p2' },
      p2: { subscriptions: [sub('3', '2000')], cursor: null },
    };
    const snap = await fetchSubscriptionSnapshot(
      async (after) => pages[after ?? 'start']!,
      new Date('2026-09-26T18:00:00Z'),
    );
    expect(
      snap.subscribers.map((s) => [s.viewer.twitchUserId, s.tier]),
    ).toEqual([
      ['1', 't1'],
      ['2', 't3'],
      ['3', 't2'],
    ]);
    expect(snap.fetchedAt).toBe('2026-09-26T18:00:00.000Z');
  });

  it('never produces a partial snapshot (repeated cursor, failing page, unknown tier)', async () => {
    const loop: SubscriptionsPage = async () => ({
      subscriptions: [sub('1')],
      cursor: 'same',
    });
    await expect(fetchSubscriptionSnapshot(loop, new Date())).rejects.toThrow(
      /repeated/,
    );
    const failing: SubscriptionsPage = vi
      .fn()
      .mockResolvedValueOnce({ subscriptions: [sub('1')], cursor: 'p2' })
      .mockRejectedValue(new Error('503'));
    await expect(
      fetchSubscriptionSnapshot(failing, new Date()),
    ).rejects.toThrow('503');
    await expect(
      fetchSubscriptionSnapshot(
        async () => ({ subscriptions: [sub('1', '9000')], cursor: null }),
        new Date(),
      ),
    ).rejects.toThrow(/tier/);
  });

  it('a failed snapshot sends nothing to Core', async () => {
    const core = { loyaltyEvent: vi.fn(), subscriptionSnapshot: vi.fn() };
    const events = createBroadcasterEvents({
      core,
      subscribe: vi.fn(),
      getSubscriptionsPage: async () => {
        throw new Error('401');
      },
      broadcasterId: '100',
      log: () => {},
    });
    expect(await events.syncSubscriptions()).toBeNull();
    expect(core.subscriptionSnapshot).not.toHaveBeenCalled();
  });
});

describe('broadcaster EventSub wiring', () => {
  it('subscribes to the six loyalty topics (follow v2 as moderator=broadcaster) and forwards with the message id', async () => {
    const subscribe = vi.fn(
      async (
        _type: string,
        _condition: Record<string, string>,
        _session: string,
        _version: string,
      ) => {
        void [_type, _condition, _session, _version];
      },
    );
    const core = {
      loyaltyEvent: vi.fn(async () => ({
        rewardId: 1,
        status: 'preview' as const,
        amount: 700,
        replayed: false,
        reason: null,
      })),
      subscriptionSnapshot: vi.fn(),
    };
    const events = createBroadcasterEvents({
      core,
      subscribe,
      getSubscriptionsPage: vi.fn(),
      broadcasterId: '100',
      log: () => {},
    });
    await events.eventSub.subscribe('sess');
    expect(subscribe.mock.calls.map((c) => [c[0], c[3]])).toEqual(
      BROADCASTER_EVENT_SUBSCRIPTIONS.map((s) => [s.type, s.version]),
    );
    expect(subscribe).toHaveBeenCalledWith(
      'channel.follow',
      { broadcaster_user_id: '100', moderator_user_id: '100' },
      'sess',
      '2',
    );

    await events.eventSub.notification(
      'channel.cheer',
      { ...user, bits: 100, is_anonymous: false },
      'msg-9',
    );
    expect(core.loyaltyEvent).toHaveBeenCalledWith({
      type: 'bits',
      eventId: 'msg-9',
      viewer: aouh,
      bits: 100,
    });
  });
});
