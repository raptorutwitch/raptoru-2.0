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
  bonk: 'historique et remboursements de modération lus dans lab_wallet_ledger',
  soundboard:
    'crédits Soundboard (décision D2) et historique lus dans lab_wallet_ledger',
  tts: 'crédits TTS (décision D2), état des remboursements lu dans lab_wallet_ledger',
  raffle:
    'déduplication des gains lue dans lab_wallet_ledger ; monnaies de tirage autres que les Jetons',
};

export class EconomyActivationError extends Error {
  constructor(readonly reasons: string[]) {
    super(`canonical economy refused: ${reasons.join('; ')}`);
  }
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
  // The real balances must already be in this Wallet: one applied opening import of the primary currency.
  const imported = await opts.q
    .query<{ id: string }>(
      `select i.id from wallet_imports i join currencies c on c.id = i.currency_id where c.is_primary`,
    )
    .catch(() => []);
  if (!imported.length)
    reasons.push("aucun import d'ouverture appliqué à la monnaie principale");
  if (reasons.length) throw new EconomyActivationError(reasons);
  return coreWalletEconomy(opts.wallet);
}
