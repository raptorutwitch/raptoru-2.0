import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ChannelPointsService } from '../src/channel-points/service.js';
import { CpTwitchActions } from '../src/channel-points/twitch-actions.js';
import { RandomBanService } from '../src/random-ban/service.js';
import { setup } from './helpers.js';

// Random Ban by channel points (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 3, decided 12/11/2026): fixed price on Twitch,
// a PERSONAL cooldown of 10 min checked by Core — a redemption under it creates no Random Ban, its points go back once
// (CANCELED) when the reward is Raptoru's, and the chat says « remboursés » only after Twitch's answer.

const CH = '83603689';
const EXEC = {
  executor_id: 'bot-1',
  login: 'lecroupier_',
  can_search: true,
  can_timeout: true,
  missing: [],
};
const KIWI = { id: '9001', login: 'kiwi', display_name: 'Kiwi' };
const BOB = { id: '9002', login: 'bob', display_name: 'Bob' };

async function fixture(o: { managed: boolean }) {
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
      { id: 'reward-rb', title: 'Random Ban', cost: 3000, is_enabled: true },
    ],
  });
  if (o.managed)
    await core.db.query(
      `update cp_rewards set managed_by_raptoru = true where reward_id = 'reward-rb'`,
    );
  await cp.saveRule(CH, 'reward-rb', {
    enabled: true,
    actions: [{ type: 'interaction', interaction: 'random_ban' }],
  });
  await cp.setEnabled(CH, true, 'test');
  const redeem = (user = KIWI) =>
    cp.receive({
      channel_id: CH,
      source: 'twitch',
      redemption_id: randomUUID(),
      reward: { id: 'reward-rb', title: 'Random Ban', cost: 3000 },
      user,
      twitch_status: 'unfulfilled',
      redeemed_at: core.clock.now().toISOString(),
    });
  /** The executor confirms every queued request (nothing left open). */
  const drain = async () => {
    for (;;) {
      const c = (await rb.claim(CH, EXEC)).request;
      if (!c) return;
      await rb.target(c.request_id, {
        executor_id: EXEC.executor_id,
        attempt_id: c.attempt_id,
        target: { id: '9100', login: 'zed', name: 'Zed' },
        is_sub: false,
        stats: { chatters: 10, candidates: 5, follow_checks: 1 },
      });
      await rb.result(c.request_id, {
        executor_id: EXEC.executor_id,
        attempt_id: c.attempt_id,
        event: 'confirmed',
      });
    }
  };
  const requests = async (buyer = KIWI.id) =>
    (
      await core.db.query<{ n: string }>(
        `select count(*) as n from rb_requests where buyer_id = $1`,
        [buyer],
      )
    ).map((r) => Number(r.n))[0];
  const cancels = () =>
    core.db.query<{ action_id: string; payload: { redemption_id: string } }>(
      `select action_id, payload from cp_twitch_actions where kind = 'redemption_status'`,
    );
  const chat = async () =>
    (
      await core.db.query<{ params: { text: string } }>(
        `select params from cmd_steps where idempotency_key like 'rb:cp-%' order by seq_global`,
      )
    ).map((r) => r.params.text);
  return { core, rb, cp, twitch, redeem, drain, requests, cancels, chat };
}

describe('channel points Random Ban — personal cooldown', () => {
  it('Raptoru reward: under cooldown → no Random Ban, one CANCELED asked, the chat told only after Twitch answered', async () => {
    const f = await fixture({ managed: true });
    await f.redeem();
    await f.drain();
    f.core.clock.advance(3 * 60_000 + 36_000);
    const second = await f.redeem();
    expect(await f.requests()).toBe(1);
    expect(second.redemption.results[0]).toMatchObject({
      status: 'failed',
      error:
        'Random Ban : délai personnel (encore 6 min 24 s) · remboursement demandé à Twitch',
    });
    const asked = await f.cancels();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.payload.redemption_id).toBe(
      second.redemption.redemption_id,
    );
    expect(await f.chat()).toEqual([]); // nothing promised before Twitch
    // The bot runs the CANCELED; Twitch accepts it.
    const { action } = await f.twitch.claim(CH);
    await f.twitch.report(CH, action!.action_id, {
      attempt_id: action!.attempt_id,
      outcome: 'done',
    });
    expect(await f.chat()).toEqual([
      '@Kiwi - Random Ban indisponible pour toi : encore 6 min 24 s avant ton prochain tirage. Tes points de chaîne ont été remboursés.',
    ]);
  });

  it('Twitch refuses the refund: the chat says a moderator will do it (never « remboursés »)', async () => {
    const f = await fixture({ managed: true });
    await f.redeem();
    await f.drain();
    await f.redeem();
    const { action } = await f.twitch.claim(CH);
    await f.twitch.report(CH, action!.action_id, {
      attempt_id: action!.attempt_id,
      outcome: 'failed',
      http_status: 400,
    });
    expect(await f.chat()).toEqual([
      '@Kiwi - Random Ban indisponible pour toi : encore 10 min avant ton prochain tirage. Tes points n’ont pas pu être remboursés automatiquement : un modérateur va le faire.',
    ]);
  });

  it('the old reward (not created by Raptoru): refused, no refund asked nor promised', async () => {
    const f = await fixture({ managed: false });
    await f.redeem();
    await f.drain();
    const second = await f.redeem();
    expect(await f.cancels()).toEqual([]);
    expect(second.redemption.results[0]!.error).toContain(
      'à rembourser à la main',
    );
    expect(await f.chat()).toEqual([
      '@Kiwi - Random Ban indisponible pour toi : encore 10 min avant ton prochain tirage. Un modérateur peut te rembourser tes points depuis Twitch.',
    ]);
  });

  it('personal: another viewer is never held; after 10 min Kiwi plays again', async () => {
    const f = await fixture({ managed: true });
    await f.redeem();
    await f.drain();
    await f.redeem(BOB);
    expect(await f.requests(BOB.id)).toBe(1);
    await f.drain();
    f.core.clock.advance(10 * 60_000);
    await f.redeem();
    expect(await f.requests()).toBe(2);
    expect(await f.cancels()).toEqual([]);
  });

  it('a Random Ban that did nothing (failed, refunded) never holds the cooldown', async () => {
    const f = await fixture({ managed: true });
    await f.redeem();
    // The executor cannot time out: the request fails, nothing done.
    await f.rb.claim(CH, { ...EXEC, can_timeout: false, missing: ['x'] });
    await f.redeem();
    expect(await f.requests()).toBe(2);
  });

  it('the same redemption delivered twice: one Random Ban, never refused by its own cooldown', async () => {
    const f = await fixture({ managed: true });
    const e = {
      channel_id: CH,
      source: 'twitch' as const,
      redemption_id: randomUUID(),
      reward: { id: 'reward-rb', title: 'Random Ban', cost: 3000 },
      user: KIWI,
      twitch_status: 'unfulfilled' as const,
      redeemed_at: f.core.clock.now().toISOString(),
    };
    await f.cp.receive(e);
    expect((await f.cp.receive(e)).outcome).toBe('duplicate');
    expect(await f.requests()).toBe(1);
    expect(await f.cancels()).toEqual([]);
  });
});

describe('channel points Random Ban — a Random Ban that did nothing gives the points back', () => {
  it('Raptoru reward: CANCELED asked once, « remboursés » only after Twitch accepted', async () => {
    const f = await fixture({ managed: true });
    const r = await f.redeem();
    // The executor cannot time out: failed, nothing done.
    await f.rb.claim(CH, { ...EXEC, can_timeout: false, missing: ['x'] });
    const asked = await f.cancels();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.payload.redemption_id).toBe(r.redemption.redemption_id);
    const state = await f.cp.state(CH);
    expect(state.recent[0]!.results[0]!.error).toContain(
      'remboursement des points demandé à Twitch',
    );
    expect(await f.chat()).toEqual([]);
    await f.cp.state(CH); // a second settle pass changes nothing
    expect(await f.cancels()).toHaveLength(1);
    const { action } = await f.twitch.claim(CH);
    await f.twitch.report(CH, action!.action_id, {
      attempt_id: action!.attempt_id,
      outcome: 'done',
    });
    expect(await f.chat()).toEqual([
      '@Kiwi - Random Ban impossible pour le moment. Tes points de chaîne ont été remboursés.',
    ]);
  });

  it('the old reward: nothing asked, the history still says a refund is owed', async () => {
    const f = await fixture({ managed: false });
    await f.redeem();
    await f.rb.claim(CH, { ...EXEC, can_timeout: false, missing: ['x'] });
    expect(await f.cancels()).toEqual([]);
    const state = await f.cp.state(CH);
    expect(state.recent[0]!.results[0]!.error).toContain(
      'remboursement nécessaire',
    );
  });
});
