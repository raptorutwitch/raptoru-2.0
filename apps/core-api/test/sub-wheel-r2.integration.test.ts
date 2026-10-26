// Roue du Sub V2, lot R2 on a real Postgres, two Cores on two pools: subscribe / resub message (through the loyalty
// route, loyalty then acquisition in two transactions) racing the chat notice; a failed acquisition resumed by the
// redelivery; rights « À vérifier » decided concurrently. Every scenario 3 times; every protection its counter-proof.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomUUID } from 'node:crypto';
import type { AlertEventInput, LoyaltyEvent } from '@raptoru/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { loyaltyRoutes } from '../src/http/loyalty-routes.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock, setup } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';
import { barrier, tampered } from './sw-race.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '83603689';
const T0 = new Date('2026-10-21T20:00:00Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(T0.getTime() + ms).toISOString();
const ROUNDS = [1, 2, 3];
const who = (v: string) => ({
  twitchUserId: v,
  login: `v${v}`,
  displayName: `V${v}`,
});
const sub = (v: string, ms: number): LoyaltyEvent => ({
  type: 'sub',
  eventId: randomUUID(),
  occurredAt: at(ms),
  viewer: who(v),
  tier: 't1',
  isGift: false,
});
const resub = (v: string, ms: number, months?: number): LoyaltyEvent => ({
  type: 'resub',
  eventId: randomUUID(),
  occurredAt: at(ms),
  viewer: who(v),
  tier: 't1',
  ...(months ? { cumulativeMonths: months } : {}),
});
const notice = (
  v: string,
  ms: number,
  over: Partial<AlertEventInput> = {},
): AlertEventInput => ({
  channel_id: CH,
  source: 'twitch',
  source_event_id: randomUUID(),
  type: 'resub',
  actor: { id: v, login: `v${v}`, display_name: `V${v}` },
  tier: '1000',
  months: 7,
  occurred_at: at(ms),
  ...over,
});

describe.skipIf(!isLocal)('Roue du Sub V2 — R2, real Postgres', () => {
  const pools: Db[] = [];
  let unlock: (() => Promise<void>) | undefined;
  let a: Db, b: Db;
  let clock: FakeClock;
  let draws = 0;
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    b = createPgDb(url!);
    pools.push(a, b);
  }, LOCK_WAIT_MS);
  beforeEach(async () => {
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    clock = new FakeClock(T0);
    draws = 0;
  });
  afterAll(async () => {
    for (const db of pools) await db.close();
    await unlock?.();
  });

  const wheel = (db: Db) =>
    new SubWheelService(
      db,
      clock,
      () => {
        draws++;
        return 2;
      },
      coreWalletEconomy(new WalletService(db)),
    );
  /** One Core: its loyalty engine and its loyalty route wired to a wheel on `wheelDb`. */
  const core = async (db: Db, wheelDb: Db = db) => {
    const c = await setup({ db, clock, loyalty: { eventCredits: true } });
    const w = wheel(wheelDb);
    const route = loyaltyRoutes(c.loyalty, { service: w, channelId: CH }).find(
      (r) => r.pattern.test('/v1/bot/loyalty/events'),
    )!;
    return {
      wheel: w,
      post: (e: LoyaltyEvent) =>
        route.handle({ params: [], body: e, url: new URL('http://core') }),
    };
  };
  const n = async (sql: string) =>
    Number(
      (await a.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!.n,
    );
  const configure = async (mode: 'v1' | 'v2_acquire', enabled: boolean) => {
    await wheel(a).setEnabled(CH, enabled);
    await wheel(a).setMode(CH, mode, 'test');
  };
  const viewers = (k: number) => Array.from({ length: k }, (_, i) => `96${i}`);
  /** Month 5 certain for every viewer (a V1 resub 40 days before). */
  const history = async (vs: string[]) => {
    await configure('v1', true);
    for (const v of vs)
      await wheel(a).fromAlert(notice(v, -40 * DAY, { months: 5 }), null);
  };

  for (const round of ROUNDS) {
    it(`subscribe (Core A), message (Core B) and notice (Core A) of one renewal at once, both modes, 20 viewers: one right, one wheel credit, one loyalty payment each (round ${round})`, async () => {
      for (const mode of ['v1', 'v2_acquire'] as const) {
        await a.query('drop schema public cascade; create schema public;');
        await migrate(a, 'all');
        draws = 0;
        await configure(mode, true);
        const [A, B] = [await core(a), await core(b)];
        await Promise.all(
          viewers(20).flatMap((v, i) => [
            A.post(sub(v, 0)),
            B.post(resub(v, 3_000, i % 2 ? 7 : undefined)),
            A.wheel.fromAlert(notice(v, 1_500), null),
          ]),
        );
        expect(await n('sw_spins')).toBe(20);
        expect(await n('sw_spin_sources where spin_id is not null')).toBe(60);
        expect(await n('sw_spin_reviews')).toBe(0);
        expect(draws).toBe(20);
        expect(await n("wallet_transactions where source = 'sub_wheel'")).toBe(
          20,
        );
        // Loyalty unchanged by R2: sub + resub of one renewal pay once (11ffe3f).
        expect(
          await n("wallet_transactions where source like 'loyalty:%'"),
        ).toBe(20);
      }
    });

    it(`loyalty succeeds, the acquisition fails on Core A while Core B gets the redelivery: one loyalty payment, the right acquired (round ${round})`, async () => {
      await configure('v2_acquire', false);
      const A = await core(a, tampered(a, { failOn: /insert into sw_spin/ }));
      const B = await core(b);
      const events = viewers(10).map((v) => sub(v, 0));
      const first = await Promise.allSettled(events.map((e) => A.post(e)));
      expect(first.every((r) => r.status === 'rejected')).toBe(true);
      expect(await n('sw_spin_sources')).toBe(0);
      const paid = await n("wallet_transactions where source like 'loyalty:%'");
      expect(paid).toBe(10);
      // The bot resends each event (to either Core, twice at once).
      await Promise.all(events.flatMap((e) => [B.post(e), B.post(e)]));
      expect(await n("wallet_transactions where source like 'loyalty:%'")).toBe(
        10,
      );
      expect(await n('loyalty_rewards')).toBe(10);
      expect(await n('sw_spin_sources')).toBe(10);
      expect(await n("sw_spins where status = 'owed'")).toBe(10);
    });

    it(`one month, two unrelated sources at once on two Cores (an estimate, a certain month 2 days later): one review per viewer, on the estimate (round ${round})`, async () => {
      const vs = viewers(10);
      await history(vs);
      await configure('v2_acquire', false);
      const pause = barrier(2);
      const [A, B] = [
        await core(a, tampered(a, { pause })),
        await core(b, tampered(b, { pause })),
      ];
      await Promise.all(
        vs.flatMap((v) => [A.post(sub(v, 0)), B.post(resub(v, 2 * DAY, 6))]),
      );
      expect(await n('sw_spin_reviews')).toBe(10);
      expect(
        await n(
          "sw_spin_reviews r join sw_spins s on s.spin_id = r.spin_id where s.month_source = 'estimated'",
        ),
      ).toBe(10);
      // Blocked on both Cores; the certain right stays drawable (once).
      const ids = await a.query<{ spin_id: string; suspect: boolean }>(
        `select s.spin_id, exists (select 1 from sw_spin_reviews r where r.spin_id = s.spin_id) as suspect
         from sw_spins s where s.status = 'owed'`,
      );
      const results = await Promise.allSettled(
        ids.flatMap((r) => [
          A.wheel.drawRight(r.spin_id),
          B.wheel.drawRight(r.spin_id),
        ]),
      );
      const codes = results.map((r) =>
        r.status === 'fulfilled' ? 'ok' : (r.reason as { code?: string }).code,
      );
      expect(codes.filter((c) => c === 'needs_review')).toHaveLength(20);
      expect(codes.filter((c) => c === 'ok')).toHaveLength(10);
      expect(codes.filter((c) => c === 'not_owed')).toHaveLength(10);
    });

    it(`counter-proof — without the viewer lock the same race leaves conflicts undetected (round ${round})`, async () => {
      const vs = viewers(10);
      await history(vs);
      await configure('v2_acquire', false);
      const pause = barrier(2);
      const o = { noViewerLock: true, pause };
      const [A, B] = [
        await core(a, tampered(a, o)),
        await core(b, tampered(b, o)),
      ];
      await Promise.all(
        vs.flatMap((v) => [A.post(sub(v, 0)), B.post(resub(v, 2 * DAY, 6))]),
      );
      expect(await n('sw_spin_reviews')).toBeLessThan(10);
    });

    it(`counter-proof — without the review check in draw(), a blocked right would be drawn (round ${round})`, async () => {
      const vs = viewers(5);
      await history(vs);
      await configure('v2_acquire', false);
      const A = await core(a);
      for (const v of vs) {
        await A.post(sub(v, 0));
        await A.post(resub(v, 2 * DAY, 6));
      }
      const suspects = await a.query<{ spin_id: string }>(
        'select spin_id from sw_spin_reviews',
      );
      expect(suspects).toHaveLength(5);
      const unchecked = wheel(
        tampered(a, {
          replace: [
            /from sw_spin_reviews where spin_id = \$1/,
            'select 1 where false',
          ],
        }),
      );
      for (const s of suspects)
        expect((await unchecked.drawRight(s.spin_id)).status).toBe('queued');
    });
  }
});
