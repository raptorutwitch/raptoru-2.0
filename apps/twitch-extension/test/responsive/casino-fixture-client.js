// The fixture `client` a casino screen is mounted with (casino.js's `ctx.client`): just enough of the extension's
// real api.js surface for each game to run unmodified, answering from the canned data in casino-fixtures.js instead
// of the Core. Never resolves a second bj/state poll (after >= 0): the screen just stays on its one fixture snapshot,
// which is exactly what a static preview wants (no replayed animation, no drift).
const never = () => new Promise(() => {});
const hang = () => never();

export function buildClient(game, data) {
  const casinoState = async () => data.casino;
  const history = async () => ({
    rounds: data.history ?? [],
    stats: { rounds: (data.history ?? []).length, staked: 0, won: 0, best: 0 },
  });
  const share = async () => ({
    text: 'LeCroupier_ : un résultat de démonstration (banc responsive).',
  });
  if (game === 'blackjack')
    return {
      casinoState,
      casinoHistory: history,
      casinoShare: share,
      bjTables: async () => ({
        tables: data.tables ?? [],
        mine: data.mine ?? null,
      }),
      bjState: async (table, after) =>
        after >= 0 ? hang() : { state: data.snapshot },
      bjJoin: async () => ({
        table: data.snapshot.table,
        seat: 0,
        created: false,
      }),
      bjBet: async () => ({ ok: true }),
      bjClear: async () => ({ ok: true }),
      bjAct: async () => ({ ok: true }),
      bjInsure: async () => ({ ok: true }),
      bjLeave: async () => ({ ok: true }),
      bjAnnounce: async () => ({ ok: true }),
    };
  // Slot, book, roulette: a spin answers once per click (real interaction — Auto/Rapide included), from a fixed
  // round picked by the scenario, or a thrown error for the "erreur contrôlée" scenario.
  return {
    casinoState,
    casinoHistory: history,
    casinoShare: share,
    casinoDraft: async () => ({ ok: true }),
    casinoPresence: async () => ({ ok: true }),
    casinoWatch: hang,
    casinoLive: hang,
    casinoSpin: async () => {
      if (data.error)
        throw Object.assign(new Error(data.error), { code: data.error });
      return data.spin();
    },
    casinoProgress: async () => ({ ok: true }),
  };
}
