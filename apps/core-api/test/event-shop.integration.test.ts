// Halloween shop (docs/HALLOWEEN.md) on a real Postgres with real parallel connections (PGlite serializes every
// transaction and cannot prove the locks): the removed Jetons exchange moves nothing; presence cycles and reward events
// racing on two Core pools pay each block / event once; purchases racing never admit two plays nor spend a Bonbon twice.
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

  it('the Jetons exchange is refused from every Core at once: no Jeton debited, no Bonbon credited', async () => {
    const [s1, s2] = [shop(a), shop(b)];
    await s1.updateSettings(CH, {
      enabled: true,
      rules: { conversion_rate: 100, conversion_cap_per_hour: 10 },
    });
    await fund(5000);
    const out = await settle(
      Array.from({ length: 6 }, (_, i) =>
        (i % 2 ? s2 : s1).convert({
          idempotency_key: randomUUID(),
          channel_id: CH,
          viewer: ANA,
          bonbons: 3,
        }),
      ),
    );
    expect(out).toEqual(Array(6).fill('conversion_removed'));
    expect((await s1.viewerState(CH, ANA.id)).balance).toBe(0);
    expect(await tokens()).toBe(5000);
    expect(await n("wallet_transactions where source = 'event_shop'")).toBe(0);
  });

  it('presence cycles racing on two Cores (viewers in any order): every second counted once, every block paid once', async () => {
    const [s1, s2] = [shop(a), shop(b)];
    await s1.updateSettings(CH, {
      enabled: true,
      rules: { presence_every_min: 5, presence_bonbons: 2 },
    });
    const ids = ['9301', '9302', '9303', '9304'];
    // 12 cycles of 2 min, half of them with the viewers reversed: 24 min each → 4 blocks of 5 min.
    const out = await settle(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? b : a).tx((q) =>
          (i % 2 ? s2 : s1).presenceListener.validated(q, {
            streamId: 's1',
            seconds: 120,
            viewerIds: i % 2 ? [...ids].reverse() : ids,
            at: clock.now(),
          }),
        ),
      ),
    );
    expect(out.filter((o) => o !== 'ok')).toEqual([]);
    const rows = await a.query<{ seconds: string; blocks_paid: number }>(
      'select seconds, blocks_paid from event_presence order by viewer_id',
    );
    expect(rows.map((r) => [Number(r.seconds), r.blocks_paid])).toEqual(
      Array(4).fill([1440, 4]),
    );
    for (const id of ids)
      expect((await s1.viewerState(CH, id)).balance).toBe(8);
    expect(await n("event_ledger where kind = 'presence'")).toBeLessThanOrEqual(
      16,
    );
  });

  it('the same reward event from two Cores at once (Bits, donation): paid once', async () => {
    const [s1, s2] = [shop(a), shop(b)];
    await s1.updateSettings(CH, {
      enabled: true,
      rules: { bits_step: 100, bits_bonbons: 1, donation_per_euro: 2 },
    });
    await a.query(
      `insert into viewers (twitch_user_id, login, display_name) values ('9301', 'ana', 'Ana')`,
    );
    const cheer = {
      channel_id: CH,
      source: 'twitch',
      source_event_id: 'cheer-1',
      type: 'bits',
      bits: 500,
      actor: { id: ANA.id, login: 'ana', display_name: 'Ana' },
    } as const;
    const tip = {
      channel_id: CH,
      source: 'external',
      source_event_id: 'streamelements-tip-1',
      type: 'donation',
      actor: { display_name: 'ana' },
      amount: { value: 1000, decimal_place: 2, currency: 'EUR' },
      provider: 'streamelements',
    } as const;
    const out = await settle(
      [cheer, tip, cheer, tip].map((e, i) =>
        (i % 2 ? b : a).tx((q) => (i % 2 ? s2 : s1).onAlert(q, e as never)),
      ),
    );
    expect(out.filter((o) => o !== 'ok')).toEqual([]);
    expect((await s1.viewerState(CH, ANA.id)).balance).toBe(5 + 20);
    expect(await n('event_ledger')).toBe(2);
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
