// LAB ONLY — catalogue viewer de Chaos V2 pour la maquette « Interactions » (docs/chaos/EXTENSION_INTERACTIONS.md).
// Chaque choix proposé au viewer est une capacité RÉELLE du moteur, relevée dans le registre
// (packages/schemas/src/chaos-registry.json, branche feat/chaos-studio, registre v3, 26/11) :
//   - un style    = une variante du registre (`variant`, mêmes ids que les préréglages de Studio) ;
//   - une force   = un niveau du registre (`level`) ;
//   - un contrôle = un paramètre exposé du registre (`params`) ou une transition permise (`transition`).
// test/interactions-model.test.js vérifie chaque id et chaque borne contre un relevé du registre
// (test/fixtures/chaos-registry-viewer.json). Les réglages techniques (amplitudes, fréquences, bords…) restent au streamer.
// INVENTÉ ici, en attendant le Core (lot 2) : les phrases, les groupes, les PRIX et leurs coefficients.

export const GROUPS = Object.freeze([
  { id: 'mouvement', label: 'Mouvement' },
  { id: 'vision', label: 'Vision' },
  { id: 'image', label: 'Image' },
]);

/** Emplacements du moteur : combien d'effets de ce genre tournent ensemble (au-delà : file d'attente). */
export const SLOTS = Object.freeze({
  transform: { capacity: 1, rule: 'Un seul retournement à la fois' },
  camera: { capacity: 2, rule: 'Deux mouvements de caméra ensemble au plus' },
  filter: { capacity: 3, rule: 'Jusqu’à trois filtres ensemble' },
  overlay: { capacity: 4, rule: 'Se superpose aux autres effets' },
});

/** Sécurité du moteur (Studio › Chaos › Sécurité) : valeurs par défaut de la configuration (Config.cs). */
export const ENGINE = Object.freeze({
  minDurationS: 1,
  maxDurationS: 60, // registre : engine_limits.max_duration_ms
  safetyDurationS: 30, // Sécurité › durée maximale d'un effet (défaut 30 s, 60 s au plus)
  safetyMaxActive: 4, // Sécurité › effets actifs en même temps (défaut 4)
});

/** Forces partagées (niveaux du registre : leger, marque, extreme). */
const LV = (labels = {}) => [
  { id: 'leger', label: labels.leger ?? 'Léger', mult: 0.7 },
  { id: 'marque', label: labels.marque ?? 'Marqué', mult: 1, default: true },
  { id: 'extreme', label: labels.extreme ?? 'Extrême', mult: 1.6 },
];

const DUR = (def = 10, max = 60, min = 5, step = 5) => ({ min, max, step, def });

/** Point visé (zoom, tunnel) : coordonnées relatives 0..1 de l'écran du jeu (2560 × 1440 aujourd'hui, 16:9). */
const POINT = { kind: 'point', id: 'point', label: 'Point visé', params: ['focus_x', 'focus_y'], def: [0.5, 0.5] };

/**
 * `gene` : 1 à 3, à quel point l'effet gêne le jeu (structure tarifaire : le prix de base suit la gêne).
 * `base` : prix fictif (Jetons) pour 10 s au style et à la force par défaut.
 * `capture` : l'effet lit l'image du jeu (impossible en plein écran exclusif) ; les calques n'en ont pas besoin.
 * `studio` : ce que le streamer garde dans Studio (jamais proposé au viewer).
 * `status: 'to_validate'` : capacité présente dans le moteur mais pas encore validée en jeu par Antoni (signalée en Lab).
 */
export const EFFECTS = Object.freeze([
  {
    id: 'flip',
    label: 'Écran retourné',
    group: 'mouvement',
    slot: 'transform',
    gene: 3,
    base: 800,
    capture: true,
    pitch: 'Tout l’écran passe la tête en bas, la souris aussi.',
    styles: [{ id: 'rotate180', label: '180°', default: true }],
    controls: [
      {
        kind: 'choice',
        id: 'entry',
        label: 'Entrée',
        def: 'ramp',
        options: [
          { id: 'ramp', label: 'Rotation', hint: 'L’écran tourne en une demi-seconde.' },
          { id: 'slow', label: 'Rotation lente', hint: 'Un tour d’une seconde et demie, bien visible.', transition: { in: { kind: 'ramp', duration_ms: 1500 }, out: { kind: 'ramp', duration_ms: 1500 } } },
          { id: 'cut', label: 'D’un coup', hint: 'Retourné sans prévenir.', mult: 1.2, transition: { in: { kind: 'cut' }, out: { kind: 'cut' } } },
        ],
      },
    ],
    duration: DUR(10),
    note: 'La souris est inversée elle aussi (haut ↔ bas, gauche ↔ droite) ; le clic tombe sous le curseur.',
    studio: ['coins pendant la rotation', 'écran visé'],
  },
  {
    id: 'mirror',
    label: 'Miroir',
    group: 'mouvement',
    slot: 'transform',
    gene: 3,
    base: 700,
    capture: true,
    pitch: 'La gauche devient la droite. Bonne chance pour viser.',
    styles: [
      { id: 'horizontal', label: 'Gauche ↔ droite', default: true },
      { id: 'vertical', label: 'Haut ↔ bas', status: 'to_validate', hint: 'Moteur prêt, curseur retourné sur le même axe ; pas encore essayé en jeu.' },
      { id: 'alterne', label: 'Alternance', mult: 1.3, hint: 'Passe d’un miroir à l’autre par un demi-tour.' },
    ],
    controls: [
      {
        kind: 'choice',
        id: 'rhythm',
        label: 'Rythme',
        def: 'normal',
        when: (c) => c.style === 'alterne',
        options: [
          { id: 'fast', label: 'Toutes les 2 s', mult: 1.1, params: { interval_ms: 2000 } },
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
          { id: 'cut', label: 'Instantané', mult: 1.1, hint: 'Inversé d’un coup.', transition: { in: { kind: 'cut' }, out: { kind: 'cut' } } },
        ],
      },
    ],
    duration: DUR(10),
    studio: ['écran visé'],
  },
  {
    id: 'shake',
    label: 'Tremblement',
    group: 'mouvement',
    slot: 'camera',
    gene: 2,
    base: 450,
    capture: true,
    pitch: 'L’écran tremble, de la vibration au séisme.',
    styles: [
      { id: 'leger', label: 'Léger', hint: 'Petit tremblement nerveux.' },
      { id: 'secousse', label: 'Secousse', default: true, hint: 'Secousse franche et continue.' },
      { id: 'impact', label: 'Impact', hint: 'Un choc, puis le calme revient.' },
      { id: 'rafales', label: 'Par rafales', hint: 'Des secousses à intervalles irréguliers.' },
      { id: 'seisme', label: 'Séisme', mult: 1.2, hint: 'Monte, gronde, puis s’apaise.' },
      { id: 'vibration', label: 'Vibration', hint: 'Vibration fine et rapide, comme un moteur.' },
    ],
    levels: LV(),
    controls: [],
    duration: DUR(10),
    studio: ['amplitudes', 'roulis', 'fréquence', 'amortissement', 'bords'],
  },
  {
    id: 'zoom',
    label: 'Zoom chaotique',
    group: 'mouvement',
    slot: 'camera',
    gene: 2,
    base: 550,
    capture: true,
    pitch: 'Des coups de zoom vers le point que tu choisis.',
    styles: [
      { id: 'progressif', label: 'Progressif', default: true, hint: 'Entre doucement, ressort doucement.' },
      { id: 'brutal', label: 'Coup de zoom', hint: 'Un coup sec avec un rebond.' },
      { id: 'aller_retour', label: 'Zoom et dézoom', hint: 'Une grande respiration.' },
      { id: 'pulsations', label: 'Pulsations', hint: 'Plusieurs petits zooms rapides.' },
      { id: 'intermittent', label: 'Intermittent', mult: 1.1, hint: 'Des zooms imprévisibles.' },
    ],
    controls: [
      {
        kind: 'slider',
        id: 'factor',
        param: 'factor',
        label: 'Zoom',
        min: 1.5,
        max: 6,
        step: 0.5,
        def: 2,
        format: (v) => `×${String(v).replace('.', ',')}`,
        // ×2 = prix de base ; chaque cran de ×0,5 change le prix de 7,5 %.
        mult: (v) => Math.round((0.7 + 0.15 * v) * 1000) / 1000,
        hint: (v) => (v <= 2 ? 'Le jeu reste lisible.' : v < 4 ? 'Gênant, mais on suit.' : 'Le jeu devient difficile à lire.'),
      },
      POINT,
    ],
    duration: DUR(10),
    studio: ['recentrage', 'rythme des pulsations', 'zoom au-delà de ×6'],
  },
  {
    id: 'drunk',
    label: 'Écran ivre',
    group: 'mouvement',
    slot: 'camera',
    gene: 2,
    base: 600,
    capture: true,
    pitch: 'L’image tangue, ondule et se dédouble.',
    styles: [
      { id: 'pompette', label: 'Pompette', hint: 'Léger roulis, un soupçon de vision double.' },
      { id: 'ivre', label: 'Ivre', default: true, hint: 'Ça tangue franchement.' },
      { id: 'ivre_mort', label: 'Ivre mort', mult: 1.3, hint: 'Titube, vision double, bords sombres.' },
      { id: 'vertige', label: 'Vertige', mult: 1.2, hint: 'Grands balancements, le zoom respire.' },
    ],
    levels: LV(),
    controls: [{ kind: 'toggle', id: 'rising', param: 'progression', on: 1, def: false, label: 'L’ivresse monte peu à peu', hint: 'Commence sobre et finit au maximum.' }],
    duration: DUR(15),
    studio: ['dérive', 'ondulation', 'vision double', 'flou', 'respiration du zoom', 'vitesse'],
  },
  {
    id: 'tunnel',
    label: 'Vision tunnel',
    group: 'vision',
    slot: 'camera',
    gene: 3,
    base: 600,
    capture: true,
    pitch: 'Tout s’assombrit autour du point que tu choisis.',
    levels: LV(),
    controls: [
      {
        kind: 'choice',
        id: 'motion',
        label: 'Animation',
        def: 'fixe',
        options: [
          { id: 'fixe', label: 'Fixe', params: { mode: 'fixe' } },
          { id: 'retrecit', label: 'Se rétrécit', mult: 1.15, hint: 'Le champ se referme jusqu’à la fin.', params: { mode: 'retrecit' } },
          { id: 'derive', label: 'Le regard dérive', mult: 1.1, hint: 'Le point vu se balade sur l’écran.', params: { mode: 'derive' } },
        ],
      },
      POINT,
    ],
    duration: DUR(10),
    studio: ['forme', 'douceur du bord', 'couleur du voile', 'zoom'],
  },
  {
    id: 'blink',
    label: 'Paupières',
    group: 'vision',
    slot: 'overlay',
    gene: 2,
    base: 450,
    capture: false,
    pitch: 'Les paupières se ferment… et se rouvrent.',
    styles: [
      { id: 'naturel', label: 'Naturel', default: true, hint: 'Un vrai clignement, de temps en temps.' },
      { id: 'rapide', label: 'Rapide', hint: 'Des séries de clignements vifs.' },
      { id: 'fatigue', label: 'Fatigué', hint: 'Les yeux se ferment de plus en plus longtemps.' },
      { id: 'resistance', label: 'Qui résistent', mult: 1.1, hint: 'Elles retombent et se rouvrent avec peine.' },
      { id: 'ferme', label: 'Yeux fermés', mult: 1.3, hint: 'Fermés presque tout du long.' },
    ],
    levels: [
      { id: 'leger', label: 'Mi-closes', mult: 0.8 },
      { id: 'marque', label: 'Presque', mult: 1 },
      { id: 'extreme', label: 'Complètement', mult: 1.3, default: true },
    ],
    levelLabel: 'Fermeture',
    controls: [],
    duration: DUR(10),
    studio: ['vitesse des paupières', 'courbure', 'cils', 'teinte'],
  },
  {
    id: 'flash',
    label: 'Flash aveuglant',
    group: 'vision',
    slot: 'overlay',
    gene: 3,
    base: 900,
    capture: false,
    photosensitive: true,
    globalCooldown: 60,
    pitch: 'Un flash blanc, puis l’image reste imprimée.',
    styles: [
      { id: 'court', label: 'Court', mult: 0.8, hint: 'Éblouit un instant.' },
      { id: 'intense', label: 'Intense', default: true, hint: 'Aveugle plus d’une seconde.' },
      { id: 'longue', label: 'Rémanence longue', mult: 1.3, hint: 'L’image fantôme met longtemps à partir.' },
    ],
    controls: [],
    duration: DUR(6, 9, 3, 3),
    note: 'Effet lumineux : refusé en mode doux ; un seul flash par minute pour tout le chat.',
    studio: ['teinte du flash', 'temps d’aveuglement'],
  },
  {
    id: 'fog',
    label: 'Brouillard',
    group: 'vision',
    slot: 'overlay',
    gene: 3,
    base: 600,
    capture: false,
    pitch: 'Des nappes de brume envahissent l’écran.',
    styles: [
      { id: 'nappes', label: 'Nappes', default: true },
      { id: 'bancs', label: 'Bancs mouvants', hint: 'S’épaissit et s’éclaircit par endroits.' },
      { id: 'passages', label: 'Nappes qui passent', hint: 'Des masses traversent avec le vent.' },
      { id: 'arrivee', label: 'Arrive peu à peu', hint: 'L’écran se voile lentement.' },
      { id: 'dissipe', label: 'Se dissipe', mult: 0.9, hint: 'Épais au début, s’en va peu à peu.' },
    ],
    levels: [
      { id: 'leger', label: 'Brume', mult: 0.7 },
      { id: 'marque', label: 'Marqué', mult: 1, default: true },
      { id: 'dense', label: 'Dense', mult: 1.3 },
      { id: 'extreme', label: 'Opaque', mult: 1.7 },
    ],
    levelLabel: 'Densité',
    controls: [],
    duration: DUR(20),
    studio: ['couleur', 'vent', 'résolution du rendu'],
  },
  {
    id: 'blur',
    label: 'Flou',
    group: 'image',
    slot: 'filter',
    gene: 3,
    base: 500,
    capture: true,
    pitch: 'Du léger flou à la bouillie illisible.',
    styles: [
      { id: 'constant', label: 'Constant', default: true },
      { id: 'pulse', label: 'Pulsé', hint: 'Va et vient entre net et flou.' },
      { id: 'progressif', label: 'Progressif', hint: 'De plus en plus flou.' },
      { id: 'vague', label: 'Vague', hint: 'Le flou ondule.' },
    ],
    levels: LV(),
    controls: [],
    duration: DUR(10),
    studio: ['flou minimal', 'période'],
  },
  {
    id: 'pixelate',
    label: 'Pixelisation',
    group: 'image',
    slot: 'filter',
    gene: 3,
    base: 500,
    capture: true,
    pitch: 'L’image part en gros pixels.',
    styles: [
      { id: 'constante', label: 'Constante', default: true },
      { id: 'progressive', label: 'Progressive', hint: 'Les pixels grossissent.' },
      { id: 'intermittente', label: 'Intermittente', hint: 'Par à-coups.' },
      { id: 'retro', label: 'Rétro', hint: 'Peu de couleurs, une grille : vieille console.' },
    ],
    levels: LV({ leger: 'Fins', marque: 'Gros', extreme: 'Énormes' }),
    levelLabel: 'Pixels',
    controls: [],
    duration: DUR(10),
    studio: ['grille', 'couleurs par canal'],
  },
  {
    id: 'color',
    label: 'Filtre de couleur',
    group: 'image',
    slot: 'filter',
    gene: 1,
    base: 350,
    capture: true,
    pitch: 'Noir et blanc, sépia, négatif, monochrome…',
    styles: [
      { id: 'nb', label: 'Noir et blanc', default: true },
      { id: 'film_noir', label: 'Film noir', hint: 'Noir et blanc très contrasté.' },
      { id: 'sepia', label: 'Sépia' },
      { id: 'inversion', label: 'Inversion', mult: 1.2, hint: 'Les couleurs en négatif.' },
      { id: 'delave', label: 'Délavé' },
      { id: 'sature', label: 'Saturé' },
      { id: 'rouge', label: 'Monochrome', hint: 'Une seule teinte, que tu choisis.' },
    ],
    controls: [
      {
        kind: 'slider',
        id: 'saturation',
        param: 'saturation',
        label: 'Saturation',
        min: 1.5,
        max: 3,
        step: 0.25,
        def: 2.25,
        when: (c) => c.style === 'sature',
        format: (v) => `×${String(Math.round(v * 100) / 100).replace('.', ',')}`,
      },
      { kind: 'hue', id: 'hue', param: 'tint', label: 'Teinte', def: 350, when: (c) => c.style === 'rouge' },
    ],
    duration: DUR(15),
    studio: ['force', 'contraste fin'],
  },
  {
    id: 'vhs',
    label: 'VHS / glitch',
    group: 'image',
    slot: 'filter',
    gene: 2,
    base: 500,
    capture: true,
    pitch: 'Une vieille cassette abîmée : parasites et tracking.',
    styles: [
      { id: 'legere', label: 'VHS légère', mult: 0.8 },
      { id: 'abimee', label: 'VHS abîmée', default: true },
      { id: 'tracking', label: 'Tracking instable', hint: 'L’image roule et glisse.' },
      { id: 'glitch_bref', label: 'Glitch bref', hint: 'Des rafales de blocs décalés.' },
      { id: 'glitch_violent', label: 'Glitch violent', mult: 1.3, hint: 'Tout se déchire.' },
    ],
    controls: [],
    duration: DUR(10),
    studio: ['grain', 'bavure des couleurs', 'pertes de bande'],
  },
]);

export const effectById = (id) => EFFECTS.find((e) => e.id === id) ?? null;
export const styleOf = (e, c) => e.styles?.find((s) => s.id === c.style) ?? null;
export const levelOf = (e, c) => e.levels?.find((l) => l.id === c.level) ?? null;
/** Contrôles qui s'appliquent au réglage en cours (Rythme : seulement pour Alternance ; Teinte : Monochrome…). */
export const controlsFor = (e, c) => e.controls.filter((k) => !k.when || k.when(c));

/** Durée maximale proposée : le plafond Sécurité du streamer (30 s par défaut) borne celui de l'effet. */
export const maxDuration = (e, capS = ENGINE.safetyDurationS) =>
  Math.max(e.duration.min, Math.min(e.duration.max, capS, ENGINE.maxDurationS));

export function defaultChoice(e) {
  const opts = {};
  for (const k of e.controls) opts[k.id] = k.def;
  return {
    style: (e.styles?.find((s) => s.default) ?? e.styles?.[0])?.id ?? null,
    level: e.levels?.find((l) => l.default)?.id ?? null,
    duration: e.duration.def,
    opts,
  };
}

/** Réglage cohérent avec le catalogue et le plafond de durée (valeurs inconnues → défaut). */
export function normalizeChoice(e, c, capS) {
  const d = defaultChoice(e);
  const out = { ...d, opts: { ...d.opts } };
  if (c?.style && e.styles?.some((s) => s.id === c.style)) out.style = c.style;
  if (c?.level && e.levels?.some((l) => l.id === c.level)) out.level = c.level;
  const max = maxDuration(e, capS);
  const dur = Number(c?.duration);
  if (Number.isFinite(dur)) out.duration = Math.min(max, Math.max(e.duration.min, Math.round(dur / e.duration.step) * e.duration.step));
  out.duration = Math.min(out.duration, max);
  for (const k of e.controls) {
    const v = c?.opts?.[k.id];
    if (v === undefined) continue;
    if (k.kind === 'choice' && k.options.some((o) => o.id === v)) out.opts[k.id] = v;
    if (k.kind === 'slider' && Number.isFinite(v)) out.opts[k.id] = Math.min(k.max, Math.max(k.min, Math.round(v / k.step) * k.step));
    if (k.kind === 'point' && Array.isArray(v)) out.opts[k.id] = v.map((x) => Math.min(1, Math.max(0, Math.round(Number(x) * 100) / 100 || 0)));
    if (k.kind === 'hue' && Number.isFinite(v)) out.opts[k.id] = ((Math.round(v) % 360) + 360) % 360;
    if (k.kind === 'toggle') out.opts[k.id] = Boolean(v);
  }
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

// --- Prix (FICTIFS, le Core les fixera) ---------------------------------------------------------------------------
// Prix = base de l'effet (10 s) × style × force × options × durée, arrondi à 50. Tout est montré au viewer, ligne par
// ligne, avant la confirmation : aucun coût caché derrière une option.
export const durationFactor = (s) => Math.round((0.4 + 0.06 * s) * 100) / 100; // 10 s = ×1 ; ±6 % par seconde

export function priceOf(e, c) {
  const lines = [{ label: 'Base · 10 s', value: e.base }];
  let k = 1;
  const add = (label, mult) => {
    if (!mult || mult === 1) return;
    lines.push({ label, mult });
    k *= mult;
  };
  const st = styleOf(e, c);
  if (st) add(st.label, st.mult);
  const lv = levelOf(e, c);
  if (lv) add(lv.label, lv.mult);
  for (const ctl of controlsFor(e, c)) {
    const v = c.opts?.[ctl.id];
    if (ctl.kind === 'choice') {
      const o = ctl.options.find((x) => x.id === v);
      if (o) add(o.label, o.mult);
    } else if (ctl.kind === 'slider' && ctl.mult) add(`${ctl.label} ${ctl.format(v)}`, ctl.mult(v));
  }
  add(`${c.duration} s`, durationFactor(c.duration));
  const total = Math.max(50, Math.round((e.base * k) / 50) * 50);
  return { total, lines };
}

/** Le moins cher d'un effet (« dès … » sur sa carte) : style et force les moins chers, durée minimale. */
export function minPrice(e) {
  let best = Infinity;
  for (const s of e.styles ?? [null])
    for (const l of e.levels ?? [null]) {
      const c = { ...defaultChoice(e), style: s?.id ?? null, level: l?.id ?? null, duration: e.duration.min };
      best = Math.min(best, priceOf(e, c).total);
    }
  return best;
}

/** Résumé d'un réglage en une ligne (suivi, historique, Régie). */
export function describeChoice(e, c) {
  const parts = [];
  const st = styleOf(e, c);
  if (st && (e.styles?.length ?? 0) > 1) parts.push(st.label);
  const lv = levelOf(e, c);
  if (lv) parts.push(lv.label);
  for (const ctl of controlsFor(e, c)) {
    const v = c.opts?.[ctl.id];
    if (ctl.kind === 'slider') parts.push(ctl.format(v));
    if (ctl.kind === 'toggle' && v) parts.push('monte peu à peu');
    if (ctl.kind === 'choice' && v !== ctl.def) parts.push(ctl.options.find((o) => o.id === v)?.label ?? v);
  }
  parts.push(`${c.duration} s`);
  return parts.join(' · ');
}

/**
 * La demande que le Core enverra au moteur pour ce réglage (protocole `effect.activate`, source externe : seuls les
 * paramètres exposés du registre sont permis). C'est la preuve que chaque option correspond à une capacité réelle.
 */
export function engineRequest(e, c) {
  const params = {};
  let transition = null;
  for (const ctl of controlsFor(e, c)) {
    const v = c.opts?.[ctl.id];
    if (ctl.kind === 'choice') {
      const o = ctl.options.find((x) => x.id === v);
      Object.assign(params, o?.params ?? {});
      if (o?.transition) transition = o.transition;
    } else if (ctl.kind === 'slider') params[ctl.param] = v;
    else if (ctl.kind === 'point') [params[ctl.params[0]], params[ctl.params[1]]] = v;
    else if (ctl.kind === 'hue') params[ctl.param] = hueHex(v);
    else if (ctl.kind === 'toggle' && v) params[ctl.param] = ctl.on;
  }
  const req = { effect: e.id, duration_ms: c.duration * 1000 };
  if (c.style) req.variant = c.style;
  if (c.level) req.level = c.level;
  if (Object.keys(params).length) req.params = params;
  if (transition) req.transition = transition;
  return req;
}
