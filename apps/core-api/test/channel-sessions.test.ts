// ASTRA-P1-007 lot 1 — one stream session per Twitch live, for the live-dependent modules (Tombola,
// Commands): identity = Twitch stream id, reconnection, lost offline, restart, already live at boot,
// simulations never closed by Twitch, stream_sessions / stream-day (Daily, Loyalty) untouched.
import { describe, expect, it } from 'vitest';
import { RaffleLabService } from '../src/raffle-lab/raffle-lab-service.js';
import { DEFAULT_RAFFLE_CONFIG } from '../src/raffle-lab/rules.js';
import {
  latestChannelSession,
  liveChannelSession,
} from '../src/stream/channel-sessions.js';
import { count, setup, type TestCore } from './helpers.js';

const CH = '900100';
const T0 = new Date('2026-10-05T18:00:00Z');
const STUDIO = {
  id: 'antoni',
  role: 'broadcaster' as const,
  via: 'studio' as const,
};

async function lab() {
  const core = await setup();
  core.clock.set(T0);
  const raffle = new RaffleLabService(core.db, core.clock);
  await raffle.act(CH, {
    actor: STUDIO,
    command: {
      action: 'config',
      config: {
        ...DEFAULT_RAFFLE_CONFIG,
        scheduler: { ...DEFAULT_RAFFLE_CONFIG.scheduler, enabled: true },
      },
    },
  } as never);
  const online = (id?: string) =>
    raffle.streamEvent({
      channel_id: CH,
      event: 'online',
      ...(id ? { twitch_stream_id: id } : {}),
    });
  const offline = () =>
    raffle.streamEvent({ channel_id: CH, event: 'offline' });
  const sessions = () =>
    core.db.query<{
      session_id: string;
      source: string;
      twitch_stream_id: string | null;
      ended_at: Date | null;
    }>(
      'select session_id, source, twitch_stream_id, ended_at from lab_stream_sessions order by started_at',
    );
  const scheduler = async () => (await raffle.settings(CH)).scheduler;
  return { core, raffle, online, offline, sessions, scheduler };
}

const live = (core: TestCore) => liveChannelSession(core.db, CH);

describe('channel stream session = the Twitch live (ASTRA-P1-007)', () => {
  it('online → one session carrying the Twitch id; repeated / id-less online → the same; offline → closed; offline again → nothing', async () => {
    const f = await lab();
    const a = await f.online('1001');
    expect(a.changed).toBe(true);
    expect(await f.online('1001')).toMatchObject({
      changed: false,
      session_id: a.session_id,
    });
    expect(await f.online()).toMatchObject({
      changed: false,
      session_id: a.session_id,
    });
    expect(await f.sessions()).toEqual([
      expect.objectContaining({
        source: 'twitch',
        twitch_stream_id: '1001',
        ended_at: null,
      }),
    ]);
    expect(await f.scheduler()).toMatchObject({
      state: 'running',
      session_id: a.session_id,
    });
    f.core.clock.advance(60_000);
    expect(await f.offline()).toMatchObject({
      changed: true,
      session_id: a.session_id,
    });
    expect(await live(f.core)).toBeNull();
    expect((await f.scheduler()).state).not.toBe('running');
    expect(await f.offline()).toMatchObject({ changed: false });
  });

  it('reconnection (same Twitch id after an offline): the same session reopened, scheduler back on', async () => {
    const f = await lab();
    const a = await f.online('1001');
    await f.offline();
    f.core.clock.advance(60_000);
    expect(await f.online('1001')).toMatchObject({
      changed: true,
      session_id: a.session_id,
    });
    expect(await f.sessions()).toHaveLength(1);
    expect((await live(f.core))?.session_id).toBe(a.session_id);
    expect(await f.scheduler()).toMatchObject({
      state: 'running',
      session_id: a.session_id,
    });
  });

  it('offline lost, then a new live: the stale session closes, a new one opens; the stale live delivered late is ignored', async () => {
    const f = await lab();
    const a = await f.online('1001');
    f.core.clock.advance(3_600_000);
    const b = await f.online('1002');
    expect(b.changed).toBe(true);
    expect(b.session_id).not.toBe(a.session_id);
    const rows = await f.sessions();
    expect(rows.map((r) => [r.twitch_stream_id, r.ended_at === null])).toEqual([
      ['1001', false],
      ['1002', true],
    ]);
    expect(await f.scheduler()).toMatchObject({ session_id: b.session_id });
    // A late « online » of the previous live: never reopened over the newer one.
    expect(await f.online('1001')).toMatchObject({ changed: false });
    expect((await live(f.core))?.session_id).toBe(b.session_id);
  });

  it('restart while live (new service on the same database) and startup sync: the same session, nothing doubled', async () => {
    const f = await lab();
    const a = await f.online('1001');
    const restarted = new RaffleLabService(f.core.db, f.core.clock);
    expect((await liveChannelSession(f.core.db, CH))?.session_id).toBe(
      a.session_id,
    );
    // The adapter's startup sync (Helix: still live, same id).
    expect(
      await restarted.streamEvent({
        channel_id: CH,
        event: 'online',
        twitch_stream_id: '1001',
      }),
    ).toMatchObject({ changed: false, session_id: a.session_id });
    expect(await f.sessions()).toHaveLength(1);
    // Startup sync while the live ended during the outage: closed.
    expect(
      await restarted.streamEvent({ channel_id: CH, event: 'offline' }),
    ).toMatchObject({
      changed: true,
    });
  });

  it('system starting while Twitch is already live (no row yet): one session opened from the startup sync, scheduler on', async () => {
    const f = await lab();
    const a = await f.online('3003');
    expect(a.changed).toBe(true);
    expect(await f.scheduler()).toMatchObject({
      state: 'running',
      session_id: a.session_id,
    });
  });

  it('a session recorded before the Twitch ids (null id) takes the id instead of being replaced', async () => {
    const f = await lab();
    const a = await f.online(); // older adapter: no id
    expect(await f.online('1001')).toMatchObject({
      changed: false,
      session_id: a.session_id,
    });
    expect((await live(f.core))?.twitch_stream_id).toBe('1001');
  });

  it('simulations: never closed by a Twitch offline; replaced by a real live (scheduler moved to it)', async () => {
    const f = await lab();
    const sim = (await f.raffle.act(CH, {
      actor: STUDIO,
      command: { action: 'stream_start' },
    } as never)) as { session_id: string };
    expect(await f.offline()).toMatchObject({ changed: false }); // e.g. startup sync while off-air
    expect((await live(f.core))?.session_id).toBe(sim.session_id);
    expect(await f.online()).toMatchObject({
      changed: false,
      session_id: sim.session_id,
    }); // no id: as before
    const real = await f.online('1001');
    expect(real.changed).toBe(true);
    const rows = await f.sessions();
    expect(rows.map((r) => [r.source, r.ended_at === null])).toEqual([
      ['simulated', false],
      ['twitch', true],
    ]);
    expect(await f.scheduler()).toMatchObject({ session_id: real.session_id });
  });

  it('a late offline of the previous live closes the current one; the reconnection / repair reopens it', async () => {
    const f = await lab();
    const b = await f.online('1002');
    await f.offline(); // stream.offline carries no id: accepted limit
    expect(await live(f.core)).toBeNull();
    expect(await f.online('1002')).toMatchObject({
      changed: true,
      session_id: b.session_id,
    });
  });

  it('concurrent events for the same live: one session (PGlite serializes; the lock is proven on real Postgres)', async () => {
    const f = await lab();
    const [x, y] = await Promise.all([f.online('1001'), f.online('1001')]);
    expect(x.session_id).toBe(y.session_id);
    expect(await f.sessions()).toHaveLength(1);
  });

  it('off-stream manual activity opens no session; the reader falls back to the last session', async () => {
    const f = await lab();
    expect(await latestChannelSession(f.core.db, CH)).toBeNull();
    const a = await f.online('1001');
    await f.offline();
    expect((await latestChannelSession(f.core.db, CH))?.session_id).toBe(
      a.session_id,
    );
    expect(await live(f.core)).toBeNull();
  });

  it('stream_sessions / stream-day (Daily, Presence, Loyalty) are never written by the channel sessions', async () => {
    const f = await lab();
    const before = [
      await count(f.core.db, 'stream_sessions'),
      await count(f.core.db, 'stream_days'),
    ];
    await f.online('1001');
    await f.offline();
    await f.online('1002');
    expect([
      await count(f.core.db, 'stream_sessions'),
      await count(f.core.db, 'stream_days'),
    ]).toEqual(before);
  });
});
