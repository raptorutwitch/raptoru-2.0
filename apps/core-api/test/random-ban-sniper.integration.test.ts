// Sniper on a real Postgres with two Core instances: the same hit reported to both at once pays the bonus ONCE; two
// attempts bought at once by one buyer are serialized (the second is never rewardable while the first counts).
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… (the database is wiped; local test databases only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { labEconomy } from '../src/economy/economy.js';
import { editWallet } from '../src/lab-moderation/store.js';
import { RandomBanService } from '../src/random-ban/service.js';
import { FakeClock } from './helpers.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const CH = '83603689';
const EXEC = {
  executor_id: 'bot-1',
  login: 'lecroupier_',
  can_search: true,
  can_timeout: true,
  missing: [],
};
const KIWI = { id: '990001', login: 'kiwi', name: 'Kiwi' };
const BUYER = { id: '9101', login: 'b', name: 'B' };

describe.skipIf(!isLocal)('Sniper on a real Postgres', () => {
  let a: Db;
  let b: Db;
  let unlock: (() => Promise<void>) | undefined;
  const clock = new FakeClock(new Date('2026-11-12T20:00:00Z'));
  let rbA: RandomBanService;
  let rbB: RandomBanService;
  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = createPgDb(url!);
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
    b = createPgDb(url!);
    for (const db of [a, b]) {
      const rb = new RandomBanService(db, clock);
      rb.economy = labEconomy;
      rb.candidates = async () => [KIWI];
      if (db === a) rbA = rb;
      else rbB = rb;
    }
    await rbA.claim(CH, EXEC);
    await rbB.claim(CH, EXEC);
  }, LOCK_WAIT_MS);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await unlock?.();
  });
  const tokens = async () =>
    Number(
      (
        await a.query<{ tokens: number }>(
          'select tokens from lab_wallets where channel_id = $1 and viewer_id = $2',
          [CH, BUYER.id],
        )
      )[0]?.tokens,
    );
  const buy = (rb: RandomBanService, ref: string) =>
    (rb === rbA ? a : b).tx((q) =>
      rb.buy(q, labEconomy, {
        channel_id: CH,
        source: 'extension',
        source_ref: ref,
        mode: 'real',
        buyer: BUYER,
        ceiling: 100_000,
        wish: { id: KIWI.id },
      }),
    );

  it('one hit reported to both Cores at once, twice each: the bonus is paid once', async () => {
    await editWallet(
      a,
      clock.now(),
      CH,
      BUYER.id,
      'set',
      { tokens: 100_000 },
      'test',
    );
    await buy(rbA, 'pg-hit-1');
    const c = (await rbA.claim(CH, EXEC)).request!;
    await rbA.target(c.request_id, {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      target: KIWI,
      is_sub: false,
      stats: { chatters: 1, candidates: 1, follow_checks: 1 },
    });
    const report = {
      executor_id: EXEC.executor_id,
      attempt_id: c.attempt_id,
      event: 'confirmed' as const,
    };
    await Promise.all([
      rbA.result(c.request_id, report),
      rbB.result(c.request_id, report),
      rbA.result(c.request_id, report),
      rbB.result(c.request_id, report),
    ]);
    expect(await tokens()).toBe(100_000 - 25_000 + 1_000);
  });

  it('two attempts bought at once on two Cores: serialized — at most one rewardable', async () => {
    await a.query(`delete from rb_requests`);
    await Promise.all([buy(rbA, 'pg-two-1'), buy(rbB, 'pg-two-2')]);
    const rows = await a.query<{ request_id: string }>(
      `select request_id from rb_requests order by seq`,
    );
    expect(rows).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const c = (await rbA.claim(CH, EXEC)).request!;
      await rbA.target(c.request_id, {
        executor_id: EXEC.executor_id,
        attempt_id: c.attempt_id,
        target: KIWI,
        is_sub: false,
        stats: { chatters: 1, candidates: 1, follow_checks: 1 },
      });
      await rbA.result(c.request_id, {
        executor_id: EXEC.executor_id,
        attempt_id: c.attempt_id,
        event: 'confirmed',
      });
    }
    const s = await a.query<{ sniper: string }>(
      `select sniper from rb_requests order by seq`,
    );
    // Exactly one rewardable: the first (the earlier requests were wiped above), the second sees it.
    expect(s.map((r) => r.sniper)).toEqual(['hit', 'glory_hit']);
  });
});
