import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ObsLike } from '../src/channel-points/obs-actions.js';
import { ChannelPointsRuntime } from '../src/channel-points/runtime.js';

// Audit 09/11 (P2): the actions of a channel-points job ran — a single lost « completed » POST (network blip to the VPS)
// must not leave the job « running » until its lease (holding every next redemption) nor lose its results.

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const obs: ObsLike = {
  connected: true,
  async request(type) {
    if (type === 'GetSourceFilter') return { filterEnabled: false };
    return {};
  },
};

async function runtime(failCompleted: (n: number) => Error | null) {
  const dir = await mkdtemp(join(tmpdir(), 'cp-ack-'));
  const calls: { path: string; body: { event?: string } }[] = [];
  let claimed = false;
  let completed = 0;
  const core = (async (path: string, body?: unknown) => {
    const b = (body ?? {}) as { event?: string };
    calls.push({ path, body: b });
    if (path.endsWith('/claim')) {
      if (claimed) return { job: null };
      claimed = true;
      return {
        job: {
          job_id: '11111111-1111-4111-8111-111111111111',
          attempt_id: '22222222-2222-4222-8222-222222222222',
          actions: [
            {
              index: 0,
              action: {
                type: 'obs_filter',
                source: 'Cam',
                filter: 'Flou',
                enabled: true,
              },
            },
          ],
        },
      };
    }
    if (b.event === 'completed') {
      const e = failCompleted(completed++);
      if (e) throw e;
    }
    return {};
  }) as never;
  const rt = await ChannelPointsRuntime.create({
    core,
    environment: 'lab',
    channelId: '83603689',
    origin: 'http://127.0.0.1:1',
    dir,
    obs: () => obs,
    twitch: () => ({ scope: false, adapter_running: true }),
  });
  cleanups.push(async () => {
    rt.stop();
    await rm(dir, { recursive: true, force: true });
  });
  return { rt, calls };
}

describe('channel points: the « completed » report of a job that ran', () => {
  it('a network failure (no status) is retried with the same results', async () => {
    const { rt, calls } = await runtime((n) =>
      n === 0 ? new Error('fetch failed') : null,
    );
    expect(await rt.once()).toBe(true);
    const done = calls.filter((c) => c.body.event === 'completed');
    expect(done).toHaveLength(2);
    expect(done[1]!.body).toEqual(done[0]!.body);
  });

  it('an answer of Core (a status: already settled, lease over) is not retried', async () => {
    const { rt, calls } = await runtime(() =>
      Object.assign(new Error('stale_attempt'), { status: 409 }),
    );
    await expect(rt.once()).rejects.toThrow('stale_attempt');
    expect(calls.filter((c) => c.body.event === 'completed')).toHaveLength(1);
  });
});
