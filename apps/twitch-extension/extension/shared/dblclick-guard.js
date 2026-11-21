import { preventBonkDoubleClick } from './bonk-model.js';

// Double-clic → plein écran (docs/mini-jeux/AUDIT_MINI_JEUX_RANDOM_BAN.md § 9). Le helper Twitch écoute `dblclick` en
// REMONTÉE sur `document` et le relaie au lecteur, qui peut passer en plein écran : deux appuis rapides sur un bouton
// de l'extension faisaient sortir le viewer de la page. La protection du chargeur Bonk (preventBonkDoubleClick) est
// étendue à tous les CONTRÔLES, une seule fois par surface, sur <html> (sous `document` : l'événement est arrêté avant
// le helper). Une zone vide laisse passer le double-clic : le plein écran voulu reste possible. Les deux `click` ne sont
// jamais touchés (le helper les reçoit en capture, avant nous). Aucun contournement de Twitch : seul notre propre
// événement de double-clic sur nos boutons cesse de remonter.

const CONTROL = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="checkbox"]',
  '[data-guard-dblclick]',
].join(', ');

export function isGuardedTarget(target) {
  return !!target?.closest?.(CONTROL);
}

/**
 * The real path, through every Shadow DOM (audit UI-03, 21/11/2026): inside the Casino's shadow root, `event.target`
 * is the host element (`div.cz-host`), never the button the viewer actually hit, so `isGuardedTarget` found nothing
 * and let the double-click reach `document`, where Twitch's helper could still pass it to the player (fullscreen).
 * `composedPath()` gives the innermost element first; a `[data-guard-dblclick]` host also guards every click inside
 * it, a game screen having no "empty" area where fullscreen is wanted.
 */
export function isGuardedPath(event) {
  const path = typeof event?.composedPath === 'function' ? event.composedPath() : null;
  if (!path) return isGuardedTarget(event?.target);
  return path.some((n) => n?.nodeType === 1 && n.matches?.(CONTROL));
}

export function onGuardedDblclick(event) {
  if (isGuardedPath(event)) preventBonkDoubleClick(event);
}

/** Installs the guard once on the surface's root element (idempotent). */
export function installDblclickGuard(doc = globalThis.document) {
  const root = doc?.documentElement;
  if (!root || root.dataset?.dblclickGuard === '1') return;
  root.addEventListener('dblclick', onGuardedDblclick);
  if (root.dataset) root.dataset.dblclickGuard = '1';
}
