// Halloween Chaos (docs/HALLOWEEN.md § 4 bis) — sandboxed preload of the « Raptoru Chaos » window only. Chromium always
// draws the mouse cursor into a screen capture; the page hides that captured copy (the real cursor stays the one Windows
// draws), so it needs to know where the cursor is: Electron main sends its position on this monitor. Read-only. Kept as
// CommonJS (.cts -> .cjs) like preload.cts: sandboxed preload scripts are always loaded as CommonJS.
// verbatimModuleSyntax forbids `import` in a .cts file; this is the CommonJS the file compiles to.
const {
  contextBridge,
  ipcRenderer,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('electron') as typeof import('electron');

interface CursorAt {
  /** Position in the captured monitor, as a fraction of its width / height (outside 0–1: on another monitor). */
  x: number;
  y: number;
  /** The monitor's scale factor (the cursor's size in captured pixels). */
  scale: number;
}

let latest: CursorAt | null = null;
let previous: CursorAt | null = null;
ipcRenderer.on('chaos-cursor', (_event: unknown, at: CursorAt) => {
  previous = latest;
  latest = at;
});

contextBridge.exposeInMainWorld('raptoruChaos', {
  /** The cursor now and just before (a captured frame may show either). */
  cursor: () => ({ latest, previous }),
});
