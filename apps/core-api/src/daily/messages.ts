// Chat wording decided by Core. Edit freely: no logic depends on these strings.

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/\s/g, ' ');

export const dailyMessages = {
  /** The validation and the gain only: the streak is `!streak`. */
  claimed: (name: string, reward: number) =>
    `@${name} - Daily validé ✅ +${fmt(reward)} jetons !`,

  alreadyClaimed: (name: string) =>
    `✅ @${name} - tu as déjà récupéré ton Daily pour ce stream !`,

  noActiveStream: () => '💤 Aucun stream actif actuellement.',

  streak: (name: string, streak: number, total: number, best: number) => {
    if (total === 0)
      return `@${name} n'a encore validé aucun Daily - tape !daily pendant un stream !`;
    const totals = `${total} Daily ${plural(total, 'validé', 'validés')} au total · record : ${best}`;
    if (streak === 0) return `@${name} n'a pas de série en cours - ${totals}`;
    return `🔥 @${name} est présent depuis ${streak} ${plural(streak, 'stream', 'streams')} d'affilée - ${totals}`;
  },
};
