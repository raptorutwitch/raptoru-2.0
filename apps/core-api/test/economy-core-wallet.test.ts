// ASTRA-P1-001 lot 1 — the debit of the canonical Core Wallet and the admission of an interaction
// are ONE transaction (economy/economy.ts, WalletService.spendIn / creditIn). The services are wired
// to the Core Wallet here only: no runtime uses it yet (the Lab keeps its test wallet).
import { describe, expect, it } from 'vitest';
import {
  BONK_LAB_RULES,
  BonkLabError409,
  BonkLabService,
} from '../src/bonk-lab/bonk-lab-service.js';
import {
  coreWalletEconomy,
  labEconomy,
  type EconomyPort,
} from '../src/economy/economy.js';
import { LabWalletError } from '../src/lab-moderation/store.js';
import { SoundLabService } from '../src/sound-lab/sound-lab-service.js';
import { TtsLabService } from '../src/tts-lab/tts-lab-service.js';
import { count, setup, type TestCore } from './helpers.js';

const CHANNEL = '900100';
const STUDIO = 'studio-A';
const VIEWER = { id: '900101', display_name: 'Viewer Test' };
const PRICE = BONK_LAB_RULES.simulatedCost;

async function fixture(economy?: (core: TestCore) => EconomyPort) {
  const core = await setup();
  const port = economy ? economy(core) : coreWalletEconomy(core.wallet.wallet);
  const bonk = new BonkLabService(core.db, core.clock, null, null, port);
  await bonk.heartbeat({
    studio_instance_id: STUDIO,
    obs: 'connected',
    source_ready: true,
    overlay_ready: true,
  });
  const fund = (amount: number) =>
    core.wallet.wallet.credit({
      key: `fund-${Math.random()}`,
      viewer: {
        twitchUserId: VIEWER.id,
        login: 'viewer_test',
        displayName: VIEWER.display_name,
      },
      amount,
      source: 'test',
    });
  const balance = async () =>
    (await core.wallet.wallet.getWallet(VIEWER.id))?.balance ?? 0;
  const rows = async () => ({
    interactions: await count(core.db, 'bonk_lab_interactions'),
    operations: await count(core.db, 'wallet_operations'),
    transactions: await count(core.db, 'wallet_transactions'),
  });
  const admit = (key: string) =>
    bonk.admit({
      idempotency_key: key,
      channel_id: CHANNEL,
      viewer: VIEWER,
      lab_session_id: 'lab-1',
      emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
    });
  return { core, bonk, fund, balance, rows, admit };
}

const failure = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: Error & { code?: string }) =>
      e instanceof LabWalletError || e instanceof BonkLabError409
        ? e.code
        : e.message,
  );

describe('Core Wallet debit + admission in one transaction (ASTRA-P1-001 lot 1)', () => {
  it('sufficient balance: debited exactly once, interaction admitted, traceable from the interaction', async () => {
    const f = await fixture();
    await f.fund(1000);
    const before = await f.rows();
    const { interaction } = await f.admit('k-1');
    expect(interaction.status).toBe('queued');
    expect(await f.balance()).toBe(1000 - PRICE);
    expect(await f.rows()).toEqual({
      interactions: before.interactions + 1,
      operations: before.operations + 1,
      transactions: before.transactions + 1,
    });
    const leg = await f.core.db.query<{
      amount: string;
      source: string;
      reference: string;
    }>(
      `select t.amount, t.source, t.reference from wallet_transactions t
       join wallet_operations o on o.id = t.operation_id where o.idempotency_key = $1`,
      [`interaction:${interaction.interaction_id}:debit`],
    );
    expect(leg).toHaveLength(1);
    expect(Number(leg[0]!.amount)).toBe(-PRICE);
    expect(leg[0]).toMatchObject({
      source: 'bonk',
      reference: interaction.interaction_id,
    });
  });

  it('insufficient balance: nothing debited, nothing admitted, no committed refusal — a retry after a top-up passes', async () => {
    const f = await fixture();
    await f.fund(PRICE - 1);
    const before = await f.rows();
    expect(await failure(f.admit('k-poor'))).toBe('insufficient_tokens');
    expect(await f.balance()).toBe(PRICE - 1);
    expect(await f.rows()).toEqual(before); // not even a « rejected » wallet operation
    await f.fund(1);
    expect((await f.admit('k-poor')).interaction.status).toBe('queued');
    expect(await f.balance()).toBe(0);
  });

  it('debit applied, then a failure later in the same transaction: full rollback (balance, wallet rows, interaction, viewer)', async () => {
    const f = await fixture((core) => {
      const real = coreWalletEconomy(core.wallet.wallet);
      return {
        ...real,
        debit: async (...args) => {
          await real.debit(...args);
          throw new Error('boom after debit');
        },
      };
    });
    const before = await f.rows();
    const viewers = await count(f.core.db, 'viewers');
    // A viewer the Wallet has never seen: its row is created inside the transaction too.
    await f.core.wallet.wallet.credit({
      key: 'other',
      viewer: { twitchUserId: '900999', login: 'other', displayName: 'Other' },
      amount: 1,
      source: 'test',
    });
    await f.fund(1000);
    const funded = await f.rows();
    expect(await failure(f.admit('k-boom'))).toBe('boom after debit');
    expect(await f.balance()).toBe(1000);
    expect(await f.rows()).toEqual(funded);
    expect(funded.interactions).toBe(before.interactions);
    expect(await count(f.core.db, 'viewers')).toBe(viewers + 2);
  });

  it('same request again (lost answer, double click): replayed, one debit; same key, other payload: refused, no debit', async () => {
    const f = await fixture();
    await f.fund(1000);
    const first = await f.admit('k-dup');
    const again = await f.admit('k-dup');
    expect(again.replayed).toBe(true);
    expect(again.interaction.interaction_id).toBe(
      first.interaction.interaction_id,
    );
    // Concurrent duplicates: serialized by the channel lock, the second one is a replay.
    const [x, y] = await Promise.all([f.admit('k-race'), f.admit('k-race')]);
    expect(x.interaction.interaction_id).toBe(y.interaction.interaction_id);
    expect(await f.balance()).toBe(1000 - 2 * PRICE);
    const other = f.bonk.admit({
      idempotency_key: 'k-dup',
      channel_id: CHANNEL,
      viewer: VIEWER,
      lab_session_id: 'lab-1',
      emote: { provider: 'unicode', id: 'unicode:1f60b', glyph: '😋' },
    });
    expect(await failure(other)).toBe('idempotency_conflict');
    expect(await f.balance()).toBe(1000 - 2 * PRICE);
  });

  it('refund: exactly the debit, once, in the transaction of the decision; never-debited → nothing credited', async () => {
    const f = await fixture();
    await f.fund(1000);
    const { interaction } = await f.admit('k-refund');
    const claimed = (await f.bonk.claim(STUDIO, CHANNEL))!;
    // Failed before being shown → refunded automatically (existing rule), through the Core Wallet.
    await f.bonk.ack(interaction.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: claimed.delivery.attempt_id!,
      event: 'failed',
    });
    expect(await f.balance()).toBe(1000);
    const refunded = await f.bonk.get(interaction.interaction_id);
    expect(refunded.refund_status).toBe('refunded');
    // Replayed ACK: no second refund.
    await f.bonk.ack(interaction.interaction_id, {
      studio_instance_id: STUDIO,
      attempt_id: claimed.delivery.attempt_id!,
      event: 'failed',
    });
    expect(await f.balance()).toBe(1000);
    const port = coreWalletEconomy(f.core.wallet.wallet);
    expect(
      await f.core.db.tx((q) =>
        port.refund(
          q,
          new Date(),
          '00000000-0000-4000-8000-000000000000',
          'test',
          'never debited',
        ),
      ),
    ).toEqual({ amount: 0, currency: null });
  });

  it('ACK lifecycle unchanged: started → completed keeps the debit (no refund)', async () => {
    const f = await fixture();
    await f.fund(1000);
    const { interaction } = await f.admit('k-ok');
    const claimed = (await f.bonk.claim(STUDIO, CHANNEL))!;
    for (const event of ['started', 'completed'] as const)
      await f.bonk.ack(interaction.interaction_id, {
        studio_instance_id: STUDIO,
        attempt_id: claimed.delivery.attempt_id!,
        event,
      });
    expect((await f.bonk.get(interaction.interaction_id)).status).toBe(
      'completed',
    );
    expect(await f.balance()).toBe(1000 - PRICE);
  });

  it('Soundboard and TTS on the same contract: Jetons debited atomically; credits refused (model pending), nothing stored', async () => {
    const core = await setup();
    const port = coreWalletEconomy(core.wallet.wallet);
    const sound = new SoundLabService(core.db, core.clock, Math.random, port);
    const tts = new TtsLabService(
      core.db,
      core.clock,
      Math.random,
      undefined,
      port,
    );
    await sound.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
    await tts.heartbeat({ studio_instance_id: STUDIO, player_ready: true });
    await core.wallet.wallet.credit({
      key: 'fund',
      viewer: {
        twitchUserId: VIEWER.id,
        login: 'viewer_test',
        displayName: VIEWER.display_name,
      },
      amount: 100_000,
      source: 'test',
    });
    const base = {
      channel_id: CHANNEL,
      viewer: VIEWER,
      lab_session_id: 'lab-1',
    };
    const s = await sound.admit({
      ...base,
      idempotency_key: 's-1',
      sound_id: 'boop',
      payment_method: 'tokens',
    });
    const t = await tts.admit({
      ...base,
      idempotency_key: 't-1',
      text: 'Bonjour Raptoru',
      payment_method: 'tokens',
    });
    const spent =
      100_000 - ((await core.wallet.wallet.getWallet(VIEWER.id))?.balance ?? 0);
    expect(spent).toBe(
      s.interaction.simulated_cost + t.interaction.simulated_cost,
    );
    const before = {
      sound: await count(core.db, 'sound_lab_interactions'),
      tts: await count(core.db, 'tts_lab_interactions'),
    };
    expect(
      await failure(
        sound.admit({
          ...base,
          idempotency_key: 's-2',
          sound_id: 'boop',
          payment_method: 'credits',
        }),
      ),
    ).toBe('economy_unavailable');
    expect(
      await failure(
        tts.admit({
          ...base,
          // Another viewer (one TTS per viewer at a time is a TTS rule, not the economy).
          viewer: { id: '900102', display_name: 'Other Viewer' },
          idempotency_key: 't-2',
          text: 'Encore',
          payment_method: 'credits',
        }),
      ),
    ).toBe('economy_unavailable');
    expect(await count(core.db, 'sound_lab_interactions')).toBe(before.sound);
    expect(await count(core.db, 'tts_lab_interactions')).toBe(before.tts);
  });

  it('Lab untouched: the default economy is still the Lab test wallet, the Core Wallet never moves', async () => {
    const core = await setup();
    expect(labEconomy).toBeDefined();
    const bonk = new BonkLabService(core.db, core.clock); // default = labEconomy
    await bonk.heartbeat({
      studio_instance_id: STUDIO,
      obs: 'connected',
      source_ready: true,
      overlay_ready: true,
    });
    const wallet = await count(core.db, 'wallet_transactions');
    await bonk.admit({
      idempotency_key: 'lab-1',
      channel_id: CHANNEL,
      viewer: VIEWER,
      lab_session_id: 'lab-1',
      emote: { provider: 'unicode', id: 'unicode:1f600', glyph: '😀' },
    });
    expect(await count(core.db, 'wallet_transactions')).toBe(wallet);
    expect(await count(core.db, 'lab_wallet_ledger')).toBeGreaterThan(0);
  });
});
