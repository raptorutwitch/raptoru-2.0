import { describe, expect, it } from 'vitest';
import {
  applyOpeningImport,
  readOpeningSnapshot,
  verifyOpeningImport,
} from '../src/wallet/opening-import.js';
import {
  convertSelection,
  SelectionConversionError,
} from '../src/wallet/selection-to-opening.js';
import { count, setup } from './helpers.js';

// Selection manifest → opening snapshot: one row per destination Twitch ID, attached accounts grouped, excluded ones
// kept out, totals exact; anything not validated, missing or contradictory is refused (fictitious data only).

const AT = '2026-11-01T03:00:00.000Z';
type R = Record<string, unknown>;
const retained = (
  se: string,
  points: number,
  id: string,
  login: string,
): R => ({
  se,
  points,
  status: 'retenu',
  status_detail: 'règle',
  rule: 'T',
  decision: null,
  attach: null,
  destination: id,
  destination_login: login,
});
const attached = (
  se: string,
  points: number,
  id: string,
  login: string,
  target: { target_se?: string; target_twitch_id?: string },
): R => ({
  se,
  points,
  status: 'rattachement',
  status_detail: 'rattaché, destination vérifiée',
  rule: 'I:multi',
  decision: 'attach',
  attach: {
    target_se: target.target_se ?? null,
    target_twitch_id: target.target_twitch_id ?? null,
    others: [],
  },
  destination: id,
  destination_login: login,
});
const excluded = (se: string, points: number): R => ({
  se,
  points,
  status: 'exclu',
  status_detail: 'règle',
  rule: 'R1',
  decision: null,
  attach: null,
  destination_login: null,
});
const ROWS: R[] = [
  retained('alice', 125_000, '1001', 'alice'),
  // Typo account attached to the real viewer (target account + its Twitch ID).
  attached('alicee', 300_000, '1001', 'alice', {
    target_se: 'alice',
    target_twitch_id: '1001',
  }),
  // Two old accounts of a renamed viewer, attached to its Twitch ID only (no account under the new name).
  attached('bob_old', 740, '1002', 'bob_now', { target_twitch_id: '1002' }),
  attached('bob_older', 460, '1002', 'bob_now', { target_twitch_id: '1002' }),
  retained('carol', 0, '1003', 'carol'),
  excluded('petit', 900),
  excluded('le flouz', 150),
];

function files(rows: R[] = ROWS, over: R = {}, rawOver: R = {}) {
  const total = rows.reduce((a, r) => a + (r.points as number), 0);
  const manifest = {
    type: 'manifeste-de-selection-provisoire',
    not_an_import_manifest: true,
    generated_at: '2026-11-01T04:00:00.000Z',
    policy: 'politique de test',
    complete: true,
    valid: true,
    problems: [],
    snapshot: { snapshot: AT, comptes: rows.length, jetons: total },
    rows,
    ...over,
  };
  const pass = rows.map((r) => ({ username: r.se, points: r.points }));
  const raw = { at: AT, passes: [pass, [...pass].reverse()], ...rawOver };
  return {
    manifestText: JSON.stringify(manifest),
    rawText: JSON.stringify(raw),
    importId: 'se-sel-1',
    currencyId: 'main',
    source: 'streamelements',
  };
}
const refused = (input: ReturnType<typeof files>, why: RegExp) => {
  try {
    convertSelection(input);
  } catch (e) {
    expect(e).toBeInstanceOf(SelectionConversionError);
    expect((e as SelectionConversionError).blocking.join('\n')).toMatch(why);
    return;
  }
  throw new Error('conversion accepted');
};

describe('selection manifest → opening snapshot', () => {
  it('one row per destination, attached accounts grouped, excluded kept out, exact totals, reproducible bytes', () => {
    const r = convertSelection(files());
    expect(r.snapshot.rows).toEqual([
      {
        twitch_user_id: '1001',
        login: 'alice',
        balance: 425_000,
        sources: [
          { source_ref: 'alice', balance: 125_000 },
          { source_ref: 'alicee', balance: 300_000 },
        ],
      },
      {
        twitch_user_id: '1002',
        login: 'bob_now',
        balance: 1_200,
        sources: [
          { source_ref: 'bob_old', balance: 740 },
          { source_ref: 'bob_older', balance: 460 },
        ],
      },
      {
        twitch_user_id: '1003',
        login: 'carol',
        balance: 0,
        sources: [{ source_ref: 'carol', balance: 0 }],
      },
    ]);
    expect(r.snapshot.excluded.map((x) => [x.source_ref, x.balance])).toEqual([
      ['le flouz', 150],
      ['petit', 900],
    ]);
    expect(r.summary).toEqual({
      sourceAccounts: 7,
      wallets: 3,
      attachedAccounts: 3,
      importedTotal: 426_200,
      excludedAccounts: 2,
      excludedTotal: 1_050,
    });
    expect(r.snapshot.source_snapshot.total).toBe(427_250);
    expect(r.snapshot.provenance?.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(convertSelection(files()).text).toBe(r.text);
  });

  it('the converted file imports and verifies: retained and attached credited exactly, excluded recorded only', async () => {
    const { db } = await setup();
    const { snapshot, sha256 } = readOpeningSnapshot(
      convertSelection(files()).text,
    );
    expect((await applyOpeningImport(db, snapshot, sha256)).status).toBe(
      'ready',
    );
    expect(await verifyOpeningImport(db, snapshot, sha256)).toMatchObject({
      ok: true,
      sourceTotal: 427_250,
      excludedTotal: 1_050,
    });
    expect(
      await count(
        db,
        "wallet_import_sources where status = 'excluded' and twitch_user_id is null",
      ),
    ).toBe(2);
    expect(await count(db, 'wallet_transactions')).toBe(2);
  });

  it('refuses a manifest that is not validated, complete or clean', () => {
    refused(files(ROWS, { valid: false }), /non validé/);
    refused(files(ROWS, { complete: false }), /incomplet/);
    refused(files(ROWS, { problems: [{ se: 'x', issue: 'y' }] }), /problème/);
    refused(
      files([...ROWS, { ...excluded('z', 1), status: 'attente' }]),
      /sans décision : z/,
    );
    expect(() =>
      convertSelection(files(ROWS, { type: 'manifeste-d-import' })),
    ).toThrow();
  });

  it("refuses destinations that are absent or contradictory (e.g. a Twitch ID that is not the target account's)", () => {
    // The target account's Twitch ID is 1001 but the attachment names another ID.
    refused(
      files(
        ROWS.map((r) =>
          r.se === 'alicee'
            ? attached('alicee', 300_000, '1001', 'alice', {
                target_se: 'alice',
                target_twitch_id: '9999',
              })
            : r,
        ),
      ),
      /9999 ≠ destination 1001/,
    );
    refused(
      files(
        ROWS.map((r) =>
          r.se === 'alicee'
            ? attached('alicee', 300_000, '9999', 'other', {
                target_se: 'alice',
              })
            : r,
        ),
      ),
      /celle du compte cible/,
    );
    refused(
      files(
        ROWS.map((r) => (r.se === 'carol' ? { ...r, destination: null } : r)),
      ),
      /destination Twitch absente : carol/,
    );
    refused(
      files(
        ROWS.map((r) => (r.se === 'alice' ? excluded('alice', 125_000) : r)),
      ),
      /compte cible non repris/,
    );
    refused(
      files(
        ROWS.map((r) =>
          r.se === 'bob_old'
            ? { ...r, status_detail: 'à rattacher, destination à vérifier' }
            : r,
        ),
      ),
      /non vérifié : bob_old/,
    );
    refused(
      files(
        ROWS.map((r) =>
          r.se === 'bob_old'
            ? { ...r, attach: { target_se: null, target_twitch_id: null } }
            : r,
        ),
      ),
      /sans cible : bob_old/,
    );
    refused(
      files(
        ROWS.map((r) =>
          r.se === 'bob_old' ? { ...r, destination_login: 'someone' } : r,
        ),
      ),
      /pseudos différents pour le Twitch ID 1002/,
    );
  });

  it('refuses duplicates and any difference with the raw export', () => {
    refused(
      files([...ROWS, retained('alice', 1, '1004', 'x')]),
      /double dans le manifeste : alice/,
    );
    const f = files();
    const raw = JSON.parse(f.rawText);
    refused(
      {
        ...f,
        rawText: JSON.stringify({
          ...raw,
          passes: [
            raw.passes[0].map((p: R) =>
              p.username === 'petit' ? { ...p, points: 901 } : p,
            ),
          ],
        }),
      },
      /solde différent de l'export brut : petit/,
    );
    refused(
      {
        ...f,
        rawText: JSON.stringify({
          ...raw,
          passes: [[...raw.passes[0], { username: 'oublie', points: 5 }]],
        }),
      },
      /absent du manifeste : oublie/,
    );
    refused(
      {
        ...f,
        rawText: JSON.stringify({ ...raw, passes: [raw.passes[0].slice(1)] }),
      },
      /absent de l'export brut : alice/,
    );
    refused(
      {
        ...f,
        rawText: JSON.stringify({
          ...raw,
          passes: [raw.passes[0], raw.passes[0].slice(1)],
        }),
      },
      /passes de l'export brut différentes/,
    );
    refused(
      files(ROWS, { snapshot: { snapshot: AT, comptes: 7, jetons: 1 } }),
      /≠ snapshot 7 \/ 1/,
    );
    refused(
      files(ROWS, {}, { at: '2026-10-01T00:00:00.000Z' }),
      /date du snapshot brut/,
    );
  });
});
