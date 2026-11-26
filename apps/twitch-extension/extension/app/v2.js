// Shell v2 entry (loaded by app/boot.js once its first sheets are in): the single layout measurement, then the one
// viewer entry of every surface (app/main.js, which replaces overlay.js / mobile.js in this shell).
import { startLayout } from './layout.js';
import { startViewer } from './main.js';
import { RUNTIME } from '../shared/runtime-config.js';

// Lab-only modules (lab-modules/, never packaged): only where the runtime allows them (Studio Lab, responsive bench —
// no package writes `labModules`) AND the page asks for them. A failure here never stops the extension.
const labAsked = new URLSearchParams(window.location.search).get('labModules');
if (RUNTIME.labModules === true && labAsked === '1') {
  await import('../lab-modules/demo/module.js').catch(() => {});
}
// Maquette « Effets live » (Chaos V2 + Bonk, faux Core), seule : ?labModules=effets (docs/chaos/EXTENSION_EFFETS_LIVE.md).
if (RUNTIME.labModules === true && labAsked === 'effets') {
  await import('../lab-modules/effets/module.js').catch(() => {});
}

const layout = startLayout();
startViewer({ surface: layout.surface });
