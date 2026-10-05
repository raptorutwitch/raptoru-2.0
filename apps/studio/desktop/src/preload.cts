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

// Studio server supervised by Electron: state and recovery work even when the server is dead.
const server = {
  getState: () => ipcRenderer.invoke('studio:server:state'),
  restart: () => ipcRenderer.invoke('studio:server:restart'),
  relaunchApp: () => ipcRenderer.invoke('studio:app:relaunch'),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('studio:server:state', listener);
    return () => ipcRenderer.removeListener('studio:server:state', listener);
  },
};

// Studio profile (Lab / Production): main confirms with a native dialog, then restarts the server.
const profile = {
  select: (name: 'lab' | 'production') =>
    ipcRenderer.invoke('studio:profile:select', name),
  regenerate: () => ipcRenderer.invoke('studio:profile:regenerate'),
};

contextBridge.exposeInMainWorld('raptoruStudio', { update, server, profile });
