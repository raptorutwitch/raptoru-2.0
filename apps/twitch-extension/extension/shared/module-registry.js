// Viewer modules of the module host (docs/studio-refonte/architecture/GUIDE_EXTENSION.md). ONE registry instead of the
// per-module if-chain of ui.js (architecture friction E2): a module registers its view factory here; the host (ui.js)
// shows it in the Hub when the SERVER lists it (capability negotiation, friction E4) and renders it — no per-module
// branch, constant, guard or style to add in ui.js. A module the server lists but this build does not know is NOT
// shown (never an empty screen); a module this build knows but the server does not list is not shown either.

const views = new Map();
let catalog = [];
let loaded = false;

/**
 * `factory({ document, client, module })` → `{ node, start(), destroy?(), attached?() }`. `module` = the server's entry
 * (id, label, description, category, enabled, actions with price and live rule).
 */
export function registerViewerModule(id, factory, presentation = {}) {
  views.set(id, { factory, presentation });
}

export function viewerModuleView(id) {
  return views.get(id)?.factory ?? null;
}

/** The Hub entries: the server's modules that this build can show (same shape as the session's `modules`). */
export function hostModules() {
  return catalog
    .filter((m) => views.has(m.id) && m.enabled !== false)
    .map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
      icon: views.get(m.id).presentation.icon ?? '✨',
      host: true,
      server: m,
    }));
}

/** Reads the server's list once per session refresh (an older server without the route: none, said nowhere). */
let lastLoad = 0;
export async function loadHostModules(client, onChange, now = Date.now()) {
  if (typeof client?.moduleCatalog !== 'function') return;
  if (now - lastLoad < 30_000) return; // the Hub redraws often: the server's list is read at most every 30 s
  lastLoad = now;
  try {
    const out = await client.moduleCatalog();
    const next = Array.isArray(out?.modules) ? out.modules : [];
    const changed = !loaded || JSON.stringify(next) !== JSON.stringify(catalog);
    catalog = next;
    loaded = true;
    if (changed) onChange?.();
  } catch {
    // Unavailable (older Core, network): keep what was shown; a host module never appears without the server.
  }
}

/** Tests only. */
export function resetHostModulesForTests() {
  views.clear();
  sessionDefs.clear();
  catalog = [];
  loaded = false;
  lastLoad = 0;
}

// --- Session modules -------------------------------------------------------------------------------------------------
// A module the EBS's SESSION offers (not /modules/v3): Commandes, Roue du Sub, Événements… Each one registers here from
// its own file — its Hub card, when it is offered, its view and how the host frames it — so ui.js has no branch, constant,
// availability check or state of its own for it (architecture/MIGRATIONS.md, extension).

const sessionDefs = new Map();

/**
 * `def` = { id, card(state) → { id, label, icon, description }, available({ state, client, document }) → boolean,
 * view({ document, client, module, team }) → { node, start(), attached?(), destroy?() }, hubFirst?: boolean (top of the
 * Hub), intro?: boolean (the host's intro above the view, default true), bodyData?: { [key]: value } (body dataset) }.
 */
export function registerSessionModule(def) {
  sessionDefs.set(def.id, def);
}

export function sessionModule(id) {
  return sessionDefs.get(id) ?? null;
}

/** In registration order (the import order in ui.js). */
export function sessionModules() {
  return [...sessionDefs.values()];
}
