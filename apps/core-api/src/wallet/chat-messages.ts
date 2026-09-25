import type { Currency, WalletOperationResult } from '@raptoru/schemas';

// Chat wording for the bot routes only. The wallet itself never produces messages. Currency names
// always come from the currency record (a global rename changes every message).

export function formatAmount(amount: number, currency: Currency): string {
  const n = Math.abs(amount).toLocaleString('fr-FR').replace(/\s/g, ' ');
  const name = Math.abs(amount) >= 2 ? currency.plural : currency.singular;
  return `${n} ${name}${currency.icon ? ` ${currency.icon}` : ''}`;
}

const balanceOf = (r: WalletOperationResult, id: string) =>
  r.balances.find((b) => b.twitchUserId === id)?.balance ?? 0;

export const walletMessages = {
  balance: (name: string, balance: number, c: Currency) =>
    balance < 0
      ? `@${name} — dette actuelle : ${formatAmount(balance, c)}.`
      : `@${name} — tu as ${formatAmount(balance, c)}.`,

  transfer: (
    from: { id: string; name: string },
    toName: string,
    amount: number,
    r: WalletOperationResult,
    c: Currency | null,
  ) => {
    if (r.status === 'applied')
      return `✅ @${from.name} → @${toName} : ${formatAmount(amount, c!)} envoyés.`;
    switch (r.rejection) {
      case 'insufficient_funds':
        return `❌ @${from.name} — solde insuffisant (tu as ${formatAmount(balanceOf(r, from.id), c!)}).`;
      case 'in_debt':
        return `❌ @${from.name} — impossible pendant une dette (${formatAmount(balanceOf(r, from.id), c!)}).`;
      case 'self_transfer':
        return `❌ @${from.name} — tu ne peux pas te faire un transfert à toi-même.`;
      case 'currency_not_transferable':
        return `❌ @${from.name} — les ${c?.plural ?? 'points'} ne sont pas transférables.`;
      default:
        return `❌ @${from.name} — transfert impossible pour le moment.`;
    }
  },

  admin: (
    actorName: string,
    targetName: string,
    target: string,
    op: string,
    r: WalletOperationResult,
    c: Currency | null,
  ) => {
    if (r.status === 'rejected') {
      if (r.rejection === 'no_change')
        return `ℹ️ @${actorName} — le solde de @${targetName} est déjà à ${formatAmount(balanceOf(r, target), c!)}.`;
      if (r.rejection === 'negative_not_allowed')
        return `❌ @${actorName} — cette monnaie n'autorise pas de solde négatif.`;
      return `❌ @${actorName} — opération refusée (${r.rejection}).`;
    }
    const delta = r.amounts[0]?.amount ?? 0;
    const signed = `${delta > 0 ? '+' : '−'}${formatAmount(delta, c!)}`;
    const after = balanceOf(r, target);
    const afterText =
      after < 0
        ? `dette : ${formatAmount(after, c!)}`
        : `solde : ${formatAmount(after, c!)}`;
    return op === 'set'
      ? `🛠️ @${targetName} : solde fixé à ${after < 0 ? '−' : ''}${formatAmount(after, c!)} (${signed}).`
      : `🛠️ @${targetName} : ${signed} (${afterText}).`;
  },

  notAuthorized: (actorName: string) =>
    `⛔ @${actorName} — commande réservée à l'équipe.`,
};
