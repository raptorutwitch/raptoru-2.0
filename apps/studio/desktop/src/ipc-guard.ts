// Electron trust boundary (ASTRA-P2-027). The privileged actions (restart the server, relaunch,
// check / download / install an update) answer only the Studio window while it shows the Studio page
// (its origin) or the local status page. The window never navigates elsewhere: another page would get
// the preload bridge. Windows opened from Studio stay on its origin (pop-out pages, overlays);
// anything else goes to the system browser. Pure decisions, wired in main.ts.

export interface TrustPolicy {
  /** Origin of the Studio page (http://127.0.0.1:4100, or STUDIO_URL in development). */
  studioOrigin: string;
  /** file:// URL of the local status page shown while the server starts or is down. */
  statusPageUrl: string;
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The Studio page or the status page (query / hash ignored). */
export function isTrustedPage(url: string, p: TrustPolicy): boolean {
  const u = parse(url);
  if (!u) return false;
  if (u.protocol === 'file:') {
    const status = parse(p.statusPageUrl);
    return !!status && u.pathname === status.pathname;
  }
  return u.origin === p.studioOrigin;
}

/** window.open / target=_blank from Studio: same origin in an app window, web links outside. */
export function windowOpenDecision(
  url: string,
  p: TrustPolicy,
): 'allow' | 'external' | 'deny' {
  const u = parse(url);
  if (!u) return 'deny';
  if (u.origin === p.studioOrigin) return 'allow';
  return u.protocol === 'https:' || u.protocol === 'http:'
    ? 'external'
    : 'deny';
}
