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
      text: `${a.actor} · ${a.action}${a.reason ? ` · ${a.reason}` : ''}`,
      page: 'moderation',
    })),
  ]
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
    .slice(0, max);
}

const KIND: Record<FeedKind, [string, string]> = {
  incident: ['Incident', 'is-down'],
  module: ['Module', 'is-ok'],
  moderation: ['Modération', 'is-warn'],
};

/** Pure. `read`: the sources that answered; a missing one is said, never read as « nothing happened ». */
export function feedHtml(
  items: FeedItem[],
  filter: FeedFilter,
  href: (page: string) => string,
  missing: string[],
) {
  const shown = items.filter((i) => filter === 'all' || i.kind === filter);
  const when = (iso: string) =>
    new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  const FILTERS: [FeedFilter, string][] = [
    ['all', 'Tout'],
    ['incident', 'Incidents'],
    ['module', 'Modules'],
    ['moderation', 'Modération'],
  ];
  return `<div class="rs-seg" role="group" aria-label="Filtrer l’activité">${FILTERS.map(([id, label]) => `<button type="button" data-feed="${id}" aria-pressed="${filter === id}">${label}</button>`).join('')}</div>
    ${missing.length ? `<p class="rs-state is-unknown">Non lu : ${esc(missing.join(', '))}.</p>` : ''}
    ${
      shown.length
        ? `<ol class="rs-feed">${shown
            .map(
              (i) =>
                `<li><time>${esc(when(i.at))}</time><span class="rs-status ${KIND[i.kind][1]}"><i></i>${KIND[i.kind][0]}</span><a href="${href(i.page)}"><b>${esc(i.title)}</b></a><span>${esc(i.text)}</span></li>`,
            )
            .join('')}</ol>`
        : '<p class="rs-muted">Rien pour l’instant.</p>'
    }`;
}

/** The two read routes behind the feed (null: not readable on this profile). */
export async function loadFeedSources() {
  const [modules, audit] = await Promise.all([
    tryGetJson<{ items: ModuleActivity[] }>('/api/modules/activity?limit=50'),
    tryGetJson<{ audit: AuditEntry[] }>('/api/lab/audit?limit=50'),
  ]);
  return { modules: modules?.items ?? null, audit: audit?.audit ?? null };
}
