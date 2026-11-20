// Blackjack (prototype) — le RÉSEAU simulé entre un écran et le Core simulé : latence, coupure, réponse perdue.
// L'écran n'appelle jamais le Core directement : uniquement par ce client, comme l'extension le fera par HTTP
// (requêtes) + flux d'événements (long-poll). Les états reçus portent un numéro de séquence ; l'écran ignore les
// doublons et se resynchronise (instantané complet) après un trou ou une reconnexion.

export function createClient(core, { user, name, latency = () => 35 + Math.random() * 70 } = {}) {
  let online = true;
  let loseNext = false;
  let watching = null; // { table, unsub, onState }
  let deliverAt = 0;
  const listeners = new Set();
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const netErr = () => Object.assign(new Error('network_error'), { code: 'network_error' });

  /** Une requête : elle voyage (latence), le Core l'exécute, la réponse revient (ou se perd). */
  async function request(fn) {
    await wait(latency());
    if (!online) throw netErr();
    let res;
    let fail;
    try {
      res = fn();
    } catch (e) {
      fail = e;
    }
    await wait(latency());
    if (loseNext) {
      loseNext = false;
      throw netErr(); // exécutée côté Core, mais la réponse n'arrive pas : le client renverra la MÊME action
    }
    if (!online) throw netErr();
    if (fail) throw fail;
    return res;
  }
  /** Les états poussés par le Core, livrés dans l'ordre avec la latence (une coupure : rien n'arrive). */
  function deliver(state) {
    if (!online) return;
    const at = Math.max(deliverAt, performance.now() + latency());
    deliverAt = at;
    setTimeout(() => online && watching && state.table === watching.table && watching.onState(state, { live: true }), at - performance.now());
  }

  return {
    user,
    name,
    get online() {
      return online;
    },
    request,
    join: (opts) => request(() => core.join(user, name, opts)),
    leave: () => request(() => core.leave(user)),
    placeBets: (b) => request(() => core.placeBets(user, b)),
    clearBets: () => request(() => core.clearBets(user)),
    act: (a) => request(() => core.act(user, a)),
    insure: (a) => request(() => core.insure(user, a)),
    tables: () => request(() => core.tables()),
    myTable: () => core.tableOf(user),
    balance: () => core.wallet.balance(user),
    /** Suivre une table : un instantané d'abord (sans animation), puis les états en direct. */
    async watch(table, onState) {
      watching?.unsub();
      watching = { table, onState, unsub: core.subscribe(table, user, deliver) };
      const snap = await request(() => core.view(table, user));
      if (watching?.table === table) onState(snap, { live: false });
    },
    unwatch() {
      watching?.unsub();
      watching = null;
    },
    /** Lab : coupure réseau. Revenir = instantané complet (resynchronisation), puis le direct. */
    async setOnline(v) {
      online = !!v;
      core.setConnected(user, online);
      for (const l of listeners) l(online);
      if (online && watching) {
        const w = watching;
        const snap = await request(() => core.view(w.table, user));
        if (watching === w) w.onState(snap, { live: false, resync: true });
      }
    },
    loseNextAnswer: () => (loseNext = true),
    onOnline: (fn) => listeners.add(fn),
  };
}
