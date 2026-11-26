// LAB ONLY — aperçu d'un effet : une scène de jeu stylisée (ciel, collines, cible, barre de vie, viseur) à laquelle
// interactions.css applique une APPROXIMATION de l'effet. Ce n'est jamais le rendu du moteur (marqué « Aperçu simulé »).
//   - catalogue : petite image figée sur son instant le plus parlant ; légère animation au survol (souris) seulement ;
//   - fiche     : grand aperçu animé qui suit le réglage (style, force, facteur, point visé, teinte…).
// Économe : une seule scène en dégradés CSS par aperçu, animation coupée quand la fiche est fermée (`data-live` absent),
// mouvement réduit respecté (interactions.css).
import { levelOf, styleOf } from './catalog.js';

/** Force d'un niveau sur 0..1 (les niveaux du registre ont des ids communs). */
const LEVEL_K = { leger: 0.4, marque: 0.7, dense: 0.85, extreme: 1 };
/** Tunnel : rayon de la zone visible par niveau (registre : levels.radius, en part de la hauteur). */
const TUNNEL_R = { leger: 0.42, marque: 0.28, extreme: 0.11 };

export function preview(document, effectId, { big = false } = {}) {
  const node = document.createElement('div');
  node.className = `ix-pv${big ? ' ix-pv--big' : ''}`;
  node.dataset.fx = effectId;
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML =
    '<div class="ix-pv__world"><div class="ix-pv__scene"></div><div class="ix-pv__ghost"></div></div>' +
    '<div class="ix-pv__veil"></div>' +
    (effectId === 'fog' ? '<div class="ix-pv__fog"><i></i><i></i><i></i></div>' : '') +
    (effectId === 'blink' ? '<i class="ix-pv__lid ix-pv__lid--top"></i><i class="ix-pv__lid ix-pv__lid--bottom"></i>' : '') +
    (effectId === 'zoom' ? '<i class="ix-pv__frame"></i>' : '') +
    (effectId === 'vhs' ? '<i class="ix-pv__track"></i>' : '');

  function set(e, c) {
    const st = styleOf(e, c);
    const lv = levelOf(e, c);
    node.dataset.style = st?.id ?? '';
    node.dataset.level = lv?.id ?? '';
    node.style.setProperty('--k', String(LEVEL_K[lv?.id] ?? 0.7));
    const o = c.opts ?? {};
    if (o.point) {
      node.style.setProperty('--zx', String(o.point[0]));
      node.style.setProperty('--zy', String(o.point[1]));
    }
    if (o.factor) node.style.setProperty('--zf', String(o.factor));
    if (o.hue != null) node.style.setProperty('--hue', `${o.hue}deg`);
    if (o.saturation) node.style.setProperty('--sat', String(o.saturation));
    if (e.id === 'tunnel') node.style.setProperty('--r', String(TUNNEL_R[lv?.id] ?? 0.28));
    node.dataset.motion = o.motion ?? '';
    node.dataset.entry = o.entry ?? '';
    node.dataset.rhythm = o.rhythm ?? '';
    node.dataset.rising = o.rising ? '1' : '';
  }

  return {
    node,
    set,
    live(on) {
      if (on) node.dataset.live = '1';
      else delete node.dataset.live;
    },
  };
}
