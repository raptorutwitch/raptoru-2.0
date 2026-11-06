import { esc, patch, poller, stateChip } from './ds/ds.js';
import { fetchSupervision, renderHistory } from './supervision-banner.js';

// L'état des services dans Système. One entry per module, every one drawn by the SAME renderer from the server's ModuleStatus
// (apps/studio/server/src/control-center/model.ts): a new module = a new server provider, nothing to add here. Reading only.

export type StatusLevel = 'ok' | 'warn' | 'error' | 'off' | 'unknown';
export interface StatusFact {
  label: string;
  value: string;
  level?: StatusLevel;
}
export interface ModuleStatus {
  id: string;
  label: string;
  level: StatusLevel;
  state: string;
  summary: string;
  facts: StatusFact[];
  hint: string | null;
  checkedAt: string;
  data?: Record<string, unknown>;
}

const HEADERS = { 'x-raptoru-studio': '1' };
const DOT: Record<StatusLevel, '' | 'w' | 'off' | 'r'> = {
  ok: '',
  warn: 'w',
  error: 'r',
  off: 'off',
  unknown: 'w',
};

/** One module (pure: reused by every module). */
export function renderStatusTile(s: ModuleStatus): string {
  const facts = s.facts
    .map(
      (f) =>
        `<dt>${esc(f.label)}</dt><dd${f.level ? ` data-l="${esc(f.level)}"` : ''}>${esc(f.value)}</dd>`,
    )
    .join('');
  return `<section class="sy-st" data-module="${esc(s.id)}">
    <header><h3>${esc(s.label)}</h3>${stateChip(DOT[s.level], s.state)}</header>
    <p>${esc(s.summary)}</p>
    ${facts ? `<details class="d-acc"><summary>Détails techniques</summary><dl class="d-kv">${facts}</dl></details>` : ''}
    ${s.hint ? `<p class="d-note">${esc(s.hint)}</p>` : ''}
  </section>`;
}

/** Studio server unreachable: one honest entry instead of stale ones. */
export const UNREACHABLE: ModuleStatus = {
  id: 'studio',
  label: 'Serveur Studio',
  level: 'error',
  state: 'Injoignable',
  summary: 'Le serveur local de Studio ne répond pas : aucun statut lisible.',
  facts: [],
  hint: 'Relancer le serveur Studio (Système › Services).',
  checkedAt: new Date(0).toISOString(),
};

export function mountControlCenter(root: HTMLElement) {
  root.innerHTML = `<div data-slot="cc-tiles"><p class="d-note">Chargement…</p></div>
    <p class="d-note" data-slot="cc-updated"></p>
    <h2 class="d-lb">Coupures récentes</h2>
    <p class="d-note">Depuis le démarrage de Studio : chaque coupure, même courte, et son retour.</p>
    <div data-slot="cc-history"></div>`;
  const tiles = root.querySelector<HTMLElement>('[data-slot="cc-tiles"]')!;
  const updated = root.querySelector<HTMLElement>('[data-slot="cc-updated"]')!;
  const history = root.querySelector<HTMLElement>('[data-slot="cc-history"]')!;

  const read = poller(async () => {
    let modules: ModuleStatus[];
    try {
      const res = await fetch('/api/control/status', { headers: HEADERS });
      if (!res.ok) throw new Error(String(res.status));
      modules = ((await res.json()) as { modules: ModuleStatus[] }).modules;
    } catch {
      modules = [UNREACHABLE];
    }
    patch(tiles, modules.map(renderStatusTile).join(''));
    const snap = await fetchSupervision();
    if (snap) patch(history, renderHistory(snap.history));
    updated.textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-FR')}`;
  }, 5000);
  return {
    setVisible(v: boolean) {
      if (v) read.start();
      else read.stop();
    },
  };
}
