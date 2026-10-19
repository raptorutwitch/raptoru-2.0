import { randomUUID } from 'node:crypto';
import type { LabActor, LabModerationCommand } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import {
  DeferredWalletCreditProvider,
  WalletCreditProvider,
} from '../src/daily/credits.js';
import { economyPreflight, selectEconomy } from '../src/economy/activation.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { LabModerationService } from '../src/lab-moderation/service.js';
import { LabForbiddenError } from '../src/lab-moderation/store.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import {
  claimAt,
  count,
  goLive,
  paris,
  setup,
  viewer,
  type TestCore,
} from './helpers.js';

// Phase 2 lot 6: the transversal Jetons flows on the CANONICAL Wallet — moderation « Créditer / Débiter » (bounded at 0,
// deduplicated, audited, permissions unchanged), chat !give (keyed by the Twitch message), Daily credits never said
// « credited » without money (B5), Loyalty events of the previous economy never paid again (cutover boundary), and the
// activation preflight. Test databases only; no flag of a real runtime is touched.

const CH = '901400';
const V = '901401';
const studio: LabActor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const mod: LabActor = {
  id: '901402',
  login: 'modo',
  role: 'moderator',
  via: 'extension',
};
const tokens = async (core: TestCore, id = V) =>
  (await core.wallet.wallet.getWallet(id))?.balance ?? 0;
const fund = (core: TestCore, amount: number, id = V) =>
  core.wallet.wallet.credit({
    key: `fund-${randomUUID()}`,
    viewer: viewer(id, `V${id}`),
    amount,
    source: 'test',
  });
const importOpening = (core: TestCore, cutoff: string) =>
  core.db.query(
    `insert into wallet_imports (id, currency_id, source, cutoff, snapshot_sha256, accounts, total)
     values ('se-test', 'main', 'streamelements', $1, $2, 0, 0)`,
    [cutoff, 'a'.repeat(64)],
  );

describe('moderation « Créditer / Débiter » on the canonical Wallet', () => {
  async function moderation() {
    const core = await setup();
    const port = coreWalletEconomy(core.wallet.wallet);
    const m = new LabModerationService(
      core.db,
      core.clock,
      core.ttsLab,
      core.soundLab,
      core.bonkLab,
      core.raffleLab,
      port,
    );
    const adjust = (
      delta: number,
      o: { actor?: LabActor; key?: string; currency?: string } = {},
    ) =>
      m.act(CH, {
        actor: o.actor ?? studio,
        idempotency_key: o.key ?? `adjust-${randomUUID()}`,
        command: {
          action: 'wallet_adjust',
          viewer_id: V,
          currency: o.currency ?? 'tokens',
          delta,
          reason: 'test modération',
        } as LabModerationCommand,
      });
    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: Error & { code?: string }) =>
          e instanceof LabForbiddenError ? 'forbidden' : (e.code ?? e.message),
      );
    return { core, m, adjust, code };
  }

  it('credit and debit: exact, on the Core ledger with actor and reason, audited, shown in D4 and on the viewer card', async () => {
    const { core, m, adjust } = await moderation();
    expect(await adjust(1_000)).toMatchObject({
      ok: true,
      applied: 1_000,
      wallet: { tokens: 1_000, credits_tts: 0 },
    });
    expect(await adjust(-300)).toMatchObject({
      applied: -300,
      wallet: { tokens: 700 },
    });
    expect(await tokens(core)).toBe(700);
    const legs = await core.db.query<{
      kind: string;
      amount: number;
      actor: string;
      reason: string;
    }>(
      "select kind, amount, actor, reason from wallet_transactions where source = 'admin' order by id",
    );
    expect(legs).toEqual([
      {
        kind: 'admin_add',
        amount: 1_000,
        actor: 'studio:antoni',
        reason: 'test modération',
      },
      {
        kind: 'admin_remove',
        amount: -300,
        actor: 'studio:antoni',
        reason: 'test modération',
      },
    ]);
    expect(
      await count(
        core.db,
        "lab_moderation_audit where action = 'wallet_adjust'",
      ),
    ).toBe(2);
    expect((await m.ledger(CH, { viewer: V })).items[0]).toMatchObject({
      kind: 'admin',
      label: 'Ajustement admin',
      amount: -300,
    });
    expect((await m.viewer(CH, V))!.wallet).toMatchObject({ tokens: 700 });
    expect(await count(core.db, 'lab_wallet_ledger')).toBe(0);
  });

  it('a debit never makes the balance negative: bounded to what is there; nothing left → « nothing_to_debit »', async () => {
    const { core, adjust, code } = await moderation();
    await fund(core, 200);
    expect(await adjust(-500)).toMatchObject({
      applied: -200,
      wallet: { tokens: 0 },
    });
    expect(await code(adjust(-1))).toBe('nothing_to_debit');
    expect(await tokens(core)).toBe(0);
  });

  it('permissions unchanged: a moderator without the « wallet » grant is refused, nothing moves', async () => {
    const { core, m, adjust, code } = await moderation();
    await m.whoami(CH, mod);
    expect(await code(adjust(100, { actor: mod }))).toBe('forbidden');
    expect(await tokens(core)).toBe(0);
  });

  it('the same action replayed (lost answer, double click) adjusts once; credits are never converted to Jetons', async () => {
    const { core, adjust } = await moderation();
    const key = `adjust-${randomUUID()}`;
    await adjust(250, { key });
    await adjust(250, { key });
    expect(await tokens(core)).toBe(250);
    expect(
      await count(core.db, "wallet_transactions where source = 'admin'"),
    ).toBe(1);
    // Credits are their own currency: adjusted in it, never converted to Jetons.
    expect(await adjust(5, { currency: 'credits_tts' })).toMatchObject({
      applied: 5,
      wallet: { tokens: 250, credits_tts: 5, credits_soundboard: 0 },
    });
    expect(await tokens(core)).toBe(250);
  });
});

describe('chat !give on the canonical Wallet (keyed by the Twitch message)', () => {
  it('a transfer, the same message again (redelivery, restarted bot): one transfer; an empty wallet is refused', async () => {
    const core = await setup();
    await fund(core, 500);
    const give = (requestId: string, amount = 200) =>
      core.wallet.chat.transfer({
        requestId,
        from: viewer(V, 'Alice'),
        to: viewer('901403', 'Bob'),
        amount,
      });
    await give('twitch-msg-1');
    await give('twitch-msg-1');
    expect([await tokens(core), await tokens(core, '901403')]).toEqual([
      300, 200,
    ]);
    const refused = await give('twitch-msg-2', 10_000);
    expect(refused.result).toMatchObject({
      status: 'rejected',
      rejection: 'insufficient_funds',
    });
    expect([await tokens(core), await tokens(core, '901403')]).toEqual([
      300, 200,
    ]);
  });
});

describe('Daily credits off (B5): never « credited » without money', () => {
  const alice = viewer('1001', 'Alice');

  it('a claim keeps its credit pending for the Core Wallet, nothing sent; switched on, it is paid exactly once', async () => {
    const off = await setup({ provider: new DeferredWalletCreditProvider() });
    await goLive(off, 'live-1', paris('2026-09-24', 20));
    const res = await claimAt(
      off,
      alice,
      paris('2026-09-24', 21),
      'msg-daily-1',
    );
    expect(res).toMatchObject({ outcome: 'claimed', reward: 500 });
    await off.credits.retryTick();
    expect(await off.credits.recoverInterrupted()).toBe(0);
    const [attempt] = await off.daily.attempts(alice.twitchUserId);
    expect(attempt).toMatchObject({
      credit_status: 'pending',
      credit_provider: 'core-wallet',
    });
    expect(await count(off.db, 'wallet_operations')).toBe(0);
    // The same !daily again (redelivery): no second claim.
    expect(
      (await claimAt(off, alice, paris('2026-09-24', 21, 5), 'msg-daily-1'))
        .reward,
    ).toBe(500);
    expect(await count(off.db, 'daily_credits')).toBe(1);
    // Wallet credits switched on (restart with the real provider), then twice more: one payment.
    const on = await setup({
      db: off.db,
      clock: off.clock,
      provider: new WalletCreditProvider(off.db),
    });
    expect(await on.credits.recoverInterrupted()).toBe(0);
    await on.credits.processPending();
    await on.credits.retryTick();
    await setup({
      db: off.db,
      clock: off.clock,
      provider: new WalletCreditProvider(off.db),
    }).then((c) => c.credits.processPending());
    expect(await tokens(on, '1001')).toBe(500);
    expect(await count(on.db, 'wallet_operations')).toBe(1);
    expect(
      (await on.daily.attempts(alice.twitchUserId)).find(
        (a) => a.outcome === 'claimed',
      ),
    ).toMatchObject({
      credit_status: 'credited',
    });
  });
});

describe('Loyalty events across the cutover boundary', () => {
  const aouh = viewer('2001', 'Aouh');
  const sub = (eventId: string, occurredAt?: string) => ({
    type: 'sub' as const,
    eventId,
    viewer: aouh,
    tier: 't1' as const,
    isGift: false,
    ...(occurredAt ? { occurredAt } : {}),
  });

  it('an event that happened before the opening cutoff is recorded excluded, never paid; after it, paid once', async () => {
    const core = await setup({ loyalty: { eventCredits: true } });
    await importOpening(core, '2026-11-01T03:00:00.000Z');
    const before = await core.loyalty.handleEvent(
      sub('evt-old', '2026-11-01T02:59:00.000Z'),
    );
    expect(before).toMatchObject({
      status: 'excluded',
      reason: 'before_cutover',
    });
    const after = await core.loyalty.handleEvent(
      sub('evt-new', '2026-11-01T03:01:00.000Z'),
    );
    expect(after.status).toBe('pending'); // sent to the Wallet right after the answer
    expect(await tokens(core, '2001')).toBe(after.amount);
    // The same event redelivered with another Twitch time: a replay, never a conflict, never a second credit.
    expect(
      await core.loyalty.handleEvent(
        sub('evt-new', '2026-11-01T03:05:00.000Z'),
      ),
    ).toMatchObject({ replayed: true });
    expect(await count(core.db, 'wallet_transactions')).toBe(1);
    expect(await tokens(core, '2001')).toBe(after.amount);
  });

  it('flags off (freeze): rewards stay previews, never become payable; nothing reaches the Wallet', async () => {
    const core = await setup({ loyalty: { preview: true } });
    expect(
      (await core.loyalty.handleEvent(sub('evt-p', '2026-11-01T03:01:00.000Z')))
        .status,
    ).toBe('preview');
    expect(await core.loyalty.processPending()).toBe(0);
    expect(await count(core.db, 'wallet_transactions')).toBe(0);
  });
});

describe('activation preflight (one economy at a time)', () => {
  it('blocks without an opening import and while wheel gains of the previous economy are not reconciled; lists what waits', async () => {
    const core = await setup({ provider: new DeferredWalletCreditProvider() });
    expect((await economyPreflight(core.db)).blocking).toEqual([
      "aucun import d'ouverture appliqué à la monnaie principale",
      "aucun import d'ouverture appliqué à credits_tts (crédits historiques à reprendre, vide si aucun)",
      "aucun import d'ouverture appliqué à credits_soundboard (crédits historiques à reprendre, vide si aucun)",
    ]);
    // A real sub during the previous economy: a pending wheel gain (nothing credited by the Lab / pre-cutover runtime).
    const wheel = new SubWheelService(core.db, core.clock, () => 0);
    await wheel.setEnabled(CH, true);
    const spin = (await wheel.fromAlert(
      {
        channel_id: CH,
        source: 'twitch',
        source_event_id: randomUUID(),
        type: 'sub',
        actor: { id: V, login: 'v', display_name: 'V' },
        tier: '1000',
      },
      null,
    ))!;
    await goLive(core, 'live-1', paris('2026-09-24', 20));
    await claimAt(core, viewer('1001', 'Alice'), paris('2026-09-24', 21));
    core.clock.set(paris('2026-09-25', 12));
    await importOpening(core, core.clock.now().toISOString());
    // The historical credits: none in this source (empty imports, recorded).
    for (const c of ['credits_tts', 'credits_soundboard'])
      await core.db.query(
        `insert into wallet_imports (id, currency_id, source, cutoff, snapshot_sha256, accounts, total)
         values ($1, $2, 'test', now(), $3, 0, 0)`,
        [`legacy-${c}`, c, 'b'.repeat(64)],
      );
    const p = await economyPreflight(core.db);
    expect(p.blocking).toEqual([
      expect.stringMatching(/1 gain\(s\) de la Roue du Sub d'avant la bascule/),
    ]);
    expect(p.pending.dailyCredits).toEqual({ count: 1, amount: 500 });
    await expect(
      selectEconomy({
        mode: 'canonical',
        q: core.db,
        wallet: core.wallet.wallet,
        modules: ['sub_wheel'],
      }),
    ).rejects.toThrow(/Roue du Sub/);
    // Reconciled (cancelled: paid by StreamElements): the canonical economy may start.
    await wheel.settleByHand(spin.spin_id, {
      status: 'cancelled',
      note: 'payé par StreamElements',
    });
    expect((await economyPreflight(core.db)).blocking).toEqual([]);
    expect(
      (
        await selectEconomy({
          mode: 'canonical',
          q: core.db,
          wallet: core.wallet.wallet,
          modules: ['sub_wheel', 'moderation_wallet'],
        })
      ).mode,
    ).toBe('canonical');
  });
});
