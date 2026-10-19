import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Db, Queryable } from '../db/db.js';
import { findCurrency } from './currencies.js';
import { MAX_AMOUNT, WalletService } from './wallet-service.js';

// Opening balances (economic cutover, docs/ECONOMY_MIGRATION.md). An APPROVED snapshot — one row per Twitch ID with
// the source accounts attached to it, plus the excluded source accounts, together equal to the source snapshot —
// enters the Wallet once, in one transaction: all of it or nothing. Plan (dry run) → apply → verify. The database
// refuses a second import for the currency and a second opening per wallet (migration 20261028130000); every source
// account is recorded once (20261029130000). The target wallets are locked and must be pristine (balance 0, no
// ledger row) under that lock; the full verification runs before commit. Never a delta, never an addition on top of
// live balances: a newer snapshot means a fresh target.

const SourceRef = z.string().min(1).max(200);
const Balance = z.number().int().min(-MAX_AMOUNT).max(MAX_AMOUNT);

export const OpeningSnapshot = z.strictObject({
  import_id: z.string().regex(/^[a-z0-9][a-z0-9_.:-]{2,63}$/),
  currency_id: z.string().min(1),
  source: z.string().min(1).max(64),
  cutoff: z.iso.datetime({ offset: true }),
  // The raw source snapshot this file was prepared from: its fingerprint and what it contained (all accounts).
  source_snapshot: z.strictObject({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    accounts: z.number().int().min(0),
    total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  // Where the decisions come from (selection manifest fingerprint, policy): bound to the file by its sha256.
  provenance: z
    .strictObject({
      manifest_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      manifest_generated_at: z.iso.datetime({ offset: true }),
      policy: z.string().min(1).max(1000),
    })
    .optional(),
  rows: z.array(
    z.strictObject({
      // A real Twitch user id: no « 0 », no leading zero.
      twitch_user_id: z.string().regex(/^[1-9]\d{0,31}$/),
      login: z.string().regex(/^[a-z0-9_]{1,25}$/),
      display_name: z.string().min(1).max(64).optional(),
      // Exact integer, the sum of its sources; a negative (debt) is accepted by the schema and blocked by the plan.
      balance: Balance,
      // Every source account (StreamElements username at the cutoff…) whose balance goes to this Twitch ID.
      sources: z
        .array(z.strictObject({ source_ref: SourceRef, balance: Balance }))
        .min(1),
    }),
  ),
  // Source accounts deliberately NOT imported (selection policy): kept out of the Wallet, recorded for the balance.
  excluded: z.array(
    z.strictObject({
      source_ref: SourceRef,
      balance: Balance,
      reason: z.string().min(1).max(200),
    }),
  ),
});
export type OpeningSnapshot = z.infer<typeof OpeningSnapshot>;

export class OpeningImportError extends Error {
  constructor(readonly blocking: string[]) {
    super(`opening import refused: ${blocking.join('; ')}`);
  }
}

/** Parses the snapshot file and fingerprints it (the fingerprint is what « the same import » means). */
export function readOpeningSnapshot(text: string) {
  return {
    snapshot: OpeningSnapshot.parse(JSON.parse(text)),
    sha256: createHash('sha256').update(text).digest('hex'),
  };
}

const openingKey = (s: OpeningSnapshot, id: string) =>
  `opening:${s.import_id}:${id}`;
const reference = (r: OpeningSnapshot['rows'][number]) =>
  r.sources.map((x) => x.source_ref).join(' + ');
const sum = (l: { balance: number }[]) => l.reduce((a, r) => a + r.balance, 0);

export interface OpeningPlan {
  status: 'ready' | 'already_applied' | 'blocked';
  blocking: string[];
  accounts: number;
  credited: number;
  zeros: number;
  total: number;
  max: number;
  sourceAccounts: number;
  excludedAccounts: number;
  excludedTotal: number;
}

/** The file on its own: every source account once, rows = their sources, imported + excluded = source snapshot. */
function checkSnapshot(s: OpeningSnapshot): string[] {
  const blocking: string[] = [];
  const ids = new Set<string>();
  const refs = new Set<string>();
  const ref = (r: string) => {
    if (refs.has(r)) blocking.push(`compte source en double : ${r}`);
    refs.add(r);
  };
  for (const r of s.rows) {
    if (ids.has(r.twitch_user_id))
      blocking.push(`twitch_user_id en double : ${r.twitch_user_id}`);
    ids.add(r.twitch_user_id);
    if (r.balance < 0)
      blocking.push(`solde négatif (dette) : ${r.twitch_user_id} ${r.balance}`);
    for (const x of r.sources) {
      ref(x.source_ref);
      if (x.balance < 0)
        blocking.push(`solde source négatif : ${x.source_ref} ${x.balance}`);
    }
    if (sum(r.sources) !== r.balance)
      blocking.push(
        `solde ≠ somme de ses comptes sources : ${r.twitch_user_id} ${r.balance} ≠ ${sum(r.sources)}`,
      );
  }
  for (const x of s.excluded) {
    ref(x.source_ref);
    if (x.balance < 0)
      blocking.push(`solde exclu négatif : ${x.source_ref} ${x.balance}`);
  }
  const sources = s.rows.flatMap((r) => r.sources).length + s.excluded.length;
  const total = sum(s.rows) + sum(s.excluded);
  if (!Number.isSafeInteger(total)) blocking.push('total hors entier exact');
  if (sources !== s.source_snapshot.accounts)
    blocking.push(
      `comptes sources ${sources} ≠ snapshot source ${s.source_snapshot.accounts}`,
    );
  if (total !== s.source_snapshot.total)
    blocking.push(
      `total importé + exclu ${total} ≠ snapshot source ${s.source_snapshot.total}`,
    );
  return blocking;
}

/** Read-only. Everything that would make the import wrong is listed; nothing is written. */
export async function planOpeningImport(
  q: Queryable,
  s: OpeningSnapshot,
  sha256: string,
): Promise<OpeningPlan> {
  const blocking = checkSnapshot(s);
  const positive = s.rows.filter((r) => r.balance > 0);
  const plan = {
    accounts: s.rows.length,
    credited: positive.length,
    zeros: s.rows.filter((r) => r.balance === 0).length,
    total: sum(positive),
    max: Math.max(0, ...s.rows.map((r) => r.balance)),
    sourceAccounts: s.source_snapshot.accounts,
    excludedAccounts: s.excluded.length,
    excludedTotal: sum(s.excluded),
  };

  const currency = await findCurrency(q, s.currency_id);
  if (!currency || currency.id !== s.currency_id || !currency.active)
    blocking.push(`monnaie absente ou inactive : ${s.currency_id}`);

  const prior = (
    await q.query<{ id: string; snapshot_sha256: string }>(
      'select id, snapshot_sha256 from wallet_imports where currency_id = $1',
      [s.currency_id],
    )
  )[0];
  if (prior) {
    if (prior.id === s.import_id && prior.snapshot_sha256 === sha256)
      return { status: 'already_applied', blocking: [], ...plan };
    blocking.push(
      `un import d'ouverture existe déjà pour ${s.currency_id} (${prior.id})`,
    );
  }

  // Early, unlocked view of the targets (the decisive check is repeated under lock by applyOpeningImport).
  const busy = await q.query<{ twitch_user_id: string }>(
    `select twitch_user_id from wallets where currency_id = $1 and twitch_user_id = any($2::text[]) and balance <> 0
     union select twitch_user_id from wallet_transactions where currency_id = $1 and twitch_user_id = any($2::text[])
     order by 1`,
    [s.currency_id, s.rows.map((r) => r.twitch_user_id)],
  );
  for (const b of busy)
    blocking.push(`portefeuille déjà mouvementé : ${b.twitch_user_id}`);

  return {
    status: blocking.length ? 'blocked' : 'ready',
    blocking,
    ...plan,
  };
}

/**
 * One transaction: the import record, the target wallets locked and checked pristine, one opening_balance per
 * positive row, every source account recorded, then the full verification — still before commit. Refused or
 * failed → nothing written. The same file again after a commit (or an uncertain one) → « already_applied ».
 */
export async function applyOpeningImport(
  db: Db,
  s: OpeningSnapshot,
  sha256: string,
): Promise<OpeningPlan> {
  const wallet = new WalletService(db);
  return db.tx(async (q) => {
    const plan = await planOpeningImport(q, s, sha256);
    if (plan.status === 'already_applied') return plan;
    if (plan.status === 'blocked') throw new OpeningImportError(plan.blocking);
    // Claims the currency first: a concurrent import of the same currency waits here, then fails on the unique key.
    await q
      .query(
        `insert into wallet_imports (id, currency_id, source, cutoff, snapshot_sha256, accounts, total,
           source_sha256, source_accounts, source_total, excluded_accounts, excluded_total)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          s.import_id,
          s.currency_id,
          s.source,
          s.cutoff,
          sha256,
          plan.accounts,
          plan.total,
          s.source_snapshot.sha256,
          s.source_snapshot.accounts,
          s.source_snapshot.total,
          plan.excludedAccounts,
          plan.excludedTotal,
        ],
      )
      .catch((e: { code?: string }) => {
        if (e.code === '23505')
          throw new OpeningImportError([
            `un autre import de ${s.currency_id} vient d'être appliqué en parallèle`,
          ]);
        throw e;
      });
    const viewer = (r: OpeningSnapshot['rows'][number]) => ({
      twitchUserId: r.twitch_user_id,
      login: r.login,
      displayName: r.display_name ?? r.login,
    });
    // Decisive check: under the wallet locks, nothing may have moved since the plan.
    const moved = await wallet.lockPristineIn(
      q,
      s.rows.map(viewer),
      s.currency_id,
    );
    if (moved.length)
      throw new OpeningImportError(
        moved.map(
          (m) =>
            `portefeuille déjà mouvementé : ${m.twitchUserId} (solde ${m.balance}, ${m.ledgerRows} ligne(s))`,
        ),
      );
    for (const r of [...s.rows].sort((a, b) =>
      a.twitch_user_id.localeCompare(b.twitch_user_id),
    )) {
      for (const x of r.sources)
        await q.query(
          `insert into wallet_import_sources (import_id, source_ref, twitch_user_id, balance, status)
           values ($1, $2, $3, $4, 'imported')`,
          [s.import_id, x.source_ref, r.twitch_user_id, x.balance],
        );
      if (r.balance === 0) continue;
      const res = await wallet.creditIn(q, {
        key: openingKey(s, r.twitch_user_id),
        viewer: viewer(r),
        amount: r.balance,
        kind: 'opening_balance',
        source: s.source,
        reference: reference(r),
        reason: `${s.import_id} (cutoff ${s.cutoff})`,
        currencyId: s.currency_id,
      });
      if (res.status !== 'applied' || res.replayed)
        throw new OpeningImportError([
          `${r.twitch_user_id} : ${res.replayed ? 'replayed' : res.rejection}`,
        ]);
    }
    for (const x of s.excluded)
      await q.query(
        `insert into wallet_import_sources (import_id, source_ref, balance, status, reason)
         values ($1, $2, $3, 'excluded', $4)`,
        [s.import_id, x.source_ref, x.balance, x.reason],
      );
    // Acceptance before commit: a failed check rolls everything back.
    const v = await verifyOpeningImport(q, s, sha256);
    if (!v.ok)
      throw new OpeningImportError([
        `contrôle avant validation en échec : ${JSON.stringify(v.problems)}`,
      ]);
    return { ...plan, status: 'ready' };
  });
}

export interface OpeningVerification {
  ok: boolean;
  /** Registry, source traceability or ledger metadata that does not match this exact file. */
  problems: string[];
  /** Snapshot row whose opening in the ledger differs (missing, other amount). */
  mismatches: { twitch_user_id: string; expected: number; actual: number }[];
  /** Opening rows in the ledger for this currency that the snapshot does not contain. */
  unexpected: { twitch_user_id: string; amount: number }[];
  /** Wallets whose balance is not the sum of their ledger rows. */
  drift: { twitch_user_id: string; balance: number; ledger: number }[];
  expectedTotal: number;
  openingTotal: number;
  excludedTotal: number;
  sourceTotal: number;
}

/**
 * Read-only, valid at any time after the import (balances move afterwards, their opening does not): the registry
 * holds THIS file (id, fingerprint, source, cutoff, totals), every source account is recorded once as imported to its
 * Twitch ID or excluded, every snapshot row has exactly its opening with its references, no other opening exists,
 * every wallet of the currency equals its ledger.
 */
export async function verifyOpeningImport(
  q: Queryable,
  s: OpeningSnapshot,
  sha256: string,
): Promise<OpeningVerification> {
  const problems: string[] = [];
  const reg = (
    await q.query<{
      id: string;
      source: string;
      cutoff: Date | string;
      snapshot_sha256: string;
      accounts: number;
      total: number;
      source_sha256: string | null;
      source_accounts: number | null;
      source_total: number | null;
      excluded_accounts: number | null;
      excluded_total: number | null;
    }>('select * from wallet_imports where currency_id = $1', [s.currency_id])
  )[0];
  const positive = s.rows.filter((r) => r.balance > 0);
  if (!reg) problems.push(`aucun import enregistré pour ${s.currency_id}`);
  else {
    const want: Record<string, unknown> = {
      id: s.import_id,
      source: s.source,
      cutoff: new Date(s.cutoff).toISOString(),
      snapshot_sha256: sha256,
      accounts: s.rows.length,
      total: sum(positive),
      source_sha256: s.source_snapshot.sha256,
      source_accounts: s.source_snapshot.accounts,
      source_total: s.source_snapshot.total,
      excluded_accounts: s.excluded.length,
      excluded_total: sum(s.excluded),
    };
    const got: Record<string, unknown> = {
      ...reg,
      cutoff: new Date(reg.cutoff).toISOString(),
    };
    for (const [k, v] of Object.entries(want))
      if ((typeof v === 'number' ? Number(got[k]) : got[k]) !== v)
        problems.push(`registre ${k} : ${String(got[k])} ≠ ${String(v)}`);
  }

  // Source traceability: exactly the file's accounts, each once, with its fate.
  const recorded = new Map(
    (
      await q.query<{
        source_ref: string;
        twitch_user_id: string | null;
        balance: number;
        status: string;
      }>(
        'select source_ref, twitch_user_id, balance, status from wallet_import_sources where import_id = $1',
        [s.import_id],
      )
    ).map((r) => [r.source_ref, r]),
  );
  const expectedSources = [
    ...s.rows.flatMap((r) =>
      r.sources.map((x) => ({
        ref: x.source_ref,
        id: r.twitch_user_id as string | null,
        balance: x.balance,
        status: 'imported',
      })),
    ),
    ...s.excluded.map((x) => ({
      ref: x.source_ref,
      id: null as string | null,
      balance: x.balance,
      status: 'excluded',
    })),
  ];
  for (const e of expectedSources) {
    const r = recorded.get(e.ref);
    if (!r) problems.push(`compte source non enregistré : ${e.ref}`);
    else if (
      r.status !== e.status ||
      r.twitch_user_id !== e.id ||
      Number(r.balance) !== e.balance
    )
      problems.push(`compte source différent : ${e.ref}`);
  }
  if (recorded.size !== expectedSources.length)
    problems.push(
      `comptes sources enregistrés ${recorded.size} ≠ ${expectedSources.length}`,
    );

  const openingRows = await q.query<{
    twitch_user_id: string;
    amount: number;
    source: string;
    reference: string | null;
    reason: string | null;
  }>(
    `select twitch_user_id, amount, source, reference, reason from wallet_transactions
     where currency_id = $1 and kind = 'opening_balance'`,
    [s.currency_id],
  );
  const openings = new Map<string, number>();
  for (const o of openingRows)
    openings.set(
      o.twitch_user_id,
      (openings.get(o.twitch_user_id) ?? 0) + Number(o.amount),
    );
  const expected = new Map(s.rows.map((r) => [r.twitch_user_id, r]));
  for (const o of openingRows) {
    const r = expected.get(o.twitch_user_id);
    if (
      r &&
      (o.source !== s.source ||
        o.reference !== reference(r) ||
        o.reason !== `${s.import_id} (cutoff ${s.cutoff})`)
    )
      problems.push(`ligne d'ouverture différente : ${o.twitch_user_id}`);
  }
  const mismatches = [...expected.values()]
    .map((r) => ({
      twitch_user_id: r.twitch_user_id,
      expected: r.balance,
      actual: openings.get(r.twitch_user_id) ?? 0,
    }))
    .filter((m) => m.expected !== m.actual);
  const unexpected = [...openings]
    .filter(([id]) => !expected.has(id))
    .map(([id, amount]) => ({ twitch_user_id: id, amount }));
  const drift = (
    await q.query<{ twitch_user_id: string; balance: number; ledger: number }>(
      `select w.twitch_user_id, w.balance, coalesce(sum(t.amount), 0)::bigint as ledger
       from wallets w left join wallet_transactions t using (twitch_user_id, currency_id)
       where w.currency_id = $1 group by w.twitch_user_id, w.balance
       having w.balance <> coalesce(sum(t.amount), 0)`,
      [s.currency_id],
    )
  ).map((d) => ({
    ...d,
    balance: Number(d.balance),
    ledger: Number(d.ledger),
  }));
  const expectedTotal = s.rows.reduce((a, r) => a + Math.max(0, r.balance), 0);
  const openingTotal = [...openings.values()].reduce((a, n) => a + n, 0);
  const excludedTotal = sum(s.excluded);
  const sourceTotal = expectedTotal + excludedTotal;
  if (sourceTotal !== s.source_snapshot.total)
    problems.push(
      `ouvertures + exclus ${sourceTotal} ≠ snapshot source ${s.source_snapshot.total}`,
    );
  return {
    ok:
      !problems.length &&
      !mismatches.length &&
      !unexpected.length &&
      !drift.length &&
      expectedTotal === openingTotal,
    problems,
    mismatches,
    unexpected,
    drift,
    expectedTotal,
    openingTotal,
    excludedTotal,
    sourceTotal,
  };
}
