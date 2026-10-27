import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MuteHolds } from '../src/channel-points/mute-holds.js';
import { RandomBanRuntime } from '../src/random-ban/runtime.js';
import {
  MUTE_WATCHDOG_MS,
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

describe('Random Ban V3 in Studio — the streamer mute plays Votekick’s MUTED scene (fake Core)', () => {
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
      mic: { input: MIC, holds: l.holds, obs: () => l.obs, fx: l.vk },
      now: l.clock.now,
    });
    /** Core hands the mute; Studio starts it and reports; Core then lists it as running. */
    const start = async (id = R, seconds = 60) => {
      state.mute = { request_id: id, attempt_id: A, seconds };
      await rt.muteOnce();
      state.active = [...state.active, { request_id: id, ends_at: 'x' }];
    };
    /** Core no longer lists `id` (expired, or a paid caution). */
    const over = async (id = R) => {
      state.active = state.active.filter((a) => a.request_id !== id);
      await rt.muteOnce();
    };
    return { calls, state, rt, start, over };
  }
  const R = '00000000-0000-4000-8000-0000000000aa';
  const R2 = '00000000-0000-4000-8000-0000000000cc';
  const A = '00000000-0000-4000-8000-0000000000bb';

  /** The whole OBS state the scene touches. */
  const scene = (l: Awaited<ReturnType<typeof lab>>) => ({
    mic: l.obs.inputs.get(MIC)!.muted,
    zoom: l.obs.zoomFilter.enabled,
    // At rest the zoom is 1.000001 by design (REST_ZOOM, Votekick 24/10): read as « rest ».
    zoomAtRest: Math.abs(Number(l.obs.zoomFilter.settings.zoom) - 1) < 0.001,
    band: l.obs.bandFilter.enabled,
    bandDuration: l.obs.bandFilter.settings.mute_duration,
    drive: l.obs.driveFilter.enabled,
  });
  const ON = { mic: true, zoom: true, band: true, drive: true };

  it('the whole scene (mic, zoom, MUTED band, drive), then back to the initial state at its natural end', async () => {
    const l = await lab();
    const f = fakeCore(l);
    const initial = scene(l);
    await f.start();
    expect(scene(l)).toMatchObject(ON);
    expect(f.calls.at(-1)!.body).toMatchObject({ event: 'muted' });
    l.clock.advance(60_000);
    await f.over(); // expired: Core no longer lists it
    expect(scene(l)).toEqual(initial);
    expect(l.vk.owners()).toEqual([]);
  });

  it('a caution ends it early: the whole scene stops at once, back to the initial state; never re-applied later', async () => {
    const l = await lab();
    const f = fakeCore(l);
    const initial = scene(l);
    await f.start();
    l.clock.advance(15_000);
    await f.over(); // the caution
    expect(scene(l)).toEqual(initial);
    // A late watchdog, a restart, OBS reconnecting: nothing comes back.
    l.clock.advance(120_000);
    await l.vk.tick();
    await l.holds.tick();
    await f.rt.muteOnce();
    const again = await MuteController.open(
      join(l.dir, 'votekick-mute.json'),
      () => l.obs,
      RAPTORU_MUTE_FX,
      l.clock.now,
      async () => {},
      l.holds,
    );
    await again.tick();
    expect(again.current).toBeNull();
    expect(scene(l)).toEqual(initial);
  });

  it('overlap — Random Ban first, Votekick joins: a caution on the Random Ban keeps the scene for Votekick; its end restores all', async () => {
    const l = await lab();
    const f = fakeCore(l);
    const initial = scene(l);
    await f.start();
    await l.vk.muteStart('mute:v1', 120);
    await f.over(); // caution on the Random Ban only
    expect(scene(l)).toMatchObject(ON);
    expect(l.vk.owners()).toEqual(['mute:v1']);
    await l.vk.muteEnd('mute:v1', 'expired');
    expect(scene(l)).toEqual(initial);
  });

  it('overlap — Votekick first, Random Ban joins: a caution on Votekick keeps the scene for the Random Ban; its end restores all', async () => {
    const l = await lab();
    const f = fakeCore(l);
    const initial = scene(l);
    await l.vk.muteStart('mute:v2', 120);
    await f.start();
    expect(l.vk.owners()).toEqual(['mute:v2', `random_ban:${R}`]);
    await l.vk.muteEnd('mute:v2', 'caution'); // the Votekick caution
    expect(scene(l)).toMatchObject(ON);
    await f.over();
    expect(scene(l)).toEqual(initial);
  });

  it('two Random Ban mutes in a row never stack: the second one waits for its own start', async () => {
    const l = await lab();
    const f = fakeCore(l);
    const initial = scene(l);
    await f.start(R, 60);
    await f.start(R2, 60); // (Core never draws it while one runs; Studio still copes)
    await f.over(R);
    expect(scene(l)).toMatchObject(ON);
    await f.over(R2);
    expect(scene(l)).toEqual(initial);
  });

  it('a mic muted by the streamer before: the scene ends, the mic stays muted', async () => {
    const l = await lab();
    const f = fakeCore(l);
    l.obs.inputs.get(MIC)!.muted = true;
    await f.start();
    await f.over();
    expect(scene(l)).toMatchObject({
      mic: true,
      zoom: false,
      band: false,
      drive: false,
    });
  });

  it('OBS failing mid-start: everything back to the initial state, reported failed (Core goes back to the viewers)', async () => {
    const l = await lab();
    const f = fakeCore(l);
    const initial = scene(l);
    l.obs.failAt = 3; // OBS refuses a request half way through the scene
    await f.start();
    expect(f.calls.at(-1)!.body).toMatchObject({ event: 'failed' });
    expect(scene(l)).toEqual(initial);
    expect(l.holds.pending).toBe(0);
  });

  it('OBS absent at the start: reported failed, nothing changed; OBS gone at the end: restored when it is back', async () => {
    const l = await lab();
    const f = fakeCore(l);
    const initial = scene(l);
    l.obs.connected = false;
    f.state.mute = { request_id: R, attempt_id: A, seconds: 60 };
    await f.rt.muteOnce();
    expect(f.calls.at(-1)!.body).toMatchObject({ event: 'failed' });
    l.obs.connected = true;
    expect(scene(l)).toEqual(initial);
    await f.start();
    l.obs.connected = false;
    await f.over(); // the caution while OBS is gone
    l.obs.connected = true;
    await l.vk.tick(); // retried when OBS answers
    await l.holds.tick();
    expect(scene(l)).toEqual(initial);
  });

  it('Core refuses or loses the report: the scene is never kept', async () => {
    const l = await lab();
    const f = fakeCore(l);
    const initial = scene(l);
    f.state.mute = { request_id: R, attempt_id: A, seconds: 60 };
    f.state.report = () => {
      throw Object.assign(new Error('not_current_attempt'), { status: 409 });
    };
    await f.rt.muteOnce();
    expect(scene(l)).toEqual(initial);
    f.state.mute = { request_id: R, attempt_id: A, seconds: 60 };
    f.state.report = () => ({ status: 'queued' }); // swept back meanwhile
    await f.rt.muteOnce();
    expect(scene(l)).toEqual(initial);
  });

  it('Core never reached again: the scene ends by its watchdog', async () => {
    const l = await lab();
    const f = fakeCore(l);
    const initial = scene(l);
    await f.start();
    l.clock.advance(60_000 + MUTE_WATCHDOG_MS);
    await l.vk.tick();
    await l.holds.tick();
    expect(scene(l)).toEqual(initial);
  });
});

describe('Random Ban V3 in Studio — the « ready » signal never waits for an animation (27/10)', () => {
  it('an animation playing for a long time: the mute poll (Studio’s signal) goes on every poll', async () => {
    const l = await lab();
    let claims = 0;
    let animations = 0;
    const core = async <T>(path: string) => {
      if (path.endsWith('/mutes/claim')) {
        claims += 1;
        return { mute: null, active: [] } as T;
      }
      if (path.endsWith('/animations/claim'))
        return (
          animations++ === 0
            ? {
                animation: {
                  request_id: '00000000-0000-4000-8000-0000000000dd',
                  animation: 'ban_csc',
                  trigger: 'Buyer',
                  banned: 'Buyer',
                },
              }
            : { animation: null }
        ) as T;
      return {} as T;
    };
    const effects = {
      play: async () => ({ end: new Promise(() => {}) }), // never ends
    } as never;
    const rt = new RandomBanRuntime({
      core,
      environment: 'production',
      channelId: '83603689',
      effects,
      mic: { input: MIC, holds: l.holds, obs: () => l.obs, fx: l.vk },
      pollMs: 5,
    });
    rt.start();
    await new Promise((r) => setTimeout(r, 150));
    rt.stop();
    expect(animations).toBe(1); // the animation loop is stuck on its animation
    expect(claims).toBeGreaterThan(5); // the signal went on
  });
});
