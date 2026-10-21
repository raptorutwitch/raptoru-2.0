// Centre de contrôle Studio (plan post-live, lot 3). One tile per module, every tile drawn by the SAME renderer from
// the server's ModuleStatus (apps/studio/server/src/control-center/model.ts): a new module = a new server provider,
// nothing to add here. Reading only for now; each module is still piloted from its own tab.

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
}

const HEADERS = { 'x-raptoru-studio': '1' };
const REFRESH_MS = 5000;
/** Badge class of the existing DA (style.css): ok · warn · ko · idle. */
const BADGE: Record<StatusLevel, string> = {
  ok: 'ok',
  warn: 'warn',
  error: 'ko',
  off: 'idle',
  unknown: 'idle',
};

const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );

/** One module tile (pure: tested, reused by every module). */
export function renderStatusTile(s: ModuleStatus): string {
  const facts = s.facts
    .map(
      (f) =>
        `<div class="cc-fact${f.level ? ` cc-${esc(f.level)}` : ''}"><span>${esc(f.label)}</span><b>${esc(f.value)}</b></div>`,
    )
    .join('');
  return `<section class="cc-tile cc-${esc(s.level)}" data-module="${esc(s.id)}">
    <header class="cc-head"><h3>${esc(s.label)}</h3><span class="badge ${BADGE[s.level]}">${esc(s.state)}</span></header>
    <p class="cc-summary">${esc(s.summary)}</p>
    ${facts ? `<div class="cc-facts">${facts}</div>` : ''}
    ${s.hint ? `<p class="cc-hint">${esc(s.hint)}</p>` : ''}
  </section>`;
}

/** Studio server unreachable: one honest tile instead of stale ones. */
export const UNREACHABLE: ModuleStatus = {
  id: 'studio',
  label: 'Serveur Studio',
  level: 'error',
  state: 'Injoignable',
  summary: 'Le serveur local de Studio ne répond pas : aucun statut lisible.',
  facts: [],
  hint: 'Relancer le serveur Studio (carte « Runtime local »).',
  checkedAt: new Date(0).toISOString(),
};

export function mountControlCenter(root: HTMLElement) {
  root.innerHTML = `<h2>Centre de contrôle</h2>
    <p class="muted">État réel des services du live. Lecture seule pour l’instant : chaque module se pilote encore depuis son onglet.</p>
    <div class="cc-grid" data-slot="cc-tiles"><p class="muted">Chargement…</p></div>
    <p class="cc-updated muted" data-slot="cc-updated"></p>`;
  const tiles = root.querySelector<HTMLElement>('[data-slot="cc-tiles"]')!;
  const updated = root.querySelector<HTMLElement>('[data-slot="cc-updated"]')!;
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function refresh() {
    let modules: ModuleStatus[];
    try {
      const res = await fetch('/api/control/status', { headers: HEADERS });
      if (!res.ok) throw new Error(String(res.status));
      modules = ((await res.json()) as { modules: ModuleStatus[] }).modules;
    } catch {
      modules = [UNREACHABLE];
    }
    tiles.innerHTML = modules.map(renderStatusTile).join('');
    updated.textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-FR')}`;
  }
  const loop = async () => {
    if (!visible) return;
    await refresh();
    timer = setTimeout(() => void loop(), REFRESH_MS);
  };
  return {
    setVisible(v: boolean) {
      visible = v;
      clearTimeout(timer);
      if (v) void loop();
    },
  };
}
