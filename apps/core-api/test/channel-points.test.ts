import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { CpRedemptionInput } from '@raptoru/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ChannelPointsService,
  CP_RULES,
} from '../src/channel-points/service.js';
import { createApp } from '../src/http/server.js';
import { sha256, STUDIO_PROTOCOL_HEADER } from '../src/studio/installations.js';
import { setup, type TestCore } from './helpers.js';

// Points de chaîne V1 (docs/CHANNEL_POINTS_V1.md): reception (dedup by Twitch redemption id), master switch OFF by
// default, rules, sounds through the Soundboard queue (paid by channel points: no wallet debit, never refundable),
// OBS jobs for Studio (one in flight, lease, never replayed once started), production routes.

const CH = '83603689';
const REWARD = '92af127c-7326-4483-a52b-b0da0be61c01';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function fixture() {
  const core = await setup();
  core.clock.set(new Date('2026-10-17T20:00:00Z'));
  const cp = new ChannelPointsService(core.db, core.clock, core.soundLab);
  await cp.syncRewards({
    channel_id: CH,
    rewards: [
      { id: REWARD, title: 'Eren cri', cost: 500, is_enabled: true },
      { id: 'reward-creepy', title: 'Creepy', cost: 2000, is_enabled: true },
    ],
  });
  return { core, cp };
}

const redemption = (
  core: TestCore,
  over: Partial<CpRedemptionInput> = {},
): CpRedemptionInput => ({
  channel_id: CH,
  source: 'twitch',
  redemption_id: randomUUID(),
  reward: { id: REWARD, title: 'Eren cri', cost: 500 },
  user: { id: '9001', login: 'cooler_user', display_name: 'Cooler_User' },
  user_input: '',
  twitch_status: 'unfulfilled',
  redeemed_at: core.clock.now().toISOString(),
  ...over,
});

const soundReady = (core: TestCore) =>
  core.soundLab.heartbeat({
    studio_instance_id: 'studio-1',
    player_ready: true,
  });

describe('Points de chaîne — reception and decisions', () => {
  it('master switch OFF by default: a real redemption is recorded, never executed; known reward kept', async () => {
    const { core, cp } = await fixture();
    expect(await cp.settings(CH)).toMatchObject({ enabled: false });
    await cp.saveRule(CH, REWARD, {
      enabled: true,
      actions: [{ type: 'sound', sound_id: 'random' }],
    });
    const out = await cp.receive(redemption(core));
    expect(out).toMatchObject({
      outcome: 'ignored',
      redemption: { status: 'ignored', reason: 'automations_off', actions: [] },
    });
    expect(
      await core.db.query('select 1 from sound_lab_interactions'),
    ).toHaveLength(0);
  });

  it('dedup by Twitch redemption id: a redelivery / reconnection changes nothing and answers the first decision', async () => {
    const { core, cp } = await fixture();
    await cp.setEnabled(CH, true, 'test');
    await soundReady(core);
    await cp.saveRule(CH, REWARD, {
      enabled: true,
      actions: [{ type: 'sound', sound_id: 'random' }],
    });
    const e = redemption(core);
    // Admitted in the Soundboard, not yet played: pending.
    expect((await cp.receive(e)).outcome).toBe('pending');
    const again = await cp.receive(e);
    expect(again.outcome).toBe('duplicate');
    expect(
      await core.db.query('select 1 from sound_lab_interactions'),
    ).toHaveLength(1);
  });

  it('no rule, disabled rule, late redemption: ignored with the reason; title never used as a key', async () => {
    const { core, cp } = await fixture();
    await cp.setEnabled(CH, true, 'test');
    expect(
      (
        await cp.receive(
          redemption(core, {
            reward: { id: 'reward-creepy', title: 'Eren cri', cost: 1 },
          }),
        )
      ).redemption.reason,
    ).toBe('no_rule');
    await cp.saveRule(CH, REWARD, {
      enabled: false,
      actions: [{ type: 'sound', sound_id: 'random' }],
    });
    expect((await cp.receive(redemption(core))).redemption.reason).toBe(
      'rule_disabled',
    );
    const v = (await cp.rewards(CH)).find((r) => r.id === REWARD)!.rule!
      .version;
    await cp.saveRule(CH, REWARD, {
      enabled: true,
      actions: [{ type: 'sound', sound_id: 'random' }],
      expected_version: v,
    });
    const old = new Date(core.clock.now().getTime() - CP_RULES.maxAgeMs - 1000);
    expect(
      (await cp.receive(redemption(core, { redeemed_at: old.toISOString() })))
        .redemption.reason,
    ).toBe('late');
  });

  it('sound: queued in the Soundboard for the redeemer, paid by channel points (no debit, not refundable); unready player = failed action', async () => {
    const { core, cp } = await fixture();
    await cp.setEnabled(CH, true, 'test');
    await cp.saveRule(CH, REWARD, {
      enabled: true,
      actions: [{ type: 'sound', sound_id: 'random' }],
    });
    const failed = await cp.receive(redemption(core));
    expect(failed.redemption).toMatchObject({
      status: 'failed',
      results: [
        { index: 0, type: 'sound', status: 'failed', error: 'studio_offline' },
      ],
    });
    await soundReady(core);
    const ok = await cp.receive(redemption(core));
    // Admitted is NOT played: pending (« en file ») until the Soundboard player reports the end.
    expect(ok.redemption).toMatchObject({
      status: 'pending',
      results: [
        { index: 0, type: 'sound', status: 'pending', progress: 'queued' },
      ],
    });
    const stateOf = async () =>
      (await cp.state(CH)).recent.find(
        (r) => r.redemption_id === ok.redemption.redemption_id,
      )!;
    const played = (await core.soundLab.claim('studio-1', CH))!;
    const ackSound = (event: 'started' | 'completed' | 'failed') =>
      core.soundLab.ack(played.interaction_id, {
        studio_instance_id: 'studio-1',
        attempt_id: played.delivery.attempt_id!,
        event,
        ...(event === 'failed'
          ? { error: { code: 'audio_error', message: 'x', retryable: false } }
          : {}),
      } as never);
    await ackSound('started');
    expect(await stateOf()).toMatchObject({
      status: 'pending',
      results: [{ status: 'pending', progress: 'playing' }],
    });
    await ackSound('completed');
    expect(await stateOf()).toMatchObject({
      status: 'done',
      results: [{ status: 'done' }],
    });
    // The player reports a failure: the action fails with the player's reason.
    const bad = await cp.receive(redemption(core));
    const second = (await core.soundLab.claim('studio-1', CH))!;
    await core.soundLab.ack(second.interaction_id, {
      studio_instance_id: 'studio-1',
      attempt_id: second.delivery.attempt_id!,
      event: 'failed',
      error: {
        code: 'audio_error',
        message: 'decode failed',
        retryable: false,
      },
    } as never);
    expect(
      (await cp.state(CH)).recent.find(
        (r) => r.redemption_id === bad.redemption.redemption_id,
      ),
    ).toMatchObject({
      status: 'failed',
      results: [{ status: 'failed', error: 'audio_error' }],
    });
    const row = (
      await core.db.query<{
        source: string;
        payment_method: string;
        simulated_cost: number;
        viewer_id: string;
      }>(
        'select source, payment_method, simulated_cost, viewer_id from sound_lab_interactions',
      )
    )[0]!;
    expect(row).toEqual({
      source: 'channel_points',
      payment_method: 'channel_points',
      simulated_cost: 0,
      viewer_id: '9001',
    });
    expect(await core.db.query('select 1 from lab_wallet_ledger')).toHaveLength(
      0,
    ); // nothing debited
    const queue = await core.soundLab.moderationQueue(CH);
    expect(
      [...queue.waiting, ...queue.playing].every((i) => !i.refundable),
    ).toBe(true);
  });

  it('a sound nobody plays (player closed) ends « expired » after 2 min instead of « en attente » for ever', async () => {
    const { core, cp } = await fixture();
    await cp.setEnabled(CH, true, 'test');
    await soundReady(core);
    await cp.saveRule(CH, REWARD, {
      enabled: true,
      actions: [{ type: 'sound', sound_id: 'random' }],
    });
    const e = await cp.receive(redemption(core));
    expect(e.redemption.status).toBe('pending');
    core.clock.advance(121_000);
    expect((await cp.state(CH)).recent[0]).toMatchObject({
      status: 'failed',
      results: [{ status: 'failed', error: 'expired' }],
    });
    // Never refunded / debited (paid on Twitch).
    expect(await core.db.query('select 1 from lab_wallet_ledger')).toHaveLength(
      0,
    );
  });

  it('rules: known rewards only, typed actions only, version conflicts refused', async () => {
    const { cp } = await fixture();
    await expect(
      cp.saveRule(CH, 'unknown', {
        enabled: true,
        actions: [{ type: 'obs_scene', scene: 'BRB' }],
      }),
    ).rejects.toMatchObject({ code: 'unknown_reward' });
    await cp.saveRule(CH, REWARD, {
      enabled: true,
      actions: [{ type: 'obs_scene', scene: 'BRB' }],
    });
    await expect(
      cp.saveRule(CH, REWARD, {
        enabled: true,
        actions: [{ type: 'obs_scene', scene: 'X' }],
      }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(
      cp.saveRule(CH, REWARD, {
        enabled: true,
        actions: [{ type: 'obs_scene', scene: 'X' }],
        expected_version: 7,
      }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
  });
});

describe('Points de chaîne — OBS jobs (Studio)', () => {
  const obsRule = (cp: ChannelPointsService) =>
    cp.saveRule(CH, REWARD, {
      enabled: true,
      actions: [
        {
          type: 'obs_source',
          scene: 'Cam',
          source: 'Creepy',
          visible: true,
          duration_ms: 3000,
        },
        { type: 'obs_filter', source: 'Cam', filter: 'Flou', enabled: true },
      ],
    });

  it('claim → started → completed with per-action results; one job in flight; frozen actions survive a rule edit', async () => {
    const { core, cp } = await fixture();
    await cp.setEnabled(CH, true, 'test');
    await obsRule(cp);
    const a = redemption(core);
    const b = redemption(core);
    expect((await cp.receive(a)).outcome).toBe('pending');
    await cp.receive(b);
    // A later edit never changes a redemption already received.
    await cp.saveRule(CH, REWARD, {
      enabled: true,
      actions: [{ type: 'obs_scene', scene: 'Autre' }],
      expected_version: 1,
    });
    const job = (await cp.claim(CH, 'studio-1'))!;
    expect(job.actions.map((x) => x.action.type)).toEqual([
      'obs_source',
      'obs_filter',
    ]);
    expect(job.redemption).toEqual({
      reward_title: 'Eren cri',
      user_name: 'Cooler_User',
    });
    expect(await cp.claim(CH, 'studio-1')).toBeNull(); // one in flight
    await cp.ack(job.job_id, {
      consumer_id: 'studio-1',
      attempt_id: job.attempt_id,
      event: 'started',
    });
    await cp.ack(job.job_id, {
      consumer_id: 'studio-1',
      attempt_id: job.attempt_id,
      event: 'completed',
      results: [
        { index: 0, ok: true },
        { index: 1, ok: false, error: 'filtre introuvable' },
      ],
    });
    const state = await cp.state(CH);
    const first = state.recent.find(
      (r) => r.redemption_id === a.redemption_id,
    )!;
    expect(first).toMatchObject({
      status: 'partial',
      results: [
        { index: 0, status: 'done' },
        { index: 1, status: 'failed', error: 'filtre introuvable' },
      ],
    });
    expect((await cp.claim(CH, 'studio-1'))!.actions).toHaveLength(2); // b, with the actions frozen at its reception
  });

  it('Studio gone: never started → offered again (3 attempts) then failed; started → expired, never replayed', async () => {
    const { core, cp } = await fixture();
    await cp.setEnabled(CH, true, 'test');
    await obsRule(cp);
    const e = redemption(core);
    await cp.receive(e);
    for (let i = 0; i < 3; i++) {
      expect(await cp.claim(CH, `studio-${i}`)).not.toBeNull();
      core.clock.advance(CP_RULES.claimLeaseMs + 1);
    }
    expect(await cp.claim(CH, 'studio-x')).toBeNull();
    expect((await cp.state(CH)).recent[0]).toMatchObject({
      status: 'failed',
      results: [{ error: 'studio_absent' }, { error: 'studio_absent' }],
    });
    const f = redemption(core);
    await cp.receive(f);
    const job = (await cp.claim(CH, 'studio-1'))!;
    await cp.ack(job.job_id, {
      consumer_id: 'studio-1',
      attempt_id: job.attempt_id,
      event: 'started',
    });
    core.clock.advance(3000 + CP_RULES.runMarginMs + 1);
    expect(await cp.claim(CH, 'studio-1')).toBeNull();
    expect(
      (await cp.state(CH)).recent.find(
        (r) => r.redemption_id === f.redemption_id,
      ),
    ).toMatchObject({
      status: 'failed',
      results: [{ status: 'unknown' }, { status: 'unknown' }],
    });
    await expect(
      cp.ack(job.job_id, {
        consumer_id: 'studio-1',
        attempt_id: job.attempt_id,
        event: 'completed',
      }),
    ).rejects.toMatchObject({ code: 'not_current_attempt' });
  });
});

describe('Points de chaîne — routes', () => {
  async function server(production: boolean) {
    const core = await setup();
    core.clock.set(new Date());
    const app = createApp({
      ...core,
      labRoutes: false,
      botSecret: 'bot-test-secret',
      studioSecret: 'studio-test-secret',
      cockpit: {
        core: () => Promise.reject(new Error('unused')),
        channelId: CH,
      },
      ...(production ? {} : { studioInstallations: undefined }),
    });
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise((r) => app.close(() => r())));
    const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    await core.studioInstallations.register(
      `${id}.${sha256(secret)}`,
      'PC test',
    );
    const call = async (path: string, body: unknown, auth: string) => {
      const res = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: auth,
          [STUDIO_PROTOCOL_HEADER]: '1',
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely read JSON answers
      return { status: res.status, body: (await res.json()) as any };
    };
    return {
      core,
      call,
      studio: `Bearer rsi_${id}.${secret}`,
      bot: 'Bearer bot-test-secret',
    };
  }

  it('production: the bot posts rewards and redemptions only; the paired Studio configures; switch OFF by default', async () => {
    const { core, call, studio, bot } = await server(true);
    expect(
      (
        await call(
          '/v1/bot/channel-points/rewards',
          {
            channel_id: CH,
            rewards: [
              { id: REWARD, title: 'Eren cri', cost: 500, is_enabled: true },
            ],
          },
          bot,
        )
      ).body,
    ).toEqual({ synced: 1 });
    // The bot cannot configure; Studio can.
    expect(
      (
        await call(
          `/v1/studio/channel-points/${CH}/settings`,
          { enabled: true },
          bot,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          `/v1/studio/channel-points/${CH}/rules/${REWARD}`,
          {
            enabled: true,
            actions: [{ type: 'obs_scene', scene: 'BRB' }],
          },
          studio,
        )
      ).body,
    ).toMatchObject({ version: 1 });
    const e = redemption(core);
    expect(
      (await call('/v1/bot/channel-points/redemptions', e, bot)).body,
    ).toMatchObject({
      outcome: 'ignored',
      redemption: { reason: 'automations_off' },
    });
    expect(
      (await call('/v1/bot/channel-points/redemptions', e, bot)).body.outcome,
    ).toBe('duplicate');
    // A test from Studio runs even with the switch OFF; the bot cannot post a simulation.
    expect(
      (
        await call(
          `/v1/studio/channel-points/${CH}/test`,
          { reward_id: REWARD },
          studio,
        )
      ).body.outcome,
    ).toBe('pending');
    expect(
      (
        await call(
          '/v1/bot/channel-points/redemptions',
          { ...e, source: 'simulation', redemption_id: 'x' },
          bot,
        )
      ).body,
    ).toEqual({ error: 'twitch_source_required' });
    const job = (
      await call(
        `/v1/studio/channel-points/${CH}/claim`,
        { consumer_id: 'studio-1' },
        studio,
      )
    ).body.job;
    expect(job.actions[0].action).toEqual({ type: 'obs_scene', scene: 'BRB' });
    // Refusals: another channel, a fake JSON action type, no credential.
    expect(
      (await call('/v1/studio/channel-points/999/state', undefined, studio))
        .status,
    ).toBe(409);
    expect(
      (
        await call(
          `/v1/studio/channel-points/${CH}/rules/${REWARD}`,
          {
            enabled: true,
            actions: [{ type: 'shell', command: 'format c:' }],
            expected_version: 1,
          },
          studio,
        )
      ).status,
    ).toBe(400);
    expect(
      (await call(`/v1/studio/channel-points/${CH}/state`, undefined, ''))
        .status,
    ).toBe(401);
    // The Lab routes are not served by the public Core.
    expect(
      (
        await call(
          `/v1/lab/channel-points/${CH}/state`,
          undefined,
          'Bearer studio-test-secret',
        )
      ).status,
    ).toBe(404);
  });
});
