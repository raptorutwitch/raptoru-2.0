// Vitrine du mini-profil (Lab seulement) : le cas de démonstration choisi est passé à chaque cadre (?mpDemo=…),
// shared/mini-profile.js le lit au chargement. Le panneau lui-même reste à sa vraie taille, sans réglage de maquette.
const frames = [...document.querySelectorAll('iframe[data-src]')];
const buttons = [...document.querySelectorAll('[data-case]')];

function choose(id) {
  for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.case === id));
  for (const f of frames) {
    const url = new URL(f.dataset.src, window.location.href);
    url.searchParams.set('mpDemo', id);
    f.src = url.pathname + url.search;
  }
  window.history.replaceState(null, '', `?cas=${id}`);
}

for (const b of buttons) b.addEventListener('click', () => choose(b.dataset.case));
choose(new URLSearchParams(window.location.search).get('cas') || 'standard');
