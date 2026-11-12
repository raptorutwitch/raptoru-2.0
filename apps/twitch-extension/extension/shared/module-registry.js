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
      // A view may name its Hub card itself (Random Ban's card is « Mini-jeux »).
      label: views.get(m.id).presentation.label ?? m.label,
      description: views.get(m.id).presentation.description ?? m.description,
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
  variantDefs.length = 0;
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
 * Hub), intro?: boolean (the host's intro above the view, default true), headLabel?: string (the open module's header
 * title, when it should say more than the Hub card's label), bodyData?: { [key]: value } (body dataset) }.
 * Shell v2 only — `lazy: { load: () => import('./view.js'), styles?: [href], prefetch?: boolean }` in place of `view`:
 * the entry file stays tiny (card + availability), the view file (exporting `view`) and its sheets are loaded when
 * the module is opened (app/lazy-views.js). The legacy panel (ui.js) never imports such a module.
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

// --- Module variants ------------------------------------------------------------------------------------------------
// A view that takes over a module the SESSION lists when it applies (TTS V2 when the session says `tts_v2`, Tombola V2
// when it says `raffle_v2`…). Registered from the module's own file: ui.js has no branch, state or fast-refresh rule of
// its own for it. The smallest lifecycle contract (every hook optional, so a module without live updates writes none):
//   view(ctx) → { node, start?(), attached?(), destroy?() }  created once while the module is open, destroyed on leaving
//   rendered?(view, ctx)                                       each time the host draws the module (fresh module / state)
//   onState?(view, next, prev, ctx) → boolean                  a new session state while it is open: true = absorbed
//                                                              (the host does not redraw — no replayed animation)
// ctx = { document, client, module, state, team, host }, host = { home(), refresh(), payment, walletMethods(),
// restrictionChips(id) } — what ui.js used to hand these modules by hand.

const variantDefs = [];

/** `def` = { id, match({ module, state, client, document }) → boolean, view, rendered?, onState?, intro?, bodyData?,
 * screenClass?, ownHeader? (the module draws its own header: the host puts no restriction chips in its own) }. */
export function registerModuleVariant(def) {
  variantDefs.push(def);
}

export function moduleVariant(env) {
  return variantDefs.find((d) => d.id === env.module?.id && d.match(env)) ?? null;
}
