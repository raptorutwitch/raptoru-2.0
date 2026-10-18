import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { createLabCore } from '../../../core-api/src/bonk-lab/lab-core.js';
import { systemClock } from '../../../core-api/src/clock.js';
import { migrate } from '../../../core-api/src/db/migrate.js';
import { createPgliteDb } from '../../../core-api/test/helpers.js';
import {
  createRandomBanExecutor,
  memoryRbJournal,
  type RbTwitch,
} from '../../../twitch-bot/src/random-ban-executor.js';
import type { ObsLike } from '../src/channel-points/obs-actions.js';
import { ChannelPointsRuntime } from '../src/channel-points/runtime.js';
import type { EffectsPlayer } from '../src/effects/player.js';
import { localLabCoreClient } from '../src/lab-moderation/proxy.js';

// Random Ban V2 (docs/RANDOM_BAN_V2.md) — the whole Lab chain with the REAL Lab Core, the REAL Twitch executor of the
// bot against a SIMULATED Twitch (no real call, no real timeout) and Studio's runtime with a simulated effects player:
// redemption → one request → target → one timeout → animation with both names → history; Studio tests never time
// out; a flop; the effects player absent never undoes a confirmed timeout.

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const CH = '900100';
const BROADCASTER = '83603689';

async function chain(o: {
  chatters: { id: string; name: string }[];
  follows: string[];
  subs?: string[];
  effects?: boolean;
}) {
  const db = createPgliteDb(
    new PGlite({
      parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) },
    }),
  );
  await migrate(db, 'lab');
  const secret = randomBytes(32).toString('hex');
  const server: Server = createLabCore({
    db,
    clock: systemClock,
    secret,
  }).server;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const coreUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dir = await mkdtemp(join(tmpdir(), 'rb-'));
  cleanups.push(async () => {
    server.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const core = localLabCoreClient(coreUrl, secret);
  // The bot's way to Core (the Lab adapter posts with the same secret, and reads the HTTP status).
  const botCore = async (path: string, body: unknown) => {
    const res = await fetch(new URL(path, coreUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as unknown };
  };
  const timeouts: [string, number, string][] = [];
  const twitch: RbTwitch = {
    chattersPage: async () => ({
      chatters: o.chatters.map((c) => ({ ...c, login: c.name.toLowerCase() })),
      cursor: null,
    }),
    moderators: async () => [],
    bans: async () => [],
    follows: async (id) => o.follows.includes(id),
    subscribers: async (ids) => ids.filter((i) => (o.subs ?? []).includes(i)),
    ban: async (id, d, r) => void timeouts.push([id, d, r]),
  };
  const executor = createRandomBanExecutor({
    core: botCore,
    channelId: CH,
    broadcasterId: BROADCASTER,
    executorId: 'lab-chat-1239040922',
    login: 'lecroupier_',
    botScopes: [
      'moderator:read:chatters',
      'moderator:read:followers',
      'moderator:manage:banned_users',
    ],
    broadcasterScopes: ['moderation:read', 'channel:read:subscriptions'],
    twitch,
    journal: memoryRbJournal(),
    pause: async () => {},
    log: () => {},
  });
  const shown: Record<string, unknown>[] = [];
  const effects = {
    status: () => ({
      url: '',
      connected: true,
      audio: true,
      current: true,
      playing: 0,
    }),
    play: async (e: Record<string, unknown>) => {
      shown.push(e);
      return { end: Promise.resolve({ event: 'completed' as const }) };
    },
    handle: async () => false,
    sounds: () => [],
    videos: () => [],
    interactionMedia: () => [],
  } as unknown as EffectsPlayer;
  const obs: ObsLike = { connected: true, request: async () => ({}) };
  const rt = await ChannelPointsRuntime.create({
    core,
    environment: 'lab',
    channelId: CH,
    origin: 'http://127.0.0.1:1',
    dir,
    obs: () => obs,
    effects: o.effects === false ? null : effects,
    twitch: () => ({ scope: true, adapter_running: true }),
  });
  await core('/v1/lab/channel-points/rewards', {
    channel_id: CH,
    rewards: [
      { id: 'reward-rb', title: 'Ban aléatoire', cost: 3000, is_enabled: true },
    ],
  });
  await core(`/v1/lab/channel-points/${CH}/rules/reward-rb`, {
    enabled: true,
    actions: [{ type: 'interaction', interaction: 'random_ban' }],
  });
  const redeem = (
    id = randomUUID(),
    source: 'twitch' | 'simulation' = 'twitch',
  ) =>
    core(
      source === 'twitch'
        ? '/v1/lab/channel-points/redemptions'
        : `/v1/lab/channel-points/${CH}/test`,
      source === 'twitch'
        ? {
            channel_id: CH,
            source: 'twitch',
            redemption_id: id,
            reward: { id: 'reward-rb', title: 'Ban aléatoire', cost: 3000 },
            user: { id: '9001', login: 'buyer', display_name: 'Buyer' },
            twitch_status: 'unfulfilled',
            redeemed_at: new Date().toISOString(),
          }
        : { reward_id: 'reward-rb' },
    );
  const rbState = () =>
    core<{ recent: Record<string, unknown>[] }>(
      `/v1/lab/random-ban/${CH}/state`,
    );
  return { core, executor, rt, redeem, timeouts, shown, rbState };
}

describe('Random Ban — Lab chain (real Lab Core, bot executor on a simulated Twitch, Studio runtime)', () => {
  it('a real redemption: one target among the followers present, ONE timeout by LeCroupier_ (sub 3 min), then the animation with both names', async () => {
    const c = await chain({
      chatters: [
        { id: '5', name: 'Lurker' },
        { id: '6', name: 'NoFollow' },
      ],
      follows: ['5'],
      subs: ['5'],
    });
    await c.core(`/v1/lab/channel-points/${CH}/settings`, { enabled: true });
    const id = randomUUID();
    await c.redeem(id);
    await c.redeem(id); // redelivered by Twitch: nothing more
    expect(await c.executor.tick()).toBe('worked');
    expect(await c.executor.tick()).toBe('idle');
    expect(c.timeouts).toEqual([['5', 180, 'Pas de chance fdp']]);
    expect(await c.rt.randomBan.once()).toBe(true);
    expect(c.shown).toHaveLength(1);
    expect(c.shown[0]).toMatchObject({
      kind: 'ban',
      trigger: 'Buyer',
      banned: 'Lurker',
    });
    expect(String(c.shown[0]!.animation)).toMatch(/^ban_(?!csc)/);
    expect(await c.rt.randomBan.once()).toBe(false);
    const s = await c.rbState();
    expect(s.recent[0]).toMatchObject({
      status: 'confirmed',
      mode: 'real',
      target: { name: 'Lurker', is_sub: true },
      duration_s: 180,
      animation_status: 'completed',
      stats: { chatters: 2, candidates: 2 },
    });
    const cp = await c.core<{ recent: Record<string, unknown>[] }>(
      `/v1/lab/channel-points/${CH}/state`,
    );
    expect(cp.recent[0]).toMatchObject({
      status: 'done',
      results: [{ status: 'done', detail: 'Lurker en timeout 3 min' }],
    });
  });

  it('the buyer drawn himself: CSC; nobody following: flop (animation, no timeout, nothing refunded)', async () => {
    const c = await chain({
      chatters: [{ id: '9001', name: 'Buyer' }],
      follows: ['9001'],
    });
    await c.core(`/v1/lab/channel-points/${CH}/settings`, { enabled: true });
    await c.redeem();
    await c.executor.tick();
    await c.rt.randomBan.once();
    expect(c.timeouts).toEqual([['9001', 300, 'Pas de chance gros fdp']]);
    expect(c.shown[0]).toMatchObject({
      kind: 'ban',
      animation: 'ban_csc',
      trigger: 'Buyer',
      banned: 'Buyer',
    });
    const f = await chain({
      chatters: [{ id: '6', name: 'NoFollow' }],
      follows: [],
    });
    await f.core(`/v1/lab/channel-points/${CH}/settings`, { enabled: true });
    await f.redeem();
    await f.executor.tick();
    await f.rt.randomBan.once();
    expect(f.timeouts).toEqual([]);
    expect(f.shown).toEqual([{ kind: 'flop', trigger: 'Buyer' }]);
    expect((await f.rbState()).recent[0]).toMatchObject({
      status: 'flop',
      refund: 'none',
    });
  });

  it('Studio tests NEVER time out: « Tester » of the rule and « Tirage à blanc » run the real search only; « Tester l’animation » calls no one', async () => {
    const c = await chain({
      chatters: [{ id: '5', name: 'Lurker' }],
      follows: ['5'],
    });
    // Switch OFF: the rule's « Tester » still runs (a simulation), as a dry run.
    await c.redeem(randomUUID(), 'simulation');
    await c.executor.tick();
    await c.rt.handle(
      Object.assign(
        (await import('node:stream')).Readable.from([
          JSON.stringify({ mode: 'dry_run' }),
        ]),
        {
          method: 'POST',
          headers: { host: '127.0.0.1:1', 'x-raptoru-studio': '1' },
        },
      ) as never,
      {
        writeHead: () => ({ end: () => {} }),
        end: () => {},
        headersSent: false,
      } as never,
      new URL('http://127.0.0.1:1/api/random-ban/test'),
    );
    await c.executor.tick();
    expect(c.timeouts).toEqual([]);
    const s = await c.rbState();
    expect(s.recent.map((r) => [r.mode, r.status])).toEqual([
      ['dry_run', 'simulated'],
      ['dry_run', 'simulated'],
    ]);
    // Animation only: straight to the player.
    await c.core(`/v1/lab/random-ban/${CH}/test`, {
      mode: 'animation',
      outcome: 'flop',
      trigger: 'Raptoru_',
    });
    while (await c.rt.randomBan.once());
    expect(c.shown.at(-1)).toEqual({ kind: 'flop', trigger: 'Raptoru_' });
    expect(c.timeouts).toEqual([]);
  });

  it('effects player absent: the confirmed timeout stays confirmed; the animation is reported not shown', async () => {
    const c = await chain({
      chatters: [{ id: '5', name: 'Lurker' }],
      follows: ['5'],
      effects: false,
    });
    await c.core(`/v1/lab/channel-points/${CH}/settings`, { enabled: true });
    await c.redeem();
    await c.executor.tick();
    expect(await c.rt.randomBan.once()).toBe(true);
    expect((await c.rbState()).recent[0]).toMatchObject({
      status: 'confirmed',
      animation_status: 'failed',
      error: 'animation: effects_player_unavailable',
    });
    expect(c.timeouts).toHaveLength(1);
  });
});
