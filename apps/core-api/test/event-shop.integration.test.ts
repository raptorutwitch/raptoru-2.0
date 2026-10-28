// Halloween shop (docs/HALLOWEEN.md) on a real Postgres with real parallel connections (PGlite serializes every
// transaction and cannot prove the locks): conversions racing on two Core pools never pass the hourly cap nor debit
// a Jeton without its Bonbon; purchases racing never admit two plays nor spend a Bonbon twice.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { EventShopError, EventShopService } from '../src/event-shop/service.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '83603689';
const ANA = { id: '9301', display_name: 'Ana' };

describe.skipIf(!isLocal)('Halloween shop, real Postgres', () => {
  const pools: Db[] = [];
  let unlock: (() => Promise<void>) | undefined;
  let a: Db, b: Db;
  let clock: FakeClock;
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    b = createPgDb(url!);
    pools.push(a, b);
  }, LOCK_WAIT_MS);
  beforeEach(async () => {
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    clock = new FakeClock(new Date('2026-10-31T18:00:00Z'));
  });
  afterAll(async () => {
    for (const db of pools) await db.close();
    await unlock?.();
  });

  const shop = (db: Db) =>
    new EventShopService(db, clock, coreWalletEconomy(new WalletService(db)));
  const n = async (sql: string) =>
    Number(
      (await a.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!.n,
    );
  const tokens = async () =>
    Number(
      (
        await a.query<{ balance: string }>(
          "select balance from wallets where twitch_user_id = $1 and currency_id = 'main'",
          [ANA.id],
        )
      )[0]?.balance ?? 0,
    );
  const settle = async <T>(ps: Promise<T>[]) =>
    (await Promise.allSettled(ps)).map((r) =>
      r.status === 'fulfilled'
        ? 'ok'
        : r.reason instanceof EventShopError
          ? r.reason.code
          : `crash:${(r.reason as Error).message}`,
    );
  const fund = (amount: number) =>
    new WalletService(a).credit({
      key: `fund-${amount}`,
      viewer: { twitchUserId: ANA.id, login: 'ana', displayName: 'Ana' },
      amount,
      source: 'test',
    });

  it('eight conversions from two Cores at once: never past the hourly cap, one Jeton debit per Bonbon', async () => {
    const [s1, s2] = [shop(a), shop(b)];
    await s1.updateSettings(CH, {
      enabled: true,
      rules: { conversion_rate: 100, conversion_cap_per_hour: 10 },
    });
    await fund(5000);
    const out = await settle(
      Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? s2 : s1).convert({
          idempotency_key: randomUUID(),
          channel_id: CH,
          viewer: ANA,
          bonbons: 3,
        }),
      ),
    );
    expect(out.filter((o) => o.startsWith('crash'))).toEqual([]);
    expect(out.filter((o) => o === 'ok')).toHaveLength(3); // 3 × 3 = 9 ≤ 10; a 4th would be 12
    expect(out.filter((o) => o === 'conversion_cap')).toHaveLength(5);
    expect((await s1.viewerState(CH, ANA.id)).balance).toBe(9);
    expect(await tokens()).toBe(5000 - 900);
    expect(await n("wallet_transactions where source = 'event_shop'")).toBe(3);
  });

  it('the same conversion key from two Cores: debited and credited once', async () => {
    const [s1, s2] = [shop(a), shop(b)];
    await s1.updateSettings(CH, {
      enabled: true,
      rules: { conversion_rate: 100, conversion_cap_per_hour: 10 },
    });
    await fund(1000);
    const req = {
      idempotency_key: randomUUID(),
      channel_id: CH,
      viewer: ANA,
      bonbons: 2,
    };
    const out = await settle([
      s1.convert(req),
      s2.convert(req),
      s1.convert(req),
    ]);
    expect(out.filter((o) => o.startsWith('crash'))).toEqual([]);
    expect((await s1.viewerState(CH, ANA.id)).balance).toBe(2);
    expect(await tokens()).toBe(800);
  });

  it('five purchases from two Cores at once: one play admitted, one debit, the rest refused busy', async () => {
    const [s1, s2] = [shop(a), shop(b)];
    await s1.updateSettings(CH, {
      enabled: true,
      rules: { viewer_gap_ms: 0, screamer_gap_ms: 0 },
    });
    await s1.heartbeat({
      studio_instance_id: 'studio-A',
      channel_id: CH,
      engine_ready: true,
      media: [],
    });
    await s1.grant(
      {
        idempotency_key: randomUUID(),
        channel_id: CH,
        viewer: ANA.id,
        amount: 20,
        reason: 'grant',
      },
      'test',
    );
    const out = await settle(
      ['blink', 'fog', 'eyes', 'tunnel', 'silhouette'].map((item_id, i) =>
        (i % 2 ? s2 : s1).purchase({
          idempotency_key: randomUUID(),
          channel_id: CH,
          viewer: ANA,
          item_id,
        }),
      ),
    );
    expect(out.filter((o) => o.startsWith('crash'))).toEqual([]);
    expect(out.filter((o) => o === 'ok')).toHaveLength(1);
    expect(await n('event_shop_purchases')).toBe(1);
    const price = Number(
      (
        await a.query<{ price: string }>(
          'select price from event_shop_purchases',
        )
      )[0]!.price,
    );
    expect((await s1.viewerState(CH, ANA.id)).balance).toBe(20 - price);
    // The ledger agrees with the balance.
    expect(
      await n(`event_wallets w where balance <> (select coalesce(sum(amount), 0) from event_ledger l
               where l.channel_id = w.channel_id and l.viewer_id = w.viewer_id and l.season = w.season)`),
    ).toBe(0);
  });
});
