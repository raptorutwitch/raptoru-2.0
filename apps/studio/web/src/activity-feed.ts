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
};

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
      text: h.text,
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
      text: `${/^studio(:|$)/.test(a.actor) ? 'Studio' : a.actor} · ${AUDIT_FR[a.action] ?? a.action}${a.reason ? ` · ${a.reason}` : ''}`,
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
) {
  const shown = items.filter((i) => filter === 'all' || i.kind === filter);
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
      return `${head}<li class="ac-e" data-kind="${i.kind}"><time>${esc(hour(i.at))}</time><i title="${KIND[i.kind]}"></i><a href="${href(i.page)}" data-page="${esc(i.page)}"><b>${esc(i.title)}</b><span>${esc(i.text)}</span></a></li>`;
    })
    .join('');
  return `${missing.length ? `<p class="d-note bad">Non lu : ${esc(missing.join(', '))}.</p>` : ''}${rows ? `<ol class="ac-feed">${rows}</ol>` : '<p class="d-empty">Rien pour l’instant.</p>'}`;
}

/** The two read routes behind the feed (null: not readable on this profile). */
export async function loadFeedSources() {
  const [modules, audit] = await Promise.all([
    tryGetJson<{ items: ModuleActivity[] }>('/api/modules/activity?limit=50'),
    tryGetJson<{ audit: AuditEntry[] }>('/api/lab/audit?limit=50'),
  ]);
  return { modules: modules?.items ?? null, audit: audit?.audit ?? null };
}
