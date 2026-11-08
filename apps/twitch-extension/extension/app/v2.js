// Shell v2 entry (loaded by app/boot.js once its first sheets are in): the single layout measurement, then the one
// viewer entry of every surface (app/main.js, which replaces overlay.js / mobile.js in this shell).
import { startLayout } from './layout.js';
import { startViewer } from './main.js';
import { RUNTIME } from '../shared/runtime-config.js';

// Lab-only modules (lab-modules/, never packaged): only where the runtime allows them (Studio Lab, responsive bench —
// no package writes `labModules`) AND the page asks for them. A failure here never stops the extension.
if (RUNTIME.labModules === true && new URLSearchParams(window.location.search).get('labModules') === '1') {
  await import('../lab-modules/demo/module.js').catch(() => {});
}

const layout = startLayout();
startViewer({ surface: layout.surface });
