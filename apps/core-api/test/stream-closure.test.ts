import type { PresenceObservationRequest } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { MAX_LIVE_STATE_AGE_SECONDS } from '../src/presence/presence-service.js';
import {
  goLive,
  HOUR,
  MINUTE,
  paris,
  setup,
  viewer,
  type TestCore,
} from './helpers.js';

// Regression tests for the live of 2026-09-25: the bot was stopped ~1 min after the real end,
// before Twitch sent stream.offline, and the session stayed open ("still live").

const T0 = paris('2026-09-25', 20);
const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);
const aouh = viewer('3001', 'Aouh');
let seq = 0;

async function cycle(
  core: TestCore,
  minute: number,
  liveStateAgeSeconds: number | null,
) {
  core.clock.set(at(minute));
  await core.presence.acquireLease({ workerId: 'w', streamId: 's1' });
  const req: PresenceObservationRequest = {
    cycleId: `sc-${++seq}`,
    workerId: 'w',
    streamId: 's1',
    observedAt: at(minute).toISOString(),
    durationMs: 5,
    liveStateAgeSeconds,
    snapshot: { status: 'ok', chatters: [aouh], reportedTotal: 1, pages: 1 },
  };
  return core.presence.record(req);
}

const watchSeconds = async (core: TestCore) =>
  (
    await core.db.query<{ s: number }>(
      'select estimated_watch_seconds as s from presence_viewer_streams',
    )
  )[0]?.s ?? 0;

describe('presence never outlives an unconfirmed live', () => {
  it('no interval is credited once the last live confirmation is too old (missed offline + Helix outage)', async () => {
    const core = await setup({ loyalty: { preview: true } });
    await goLive(core, 's1', T0);
    await cycle(core, 0, 30);
    await cycle(core, 2, 30);
    expect(await watchSeconds(core)).toBe(120);

    // Stream ended at ~3 min, stream.offline lost and Helix failing: the bot keeps observing chat
    // but can no longer confirm the live, so the confirmation ages.
    const results = [];
    for (let m = 4, age = 150; m <= 20; m += 2, age += 120)
      results.push(await cycle(core, m, age));
    const credited = results.filter((r) => r.creditedSeconds > 0).length;
    expect(results.at(-1)).toMatchObject({
      creditedSeconds: 0,
      gapReason: 'live_unconfirmed',
    });
    // Bounded: only intervals whose both ends were confirmed within MAX_LIVE_STATE_AGE_SECONDS.
    // Ages 150, 270, 390, 510 s are still confirmed; from 630 s on, nothing is credited.
    expect(credited).toBe(
      Math.floor((MAX_LIVE_STATE_AGE_SECONDS - 150) / 120) + 1,
    );

    // Unknown confirmation (null) never credits either, and the next interval is not bridged.
    expect(await cycle(core, 22, null)).toMatchObject({
      creditedSeconds: 0,
      gapReason: 'live_unconfirmed',
    });
    expect(await cycle(core, 24, 20)).toMatchObject({
      creditedSeconds: 0,
      gapReason: 'live_unconfirmed',
    });
    expect(await cycle(core, 26, 20)).toMatchObject({ creditedSeconds: 120 });
  });
});

describe('late offline reconciliation', () => {
  it('bot stopped before stream.offline: the next Helix check closes the session at the last live confirmation', async () => {
    const core = await setup();
    await goLive(core, 's1', T0);
    for (let m = 0; m <= 330; m += 2) await cycle(core, m, 49); // 5h30 of live, confirmed ~49 s before each cycle
    // Studio stopped at ~5h31; Helix confirms offline the next day at bot start.
    core.clock.set(new Date(at(331).getTime() + 18 * HOUR));
    await core.streams.sync(null);

    const [session] = await core.db.query<{ ended_at: Date }>(
      'select ended_at from stream_sessions',
    );
    expect(session!.ended_at.toISOString()).toBe(
      new Date(at(330).getTime() - 49_000).toISOString(),
    );
    expect((await core.presence.report('latest'))!.endedAt).not.toBeNull();
  });

  it('a timely reconciliation (or the EventSub offline) keeps "now" as the end', async () => {
    const core = await setup();
    await goLive(core, 's1', T0);
    await cycle(core, 0, 10);
    await cycle(core, 2, 10);
    core.clock.set(at(4));
    await core.streams.sync(null);
    const [session] = await core.db.query<{ ended_at: Date }>(
      'select ended_at from stream_sessions',
    );
    expect(session!.ended_at.toISOString()).toBe(at(4).toISOString());
  });

  it('without presence data, a reconciliation closes at "now" as before', async () => {
    const core = await setup();
    await goLive(core, 's1', T0);
    core.clock.set(at(600));
    await core.streams.sync(null);
    const [session] = await core.db.query<{ ended_at: Date }>(
      'select ended_at from stream_sessions',
    );
    expect(session!.ended_at.toISOString()).toBe(at(600).toISOString());
  });
});
