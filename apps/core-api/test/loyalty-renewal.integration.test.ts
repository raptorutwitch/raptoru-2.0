// One loyalty reward per renewal on a real Postgres with real parallel connections (PGlite serializes every
// transaction and cannot prove the per-viewer lock): the sub and the resub of the same renewal sent at the same time to
// two Core instances, for many viewers at once — exactly one reward per viewer, one-to-one pairs, nothing lost.
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import type { LoyaltyEvent } from '@raptoru/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
const T = Date.parse('2026-10-20T17:05:34.000Z');

describe.skipIf(!isLocal)('one reward per renewal, real Postgres', () => {
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

  it('sub and resub of 30 viewers, each pair raced on two Cores: one reward each, one-to-one', async () => {
    const clock = new FakeClock(new Date(T));
    const modes = { ...SHADOW_MODES, eventCredits: true };
    const coreA = createCore(a, clock, new DevFakeCreditProvider(), modes);
    const coreB = createCore(b, clock, new DevFakeCreditProvider(), modes);
    const viewers = Array.from({ length: 30 }, (_, i) => ({
      twitchUserId: String(9300 + i),
      login: `v${i}`,
      displayName: `V${i}`,
    }));
    const events = viewers.flatMap((v, i): [LoyaltyEvent, LoyaltyEvent] => [
      {
        type: 'sub',
        eventId: `s-${i}`,
        occurredAt: new Date(T).toISOString(),
        viewer: v,
        tier: 't1',
        isGift: false,
      },
      {
        type: 'resub',
        eventId: `r-${i}`,
        occurredAt: new Date(T + 8_000).toISOString(),
        viewer: v,
        tier: 't1',
      },
    ]);
    // Each pair split across the two Cores, every event in flight at once.
    await Promise.all(
      events.map((e, i) => (i % 2 ? coreB : coreA).loyalty.handleEvent(e)),
    );
    await coreA.loyalty.processPending();

    const perViewer = await a.query<{
      twitch_user_id: string;
      paid: number;
      excluded: number;
      balance: number;
    }>(
      `select r.twitch_user_id,
         count(*) filter (where r.status = 'credited')::int as paid,
         count(*) filter (where r.status = 'excluded')::int as excluded,
         (select balance from wallets w where w.twitch_user_id = r.twitch_user_id and w.currency_id = 'main')::int as balance
       from loyalty_rewards r where r.source in ('sub', 'resub') group by r.twitch_user_id`,
    );
    expect(perViewer).toHaveLength(30);
    for (const v of perViewer)
      expect([v.paid, v.excluded, v.balance], v.twitch_user_id).toEqual([
        1, 1, 2000,
      ]);
    // One-to-one: every excluded row points at a distinct paid row of the same viewer.
    const links = await a.query<{ ok: boolean }>(
      `select count(distinct (e.breakdown->>'pairedWith')) = count(*) and bool_and(p.status = 'credited'
         and p.twitch_user_id = e.twitch_user_id) as ok
       from loyalty_rewards e join loyalty_rewards p on p.id = (e.breakdown->>'pairedWith')::bigint
       where e.status = 'excluded'`,
    );
    expect(links[0]!.ok).toBe(true);
    // The Wallet saw exactly 30 credits.
    expect(
      (
        await a.query<{ n: number }>(
          "select count(*)::int as n from wallet_transactions where source in ('loyalty:sub', 'loyalty:resub')",
        )
      )[0]!.n,
    ).toBe(30);
  });
});
