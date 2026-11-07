import type { LabCoreCall } from '../lab-moderation/proxy.js';
import type { ModuleStatus, StatusLevel, StatusProvider } from './model.js';

// Centre de contrôle — every module of the module host in ONE provider (architecture socle): a new module appears here
// by itself, with its own status. Level: OFF on purpose = « off » (never an outage); ON and ready = ok; ON and waiting
// = warn with its reasons; error = error; a status the module cannot give = unknown. Never green on the switch alone.

interface CatalogEntry {
  id: string;
  label: string;
  lab_only: boolean;
  status: {
    intention: 'on' | 'off';
    observed: 'ready' | 'waiting' | 'error' | 'unknown';
    summary: string;
    reasons: string[];
  };
}

export function levelOf(s: CatalogEntry['status']): StatusLevel {
  if (s.intention === 'off') return 'off';
  return s.observed === 'ready'
    ? 'ok'
    : s.observed === 'waiting'
      ? 'warn'
      : s.observed === 'error'
        ? 'error'
        : 'unknown';
}

const RANK: Record<StatusLevel, number> = {
  error: 4,
  warn: 3,
  unknown: 2,
  ok: 1,
  off: 0,
};

export function modulesStatusProvider(
  core: LabCoreCall | null,
  channelId: string,
  now: () => Date = () => new Date(),
): StatusProvider {
  const id = 'modules';
  const label = 'Modules du socle';
  return {
    id,
    label,
    async read(): Promise<ModuleStatus> {
      const base = { id, label, checkedAt: now().toISOString() };
      if (!core)
        return {
          ...base,
          level: 'unknown',
          state: 'Inconnu',
          summary: 'Aucun Core joignable sur ce profil.',
          facts: [],
          hint: null,
        };
      let modules: CatalogEntry[];
      try {
        modules = (
          await core<{ modules: CatalogEntry[] }>(
            `/v1/lab/modules/${channelId}`,
          )
        ).modules;
      } catch {
        return {
          ...base,
          level: 'unknown',
          state: 'Inconnu',
          summary:
            'Le Core de ce profil ne fournit pas encore le catalogue des modules.',
          facts: [],
          hint: null,
        };
      }
      const worst = modules.reduce<StatusLevel>(
        (w, m) => (RANK[levelOf(m.status)] > RANK[w] ? levelOf(m.status) : w),
        'off',
      );
      const down = modules.filter((m) =>
        ['error', 'warn'].includes(levelOf(m.status)),
      );
      return {
        ...base,
        level: modules.length ? worst : 'off',
        state:
          worst === 'error'
            ? 'Erreur'
            : worst === 'warn'
              ? 'En attente'
              : worst === 'ok'
                ? 'Prêt'
                : worst === 'unknown'
                  ? 'Inconnu'
                  : 'Coupés',
        summary: !modules.length
          ? 'Aucun module du socle sur ce Core.'
          : down.length
            ? `À regarder : ${down.map((m) => m.label).join(', ')}.`
            : `${modules.length} module(s) : rien à corriger.`,
        facts: modules.map((m) => ({
          label: `${m.label}${m.lab_only ? ' (Lab)' : ''}`,
          value:
            m.status.intention === 'off' ? 'Coupé (réglage)' : m.status.summary,
          level: levelOf(m.status),
        })),
        hint:
          down
            .flatMap((m) => m.status.reasons.map((r) => `${m.label} : ${r}`))
            .join(' ') || null,
        data: {
          modules: modules.map((m) => ({ id: m.id, level: levelOf(m.status) })),
        },
      };
    },
  };
}
