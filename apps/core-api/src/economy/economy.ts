import type { WalletOperationResult } from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';
import {
  debit as labDebit,
  LabWalletError,
  lockWallet,
  refundDebit as labRefundDebit,
  type LabModule,
  type WalletCurrency,
} from '../lab-moderation/store.js';
import {
  creditCurrency,
  currency as labCurrency,
} from '../raffle-lab/currencies.js';
import type { WalletService } from '../wallet/wallet-service.js';

// ASTRA-P1-001 (lot 1): the economic side of an interaction admission, as ONE contract usable inside
// the admission's own transaction — so the debit and the admission commit or roll back together
// (never a spend committed on its own next to the admission). Two implementations:
// - `labEconomy`: the Lab test wallet (lab_wallets / lab_wallet_ledger), fictitious, the default of
//   every module — the Lab behaves exactly as before;
// - `coreWalletEconomy(wallet)`: the canonical Core Wallet (Jetons = currency `main`), used by no
//   runtime yet (cutover decision), proven by tests.
// A refusal always throws (LabWalletError): the caller's transaction then keeps nothing.
//
// Module movements (economy unification, 16/10/2026): the games and rewards decided by Core (Jeu des
// mots, Roulette / Slot, Duel, Tombola winnings) go through the same port, still inside the caller's
// transaction: `hold` (lock in a stable order, read balances and cap), `move` (one signed change and its
// ledger row) and `transfer` (viewer → viewer, sum zero). Lab only for now: the canonical adapter refuses
// them explicitly until P1-001 lot 2 wires them (never a silent success).

export interface EconomyDebit {
  channelId: string;
  viewer: { id: string; display_name: string };
  currency: WalletCurrency;
  amount: number;
  module: LabModule;
  interactionId: string;
}

/** A balance change decided by a module (game result, reward), recorded with its ledger row. */
export interface EconomyMovement {
  channelId: string;
  viewerId: string;
  /** A registered currency (`tokens`, or the currency of a Tombola round). */
  currency: string;
  /** Signed: a credit when positive, a debit when negative (never below 0). */
  amount: number;
  kind: 'word_game' | 'mini_game' | 'raffle_win';
  /** Ledger reason: the module's idempotency key (unique per kind where the module requires it). */
  key?: string | null;
  moduleId?: string | null;
  raffleId?: string | null;
}

/** Locked wallets: their balances in the currency, and its balance cap. */
export interface EconomyHold {
  balances: Map<string, number>;
  maxBalance: number;
}

export interface EconomyPort {
  /** Inside the admission transaction. Throws when refused (nothing of the admission is kept). */
  debit(q: Queryable, now: Date, d: EconomyDebit): Promise<void>;
  /**
   * Locks the viewers' wallets in a stable order (by Twitch ID: crossed operations never wait on each
   * other) and reads their balances and the currency cap, inside the caller's transaction.
   */
  hold(
    q: Queryable,
    now: Date,
    channelId: string,
    viewerIds: string[],
    currency: string,
  ): Promise<EconomyHold>;
  /**
   * One balance change and its ledger row, inside the caller's transaction. Refused before writing
   * anything: CurrencyCreditError for a credit (cap, unavailable currency), LabWalletError for a debit
   * below 0.
   */
  move(
    q: Queryable,
    now: Date,
    m: EconomyMovement,
  ): Promise<{ balanceAfter: number; ledgerId: number }>;
  /**
   * Viewer → viewer in the caller's transaction: both wallets locked in a stable order, the sender
   * debited and the receiver credited (two ledger rows, `keys.from` / `keys.to`), sum zero. Throws
   * (nothing kept by the caller) when the sender cannot pay or the receiver would exceed the cap.
   */
  transfer(
    q: Queryable,
    now: Date,
    t: {
      channelId: string;
      from: string;
      to: string;
      currency: string;
      amount: number;
      kind: EconomyMovement['kind'];
      keys: { from: string; to: string };
    },
  ): Promise<void>;
  /**
   * Gives back exactly what was debited for this interaction, at most once, inside the caller's
   * transaction. Nothing debited → nothing given back (amount 0). Throws when it cannot be applied.
   */
  refund(
    q: Queryable,
    now: Date,
    interactionId: string,
    actor: string,
    reason: string,
  ): Promise<{ amount: number; currency: WalletCurrency | null }>;
}

/** The Lab wallet column of a registered currency (the wallet the module movements need today). */
async function labColumn(q: Queryable, currencyId: string) {
  const c = await labCurrency(q, currencyId);
  if (!c?.wallet_column)
    throw new LabWalletError('economy_unavailable', {
      reason: 'currency_not_supported',
      currency: currencyId,
    });
  return { ...c, wallet_column: c.wallet_column };
}

async function labHold(
  q: Queryable,
  now: Date,
  channelId: string,
  viewerIds: string[],
  currencyId: string,
): Promise<EconomyHold> {
  const c = await labColumn(q, currencyId);
  const balances = new Map<string, number>();
  for (const id of [...new Set(viewerIds)].sort())
    balances.set(
      id,
      (await lockWallet(q, channelId, id, now))[c.wallet_column],
    );
  return { balances, maxBalance: c.max_balance };
}

async function labMove(q: Queryable, now: Date, m: EconomyMovement) {
  let balanceAfter: number;
  if (m.amount > 0)
    // Locks the wallet, checks the currency and its cap before writing (CurrencyCreditError).
    balanceAfter = await creditCurrency(q, now, {
      channelId: m.channelId,
      viewerId: m.viewerId,
      currencyId: m.currency,
      amount: m.amount,
    });
  else {
    const c = await labColumn(q, m.currency);
    const before = (await lockWallet(q, m.channelId, m.viewerId, now))[
      c.wallet_column
    ];
    if (before + m.amount < 0)
      throw new LabWalletError(
        c.wallet_column === 'tokens'
          ? 'insufficient_tokens'
          : 'insufficient_credits',
        { balance: before, needed: -m.amount },
      );
    balanceAfter = before + m.amount;
    await q.query(
      `update lab_wallets set ${c.wallet_column} = $3, updated_at = $4 where channel_id = $1 and viewer_id = $2`,
      [m.channelId, m.viewerId, balanceAfter, now],
    );
  }
  const ledgerId = Number(
    (
      await q.query<{ id: number }>(
        `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, module_id, interaction_id, actor, reason, created_at, raffle_id)
         values ($1, $2, $3, $4, $5, $6, null, 'system', $7, $8, $9) returning id`,
        [
          m.channelId,
          m.viewerId,
          m.kind,
          m.currency,
          m.amount,
          m.moduleId ?? null,
          m.key ?? null,
          now,
          m.raffleId ?? null,
        ],
      )
    )[0]!.id,
  );
  return { balanceAfter, ledgerId };
}

export const labEconomy: EconomyPort = {
  debit: (q, now, d) =>
    labDebit(q, now, {
      channelId: d.channelId,
      viewerId: d.viewer.id,
      currency: d.currency,
      amount: d.amount,
      module: d.module,
      interactionId: d.interactionId,
    }),
  refund: labRefundDebit,
  hold: labHold,
  move: labMove,
  async transfer(q, now, t) {
    // Both locked first, in the stable order; the debit refuses an empty sender, the credit a full receiver.
    await labHold(q, now, t.channelId, [t.from, t.to], t.currency);
    await labMove(q, now, {
      channelId: t.channelId,
      viewerId: t.from,
      currency: t.currency,
      amount: -t.amount,
      kind: t.kind,
      key: t.keys.from,
    });
    await labMove(q, now, {
      channelId: t.channelId,
      viewerId: t.to,
      currency: t.currency,
      amount: t.amount,
      kind: t.kind,
      key: t.keys.to,
    });
  },
};

/** Module movements are not wired to the canonical Wallet yet (P1-001 lot 2): explicit refusal. */
const notWired = (): never => {
  throw new LabWalletError('economy_unavailable', {
    reason: 'canonical_not_wired',
  });
};

const debitKey = (interactionId: string) =>
  `interaction:${interactionId}:debit`;

export function coreWalletEconomy(wallet: WalletService): EconomyPort {
  return {
    hold: async () => notWired(),
    move: async () => notWired(),
    transfer: async () => notWired(),
    async debit(q, _now, d) {
      // Jetons only: the model of TTS / Soundboard credits is a pending product decision (D2).
      if (d.currency !== 'tokens')
        throw new LabWalletError('economy_unavailable', {
          reason: 'currency_not_supported',
          currency: d.currency,
        });
      const r = await wallet.spendIn(q, {
        key: debitKey(d.interactionId),
        viewer: {
          twitchUserId: d.viewer.id,
          // Placeholder for a viewer the Wallet has never seen (never overwrites a known login).
          login: d.viewer.display_name.toLowerCase(),
          displayName: d.viewer.display_name,
        },
        amount: d.amount,
        source: d.module,
        reference: d.interactionId,
      });
      // Every non-applied outcome aborts the admission (an admitted interaction is always paid).
      if (r.status !== 'applied' || r.replayed)
        throw new LabWalletError(
          r.rejection === 'insufficient_funds' || r.rejection === 'in_debt'
            ? 'insufficient_tokens'
            : 'economy_unavailable',
          {
            reason: r.replayed ? 'replayed' : r.rejection,
            balance: r.balances[0]?.balance ?? null,
            needed: d.amount,
          },
        );
    },

    async refund(q, _now, interactionId, actor, reason) {
      const spent = (
        await q.query<{ result: WalletOperationResult }>(
          `select result from wallet_operations where idempotency_key = $1 and status = 'applied'`,
          [debitKey(interactionId)],
        )
      )[0]?.result;
      const leg = spent?.amounts[0];
      if (!spent || !leg) return { amount: 0, currency: null };
      const r = await wallet.creditIn(q, {
        key: `interaction:${interactionId}:refund`,
        viewer: {
          twitchUserId: leg.twitchUserId,
          login: leg.twitchUserId,
          displayName: leg.twitchUserId,
        },
        amount: -leg.amount,
        kind: 'refund',
        source: 'interaction_refund',
        reference: interactionId,
        reason: `${reason} (${actor})`,
        currencyId: spent.currencyId,
      });
      // A refund that cannot be applied rolls back the decision that asked for it (never « refunded »
      // without the money).
      if (r.status !== 'applied')
        throw new LabWalletError('economy_unavailable', {
          reason: r.rejection,
        });
      return { amount: r.replayed ? 0 : -leg.amount, currency: 'tokens' };
    },
  };
}

/**
 * Automatic refunds (expired before being claimed, failed before being shown): an economic refusal
 * (e.g. an inactive currency of the canonical Wallet) never blocks the queue of the channel. Undone
 * alone (savepoint): the item keeps refund_status 'none' — refundable later by moderation — and
 * the rest of the transaction goes on. Any other error still aborts it. The Lab wallet never refuses.
 */
export async function deferrableRefund(
  q: Queryable,
  refund: () => Promise<unknown>,
): Promise<void> {
  await q.query('savepoint economy_refund');
  try {
    await refund();
    await q.query('release savepoint economy_refund');
  } catch (error) {
    await q.query('rollback to savepoint economy_refund');
    if (!(error instanceof LabWalletError)) throw error;
  }
}
