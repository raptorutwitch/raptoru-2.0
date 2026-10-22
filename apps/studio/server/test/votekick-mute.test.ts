import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MUTE_WATCHDOG_MS,
  MuteController,
  SAMMI_MUTE_FX,
} from '../src/votekick/mute-controller.js';
import {
  SimObs,
  sammiLegacyEnd,
  sammiLegacyStart,
} from '../src/votekick/sim-obs.js';

// Votekick V2 — the broadcaster's mute on a simulated OBS (docs/VOTEKICK_V2.md § Mute): the SAMMI end lets the
// effect react once the voice is back; the controller's end never does, restores only its 4 items to their snapshot,
// ignores late / repeated orders, survives OBS leaving and Studio restarting, ends a mute Core forgot.

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function lab(obs = new SimObs()) {
  const dir = await mkdtemp(join(tmpdir(), 'vk-mute-'));
  dirs.push(dir);
  let now = 1_000_000;
  const clock = { now: () => now, advance: (ms: number) => void (now += ms) };
  const file = join(dir, 'votekick-mute.json');
  const open = () =>
    MuteController.open(
      file,
      () => obs,
      SAMMI_MUTE_FX,
      clock.now,
      async (ms) => clock.advance(ms),
    );
  return { obs, clock, file, open, mute: await open() };
}

describe('MUTED: the historical end (SAMMI) vs the V2 end', () => {
  it('SAMMI: the voice comes back while the camera still reacts and the band still shows', async () => {
    const obs = new SimObs();
    await sammiLegacyStart(obs, 50);
    obs.voice(0.8);
    await sammiLegacyEnd(obs);
    const seen = obs.reactionsAfterUnmute().map((f) => f.step);
    expect(seen).toContain('Votekick Zoom Drive off');
    expect(seen).toContain('écriture tardive du drive');
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });

  it('V2: drive cut, zoom reset (late write reset again), band exit, mic LAST — no reaction after the unmute', async () => {
    const l = await lab();
    await l.mute.muteStart('mute:s1', 50);
    expect(l.obs.inputs.get('Micro (Obsolète)')!.muted).toBe(true);
    expect(l.obs.bandFilter.settings.mute_duration).toBe(50);
    l.obs.voice(0.8);
    l.clock.advance(20_000);
    const report = await l.mute.muteEnd('mute:s1', 'caution');
    expect(report).toEqual({ id: 'mute:s1', ok: true, mismatches: [] });
    expect(l.obs.reactionsAfterUnmute()).toEqual([]);
    const steps = l.obs.frames.map((f) => f.step);
    const unmute = steps.lastIndexOf('micro rétabli');
    expect(unmute).toBe(steps.length - 1); // the voice is the very last change
    // The band played its exit from now (20 s in + 0.14 s), not cut.
    expect(steps).toContain('Votekick Mute réglé');
    expect(l.obs.zoomFilter.settings.zoom).toBe(1);
    expect(l.obs.filters.get('overlay cam shushu|prison')!.enabled).toBe(false);
  });
});

describe('MUTED V2: determinism', () => {
  it('a late or repeated end of an old mute does nothing; a second start only moves the end', async () => {
    const l = await lab();
    await l.mute.muteStart('mute:a', 30);
    await l.mute.muteStart('mute:a', 30); // repeated
    expect(await l.mute.muteEnd('mute:old', 'expired')).toBeNull();
    expect(l.mute.current?.id).toBe('mute:a');
    await l.mute.muteStart('mute:b', 60);
    expect(l.mute.current).toEqual({
      id: 'mute:a',
      endsAt: l.clock.now() + 60_000,
    });
    expect(await l.mute.muteEnd('mute:a', 'expired')).toMatchObject({
      ok: true,
    });
    expect(await l.mute.muteEnd('mute:a', 'expired')).toBeNull();
  });

  it('only its items, back to their snapshot: a mic muted before the vote stays muted', async () => {
    const l = await lab();
    l.obs.inputs.get('Micro (Obsolète)')!.muted = true;
    await l.mute.muteStart('mute:s', 30);
    await l.mute.muteEnd('mute:s', 'expired');
    expect(l.obs.inputs.get('Micro (Obsolète)')!.muted).toBe(true);
    expect(l.obs.requests.some((r) => r.includes('prison'))).toBe(false);
  });

  it('start and end at the same instant never interleave', async () => {
    const l = await lab();
    const start = l.mute.muteStart('mute:s', 30);
    const end = l.mute.muteEnd('mute:s', 'caution');
    await Promise.all([start, end]);
    expect(l.mute.current).toBeNull();
    expect(l.obs.reactionsAfterUnmute()).toEqual([]);
    expect(l.obs.driveFilter.enabled).toBe(false);
  });

  it('Core never ends it: the watchdog does, after the end + margin', async () => {
    const l = await lab();
    await l.mute.muteStart('mute:s', 30);
    l.clock.advance(30_000 + MUTE_WATCHDOG_MS - 1);
    expect(await l.mute.tick()).toBeNull();
    l.clock.advance(1);
    expect(await l.mute.tick()).toMatchObject({ ok: true });
    expect(l.obs.inputs.get('Micro (Obsolète)')!.muted).toBe(false);
  });

  it('OBS leaves during the end: kept, replayed whole when OBS answers', async () => {
    const l = await lab();
    await l.mute.muteStart('mute:s', 30);
    l.obs.failAt = 2; // the zoom reset fails, OBS gone
    expect(await l.mute.muteEnd('mute:s', 'expired')).toBeNull();
    expect(l.mute.current?.id).toBe('mute:s');
    expect(await l.mute.tick()).toBeNull(); // still gone
    l.obs.connected = true;
    expect(await l.mute.tick()).toMatchObject({ ok: true });
    expect(l.obs.inputs.get('Micro (Obsolète)')!.muted).toBe(false);
    expect(l.obs.reactionsAfterUnmute()).toEqual([]);
  });

  it('Studio restarts mid-mute: the saved mute is ended when due', async () => {
    const l = await lab();
    await l.mute.muteStart('mute:s', 30);
    expect(JSON.parse(await readFile(l.file, 'utf8')).id).toBe('mute:s');
    const again = await l.open(); // a new Studio process
    expect(again.current?.id).toBe('mute:s');
    l.clock.advance(30_000 + MUTE_WATCHDOG_MS);
    expect(await again.tick()).toMatchObject({ ok: true });
    await expect(readFile(l.file, 'utf8')).rejects.toThrow();
  });
});
