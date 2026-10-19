import type { WalletOperationResult } from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';
import {
  debit as labDebit,
  LabWalletError,
  lockWallet,
  readWallet,
  refundDebit as labRefundDebit,
  type LabModule,
  type WalletCurrency,
} from '../lab-moderation/store.js';
import {
  creditCurrency,
  CurrencyCreditError,
  currency as labCurrency,
} from '../raffle-lab/currencies.js';
import { findCurrency } from '../wallet/currencies.js';
import { MAX_AMOUNT, type WalletService } from '../wallet/wallet-service.js';

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
// ledger row) and `transfer` (viewer → viewer, sum zero). Canonical adapter (Phase 2 lot 1, 19/10/2026): the same
// three on the Core Wallet, Jetons only, every movement keyed (a replay never pays twice). Which adapter a
// runtime uses is decided in one place (economy/activation.ts): the Lab wallet everywhere until the cutover.

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

/** One row of the economy's ledger, in the shape of D4 « Activité Jetons » (whatever the source). */
export interface EconomyLedgerRow {
  id: number;
  viewer_id: string;
  kind: string;
  currency: string;
  amount: number;
  module_id: string | null;
  interaction_id: string | null;
  raffle_id: string | null;
  actor: string;
  reason: string | null;
  created_at: Date;
  refunded_by: number | null;
  refund_of: number | null;
}

/** Balances shown to the viewer and to moderation. A currency the economy does not hold is null (never 0). */
export interface EconomyBalances {
  tokens: number;
  credits_tts: number | null;
  credits_soundboard: number | null;
}

export interface EconomyPort {
  /** Which ledger this is: tools that only exist on one side check it. */
  readonly mode: 'lab' | 'canonical';
  balances(
    q: Queryable,
    channelId: string,
    viewerId: string,
  ): Promise<EconomyBalances>;
  /** The debit and refund of one interaction, in order. */
  interactionMovements(
    q: Queryable,
    interactionId: string,
  ): Promise<
    {
      id: number;
      kind: string;
      currency: string;
      amount: number;
      created_at: Date;
    }[]
  >;
  /** Interactions of a module actually debited in the last days (moderation « payée »). */
  debitedInteractions(
    q: Queryable,
    channelId: string,
    module: LabModule,
    withinDays: number,
  ): Promise<Set<string>>;
  /**
   * Whether this economy can pay a module result in the currency (Tombola rounds): the Lab wallet takes every
   * registered currency; the Core Wallet only the Jetons (credits and other Lab currencies are never converted).
   */
  acceptsCurrency(q: Queryable, currency: string): Promise<boolean>;
  /** The Tombola winnings of a round already in the ledger (one per winner at most). */
  raffleWins(
    q: Queryable,
    raffleId: string,
  ): Promise<
    {
      id: number;
      viewer_id: string;
      amount: number;
      currency: string;
      created_at: Date;
    }[]
  >;
  /** Ledger page, newest first (`before` = id cursor), at most `limit` rows. */
  ledger(
    q: Queryable,
    channelId: string,
    f: { viewer: string | null; before: number | null; limit: number },
  ): Promise<EconomyLedgerRow[]>;
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
  mode: 'lab',
  // The Lab keeps its own rules (registered and available, checked by the module): nothing more here.
  acceptsCurrency: async () => true,
  async raffleWins(q, raffleId) {
    return (
      await q.query<{
        id: string;
        viewer_id: string;
        amount: string;
        currency: string;
        created_at: Date;
      }>(
        `select id, viewer_id, amount, currency, created_at from lab_wallet_ledger where raffle_id = $1 and kind = 'raffle_win'`,
        [raffleId],
      )
    ).map((r) => ({ ...r, id: Number(r.id), amount: Number(r.amount) }));
  },
  balances: (q, channelId, viewerId) => readWallet(q, channelId, viewerId),
  async interactionMovements(q, interactionId) {
    return (
      await q.query<{
        id: string;
        kind: string;
        currency: string;
        amount: string;
        created_at: Date;
      }>(
        'select id, kind, currency, amount, created_at from lab_wallet_ledger where interaction_id = $1 order by id',
        [interactionId],
      )
    ).map((m) => ({ ...m, id: Number(m.id), amount: Number(m.amount) }));
  },
  async debitedInteractions(q, channelId, module, withinDays) {
    return new Set(
      (
        await q.query<{ interaction_id: string }>(
          `select interaction_id from lab_wallet_ledger where channel_id = $1 and kind = 'debit' and module_id = $2
           and created_at > now() - make_interval(days => $3)`,
          [channelId, module, withinDays],
        )
      ).map((d) => d.interaction_id),
    );
  },
  async ledger(q, channelId, f) {
    return (
      await q.query<{
        id: string;
        viewer_id: string;
        kind: string;
        currency: string;
        amount: string;
        module_id: string | null;
        interaction_id: string | null;
        raffle_id: string | null;
        actor: string;
        reason: string | null;
        created_at: Date;
        refunded_by: string | null;
        refund_of: string | null;
      }>(
        `select l.id, l.viewer_id, l.kind, l.currency, l.amount, l.module_id, l.interaction_id, l.raffle_id, l.actor,
           l.reason, l.created_at,
           case when l.kind = 'debit' then (select r.id from lab_wallet_ledger r where r.kind = 'refund' and r.interaction_id = l.interaction_id) end as refunded_by,
           case when l.kind = 'refund' then (select d.id from lab_wallet_ledger d where d.kind = 'debit' and d.interaction_id = l.interaction_id) end as refund_of
         from lab_wallet_ledger l
         where l.channel_id = $1 and ($2::text is null or l.viewer_id = $2) and ($3::bigint is null or l.id < $3)
         order by l.id desc limit $4`,
        [channelId, f.viewer, f.before, f.limit],
      )
    ).map((r) => ({
      ...r,
      id: Number(r.id),
      amount: Number(r.amount),
      refunded_by: r.refunded_by === null ? null : Number(r.refunded_by),
      refund_of: r.refund_of === null ? null : Number(r.refund_of),
    }));
  },
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

const debitKey = (interactionId: string) =>
  `interaction:${interactionId}:debit`;

/**
 * The canonical currency behind a module currency. Only the Jetons (`tokens` → the primary currency) exist in the
 * Core Wallet; Lab credits (TTS / Soundboard) and other Tombola currencies are refused, never converted (D2).
 */
async function canonicalCurrency(q: Queryable, currency: string) {
  if (currency !== 'tokens')
    throw new LabWalletError('economy_unavailable', {
      reason: 'currency_not_supported',
      currency,
    });
  const c = await findCurrency(q);
  if (!c?.active)
    throw new LabWalletError('economy_unavailable', {
      reason: 'currency_inactive',
      currency,
    });
  return c.id;
}
/** A viewer the Wallet may not know yet: the Twitch ID is the key, a placeholder never overwrites a real login. */
const byId = (id: string) => ({ twitchUserId: id, login: id, displayName: id });
/** The idempotency key of a module movement: its own key, or (Tombola win) its round and winner. */
function movementKey(m: EconomyMovement) {
  const k = m.key ?? (m.raffleId ? `${m.raffleId}:${m.viewerId}` : null);
  if (!k)
    throw new LabWalletError('economy_unavailable', {
      reason: 'idempotency_key_required',
    });
  return `move:${m.kind}:${k}`;
}
async function ledgerRow(q: Queryable, operationId: number, viewerId: string) {
  return Number(
    (
      await q.query<{ id: number }>(
        'select id from wallet_transactions where operation_id = $1 and twitch_user_id = $2 order by id limit 1',
        [operationId, viewerId],
      )
    )[0]!.id,
  );
}

/** Canonical ledger rows (primary currency) with the idempotency key of their operation. */
async function canonicalRows(
  q: Queryable,
  where: string,
  params: unknown[],
  tail = 'order by t.id',
) {
  return q.query<{
    id: number;
    twitch_user_id: string;
    amount: number;
    kind: string;
    source: string;
    reference: string | null;
    actor: string | null;
    reason: string | null;
    created_at: Date;
    key: string;
  }>(
    `select t.id, t.twitch_user_id, t.amount, t.kind, t.source, t.reference, t.actor, t.reason, t.created_at,
       o.idempotency_key as key
     from wallet_transactions t join wallet_operations o on o.id = t.operation_id
     join currencies c on c.id = t.currency_id and c.is_primary
     where ${where} ${tail}`,
    params,
  );
}
const INTERACTION_KEY = /^interaction:(.+):(debit|refund)$/;
const interactionKeys = (id: string) => [
  debitKey(id),
  `interaction:${id}:refund`,
];

export function coreWalletEconomy(wallet: WalletService): EconomyPort {
  return {
    mode: 'canonical',
    async acceptsCurrency(q, currency) {
      if (currency !== 'tokens') return false;
      return (await findCurrency(q))?.active === true;
    },

    async raffleWins(q, raffleId) {
      // The key of a Tombola win: move:raffle_win:<round>:<winner> (movementKey).
      return (
        await canonicalRows(q, 'o.idempotency_key like $1', [
          `move:raffle_win:${raffleId.replace(/[\\%_]/g, '\\$&')}:%`,
        ])
      ).map((r) => ({
        id: Number(r.id),
        viewer_id: r.twitch_user_id,
        amount: Number(r.amount),
        currency: 'tokens',
        created_at: r.created_at,
      }));
    },
    async balances(q, _channelId, viewerId) {
      const w = (
        await q.query<{ balance: number }>(
          'select w.balance from wallets w join currencies c on c.id = w.currency_id and c.is_primary where w.twitch_user_id = $1',
          [viewerId],
        )
      )[0];
      // Credits are not held by the Core Wallet (D2: secondary currencies, not migrated yet): null, never 0.
      return {
        tokens: Number(w?.balance ?? 0),
        credits_tts: null,
        credits_soundboard: null,
      };
    },

    async interactionMovements(q, interactionId) {
      return (
        await canonicalRows(q, 'o.idempotency_key = any($1::text[])', [
          interactionKeys(interactionId),
        ])
      ).map((r) => ({
        id: Number(r.id),
        kind: INTERACTION_KEY.exec(r.key)![2]!,
        currency: 'tokens',
        amount: Number(r.amount),
        created_at: r.created_at,
      }));
    },

    async debitedInteractions(q, _channelId, module, withinDays) {
      return new Set(
        (
          await canonicalRows(
            q,
            `o.idempotency_key like 'interaction:%:debit' and t.source = $1
             and t.created_at > now() - make_interval(days => $2)`,
            [module, withinDays],
          )
        ).map((r) => r.reference!),
      );
    },

    async ledger(q, _channelId, f) {
      const rows = await canonicalRows(
        q,
        '($1::text is null or t.twitch_user_id = $1) and ($2::bigint is null or t.id < $2)',
        [f.viewer, f.before],
        `order by t.id desc limit ${Math.max(1, Math.trunc(f.limit))}`,
      );
      // Interaction debit ↔ refund links, and the module of a refund (its debit's).
      const ids = [
        ...new Set(rows.flatMap((r) => INTERACTION_KEY.exec(r.key)?.[1] ?? [])),
      ];
      const links = ids.length
        ? await canonicalRows(q, 'o.idempotency_key = any($1::text[])', [
            ids.flatMap(interactionKeys),
          ])
        : [];
      const leg = (id: string, k: string) =>
        links.find((l) => l.key === `interaction:${id}:${k}`);
      return rows.map((r) => {
        const m = INTERACTION_KEY.exec(r.key);
        const interaction = m?.[1] ?? null;
        const debitRow = interaction ? leg(interaction, 'debit') : undefined;
        const refundRow = interaction ? leg(interaction, 'refund') : undefined;
        const kind = m
          ? m[2]!
          : r.kind.startsWith('admin_')
            ? 'admin'
            : r.key.startsWith('move:')
              ? r.source === 'raffle'
                ? 'raffle_win'
                : r.source
              : r.kind;
        return {
          id: Number(r.id),
          viewer_id: r.twitch_user_id,
          kind,
          currency: 'tokens',
          amount: Number(r.amount),
          module_id: m
            ? (debitRow?.source ?? null)
            : r.source === 'raffle'
              ? 'raffle'
              : null,
          interaction_id: interaction,
          raffle_id: r.key.startsWith('move:raffle_win:')
            ? r.key.slice('move:raffle_win:'.length, r.key.lastIndexOf(':'))
            : null,
          actor: r.actor ?? 'system',
          reason: r.reason,
          created_at: r.created_at,
          refunded_by:
            m?.[2] === 'debit' && refundRow ? Number(refundRow.id) : null,
          refund_of:
            m?.[2] === 'refund' && debitRow ? Number(debitRow.id) : null,
        };
      });
    },

    async hold(q, _now, _channelId, viewerIds, currency) {
      const id = await canonicalCurrency(q, currency);
      const balances = await wallet.lockIn(q, viewerIds.map(byId), id);
      // No balance cap in the Core Wallet: only the per-operation bound.
      return { balances, maxBalance: MAX_AMOUNT };
    },

    async move(q, _now, m) {
      // A gain in an unavailable currency is the modules' CurrencyCreditError, as with the Lab wallet.
      const currencyId = await canonicalCurrency(q, m.currency).catch((e) => {
        if (m.amount > 0 && e instanceof LabWalletError)
          throw new CurrencyCreditError(
            'currency_unavailable',
            String(e.details?.reason),
          );
        throw e;
      });
      if (!Number.isSafeInteger(m.amount) || m.amount === 0)
        throw new LabWalletError('economy_unavailable', {
          reason: 'invalid_amount',
        });
      const common = {
        key: movementKey(m),
        viewer: byId(m.viewerId),
        amount: Math.abs(m.amount),
        source: m.moduleId ?? m.kind,
        reference: m.key ?? m.raffleId ?? undefined,
        currencyId,
      };
      const r =
        m.amount > 0
          ? await wallet.creditIn(q, {
              ...common,
              kind: 'reward',
              reason: m.kind,
            })
          : await wallet.spendIn(q, common);
      // A replayed key is the movement already applied: its result again, never a second payment.
      if (r.status !== 'applied') {
        if (m.amount > 0)
          throw new CurrencyCreditError(
            'currency_unavailable',
            String(r.rejection),
          );
        throw new LabWalletError(
          r.rejection === 'insufficient_funds' || r.rejection === 'in_debt'
            ? 'insufficient_tokens'
            : 'economy_unavailable',
          {
            reason: r.rejection,
            balance: r.balances[0]?.balance ?? null,
            needed: -m.amount,
          },
        );
      }
      return {
        balanceAfter:
          r.balances.find((b) => b.twitchUserId === m.viewerId)?.balance ?? 0,
        ledgerId: await ledgerRow(q, r.operationId, m.viewerId),
      };
    },

    async transfer(q, _now, t) {
      const currencyId = await canonicalCurrency(q, t.currency);
      const r = await wallet.transferIn(q, {
        key: `move:${t.kind}:${t.keys.from}`,
        from: byId(t.from),
        to: byId(t.to),
        amount: t.amount,
        source: t.kind,
        currencyId,
      });
      if (r.status !== 'applied')
        throw new LabWalletError(
          r.rejection === 'insufficient_funds' || r.rejection === 'in_debt'
            ? 'insufficient_tokens'
            : 'economy_unavailable',
          {
            reason: r.rejection,
            balance:
              r.balances.find((b) => b.twitchUserId === t.from)?.balance ??
              null,
            needed: t.amount,
          },
        );
    },

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
