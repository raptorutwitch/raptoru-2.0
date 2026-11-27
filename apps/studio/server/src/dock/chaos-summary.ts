import { pathToFileURL } from 'node:url';
import type { DockActivity } from './hub.js';

// Chaos purchases in the dock (docs/OBS_DOCK.md): the setting in one line — « Somnolence · Complètement » — worded by
// the extension's own catalogue (modules/interactions/catalog.js, describeChoice: the line its tracking, history and
// moderation show, without its last part, the duration, which the dock shows itself next to the price). Studio ships
// that file; the Core keeps no viewer labels (chaos/catalog.ts). Without the catalogue, or for an unknown effect, the
// line stays as the Core sent it (the dock then shows the duration and the price alone).

interface Catalog {
  effectById(id: string): unknown;
  normalizeChoice(
    e: unknown,
    c: Record<string, unknown>,
    capS: number,
  ): Record<string, unknown>;
  describeChoice(e: unknown, c: Record<string, unknown>): string;
}

export type DockDecorator = (a: DockActivity) => DockActivity;

export function chaosSummary(cat: Catalog): DockDecorator {
  return (a) => {
    if (a.type !== 'chaos') return a;
    const d = a.data as {
      effect?: { id?: unknown };
      choice?: Record<string, unknown>;
      duration_s?: unknown;
    };
    const e = cat.effectById(String(d.effect?.id ?? ''));
    if (!e) return a;
    const duration = typeof d.duration_s === 'number' ? d.duration_s : null;
    // The choice as bought, completed like the extension completes it; the duration is the one the Core sold.
    const choice = {
      ...cat.normalizeChoice(e, d.choice ?? {}, 60),
      ...(duration ? { duration } : {}),
    };
    return {
      ...a,
      data: {
        ...a.data,
        // describeChoice always ends with the duration (« … · 10 s »): the dock shows it on its own.
        setting: cat
          .describeChoice(e, choice)
          .split(' · ')
          .slice(0, -1)
          .join(' · '),
      },
    };
  };
}

/** The decorator from the shipped catalogue file, or the identity when it cannot be loaded. */
export async function loadChaosSummary(
  catalogFile: string,
): Promise<DockDecorator> {
  try {
    return chaosSummary(
      (await import(pathToFileURL(catalogFile).href)) as Catalog,
    );
  } catch {
    return (a) => a;
  }
}
