import { describe, expect, it } from 'vitest';
import { economyPreflight } from '../src/economy/activation.js';
import {
  convertLegacyCredits,
  type LegacyCreditsExport,
  LegacyCreditsError,
} from '../src/wallet/legacy-credits-to-opening.js';
import {
  applyOpeningImport,
  readOpeningSnapshot,
  verifyOpeningImport,
} from '../src/wallet/opening-import.js';
import { count, setup } from './helpers.js';

// Historical Crédits TTS / Soundboard (docs/ECONOMY_MIGRATION.md § 15): a drained export of the legacy table
// ext_channel_point_redemptions → one opening per credits currency, through the secure opening import. Synthetic rows
// only (no real export in the repository).

const CUTOFF = '2026-10-25T20:00:00.000Z';
const row = (
  id: string,
  over: Partial<LegacyCreditsExport['rows'][number]> = {},
): LegacyCreditsExport['rows'][number] => ({
  redemption_id: id,
  reward_key: 'tts',
  twitch_user_id: '5001',
  login: 'alice',
  status: 'available',
  expires_at: '2027-06-01T00:00:00.000Z',
  credit_units: 1,
  credit_remaining: 1,
  credit_in_flight: 0,
  ...over,
});
function exportText(rows: LegacyCreditsExport['rows']) {
  const remaining: Record<string, number> = {};
  for (const r of rows)
    remaining[r.reward_key] =
      (remaining[r.reward_key] ?? 0) + r.credit_remaining;
  return JSON.stringify({
    source: 'legacy-ext-redemptions',
    exported_at: '2026-10-25T20:05:00.000Z',
    cutoff: CUTOFF,
    declared: { rows: rows.length, remaining },
    rows,
  });
}
const ROWS = [
  row('r1'),
  row('r2'),
  // A Soundboard pack of 3, one used: 2 left.
  row('r3', { reward_key: 'sound', credit_units: 3, credit_remaining: 2 }),
  // Bob renamed: the latest login is kept, the ID is the key.
  row('r4', {
    twitch_user_id: '5002',
    login: 'bob_old',
    expires_at: '2027-01-01T00:00:00.000Z',
  }),
  row('r5', { twitch_user_id: '5002', login: 'Bob_New' }),
  // Not a balance at the cutoff: expired, settled, used up.
  row('r6', { expires_at: '2026-10-01T00:00:00.000Z' }),
  row('r7', { status: 'fulfilled', twitch_user_id: '5003', login: 'carol' }),
  row('r8', { credit_remaining: 0, status: 'fulfilled' }),
];
const refused = (rows: LegacyCreditsExport['rows'], text?: string) => {
  try {
    convertLegacyCredits({
      exportText: text ?? exportText(rows),
      importPrefix: 'legacy-credits-t',
    });
    return [];
  } catch (e) {
    if (!(e instanceof LegacyCreditsError)) throw e;
    return e.blocking;
  }
};

describe('historical credits → opening snapshots', () => {
  it('per viewer and currency: valid credits kept, expired / settled ones excluded with their reason, reproducible', () => {
    const a = convertLegacyCredits({
      exportText: exportText(ROWS),
      importPrefix: 'legacy-credits-t',
    });
    const b = convertLegacyCredits({
      exportText: exportText(ROWS),
      importPrefix: 'legacy-credits-t',
    });
    expect(a.snapshots.map((s) => s.text)).toEqual(
      b.snapshots.map((s) => s.text),
    );
    const [tts, sound] = a.snapshots.map((s) => s.snapshot);
    expect(tts).toMatchObject({
      import_id: 'legacy-credits-t-tts',
      currency_id: 'credits_tts',
      cutoff: CUTOFF,
      source_snapshot: { accounts: 6, total: 6 },
      rows: [
        { twitch_user_id: '5001', login: 'alice', balance: 2 },
        { twitch_user_id: '5002', login: 'bob_new', balance: 2 },
      ],
    });
    expect(tts!.excluded.map((x) => [x.source_ref, x.reason])).toEqual([
      ['ext-redemption:r6', 'expiré à la coupure'],
      ['ext-redemption:r7', 'statut fulfilled'],
    ]);
    expect(sound).toMatchObject({
      currency_id: 'credits_soundboard',
      rows: [{ twitch_user_id: '5001', balance: 2 }],
      excluded: [],
    });
    expect(a.summary.currencies).toEqual({
      credits_tts: {
        viewers: 2,
        imported: 4,
        excluded_rows: 2,
        excluded: 2,
        reasons: { 'expiré à la coupure': 1, 'statut fulfilled': 1 },
      },
      credits_soundboard: {
        viewers: 1,
        imported: 2,
        excluded_rows: 0,
        excluded: 0,
        reasons: {},
      },
    });
    expect(a.summary.renamed).toBe(1);
  });

  it('refused: in flight, unknown reward, unresolved identity, Lab credits, duplicates, totals not matching', () => {
    expect(
      refused([row('x', { status: 'claimed', credit_in_flight: 1 })]),
    ).toEqual([expect.stringContaining('crédit en vol')]);
    expect(refused([row('x', { reward_key: 'bonk' })])).toEqual([
      expect.stringContaining('reward_key inconnue'),
    ]);
    expect(refused([row('x', { twitch_user_id: '0' })])).toEqual([
      'identité non résolue : x',
    ]);
    expect(refused([row('lab-credit-tts-1')])).toEqual([
      'crédit du Lab de test : lab-credit-tts-1',
    ]);
    expect(refused([row('x'), row('x')])).toEqual(['redemption en double : x']);
    const text = JSON.parse(exportText([row('x')]));
    text.declared.remaining.tts = 5;
    expect(refused([], JSON.stringify(text))).toEqual([
      "crédits tts : 1 ≠ total déclaré par l'export 5",
    ]);
    text.declared = { rows: 2, remaining: { tts: 1 } };
    expect(refused([], JSON.stringify(text))).toEqual([
      "lignes 1 ≠ lignes déclarées par l'export 2",
    ]);
    // Never the Lab test wallet: another source is not even parsed.
    expect(() =>
      convertLegacyCredits({
        exportText: JSON.stringify({ ...text, source: 'lab_wallets' }),
        importPrefix: 'legacy-credits-t',
      }),
    ).toThrow();
  });

  it('imported once into the canonical Wallet, in each credits currency, never in Jetons; verified; replay changes nothing', async () => {
    const core = await setup();
    const { snapshots } = convertLegacyCredits({
      exportText: exportText(ROWS),
      importPrefix: 'legacy-credits-t',
    });
    for (const s of snapshots) {
      const { snapshot, sha256 } = readOpeningSnapshot(s.text);
      expect((await applyOpeningImport(core.db, snapshot, sha256)).status).toBe(
        'ready',
      );
      expect((await applyOpeningImport(core.db, snapshot, sha256)).status).toBe(
        'already_applied',
      );
      expect((await verifyOpeningImport(core.db, snapshot, sha256)).ok).toBe(
        true,
      );
    }
    const balances = await core.db.query<{
      twitch_user_id: string;
      currency_id: string;
      balance: string;
    }>(
      'select twitch_user_id, currency_id, balance from wallets order by currency_id, twitch_user_id',
    );
    expect(
      balances.map((b) => [b.twitch_user_id, b.currency_id, Number(b.balance)]),
    ).toEqual([
      ['5001', 'credits_soundboard', 2],
      ['5001', 'credits_tts', 2],
      ['5002', 'credits_tts', 2],
    ]);
    expect(await count(core.db, "wallets where currency_id = 'main'")).toBe(0);
    // The two credits imports are what the activation asks for (the Jetons one is still missing here).
    expect((await economyPreflight(core.db)).blocking).toEqual([
      "aucun import d'ouverture appliqué à la monnaie principale",
    ]);
  });

  it('a source without any credit: two empty imports, recorded (the activation knows it was looked at)', async () => {
    const core = await setup();
    const { snapshots, summary } = convertLegacyCredits({
      exportText: exportText([]),
      importPrefix: 'legacy-credits-e',
    });
    expect(summary.currencies.credits_tts!.viewers).toBe(0);
    for (const s of snapshots) {
      const { snapshot, sha256 } = readOpeningSnapshot(s.text);
      await applyOpeningImport(core.db, snapshot, sha256);
      expect((await verifyOpeningImport(core.db, snapshot, sha256)).ok).toBe(
        true,
      );
    }
    expect(await count(core.db, 'wallet_imports')).toBe(2);
    expect(await count(core.db, 'wallets')).toBe(0);
  });
});
