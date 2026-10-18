import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CP_RETRY_TTL_MS,
  CP_SUBSCRIPTION,
  canReadChannelPoints,
  createChannelPointsEvents,
  normalizeRedemption,
} from '../src/channel-points-events.js';
import { broadcasterScopes } from '../src/config.js';
import { createEventSubRouter } from '../src/twitch/eventsub.js';

// Points de chaîne V1: the redemption event (official Twitch example, dev.twitch.tv EventSub subscription types,
// read 17/10/2026; ids adapted to raptoru_) → Core contract; read only; Core decides everything.

afterEach(() => vi.useRealTimers());

const BROADCASTER = '83603689';
/** The reference example, broadcaster set to raptoru_. */
const EXAMPLE = {
  id: '17fa2df1-ad76-4804-bfa5-a40ef63efe63',
  broadcaster_user_id: BROADCASTER,
  broadcaster_user_login: 'raptoru_',
  broadcaster_user_name: 'Raptoru_',
  user_id: '9001',
  user_login: 'cooler_user',
  user_name: 'Cooler_User',
  user_input: 'pogchamp',
  status: 'unfulfilled',
  reward: {
    id: '92af127c-7326-4483-a52b-b0da0be61c01',
    title: 'title',
    cost: 100,
    prompt: 'reward prompt',
  },
  redeemed_at: '2020-07-15T17:16:03.17106713Z',
};
const frame = (event: object, id: string) =>
  JSON.stringify({
    metadata: {
      message_id: id,
      message_type: 'notification',
      message_timestamp: '2026-10-17T20:00:00Z',
      subscription_type: CP_SUBSCRIPTION.type,
      subscription_version: '1',
    },
    payload: {
      subscription: { type: CP_SUBSCRIPTION.type, version: '1' },
      event,
    },
  });

describe('normalizeRedemption', () => {
  it('the official example → Twitch ids as keys, redeemer, input, status, date', () => {
    expect(normalizeRedemption(EXAMPLE, '900100', BROADCASTER)).toEqual({
      channel_id: '900100',
      source: 'twitch',
      redemption_id: '17fa2df1-ad76-4804-bfa5-a40ef63efe63',
      reward: {
        id: '92af127c-7326-4483-a52b-b0da0be61c01',
        title: 'title',
        cost: 100,
        prompt: 'reward prompt',
      },
      user: { id: '9001', login: 'cooler_user', display_name: 'Cooler_User' },
      user_input: 'pogchamp',
      twitch_status: 'unfulfilled',
      redeemed_at: '2020-07-15T17:16:03.171Z',
    });
  });

  it('another channel, missing ids or date: ignored (null); empty input omitted', () => {
    expect(
      normalizeRedemption(
        { ...EXAMPLE, broadcaster_user_id: '1' },
        '9',
        BROADCASTER,
      ),
    ).toBeNull();
    for (const bad of [
      { ...EXAMPLE, id: undefined },
      { ...EXAMPLE, reward: { ...EXAMPLE.reward, id: 'a b' } },
      { ...EXAMPLE, user_id: 'x' },
      { ...EXAMPLE, redeemed_at: 'hier' },
      { ...EXAMPLE, reward: null },
    ])
      expect(normalizeRedemption(bad as never, '9', BROADCASTER)).toBeNull();
    expect(
      normalizeRedemption({ ...EXAMPLE, user_input: '' }, '9', BROADCASTER)!
        .user_input,
    ).toBeUndefined();
  });
});

function setup(
  o: { fail?: () => Error | null; subscribeFails?: boolean } = {},
) {
  const posted: unknown[] = [];
  const rewards: unknown[] = [];
  const subs: { type: string; condition: unknown; version: string }[] = [];
  const logs: string[] = [];
  const events = createChannelPointsEvents({
    channelId: '900100',
    broadcasterId: BROADCASTER,
    postRedemption: async (body) => {
      const err = o.fail?.();
      if (err) throw err;
      posted.push(body);
      return { outcome: 'ignored' };
    },
    postRewards: async (body) => {
      rewards.push(body);
      return { synced: body.rewards.length };
    },
    subscribe: async (type, condition, _s, version) => {
      if (o.subscribeFails) throw new Error('helix_403');
      subs.push({ type, condition, version });
    },
    getCustomRewards: async () => [
      {
        id: 'r1',
        title: 'Eren cri',
        cost: 500,
        is_enabled: true,
        is_paused: false,
        is_user_input_required: false,
      },
    ],
    log: (...a: unknown[]) => logs.push(a.join(' ')),
  });
  const route = createEventSubRouter({
    subscribe: (s) => events.subscribe(s),
    notification: async (type, event) => {
      await events.handle(type, event);
    },
    log: () => {},
  });
  return { events, posted, rewards, subs, logs, route };
}

describe('channel points events (bot)', () => {
  it('accepts manage-only redemptions without granting unrelated capabilities', () => {
    expect(canReadChannelPoints(['channel:manage:redemptions'])).toBe(true);
    expect(canReadChannelPoints(['channel:read:redemptions'])).toBe(true);
    expect(canReadChannelPoints(['moderation:read'])).toBe(false);
  });
  it('subscribes the broadcaster redemption type (v1) and reads the reward list', async () => {
    const s = setup();
    await s.events.subscribe('sess');
    expect(s.events.subscriptionStatus()).toBe('subscribed');
    await s.events.syncRewards();
    expect(s.subs).toEqual([
      {
        type: 'channel.channel_points_custom_reward_redemption.add',
        version: '1',
        condition: { broadcaster_user_id: BROADCASTER },
      },
    ]);
    expect(s.rewards).toEqual([
      {
        channel_id: '900100',
        rewards: [
          {
            id: 'r1',
            title: 'Eren cri',
            cost: 500,
            is_enabled: true,
            is_paused: false,
            user_input_required: false,
          },
        ],
      },
    ]);
  });

  it('a refused subscription is logged, never thrown (the connection and other events go on)', async () => {
    const s = setup({ subscribeFails: true });
    await expect(s.events.subscribe('sess')).resolves.toBeUndefined();
    expect(s.events.subscriptionStatus()).toBe('inactive');
    expect(s.logs.join('\n')).toContain('abonnement aux récompenses refusé');
  });

  it('frames through the real router: forwarded once per EventSub message; other types not handled', async () => {
    const s = setup();
    await s.route(frame(EXAMPLE, 'm1'), true);
    await s.route(frame(EXAMPLE, 'm1'), true); // redelivery of the same message
    expect(s.posted).toHaveLength(1);
    expect(await s.events.handle('channel.follow', {})).toBe(false);
  });

  it('Core down: retried with the same redemption id, then delivered; 4xx not retried; TTL drop', async () => {
    vi.useFakeTimers();
    let down = true;
    const s = setup({
      fail: () =>
        down
          ? Object.assign(new Error('core-api responded 503'), { status: 503 })
          : null,
    });
    await s.events.handle(CP_SUBSCRIPTION.type, EXAMPLE);
    expect(s.events.pendingRetries()).toBe(1);
    down = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.posted).toHaveLength(1);
    const refused = setup({
      fail: () =>
        Object.assign(new Error('core-api responded 400'), { status: 400 }),
    });
    await refused.events.handle(CP_SUBSCRIPTION.type, EXAMPLE);
    expect(refused.events.pendingRetries()).toBe(0);
    expect(refused.logs.join('\n')).toContain('perdu');
    const gone = setup({ fail: () => new Error('lab_core_502') });
    await gone.events.handle(CP_SUBSCRIPTION.type, EXAMPLE);
    await vi.advanceTimersByTimeAsync(CP_RETRY_TTL_MS + 60_000);
    expect(gone.events.pendingRetries()).toBe(0);
    expect(gone.logs.join('\n')).toContain('perdu');
  });
});

describe('broadcaster scopes', () => {
  it('channel:read:redemptions only when Points de chaîne is on; read only (never manage)', () => {
    expect(
      broadcasterScopes({
        LOYALTY_TWITCH_EVENTS: 'true',
        CHANNEL_POINTS_EVENTS: 'false',
      }),
    ).not.toContain('channel:read:redemptions');
    expect(
      broadcasterScopes({
        LOYALTY_TWITCH_EVENTS: 'false',
        CHANNEL_POINTS_EVENTS: 'true',
      }),
    ).toEqual(['channel:read:redemptions']);
    const both = broadcasterScopes({
      LOYALTY_TWITCH_EVENTS: 'true',
      CHANNEL_POINTS_EVENTS: 'true',
    });
    expect(both).toContain('channel:read:redemptions');
    expect(both).toContain('bits:read');
    expect(both.some((s) => s.includes('manage'))).toBe(false);
  });
});
