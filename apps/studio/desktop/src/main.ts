import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { setupUpdater } from './updater.js';

// Electron shell: starts the local Studio server (hidden), shows its web UI, and on exit asks the
// server to stop what it started (bot, Core) before quitting. Postgres is left running.
//
// Packaged (Raptoru Studio.exe): the server, Core and bot run on the Node embedded in the exe
// (ELECTRON_RUN_AS_NODE), and the local data (.env, tokens, PIDs) is read from the Raptoru folder
// named in %APPDATA%\Raptoru Studio\studio.json, never from the package.

const STUDIO_PORT = 4100;
const studioUrl = process.env.STUDIO_URL ?? `http://127.0.0.1:${STUDIO_PORT}`;
const serverEntry = fileURLToPath(
  new URL('../../server/dist/index.js', import.meta.url),
);

let server: ChildProcess | null = null;
let quitting = false;
let win: BrowserWindow | null = null;

// One Studio at a time: a second launch focuses the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

/** Local Raptoru folder holding the .env files and tokens (packaged app only). */
function dataRoot(): string | null {
  if (process.env.RAPTORU_DATA_ROOT) return process.env.RAPTORU_DATA_ROOT;
  if (!app.isPackaged) return null; // development: code and data are the same repository
  const configFile = join(app.getPath('userData'), 'studio.json');
  try {
    const { dataRoot } = JSON.parse(readFileSync(configFile, 'utf8')) as {
      dataRoot?: string;
    };
    if (dataRoot) return dataRoot;
  } catch {
    /* handled below */
  }
  throw new Error(
    `local data folder not configured: create ${configFile} with {"dataRoot": "C:\\\\path\\\\to\\\\Raptoru 2.0"}`,
  );
}

async function serverUp(): Promise<boolean> {
  try {
    return (
      await fetch(`${studioUrl}/health`, { signal: AbortSignal.timeout(1000) })
    ).ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<void> {
  if (await serverUp()) return; // already running (e.g. started by hand): reuse it
  const root = dataRoot();
  // Packaged: the exe's own Node. Development: system Node (v24+). No console window either way.
  server = app.isPackaged
    ? spawn(process.execPath, [serverEntry], {
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          RAPTORU_PACKAGED: '1',
          ...(root ? { RAPTORU_DATA_ROOT: root } : {}),
        },
      })
    : spawn('node', [serverEntry], {
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ...(root ? { RAPTORU_DATA_ROOT: root } : {}) },
      });
  server.on('exit', () => {
    server = null;
  });
  for (let i = 0; i < 50; i++) {
    if (await serverUp()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Studio server did not start');
}

async function stopServer(): Promise<void> {
  const child = server;
  if (!child) return;
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => resolve()),
  );
  await fetch(`${studioUrl}/api/shutdown`, {
    method: 'POST',
    headers: { 'x-raptoru-studio': '1' },
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
  const timer = setTimeout(() => child.kill(), 10_000); // graceful stop of bot/Core first
  await exited;
  clearTimeout(timer);
}

void app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    title: 'Raptoru Studio',
    backgroundColor: '#111317',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
    },
  });
  win.on('closed', () => {
    win = null;
  });
  const updater = setupUpdater({
    getWindow: () => win,
    stopServer,
    log: (...args) => console.log(...args),
  });
  try {
    await ensureServer();
    await win.loadURL(studioUrl);
    // Silent: only ever surfaces 'available' (renderer shows the button) — never downloads,
    // never installs without the user clicking "Mettre à jour" / "Redémarrer et installer".
    setTimeout(() => updater.checkSilently(), 3000);
  } catch (error) {
    await win.loadURL(
      `data:text/plain;charset=utf-8,${encodeURIComponent(`Raptoru Studio: ${(error as Error).message}`)}`,
    );
  }

  // Smoke test: STUDIO_SCREENSHOT=path.png captures the window after load, then quits.
  const shot = process.env.STUDIO_SCREENSHOT;
  if (shot) {
    setTimeout(
      async () => {
        try {
          await writeFile(shot, (await win!.webContents.capturePage()).toPNG());
        } catch (error) {
          console.error('screenshot failed', error);
        } finally {
          app.quit();
        }
      },
      Number(process.env.STUDIO_SCREENSHOT_DELAY_MS ?? 4000),
    );
  }
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', (event) => {
  if (quitting || !server) return;
  event.preventDefault();
  quitting = true;
  void stopServer().finally(() => app.quit());
});
