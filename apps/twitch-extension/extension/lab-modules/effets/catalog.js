// LAB ONLY — catalogue viewer de Chaos V2 pour la maquette « Effets live » (docs/chaos/EXTENSION_EFFETS_LIVE.md).
// Recopié du registre réel du moteur (packages/schemas/src/chaos-registry.json, branche feat/chaos-studio, 26/11) :
// identifiants, emplacement (slot), durées et paliers proposés aux viewers (bloc `viewer`), effet photosensible.
// Ce qui est INVENTÉ ici, en attendant le Core (lot 2) : les phrases courtes, les groupes d'affichage, les PRIX.
// Le Core enverra tout cela ; la vue ne calculera rien (SOCLE.md § 4.2 « Interdits »).

/** Libellés des paliers du registre (niveaux d'intensité ou styles). */
export const TIER_LABELS = Object.freeze({
  leger: 'Léger',
  marque: 'Marqué',
  dense: 'Dense',
  extreme: 'Extrême',
  horizontal: 'Gauche-droite',
  vertical: 'Haut-bas',
  alterne: 'Alterné',
  naturel: 'Naturel',
  fatigue: 'Fatigué',
  ferme: 'Yeux fermés',
  court: 'Court',
  intense: 'Intense',
  longue: 'Rémanence',
  nb: 'Noir et blanc',
  sepia: 'Sépia',
  inversion: 'Inversé',
  legere: 'Légère',
  abimee: 'Abîmée',
  glitch_violent: 'Glitch violent',
});

/** Groupes d'affichage (filtres) : trois mots qu'un viewer comprend, au lieu des six familles techniques. */
export const GROUPS = Object.freeze([
  { id: 'mouvement', label: 'Mouvement' },
  { id: 'vision', label: 'Vision' },
  { id: 'image', label: 'Image' },
]);

/** Emplacements du moteur : combien d'effets de ce genre tournent ensemble (au-delà : file d'attente). */
export const SLOTS = Object.freeze({
  transform: { capacity: 1, rule: 'Un seul à la fois (retournements)' },
  camera: { capacity: 2, rule: 'Deux mouvements de caméra ensemble au plus' },
  filter: { capacity: 3, rule: 'Jusqu’à trois filtres ensemble' },
  overlay: { capacity: 4, rule: 'Se superpose au reste (jusqu’à quatre)' },
});

const D = [5, 10, 20, 30];
const LV = ['leger', 'marque', 'extreme'];

/**
 * `tierKind` : 'level' (l'intensité change le prix) ou 'style' (même prix). `capture` : l'effet lit l'image du jeu
 * (impossible en plein écran exclusif) ; les calques (overlay) n'en ont pas besoin. `photosensitive` : refusé en mode doux.
 * `base` : prix fictif (Jetons) pour 10 s au palier par défaut.
 */
export const EFFECTS = Object.freeze([
  { id: 'flip', label: 'Écran retourné', group: 'mouvement', slot: 'transform', pitch: 'Tout l’écran passe la tête en bas.', tiers: ['marque'], tierKind: 'style', durations: D, base: 4000, capture: true },
  { id: 'mirror', label: 'Miroir', group: 'mouvement', slot: 'transform', pitch: 'La gauche devient la droite. Bonne chance pour viser.', tiers: ['horizontal', 'vertical', 'alterne'], tierKind: 'style', durations: D, base: 3000, capture: true },
  { id: 'shake', label: 'Tremblement', group: 'mouvement', slot: 'camera', pitch: 'L’écran tremble, de la vibration au séisme.', tiers: LV, tierKind: 'level', durations: D, base: 2000, capture: true },
  { id: 'zoom', label: 'Zoom chaotique', group: 'mouvement', slot: 'camera', pitch: 'Des coups de zoom soudains vers un point de l’écran.', tiers: LV, tierKind: 'level', durations: D, base: 2500, capture: true },
  { id: 'drunk', label: 'Écran ivre', group: 'mouvement', slot: 'camera', pitch: 'L’image tangue, ondule et se dédouble.', tiers: LV, tierKind: 'level', durations: D, base: 3000, capture: true },
  { id: 'tunnel', label: 'Vision tunnel', group: 'vision', slot: 'camera', pitch: 'Tout s’assombrit autour d’un point qui grossit.', tiers: LV, tierKind: 'level', durations: D, base: 2500, capture: true },
  { id: 'blink', label: 'Clignement', group: 'vision', slot: 'overlay', pitch: 'Les paupières se ferment… et se rouvrent.', tiers: ['naturel', 'fatigue', 'ferme'], tierKind: 'style', durations: D, base: 2500, capture: false },
  { id: 'flash', label: 'Flash aveuglant', group: 'vision', slot: 'overlay', pitch: 'Un flash blanc, puis l’image reste imprimée.', tiers: ['court', 'intense', 'longue'], tierKind: 'level', durations: [3, 6, 9], base: 4000, capture: false, photosensitive: true, globalCooldown: 60 },
  { id: 'fog', label: 'Brouillard', group: 'vision', slot: 'overlay', pitch: 'Des nappes de brume envahissent l’écran.', tiers: ['leger', 'marque', 'dense', 'extreme'], tierKind: 'level', durations: D, base: 3000, capture: false },
  { id: 'blur', label: 'Flou', group: 'image', slot: 'filter', pitch: 'Du léger flou à la bouillie illisible.', tiers: LV, tierKind: 'level', durations: D, base: 2000, capture: true },
  { id: 'pixelate', label: 'Pixelisation', group: 'image', slot: 'filter', pitch: 'L’image part en gros pixels.', tiers: LV, tierKind: 'level', durations: D, base: 2000, capture: true },
  { id: 'color', label: 'Filtre de couleur', group: 'image', slot: 'filter', pitch: 'Noir et blanc, sépia ou couleurs inversées.', tiers: ['nb', 'sepia', 'inversion'], tierKind: 'style', durations: D, base: 1500, capture: true },
  { id: 'vhs', label: 'VHS / glitch', group: 'image', slot: 'filter', pitch: 'Une vieille cassette abîmée : parasites et tracking.', tiers: ['legere', 'abimee', 'glitch_violent'], tierKind: 'level', durations: D, base: 2500, capture: true },
]);

export const effectById = (id) => EFFECTS.find((e) => e.id === id) ?? null;

/** Palier proposé par défaut : le milieu d'une intensité (Marqué), le premier style. */
export const defaultTier = (e) => (e.tierKind === 'level' ? e.tiers[Math.min(1, e.tiers.length - 1)] : e.tiers[0]);
/** Durée proposée par défaut : 10 s (6 s pour le flash). */
export const defaultDuration = (e) => e.durations[Math.min(1, e.durations.length - 1)];

// PRIX FICTIFS (le Core les fixera, question Q2) : base × durée × palier, arrondi à 50.
const DURATION_FACTOR = { 3: 0.6, 5: 0.6, 6: 1, 9: 1.4, 10: 1, 20: 1.8, 30: 2.5 };
const LEVEL_FACTOR = { leger: 0.7, legere: 0.7, court: 0.7, marque: 1, abimee: 1, intense: 1, dense: 1.3, longue: 1.3, extreme: 1.6, glitch_violent: 1.6 };

export function mockPrice(e, tier, duration) {
  const d = DURATION_FACTOR[duration] ?? duration / 10;
  const l = e.tierKind === 'level' ? (LEVEL_FACTOR[tier] ?? 1) : 1;
  return Math.max(50, Math.round((e.base * d * l) / 50) * 50);
}

/** Le moins cher de l'effet (« dès … » sur sa carte). */
export const minPrice = (e) => Math.min(...e.tiers.flatMap((t) => e.durations.map((d) => mockPrice(e, t, d))));
