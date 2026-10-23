import { describe, expect, it, vi } from 'vitest';
import type { BotLeaseRequest } from '@raptoru/schemas';
import {
  botFlags,
  createInstanceLease,
  type LeaseCall,
} from '../src/instance-lease.js';

// Single active production bot (plan post-live lot 1/2): standby until the Core grants the lease, renewal with the
// health, stop on loss, release on a clean stop.

const report = (): Omit<BotLeaseRequest, 'instanceId'> => ({
  host: 'vps',
  version: 'dev',
  startedAt: '2026-10-21T10:00:00.000Z',
  health: {
    eventSubBot: false,
    eventSubBroadcaster: null,
    broadcasterToken: null,
  },
  flags: {},
});

const holder = (instanceId: string) => ({
  instanceId,
  host: instanceId.split('-')[0]!,
  since: '2026-10-21T09:00:00.000Z',
  expiresAt: '2026-10-21T09:00:45.000Z',
});
const answer = (granted: boolean, holderId = 'vps-1') => ({
  status: 200,
  body: {
    granted,
    holder: holder(holderId),
    ttlSeconds: 45,
    renewSeconds: 15,
  },
});

/** A Core answering from `script` in order (the last answer repeats). */
function core(script: (Awaited<ReturnType<LeaseCall>> | Error)[]) {
  const calls: { path: string; body: unknown }[] = [];
  let i = 0;
  const call: LeaseCall = async (path, body) => {
    calls.push({ path, body });
    if (path.endsWith('/release')) return { status: 200, body: {} };
    const next = script[Math.min(i++, script.length - 1)]!;
    if (next instanceof Error) throw next;
    return next;
  };
  return { call, calls };
}

describe('instance lease (bot side)', () => {
  it('waits in standby while another instance holds it, logs once per change, then acquires', async () => {
    const { call, calls } = core([
      answer(false, 'pc-1'),
      answer(false, 'pc-1'),
      new Error('fetch failed'),
      answer(true),
    ]);
    const log = vi.fn();
    const sleep = vi.fn(async () => {});
    const lease = createInstanceLease({
      instanceId: 'vps-1',
      call,
      report,
      log,
      sleep,
    });
    expect(await lease.acquire()).toEqual({ supported: true });
    expect(
      calls.filter((c) => c.path === '/v1/bot/instance/lease'),
    ).toHaveLength(4);
    expect(sleep).toHaveBeenCalledWith(15_000);
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes('autre instance'))).toHaveLength(1);
    expect(lines.some((l) => l.includes('fetch failed'))).toBe(true);
    expect(lines.at(-1)).toContain('bail obtenu');
  });

  it('a Core without the lease API (404): the bot WAITS (never starts unprotected), says why', async () => {
    const log = vi.fn();
    let calls = 0;
    const sleep = vi.fn(async () => {
      if (++calls === 3) throw new Error('stop the loop'); // three refusals prove it waits
    });
    const lease = createInstanceLease({
      instanceId: 'vps-1',
      call: async () => ({ status: 404, body: null }),
      report,
      log,
      sleep,
    });
    await expect(lease.acquire()).rejects.toThrow('stop the loop');
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(1); // once, not every 15 s
    expect(lines[0]).toContain('Core sans API de bail (404)');
    expect(lines[0]).toContain('aucune connexion Twitch');
  });

  it('404 with `optional` (development only): starts unprotected, says so', async () => {
    const log = vi.fn();
    const lease = createInstanceLease({
      instanceId: 'vps-1',
      call: async () => ({ status: 404, body: null }),
      report,
      log,
      optional: true,
    });
    expect(await lease.acquire()).toEqual({ supported: false });
    expect(String(log.mock.calls[0]![0])).toContain('sans garantie');
    lease.keep(vi.fn()); // nothing to protect: no fence armed
    lease.stop();
  });

  it('a malformed answer is an error (standby), never a grant', async () => {
    const { call } = core([
      { status: 200, body: { granted: true } },
      answer(true),
    ]);
    const log = vi.fn();
    const lease = createInstanceLease({
      instanceId: 'vps-1',
      call,
      report,
      log,
      sleep: async () => {},
    });
    await lease.acquire();
    expect(String(log.mock.calls[0]![0])).toContain('en attente');
  });

  it('another holder named at a renewal → stop « lost », once', async () => {
    vi.useFakeTimers();
    try {
      const { call } = core([
        answer(true),
        answer(true),
        answer(false, 'pc-9'),
      ]);
      const onStop = vi.fn();
      const lease = createInstanceLease({
        instanceId: 'vps-1',
        call,
        report,
        log: vi.fn(),
      });
      await lease.acquire();
      lease.keep(onStop);
      await vi.advanceTimersByTimeAsync(15_000); // granted
      expect(onStop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(15_000); // lost
      await vi.advanceTimersByTimeAsync(60_000); // nothing more
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(onStop).toHaveBeenCalledWith({
        kind: 'lost',
        holder: holder('pc-9'),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('network lost: no grant for ttl − 10 s after the last granted SENDING → stop « expired », before the Core can give the lease away', async () => {
    vi.useFakeTimers();
    try {
      const { call } = core([answer(true), new Error('fetch failed')]);
      const onStop = vi.fn();
      const log = vi.fn();
      const lease = createInstanceLease({
        instanceId: 'vps-1',
        call,
        report,
        log,
      });
      await lease.acquire(); // granted at t = 0: the Core lease runs until ≥ 45 s
      lease.keep(onStop);
      await vi.advanceTimersByTimeAsync(34_900);
      expect(onStop).not.toHaveBeenCalled();
      expect(
        log.mock.calls.some((c) => String(c[0]).includes('arrêt de sécurité')),
      ).toBe(true);
      await vi.advanceTimersByTimeAsync(200); // 35.1 s, well before 45 s
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(onStop.mock.calls[0]![0]).toMatchObject({ kind: 'expired' });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(onStop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('each granted renewal re-arms the fence; Core errors shorter than the fence change nothing', async () => {
    vi.useFakeTimers();
    try {
      const { call } = core([
        answer(true), // acquire, t = 0
        answer(true), // 15 s
        new Error('timeout'), // 30 s
        answer(true), // 45 s → fence at 80 s
        new Error('timeout'), // 60 s, 75 s, …
      ]);
      const onStop = vi.fn();
      const lease = createInstanceLease({
        instanceId: 'vps-1',
        call,
        report,
        log: vi.fn(),
      });
      await lease.acquire();
      lease.keep(onStop);
      await vi.advanceTimersByTimeAsync(79_000);
      expect(onStop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(onStop).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'expired' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('a slow answer: the fence counts from the request SENDING, not from the answer', async () => {
    vi.useFakeTimers();
    try {
      let t = 0; // monotonic clock under test control
      let first = true;
      const onStop = vi.fn();
      const lease = createInstanceLease({
        instanceId: 'vps-1',
        now: () => t,
        call: async () => {
          if (!first) throw new Error('down');
          first = false;
          t += 8_000; // the grant arrives 8 s after it was sent
          return answer(true);
        },
        report,
        log: vi.fn(),
      });
      await lease.acquire(); // sent at 0, answered at t = 8 s
      lease.keep(onStop);
      // Fence = 35 s after the SENDING = 27 s after the answer.
      await vi.advanceTimersByTimeAsync(26_900);
      expect(onStop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(onStop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a Core rolled back (no lease route) while running: 404 renewals → stop « expired »', async () => {
    vi.useFakeTimers();
    try {
      const { call } = core([answer(true), { status: 404, body: null }]);
      const onStop = vi.fn();
      const lease = createInstanceLease({
        instanceId: 'vps-1',
        call,
        report,
        log: vi.fn(),
      });
      await lease.acquire();
      lease.keep(onStop);
      await vi.advanceTimersByTimeAsync(36_000);
      expect(onStop).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'expired' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends its current health with each renewal', async () => {
    vi.useFakeTimers();
    try {
      const { call, calls } = core([answer(true)]);
      let n = 0;
      const lease = createInstanceLease({
        instanceId: 'vps-1',
        call,
        report: () => ({
          ...report(),
          health: {
            eventSubBot: ++n > 1,
            eventSubBroadcaster: null,
            broadcasterToken: null,
          },
        }),
        log: vi.fn(),
      });
      await lease.acquire();
      lease.keep(vi.fn());
      await vi.advanceTimersByTimeAsync(15_000);
      const bodies = calls.map((c) => c.body as BotLeaseRequest);
      expect(bodies[0]!.health.eventSubBot).toBe(false);
      expect(bodies[1]!.health.eventSubBot).toBe(true);
      lease.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('release: one call with the instance id, never throws, gives up after 3 s', async () => {
    const { call, calls } = core([answer(true)]);
    const lease = createInstanceLease({
      instanceId: 'vps-1',
      call,
      report,
      log: vi.fn(),
    });
    await lease.acquire();
    await lease.release();
    expect(calls.at(-1)).toEqual({
      path: '/v1/bot/instance/release',
      body: { instanceId: 'vps-1' },
    });

    const failing = createInstanceLease({
      instanceId: 'vps-1',
      call: async () => {
        throw new Error('down');
      },
      report,
      log: vi.fn(),
    });
    await expect(failing.release()).resolves.toBeUndefined();

    vi.useFakeTimers();
    try {
      const hanging = createInstanceLease({
        instanceId: 'vps-1',
        call: () => new Promise(() => {}),
        report,
        log: vi.fn(),
      });
      const done = hanging.release();
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(done).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('flags: on / off per feature and the alerts mode, nothing else', () => {
    expect(
      botFlags({
        DAILY_CHAT_COMMANDS: 'true',
        LOYALTY_CHAT_COMMANDS: 'true',
        LOYALTY_TWITCH_EVENTS: 'true',
        CHANNEL_POINTS_EVENTS: 'true',
        PRESENCE_SHADOW: 'true',
        CHAT_GAMES: 'false',
        CHAT_GAMES_OUTPUT: 'false',
        ALERTS_FOLLOW: 'true',
        RANDOM_BAN: 'true',
        CAUTION: 'false',
        VOTEKICK: 'true',
        ALERTS_MODE: 'active',
      }),
    ).toEqual({
      DAILY_CHAT_COMMANDS: true,
      LOYALTY_CHAT_COMMANDS: true,
      LOYALTY_TWITCH_EVENTS: true,
      CHANNEL_POINTS_EVENTS: true,
      PRESENCE_SHADOW: true,
      CHAT_GAMES: false,
      CHAT_GAMES_OUTPUT: false,
      ALERTS_FOLLOW: true,
      RANDOM_BAN: true,
      CAUTION: false,
      VOTEKICK: true,
      ALERTS_MODE: 'active',
    });
  });
});
