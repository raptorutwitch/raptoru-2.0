import { BrowserWindow, globalShortcut, screen, type Display } from 'electron';

// Halloween (docs/HALLOWEEN.md) — the overlay window over the streamer's screen. Electron main opens ONE transparent,
// frameless, always-on-top window on the screen chosen in Studio: it is click-through (setIgnoreMouseEvents), never
// focusable (no focus stolen from a game, no key taken), out of the taskbar, and it loads the overlay page served by
// the Studio server (which decides what plays). It follows the settings (enabled, screen) every 2 s and closes with
// Studio. A global shortcut (Ctrl + Shift + F12) asks Studio for STOP ALL. No Windows setting is ever changed.

export const STOP_ALL_SHORTCUT = 'CommandOrControl+Shift+F12';

export interface OverlayConfig {
  enabled: boolean;
  display_id: number | null;
  url: string;
}

/** The screen to cover: the chosen one when still connected, else the primary screen. */
export function pickDisplay<D extends { id: number }>(
  displays: D[],
  primary: D,
  id: number | null,
): D {
  return (id !== null && displays.find((d) => d.id === id)) || primary;
}

export const sameBounds = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export function startHalloweenOverlay(deps: {
  studioUrl: string;
  mainToken: string;
  log: (...args: unknown[]) => void;
}) {
  let overlay: BrowserWindow | null = null;
  let loadedUrl: string | null = null;
  let disposed = false;

  const call = async (path: string, body?: unknown) => {
    const res = await fetch(`${deps.studioUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'x-raptoru-studio': '1',
        'x-raptoru-main': deps.mainToken,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<unknown>;
  };

  const describe = (d: Display) => ({
    id: d.id,
    label: d.label || `Écran ${d.size.width}×${d.size.height}`,
    bounds: d.bounds,
    scale: d.scaleFactor,
    primary: d.id === screen.getPrimaryDisplay().id,
  });
  const pushDisplays = () =>
    void call('/api/halloween/displays', {
      displays: screen.getAllDisplays().map(describe),
    }).catch(() => {});

  const close = () => {
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
    overlay = null;
    loadedUrl = null;
  };

  const open = (display: Display, url: string) => {
    const w = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Raptoru Halloween',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    // Never a click, never the keyboard: everything goes through to the game / desktop underneath.
    w.setIgnoreMouseEvents(true);
    w.setAlwaysOnTop(true, 'screen-saver');
    // The page only ever shows Studio's overlay: no navigation, no popup.
    w.webContents.on('will-navigate', (event) => event.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.once('ready-to-show', () => w.showInactive());
    w.on('closed', () => {
      if (overlay === w) {
        overlay = null;
        loadedUrl = null;
      }
    });
    void w
      .loadURL(url)
      .catch((e: Error) =>
        deps.log('[halloween] overlay load failed', e.message),
      );
    overlay = w;
    loadedUrl = url;
    deps.log(`[halloween] overlay ouvert sur ${display.label || display.id}`);
  };

  const sync = async () => {
    if (disposed) return;
    let cfg: OverlayConfig;
    try {
      cfg = (await call('/api/halloween/overlay-config')) as OverlayConfig;
    } catch {
      return; // Studio server restarting: keep what is there (it plays nothing without the server anyway)
    }
    if (disposed) return;
    if (!cfg.enabled) return close();
    const display = pickDisplay(
      screen.getAllDisplays(),
      screen.getPrimaryDisplay(),
      cfg.display_id,
    );
    if (!overlay || overlay.isDestroyed() || loadedUrl !== cfg.url) {
      close();
      open(display, cfg.url);
      return;
    }
    if (!sameBounds(overlay.getBounds(), display.bounds))
      overlay.setBounds(display.bounds);
    // Some games raise themselves: stay above them.
    overlay.setAlwaysOnTop(true, 'screen-saver');
  };

  screen.on('display-added', pushDisplays);
  screen.on('display-removed', pushDisplays);
  screen.on('display-metrics-changed', pushDisplays);
  pushDisplays();
  const timer = setInterval(() => {
    pushDisplays();
    void sync();
  }, 2000);
  void sync();
  const shortcut = globalShortcut.register(STOP_ALL_SHORTCUT, () => {
    void call('/api/halloween/stop', {}).catch(() => {});
  });
  if (!shortcut)
    deps.log(
      '[halloween] raccourci STOP ALL indisponible (déjà pris par une autre application)',
    );

  return {
    shortcut,
    dispose() {
      disposed = true;
      clearInterval(timer);
      if (shortcut) globalShortcut.unregister(STOP_ALL_SHORTCUT);
      close();
    },
  };
}
