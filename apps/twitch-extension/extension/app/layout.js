// The ONE measurement of the extension (plan § 1.1-3, § 3): a ResizeObserver on the page root sets, on <html>:
//   data-surface  video | panel | popout | mobile        (from the page and Twitch's parameters, never from the size)
//   data-profile  normal | compact | large | etroit       (from the CSS size really available, ±8 px hysteresis)
//   data-touch    present on the mobile surface or a coarse pointer
//   --kg          geometry scale  clamp(0.85, min(W/651, H/434), 1.15)   (spacing, radii, cards, icons)
//   --kt          text scale      clamp(0.95, min(W/651, H/434), 1.10)   (texts, above their per-role floors)
//   --vw, --vh    the measured root size in px
// CSS defaults (app/css/tokens.css) give the normal profile with --kg = --kt = 1 if this script never runs.
// No module measures the window: they read these attributes and variables (or a local @container query).

export const REF_W = 651;
export const REF_H = 434;
const HYST = 8;
const clamp = (min, v, max) => Math.min(max, Math.max(min, v));
const round = (v) => Math.round(v * 1000) / 1000;

/** Surface of this page: decided by the page and Twitch's query parameters only. */
export function detectSurface(location = window.location) {
  const q = new URLSearchParams(location.search);
  if (/(?:^|\/)video_component\.html$/i.test(location.pathname) || q.get('anchor') === 'component') return 'video';
  if (q.get('platform') === 'mobile' || /(?:^|\/)mobile\.html$/i.test(location.pathname)) return 'mobile';
  if (q.get('popout') === 'true') return 'popout';
  return 'panel';
}

function profileOf(w, h) {
  if (h >= w || w < 360) return 'etroit';
  const r = Math.min(w / REF_W, h / REF_H);
  return r < 0.85 ? 'compact' : r > 1.15 ? 'large' : 'normal';
}

/**
 * Pure layout decision (tested). `prev` = the previous profile: it is kept while the size is within HYST px of
 * the boundary that would change it (no flicker while a window is being resized).
 */
export function computeLayout({ w, h, prev = null }) {
  let profile = profileOf(w, h);
  if (prev && profile !== prev) {
    const near = [[HYST, 0], [-HYST, 0], [0, HYST], [0, -HYST]].some(([dw, dh]) => profileOf(w + dw, h + dh) === prev);
    if (near) profile = prev;
  }
  const r = Math.min(w / REF_W, h / REF_H);
  const kg = profile === 'etroit' ? 1 : round(clamp(0.85, r, 1.15));
  const kt = profile === 'etroit' ? 1 : round(clamp(0.95, r, 1.1));
  return { profile, kg, kt };
}

let started = null;

/** Starts the measurement once; returns { surface, current(), subscribe(fn) → off }. */
export function startLayout(root = document.documentElement) {
  if (started) return started;
  const surface = detectSurface();
  const touch = surface === 'mobile' || globalThis.matchMedia?.('(pointer: coarse)').matches === true;
  root.dataset.surface = surface;
  if (touch) root.dataset.touch = '';
  let current = null;
  const listeners = new Set();
  const apply = () => {
    const w = Math.round(root.clientWidth);
    const h = Math.round(root.clientHeight || window.innerHeight);
    if (!w || !h) return;
    const next = computeLayout({ w, h, prev: current?.profile });
    if (current && next.profile === current.profile && next.kg === current.kg && next.kt === current.kt) return;
    current = { ...next, w, h, surface, touch };
    root.dataset.profile = next.profile;
    root.style.setProperty('--kg', String(next.kg));
    root.style.setProperty('--kt', String(next.kt));
    root.style.setProperty('--vw', `${w}px`);
    root.style.setProperty('--vh', `${h}px`);
    for (const fn of listeners) fn(current);
  };
  apply();
  // Observing the root (not a child) cannot loop: our own style changes do not resize the viewport.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
  if (ro) ro.observe(root);
  else window.addEventListener('resize', apply);
  started = {
    surface,
    current: () => current,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return started;
}
