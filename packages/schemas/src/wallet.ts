import { z } from 'zod';
import { Viewer } from './daily.js';

// Wallet / Loyalty contracts. Amounts are positive integers; the operation decides the sign.

export const CurrencyId = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
export const WalletAmount = z.number().int().min(1).max(1_000_000_000_000);

export const Currency = z.object({
  id: CurrencyId,
  singular: z.string().min(1).max(40),
  plural: z.string().min(1).max(40),
  icon: z.string().max(16).nullable(),
  active: z.boolean(),
  isPrimary: z.boolean(),
  transferable: z.boolean(),
  allowNegativeAdmin: z.boolean(),
});
export type Currency = z.infer<typeof Currency>;

export const CurrencyCreate = Currency.extend({
  icon: z.string().max(16).nullable().default(null),
  active: z.boolean().default(true),
  isPrimary: z.boolean().default(false),
  transferable: z.boolean().default(true),
  allowNegativeAdmin: z.boolean().default(true),
});
export const CurrencyUpdate = Currency.omit({ id: true }).partial();

export const WalletRejection = z.enum([
  'insufficient_funds',
  'in_debt',
  'self_transfer',
  'currency_inactive',
  'currency_not_transferable',
  'currency_not_found',
  'negative_not_allowed',
  'no_change',
  'not_authorized',
]);
export type WalletRejection = z.infer<typeof WalletRejection>;

export const WalletTransactionKind = z.enum([
  'reward',
  'spend',
  'transfer_out',
  'transfer_in',
  'admin_add',
  'admin_remove',
  'admin_set_adjustment',
  'penalty',
  'refund',
  'opening_balance',
]);
export type WalletTransactionKind = z.infer<typeof WalletTransactionKind>;

export const WalletOperationResult = z.object({
  operationId: z.number().int(),
  status: z.enum(['applied', 'rejected']),
  rejection: WalletRejection.nullable(),
  replayed: z.boolean(),
  currencyId: z.string(),
  /** Balance after the operation for every wallet involved (before it, when rejected). */
  balances: z.array(
    z.object({ twitchUserId: z.string(), balance: z.number().int() }),
  ),
  amounts: z.array(
    z.object({
      twitchUserId: z.string(),
      amount: z.number().int(),
      kind: WalletTransactionKind,
    }),
  ),
});
export type WalletOperationResult = z.infer<typeof WalletOperationResult>;

export const AdminOp = z.enum(['add', 'remove', 'set']);
export type AdminOp = z.infer<typeof AdminOp>;

// --- bot (chat transport) ------------------------------------------------------------------------

export const WalletBalanceRequest = z.object({
  /** Whose wallet is read. */
  viewer: Viewer,
  /** Who typed the command, when it is someone else's wallet (`!solde @Pseudo`): the reply is addressed to them. */
  requester: Viewer.optional(),
  currencyId: CurrencyId.optional(),
});
export type WalletBalanceRequest = z.infer<typeof WalletBalanceRequest>;

export const WalletTransferRequest = z.object({
  /** Twitch message id (or any stable id of the triggering action): retries replay the outcome. */
  requestId: z.string().min(1).max(128),
  from: Viewer,
  to: Viewer,
  amount: WalletAmount,
  currencyId: CurrencyId.optional(),
});
export type WalletTransferRequest = z.infer<typeof WalletTransferRequest>;

export const WalletChatAdminRequest = z.object({
  requestId: z.string().min(1).max(128),
  actor: Viewer,
  target: Viewer,
  op: AdminOp,
  /** For add/remove: > 0. For set: the target balance (may be 0 or negative). */
  amount: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
  reason: z.string().max(200).optional(),
  currencyId: CurrencyId.optional(),
});
export type WalletChatAdminRequest = z.infer<typeof WalletChatAdminRequest>;

export const WalletChatResponse = z.object({
  message: z.string(),
  result: WalletOperationResult.nullable(),
});
export type WalletChatResponse = z.infer<typeof WalletChatResponse>;

// --- admin (Studio) ------------------------------------------------------------------------------

export const WalletAdminAdjustRequest = z.object({
  requestId: z.string().min(1).max(128),
  actor: z.string().min(1).max(64),
  target: Viewer,
  op: AdminOp,
  amount: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
  reason: z.string().max(200).optional(),
  currencyId: CurrencyId.optional(),
});
export type WalletAdminAdjustRequest = z.infer<typeof WalletAdminAdjustRequest>;

export const LoyaltyRateRequest = z.object({
  viewer: Viewer,
  multiplier: z.number().positive().max(100),
  actor: z.string().min(1).max(64),
  reason: z.string().max(200).optional(),
});

export const LoyaltyBoostRequest = z.object({
  multiplier: z.number().positive().max(100),
  label: z.string().min(1).max(80),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }),
  actor: z.string().min(1).max(64),
});

export const StaffRoleRequest = z.object({
  viewer: Viewer,
  role: z.enum(['owner', 'supermod']),
  actor: z.string().min(1).max(64),
});
