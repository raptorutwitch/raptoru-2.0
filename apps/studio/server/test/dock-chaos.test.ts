import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadChaosSummary } from '../src/dock/chaos-summary.js';
import {
  DockHub,
  type DockActivity,
  type DockHubEvent,
} from '../src/dock/hub.js';

// Chaos purchases in the OBS dock (docs/OBS_DOCK.md): Studio words the choice with the extension's own catalogue (the
// file it ships), on every activity the docks get — the cache and the older pages alike. A missing catalogue, an
// unknown effect or a failing decorator leave the line as the Core sent it.

const CATALOG = fileURLToPath(
  new URL(
    '../../../twitch-extension/extension/modules/interactions/catalog.js',
    import.meta.url,
  ),
);
const chaos = (
  key: string,
  seq: number,
  data: Record<string, unknown>,
): DockActivity => ({
  activity_key: `ix:chaos:${key}`,
  kind: 'interaction',
  type: 'chaos',
  occurred_at: '2026-11-27T20:00:00.000Z',
  data: { actor: { id: '1', name: 'Ana' }, ...data },
  state: { status: 'chaos_queued', refund_status: 'none' },
  seq,
});
const blink = {
  effect: { id: 'blink', label: 'Paupières' },
  choice: { style: 'fatigue', level: 'extreme' },
  duration_s: 10,
  price: 2400,
  payment: 'jetons',
};

describe('Chaos in the dock — the choice worded like the extension', () => {
  it('the extension’s one-line summary of the setting (its duration shown apart by the dock); other activities untouched', async () => {
    const dress = await loadChaosSummary(CATALOG);
    expect(dress(chaos('a', 1, blink)).data.setting).toBe(
      'Somnolence · Complètement',
    );
    expect(
      dress(
        chaos('b', 2, {
          effect: { id: 'color', label: 'Couleur' },
          choice: { style: 'sepia' },
          duration_s: 20,
        }),
      ).data.setting,
    ).toBe('Sépia');
    const unknown = chaos('c', 3, { effect: { id: 'nope' }, duration_s: 5 });
    expect(dress(unknown)).toBe(unknown);
    const follow = {
      ...chaos('d', 4, blink),
      type: 'follow',
      kind: 'alert' as const,
    };
    expect(dress(follow)).toBe(follow);
    // No catalogue (a broken install): the identity, never an error.
    const none = await loadChaosSummary(`${CATALOG}.missing`);
    const row = chaos('e', 5, blink);
    expect(none(row)).toBe(row);
  });

  it('the hub dresses what docks get — the snapshot, the changes and the older pages; a failing decorator changes nothing', async () => {
    const rows = [chaos('a', 1, blink)];
    const core = async <T>(path: string): Promise<T> => {
      if (path.includes('before='))
        return {
          cursor: 1,
          activities: [chaos('old', 0, blink)],
          more: false,
        } as T;
      if (path.includes('/activity?'))
        return { cursor: 1, activities: rows, more: false } as T;
      await new Promise((r) => setTimeout(r, 5));
      return { cursor: 1, activities: [] } as T;
    };
    const hub = new DockHub({
      core,
      environment: 'production',
      channelId: '83603689',
      sleep: () => new Promise((r) => setTimeout(r, 1)),
      decorate: await loadChaosSummary(CATALOG),
    });
    const events: DockHubEvent[] = [];
    const stop = hub.subscribe((e) => events.push(e));
    for (let i = 0; i < 200 && !events.some((e) => e.type === 'snapshot'); i++)
      await new Promise((r) => setTimeout(r, 5));
    const snap = events.find((e) => e.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.activities[0]!.data.setting).toBe(
      'Somnolence · Complètement',
    );
    const page = await hub.history({ at: '2026-11-27T20:00:00.000Z', seq: 1 });
    expect(page.activities[0]!.data.setting).toBe('Somnolence · Complètement');
    stop();
    const broken = new DockHub({
      core,
      environment: 'lab',
      channelId: '83603689',
      decorate: () => {
        throw new Error('boom');
      },
    });
    const same = await broken.history({
      at: '2026-11-27T20:00:00.000Z',
      seq: 1,
    });
    expect(same.activities[0]!.data.setting).toBeUndefined();
  });
});
