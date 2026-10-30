import {
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  screen,
  session,
  type Display,
} from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickScreenSource } from './capture-window.js';

const here = dirname(fileURLToPath(import.meta.url));

// Halloween (docs/HALLOWEEN.md) — the windows over the streamer's screen. Electron main opens, on the screen chosen in
// Studio, transparent, frameless, always-on-top windows: click-through (setIgnoreMouseEvents), never focusable (no focus
// stolen from a game, no key taken), out of the taskbar, loading the overlay page served by the Studio server (which
// decides what plays). They follow the settings (enabled, screen) every 2 s and close with Studio. A global shortcut
// (Ctrl + Shift + F12) asks Studio for STOP ALL. No Windows setting is ever changed.
// - The OVERLAY window (screamers, apparitions, drawn effects): seen by OBS's screen capture like any window.
// - The CHAOS window (écran retourné, flou, docs/HALLOWEEN.md § 4 bis): it captures the WHOLE monitor it covers and
//   redraws it flipped or blurred. Windows excludes it from every capture (content protection = display affinity
//   « exclude from capture »), so it never captures itself — whatever application is in front, even when the streamer
//   changes window. OBS does not see it either: Studio applies the same effect to OBS's screen capture with filters.
//   Its page may capture only that monitor; any other page or request is refused.

export const STOP_ALL_SHORTCUT = 'CommandOrControl+Shift+F12';

export interface OverlayConfig {
  enabled: boolean;
  display_id: number | null;
  url: string;
  /** The same page in its « chaos » role. */
  chaos_url?: string;
}

/** The windows' own session: only the Chaos page may capture, and only the monitor it covers. */
export const OVERLAY_PARTITION = 'halloween-overlay';

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

type Kind = 'overlay' | 'chaos';

export function startHalloweenOverlay(deps: {
  studioUrl: string;
  mainToken: string;
  log: (...args: unknown[]) => void;
}) {
  const wins: Record<Kind, BrowserWindow | null> = {
    overlay: null,
    chaos: null,
  };
  const loaded: Record<Kind, string | null> = { overlay: null, chaos: null };
  /** The monitor the windows cover now (the Chaos capture's source). */
  let covered: Display | null = null;
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

  const overlaySession = session.fromPartition(OVERLAY_PARTITION);
  overlaySession.setDisplayMediaRequestHandler((request, callback) => {
    // Only the Chaos window's page, and only the monitor it covers: anything else is refused (no stream).
    const chaos = wins.chaos;
    const from = request.frame?.url ?? '';
    if (
      !chaos ||
      chaos.isDestroyed() ||
      !covered ||
      !from.startsWith(`${deps.studioUrl}/halloween/`) ||
      !from.includes('role=chaos')
    )
      return callback({});
    const display = covered;
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(
        (sources) => {
          const pick = pickScreenSource(sources, display.id);
          if (!pick) {
            deps.log('[halloween] Chaos : écran introuvable pour la capture');
            return callback({});
          }
          callback({ video: pick });
        },
        () => callback({}),
      );
  });

  const close = (kind: Kind) => {
    const w = wins[kind];
    if (w && !w.isDestroyed()) w.destroy();
    wins[kind] = null;
    loaded[kind] = null;
  };
  const closeAll = () => {
    close('chaos');
    close('overlay');
    covered = null;
  };

  const open = (kind: Kind, display: Display, url: string) => {
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
      title: kind === 'chaos' ? 'Raptoru Chaos' : 'Raptoru Halloween',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: OVERLAY_PARTITION,
        // The Chaos page learns where the cursor is (it hides the copy Chromium draws into the capture).
        ...(kind === 'chaos'
          ? { preload: join(here, 'chaos-preload.cjs') }
          : {}),
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    // The Chaos window is invisible to every screen capture: it never captures itself (no loop).
    if (kind === 'chaos') w.setContentProtection(true);
    // Never a click, never the keyboard: everything goes through to the game / desktop underneath.
    w.setIgnoreMouseEvents(true);
    w.setAlwaysOnTop(true, 'screen-saver');
    // The page only ever shows Studio's overlay: no navigation, no popup.
    w.webContents.on('will-navigate', (event) => event.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.once('ready-to-show', () => w.showInactive());
    w.on('closed', () => {
      if (wins[kind] === w) {
        wins[kind] = null;
        loaded[kind] = null;
      }
    });
    void w
      .loadURL(url)
      .catch((e: Error) =>
        deps.log(`[halloween] ${kind} load failed`, e.message),
      );
    wins[kind] = w;
    loaded[kind] = url;
    deps.log(
      `[halloween] ${kind === 'chaos' ? 'Chaos' : 'overlay'} ouvert sur ${display.label || display.id}`,
    );
  };

  const place = (kind: Kind, display: Display, url: string) => {
    const w = wins[kind];
    if (!w || w.isDestroyed() || loaded[kind] !== url) {
      close(kind);
      open(kind, display, url);
      return;
    }
    if (!sameBounds(w.getBounds(), display.bounds)) w.setBounds(display.bounds);
    // Some games raise themselves: stay above them.
    w.setAlwaysOnTop(true, 'screen-saver');
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
    if (!cfg.enabled) return closeAll();
    const display = pickDisplay(
      screen.getAllDisplays(),
      screen.getPrimaryDisplay(),
      cfg.display_id,
    );
    covered = display;
    place('overlay', display, cfg.url);
    if (cfg.chaos_url) place('chaos', display, cfg.chaos_url);
    else close('chaos');
  };

  screen.on('display-added', pushDisplays);
  screen.on('display-removed', pushDisplays);
  screen.on('display-metrics-changed', pushDisplays);
  pushDisplays();
  const timer = setInterval(() => {
    pushDisplays();
    void sync();
  }, 2000);
  // The cursor's position on the covered monitor, for the Chaos page (60 times a second, only when it moved).
  let lastCursor = '';
  const cursorTimer = setInterval(() => {
    const w = wins.chaos;
    if (!w || w.isDestroyed() || !covered) return;
    const p = screen.getCursorScreenPoint();
    const b = covered.bounds;
    const at = {
      x: (p.x - b.x) / b.width,
      y: (p.y - b.y) / b.height,
      scale: covered.scaleFactor,
    };
    const key = `${at.x}|${at.y}|${at.scale}`;
    if (key === lastCursor) return;
    lastCursor = key;
    w.webContents.send('chaos-cursor', at);
  }, 16);
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
      clearInterval(cursorTimer);
      if (shortcut) globalShortcut.unregister(STOP_ALL_SHORTCUT);
      overlaySession.setDisplayMediaRequestHandler(null);
      closeAll();
    },
  };
}
