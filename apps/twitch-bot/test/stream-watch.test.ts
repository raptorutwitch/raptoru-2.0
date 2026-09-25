import { describe, expect, it, vi } from 'vitest';
import type { CoreClient } from '../src/core-client.js';
import { createStreamWatcher, EVENTSUB_TRUST_MS } from '../src/stream-watch.js';

function fakeCore() {
  return {
    streamOnline: vi.fn(async () => ({})),
    streamOffline: vi.fn(async () => ({})),
    streamSync: vi.fn(async () => ({})),
    dailyClaim: vi.fn(),
    dailyStreak: vi.fn(),
    presenceLease: vi.fn(),
    presenceObservation: vi.fn(),
    walletBalance: vi.fn(),
    walletTransfer: vi.fn(),
    walletAdmin: vi.fn(),
  } satisfies Record<keyof CoreClient, unknown>;
}

const live = { id: '317', started_at: '2026-09-24T18:00:00Z' };

describe('stream watcher', () => {
  it('at startup, reports the Helix snapshot (live or confirmed offline)', async () => {
    const core = fakeCore();
    await createStreamWatcher({
      core: core as never,
      getStream: async () => live,
    }).sync();
    expect(core.streamSync).toHaveBeenCalledWith({
      live: { streamId: '317', startedAt: '2026-09-24T18:00:00Z' },
    });

    await createStreamWatcher({
      core: core as never,
      getStream: async () => null,
    }).sync();
    expect(core.streamSync).toHaveBeenLastCalledWith({ live: null });
  });

  it('never turns a Helix error into offline', async () => {
    const core = fakeCore();
    const watcher = createStreamWatcher({
      core: core as never,
      getStream: async () => {
        throw new Error('503');
      },
      log: () => {},
    });
    await watcher.sync();
    expect(core.streamSync).not.toHaveBeenCalled();
  });

  it('trusts a fresh EventSub event over a lagging Helix snapshot', async () => {
    const core = fakeCore();
    let now = 0;
    const watcher = createStreamWatcher({
      core: core as never,
      getStream: async () => null,
      now: () => now,
    });
    await watcher.online(live);
    expect(core.streamOnline).toHaveBeenCalledWith({
      streamId: '317',
      startedAt: '2026-09-24T18:00:00Z',
    });

    now = EVENTSUB_TRUST_MS - 1;
    await watcher.sync(); // Helix still says offline right after going live: ignored
    expect(core.streamSync).not.toHaveBeenCalled();

    now = EVENTSUB_TRUST_MS;
    await watcher.sync(); // afterwards Helix repairs any missed event
    expect(core.streamSync).toHaveBeenCalledWith({ live: null });
  });
});
