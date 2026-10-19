import type { Queryable } from '../db/db.js';
import type { WalletService } from '../wallet/wallet-service.js';
import { coreWalletEconomy, labEconomy, type EconomyPort } from './economy.js';

// The ONE place where a Core runtime chooses its economy (Phase 2, docs/ECONOMY_MIGRATION.md § 12). Every runtime uses
// the Lab test wallet today; StreamElements stays the only real economy of the stream. The canonical Wallet is chosen
// only explicitly, at the cutover, and refused while it would run next to another economy: no opening import yet
// (the real balances are still elsewhere), or a module of the runtime not proven on the canonical Wallet (its
// movements would stay on another ledger). Never an automatic switch.

export type EconomyMode = 'lab' | 'canonical';

/**
 * Modules proven end to end on the canonical Wallet (every economic path through the port, tests on PGlite and real
 * Postgres). A module absent or `false` here keeps a runtime on the Lab wallet.
 */
export const CANONICAL_READY: Readonly<Record<string, true | string>> = {
  word_game: true,
  mini_games: true, // Roulette, Slot, Duel
  // Phase 2 lot 2: debits (single, salves), automatic and moderation refunds, moderation reads — all on the port.
  bonk: true,
  // Jetons proven end to end; the credits payment (D2: secondary currency, not migrated) is refused on canonical.
  soundboard:
    'paiement en crédits Soundboard refusé en canonique (crédits non migrés, D2)',
  tts: 'paiement en crédits TTS refusé en canonique (crédits non migrés, D2)',
  // Phase 2 lot 3: winnings once per winner and round (dedup and history on the port), Jetons rounds (the defaults).
  // A round in credits or another Lab currency is refused at configuration and opening (D2: credits are never a
  // Tombola reward, never converted) — refused explicitly, not a missing path.
  raffle: true,
  // Phase 2 lot 5: a gain decided on canonical is credited with its spin, once (same row lock for award / cancel);
  // « credited by hand » closed on canonical; gains pending from before never paid automatically.
  sub_wheel: true,
  // Phase 2 lot 6: « Créditer » / « Débiter » through WalletService.adminAdjustIn (bounded at 0, deduplicated by the
  // action key, audited); the Lab test-wallet tool (set / reset the fictitious balances) is refused on canonical.
  moderation_wallet: true,
};

export class EconomyActivationError extends Error {
  constructor(readonly reasons: string[]) {
    super(`canonical economy refused: ${reasons.join('; ')}`);
  }
}

/** What the economic cutover still has to settle, read-only (docs/ECONOMY_MIGRATION.md § 13). */
export interface EconomyPreflight {
  /** Blocking: the canonical economy cannot start. */
  blocking: string[];
  /** The boundary between the previous economy and this one: the cutoff of the applied opening import. */
  cutoff: string | null;
  /** Waiting, paid at most once when their flow is switched on (same keys). */
  pending: {
    dailyCredits: { count: number; amount: number };
    loyaltyRewards: { count: number; amount: number };
  };
}

const total = async (q: Queryable, sql: string, params: unknown[] = []) => {
  const r = (
    await q
      .query<{ n: string | number; s: string | number | null }>(sql, params)
      .catch(() => [])
  )[0];
  return { count: Number(r?.n ?? 0), amount: Number(r?.s ?? 0) };
};

export async function economyPreflight(
  q: Queryable,
): Promise<EconomyPreflight> {
  const blocking: string[] = [];
  const cutoff = (
    await q
      .query<{ cutoff: Date }>(
        'select i.cutoff from wallet_imports i join currencies c on c.id = i.currency_id where c.is_primary',
      )
      .catch(() => [])
  )[0]?.cutoff;
  if (!cutoff)
    blocking.push("aucun import d'ouverture appliqué à la monnaie principale");
  // Wheel gains of the previous economy (paid by SAMMI / StreamElements or not): reconciled by hand first, never paid
  // automatically by this one (docs/SUB_WHEEL.md § 3).
  const wheel = await total(
    q,
    `select count(*) as n, sum(amount) as s from sw_spins where source = 'twitch' and award_status = 'pending'
     and ($1::timestamptz is null or created_at <= $1)`,
    [cutoff ?? null],
  );
  if (wheel.count)
    blocking.push(
      `${wheel.count} gain(s) de la Roue du Sub d'avant la bascule à rapprocher (${wheel.amount} Jetons)`,
    );
  return {
    blocking,
    cutoff: cutoff ? new Date(cutoff).toISOString() : null,
    pending: {
      dailyCredits: await total(
        q,
        `select count(*) as n, sum(amount) as s from daily_credits where provider = 'core-wallet'
         and status in ('pending', 'sending')`,
      ),
      loyaltyRewards: await total(
        q,
        "select count(*) as n, sum(amount) as s from loyalty_rewards where status = 'pending'",
      ),
    },
  };
}

export async function selectEconomy(opts: {
  mode: EconomyMode;
  q: Queryable;
  wallet: WalletService;
  /** The economic modules this runtime serves. */
  modules: readonly string[];
}): Promise<EconomyPort> {
  if (opts.mode === 'lab') return labEconomy;
  const reasons: string[] = [];
  for (const m of opts.modules) {
    const r = CANONICAL_READY[m];
    if (r !== true) reasons.push(`${m} : ${r ?? 'module inconnu'}`);
  }
  // The real balances must already be in this Wallet (one applied opening import), and nothing of the previous
  // economy left to reconcile.
  reasons.push(...(await economyPreflight(opts.q)).blocking);
  if (reasons.length) throw new EconomyActivationError(reasons);
  return coreWalletEconomy(opts.wallet);
}
