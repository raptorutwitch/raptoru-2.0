// Raptoru Studio — REGISTRE de navigation (refonte UX, docs/RAPTORU_STUDIO_UX_UI_2026-11-04.md § B.2, E.3).
// Un index, pas un moteur : chaque page a UNE adresse canonique (`?p=<id>`) et affiche soit une vue existante (`view`,
// montée une seule fois par main.ts), soit une page de regroupement du shell (`hub`). Aucun prix, aucune permission,
// aucune règle métier ici : la barre latérale, le catalogue, les favoris et la palette Ctrl+K lisent ce registre et
// ouvrent la même vue. Les anciens liens `?tab=<id>` restent des alias exacts (e2e, liens internes, habitudes).

/** Les vues historiques (identifiants d'onglet de Studio 0.1.25, gardés comme contrat). */
// One declaration of the view ids (architecture socle: was declared 3 times). A new view = one id here + its mount.
export const VIEW_IDS = [
  'studio',
  'moderation',
  'tombola',
  'commands',
  'word-game',
  'mini-games',
  'alerts',
  'channel-points',
  'effects',
  'random-ban',
  'caution',
  'votekick',
  'simulation',
  'test-lab',
  'extension-lab',
  'soundboard',
  'halloween',
  'progression',
  'shop',
  'challenges',
  'modules',
  'tts',
  'bonk',
  'spotify',
  'sub-wheel',
] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export type SectionId =
  | 'centre'
  | 'regie'
  | 'modules'
  | 'communaute'
  | 'activite'
  | 'systeme'
  | 'labo';

export interface Section {
  id: SectionId;
  label: string;
  icon: IconName;
  /** Page ouverte par un clic sur la rubrique. */
  home: string;
}

export interface Page {
  id: string;
  label: string;
  section: SectionId;
  /** Sous-groupe du catalogue (Modules) ou de la rubrique. */
  group?: string;
  icon: IconName;
  /** Une phrase : ce qu'on y fait (catalogue, palette). */
  desc: string;
  /** Vue existante affichée, avec ses paramètres d'adresse (ex. surface=panel pour l'Extension Lab). */
  view?: ViewId;
  params?: Record<string, string>;
  /** Partie de la vue qui est cette page (`setFocus` de la vue), ex. Spotify dans la vue Récompenses Twitch. */
  anchor?: string;
  /** Page de regroupement rendue par le shell. */
  hub?: 'centre' | 'regie' | 'modules' | 'communaute' | 'activite' | 'labo';
  /** Mots-clés de la palette (anciens noms, synonymes). */
  keywords?: string;
  /** Jeton de couleur discret de sa famille (barre latérale). */
  tint?: string;
}

export type IconName =
  | 'home'
  | 'live'
  | 'grid'
  | 'users'
  | 'activity'
  | 'settings'
  | 'flask'
  | 'star'
  | 'search'
  | 'sound'
  | 'bell'
  | 'gift'
  | 'dice'
  | 'sparkle'
  | 'shield'
  | 'music'
  | 'terminal'
  | 'pumpkin'
  | 'trophy'
  | 'shop'
  | 'level'
  | 'user'
  | 'mod'
  | 'puzzle'
  | 'wheel'
  | 'mic'
  | 'film'
  | 'menu'
  | 'close'
  | 'chevron'
  | 'external';

export const SECTIONS: readonly Section[] = [
  { id: 'centre', label: 'Centre de contrôle', icon: 'home', home: 'centre' },
  { id: 'regie', label: 'Régie live', icon: 'live', home: 'regie' },
  { id: 'modules', label: 'Modules', icon: 'grid', home: 'modules' },
  { id: 'communaute', label: 'Communauté', icon: 'users', home: 'communaute' },
  { id: 'activite', label: 'Activité', icon: 'activity', home: 'activite' },
  { id: 'systeme', label: 'Système', icon: 'settings', home: 'systeme' },
];
/** Le Laboratoire : accessible à part, en bas de la barre (jamais mêlé à la navigation principale). */
export const LAB_SECTION: Section = {
  id: 'labo',
  label: 'Laboratoire',
  icon: 'flask',
  home: 'labo',
};

export const PAGES: Page[] = [
  // --- Centre / Régie --------------------------------------------------------------------------------------------
  {
    id: 'centre',
    label: 'Centre de contrôle',
    section: 'centre',
    icon: 'home',
    hub: 'centre',
    desc: 'État général, incidents, préparation du live.',
    keywords: 'accueil supervision incidents santé',
  },
  {
    id: 'regie',
    label: 'Régie live',
    section: 'regie',
    icon: 'live',
    hub: 'regie',
    desc: 'Interventions rapides pendant le stream.',
    keywords: 'live stream contrôle rapide',
  },
  {
    id: 'moderation',
    label: 'Modération',
    section: 'regie',
    icon: 'mod',
    view: 'moderation',
    desc: 'Files D4, sanctions, remboursements, équipe, audit.',
    keywords: 'd4 sanctions supermods remboursement tombola studio wallet test',
  },
  // --- Modules ---------------------------------------------------------------------------------------------------
  {
    id: 'modules',
    label: 'Modules',
    section: 'modules',
    icon: 'grid',
    hub: 'modules',
    desc: 'Catalogue de toutes les fonctionnalités.',
  },
  {
    id: 'soundboard',
    label: 'Soundboard',
    section: 'modules',
    group: 'Sons & voix',
    icon: 'sound',
    view: 'soundboard',
    desc: 'Banque de sons, réglages, lecteur.',
    keywords: 'sons lecteur audio',
  },
  {
    id: 'tts',
    label: 'TTS',
    section: 'modules',
    group: 'Sons & voix',
    icon: 'mic',
    view: 'tts',
    desc: 'File, source OBS, prix et limites.',
    keywords: 'text to speech voix',
  },
  {
    id: 'alerts',
    label: 'Alertes',
    section: 'modules',
    group: 'Alertes & points de chaîne',
    icon: 'bell',
    view: 'alerts',
    desc: 'Profils, variantes, déclencheurs, file et historique.',
    keywords: 'follow sub bits raid streamelements',
  },
  {
    id: 'channel-points',
    label: 'Récompenses Twitch',
    section: 'modules',
    group: 'Alertes & points de chaîne',
    icon: 'gift',
    view: 'channel-points',
    desc: 'Points de chaîne : récompenses, actions liées, historique.',
    keywords: 'points de chaîne channel points récompenses effets',
  },
  {
    id: 'tombola',
    label: 'Tombola',
    section: 'modules',
    group: 'Jeux & tirages',
    icon: 'dice',
    view: 'tombola',
    desc: 'Préparer, en direct, historique.',
    keywords: 'raffle tirage giveaway',
  },
  {
    id: 'word-game',
    label: 'Jeu des mots',
    section: 'modules',
    group: 'Jeux & tirages',
    icon: 'puzzle',
    view: 'word-game',
    desc: 'Manches, mots, révélation locale.',
    keywords: 'mots jdm',
  },
  {
    id: 'sub-wheel',
    label: 'Roue du Sub',
    section: 'modules',
    group: 'Jeux & tirages',
    icon: 'wheel',
    view: 'sub-wheel',
    desc: 'Droits, file, à vérifier.',
    keywords: 'roue sub wheel',
  },
  {
    id: 'mini-games',
    // Its own page; the anchor links the host's module `mini_games` to it (catalogue, supervision).
    anchor: 'mini_games',
    label: 'Roulette · Slots · Duels',
    section: 'modules',
    group: 'Jeux & tirages',
    icon: 'dice',
    view: 'mini-games',
    desc: 'Interrupteur, mises, délais et derniers tirages.',
    keywords: 'roulette slot machine duel',
  },
  {
    id: 'bonk',
    label: 'Bonk',
    section: 'modules',
    group: 'Effets & mise en scène',
    icon: 'sparkle',
    view: 'bonk',
    desc: 'Connexion OBS, overlay, zone d’impact, prix.',
    keywords: 'bonk overlay obs',
  },
  {
    id: 'effects',
    label: 'Effets & lecteur d’effets',
    section: 'modules',
    group: 'Effets & mise en scène',
    icon: 'film',
    view: 'effects',
    desc: 'FX Cam, couleur cam, lecteur d’effets.',
    keywords: 'fx cam couleur effets obs',
  },
  {
    id: 'random-ban',
    label: 'Random Ban',
    section: 'modules',
    group: 'Interactions à sanction',
    icon: 'shield',
    view: 'random-ban',
    desc: 'Tirage, mute OBS du streamer, suivi.',
    keywords: 'rb ban timeout',
  },
  {
    id: 'caution',
    label: 'Caution',
    section: 'modules',
    group: 'Interactions à sanction',
    icon: 'shield',
    view: 'caution',
    desc: 'Libérer une sanction contre des Jetons.',
    keywords: 'caution libération',
  },
  {
    id: 'votekick',
    label: 'Votekick',
    section: 'modules',
    group: 'Interactions à sanction',
    icon: 'shield',
    view: 'votekick',
    desc: 'Durée de vote, son de lancement.',
    keywords: 'vote kick',
  },
  {
    id: 'spotify',
    label: 'Spotify',
    section: 'modules',
    group: 'Musique',
    icon: 'music',
    view: 'spotify',
    desc: 'Demandes de musique, file, quotas.',
    keywords: 'musique song request file musicale',
  },
  {
    id: 'commands',
    label: 'Commandes du chat',
    section: 'modules',
    group: 'Commandes du chat',
    icon: 'terminal',
    view: 'commands',
    desc: 'Commandes, alias, droits, étapes.',
    keywords: 'commandes chat !commande',
  },
  {
    id: 'halloween',
    label: 'Halloween',
    section: 'modules',
    group: 'Événements saisonniers',
    icon: 'pumpkin',
    view: 'halloween',
    desc: 'Boutique Bonbons, screamers, ambiance, chaos.',
    keywords: 'événement saison bonbons screamer',
  },
  // --- Communauté -----------------------------------------------------------------------------------------------
  {
    id: 'communaute',
    label: 'Communauté',
    section: 'communaute',
    icon: 'users',
    hub: 'communaute',
    desc: 'Viewers, progression, boutique, défis.',
  },
  {
    id: 'progression',
    label: 'Progression & viewers',
    section: 'communaute',
    icon: 'level',
    view: 'progression',
    desc: 'Règles XP, viewers, titres et badges, attribution.',
    keywords: 'xp niveaux viewers titres badges daily',
  },
  {
    id: 'shop',
    label: 'Boutique',
    section: 'communaute',
    icon: 'shop',
    view: 'shop',
    desc: 'Catalogue, atelier, offres, achats et retours.',
    keywords: 'cosmétiques cadres bannières titres badges offres achats',
  },
  {
    id: 'challenges',
    label: 'Défis',
    section: 'communaute',
    icon: 'trophy',
    view: 'challenges',
    desc: 'Catalogue, atelier, suivi et récompenses.',
    keywords: 'succès achievements',
  },
  // --- Activité / Système ---------------------------------------------------------------------------------------
  {
    id: 'activite',
    label: 'Activité',
    section: 'activite',
    icon: 'activity',
    hub: 'activite',
    desc: 'Incidents, historiques et journaux des modules.',
    keywords: 'historique journal incidents',
  },
  {
    id: 'systeme',
    label: 'Système',
    section: 'systeme',
    icon: 'settings',
    view: 'studio',
    desc: 'Profil Lab ou Production, serveur, bot, comptes Twitch, OBS, lecteurs.',
    keywords: 'profil production lab connexions obs twitch runtime appairage',
  },
  // --- Laboratoire -----------------------------------------------------------------------------------------------
  {
    id: 'labo',
    label: 'Laboratoire',
    section: 'labo',
    icon: 'flask',
    hub: 'labo',
    desc: 'Simulation, services de test, Extension Lab.',
  },
  {
    id: 'simulation',
    label: 'Simulation',
    section: 'labo',
    icon: 'flask',
    view: 'simulation',
    desc: 'Live simulé, chat fictif, scénarios.',
    keywords: 'sim chat fictif',
  },
  // Architecture socle: the overview of the module host. Each of its modules has a page, added from the Core's catalog.
  {
    id: 'socle-modules',
    label: 'Modules du socle',
    section: 'labo',
    icon: 'grid',
    view: 'modules',
    desc: 'Modules construits sur le socle commun : état, réglages, actions, activité.',
    keywords: 'socle module catalogue démonstration',
  },
  {
    id: 'test-lab',
    label: 'Test Lab',
    section: 'labo',
    icon: 'terminal',
    view: 'test-lab',
    desc: 'Core 3000, bot, journaux.',
    keywords: 'services logs',
  },
  {
    id: 'extension-lab',
    label: 'Extension Lab',
    section: 'labo',
    icon: 'puzzle',
    view: 'extension-lab',
    desc: 'Surfaces de l’extension, rôles, identités de test.',
    keywords: 'extension hub vidéo panel mobile',
  },
];

const TINT: Record<string, string> = {
  tts: 'blue',
  tombola: 'teal',
  alerts: 'violet',
  soundboard: 'green',
  bonk: 'orange',
  spotify: 'green',
  commands: 'violet',
  'sub-wheel': 'gold',
  'channel-points': 'rose',
  'word-game': 'teal',
  'random-ban': 'red',
  caution: 'red',
  votekick: 'red',
  moderation: 'red',
  effects: 'orange',
  halloween: 'orange',
};
for (const p of PAGES) p.tint = TINT[p.id];

const BY_ID = new Map(PAGES.map((p) => [p.id, p]));

/**
 * A module of the Core without a page of its own gets the generic one: the catalogue, the palette, favourites and
 * routing follow by themselves, so a new module needs no line here. Idempotent.
 */
export function addHostModulePages(
  modules: { id: string; label: string; description: string }[],
) {
  for (const m of modules) {
    const id = m.id.replace(/_/g, '-');
    if (BY_ID.has(id) || PAGES.some((p) => p.anchor === m.id)) continue;
    const page: Page = {
      id,
      label: m.label,
      section: 'modules',
      group: 'Nouveaux modules',
      icon: 'puzzle',
      view: 'modules',
      anchor: m.id,
      desc: m.description,
    };
    PAGES.push(page);
    BY_ID.set(id, page);
  }
}
export const pageById = (id: string | null | undefined) =>
  id ? BY_ID.get(id) : undefined;
export const sectionOf = (p: Page) =>
  p.section === 'labo'
    ? LAB_SECTION
    : SECTIONS.find((s) => s.id === p.section)!;

/** Alias historiques : `?tab=<ViewId>` → la page canonique qui l'affiche. */
/** Historical `?tab=<id>` aliases (views created before the shell only). */
const LEGACY: Partial<Record<ViewId, string>> = {
  studio: 'systeme',
  moderation: 'moderation',
  tombola: 'tombola',
  commands: 'commands',
  'word-game': 'word-game',
  alerts: 'alerts',
  'channel-points': 'channel-points',
  simulation: 'simulation',
  'test-lab': 'test-lab',
  'extension-lab': 'extension-lab',
  soundboard: 'soundboard',
  halloween: 'halloween',
  progression: 'progression',
  shop: 'shop',
  challenges: 'challenges',
};
export const pageForLegacyTab = (tab: string | null) =>
  tab && (VIEW_IDS as readonly string[]).includes(tab)
    ? // A view without a historical alias: its first page (no list to maintain for new views).
      pageById(
        LEGACY[tab as ViewId] ??
          PAGES.find((p) => p.view === tab && !p.anchor)?.id ??
          PAGES.find((p) => p.view === tab)?.id ??
          '',
      )
    : undefined;

/** Adresse canonique d'une page (les paramètres de vue, ex. surface, suivent). */
export function hrefOf(p: Page, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ p: p.id, ...(p.params ?? {}), ...extra });
  return `/?${q.toString()}`;
}

/** Page demandée par une adresse : `?p=` d'abord, puis l'ancien `?tab=`. */
export function pageFromSearch(search: string): Page | undefined {
  const q = new URLSearchParams(search);
  return pageById(q.get('p')) ?? pageForLegacyTab(q.get('tab'));
}

/** Fil d'Ariane : rubrique › (groupe) › page — trois niveaux au plus, jamais sur une page d'accueil de rubrique. */
export function crumbsOf(p: Page): string[] {
  const s = sectionOf(p);
  if (s.home === p.id) return [s.label];
  return [s.label, ...(p.group ? [p.group] : []), p.label];
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Palette : pages correspondant à une recherche (libellé, groupe, rubrique, mots-clés), les plus pertinentes d'abord. */
export function searchPages(query: string, limit = 12): Page[] {
  const q = norm(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored = PAGES.map((p) => {
    const label = norm(p.label);
    const hay = norm(
      `${p.label} ${p.group ?? ''} ${sectionOf(p).label} ${p.keywords ?? ''} ${p.desc}`,
    );
    if (!words.every((w) => hay.includes(w))) return null;
    const score =
      (label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2) + (p.hub ? 0.5 : 0);
    return { p, score };
  }).filter((x): x is { p: Page; score: number } => !!x);
  return scored
    .sort((a, b) => a.score - b.score || a.p.label.localeCompare(b.p.label))
    .slice(0, limit)
    .map((x) => x.p);
}

/** Catalogue Modules : groupes dans l'ordre du registre. */
export function moduleGroups(): { group: string; pages: Page[] }[] {
  const out: { group: string; pages: Page[] }[] = [];
  for (const p of PAGES) {
    if (p.section !== 'modules' || p.hub) continue;
    const g =
      out.find((x) => x.group === p.group) ??
      (out.push({ group: p.group ?? 'Autres', pages: [] }),
      out[out.length - 1]!);
    g.pages.push(p);
  }
  return out;
}
