import { esc, tryGetJson } from './http.js';
import type { HistoryEntry } from './supervision-banner.js';

// Activité: one readable feed of what already exists — the supervision's outages, the host modules' journal, the
// moderation audit. Read only and without a copy: each source stays where it is; a source that does not answer is said.

export type FeedKind = 'incident' | 'module' | 'moderation';
export type FeedFilter = 'all' | FeedKind;

export interface FeedItem {
  at: string;
  kind: FeedKind;
  title: string;
  text: string;
  /** The page with the detail. */
  page: string;
}

export interface ModuleActivity {
  module_id: string;
  action: string;
  viewer: { display_name: string } | null;
  amount: number;
  status: string;
  created_at: string;
}
export interface AuditEntry {
  created_at: string;
  actor: string;
  module_id: string | null;
  action: string;
  reason: string | null;
}

const STATUS: Record<string, string> = {
  done: 'terminé',
  queued: 'en attente',
  failed: 'échec',
  refunded: 'remboursé',
  canceled: 'annulé',
};

/** Les décisions du journal d'audit, dans les mots du streamer ; un code inconnu reste lisible tel quel. */
const AUDIT_FR: Record<string, string> = {
  raffle_open: 'Tombola ouverte',
  raffle_cancel: 'Tombola annulée',
  raffle_draw: 'Tirage',
  raffle_pause: 'Tombola en pause',
  raffle_resume: 'Tombola reprise',
  raffle_extend: 'Temps ajouté',
  raffle_config: 'Réglages de la Tombola',
  raffle_add_participant: 'Participant ajouté',
  raffle_remove_participant: 'Participant retiré',
  raffle_no_participants: 'Tombola sans participant',
  scheduler_start: 'Tombola automatique lancée',
  scheduler_stop: 'Tombola automatique arrêtée',
  block_viewer: 'Viewer bloqué',
  unblock_viewer: 'Viewer débloqué',
  set_staff: 'Équipe modifiée',
  set_permission: 'Droits modifiés',
  word_add: 'Mot ajouté',
  word_remove: 'Mot retiré',
  allow: 'Demande laissée passer',
  cancel: 'Demande retirée',
  stop: 'Lecture coupée',
  stop_current: 'Lecture coupée',
  purge: 'File vidée',
  refund: 'Remboursement',
  module_state: 'État du module changé',
  global_pause: 'Pause globale',
  cooldown_set: 'Délai imposé',
  cooldown_clear: 'Délai retiré',
  cooldown_running_set: 'Délai en cours modifié',
  cooldown_running_clear: 'Délai en cours retiré',
  note_add: 'Note ajoutée',
  wallet_adjust: 'Solde ajusté',
  lab_wallet_adjust: 'Solde de test ajusté',
  stream_start: 'Live démarré',
  stream_end: 'Live terminé',
  scheduler_skip: 'Tombola automatique passée',
  raffle_retry_payout: 'Gain relancé',
  sw_mode: 'Roue : mode changé',
  sw_announce_delay: 'Roue : délai d’annonce changé',
  sw_invitations: 'Roue : invitations changées',
  sw_grant: 'Roue : tour accordé',
  sw_draw_request: 'Roue : tirage demandé',
  sw_confirm_shown: 'Roue : confirmation affichée',
  sw_redraw: 'Roue : nouveau tirage',
  sw_replay: 'Roue : tirage rejoué',
};
/** Les motifs fixes du Core ; un motif écrit à la main reste tel quel. */
const REASON_FR: Record<string, string> = {
  stopped_by_moderator: 'coupé par la modération',
  cancelled_by_moderator: 'retiré par la modération',
  failed_before_start: 'échec avant la lecture',
};
/** Une panne dit ce qui manque ; le code technique reste dans le journal de Système. */
const plainIncident = (t: string) => t.replace(/ \([a-z_]+\)/, '');

/** Pure: newest first, at most `max`. */
export function mergeFeed(
  history: HistoryEntry[],
  modules: ModuleActivity[],
  audit: AuditEntry[],
  labels: (id: string) => string,
  max = 60,
): FeedItem[] {
  return [
    ...history.map((h): FeedItem => ({
      at: h.at,
      kind: 'incident',
      title: h.label,
      text: plainIncident(h.text),
      page: 'systeme',
    })),
    ...modules.map((m): FeedItem => ({
      at: m.created_at,
      kind: 'module',
      title: labels(m.module_id),
      text: `${m.viewer?.display_name ?? 'Studio'} · ${m.action}${m.amount ? ` · ${m.amount} Jetons` : ''} · ${STATUS[m.status] ?? m.status}`,
      page: m.module_id.replace(/_/g, '-'),
    })),
    ...audit.map((a): FeedItem => ({
      at: a.created_at,
      kind: 'moderation',
      title: a.module_id ? labels(a.module_id) : 'Modération',
      text: [
        ...(/^(studio(:|$)|system$)/.test(a.actor) ? [] : [a.actor]),
        AUDIT_FR[a.action] ?? a.action,
        ...(a.reason ? [REASON_FR[a.reason] ?? a.reason] : []),
      ].join(' · '),
      page: 'moderation',
    })),
  ]
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
    .slice(0, max);
}

const KIND: Record<FeedKind, string> = {
  incident: 'Incident',
  module: 'Module',
  moderation: 'Modération',
};
export const FEED_FILTERS: [FeedFilter, string][] = [
  ['all', 'Tout'],
  ['incident', 'Incidents'],
  ['module', 'Modules'],
  ['moderation', 'Modération'],
];

/** Pure. `missing`: the sources that did not answer; one is said, never read as « nothing happened ». */
export function feedHtml(
  items: FeedItem[],
  filter: FeedFilter,
  href: (page: string) => string,
  missing: string[],
  find = '',
) {
  const q = find.trim().toLowerCase();
  const shown = items
    .filter((i) => filter === 'all' || i.kind === filter)
    .filter((i) => !q || `${i.title} ${i.text}`.toLowerCase().includes(q))
    // La même ligne répétée à la suite : une seule, avec son nombre.
    .reduce<(FeedItem & { n: number })[]>((out, i) => {
      const last = out.at(-1);
      if (last && last.title === i.title && last.text === i.text) last.n += 1;
      else out.push({ ...i, n: 1 });
      return out;
    }, []);
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  const hour = (iso: string) =>
    new Date(iso).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  let at = '';
  const rows = shown
    .map((i) => {
      const d = day(i.at);
      const head = d === at ? '' : `<li class="ac-day">${esc(d)}</li>`;
      at = d;
      return `${head}<li class="ac-e" data-kind="${i.kind}"><time>${esc(hour(i.at))}</time><i title="${KIND[i.kind]}"></i><a href="${href(i.page)}" data-page="${esc(i.page)}"><b>${esc(i.title)}</b><span>${esc(i.text)}${i.n > 1 ? ` · ${i.n} fois` : ''}</span></a></li>`;
    })
    .join('');
  return `${missing.length ? `<p class="d-note bad">Non lu : ${esc(missing.join(', '))}.</p>` : ''}${rows ? `<ol class="ac-feed">${rows}</ol>` : `<p class="d-empty">${q ? 'Rien ne correspond.' : filter === 'incident' ? 'Aucun incident enregistré.' : 'Rien pour l’instant.'}</p>`}`;
}

/** The two read routes behind the feed (null: not readable on this profile). */
export async function loadFeedSources() {
  const [modules, audit] = await Promise.all([
    tryGetJson<{ items: ModuleActivity[] }>('/api/modules/activity?limit=50'),
    tryGetJson<{ audit: AuditEntry[] }>('/api/lab/audit?limit=50'),
  ]);
  return { modules: modules?.items ?? null, audit: audit?.audit ?? null };
}
