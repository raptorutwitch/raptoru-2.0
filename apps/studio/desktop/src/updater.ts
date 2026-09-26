import { app, ipcMain, type BrowserWindow } from 'electron';
// electron-updater is a CommonJS module without named ESM exports: destructure the default import.
import electronUpdaterPkg from 'electron-updater';
import {
  initialUpdateState,
  nextUpdateState,
  type UpdateEvent,
  type UpdateState,
} from './update-state.js';

// One update channel, driven entirely by explicit renderer action (IPC), except a single silent
// check on startup (never downloads, never installs on its own — see checkSilently below).
// The renderer never talks to electron-updater directly: it only sees `UpdateState` snapshots.

const { autoUpdater } = electronUpdaterPkg;

const STATE_CHANNEL = 'studio:update:state';

export interface Updater {
  /** Silent, once at startup: only ever moves to 'available' or 'not-available'/'error'. Never downloads. */
  checkSilently(): void;
}

export function setupUpdater(deps: {
  getWindow: () => BrowserWindow | null;
  /** Graceful shutdown of the local server (bot/Core) before the installer replaces the app. */
  stopServer: () => Promise<void>;
  log: (...args: unknown[]) => void;
}): Updater {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false; // only 'studio:update:install' may install
  autoUpdater.logger = {
    info: (m: unknown) => deps.log('[updater]', m),
    warn: (m: unknown) => deps.log('[updater]', m),
    error: (m: unknown) => deps.log('[updater]', m),
    debug: (m: unknown) => deps.log('[updater]', m),
  };

  let state: UpdateState = initialUpdateState(app.getVersion());
  const apply = (event: UpdateEvent) => {
    state = nextUpdateState(state, event);
    deps.getWindow()?.webContents.send(STATE_CHANNEL, state);
  };

  autoUpdater.on('checking-for-update', () => apply({ type: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    apply({ type: 'available', version: info.version }),
  );
  autoUpdater.on('update-not-available', () =>
    apply({ type: 'not-available' }),
  );
  autoUpdater.on('download-progress', (p) =>
    apply({ type: 'progress', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    apply({ type: 'downloaded', version: info.version }),
  );
  autoUpdater.on('error', (error) =>
    apply({ type: 'error', message: error.message }),
  );

  const check = async () => {
    if (!app.isPackaged) {
      apply({
        type: 'unsupported',
        message:
          'Mise à jour indisponible en développement (app non packagée).',
      });
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      apply({ type: 'error', message: (error as Error).message });
    }
  };

  ipcMain.handle(STATE_CHANNEL, () => state);
  ipcMain.handle('studio:update:check', check);
  ipcMain.handle('studio:update:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      apply({ type: 'error', message: (error as Error).message });
    }
  });
  ipcMain.handle('studio:update:install', async () => {
    await deps.stopServer();
    autoUpdater.quitAndInstall();
  });

  return {
    checkSilently() {
      void check();
    },
  };
}
