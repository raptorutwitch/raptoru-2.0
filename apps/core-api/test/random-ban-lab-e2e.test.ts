import { describe, expect, it } from 'vitest';
// The REAL Twitch executor of the bot, against the Lab's fake Twitch (no network): no second draw in this test.
import {
  createRandomBanExecutor,
  memoryRbJournal,
} from '../../twitch-bot/src/random-ban-executor.js';
import {
  LAB_CHATTERS,
  labFakeTwitch,
} from '../../twitch-bot/src/rb-lab-twitch.js';
import { randomBanRoutes } from '../src/http/random-ban-routes.js';
import { internalLabCall } from '../src/ext/lab-internal.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { RandomBanService } from '../src/random-ban/service.js';
import { randomBanExtModule } from '../src/modules/random-ban.js';
import { setup } from './helpers.js';

// Mini-jeux in the Lab, end to end without Twitch (PLAN lot 3b): a viewer buys from the extension (module host), the
// bot's executor (fake Twitch) claims it, searches, tells Core the target, « times out » once, reports — the request is
// confirmed, the price paid recorded, the viewer's history shows it, the next price is the 2nd tier.

const CH = '83603689';
const V = { id: '9001', display_name: 'Alice' };

describe('Random Ban — Lab end to end (extension → real executor → result)', () => {
  it('one purchase, one draw among the fictional chatters, one simulated timeout, one charge used', async () => {
    const core = await setup();
    // A real-mode request (the main Core's extension door, not the Lab's dry run): the fake Twitch is the only target.
    const rb = new RandomBanService(core.db, core.clock);
    core.modules.add({ ...randomBanExtModule(rb), id: 'random_ban_e2e' });
    await core.moduleSettings.set(CH, 'random_ban_e2e.enabled', 1, 'test');
    await editWallet(
      core.db,
      core.clock.now(),
      CH,
      V.id,
      'set',
      { tokens: 100_000 },
      'test',
    );
    const call = internalLabCall(randomBanRoutes(rb));
    const bans: { userId: string; durationS: number }[] = [];
    const executor = createRandomBanExecutor({
      core: async (path, body) => {
        try {
          return { status: 200, body: await call(path, body) };
        } catch (e) {
          const err = e as { status?: number; body?: unknown };
          return { status: err.status ?? 500, body: err.body ?? {} };
        }
      },
      channelId: CH,
      broadcasterId: '0',
      executorId: 'lab-simulator',
      login: 'lecroupier_simule',
      botScopes: [
        'moderator:read:chatters',
        'moderator:read:followers',
        'moderator:manage:banned_users',
      ],
      broadcasterScopes: ['moderation:read', 'channel:read:subscriptions'],
      twitch: labFakeTwitch(bans),
      journal: memoryRbJournal(),
      pause: async () => {},
      log: () => {},
    });
    // The executor says it is there (its first poll), then the viewer buys.
    await rb.claim(CH, {
      executor_id: 'lab-simulator',
      login: 'lecroupier_simule',
      can_search: true,
      can_timeout: true,
      missing: [],
    });
    const bought = await core.modules.viewer(CH, 'random_ban_e2e', 'launch', {
      viewer: V,
      idempotency_key: 'intent-e2e-0001',
      input: { expected_price: 25_000 },
    });
    expect(bought.replayed).toBe(false);
    // Let the real executor work until the request ends.
    const run = executor.run();
    for (let i = 0; i < 100; i++) {
      const s = await rb.buyerState(CH, V.id);
      if (
        s.mine[0]?.status !== 'queued' &&
        s.mine[0]?.status !== 'searching' &&
        s.mine[0]?.status !== 'timeout_requested'
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    executor.stop();
    await run.catch(() => {});
    const s = await rb.buyerState(CH, V.id);
    expect(s.mine[0]).toMatchObject({
      source: 'extension',
      status: 'confirmed',
      price_paid: 25_000,
    });
    expect(bans).toHaveLength(1);
    const target = s.mine[0]!.target!;
    expect([...LAB_CHATTERS.map((c) => c.id), V.id]).toContain(target.id);
    expect(bans[0]!.userId).toBe(target.id);
    expect(s.price).toBe(25_000);
    expect(s.charges).toMatchObject({ available: 2, max: 3 });
  }, 30_000);

  it('Le Viseur + Sniper, end to end: the reel plays BEFORE the strike, then the ban video; a hit pays once', async () => {
    const core = await setup();
    const rb = new RandomBanService(core.db, core.clock);
    rb.economy = core.economy;
    rb.pricing = core.randomBan.pricing;
    // The Lab's fictional chatters are the ones present; the fake Twitch « draws » among the same ones.
    rb.candidates = async () => LAB_CHATTERS.map((c) => ({ ...c }));
    core.modules.add({ ...randomBanExtModule(rb), id: 'random_ban_e2e' });
    await core.moduleSettings.set(CH, 'random_ban_e2e.enabled', 1, 'test');
    await core.moduleSettings.set(CH, 'random_ban.sequence', 1, 'test');
    await editWallet(
      core.db,
      core.clock.now(),
      CH,
      V.id,
      'set',
      { tokens: 100_000 },
      'test',
    );
    const call = internalLabCall(randomBanRoutes(rb));
    const events: string[] = [];
    const bans: { userId: string; durationS: number }[] = [];
    const twitch = labFakeTwitch(bans);
    const executor = createRandomBanExecutor({
      core: async (path, body) => {
        try {
          return { status: 200, body: await call(path, body) };
        } catch (e) {
          const err = e as { status?: number; body?: unknown };
          return { status: err.status ?? 500, body: err.body ?? {} };
        }
      },
      channelId: CH,
      broadcasterId: '0',
      executorId: 'lab-simulator',
      login: 'lecroupier_simule',
      botScopes: [
        'moderator:read:chatters',
        'moderator:read:followers',
        'moderator:manage:banned_users',
      ],
      broadcasterScopes: ['moderation:read', 'channel:read:subscriptions'],
      // Only Kiwi in the chat: the draw is certain (the wished one), the test is not about luck.
      twitch: {
        ...twitch,
        chattersPage: async () => ({
          chatters: [LAB_CHATTERS[0]!],
          cursor: null,
        }),
        ban: async (id, s, reason) => {
          events.push('ban');
          await twitch.ban(id, s, reason);
        },
      },
      journal: memoryRbJournal(),
      // The strike delay: Studio plays the reel meanwhile (its own poll, here by hand).
      pause: async (ms) => {
        events.push(`pause:${ms}`);
        const a = (await rb.claimAnimation(CH, 'studio-e2e')).animation as {
          animation?: string;
          request_id?: string;
        } | null;
        if (a?.animation) events.push(a.animation);
        if (a?.request_id)
          await rb.reportAnimation(a.request_id, {
            consumer_id: 'studio-e2e',
            event: 'completed',
          });
      },
      log: () => {},
    });
    await rb.claimMute(CH, {
      consumer_id: 'studio-e2e',
      obs_ready: false,
      mic_held: false,
    });
    await rb.claim(CH, {
      executor_id: 'lab-simulator',
      login: 'x',
      can_search: true,
      can_timeout: true,
      missing: [],
    });
    await core.modules.viewer(CH, 'random_ban_e2e', 'launch', {
      viewer: V,
      idempotency_key: 'intent-e2e-viseur',
      input: { expected_price: 25_000, wish_id: LAB_CHATTERS[0]!.id },
    });
    const run = executor.run();
    for (
      let i = 0;
      i < 200 &&
      !(await rb.buyerState(CH, V.id)).mine[0]?.status.match(
        /confirmed|failed|flop|uncertain/,
      );
      i++
    )
      await new Promise((r) => setTimeout(r, 20));
    executor.stop();
    await run.catch(() => {});
    expect(events).toEqual([`pause:${7_500}`, 'reel', 'ban']);
    const video = (await rb.claimAnimation(CH, 'studio-e2e')).animation;
    expect(video).toMatchObject({ banned: 'Kiwi', trigger: 'Alice' });
    const s = await rb.buyerState(CH, V.id);
    expect(s.mine[0]).toMatchObject({
      status: 'confirmed',
      sniper: 'hit',
      sniper_bonus: 2_000,
    });
    expect(s.stats).toMatchObject({
      earned: 2_000,
      spent: 25_000,
      sniper_hits: 1,
    });
  }, 30_000);
});
