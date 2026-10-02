// Tombola V2 overlay — icons, formats and the picture (PP) of the validated prototype kit
// (prototypes/tombola-v2/shared/kit.js), without its demo data or simulated rules.

const P = {
  ticket:
    '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2.5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  gift: '<rect x="3" y="8" width="18" height="13" rx="1.5"/><path d="M3 12h18M12 8v13M12 8c-2-4-6-4-6-1.5S10 8 12 8c2 0 6 1 6-1.5S14 4 12 8"/>',
  users:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
};
export const ic = (n, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
export const fmt = (n) =>
  Number(n)
    .toLocaleString('fr-FR')
    .replaceAll(String.fromCharCode(0x202f), ' ');
export const hueOf = (n) =>
  [...String(n)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 9);

/** Fonts offered for the custom overlay message (Windows fonts available to OBS). */
export const HINT_FONTS = {
  segoe: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  bahnschrift: "'Bahnschrift', 'Segoe UI', sans-serif",
  trebuchet: "'Trebuchet MS', 'Segoe UI', sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
};
const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
/** Custom message (display only) with its style from Core: font, colour, bold, italic, highlight. */
export function hintMessage(text, style = {}) {
  const css = [
    `font-family:${HINT_FONTS[style.font] ?? HINT_FONTS.segoe}`,
    HEX.test(style.color ?? '') ? `color:${style.color}` : '',
    style.bold ? 'font-weight:800' : '',
    style.italic ? 'font-style:italic' : '',
  ]
    .filter(Boolean)
    .join(';');
  const body = HEX.test(style.highlight ?? '')
    ? `<span class="hl" style="background:${style.highlight}">${esc(text)}</span>`
    : esc(text);
  return `<span class="hint" style="${css}">${body}</span>`;
}

/** Twitch picture only from Twitch's CDN (Core's cache); the initials stay underneath. */
const img = (url) =>
  typeof url === 'string' && url.startsWith('https://static-cdn.jtvnw.net/')
    ? `<img src="${esc(url)}" alt="" data-pp>`
    : '';
/**
 * PP: initials on a stable hue, source ring (Chat turquoise / Extension pink), real picture on top.
 * `p` = { viewer_id, display_name, source, avatar_url }.
 */
export const avatar = (p, cls = '') =>
  `<span class="pp ${p.source === 'extension' ? 'ext' : ''} ${cls}" style="--h:${hueOf(p.display_name)}" data-id="${esc(p.viewer_id)}"><i>${esc(
    String(p.display_name)
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 2)
      .toUpperCase(),
  )}</i>${img(p.avatar_url)}</span>`;
