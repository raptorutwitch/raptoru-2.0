import type { Check, Level } from './readiness.js';

// The state of each module page, for the catalogue: what « Prêt pour le live » and the Core's module catalog already read.
// Nothing is read twice, nothing is invented: a module without a check shows no state at all.

export interface PageState {
  level: Level;
  /** One or two words. */
  text: string;
}

export interface HostModuleStatus {
  id: string;
  status: { intention: 'on' | 'off'; observed: string; summary: string };
}

/** Check of the readiness list → the page of that module. */
const CHECK_PAGE: Record<string, string> = {
  soundboard: 'soundboard',
  tts: 'tts',
  bonk: 'bonk',
  alerts: 'alerts',
  cp: 'channel-points',
  wheel: 'sub-wheel',
  games: 'mini-games',
  'word-game': 'word-game',
  spotify: 'spotify',
  effects: 'effects',
};

const HOST_STATE: Record<string, PageState> = {
  ready: { level: 'ok', text: 'Prêt' },
  waiting: { level: 'warn', text: 'En attente' },
  error: { level: 'error', text: 'Problème' },
  unknown: { level: 'unknown', text: 'Inconnu' },
};

/** Pure. A module of the host is matched by its page id; the readiness check wins when both exist. */
export function pageStates(
  checks: Check[] | undefined,
  modules: HostModuleStatus[] | null | undefined,
): Map<string, PageState> {
  const out = new Map<string, PageState>();
  for (const m of modules ?? [])
    out.set(
      m.id.replace(/_/g, '-'),
      m.status.intention === 'off'
        ? { level: 'off', text: 'Coupé' }
        : (HOST_STATE[m.status.observed] ?? HOST_STATE.unknown!),
    );
  for (const c of checks ?? []) {
    const page = CHECK_PAGE[c.id];
    if (page) out.set(page, { level: c.level, text: c.state });
  }
  return out;
}

export type CatalogFilter = 'all' | 'attention' | 'on' | 'off';

/** Pure: does a module with this state belong to the filter? A module without a state is only in « Tous ». */
export function inFilter(state: PageState | undefined, f: CatalogFilter) {
  if (f === 'all') return true;
  if (!state) return false;
  if (f === 'off') return state.level === 'off';
  if (f === 'on') return state.level === 'ok';
  return (
    state.level === 'error' ||
    state.level === 'warn' ||
    state.level === 'unknown'
  );
}
