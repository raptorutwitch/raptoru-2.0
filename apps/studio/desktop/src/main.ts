import { execFile, spawn } from 'node:child_process';
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  renameSync,
  type WriteStream,
} from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { setupUpdater } from './updater.js';
import {
  ServerSupervisor,
  type ChildHandle,
  type Probe,
  type ServerStatus,
} from './server-supervisor.js';

// Electron shell and top supervisor of the local runtime:
//   Electron main → Studio server (supervised here) → Local Runtime Manager → Core / workers.
// The window shows an Electron-owned status page while the server is starting, lost or restarting;
// recovery (restart the server, relaunch the app) goes through IPC, never through the server's own
// HTTP API. The server's output is kept in <userData>/logs/studio-server.log.
//
// Packaged (Raptoru Studio.exe): the server, Core and bot run on the Node embedded in the exe
// (ELECTRON_RUN_AS_NODE), and the local data (.env, tokens, PIDs) is read from the Raptoru folder
// named in %APPDATA%\Raptoru Studio\studio.json, never from the package.

const STUDIO_PORT = 4100;
/** Set only to point the window at a server run by hand (development): not supervised then. */
const externalUrl = process.env.STUDIO_URL ?? null;
const studioUrl = externalUrl ?? `http://127.0.0.1:${STUDIO_PORT}`;
const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = fileURLToPath(
  new URL('../../server/dist/index.js', import.meta.url),
);
const statusPage = join(here, '..', 'static', 'status.html');

// One Studio at a time, whether started from the repository (npm run studio) or installed: both
// use the same profile folder, hence the same single-instance lock. A second launch only focuses
// the existing window (no second server, the first one is never stopped).
app.setPath('userData', join(app.getPath('appData'), 'Raptoru Studio'));
let win: BrowserWindow | null = null;
let quitting = false;
const primary = app.requestSingleInstanceLock();
if (!primary) {
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

// --- server log file (current run + previous run) ----------------------------------------------------
let logFile: WriteStream | null = null;
function serverLog(line: string) {
  if (!logFile) {
    const dir = join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'studio-server.log');
    try {
      renameSync(file, `${file}.1`);
    } catch {
      /* first run */
    }
    logFile = createWriteStream(file, { flags: 'a' });
  }
  logFile.write(`${new Date().toISOString()} ${line}\n`);
}

// --- supervisor dependencies ---------------------------------------------------------------------------
async function probe(): Promise<Probe> {
  try {
    const res = await fetch(`${studioUrl}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    const body = (await res.json().catch(() => null)) as {
      service?: string;
    } | null;
    return res.ok && body?.service === 'studio-server' ? 'studio' : 'other';
  } catch {
    return 'down';
  }
}
function portFree(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(STUDIO_PORT, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}
async function requestShutdown(): Promise<void> {
  await fetch(`${studioUrl}/api/shutdown`, {
    method: 'POST',
    headers: { 'x-raptoru-studio': '1' },
    signal: AbortSignal.timeout(2000),
  });
}
function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32')
      execFile(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true },
        () => resolve(),
      );
    else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }
  });
}
function spawnServer(): ChildHandle {
  const root = dataRoot();
  const env = {
    ...process.env,
    // The server shuts itself down (and its Core) if this process disappears (forced close).
    RAPTORU_PARENT_PID: String(process.pid),
    ...(root ? { RAPTORU_DATA_ROOT: root } : {}),
  };
  // Packaged: the exe's own Node. Development: system Node (v24+). No console window either way.
  const child = app.isPackaged
    ? spawn(process.execPath, [serverEntry], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...env, ELECTRON_RUN_AS_NODE: '1', RAPTORU_PACKAGED: '1' },
      })
    : spawn('node', [serverEntry], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env,
      });
  const outputs: ((line: string) => void)[] = [];
  const pipe = (stream: NodeJS.ReadableStream | null, prefix: string) => {
    let buf = '';
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines)
        if (l.trim()) for (const o of outputs) o(prefix + l);
    });
    // A closed pipe must never crash Electron (EPIPE).
    stream?.on('error', () => {});
  };
  pipe(child.stdout, '');
  pipe(child.stderr, '[stderr] ');
  child.on('error', (e) =>
    outputs.forEach((o) =>
      o(`[supervisor] lancement impossible : ${e.message}`),
    ),
  );
  return {
    pid: child.pid,
    onExit: (l) => child.once('exit', (code) => l(code)),
    onOutput: (l) => outputs.push(l),
  };
}

const supervisor = new ServerSupervisor({
  spawn: spawnServer,
  probe,
  portFree,
  requestShutdown,
  killTree,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: serverLog,
});

// --- window: Electron status page ⇄ Studio UI -------------------------------------------------------------
let showing: 'status' | 'studio' | null = null;
let loadingStudio = false;

function sendStatus(extra: Partial<{ phase: string }> = {}) {
  win?.webContents.send('studio:server:state', {
    ...supervisor.status,
    ...extra,
  });
}
async function showStatusPage() {
  if (!win || showing === 'status') return;
  showing = 'status';
  await win.loadFile(statusPage).catch(() => {});
  sendStatus();
}
/** Server ready: wait for the local Core (bounded), then open the Studio UI. */
async function showStudio() {
  if (!win || showing === 'studio' || loadingStudio) return;
  loadingStudio = true;
  try {
    await showStatusPage();
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline && supervisor.status.state === 'ready') {
      const rt = (await fetch(`${studioUrl}/api/runtime/status`, {
        headers: { 'x-raptoru-studio': '1' },
        signal: AbortSignal.timeout(1500),
      })
        .then((r) => r.json())
        .catch(() => null)) as {
        enabled?: boolean;
        services?: { id: string; state: string; detail: string }[];
      } | null;
      const core = rt?.services?.find((s) => s.id === 'labcore');
      if (
        !rt?.enabled ||
        !core ||
        core.state === 'ready' ||
        core.state === 'error'
      )
        break;
      sendStatus({ phase: `Démarrage du Core local… (${core.detail})` });
      await new Promise((r) => setTimeout(r, 500));
    }
    if (supervisor.status.state !== 'ready' || !win) return;
    showing = 'studio';
    await win.loadURL(studioUrl);
  } finally {
    loadingStudio = false;
  }
}
supervisor.onChange((s: ServerStatus) => {
  sendStatus();
  if (s.state === 'ready') void showStudio();
  else if (
    ['starting', 'crashed', 'restarting', 'fatal', 'stopped'].includes(
      s.state,
    ) &&
    !quitting
  )
    void showStatusPage();
});

ipcMain.handle('studio:server:state', () => supervisor.status);
ipcMain.handle('studio:server:restart', async () => {
  if (externalUrl) return supervisor.status;
  void supervisor.restart();
  return supervisor.status;
});
ipcMain.handle('studio:app:relaunch', () => {
  app.relaunch();
  app.quit();
});

void app.whenReady().then(async () => {
  if (!primary) return; // second launch: the first window was focused, nothing else starts
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    title: 'Raptoru Studio',
    backgroundColor: '#111317',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The window hosts local players (Soundboard, TTS preview): they must keep their timers and
      // heartbeats when Studio is minimised or behind another window.
      backgroundThrottling: false,
      preload: join(here, 'preload.cjs'),
    },
  });
  win.on('closed', () => {
    win = null;
  });
  const updater = setupUpdater({
    getWindow: () => win,
    stopServer: () => supervisor.stop(),
    log: (...args) => console.log(...args),
  });
  if (externalUrl) {
    showing = 'studio';
    await win.loadURL(studioUrl);
  } else {
    await showStatusPage();
    try {
      await supervisor.start();
    } catch (error) {
      serverLog(`[supervisor] ${(error as Error).message}`);
    }
  }
  // Silent: only ever surfaces 'available' (renderer shows the button) — never downloads,
  // never installs without the user clicking "Mettre à jour" / "Redémarrer et installer".
  setTimeout(() => updater.checkSilently(), 3000);

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
  if (quitting || externalUrl || !primary) return;
  event.preventDefault();
  quitting = true;
  void supervisor.stop().finally(() => {
    logFile?.end();
    app.quit();
  });
});
