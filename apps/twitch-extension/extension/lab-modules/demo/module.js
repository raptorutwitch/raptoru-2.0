// LAB ONLY — fictitious module proving that the v2 socle takes an independent module (docs/extension/SOCLE.md
// « Ajouter un module »). Never packaged: scripts/package.mjs drops lab-modules/ and verify-package.mjs refuses it.
// Loaded by app/v2.js only when the runtime says `labModules: true` (Studio Lab, responsive bench — never a package)
// AND the page asks for it (?labModules=1). No Core call, no Jeton, no purchase.
//
// This file is the module's ENTRY: what the Hub needs (card, availability), nothing else. The view and its sheet
// (view.js, demo.css) are loaded when the module is opened.
import { registerSessionModule } from '../../shared/module-registry.js';

/** Lifecycle trace read by the bench (test/responsive/lab-module.mjs). */
const trace = (globalThis.__raptoruLabDemo ??= { events: [], removed: false });
export const labDemoEvent = (name) => trace.events.push(name);

/** « Retirer le module » : the module stops being offered; the host closes it and the Hub drops its card. */
export function removeLabDemo() {
  trace.removed = true;
}

registerSessionModule({
  id: 'lab_demo',
  card: () => ({
    id: 'lab_demo',
    label: 'Démo Lab',
    icon: '🧪',
    description: 'Module fictif du socle v2 (Lab seulement)',
  }),
  available: ({ state }) => Boolean(state) && !trace.removed,
  // Live hook of the registry: a new session while the module is open goes to its view (true = absorbed).
  onState: (view, next) => view.onState?.(next) === true,
  lazy: {
    load: () => import('./view.js'),
    styles: ['lab-modules/demo/demo.css'],
    // Proof of loading on demand: not fetched in the background with the other modules.
    prefetch: false,
  },
});
labDemoEvent('entry');
