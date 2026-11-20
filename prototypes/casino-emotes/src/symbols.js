// Machine n°2 — l'apparence des symboles : l'émote du manifeste (image fixe au repos, animation native selon le
// réglage), ou un visuel PROVISOIRE dessiné quand le fichier manque. Purement graphique : le moteur ne lit jamais ceci.
import { PREPARED } from '../assets/emotes/prepared.js';
import { SYMBOLS } from './manifest.js';

export const BY_ID = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));

/** Le BONUS provisoire : une pièce or et violette, « BONUS » + « WILD », bien distincte des émotes. */
const BONUS_MARK = `<svg class="sym bonusmark" viewBox="0 0 64 64" aria-hidden="true">
  <defs><radialGradient id="bmG" cx="40%" cy="32%" r="75%"><stop offset="0" stop-color="#fff3bd"/><stop offset=".55" stop-color="#ffb400"/><stop offset="1" stop-color="#8f4f00"/></radialGradient>
  <linearGradient id="bmV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9b5cff"/><stop offset="1" stop-color="#3b0f7a"/></linearGradient></defs>
  <circle cx="32" cy="32" r="30" fill="url(#bmV)" stroke="#e7c6ff" stroke-width="2"/>
  <circle cx="32" cy="32" r="24" fill="url(#bmG)" stroke="#7a3f00" stroke-width="1.2"/>
  <path d="M32 11.5l3 6.1 6.7.9-4.9 4.6 1.2 6.6L32 26.5l-6 3.2 1.2-6.6-4.9-4.6 6.7-.9z" fill="#fff8d8"/>
  <text x="32" y="43" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="11" fill="#4a1f00">BONUS</text>
  <rect x="17" y="47" width="30" height="9" rx="4.5" fill="#3b0f7a" stroke="#e7c6ff" stroke-width="1"/>
  <text x="32" y="54.2" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="7" fill="#fff" letter-spacing=".6">WILD</text>
</svg>`;
/** Un symbole payant sans fichier : un disque gris nommé, marqué « provisoire ». */
const placeholder = (s) =>
  `<svg class="sym placeholder" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#3a2d55" stroke="#8f7cb8" stroke-dasharray="4 3"/><text x="32" y="36" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="12" fill="#e9e0ff">${s.id.toUpperCase()}</text><text x="32" y="48" text-anchor="middle" font-family="Arial" font-size="6.5" fill="#bfb0dd">provisoire</text></svg>`;

const assetOf = (id) => PREPARED[id] ?? { missing: true };
export const isProvisional = (id) => !!assetOf(id).missing;

/**
 * Le HTML d'un symbole. L'image a ses dimensions écrites (64 × 64) : même avant que la feuille de style ne s'applique,
 * elle ne peut jamais apparaître à sa taille d'origine (1980 px).
 */
export function symbolHTML(sym) {
  const s = BY_ID[sym?.id] ?? BY_ID.c5;
  const a = assetOf(s.id);
  if (a.missing) return s.id === 'bonus' ? BONUS_MARK : placeholder(s);
  const src = s.native === 'always' && a.anim ? a.anim : a.still;
  const anim = a.anim && s.native === 'win' ? ` data-anim="${a.anim}" data-still="${a.still}"` : '';
  return `<span class="sym skin emo" data-skin="${s.id}" data-idle="${s.idle}" data-win="${s.win}" data-expand="${s.expand}"${anim} ${s.scale ? ` style="--scale:${s.scale}"` : ""}><img src="${src}" alt="${s.name}" width="64" height="64" draggable="false" decoding="async"></span>`;
}

/** L'animation native d'un symbole animé (réglage 'win') : jouée sur un gain ou une extension, puis l'image fixe. */
export function playNative(root, on) {
  root.querySelectorAll('.emo[data-anim]').forEach((e) => {
    const img = e.querySelector('img');
    const want = on ? e.dataset.anim : e.dataset.still;
    if (img.src.endsWith(want)) return;
    img.src = want;
    if (on) {
      // un fondu discret de l'image fixe vers l'animation
      img.classList.remove('awake');
      void img.offsetWidth;
      img.classList.add('awake');
    }
  });
}

/** Toutes les images, décodées avant d'afficher la machine (aucun symbole qui apparaît en retard ou au mauvais format). */
export function preload() {
  const srcs = Object.values(PREPARED).flatMap((a) => (a.missing ? [] : [a.still, a.anim].filter(Boolean)));
  return Promise.all(
    srcs.map((src) => {
      const img = new Image();
      img.src = src;
      return img.decode().catch(() => {});
    }),
  );
}
