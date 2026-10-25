// Global banner of the live incidents (incident 22/10, docs/PLAN_SUPERVISION_2026-10-23.md lot 2), above every tab.
// Data: GET /api/supervision (apps/studio/server/src/supervision/supervisor.ts) — only CONFIRMED incidents (≥ 30 s), never
// the microcoupures. An ongoing incident stays while it lasts; once over it turns green and stays until « Vu ».

export interface Incident {
  id: string;
  signal: string;
  label: string;
  cause: string | null;
  value: string;
  hint: string | null;
  action: 'auto' | 'manual' | null;
  startedAt: string;
  confirmedAt: string;
  endedAt: string | null;
  acknowledged: boolean;
}
export interface HistoryEntry {
  at: string;
  signal: string;
  label: string;
  kind: 'down' | 'confirmed' | 'up' | 'micro';
  text: string;
}
export interface SupervisionSnapshot {
  now: string;
  incidents: Incident[];
  history: HistoryEntry[];
}

const HEADERS = { 'x-raptoru-studio': '1' };
const REFRESH_MS = 5000;

const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export function lasted(fromIso: string, toIso: string) {
  const s = Math.max(
    0,
    Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000),
  );
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60
    ? `${m} min ${String(s % 60).padStart(2, '0')} s`
    : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Pure: the banner for these incidents ('' when there is nothing to show). */
export function renderBanner(snap: SupervisionSnapshot): string {
  const active = snap.incidents.filter((i) => !i.endedAt);
  const ended = snap.incidents.filter((i) => i.endedAt && !i.acknowledged);
  if (!active.length && !ended.length) return '';
  const activeHtml = active
    .map(
      (
        i,
      ) => `<div class="sup-item sup-down" role="alert" data-incident="${esc(i.id)}">
      <b>${esc(i.label)} : ${esc(i.value)}</b>
      <span>depuis ${esc(clock(i.startedAt))} (${esc(lasted(i.startedAt, snap.now))})${i.cause ? ` · ${esc(i.cause)}` : ''}</span>
      <span class="sup-action">${i.action === 'manual' ? 'Action requise' : 'Récupération automatique en cours'}</span>
      ${i.hint ? `<p>${esc(i.hint)}</p>` : ''}
    </div>`,
    )
    .join('');
  const endedHtml = ended
    .map(
      (
        i,
      ) => `<div class="sup-item sup-up" role="status" data-incident="${esc(i.id)}">
      <b>${esc(i.label)} rétabli</b>
      <span>indisponible de ${esc(clock(i.startedAt))} à ${esc(clock(i.endedAt!))} (${esc(lasted(i.startedAt, i.endedAt!))})${i.cause ? ` · ${esc(i.cause)}` : ''}</span>
      <button type="button" data-sup-ack="${esc(i.id)}">Vu</button>
    </div>`,
    )
    .join('');
  return `<div class="sup-banner-inner">${activeHtml}${endedHtml}</div>`;
}

/** Pure: the short history (newest first) for the Centre de contrôle. */
export function renderHistory(history: HistoryEntry[], max = 15): string {
  if (!history.length)
    return '<p class="muted">Aucune coupure depuis le démarrage de Studio.</p>';
  return `<ul class="sup-history">${history
    .slice(0, max)
    .map(
      (h) =>
        `<li class="sup-h-${esc(h.kind)}"><time>${esc(clock(h.at))}</time> <b>${esc(h.label)}</b> ${esc(h.text)}</li>`,
    )
    .join('')}</ul>`;
}

export async function fetchSupervision(): Promise<SupervisionSnapshot | null> {
  try {
    const res = await fetch('/api/supervision', { headers: HEADERS });
    return res.ok ? ((await res.json()) as SupervisionSnapshot) : null;
  } catch {
    return null;
  }
}

/** Mounted once under the top bar: polls whatever tab is open. */
export function mountSupervisionBanner(root: HTMLElement) {
  let last = '';
  async function refresh() {
    const snap = await fetchSupervision();
    // Studio server unreachable: the Centre de contrôle says so; the banner keeps its last state.
    if (!snap) return;
    const html = renderBanner(snap);
    if (html === last) return;
    last = html;
    root.innerHTML = html;
    root.hidden = !html;
  }
  root.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-sup-ack]')
      ?.dataset.supAck;
    if (!id) return;
    void fetch('/api/supervision/ack', {
      method: 'POST',
      headers: { ...HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(() => refresh());
  });
  const loop = async () => {
    await refresh();
    setTimeout(() => void loop(), REFRESH_MS);
  };
  void loop();
}
