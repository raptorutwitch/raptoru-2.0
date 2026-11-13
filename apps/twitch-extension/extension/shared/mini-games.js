// Mini-jeux — the container (V3, 14/11): a small catalog of game tiles, a game screen, a « Jeux » button back to the
// catalog. A game is `{ id, label, tagline, icon (svg), create({ back }) → { node, start(), destroy() },
// peek?() → Promise<string | null> }` (a one-line live summary on its tile). Adding a game = one more entry. The catalog
// lists real games only. The last screen of the session is reopened (no extra click for a returning player).

const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KEY = 'mg:screen';

export function createMiniGames({ document, games }) {
  const win = document.defaultView ?? globalThis;
  const node = document.createElement('section');
  node.className = 'mg';
  let view = null;
  let started = false;
  let peeked = false;

  const remember = (id) => {
    try {
      win.sessionStorage.setItem(KEY, id);
    } catch {
      /* memory only */
    }
  };
  const recalled = () => {
    try {
      return win.sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  };

  function catalog() {
    view?.destroy?.();
    view = null;
    remember('catalog');
    node.dataset.screen = 'catalog';
    node.innerHTML = `<div class="mg__home">
        <header class="mg__hero"><span class="mg__mark" aria-hidden="true">${games[0]?.icon ?? ''}</span><div><b>Mini-jeux</b><small>Des parties rapides, en Jetons</small></div></header>
        <div class="mg__tiles" role="list">${games
          .map(
            (g) => `<button type="button" class="mg__tile" role="listitem" data-game="${esc(g.id)}">
              <span class="mg__ticon" aria-hidden="true">${g.icon}</span>
              <span class="mg__tbody"><b>${esc(g.label)}</b><small>${esc(g.tagline ?? '')}</small><em data-peek="${esc(g.id)}"></em></span>
              <span class="mg__play">Jouer</span>
            </button>`,
          )
          .join('')}</div>
      </div>`;
    if (started) void peek();
  }

  async function peek() {
    if (peeked) return;
    peeked = true;
    for (const g of games) {
      const line = await g.peek?.().catch(() => null);
      const el = node.querySelector(`[data-peek="${g.id}"]`);
      if (el && line) el.textContent = line;
    }
    peeked = false;
  }

  function open(game) {
    view?.destroy?.();
    remember(game.id);
    node.dataset.screen = game.id;
    view = game.create({ back: games.length ? catalog : null });
    node.replaceChildren(view.node);
    if (started) view.start?.();
  }

  const onClick = (e) => {
    const id = e.target.closest?.('[data-game]')?.dataset.game;
    const g = id && games.find((x) => x.id === id);
    if (g) open(g);
  };
  node.addEventListener('click', onClick);

  const last = games.find((g) => g.id === recalled());
  if (last) open(last);
  else catalog();

  return {
    node,
    start() {
      started = true;
      if (view) view.start?.();
      else void peek();
    },
    destroy() {
      started = false;
      view?.destroy?.();
      node.removeEventListener('click', onClick);
    },
  };
}
