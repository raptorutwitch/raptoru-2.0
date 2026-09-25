import type { PresenceObservationRequest } from '@raptoru/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GetChattersPage } from '../src/presence/chatters-snapshot.js';
import { PresenceWorker } from '../src/presence/presence-worker.js';
import { HelixError } from '../src/twitch/helix.js';

const MIN = 60_000;
const ok = {
  accepted: true,
  rejection: null,
  creditedSeconds: 0,
  creditedViewers: 0,
  gapReason: null,
};

function setupWorker(
  getPage: GetChattersPage = async () => ({
    chatters: [],
    cursor: null,
    total: 0,
  }),
) {
  const observations: PresenceObservationRequest[] = [];
  const core = {
    presenceLease: vi.fn(async ({ workerId }: { workerId: string }) => ({
      granted: true,
      holder: workerId,
      expiresAt: new Date().toISOString(),
    })),
    presenceObservation: vi.fn(async (o: PresenceObservationRequest) => {
      observations.push(o);
      return ok;
    }),
  };
  const pages = vi.fn(getPage);
  const worker = new PresenceWorker({
    core,
    getPage: pages,
    workerId: 'w1',
    liveStateAgeSeconds: () => 12,
    log: () => {},
    snapshotOptions: { sleep: async () => {} },
  });
  return { worker, core, pages, observations };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-26T18:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('presence worker lifecycle', () => {
  it('snapshots immediately, then every 2 minutes, with a single pending timer', async () => {
    const { worker, observations } = setupWorker();
    worker.start('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(observations).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(6 * MIN);
    expect(observations.map((o) => o.observedAt)).toEqual([
      '2026-09-26T18:00:00.000Z',
      '2026-09-26T18:02:00.000Z',
      '2026-09-26T18:04:00.000Z',
      '2026-09-26T18:06:00.000Z',
    ]);
    expect(observations[0]).toMatchObject({
      workerId: 'w1',
      streamId: 's1',
      liveStateAgeSeconds: 12,
    });
    expect(vi.getTimerCount()).toBe(1);
    worker.stop();
  });

  it('double start for the same stream and repeated start/stop never accumulate timers', async () => {
    const { worker, observations } = setupWorker();
    worker.start('s1');
    worker.start('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(observations).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    for (let i = 0; i < 20; i++) {
      worker.stop();
      worker.start('s1'); // e.g. EventSub reconnect replaying online
    }
    expect(vi.getTimerCount()).toBe(1);
    worker.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(worker.activeStreamId).toBeNull();
  });

  it('stream.offline (stop) aborts an in-flight snapshot and reports nothing', async () => {
    const { worker, core } = setupWorker(
      (_after, signal) =>
        new Promise((_r, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    worker.start('s1');
    await vi.advanceTimersByTimeAsync(1000);
    worker.stop();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(core.presenceObservation).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never overlaps cycles and skips missed deadlines instead of stacking them', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slow: GetChattersPage = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5 * MIN)); // longer than the interval
      inFlight--;
      return { chatters: [], cursor: null, total: 0 };
    };
    const { worker, observations } = setupWorker(slow);
    worker.start('s1');
    await vi.advanceTimersByTimeAsync(21 * MIN); // the 18:15 cycle reports when it ends (18:20)
    worker.stop();

    expect(maxInFlight).toBe(1);
    // Starts at 0, 5, 10, 15 min: one cycle per slow snapshot, no burst of catch-up cycles.
    expect(observations.map((o) => o.observedAt.slice(11, 16))).toEqual([
      '18:00',
      '18:05',
      '18:10',
      '18:15',
    ]);
  });

  it('401/403 stops the worker cleanly after reporting the failure', async () => {
    const { worker, observations } = setupWorker(async () => {
      throw new HelixError(401, 'invalid token');
    });
    worker.start('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(observations[0]!.snapshot).toMatchObject({
      status: 'error',
      errorKind: 'auth',
      httpStatus: 401,
    });
    expect(worker.activeStreamId).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('429 waits for the Twitch reset before calling again', async () => {
    const resetAt = Date.parse('2026-09-26T18:07:00Z');
    const getPage = vi
      .fn<GetChattersPage>()
      .mockRejectedValueOnce(new HelixError(429, 'limited', resetAt))
      .mockResolvedValue({ chatters: [], cursor: null, total: 0 });
    const { worker, observations } = setupWorker(getPage);
    worker.start('s1');
    await vi.advanceTimersByTimeAsync(6 * MIN);
    expect(observations).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1 * MIN);
    expect(observations).toHaveLength(2);
    worker.stop();
  });

  it('repeated failures back off exponentially, capped', async () => {
    const { worker, observations } = setupWorker(async () => {
      throw new HelixError(500, 'boom');
    });
    worker.start('s1');
    await vi.advanceTimersByTimeAsync(60 * MIN);
    worker.stop();
    const minutes = observations.map(
      (o) =>
        (Date.parse(o.observedAt) - Date.parse('2026-09-26T18:00:00Z')) / MIN,
    );
    // 0, +2, +4, +8, then capped at +10.
    expect(minutes.slice(0, 7)).toEqual([0, 2, 6, 14, 24, 34, 44]);
  });

  it('skips Twitch entirely when another worker holds the lease', async () => {
    const { worker, core, pages } = setupWorker();
    core.presenceLease.mockResolvedValue({
      granted: false,
      holder: 'other',
      expiresAt: new Date().toISOString(),
    });
    worker.start('s1');
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(pages).not.toHaveBeenCalled();
    expect(core.presenceObservation).not.toHaveBeenCalled();
    worker.stop();
  });

  it('a Core outage fails the cycle with backoff, without crashing the worker', async () => {
    const { worker, core } = setupWorker();
    core.presenceObservation.mockRejectedValue(new Error('ECONNREFUSED'));
    worker.start('s1');
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(worker.activeStreamId).toBe('s1');
    expect(vi.getTimerCount()).toBe(1);
    worker.stop();
  });
});
