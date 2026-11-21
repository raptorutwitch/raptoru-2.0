// Les réactions de la table de Blackjack (docs/CASINO.md § 18.7) — le SEUL fichier à modifier pour changer leurs visuels
// ou les réactions de la banque.
//
// Les identifiants (r1 … r7) sont ceux que le Core accepte et transmet : ils ne changent jamais. Chacun est relié ici à
// une image (chemin relatif à ce dossier). Pour remplacer une émote :
//   1. déposer le fichier dans ce dossier (PNG, GIF ou WebP animé, transparent ; carré, 112 à 128 px conseillé) ;
//   2. changer sa ligne `src` (et `label`, le nom lu par les lecteurs d'écran et affiché au survol).
// Rien d'autre : ni le protocole, ni le rythme (cooldown), ni la logique, ni les animations d'apparition, ni le Core.
// Une image animée garde sa propre animation et sa transparence : elle est affichée telle quelle (<img>, jamais redessinée).
// `glyph` : le repli si l'image ne charge pas.
//
// Choix d'Antoni du 21/11 (dans cet ordre). Les cinq premières sont les emojis de Discord : Twemoji 17.0.3 (le jeu
// d'emojis qu'affiche Discord), déjà embarqué dans l'extension (assets/twemoji, licence CC-BY 4.0, attribution dans
// assets/twemoji/readme.txt et license-graphics.txt). Les deux dernières sont les émotes d'Antoni.
export const REACTIONS = [
  { id: 'r1', label: 'Sourire', src: '../../twemoji/svg/1f642.svg', glyph: '🙂' },
  { id: 'r2', label: 'Visage attendri', src: '../../twemoji/svg/1f633.svg', glyph: '😳' },
  { id: 'r3', label: 'Colère', src: '../../twemoji/svg/1f621.svg', glyph: '😡' },
  { id: 'r4', label: 'Lunettes de soleil', src: '../../twemoji/svg/1f60e.svg', glyph: '😎' },
  { id: 'r5', label: 'Sourire en coin', src: '../../twemoji/svg/1f609.svg', glyph: '😉' },
  { id: 'r6', label: 'ICANT', src: 'ICANT.png', glyph: '😂' },
  { id: 'r7', label: 'ptn', src: 'ptn.gif', glyph: '😱' },
];

// La banque réagit de temps en temps (bj-reactions.js pickDealerReaction) d'une émote seule, sans texte : au plus une
// fois par manche, la même chez tous les viewers, jamais une IA. Pour chaque situation : l'émote (`r`, un identifiant
// ci-dessus) et sa probabilité (`chance`, 0 = jamais). Tout se modifie ici.
export const DEALER = {
  // La banque a blackjack : elle savoure.
  dealer_bj: { r: 'r5', chance: 0.6 },
  // Un joueur fait blackjack : on célèbre.
  blackjack: { r: 'r7', chance: 0.6 },
  // Un gros gain (au moins 10 fois la mise minimum) : la banque est attendrie.
  big_win: { r: 'r2', chance: 0.5 },
  // La banque saute.
  dealer_bust: { r: 'r3', chance: 0.35 },
  // Un joueur dépasse 21 : réaction amusée.
  bust: { r: 'r6', chance: 0.2 },
  // La banque gagne contre tout le monde.
  dealer_win: { r: 'r4', chance: 0.2 },
};

/** L'adresse d'une image (chemin relatif à ce dossier ; le paquet de l'extension la sert à côté). */
export const assetUrl = (src) => new URL(src, import.meta.url).href;
