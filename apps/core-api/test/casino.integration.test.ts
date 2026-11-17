// Casino (docs/CASINO.md) on a real Postgres with two Cores (two pools): one intent sent 10 times at once from both →
// one round, one debit; 20 different intents with money for 5 → exactly 5, never below 0, the ledger agrees with the
// balance; the canonical Wallet the same; a failure inside the spin's transaction (a crash) → nothing debited.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted. Fictional data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seededRng, type IntRng } from '../src/casino/rng.js';
import {
  CASINO_SETTINGS,
  CasinoError,
  CasinoService,
} from '../src/casino/service.js';
import { evaluate, STRIPS, windowAt } from '../src/casino/slot.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import {
  coreWalletEconomy,
  labEconomy,
  type EconomyPort,
} from '../src/economy/economy.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { ModuleSettings } from '../src/module-settings/service.js';
import { createWalletModule } from '../src/wallet/index.js';
import { FakeClock } from './helpers.js';
import { openCanonicalLive } from './live.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '900441';
const V = { id: '900442', display_name: 'Joueur Fictif' };

/** Spins that pay nothing (and open no Coffre): the balance arithmetic is exact. */
const LOSING = (() => {
  const rng = seededRng(77);
  for (;;) {
    const s = STRIPS.map((x) => rng.int(x.length));
    const ev = evaluate(windowAt(s), 100);
    if (ev.total === 0 && ev.scatter.count < 3) return s;
  }
})();
const losingRng = (): IntRng => {
  let i = 0;
  return { int: (n) => LOSING[i++ % 5]! % n };
};

describe.skipIf(!isLocal)('casino, real Postgres, two Cores', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;
  const clock = new FakeClock(new Date('2026-12-01T20:00:00Z'));
  const settingsOf = (db: Db) => {
    const s = new ModuleSettings(db, clock);
    s.register(
      Object.fromEntries(
        Object.entries(CASINO_SETTINGS).map(([k, v]) => [`casino.${k}`, v]),
      ),
    );
    return s;
  };
  const casino = (db: Db, economy: EconomyPort = labEconomy) => {
    const c = new CasinoService(db, clock, economy, settingsOf(db));
    c.rng = losingRng();
    return c;
  };
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    b = createPgDb(url!);
    await settingsOf(a).set(CH, 'casino.open', 1, 'test');
    await a.query(
      `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
       values (gen_random_uuid(), $1, $2, 'simulated', 'test')`,
      [CH, clock.now()],
    );
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    await b?.close();
    await a?.close();
    await unlock?.();
  });
  const labTokens = async () =>
    Number(
      (
        await a.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, V.id],
        )
      )[0]!.tokens,
    );

  it('ONE intent sent 10 times at once from two Cores: one round, one debit; the others replay it', async () => {
    await editWallet(
      a,
      clock.now(),
      CH,
      V.id,
      'set',
      { tokens: 10_000 },
      'test',
    );
    const [A, B] = [casino(a), casino(b)];
    const out = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 ? A : B).spinSlot(CH, V, {
          key: 'intent-once-casino',
          bet: 100,
        }),
      ),
    );
    const ok = out.filter(
      (r) => r.status === 'fulfilled',
    ) as PromiseFulfilledResult<
      Awaited<ReturnType<CasinoService['spinSlot']>>
    >[];
    expect(ok.length).toBeGreaterThanOrEqual(9); // a lost race may answer « idempotency_conflict »: never a payment
    expect(new Set(ok.map((r) => r.value.round.round_id)).size).toBe(1);
    expect(await labTokens()).toBe(9_900);
    expect(await a.query('select 1 from casino_rounds')).toHaveLength(1);
  });

  it('20 different intents from two Cores with money for 5: exactly 5 rounds, 0 left, the ledger agrees', async () => {
    await editWallet(a, clock.now(), CH, V.id, 'set', { tokens: 500 }, 'test');
    await a.query('delete from casino_rounds');
    const ledger = async () =>
      Number(
        (
          await a.query<{ s: string }>(
            "select coalesce(sum(amount), 0) as s from lab_wallet_ledger where viewer_id = $1 and module_id = 'casino'",
            [V.id],
          )
        )[0]!.s,
      );
    const before = await ledger();
    const [A, B] = [casino(a), casino(b)];
    const out = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? A : B).spinSlot(CH, V, {
          key: `intent-many-${i}-x`,
          bet: 100,
        }),
      ),
    );
    const refused = out.filter(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult[];
    expect(out.length - refused.length).toBe(5);
    expect(
      refused.every(
        (r) =>
          r.reason instanceof CasinoError &&
          r.reason.code === 'insufficient_tokens',
      ),
    ).toBe(true);
    expect(await labTokens()).toBe(0);
    expect(await a.query('select 1 from casino_rounds')).toHaveLength(5);
    expect((await ledger()) - before).toBe(-500);
  });

  it('a failure inside the spin’s transaction (a crash before the commit): nothing debited, nothing recorded', async () => {
    await editWallet(
      a,
      clock.now(),
      CH,
      V.id,
      'set',
      { tokens: 1_000 },
      'test',
    );
    await a.query('delete from casino_rounds');
    // The credit fails after the debit was written (the spin pays 0 here, so break the bet's insert instead): the
    // round's unique key already taken by ANOTHER viewer row is impossible; a failing economy move is the crash.
    const crashing: EconomyPort = {
      ...labEconomy,
      move: async (q, now, m) => {
        await labEconomy.move(q, now, m); // the debit is written…
        throw new Error('simulated crash'); // …then the process dies before the commit
      },
    };
    const c = casino(a, crashing);
    await expect(
      c.spinSlot(CH, V, { key: 'intent-crash-xx', bet: 100 }),
    ).rejects.toMatchObject({ code: 'casino_unavailable' });
    expect(await labTokens()).toBe(1_000);
    expect(await a.query('select 1 from casino_rounds')).toHaveLength(0);
    // the same intent, retried on a healthy Core: paid once
    await casino(b).spinSlot(CH, V, { key: 'intent-crash-xx', bet: 100 });
    expect(await labTokens()).toBe(900);
  });

  it('the canonical Wallet (Production): concurrent spins never below 0; wallet_transactions = the balance change', async () => {
    const wa = createWalletModule(a, clock).wallet;
    const wb = createWalletModule(b, clock).wallet;
    await openCanonicalLive(a, clock, 'casino-live-1');
    await wa.credit({
      key: 'casino-fund-1',
      viewer: {
        twitchUserId: V.id,
        login: 'joueur',
        displayName: V.display_name,
      },
      amount: 350,
      source: 'test',
    });
    const [A, B] = [
      casino(a, coreWalletEconomy(wa)),
      casino(b, coreWalletEconomy(wb)),
    ];
    A.productionApproved = true;
    B.productionApproved = true;
    const out = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? A : B).spinSlot(CH, V, {
          key: `intent-canon-${i}-x`,
          bet: 100,
        }),
      ),
    );
    expect(out.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const bal = (await coreWalletEconomy(wa).balances(a, CH, V.id)).tokens;
    expect(bal).toBe(50);
    const sum = await a.query<{ s: string }>(
      `select coalesce(sum(amount), 0) as s
         from wallet_transactions where twitch_user_id = $1 and source = 'casino'`,
      [V.id],
    );
    expect(Number(sum[0]!.s)).toBe(-300);
  });
});
