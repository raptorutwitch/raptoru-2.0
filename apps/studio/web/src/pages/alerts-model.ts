import { esc } from '../ds/ds.js';
import type { Transition, VariantLook } from './alerts-place.js';

// Alertes, partie pure : familles et variantes telles que le Core les décide, données fictives des tests, événement de test et
// données d'aperçu, temps des textes sur la timeline. Pas de DOM, pas de fetch. Le Core reste seul juge du tirage et des seuils :
// les tables d'ici servent à les dire, un test les compare au Core.

export interface AlertVariantInfo {
  id: string;
  type: string;
  video?: string | null;
  audio?: string | null;
  textStyle?: string;
  text?: string;
  provisional?: boolean;
  keepAudio?: boolean;
  loop?: boolean;
  volume?: number;
  showAt?: number;
  fadeOutAt?: number;
  hideAt?: number;
  duration?: number;
  mediaMs?: number;
  priority?: number;
  subtitles?: { text: string; showAt: number; hideAt: number }[];
  textBox?: { enterDuration: number; exitDuration: number };
  videoFade?: { in: number; out: number; outAt: number };
  tts?: unknown;
  /** Cadence mesurée (timeline image par image). */
  fps?: number;
  /** Médias absents du stockage de Studio. */
  missing: string[];
  [k: string]: unknown;
}

export interface AlertItem {
  alert_id: string;
  type: string;
  family?: string;
  variant_id: string;
  data: Record<string, unknown>;
  status: string;
  attempts: number;
  created_at: string | null;
  ended_at?: string | null;
  failure: { code?: string; message?: string | null } | null;
}

export interface AlertsState {
  environment?: 'lab' | 'production';
  source?: { seen: boolean; ago_ms: number | null; current: boolean | null };
  max_age_ms?: number | null;
  in_flight: AlertItem[];
  queued: AlertItem[];
  recent: AlertItem[];
  media: { name: string; available: boolean; bytes?: number }[];
  player_url: string;
  preview_url: string;
}

export type FamilyMode = 'auto' | 'usual' | 'halloween' | 'off';
export interface VariantSettings {
  families: Partial<Record<string, FamilyMode>>;
  follow?: string[];
  weights?: Record<string, number>;
}
export interface BallonPools {
  sub: number[];
  prime: number[];
  resub: number[];
}

/** Le formulaire : une partie de l'événement normalisé (le Core valide l'événement de test). */
export interface FakeData {
  pseudo: string;
  anonymous: boolean;
  recipient: string;
  count: number;
  months: number;
  bits: number;
  viewers: number;
  amount: string;
  currency: string;
  message: string;
}

// --- Familles et variantes -----------------------------------------------------------------------------------------------

export interface Family {
  id: string;
  label: string;
  /** Jeton de couleur du repère de la famille. */
  color: string;
  usual: string;
  halloween: string | null;
  has: (v: AlertVariantInfo) => boolean;
}
const ballon = (kind: string) => (v: AlertVariantInfo) =>
  v.id === 'eren_sub' || v.id.startsWith(`hw_ballon_${kind}_`);

/** Les huit familles que le streamer règle (mêmes clés que ALERT_VARIANT_FAMILIES). */
export const FAMILIES: Family[] = [
  {
    id: 'follow',
    label: 'Follow',
    color: 'teal',
    usual: 'Dofus, Eren, Discord',
    halloween: 'Miss Minute',
    has: (v) => v.type === 'follow',
  },
  {
    id: 'sub',
    label: 'Sub',
    color: 'blue',
    usual: 'Eren',
    halloween: 'le Ballon',
    has: ballon('sub'),
  },
  {
    id: 'prime',
    label: 'Sub Prime',
    color: 'violet',
    usual: 'Eren',
    halloween: 'le Ballon',
    has: ballon('prime'),
  },
  {
    id: 'resub',
    label: 'Resub',
    color: 'green',
    usual: 'Eren',
    halloween: 'le Ballon',
    has: ballon('resub'),
  },
  {
    id: 'gift',
    label: 'Subgift',
    color: 'orange',
    usual: 'Subgift 1, 5, 10, 20',
    halloween: 'Jerry',
    has: (v) => v.type === 'gift_community' || v.type === 'gift_targeted',
  },
  {
    id: 'bits',
    label: 'Bits',
    color: 'amber',
    usual: 'Bits',
    halloween: null,
    has: (v) => v.type === 'bits',
  },
  {
    id: 'raid',
    label: 'Raid',
    color: 'ink2',
    usual: 'Raid',
    halloween: null,
    has: (v) => v.type === 'raid',
  },
  {
    id: 'donation',
    label: 'Don',
    color: 'gold',
    usual: 'Don',
    halloween: null,
    has: (v) => v.type === 'donation',
  },
];
export const familyById = (id: string) =>
  FAMILIES.find((f) => f.id === id) ?? FAMILIES[0]!;

export const MODES: [FamilyMode, string][] = [
  ['auto', 'Auto'],
  ['usual', 'Habit.'],
  ['halloween', 'Hallow.'],
  ['off', 'Off'],
];

/** Ce qu'une famille joue, en mots. */
export function playsText(
  mode: FamilyMode,
  usual: string,
  halloween: string | null,
) {
  if (mode === 'off')
    return 'Aucune animation. L’événement est noté, les gains ne changent pas.';
  if (mode === 'usual' || !halloween) return `${usual}.`;
  if (mode === 'halloween')
    return `${halloween} toujours (secours : ${usual} si le média manque).`;
  return `${usual}. ${halloween} quand le profil Halloween est actif.`;
}

/** Les variantes habituelles de Follow et leurs poids d'origine (Core : FOLLOW_WEIGHTS). */
export const FOLLOW: [string, number][] = [
  ['follow_dofus_ebene', 20],
  ['follow_dofus_eliatrope', 20],
  ['follow_dofus_emeraude', 20],
  ['follow_eren', 20],
  ['follow_discord', 1],
];
export const followed = (id: string) => FOLLOW.some(([v]) => v === id);

/** Une case Follow basculée → la nouvelle sélection ; null si plus rien ne resterait (couper la famille à la place). */
export function toggleFollow(
  current: string[] | undefined,
  id: string,
  on: boolean,
): string[] | null {
  const set = new Set(current ?? FOLLOW.map(([v]) => v));
  if (on) set.add(id);
  else set.delete(id);
  return set.size ? FOLLOW.map(([v]) => v).filter((v) => set.has(v)) : null;
}

export const weightOf = (s: VariantSettings | null, id: string) =>
  s?.weights?.[id] ?? FOLLOW.find(([v]) => v === id)?.[1] ?? 0;

/** Les chances réelles d'une variante Follow dans le tirage du Core (0 si elle n'est pas dans le tirage). */
export function chance(s: VariantSettings | null, id: string) {
  const allowed = s?.follow ?? FOLLOW.map(([v]) => v);
  if (!allowed.includes(id)) return 0;
  const total = allowed.reduce((n, v) => n + weightOf(s, v), 0);
  return total ? Math.round((weightOf(s, id) / total) * 100) : 0;
}

/** Une case Ballon basculée → les nouveaux tirages (jamais vide : le dernier reste). */
export function togglePool(
  pools: BallonPools | undefined,
  kind: keyof BallonPools,
  n: number,
  on: boolean,
): BallonPools {
  const all = [1, 2, 3, 4];
  const cur = { sub: all, prime: all, resub: all, ...(pools ?? {}) };
  const set = new Set(cur[kind]);
  if (on) set.add(n);
  else if (set.size > 1) set.delete(n);
  return { ...cur, [kind]: [...set].sort((a, b) => a - b) };
}

const BALLONS = ['Bonbons', 'Citrouilles', 'Bonbons maïs', 'Araignées'];
const NAMES: Record<string, string> = {
  follow_dofus_ebene: 'Dofus Ébène',
  follow_dofus_eliatrope: 'Dofus Éliatrope',
  follow_dofus_emeraude: 'Dofus Émeraude',
  follow_eren: 'Eren',
  follow_discord: 'Discord',
  eren_sub: 'Eren',
  subgift_1: 'Subgift 1',
  subgift_5: 'Subgift 5',
  subgift_10: 'Subgift 10',
  subgift_20: 'Subgift 20',
  subgift_targeted: 'Subgift ciblé',
  bits_default: 'Bits',
  don_moneytest: 'Don',
  raid_default: 'Raid Titan',
  hw_follow_miss_minute: 'Miss Minute',
  hw_gift_1: 'Jerry 1',
  hw_gift_5: 'Jerry 5',
  hw_gift_10: 'Jerry 10',
  hw_gift_20: 'Jerry 20',
  hw_gift_targeted: 'Jerry ciblé',
};
export const ballonOf = (id: string) => {
  const m = /^hw_ballon_(sub|prime|resub)_(\d)$/.exec(id);
  return m ? { kind: m[1] as keyof BallonPools, n: Number(m[2]) } : null;
};
export function variantName(id: string) {
  const b = ballonOf(id);
  return b ? `Ballon ${BALLONS[b.n - 1]}` : (NAMES[id] ?? id);
}
export const isHalloween = (v: { id: string }) => v.id.startsWith('hw_');

/** Seuils du Core : GIFT_THRESHOLDS, JERRY_THRESHOLDS, BITS_MINIMUM. */
export const GIFT_MIN: Record<string, number> = {
  subgift_1: 1,
  subgift_5: 5,
  subgift_10: 10,
  subgift_20: 20,
  hw_gift_1: 1,
  hw_gift_5: 5,
  hw_gift_10: 10,
  hw_gift_20: 20,
};
export const BITS_MINIMUM = 10;

/** Ce qui déclenche une variante, dans les mots du streamer. */
export function triggerOf(v: AlertVariantInfo) {
  const min = GIFT_MIN[v.id];
  if (min)
    return min === 1 ? 'De 1 à 4 subs offerts' : `Dès ${min} subs offerts`;
  if (v.type === 'gift_targeted') return 'Un sub offert à un viewer';
  if (v.type === 'bits') return `Dès ${BITS_MINIMUM} Bits`;
  if (v.type === 'donation') return 'Un don confirmé';
  if (v.type === 'raid') return 'Un raid';
  if (v.id === 'eren_sub') return 'Sub, Sub Prime et Resub';
  if (v.type === 'follow') return 'Un nouveau follow';
  return 'Tiré au sort parmi les Ballons cochés';
}

export const TYPE_LABEL: Record<string, string> = {
  follow: 'Follow',
  sub: 'Sub',
  resub: 'Resub',
  gift_community: 'Subgift',
  gift_targeted: 'Subgift ciblé',
  bits: 'Bits',
  donation: 'Don',
  raid: 'Raid',
};

/** Les familles de la file (mêmes que `alertFamilyOf`, vérifié par un test) : le test de superposition en joue une de chaque. */
export const familyOfType = (type: string) =>
  ['sub', 'resub', 'gift_targeted', 'gift_community'].includes(type)
    ? 'subscription'
    : type;
const FAMILY_SAMPLES = ['follow', 'sub', 'bits', 'donation', 'raid'];
export const overlapCategories = (type: string) =>
  FAMILY_SAMPLES.filter((c) => familyOfType(c) !== familyOfType(type));

// --- Données fictives ---------------------------------------------------------------------------------------------------

const BASE: FakeData = {
  pseudo: 'Raptoru_Fan',
  anonymous: false,
  recipient: 'Viewer_Chanceux',
  count: 5,
  months: 13,
  bits: 100,
  viewers: 42,
  amount: '5',
  currency: 'EUR',
  message: 'Merci pour le stream !',
};

export const PRESETS: Record<string, { label: string; data: FakeData }> = {
  normal: { label: 'Normal', data: BASE },
  long: {
    label: 'Pseudo long',
    data: {
      ...BASE,
      pseudo: 'UnPseudoVraimentTresTresLong_25',
      recipient: 'DestinataireAuPseudoInterminable',
      message:
        'Un message de don très long pour vérifier que le texte tient dans son cadre sans déborder, même quand le viewer écrit beaucoup, vraiment beaucoup, jusqu’à la limite.',
      count: 100,
      months: 120,
      viewers: 12345,
      amount: '1234.56',
    },
  },
  hostile: {
    label: 'HTML hostile',
    data: {
      ...BASE,
      pseudo: '<img src=x onerror=alert(1)>',
      recipient: '"><script>alert(2)</script>',
      message: '<b>gras</b> & <script>alert(3)</script>',
    },
  },
  anonymous: {
    label: 'Anonyme',
    data: { ...BASE, anonymous: true, pseudo: '' },
  },
};

/** Les champs qu'utilise un type d'événement. */
export function fieldsOf(type: string): (keyof FakeData)[] {
  switch (type) {
    case 'gift_community':
      return ['pseudo', 'anonymous', 'count'];
    case 'gift_targeted':
      return ['pseudo', 'anonymous', 'recipient'];
    case 'bits':
      return ['pseudo', 'bits'];
    case 'donation':
      return ['pseudo', 'anonymous', 'amount', 'currency', 'message'];
    case 'raid':
      return ['pseudo', 'viewers'];
    case 'resub':
      return ['pseudo', 'months'];
    default:
      return ['pseudo'];
  }
}

const person = (name: string) =>
  name.trim() ? { display_name: name.trim().slice(0, 64) } : undefined;

/** L'événement de test envoyé à la file du Core. */
export function testEvent(type: string, f: FakeData) {
  const has = new Set(fieldsOf(type));
  const anonymous = has.has('anonymous') && f.anonymous;
  const ev: Record<string, unknown> = { type };
  const actor = anonymous ? undefined : person(f.pseudo);
  if (actor) ev.actor = actor;
  if (anonymous) ev.anonymous = true;
  if (has.has('recipient')) ev.recipient = person(f.recipient);
  if (has.has('count')) ev.count = f.count;
  if (has.has('months')) ev.months = f.months;
  if (has.has('bits')) ev.bits = f.bits;
  if (has.has('viewers')) ev.viewers = f.viewers;
  if (has.has('amount')) {
    const [int, dec = ''] = f.amount.replace(',', '.').split('.');
    const decimals = Math.min(2, dec.length);
    ev.amount = {
      value:
        Number(int || 0) * 10 ** decimals + Number(dec.slice(0, decimals) || 0),
      decimal_place: decimals,
      currency: f.currency.toUpperCase(),
    };
    if (f.message.trim()) ev.message = f.message.slice(0, 500);
  }
  return ev;
}

/** L'événement d'une famille : Prime et Resub sont des subs ; une variante Halloween se teste sans changer le profil. */
export function familyEvent(
  family: string,
  v: AlertVariantInfo,
  f: FakeData,
): Record<string, unknown> {
  const type = family === 'prime' ? 'sub' : family === 'gift' ? v.type : family;
  const ev = testEvent(type, f);
  if (family === 'sub' || family === 'resub') ev.tier = '1000';
  if (family === 'prime') ev.tier = 'prime';
  if (isHalloween(v)) ev.test_profile = 'halloween';
  return ev;
}

/**
 * Les données d'aperçu d'un événement : les mêmes que `alertData` du Core pour la source OBS
 * (apps/core-api/src/alerts/rules.ts, vérifié par un test).
 */
export function previewData(ev: Record<string, unknown>) {
  const type = String(ev.type);
  const actor = ev.actor as { display_name: string } | undefined;
  const anonymousGifter =
    (type === 'gift_targeted' || type === 'gift_community') &&
    (ev.anonymous === true || !actor);
  const amount = ev.amount as
    { value: number; decimal_place: number; currency: string } | undefined;
  return {
    pseudo: anonymousGifter
      ? 'Un généreux anonyme'
      : (actor?.display_name ?? 'Anonyme'),
    ...(ev.recipient
      ? { recipient: (ev.recipient as { display_name: string }).display_name }
      : {}),
    ...(ev.count !== undefined ? { count: ev.count } : {}),
    ...(ev.bits !== undefined ? { amount: String(ev.bits) } : {}),
    ...(amount
      ? {
          amount: (amount.value / 10 ** amount.decimal_place).toFixed(
            amount.decimal_place,
          ),
          currency: amount.currency,
        }
      : {}),
    ...(ev.viewers !== undefined ? { viewers: ev.viewers } : {}),
    ...(ev.tier ? { tier: ev.tier } : {}),
    ...(ev.months !== undefined ? { months: ev.months } : {}),
    ...(ev.message ? { message: ev.message } : {}),
    anonymous: anonymousGifter || ev.anonymous === true,
  };
}

const FIELD_LABEL: Record<keyof FakeData, string> = {
  pseudo: 'Pseudo',
  anonymous: 'Anonyme',
  recipient: 'Destinataire',
  count: 'Subs offerts',
  months: 'Mois',
  bits: 'Bits',
  viewers: 'Viewers',
  amount: 'Montant',
  currency: 'Devise',
  message: 'Message',
};

/** Les champs de données fictives d'un type (valeurs échappées : un préréglage contient du HTML hostile exprès). */
export function formView(type: string, f: FakeData) {
  return fieldsOf(type)
    .map((k) => {
      const label = FIELD_LABEL[k];
      if (k === 'anonymous')
        return `<div class="d-row"><span>${label}</span><span class="d-sw"><input type="checkbox" role="switch" data-field="anonymous" ${f.anonymous ? 'checked' : ''} aria-label="${label}"><i></i></span></div>`;
      if (k === 'message')
        return `<div class="d-row col"><span>${label}</span><textarea class="d-area" data-field="message" rows="2" maxlength="500" aria-label="${label}">${esc(f.message)}</textarea></div>`;
      if (k === 'currency')
        return `<div class="d-row"><span>${label}</span><label class="d-fld"><select data-field="currency" aria-label="${label}">${['EUR', 'USD', 'GBP', 'CAD', 'CHF'].map((c) => `<option ${c === f.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>`;
      const numeric = ['count', 'months', 'bits', 'viewers'].includes(k);
      return `<div class="d-row"><span>${label}</span><label class="d-fld alr-wide"><input data-field="${k}" aria-label="${label}" ${numeric ? 'type="number" min="1"' : 'type="text" maxlength="64"'} value="${esc(f[k])}"></label></div>`;
    })
    .join('');
}

// --- File, états ----------------------------------------------------------------------------------------------------------

export const STATUS: Record<string, string> = {
  queued: 'En attente',
  claimed: 'Réservée',
  playing: 'En cours',
  completed: 'Terminée',
  failed: 'Échec',
  expired: 'Expirée',
};

/** Pourquoi une alerte n'a pas été jouée, en mots. */
export function failureText(a: AlertItem) {
  const f = a.failure;
  if (!f) return '';
  if (f.code === 'cleared') return 'Retirée quand la file a été vidée';
  if (f.code === 'stale') return 'Trop ancienne, pas jouée';
  const m = String(f.message ?? f.code ?? '');
  return m.startsWith('media_missing')
    ? `Média manquant sur ce PC : ${m.slice('media_missing: '.length)}`
    : m;
}

/** Un élément de la file ou de l'historique : tout ce qui vient du viewer est échappé. */
export const queueChip = (a: AlertItem, now: boolean) =>
  `<button type="button" class="alr-qp${now ? ' now' : ''}" data-item="${esc(a.alert_id)}" title="${esc(STATUS[a.status] ?? a.status)}"><b>${esc(a.data.pseudo)}</b><small>${esc(TYPE_LABEL[a.type] ?? a.type)}</small></button>`;

export const queueHtml = (s: AlertsState) =>
  [
    ...s.in_flight.map((a) => queueChip(a, true)),
    ...s.queued.map((a) => queueChip(a, false)),
  ].join('');

const REASONS: Record<string, string> = {
  'video-ended': 'fin de la vidéo',
  'audio-ended': 'fin du son',
  duration: 'durée imposée',
  stopped: 'arrêtée',
  replaced: 'remplacée',
  'video-error': 'erreur du lecteur vidéo',
  'video-play-error': 'lecture refusée',
  'no-media': 'aucun média',
  timeout: 'délai de sécurité dépassé',
};

/** La dernière ligne d'état de l'aperçu. */
export function previewStatus(
  m: { state: string; reason?: string; ms?: number } | null,
) {
  if (!m) return '';
  if (m.state === 'loading') return 'Chargement…';
  if (m.state === 'playing') return 'Lecture…';
  return `Terminée : ${REASONS[m.reason ?? ''] ?? m.reason} (${((m.ms ?? 0) / 1000).toFixed(1).replace('.', ',')} s)`;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2).replace('.', ',')} s`;

/** L'instant de la timeline : « 1,50 s · image 37 » (les images commencent à 1, comme dans un logiciel de montage). */
export function scrubLabel(ms: number, fps = 24) {
  return `${seconds(ms)} · image ${Math.floor((ms * fps) / 1000 + 1e-6) + 1}`;
}

const MARKS: Record<string, string> = {
  'text-show': 'texte',
  'text-fade': 'fondu du texte',
  'text-hide': 'sortie du texte',
  'text-exit': 'sortie du texte',
  'text-clear': 'fin du texte',
  'subtitle-show': 'sous-titre',
  'subtitle-tremble': 'tremblement',
  'subtitle-out': 'fin du sous-titre',
  'subtitle-exit': 'sortie du sous-titre',
  'subtitle-clear': 'fin du sous-titre',
  'video-fade-out': 'fondu vidéo',
  'video-exit': 'sortie vidéo',
};
export const markLabel = (m: { at: number; action: string }) =>
  `${MARKS[m.action] ?? m.action} ${seconds(m.at)}`;

// --- Temps des textes ----------------------------------------------------------------------------------------------------

/** Les transitions proposées (mêmes clés que FX_KINDS du moteur). `origin` = ce que fait déjà le style, rien d'enregistré. */
export const TRANSITIONS: [string, string][] = [
  ['origin', 'D’origine'],
  ['fade', 'Fondu'],
  ['rise', 'Monte'],
  ['drop', 'Descend'],
  ['left', 'Par la gauche'],
  ['right', 'Par la droite'],
  ['zoom', 'Zoom'],
  ['cut', 'Coupe nette'],
];
export type FxKey = 'textEnter' | 'textExit' | 'mediaEnter' | 'mediaExit';
export const DEFAULT_FX_MS = 400;

/** Durées des animations propres à chaque style (alerts-player/alerts.css). `after` : la sortie commence à `hideAt`. */
function originFx(v: AlertVariantInfo) {
  switch (v.textStyle) {
    case 'pseudo-classic':
      return { enter: 450, exit: 350, after: true };
    case 'pseudo-dofus':
      return { enter: 600, exit: 1000, after: true };
    case 'eren-subs':
      return { enter: 200, exit: 100, after: true };
    case 'pseudo-don':
      return {
        enter: v.textBox?.enterDuration ?? 340,
        exit: v.textBox?.exitDuration ?? 300,
        after: true,
      };
    default:
      return {
        enter: 220,
        exit:
          v.hideAt !== undefined && v.fadeOutAt !== undefined
            ? v.hideAt - v.fadeOutAt
            : 350,
        after: false,
      };
  }
}

export interface Clip {
  /** 'text', ou `sub<i>` pour un sous-titre. */
  key: string;
  label: string;
  in: number;
  /** Quand le texte a complètement disparu. */
  end: number;
  enterMs: number;
  exitMs: number;
  /** Ce que la sortie d'origine ajoute après `hideAt`. */
  tail: number;
}

/** Les blocs de texte d'une variante sur la timeline, avec ses réglages. */
export function clipsOf(v: AlertVariantInfo, look: VariantLook = {}): Clip[] {
  const o = originFx(v);
  const enterMs = look.textEnter
    ? look.textEnter.kind === 'cut'
      ? 0
      : look.textEnter.ms
    : o.enter;
  const exit = look.textExit;
  const exitMs = exit ? (exit.kind === 'cut' ? 0 : exit.ms) : o.exit;
  const tail = !exit && o.after ? o.exit : 0;
  if (v.textStyle === 'eren-subs')
    return (v.subtitles ?? []).map((s, i) => {
      const l = look.subtitles?.[i];
      return {
        key: `sub${i}`,
        label: l?.text ?? s.text,
        in: l?.showAt ?? s.showAt,
        end: (l?.hideAt ?? s.hideAt) + tail,
        enterMs,
        exitMs,
        tail,
      };
    });
  const show = look.showAt ?? v.showAt;
  const hide = look.hideAt ?? v.hideAt;
  if (show === undefined || hide === undefined) return [];
  return [
    {
      key: 'text',
      label:
        v.textStyle === 'pseudo-don' ? 'Pseudo, montant, message' : 'Texte',
      in: show,
      end: hide + tail,
      enterMs,
      exitMs,
      tail,
    },
  ];
}

/** Un bloc déplacé sur la timeline : le réglage correspondant, sans garder ce qui revient au temps d'origine. */
export function moveClip(
  v: AlertVariantInfo,
  look: VariantLook,
  clip: Clip,
  inMs: number,
  endMs: number,
): VariantLook {
  const next = { ...look };
  const hide = Math.round(endMs - clip.tail);
  const show = Math.round(inMs);
  if (clip.key === 'text') {
    if (show === v.showAt) delete next.showAt;
    else next.showAt = show;
    if (hide === v.hideAt) delete next.hideAt;
    else next.hideAt = hide;
    return next;
  }
  const i = Number(clip.key.slice(3));
  const subs = (v.subtitles ?? []).map((_, n) => ({
    ...next.subtitles?.[n],
  }));
  const base = v.subtitles?.[i];
  const s = subs[i];
  if (!base || !s) return look;
  if (show === base.showAt) delete s.showAt;
  else s.showAt = show;
  if (hide === base.hideAt) delete s.hideAt;
  else s.hideAt = hide;
  next.subtitles = subs;
  if (subs.every((x) => !Object.keys(x).length)) delete next.subtitles;
  return next;
}

/** Une transition choisie : `origin` efface le réglage, une coupe nette n'a pas de durée. */
export function setFx(
  look: VariantLook,
  key: FxKey,
  kind: string,
  ms?: number,
): VariantLook {
  const next = { ...look };
  if (kind === 'origin') delete next[key];
  else {
    const t: Transition = {
      kind,
      ms: kind === 'cut' ? 0 : Math.round(ms ?? look[key]?.ms ?? DEFAULT_FX_MS),
    };
    next[key] = t;
  }
  return next;
}

/** La longueur de l'alerte avant que l'aperçu ne l'ait mesurée. */
export const lengthOf = (v: AlertVariantInfo) =>
  Math.max(
    v.duration ? v.duration + 300 : 0,
    v.loop ? 0 : (v.mediaMs ?? 0),
    v.hideAt ?? 0,
    ...(v.subtitles ?? []).map((s) => s.hideAt),
  );

/** Une phrase modifiable : ces styles lisent leur gabarit ; les subgifts, les Bits et le don composent le leur. */
export const canEditText = (v: AlertVariantInfo) =>
  ['pseudo-classic', 'pseudo-dofus', 'pseudo-zone', 'eren-subs'].includes(
    v.textStyle ?? '',
  );
