import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db/db.js';
import {
  applyOpeningImport,
  OpeningImportError,
  planOpeningImport,
  readOpeningSnapshot,
  verifyOpeningImport,
  type OpeningSnapshot,
} from '../src/wallet/opening-import.js';
import { count, setup, viewer } from './helpers.js';

// Opening balances (docs/ECONOMY_MIGRATION.md): an approved snapshot enters the Wallet once, all or nothing, never
// twice, never on top of a balance that already moved; the control finds any difference.

function snap(over: Partial<OpeningSnapshot> = {}): OpeningSnapshot {
  return {
    import_id: 'se-test-1',
    currency_id: 'main',
    source: 'streamelements',
    cutoff: '2026-11-01T03:00:00.000Z',
    rows: [
      {
        twitch_user_id: '1001',
        login: 'alice',
        balance: 125_000,
        source_ref: 'alice',
      },
      { twitch_user_id: '1002', login: 'bob', balance: 7, source_ref: 'bob' },
      {
        twitch_user_id: '1003',
        login: 'carol',
        balance: 0,
        source_ref: 'carol',
      },
      {
        twitch_user_id: '1004',
        login: 'dave_new',
        balance: 999_999_999_999,
        source_ref: 'dave_old',
      },
    ],
    ...over,
  };
}

const file = (s: OpeningSnapshot) => readOpeningSnapshot(JSON.stringify(s));

async function balances(db: Db) {
  return Object.fromEntries(
    (
      await db.query<{ twitch_user_id: string; balance: number }>(
        "select twitch_user_id, balance from wallets where currency_id = 'main' order by 1",
      )
    ).map((r) => [r.twitch_user_id, Number(r.balance)]),
  );
}

describe('opening balances import', () => {
  it('plans without writing, applies all rows exactly once, and verifies', async () => {
    const { db } = await setup();
    const { snapshot, sha256 } = file(snap());
    const plan = await planOpeningImport(db, snapshot, sha256);
    expect(plan).toMatchObject({
      status: 'ready',
      accounts: 4,
      credited: 3,
      zeros: 1,
      total: 125_000 + 7 + 999_999_999_999,
    });
    expect(await count(db, 'wallet_operations')).toBe(0);

    await applyOpeningImport(db, snapshot, sha256);
    expect(await balances(db)).toEqual({
      '1001': 125_000,
      '1002': 7,
      '1004': 999_999_999_999,
    });
    // The source record stays on the ledger row; the login of the snapshot names a viewer never seen before.
    const row = (
      await db.query<{ kind: string; reference: string; source: string }>(
        "select kind, reference, source from wallet_transactions where twitch_user_id = '1004'",
      )
    )[0];
    expect(row).toEqual({
      kind: 'opening_balance',
      reference: 'dave_old',
      source: 'streamelements',
    });
    expect(await verifyOpeningImport(db, snapshot)).toMatchObject({ ok: true });
  });

  it('the same file again is « already applied »: nothing changes', async () => {
    const { db } = await setup();
    const { snapshot, sha256 } = file(snap());
    await applyOpeningImport(db, snapshot, sha256);
    const ops = await count(db, 'wallet_transactions');
    expect((await applyOpeningImport(db, snapshot, sha256)).status).toBe(
      'already_applied',
    );
    expect(await count(db, 'wallet_transactions')).toBe(ops);
  });

  it('refuses any other snapshot for the currency (other id, or same id with other content)', async () => {
    const { db } = await setup();
    const first = file(snap());
    await applyOpeningImport(db, first.snapshot, first.sha256);
    const before = await balances(db);
    for (const other of [
      snap({ import_id: 'se-test-2' }),
      snap({
        rows: snap().rows.map((r) => ({ ...r, balance: r.balance + 1 })),
      }),
    ]) {
      const f = file(other);
      await expect(
        applyOpeningImport(db, f.snapshot, f.sha256),
      ).rejects.toThrow(OpeningImportError);
    }
    expect(await balances(db)).toEqual(before);
  });

  it('refuses a target wallet that already moved, debts and duplicates — and then writes nothing', async () => {
    const core = await setup();
    await core.wallet.wallet.credit({
      key: 'live-1',
      viewer: viewer('1002', 'Bob'),
      amount: 50,
      source: 'test',
    });
    const rows = snap().rows;
    const bad = snap({
      rows: [
        ...rows,
        { ...rows[0]!, source_ref: 'alice2' },
        {
          twitch_user_id: '1005',
          login: 'eve',
          balance: -10,
          source_ref: 'eve',
        },
      ],
    });
    const f = file(bad);
    const plan = await planOpeningImport(core.db, f.snapshot, f.sha256);
    expect(plan.status).toBe('blocked');
    expect(plan.blocking.join('\n')).toMatch(
      /double : 1001[\s\S]*négatif[\s\S]*déjà mouvementé : 1002/,
    );
    await expect(
      applyOpeningImport(core.db, f.snapshot, f.sha256),
    ).rejects.toThrow(OpeningImportError);
    expect(await count(core.db, 'wallet_imports')).toBe(0);
    expect(await balances(core.db)).toEqual({ '1002': 50 });
  });

  it('a failure in the middle keeps nothing; the same import then applies cleanly', async () => {
    const { db } = await setup();
    let n = 0;
    const crashing: Db = {
      ...db,
      tx: (fn) =>
        db.tx((q) =>
          fn({
            query: (sql, params) => {
              if (/insert into wallet_transactions/.test(sql) && ++n === 2)
                throw new Error('connection lost');
              return q.query(sql, params);
            },
          }),
        ),
    };
    const { snapshot, sha256 } = file(snap());
    await expect(
      applyOpeningImport(crashing, snapshot, sha256),
    ).rejects.toThrow('connection lost');
    expect(await count(db, 'wallet_imports')).toBe(0);
    expect(await count(db, 'wallet_transactions')).toBe(0);
    await applyOpeningImport(db, snapshot, sha256);
    expect(await verifyOpeningImport(db, snapshot)).toMatchObject({ ok: true });
  });

  it('the database itself refuses a second opening for a wallet, whatever its key', async () => {
    const core = await setup();
    const { snapshot, sha256 } = file(snap());
    await applyOpeningImport(core.db, snapshot, sha256);
    await expect(
      core.wallet.wallet.credit({
        key: 'another-key',
        viewer: viewer('1001', 'Alice'),
        amount: 1,
        kind: 'opening_balance',
        source: 'streamelements',
      }),
    ).rejects.toThrow();
    expect((await balances(core.db))['1001']).toBe(125_000);
  });

  it('stays verifiable after live movements, and reports any opening outside the snapshot', async () => {
    const core = await setup();
    const { snapshot, sha256 } = file(snap());
    await applyOpeningImport(core.db, snapshot, sha256);
    await core.wallet.wallet.spend({
      key: 's1',
      viewer: viewer('1001', 'Alice'),
      amount: 5_000,
      source: 'test',
    });
    expect(await verifyOpeningImport(core.db, snapshot)).toMatchObject({
      ok: true,
    });

    await core.wallet.wallet.credit({
      key: 'stray',
      viewer: viewer('2000', 'Zed'),
      amount: 3,
      kind: 'opening_balance',
      source: 'manual',
    });
    const v = await verifyOpeningImport(core.db, snapshot);
    expect(v.ok).toBe(false);
    expect(v.unexpected).toEqual([{ twitch_user_id: '2000', amount: 3 }]);

    // A snapshot that does not match what was imported: every differing row is listed.
    const wrong = snap({
      rows: snap().rows.map((r) =>
        r.twitch_user_id === '1002' ? { ...r, balance: 8 } : r,
      ),
    });
    expect((await verifyOpeningImport(core.db, wrong)).mismatches).toEqual([
      { twitch_user_id: '1002', expected: 8, actual: 7 },
    ]);
  });
});
