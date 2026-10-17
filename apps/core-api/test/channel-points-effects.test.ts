import { randomUUID } from 'node:crypto';
import { CpRuleInput, type CpRedemptionInput } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import {
  ChannelPointsService,
  CP_RULES,
} from '../src/channel-points/service.js';
import { setup, type TestCore } from './helpers.js';

// Effects player P0.1 (docs/EFFECTS_PLAYER.md): an « effect sound » action rides in the Studio job of the redemption
// (never the Soundboard: no queue, no wallet), is « playing » once Studio's player started it (the job ends at once, so
// the next redemption may overlap) and « done » only when its end is reported; no end → unknown, never replayed.

const CH = '83603689';
const REWARD = 'reward-eren';

async function fixture() {
  const core = await setup();
  core.clock.set(new Date('2026-10-18T20:00:00Z'));
  const cp = new ChannelPointsService(core.db, core.clock, core.soundLab);
  await cp.syncRewards({
    channel_id: CH,
    rewards: [{ id: REWARD, title: 'Eren cri', cost: 1500, is_enabled: true }],
  });
  await cp.setEnabled(CH, true, 'test');
  await cp.saveRule(CH, REWARD, {
    enabled: true,
    actions: [{ type: 'effect_sound', sound_id: 'eren-scream', volume: 100 }],
  });
  return { core, cp };
}

const redemption = (core: TestCore): CpRedemptionInput => ({
  channel_id: CH,
  source: 'twitch',
  redemption_id: randomUUID(),
  reward: { id: REWARD, title: 'Eren cri', cost: 1500 },
  user: { id: '9001', login: 'cooler_user', display_name: 'Cooler_User' },
  redeemed_at: core.clock.now().toISOString(),
});

/** Studio's side of one job: claimed, started, completed with the effect reported playing. */
async function runJob(cp: ChannelPointsService, consumer = 'studio-1') {
  const job = (await cp.claim(CH, consumer))!;
  await cp.ack(job.job_id, {
    consumer_id: consumer,
    attempt_id: job.attempt_id,
    event: 'started',
  });
  await cp.ack(job.job_id, {
    consumer_id: consumer,
    attempt_id: job.attempt_id,
    event: 'completed',
    results: [{ index: 0, ok: true, playing: true }],
  });
  return job;
}

describe('Points de chaîne — effect sounds', () => {
  it('rule validation: catalogue sound and 0-100 volume only', () => {
    const ok = (a: unknown) =>
      CpRuleInput.safeParse({ enabled: true, actions: [a] }).success;
    expect(
      ok({ type: 'effect_sound', sound_id: 'tiens-bon', volume: 41 }),
    ).toBe(true);
    expect(ok({ type: 'effect_sound', sound_id: 'nope', volume: 41 })).toBe(
      false,
    );
    expect(
      ok({ type: 'effect_sound', sound_id: 'tiens-bon', volume: 150 }),
    ).toBe(false);
    expect(ok({ type: 'effect_sound', sound_id: 'tiens-bon' })).toBe(false);
    expect(
      ok({
        type: 'effect_sound',
        sound_id: 'tiens-bon',
        volume: 41,
        path: 'C:/x.ogg',
      }),
    ).toBe(false);
  });

  it('a Studio job, never the Soundboard (unready player, no wallet); playing → done on the reported end; dedup', async () => {
    const { core, cp } = await fixture();
    // No Soundboard player ready: a Soundboard sound would fail here — the effect does not depend on it.
    const e = redemption(core);
    expect((await cp.receive(e)).redemption).toMatchObject({
      status: 'pending',
      results: [{ index: 0, type: 'effect_sound', status: 'pending' }],
    });
    expect((await cp.receive(e)).outcome).toBe('duplicate');
    const job = await runJob(cp);
    expect(job.actions).toEqual([
      {
        index: 0,
        action: { type: 'effect_sound', sound_id: 'eren-scream', volume: 100 },
      },
    ]);
    expect(await cp.claim(CH, 'studio-1')).toBeNull(); // the duplicate made no second job
    const row = async () =>
      (await cp.state(CH)).recent.find(
        (r) => r.redemption_id === e.redemption_id,
      )!;
    // Started is not played to the end: pending, « en cours de lecture ».
    expect(await row()).toMatchObject({
      status: 'pending',
      results: [{ status: 'pending', progress: 'playing' }],
    });
    expect(
      await cp.effectReport(job.job_id, {
        consumer_id: 'studio-1',
        index: 0,
        event: 'completed',
      }),
    ).toEqual({ status: 'recorded' });
    expect(await row()).toMatchObject({
      status: 'done',
      results: [{ status: 'done' }],
    });
    // A repeated / late report changes nothing.
    expect(
      await cp.effectReport(job.job_id, {
        consumer_id: 'studio-1',
        index: 0,
        event: 'failed',
        error: 'x',
      }),
    ).toEqual({ status: 'already_final' });
    expect((await row()).status).toBe('done');
    expect(
      await core.db.query('select 1 from sound_lab_interactions'),
    ).toHaveLength(0);
    expect(await core.db.query('select 1 from lab_wallet_ledger')).toHaveLength(
      0,
    );
  });

  it('two redemptions close together: the second job is claimable while the first effect plays (overlap)', async () => {
    const { core, cp } = await fixture();
    const a = redemption(core);
    const b = redemption(core);
    await cp.receive(a);
    await cp.receive(b);
    const first = await runJob(cp);
    const second = await runJob(cp); // not blocked by the first sound still playing
    expect(second.job_id).not.toBe(first.job_id);
    const recent = (await cp.state(CH)).recent;
    for (const id of [a.redemption_id, b.redemption_id])
      expect(recent.find((r) => r.redemption_id === id)).toMatchObject({
        results: [{ status: 'pending', progress: 'playing' }],
      });
  });

  it('player failure, unknown end, refused reports; no end within the delay → unknown (never replayed)', async () => {
    const { core, cp } = await fixture();
    // Not started (player absent): failed in the job report itself.
    const off = redemption(core);
    await cp.receive(off);
    const j0 = (await cp.claim(CH, 'studio-1'))!;
    await cp.ack(j0.job_id, {
      consumer_id: 'studio-1',
      attempt_id: j0.attempt_id,
      event: 'completed',
      results: [{ index: 0, ok: false, error: 'effects_player_offline' }],
    });
    // Started, then an error while playing.
    const bad = redemption(core);
    await cp.receive(bad);
    const j1 = await runJob(cp);
    await expect(
      cp.effectReport(j1.job_id, {
        consumer_id: 'another-studio',
        index: 0,
        event: 'completed',
      }),
    ).rejects.toMatchObject({ code: 'not_current_attempt' });
    await cp.effectReport(j1.job_id, {
      consumer_id: 'studio-1',
      index: 0,
      event: 'failed',
      error: 'playback_error',
    });
    // Started, never ended (Studio closed): unknown after the delay.
    const lost = redemption(core);
    await cp.receive(lost);
    await runJob(cp);
    core.clock.advance(CP_RULES.effectEndMs + 1);
    const recent = (await cp.state(CH)).recent;
    const of = (e: CpRedemptionInput) =>
      recent.find((r) => r.redemption_id === e.redemption_id);
    expect(of(off)).toMatchObject({
      status: 'failed',
      results: [{ status: 'failed', error: 'effects_player_offline' }],
    });
    expect(of(bad)).toMatchObject({
      status: 'failed',
      results: [{ status: 'failed', error: 'playback_error' }],
    });
    expect(of(lost)).toMatchObject({
      status: 'failed',
      results: [{ status: 'unknown', error: 'playback_not_confirmed' }],
    });
    // Nothing is offered again.
    expect(await cp.claim(CH, 'studio-1')).toBeNull();
  });

  it('an effect report on a non-effect action is refused', async () => {
    const { core, cp } = await fixture();
    await cp.saveRule(CH, REWARD, {
      enabled: true,
      actions: [{ type: 'obs_scene', scene: 'BRB' }],
      expected_version: 1,
    });
    await cp.receive(redemption(core));
    const job = (await cp.claim(CH, 'studio-1'))!;
    await expect(
      cp.effectReport(job.job_id, {
        consumer_id: 'studio-1',
        index: 0,
        event: 'completed',
      }),
    ).rejects.toMatchObject({ code: 'not_an_effect' });
  });

  it('effect video (NTM): catalogue video only; same cycle as a sound — a Studio job, playing, then done', async () => {
    const ok = (a: unknown) =>
      CpRuleInput.safeParse({ enabled: true, actions: [a] }).success;
    expect(ok({ type: 'effect_video', video_id: 'fuck-you', volume: 10 })).toBe(
      true,
    );
    expect(
      ok({ type: 'effect_video', video_id: 'eren-scream', volume: 10 }),
    ).toBe(false);
    expect(
      ok({ type: 'effect_video', video_id: 'fuck-you', volume: 101 }),
    ).toBe(false);
    const { core, cp } = await fixture();
    await cp.saveRule(CH, REWARD, {
      enabled: true,
      actions: [{ type: 'effect_video', video_id: 'fuck-you', volume: 10 }],
      expected_version: 1,
    });
    const e = redemption(core);
    await cp.receive(e);
    const job = await runJob(cp);
    expect(job.actions[0]!.action).toEqual({
      type: 'effect_video',
      video_id: 'fuck-you',
      volume: 10,
    });
    expect((await cp.state(CH)).recent[0]).toMatchObject({
      results: [{ status: 'pending', progress: 'playing' }],
    });
    await cp.effectReport(job.job_id, {
      consumer_id: 'studio-1',
      index: 0,
      event: 'completed',
    });
    expect((await cp.state(CH)).recent[0]).toMatchObject({
      status: 'done',
      results: [{ status: 'done' }],
    });
  });
});
