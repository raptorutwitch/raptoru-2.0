// Roue du Sub V2, lot R3 on a real Postgres, two Cores (two Studio players) on two pools: the automatic queue drawn
// from both at once (one wheel at a time, each right once), manual requests racing the automatic draw, a review opened
// while the same right is being drawn (one outcome only), modes switched during the draws. Every scenario 3 times;
// the protection of the review race has its counter-proof.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomUUID } from 'node:crypto';
import type { AlertEventInput, LoyaltyEvent } from '@raptoru/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { coreWalletEconomy } from '../src/economy/economy.js';
import { loyaltyRoutes } from '../src/http/loyalty-routes.js';
import type { Actor } from '../src/lab-moderation/store.js';
import { SubWheelService } from '../src/sub-wheel/service.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { FakeClock, setup } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';
import { tampered } from './sw-race.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '83603689';
const T0 = new Date('2026-10-21T20:00:00Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(T0.getTime() + ms);
const ROUNDS = [1, 2, 3];
const studio: Actor = { id: 'studio', role: 'broadcaster', via: 'studio' };
const notice = (v: string, ms: number, months = 7): AlertEventInput => ({
  channel_id: CH,
  source: 'twitch',
  source_event_id: randomUUID(),
  type: 'resub',
  actor: { id: v, login: `v${v}`, display_name: `V${v}` },
  tier: '1000',
  months,
  occurred_at: at(ms).toISOString(),
});
const who = (v: string) => ({
  twitchUserId: v,
  login: `v${v}`,
  displayName: `V${v}`,
});

describe.skipIf(!isLocal)('Roue du Sub V2 — R3, real Postgres', () => {
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
  const n = async (sql: string) =>
    Number(
      (await a.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!.n,
    );
  const credits = () => n("wallet_transactions where source = 'sub_wheel'");
  const live = async () => {
    // The real stream service (the Daily's stream_sessions), as the bot's stream.online does.
    const c = await setup({ db: a, clock });
    await c.streams.online({ streamId: 's1', startedAt: at(-DAY / 24) });
  };
  /** One ok chatters reading of the live seeing these viewers. */
  const reading = async (viewers: string[], ms: number) => {
    const id = (
      await a.query<{ id: number }>(
        `insert into presence_cycles (cycle_id, stream_id, worker_id, observed_at, received_at, duration_ms, status,
           chatter_count) values ($1, 's1', 'w', $2, $2, 1, 'ok', $3) returning id`,
        [randomUUID(), at(ms), viewers.length],
      )
    )[0]!.id;
    for (const v of viewers) {
      await a.query(
        'insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $2) on conflict do nothing',
        [v, `v${v}`],
      );
      await a.query(
        `insert into presence_viewer_streams (stream_id, twitch_user_id, first_seen_at, last_seen_at, last_seen_cycle)
         values ('s1', $1, $2, $2, $3)
         on conflict (stream_id, twitch_user_id) do update set last_seen_at = $2, last_seen_cycle = $3`,
        [v, at(ms), id],
      );
    }
  };
  const v2 = async () => {
    await wheel(a).setEnabled(CH, true);
    await wheel(a).setMode(CH, 'v2', 'test');
  };
  const viewers = (k: number) => Array.from({ length: k }, (_, i) => `97${i}`);
  /** Claims on both Cores until the queue is empty, completing each wheel; never two wheels playing at once. */
  const drain = async (wa: SubWheelService, wb: SubWheelService) => {
    for (let k = 0; k < 200; k++) {
      const got = (
        await Promise.all([wa, wb].map((w) => w.claimAnimation(CH, 'obs')))
      ).flatMap((r) => (r.spin ? [r.spin] : []));
      expect(got.length).toBeLessThanOrEqual(1);
      expect(await n("sw_spins where status = 'playing'")).toBeLessThanOrEqual(
        1,
      );
      if (!got.length) return;
      await wa.reportAnimation(got[0]!.spin_id, {
        consumer_id: 'obs',
        event: 'completed',
      });
    }
  };

  for (const round of ROUNDS) {
    it(`the automatic queue drawn from two players at once: one wheel at a time, each right once, one credit each (round ${round})`, async () => {
      await v2();
      await live();
      const vs = viewers(30);
      for (const [i, v] of vs.entries())
        await wheel(a).fromAlert(notice(v, i * 1_000), null);
      await reading(vs, 60_000);
      clock.set(at(90_000));
      await drain(wheel(a), wheel(b));
      expect(await n("sw_spins where status = 'shown'")).toBe(30);
      expect(draws).toBe(30);
      expect(await credits()).toBe(30);
    });

    it(`manual requests racing the automatic draws on two Cores: every right drawn once (round ${round})`, async () => {
      await v2();
      await live();
      const vs = viewers(20);
      const ids: string[] = [];
      for (const [i, v] of vs.entries())
        ids.push(
          (await wheel(a).fromAlert(notice(v, i * 1_000), null))!.spin_id,
        );
      await reading(vs, 60_000);
      clock.set(at(90_000));
      const [wa, wb] = [wheel(a), wheel(b)];
      await Promise.all([
        drain(wa, wb),
        ...ids
          .filter((_, i) => i % 2)
          .map((id) => wb.requestDraw(id, studio).catch(() => null)),
      ]);
      await drain(wa, wb);
      expect(await n("sw_spins where status = 'shown'")).toBe(20);
      expect(draws).toBe(20);
      expect(await credits()).toBe(20);
    });

    it(`modes v2 ↔ v2_acquire switched during the draws and the notices: each right drawn at most once (round ${round})`, async () => {
      await v2();
      await live();
      const vs = viewers(20);
      for (const [i, v] of vs.entries())
        await wheel(a).fromAlert(notice(v, i * 1_000), null);
      await reading(vs, 60_000);
      clock.set(at(90_000));
      let flipping = true;
      const flips = (async () => {
        for (let k = 0; flipping; k++)
          await wheel(a).setMode(CH, k % 2 ? 'v2' : 'v2_acquire', 'test');
      })();
      const [wa, wb] = [wheel(a), wheel(b)];
      await Promise.all([
        drain(wa, wb),
        ...vs.map((v, i) =>
          wb.fromAlert(notice(v, 2 * DAY + i * 1_000, 8), null),
        ),
      ]);
      flipping = false;
      await flips;
      await wheel(a).setMode(CH, 'v2', 'test');
      await reading(vs, 2 * DAY + 60_000);
      clock.set(at(2 * DAY + 90_000));
      await drain(wa, wb);
      const drawn = await n('sw_spins where segment is not null');
      expect(draws).toBe(drawn);
      expect(await credits()).toBe(drawn);
      expect(await n('sw_spins')).toBe(40);
      expect(drawn).toBe(40);
    });
  }

  /**
   * A review opened (Core B: the share of the same month) while Core A draws the same right: Core A holds its draw
   * uncommitted for 400 ms (before its wallet movement), Core B's acquisition arrives meanwhile.
   */
  const reviewRace = async (protectedFlag: boolean) => {
    await live();
    await wheel(a).setEnabled(CH, true);
    const vs = viewers(6);
    for (const v of vs) await wheel(a).fromAlert(notice(v, -40 * DAY, 5), null);
    // That history was shown long ago: the claims below draw the owed rights, not old V1 wheels.
    await a.query(
      "update sw_spins set status = 'shown' where status = 'queued'",
    );
    await wheel(a).setMode(CH, 'v2', 'test');
    const c = await setup({ db: a, clock, loyalty: { eventCredits: true } });
    const loyaltyA = loyaltyRoutes(c.loyalty, {
      service: wheel(a),
      channelId: CH,
    }).find((r) => r.pattern.test('/v1/bot/loyalty/events'))!;
    // The estimated rights (month 6), owed, auto, in order.
    for (const [i, v] of vs.entries()) {
      clock.set(at(i * 1_000));
      await loyaltyA.handle({
        params: [],
        url: new URL('http://core'),
        body: {
          type: 'sub',
          eventId: randomUUID(),
          occurredAt: at(i * 1_000).toISOString(),
          viewer: who(v),
          tier: 't1',
          isGift: false,
        } satisfies LoyaltyEvent,
      });
    }
    await a.query("update sw_spins set queue = 'auto' where status = 'owed'");
    await reading(vs, 60_000);
    clock.set(at(90_000));
    const slowA = wheel(
      tampered(a, { delayOn: [/insert into wallet_operations/, 400] }),
    );
    const cb = await setup({ db: b, clock, loyalty: { eventCredits: true } });
    // Counter-proof: the review's lock of both rights removed (the same read, without « for update »).
    const wb = wheel(
      protectedFlag
        ? b
        : tampered(b, {
            replace: [
              /where spin_id = any\(\$1::uuid\[\]\) order by spin_id for update/,
              'select * from sw_spins where spin_id = any($1::uuid[]) order by spin_id',
            ],
          }),
    );
    const routeB = loyaltyRoutes(cb.loyalty, {
      service: wb,
      channelId: CH,
    }).find((r) => r.pattern.test('/v1/bot/loyalty/events'))!;
    for (const v of vs) {
      const [claimed] = await Promise.all([
        slowA.claimAnimation(CH, 'obs'),
        (async () => {
          await new Promise((r) => setTimeout(r, 100));
          await routeB.handle({
            params: [],
            url: new URL('http://core'),
            body: {
              type: 'resub',
              eventId: randomUUID(),
              occurredAt: at(2 * DAY).toISOString(),
              viewer: who(v),
              tier: 't1',
              cumulativeMonths: 6,
            } satisfies LoyaltyEvent,
          });
        })(),
      ]);
      if (claimed.spin)
        await wheel(a).reportAnimation(claimed.spin.spin_id, {
          consumer_id: 'obs',
          event: 'completed',
        });
    }
    // The forbidden outcome: a right drawn AND under review.
    return n(
      `sw_spins s where s.segment is not null and exists (select 1 from sw_spin_reviews v
         where v.spin_id = s.spin_id and v.status = 'open')`,
    );
  };

  for (const round of ROUNDS)
    it(`a review opened while the same right is drawn: one outcome only — drawn (the other right blocked) or blocked, never both (round ${round})`, async () => {
      expect(await reviewRace(true)).toBe(0);
      // Each viewer: one month (6) drawn at most once — the blocked right is never drawn by any path.
      for (const v of viewers(6)) {
        const rows = await a.query<{ spin_id: string; segment: number | null }>(
          `select spin_id, segment from sw_spins where viewer_id = $1 and sub_month = 6`,
          [v],
        );
        expect(rows).toHaveLength(2);
        expect(
          rows.filter((r) => r.segment !== null).length,
        ).toBeLessThanOrEqual(1);
        expect(await n(`sw_spin_reviews where viewer_id = '${v}'`)).toBe(1);
      }
      expect(await credits()).toBe(draws);
    });

  it('counter-proof — without the row lock of the review, a right ends drawn AND under review', async () => {
    expect(await reviewRace(false)).toBeGreaterThan(0);
  });

  for (const round of ROUNDS)
    it(`R4 — « distinct » (Core A), « fusion » and « Tirer » (Core B) on one review at once: one decision, never merged AND asked (round ${round})`, async () => {
      await wheel(a).setEnabled(CH, true);
      const vs = viewers(10);
      for (const v of vs)
        await wheel(a).fromAlert(notice(v, -40 * DAY, 5), null);
      await wheel(a).setMode(CH, 'v2', 'test');
      const c = await setup({ db: a, clock, loyalty: { eventCredits: true } });
      const route = loyaltyRoutes(c.loyalty, {
        service: wheel(a),
        channelId: CH,
      }).find((r) => r.pattern.test('/v1/bot/loyalty/events'))!;
      const post = (body: LoyaltyEvent) =>
        route.handle({ params: [], url: new URL('http://core'), body });
      for (const v of vs) {
        await post({
          type: 'sub',
          eventId: randomUUID(),
          occurredAt: at(0).toISOString(),
          viewer: who(v),
          tier: 't1',
          isGift: false,
        });
        await post({
          type: 'resub',
          eventId: randomUUID(),
          occurredAt: at(2 * DAY).toISOString(),
          viewer: who(v),
          tier: 't1',
          cumulativeMonths: 6,
        });
      }
      const reviews = await a.query<{ id: number; spin_id: string }>(
        'select id, spin_id from sw_spin_reviews',
      );
      expect(reviews).toHaveLength(10);
      const [wa, wb] = [wheel(a), wheel(b)];
      const settled = await Promise.all(
        reviews.map((r) =>
          Promise.allSettled([
            wa.resolveReview(r.id, studio, 'distinct', 'A'),
            wb.resolveReview(r.id, studio, 'merge', 'B'),
            wb.requestDraw(r.spin_id, studio),
          ]),
        ),
      );
      for (const [i, [d, m]] of settled.entries()) {
        expect(
          [d.status, m.status].filter((x) => x === 'fulfilled'),
        ).toHaveLength(1);
        const loser =
          d.status === 'rejected' ? d : (m as PromiseRejectedResult);
        expect((loser.reason as { code?: string }).code).toBe('review_closed');
        const row = (
          await a.query<{ status: string; merged_into: string | null }>(
            'select status, merged_into from sw_spins where spin_id = $1',
            [reviews[i]!.spin_id],
          )
        )[0]!;
        expect(['merged', 'owed', 'requested']).toContain(row.status);
        if (m.status === 'fulfilled') expect(row.status).toBe('merged');
      }
      expect(
        await n('lab_moderation_audit where action like $$sw_review_%$$'),
      ).toBe(10);
      expect(
        await n("sw_spins where status = 'merged' and award_status <> 'none'"),
      ).toBe(0);
    });
});
