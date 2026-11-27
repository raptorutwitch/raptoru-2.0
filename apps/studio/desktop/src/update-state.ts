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
  /** « Nouveautés » of the latest version, plain text (notesText), kept like latestVersion. */
  notes: string | null;
}

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; notes?: string | null }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string; notes?: string | null }
  | { type: 'error'; message: string }
  | { type: 'unsupported'; message: string };

export function initialUpdateState(currentVersion: string): UpdateState {
  return {
    status: 'idle',
    currentVersion,
    latestVersion: null,
    percent: null,
    message: null,
    notes: null,
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
        notes: event.notes ?? null,
      };
    case 'not-available':
      return {
        ...state,
        status: 'not-available',
        latestVersion: null,
        percent: null,
        message: null,
        notes: null,
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
        notes: event.notes ?? state.notes,
      };
    case 'error':
      return { ...state, status: 'error', message: event.message };
    case 'unsupported':
      return { ...state, status: 'unsupported', message: event.message };
  }
}

/**
 * The release's notes (electron-updater: the GitHub release body as HTML, a string, or an array of { note }) as a short
 * plain text for the widget: one line per change, without the conventional-commit prefix, without merges, tests and
 * chores. Never HTML: the renderer only sets textContent.
 */
export function notesText(raw: unknown, maxLines = 12): string | null {
  const text = Array.isArray(raw)
    ? raw.map((x) => String((x as { note?: unknown })?.note ?? '')).join('\n')
    : typeof raw === 'string'
      ? raw
      : '';
  const plain = text
    .replace(/<\/(li|p|h\d|div)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  const lines = plain
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•]\s*/, ''))
    .filter((l) => /^(feat|fix|perf)(\([^)]*\))?!?:/i.test(l))
    .map((l) => l.replace(/^\w+(\([^)]*\))?!?:\s*/, ''))
    .map((l) => l.charAt(0).toUpperCase() + l.slice(1));
  if (!lines.length) return null;
  const shown = lines.slice(0, maxLines).map((l) => `• ${l}`);
  if (lines.length > maxLines)
    shown.push(`… et ${lines.length - maxLines} autre(s)`);
  return shown.join('\n');
}

/** The periodic background check never disturbs a version being offered, downloaded or ready to install. */
export function shouldAutoCheck(state: UpdateState): boolean {
  return ['idle', 'not-available', 'error'].includes(state.status);
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
