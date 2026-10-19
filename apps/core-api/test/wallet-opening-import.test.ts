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
import { WalletService } from '../src/wallet/wallet-service.js';
import { count, setup, viewer } from './helpers.js';

// Opening balances (docs/ECONOMY_MIGRATION.md): an approved snapshot enters the Wallet once, all or nothing, never
// twice, never on top of a balance that already moved (checked under the wallet locks), every source account recorded
// once (imported to one Twitch ID, or excluded), verified before commit against this exact file.

type Row = OpeningSnapshot['rows'][number];
const row = (id: string, login: string, sources: [string, number][]): Row => ({
  twitch_user_id: id,
  login,
  balance: sources.reduce((a, [, b]) => a + b, 0),
  sources: sources.map(([source_ref, balance]) => ({ source_ref, balance })),
});
const EXCLUDED = [
  { source_ref: 'petit_compte', balance: 900, reason: 'non-follow < 3 000' },
  { source_ref: 'null', balance: 11_500, reason: 'artefact' },
];
const ROWS = [
  row('1001', 'alice', [['alice', 125_000]]),
  row('1002', 'bob', [['bob', 7]]),
  row('1003', 'carol', [['carol', 0]]),
  // Renamed: the source account carries the old name.
  row('1004', 'dave_new', [['dave_old', 999_999_999_999]]),
  // Two source accounts attached to one Twitch ID (same viewer).
  row('1005', 'erin', [
    ['erin_old', 740],
    ['erin_older', 460],
  ]),
];

function snap(over: Partial<OpeningSnapshot> = {}): OpeningSnapshot {
  const rows = over.rows ?? ROWS;
  const excluded = over.excluded ?? EXCLUDED;
  const all = [...rows.flatMap((r) => r.sources), ...excluded];
  return {
    import_id: 'se-test-1',
    currency_id: 'main',
    source: 'streamelements',
    cutoff: '2026-11-01T03:00:00.000Z',
    source_snapshot: {
      sha256: 'a'.repeat(64),
      accounts: all.length,
      total: all.reduce((a, x) => a + x.balance, 0),
    },
    ...over,
    rows,
    excluded,
  };
}

const file = (s: OpeningSnapshot) => readOpeningSnapshot(JSON.stringify(s));

async function balances(db: Db) {
  return Object.fromEntries(
    (
      await db.query<{ twitch_user_id: string; balance: number }>(
        "select twitch_user_id, balance from wallets where currency_id = 'main' and balance <> 0 order by 1",
      )
    ).map((r) => [r.twitch_user_id, Number(r.balance)]),
  );
}
const nothingWritten = async (db: Db) => {
  expect(await count(db, 'wallet_imports')).toBe(0);
  expect(await count(db, 'wallet_import_sources')).toBe(0);
  expect(await count(db, 'wallet_transactions')).toBe(0);
};

describe('opening balances import', () => {
  it('plans without writing, applies all rows exactly once, and verifies', async () => {
    const { db } = await setup();
    const { snapshot, sha256 } = file(snap());
    const plan = await planOpeningImport(db, snapshot, sha256);
    expect(plan).toMatchObject({
      status: 'ready',
      accounts: 5,
      credited: 4,
      zeros: 1,
      total: 125_000 + 7 + 999_999_999_999 + 1_200,
      sourceAccounts: 8,
      excludedAccounts: 2,
      excludedTotal: 12_400,
    });
    expect(await count(db, 'wallet_operations')).toBe(0);

    await applyOpeningImport(db, snapshot, sha256);
    expect(await balances(db)).toEqual({
      '1001': 125_000,
      '1002': 7,
      '1004': 999_999_999_999,
      '1005': 1_200,
    });
    // The source records stay on the ledger row; the login of the snapshot names a viewer never seen before.
    const ledger = await db.query<{
      twitch_user_id: string;
      kind: string;
      reference: string;
      source: string;
    }>(
      "select twitch_user_id, kind, reference, source from wallet_transactions where twitch_user_id in ('1004', '1005') order by 1",
    );
    expect(ledger).toEqual([
      {
        twitch_user_id: '1004',
        kind: 'opening_balance',
        reference: 'dave_old',
        source: 'streamelements',
      },
      {
        twitch_user_id: '1005',
        kind: 'opening_balance',
        reference: 'erin_old + erin_older',
        source: 'streamelements',
      },
    ]);
    expect(await verifyOpeningImport(db, snapshot, sha256)).toMatchObject({
      ok: true,
      excludedTotal: 12_400,
      sourceTotal: snapshot.source_snapshot.total,
    });
  });

  it('records every source account once: attached ones on their Twitch ID, excluded ones outside any wallet', async () => {
    const { db } = await setup();
    const { snapshot, sha256 } = file(snap());
    await applyOpeningImport(db, snapshot, sha256);
    const sources = await db.query<{
      source_ref: string;
      twitch_user_id: string | null;
      balance: number;
      status: string;
    }>(
      'select source_ref, twitch_user_id, balance, status from wallet_import_sources order by source_ref',
    );
    expect(sources).toHaveLength(8);
    expect(
      sources
        .filter((x) => x.twitch_user_id === '1005')
        .map((x) => [x.source_ref, Number(x.balance)]),
    ).toEqual([
      ['erin_old', 740],
      ['erin_older', 460],
    ]);
    // Excluded: recorded with their balance, never a wallet, never a ledger row.
    expect(
      sources
        .filter((x) => x.status === 'excluded')
        .map((x) => [x.source_ref, x.twitch_user_id, Number(x.balance)]),
    ).toEqual([
      ['null', null, 11_500],
      ['petit_compte', null, 900],
    ]);
    expect(
      await count(
        db,
        "wallet_transactions where reference in ('petit_compte', 'null')",
      ),
    ).toBe(0);
    const reg = (
      await db.query<{
        source_total: number;
        excluded_total: number;
        total: number;
      }>('select source_total, excluded_total, total from wallet_imports')
    )[0]!;
    expect(Number(reg.total) + Number(reg.excluded_total)).toBe(
      Number(reg.source_total),
    );
    // Append-only.
    await expect(
      db.query(
        "update wallet_import_sources set balance = 1 where source_ref = 'null'",
      ),
    ).rejects.toThrow();
  });

  it('the same file again is « already applied »: nothing changes, and it still verifies', async () => {
    const { db } = await setup();
    const { snapshot, sha256 } = file(snap());
    await applyOpeningImport(db, snapshot, sha256);
    const ops = await count(db, 'wallet_transactions');
    expect((await applyOpeningImport(db, snapshot, sha256)).status).toBe(
      'already_applied',
    );
    expect(await count(db, 'wallet_transactions')).toBe(ops);
    expect((await verifyOpeningImport(db, snapshot, sha256)).ok).toBe(true);
  });

  it('refuses any other snapshot for the currency (other id, or same id with other content)', async () => {
    const { db } = await setup();
    const first = file(snap());
    await applyOpeningImport(db, first.snapshot, first.sha256);
    const before = await balances(db);
    for (const other of [
      snap({ import_id: 'se-test-2' }),
      snap({ cutoff: '2026-11-02T03:00:00.000Z' }),
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
    const bad = snap({
      rows: [
        ...ROWS,
        row('1001', 'alice', [['alice2', 3]]),
        {
          ...row('1006', 'eve', [['eve', 0]]),
          balance: -10,
          sources: [{ source_ref: 'eve', balance: -10 }],
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

  it('strict snapshot: real Twitch IDs only, every source once, rows = their sources, imported + excluded = source', async () => {
    const { db } = await setup();
    // Twitch ID « 0 » (the raptoru_ test ID), a leading zero, a login with a space: refused by the schema.
    for (const id of ['0', '0123'])
      expect(() => file(snap({ rows: [row(id, 'x', [['x', 5]])] }))).toThrow();
    expect(() =>
      file(snap({ rows: [row('1009', 'le flouz', [['le flouz', 5]])] })),
    ).toThrow();
    // A field the format does not know: refused (strict).
    expect(() =>
      readOpeningSnapshot(JSON.stringify({ ...snap(), extra: 1 })),
    ).toThrow();

    const cases: [OpeningSnapshot, RegExp][] = [
      // The same source account imported twice (two wallets) or imported AND excluded.
      [
        snap({ rows: [...ROWS, row('1007', 'frank', [['alice', 10]])] }),
        /compte source en double : alice/,
      ],
      [
        snap({
          excluded: [
            ...EXCLUDED,
            { source_ref: 'bob', balance: 7, reason: 'x' },
          ],
        }),
        /compte source en double : bob/,
      ],
      // A row whose balance is not the sum of its sources.
      [
        snap({
          rows: ROWS.map((r) =>
            r.twitch_user_id === '1005' ? { ...r, balance: 1_201 } : r,
          ),
        }),
        /somme de ses comptes sources : 1005/,
      ],
      // A truncated file: fewer accounts / less money than the source snapshot.
      [
        {
          ...snap(),
          source_snapshot: { ...snap().source_snapshot, accounts: 9 },
        },
        /comptes sources 8 ≠ snapshot source 9/,
      ],
      [
        {
          ...snap(),
          source_snapshot: {
            ...snap().source_snapshot,
            total: snap().source_snapshot.total + 1,
          },
        },
        /total importé \+ exclu/,
      ],
    ];
    for (const [s, why] of cases) {
      const f = file(s);
      const plan = await planOpeningImport(db, f.snapshot, f.sha256);
      expect(plan.status).toBe('blocked');
      expect(plan.blocking.join('\n')).toMatch(why);
      await expect(
        applyOpeningImport(db, f.snapshot, f.sha256),
      ).rejects.toThrow(OpeningImportError);
    }
    await nothingWritten(db);
  });

  it('a credit committed between the plan and the wallet locks refuses the import (Astra B3): no 7 + 100', async () => {
    const { db } = await setup();
    const wallet = new WalletService(db);
    let injected = false;
    // Under READ COMMITTED a writer can commit between the unlocked plan and the locks; here it is injected there.
    const racing: Db = {
      ...db,
      tx: (fn) =>
        db.tx((q) =>
          fn({
            query: async (sql, params) => {
              const r = await q.query(sql, params);
              if (!injected && /insert into wallet_imports/.test(sql)) {
                injected = true;
                await wallet.creditIn(q, {
                  key: 'live-7',
                  viewer: viewer('1001', 'Alice'),
                  amount: 7,
                  source: 'test',
                });
              }
              return r as never;
            },
          }),
        ),
    };
    const { snapshot, sha256 } = file(snap());
    await expect(applyOpeningImport(racing, snapshot, sha256)).rejects.toThrow(
      /déjà mouvementé : 1001 \(solde 7/,
    );
    // The whole transaction is rolled back (the injected credit with it, here): no opening anywhere.
    await nothingWritten(db);
  });

  it('a target wallet with a balance but no ledger is refused before anything is committed (Astra I2)', async () => {
    const { db } = await setup();
    await db.query(
      "insert into viewers (twitch_user_id, login, display_name) values ('1001', 'alice', 'Alice')",
    );
    await db.query(
      "insert into wallets (twitch_user_id, currency_id, balance) values ('1001', 'main', 7)",
    );
    const { snapshot, sha256 } = file(snap());
    expect(
      (await planOpeningImport(db, snapshot, sha256)).blocking.join(),
    ).toMatch(/déjà mouvementé : 1001/);
    await expect(applyOpeningImport(db, snapshot, sha256)).rejects.toThrow(
      OpeningImportError,
    );
    expect(await count(db, 'wallet_imports')).toBe(0);
    expect(await count(db, 'wallet_transactions')).toBe(0);
  });

  it('any inconsistency of the currency found by the final control rolls the import back before commit', async () => {
    const { db } = await setup();
    // A wallet OUTSIDE the snapshot whose balance is not its ledger: the import must not be committed next to it.
    await db.query(
      "insert into viewers (twitch_user_id, login, display_name) values ('2000', 'zed', 'Zed')",
    );
    await db.query(
      "insert into wallets (twitch_user_id, currency_id, balance) values ('2000', 'main', 3)",
    );
    const { snapshot, sha256 } = file(snap());
    await expect(applyOpeningImport(db, snapshot, sha256)).rejects.toThrow(
      /contrôle avant validation/,
    );
    expect(await count(db, 'wallet_imports')).toBe(0);
    expect(await count(db, 'wallet_transactions')).toBe(0);
  });

  it('a failure in the middle keeps nothing; the same import then applies cleanly', async () => {
    const { db } = await setup();
    // Second ledger row, second excluded source, then the final control itself (run once, before commit).
    for (const [at, nth] of [
      [/insert into wallet_transactions/, 2],
      [/insert into wallet_import_sources[\s\S]*'excluded'/, 2],
      [
        /from wallet_transactions\s+where currency_id = \$1 and kind = 'opening_balance'/,
        1,
      ],
    ] as const) {
      let n = 0;
      const crashing: Db = {
        ...db,
        tx: (fn) =>
          db.tx((q) =>
            fn({
              query: (sql, params) => {
                if (at.test(sql) && ++n === nth)
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
      await nothingWritten(db);
    }
    const { snapshot, sha256 } = file(snap());
    await applyOpeningImport(db, snapshot, sha256);
    expect(await verifyOpeningImport(db, snapshot, sha256)).toMatchObject({
      ok: true,
    });
  });

  it('a commit whose answer was lost: re-running the same file says « already applied » and verifies, never pays twice', async () => {
    const { db } = await setup();
    const { snapshot, sha256 } = file(snap());
    const lostAnswer: Db = {
      ...db,
      tx: async (fn) => {
        await db.tx(fn);
        throw new Error('connection reset after COMMIT');
      },
    };
    await expect(
      applyOpeningImport(lostAnswer, snapshot, sha256),
    ).rejects.toThrow('after COMMIT');
    const rows = await count(db, 'wallet_transactions');
    expect((await applyOpeningImport(db, snapshot, sha256)).status).toBe(
      'already_applied',
    );
    expect(await count(db, 'wallet_transactions')).toBe(rows);
    expect((await verifyOpeningImport(db, snapshot, sha256)).ok).toBe(true);
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

  it('the control certifies only the imported file (Astra I1): no import, other id / cutoff / source / references', async () => {
    const { db } = await setup();
    // Nothing imported: an all-zero snapshot is not « ok ».
    const zero = file(
      snap({ rows: [row('1001', 'alice', [['alice', 0]])], excluded: [] }),
    );
    expect(
      await verifyOpeningImport(db, zero.snapshot, zero.sha256),
    ).toMatchObject({ ok: false });

    const { snapshot, sha256 } = file(snap());
    await applyOpeningImport(db, snapshot, sha256);
    for (const other of [
      snap({ import_id: 'other-id' }),
      snap({ cutoff: '2020-01-01T00:00:00.000Z' }),
      snap({ source: 'other' }),
      snap({
        rows: ROWS.map((r) =>
          r.twitch_user_id === '1004'
            ? {
                ...r,
                sources: [{ source_ref: 'someone_else', balance: r.balance }],
              }
            : r,
        ),
      }),
      snap({
        excluded: [
          {
            source_ref: 'petit_compte',
            balance: 900,
            reason: 'non-follow < 3 000',
          },
          { source_ref: 'autre', balance: 11_500, reason: 'artefact' },
        ],
      }),
    ]) {
      const f = file(other);
      const v = await verifyOpeningImport(db, f.snapshot, f.sha256);
      expect(v.ok).toBe(false);
      expect(v.problems.length).toBeGreaterThan(0);
    }
    // Same content, other fingerprint (another file): not certified either.
    expect((await verifyOpeningImport(db, snapshot, 'b'.repeat(64))).ok).toBe(
      false,
    );
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
    expect(await verifyOpeningImport(core.db, snapshot, sha256)).toMatchObject({
      ok: true,
    });

    await core.wallet.wallet.credit({
      key: 'stray',
      viewer: viewer('2000', 'Zed'),
      amount: 3,
      kind: 'opening_balance',
      source: 'manual',
    });
    const v = await verifyOpeningImport(core.db, snapshot, sha256);
    expect(v.ok).toBe(false);
    expect(v.unexpected).toEqual([{ twitch_user_id: '2000', amount: 3 }]);

    // A snapshot that does not match what was imported: every differing row is listed.
    const wrong = snap({
      rows: ROWS.map((r) =>
        r.twitch_user_id === '1002' ? row('1002', 'bob', [['bob', 8]]) : r,
      ),
    });
    const f = file(wrong);
    expect(
      (await verifyOpeningImport(core.db, f.snapshot, f.sha256)).mismatches,
    ).toEqual([{ twitch_user_id: '1002', expected: 8, actual: 7 }]);
  });
});
