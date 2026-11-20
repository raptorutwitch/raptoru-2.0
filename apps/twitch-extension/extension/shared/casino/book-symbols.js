// Casino V1 — the emote machine's symbols (docs/CASINO.md § 13): the validated manifest of prototypes/casino-emotes
// (src/manifest.js + src/symbols.js), unchanged except the paths. Display only: the Core never reads this file, an
// image never changes a probability. Still image at rest; the animated emotes play only on a win or an expansion.

const DIR = 'assets/casino/emotes';
/** id → { name, rank, native (win|never), win (pop|shake|glow), expand, shape?, zoom?, focusY?, still, anim? } */
export const SYMBOLS = [
  { id: 'p1', name: 'Grub', rank: 'Fort n°1', native: 'win', win: 'pop', expand: 'sweep', anim: true },
  { id: 'p2', name: 'Love', rank: 'Fort n°2', native: 'win', win: 'pop', expand: 'sweep', anim: true },
  { id: 'p3', name: 'Shy', rank: 'Fort n°3', native: 'win', win: 'pop', expand: 'sweep', anim: true },
  { id: 'p4', name: 'Waf', rank: 'Fort n°4', native: 'win', win: 'shake', expand: 'sweep', anim: true },
  { id: 'c1', name: 'Pied', rank: 'Commun n°1', native: 'never', win: 'pop', expand: 'sweep' },
  { id: 'c2', name: 'Hug', rank: 'Commun n°2', native: 'never', win: 'pop', expand: 'sweep' },
  { id: 'c3', name: 'Raptor sadge', rank: 'Commun n°3', native: 'never', win: 'shake', expand: 'sweep' },
  { id: 'c4', name: 'Smile', rank: 'Commun n°4', native: 'never', win: 'pop', expand: 'sweep' },
  { id: 'c5', name: 'Spirit', rank: 'Commun n°5', native: 'never', win: 'pop', expand: 'sweep' },
  { id: 'bonus', name: 'BONUS', rank: 'WILD + BONUS', native: 'never', win: 'glow', expand: 'pulse', shape: 'circle', zoom: 1.35, focusY: 0.58 },
].map((s) => ({ ...s, idle: 'none', still: `${DIR}/${s.id}.png`, anim: s.anim ? `${DIR}/${s.id}.gif` : null }));

export const BY_ID = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));

/** A symbol's HTML: the image has its size written (64 × 64), it never shows at its natural size before the CSS. */
export function symbolHTML(sym) {
  const s = BY_ID[sym?.id] ?? BY_ID.c5;
  const anim = s.anim && s.native === 'win' ? ` data-anim="${s.anim}" data-still="${s.still}"` : '';
  return `<span class="sym skin emo" data-skin="${s.id}" data-idle="${s.idle}" data-win="${s.win}" data-expand="${s.expand}"${anim}><img src="${s.still}" alt="${s.name}" width="64" height="64" draggable="false" decoding="async"></span>`;
}

/** An animated emote's own animation: played on a win or an expansion, then its still image again. */
export function playNative(root, on) {
  root.querySelectorAll('.emo[data-anim]').forEach((e) => {
    const img = e.querySelector('img');
    const want = on ? e.dataset.anim : e.dataset.still;
    if (img.getAttribute('src') === want) return;
    img.src = want;
    if (on) {
      img.classList.remove('awake');
      void img.offsetWidth;
      img.classList.add('awake');
    }
  });
}

/** Every image decoded before the machine shows (no symbol appearing late or at the wrong size). */
export function preload() {
  const srcs = SYMBOLS.flatMap((s) => [s.still, s.anim].filter(Boolean));
  return Promise.all(
    srcs.map((src) => {
      const img = new globalThis.Image();
      img.src = src;
      return img.decode().catch(() => {});
    }),
  );
}
