import { describe, expect, it } from 'vitest';
import type { LabActor, LabModerationCommand } from '@raptoru/schemas';
import {
  BONK_LAB_RULES,
  BonkLabService,
} from '../src/bonk-lab/bonk-lab-service.js';
import { coreWalletEconomy, labEconomy } from '../src/economy/economy.js';
import { LabModerationService } from '../src/lab-moderation/service.js';
import { SoundLabService } from '../src/sound-lab/sound-lab-service.js';
import { TtsLabService } from '../src/tts-lab/tts-lab-service.js';
import { count, setup } from './helpers.js';

// Phase 2 lot 2: Bonk, Soundboard and TTS — and the moderation that drives them — on the CANONICAL Core Wallet, end to
// end: salves, automatic and manual refunds (once, also after a restart), moderation reads (balance, interaction
// movements, D4 activity) from the canonical ledger, Lab-only tools refused, credits never converted. Test DB only.

const CH = '901000';
const STUDIO = 'studio-A';
const V = { id: '901001', display_name: 'Viewer Canon' };
const PRICE = BONK_LAB_RULES.simulatedCost;
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
let seq = 0;

async function canonical() {
  const core = await setup();
  const port = coreWalletEconomy(core.wallet.wallet);
  /** A fresh set of services on the same database (a Core restart). */
  const services = () => {
    const bonk = new BonkLabService(core.db, core.clock, null, null, port);
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
      bonk,
      core.raffleLab,
      port,
    );
    return { bonk, sound, tts, mod };
  };
  const s = services();
  const ready = async (x = s) => {
    await x.bonk.heartbeat({
      studio_instance_id: STUDIO,
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
    await x.sound.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
    await x.tts.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
  };
  await ready();
  const fund = (amount: number, viewer = V) =>
    core.wallet.wallet.credit({
      key: `fund-${++seq}`,
      viewer: {
        twitchUserId: viewer.id,
        login: 'viewer_canon',
        displayName: viewer.display_name,
      },
      amount,
      source: 'test',
    });
  const balance = async (viewer = V) =>
    (await core.wallet.wallet.getWallet(viewer.id))?.balance ?? 0;
  const base = { channel_id: CH, viewer: V, lab_session_id: 'lab-1' };
  const emote = (g: string) => ({
    provider: 'unicode' as const,
    id: `unicode:${g.codePointAt(0)!.toString(16)}`,
    glyph: g,
  });
  const act = (command: Record<string, unknown>, m = s.mod) =>
    m.act(CH, {
      actor: studio,
      command: command as LabModerationCommand,
      idempotency_key: `moderation-act-${++seq}`,
    });
  return { core, port, s, services, ready, fund, balance, base, emote, act };
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: Error & { code?: string }) => e.code ?? e.message,
  );
/** Core ledger = balances, and the Lab wallet never moved. */
async function consistent(db: Awaited<ReturnType<typeof setup>>['db']) {
  expect(
    await count(
      db,
      `wallets w where balance <> (select coalesce(sum(amount), 0) from wallet_transactions t
         where t.twitch_user_id = w.twitch_user_id and t.currency_id = w.currency_id)`,
    ),
  ).toBe(0);
  expect(await count(db, 'lab_wallet_ledger')).toBe(0);
}

describe('Bonk on the canonical Wallet', () => {
  it('salve: N shots = N debits in one transaction; short on the last shot → the whole salve refused; replay → no debit', async () => {
    const f = await canonical();
    await f.fund(PRICE * 3 + 1);
    const salve = (key: string, n: number) =>
      f.s.bonk.admitVolley({
        ...f.base,
        idempotency_key: key,
        emotes: Array.from({ length: n }, () => f.emote('😀')),
        cadence_ms: 200,
      });
    expect((await salve('v-1', 3)).interactions).toHaveLength(3);
    expect(await f.balance()).toBe(1);
    expect(await code(salve('v-2', 2))).toBe('insufficient_tokens');
    expect(await f.balance()).toBe(1);
    expect(await count(f.core.db, 'bonk_lab_interactions')).toBe(3);
    await f.fund(PRICE * 3);
    const again = await salve('v-1', 3);
    expect(again.replayed).toBe(true);
    expect(await f.balance()).toBe(1 + PRICE * 3);
    await consistent(f.core.db);
  });

  it('expired before being shown: refunded once by the sweep; a restarted Core sweeping again pays nothing more', async () => {
    const f = await canonical();
    await f.fund(1_000);
    const { interaction } = await f.s.bonk.admit({
      ...f.base,
      idempotency_key: 'b-exp',
      emote: f.emote('😀'),
    });
    f.core.clock.advance(BONK_LAB_RULES.expiresAfterMs + 1);
    await f.s.bonk.sweepExpired();
    expect(await f.balance()).toBe(1_000);
    const restarted = f.services();
    await restarted.bonk.sweepExpired();
    await restarted.bonk.sweepExpired();
    expect(await f.balance()).toBe(1_000);
    expect(
      (await restarted.bonk.get(interaction.interaction_id)).refund_status,
    ).toBe('refunded');
    // The moderation detail reads the canonical movements: the debit and its refund, nothing else.
    const detail = await restarted.mod.interaction(
      CH,
      interaction.interaction_id,
    );
    expect(detail!.movements.map((m) => [m.kind, m.amount])).toEqual([
      ['debit', -PRICE],
      ['refund', PRICE],
    ]);
    await consistent(f.core.db);
  });
});

describe('TTS on the canonical Wallet', () => {
  const say = (f: Awaited<ReturnType<typeof canonical>>, key: string) =>
    f.s.tts.admit({
      ...f.base,
      idempotency_key: key,
      text: 'Salut Raptoru !',
      payment_method: 'tokens',
    });

  it('paid in Jetons, marked « payée » for moderation; a failure before reading refunds once (replayed ACK included)', async () => {
    const f = await canonical();
    await f.fund(10_000);
    const { interaction } = await say(f, 't-1');
    const cost = interaction.simulated_cost;
    expect(await f.balance()).toBe(10_000 - cost);
    expect((await f.s.tts.moderationQueue(CH)).waiting[0]).toMatchObject({
      interaction_id: interaction.interaction_id,
      paid: true,
    });
    const claimed = (await f.s.tts.claim(STUDIO, CH))!;
    const fail = () =>
      f.s.tts.ack(interaction.interaction_id, {
        studio_instance_id: STUDIO,
        attempt_id: claimed.delivery.attempt_id!,
        event: 'failed',
      });
    await fail();
    await fail();
    expect(await f.balance()).toBe(10_000);
    expect((await f.s.tts.get(interaction.interaction_id)).refund_status).toBe(
      'refunded',
    );
    await consistent(f.core.db);
  });

  it('moderation cancel with refund: exact amount back once — repeated, and repeated after a restart, never twice', async () => {
    const f = await canonical();
    await f.fund(10_000);
    const { interaction } = await say(f, 't-2');
    const cancel = {
      action: 'cancel',
      module: 'tts',
      interaction_id: interaction.interaction_id,
      refund: true,
    };
    await f.act(cancel);
    expect(await f.balance()).toBe(10_000);
    await code(f.act(cancel));
    await code(f.act(cancel, f.services().mod));
    expect(await f.balance()).toBe(10_000);
    expect(
      await count(f.core.db, "wallet_transactions where kind = 'refund'"),
    ).toBe(1);
  });

  it('a crash after the payment, before the request is stored: nothing debited, nothing queued; the retry pays once', async () => {
    const f = await canonical();
    await f.fund(10_000);
    const failing = new TtsLabService(
      f.core.db,
      f.core.clock,
      Math.random,
      undefined,
      {
        ...f.port,
        debit: async (...a) => {
          await f.port.debit(...a);
          throw new Error('crash after debit');
        },
      },
    );
    expect(
      await code(
        failing.admit({
          ...f.base,
          idempotency_key: 't-crash',
          text: 'Coucou',
          payment_method: 'tokens',
        }),
      ),
    ).toBe('crash after debit');
    expect(await f.balance()).toBe(10_000);
    expect(await count(f.core.db, 'tts_lab_interactions')).toBe(0);
    const { interaction } = await f.s.tts.admit({
      ...f.base,
      idempotency_key: 't-crash',
      text: 'Coucou',
      payment_method: 'tokens',
    });
    expect(await f.balance()).toBe(10_000 - interaction.simulated_cost);
  });
});

describe('Soundboard on the canonical Wallet', () => {
  it('Jetons debited; a channel points sound debits nothing; no credits → refused, never paid in Jetons instead', async () => {
    const f = await canonical();
    await f.fund(10_000);
    const { interaction } = await f.s.sound.admit({
      ...f.base,
      idempotency_key: 's-1',
      sound_id: 'boop',
      payment_method: 'tokens',
    });
    expect(await f.balance()).toBe(10_000 - interaction.simulated_cost);
    await f.s.sound.admitChannelPoints({
      idempotency_key: 'cp-1',
      channel_id: CH,
      viewer: V,
      sound_id: 'boop',
    });
    expect(await f.balance()).toBe(10_000 - interaction.simulated_cost);
    expect(
      await code(
        f.s.sound.admit({
          ...f.base,
          idempotency_key: 's-2',
          sound_id: 'boop',
          payment_method: 'credits',
        }),
      ),
    ).toBe('insufficient_credits');
    expect(await f.balance()).toBe(10_000 - interaction.simulated_cost);
    await consistent(f.core.db);
  });

  it('pause with « cancel and refund » of the waiting queue: every waiting sound refunded once', async () => {
    const f = await canonical();
    await f.fund(10_000);
    for (const k of ['q-1', 'q-2', 'q-3'])
      await f.s.sound.admit({
        ...f.base,
        idempotency_key: k,
        sound_id: 'boop',
        payment_method: 'tokens',
      });
    const command = {
      action: 'module_state',
      module: 'soundboard',
      state: 'paused',
      waiting: 'cancel_refund',
    };
    await f.act(command);
    await code(f.act(command));
    expect(await f.balance()).toBe(10_000);
    expect(
      await count(f.core.db, "wallet_transactions where kind = 'refund'"),
    ).toBe(3);
  });
});

describe('moderation reads and tools on the canonical Wallet', () => {
  it('balances from the Core Wallet (credits null, never 0); D4 activity: module labels and debit ↔ refund links', async () => {
    const f = await canonical();
    await f.fund(10_000);
    await f.s.bonk.admit({
      ...f.base,
      idempotency_key: 'b-1',
      emote: f.emote('😀'),
    });
    const { interaction } = await f.s.sound.admit({
      ...f.base,
      idempotency_key: 's-1',
      sound_id: 'boop',
      payment_method: 'tokens',
    });
    await f.act({
      action: 'cancel',
      module: 'soundboard',
      interaction_id: interaction.interaction_id,
      refund: true,
    });
    const wallet = await f.s.mod.wallet(CH, V.id);
    expect(wallet).toEqual({
      tokens: await f.balance(),
      credits_tts: 0,
      credits_soundboard: 0,
    });
    expect((await f.s.mod.viewer(CH, V.id))!.wallet).toEqual(wallet);
    const page = await f.s.mod.ledger(CH, { viewer: V.id, auto: true });
    const rows = page.items.map((r) => [
      r.kind,
      r.label,
      r.amount,
      r.interaction_id === interaction.interaction_id,
    ]);
    expect(rows).toEqual([
      ['refund', 'Remboursement Soundboard', interaction.simulated_cost, true],
      ['debit', 'Soundboard', -interaction.simulated_cost, true],
      ['debit', 'Bonk', -PRICE, false],
      ['reward', 'reward', 10_000, false],
    ]);
    const debit = page.items.find(
      (r) =>
        r.kind === 'debit' && r.interaction_id === interaction.interaction_id,
    )!;
    const refund = page.items.find((r) => r.kind === 'refund')!;
    expect([debit.refunded_by, refund.refund_of]).toEqual([
      refund.id,
      debit.id,
    ]);
  });

  it('the Lab test-wallet tool (set the fictitious balances) is refused on the canonical Wallet: nothing moves', async () => {
    const f = await canonical();
    await f.fund(500);
    expect(
      await code(
        f.s.mod.editWallet(CH, {
          actor: studio,
          viewer_id: V.id,
          op: 'set',
          tokens: 99,
        }),
      ),
    ).toBe('canonical_wallet_tools_not_wired');
    expect(await f.balance()).toBe(500);
  });

  it('three modules on one wallet, then the moderation activity: everything on the Core ledger, nothing on the Lab one', async () => {
    const f = await canonical();
    await f.fund(20_000);
    await f.s.bonk.admitVolley({
      ...f.base,
      idempotency_key: 'v-x',
      emotes: [f.emote('😀'), f.emote('😋')],
      cadence_ms: 200,
    });
    await f.s.sound.admit({
      ...f.base,
      idempotency_key: 's-x',
      sound_id: 'boop',
      payment_method: 'tokens',
    });
    await f.s.tts.admit({
      ...f.base,
      idempotency_key: 't-x',
      text: 'Bonjour',
      payment_method: 'tokens',
    });
    const page = await f.s.mod.ledger(CH, { auto: true });
    expect(
      page.items
        .filter((r) => r.kind === 'debit')
        .map((r) => r.label)
        .sort(),
    ).toEqual(['Bonk', 'Bonk', 'Soundboard', 'TTS']);
    await consistent(f.core.db);
  });
});

describe('Lab economy unchanged (regression)', () => {
  it('the default moderation still reads and adjusts the Lab test wallet', async () => {
    const core = await setup();
    const mod = new LabModerationService(
      core.db,
      core.clock,
      core.ttsLab,
      core.soundLab,
      core.bonkLab,
      core.raffleLab,
    );
    expect(labEconomy.mode).toBe('lab');
    const before = await mod.wallet(CH, V.id);
    expect(before.credits_tts).not.toBeNull();
    await mod.act(CH, {
      actor: studio,
      command: {
        action: 'wallet_adjust',
        viewer_id: V.id,
        currency: 'tokens',
        delta: 100,
        reason: 'test',
      } as LabModerationCommand,
    });
    expect((await mod.wallet(CH, V.id)).tokens).toBe(before.tokens + 100);
    expect(await count(core.db, 'wallet_transactions')).toBe(0);
  });
});
