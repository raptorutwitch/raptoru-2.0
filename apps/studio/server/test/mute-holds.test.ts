import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MuteHolds } from '../src/channel-points/mute-holds.js';
import { RandomBanRuntime } from '../src/random-ban/runtime.js';
import {
  MuteController,
  RAPTORU_MUTE_FX,
} from '../src/votekick/mute-controller.js';
import { SimObs } from '../src/votekick/sim-obs.js';

// Random Ban V3 — who keeps « Micro » muted (src/channel-points/mute-holds.ts): Votekick's mute, BRB and the Random Ban
// streamer mute hold it under their own names; the voice comes back only when the last one ends, never when it was
// muted before, never over a manual change. On a simulated OBS (no real OBS, no Twitch).

const MIC = RAPTORU_MUTE_FX.micInput;
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function lab() {
  const dir = await mkdtemp(join(tmpdir(), 'mute-holds-'));
  dirs.push(dir);
  const obs = new SimObs(RAPTORU_MUTE_FX);
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => void (t += ms) };
  const file = join(dir, 'obs-reverts-mute-holds.json');
  const holds = await MuteHolds.open(file, () => obs, clock.now);
  const vk = await MuteController.open(
    join(dir, 'votekick-mute.json'),
    () => obs,
    RAPTORU_MUTE_FX,
    clock.now,
    async (ms) => clock.advance(ms),
    holds,
  );
  const muted = () => obs.inputs.get(MIC)!.muted;
  return { dir, obs, clock, file, holds, vk, muted };
}

describe('MuteHolds — one mic, several effects', () => {
  it('BRB ending DURING a Votekick mute: the voice stays cut until the Votekick mute ends (the 26/10 flaw)', async () => {
    const l = await lab();
    await l.holds.hold(MIC, 'cp:Micro', l.clock.now() + 10_000); // BRB first
    await l.vk.muteStart('mute:v1', 60); // the Votekick mute starts while BRB holds the mic
    l.clock.advance(10_000);
    await l.holds.tick(); // BRB's time is over
    expect(l.muted()).toBe(true);
    await l.vk.muteEnd('mute:v1', 'expired');
    expect(l.muted()).toBe(false); // live before the first hold: back
  });

  it('the Votekick mute ending first: the Random Ban mute keeps the mic cut, then gives it back', async () => {
    const l = await lab();
    await l.vk.muteStart('mute:v2', 30);
    await l.holds.hold(MIC, 'random_ban:r1', l.clock.now() + 60_000);
    await l.vk.muteEnd('mute:v2', 'caution'); // a caution on the Votekick mute only
    expect(l.muted()).toBe(true);
    expect(l.holds.holders(MIC)).toEqual(['random_ban:r1']);
    await l.holds.release(MIC, 'random_ban:r1');
    expect(l.muted()).toBe(false);
  });

  it('a mic muted by the streamer before: never unmuted by any end', async () => {
    const l = await lab();
    l.obs.inputs.get(MIC)!.muted = true;
    await l.holds.hold(MIC, 'random_ban:r2', l.clock.now() + 60_000);
    await l.vk.muteStart('mute:v3', 30);
    await l.vk.muteEnd('mute:v3', 'expired');
    await l.holds.release(MIC, 'random_ban:r2');
    expect(l.muted()).toBe(true);
  });

  it('a manual unmute meanwhile is kept: the end does not mute again', async () => {
    const l = await lab();
    await l.holds.hold(MIC, 'random_ban:r3', l.clock.now() + 60_000);
    l.obs.inputs.get(MIC)!.muted = false; // the streamer took his voice back
    await l.holds.release(MIC, 'random_ban:r3');
    expect(l.muted()).toBe(false);
    expect(l.holds.pending).toBe(0);
  });

  it('a hold past its time is released by tick; the same owner again only moves its end', async () => {
    const l = await lab();
    await l.holds.hold(MIC, 'cp:Micro', l.clock.now() + 5_000);
    await l.holds.hold(MIC, 'cp:Micro', l.clock.now() + 8_000);
    l.clock.advance(6_000);
    await l.holds.tick();
    expect(l.muted()).toBe(true);
    l.clock.advance(2_000);
    await l.holds.tick();
    expect(l.muted()).toBe(false);
  });

  it('OBS absent at the end: the unmute is owed and done when OBS is back; a restart keeps the holds', async () => {
    const l = await lab();
    await l.holds.hold(MIC, 'random_ban:r4', l.clock.now() + 60_000);
    l.obs.connected = false;
    await l.holds.release(MIC, 'random_ban:r4');
    expect(l.holds.pending).toBe(1);
    // Studio restarts: the owed unmute is read back from disk.
    const again = await MuteHolds.open(l.file, () => l.obs, l.clock.now);
    l.obs.connected = true;
    await again.tick();
    expect(l.muted()).toBe(false);
    expect(again.pending).toBe(0);
    // A hold saved before a restart is released at its time.
    await again.hold(MIC, 'random_ban:r5', l.clock.now() + 1_000);
    const third = await MuteHolds.open(l.file, () => l.obs, l.clock.now);
    expect(third.holders(MIC)).toEqual(['random_ban:r5']);
    l.clock.advance(1_000);
    await third.tick();
    expect(l.muted()).toBe(false);
  });

  it('OBS absent at the start: the hold fails and nothing is recorded', async () => {
    const l = await lab();
    l.obs.connected = false;
    await expect(
      l.holds.hold(MIC, 'random_ban:r6', l.clock.now() + 1_000),
    ).rejects.toThrow('obs_offline');
    expect(l.holds.pending).toBe(0);
  });
});

describe('Random Ban V3 in Studio — the streamer mute (fake Core)', () => {
  function fakeCore(l: Awaited<ReturnType<typeof lab>>) {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const state = {
      mute: null as null | {
        request_id: string;
        attempt_id: string;
        seconds: number;
      },
      active: [] as { request_id: string; ends_at: string }[],
      report: (() => ({ status: 'confirmed' })) as (
        body: Record<string, unknown>,
      ) => { status: string },
    };
    const core = async <T>(path: string, body?: unknown) => {
      calls.push({ path, body: (body ?? {}) as Record<string, unknown> });
      if (path.endsWith('/mutes/claim')) {
        const out = { mute: state.mute, active: state.active };
        state.mute = null;
        return out as T;
      }
      if (path.endsWith('/mute'))
        return state.report(body as Record<string, unknown>) as T;
      if (path.endsWith('/animations/claim')) return { animation: null } as T;
      throw new Error(`unexpected ${path}`);
    };
    const rt = new RandomBanRuntime({
      core,
      environment: 'production',
      channelId: '83603689',
      effects: null,
      mic: { input: MIC, holds: l.holds, obs: () => l.obs },
      now: l.clock.now,
    });
    return { calls, state, rt };
  }
  const R = '00000000-0000-4000-8000-0000000000aa';
  const A = '00000000-0000-4000-8000-0000000000bb';

  it('muted, reported, kept while Core lists it, released when a caution ended it — Votekick still holds', async () => {
    const l = await lab();
    const f = fakeCore(l);
    await f.rt.muteOnce();
    expect(f.calls[0]!.body).toMatchObject({
      obs_ready: true,
      mic_held: false,
    });
    f.state.mute = { request_id: R, attempt_id: A, seconds: 60 };
    await f.rt.muteOnce();
    expect(l.muted()).toBe(true);
    expect(f.calls.at(-1)!.body).toMatchObject({
      event: 'muted',
      attempt_id: A,
    });
    await l.vk.muteStart('mute:v9', 120); // a Votekick mute on top
    f.state.active = [{ request_id: R, ends_at: 'x' }];
    await f.rt.muteOnce();
    expect(l.holds.holders(MIC)).toContain(`random_ban:${R}`);
    expect(f.calls.at(-1)!.body).toMatchObject({ mic_held: true });
    f.state.active = []; // the caution ended the Random Ban mute only
    await f.rt.muteOnce();
    expect(l.holds.holders(MIC)).toEqual(['votekick:mute:v9']);
    expect(l.muted()).toBe(true);
    await l.vk.muteEnd('mute:v9', 'expired');
    expect(l.muted()).toBe(false);
  });

  it('OBS absent: reported failed (Core goes back to the viewers), nothing held', async () => {
    const l = await lab();
    const f = fakeCore(l);
    l.obs.connected = false;
    f.state.mute = { request_id: R, attempt_id: A, seconds: 60 };
    await f.rt.muteOnce();
    expect(f.calls.at(-1)!.body).toMatchObject({ event: 'failed' });
    expect(l.holds.pending).toBe(0);
  });

  it('Core refuses or loses the report: the mute is never kept', async () => {
    const l = await lab();
    const f = fakeCore(l);
    f.state.mute = { request_id: R, attempt_id: A, seconds: 60 };
    f.state.report = () => {
      throw Object.assign(new Error('not_current_attempt'), { status: 409 });
    };
    await f.rt.muteOnce();
    expect(l.muted()).toBe(false);
    expect(l.holds.pending).toBe(0);
    f.state.mute = { request_id: R, attempt_id: A, seconds: 60 };
    f.state.report = () => ({ status: 'queued' }); // swept back to the viewers meanwhile
    await f.rt.muteOnce();
    expect(l.muted()).toBe(false);
  });

  it('the hold ends by itself at its time even if Core is never reached again', async () => {
    const l = await lab();
    const f = fakeCore(l);
    f.state.mute = { request_id: R, attempt_id: A, seconds: 60 };
    await f.rt.muteOnce();
    expect(l.muted()).toBe(true);
    l.clock.advance(60_000);
    await l.holds.tick();
    expect(l.muted()).toBe(false);
  });
});
