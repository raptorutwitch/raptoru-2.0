import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ChannelPointsService } from '../src/channel-points/service.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { CpTwitchActions } from '../src/channel-points/twitch-actions.js';
import { internalLabCall } from '../src/ext/lab-internal.js';
import { channelPointsRoutes } from '../src/http/channel-points-routes.js';
import { RandomBanService } from '../src/random-ban/service.js';
import { setup } from './helpers.js';

// Points de chaîne — Studio administers the rewards (docs/mini-jeux/RECOMPENSES_TWITCH.md): Twitch says which rewards
// Raptoru's app may manage; Studio creates one (a migration copies the old rule OFF), pauses / resumes it, refunds a
// redemption of it — each a Twitch action the bot runs once. Never on a reward Raptoru does not own.

const CH = '83603689';
const OLD = 'b15cc303-old-ban-aleatoire';
const KIWI = { id: '9001', login: 'kiwi', display_name: 'Kiwi' };

async function fixture() {
  const core = await setup();
  core.clock.set(new Date('2026-11-12T20:00:00Z'));
  const rb = new RandomBanService(core.db, core.clock);
  const twitch = new CpTwitchActions(core.db, core.clock);
  const cp = new ChannelPointsService(
    core.db,
    core.clock,
    core.soundLab,
    rb,
    undefined,
    undefined,
    twitch,
  );
  await cp.syncRewards({
    channel_id: CH,
    rewards: [
      {
        id: OLD,
        title: 'Ban aléatoire',
        cost: 3000,
        is_enabled: true,
        manageable: false,
      },
    ],
  });
  await cp.saveRule(CH, OLD, {
    enabled: true,
    actions: [{ type: 'interaction', interaction: 'random_ban' }],
  });
  await cp.setEnabled(CH, true, 'test');
  /** The bot runs the next Twitch action; Twitch answers `outcome` (and the new reward's id). */
  const bot = async (
    outcome: 'done' | 'failed' = 'done',
    reward_id?: string,
  ) => {
    const { action } = await twitch.claim(CH);
    if (!action) return null;
    await twitch.report(CH, action.action_id, {
      attempt_id: action.attempt_id,
      outcome,
      ...(reward_id ? { reward_id } : {}),
      ...(outcome === 'failed' ? { http_status: 403, error: 'forbidden' } : {}),
    });
    return action;
  };
  const reward = async (id: string) =>
    (await cp.rewards(CH)).find((r) => r.id === id);
  const redeem = (rewardId: string, title: string, user = KIWI) =>
    cp.receive({
      channel_id: CH,
      source: 'twitch',
      redemption_id: randomUUID(),
      reward: { id: rewardId, title, cost: 3000 },
      user,
      twitch_status: 'unfulfilled',
      redeemed_at: core.clock.now().toISOString(),
    });
  const rbCount = async () =>
    Number(
      (
        await core.db.query<{ n: string }>(
          'select count(*) as n from rb_requests',
        )
      )[0]!.n,
    );
  return { core, cp, twitch, rb, bot, reward, redeem, rbCount };
}

describe('reward administration from Studio', () => {
  it('Twitch says what Raptoru may manage; an older bot (no answer) keeps what the Core knew', async () => {
    const f = await fixture();
    expect(await f.reward(OLD)).toMatchObject({ managed: false, paused: null });
    await f.cp.syncRewards({
      channel_id: CH,
      rewards: [
        {
          id: OLD,
          title: 'Ban aléatoire',
          cost: 3000,
          is_enabled: true,
          is_paused: true,
          manageable: true,
        },
      ],
    });
    expect(await f.reward(OLD)).toMatchObject({
      managed: true,
      paused: true,
      twitch_enabled: false,
    });
    await f.cp.syncRewards({
      channel_id: CH,
      rewards: [
        { id: OLD, title: 'Ban aléatoire', cost: 3000, is_enabled: true },
      ],
    });
    expect(await f.reward(OLD)).toMatchObject({ managed: true });
  });

  it('migration: a new Raptoru reward, the old rule copied OFF onto it (no double trigger), the old one untouched', async () => {
    const f = await fixture();
    // Twitch refuses a title already used on the channel: said before asking it.
    await expect(
      f.cp.createManagedReward(CH, {
        title: 'ban ALÉATOIRE',
        cost: 3000,
        prompt: '',
        user_input: false,
      }),
    ).rejects.toMatchObject({ code: 'reward_title_taken' });
    await f.cp.createManagedReward(CH, {
      title: 'Random Ban',
      cost: 3000,
      prompt: 'Un viewer du chat est exclu au hasard (toi compris).',
      user_input: false,
      migrated_from: OLD,
    });
    // One creation at a time.
    await expect(
      f.cp.createManagedReward(CH, {
        title: 'Autre',
        cost: 10,
        prompt: '',
        user_input: false,
      }),
    ).rejects.toMatchObject({ code: 'reward_create_in_progress' });
    const a = await f.bot('done', 'new-rb-reward');
    expect(a).toMatchObject({
      kind: 'reward_create',
      reward: { title: 'Random Ban', cost: 3000 },
    });
    expect(await f.reward('new-rb-reward')).toMatchObject({
      managed: true,
      migrated_from: OLD,
      rule: {
        enabled: false,
        actions: [{ type: 'interaction', interaction: 'random_ban' }],
      },
    });
    expect((await f.reward(OLD))!.rule).toMatchObject({ enabled: true });
    // While the new rule is OFF, its redemptions run nothing; the old reward still works (one Random Ban each, never two).
    await f.redeem('new-rb-reward', 'Random Ban');
    expect(await f.rbCount()).toBe(0);
    await f.redeem(OLD, 'Ban aléatoire');
    expect(await f.rbCount()).toBe(1);
  });

  it('pause / resume a reward Raptoru owns (one change in flight); never a reward it does not own', async () => {
    const f = await fixture();
    await expect(
      f.cp.updateManagedReward(CH, OLD, { is_paused: true }),
    ).rejects.toMatchObject({
      code: 'reward_not_managed',
    });
    await f.cp.createManagedReward(CH, {
      title: 'Random Ban',
      cost: 3000,
      prompt: '',
      user_input: false,
    });
    await f.bot('done', 'new-rb-reward');
    await f.cp.updateManagedReward(CH, 'new-rb-reward', { is_paused: true });
    await expect(
      f.cp.updateManagedReward(CH, 'new-rb-reward', { is_paused: false }),
    ).rejects.toMatchObject({
      code: 'reward_update_in_progress',
    });
    const a = await f.bot();
    expect(a).toMatchObject({
      kind: 'reward_update',
      reward_id: 'new-rb-reward',
      patch: { is_paused: true },
    });
    expect(await f.reward('new-rb-reward')).toMatchObject({
      paused: true,
      twitch_enabled: false,
    });
    await f.cp.updateManagedReward(CH, 'new-rb-reward', {
      is_paused: false,
      cost: 3500,
    });
    await f.bot();
    expect(await f.reward('new-rb-reward')).toMatchObject({
      paused: false,
      twitch_enabled: true,
      cost: 3500,
    });
    // Twitch refuses a change (403): nothing changes in the Core, the action stays « failed » (shown in À traiter).
    await f.cp.updateManagedReward(CH, 'new-rb-reward', { is_paused: true });
    await f.bot('failed');
    expect(await f.reward('new-rb-reward')).toMatchObject({ paused: false });
    expect((await f.cp.attention(CH)).twitch_actions).toMatchObject([
      { kind: 'reward_update', status: 'failed' },
    ]);
  });

  it('refund one redemption by hand: a reward Raptoru owns only, once (CANCELED key), never a simulation', async () => {
    const f = await fixture();
    await f.cp.createManagedReward(CH, {
      title: 'Random Ban',
      cost: 3000,
      prompt: '',
      user_input: false,
    });
    await f.bot('done', 'new-rb-reward');
    const old = await f.redeem(OLD, 'Ban aléatoire');
    await expect(
      f.cp.refundRedemption(CH, 'twitch', old.redemption.redemption_id),
    ).rejects.toMatchObject({
      code: 'reward_not_managed',
    });
    const r = await f.redeem('new-rb-reward', 'Random Ban');
    expect(
      (await f.cp.refundRedemption(CH, 'twitch', r.redemption.redemption_id))
        .status,
    ).toBe('queued');
    expect(
      (await f.cp.refundRedemption(CH, 'twitch', r.redemption.redemption_id))
        .status,
    ).toBe('exists');
    const a = await f.bot();
    expect(a).toMatchObject({
      kind: 'redemption_status',
      status: 'CANCELED',
      redemption_id: r.redemption.redemption_id,
    });
    expect(await f.bot()).toBeNull(); // nothing more: one refund
  });

  it('À traiter: a redemption of the OLD reward refused (cooldown) — its points to give back by hand', async () => {
    const f = await fixture();
    await f.redeem(OLD, 'Ban aléatoire');
    await f.redeem(OLD, 'Ban aléatoire'); // within the personal 10 min: refused, not refundable by Raptoru
    const att = await f.cp.attention(CH);
    expect(att.hand_refunds).toHaveLength(1);
    expect(att.hand_refunds[0]!.results[0]!.error).toContain(
      'à rembourser à la main',
    );
  });

  it('the Studio routes (Lab door): create, change, refund — with the readable refusals', async () => {
    const f = await fixture();
    const call = internalLabCall(channelPointsRoutes(f.cp));
    await expect(
      call(`/v1/lab/channel-points/${CH}/rewards/${OLD}/twitch`, {
        patch: { is_paused: true },
      }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'reward_not_managed' },
    });
    await expect(
      call(`/v1/lab/channel-points/${CH}/rewards/${OLD}/twitch`, { patch: {} }),
    ).rejects.toMatchObject({
      status: 400,
    });
    const out = await call<{ action_id: string }>(
      `/v1/lab/channel-points/${CH}/rewards`,
      {
        title: 'Random Ban',
        cost: 3000,
        migrated_from: OLD,
      },
    );
    expect(out.action_id).toMatch(/^[0-9a-f-]{36}$/);
    const state = await call<{
      twitch_actions: { kind: string; status: string }[];
    }>(`/v1/lab/channel-points/${CH}/state`);
    expect(state.twitch_actions[0]).toMatchObject({
      kind: 'reward_create',
      status: 'queued',
    });
  });

  it('the controlled refund test (migration step 5): the NEW reward redeemed off-live → no Random Ban, one CANCELED', async () => {
    const f = await fixture();
    // The Production economy: the canonical live decides (no stream open here).
    const cp = new ChannelPointsService(
      f.core.db,
      f.core.clock,
      f.core.soundLab,
      f.rb,
      coreWalletEconomy(f.core.wallet.wallet),
      undefined,
      f.twitch,
    );
    await cp.createManagedReward(CH, {
      title: 'Random Ban',
      cost: 3000,
      prompt: '',
      user_input: false,
      migrated_from: OLD,
    });
    await f.bot('done', 'new-rb-reward');
    await cp.saveRule(CH, 'new-rb-reward', {
      enabled: true,
      actions: [{ type: 'interaction', interaction: 'random_ban' }],
      expected_version: 1,
    } as never);
    const r = await cp.receive({
      channel_id: CH,
      source: 'twitch',
      redemption_id: randomUUID(),
      reward: { id: 'new-rb-reward', title: 'Random Ban', cost: 3000 },
      user: { id: '83603689', login: 'raptoru_', display_name: 'raptoru_' },
      twitch_status: 'unfulfilled',
      redeemed_at: f.core.clock.now().toISOString(),
    });
    expect(r.redemption).toMatchObject({ reason: 'stream_offline' });
    expect(await f.rbCount()).toBe(0);
    const a = await f.bot();
    expect(a).toMatchObject({
      kind: 'redemption_status',
      status: 'CANCELED',
      redemption_id: r.redemption.redemption_id,
    });
  });
});
