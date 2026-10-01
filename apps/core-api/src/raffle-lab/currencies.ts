import type { Queryable } from '../db/db.js';
import { lockWallet, type WalletCurrency } from '../lab-moderation/store.js';

// Registry of the Lab currencies (lab_currencies): a module chooses a registered currency, Core credits
// the matching balance. Jetons / Crédits TTS / Crédits Soundboard keep their lab_wallets column; a
// currency registered later is stored in lab_wallet_balances.

export interface LabCurrency {
  currency_id: string;
  label: string;
  short_label: string;
  icon: string;
  available: boolean;
  wallet_column: WalletCurrency | null;
  max_balance: number;
}

export async function listCurrencies(q: Queryable): Promise<LabCurrency[]> {
  return (
    await q.query<LabCurrency & { max_balance: string | number }>(
      'select currency_id, label, short_label, icon, available, wallet_column, max_balance from lab_currencies order by sort, currency_id',
    )
  ).map((c) => ({ ...c, max_balance: Number(c.max_balance) }));
}

export async function currency(
  q: Queryable,
  id: string,
): Promise<LabCurrency | null> {
  return (await listCurrencies(q)).find((c) => c.currency_id === id) ?? null;
}

export class CurrencyCreditError extends Error {
  constructor(
    readonly code: 'unknown_currency' | 'currency_unavailable' | 'balance_cap',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Credits `amount` of a registered currency to a viewer (inside the caller's transaction). Never
 * clipped: a credit that would exceed the balance cap is refused (the caller records the failure).
 * Returns the balance after the credit.
 */
export async function creditCurrency(
  q: Queryable,
  now: Date,
  p: {
    channelId: string;
    viewerId: string;
    currencyId: string;
    amount: number;
  },
): Promise<number> {
  const c = await currency(q, p.currencyId);
  if (!c)
    throw new CurrencyCreditError(
      'unknown_currency',
      `unknown currency ${p.currencyId}`,
    );
  if (!c.available)
    throw new CurrencyCreditError(
      'currency_unavailable',
      `${c.label} is not available`,
    );
  if (c.wallet_column) {
    const w = await lockWallet(q, p.channelId, p.viewerId, now);
    const next = w[c.wallet_column] + p.amount;
    if (next > c.max_balance)
      throw new CurrencyCreditError(
        'balance_cap',
        `${c.label}: balance cap ${c.max_balance} reached`,
      );
    await q.query(
      `update lab_wallets set ${c.wallet_column} = $3, updated_at = $4 where channel_id = $1 and viewer_id = $2`,
      [p.channelId, p.viewerId, next, now],
    );
    return next;
  }
  await q.query(
    `insert into lab_wallet_balances (channel_id, viewer_id, currency_id, balance, updated_at) values ($1, $2, $3, 0, $4)
     on conflict do nothing`,
    [p.channelId, p.viewerId, c.currency_id, now],
  );
  const cur = Number(
    (
      await q.query<{ balance: string | number }>(
        'select balance from lab_wallet_balances where channel_id = $1 and viewer_id = $2 and currency_id = $3 for update',
        [p.channelId, p.viewerId, c.currency_id],
      )
    )[0]!.balance,
  );
  if (cur + p.amount > c.max_balance)
    throw new CurrencyCreditError(
      'balance_cap',
      `${c.label}: balance cap ${c.max_balance} reached`,
    );
  await q.query(
    'update lab_wallet_balances set balance = $4, updated_at = $5 where channel_id = $1 and viewer_id = $2 and currency_id = $3',
    [p.channelId, p.viewerId, c.currency_id, cur + p.amount, now],
  );
  return cur + p.amount;
}
