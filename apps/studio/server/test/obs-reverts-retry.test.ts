import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ObsActions, type ObsLike } from '../src/channel-points/obs-actions.js';

// Audit 09/11 (P2): a temporary OBS change (filter, source) is reverted at its end — and still reverted when OBS is busy
// or drops the request at that moment (it used to be forgotten for good: the filter stayed on for the whole stream).

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

function fakeObs() {
  const filters = new Map<string, boolean>([['Cam|Flou', false]]);
  let failNext: string | null = null;
  const obs: ObsLike & { failNext(m: string): void; filters: typeof filters } =
    {
      connected: true,
      filters,
      failNext: (m) => (failNext = m),
      async request(type, data) {
        if (failNext) {
          const m = failNext;
          failNext = null;
          throw Object.assign(new Error(m), m === 'gone' ? { code: 600 } : {});
        }
        const d = data as {
          sourceName: string;
          filterName: string;
          filterEnabled?: boolean;
        };
        const k = `${d.sourceName}|${d.filterName}`;
        if (type === 'GetSourceFilter')
          return { filterEnabled: filters.get(k) === true };
        if (type === 'SetSourceFilterEnabled') {
          filters.set(k, d.filterEnabled === true);
          return {};
        }
        throw new Error(`unexpected ${type}`);
      },
    };
  return obs;
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'obs-reverts-'));
  dirs.push(dir);
  let t = 0;
  const obs = fakeObs();
  const actions = await ObsActions.open(
    join(dir, 'obs-reverts.json'),
    () => obs,
    () => t,
  );
  await actions.run({
    type: 'obs_filter',
    source: 'Cam',
    filter: 'Flou',
    enabled: true,
    duration_ms: 10_000,
  });
  expect(obs.filters.get('Cam|Flou')).toBe(true);
  t = 10_000;
  return { obs, actions };
}

describe('OBS temporary changes: the revert survives a transient OBS failure', () => {
  for (const m of ['obs_request_timeout', 'obs_offline'])
    it(`${m} at the revert: kept, done at the next tick`, async () => {
      const { obs, actions } = await setup();
      obs.failNext(m);
      await actions.tick();
      expect(actions.pending).toBe(1);
      expect(obs.filters.get('Cam|Flou')).toBe(true);
      await actions.tick();
      expect(actions.pending).toBe(0);
      expect(obs.filters.get('Cam|Flou')).toBe(false);
    });

  it('the filter is gone (OBS code 600): dropped, nothing retried', async () => {
    const { obs, actions } = await setup();
    obs.failNext('gone');
    await actions.tick();
    expect(actions.pending).toBe(0);
  });
});
