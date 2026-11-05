// Refonte H9 on a real Postgres with two Cores (two pools): the same subscriber snapshot applied by both at once settles
// each base-rate tick ONCE — one complement each, never two, credited once.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted. Fictional viewers.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCore } from '../src/app.js';
import { DevFakeCreditProvider } from '../src/daily/credits.js';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { SHADOW_MODES } from '../src/loyalty/engine.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const T = new Date('2026-11-05T20:00:00Z');

describe.skipIf(!isLocal)('loyalty complement (H9), real Postgres', () => {
  const pools: Db[] = [];
  let unlock: (() => Promise<void>) | undefined;
  let a: Db, b: Db;
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    b = createPgDb(url!);
    pools.push(a, b);
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    for (const p of pools) await p.close();
    await unlock?.();
  });

  it('20 base-rate ticks, one snapshot applied by two Cores at once (×3): 20 complements, credited once', async () => {
    const clock = new FakeClock(T);
    const modes = { ...SHADOW_MODES, passiveCredits: true };
    const A = createCore(a, clock, new DevFakeCreditProvider(), modes);
    const B = createCore(b, clock, new DevFakeCreditProvider(), modes);
    const viewers = Array.from({ length: 20 }, (_, i) => ({
      twitchUserId: String(7000 + i),
      login: `fictif${i}`,
      displayName: `Fictif${i}`,
    }));
    for (const v of viewers) {
      await a.query(
        `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $3) on conflict do nothing`,
        [v.twitchUserId, v.login, v.displayName],
      );
      // A tick paid at the base rate, as the engine records it when the tier is unknown.
      await a.query(
        `insert into loyalty_rewards (idempotency_key, request_hash, source, twitch_user_id, stream_id, currency_id,
           amount, status, breakdown) values ($1, 'h', 'passive_watch', $2, null, 'main', 10, 'pending', $3)`,
        [
          `passive:s1:${v.twitchUserId}:1`,
          v.twitchUserId,
          JSON.stringify({
            tier: 'unknown',
            candidates: { none: 10, t1: 20, t2: 20, t3: 20 },
            provisional: true,
            complement: 'awaiting',
            tick_at: T.toISOString(),
          }),
        ],
      );
    }
    clock.set(new Date(T.getTime() + 3_600_000));
    const snap = {
      fetchedAt: clock.now().toISOString(),
      subscribers: viewers.map((viewer) => ({
        viewer,
        tier: 't1' as const,
        isGift: false,
      })),
    };
    await Promise.all(
      [A, B, A, B, A, B].map((c) => c.loyalty.applySubscriptionSnapshot(snap)),
    );
    await Promise.all([A.loyalty.processPending(), B.loyalty.processPending()]);
    const complements = await a.query<{ n: number }>(
      "select count(*)::int as n from loyalty_rewards where idempotency_key like 'passive-complement:%'",
    );
    expect(complements[0]!.n).toBe(20);
    const balances = await a.query<{ balance: number | string }>(
      "select balance from wallets where currency_id = 'main' order by twitch_user_id",
    );
    expect(balances.map((r) => Number(r.balance))).toEqual(
      viewers.map(() => 20), // 10 base + 10 complement, each once
    );
  });
});
