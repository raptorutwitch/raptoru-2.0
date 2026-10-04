import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_MS, IDLE_MAX_MS, WorkerLoop } from '../src/worker-loop.js';

// ASTRA-P2-017: idle workers back off; work or an admission brings the 150 ms cadence back at once.
afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const at: number[] = [];
  let busy = false;
  let inFlight = 0;
  let maxInFlight = 0;
  let release: (() => void) | null = null;
  let slow = false;
  const loop = new WorkerLoop(
    async () => {
      at.push(Date.now());
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (slow) await new Promise<void>((r) => (release = r));
      inFlight -= 1;
    },
    () => busy,
  );
  const gaps = () => at.slice(1).map((t, i) => t - at[i]!);
  return {
    loop,
    at,
    gaps,
    setBusy: (b: boolean) => (busy = b),
    setSlow: (s: boolean) => (slow = s),
    release: () => release?.(),
    maxInFlight: () => maxInFlight,
  };
}

describe('Lab worker loop cadence', () => {
  it('idle: 300, 600, then 1 s between empty ticks; busy: back to 150 ms', async () => {
    const t = setup();
    t.loop.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.gaps().slice(0, 4)).toEqual([300, 600, IDLE_MAX_MS, IDLE_MAX_MS]);
    expect(t.at.length).toBeLessThan(8); // ~6.5 ticks/s before (150 ms), ≤ 1/s now
    t.setBusy(true);
    const n = t.at.length;
    await vi.advanceTimersByTimeAsync(1_500);
    expect(
      t
        .gaps()
        .slice(n)
        .every((g) => g === ACTIVE_MS),
    ).toBe(true);
    t.loop.stop();
  });

  it('an admission wakes the idle loop at once (no added latency)', async () => {
    const t = setup();
    t.loop.start();
    await vi.advanceTimersByTimeAsync(3_000); // backed off to 1 s
    const before = t.at.length;
    const wokeAt = Date.now();
    t.setBusy(true); // the admitted item: claimed by the woken tick, now a local entry
    t.loop.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.at.length).toBe(before + 1);
    expect(t.at.at(-1)).toBe(wokeAt);
    await vi.advanceTimersByTimeAsync(ACTIVE_MS);
    expect(t.at.length).toBe(before + 2); // active cadence while the item is handled
    t.loop.stop();
  });

  it('a wake during a tick runs one more tick right after it, never two at once; stop ends everything', async () => {
    const t = setup();
    t.setSlow(true);
    t.loop.start();
    await vi.advanceTimersByTimeAsync(0);
    t.loop.wake(); // tick in progress
    t.loop.wake();
    t.setSlow(false);
    t.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.at).toHaveLength(2);
    expect(t.maxInFlight()).toBe(1);
    t.loop.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.at).toHaveLength(2);
  });
});
