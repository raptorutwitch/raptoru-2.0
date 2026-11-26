// LAB ONLY — pictogrammes des effets (24×24, trait courant) et petite scène animée d'aperçu (CSS pur, effets.css).

const P = {
  flip: '<path d="M7 4v9a5 5 0 0 0 10 0V8"/><path d="m14 11 3-3 3 3"/><path d="M4 7l3-3 3 3"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2.4"/><path d="M9 7 4 17h5zM15 7l5 10h-5z"/>',
  shake: '<rect x="7" y="6" width="10" height="12" rx="2"/><path d="M3 9v6M21 9v6M5 7v10M19 7v10"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M8 10.5h5M10.5 8v5"/>',
  drunk: '<path d="M3 9c3-3 5 3 9 0s6 3 9 0"/><path d="M3 15c3-3 5 3 9 0s6 3 9 0"/>',
  tunnel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2"/>',
  blink: '<path d="M2.5 12c2.6-4 5.8-6 9.5-6s6.9 2 9.5 6c-2.6 4-5.8 6-9.5 6s-6.9-2-9.5-6Z"/><path d="M5 15.5 3.5 18M12 18v2.6M19 15.5l1.5 2.5"/>',
  flash: '<path d="M13 2 5 13.5h6L10 22l9-12.5h-6Z"/>',
  fog: '<path d="M7 15a4 4 0 0 1 .5-8A5.5 5.5 0 0 1 18 9a3 3 0 0 1-.5 6Z"/><path d="M4 19h16M7 22h10"/>',
  blur: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5"/>',
  pixelate: '<path d="M4 4h5v5H4zM9 9h5v5H9zM14 4h6v5h-6zM4 14h5v6H4zM14 14h6v6h-6z"/>',
  color: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor"/>',
  vhs: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="8" cy="12" r="2.2"/><circle cx="16" cy="12" r="2.2"/><path d="M10.2 12h3.6"/>',
  bonk: '<path d="M4 20 13 11"/><path d="m11 6 5-3 5 5-3 5z"/>',
  chaos: '<path d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5L10 13l-6.5-2L10 9Z"/><path d="M19 3v3M17.5 4.5h3"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.2-3 7.5-7 9-4-1.5-7-4.8-7-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4.5v15l12-7.5Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  gift: '<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M12 9v11M3.5 13h17M12 9C9 9 7 4 9.5 4S12 9 12 9Zm0 0c3 0 5-5 2.5-5S12 9 12 9Z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevL: '<path d="m15 5-7 7 7 7"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  queue: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  undo: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  lab: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.6 1.6 0 0 0 5.9 21h12.2a1.6 1.6 0 0 0 1.4-2.5L14 9V3"/><path d="M7.5 15h9"/>',
};

const NS = 'http://www.w3.org/2000/svg';

export function glyph(document, name, className = 'fx-ico') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = P[name] ?? P.chaos;
  return svg;
}

/** Jeton (même pièce dorée que le porte-monnaie de l'en-tête). */
export function token(document) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'fx-tok');
  svg.innerHTML = '<circle cx="8" cy="8" r="7.2" fill="#f2c65f"/><circle cx="8" cy="8" r="5.6" fill="none" stroke="#b9862a" stroke-width="1"/><path d="M8 4.6 11.2 8 8 11.4 4.8 8Z" fill="#7a5414"/>';
  return svg;
}

/**
 * Aperçu animé : une scène de jeu stylisée (ciel, soleil, collines, viseur, barre de vie) à laquelle effets.css
 * applique l'effet (`data-fx`, `data-tier`). `live` : animé ; sinon figé sur son image la plus parlante.
 */
export function preview(document, effect, tier, { live = false, big = false } = {}) {
  const box = document.createElement('div');
  box.className = `fx-pv${big ? ' fx-pv--big' : ''}`;
  box.dataset.fx = effect;
  if (tier) box.dataset.tier = tier;
  if (live) box.dataset.live = '1';
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = `<div class="fx-pv__scene"><i class="fx-pv__sun"></i><i class="fx-pv__hill fx-pv__hill--a"></i><i class="fx-pv__hill fx-pv__hill--b"></i><i class="fx-pv__ground"></i><i class="fx-pv__target"></i><i class="fx-pv__hud"></i><i class="fx-pv__aim"></i></div><i class="fx-pv__over"></i><i class="fx-pv__lid fx-pv__lid--top"></i><i class="fx-pv__lid fx-pv__lid--bottom"></i>`;
  return box;
}
