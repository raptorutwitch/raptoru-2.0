import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CoreHttpError, type CoreClient } from '../src/core-client.js';
import {
  fileOutbox,
  memoryOutbox,
  type LoyaltyOutbox,
} from '../src/loyalty-outbox.js';
import {
  BROADCASTER_EVENT_SUBSCRIPTIONS,
  createBroadcasterEvents,
  fetchSubscriptionSnapshot,
  normalizeLoyaltyEvent,
  type SubscriptionsPage,
} from '../src/loyalty-events.js';

const user = { user_id: '42', user_login: 'aouh', user_name: 'Aouh' };
const aouh = { twitchUserId: '42', login: 'aouh', displayName: 'Aouh' };
/** Twitch timestamps (ISO, comparable as strings). */
const T = (n: number) =>
  new Date(Date.UTC(2026, 8, 28, 20, 0, n)).toISOString();
const tick = () => new Promise((r) => setTimeout(r, 0));

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
      listEnabledSubscriptions: async () => [],
      outbox: memoryOutbox(),
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
      listEnabledSubscriptions: async () => [
        {
          type: 'stream.online',
          sessionId: 'presence-session',
          createdAt: T(0),
        },
        { type: 'channel.cheer', sessionId: 'sess', createdAt: T(1) },
      ],
      outbox: memoryOutbox(),
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
      T(2),
    );
    await tick();
    expect(core.loyaltyEvent).toHaveBeenCalledWith({
      type: 'bits',
      eventId: 'msg-9',
      viewer: aouh,
      bits: 100,
    });
  });
});

describe('Rewards Twitch V1: normalization edge cases', () => {
  it('T1/T2/T3, gift recipients, sponsored and large gifts; nothing economic in the bot', () => {
    expect(
      ['1000', '2000', '3000'].map((tier) =>
        normalizeLoyaltyEvent(
          'channel.subscribe',
          { ...user, tier, is_gift: false },
          'x',
        ),
      ),
    ).toMatchObject([{ tier: 't1' }, { tier: 't2' }, { tier: 't3' }]);
    // Gift recipient: forwarded as a gifted sub (Core keeps the tier, pays nobody for it).
    expect(
      normalizeLoyaltyEvent(
        'channel.subscribe',
        { ...user, tier: '1000', is_gift: true },
        'r',
      ),
    ).toMatchObject({ type: 'sub', isGift: true });
    // Twitch-sponsored gift (brand account as gifter): forwarded like any gifter.
    const minecraft = {
      user_id: '112568845',
      user_login: 'minecraft',
      user_name: 'Minecraft',
    };
    expect(
      normalizeLoyaltyEvent(
        'channel.subscription.gift',
        { ...minecraft, tier: '1000', total: 1, is_anonymous: false },
        's',
      ),
    ).toMatchObject({ gifter: { login: 'minecraft' }, count: 1 });
    expect(
      normalizeLoyaltyEvent(
        'channel.subscription.gift',
        { ...user, tier: '3000', total: 100, is_anonymous: false },
        'big',
      ),
    ).toMatchObject({ tier: 't3', count: 100 });
    // Unusable amounts are dropped, never rounded or guessed.
    for (const bits of [0, -5, 1.5, 'x'])
      expect(
        normalizeLoyaltyEvent('channel.cheer', { ...user, bits }, 'b'),
      ).toBeNull();
    expect(
      normalizeLoyaltyEvent(
        'channel.subscription.gift',
        { ...user, tier: '1000', total: 0 },
        'g0',
      ),
    ).toBeNull();
  });
});

describe('Rewards Twitch V1: durable forwarding and single consumer', () => {
  const cheer = { ...user, bits: 100, is_anonymous: false };
  const ok = {
    rewardId: 1,
    status: 'preview' as const,
    amount: 700,
    replayed: false,
    reason: null,
  };

  /** Fake Twitch shared by several bots: enabled subscriptions with their creation time. */
  function twitch() {
    let clock = 0;
    const subs: { type: string; sessionId: string; createdAt: string }[] = [];
    return {
      subs,
      list: async () => [...subs],
      subscribe: async (type: string, _c: unknown, sessionId: string) => {
        subs.push({ type, sessionId, createdAt: T(++clock) });
      },
      /** The session's socket closes: Twitch disables its subscriptions. */
      drop: (sessionId: string) => {
        for (let i = subs.length - 1; i >= 0; i--)
          if (subs[i]!.sessionId === sessionId) subs.splice(i, 1);
      },
    };
  }

  function bot(
    loyaltyEvent: CoreClient['loyaltyEvent'],
    options: { outbox?: LoyaltyOutbox; tw?: ReturnType<typeof twitch> } = {},
  ) {
    const scheduled: { run: () => void; ms: number }[] = [];
    const logs: string[] = [];
    const tw = options.tw ?? twitch();
    const outbox = options.outbox ?? memoryOutbox();
    const subscribe = vi.fn(tw.subscribe);
    const events = createBroadcasterEvents({
      core: { loyaltyEvent, subscriptionSnapshot: vi.fn() },
      subscribe,
      listEnabledSubscriptions: tw.list,
      getSubscriptionsPage: vi.fn(),
      broadcasterId: '100',
      outbox,
      log: (...args) => logs.push(args.join(' ')),
      retryDelaysMs: [10, 20],
      schedule: (run, ms) => scheduled.push({ run, ms }),
    });
    const flush = async (max = 10) => {
      for (let i = 0; i < max && scheduled.length; i++) {
        scheduled.shift()!.run();
        await tick();
      }
    };
    return { events, scheduled, logs, subscribe, tw, outbox, flush };
  }

  it('Core down or restarting: the event stays in the outbox and is resent (same id) until Core answers', async () => {
    const loyaltyEvent = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new CoreHttpError(503))
      .mockRejectedValueOnce(new CoreHttpError(503))
      .mockResolvedValueOnce(ok);
    const b = bot(loyaltyEvent);
    await b.events.eventSub.subscribe('s1');
    await b.events.eventSub.notification('channel.cheer', cheer, 'msg-1', T(9));
    await tick();
    expect(b.outbox.pending().map((e) => e.event.eventId)).toEqual(['msg-1']);
    await b.flush();
    // Retries never stop while Core is down (last delay repeats); same id: Core replays.
    expect(loyaltyEvent).toHaveBeenCalledTimes(4);
    for (const [body] of loyaltyEvent.mock.calls)
      expect(body).toMatchObject({ eventId: 'msg-1', bits: 100 });
    expect(b.outbox.pending()).toEqual([]);
    expect(b.logs.at(-1)).toMatch(/bits → preview 700/);
  });

  it('a definitive Core refusal (409) is not retried and stays traceable in the outbox journal', async () => {
    const b = bot(vi.fn().mockRejectedValue(new CoreHttpError(409)));
    await b.events.eventSub.subscribe('s1');
    await b.events.eventSub.notification('channel.cheer', cheer, 'm', T(9));
    await tick();
    expect(b.scheduled).toHaveLength(0);
    expect(b.outbox.pending()).toEqual([]);
    expect(b.outbox.rejected()).toMatchObject([
      { event: { eventId: 'm', bits: 100 }, reason: 'core-api responded 409' },
    ]);
    expect(b.logs.join('\n')).toMatch(/REJECTED by Core: bits m/);
  });

  it('bot restart while Core is down: the new process resends what the old one had received', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raptoru-outbox-'));
    const file = join(dir, '.loyalty-outbox.json');
    const first = bot(
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
      {
        outbox: fileOutbox(file),
      },
    );
    await first.events.eventSub.subscribe('s1');
    await first.events.eventSub.notification(
      'channel.cheer',
      cheer,
      'lost?',
      T(9),
    );
    await first.events.eventSub.notification(
      'channel.follow',
      { ...user, followed_at: 'x' },
      'f1',
      T(9),
    );
    await tick();
    // Process killed here (its scheduled retries die with it). A new process starts.
    const loyaltyEvent = vi.fn().mockResolvedValue(ok);
    const second = bot(loyaltyEvent, { outbox: fileOutbox(file) });
    second.events.resumePending();
    await tick();
    expect(loyaltyEvent.mock.calls.map(([e]) => e.eventId).sort()).toEqual([
      'f1',
      'lost?',
    ]);
    expect(fileOutbox(file).pending()).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('two bots starting at the same time: exactly one consumes, every event reaches Core once', async () => {
    const tw = twitch();
    const loyaltyEvent = vi.fn().mockResolvedValue(ok);
    const a = bot(loyaltyEvent, { tw });
    const b = bot(loyaltyEvent, { tw });
    // Both pass the first check (nobody subscribed yet), then both subscribe.
    const results = await Promise.allSettled([
      a.events.eventSub.subscribe('sa'),
      b.events.eventSub.subscribe('sb'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(String((results[1] as PromiseRejectedResult).reason)).toMatch(
      /subscribed first/,
    );
    tw.drop('sb'); // the loser's socket closes

    // Twitch delivered the same cheer to both sessions (different message ids).
    await a.events.eventSub.notification('channel.cheer', cheer, 'a-1', T(50));
    await b.events.eventSub.notification('channel.cheer', cheer, 'b-1', T(50));
    await tick();
    expect(loyaltyEvent.mock.calls.map(([e]) => e.eventId)).toEqual(['a-1']);
    expect(b.outbox.pending()).toEqual([]); // late message of the yielded session: never resent
    // The loser keeps refusing while the winner lives.
    await expect(b.events.eventSub.subscribe('sb2')).rejects.toThrow(
      /already receives them/,
    );
  });

  it('an event arriving while the session is being verified waits in the outbox, then is sent', async () => {
    const tw = twitch();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const loyaltyEvent = vi.fn().mockResolvedValue(ok);
    const b = bot(loyaltyEvent, {
      tw: {
        ...tw,
        list: async () => {
          if (++calls === 2) await gate; // the post-subscribe check is slow
          return tw.list();
        },
      },
    });
    const subscribing = b.events.eventSub.subscribe('s1');
    await tick();
    await b.events.eventSub.notification(
      'channel.cheer',
      cheer,
      'early',
      T(60),
    );
    await tick();
    expect(loyaltyEvent).not.toHaveBeenCalled();
    expect(b.outbox.pending().map((e) => e.event.eventId)).toEqual(['early']);
    release();
    await subscribing;
    await tick();
    expect(loyaltyEvent.mock.calls.map(([e]) => e.eventId)).toEqual(['early']);
  });

  it('restart while the dead session is still listed: its unsent events are kept and sent, never dropped', async () => {
    const tw = twitch();
    await tw.subscribe('channel.cheer', {}, 'old'); // previous run, not yet disabled by Twitch
    const outbox = memoryOutbox();
    outbox.add({
      event: { type: 'bits', eventId: 'old-1', viewer: aouh, bits: 100 },
      receivedAt: T(5),
      session: 'old',
    });
    const loyaltyEvent = vi.fn().mockResolvedValue(ok);
    const b = bot(loyaltyEvent, { tw, outbox });
    await expect(b.events.eventSub.subscribe('new')).rejects.toThrow(
      /already receives/,
    );
    await tick();
    expect(loyaltyEvent.mock.calls.map(([e]) => e.eventId)).toEqual(['old-1']);
    tw.drop('old'); // Twitch notices the dead socket: the next attempt consumes normally
    await b.events.eventSub.subscribe('new-2');
    expect(b.subscribe).toHaveBeenCalledTimes(
      BROADCASTER_EVENT_SUBSCRIPTIONS.length,
    );
  });
});
