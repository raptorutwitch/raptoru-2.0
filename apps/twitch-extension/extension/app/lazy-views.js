// Shell v2 — views loaded on demand (plan § 15). The heavy views are not imported by the panel: they are imported
// here when their module is opened (or in the background once the Hub is shown), with their stylesheets, and they
// register themselves in shared/module-registry.js exactly as before. Order inside an entry = registration order
// of the legacy panel (V2 before V1). Lightweight session modules (Événements, Commandes, Roue, Coffre) and Tombola
// stay eager: the Hub needs their cards and availability.
//
// A NEW module needs no line here: its session entry declares `lazy` (shared/module-registry.js) and only its small
// entry file (card + availability) is imported up front; its view and sheets come on opening, like below.
import { loadStyles } from './styles.js';
import { sessionModule } from '../shared/module-registry.js';

const LAZY = {
  soundboard: { styles: ['modules/soundboard/soundboard.css'], load: [() => import('../shared/soundboard-view.js')] },
  bonk: {
    styles: ['app/css/picker.css', 'modules/bonk/bonk-chargeur.css'],
    load: [() => import('../shared/bonk-view.js')],
  },
  tts: { styles: ['modules/tts/tts.css'], load: [() => import('../shared/tts-v2.js'), () => import('../shared/tts-v1.js')] },
  // Session module « Commandes » (eager JS: the Hub needs its card): only its sheet comes on opening.
  commands: { styles: ['modules/commands/commands.css'], load: [] },
  moderation: {
    styles: ['modules/moderation/moderation.css', 'modules/commands/commands.css'],
    load: [() => import('../shared/moderation-v2.js'), () => import('../shared/moderation-v1.js')],
  },
};

/** The entry of a module: the built-in list above, or a session module's own `lazy` (its view arrives on load). */
function entryOf(id) {
  if (LAZY[id]) return LAZY[id];
  const def = sessionModule(id);
  if (!def?.lazy) return null;
  return {
    styles: def.lazy.styles ?? [],
    prefetch: def.lazy.prefetch !== false,
    load: [async () => {
      const loaded = await def.lazy.load();
      if (typeof loaded?.view !== 'function') throw new Error(`module ${id}: its lazy file exports no view()`);
      def.view = loaded.view;
    }],
  };
}

const ready = new Set();
const pending = new Map();

export const lazyViewReady = (id) => !entryOf(id) || ready.has(id);

export function loadLazyView(id) {
  if (lazyViewReady(id)) return Promise.resolve();
  if (!pending.has(id)) {
    const entry = entryOf(id);
    pending.set(id, (async () => {
      await loadStyles(entry.styles);
      for (const load of entry.load) await load();
      ready.add(id);
    })().finally(() => pending.delete(id)));
  }
  return pending.get(id);
}

let prefetched = false;
/** Once, after the Hub's first paint: the modules it offers, when the browser is idle. Errors are silent here. */
export function prefetchLazyViews(ids) {
  if (prefetched) return;
  prefetched = true;
  const go = () => { for (const id of ids) if (entryOf(id)?.prefetch !== false) loadLazyView(id).catch(() => {}); };
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 1500);
}
