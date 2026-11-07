import type { loadFeedSources } from '../activity-feed.js';
import type { HostModuleStatus } from '../module-states.js';
import type { Check, ReadinessInput } from '../readiness.js';
import type { CpSummary, LiveState } from '../shell/regie.js';
import type { SupervisionSnapshot } from '../supervision-banner.js';

// Le relevé unique du shell, tel que le voient les pages de pilotage. Une lecture jamais faite reste `undefined` (« lecture… »),
// une lecture ratée `null` (« non lu ») : aucune page n'en déduit un état.

export interface Pulse {
  supOk: boolean;
  sup: SupervisionSnapshot | null;
  live?: LiveState;
  cp?: CpSummary | null;
  ready?: Check[];
  input?: ReadinessInput;
  hostModules: HostModuleStatus[] | null;
  feed?: Awaited<ReturnType<typeof loadFeedSources>>;
  /** Compteurs vivants de la barre latérale, par page. */
  counts: Map<string, string>;
  favs: string[];
  recent: string[];
  /** `lab`, `production` ou `unknown`. */
  profile: string;
  /** Le Lab tourne sur le vrai Core : pas de Test Lab. */
  labMain: boolean;
}

/** Ce que le shell fournit à une page de pilotage. */
export interface HubCtx {
  /** Relève tout de suite (après une action). */
  refresh(): void;
  /** Ouvre une page sans recharger (depuis un tiroir, hors du shell). */
  open(id: string): void;
}

export interface HubView {
  setVisible(v: boolean): void;
  update(p: Pulse): void;
}
