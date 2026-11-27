// Bulle « Tombola » du socle v2 (app/panel.js) : tant qu'une tombola est ouverte et que le viewer n'y est pas inscrit,
// un petit raccourci dans le Hub et l'en-tête de chaque module. « Tombola » ouvre sa page (le retour ramène au module
// d'où l'on vient) ; « Rejoindre » inscrit tout de suite par la même action que la page Tombola (client.joinRaffle, le
// Core décide : fermée, en pause, bloqué, déjà inscrit…), sans quitter le module. Jamais sans l'identité Twitch
// partagée : son parcours reste celui de la page Tombola. Après l'inscription : « Inscrit » quelques secondes, puis
// la bulle disparaît.

export const JOINED_SHOWN_MS = 3000;

/** Refus du Core, en deux mots dans la bulle (la phrase complète en infobulle). `retry` : un nouvel essai a un sens. */
const REFUSAL = {
  raffle_closed: { short: 'Fermée', long: 'Inscriptions fermées', retry: false },
  raffle_paused: { short: 'En pause', long: 'Inscriptions en pause par la modération', retry: true },
  round_paused: { short: 'En pause', long: 'En pause · reprise bientôt', retry: true },
  global_pause: { short: 'En pause', long: 'Raptoru est en pause · inscriptions suspendues', retry: true },
  module_disabled: { short: 'Indisponible', long: 'Inscriptions désactivées', retry: false },
  extension_join_disabled: { short: 'Par le chat', long: 'Inscription depuis le chat uniquement', retry: false },
  viewer_blocked: { short: 'Indisponible', long: 'Inscription indisponible pour ton compte', retry: false },
  entry_removed: { short: 'Retiré', long: 'Retiré par la modération', retry: false },
  identity_required: { short: 'Identité', long: 'Partage ton identité Twitch pour participer depuis l’Extension', retry: false },
};
const refusalOf = (code) => REFUSAL[code] ?? { short: 'Échec', long: 'Inscription impossible pour l’instant', retry: true };

/**
 * Ce que montre la bulle (pur, testé) : null = cachée ; sinon `mode` open | joining | error | joined, `canJoin`
 * (le bouton « Rejoindre » ou « Réessayer »), `message` / `detail` pour un refus.
 */
export function raffleBubbleView({ offered, active, joined, onRaffle, identityShared, windowId, local, now }) {
  if (!offered || !active || onRaffle) return null;
  const mine = local && local.windowId === windowId ? local : null;
  if (mine?.status === 'joined') return now - mine.at < JOINED_SHOWN_MS ? { mode: 'joined' } : null;
  if (joined) return null;
  if (mine?.status === 'joining') return { mode: 'joining', canJoin: false };
  if (mine?.status === 'error') {
    const r = refusalOf(mine.code);
    return { mode: 'error', canJoin: identityShared && r.retry, message: r.short, detail: r.long };
  }
  return { mode: 'open', canJoin: identityShared };
}

/**
 * La bulle et son inscription : un seul nœud gardé d'un rendu à l'autre. `render(input)` le met à jour et le rend
 * (ou null) ; un clic sur « Rejoindre » pendant une inscription en cours ne fait rien (une intention à la fois).
 */
export function createRaffleBubble({ document, icon, join, open, changed, refreshed, now = () => Date.now() }) {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  let local = null; // { windowId, status: joining | joined | error, code?, at }
  let lastInput = null;
  let shownWindow = null;
  const node = el('span', 'jdm-raffle-chip');
  node.setAttribute('role', 'group');
  node.setAttribute('aria-label', 'Tombola ouverte');

  async function runJoin(windowId) {
    if (local?.windowId === windowId && local.status === 'joining') return;
    local = { windowId, status: 'joining', at: now() };
    changed();
    try {
      await join();
      local = { windowId, status: 'joined', at: now() };
      refreshed?.();
      document.defaultView?.setTimeout?.(() => changed(), JOINED_SHOWN_MS + 50);
    } catch (e) {
      local = { windowId, status: 'error', code: e?.code ?? 'error', at: now() };
    }
    changed();
  }

  function render(input) {
    lastInput = input;
    const windowId = String(input.raffle?.window_id ?? input.raffle?.token ?? 'open');
    if (local && local.windowId !== windowId) local = null; // une nouvelle tombola : on repart de zéro
    const view = raffleBubbleView({
      offered: input.offered,
      active: input.active,
      joined: input.raffle?.joined === true,
      onRaffle: input.onRaffle,
      identityShared: input.identityShared,
      windowId,
      local,
      now: now(),
    });
    if (!view) return null;
    node.className = `jdm-raffle-chip is-${view.mode}`;
    if (shownWindow !== windowId) {
      shownWindow = windowId;
      node.classList.add('is-new');
      node.addEventListener('animationend', () => node.classList.remove('is-new'), { once: true });
    }
    const dot = el('span', 'jdm-raffle-chip__dot');
    dot.setAttribute('aria-hidden', 'true');
    if (view.mode === 'joined') {
      const done = el('span', 'jdm-raffle-chip__done');
      done.setAttribute('role', 'status');
      done.append(dot, el('span', 'jdm-raffle-chip__label', 'Inscrit ✓'));
      node.replaceChildren(done);
      node.setAttribute('aria-label', 'Tombola : inscrit');
      return node;
    }
    node.setAttribute('aria-label', 'Tombola ouverte');
    const go = el('button', 'jdm-raffle-chip__open');
    go.type = 'button';
    go.title = 'Tombola ouverte : voir les participants';
    go.setAttribute('aria-label', 'Tombola ouverte : voir la page');
    go.append(dot, icon('raffle_join', 'jdm-raffle-chip__icon'), el('span', 'jdm-raffle-chip__label', 'Tombola'));
    go.addEventListener('click', () => open());
    const parts = [go];
    if (view.mode === 'error') {
      const msg = el('span', 'jdm-raffle-chip__msg', view.message);
      msg.title = view.detail;
      msg.setAttribute('role', 'alert');
      parts.push(msg);
    }
    if (view.mode === 'joining' || view.canJoin) {
      const joinBtn = el('button', 'jdm-raffle-chip__join', view.mode === 'joining' ? '…' : view.mode === 'error' ? 'Réessayer' : 'Rejoindre');
      joinBtn.type = 'button';
      joinBtn.title = view.mode === 'joining' ? 'Inscription en cours' : 'S’inscrire à la Tombola sans quitter ce module';
      joinBtn.setAttribute('aria-label', view.mode === 'joining' ? 'Inscription à la Tombola en cours' : 'Rejoindre la Tombola');
      if (view.mode === 'joining') {
        joinBtn.disabled = true;
        joinBtn.setAttribute('aria-busy', 'true');
      }
      joinBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void runJoin(windowId);
      });
      parts.push(joinBtn);
    }
    node.replaceChildren(...parts);
    return node;
  }

  return {
    render,
    /** Le dernier état reçu (tests) et l'inscription locale en cours. */
    debug: () => ({ local, lastInput }),
  };
}
