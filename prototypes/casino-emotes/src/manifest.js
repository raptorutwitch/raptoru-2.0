// Machine n°2 — LE MANIFESTE DES ÉMOTES. C'est le seul fichier à modifier pour changer une image.
//
// Chaque symbole logique (id) reçoit un fichier du dossier source (SOURCE_DIR, jamais modifié) : `npm start` en fait une
// copie redimensionnée dans assets/emotes/ (et, pour un GIF, garde l'animation d'origine + une image fixe « poster »).
// Les ids, leur rang et leurs gains sont ceux du moteur (engine.js) : changer une émote ne change JAMAIS une probabilité.
//
// Réglages par symbole :
//   file    : nom du fichier dans SOURCE_DIR (null = visuel provisoire dessiné)
//   native  : animation d'un GIF/WebP animé — 'win' (seulement sur un gain ou une extension), 'always', 'never'
//   idle    : au repos — 'none' | 'bob' (petit rebond) | 'glow' (lueur douce) — À ÉVITER sur les symboles fréquents
//   win     : sur un gain — 'pop' (celle de la machine à fruits) | 'shake' | 'glow'
//   expand  : pendant l'extension — 'sweep' (balayage lumineux) | 'pulse'
//   poster  : ms d'attente avant de prendre l'image fixe d'un GIF (si sa 1re image est vide)
//   scale   : taille dans la case (0,5 – 1,6)
//   shape   : 'circle' = découpé en cercle (comme une photo de profil Twitch)
//   zoom    : resserre l'image dans le cercle (1 = image entière) · focusY : hauteur du centre du cadrage (0 haut – 1 bas)

export const SOURCE_DIR = 'C:/Users/Antoni/Desktop/Mes projets/Emote pour Slots';

export const SYMBOLS = [
  // 4 symboles forts (paient dès 2), du plus fort au moins fort — les 4 émotes animées, dans l'ordre d'Antoni (21/11)
  { id: 'p1', name: 'Grub', rank: 'Fort n°1', file: 'GrubDance.gif', native: 'win', idle: 'none', win: 'pop', expand: 'sweep' },
  { id: 'p2', name: 'Love', rank: 'Fort n°2', file: 'Emote love V2.gif', native: 'win', idle: 'none', win: 'pop', expand: 'sweep' },
  { id: 'p3', name: 'Shy', rank: 'Fort n°3', file: 'Emote Shy.gif', native: 'win', idle: 'none', win: 'pop', expand: 'sweep' },
  { id: 'p4', name: 'Waf', rank: 'Fort n°4', file: 'Waf V3.gif', native: 'win', idle: 'none', win: 'shake', expand: 'sweep' },
  // 5 symboles communs (paient dès 3) : Pied et Hug en tête, puis les trois autres fixes
  { id: 'c1', name: 'Pied', rank: 'Commun n°1', file: 'Beau pied vraiment magnifique.png', native: 'never', idle: 'none', win: 'pop', expand: 'sweep' },
  { id: 'c2', name: 'Hug', rank: 'Commun n°2', file: 'Hug.png', native: 'never', idle: 'none', win: 'pop', expand: 'sweep' },
  { id: 'c3', name: 'Raptor sadge', rank: 'Commun n°3', file: 'Raptor sadge Fixed.png', native: 'never', idle: 'none', win: 'shake', expand: 'sweep' },
  { id: 'c4', name: 'Smile', rank: 'Commun n°4', file: 'SmileThiccer.png', native: 'never', idle: 'none', win: 'pop', expand: 'sweep' },
  { id: 'c5', name: 'Spirit', rank: 'Commun n°5', file: 'SpiritEel.png', native: 'never', idle: 'none', win: 'pop', expand: 'sweep' },
  // Le symbole spécial : WILD + BONUS (le « livre ») — Qilby Avatar 3, en cercle, visage resserré (zoom, focusY).
  { id: 'bonus', name: 'BONUS', rank: 'WILD + BONUS', file: 'Qilby Avatar 3 .png', shape: 'circle', zoom: 1.35, focusY: 0.58, native: 'win', idle: 'none', win: 'glow', expand: 'pulse' },
];

/** Les autres émotes du dossier, non utilisées pour l'instant (pour un échange rapide). */
export const SPARE = ['Waaah.png']; // écartée (21/11) : la 11e image du dossier, la plus pastel, proche de Hug
