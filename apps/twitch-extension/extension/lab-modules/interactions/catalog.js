// LAB ONLY — catalogue viewer de Chaos V2 pour la maquette « Interactions » (docs/chaos/EXTENSION_INTERACTIONS.md).
// Un effet = des MÉTADONNÉES : ses préréglages (variantes du registre), ses forces (niveaux du registre), ses contrôles
// (paramètres exposés du registre, transitions permises), ses durées, sa gêne. Tout le reste est générique : la fiche,
// les contrôles, la demande au moteur, le prix, les règles de file (model.js). Ajouter un effet = ajouter une entrée ici
// (+ son aperçu CSS) ; aucun code de vue à écrire. Les valeurs réelles viennent de registry.js (extrait du registre).
// INVENTÉ ici, en attendant le Core (lot 2) : les libellés et phrases, les groupes, les montants de base des prix.
import { REGISTRY } from './registry.js';

export const GROUPS = Object.freeze([
  { id: 'mouvement', label: 'Mouvement' },
  { id: 'vision', label: 'Vision' },
  { id: 'image', label: 'Image' },
]);

/** Emplacements du moteur (registre `slots`) : combien d'effets de ce genre tournent ensemble. */
const SLOT_RULES = {
  transform: 'Un seul retournement à la fois',
  camera: 'Deux mouvements de caméra ensemble au plus',
  filter: 'Jusqu’à trois filtres ensemble',
  overlay: 'Se superpose aux autres effets',
};
export const SLOTS = Object.freeze(
  Object.fromEntries(Object.entries(REGISTRY.slots).map(([id, s]) => [id, { capacity: s.max_active, rule: SLOT_RULES[id] }])),
);

/**
 * Trois plafonds de durée, à ne pas confondre (EXTENSION_INTERACTIONS.md § 5) :
 *  - registre (moteur) : 60 s, la borne absolue de toute activation ;
 *  - Sécurité de Studio : 30 s par défaut, réglable jusqu'à 60 s ; le moteur refuse au-delà, quelle que soit la source ;
 *  - autorisation viewer (futur Core) : la plage vendue par effet et par préréglage, toujours sous les deux autres.
 */
export const ENGINE = Object.freeze({
  minDurationS: REGISTRY.limits.min_duration_ms / 1000,
  maxDurationS: REGISTRY.limits.max_duration_ms / 1000,
  maxTransitionMs: REGISTRY.limits.max_transition_ms,
  safetyDurationS: REGISTRY.safetyDefaults.max_duration_ms / 1000,
  safetyMaxActive: REGISTRY.safetyDefaults.max_active_effects,
});

const reg = (id) => REGISTRY.effects[id];
const pct = (x) => `${String(Math.round(x * 10) / 10).replace('.', ',')} %`;
const sec = (ms) => `${String(Math.round(ms / 100) / 10).replace('.', ',')} s`;
const num = (x, d = 2) => String(Math.round(x * 10 ** d) / 10 ** d).replace('.', ',');
const DUR = (def = 10, max = 60, min = 5, step = 5) => ({ min, max, step, def });
/** Point visé (zoom, tunnel) : coordonnées relatives 0..1 de l'écran du jeu (2560 × 1440 aujourd'hui, 16:9). */
const POINT = { kind: 'point', id: 'point', label: 'Point visé', params: ['focus_x', 'focus_y'], def: [0.5, 0.5] };
/** Aire visible d'un disque de rayon r (en hauteurs d'écran), rapportée à l'écran 16:9. */
const visibleArea = (r) => Math.min(1, (Math.PI * r * r) / (16 / 9));

/**
 * Effets publics du moteur (les 13 du registre). Champs :
 *  `base`     prix fictif (Jetons) de 10 s au réglage de référence (gêne 1) — § 6 du document ;
 *  `gene(p, c)` gêne du réglage choisi, calculée sur les VALEURS RÉELLES résolues comme le moteur (défauts → variante
 *              → niveau → demande), rapportée au réglage de référence ; `why(p, c)` dit en clair ce qui la fait varier ;
 *  `presets`  préréglages viewer = variantes du registre (ids réels) ; `duration` d'un préréglage remplace celle de
 *              l'effet (fixe : `fixed(c)`) ; `status: 'to_validate'` = présent dans le moteur, pas encore essayé en jeu ;
 *  `levels`   forces = niveaux du registre (ids réels, libellés viewer) ;
 *  `controls` contrôles génériques (slider, choice, toggle, hue, point), chacun lié à des paramètres exposés ;
 *  `capture`  l'effet lit l'image du jeu (impossible en plein écran exclusif) ; `studio` : ce qui reste au streamer.
 */
export const EFFECTS = Object.freeze([
  {
    id: 'flip',
    label: 'Écran retourné',
    group: 'mouvement',
    base: 12000,
    capture: true,
    pitch: 'Tout l’écran passe la tête en bas, la souris aussi.',
    presets: [{ id: 'rotate180', label: '180°', default: true }],
    controls: [
      {
        kind: 'choice',
        id: 'entry',
        label: 'Entrée',
        def: 'ramp',
        options: [
          { id: 'ramp', label: 'Rotation', hint: 'L’écran tourne en une demi-seconde.' },
          { id: 'slow', label: 'Rotation lente', hint: 'Un tour d’une seconde et demie, bien visible.', transition: { in: { kind: 'ramp', duration_ms: 1500 }, out: { kind: 'ramp', duration_ms: 1500 } } },
          { id: 'cut', label: 'D’un coup', hint: 'Retourné sans prévenir.', transition: { in: { kind: 'cut' }, out: { kind: 'cut' } } },
        ],
      },
    ],
    duration: DUR(10),
    // Image à l'envers ET souris inversée : la référence de la gêne la plus forte sur les commandes.
    gene: () => 1,
    why: () => 'image et souris inversées',
    note: 'La souris est inversée elle aussi (haut ↔ bas, gauche ↔ droite) ; le clic tombe sous le curseur.',
    studio: ['coins pendant la rotation', 'écran visé'],
  },
  {
    id: 'mirror',
    label: 'Miroir',
    group: 'mouvement',
    base: 9000,
    capture: true,
    pitch: 'La gauche devient la droite. Bonne chance pour viser.',
    presets: [
      { id: 'horizontal', label: 'Gauche ↔ droite', default: true, hint: 'L’image est inversée de gauche à droite ; la souris, non.' },
      { id: 'vertical', label: 'Haut ↔ bas', status: 'to_validate', hint: 'L’image est inversée de haut en bas. Moteur prêt, pas encore essayé en jeu.' },
      { id: 'alterne', label: 'Alternance', hint: 'Passe d’un miroir à l’autre par un demi-tour, à intervalle régulier.' },
    ],
    controls: [
      {
        kind: 'choice',
        id: 'rhythm',
        label: 'Changement',
        def: 'normal',
        when: (c) => c.style === 'alterne',
        options: [
          { id: 'fast', label: 'Toutes les 2 s', params: { interval_ms: 2000 } },
          { id: 'normal', label: 'Toutes les 3 s', params: { interval_ms: 3000 } },
          { id: 'slow', label: 'Toutes les 5 s', params: { interval_ms: 5000 } },
        ],
      },
      {
        kind: 'choice',
        id: 'entry',
        label: 'Entrée',
        def: 'card',
        options: [
          { id: 'card', label: 'Retournement', hint: 'L’image se retourne comme une carte.' },
          { id: 'cut', label: 'Instantané', hint: 'Inversé d’un coup.', transition: { in: { kind: 'cut' }, out: { kind: 'cut' } } },
        ],
      },
    ],
    duration: DUR(10),
    // Un seul axe inversé : gêne de référence. L'alternance empêche de s'habituer : chaque changement d'axe compte.
    gene: (p, c) => (c.style === 'alterne' ? 1 + 1.5 / (p.interval_ms / 1000) : 1),
    why: (p, c) => (c.style === 'alterne' ? `un changement d’axe toutes les ${sec(p.interval_ms)}` : 'un axe inversé'),
    studio: ['écran visé'],
  },
  {
    id: 'shake',
    label: 'Tremblement',
    group: 'mouvement',
    base: 4000,
    capture: true,
    pitch: 'L’écran tremble, de la vibration au séisme.',
    // Les préréglages de Studio, décrits par leur mouvement réel (registre : amplitudes, fréquence, enveloppe).
    presets: [
      { id: 'leger', label: 'Léger', hint: 'Petit tremblement continu, rapide (1,2 % de l’écran).' },
      { id: 'secousse', label: 'Secousse', default: true, hint: 'Secousse continue et irrégulière (2,4 % de l’écran).' },
      { id: 'vibration', label: 'Vibration', hint: 'Vibration fine et régulière, très rapide (0,6 %).' },
      { id: 'rafales', label: 'Par rafales', hint: 'Coups brefs (2,6 %) toutes les 1,5 s environ, calme entre les deux.' },
      { id: 'seisme', label: 'Séisme', hint: 'Grandes oscillations lentes, jusqu’à 4,5 % en hauteur ; monte pendant le premier quart.' },
      { id: 'impact', label: 'Impact', hint: 'Un seul choc fort (3,5 %) au début, amorti en moins d’une seconde.', duration: { min: 3, max: 3, step: 1, def: 3 } },
    ],
    controls: [
      { kind: 'slider', id: 'intensity', param: 'intensity', label: 'Intensité', min: 0.2, max: 1, step: 0.05, def: 'variant', format: (v) => `${Math.round(v * 100)} %` },
    ],
    duration: DUR(10),
    // Amplitude réelle = amplitude du préréglage × intensité ; part du temps où ça bouge (enveloppe du mode).
    gene: (p, c) => {
      const amp = Math.max(p.amp_x, p.amp_y) * p.intensity;
      const duty = { impact: Math.min(1, (p.decay_ms / 1000) * 2 / c.duration), rafales: Math.min(1, (p.decay_ms / 1000 + 0.05) / (p.interval_ms / 1000)), seisme: 0.75 }[p.mode] ?? 1;
      return (amp * duty) / (2.4 * 0.7);
    },
    why: (p) => `amplitude ${pct(Math.max(p.amp_x, p.amp_y) * p.intensity)} de l’écran`,
    studio: ['amplitudes', 'roulis', 'fréquence', 'amortissement', 'bords'],
  },
  {
    id: 'zoom',
    label: 'Zoom',
    group: 'mouvement',
    base: 5000,
    capture: true,
    pitch: 'Des coups de zoom vers le point que tu choisis.',
    presets: [
      { id: 'progressif', label: 'Progressif', default: true, hint: 'Entre doucement, reste, ressort doucement.' },
      { id: 'brutal', label: 'Coup de zoom', hint: 'Un coup sec avec un rebond, puis reste zoomé.' },
      { id: 'pulsations', label: 'Pulsations', hint: 'Quatre petits zooms rapides répartis sur la durée.', duration: { min: 5, max: 20, step: 5, def: 10 } },
      { id: 'aller_retour', label: 'Zoom et dézoom', hint: 'Une seule grande respiration.', duration: { min: 5, max: 15, step: 5, def: 10 } },
      { id: 'intermittent', label: 'Intermittent', hint: 'Quatre zooms imprévisibles.', duration: { min: 5, max: 20, step: 5, def: 10 } },
    ],
    controls: [
      { kind: 'slider', id: 'factor', param: 'factor', label: 'Zoom', min: 1.5, max: 6, step: 0.5, def: 'variant', format: (v) => `×${num(v, 1)}`, hint: (v) => (v <= 2 ? 'Le jeu reste lisible.' : v < 4 ? 'Gênant, mais on suit.' : 'Le jeu devient difficile à lire.') },
      POINT,
    ],
    duration: DUR(10),
    // Part de l'écran qui sort du champ (1 − 1/f²). Pulsations (un nombre fixe de zooms répartis sur la durée) : on paie
    // le temps réellement zoomé, le même quelle que soit la durée choisie.
    gene: (p, c) => {
      const hidden = (1 - 1 / (p.factor * p.factor)) / 0.75;
      if (p.mode !== 'pulsations') return hidden;
      const zoomedS = Math.min(c.duration, (p.pulses * (p.attack_ms + p.hold_ms + p.release_ms)) / 1000);
      return (hidden * durationFactor(zoomedS)) / durationFactor(c.duration);
    },
    why: (p, c) => `${Math.round((1 - 1 / (p.factor * p.factor)) * 100)} % de l’écran hors champ${p.mode === 'pulsations' ? `, ${sec(p.pulses * (p.attack_ms + p.hold_ms + p.release_ms))} zoomé sur ${c.duration} s` : ''}`,
    studio: ['recentrage', 'rythme des pulsations', 'zoom au-delà de ×6'],
  },
  {
    id: 'drunk',
    label: 'Ivresse',
    group: 'mouvement',
    base: 6000,
    capture: true,
    pitch: 'L’image tangue, ondule et se dédouble.',
    presets: [
      { id: 'pompette', label: 'Pompette', hint: 'Léger roulis (2,5°), un soupçon de vision double.' },
      { id: 'ivre', label: 'Ivre', default: true, hint: 'Ça tangue franchement (4°), vision double marquée.' },
      { id: 'ivre_mort', label: 'Ivre mort', hint: 'Titube (13°), vision double et flou forts, bords sombres.' },
      { id: 'vertige', label: 'Vertige', hint: 'Grands balancements (18°), le zoom respire.' },
    ],
    levels: [
      { id: 'leger', label: 'Léger', default: false },
      { id: 'marque', label: 'Marqué', default: true },
      { id: 'extreme', label: 'Extrême' },
    ],
    controls: [{ kind: 'toggle', id: 'rising', label: 'L’ivresse monte peu à peu', hint: 'Commence sobre et finit au maximum.', on: { progression: 1 }, def: false }],
    duration: DUR(15),
    // Déformation : balancement, vision double et flou réels (la gêne croît moins vite qu'eux : racine carrée), ×
    // intensité moyenne (montée progressive : moitié moins au début).
    gene: (p) => {
      const d = 0.4 * (p.sway / 4) + 0.3 * (p.double / 0.4) + 0.3 * (p.blur / 0.25);
      return (Math.sqrt(d) * p.intensity * (1 - p.progression / 2)) / (0.65 * 0.75);
    },
    why: (p) => `balancement ${num(p.sway, 1)}°, vision double ${Math.round(p.double * 100)} %, intensité ${Math.round(p.intensity * 100)} %`,
    studio: ['dérive', 'ondulation', 'flou', 'respiration du zoom', 'vitesse'],
  },
  {
    id: 'tunnel',
    label: 'Vision tunnel',
    group: 'vision',
    base: 7000,
    capture: true,
    pitch: 'Tout s’assombrit autour du point que tu choisis.',
    levels: [
      { id: 'leger', label: 'Léger' },
      { id: 'marque', label: 'Marqué', default: true },
      { id: 'extreme', label: 'Extrême' },
    ],
    controls: [
      {
        kind: 'choice',
        id: 'motion',
        label: 'Animation',
        def: 'fixe',
        options: [
          { id: 'fixe', label: 'Fixe', params: { mode: 'fixe' } },
          { id: 'retrecit', label: 'Se rétrécit', hint: 'Le champ se referme jusqu’à la fin.', params: { mode: 'retrecit' } },
          { id: 'derive', label: 'Le regard dérive', hint: 'Le point vu se balade sur l’écran.', params: { mode: 'derive' } },
        ],
      },
      // Le niveau impose un zoom (×1,15 à ×3,4) ; le viewer peut le retirer (zoom ×1) ou le régler.
      { kind: 'toggle', id: 'zoomOn', label: 'Zoom supplémentaire', hint: 'Le point vu grossit en plus de l’assombrissement.', off: { zoom: 1 }, def: true },
      { kind: 'slider', id: 'zoom', param: 'zoom', label: 'Zoom', min: 1.1, max: 3.5, step: 0.1, def: 'level', when: (c) => c.opts.zoomOn !== false, format: (v) => `×${num(v, 1)}` },
      POINT,
    ],
    duration: DUR(10),
    // Part de l'écran assombrie (obscurité × hors de la zone visible, rayon moyen si le champ se referme) ; le zoom ajoute
    // la part qui sort du champ dans la zone visible.
    gene: (p) => {
      const r = p.mode === 'retrecit' ? (p.radius * (1 + p.shrink)) / 2 : p.radius;
      const raw = p.darkness * (1 - visibleArea(r)) + visibleArea(r) * (1 - 1 / (p.zoom * p.zoom));
      return raw / (0.93 * (1 - visibleArea(0.28)) + visibleArea(0.28) * (1 - 1 / 2.25));
    },
    why: (p) => `${Math.round((1 - visibleArea(p.radius)) * 100)} % de l’écran assombri à ${Math.round(p.darkness * 100)} %${p.zoom > 1 ? `, zoom ×${num(p.zoom, 1)}` : ''}`,
    studio: ['forme', 'douceur du bord', 'couleur du voile'],
  },
  {
    id: 'blink',
    label: 'Paupières',
    group: 'vision',
    base: 14000,
    capture: false,
    pitch: 'Les paupières se ferment… et se rouvrent.',
    // Préréglages viewer construits sur les modes RÉELS du moteur (naturel, série, fermé, somnolence, résistance).
    presets: [
      { id: 'naturel', label: 'Naturel', default: true, hint: 'Des clignements naturels pendant toute la durée.' },
      { id: 'ponctuel', variant: 'naturel', label: 'Un clignement', hint: 'Une seule fermeture puis la réouverture. Plusieurs achats = plusieurs clignements, à la suite.', duration: { fixed: (c) => Math.max(2, Math.ceil((c.opts.shut ?? 0.4) + 1.6)) } },
      { id: 'serie', label: 'Répétés', hint: 'Des séries de clignements, avec une pause entre chaque série.', duration: { min: 5, max: 30, step: 5, def: 10 } },
      { id: 'lent', label: 'Lent', hint: 'Les paupières tombent lentement et se rouvrent lentement.' },
      { id: 'fatigue', label: 'Somnolence', hint: 'Paupières lourdes qui tombent peu à peu, deux micro-sommeils, réveil en sursaut.' },
      { id: 'resistance', label: 'Lutte contre le sommeil', hint: 'Fermés, ils s’entrouvrent, retombent… et se rouvrent enfin à la fin.' },
      { id: 'ferme', label: 'Yeux fermés', hint: 'Fermés pendant presque toute la durée. Très gênant : 15 s au plus.', duration: { min: 3, max: 15, step: 1, def: 5 } },
    ],
    levels: [
      { id: 'leger', label: 'Mi-closes' },
      { id: 'marque', label: 'Presque' },
      { id: 'extreme', label: 'Complètement', default: true },
    ],
    levelLabel: 'Fermeture',
    controls: [
      { kind: 'slider', id: 'hold', label: 'Yeux fermés à chaque clignement', min: 0.1, max: 5, step: 0.1, def: 0.1, when: (c) => c.style === 'naturel', apply: (v) => ({ hold_ms: Math.round(v * 1000) }), format: (v) => `${num(v, 1)} s` },
      { kind: 'slider', id: 'shut', label: 'Durée de la fermeture', min: 0.2, max: 3, step: 0.1, def: 0.4, when: (c) => c.style === 'ponctuel', apply: (v) => ({ hold_ms: Math.round(v * 1000) }), format: (v) => `${num(v, 1)} s` },
      { kind: 'slider', id: 'count', param: 'count', label: 'Clignements par série', min: 2, max: 6, step: 1, def: 3, when: (c) => c.style === 'serie', format: (v) => `${v}` },
      { kind: 'slider', id: 'pause', label: 'Pause entre deux séries', min: 1.5, max: 8, step: 0.5, def: 2, when: (c) => c.style === 'serie', apply: (v) => ({ interval_ms: Math.round(v * 1000) }), format: (v) => `${num(v, 1)} s` },
      { kind: 'slider', id: 'slowness', label: 'Lenteur des paupières', min: 0.3, max: 1.5, step: 0.1, def: 0.5, when: (c) => c.style === 'lent', apply: (v) => ({ close_ms: Math.round(v * 1000), open_ms: Math.round(v * 900) }), format: (v) => `${num(v, 1)} s` },
    ],
    duration: DUR(10, 30),
    // Part du temps où les yeux sont (presque) fermés, d'après les vrais temps de fermeture, maintien, ouverture et
    // intervalle du mode, × profondeur de la fermeture. Référence (gêne 1) : yeux fermés tout du long.
    gene: (p, c) => {
      const d = c.duration;
      const shut = (p.close_ms / 2 + p.hold_ms + p.open_ms / 2) / 1000;
      const cycle = (p.close_ms + p.hold_ms + p.open_ms) / 1000;
      let frac;
      if (p.mode === 'ferme') frac = Math.max(0, d - (p.close_ms + p.open_ms) / 2000) / d;
      else if (p.mode === 'resistance') frac = 0.75;
      else if (p.mode === 'somnolence') frac = Math.min(1, 0.25 + 4 / d);
      else if (p.mode === 'serie') frac = (p.count * shut) / (p.count * (cycle + 0.12) + p.interval_ms / 1000);
      else frac = Math.min(1, (shut * Math.max(1, Math.floor(d / (cycle + p.interval_ms / 1000)) + 1)) / d);
      return Math.min(1, frac) * Math.min(1, p.intensity);
    },
    why: (p, c) => `yeux fermés environ ${Math.round(Math.min(1, EFFECTS_BY_ID.blink.gene(p, c) / Math.min(1, p.intensity)) * 100)} % du temps`,
    studio: ['courbure', 'cils', 'teinte'],
  },
  {
    id: 'flash',
    label: 'Flash',
    group: 'vision',
    base: 7500,
    capture: false,
    photosensitive: true,
    globalCooldown: 60,
    pitch: 'Un flash blanc, puis l’image reste imprimée.',
    presets: [
      { id: 'court', label: 'Court', hint: 'Blanc 0,3 s, la vue revient en 0,9 s.' },
      { id: 'intense', label: 'Intense', default: true, hint: 'Blanc 1,4 s, retour en 2,6 s, image fantôme 4,5 s.' },
      { id: 'longue', label: 'Rémanence longue', hint: 'Blanc 1 s, retour lent (5,5 s), image fantôme 8 s.' },
    ],
    controls: [],
    // Le flash est fait de ses phases (blanc, retour, rémanence) : la durée ne fait qu'encadrer ; 3 à 9 s.
    duration: DUR(6, 9, 3, 3),
    gene: (p) => (p.blind_ms + p.recovery_ms / 2 + (p.ghost_ms * p.ghost) / 6) / (1400 + 1300 + 750),
    why: (p) => `aveuglé ${sec(p.blind_ms)}, vue rendue en ${sec(p.recovery_ms)}`,
    note: 'Effet lumineux : refusé en mode doux ; un seul flash par minute pour tout le chat.',
    studio: ['teinte du flash'],
  },
  {
    id: 'fog',
    label: 'Brouillard',
    group: 'vision',
    base: 6000,
    capture: false,
    pitch: 'Des nappes de brume envahissent l’écran et dérivent.',
    presets: [{ id: 'nappes', label: 'Nappes', default: true }],
    // Trois forces vendues ; la brume légère (niveau « leger ») reste à Studio, trop peu visible pour être vendue.
    levels: [
      { id: 'marque', label: 'Marqué', default: true },
      { id: 'dense', label: 'Dense' },
      { id: 'extreme', label: 'Occultant' },
    ],
    levelLabel: 'Densité',
    controls: [],
    duration: DUR(15, 60, 10),
    // Part de l'image cachée : densité × opacité × épaisseur du cœur des nappes (valeurs réelles des niveaux).
    gene: (p) => (p.density * p.opacity * (0.6 + 0.4 * p.thickness)) / (0.6 * 0.85 * 0.68),
    why: (p) => `densité ${Math.round(p.density * 100)} %, opacité ${Math.round(p.opacity * 100)} %`,
    note: 'Le brouillard monte en 2,5 s (comptées dans la durée) et se dissipe en 3 s après elle ; il dérive avec le vent pendant toute la durée.',
    studio: ['couleur', 'vent', 'résolution du rendu', 'brume légère'],
  },
  {
    id: 'blur',
    label: 'Flou',
    group: 'image',
    base: 5000,
    capture: true,
    pitch: 'Du léger flou à la bouillie illisible.',
    presets: [
      { id: 'constant', label: 'Constant', default: true },
      { id: 'pulse', label: 'Pulsé', hint: 'Va et vient entre presque net et le flou choisi.' },
      { id: 'progressif', label: 'Progressif', hint: 'De net au flou choisi, jusqu’à la fin.' },
      { id: 'vague', label: 'Vague', hint: 'Le flou ondule.' },
    ],
    levels: [
      { id: 'leger', label: 'Léger' },
      { id: 'marque', label: 'Marqué', default: true },
      { id: 'extreme', label: 'Extrême' },
    ],
    controls: [],
    duration: DUR(10),
    // Flou moyen réel sur la durée (pulsé et vague : entre le minimum et le maximum ; progressif : la moitié).
    gene: (p) => {
      const avg = p.mode === 'constant' ? p.amount : p.mode === 'progressif' ? p.amount / 2 : (p.amount + p.minimum) / 2;
      return avg / 55;
    },
    why: (p) => `flou moyen ${Math.round(p.mode === 'constant' ? p.amount : p.mode === 'progressif' ? p.amount / 2 : (p.amount + p.minimum) / 2)} sur 100`,
    studio: ['flou minimal', 'période'],
  },
  {
    id: 'pixelate',
    label: 'Pixelisation',
    group: 'image',
    base: 5000,
    capture: true,
    pitch: 'L’image part en gros pixels.',
    presets: [
      { id: 'constante', label: 'Constante', default: true },
      { id: 'progressive', label: 'Progressive', hint: 'Les pixels grossissent jusqu’à la taille choisie.' },
      { id: 'intermittente', label: 'Intermittente', hint: 'Par à-coups : pixelisé, net, pixelisé…' },
    ],
    controls: [
      // Paramètre réel `block` (taille d'un pixel en 1080p, 2 à 160) : crans lisibles, du reconnaissable à l'illisible.
      { kind: 'slider', id: 'block', param: 'block', label: 'Taille des pixels', stops: [6, 8, 10, 14, 20, 28, 40, 56, 80, 112], def: 28, format: (v) => `${v} px` },
    ],
    duration: DUR(10),
    gene: (p) => Math.sqrt(p.block / 28) * (p.mode === 'constant' ? 1 : 0.55),
    why: (p) => `pixels de ${p.block} px${p.mode === 'constant' ? '' : ', une partie du temps'}`,
    studio: ['grille', 'couleurs par canal', 'style Rétro'],
  },
  {
    id: 'color',
    label: 'Couleur',
    group: 'image',
    base: 2000,
    capture: true,
    pitch: 'Noir et blanc, sépia, négatif, monochrome…',
    presets: [
      { id: 'nb', label: 'Noir et blanc', default: true },
      { id: 'film_noir', label: 'Film noir', hint: 'Noir et blanc très contrasté : les zones sombres se bouchent.' },
      { id: 'sepia', label: 'Sépia' },
      { id: 'inversion', label: 'Négatif', hint: 'Les couleurs en négatif : ennemis et interface se lisent mal.' },
      { id: 'delave', label: 'Délavé' },
      { id: 'sature', label: 'Saturé' },
      { id: 'rouge', label: 'Monochrome', hint: 'Une seule teinte, que tu choisis.' },
    ],
    controls: [
      { kind: 'slider', id: 'saturation', param: 'saturation', label: 'Saturation', min: 1.5, max: 3, step: 0.25, def: 'variant', when: (c) => c.style === 'sature', format: (v) => `×${num(v)}` },
      { kind: 'hue', id: 'hue', param: 'tint', label: 'Teinte', def: 350, when: (c) => c.style === 'rouge' },
    ],
    duration: DUR(15),
    // Couleurs perdues (noir et blanc, sépia, monochrome) = 1 ; contraste qui bouche les ombres ou négatif : on lit
    // moins bien l'interface ; délavé et saturé : on garde l'information de couleur.
    gene: (p) => ({ inversion: 1.5, nb: p.contrast > 1.3 ? 1.2 : 1, sepia: 0.9, teinte: 1, desature: 0.6, sature: 0.5 + 0.2 * (p.saturation - 1.5) })[p.mode] ?? 1,
    why: (p) => ({ inversion: 'couleurs en négatif', desature: 'couleurs atténuées', sature: 'couleurs exagérées' })[p.mode] ?? 'couleurs perdues',
    studio: ['force', 'contraste fin'],
  },
  {
    id: 'vhs',
    label: 'VHS / glitch',
    group: 'image',
    base: 3000,
    capture: true,
    pitch: 'Une vieille cassette abîmée : parasites et tracking.',
    presets: [
      { id: 'legere', label: 'VHS légère', hint: 'Lignes et grain, presque pas de glitch.' },
      { id: 'abimee', label: 'VHS abîmée', default: true, hint: 'Usure, parasites, couleurs qui bavent.' },
      { id: 'tracking', label: 'Tracking instable', hint: 'L’image roule et glisse.' },
      { id: 'glitch_bref', label: 'Glitch bref', hint: 'Des rafales de blocs décalés.' },
      { id: 'glitch_violent', label: 'Glitch violent', hint: 'Tout se déchire, très souvent.' },
    ],
    controls: [],
    duration: DUR(10),
    // Usure, tracking et glitchs réels du préréglage (valeurs du registre).
    gene: (p) => (0.4 * p.intensity + 0.3 * p.tracking + 0.3 * p.glitch * (0.5 + 0.5 * p.glitch_rate)) / (0.4 * 0.85 + 0.3 * 0.5 + 0.3 * 0.3 * 0.65),
    why: (p) => `usure ${Math.round(p.intensity * 100)} %, tracking ${Math.round(p.tracking * 100)} %, glitchs ${Math.round(p.glitch * 100)} %`,
    studio: ['grain', 'bavure des couleurs', 'pertes de bande'],
  },
].map((e) => ({ slot: reg(e.id).slot, levels: null, ...e })));

/**
 * Effets prévus, pas encore dans le moteur (EXTENSION_INTERACTIONS.md § 12) : visibles seulement avec le réglage Lab
 * « Effets à venir », jamais achetables. Ils montrent qu'un effet s'ajoute par ses métadonnées.
 */
export const PLANNED = Object.freeze([
  { id: 'confetti', label: 'Confettis', group: 'celebration', planned: true, pitch: 'Une pluie de confettis pour un beau moment.', slot: 'overlay' },
  { id: 'emote_rain', label: 'Pluie d’emotes', group: 'celebration', planned: true, pitch: 'Les emotes de la chaîne (Twitch, 7TV, BTTV) tombent sur l’écran.', slot: 'overlay' },
]);

const EFFECTS_BY_ID = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));
export const effectById = (id) => EFFECTS_BY_ID[id] ?? PLANNED.find((e) => e.id === id) ?? null;
export const presetOf = (e, c) => e.presets?.find((s) => s.id === c.style) ?? null;
export const levelOf = (e, c) => e.levels?.find((l) => l.id === c.level) ?? null;
/** Variante du registre d'un préréglage (un préréglage viewer peut réutiliser une variante : « Un clignement »). */
export const variantOf = (e, c) => presetOf(e, c)?.variant ?? presetOf(e, c)?.id ?? null;
/** Contrôles qui s'appliquent au réglage en cours (conditions `when`). */
export const controlsFor = (e, c) => (e.controls ?? []).filter((k) => !k.when || k.when(c));

/** Plage de durée vendue pour ce réglage : celle du préréglage, sinon de l'effet, sous le plafond Sécurité (capS). */
export function durationRange(e, c, capS = ENGINE.safetyDurationS) {
  const p = presetOf(e, c)?.duration;
  if (p?.fixed) {
    const s = Math.min(p.fixed(c), capS, ENGINE.maxDurationS);
    return { min: s, max: s, step: 1, def: s, fixed: true };
  }
  const r = { ...e.duration, ...(p ?? {}) };
  const max = Math.max(r.min, Math.min(r.max, capS, ENGINE.maxDurationS));
  return { min: r.min, max, step: r.step, def: Math.min(r.def, max), fixed: false };
}

/** Valeur par défaut d'un contrôle : fixe, ou celle que le préréglage / le niveau donne au paramètre (`'variant'`, `'level'`). */
function controlDefault(e, c, k) {
  if (k.def !== 'variant' && k.def !== 'level') return k.def;
  return resolveParams(e, { ...c, opts: {} })[k.param];
}

export function defaultChoice(e) {
  const c = {
    style: (e.presets?.find((s) => s.default) ?? e.presets?.[0])?.id ?? null,
    level: e.levels?.find((l) => l.default)?.id ?? null,
    duration: 10,
    opts: {},
  };
  for (const k of e.controls ?? []) if (!(k.id in c.opts)) c.opts[k.id] = controlDefault(e, c, k);
  c.duration = durationRange(e, c).def;
  return c;
}

const snap = (k, v) => {
  if (k.stops) return k.stops.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), k.stops[0]);
  return Math.min(k.max, Math.max(k.min, Math.round(v / k.step) * k.step));
};

/**
 * Réglage cohérent avec le catalogue et le plafond (valeurs inconnues → défaut). `reset` : contrôles à remettre à la
 * valeur du nouveau préréglage / niveau (le viewer vient d'en changer).
 */
export function normalizeChoice(e, c, capS, { reset = false } = {}) {
  const out = defaultChoice(e);
  if (c?.style && e.presets?.some((s) => s.id === c.style)) out.style = c.style;
  if (c?.level && e.levels?.some((l) => l.id === c.level)) out.level = c.level;
  for (const k of e.controls ?? []) {
    const v = reset && (k.def === 'variant' || k.def === 'level') ? undefined : c?.opts?.[k.id];
    if (v === undefined) {
      out.opts[k.id] = controlDefault(e, out, k);
      continue;
    }
    if (k.kind === 'choice' && k.options.some((o) => o.id === v)) out.opts[k.id] = v;
    else if (k.kind === 'slider' && Number.isFinite(Number(v))) out.opts[k.id] = Math.round(snap(k, Number(v)) * 1000) / 1000;
    else if (k.kind === 'point' && Array.isArray(v)) out.opts[k.id] = v.map((x) => Math.min(1, Math.max(0, Math.round(Number(x) * 100) / 100 || 0)));
    else if (k.kind === 'hue' && Number.isFinite(Number(v))) out.opts[k.id] = ((Math.round(v) % 360) + 360) % 360;
    else if (k.kind === 'toggle') out.opts[k.id] = Boolean(v);
    else out.opts[k.id] = controlDefault(e, out, k);
  }
  const range = durationRange(e, out, capS);
  const d = Number(c?.duration);
  out.duration = range.fixed ? range.def : Number.isFinite(d) ? Math.min(range.max, Math.max(range.min, Math.round(d / range.step) * range.step)) : range.def;
  return out;
}

/** Teinte (0–360°) → #rrggbb (saturation 65 %, luminosité 50 %) : ce que le paramètre couleur `tint` du moteur reçoit. */
export function hueHex(h) {
  const s = 0.65;
  const l = 0.5;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** Paramètres et transition demandés par les contrôles (la partie « demande » des couches du moteur). */
function requestParts(e, c) {
  const params = {};
  let transition = null;
  for (const k of controlsFor(e, c)) {
    const v = c.opts?.[k.id];
    if (v === undefined) continue; // contrôle pas encore réglé : le moteur garde la valeur du préréglage
    if (k.kind === 'choice') {
      const o = k.options.find((x) => x.id === v);
      Object.assign(params, o?.params ?? {});
      if (o?.transition) transition = o.transition;
    } else if (k.kind === 'slider') Object.assign(params, k.apply ? k.apply(v) : { [k.param]: v });
    else if (k.kind === 'point') [params[k.params[0]], params[k.params[1]]] = v;
    else if (k.kind === 'hue') params[k.param] = hueHex(v);
    else if (k.kind === 'toggle') Object.assign(params, (v ? k.on : k.off) ?? {});
  }
  return { params, transition };
}

/**
 * Paramètres tels que le moteur les résoudra : défauts → variante → niveau → demande (Params.Resolve). Sans le
 * préréglage enregistré dans Studio, qui s'intercale avant la demande (§ 5 : décision du lot 2).
 */
export function resolveParams(e, c) {
  const r = reg(e.id);
  if (!r) return {};
  const p = Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, v.def]));
  const variant = variantOf(e, c);
  if (variant) Object.assign(p, r.variants[variant]?.params ?? {});
  if (c.level) Object.assign(p, r.levels[c.level]?.params ?? {});
  Object.assign(p, requestParts(e, c).params);
  return p;
}

/**
 * La demande que le Core enverra au moteur pour ce réglage (protocole `effect.activate`, source externe : seuls les
 * paramètres exposés du registre sont permis).
 */
export function engineRequest(e, c) {
  const { params, transition } = requestParts(e, c);
  const req = { effect: e.id, duration_ms: Math.round(c.duration * 1000) };
  const variant = variantOf(e, c);
  if (variant) req.variant = variant;
  if (c.level) req.level = c.level;
  if (Object.keys(params).length) req.params = params;
  if (transition) req.transition = transition;
  return req;
}

// --- Prix (FICTIFS, le Core les fixera) ---------------------------------------------------------------------------
// prix = base de l'effet × gêne du réglage × durée, arrondi à 50 Jetons. La gêne se calcule sur les valeurs réelles du
// réglage (amplitude, part de l'écran cachée, temps yeux fermés…), jamais sur le nom d'un préréglage.
// Durée : une part fixe (un déclenchement interrompt, quelle que soit sa longueur) + une part par seconde.
export const durationFactor = (s) => Math.round((0.3 + 0.07 * s) * 1000) / 1000; // 10 s = ×1 ; 30 s = ×2,4 ; 60 s = ×4,5

export function gene(e, c) {
  return Math.max(0.05, e.gene(resolveParams(e, c), c));
}

export function priceOf(e, c) {
  const p = resolveParams(e, c);
  const g = gene(e, c);
  const lines = [
    { label: 'Base · 10 s, réglage de référence', value: e.base },
    { label: `Gêne de ce réglage : ${e.why(p, c)}`, mult: Math.round(g * 100) / 100 },
    { label: `Durée ${num(c.duration, 1)} s`, mult: durationFactor(c.duration) },
  ];
  const total = Math.max(50, Math.round((e.base * g * durationFactor(c.duration)) / 50) * 50);
  return { total, lines };
}

/** Le moins cher d'un effet (« dès … » sur sa carte) : préréglage et force les plus doux, durée minimale. */
export function minPrice(e) {
  let best = Infinity;
  for (const s of e.presets ?? [null])
    for (const l of e.levels ?? [null]) {
      const c = normalizeChoice(e, { style: s?.id ?? null, level: l?.id ?? null, duration: 0 }, ENGINE.maxDurationS, { reset: true });
      for (const k of e.controls ?? []) {
        if (k.kind !== 'slider' || (k.when && !k.when(c))) continue;
        const low = k.stops ? k.stops[0] : k.min;
        const high = k.stops ? k.stops.at(-1) : k.max;
        const a = priceOf(e, normalizeChoice(e, { ...c, opts: { ...c.opts, [k.id]: low } })).total;
        const b = priceOf(e, normalizeChoice(e, { ...c, opts: { ...c.opts, [k.id]: high } })).total;
        c.opts[k.id] = a <= b ? low : high;
      }
      for (const k of e.controls ?? []) if (k.kind === 'toggle' && k.off) c.opts[k.id] = false;
      const r = durationRange(e, c, ENGINE.maxDurationS);
      for (const d of [r.min, r.max]) best = Math.min(best, priceOf(e, normalizeChoice(e, { ...c, duration: d }, ENGINE.maxDurationS)).total);
    }
  return best;
}

/** Résumé d'un réglage en une ligne (suivi, historique, modération). */
export function describeChoice(e, c) {
  const parts = [];
  const st = presetOf(e, c);
  if (st && (e.presets?.length ?? 0) > 1) parts.push(st.label);
  const lv = levelOf(e, c);
  if (lv) parts.push(lv.label);
  for (const k of controlsFor(e, c)) {
    const v = c.opts?.[k.id];
    if (k.kind === 'slider' && v !== controlDefault(e, c, k)) parts.push(`${k.label.toLowerCase()} ${k.format(v)}`);
    if (k.kind === 'toggle' && v !== k.def) parts.push(v ? k.label.toLowerCase() : `sans ${k.label.toLowerCase()}`);
    if (k.kind === 'choice' && v !== k.def) parts.push(k.options.find((o) => o.id === v)?.label ?? v);
  }
  parts.push(`${num(c.duration, 1)} s`);
  return parts.join(' · ');
}
