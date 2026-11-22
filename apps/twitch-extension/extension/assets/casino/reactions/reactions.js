// Les réactions de la table de Blackjack (docs/CASINO.md § 18.7) — le SEUL fichier à modifier pour changer leurs visuels
// ou les réactions de la banque.
//
// Les identifiants (r1 … r13, s1 … s9) sont ceux que le Core accepte et transmet : ils ne changent jamais. Chacun est relié ici à
// une image (chemin relatif à ce dossier). Pour remplacer une émote :
//   1. déposer le fichier dans ce dossier (PNG, GIF ou WebP animé, transparent ; carré, 112 à 128 px conseillé) ;
//   2. changer sa ligne `src` (et `label`, le nom lu par les lecteurs d'écran et affiché au survol).
// Rien d'autre : ni le protocole, ni le rythme (cooldown), ni la logique, ni les animations d'apparition, ni le Core.
// Une image animée garde sa propre animation et sa transparence : elle est affichée telle quelle (<img>, jamais redessinée).
// `glyph` : le repli si l'image ne charge pas.
//
// Choix d'Antoni du 22/11 : 10 classiques, dans cet ordre. Les neuf premières sont les emojis de Discord : Twemoji
// 17.0.3 (le jeu d'emojis qu'affiche Discord), déjà embarqué dans l'extension (assets/twemoji, licence CC-BY 4.0,
// attribution dans assets/twemoji/readme.txt et license-graphics.txt). La dixième, ptn, l'émote animée d'Antoni, est
// aussi sur la page des abonnés. Les identifiants suivent l'historique (r1 … r13) : jamais réutilisés pour une autre image.
const T = (code) => `../../twemoji/svg/${code}.svg`;
export const REACTIONS = [
  { id: 'r1', label: 'Sourire', src: T('1f642'), glyph: '🙂' },
  { id: 'r8', label: 'Sourire avec sueur', src: T('1f605'), glyph: '😅' },
  { id: 'r9', label: 'Pleurs', src: T('1f62d'), glyph: '😭' },
  { id: 'r2', label: 'Visage rougissant', src: T('1f633'), glyph: '😳' },
  { id: 'r10', label: 'Salut', src: T('1fae1'), glyph: '🫡' },
  { id: 'r3', label: 'Colère', src: T('1f621'), glyph: '😡' },
  { id: 'r11', label: 'Câlin', src: T('1f917'), glyph: '🤗' },
  { id: 'r12', label: 'Surprise', src: T('1f62e'), glyph: '😮' },
  { id: 'r13', label: 'Crâne', src: T('1f480'), glyph: '💀' },
  { id: 'r7', label: 'ptn', src: 'ptn.gif', glyph: '😱' },
  // Les abonnés de la chaîne seulement (le Core vérifie l'abonnement à chaque envoi) : les émotes d'Antoni du 22/11
  // (subs/, réduites en 128 × 128 depuis ses fichiers d'origine).
  { id: 's1', label: 'Aigri', src: 'subs/aigri.png', glyph: '★' },
  { id: 's2', label: 'Cheh', src: 'subs/cheh.png', glyph: '★' },
  { id: 's3', label: 'VNR', src: 'subs/vnr.png', glyph: '★' },
  { id: 's4', label: 'Flex Megumin', src: 'subs/flex-megumin.png', glyph: '★' },
  { id: 's5', label: 'GasmRem', src: 'subs/gasm-rem.png', glyph: '★' },
  { id: 's6', label: 'Happy', src: 'subs/happy.png', glyph: '★' },
  { id: 's7', label: 'Raptor Sadge', src: 'subs/raptor-sadge.png', glyph: '★' },
  { id: 's8', label: 'SpiritEel', src: 'subs/spirit-eel.png', glyph: '★' },
  { id: 's9', label: 'Grumpy', src: 'subs/grumpy.png', glyph: '★' },
  // Le premier choix du 21/11 : plus proposées, toujours affichées (un écran pas encore à jour ; la banque, ci-dessous).
  { id: 'r4', label: 'Lunettes de soleil', src: T('1f60e'), glyph: '😎' },
  { id: 'r5', label: 'Sourire en coin', src: T('1f609'), glyph: '😉' },
  { id: 'r6', label: 'ICANT', src: 'ICANT.png', glyph: '😂' },
];

// La bulle de choix, dans cet ordre : la page 1 (les classiques, pour tous) et la page 2 (les abonnés de la chaîne ;
// le Core ne l'annonce qu'à un abonné et le revérifie à chaque envoi). ptn est sur les deux. Une réaction absente des
// deux pages n'est plus proposée mais toujours affichée quand elle arrive (un écran pas encore à jour, la banque).
export const PAGES = [
  ['r1', 'r8', 'r9', 'r2', 'r10', 'r3', 'r11', 'r12', 'r13', 'r7'],
  ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 'r7'],
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
