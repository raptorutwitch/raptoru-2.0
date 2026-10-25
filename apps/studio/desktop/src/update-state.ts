// Pure state machine for the auto-update UI: no Electron import, so it is testable in plain
// vitest. `updater.ts` is the only place that maps real electron-updater events onto this.

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  /** Set on 'available' and kept through 'downloading'/'downloaded'. */
  latestVersion: string | null;
  /** Set while 'downloading' (0-100). */
  percent: number | null;
  /** Error text or the reason updates are unsupported (dev build, missing config…). */
  message: string | null;
}

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }
  | { type: 'unsupported'; message: string };

export function initialUpdateState(currentVersion: string): UpdateState {
  return {
    status: 'idle',
    currentVersion,
    latestVersion: null,
    percent: null,
    message: null,
  };
}

export function nextUpdateState(
  state: UpdateState,
  event: UpdateEvent,
): UpdateState {
  switch (event.type) {
    case 'checking':
      return { ...state, status: 'checking', message: null };
    case 'available':
      return {
        ...state,
        status: 'available',
        latestVersion: event.version,
        percent: null,
        message: null,
      };
    case 'not-available':
      return {
        ...state,
        status: 'not-available',
        latestVersion: null,
        percent: null,
        message: null,
      };
    case 'progress':
      return { ...state, status: 'downloading', percent: event.percent };
    case 'downloaded':
      return {
        ...state,
        status: 'downloaded',
        latestVersion: event.version,
        percent: 100,
        message: null,
      };
    case 'error':
      return { ...state, status: 'error', message: event.message };
    case 'unsupported':
      return { ...state, status: 'unsupported', message: event.message };
  }
}

/**
 * Why this build must not check GitHub, or null. A development run is not packaged; a local test build carries a
 * prerelease version (0.1.7-sup.2): electron-updater would look for its « sup » channel, which no official release
 * publishes (error shown in Studio, 23/10). Official versions (x.y.z) check as before.
 */
export function updateBlockReason(
  version: string,
  packaged: boolean,
): string | null {
  if (!packaged)
    return 'Mise à jour indisponible en développement (app non packagée).';
  if (version.includes('-'))
    return `Version de test ${version} : mises à jour automatiques désactivées. Réinstalle une version officielle pour les retrouver.`;
  return null;
}
