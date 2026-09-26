// Sandboxed preload (contextIsolation + sandbox): the only bridge between the Studio web page
// (loaded from http://127.0.0.1:4100, not a local file) and the Electron main process. Kept as
// CommonJS (.cts -> .cjs) because sandboxed preload scripts are always loaded as CommonJS,
// regardless of the package's "type": "module".
// verbatimModuleSyntax forbids `import` in a .cts file; this is the CommonJS the file compiles to.
const {
  contextBridge,
  ipcRenderer,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('electron') as typeof import('electron');

const update = {
  getState: () => ipcRenderer.invoke('studio:update:state'),
  check: () => ipcRenderer.invoke('studio:update:check'),
  download: () => ipcRenderer.invoke('studio:update:download'),
  install: () => ipcRenderer.invoke('studio:update:install'),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('studio:update:state', listener);
    return () => ipcRenderer.removeListener('studio:update:state', listener);
  },
};

contextBridge.exposeInMainWorld('raptoruStudio', { update });
