import { createHash } from 'node:crypto';
import type {
  AdminOp,
  Currency,
  Viewer,
  WalletOperationResult,
  WalletRejection,
  WalletTransactionKind,
} from '@raptoru/schemas';
import type { Db, Queryable } from '../db/db.js';
import { findCurrency } from './currencies.js';

// The single economic source of truth. Every balance change is an operation (idempotency key)
// made of immutable ledger rows, applied atomically with only the wallets involved locked:
// independent viewers are processed in parallel, and a wallet is never read-modify-written
// without its row lock. This service never produces chat output: callers decide the feedback.

export class WalletInputError extends Error {}
/** Same idempotency key reused with a different request. */
export class WalletIdempotencyError extends Error {}

export const MAX_AMOUNT = 1_000_000_000_000;

interface Leg {
  twitchUserId: string;
  amount: number;
  kind: WalletTransactionKind;
}

type Plan = { legs: Leg[] } | { rejection: WalletRejection };

interface Meta {
  source: string;
  reference?: string | null;
  actor?: string | null;
  reason?: string | null;
}

interface PlanContext {
  currency: Currency;
  balances: Map<string, number>;
}

export interface WalletView {
  twitchUserId: string;
  currency: Currency;
  balance: number;
  inDebt: boolean;
  /** Rank by balance among positive wallets of this currency; null when the balance is <= 0. */
  position: number | null;
  stats: {
    earned: number;
    spent: number;
    receivedFromTransfers: number;
    sentInTransfers: number;
    adminAdjustments: number;
    penalties: number;
    refunds: number;
    openingBalance: number;
  };
}

function positiveAmount(amount: number): number {
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
    throw new WalletInputError('amount must be an integer between 1 and 1e12');
  }
  return amount;
}

function requestHash(kind: string, payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([kind, payload]))
    .digest('hex');
}

export async function ensureViewers(
  q: Queryable,
  viewers: Viewer[],
): Promise<void> {
  const unique = [
    ...new Map(viewers.map((v) => [v.twitchUserId, v])).values(),
  ].sort((a, b) => a.twitchUserId.localeCompare(b.twitchUserId));
  for (const v of unique) {
    await q.query(
      `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $3)
       on conflict (twitch_user_id) do update set login = excluded.login,
         display_name = excluded.display_name, updated_at = now()
       where viewers.login is distinct from excluded.login or viewers.display_name is distinct from excluded.display_name`,
      [v.twitchUserId, v.login, v.displayName],
    );
  }
}

export interface CreditInput {
  key: string;
  viewer: Viewer;
  amount: number;
  kind?: 'reward' | 'refund' | 'opening_balance';
  source: string;
  reference?: string;
  reason?: string;
  currencyId?: string;
}

export interface SpendInput {
  key: string;
  viewer: Viewer;
  amount: number;
  source: string;
  reference?: string;
  currencyId?: string;
}

/**
 * Inside a caller's transaction (no identity source there): the viewer row is created if missing,
 * never rewritten — a real login / display name is kept, a placeholder is replaced by the next
 * ensureViewers.
 */
async function ensureViewerRows(q: Queryable, viewers: Viewer[]) {
  for (const v of [
    ...new Map(viewers.map((x) => [x.twitchUserId, x])).values(),
  ].sort((a, b) => a.twitchUserId.localeCompare(b.twitchUserId)))
    await q.query(
      `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $3)
       on conflict (twitch_user_id) do nothing`,
      [v.twitchUserId, v.login, v.displayName],
    );
}

export class WalletService {
  constructor(private readonly db: Db) {}

  // --- writes -----------------------------------------------------------------------------------

  /** Gains and compensations. Never refused for a negative balance: debt shrinks naturally. */
  async credit(input: CreditInput): Promise<WalletOperationResult> {
    return this.creditWith(null, input);
  }

  /**
   * The same credit inside the caller's transaction (ASTRA-P1-001: an interaction refund commits or
   * rolls back with the state change that decided it). Opens no transaction of its own.
   */
  async creditIn(
    q: Queryable,
    input: CreditInput,
  ): Promise<WalletOperationResult> {
    return this.creditWith(q, input);
  }

  private async creditWith(
    q: Queryable | null,
    input: CreditInput,
  ): Promise<WalletOperationResult> {
    const amount = positiveAmount(input.amount);
    const kind = input.kind ?? 'reward';
    return this.run(
      q,
      input.key,
      `credit:${kind}`,
      {
        v: input.viewer.twitchUserId,
        amount,
        c: input.currencyId ?? null,
        s: input.source,
        r: input.reference ?? null,
      },
      input.currencyId,
      [input.viewer],
      {
        source: input.source,
        reference: input.reference,
        reason: input.reason,
      },
      () => ({
        legs: [{ twitchUserId: input.viewer.twitchUserId, amount, kind }],
      }),
    );
  }

  /** Purchases: never below 0, refused while in debt. */
  async spend(input: SpendInput): Promise<WalletOperationResult> {
    return this.spendWith(null, input);
  }

  /**
   * The same purchase inside the caller's transaction (ASTRA-P1-001: admission + debit atomic — never
   * a spend committed on its own next to the admission). Opens no transaction; a refusal comes back
   * as status `rejected` and the caller must abort its transaction (nothing of it is then kept).
   */
  async spendIn(
    q: Queryable,
    input: SpendInput,
  ): Promise<WalletOperationResult> {
    return this.spendWith(q, input);
  }

  private async spendWith(
    q: Queryable | null,
    input: SpendInput,
  ): Promise<WalletOperationResult> {
    const amount = positiveAmount(input.amount);
    const id = input.viewer.twitchUserId;
    return this.run(
      q,
      input.key,
      'spend',
      {
        v: id,
        amount,
        c: input.currencyId ?? null,
        s: input.source,
        r: input.reference ?? null,
      },
      input.currencyId,
      [input.viewer],
      { source: input.source, reference: input.reference },
      ({ balances }) => {
        const balance = balances.get(id)!;
        if (balance < 0) return { rejection: 'in_debt' };
        if (balance < amount) return { rejection: 'insufficient_funds' };
        return { legs: [{ twitchUserId: id, amount: -amount, kind: 'spend' }] };
      },
    );
  }

  /** Explicit malus/debt: may go below 0 when the currency allows it. */
  async penalty(input: {
    key: string;
    viewer: Viewer;
    amount: number;
    source: string;
    reason: string;
    actor?: string;
    reference?: string;
    currencyId?: string;
  }): Promise<WalletOperationResult> {
    const amount = positiveAmount(input.amount);
    const id = input.viewer.twitchUserId;
    return this.execute(
      input.key,
      'penalty',
      {
        v: id,
        amount,
        c: input.currencyId ?? null,
        s: input.source,
        r: input.reference ?? null,
      },
      input.currencyId,
      [input.viewer],
      {
        source: input.source,
        reference: input.reference,
        reason: input.reason,
        actor: input.actor,
      },
      ({ currency, balances }) => {
        if (!currency.allowNegativeAdmin && balances.get(id)! - amount < 0)
          return { rejection: 'negative_not_allowed' };
        return {
          legs: [{ twitchUserId: id, amount: -amount, kind: 'penalty' }],
        };
      },
    );
  }

  /** Viewer → viewer, atomic, never below 0, no tax, no daily cap. Emits nothing public. */
  async transfer(input: {
    key: string;
    from: Viewer;
    to: Viewer;
    amount: number;
    source: string;
    currencyId?: string;
  }): Promise<WalletOperationResult> {
    const amount = positiveAmount(input.amount);
    const from = input.from.twitchUserId;
    const to = input.to.twitchUserId;
    return this.execute(
      input.key,
      'transfer',
      { from, to, amount, c: input.currencyId ?? null },
      input.currencyId,
      [input.from, input.to],
      { source: input.source, reference: `transfer:${from}->${to}` },
      ({ currency, balances }) => {
        if (from === to) return { rejection: 'self_transfer' };
        if (!currency.transferable)
          return { rejection: 'currency_not_transferable' };
        const balance = balances.get(from)!;
        if (balance < 0) return { rejection: 'in_debt' };
        if (balance < amount) return { rejection: 'insufficient_funds' };
        return {
          legs: [
            { twitchUserId: from, amount: -amount, kind: 'transfer_out' },
            { twitchUserId: to, amount, kind: 'transfer_in' },
          ],
        };
      },
    );
  }

  /**
   * Owner/Supermod corrections. `set` never overwrites: it writes the difference as an
   * adjustment. Removal/set below 0 only when the currency allows administrative debt.
   */
  async adminAdjust(input: {
    key: string;
    actor: string;
    target: Viewer;
    op: AdminOp;
    amount: number;
    reason?: string;
    currencyId?: string;
  }): Promise<WalletOperationResult> {
    const id = input.target.twitchUserId;
    if (input.op !== 'set') positiveAmount(input.amount);
    else if (
      !Number.isInteger(input.amount) ||
      Math.abs(input.amount) > MAX_AMOUNT
    ) {
      throw new WalletInputError('target balance must be an integer');
    }
    return this.execute(
      input.key,
      `admin:${input.op}`,
      { v: id, amount: input.amount, c: input.currencyId ?? null },
      input.currencyId,
      [input.target],
      { source: 'admin', actor: input.actor, reason: input.reason },
      ({ currency, balances }) => {
        const balance = balances.get(id)!;
        const delta =
          input.op === 'add'
            ? input.amount
            : input.op === 'remove'
              ? -input.amount
              : input.amount - balance;
        if (delta === 0) return { rejection: 'no_change' };
        if (balance + delta < 0 && delta < 0 && !currency.allowNegativeAdmin)
          return { rejection: 'negative_not_allowed' };
        const kind =
          input.op === 'add'
            ? 'admin_add'
            : input.op === 'remove'
              ? 'admin_remove'
              : 'admin_set_adjustment';
        return { legs: [{ twitchUserId: id, amount: delta, kind }] };
      },
    );
  }

  /** In the caller's transaction (`q`) or in a transaction of its own (`null`). */
  private async run(
    q: Queryable | null,
    key: string,
    opKind: string,
    payload: unknown,
    currencyId: string | undefined,
    participants: Viewer[],
    meta: Meta,
    plan: (ctx: PlanContext) => Plan,
  ): Promise<WalletOperationResult> {
    if (!q)
      return this.execute(
        key,
        opKind,
        payload,
        currencyId,
        participants,
        meta,
        plan,
      );
    // Inside a caller's transaction: viewer rows only created, never rewritten (no identity here).
    await ensureViewerRows(q, participants);
    return this.apply(
      q,
      key,
      opKind,
      payload,
      currencyId,
      participants,
      meta,
      plan,
    );
  }

  private async execute(
    key: string,
    opKind: string,
    payload: unknown,
    currencyId: string | undefined,
    participants: Viewer[],
    meta: Meta,
    plan: (ctx: PlanContext) => Plan,
  ): Promise<WalletOperationResult> {
    if (!key || key.length > 200)
      throw new WalletInputError('idempotency key required');
    // Viewer identity rows first, outside the money transaction (idempotent, short).
    await ensureViewers(this.db, participants);
    return this.db.tx((q) =>
      this.apply(q, key, opKind, payload, currencyId, participants, meta, plan),
    );
  }

  /** One operation inside the given transaction (idempotency claim, locks, plan, ledger). */
  private async apply(
    q: Queryable,
    key: string,
    opKind: string,
    payload: unknown,
    currencyId: string | undefined,
    participants: Viewer[],
    meta: Meta,
    plan: (ctx: PlanContext) => Plan,
  ): Promise<WalletOperationResult> {
    if (!key || key.length > 200)
      throw new WalletInputError('idempotency key required');
    const hash = requestHash(opKind, payload);
    {
      // 1. Claim the idempotency key. A concurrent duplicate waits here until the first commits.
      const claimed = await q.query<{ id: number }>(
        `insert into wallet_operations (idempotency_key, kind, request_hash, status) values ($1, $2, $3, 'pending')
         on conflict (idempotency_key) do nothing returning id`,
        [key, opKind, hash],
      );
      if (!claimed[0]) {
        const prior = (
          await q.query<{
            request_hash: string;
            result: WalletOperationResult;
          }>(
            'select request_hash, result from wallet_operations where idempotency_key = $1',
            [key],
          )
        )[0]!;
        if (prior.request_hash !== hash) {
          throw new WalletIdempotencyError(
            'idempotency key already used for a different request',
          );
        }
        return { ...prior.result, replayed: true };
      }
      const operationId = claimed[0].id;

      const finish = async (result: WalletOperationResult) => {
        await q.query(
          'update wallet_operations set status = $2, result = $3 where id = $1',
          [operationId, result.status, JSON.stringify(result)],
        );
        return result;
      };
      const reject = (
        rejection: WalletRejection,
        currency: string,
        balances: Map<string, number>,
      ) =>
        finish({
          operationId,
          status: 'rejected',
          rejection,
          replayed: false,
          currencyId: currency,
          balances: [...balances].map(([twitchUserId, balance]) => ({
            twitchUserId,
            balance,
          })),
          amounts: [],
        });

      // 2. Currency.
      const currency = await findCurrency(q, currencyId);
      if (!currency)
        return reject('currency_not_found', currencyId ?? '', new Map());
      if (!currency.active)
        return reject('currency_inactive', currency.id, new Map());

      // 3. Lock only the wallets involved, in a stable order (no deadlock between crossed transfers).
      const ids = [...new Set(participants.map((p) => p.twitchUserId))].sort();
      for (const id of ids) {
        await q.query(
          'insert into wallets (twitch_user_id, currency_id) values ($1, $2) on conflict do nothing',
          [id, currency.id],
        );
      }
      const rows = await q.query<{ twitch_user_id: string; balance: number }>(
        `select twitch_user_id, balance from wallets where currency_id = $1 and twitch_user_id = any($2::text[])
         order by twitch_user_id for update`,
        [currency.id, ids],
      );
      const balances = new Map(
        rows.map((r) => [r.twitch_user_id, Number(r.balance)]),
      );

      // 4. Business rules on the locked balances.
      const decision = plan({ currency, balances });
      if ('rejection' in decision)
        return reject(decision.rejection, currency.id, balances);

      // 5. Apply: balance update and ledger row together.
      for (const leg of [...decision.legs].sort((a, b) =>
        a.twitchUserId.localeCompare(b.twitchUserId),
      )) {
        const after = Number(
          (
            await q.query<{ balance: number }>(
              `update wallets set balance = balance + $3, updated_at = now()
               where twitch_user_id = $1 and currency_id = $2 returning balance`,
              [leg.twitchUserId, currency.id, leg.amount],
            )
          )[0]!.balance,
        );
        balances.set(leg.twitchUserId, after);
        await q.query(
          `insert into wallet_transactions (operation_id, twitch_user_id, currency_id, amount, kind, source,
             reference, actor, reason, balance_after)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            operationId,
            leg.twitchUserId,
            currency.id,
            leg.amount,
            leg.kind,
            meta.source,
            meta.reference ?? null,
            meta.actor ?? null,
            meta.reason ?? null,
            after,
          ],
        );
      }
      return finish({
        operationId,
        status: 'applied',
        rejection: null,
        replayed: false,
        currencyId: currency.id,
        balances: [...balances].map(([twitchUserId, balance]) => ({
          twitchUserId,
          balance,
        })),
        amounts: decision.legs.map((l) => ({
          twitchUserId: l.twitchUserId,
          amount: l.amount,
          kind: l.kind,
        })),
      });
    }
  }

  // --- reads ------------------------------------------------------------------------------------

  /** Read-only. An unknown wallet reads as 0. */
  async getWallet(
    twitchUserId: string,
    currencyId?: string,
  ): Promise<WalletView | null> {
    const currency = await findCurrency(this.db, currencyId);
    if (!currency) return null;
    const balance = Number(
      (
        await this.db.query<{ balance: number }>(
          'select balance from wallets where twitch_user_id = $1 and currency_id = $2',
          [twitchUserId, currency.id],
        )
      )[0]?.balance ?? 0,
    );
    const sums = new Map(
      (
        await this.db.query<{ kind: WalletTransactionKind; total: number }>(
          `select kind, sum(amount)::bigint as total from wallet_transactions
           where twitch_user_id = $1 and currency_id = $2 group by kind`,
          [twitchUserId, currency.id],
        )
      ).map((r) => [r.kind, Number(r.total)]),
    );
    const sum = (kind: WalletTransactionKind) => sums.get(kind) ?? 0;
    return {
      twitchUserId,
      currency,
      balance,
      inDebt: balance < 0,
      position: balance > 0 ? await this.position(currency.id, balance) : null,
      stats: {
        // Transfers are never counted as earnings: a round trip between viewers creates nothing.
        earned: sum('reward'),
        spent: -sum('spend'),
        receivedFromTransfers: sum('transfer_in'),
        sentInTransfers: -sum('transfer_out'),
        adminAdjustments:
          sum('admin_add') + sum('admin_remove') + sum('admin_set_adjustment'),
        penalties: -sum('penalty'),
        refunds: sum('refund'),
        openingBalance: sum('opening_balance'),
      },
    };
  }

  private async position(currencyId: string, balance: number): Promise<number> {
    const row = (
      await this.db.query<{ n: number }>(
        'select count(*)::int as n from wallets where currency_id = $1 and balance > $2',
        [currencyId, balance],
      )
    )[0]!;
    return row.n + 1;
  }

  async history(
    twitchUserId: string,
    opts: { currencyId?: string; limit?: number; beforeId?: number } = {},
  ) {
    const currency = await findCurrency(this.db, opts.currencyId);
    if (!currency) return [];
    const rows = await this.db.query<{
      id: number;
      amount: number;
      kind: WalletTransactionKind;
      source: string;
      reference: string | null;
      actor: string | null;
      reason: string | null;
      balance_after: number;
      created_at: Date;
    }>(
      `select id, amount, kind, source, reference, actor, reason, balance_after, created_at from wallet_transactions
       where twitch_user_id = $1 and currency_id = $2 and ($3::bigint is null or id < $3)
       order by id desc limit $4`,
      [
        twitchUserId,
        currency.id,
        opts.beforeId ?? null,
        Math.min(opts.limit ?? 50, 500),
      ],
    );
    return rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      kind: r.kind,
      source: r.source,
      reference: r.reference,
      actor: r.actor,
      reason: r.reason,
      balanceAfter: Number(r.balance_after),
      createdAt: r.created_at.toISOString(),
    }));
  }

  /** Top N by balance (positive balances only). Balances are public. */
  async leaderboard(opts: { currencyId?: string; limit?: number } = {}) {
    const currency = await findCurrency(this.db, opts.currencyId);
    if (!currency) return null;
    const rows = await this.db.query<{
      twitch_user_id: string;
      login: string;
      display_name: string;
      balance: number;
    }>(
      `select w.twitch_user_id, v.login, v.display_name, w.balance from wallets w join viewers v using (twitch_user_id)
       where w.currency_id = $1 and w.balance > 0 order by w.balance desc, w.twitch_user_id limit $2`,
      [currency.id, Math.min(opts.limit ?? 100, 500)],
    );
    let rank = 0;
    let previous: number | null = null;
    return {
      currency,
      entries: rows.map((r, i) => {
        const balance = Number(r.balance);
        if (balance !== previous) rank = i + 1; // ties share a rank
        previous = balance;
        return {
          rank,
          twitchUserId: r.twitch_user_id,
          login: r.login,
          displayName: r.display_name,
          balance,
        };
      }),
    };
  }
}
