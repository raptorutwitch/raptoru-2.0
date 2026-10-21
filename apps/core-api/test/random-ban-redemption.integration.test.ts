// Random Ban → confirmation → finalized channel points redemption on a real Postgres with real parallel connections
// (live of 21/10: 6 confirmed Random Bans left their redemption « pending » until a Studio read): several redemptions
// received at once on two Core instances, every executor result reported twice at once (answer lost), a refusal, and
// a « historical » redemption whose Random Ban ended without the hook — never touched by another request's result.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCore } from '../src/app.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { RandomBanService } from '../src/random-ban/service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '83603689';
const EXEC = {
  executor_id: 'bot-prod-1',
  login: 'lecroupier_',
  can_search: true,
  can_timeout: true,
  missing: [],
};
const TARGET = { id: '9002', login: 'target', name: 'Target' };
const STATS = { chatters: 12, candidates: 7, follow_checks: 2 };

describe.skipIf(!isLocal)(
  'Random Ban redemption finalized, real Postgres',
  () => {
    const pools: Db[] = [];
    let unlock: (() => Promise<void>) | undefined;
    let a: Db, b: Db;
    beforeAll(async () => {
      unlock = await lockDestructiveSuite(url!);
      a = createPgDb(url!);
      b = createPgDb(url!);
      pools.push(a, b);
    }, LOCK_WAIT_MS);
    beforeEach(async () => {
      await a.query('drop schema public cascade; create schema public;');
      await migrate(a, 'all');
    });
    afterAll(async () => {
      for (const p of pools) await p.close();
      await unlock?.();
    });

    it('6 redemptions at once on two Cores, each result reported twice at once: each redemption final once, the historical one untouched', async () => {
      const clock = new FakeClock(new Date('2026-10-21T18:30:00Z'));
      const coreA = createCore(a, clock, new DevFakeCreditProvider());
      const coreB = createCore(b, clock, new DevFakeCreditProvider());
      const cp = coreA.channelPoints;
      await cp.syncRewards({
        channel_id: CH,
        rewards: [
          {
            id: 'reward-rb',
            title: 'Ban aléatoire',
            cost: 3000,
            is_enabled: true,
          },
        ],
      });
      await cp.saveRule(CH, 'reward-rb', {
        enabled: true,
        actions: [{ type: 'interaction', interaction: 'random_ban' }],
      });
      await cp.setEnabled(CH, true, 'test');
      const redeem = (core: typeof coreA, i: number) =>
        core.channelPoints.receive({
          channel_id: CH,
          source: 'twitch' as const,
          redemption_id: randomUUID(),
          reward: { id: 'reward-rb', title: 'Ban aléatoire', cost: 3000 },
          user: {
            id: String(9100 + i),
            login: `buyer${i}`,
            display_name: `Buyer${i}`,
          },
          twitch_status: 'unfulfilled' as const,
          redeemed_at: clock.now().toISOString(),
        });
      const rows = () =>
        a.query<{
          redemption_id: string;
          status: string;
          twitch_status: string;
          results: {
            status: string;
            random_ban_id: string;
            detail?: string;
            error?: string;
          }[];
        }>(
          'select redemption_id, status, twitch_status, results from cp_redemptions order by received_at, redemption_id',
        );
      const rbOf = new Map<string, string>(); // random ban request → redemption

      // The « historical » case: its Random Ban ends through an executor path without the hook (the code of 21/10).
      const historical = await redeem(coreA, 0);
      const legacy = new RandomBanService(a, clock);
      const h = (await legacy.claim(CH, EXEC)).request!;
      await legacy.target(h.request_id, {
        executor_id: EXEC.executor_id,
        attempt_id: h.attempt_id,
        target: TARGET,
        is_sub: false,
        stats: STATS,
      });
      await legacy.result(h.request_id, {
        executor_id: EXEC.executor_id,
        attempt_id: h.attempt_id,
        event: 'confirmed',
      });

      // Six redemptions received at the same time, half on each Core.
      const received = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          redeem(i % 2 ? coreB : coreA, i + 1),
        ),
      );
      for (const r of received) {
        expect(r.redemption.status).toBe('pending');
        rbOf.set(
          (r.redemption.results[0] as { random_ban_id: string }).random_ban_id,
          r.redemption.redemption_id!,
        );
      }
      expect(rbOf.size).toBe(6);

      // One Random Ban at a time; each result reported twice at once (on both Cores); the last one is refused.
      const reported = new Set<string>();
      for (let n = 0; n < 6; n++) {
        const core = n % 2 ? coreB : coreA;
        const c = (await core.randomBan.claim(CH, EXEC)).request!;
        await core.randomBan.target(c.request_id, {
          executor_id: EXEC.executor_id,
          attempt_id: c.attempt_id,
          target: TARGET,
          is_sub: false,
          stats: STATS,
        });
        const report =
          n < 5
            ? {
                executor_id: EXEC.executor_id,
                attempt_id: c.attempt_id,
                event: 'confirmed' as const,
              }
            : {
                executor_id: EXEC.executor_id,
                attempt_id: c.attempt_id,
                event: 'refused' as const,
                error: 'Twitch 400 : already banned',
              };
        const [r1, r2] = await Promise.all([
          coreA.randomBan.result(c.request_id, report),
          coreB.randomBan.result(c.request_id, report),
        ]);
        expect(r1.status).toBe(r2.status);
        reported.add(c.request_id);
        // Final right after the report, no Studio read; the ones still queued stay pending.
        const now = await rows();
        const mine = now.find(
          (x) => x.redemption_id === rbOf.get(c.request_id),
        )!;
        expect(mine.status).toBe(n < 5 ? 'done' : 'failed');
        expect(mine.results).toHaveLength(1);
        const waiting = [...rbOf.keys()]
          .filter((id) => !reported.has(id))
          .map((id) => rbOf.get(id));
        expect(waiting).toHaveLength(5 - n);
        for (const x of now.filter((r) => waiting.includes(r.redemption_id)))
          expect(x.status).toBe('pending');
        expect(
          now.find(
            (x) => x.redemption_id === historical.redemption.redemption_id,
          )!.status,
        ).toBe('pending');
      }

      const end = await rows();
      const fresh = end.filter(
        (x) => x.redemption_id !== historical.redemption.redemption_id,
      );
      expect(fresh.map((x) => x.status).sort()).toEqual([
        'done',
        'done',
        'done',
        'done',
        'done',
        'failed',
      ]);
      expect(fresh.find((x) => x.status === 'failed')!.results[0]!.error).toBe(
        'Twitch 400 : already banned — remboursement nécessaire (non effectué : récompense créée par SAMMI)',
      );
      // Twitch's status never changed by Raptoru; no Studio job; no Jetons moved; one request per redemption.
      expect(end.every((x) => x.twitch_status === 'unfulfilled')).toBe(true);
      expect(
        (
          await a.query<{ n: number }>('select count(*)::int as n from cp_jobs')
        )[0]!.n,
      ).toBe(0);
      expect(
        (
          await a.query<{ n: number }>(
            'select count(*)::int as n from wallet_transactions',
          )
        )[0]!.n,
      ).toBe(0);
      expect(
        (
          await a.query<{ n: number }>(
            'select count(*)::int as n from rb_requests',
          )
        )[0]!.n,
      ).toBe(7);
      expect(
        end.find(
          (x) => x.redemption_id === historical.redemption.redemption_id,
        )!.status,
      ).toBe('pending');

      // The existing regularization path (a Studio read): the historical one becomes done — status only, nothing
      // replayed (no new claim), still no job nor Jetons.
      await cp.state(CH);
      const after = (await rows()).find(
        (x) => x.redemption_id === historical.redemption.redemption_id,
      )!;
      expect(after).toMatchObject({
        status: 'done',
        twitch_status: 'unfulfilled',
      });
      expect(await coreA.randomBan.claim(CH, EXEC)).toEqual({
        request: null,
        reason: 'idle',
      });
      expect(
        (
          await a.query<{ n: number }>(
            'select count(*)::int as n from wallet_transactions',
          )
        )[0]!.n,
      ).toBe(0);
    });
  },
);
