// LAB ONLY — « Jouer sur mon PC » : la fiche envoie sa demande (engineRequest, les mêmes paramètres réels que le futur
// achat) au Studio qui sert CETTE page, qui la passe au moteur Chaos par la route Lab `POST /api/chaos/lab/play`
// (profil Lab seulement, même hôte, en-tête Studio ; source « extension » = règles d'un viewer ; docs/chaos/CONTRAT_LOT2.md
// § 3). Visible seulement quand la page est servie par Studio sur ce PC (`/ext/`, même origine, Studio répond) : une page
// d'une autre origine ne peut ni l'afficher ni appeler Studio (aucun CORS, garde même hôte, en-tête obligatoire).
// Désactivé par défaut, jamais déclenché à l'ouverture ; aucun Jeton, aucun Core, aucune récompense Twitch.
const STUDIO = { 'x-raptoru-studio': '1' };

/** Lecture lisible d'un état du moteur pour la fiche. */
const STATE_TEXT = {
  accepted: 'accepté par le moteur',
  starting: 'démarre sur ton écran',
  started: 'joue sur ton écran',
  queued: 'en file du moteur',
};

export function createLocalPlay({ win = globalThis, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  const servedByStudio = () => String(win?.location?.pathname ?? '').startsWith('/ext/');
  let available = null; // null : pas encore vérifié
  let on = false;

  async function call(path, init = {}) {
    const res = await fetchImpl(path, { ...init, headers: { ...STUDIO, ...(init.body ? { 'content-type': 'application/json' } : {}) } });
    const body = await res.json().catch(() => ({}));
    return { res, body };
  }

  return {
    /** Studio Lab sert-il cette page, et sa partie Chaos répond-elle ? (une fois, à l'ouverture du module) */
    async probe() {
      if (!servedByStudio() || typeof fetchImpl !== 'function') return (available = false);
      try {
        available = (await call('/api/chaos/state')).res.ok;
      } catch {
        available = false;
      }
      return available;
    },
    isAvailable: () => available === true,
    isOn: () => on && available === true,
    setOn(v) {
      on = Boolean(v) && available === true;
      return on;
    },
    /** Envoie la demande au moteur ; null si le mode est coupé. Jamais d'exception : un résultat lisible. */
    async play(engineRequest) {
      if (!on || available !== true) return null;
      try {
        const { res, body } = await call('/api/chaos/lab/play', { method: 'POST', body: JSON.stringify(engineRequest) });
        if (!res.ok || body.ok === false) return { ok: false, code: body.code ?? body.error ?? `http_${res.status}`, text: body.message ?? 'refusé par Studio' };
        return { ok: true, requestId: body.request_id ?? null, state: body.state ?? 'accepted', text: STATE_TEXT[body.state] ?? 'envoyé au moteur' };
      } catch {
        return { ok: false, code: 'studio_unreachable', text: 'Studio ne répond pas' };
      }
    },
    /** STOP ALL du moteur (la même route que Studio › Chaos). */
    async stopAll() {
      if (available !== true) return false;
      try {
        return (await call('/api/chaos/stop-all', { method: 'POST', body: '{}' })).res.ok;
      } catch {
        return false;
      }
    },
  };
}
