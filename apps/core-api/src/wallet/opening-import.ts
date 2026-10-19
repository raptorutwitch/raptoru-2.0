import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Db, Queryable } from '../db/db.js';
import { findCurrency } from './currencies.js';
import { MAX_AMOUNT, WalletService } from './wallet-service.js';

// Opening balances (economic cutover, docs/ECONOMY_MIGRATION.md). An APPROVED snapshot — one row per Twitch ID, the
// exact historical balance at the cutoff (StreamElements Jetons), identities already reconciled — enters the Wallet
// once, in one transaction: all of it or nothing. Plan (dry run) → apply → verify. The database refuses a second
// import for the currency and a second opening per wallet (migration 20261028130000); the target wallets must be
// empty. Never a delta, never an addition on top of live balances: a newer snapshot means a fresh target.

export const OpeningSnapshot = z.strictObject({
  import_id: z.string().regex(/^[a-z0-9][a-z0-9_.:-]{2,63}$/),
  currency_id: z.string().min(1),
  source: z.string().min(1).max(64),
  cutoff: z.iso.datetime({ offset: true }),
  rows: z.array(
    z.strictObject({
      twitch_user_id: z.string().regex(/^\d{1,32}$/),
      login: z.string().min(1).max(64),
      display_name: z.string().min(1).max(64).optional(),
      // Exact integer; a negative (debt) is accepted by the schema and blocked by the plan (decision needed).
      balance: z.number().int().min(-MAX_AMOUNT).max(MAX_AMOUNT),
      // The source record (StreamElements username at the cutoff…): kept on the ledger row as its reference.
      source_ref: z.string().min(1).max(200),
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

export interface OpeningPlan {
  status: 'ready' | 'already_applied' | 'blocked';
  blocking: string[];
  accounts: number;
  credited: number;
  zeros: number;
  total: number;
  max: number;
}

/** Read-only. Everything that would make the import wrong is listed; nothing is written. */
export async function planOpeningImport(
  q: Queryable,
  s: OpeningSnapshot,
  sha256: string,
): Promise<OpeningPlan> {
  const blocking: string[] = [];
  const seen = new Set<string>();
  for (const r of s.rows) {
    if (seen.has(r.twitch_user_id))
      blocking.push(`twitch_user_id en double : ${r.twitch_user_id}`);
    seen.add(r.twitch_user_id);
    if (r.balance < 0)
      blocking.push(`solde négatif (dette) : ${r.twitch_user_id} ${r.balance}`);
  }
  const positive = s.rows.filter((r) => r.balance > 0);
  const total = positive.reduce((a, r) => a + r.balance, 0);
  if (!Number.isSafeInteger(total)) blocking.push('total hors entier exact');
  const plan = {
    accounts: s.rows.length,
    credited: positive.length,
    zeros: s.rows.filter((r) => r.balance === 0).length,
    total,
    max: Math.max(0, ...s.rows.map((r) => r.balance)),
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

  // The target wallets must be empty: an opening is never added on top of a balance that already moved.
  const busy = await q.query<{ twitch_user_id: string }>(
    `select distinct twitch_user_id from wallet_transactions
     where currency_id = $1 and twitch_user_id = any($2::text[]) order by twitch_user_id`,
    [s.currency_id, [...seen]],
  );
  for (const b of busy)
    blocking.push(`portefeuille déjà mouvementé : ${b.twitch_user_id}`);

  return {
    status: blocking.length ? 'blocked' : 'ready',
    blocking,
    ...plan,
  };
}

/** One transaction: the import record, then one opening_balance per positive row. Refused → nothing written. */
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
        `insert into wallet_imports (id, currency_id, source, cutoff, snapshot_sha256, accounts, total)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          s.import_id,
          s.currency_id,
          s.source,
          s.cutoff,
          sha256,
          plan.accounts,
          plan.total,
        ],
      )
      .catch((e: { code?: string }) => {
        if (e.code === '23505')
          throw new OpeningImportError([
            `un autre import de ${s.currency_id} vient d'être appliqué en parallèle`,
          ]);
        throw e;
      });
    for (const r of [...s.rows].sort((a, b) =>
      a.twitch_user_id.localeCompare(b.twitch_user_id),
    )) {
      if (r.balance === 0) continue;
      const res = await wallet.creditIn(q, {
        key: openingKey(s, r.twitch_user_id),
        viewer: {
          twitchUserId: r.twitch_user_id,
          login: r.login,
          displayName: r.display_name ?? r.login,
        },
        amount: r.balance,
        kind: 'opening_balance',
        source: s.source,
        reference: r.source_ref,
        reason: `${s.import_id} (cutoff ${s.cutoff})`,
        currencyId: s.currency_id,
      });
      if (res.status !== 'applied' || res.replayed)
        throw new OpeningImportError([
          `${r.twitch_user_id} : ${res.replayed ? 'replayed' : res.rejection}`,
        ]);
    }
    return { ...plan, status: 'ready' };
  });
}

export interface OpeningVerification {
  ok: boolean;
  /** Snapshot row whose opening in the ledger differs (missing, other amount). */
  mismatches: { twitch_user_id: string; expected: number; actual: number }[];
  /** Opening rows in the ledger for this currency that the snapshot does not contain. */
  unexpected: { twitch_user_id: string; amount: number }[];
  /** Wallets whose balance is not the sum of their ledger rows. */
  drift: { twitch_user_id: string; balance: number; ledger: number }[];
  expectedTotal: number;
  openingTotal: number;
}

/**
 * Read-only, valid at any time after the import (balances move afterwards, their opening does not): every snapshot
 * row has exactly its opening, no other opening exists, every wallet of the currency equals its ledger.
 */
export async function verifyOpeningImport(
  q: Queryable,
  s: OpeningSnapshot,
): Promise<OpeningVerification> {
  const openings = new Map(
    (
      await q.query<{ twitch_user_id: string; amount: number }>(
        `select twitch_user_id, sum(amount)::bigint as amount from wallet_transactions
         where currency_id = $1 and kind = 'opening_balance' group by twitch_user_id`,
        [s.currency_id],
      )
    ).map((r) => [r.twitch_user_id, Number(r.amount)]),
  );
  const expected = new Map(s.rows.map((r) => [r.twitch_user_id, r.balance]));
  const mismatches = [...expected]
    .map(([id, want]) => ({
      twitch_user_id: id,
      expected: want,
      actual: openings.get(id) ?? 0,
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
  return {
    ok:
      !mismatches.length &&
      !unexpected.length &&
      !drift.length &&
      expectedTotal === openingTotal,
    mismatches,
    unexpected,
    drift,
    expectedTotal,
    openingTotal,
  };
}
