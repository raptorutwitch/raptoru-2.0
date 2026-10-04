// Commands V2 — view model of the extension's « Modération › Commandes » (phase E). Wording, filters,
// grouping, draft bookkeeping, and a display-only reading of the rights Core returned (`/me`): what is
// shown editable. Core still checks every change (rights, bounds, locks, version) and refuses the rest.
// Same vocabulary as Studio's tab (apps/studio/web/src/commands-model.ts). Pure functions, no DOM.

export const GROUPS = [
  ['everyone', 'Tout le monde', 'Tout le monde'],
  ['followers', 'Followers', 'Followers'],
  ['subs', 'Abonnés', 'Abonnés'],
  ['vips', 'VIP', 'VIP'],
  ['mods', 'Modérateurs', 'Mods'],
  ['supermods', 'Supermodos', 'Supermodos'],
  ['broadcaster', 'Streamer', 'Streamer'],
];
const SHORT = Object.fromEntries(GROUPS.map((g) => [g[0], g[2]]));
/** [mode, label, icon, explanation, sent by the Lab executor today]. */
export const MODES = [
  ['normal', 'Message', 'chat', 'Un message normal dans le chat.', true],
  ['me', '/me', 'sparkles', 'Non supporté aujourd’hui : Twitch n’accepte pas /me par la voie d’envoi utilisée. Le message ne serait pas envoyé.', false],
  ['announce', 'Annonce', 'megaphone', 'Un encadré coloré mis en avant par Twitch.', true],
  ['reply', 'Réponse Twitch', 'at', 'Répond dans le fil du message du viewer.', true],
  ['silent', 'Rien', 'off', 'Aucun message.', true],
];
export const TO = [
  ['none', 'Personne', 'Pas de @ au début'],
  ['author', 'Celui qui tape la commande', '@pseudo de l’auteur'],
  ['target', 'La personne mentionnée', 'Le @pseudo écrit après la commande'],
  ['user', 'Un pseudo précis…', 'Toujours la même personne'],
];
/** [token, readable name, explanation, example, needs] — exactly Core's variables. */
export const VARIABLES = [
  ['{display_name}', 'Pseudo du viewer', 'Le pseudo de celui qui tape la commande', 'PixelMamie', null],
  ['{user}', 'Identifiant du viewer', 'Son login Twitch, en minuscules', 'pixelmamie', null],
  ['{target}', 'Personne mentionnée', 'Le @pseudo écrit après la commande', 'Aouh', 'mention'],
  ['{amount}', 'Nombre saisi', 'Le nombre écrit après la commande', '500', 'number'],
  ['{args}', 'Texte saisi', 'Tout le texte écrit après la commande', 'bonne chance !', null],
  ['{count}', 'Compteur d’utilisations', 'Combien de fois la commande a été utilisée', '128', null],
];
export const COOLDOWN_PRESETS = [
  [10, '10 s'],
  [30, '30 s'],
  [60, '1 min'],
  [300, '5 min'],
];
export const WINDOWS = [
  ['hour', 'par heure'],
  ['live', 'par live'],
  ['day', 'par jour'],
  ['total', 'au total'],
];
export const REASON = {
  reserved: 'Mot réservé à un module',
  not_found: 'Commande inconnue',
  disabled: 'Désactivée',
  invalid_config: 'Configuration à corriger',
  unavailable: 'Pas disponible maintenant',
  denied_user: 'Personne exclue',
  access_denied: 'Pas autorisé',
  follower_status_unknown: 'Follow inconnu',
  invalid_arguments: 'Arguments manquants',
  cooldown: 'Cooldown en cours',
  quota: 'Maximum atteint',
  duplicate_message: 'Message déjà traité',
};
export const STEP = {
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
export const FIELD = {
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
  reply_first: 'Ordre',
  when: 'Disponibilité',
  refuse: 'Message de refus',
  team_lock: 'Verrou équipe',
};
/** Core refusals of a save, in words. */
export const SAVE_ERROR = {
  version_conflict: 'Modifiée ailleurs entre-temps',
  field_not_delegated: 'Ce réglage n’est pas délégué à ton rôle',
  cooldown_below_minimum: 'Cooldown en dessous du minimum autorisé',
  command_locked: 'Commande verrouillée par le streamer',
  not_delegated: 'Action non déléguée à ton rôle',
  field_locked: 'Champ verrouillé par son module',
  word_taken: 'Ce mot lance déjà une autre commande',
  word_reserved: 'Ce mot appartient à un module',
  invalid_config: 'Configuration à corriger',
  unknown_category: 'Cette catégorie n’existe plus',
  system_command: 'Une commande de module ne se supprime pas',
  team_only: 'Réservé à l’équipe',
  invalid_request: 'Valeur invalide (nom : lettres, chiffres et _ uniquement)',
};
/** Core's configuration issues, in words (the others are shown as Core wrote them). */
export const ISSUE = {
  'an alias repeats the name': 'le nom est déjà un alias de cette commande',
  'duplicate alias': 'alias en double',
  'name: required': 'le nom est obligatoire',
};

export const dur = (s) => {
  if (s < 60) return `${s} s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${m}` : `${h} h`;
};
export function whoShort(a) {
  let s;
  if (a.groups.includes('everyone')) s = 'Tout le monde';
  else if (a.groups.length) s = [...a.groups.map((g) => SHORT[g]), ...a.allow].join(' + ');
  else if (a.allow.length) s = `Uniquement ${a.allow.join(', ')}`;
  else s = 'Personne';
  return a.deny.length ? `${s} · sauf ${a.deny.join(', ')}` : s;
}
/** No implicit exemption: the streamer is in only through « Streamer », « Tout le monde » or the list. */
export function whoSentence(a) {
  if (a.groups.includes('everyone')) return a.deny.length ? 'Tout le monde, streamer compris, sauf les personnes exclues.' : 'Tout le monde, streamer compris.';
  if (!a.groups.length && !a.allow.length) return 'Personne ne peut l’utiliser.';
  return a.groups.includes('broadcaster') ? 'Seulement ces personnes.' : 'Seulement ces personnes — le streamer aussi, uniquement s’il en fait partie (groupe Streamer).';
}
export const cooldownShort = (c) => (c.enabled ? `${dur(c.seconds)} ${c.scope === 'viewer' ? 'par personne' : 'global'}` : 'Aucun');
export const cooldownText = (c) => (c.enabled ? `Cooldown : ${dur(c.seconds)} ${c.scope === 'viewer' ? 'par personne' : 'pour tout le chat'}` : 'Aucun cooldown');
const WIN_SHORT = { hour: 'heure', live: 'live', day: 'jour', total: '' };
export const quotaShort = (q) => `${q.window === 'total' ? `${q.max} au total` : `${q.max} / ${WIN_SHORT[q.window]}`}${q.scope === 'viewer' ? ' par personne' : ''}`;
export const quotaText = (q) => (q.enabled ? `Utilisations : ${q.max} ${WINDOWS.find((w) => w[0] === q.window)[1]} ${q.scope === 'viewer' ? 'par personne' : 'pour tout le chat'}` : 'Utilisations illimitées');
export const unitOf = (s) => (s % 3600 === 0 ? 'h' : s % 60 === 0 ? 'min' : 's');
export const word = (w) =>
  String(w || '')
    .trim()
    .toLowerCase()
    .replace(/^!+/, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 25);
export const variableMissing = (c, needs) => !!needs && !c.args.some((a) => a.type === needs);
export function insertAt(text, start, end, token) {
  const ins = start && !/\s$/.test(text.slice(0, start)) ? ` ${token}` : token;
  return { text: text.slice(0, start) + ins + text.slice(end), caret: start + ins.length };
}
/** Example rendering for « Aperçu » (the real rendering is Core's). */
export function previewText(m) {
  const ex = Object.fromEntries(VARIABLES.map((v) => [v[0], v[0] === '{target}' ? 'Aouh' : v[3]]));
  const body = m.text.replace(/\{[a-z_]+\}/g, (t) => ex[t] ?? t);
  const to = m.mode === 'reply' ? '' : m.to === 'author' ? 'PixelMamie' : m.to === 'target' ? 'Aouh' : m.to === 'user' ? (m.to_login ?? '…') : '';
  return `${to ? `@${to} ` : ''}${body}`;
}

// ------------------------------------------------------------------ state of a command (from Core)

export function stateOf(c) {
  const issue = c.issues?.[0];
  if (issue?.code === 'word_reserved') return { key: 'reserved', label: 'Mot réservé', tone: 'bad', why: `!${issue.word} appartient au module ${issue.module === 'raffle' ? 'Tombola' : issue.module} : ce mot ne lance pas cette commande.` };
  if (issue?.code === 'last_send_failed')
    return {
      key: 'send',
      label: issue.status === 'unknown' ? 'Envoi incertain' : issue.status === 'expired' ? 'Envoi expiré' : 'Envoi échoué',
      tone: 'warn',
      why: `Dernier envoi : ${STEP[issue.status]?.[0] ?? issue.status}${issue.error ? ` (${issue.error})` : ''}.`,
    };
  if (issue?.code === 'me_unsupported') return { key: 'me', label: '/me non envoyé', tone: 'warn', why: 'Un message en /me n’est pas envoyé aujourd’hui.' };
  return c.config.enabled ? { key: 'ok', label: 'Active', tone: 'ok', why: 'Fonctionne normalement' } : { key: 'off', label: 'Désactivée', tone: 'off', why: 'Désactivée' };
}
export const needsCheck = (c) => (c.issues?.length ?? 0) > 0;

// ------------------------------------------------------------------ filters, grouping, counts

export const NO_CATEGORY = { category_id: '', name: 'Sans catégorie', icon: 'folder', color: '#94a3b8', position: Number.MAX_SAFE_INTEGER };
export const categoryOf = (c, cats) => cats.find((k) => k.category_id === c.config.category) ?? NO_CATEGORY;
const inState = (k, c) => k === 'all' || (k === 'check' ? needsCheck(c) : k === 'off' ? !c.config.enabled : !c.config.listed);
const inCat = (ui, c, cats) => ui.cat === 'all' || (ui.cat === 'none' ? categoryOf(c, cats) === NO_CATEGORY : c.config.category === ui.cat);
export const matches = (c, q) => {
  const w = String(q || '').trim().toLowerCase().replace(/^!+/, '');
  if (!w) return { ok: true, via: null };
  if (c.config.name.includes(w)) return { ok: true, via: null };
  const al = c.config.aliases.find((a) => a.includes(w));
  if (al) return { ok: true, via: al };
  return { ok: c.config.description.toLowerCase().includes(w), via: null };
};
export function visible(list, cats, ui) {
  return list
    .map((c) => ({ c, m: matches(c, ui.q) }))
    .filter(({ c, m }) => m.ok && inState(ui.side, c) && inCat(ui, c, cats))
    .map(({ c, m }) => ({ c, via: m.via }))
    .sort((a, b) => a.c.config.name.localeCompare(b.c.config.name));
}
/** Counters of the state filters follow the category filter and the search. */
export function counts(list, cats, ui) {
  const base = list.filter((c) => matches(c, ui.q).ok && inCat(ui, c, cats));
  return { all: base.length, check: base.filter(needsCheck).length, off: base.filter((c) => !c.config.enabled).length, hidden: base.filter((c) => !c.config.listed).length };
}
/** Grouped by category (streamer's order, « Sans catégorie » last) unless a category is chosen or grouping is off. */
export function groups(rows, cats, ui) {
  if (!ui.group || ui.cat !== 'all') return [[null, rows]];
  const ordered = [...cats].sort((a, b) => a.position - b.position);
  return [...ordered, NO_CATEGORY].map((k) => [k, rows.filter((r) => categoryOf(r.c, cats) === k)]).filter(([, l]) => l.length);
}

// ------------------------------------------------------------------ rights (display only)

const RIGHT_OF = {
  name: 'rename',
  enabled: 'toggle',
  reply: 'reply',
  aliases: 'aliases',
  'audience.groups': 'audience',
  'audience.allow': 'audience',
  'audience.deny': 'exclusions',
  cooldown: 'cooldown',
  quota: 'quota',
  listed: 'listed',
};
/**
 * May the reader change this field of this command? `me` = Core's `/me` ({ role, rights }); the
 * streamer has every right (rights null). Returns { ok, why } — `why` explains a lock.
 */
export function canEdit(me, c, field) {
  if (c && (c.locked_fields ?? []).includes(field)) return { ok: false, why: `Verrouillé par le module ${c.owner_module === 'raffle' ? 'Tombola' : c.owner_module}` };
  if (me.role === 'broadcaster') return { ok: true, why: '' };
  if (c?.config.team_lock) return { ok: false, why: 'Commande verrouillée par le streamer' };
  const right = RIGHT_OF[field];
  if (!right) return { ok: false, why: 'Réglable dans Studio par le streamer' };
  const v = me.rights?.[right];
  const ok = typeof v === 'object' ? v?.allowed === true : v === true;
  return ok ? { ok: true, why: '' } : { ok: false, why: `Non délégué aux ${me.role === 'supermod' ? 'supermodos' : 'modérateurs'}` };
}
/** Minimum cooldown (seconds) the reader must keep; 0 = none. */
export const cooldownMin = (me) => (me.role === 'broadcaster' ? 0 : (me.rights?.cooldown?.min_seconds ?? 0));
export const canCreate = (me) => me.role === 'broadcaster' || me.rights?.create === true;
export function canRemove(me, c) {
  if (c.kind === 'system') return { ok: false, why: 'Une commande de module ne se supprime pas' };
  if (me.role === 'broadcaster') return { ok: true, why: '' };
  if (c.config.team_lock) return { ok: false, why: 'Commande verrouillée par le streamer' };
  return me.rights?.remove === true ? { ok: true, why: '' } : { ok: false, why: 'Suppression non déléguée à ton rôle' };
}
/** What a new command may set (creation right): name, description, category; the rest per right. */
export function canSetOnCreate(me, field) {
  if (['name', 'description', 'category'].includes(field)) return true;
  return canEdit(me, null, field).ok;
}

// ------------------------------------------------------------------ editing

const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
export const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
export function changes(base, draft) {
  const out = {};
  for (const k of Object.keys(draft)) if (!same(base[k], draft[k])) out[k] = draft[k];
  return out;
}
/** 409: my changes re-applied on top of the current version, the fields changed on both sides named. */
export function reapply(base, draft, current) {
  const mine = changes(base, draft);
  const theirs = changes(base, current);
  const both = Object.keys(mine).filter((k) => k in theirs && !same(mine[k], current[k]));
  return { draft: { ...current, ...mine }, both };
}
/** A new simple command (Core fills nothing more and validates it all). */
export const blank = (category) => ({
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
  args: [],
});

// ------------------------------------------------------------------ public list (phase F, viewers)

/** « VIP + Abonnés », « Tout le monde », « Certaines personnes » — never who exactly. */
export function publicWho(a) {
  if (a.groups.includes('everyone')) return 'Tout le monde';
  const g = a.groups.map((k) => SHORT[k]);
  if (a.named_people) g.push(g.length ? 'quelques personnes' : 'Certaines personnes');
  return g.join(' + ') || 'Personne';
}
export const publicCooldown = (c) => (c ? `${dur(c.seconds)} ${c.scope === 'viewer' ? 'par personne' : 'pour tout le chat'}` : 'Aucun');
export const publicQuota = (q) => (q ? `max ${quotaShort(q)}` : '');
export const WHEN_LABEL = { live: 'Pendant le live', offline: 'Hors live' };
/** Name, alias or description contains the search (with or without « ! »). */
export function publicMatches(c, q) {
  const w = String(q || '').trim().toLowerCase().replace(/^!+/, '');
  return !w || c.name.includes(w) || c.aliases.some((a) => a.includes(w)) || c.description.toLowerCase().includes(w);
}
/** Core's groups (its order), « Sans catégorie » last, filtered by the search; empty groups dropped. */
export function publicGroups(pub, q) {
  const groups = [...pub.categories.map((k) => ({ ...k, commands: k.commands.filter((c) => publicMatches(c, q)) })), { ...NO_CATEGORY, commands: pub.uncategorized.filter((c) => publicMatches(c, q)) }];
  return groups.filter((k) => k.commands.length);
}

