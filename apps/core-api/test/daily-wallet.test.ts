import { describe, expect, it } from 'vitest';
import {
  WalletCreditProvider,
  type CreditProvider,
} from '../src/daily/credits.js';
import {
  claimAt,
  count,
  endLive,
  goLive,
  paris,
  setup,
  viewer,
  type TestCore,
} from './helpers.js';

const alice = viewer('1001', 'Alice');
const bob = viewer('1002', 'Bob');

/** Core whose Daily credits go to the Core Wallet (DAILY_WALLET_CREDITS=true). */
async function walletCore(base?: TestCore, provider?: CreditProvider) {
  const first = base ?? (await setup());
  return setup({
    db: first.db,
    clock: first.clock,
    provider: provider ?? new WalletCreditProvider(first.db),
  });
}

const balance = async (core: TestCore, id: string) =>
  Number(
    (
      await core.db.query<{ balance: string }>(
        "select balance from wallets where twitch_user_id = $1 and currency_id = 'main'",
        [id],
      )
    )[0]?.balance ?? 0,
  );

const walletOps = (core: TestCore) =>
  core.db.query<{ idempotency_key: string; status: string }>(
    'select idempotency_key, status from wallet_operations order by id',
  );

const setDailyConfig = (core: TestCore, base: number, perStreak = 150) =>
  core.db.query(
    `insert into daily_config (id, config) values (1, $1)
     on conflict (id) do update set config = excluded.config`,
    [JSON.stringify({ reward: { base, perStreak, max: 2000 } })],
  );

describe('Daily → Wallet: modes', () => {
  it('preview (flag off): the claim is real and journaled, zero Wallet write', async () => {
    const core = await setup(); // dev-fake provider = DAILY_WALLET_CREDITS=false
    await goLive(core, 'live-1', paris('2026-09-24', 20));
    const res = await claimAt(core, alice, paris('2026-09-24', 21));
    expect(res).toMatchObject({ outcome: 'claimed', reward: 500 });
    for (const t of ['wallets', 'wallet_operations', 'wallet_transactions'])
      expect(await count(core.db, t)).toBe(0);
    const [attempt] = await core.daily.attempts(alice.twitchUserId);
    expect(attempt).toMatchObject({
      credit_provider: 'dev-fake',
      credit_key: expect.stringMatching(/^daily-claim:\d+$/),
      wallet_operation_id: null,
      breakdown: { streak: 1, base: 500, bonus: 0, final: 500 },
    });
  });

  it('wallet credit (flag on): one Wallet reward per claim, traceable from the claim', async () => {
    const core = await walletCore();
    await goLive(core, 'live-1', paris('2026-09-24', 20));
    await claimAt(core, alice, paris('2026-09-24', 21));

    expect(await balance(core, '1001')).toBe(500);
    const [attempt] = await core.daily.attempts(alice.twitchUserId);
    expect(attempt).toMatchObject({
      credit_status: 'credited',
      credit_provider: 'core-wallet',
      breakdown: {
        streak: 1,
        streakBefore: 0,
        base: 500,
        perStreak: 150,
        max: 2000,
        bonus: 0,
        capped: false,
        final: 500,
      },
    });
    const [tx] = await core.db.query(
      `select t.amount, t.kind, t.source, t.reference, o.idempotency_key, o.id
       from wallet_transactions t join wallet_operations o on o.id = t.operation_id`,
    );
    expect(Number(tx!.amount)).toBe(500);
    expect(tx).toMatchObject({
      kind: 'reward',
      source: 'daily',
      reference: attempt!.credit_key,
      idempotency_key: attempt!.credit_key,
    });
    expect(Number(tx!.id)).toBe(Number(attempt!.wallet_operation_id));
    // The Wallet never overwrites the viewer's display name with the login.
    expect(
      (
        await core.db.query(
          "select display_name from viewers where twitch_user_id = '1001'",
        )
      )[0],
    ).toEqual({ display_name: 'Alice' });
  });
});

describe('Daily → Wallet: idempotency and failures', () => {
  it('double click, same message twice, concurrent claims: exactly one Wallet operation', async () => {
    const core = await walletCore();
    await goLive(core, 'live-1', paris('2026-09-24', 20));
    core.clock.set(paris('2026-09-24', 21));
    await Promise.all([
      ...Array.from({ length: 8 }, (_, i) =>
        core.daily.claim({ viewer: alice, requestId: `click-${i}` }),
      ),
      core.daily.claim({ viewer: bob, requestId: 'same' }),
      core.daily.claim({ viewer: bob, requestId: 'same' }),
    ]);
    expect((await walletOps(core)).map((o) => o.status)).toEqual([
      'applied',
      'applied',
    ]);
    expect([await balance(core, '1001'), await balance(core, '1002')]).toEqual([
      500, 500,
    ]);
  });

  it('Wallet unavailable: the credit stays pending and is paid once on the next run', async () => {
    const base = await setup();
    const wallet = new WalletCreditProvider(base.db);
    let down = true;
    const flaky: CreditProvider = {
      name: wallet.name,
      idempotent: true,
      credit: (r) =>
        down ? Promise.reject(new Error('wallet down')) : wallet.credit(r),
    };
    const core = await walletCore(base, flaky);
    await goLive(core, 'live-1', paris('2026-09-24', 20));
    const res = await claimAt(core, alice, paris('2026-09-24', 21));
    expect(res.outcome).toBe('claimed'); // the Daily itself stays valid
    expect(await count(core.db, 'wallet_operations')).toBe(0);
    expect((await core.daily.attempts(alice.twitchUserId))[0]).toMatchObject({
      credit_status: 'pending',
      credit_error: 'wallet down',
    });

    down = false;
    await claimAt(core, bob, paris('2026-09-24', 21, 5)); // next claim runs the queue
    await core.credits.processPending();
    expect(await balance(core, '1001')).toBe(500);
    expect(await balance(core, '1002')).toBe(500);
    expect(await count(core.db, 'wallet_operations')).toBe(2);
  });

  it('Core restart between the claim and the Wallet write, and during the write: paid exactly once', async () => {
    const base = await setup();
    await goLive(base, 'live-1', paris('2026-09-24', 20));
    // Crash 1: claim committed, credit never sent (hung provider → 'sending').
    const hung = await walletCore(base, {
      name: 'core-wallet',
      idempotent: true,
      credit: () => new Promise<never>(() => {}),
    });
    base.clock.set(paris('2026-09-24', 21));
    void hung.daily.claim({ viewer: alice, requestId: 'a' });
    await new Promise((r) => setTimeout(r, 50));
    // Crash 2: the Wallet write committed, but Core died before marking the credit.
    const applied = await walletCore(base, {
      name: 'core-wallet',
      idempotent: true,
      credit: async (r) => {
        await new WalletCreditProvider(base.db).credit(r);
        return new Promise<never>(() => {});
      },
    });
    void applied.daily.claim({ viewer: bob, requestId: 'b' });
    await new Promise((r) => setTimeout(r, 50));
    expect(
      (
        await base.db.query(
          'select status from daily_credits order by claim_id',
        )
      ).map((r) => r.status),
    ).toEqual(['sending', 'sending']);

    const restarted = await walletCore(base);
    expect(await restarted.credits.recoverInterrupted()).toBe(2);
    await restarted.credits.processPending();
    await restarted.credits.processPending();

    expect([await balance(base, '1001'), await balance(base, '1002')]).toEqual([
      500, 500,
    ]);
    expect(await count(base.db, 'wallet_operations')).toBe(2); // bob's resend was a replay
    expect(
      (
        await base.db.query(
          'select status from daily_credits order by claim_id',
        )
      ).map((r) => r.status),
    ).toEqual(['credited', 'credited']);
  });

  it('several Cores sending the same pending credits: one Wallet operation each', async () => {
    const base = await setup();
    await goLive(base, 'live-1', paris('2026-09-24', 20));
    // Claims recorded while no credit is sent (as if the sender were down).
    const quiet = await walletCore(base, {
      name: 'core-wallet',
      idempotent: true,
      credit: () => Promise.reject(new Error('down')),
    });
    const people = Array.from({ length: 6 }, (_, i) =>
      viewer(String(3000 + i), `P${i}`),
    );
    for (const p of people) await claimAt(quiet, p, paris('2026-09-24', 21));
    const cores = await Promise.all([1, 2, 3].map(() => walletCore(base)));
    await Promise.all(cores.map((c) => c.credits.processPending()));
    expect(await count(base.db, 'wallet_operations')).toBe(6);
    for (const p of people)
      expect(await balance(base, p.twitchUserId)).toBe(500);
  });
});

describe('Daily → Wallet: periodic retry (every Core, every minute)', () => {
  it('pays a pending credit without any new claim or restart; requeues only stale interrupted sends', async () => {
    const base = await setup();
    await goLive(base, 'live-1', paris('2026-09-24', 20));
    // Alice: Wallet down at claim time → pending. Bob: a crashed Core left it 'sending' long ago.
    // Cid: another Core is sending it right now (recent 'sending'): must be left alone.
    const down = await walletCore(base, {
      name: 'core-wallet',
      idempotent: true,
      credit: () => Promise.reject(new Error('wallet down')),
    });
    const cid = viewer('1003', 'Cid');
    for (const v of [alice, bob, cid])
      await claimAt(down, v, paris('2026-09-24', 21));
    await base.db.query(
      `update daily_credits set status = 'sending', updated_at = now() - interval '10 minutes'
       where twitch_user_id = '1002'`,
    );
    await base.db.query(
      "update daily_credits set status = 'sending', updated_at = now() where twitch_user_id = '1003'",
    );

    const running = await walletCore(base); // a Core that never restarted
    await running.credits.retryTick();
    await running.credits.retryTick(); // no-op: nothing paid twice

    expect(
      await base.db.query(
        'select twitch_user_id, status from daily_credits order by twitch_user_id',
      ),
    ).toEqual([
      { twitch_user_id: '1001', status: 'credited' },
      { twitch_user_id: '1002', status: 'credited' },
      { twitch_user_id: '1003', status: 'sending' },
    ]);
    expect([await balance(base, '1001'), await balance(base, '1002')]).toEqual([
      500, 500,
    ]);
    expect(await count(base.db, 'wallet_operations')).toBe(2);
  });

  it('preview provider: the sweep never writes to the Wallet', async () => {
    const core = await setup(); // dev-fake
    await goLive(core, 'live-1', paris('2026-09-24', 20));
    await claimAt(core, alice, paris('2026-09-24', 21));
    await core.credits.retryTick();
    expect(await count(core.db, 'wallet_operations')).toBe(0);
  });
});

describe('Daily → Wallet: product rules unchanged', () => {
  it('streaks, stream-days, 16:00, several lives, non-eligible claims and config changes', async () => {
    const core = await walletCore();
    const claims: [string, number][] = [];
    const claim = async (v: typeof alice, at: Date) => {
      const res = await claimAt(core, v, at);
      claims.push([`${v.login} ${res.outcome}`, res.reward]);
      return res;
    };

    // Outside a live: not eligible.
    await claim(alice, paris('2026-09-24', 19));
    // Stream-day 24: first claims.
    await goLive(core, 'd24', paris('2026-09-24', 20));
    await claim(alice, paris('2026-09-24', 20, 30));
    await claim(bob, paris('2026-09-24', 20, 31));
    await endLive(core, paris('2026-09-24', 23));
    // Second live in the same stream-day (before 16:00 next day): no second Daily.
    await goLive(core, 'd24-bis', paris('2026-09-25', 14));
    await claim(alice, paris('2026-09-25', 14, 30));
    // Crossing 16:00 during that live: still stream-day 24.
    await claim(alice, paris('2026-09-25', 16, 30));
    await endLive(core, paris('2026-09-25', 17));
    // Config changed between two claims.
    await setDailyConfig(core, 1000);
    // Stream-day 25: alice streak 2 (new config), bob skips it.
    await goLive(core, 'd25', paris('2026-09-25', 20));
    await claim(alice, paris('2026-09-25', 20, 30));
    await endLive(core, paris('2026-09-25', 23));
    // Stream-day 26: alice streak 3; bob comes back → streak reset to 1.
    await goLive(core, 'd26', paris('2026-09-26', 20));
    await claim(alice, paris('2026-09-26', 20, 30));
    await claim(bob, paris('2026-09-26', 20, 31));

    expect(claims).toEqual([
      ['alice no_active_stream', 0],
      ['alice claimed', 500],
      ['bob claimed', 500],
      ['alice already_claimed', 0],
      ['alice already_claimed', 0],
      ['alice claimed', 1150], // 1000 + 150 × 1
      ['alice claimed', 1300],
      ['bob claimed', 1000], // streak reset
    ]);
    // Wallet = exactly the claimed rewards, one operation per claim.
    expect(await balance(core, '1001')).toBe(500 + 1150 + 1300);
    expect(await balance(core, '1002')).toBe(500 + 1000);
    expect(await count(core.db, 'wallet_operations')).toBe(5);

    // History keeps each claim's own calculation: the config change re-priced nothing.
    const frozen = await core.db.query<{
      stream_day: string;
      breakdown: object;
    }>(
      "select to_char(stream_day, 'YYYY-MM-DD') as stream_day, breakdown from daily_claims where twitch_user_id = '1001' order by stream_day",
    );
    expect(frozen).toEqual([
      {
        stream_day: '2026-09-24',
        breakdown: expect.objectContaining({
          streak: 1,
          base: 500,
          final: 500,
        }),
      },
      {
        stream_day: '2026-09-25',
        breakdown: expect.objectContaining({
          streak: 2,
          streakBefore: 1,
          base: 1000,
          bonus: 150,
          final: 1150,
        }),
      },
      {
        stream_day: '2026-09-26',
        breakdown: expect.objectContaining({
          streak: 3,
          bonus: 300,
          final: 1300,
        }),
      },
    ]);
  });
});
