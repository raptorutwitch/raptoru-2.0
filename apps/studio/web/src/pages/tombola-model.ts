import type { RaffleConfig } from '@raptoru/schemas';

// Tombola : contrats lus au Core (relais /api/raffle/*) et fonctions pures. Aucune règle métier : le Core valide et décide, ces
// fonctions présentent ou préviennent avant l'envoi. Sans DOM : testées telles quelles.

export type Config = RaffleConfig;
export type RoundKind = 'normal' | 'super' | 'giveaway';
type TitleState = 'open' | 'running' | 'paused' | 'ended' | 'cancelled';
export type Titles = Record<TitleState, [string, string]> & { name: string };
export interface Currency {
  id: string;
  label: string;
  short_label: string;
  icon: string;
  available: boolean;
}
export interface Scheduler {
  enabled: boolean;
  preset: string;
  timing: { first_delay_s: number; min_s: number; max_s: number };
  state: 'stopped' | 'running' | 'paused';
  /** Ce qu'il faut montrer, décidé par le Core. */
  phase: 'disabled' | 'waiting_stream' | 'running' | 'waiting_round' | 'paused';
  can_pause: boolean;
  can_resume: boolean;
  next_at: string | null;
  remaining_ms: number | null;
  waiting_for_round: boolean;
  last_skip_reason: string | null;
}
export interface Status {
  config: Config;
  scheduler: Scheduler;
  currencies: Currency[];
  stream: { session_id: string; started_at: string; source: string } | null;
  /** Faux en Production : aucun live simulé (le serveur Studio le refuse). */
  simulated_stream?: boolean;
  winners_table: { participants: number; min: number; max: number }[];
  titles?: {
    normal: Titles;
    super: Titles;
    giveaway: Titles;
    idle: string;
  };
  overlay_url: string;
  preview_url: string;
}
/** `no_participants` : terminée sans inscrit (ni tirage, ni gagnant, ni paiement), ce n'est pas une annulation. */
export type Outcome = 'cancelled' | 'no_participants' | 'winners' | null;
export interface Round {
  raffle_id: string;
  status: string;
  kind: RoundKind;
  amount: number;
  currency: { id: string; label: string; short_label: string } | null;
  prize: string | null;
  remaining_ms: number;
  duration_ms: number;
  participants: number;
  origin: 'manual' | 'automatic';
  reveal: { is_full: boolean } | null;
  outcome: Outcome;
  titles?: Titles;
}
export interface Snapshot {
  module_state: 'active' | 'paused' | 'disabled';
  round: Round | null;
}
export interface Entry {
  viewer_id: string;
  display_name: string;
  source: 'chat' | 'extension' | 'manual';
  command: string | null;
  avatar_url?: string | null;
  created_at: string;
  added_by: string | null;
  removed_at: string | null;
  removed_by: string | null;
  removed_reason?: string | null;
}
export interface Winner {
  position: number;
  viewer_id: string;
  display_name: string;
  expected: number;
  currency: { short_label: string } | null;
  payout_status: 'pending' | 'paid' | 'failed' | 'none';
  ledger_id: number | null;
  credited: number;
  paid_at: string | null;
  attempts: number;
  failure: string | null;
}
export interface Card {
  raffle_id: string;
  status: string;
  kind: RoundKind;
  amount: number;
  currency: { label: string; short_label: string } | null;
  prize: string | null;
  is_full: boolean | null;
  origin: string;
  opened_by: string;
  outcome: Outcome;
  duration_ms: number;
  session_id?: string | null;
  winners_mode?: string;
  timeline: Record<string, string | null>;
  cancelled_by: string | null;
  cancel_reason: string | null;
  entries: Entry[];
  winners: Winner[];
  audit: {
    created_at: string;
    actor: string;
    role: string;
    action: string;
    viewer_id?: string | null;
    reason: string | null;
    after?: Record<string, unknown> | null;
  }[];
}
export interface HistoryItem extends Omit<Round, 'reveal' | 'titles'> {
  winners: {
    viewer_id: string;
    display_name: string;
    amount: number;
    payout_status: string;
  }[];
  payouts: { paid: number; failed: number };
  is_full: boolean | null;
  opened_at: string;
  cancelled_at: string | null;
  session_id: string | null;
}

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

/** Le relais Studio de la Tombola. Une réponse refusée devient une erreur lisible par `errText` (`code`, `body`). */
export async function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  raw?: { data: Blob; name: string },
): Promise<T> {
  const res = await fetch(`/api/raffle${path}`, {
    method: body === undefined && !raw ? 'GET' : 'POST',
    headers: raw
      ? {
          'x-raptoru-studio': '1',
          'content-type': 'application/octet-stream',
          'x-sound-name': encodeURIComponent(raw.name),
        }
      : HEADERS,
    body: raw
      ? raw.data
      : body === undefined
        ? undefined
        : JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok)
    throw Object.assign(new Error(out.error ?? 'error'), {
      code: out.error,
      body: out,
    });
  return out;
}

/** Les refus du Core dits dans les mots du streamer. */
export const ERRORS: Record<string, string> = {
  raffle_already_open:
    'Une Tombola est déjà en cours, ou son résultat encore à l’écran.',
  no_open_raffle: 'Aucune Tombola en cours.',
  invalid_phase: 'Impossible à ce stade de la Tombola.',
  viewer_blocked: 'Ce viewer est bloqué de la Tombola.',
  already_joined: 'Déjà inscrit.',
  not_a_participant: 'Ce viewer ne participe pas.',
  global_pause: 'Raptoru est en pause globale.',
  module_disabled: 'La Tombola est désactivée.',
  currency_unavailable: 'Monnaie indisponible.',
  scheduler_not_paused: 'La Tombola automatique n’est pas en pause.',
  scheduler_not_running:
    'La Tombola automatique ne tourne pas : elle attend le prochain stream.',
  stream_already_live: 'Un stream est déjà en cours.',
  no_live_stream: 'Aucun stream en cours.',
  already_paid: 'Déjà payé.',
  nothing_to_pay: 'Rien à payer : le lot se remet à la main.',
  unsupported_audio: 'Fichier refusé : MP3, WAV ou OGG uniquement.',
  sound_too_large: 'Fichier trop lourd : 5 Mo maximum.',
  empty_file: 'Fichier vide.',
  bot_running: 'Le bot du Lab lit déjà Twitch : arrête-le d’abord.',
  simulated_stream_lab_only: 'Le live simulé n’existe que dans le Lab.',
};

export const PRESETS: [string, string][] = [
  ['rare', 'Rare'],
  ['occasional', 'Occasionnel'],
  ['normal', 'Normal'],
  ['frequent', 'Fréquent'],
  ['very_frequent', 'Très fréquent'],
  ['custom', 'Personnalisé'],
];
/** Polices du message de l'overlay : les mêmes que raffle-overlay/kit.js. */
export const HINT_FONTS = {
  segoe: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  bahnschrift: "'Bahnschrift', 'Segoe UI', sans-serif",
  trebuchet: "'Trebuchet MS', 'Segoe UI', sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
} as const;
export const HINT_COLORS: [string | null, string][] = [
  [null, 'Gris, par défaut'],
  ['#eef3f8', 'Blanc'],
  ['#2fd8c4', 'Turquoise'],
  ['#f47e98', 'Rose'],
  ['#e9c46a', 'Or'],
  ['#ffb35c', 'Ambre'],
];
export const HINT_HIGHLIGHTS: [string | null, string][] = [
  [null, 'Aucun'],
  ['#05070bcc', 'Sombre'],
  ['#2fd8c433', 'Turquoise'],
  ['#f47e9838', 'Rose'],
  ['#e9c46a38', 'Or'],
];
export const HINT_EMOJIS = ['🎟️', '🎁', '💰', '🔥', '⭐', '🎉', '🍀', '👀'];

export const ACTIVE = ['opening', 'open', 'paused'];
export const DRAWN = ['revealing', 'revealed', 'finished'];

/**
 * Choisir la monnaie. Les Bonbons (Halloween, docs/HALLOWEEN.md) se comptent à l'unité : ce choix passe un montant aléatoire
 * (tranches en Jetons) en montant fixe et ramène un montant taillé pour les Jetons à 10 Bonbons, jamais 25 000 Bonbons d'un clic.
 */
export function pickCurrency(c: Config, id: string) {
  c.currency_id = id;
  if (id !== 'bonbons') return;
  if (c.amount_mode === 'random') c.amount_mode = 'fixed';
  if (c.fixed_amount > 1000) c.fixed_amount = 10;
}

export type CmdList = 'join_commands' | 'cancel_commands';
const CMD_RE = /^![\p{L}\p{N}_]{1,24}$/u;
export const normCmd = (v: string) => {
  const t = v.trim().toLowerCase();
  return t.startsWith('!') ? t : `!${t}`;
};
/** Vérification avant envoi, le Core vérifie à nouveau : forme, doublon, l'autre liste. */
export function cmdProblem(c: Config, list: CmdList, value: string, skip = -1) {
  if (!CMD_RE.test(value))
    return 'Une commande, c’est « ! » suivi de 1 à 24 lettres, chiffres ou « _ », sans espace.';
  if (c[list].some((x, i) => i !== skip && x === value))
    return `${value} est déjà dans cette liste.`;
  const other: CmdList =
    list === 'join_commands' ? 'cancel_commands' : 'join_commands';
  if (c[other].includes(value))
    return `${value} est déjà une commande ${list === 'join_commands' ? 'd’annulation' : 'd’inscription'} : une commande ne peut pas faire les deux.`;
  if (skip < 0 && c[list].length >= 12) return '12 commandes maximum.';
  return '';
}

/** La récompense telle qu'on la lit partout : montant et monnaie, ou le lot. */
export function reward(r: {
  kind: string;
  amount: number;
  prize: string | null;
  currency: { short_label: string } | null;
}) {
  return r.kind === 'giveaway'
    ? (r.prize ?? 'Lot')
    : `${Number(r.amount).toLocaleString('fr-FR').replace(/\s/g, ' ')} ${r.currency?.short_label ?? ''}`.trim();
}

export type HistState =
  'running' | 'cancelled' | 'empty' | 'failed' | 'paid' | 'give' | 'none';
/** Où en est une manche de l'historique : une seule lecture, pour la liste et ses filtres. */
export function histState(h: HistoryItem): HistState {
  if (h.status === 'cancelled') return 'cancelled';
  if (h.outcome === 'no_participants') return 'empty';
  if (!['finished', 'revealed'].includes(h.status)) return 'running';
  if (h.kind === 'giveaway') return 'give';
  if (h.payouts.failed) return 'failed';
  return h.winners.length ? 'paid' : 'none';
}

export type HistFilter = 'all' | 'special' | 'auto' | 'cancelled' | 'failed';
export function filterHistory(
  list: HistoryItem[],
  f: HistFilter,
  query: string,
) {
  const q = query.trim().toLowerCase();
  return list.filter(
    (h) =>
      (f === 'all' ||
        (f === 'special' && (h.kind !== 'normal' || h.is_full === true)) ||
        (f === 'auto' && h.origin === 'automatic') ||
        (f === 'cancelled' && h.status === 'cancelled') ||
        (f === 'failed' && h.payouts.failed > 0)) &&
      (!q ||
        (h.prize ?? '').toLowerCase().includes(q) ||
        h.winners.some((w) => w.display_name.toLowerCase().includes(q))),
  );
}

const dayLabel = (iso: string, today: Date) => {
  const d = new Date(iso);
  const days = Math.round(
    (new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    ).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  return days === 0
    ? 'Aujourd’hui'
    : days === 1
      ? 'Hier'
      : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
};
/** Le stream en cours d'abord, puis jour par jour (la liste du Core arrive de la plus récente à la plus ancienne). */
export function groupHistory(
  list: HistoryItem[],
  sessionId: string | null,
  today = new Date(),
) {
  const out: { label: string; items: HistoryItem[] }[] = [];
  for (const h of list) {
    const label =
      sessionId && h.session_id === sessionId
        ? 'Ce stream'
        : dayLabel(h.opened_at, today);
    const last = out.at(-1);
    if (last?.label === label) last.items.push(h);
    else out.push({ label, items: [h] });
  }
  return out;
}

/**
 * Ce que l'overlay affichera à la prochaine manche : un instantané au format du Core, donné au vrai overlay. Une manche aléatoire
 * ne connaît son montant qu'au lancement : on montre le milieu de la première tranche, et la scène dit que c'est un exemple.
 */
export function nextRoundLook(c: Config, s: Status, asSuper: boolean) {
  const kind: RoundKind =
    c.amount_mode === 'giveaway' && !asSuper
      ? 'giveaway'
      : asSuper
        ? 'super'
        : 'normal';
  const b = c.random.bands[0]!;
  const step = Math.max(1, c.random.step);
  const amount =
    kind === 'super'
      ? c.super.jackpot
      : c.amount_mode === 'fixed'
        ? c.fixed_amount
        : Math.round((b.from + b.to) / 2 / step) * step;
  const currency = s.currencies.find(
    (k) => k.id === (kind === 'super' ? c.super.currency_id : c.currency_id),
  );
  return {
    example: kind === 'normal' && c.amount_mode === 'random',
    snapshot: {
      module_state: 'active',
      overlay_hint: c.overlay_hint,
      labels: c.labels,
      join_command: c.join_commands[0],
      join_feedback_ms: c.display.join_feedback_ms,
      round: {
        raffle_id: `prochaine:${kind}:${amount}:${currency?.id}:${c.prize}`,
        status: 'open',
        kind,
        amount,
        currency: currency ?? null,
        prize: c.prize,
        // Loin dans le futur : le temps reste plein, il ne défile pas dans l'aperçu.
        closes_at: new Date(Date.now() + 86_400_000).toISOString(),
        duration_ms: c.duration_s * 1000,
        remaining_ms: c.duration_s * 1000,
        paused: false,
        titles: s.titles?.[kind],
        outcome: null,
        participants: 0,
        recent: [],
        entries_tail: [],
        launch_sound: null,
        reveal: null,
      },
    },
  };
}
