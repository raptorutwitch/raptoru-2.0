// Ported unchanged from the validated casino prototype (prototypes/casino-v8 · symbols.js); docs/CASINO.md.
// Display only: every result comes from the Core.
// Symboles PROVISOIRES, dessinés en SVG (aucun fichier externe). Pour mettre tes propres visuels : ajoute
// son chemin dans assets/manifest.js (symbols) — symbolHTML() l'utilisera à la place du dessin.
import { byId } from './frame.js';
import { onSkinError, skinHTML } from './skin.js';

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">
<defs>
  <radialGradient id="gRed" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ff8a8a"/><stop offset=".45" stop-color="#ef2b45"/><stop offset="1" stop-color="#8e0820"/></radialGradient>
  <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4b0"/><stop offset=".45" stop-color="#ffc629"/><stop offset="1" stop-color="#b06d00"/></linearGradient>
  <radialGradient id="gLemon" cx="38%" cy="32%" r="80%"><stop offset="0" stop-color="#fffbc4"/><stop offset=".5" stop-color="#ffe03a"/><stop offset="1" stop-color="#c99a00"/></radialGradient>
  <radialGradient id="gGrape" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#e2c6ff"/><stop offset=".5" stop-color="#9147ff"/><stop offset="1" stop-color="#3f0f8f"/></radialGradient>
  <linearGradient id="gLeaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9df27e"/><stop offset="1" stop-color="#239146"/></linearGradient>
  <linearGradient id="gCyan" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3fdff"/><stop offset=".4" stop-color="#46dcff"/><stop offset="1" stop-color="#0b5fa8"/></linearGradient>
  <linearGradient id="gPink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe0fb"/><stop offset=".5" stop-color="#ff4fd8"/><stop offset="1" stop-color="#8a0068"/></linearGradient>
  <linearGradient id="gBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3160"/><stop offset="1" stop-color="#120d24"/></linearGradient>
  <linearGradient id="gWild" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b86"/><stop offset=".5" stop-color="#ff2f55"/><stop offset="1" stop-color="#8a0f30"/></linearGradient>
  <radialGradient id="gCoin" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#fff3bd"/><stop offset=".55" stop-color="#ffb400"/><stop offset="1" stop-color="#8f4f00"/></radialGradient>
</defs>
<symbol id="s-cerise" viewBox="0 0 64 64">
  <path d="M33 9C31 21 25 29 21 36M33 9c3 12 8 21 12 29" stroke="#2f7d35" stroke-width="3.2" fill="none" stroke-linecap="round"/>
  <path d="M33 9c7-5 17-4 22 2-8 5-16 4-22-2z" fill="url(#gLeaf)"/>
  <circle cx="21" cy="44" r="12.5" fill="url(#gRed)"/><circle cx="45" cy="46" r="12.5" fill="url(#gRed)"/>
  <ellipse cx="16.5" cy="39.5" rx="3.6" ry="2.4" fill="#fff" opacity=".75"/><ellipse cx="40.5" cy="41.5" rx="3.6" ry="2.4" fill="#fff" opacity=".75"/>
</symbol>
<symbol id="s-citron" viewBox="0 0 64 64">
  <g transform="rotate(-18 32 34)"><ellipse cx="32" cy="34" rx="23" ry="17" fill="url(#gLemon)"/>
  <ellipse cx="8.5" cy="34" rx="3.5" ry="3" fill="#e7b800"/><ellipse cx="55.5" cy="34" rx="3.5" ry="3" fill="#e7b800"/>
  <ellipse cx="25" cy="27" rx="8" ry="3.4" fill="#fff" opacity=".6"/></g>
  <path d="M38 14c4-6 11-7 15-4-4 5-10 6-15 4z" fill="url(#gLeaf)"/>
</symbol>
<symbol id="s-raisin" viewBox="0 0 64 64">
  <path d="M33 7v9" stroke="#6b4a1e" stroke-width="3" stroke-linecap="round"/><path d="M33 12c6-7 15-7 19-2-6 5-13 6-19 2z" fill="url(#gLeaf)"/>
  <g fill="url(#gGrape)"><circle cx="21" cy="24" r="8"/><circle cx="33" cy="23" r="8"/><circle cx="45" cy="24" r="8"/>
  <circle cx="27" cy="36" r="8"/><circle cx="39" cy="36" r="8"/><circle cx="33" cy="48" r="8"/></g>
  <g fill="#fff" opacity=".55"><circle cx="18" cy="21" r="2"/><circle cx="30" cy="20" r="2"/><circle cx="42" cy="21" r="2"/><circle cx="24" cy="33" r="2"/><circle cx="36" cy="33" r="2"/><circle cx="30" cy="45" r="2"/></g>
</symbol>
<symbol id="s-cloche" viewBox="0 0 64 64">
  <circle cx="32" cy="8.5" r="3.5" fill="url(#gGold)"/>
  <path d="M32 11c-11 0-16 12-16 23l-4 9h40l-4-9c0-11-5-23-16-23z" fill="url(#gGold)" stroke="#8a5300" stroke-width="1.5"/>
  <rect x="10" y="43" width="44" height="6" rx="3" fill="#d18f00" stroke="#8a5300" stroke-width="1.2"/>
  <circle cx="32" cy="54" r="5" fill="url(#gGold)" stroke="#8a5300" stroke-width="1.2"/>
  <path d="M24 20c-3 4-4 10-4 15" stroke="#fffbe0" stroke-width="3" stroke-linecap="round" opacity=".75" fill="none"/>
</symbol>
<symbol id="s-wild" viewBox="0 0 64 64">
  <path d="M32 4l22 8v18c0 14-9.5 24-22 30C19.5 54 10 44 10 30V12z" fill="url(#gWild)" stroke="url(#gGold)" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="M32 9.5l17 6.2v14.5c0 11-7.3 19-17 24-9.7-5-17-13-17-24V15.7z" fill="none" stroke="#ffd0da" stroke-width="1" opacity=".55"/>
  <text x="32" y="38" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="13.5" fill="#fff" letter-spacing=".4">WILD</text>
  <path d="M32 12.5l1.8 3.7 4 .6-2.9 2.8.7 4L32 21.7l-3.6 1.9.7-4-2.9-2.8 4-.6z" fill="#ffe7a8"/>
  <path d="M20 44c3.5 3 7.5 5.3 12 7" stroke="#ffd0da" stroke-width="1.6" stroke-linecap="round" opacity=".6" fill="none"/>
</symbol>
<symbol id="s-bar" viewBox="0 0 64 64">
  <rect x="5" y="17" width="54" height="30" rx="7" fill="url(#gBar)" stroke="url(#gGold)" stroke-width="3.2"/>
  <text x="32" y="40" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="19" fill="url(#gGold)" letter-spacing="1">BAR</text>
</symbol>
<symbol id="s-diamant" viewBox="0 0 64 64">
  <path d="M14 23l9-12h18l9 12-18 31z" fill="url(#gCyan)" stroke="#d9fbff" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M14 23h36M23 11l4 12 5 31M41 11l-4 12-5 31M27 23l5-12 5 12" stroke="#e8feff" stroke-width="1.3" fill="none" opacity=".8"/>
  <path d="M18 23l5-7" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>
</symbol>
<symbol id="s-sept" viewBox="0 0 64 64">
  <text x="33" y="55" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="58" fill="url(#gRed)" stroke="url(#gGold)" stroke-width="3.2" paint-order="stroke" font-style="italic">7</text>
  <path d="M50 10l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="#fff6c9"/>
</symbol>
<symbol id="s-bonus" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="29" fill="#2a0b4a" stroke="#c46bff" stroke-width="2.4"/>
  <circle cx="32" cy="32" r="24.5" fill="url(#gCoin)" stroke="#7a3f00" stroke-width="1.2"/>
  <circle cx="32" cy="32" r="19.5" fill="none" stroke="#fff3c4" stroke-width="1.3" opacity=".8"/>
  <path d="M32 14l2.4 5 5.4.6-4 3.7 1.1 5.4L32 26l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" fill="#fff8d8"/>
  <text x="32" y="42.5" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="10.5" fill="#5a2a00" letter-spacing=".4">BONUS</text>
</symbol>
</svg>`;

function install(root) {
  if (byId('arcade-sprite') || !root) return;
  const holder = root.ownerDocument.createElement('div');
  holder.id = 'arcade-sprite';
  holder.innerHTML = SPRITE;
  root.prepend(holder);
}

/** The drawing of a symbol (inline SVG, the validated default). */
const drawing = (id) => `<svg class="sym" viewBox="0 0 64 64" aria-hidden="true"><use href="#s-${/^[a-z]+$/.test(id) ? id : 'cerise'}"/></svg>`;

/** A symbol's look: its skin image (skin.js) if any, else the drawing. */
function symbolHTML(sym) {
  return (sym && skinHTML(sym.id, sym.name)) || drawing(sym ? sym.id : 'cerise');
}
/** A skin image that failed to load goes back to the drawing (listened on the casino's shadow root). */
const repair = (e) => onSkinError(e, drawing);

export const ArcadeSymbols = { install, symbolHTML, repair };
