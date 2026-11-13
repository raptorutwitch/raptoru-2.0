// Mini-jeux — the container (UX refonte 13/11): one Hub card, several games inside. A compact row of game tiles shows
// only when there is more than one game (never fictional games); the first one opens by default. Each game is
// `{ id, label, icon (svg markup), create() → { node, start(), destroy() } }`: switching destroys the previous view
// (no timer, poll or listener left behind).

export function createMiniGames({ document, games }) {
  const node = document.createElement('section');
  node.className = 'mg';
  const body = document.createElement('div');
  body.className = 'mg__body';
  let current = null;
  let view = null;
  let started = false;
  let nav = null;
  if (games.length > 1) {
    nav = document.createElement('nav');
    nav.className = 'mg__nav';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Mini-jeux');
    for (const g of games) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mg__tile';
      b.setAttribute('role', 'tab');
      b.dataset.game = g.id;
      b.innerHTML = `<span class="mg__ticon" aria-hidden="true">${g.icon}</span><span>${g.label}</span>`;
      nav.append(b);
    }
    nav.addEventListener('click', (e) => {
      const id = e.target.closest?.('[data-game]')?.dataset.game;
      if (id && id !== current?.id) open(games.find((g) => g.id === id));
    });
    node.append(nav);
  }
  node.append(body);

  function open(game) {
    view?.destroy?.();
    current = game;
    view = game.create();
    body.replaceChildren(view.node);
    node.dataset.game = game.id;
    for (const b of nav?.querySelectorAll('[data-game]') ?? []) {
      const on = b.dataset.game === game.id;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    }
    if (started) view.start?.();
  }
  open(games[0]);

  return {
    node,
    start() {
      started = true;
      view?.start?.();
    },
    destroy() {
      started = false;
      view?.destroy?.();
    },
  };
}
