import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALERT_RETRY_TTL_MS,
  type AlertsMode,
  createLabAlertsIngest,
} from '../src/lab-alerts-ingest.js';
import { createLabChatIngest } from '../src/lab-chat-ingest.js';
import { createEventSubRouter } from '../src/twitch/eventsub.js';
import {
  BROADCASTER,
  cheer,
  EVENTS,
  frame,
  READER,
} from './fixtures/eventsub-alerts.js';

// Twitch alerts, real events (17/10/2026): the Lab chat adapter's EventSub connection → normalized alert events →
// the Lab Core. Whole WebSocket frames (fixtures shaped like the Twitch reference) go through the real router.

afterEach(() => {
  vi.useRealTimers();
});

function setup(
  mode: AlertsMode,
  o: { scopes?: string[]; fail?: (path: string) => Error | null } = {},
) {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const subs: { type: string; version?: string; condition: unknown }[] = [];
  const logs: string[] = [];
  const log = (...a: unknown[]) => logs.push(a.join(' '));
  const lab = async (path: string, body: unknown) => {
    const err = o.fail?.(path);
    if (err) throw err;
    posts.push({ path, body: body as Record<string, unknown> });
    return path === '/v1/lab/alerts/events' ? { outcome: 'queued' } : {};
  };
  const alerts = createLabAlertsIngest({
    mode,
    channelId: '900100',
    broadcasterId: BROADCASTER,
    tokenUserId: READER,
    scopes: o.scopes ?? ['user:read:chat'],
    lab,
    log,
  });
  const ingest = createLabChatIngest({
    lab,
    labChannelId: '900100',
    broadcasterId: BROADCASTER,
    tokenUserId: READER,
    subscribe: async (type, condition, _session, version) => {
      if (type === 'channel.follow' && o.fail?.('subscribe:follow'))
        throw o.fail('subscribe:follow');
      subs.push({ type, version, condition });
    },
    getStream: async () => null,
    alerts,
    log,
  });
  const route = createEventSubRouter(ingest.handlers);
  const deliver = (type: string, event: object, id: string, version = '1') =>
    route(frame(type, version, event as Record<string, unknown>, id), true);
  const alertPosts = () =>
    posts.filter((p) => p.path === '/v1/lab/alerts/events').map((p) => p.body);
  return { ingest, alerts, subs, posts, logs, deliver, alertPosts };
}

const all = (s: ReturnType<typeof setup>) => [
  s.deliver('channel.chat.notification', EVENTS.sub, 'm1'),
  s.deliver('channel.chat.notification', EVENTS.resub, 'm2'),
  s.deliver('channel.chat.notification', EVENTS.giftTargeted, 'm3'),
  ...EVENTS.community.map((e, i) =>
    s.deliver('channel.chat.notification', e, `m4-${i}`),
  ),
  s.deliver('channel.chat.message', cheer(100, { messageId: 'c1' }), 'm5'),
  s.deliver('channel.chat.notification', EVENTS.raid, 'm6'),
  s.deliver('channel.follow', EVENTS.follow, 'm7', '2'),
];

describe('Lab alerts ingestion — modes', () => {
  it('OFF (default): no alert subscription, nothing read for the alerts; the chat still flows', async () => {
    const s = setup('off', {
      scopes: ['user:read:chat', 'moderator:read:followers'],
    });
    await s.ingest.handlers.subscribe('sess');
    expect(s.subs.map((x) => x.type)).toEqual([
      'stream.online',
      'stream.offline',
      'channel.chat.message',
    ]);
    await Promise.all(all(s));
    expect(s.alertPosts()).toEqual([]);
    // The cheer message itself still reaches the chat route (Jeu des mots etc.).
    expect(s.posts.map((p) => p.path)).toEqual(['/v1/lab/chat']);
  });

  it('TEST: subscribed and logged, NEVER sent to Core (nothing queued, nothing displayed)', async () => {
    const s = setup('test');
    await s.ingest.handlers.subscribe('sess');
    expect(s.subs.map((x) => x.type)).toContain('channel.chat.notification');
    await Promise.all(all(s));
    expect(s.alertPosts()).toEqual([]);
    expect(s.logs.filter((l) => l.includes('TEST, non admis'))).toEqual([
      '[lab-alerts] TEST, non admis : sub Alice (n-sub-1)',
      '[lab-alerts] TEST, non admis : resub viewer23 (d62235c8-47ff-a4f4--84e8-5a29a65a9c03)',
      '[lab-alerts] TEST, non admis : gift_targeted Alice (n-gift-t-1)',
      '[lab-alerts] TEST, non admis : gift_community Bob (n-cg-777)',
      '[lab-alerts] TEST, non admis : gift_recipient Bob (n-cg-777-401)',
      '[lab-alerts] TEST, non admis : gift_recipient Bob (n-cg-777-402)',
      '[lab-alerts] TEST, non admis : gift_recipient Bob (n-cg-777-403)',
      '[lab-alerts] TEST, non admis : bits viewer32 (c1)',
      '[lab-alerts] TEST, non admis : raid GrosRaideur (n-raid-1)',
      '[lab-alerts] TEST, non admis : follow Cool_User (m7)',
    ]);
  });

  it('ACTIVE: every source to the Lab alerts channel with its stable Twitch id', async () => {
    const s = setup('active', {
      scopes: ['user:read:chat', 'moderator:read:followers'],
    });
    await s.ingest.handlers.subscribe('sess');
    expect(s.subs.slice(3)).toEqual([
      {
        type: 'channel.chat.notification',
        version: '1',
        condition: { broadcaster_user_id: BROADCASTER, user_id: READER },
      },
      {
        type: 'channel.follow',
        version: '2',
        condition: {
          broadcaster_user_id: BROADCASTER,
          moderator_user_id: READER,
        },
      },
    ]);
    await Promise.all(all(s));
    const got = s.alertPosts();
    expect(
      got.every((e) => e.channel_id === '900100' && e.source === 'twitch'),
    ).toBe(true);
    expect(got.map((e) => [e.type, e.source_event_id])).toEqual([
      ['sub', 'n-sub-1'],
      ['resub', 'd62235c8-47ff-a4f4--84e8-5a29a65a9c03'],
      ['gift_targeted', 'n-gift-t-1'],
      ['gift_community', 'n-cg-777'],
      ['gift_recipient', 'n-cg-777-401'],
      ['gift_recipient', 'n-cg-777-402'],
      ['gift_recipient', 'n-cg-777-403'],
      ['bits', 'c1'],
      ['raid', 'n-raid-1'],
      // A follow has no id of its own: the EventSub message id (the same on a redelivery).
      ['follow', 'm7'],
    ]);
    expect(got[1]).toMatchObject({ months: 10, tier: '1000' });
    expect(got[2]).toMatchObject({
      actor: { display_name: 'Alice' },
      recipient: { display_name: 'Chanceux' },
    });
    expect(got[3]).toMatchObject({ count: 3, community_gift_id: 'cg-777' });
    expect(got[4]).toMatchObject({ community_gift_id: 'cg-777' });
    expect(got[7]).toMatchObject({
      bits: 100,
      actor: { display_name: 'viewer32' },
    });
    expect(got[8]).toMatchObject({
      viewers: 42,
      actor: { display_name: 'GrosRaideur' },
    });
    expect(got[9]).toMatchObject({ actor: { display_name: 'Cool_User' } });
  });
});

describe('Lab alerts ingestion — payload details', () => {
  it('anonymous community gift, anonymous cheer, Prime sub, shared-chat events of another channel', async () => {
    const s = setup('active');
    await s.deliver(
      'channel.chat.notification',
      EVENTS.communityAnonymous,
      'a1',
    );
    await s.deliver(
      'channel.chat.message',
      cheer(50, {
        messageId: 'c2',
        login: 'ananonymouscheerer',
        name: 'AnAnonymousCheerer',
      }),
      'a2',
    );
    await s.deliver('channel.chat.notification', EVENTS.prime, 'a3');
    await s.deliver('channel.chat.notification', EVENTS.sharedResub, 'a4');
    await s.deliver(
      'channel.chat.message',
      cheer(500, { messageId: 'c3', source: '112233' }),
      'a5',
    );
    const got = s.alertPosts();
    expect(got).toHaveLength(3);
    expect(got[0]).toMatchObject({
      type: 'gift_community',
      anonymous: true,
      count: 5,
    });
    expect(got[0]!.actor).toBeUndefined();
    expect(got[1]).toMatchObject({ type: 'bits', anonymous: true, bits: 50 });
    expect(got[1]!.actor).toBeUndefined();
    expect(got[2]).toMatchObject({ type: 'sub', tier: 'prime' });
  });

  it('invalid / incomplete payloads are ignored without breaking the connection', async () => {
    const s = setup('active');
    await expect(
      s.deliver(
        'channel.chat.notification',
        { notice_type: 'sub', sub: {} },
        'x1',
      ),
    ).resolves.toEqual({ kind: 'other' });
    await s.deliver(
      'channel.chat.notification',
      { notice_type: 'raid', raid: null },
      'x2',
    );
    await s.deliver('channel.follow', { user_id: '1' }, 'x3', '2');
    await s.deliver(
      'channel.chat.message',
      cheer(0, { messageId: 'c0' }),
      'x4',
    );
    expect(s.alertPosts()).toEqual([]);
  });
});

describe('Lab alerts ingestion — resilience', () => {
  it('follows without the scope: not subscribed, said in the log; a refused subscription never stops the chat', async () => {
    const noScope = setup('active');
    await noScope.ingest.handlers.subscribe('sess');
    expect(noScope.subs.map((x) => x.type)).not.toContain('channel.follow');
    expect(noScope.logs.join('\n')).toContain('follows non reçus');
    const refused = setup('active', {
      scopes: ['user:read:chat', 'moderator:read:followers'],
      fail: (p) => (p === 'subscribe:follow' ? new Error('helix_403') : null),
    });
    await expect(
      refused.ingest.handlers.subscribe('sess'),
    ).resolves.toBeUndefined();
    expect(refused.subs.map((x) => x.type)).toContain('channel.chat.message');
    expect(refused.logs.join('\n')).toContain(
      'abonnement channel.follow refusé',
    );
  });

  it('a redelivered frame (same EventSub message id) is forwarded once; another session forwards it again with the SAME Twitch id (Core deduplicates)', async () => {
    const s = setup('active');
    await s.deliver('channel.chat.notification', EVENTS.sub, 'm1');
    await s.deliver('channel.chat.notification', EVENTS.sub, 'm1');
    expect(s.alertPosts()).toHaveLength(1);
    // Bot / adapter restart: a fresh router (no memory), the same notification.
    const again = setup('active');
    await again.deliver('channel.chat.notification', EVENTS.sub, 'm1-bis');
    expect(again.alertPosts()[0]!.source_event_id).toBe(
      s.alertPosts()[0]!.source_event_id,
    );
  });

  it('Core unreachable: retried in the background with the same id, then delivered; never blocks EventSub', async () => {
    vi.useFakeTimers();
    let down = true;
    const s = setup('active', {
      fail: (p) =>
        down && p === '/v1/lab/alerts/events'
          ? new Error('fetch failed')
          : null,
    });
    await s.deliver('channel.chat.notification', EVENTS.raid, 'r1');
    expect(s.alerts.pendingRetries()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    down = false;
    await vi.advanceTimersByTimeAsync(4000);
    expect(s.alertPosts().map((e) => e.source_event_id)).toEqual(['n-raid-1']);
    expect(s.alerts.pendingRetries()).toBe(0);
    expect(s.logs.join('\n')).toContain('raid GrosRaideur (n-raid-1) → queued');
  });

  it('Core refusing (4xx) is not retried; Core down longer than the TTL: dropped with a log line; stop drops the rest', async () => {
    vi.useFakeTimers();
    const refused = setup('active', {
      fail: (p) =>
        p === '/v1/lab/alerts/events' ? new Error('lab_core_400') : null,
    });
    await refused.deliver('channel.chat.notification', EVENTS.sub, 's1');
    expect(refused.alerts.pendingRetries()).toBe(0);
    expect(refused.logs.join('\n')).toContain('perdu (Core : lab_core_400)');
    const down = setup('active', {
      fail: (p) =>
        p === '/v1/lab/alerts/events' ? new Error('lab_core_503') : null,
    });
    await down.deliver('channel.chat.notification', EVENTS.sub, 's2');
    await vi.advanceTimersByTimeAsync(ALERT_RETRY_TTL_MS + 60_000);
    expect(down.alerts.pendingRetries()).toBe(0);
    expect(down.logs.join('\n')).toContain('perdu (Core : lab_core_503)');
    const stopping = setup('active', {
      fail: (p) =>
        p === '/v1/lab/alerts/events' ? new Error('fetch failed') : null,
    });
    await stopping.deliver('channel.chat.notification', EVENTS.sub, 's3');
    stopping.ingest.close();
    expect(stopping.alerts.pendingRetries()).toBe(0);
    expect(stopping.logs.join('\n')).toContain('abandonnée');
  });
});

describe('never in production', () => {
  it('the production bot entry (index / runtime) carries no alert code; only the Lab adapter does', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = (f: string) =>
      readFile(new URL(`../src/${f}`, import.meta.url), 'utf8');
    for (const f of ['index.ts', 'runtime.ts'])
      expect(await src(f)).not.toMatch(/alert/i);
    expect(await src('lab-chat-main.ts')).toContain('createLabAlertsIngest');
    // The adapter itself only ever posts to the Lab Core's alerts route.
    expect(await src('lab-alerts-ingest.ts')).toContain(
      "'/v1/lab/alerts/events'",
    );
  });
});
