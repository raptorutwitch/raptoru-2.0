// TTS V2 — calibrated character previews (extension UI only; the OBS player is not concerned).
// Port of the validated D3 prototype `prototypes/tts-v2-extension-ux/shared/calibration.js`.
// Values: CHARACTERS[].calibration in tts-characters.js (single source). In the Lab only, a local
// setting saved by the calibration tool (same origin, same key / version) is previewed on top.
import { CHARACTERS, CHARACTERS_BY_ID, assetUrl, layout as baseLayout } from './tts-characters.js';

export const CALIBRATION_KEY = 'tts-v2-preview-calibration';
const VERSION = 2;
const KINDS = ['portrait', 'card'];
const NEUTRAL = { x: 0, y: 0, scale: 1, rotation: 0 };
const LIMITS = { x: [-0.5, 0.5], y: [-0.5, 0.5], scale: [0.3, 3], rotation: [-30, 30] };
const clamp = (k, v) => Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], Number(v)));

const defaults = () => Object.fromEntries(CHARACTERS.map((c) => [c.id, {
  portrait: { ...NEUTRAL, ...c.calibration.portrait },
  card: { ...NEUTRAL, ...c.calibration.card },
}]));

function sanitize(raw) {
  const out = defaults();
  if (!raw || typeof raw !== 'object') return out;
  for (const id of Object.keys(out)) {
    for (const kind of KINDS) {
      const src = raw[id] && raw[id][kind];
      if (!src) continue;
      for (const k of Object.keys(NEUTRAL)) if (Number.isFinite(Number(src[k]))) out[id][kind][k] = clamp(k, src[k]);
    }
  }
  return out;
}

/**
 * @param {{ document: Document, assetBase: string, allowLocalOverride?: boolean }} options
 * allowLocalOverride: Lab only — follow the calibration tool's local setting (never in production).
 */
export function createCalibration({ document, assetBase, allowLocalOverride = false }) {
  const win = document.defaultView;
  const listeners = new Set();
  const load = () => {
    if (!allowLocalOverride) return defaults();
    try {
      const raw = JSON.parse(win.localStorage.getItem(CALIBRATION_KEY) || 'null');
      return raw && raw.v === VERSION ? sanitize(raw.values) : defaults();
    } catch {
      return defaults();
    }
  };
  let current = load();
  const onStorage = (e) => {
    if (e.key !== CALIBRATION_KEY) return;
    current = load();
    listeners.forEach((fn) => fn(current));
  };
  if (allowLocalOverride) win.addEventListener('storage', onStorage);

  const layout = (id, kind, W, H) => baseLayout(CHARACTERS_BY_ID[id], kind, W, H, current[id][kind]);

  // One full-frame master image per character: the shuffle draws without waiting for any media.
  const MASTER = {};
  let settled = false;
  const loaded = Promise.all(CHARACTERS.map((c) => new Promise((resolve) => {
    const file = c.assets.idle;
    const isVideo = /\.webm$/i.test(file);
    const m = document.createElement(isVideo ? 'video' : 'img');
    const grab = () => {
      const k = Math.min(1, 1280 / c.frame.width);
      const cv = document.createElement('canvas');
      cv.width = Math.round(c.frame.width * k);
      cv.height = Math.round(c.frame.height * k);
      cv.getContext('2d').drawImage(m, 0, 0, cv.width, cv.height);
      MASTER[c.id] = cv;
      if (settled) listeners.forEach((fn) => fn(current)); // arrived after the fallback delay
      resolve();
    };
    if (isVideo) {
      Object.assign(m, { muted: true, preload: 'auto' });
      m.addEventListener('loadeddata', () => { m.currentTime = c.preview.timeS; }, { once: true });
      m.addEventListener('seeked', grab, { once: true });
    } else m.addEventListener('load', grab, { once: true });
    m.addEventListener('error', resolve, { once: true });
    m.src = assetUrl(assetBase, file);
  })));
  // Fallback: a slow media never blocks the display (2.5 s max).
  const ready = Promise.race([loaded, new Promise((r) => win.setTimeout(r, 2500))]).then(() => { settled = true; });

  /** Draws the calibrated character in a canvas (created if absent) of CSS size W×H. */
  function drawSprite(id, kind, W, H, canvas) {
    const cv = canvas || document.createElement('canvas');
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
    Object.assign(cv.style, { width: `${W}px`, height: `${H}px` });
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const src = MASTER[id];
    if (!src) return cv;
    const L = layout(id, kind, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(L.left + L.ox, L.top + L.oy);
    ctx.rotate((L.rot * Math.PI) / 180);
    ctx.drawImage(src, -L.ox, -L.oy, L.w, L.h);
    return cv;
  }

  /** Calibrated live DOM preview (master image underneath until the first video frame). */
  function mountPreview(el, id, kind, { animated = false } = {}) {
    const p = CHARACTERS_BY_ID[id];
    el.classList.add('pv');
    el.style.setProperty('--c', p.accent);
    el.replaceChildren();
    const W = el.clientWidth, H = el.clientHeight;
    const L = layout(id, kind, W, H);
    const ph = drawSprite(id, kind, W, H);
    Object.assign(ph.style, { position: 'absolute', left: '0', top: '0' });
    el.append(ph);
    const file = p.assets.idle;
    const isVideo = /\.webm$/i.test(file);
    const m = document.createElement(isVideo ? 'video' : 'img');
    if (isVideo) Object.assign(m, { muted: true, playsInline: true, loop: true, autoplay: animated, preload: 'auto' });
    else m.alt = '';
    Object.assign(m.style, {
      width: `${L.w}px`, height: `${L.h}px`, left: `${L.left}px`, top: `${L.top}px`,
      transformOrigin: `${L.ox}px ${L.oy}px`, transform: L.rot ? `rotate(${L.rot}deg)` : '',
    });
    const drop = () => win.requestAnimationFrame(() => ph.remove());
    if (isVideo) {
      m.addEventListener('loadeddata', () => { if (!animated) { m.pause(); m.currentTime = p.preview.timeS; } drop(); }, { once: true });
    } else m.addEventListener('load', drop, { once: true });
    m.src = assetUrl(assetBase, file);
    el.append(m);
    return m;
  }

  return {
    ready,
    drawSprite,
    mountPreview,
    get: (id) => current[id],
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    destroy: () => { listeners.clear(); if (allowLocalOverride) win.removeEventListener('storage', onStorage); },
  };
}
