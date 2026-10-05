import type { WalletOperationResult } from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';
import {
  debit as labDebit,
  LabWalletError,
  refundDebit as labRefundDebit,
  type LabModule,
  type WalletCurrency,
} from '../lab-moderation/store.js';
import type { WalletService } from '../wallet/wallet-service.js';

// ASTRA-P1-001 (lot 1): the economic side of an interaction admission, as ONE contract usable inside
// the admission's own transaction — so the debit and the admission commit or roll back together
// (never a spend committed on its own next to the admission). Two implementations:
// - `labEconomy`: the Lab test wallet (lab_wallets / lab_wallet_ledger), fictitious, the default of
//   every module — the Lab behaves exactly as before;
// - `coreWalletEconomy(wallet)`: the canonical Core Wallet (Jetons = currency `main`), used by no
//   runtime yet (cutover decision), proven by tests.
// A refusal always throws (LabWalletError): the caller's transaction then keeps nothing.

export interface EconomyDebit {
  channelId: string;
  viewer: { id: string; display_name: string };
  currency: WalletCurrency;
  amount: number;
  module: LabModule;
  interactionId: string;
}

export interface EconomyPort {
  /** Inside the admission transaction. Throws when refused (nothing of the admission is kept). */
  debit(q: Queryable, now: Date, d: EconomyDebit): Promise<void>;
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
};

const debitKey = (interactionId: string) =>
  `interaction:${interactionId}:debit`;

export function coreWalletEconomy(wallet: WalletService): EconomyPort {
  return {
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
