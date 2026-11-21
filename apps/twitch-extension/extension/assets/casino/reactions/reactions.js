// Les réactions de la table de Blackjack (docs/CASINO.md § 18) — le SEUL fichier à modifier pour changer leurs visuels.
//
// Les identifiants (r1 … r6) sont ceux que le Core accepte et transmet : ils ne changent jamais. Chacun est relié ici à
// une image de ce dossier. Pour remplacer une émote provisoire :
//   1. déposer le fichier dans ce dossier (PNG, GIF ou WebP animé ; carré, 112 × 112 px conseillé, moins de 200 Ko) ;
//   2. changer sa ligne `src` (et `label`, le nom lu par les lecteurs d'écran et affiché au survol).
// Rien d'autre : ni la logique, ni la transmission, ni les animations d'apparition (un GIF ou un WebP animé garde sa
// propre animation : l'image est affichée telle quelle, jamais redessinée). `glyph` : le repli si l'image ne charge pas.
export const REACTIONS = [
  { id: 'r1', label: 'GG', src: 'r1.svg', glyph: '👏' },
  { id: 'r2', label: 'Wow', src: 'r2.svg', glyph: '😮' },
  { id: 'r3', label: 'Mdr', src: 'r3.svg', glyph: '😂' },
  { id: 'r4', label: 'Aïe', src: 'r4.svg', glyph: '😬' },
  { id: 'r5', label: 'Cœur', src: 'r5.svg', glyph: '❤️' },
  { id: 'r6', label: 'En feu', src: 'r6.svg', glyph: '🔥' },
];

// La banque réagit de temps en temps (jamais une IA, jamais à chaque manche : bj-reactions.js pickDealerReaction).
// Même principe : une image par situation (`src`, ici les émotes provisoires) et quelques phrases courtes, tirées au sort
// de la même façon chez tous les viewers.
export const DEALER = {
  dealer_bj: { src: 'r4.svg', glyph: '😬', lines: ['Blackjack pour la maison.', 'La maison a le dernier mot… cette fois.'] },
  blackjack: { src: 'r1.svg', glyph: '👏', lines: ['Joli blackjack !', 'Blackjack, bien joué.', 'Ça, c’est une main !'] },
  big_win: { src: 'r6.svg', glyph: '🔥', lines: ['Belle manche !', 'La table est en feu ce soir.'] },
  dealer_bust: { src: 'r2.svg', glyph: '😮', lines: ['Aïe, la banque saute !', 'Trop de cartes pour moi…'] },
  bust: { src: 'r3.svg', glyph: '😂', lines: ['Ça arrive aux meilleurs.', 'Une carte de trop…'] },
};

/** L'adresse d'une image de ce dossier (le paquet de l'extension la sert à côté de ce fichier). */
export const assetUrl = (src) => new URL(src, import.meta.url).href;
