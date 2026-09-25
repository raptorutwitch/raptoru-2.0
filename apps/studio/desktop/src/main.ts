import { spawn, type ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

// Electron shell: starts the local Studio server (hidden), shows its web UI, and on exit asks the
// server to stop what it started (bot, Core) before quitting. Postgres is left running.

const STUDIO_PORT = 4100;
const studioUrl = process.env.STUDIO_URL ?? `http://127.0.0.1:${STUDIO_PORT}`;
const serverEntry = fileURLToPath(
  new URL('../../server/dist/index.js', import.meta.url),
);

let server: ChildProcess | null = null;
let quitting = false;

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
  // System Node (v24+) runs the server; windowsHide: no console window.
  server = spawn('node', [serverEntry], { stdio: 'ignore', windowsHide: true });
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
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    title: 'Raptoru Studio',
    backgroundColor: '#111317',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await ensureServer();
    await win.loadURL(studioUrl);
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
          await writeFile(shot, (await win.webContents.capturePage()).toPNG());
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
