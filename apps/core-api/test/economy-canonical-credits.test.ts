import { randomUUID } from 'node:crypto';
import type { CpRedemptionInput, LabActor } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { ChannelPointsService } from '../src/channel-points/service.js';
import type { Db } from '../src/db/db.js';
import { coreWalletEconomy, labEconomy } from '../src/economy/economy.js';
import { LabModerationService } from '../src/lab-moderation/service.js';
import { SoundLabService } from '../src/sound-lab/sound-lab-service.js';
import { TtsLabService } from '../src/tts-lab/tts-lab-service.js';
import { count, setup } from './helpers.js';

// Phase 2 lot 4 (docs/ECONOMY_MIGRATION.md § 14): Crédits TTS / Soundboard are secondary currencies of the canonical
// Wallet, obtained only through a channel points reward (rule action « credits »), spent by TTS / Soundboard, given
// back in their own currency, never converted. Test DB only.

const CH = '83603689';
const REWARD = 'reward-credits-tts';
const V = { id: '9301', login: 'viewer_cred', display_name: 'Viewer Cred' };
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
let seq = 0;

async function fixture(economy: 'canonical' | 'lab' = 'canonical') {
  const core = await setup();
  core.clock.set(new Date('2026-10-19T20:00:00Z'));
  const port =
    economy === 'canonical'
      ? coreWalletEconomy(core.wallet.wallet)
      : labEconomy;
  const sound = new SoundLabService(core.db, core.clock, Math.random, port);
  const tts = new TtsLabService(
    core.db,
    core.clock,
    Math.random,
    undefined,
    port,
  );
  const mod = new LabModerationService(
    core.db,
    core.clock,
    tts,
    sound,
    core.bonkLab,
    core.raffleLab,
    port,
  );
  const cpOn = (db: Db = core.db) =>
    new ChannelPointsService(db, core.clock, sound, undefined, port);
  const cp = cpOn();
  await cp.syncRewards({
    channel_id: CH,
    rewards: [
      { id: REWARD, title: 'Crédits TTS', cost: 1000, is_enabled: true },
      { id: 'reward-sb', title: 'Crédits SB', cost: 1000, is_enabled: true },
    ],
  });
  await cp.setEnabled(CH, true, 'test');
  await cp.saveRule(CH, REWARD, {
    enabled: true,
    actions: [{ type: 'credits', currency: 'credits_tts', amount: 3 }],
  });
  await sound.heartbeat({ studio_instance_id: 'S', player_ready: true });
  await tts.heartbeat({ studio_instance_id: 'S', player_ready: true });
  const redemption = (
    over: Partial<CpRedemptionInput> = {},
  ): CpRedemptionInput => ({
    channel_id: CH,
    source: 'twitch',
    redemption_id: randomUUID(),
    reward: { id: REWARD, title: 'Crédits TTS', cost: 1000 },
    user: V,
    twitch_status: 'unfulfilled',
    redeemed_at: core.clock.now().toISOString(),
    ...over,
  });
  const balances = () => port.balances(core.db, CH, V.id);
  const act = (command: Record<string, unknown>) =>
    mod.act(CH, {
      actor: studio,
      command: command as never,
      idempotency_key: `credits-act-${++seq}`,
    });
  const base = { channel_id: CH, viewer: V, lab_session_id: 'lab-1' };
  return {
    core,
    port,
    cp,
    cpOn,
    sound,
    tts,
    mod,
    redemption,
    balances,
    act,
    base,
  };
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: Error & { code?: string }) => e.code ?? e.message,
  );

describe('credits granted by a channel points reward (canonical Wallet)', () => {
  it('a redemption grants the rule amount once, in its own currency; Jetons and the other credits untouched', async () => {
    const f = await fixture();
    const e = f.redemption();
    const out = await f.cp.receive(e);
    expect(out).toMatchObject({
      outcome: 'done',
      redemption: {
        results: [{ status: 'done', granted: 3, detail: '+3 Crédits TTS' }],
      },
    });
    expect(await f.balances()).toEqual({
      tokens: 0,
      credits_tts: 3,
      credits_soundboard: 0,
    });
    // Redelivered (reconnection, outbox replay), and on a restarted Core: the first decision, nothing more.
    expect((await f.cp.receive(e)).outcome).toBe('duplicate');
    expect((await f.cpOn().receive(e)).outcome).toBe('duplicate');
    expect((await f.balances()).credits_tts).toBe(3);
    expect(
      await count(
        f.core.db,
        "wallet_transactions where kind = 'reward' and source = 'channel_points'",
      ),
    ).toBe(1);
    // The moderation reads it: balance and « Points de chaîne » activity in Crédits TTS.
    const activity = await f.mod.ledger(CH, { viewer: V.id, limit: 10 });
    expect(activity.items[0]).toMatchObject({
      kind: 'channel_points',
      label: 'Points de chaîne',
      currency: 'credits_tts',
      amount: 3,
    });
  });

  it('two deliveries of the same redemption at once: credited once', async () => {
    const f = await fixture();
    const e = f.redemption();
    const outs = await Promise.all([f.cp.receive(e), f.cpOn().receive(e)]);
    expect(outs.map((o) => o.outcome).sort()).toEqual(['done', 'duplicate']);
    expect((await f.balances()).credits_tts).toBe(3);
  });

  it('no rule, rule disabled, switch OFF, simulation: nothing granted; late: credits granted, nothing else run', async () => {
    const f = await fixture();
    expect(
      (
        await f.cp.receive(
          f.redemption({
            reward: { id: 'reward-sb', title: 'Crédits SB', cost: 1 },
          }),
        )
      ).redemption.reason,
    ).toBe('no_rule');
    await f.cp.setEnabled(CH, false, 'test');
    expect((await f.cp.receive(f.redemption())).redemption.reason).toBe(
      'automations_off',
    );
    await f.cp.setEnabled(CH, true, 'test');
    const sim = await f.cp.receive(
      f.redemption({ source: 'simulation', redemption_id: 'test-1' }),
    );
    expect(sim.redemption.results[0]).toMatchObject({
      status: 'done',
      detail: 'simulation : +3 Crédits TTS (aucun crédit)',
    });
    expect((await f.balances()).credits_tts).toBe(0);
    // Late (after an outage): the points are spent, the credits are granted; a sound of the same rule is not played.
    await f.cp.saveRule(CH, REWARD, {
      enabled: true,
      expected_version: 1,
      actions: [
        { type: 'sound', sound_id: 'boop' },
        { type: 'credits', currency: 'credits_tts', amount: 3 },
      ],
    });
    const late = await f.cp.receive(
      f.redemption({
        redeemed_at: new Date(
          f.core.clock.now().getTime() - 10 * 60_000,
        ).toISOString(),
      }),
    );
    expect(late.redemption).toMatchObject({
      reason: 'late',
      status: 'done',
      actions: [{ type: 'credits' }],
    });
    expect((await f.balances()).credits_tts).toBe(3);
    expect(await count(f.core.db, 'sound_lab_interactions')).toBe(0);
    // Disabled rule: nothing.
    await f.cp.saveRule(CH, REWARD, {
      enabled: false,
      expected_version: 2,
      actions: [{ type: 'credits', currency: 'credits_tts', amount: 3 }],
    });
    expect((await f.cp.receive(f.redemption())).redemption.reason).toBe(
      'rule_disabled',
    );
    expect((await f.balances()).credits_tts).toBe(3);
  });

  it('a currency not installed: the action fails, the redemption is recorded, nothing credited', async () => {
    const f = await fixture();
    await f.core.db.query(
      "update currencies set active = false where id = 'credits_tts'",
    );
    const out = await f.cp.receive(f.redemption());
    expect(out.redemption).toMatchObject({
      status: 'failed',
      results: [{ status: 'failed', error: 'currency_unavailable' }],
    });
    expect(await count(f.core.db, 'wallet_transactions')).toBe(0);
  });

  it('a crash during the reception: nothing kept (credit included); the redelivery grants once', async () => {
    const f = await fixture();
    const e = f.redemption();
    // The database fails right after the credit, before the redemption row (the whole transaction is lost).
    const crashing: Db = {
      ...f.core.db,
      tx: (fn) =>
        f.core.db.tx((q) =>
          fn({
            query: (sql, params) => {
              if (/^\s*insert into cp_redemptions/.test(sql))
                throw new Error('crash');
              return q.query(sql, params);
            },
          } as typeof q),
        ),
    };
    expect(await code(f.cpOn(crashing).receive(e))).toBe('crash');
    expect((await f.balances()).credits_tts).toBe(0);
    expect(await count(f.core.db, 'cp_redemptions')).toBe(0);
    expect((await f.cp.receive(e)).outcome).toBe('done');
    expect((await f.balances()).credits_tts).toBe(3);
  });

  it('canceled on Twitch: the credits taken back once; already spent → at most the balance, never below 0', async () => {
    const f = await fixture();
    const a = f.redemption();
    await f.cp.receive(a);
    const cancel = (e: CpRedemptionInput) =>
      f.cp.update({
        channel_id: CH,
        source: 'twitch',
        redemption_id: e.redemption_id,
        reward_id: REWARD,
        user_id: V.id,
        twitch_status: 'canceled',
      });
    expect(await cancel(a)).toEqual({ outcome: 'recorded' });
    expect(await cancel(a)).toEqual({ outcome: 'duplicate' });
    expect((await f.balances()).credits_tts).toBe(0);
    // Granted 3, 2 spent, then canceled: 1 taken back, 2 « à rapprocher ».
    const b = f.redemption();
    await f.cp.receive(b);
    // 2 spent (moderation adjustment: the same debit path, whatever spent them).
    await f.act({
      action: 'wallet_adjust',
      viewer_id: V.id,
      currency: 'credits_tts',
      delta: -2,
      reason: 'dépense',
    });
    expect((await f.balances()).credits_tts).toBe(1);
    await cancel(b);
    expect((await f.balances()).credits_tts).toBe(0);
    const row = (await f.cp.state(CH)).recent.find(
      (r) => r.redemption_id === b.redemption_id,
    )!;
    expect(row).toMatchObject({
      twitch_status: 'canceled',
      results: [{ granted: 3, reversed: 1 }],
    });
    expect(row.results[0]!.detail).toContain('à rapprocher');
    // Unknown redemption, fulfilled: nothing moves.
    expect(
      await f.cp.update({
        channel_id: CH,
        source: 'twitch',
        redemption_id: 'never-seen',
        reward_id: REWARD,
        user_id: V.id,
        twitch_status: 'canceled',
      }),
    ).toEqual({ outcome: 'unknown_redemption' });
    const c = f.redemption();
    await f.cp.receive(c);
    await f.cp.update({
      channel_id: CH,
      source: 'twitch',
      redemption_id: c.redemption_id,
      reward_id: REWARD,
      user_id: V.id,
      twitch_status: 'fulfilled',
    });
    expect((await f.balances()).credits_tts).toBe(3);
  });
});

describe('TTS and Soundboard paid in credits (canonical Wallet)', () => {
  it('TTS: Crédits TTS debited, Jetons untouched; moderation cancel refunds the credits once, never in Jetons', async () => {
    const f = await fixture();
    await f.cp.receive(f.redemption());
    const { interaction } = await f.tts.admit({
      ...f.base,
      idempotency_key: 'tts-1',
      text: 'Salut',
      payment_method: 'credits',
    });
    const cost = interaction.simulated_cost;
    expect(cost).toBeGreaterThan(0);
    expect(await f.balances()).toEqual({
      tokens: 0,
      credits_tts: 3 - cost,
      credits_soundboard: 0,
    });
    const cancel = {
      action: 'cancel',
      module: 'tts',
      interaction_id: interaction.interaction_id,
      refund: true,
    };
    await f.act(cancel);
    await code(f.act(cancel));
    expect(await f.balances()).toEqual({
      tokens: 0,
      credits_tts: 3,
      credits_soundboard: 0,
    });
    const movements = await f.port.interactionMovements(
      f.core.db,
      interaction.interaction_id,
    );
    expect(movements.map((m) => [m.kind, m.currency, m.amount])).toEqual([
      ['debit', 'credits_tts', -cost],
      ['refund', 'credits_tts', cost],
    ]);
  });

  it('Soundboard: Crédits Soundboard only; Crédits TTS never pay a sound; Jetons still pay; channel points debit nothing', async () => {
    const f = await fixture();
    await f.cp.saveRule(CH, 'reward-sb', {
      enabled: true,
      actions: [{ type: 'credits', currency: 'credits_soundboard', amount: 2 }],
    });
    await f.cp.receive(f.redemption()); // 3 Crédits TTS
    const sound = (key: string, payment_method: 'credits' | 'tokens') =>
      f.sound.admit({
        ...f.base,
        idempotency_key: key,
        sound_id: 'boop',
        payment_method,
      });
    expect(await code(sound('s-1', 'credits'))).toBe('insufficient_credits');
    expect((await f.balances()).credits_tts).toBe(3);
    await f.cp.receive(
      f.redemption({
        reward: { id: 'reward-sb', title: 'Crédits SB', cost: 1000 },
      }),
    );
    const { interaction } = await sound('s-2', 'credits');
    expect(await f.balances()).toEqual({
      tokens: 0,
      credits_tts: 3,
      credits_soundboard: 2 - interaction.simulated_cost,
    });
    expect(await code(sound('s-3', 'tokens'))).toBe('insufficient_tokens');
    await f.core.wallet.wallet.credit({
      key: 'fund-1',
      viewer: {
        twitchUserId: V.id,
        login: V.login,
        displayName: V.display_name,
      },
      amount: 1_000,
      source: 'test',
    });
    await sound('s-4', 'tokens');
    await f.sound.admitChannelPoints({
      idempotency_key: 'cp-direct',
      channel_id: CH,
      viewer: V,
      sound_id: 'boop',
    });
    const after = await f.balances();
    expect(after.credits_soundboard).toBe(2 - interaction.simulated_cost);
    expect(after.credits_tts).toBe(3);
  });
});

describe('credits on the Lab test wallet (default economy)', () => {
  it('granted in the Lab wallet column with its own ledger kind', async () => {
    const f = await fixture('lab');
    const before = (await f.balances()).credits_tts ?? 0;
    await f.cp.receive(f.redemption());
    expect((await f.balances()).credits_tts).toBe(before + 3);
    expect(
      await count(f.core.db, "lab_wallet_ledger where kind = 'channel_points'"),
    ).toBe(1);
    expect(await count(f.core.db, 'wallet_transactions')).toBe(0);
  });
});
