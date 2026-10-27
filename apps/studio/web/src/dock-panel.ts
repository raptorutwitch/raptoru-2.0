// Dock OBS V1 (docs/OBS_DOCK.md) — Studio's panel for the OBS dock, in the Alertes tab: the URL to paste into OBS
// (it holds the dock key: hidden by default, copied in one click), the open docks and the feed's state, a new key.

const HEADERS = { 'x-raptoru-studio': '1', 'content-type': 'application/json' };

interface DockInfo {
  available: boolean;
  reason: string | null;
  url: string | null;
  clients?: number;
  feed?: { state: string; error: string | null };
}

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

const FEED: Record<string, string> = {
  live: 'Flux en direct',
  connecting: 'Connexion au Core…',
  stale: 'Core injoignable (cache affiché)',
  idle: 'En pause (aucun dock ouvert)',
};

/** The panel's HTML (pure, tested). */
export function dockPanelView(
  info: DockInfo | null,
  error: string | null,
  shown = false,
) {
  if (error) return `<p class="al-hint">Dock indisponible : ${esc(error)}</p>`;
  if (!info) return '<p class="al-hint">Chargement…</p>';
  if (!info.available)
    return `<p class="al-hint">Dock indisponible${info.reason === 'port_in_use' ? ' : son port est déjà utilisé (fermer l’autre Studio ou régler DOCK_PORT)' : info.reason === 'no_core' ? ' : aucun Core pour ce profil' : ''}.</p>`;
  const masked = info.url ? info.url.replace(/#key=.*/, '#key=••••••••') : '';
  return `<div class="al-url"><input readonly data-role="dock-url" value="${esc(shown ? info.url : masked)}" aria-label="URL du dock OBS"/>
      <button type="button" class="al-small" data-act="dock-copy">Copier</button>
      <button type="button" class="al-small" data-act="dock-show">${shown ? 'Masquer' : 'Afficher'}</button></div>
    <p class="al-hint">OBS → Docks → Docks de navigateur personnalisés : nom « Raptoru », URL collée. Le dock affiche les
      événements reçus et rejoue une alerte sur demande (animation seulement, jamais l’événement). Il fonctionne tant que
      Studio est ouvert.</p>
    <p class="al-hint">${esc(FEED[info.feed?.state ?? ''] ?? '—')}${info.feed?.error ? ` (${esc(info.feed.error)})` : ''} ·
      ${info.clients ?? 0} dock(s) ouvert(s) ·
      <button type="button" class="al-small" data-act="dock-key" title="L’ancienne URL ne marchera plus : à recoller dans OBS">Nouvelle clé</button></p>`;
}

export function mountDockPanel(root: HTMLElement) {
  let info: DockInfo | null = null;
  let error: string | null = null;
  let shown = false;
  const render = () => (root.innerHTML = dockPanelView(info, error, shown));
  const load = async () => {
    try {
      const res = await fetch('/api/dock', { headers: HEADERS });
      info = (await res.json()) as DockInfo;
      error = res.ok ? null : `HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error).message;
    }
    render();
  };
  root.addEventListener('click', async (ev) => {
    const act = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]')
      ?.dataset.act;
    if (act === 'dock-show') {
      shown = !shown;
      render();
    } else if (act === 'dock-copy' && info?.url) {
      await navigator.clipboard.writeText(info.url).catch(() => {});
    } else if (
      act === 'dock-key' &&
      confirm(
        'Nouvelle clé du dock ?\n\nLes docks ouverts se ferment : recolle la nouvelle URL dans OBS.',
      )
    ) {
      const res = await fetch('/api/dock/key', {
        method: 'POST',
        headers: HEADERS,
      });
      info = (await res.json()) as DockInfo;
      shown = false;
      render();
    }
  });
  render();
  void load();
  const timer = window.setInterval(() => void load(), 10_000);
  return { stop: () => window.clearInterval(timer) };
}
