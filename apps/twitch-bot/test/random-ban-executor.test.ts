import { describe, expect, it } from 'vitest';
import {
  createRandomBanExecutor,
  helixRbTwitch,
  memoryRbJournal,
  RbReadError,
  type RbTwitch,
  type RbUser,
  searchTarget,
  timeoutOnce,
} from '../src/random-ban-executor.js';
import { type Helix, HelixError } from '../src/twitch/helix.js';

// Random Ban V2 — the Twitch executor (docs/RANDOM_BAN_V2.md) against a SIMULATED Twitch (no real call, no real
// timeout): eligibility (lurkers, follow, moderators, broadcaster, bans / timeouts, VIP, buyer), uniform draw, read
// failures never turned into a flop, Ban User once (409 / 429 / not sent retried; 4xx refused; ambiguous checked in the
// bans list), Core told the target before any timeout, dry run without timeout, restart from the journal.

const BROADCASTER = '83603689';
const u = (id: string, name = `user${id}`): RbUser => ({
  id,
  login: name.toLowerCase(),
  name,
});
const NOW = Date.parse('2026-10-18T20:00:00Z');
const pause = async () => {};

/** A small Twitch: chatters (paged), moderators, bans, follows, subscribers, the timeouts it received. */
function fakeTwitch(o: {
  chatters: RbUser[];
  mods?: string[];
  bans?: { user_id: string; expires_at: string }[];
  follows?: string[];
  subs?: string[];
  page?: number;
}) {
  const calls = { follows: 0, ban: [] as [string, number, string][] };
  const t: RbTwitch & { calls: typeof calls } = {
    calls,
    async chattersPage(after) {
      const size = o.page ?? 1000;
      const at = after ? Number(after) : 0;
      return {
        chatters: o.chatters.slice(at, at + size),
        cursor: at + size < o.chatters.length ? String(at + size) : null,
      };
    },
    async moderators(ids) {
      expect(ids.length).toBeLessThanOrEqual(100);
      return ids.filter((i) => (o.mods ?? []).includes(i));
    },
    async bans(ids) {
      expect(ids.length).toBeLessThanOrEqual(100);
      return (o.bans ?? []).filter((b) => ids.includes(b.user_id));
    },
    async follows(id) {
      calls.follows += 1;
      return (o.follows ?? []).includes(id);
    },
    async subscribers(ids) {
      return ids.filter((i) => (o.subs ?? []).includes(i));
    },
    async ban(id, d, r) {
      calls.ban.push([id, d, r]);
    },
  };
  return t;
}

describe('Random Ban — search', () => {
  it('eligible = present chatters (lurkers too) who follow, minus broadcaster, moderators, banned and timed out; VIPs and the buyer stay', async () => {
    const twitch = fakeTwitch({
      chatters: [
        u(BROADCASTER, 'Raptoru_'),
        u('1', 'LeCroupier_'), // moderator
        u('2', 'Banned'), // permanent ban
        u('3', 'TimedOut'), // timeout in progress
        u('4', 'OldTimeout'), // timeout over: eligible again
        u('5', 'Lurker'), // never spoke: listed by Twitch, eligible
        u('6', 'NoFollow'),
        u('7', 'Vip'),
      ],
      mods: ['1'],
      bans: [
        { user_id: '2', expires_at: '' },
        { user_id: '3', expires_at: new Date(NOW + 60_000).toISOString() },
        { user_id: '4', expires_at: new Date(NOW - 60_000).toISOString() },
      ],
      follows: [BROADCASTER, '1', '2', '3', '4', '5', '7'],
    });
    const picked = new Set<string>();
    for (let k = 0; k < 40; k++) {
      const r = await searchTarget({
        twitch,
        broadcasterId: BROADCASTER,
        now: () => NOW,
        pause,
      });
      expect(r.target).not.toBeNull();
      picked.add(r.target!.name);
      expect(r.stats).toMatchObject({ chatters: 8, candidates: 4 });
    }
    expect([...picked].sort()).toEqual(['Lurker', 'OldTimeout', 'Vip']);
  });

  it('uniform among the eligible: the first follower in a crypto shuffle (deterministic draw here)', async () => {
    const chatters = Array.from({ length: 30 }, (_, i) => u(String(100 + i)));
    const follows = chatters.filter((_, i) => i % 3 === 0).map((c) => c.id);
    const counts = new Map<string, number>();
    const twitch = fakeTwitch({ chatters, follows });
    for (let k = 0; k < 3000; k++) {
      const r = await searchTarget({
        twitch,
        broadcasterId: BROADCASTER,
        pause,
      });
      counts.set(r.target!.id, (counts.get(r.target!.id) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([...follows].sort());
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(300 * 0.7);
      expect(n).toBeLessThan(300 * 1.3);
    }
    // With the shuffle fixed to « no swap », the first follower in list order wins, after ≤ one window of checks.
    const fixed = await searchTarget({
      twitch: fakeTwitch({ chatters, follows }),
      broadcasterId: BROADCASTER,
      draw: (n) => n - 1,
      pause,
    });
    expect(fixed.target!.id).toBe('100');
    expect(fixed.stats.follow_checks).toBe(8);
  });

  it('chatters read across pages (Twitch: 1000 per page); bulk reads by 100 ids', async () => {
    const chatters = Array.from({ length: 250 }, (_, i) => u(String(1000 + i)));
    const r = await searchTarget({
      twitch: fakeTwitch({ chatters, follows: ['1249'], page: 100 }),
      broadcasterId: BROADCASTER,
      pause,
    });
    expect(r.target!.id).toBe('1249');
    expect(r.stats.chatters).toBe(250);
  });

  it('nobody eligible: flop (no target); a Twitch read that keeps failing is an error, never a flop', async () => {
    const empty = await searchTarget({
      twitch: fakeTwitch({ chatters: [u('5'), u('6')], follows: [] }),
      broadcasterId: BROADCASTER,
      pause,
    });
    expect(empty).toMatchObject({ target: null, stats: { follow_checks: 2 } });
    const flaky = fakeTwitch({ chatters: [u('5')], follows: ['5'] });
    let n = 0;
    flaky.follows = async () => {
      n += 1;
      throw new Error('fetch failed');
    };
    await expect(
      searchTarget({ twitch: flaky, broadcasterId: BROADCASTER, pause }),
    ).rejects.toBeInstanceOf(RbReadError);
    expect(n).toBe(3);
    // One failure then success: retried, found.
    const once = fakeTwitch({ chatters: [u('5')], follows: ['5'] });
    let first = true;
    const real = once.follows.bind(once);
    once.follows = async (id) => {
      if (first) {
        first = false;
        throw new HelixError(503, 'busy');
      }
      return real(id);
    };
    expect(
      (await searchTarget({ twitch: once, broadcasterId: BROADCASTER, pause }))
        .target!.id,
    ).toBe('5');
    // A refusal (missing scope): final at once.
    const denied = fakeTwitch({ chatters: [u('5')], follows: ['5'] });
    denied.moderators = async () => {
      throw new HelixError(401, 'Missing scope: moderation:read');
    };
    await expect(
      searchTarget({ twitch: denied, broadcasterId: BROADCASTER, pause }),
    ).rejects.toThrow('modérateurs: Twitch 401');
  });
});

describe('Random Ban — timeout once', () => {
  const run = (ban: RbTwitch['ban'], bans: RbTwitch['bans'] = async () => []) =>
    timeoutOnce({
      twitch: { ...fakeTwitch({ chatters: [] }), ban, bans },
      target: '5',
      durationS: 300,
      reason: 'Pas de chance gros fdp',
      pause,
      now: () => NOW,
    });

  it('confirmed; refused (4xx: nothing applied); 409 / 429 / request never sent: retried, nothing doubled', async () => {
    const sent: number[] = [];
    expect(await run(async (_id, d) => void sent.push(d))).toEqual({
      event: 'confirmed',
    });
    expect(sent).toEqual([300]);
    expect(
      await run(async () => {
        throw new HelixError(
          400,
          'The user specified in the user_id field may not be put in a timeout.',
        );
      }),
    ).toMatchObject({
      event: 'refused',
      error: expect.stringContaining('Twitch 400'),
    });
    let n = 0;
    expect(
      await run(async () => {
        n += 1;
        if (n === 1) throw new HelixError(409, 'conflict');
        if (n === 2) throw new HelixError(429, 'rate', NOW + 100);
        if (n === 3)
          throw Object.assign(new Error('fetch failed'), {
            cause: { code: 'ECONNREFUSED' },
          });
      }),
    ).toEqual({
      event: 'refused',
      error: 'Twitch occupé : aucun timeout appliqué',
    });
    expect(n).toBe(3);
    n = 0;
    expect(
      await run(async () => {
        n += 1;
        if (n === 1) throw new HelixError(409, 'conflict');
      }),
    ).toEqual({ event: 'confirmed' });
    expect(n).toBe(2);
  });

  it('ambiguous answer (timeout / 5xx): never sent again — checked in the bans list (confirmed / not applied / uncertain)', async () => {
    let calls = 0;
    const timeoutErr = async () => {
      calls += 1;
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    };
    expect(
      await run(timeoutErr, async () => [
        { user_id: '5', expires_at: new Date(NOW + 299_000).toISOString() },
      ]),
    ).toEqual({ event: 'confirmed', verified: true });
    expect(await run(timeoutErr, async () => [])).toMatchObject({
      event: 'refused',
      error: 'Twitch ne répond pas ; vérifié : aucun timeout appliqué',
    });
    expect(
      await run(
        async () => {
          calls += 1;
          throw new HelixError(502, 'bad gateway');
        },
        async () => {
          throw new Error('down');
        },
      ),
    ).toEqual({
      event: 'uncertain',
      error: 'Twitch 502 ; liste des bannis illisible',
    });
    expect(calls).toBe(3);
  });
});

/** A fake Core for the executor: records every call, answers like the real one. */
function fakeCore(o: { mode?: 'real' | 'dry_run'; answer?: number } = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let given = false;
  return {
    calls,
    async core(path: string, body: unknown) {
      calls.push({ path, body: body as Record<string, unknown> });
      if (path.endsWith('/claim')) {
        if (given)
          return { status: 200, body: { request: null, reason: 'idle' } };
        given = true;
        return {
          status: 200,
          body: {
            request: {
              request_id: '11111111-1111-4111-8111-111111111111',
              attempt_id: '22222222-2222-4222-8222-222222222222',
              mode: o.mode ?? 'real',
            },
          },
        };
      }
      if (path.endsWith('/target'))
        return o.answer
          ? { status: o.answer, body: { error: 'not_current_attempt' } }
          : {
              status: 200,
              body:
                (o.mode ?? 'real') === 'real'
                  ? {
                      proceed: true,
                      duration_s: 300,
                      reason: 'Pas de chance gros fdp',
                    }
                  : { proceed: false },
            };
      return { status: 200, body: {} };
    },
  };
}

const executor = (
  core: ReturnType<typeof fakeCore>,
  twitch: ReturnType<typeof fakeTwitch>,
  journal = memoryRbJournal(),
  scopes = [
    'moderator:read:chatters',
    'moderator:read:followers',
    'moderator:manage:banned_users',
  ],
) =>
  createRandomBanExecutor({
    core: core.core,
    channelId: '900100',
    broadcasterId: BROADCASTER,
    executorId: 'lab-chat-1',
    login: 'lecroupier_',
    botScopes: scopes,
    broadcasterScopes: ['moderation:read', 'channel:read:subscriptions'],
    twitch,
    journal,
    pause,
    now: () => NOW,
    log: () => {},
  });

describe('Random Ban — executor', () => {
  it('real: claim → target told to Core → ONE timeout (sub: Core decides the duration) → confirmed; nothing more after', async () => {
    const core = fakeCore();
    const twitch = fakeTwitch({
      chatters: [u('5', 'Lurker')],
      follows: ['5'],
      subs: ['5'],
    });
    const ex = executor(core, twitch);
    expect(ex.ready).toEqual({
      canSearch: true,
      canTimeout: true,
      missing: [],
    });
    expect(await ex.tick()).toBe('worked');
    expect(core.calls.map((c) => c.path.split('/').pop())).toEqual([
      'claim',
      'target',
      'result',
    ]);
    expect(core.calls[1]!.body).toMatchObject({
      target: { id: '5', name: 'Lurker' },
      is_sub: true,
    });
    expect(twitch.calls.ban).toEqual([['5', 300, 'Pas de chance gros fdp']]);
    expect(core.calls[2]!.body).toMatchObject({ event: 'confirmed' });
    expect(await ex.tick()).toBe('idle');
    expect(twitch.calls.ban).toHaveLength(1);
  });

  it('Core did not acknowledge the target: nothing is sent (the lease expires, Core offers it again)', async () => {
    const core = fakeCore({ answer: 409 });
    const twitch = fakeTwitch({ chatters: [u('5')], follows: ['5'] });
    await executor(core, twitch).tick();
    expect(twitch.calls.ban).toEqual([]);
  });

  it('dry run: the real search, never a timeout; flop and read failure reported as such', async () => {
    const core = fakeCore({ mode: 'dry_run' });
    const twitch = fakeTwitch({ chatters: [u('5')], follows: ['5'] });
    await executor(core, twitch).tick();
    expect(twitch.calls.ban).toEqual([]);
    expect(core.calls.at(-1)!.path).toMatch(/\/target$/);
    const flopCore = fakeCore();
    await executor(
      flopCore,
      fakeTwitch({ chatters: [u('5')], follows: [] }),
    ).tick();
    expect(flopCore.calls.at(-1)!.body).toMatchObject({
      event: 'flop',
      stats: { candidates: 1 },
    });
    const failCore = fakeCore();
    const down = fakeTwitch({ chatters: [u('5')] });
    down.chattersPage = async () => {
      throw new Error('fetch failed');
    };
    await executor(failCore, down).tick();
    expect(failCore.calls.at(-1)!.body).toMatchObject({
      event: 'failed',
      error: expect.stringContaining(
        'recherche impossible : liste des chatters',
      ),
    });
  });

  it('missing rights are told to Core with each claim (Core refuses what cannot be served)', async () => {
    const core = fakeCore();
    const ex = executor(core, fakeTwitch({ chatters: [] }), memoryRbJournal(), [
      'moderator:read:chatters',
      'moderator:read:followers',
    ]);
    expect(ex.ready).toEqual({
      canSearch: true,
      canTimeout: false,
      missing: ['lecroupier_: moderator:manage:banned_users'],
    });
    await ex.tick();
    expect(core.calls[0]!.body).toMatchObject({
      can_timeout: false,
      missing: ['lecroupier_: moderator:manage:banned_users'],
    });
  });

  it('restart during a timeout: the journal entry is settled from Twitch (never sent again) and reported once', async () => {
    const journal = memoryRbJournal();
    journal.put({
      request_id: '33333333-3333-4333-8333-333333333333',
      attempt_id: '44444444-4444-4444-8444-444444444444',
      target_id: '5',
      state: 'about_to_timeout',
    });
    const core = fakeCore();
    core.core = (async (path: string, body: unknown) => {
      core.calls.push({ path, body: body as Record<string, unknown> });
      return { status: 200, body: { request: null } };
    }) as typeof core.core;
    const twitch = fakeTwitch({
      chatters: [],
      bans: [
        { user_id: '5', expires_at: new Date(NOW + 200_000).toISOString() },
      ],
    });
    await executor(core, twitch, journal).tick();
    expect(core.calls[0]).toMatchObject({
      path: '/v1/lab/random-ban/requests/33333333-3333-4333-8333-333333333333/result',
      body: { event: 'confirmed', verified: true },
    });
    expect(twitch.calls.ban).toEqual([]);
    expect(journal.entries()).toEqual([]);
  });
});

describe('Random Ban — production bot (main Core)', () => {
  it('dry run on /v1/bot/random-ban: claim and target only, never a timeout', async () => {
    const core = fakeCore({ mode: 'dry_run' });
    const twitch = fakeTwitch({ chatters: [u('5')], follows: ['5'] });
    const ex = createRandomBanExecutor({
      core: core.core,
      base: '/v1/bot/random-ban',
      channelId: BROADCASTER,
      broadcasterId: BROADCASTER,
      executorId: 'bot-1239040922',
      login: 'lecroupier_',
      botScopes: [
        'moderator:read:chatters',
        'moderator:read:followers',
        'moderator:manage:banned_users',
      ],
      broadcasterScopes: ['moderation:read', 'channel:read:subscriptions'],
      twitch,
      journal: memoryRbJournal(),
      pause,
      now: () => NOW,
      log: () => {},
    });
    expect(await ex.tick()).toBe('worked');
    expect(core.calls.map((c) => c.path)).toEqual([
      `/v1/bot/random-ban/${BROADCASTER}/claim`,
      '/v1/bot/random-ban/requests/11111111-1111-4111-8111-111111111111/target',
    ]);
    expect(twitch.calls.ban).toEqual([]);
  });

  it('Helix adapter: bot reads + timeout as LeCroupier_, moderation reads with the broadcaster token (absent: refused)', async () => {
    const calls: unknown[][] = [];
    const rec =
      (name: string, out: unknown) =>
      async (...args: unknown[]) => {
        calls.push([name, ...args]);
        return out;
      };
    const bot = {
      getChattersPage: rec('chatters', {
        chatters: [
          { twitchUserId: '5', login: 'lurker', displayName: 'Lurker' },
        ],
        cursor: null,
      }),
      isFollower: rec('follows', true),
      timeoutUser: rec('timeout', undefined),
    } as unknown as Helix;
    const broadcaster = {
      getModeratorIds: rec('mods', ['7']),
      getBans: rec('bans', []),
      getSubscriberIds: rec('subs', ['5']),
    } as unknown as Helix;
    const t = helixRbTwitch(bot, broadcaster, BROADCASTER, '1239040922');
    expect(await t.chattersPage(null)).toEqual({
      chatters: [u('5', 'Lurker')],
      cursor: null,
    });
    expect(await t.moderators(['5', '7'])).toEqual(['7']);
    expect(await t.subscribers(['5'])).toEqual(['5']);
    await t.ban('5', 300, 'r');
    expect(calls).toContainEqual(['chatters', BROADCASTER, '1239040922', null]);
    expect(calls).toContainEqual([
      'timeout',
      BROADCASTER,
      '1239040922',
      '5',
      300,
      'r',
    ]);
    const without = helixRbTwitch(bot, null, BROADCASTER, '1239040922');
    await expect(without.bans(['5'])).rejects.toThrow(
      'broadcaster_token_absent',
    );
  });
});

describe('Random Ban V3 — the buyer drawn less often, never impossible', () => {
  const crypto = async (n: number, chatters: RbUser[], buyerId: string) => {
    const { randomInt } = await import('node:crypto');
    const seen = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const r = await searchTarget({
        twitch: fakeTwitch({ chatters, follows: chatters.map((c) => c.id) }),
        broadcasterId: BROADCASTER,
        buyerId,
        draw: (k) => randomInt(k),
        pause,
        now: () => NOW,
      });
      seen.set(r.target!.id, (seen.get(r.target!.id) ?? 0) + 1);
    }
    return seen;
  };

  it('the buyer met first and passed over: the next follower is the target; kept: he is (CSC)', async () => {
    const chatters = [u('10'), u('11'), u('12')];
    const twitch = () => fakeTwitch({ chatters, follows: ['10', '11', '12'] });
    // Shuffle draws (identity order: j = i), then the buyer's keep draw.
    const run = (keep: number) => {
      const draws = [2, 1, keep];
      return searchTarget({
        twitch: twitch(),
        broadcasterId: BROADCASTER,
        buyerId: '10',
        draw: () => draws.shift()!,
        pause,
        now: () => NOW,
      });
    };
    expect((await run(250)).target!.id).toBe('11'); // 250 ≥ 1000 × 0.25: passed over
    expect((await run(249)).target!.id).toBe('10'); // kept
  });

  it('the buyer alone eligible: still the target (never a flop because of the rarity)', async () => {
    const r = await searchTarget({
      twitch: fakeTwitch({ chatters: [u('10'), u('11')], follows: ['10'] }),
      broadcasterId: BROADCASTER,
      buyerId: '10',
      draw: (k) => (k === 1000 ? 999 : 0), // the shuffle keeps its order; the buyer is passed over
      pause,
      now: () => NOW,
    });
    expect(r.target!.id).toBe('10');
  });

  it('frequencies (crypto, 20 000 draws): buyer ≈ w/N, the others share the rest equally', async () => {
    for (const [n, buyerP] of [
      [2, 0.125],
      [5, 0.05],
    ] as const) {
      const chatters = Array.from({ length: n }, (_, i) => u(String(20 + i)));
      const runs = 20_000;
      const seen = await crypto(runs, chatters, '20');
      const p = (seen.get('20') ?? 0) / runs;
      expect(Math.abs(p - buyerP)).toBeLessThan(0.012);
      const others = (1 - buyerP) / (n - 1);
      for (const c of chatters.slice(1))
        expect(Math.abs((seen.get(c.id) ?? 0) / runs - others)).toBeLessThan(
          0.015,
        );
    }
  }, 60_000);
});
