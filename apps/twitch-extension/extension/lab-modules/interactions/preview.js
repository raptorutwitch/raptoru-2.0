// LAB ONLY — aperçu d'un effet : une scène de jeu stylisée (ciel, collines, cible, barre de vie, viseur) à laquelle
// interactions.css applique une APPROXIMATION de l'effet. Ce n'est jamais le rendu du moteur (marqué « Aperçu simulé »).
// L'aperçu lit les VALEURS RÉELLES du réglage, résolues comme le moteur (catalog.resolveParams) : amplitude et fréquence
// du tremblement, facteur et point du zoom, rayon, obscurité et zoom du tunnel, fermeture et chronologie des paupières,
// densité du brouillard, flou, taille des pixels, saturation et teinte… Un nouvel effet n'a qu'à lire ses paramètres ici.
//   - catalogue : petite image figée sur son instant le plus parlant ; légère animation au survol (souris) seulement ;
//   - fiche     : grand aperçu animé qui suit le réglage.
// Économe : une scène en dégradés CSS par aperçu, animation coupée quand la fiche est fermée, mouvement réduit respecté.
import { resolveParams, variantOf } from './catalog.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/**
 * Paupières : la chronologie du moteur (Vision.cs, BlinkEffect.Prepare), en images clés pour Web Animations. `c` = 0
 * (ouvert) … 1 (fermé). Renvoie [{ offset, c }] sur une période, et la durée de la période (ms).
 */
export function blinkTimeline(p) {
  const close = p.close_ms;
  const hold = p.hold_ms;
  const open = p.open_ms;
  const depth = Math.min(1, p.intensity);
  const one = (t0) => [
    [t0, 0],
    [t0 + close, depth],
    [t0 + close + hold, depth],
    [t0 + close + hold + open, 0],
  ];
  let pts = [];
  let period = 0;
  if (p.mode === 'ferme') {
    period = 6000;
    pts = [[0, 0], [close, depth], [period - open - 200, depth], [period - 200, 0], [period, 0]];
  } else if (p.mode === 'serie') {
    let t = 150;
    for (let k = 0; k < p.count; k += 1) {
      pts.push(...one(t));
      t += close + hold + open + 120;
    }
    period = t + p.interval_ms;
  } else if (p.mode === 'somnolence') {
    period = 7000;
    pts = [[0, 0], [1800, 0.45 * depth], [2600, 0.3 * depth], [3600, depth], [5000, depth], [5150, 0], [7000, 0.15]];
  } else if (p.mode === 'resistance') {
    period = 6500;
    pts = [[0, 0], [close, 1], [1200, 1], [1900, 0.45], [2200, 0.5], [2500, 1], [3300, 1], [4000, 0.35], [4300, 0.4], [4600, 1], [5300, 1], [6300, 0], [6500, 0]];
  } else {
    pts = one(250);
    period = 250 + close + hold + open + p.interval_ms;
  }
  return { period, keys: pts.map(([t, c]) => ({ offset: clamp(t / period, 0, 1), c })) };
}

/** Assombrissement de la partie visible pour une fermeture c (shader « eyelids » : dim × c²). */
const dimOf = (c) => Math.round(0.55 * c * c * 1000) / 1000;

/** Bords de l'amande pour une fermeture c (0..1) : paupière haute (c), basse (c^1,8), largeur qui se resserre (shader « eyelids »). */
export function eyeBox(c) {
  const lower = Math.pow(c, 1.8);
  return { top: `${-15 + c * 65}%`, bottom: `${-15 + lower * 65}%`, width: `${170 - c * 100}%` };
}

export function preview(document, effectId, { big = false } = {}) {
  const node = document.createElement('div');
  node.className = `ix-pv${big ? ' ix-pv--big' : ''}`;
  node.dataset.fx = effectId;
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML =
    '<div class="ix-pv__world"><div class="ix-pv__scene"></div><div class="ix-pv__ghost"></div></div>' +
    '<div class="ix-pv__veil"></div>' +
    (effectId === 'fog' ? '<div class="ix-pv__fog"><i class="ix-pv__fogf"></i><i class="ix-pv__fogn"></i></div>' : '') +
    (effectId === 'blink' ? '<i class="ix-pv__eye"></i>' : '') +
    (effectId === 'zoom' ? '<i class="ix-pv__frame"></i>' : '') +
    (effectId === 'vhs' ? '<i class="ix-pv__track"></i>' : '') +
    (effectId === 'confetti' || effectId === 'emote_rain' ? '<i class="ix-pv__rain"></i><i class="ix-pv__rain ix-pv__rain--b"></i>' : '');
  const eye = node.querySelector('.ix-pv__eye');
  const veil = node.querySelector('.ix-pv__veil');
  let params = null;
  let live = false;
  let anim = null;
  let dimAnim = null;
  const reduced = () => Boolean(document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const v = (k, x) => node.style.setProperty(k, String(x));

  function animateEye() {
    anim?.cancel();
    dimAnim?.cancel();
    anim = null;
    dimAnim = null;
    if (!eye || !params) return;
    // Image figée : yeux à moitié fermés (catalogue, mouvement réduit) ; la fiche montre la vraie chronologie.
    const c0 = Math.min(1, params.intensity) * 0.55;
    Object.assign(eye.style, eyeBox(c0));
    veil.style.opacity = String(dimOf(c0));
    if (!live || reduced() || typeof eye.animate !== 'function') return;
    const { period, keys } = blinkTimeline(params);
    anim = eye.animate(
      keys.map((k) => ({ offset: k.offset, ...eyeBox(k.c), easing: 'ease-in-out' })),
      { duration: period, iterations: Infinity },
    );
    // Comme le shader : la partie encore visible s'assombrit à mesure que les paupières se ferment (c²).
    dimAnim = veil.animate(
      keys.map((k) => ({ offset: k.offset, opacity: dimOf(k.c), easing: 'ease-in-out' })),
      { duration: period, iterations: Infinity },
    );
  }

  function set(e, c) {
    if (!e || e.planned) return;
    const p = resolveParams(e, c);
    params = p;
    node.dataset.style = variantOf(e, c) ?? '';
    node.dataset.level = c.level ?? '';
    node.dataset.mode = p.mode ?? '';
    const o = c.opts ?? {};
    if (o.point) {
      v('--zx', o.point[0]);
      v('--zy', o.point[1]);
    }
    if (o.hue != null) v('--hue', `${o.hue}deg`);
    node.dataset.entry = o.entry ?? '';
    node.dataset.rhythm = o.rhythm ?? '';
    switch (e.id) {
      case 'shake': // amplitudes réelles par axe (% de l'écran), roulis (°), fréquence, intervalle des rafales
        v('--a', `${Math.max(p.amp_x, p.amp_y) * p.intensity}%`);
        v('--ax', `${p.amp_x * p.intensity}%`);
        v('--ay', `${p.amp_y * p.intensity}%`);
        v('--rot', `${p.rotation * p.intensity}deg`);
        // Huit positions irrégulières par cycle : un cycle = 8 / fréquence (le moteur suit un bruit, pas une oscillation).
        v('--period', `${clamp(8 / p.frequency, 0.3, 2.4)}s`);
        v('--burst', `${clamp(p.interval_ms / 1000, 0.6, 4)}s`);
        break;
      case 'zoom':
        v('--zf', p.factor);
        break;
      case 'drunk':
        v('--sway', `${p.sway * p.intensity}deg`);
        v('--double', clamp(p.double * p.intensity * 1.2, 0, 0.8));
        v('--dblur', `${p.blur * p.intensity}cqw`);
        break;
      case 'tunnel': {
        // Shader « tunnel » : zone nette de rayon r (hauteurs d'écran), puis l'obscurité croît sur la largeur du dégradé
        // jusqu'à son maximum ; ellipse étirée (`stretch`, 1 pour le cercle). Le voile mesure 4 × l'aperçu (16:9).
        const stretch = p.shape === 'cercle' ? 1 : p.stretch;
        const outer = p.radius + 0.6 * p.gradient;
        v('--ry', `${(outer * 100) / 4}%`);
        v('--rx', `${(outer * stretch * (9 / 16) * 100) / 4}%`);
        v('--stop', `${(p.radius / outer) * 100}%`);
        v('--d', p.darkness);
        v('--tz', p.zoom);
        v('--shrink', p.shrink);
        break;
      }
      case 'fog':
        v('--fog', clamp(0.25 + (p.density * p.opacity * (0.6 + 0.4 * p.thickness)) * 0.85, 0, 1));
        v('--haze', clamp(p.haze * p.opacity * 0.5, 0, 0.6));
        break;
      case 'blur':
        v('--b', `${(p.amount / 100) * 3}cqw`);
        v('--bmin', `${(p.minimum / 100) * 3}cqw`);
        break;
      case 'pixelate': // taille réelle en 1080p, grossie pour rester lisible dans un petit aperçu
        v('--px', `${clamp(p.block * 0.12, 0.8, 18)}cqw`);
        break;
      case 'color':
        v('--sat', p.saturation);
        break;
      case 'vhs':
        v('--v', clamp(0.35 * p.intensity + 0.35 * p.glitch + 0.3 * p.tracking, 0.2, 1));
        break;
      case 'flash':
        v('--blind', `${p.blind_ms}ms`);
        v('--rec', `${p.recovery_ms}ms`);
        break;
      default:
        break;
    }
    if (e.id === 'blink') animateEye();
  }

  return {
    node,
    set,
    live(on) {
      live = Boolean(on);
      if (on) node.dataset.live = '1';
      else delete node.dataset.live;
      if (eye) animateEye();
    },
  };
}
