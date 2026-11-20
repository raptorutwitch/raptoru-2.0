// Casino — the look of the slot's symbols and the games' sounds (docs/CASINO.md § 7). PURELY GRAPHIC: the logical ids
// (cerise, citron, raisin, cloche, bar, diamant, sept, wild, bonus) are the Core's; the probabilities, the pays and the
// draws never read this file. null = the validated drawings (inline SVG). To use your Twitch emotes or illustrations,
// fill a symbol:
//   cerise: { src: 'https://static-cdn.jtvnw.net/emoticons/v2/<emote id>/default/dark/3.0', alt: 'Cerise',
//             fit: 'contain' | 'cover', scale: 1, y: 0, idle: 'none' | 'bob' | 'pulse' | 'spin', win: 'pop' | 'shake' | 'glow' }
// Formats: PNG, WebP (animated too), GIF, APNG, SVG; square, transparent background, 112 px or more (shown 30–90 px).
// Hosts: the extension's own files (assets/casino/…) or the Twitch emote CDN (static-cdn.jtvnw.net, already allowed);
// another host must be added to the extension's image allowlist in the Twitch console first.
// A missing or broken image falls back to the drawing by itself (never an empty cell).

export const SKIN = {
  symbols: {
    cerise: null,
    citron: null,
    raisin: null,
    cloche: null,
    bar: null,
    diamant: null,
    sept: null,
    wild: null,
    bonus: null,
  },
  /** A sound file instead of the synthesized one (OGG / MP3, short, normalized): reelStop, win, bigWin, wild, bonus… */
  sounds: {},
};

const failed = new Set();
const ID = /^[a-z]+$/;
const SAFE_SRC = /^(https:\/\/static-cdn\.jtvnw\.net\/|assets\/casino\/)[A-Za-z0-9/._-]+$/;
const ENUM = { fit: ['contain', 'cover'], idle: ['none', 'bob', 'pulse', 'spin'], win: ['pop', 'shake', 'glow'] };
const pick = (v, list, d) => (list.includes(v) ? v : d);
const num = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** The image of a symbol (with its framing and its animations), or null: the drawing. */
export function skinHTML(id, name) {
  const s = ID.test(id) ? SKIN.symbols[id] : null;
  if (!s || !s.src || failed.has(id) || !SAFE_SRC.test(s.src)) return null;
  const alt = String(s.alt ?? name ?? id).replace(/[&<>"']/g, '');
  return `<span class="sym skin" data-skin="${id}" data-idle="${pick(s.idle, ENUM.idle, 'none')}" data-win="${pick(s.win, ENUM.win, 'pop')}" style="--fit:${pick(s.fit, ENUM.fit, 'contain')};--scale:${num(s.scale, 1, 0.5, 1.6)};--y:${num(s.y, 0, -0.3, 0.3)}"><img src="${s.src}" alt="${alt}" draggable="false" decoding="async"></span>`;
}

/**
 * A skin image that cannot load: the symbol goes back to its drawing (this session), right away in the cells already
 * painted. Listened once on the casino's shadow root (an `onerror` attribute is refused by the extension's CSP).
 */
export function onSkinError(e, drawing) {
  const img = e.target;
  const box = img?.closest?.('[data-skin]');
  if (!box) return;
  const id = box.dataset.skin;
  failed.add(id);
  box.outerHTML = drawing(id);
}
