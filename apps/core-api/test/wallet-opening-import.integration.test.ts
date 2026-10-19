// Opening import on a real Postgres with real parallel connections (PGlite serializes every transaction and cannot
// prove the locks): import against ordinary Wallet writers, two imports at once, rollback on a real server (Astra B3).
// Opt-in: TEST_DATABASE_URL=postgres://…@127.0.0.1:…/…test… npm run test:integration
// The database is wiped: only local URLs to a database whose name contains "test" are accepted.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import {
  applyOpeningImport,
  OpeningImportError,
  readOpeningSnapshot,
  verifyOpeningImport,
} from '../src/wallet/opening-import.js';
import { WalletService } from '../src/wallet/wallet-service.js';
import { LOCK_WAIT_MS, lockDestructiveSuite } from './pg-exclusive.js';

const url = process.env.TEST_DATABASE_URL;
const isLocal =
  !!url && /@(localhost|127\.0\.0\.1)[:/][^/]*\/[^/?]*test/.test(url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const v = (id: string) => ({
  twitchUserId: id,
  login: `v${id}`,
  displayName: `V${id}`,
});

const SOURCES: [string, string, [string, number][]][] = [
  ['1001', 'alice', [['alice', 100]]],
  [
    '1002',
    'bob',
    [
      ['bob_old', 40],
      ['bob', 60],
    ],
  ],
  ['1003', 'carol', [['carol', 5_000]]],
];
const file = () => {
  const rows = SOURCES.map(([id, login, src]) => ({
    twitch_user_id: id,
    login,
    balance: src.reduce((a, [, b]) => a + b, 0),
    sources: src.map(([source_ref, balance]) => ({ source_ref, balance })),
  }));
  const excluded = [
    { source_ref: 'petit', balance: 300, reason: 'non-follow < 3 000' },
  ];
  return readOpeningSnapshot(
    JSON.stringify({
      import_id: 'se-it-1',
      currency_id: 'main',
      source: 'streamelements',
      cutoff: '2026-11-01T03:00:00.000Z',
      source_snapshot: { sha256: 'c'.repeat(64), accounts: 5, total: 5_500 },
      rows,
      excluded,
    }),
  );
};

describe.skipIf(!isLocal)('opening import on a real Postgres', () => {
  const pools: Db[] = [];
  let unlock: (() => Promise<void>) | undefined;
  const pool = () => {
    const db = createPgDb(url!);
    pools.push(db);
    return db;
  };
  let a: Db, b: Db;
  const n = async (sql: string) =>
    Number(
      (await a.query<{ n: string }>(`select count(*) as n from ${sql}`))[0]!.n,
    );
  const balance = async (id: string) =>
    Number(
      (
        await a.query<{ balance: string }>(
          "select balance from wallets where twitch_user_id = $1 and currency_id = 'main'",
          [id],
        )
      )[0]?.balance ?? 0,
    );

  beforeAll(async () => {
    unlock = await lockDestructiveSuite(url!);
    a = pool();
    b = pool();
  }, LOCK_WAIT_MS);
  beforeEach(async () => {
    await a.query('drop schema public cascade; create schema public;');
    await migrate(a, 'all');
  });
  afterAll(async () => {
    for (const db of pools) await db.close();
    await unlock?.();
  });

  it('a credit in flight on a target wallet: the import waits for its lock, then refuses — no opening on top', async () => {
    const wallet = new WalletService(a);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let credited!: () => void;
    const inFlight = new Promise<void>((r) => (credited = r));
    // Connection A: a normal credit of 7, not yet committed (it holds the wallet lock).
    const writer = a.tx(async (q) => {
      await wallet.creditIn(q, {
        key: 'live-7',
        viewer: v('1001'),
        amount: 7,
        source: 'test',
      });
      credited();
      await gate;
    });
    await inFlight;
    // Connection B: the import passes its unlocked plan, then blocks on the wallet lock.
    const { snapshot, sha256 } = file();
    let settled = false;
    const imp = applyOpeningImport(b, snapshot, sha256).finally(
      () => (settled = true),
    );
    await sleep(400);
    expect(settled).toBe(false);
    release();
    await writer;
    await expect(imp).rejects.toThrow(/déjà mouvementé : 1001 \(solde 7/);
    expect(await balance('1001')).toBe(7);
    expect(await n('wallet_imports')).toBe(0);
    expect(await n("wallet_transactions where kind = 'opening_balance'")).toBe(
      0,
    );
    expect(await n('wallet_import_sources')).toBe(0);
  });

  it('a credit arriving while the import holds the locks waits for its commit, then lands after the opening', async () => {
    const { snapshot, sha256 } = file();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const holding = new Promise<void>((r) => (locked = r));
    // The import is paused just before its final control, wallet locks held.
    const paused: Db = {
      ...b,
      tx: (fn) =>
        b.tx((q) =>
          fn({
            query: async (sql, params) => {
              if (
                /kind = 'opening_balance'/.test(sql) &&
                /select twitch_user_id, amount/.test(sql)
              ) {
                locked();
                await gate;
              }
              return q.query(sql, params);
            },
          }),
        ),
    };
    const imp = applyOpeningImport(paused, snapshot, sha256);
    await holding;
    let done = false;
    const credit = new WalletService(a)
      .credit({ key: 'live-9', viewer: v('1002'), amount: 9, source: 'test' })
      .finally(() => (done = true));
    await sleep(400);
    expect(done).toBe(false); // blocked on the wallet lock of 1002
    release();
    expect((await imp).status).toBe('ready');
    expect((await credit).status).toBe('applied');
    expect(await balance('1002')).toBe(100 + 9);
    // The opening itself is untouched and the whole currency still verifies.
    expect(await verifyOpeningImport(a, snapshot, sha256)).toMatchObject({
      ok: true,
    });
  });

  it('the same import started twice at once on two connections: one opening per wallet, never two', async () => {
    const { snapshot, sha256 } = file();
    const results = await Promise.allSettled([
      applyOpeningImport(a, snapshot, sha256),
      applyOpeningImport(b, snapshot, sha256),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of results)
      if (r.status === 'rejected')
        expect(r.reason).toBeInstanceOf(OpeningImportError);
    expect(await n("wallet_transactions where kind = 'opening_balance'")).toBe(
      3,
    );
    expect(await n('wallet_import_sources')).toBe(5);
    // Whatever the loser saw, re-running is safe.
    expect((await applyOpeningImport(b, snapshot, sha256)).status).toBe(
      'already_applied',
    );
    expect(await verifyOpeningImport(a, snapshot, sha256)).toMatchObject({
      ok: true,
      sourceTotal: 5_500,
    });
  });

  it('a failure on a real server rolls everything back; the same file then applies once', async () => {
    const { snapshot, sha256 } = file();
    let k = 0;
    const crashing: Db = {
      ...b,
      tx: (fn) =>
        b.tx((q) =>
          fn({
            query: (sql, params) => {
              if (/insert into wallet_transactions/.test(sql) && ++k === 2)
                throw new Error('connection lost');
              return q.query(sql, params);
            },
          }),
        ),
    };
    await expect(
      applyOpeningImport(crashing, snapshot, sha256),
    ).rejects.toThrow('connection lost');
    for (const t of [
      'wallet_imports',
      'wallet_import_sources',
      'wallet_transactions',
      'wallet_operations',
    ])
      expect(await n(t)).toBe(0);
    expect((await applyOpeningImport(a, snapshot, sha256)).status).toBe(
      'ready',
    );
    expect((await applyOpeningImport(b, snapshot, sha256)).status).toBe(
      'already_applied',
    );
    expect(await verifyOpeningImport(a, snapshot, sha256)).toMatchObject({
      ok: true,
    });
  });
});
