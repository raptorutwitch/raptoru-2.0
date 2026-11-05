import { randomUUID } from 'node:crypto';
import type { CpRedemptionInput } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import {
  ChannelPointsService,
  CP_RULES,
} from '../src/channel-points/service.js';
import { CpTwitchActions } from '../src/channel-points/twitch-actions.js';
import { setup } from './helpers.js';

// Refonte H2 (decided 05/11): a channel-point OBS job not started 2 min after its reception expires, is never run
// afterwards, and its redemption is refunded ONCE on Twitch only when nothing of it took effect and the reward is
// Raptoru's. Fictional channel / rewards / viewers.

const CH = '900777';
const REWARD = '11111111-2222-4333-8444-555555555555';
const T0 = new Date('2026-11-05T20:00:00Z');

async function fixture(opts: { managed?: boolean; credits?: boolean } = {}) {
  const core = await setup();
  core.clock.set(T0);
  const twitch = new CpTwitchActions(core.db, core.clock);
  const cp = new ChannelPointsService(
    core.db,
    core.clock,
    core.soundLab,
    undefined,
    undefined,
    undefined,
    twitch,
  );
  await cp.syncRewards({
    channel_id: CH,
    rewards: [
      { id: REWARD, title: 'Scène fictive', cost: 500, is_enabled: true },
    ],
  });
  if (opts.managed)
    await core.db.query(
      'update cp_rewards set managed_by_raptoru = true where channel_id = $1',
      [CH],
    );
  await cp.saveRule(CH, REWARD, {
    enabled: true,
    actions: [
      ...(opts.credits
        ? [
            {
              type: 'credits' as const,
              currency: 'credits_tts' as const,
              amount: 1,
            },
          ]
        : []),
      { type: 'obs_scene', scene: 'Fictive', duration_ms: 3000 },
    ],
  });
  await cp.setEnabled(CH, true, 'test');
  const redeem = (over: Partial<CpRedemptionInput> = {}) =>
    cp.receive({
      channel_id: CH,
      source: 'twitch',
      redemption_id: randomUUID(),
      reward: { id: REWARD, title: 'Scène fictive', cost: 500 },
      user: { id: '9001', login: 'fictif', display_name: 'Fictif' },
      user_input: '',
      twitch_status: 'unfulfilled',
      redeemed_at: core.clock.now().toISOString(),
      ...over,
    });
  const refunds = () =>
    core.db.query<{ payload: { status: string; redemption_id: string } }>(
      "select payload from cp_twitch_actions where kind = 'redemption_status'",
    );
  return { core, cp, redeem, refunds };
}

const last = async (cp: ChannelPointsService) =>
  (await cp.state(CH)).recent[0]!;

describe('Points de chaîne — expired OBS jobs (H2)', () => {
  it('Studio absent 2 min: expired, never handed out later; refund asked once (managed reward)', async () => {
    const t = await fixture({ managed: true });
    const e = await t.redeem();
    t.core.clock.advance(CP_RULES.queuedMaxMs + 1);
    expect(await t.cp.claim(CH, 'studio-1')).toBeNull();
    expect(await last(t.cp)).toMatchObject({
      status: 'failed',
      results: [
        {
          status: 'failed',
          error:
            'expiré : Studio absent pendant plus de 2 min — remboursement demandé à Twitch',
        },
      ],
    });
    expect(await t.refunds()).toEqual([
      {
        payload: {
          reward_id: REWARD,
          redemption_id: e.redemption.redemption_id,
          status: 'CANCELED',
        },
      },
    ]);
    // Replays (claims, reads, a redelivered redemption): no second refund, no job.
    await t.cp.claim(CH, 'studio-1');
    await t.cp.state(CH);
    await t.redeem({ redemption_id: e.redemption.redemption_id });
    expect(await t.refunds()).toHaveLength(1);
    expect(await t.cp.claim(CH, 'studio-1')).toBeNull();
  });

  it('within 2 min: run normally; a started job is never expired nor refunded', async () => {
    const t = await fixture({ managed: true });
    await t.redeem();
    t.core.clock.advance(CP_RULES.queuedMaxMs - 1_000);
    const job = (await t.cp.claim(CH, 'studio-1'))!;
    expect(job).not.toBeNull();
    await t.cp.ack(job.job_id, {
      consumer_id: 'studio-1',
      attempt_id: job.attempt_id,
      event: 'started',
    });
    t.core.clock.advance(CP_RULES.queuedMaxMs);
    await t.cp.state(CH);
    expect(await t.refunds()).toEqual([]);
    expect((await last(t.cp)).results[0]!.error ?? '').not.toContain('expiré');
  });

  it('not Raptoru’s reward: expired, said non refundable, nothing asked to Twitch', async () => {
    const t = await fixture();
    await t.redeem();
    t.core.clock.advance(CP_RULES.queuedMaxMs + 1);
    expect((await last(t.cp)).results[0]).toMatchObject({
      error:
        'expiré : Studio absent pendant plus de 2 min — non remboursable (récompense non créée par Raptoru)',
    });
    expect(await t.refunds()).toEqual([]);
  });

  it('credits already granted with the redemption: the OBS part expires, no refund (the viewer got something)', async () => {
    const t = await fixture({ managed: true, credits: true });
    await t.redeem();
    t.core.clock.advance(CP_RULES.queuedMaxMs + 1);
    const r = await last(t.cp);
    expect(r.results[0]).toMatchObject({ status: 'done' });
    expect(r.results[1]!.error).toContain(
      'non remboursé (une autre action a eu lieu)',
    );
    expect(await t.refunds()).toEqual([]);
  });

  it('claimed then never started (OBS / player not ready), past 2 min: « n’a pas pu le lancer »', async () => {
    const t = await fixture();
    await t.redeem();
    expect(await t.cp.claim(CH, 'studio-1')).not.toBeNull();
    t.core.clock.advance(CP_RULES.claimLeaseMs + 1);
    t.core.clock.advance(CP_RULES.queuedMaxMs);
    expect(await t.cp.claim(CH, 'studio-1')).toBeNull();
    expect((await last(t.cp)).results[0]!.error).toContain(
      'Studio n’a pas pu le lancer en 2 min',
    );
  });

  it('race: a claim and a history read at the expiry instant — claimed or expired, never both', async () => {
    const t = await fixture({ managed: true });
    await t.redeem();
    t.core.clock.advance(CP_RULES.queuedMaxMs + 1);
    const [claimed] = await Promise.all([
      t.cp.claim(CH, 'studio-1'),
      t.cp.state(CH),
      t.cp.claim(CH, 'studio-2'),
    ]);
    expect(claimed).toBeNull();
    expect(await t.refunds()).toHaveLength(1);
  });
});
