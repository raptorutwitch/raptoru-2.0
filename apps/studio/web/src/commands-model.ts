import type { CmdConfig, CmdTeamRights } from '@raptoru/schemas';

// Commands V2 (Studio) — view model of the « Commandes » tab: vocabulary, wording, filters, grouping,
// draft bookkeeping. No business rule lives here: Core validates every change, decides every test
// (« Tester » calls Core's decide()), owns the categories, the rights and the history. Pure functions
// (no DOM), tested from apps/studio/server/test/commands-studio.test.ts.

export type Audience = CmdConfig['audience'];
export interface Category {
  category_id: string;
  name: string;
  icon: string;
  color: string;
  position: number;
}
export type Issue =
  | { code: 'word_reserved'; word: string; module: string }
  | {
      code: 'last_send_failed';
      status: string;
      error: string | null;
      at: string;
    }
  | { code: 'me_unsupported' };
export interface CommandItem {
  command_id: string;
  kind: 'custom' | 'system';
  owner_module: string | null;
  system_key: string | null;
  locked_fields: string[];
  defaults_version: number | null;
  version: number;
  config: CmdConfig;
  updated_at: string;
  updated_by: string;
  uses_30d?: number;
  issues?: Issue[];
}
export interface ListResponse {
  commands: CommandItem[];
  reserved_words: { word: string; module: string }[];
  categories: Category[];
}

// ------------------------------------------------------------------ vocabulary (validated prototype)

/** [group, label, short] — groups add up (OR); « Tout le monde » is exclusive. */
export const GROUPS: [Audience['groups'][number], string, string][] = [
  ['everyone', 'Tout le monde', 'Tout le monde'],
  ['followers', 'Followers', 'Followers'],
  ['subs', 'Abonnés', 'Abonnés'],
  ['vips', 'VIP', 'VIP'],
  ['mods', 'Modérateurs', 'Mods'],
  ['supermods', 'Supermodos', 'Supermodos'],
  ['broadcaster', 'Streamer', 'Streamer'],
];
const SHORT = Object.fromEntries(GROUPS.map((g) => [g[0], g[2]]));

export type ReplyMode = CmdConfig['reply']['mode'];
/** [mode, label, icon, explanation, sent by the Lab executor today]. */
export const MODES: [ReplyMode, string, string, string, boolean][] = [
  ['normal', 'Message', 'chat', 'Un message normal dans le chat.', true],
  [
    'me',
    '/me',
    'sparkles',
    'Non supporté aujourd’hui : Twitch n’accepte pas /me par la voie d’envoi utilisée (Send Chat Message). Le message ne serait pas envoyé.',
    false,
  ],
  [
    'announce',
    'Annonce',
    'megaphone',
    'Un encadré coloré mis en avant par Twitch, pour les infos importantes.',
    true,
  ],
  [
    'reply',
    'Réponse Twitch',
    'at',
    'Répond dans le fil du message du viewer : Twitch affiche son message au-dessus.',
    true,
  ],
  ['silent', 'Rien', 'off', 'Aucun message.', true],
];
/** [to, label, explanation] — « @pseudo » at the start of the message. */
export const TO: [CmdConfig['reply']['to'], string, string][] = [
  ['none', 'Personne', 'Pas de @ au début du message'],
  ['author', 'Celui qui tape la commande', '@pseudo de l’auteur au début'],
  ['target', 'La personne mentionnée', 'Le @pseudo écrit après la commande'],
  ['user', 'Un pseudo précis…', 'Toujours la même personne'],
];
/** [token, readable name, explanation, example, needs] — exactly Core's variables. */
export const VARIABLES: [
  string,
  string,
  string,
  string,
  'mention' | 'number' | null,
][] = [
  [
    '{display_name}',
    'Pseudo du viewer',
    'Le pseudo de celui qui tape la commande',
    'PixelMamie',
    null,
  ],
  [
    '{user}',
    'Identifiant du viewer',
    'Son login Twitch, en minuscules',
    'pixelmamie',
    null,
  ],
  [
    '{target}',
    'Personne mentionnée',
    'Le @pseudo écrit après la commande',
    'Aouh',
    'mention',
  ],
  [
    '{amount}',
    'Nombre saisi',
    'Le nombre écrit après la commande',
    '500',
    'number',
  ],
  [
    '{args}',
    'Texte saisi',
    'Tout le texte écrit après la commande',
    'bonne chance !',
    null,
  ],
  [
    '{count}',
    'Compteur d’utilisations',
    'Combien de fois la commande a été utilisée',
    '128',
    null,
  ],
];
export const COOLDOWN_PRESETS: [number, string][] = [
  [10, '10 s'],
  [30, '30 s'],
  [60, '1 min'],
  [300, '5 min'],
];
export const WINDOWS: [CmdConfig['quota']['window'], string][] = [
  ['hour', 'par heure'],
  ['live', 'par live'],
  ['day', 'par jour'],
  ['total', 'au total'],
];

// ------------------------------------------------------------------ wording

export const dur = (s: number) => {
  if (s < 60) return `${s} s`;
  if (s < 3600)
    return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${m}` : `${h} h`;
};

/** « VIP + Abonnés », « Uniquement Aouh », « Tout le monde · sauf TrollMan », « Personne ». */
export function whoShort(a: Audience) {
  let s: string;
  if (a.groups.includes('everyone')) s = 'Tout le monde';
  else if (a.groups.length)
    s = [...a.groups.map((g) => SHORT[g]), ...a.allow].join(' + ');
  else if (a.allow.length) s = `Uniquement ${a.allow.join(', ')}`;
  else s = 'Personne';
  return a.deny.length ? `${s} · sauf ${a.deny.join(', ')}` : s;
}
/** No implicit exemption: the streamer is in only through « Streamer », « Tout le monde » or the list. */
export function whoSentence(a: Audience) {
  if (a.groups.includes('everyone'))
    return a.deny.length
      ? 'Tout le monde, streamer compris, sauf les personnes exclues.'
      : 'Tout le monde, streamer compris.';
  if (!a.groups.length && !a.allow.length)
    return 'Personne ne peut l’utiliser.';
  return a.groups.includes('broadcaster')
    ? 'Seulement ces personnes. Une personne exclue ne peut jamais l’utiliser.'
    : 'Seulement ces personnes — le streamer aussi n’y a accès que s’il en fait partie (groupe Streamer).';
}
export const cooldownShort = (c: CmdConfig['cooldown']) =>
  c.enabled
    ? `${dur(c.seconds)} ${c.scope === 'viewer' ? 'par personne' : 'global'}`
    : 'Aucun';
export const cooldownText = (c: CmdConfig['cooldown']) =>
  c.enabled
    ? `Cooldown : ${dur(c.seconds)} ${c.scope === 'viewer' ? 'par personne' : 'pour tout le chat'}`
    : 'Aucun cooldown';
const WIN_SHORT = {
  hour: 'heure',
  live: 'live',
  day: 'jour',
  total: '',
} as const;
export const quotaShort = (q: CmdConfig['quota']) =>
  `${q.window === 'total' ? `${q.max} au total` : `${q.max} / ${WIN_SHORT[q.window]}`}${q.scope === 'viewer' ? ' par personne' : ''}`;
export const quotaText = (q: CmdConfig['quota']) =>
  q.enabled
    ? `Utilisations : ${q.max} ${WINDOWS.find((w) => w[0] === q.window)![1]} ${q.scope === 'viewer' ? 'par personne' : 'pour tout le chat'}`
    : 'Utilisations illimitées';

/** « !hug @cible [message] » */
export const syntax = (c: Pick<CmdConfig, 'name' | 'args'>) =>
  `!${c.name}${c.args
    .map((a) => {
      const w = a.type === 'mention' ? `@${a.name}` : a.name;
      return ` ${a.required ? w : `[${w}]`}`;
    })
    .join('')}`;
const EXAMPLE = { mention: '@Aouh', number: '500', text: 'bonne chance !' };
export const example = (c: Pick<CmdConfig, 'name' | 'args'>) =>
  `!${c.name}${c.args
    .filter((a) => a.required)
    .map((a) => ` ${EXAMPLE[a.type]}`)
    .join('')}`;

/** A variable needs an argument of its type (Core refuses the configuration otherwise). */
export const variableMissing = (
  c: Pick<CmdConfig, 'args'>,
  needs: 'mention' | 'number' | null,
) => !!needs && !c.args.some((a) => a.type === needs);

/** Inserts a token at the caret (a space before it when glued to a word). */
export function insertAt(
  text: string,
  start: number,
  end: number,
  token: string,
) {
  const ins = start && !/\s$/.test(text.slice(0, start)) ? ` ${token}` : token;
  return {
    text: text.slice(0, start) + ins + text.slice(end),
    caret: start + ins.length,
  };
}

/** Example rendering for « Aperçu dans le chat » (the real one is Core's, in « Tester »). */
export function previewText(m: {
  mode: ReplyMode;
  text: string;
  to: string;
  to_login?: string;
}) {
  const ex = Object.fromEntries(
    VARIABLES.map((v) => [v[0], v[0] === '{target}' ? 'Aouh' : v[3]]),
  );
  const body = m.text.replace(/\{[a-z_]+\}/g, (t) => ex[t] ?? t);
  const to =
    m.mode === 'reply'
      ? ''
      : m.to === 'author'
        ? 'PixelMamie'
        : m.to === 'target'
          ? 'Aouh'
          : m.to === 'user'
            ? (m.to_login ?? '…')
            : '';
  return `${to ? `@${to} ` : ''}${body}`;
}

// ------------------------------------------------------------------ state of a command (from Core)

export interface State {
  key: 'ok' | 'off' | 'reserved' | 'send' | 'me';
  label: string;
  tone: 'ok' | 'off' | 'bad' | 'warn';
  why: string;
}
const SEND: Record<string, string> = {
  failed: 'a échoué',
  unknown: 'est incertain (peut-être envoyé, jamais renvoyé)',
  expired: 'a expiré sans être envoyé',
};
/** One state, worst first. The switch only shows enabled; these are secondary. */
export function stateOf(c: CommandItem): State {
  const issue = c.issues?.[0];
  if (!c.config.enabled && !issue)
    return { key: 'off', label: 'Désactivée', tone: 'off', why: 'Désactivée' };
  if (issue?.code === 'word_reserved')
    return {
      key: 'reserved',
      label: 'Mot réservé',
      tone: 'bad',
      why: `!${issue.word} appartient au module ${issue.module} : ce mot ne lance pas cette commande.`,
    };
  if (issue?.code === 'last_send_failed')
    return {
      key: 'send',
      label:
        issue.status === 'unknown'
          ? 'Envoi incertain'
          : issue.status === 'expired'
            ? 'Envoi expiré'
            : 'Envoi échoué',
      tone: 'warn',
      why: `Le dernier envoi ${SEND[issue.status] ?? issue.status}${issue.error ? ` (${issue.error})` : ''}.`,
    };
  if (issue?.code === 'me_unsupported')
    return {
      key: 'me',
      label: '/me non envoyé',
      tone: 'warn',
      why: 'Un message en /me n’est pas envoyé aujourd’hui (Twitch : /me indisponible par l’API utilisée).',
    };
  return c.config.enabled
    ? { key: 'ok', label: 'Active', tone: 'ok', why: 'Fonctionne normalement' }
    : { key: 'off', label: 'Désactivée', tone: 'off', why: 'Désactivée' };
}
export const needsCheck = (c: CommandItem) => (c.issues?.length ?? 0) > 0;

// ------------------------------------------------------------------ filters, grouping, counts

export type StateFilter = 'all' | 'check' | 'off' | 'hidden';
export interface ListUi {
  side: StateFilter | 'fav';
  cat: 'all' | 'none' | string;
  group: boolean;
  q: string;
}
export const NO_CATEGORY: Category = {
  category_id: '',
  name: 'Sans catégorie',
  icon: 'folder',
  color: '#94a3b8',
  position: Number.MAX_SAFE_INTEGER,
};
/** A category id the channel does not have (deleted, legacy) counts as « Sans catégorie ». */
export const categoryOf = (c: CommandItem, cats: Category[]) =>
  cats.find((k) => k.category_id === c.config.category) ?? NO_CATEGORY;
const inState = (k: ListUi['side'], c: CommandItem, fav: Set<string>) =>
  k === 'all' ||
  (k === 'fav'
    ? fav.has(c.command_id)
    : k === 'check'
      ? needsCheck(c)
      : k === 'off'
        ? !c.config.enabled
        : !c.config.listed);
const inCat = (ui: ListUi, c: CommandItem, cats: Category[]) =>
  ui.cat === 'all' ||
  (ui.cat === 'none'
    ? categoryOf(c, cats) === NO_CATEGORY
    : c.config.category === ui.cat);
/** Name or alias contains the search (with or without « ! »), or the description. */
export const matches = (c: CommandItem, q: string) => {
  const w = q.trim().toLowerCase().replace(/^!+/, '');
  if (!w) return { ok: true, via: null as string | null };
  if (c.config.name.includes(w)) return { ok: true, via: null };
  const al = c.config.aliases.find((a) => a.includes(w));
  if (al) return { ok: true, via: al };
  return { ok: c.config.description.toLowerCase().includes(w), via: null };
};
export function visible(
  list: CommandItem[],
  cats: Category[],
  ui: ListUi,
  fav = new Set<string>(),
) {
  return list
    .map((c) => ({ c, m: matches(c, ui.q) }))
    .filter(
      ({ c, m }) => m.ok && inState(ui.side, c, fav) && inCat(ui, c, cats),
    )
    .map(({ c, m }) => ({ c, via: m.via }));
}
/** Counters of the state filters follow the category filter and the search. */
export function counts(
  list: CommandItem[],
  cats: Category[],
  ui: ListUi,
  fav = new Set<string>(),
) {
  const base = list.filter((c) => matches(c, ui.q).ok && inCat(ui, c, cats));
  return {
    all: base.length,
    fav: base.filter((c) => fav.has(c.command_id)).length,
    check: base.filter(needsCheck).length,
    off: base.filter((c) => !c.config.enabled).length,
    hidden: base.filter((c) => !c.config.listed).length,
  };
}
/** Grouped by category (streamer's order, « Sans catégorie » last) unless a category is chosen or grouping is off. */
export function groups<T extends { c: CommandItem }>(
  rows: T[],
  cats: Category[],
  ui: ListUi,
): [Category | null, T[]][] {
  if (!ui.group || ui.cat !== 'all') return [[null, rows]];
  const ordered = [...cats].sort((a, b) => a.position - b.position);
  return [...ordered, NO_CATEGORY]
    .map((k): [Category, T[]] => [
      k,
      rows.filter((r) => categoryOf(r.c, cats) === k),
    ])
    .filter(([, l]) => l.length);
}

// ------------------------------------------------------------------ editing

const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
        )
      : v;
export const same = (a: unknown, b: unknown) =>
  JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** Top-level fields the draft changed (what « Enregistrer » sends). */
export function changes(base: CmdConfig, draft: CmdConfig): Partial<CmdConfig> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(draft) as (keyof CmdConfig)[])
    if (!same(base[k], draft[k])) out[k] = draft[k];
  return out as Partial<CmdConfig>;
}

/**
 * Someone else saved meanwhile (409): my changes are re-applied on top of the current version, never
 * silently over it — the streamer reviews and saves again. `both` = fields both of us changed (mine is
 * kept in the draft, theirs shown).
 */
export function reapply(base: CmdConfig, draft: CmdConfig, current: CmdConfig) {
  const mine = changes(base, draft);
  const theirs = changes(base, current);
  const both = (Object.keys(mine) as (keyof CmdConfig)[]).filter(
    (k) => k in theirs && !same(mine[k], current[k]),
  );
  return {
    draft: { ...current, ...mine } as CmdConfig,
    both,
    theirs: Object.keys(theirs) as (keyof CmdConfig)[],
  };
}

/** Starting point of « Nouvelle commande » (Core fills and validates the rest). */
export const blank = (category: string | null): Partial<CmdConfig> => ({
  name: '',
  aliases: [],
  description: '',
  category,
  enabled: true,
  listed: true,
  audience: { groups: ['everyone'], allow: [], deny: [] },
  cooldown: { enabled: true, seconds: 30, unit: 's', scope: 'viewer' },
  quota: { enabled: false, max: 4, window: 'hour', scope: 'global' },
  reply: { mode: 'normal', text: '', to: 'none' },
});

/** The unit shown for a duration in seconds (Core: seconds must be a whole number of the unit). */
export const unitOf = (s: number): CmdConfig['cooldown']['unit'] =>
  s % 3600 === 0 ? 'h' : s % 60 === 0 ? 'min' : 's';

/** Normalised word (lower case, a-z 0-9 _), as Core expects it. */
export const word = (w: string) =>
  String(w || '')
    .trim()
    .toLowerCase()
    .replace(/^!+/, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 25);

// ------------------------------------------------------------------ Core's answers, in words

/** Field names of Core's history and refusals. */
export const FIELD: Record<string, string> = {
  name: 'Nom',
  aliases: 'Alias',
  description: 'Description',
  category: 'Catégorie',
  appearance: 'Apparence',
  enabled: 'Activée',
  listed: 'Liste publique',
  'audience.groups': 'Groupes',
  'audience.allow': 'Personnes autorisées',
  'audience.deny': 'Personnes exclues',
  cooldown: 'Cooldown',
  quota: 'Utilisations',
  reply: 'Réponse',
  args: 'Arguments',
  actions: 'Actions',
  reply_first: 'Ordre réponse / actions',
  when: 'Disponibilité',
  refuse: 'Message de refus',
  team_lock: 'Verrou équipe',
};
export const CHECK: Record<string, string> = {
  found: 'Commande trouvée',
  enabled: 'Activée',
  config: 'Configuration valide',
  available: 'Disponible maintenant (live / hors live)',
  audience: 'Accès autorisé',
  arguments: 'Arguments',
  variables: 'Variables',
  cooldown: 'Cooldown',
  quota: 'Utilisations',
  reserved: 'Mot réservé à un module',
  not_found: 'Commande trouvée',
  disabled: 'Activée',
  invalid_config: 'Configuration valide',
  unavailable: 'Disponible maintenant (live / hors live)',
  denied_user: 'Accès autorisé',
  access_denied: 'Accès autorisé',
  follower_status_unknown: 'Accès autorisé',
  invalid_arguments: 'Arguments',
};
export const REASON: Record<string, string> = {
  reserved: 'Mot réservé à un module',
  not_found: 'Commande inconnue',
  disabled: 'Désactivée',
  invalid_config: 'Configuration à corriger',
  unavailable: 'Pas disponible maintenant',
  denied_user: 'Personne exclue',
  access_denied: 'Pas autorisé',
  follower_status_unknown: 'Follow inconnu',
  invalid_arguments: 'Arguments manquants ou invalides',
  cooldown: 'Cooldown en cours',
  quota: 'Maximum atteint',
  duplicate_message: 'Message déjà traité',
};
export const STEP: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off']> = {
  queued: ['En attente', 'off'],
  claimed: ['Pris en charge', 'off'],
  running: ['Envoi en cours', 'off'],
  succeeded: ['Envoyé', 'ok'],
  failed: ['Échec', 'bad'],
  unknown: ['Incertain', 'warn'],
  expired: ['Expiré', 'warn'],
  cancelled: ['Annulé', 'off'],
  skipped: ['Non envoyé', 'warn'],
};
/** Core error codes of a save, in words (the rest shows Core's code). */
export const SAVE_ERROR: Record<string, string> = {
  word_taken: 'Ce mot lance déjà une autre commande',
  word_reserved: 'Ce mot appartient à un module',
  invalid_config: 'La configuration est à corriger',
  field_locked: 'Ce champ est verrouillé par son module',
  module_action_protected: 'L’action du module est protégée',
  unknown_category: 'Cette catégorie n’existe plus',
  category_name_taken: 'Une catégorie porte déjà ce nom',
  system_command: 'Une commande de module ne se supprime pas (désactive-la)',
};

/** Team rights (Phase A model), as rows of the « Droits de l’équipe » table. */
export const RIGHTS: [keyof CmdTeamRights, string, string?][] = [
  ['toggle', 'Activer ou désactiver une commande'],
  ['reply', 'Modifier la réponse', 'texte, façon de répondre, mention'],
  [
    'rename',
    'Renommer les commandes',
    'le mot principal ; les alias ont leur propre réglage',
  ],
  ['aliases', 'Modifier les alias'],
  [
    'audience',
    'Changer qui peut l’utiliser',
    'groupes et personnes autorisées',
  ],
  ['exclusions', 'Exclure des personnes'],
  ['cooldown', 'Changer le cooldown', 'avec un minimum'],
  ['quota', 'Changer les utilisations'],
  ['listed', 'Afficher ou cacher dans la liste publique'],
  ['volume', 'Régler le volume des sons', 'entre deux bornes'],
  ['create', 'Créer une commande simple (une réponse)'],
  ['remove', 'Supprimer une commande', 'sauf celles des modules'],
];
