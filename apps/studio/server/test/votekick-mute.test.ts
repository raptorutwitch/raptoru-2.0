import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MUTE_WATCHDOG_MS,
  MuteController,
  RAPTORU_MUTE_FX,
  REST_ZOOM,
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

  it('V2: drive cut, zoom reset (late write reset again), zoom and band off together, mic LAST — no reaction after the unmute', async () => {
    const l = await lab();
    await l.mute.muteStart('mute:s1', 50);
    expect(l.obs.inputs.get('Micro (Obsolète)')!.muted).toBe(true);
    expect(l.obs.bandFilter.settings.mute_duration).toBe(0); // no clock of its own: Studio ends it
    l.obs.voice(0.8);
    l.clock.advance(20_000);
    const report = await l.mute.muteEnd('mute:s1', 'caution');
    expect(report).toEqual({ id: 'mute:s1', ok: true, mismatches: [] });
    expect(l.obs.reactionsAfterUnmute()).toEqual([]);
    const steps = l.obs.frames.map((f) => f.step);
    const unmute = steps.lastIndexOf('micro rétabli');
    expect(unmute).toBe(steps.length - 1); // the voice is the very last change
    // The band's saved duration was written back after it was disabled.
    expect(steps).toContain('Votekick Mute réglé');
    expect(l.obs.zoomFilter.settings.zoom).toBe(REST_ZOOM);
    expect(l.obs.filters.get('overlay cam shushu|prison')!.enabled).toBe(false);
  });
});

describe('MUTED V2: the audio drive', () => {
  it('the drive’s settings and the zoom’s other settings are never written; drive enabled last', async () => {
    const l = await lab();
    const drive = { ...l.obs.driveFilter.settings };
    l.obs.zoomFilter.settings.zoom_max = 1.08;
    await l.mute.muteStart('mute:s1', 50);
    const r = l.obs.requests;
    expect(
      r.some(
        (x) =>
          x ===
          'SetSourceFilterSettings Micro (Obsolète) / Votekick Zoom Drive',
      ),
    ).toBe(false);
    expect(r.filter((x) => x.startsWith('Set')).at(-1)).toBe(
      'SetSourceFilterEnabled Micro (Obsolète) / Votekick Zoom Drive',
    );
    await l.mute.muteEnd('mute:s1', 'expired');
    expect(l.obs.driveFilter.settings).toEqual(drive);
    expect(l.obs.zoomFilter.settings.zoom_max).toBe(1.08);
  });

  it('end: zoom and band disabled together, no exit animation; mic last; always back to REST even if left on before', async () => {
    const l = await lab();
    // OBS left « live » by a manual test: drive and zoom on before the vote.
    l.obs.driveFilter.enabled = true;
    l.obs.zoomFilter.enabled = true;
    const bandDuration = l.obs.bandFilter.settings.mute_duration;
    await l.mute.muteStart('mute:s1', 50);
    l.clock.advance(20_000);
    const from = l.obs.requests.length;
    expect(await l.mute.muteEnd('mute:s1', 'caution')).toEqual({
      id: 'mute:s1',
      ok: true,
      mismatches: [],
    });
    const sets = l.obs.requests.slice(from).filter((x) => x.startsWith('Set'));
    const zoomOff = sets.indexOf(
      'SetSourceFilterEnabled overlay cam shushu / Votekick Zoom',
    );
    expect(sets[zoomOff + 1]).toBe(
      'SetSourceFilterEnabled overlay cam shushu / Votekick Mute',
    );
    expect(sets.at(-1)).toBe('SetInputMute Micro (Obsolète)');
    expect(l.clock.now()).toBe(1_000_000 + 20_000); // no wait for an exit animation
    expect(l.obs.driveFilter.enabled).toBe(false);
    expect(l.obs.zoomFilter.enabled).toBe(false);
    expect(l.obs.zoomFilter.settings.zoom).toBe(REST_ZOOM);
    expect(l.obs.bandFilter.enabled).toBe(false);
    expect(l.obs.bandFilter.settings.mute_duration).toBe(bandDuration);
    expect(l.obs.reactionsAfterUnmute()).toEqual([]);
  });
});

describe('MUTED V2: the zoom is never written as an integer (Audio Move truncation)', () => {
  /** Every zoom value Studio sends, as its JSON text (what obs-websocket receives). */
  const zoomWrites = (obs: SimObs) => {
    const sent: string[] = [];
    const real = obs.request.bind(obs);
    obs.request = async (type, d) => {
      const z = (d as { filterSettings?: { zoom?: unknown } }).filterSettings
        ?.zoom;
      if (type === 'SetSourceFilterSettings' && z !== undefined)
        sent.push(JSON.stringify(z));
      return real(type, d);
    };
    return sent;
  };

  it('the 23/10 failure, reproduced: a zoom written as JSON 1 is an OBS integer, the drive then writes 1 forever', async () => {
    const obs = new SimObs();
    await obs.request('SetSourceFilterSettings', {
      sourceName: 'overlay cam shushu',
      filterName: 'Votekick Zoom',
      filterSettings: { zoom: 1 },
      overlay: true,
    });
    obs.driveFilter.enabled = true;
    obs.voice(0.8);
    expect(obs.zoomIsInteger).toBe(true);
    expect(obs.zoomFilter.settings.zoom).toBe(1); // frozen: Math.trunc(1.24)
  });

  it('every zoom written is a decimal; mic muted, the voice moves the zoom and silence brings it back; again after the end', async () => {
    const l = await lab();
    const sent = zoomWrites(l.obs);
    l.obs.zoomFilter.settings.zoom = 1; // whatever OBS held
    for (const round of [1, 2]) {
      await l.mute.muteStart(`mute:r${round}`, 30);
      expect(l.obs.inputs.get('Micro (Obsolète)')!.muted).toBe(true);
      expect(l.obs.zoomIsInteger).toBe(false);
      l.obs.voice(0.8);
      expect(l.obs.zoomFilter.settings.zoom).toBeCloseTo(1.24, 6);
      l.obs.voice(0);
      expect(l.obs.zoomFilter.settings.zoom).toBe(1);
      l.obs.voice(0.4);
      expect(l.obs.zoomFilter.settings.zoom).toBeCloseTo(1.12, 6);
      expect(await l.mute.muteEnd(`mute:r${round}`, 'expired')).toMatchObject({
        ok: true,
      });
      expect(l.obs.zoomIsInteger).toBe(false);
      expect(l.obs.zoomFilter.settings.zoom).toBe(REST_ZOOM);
    }
    expect(sent.length).toBeGreaterThanOrEqual(4);
    for (const text of sent) expect(text).toMatch(/[.e]/); // never `1`: always a JSON decimal
    expect(Number(sent[0])).toBe(1.000001);
  });

  it('Raptoru names: the drive on « Micro » only, « Micro (Obsolète) » never touched; drive settings and zoom_max kept', async () => {
    const obs = new SimObs(RAPTORU_MUTE_FX);
    obs.driveFilter.settings.factor = 0.8;
    obs.zoomFilter.settings.zoom_max = 1.101;
    const dir = await mkdtemp(join(tmpdir(), 'vk-mute-'));
    dirs.push(dir);
    const mute = await MuteController.open(
      join(dir, 'm.json'),
      () => obs,
      RAPTORU_MUTE_FX,
      () => 1_000_000,
      async () => {},
    );
    await mute.muteStart('mute:x', 30);
    obs.voice(0.5);
    expect(obs.zoomFilter.settings.zoom).toBeCloseTo(1.15, 6);
    await mute.muteEnd('mute:x', 'caution');
    expect(obs.requests.some((r) => r.includes('Obsolète'))).toBe(false);
    expect(obs.driveFilter.settings).toEqual({ base_value: 1, factor: 0.8 });
    expect(obs.zoomFilter.settings.zoom_max).toBe(1.101);
    expect(obs.inputs.get('Micro')!.muted).toBe(false);
  });
});

describe('MUTED V2: the band has no clock of its own (one clock: Studio)', () => {
  /** The band writes during the mute, and the order of the end's steps. */
  const watch = (obs: SimObs) => {
    const bandWrites: unknown[] = [];
    const real = obs.request.bind(obs);
    obs.request = async (type, d) => {
      const data = d as {
        filterName?: string;
        filterSettings?: { mute_duration?: unknown };
      };
      if (
        type === 'SetSourceFilterSettings' &&
        data.filterName === 'Votekick Mute'
      )
        bandWrites.push(data.filterSettings?.mute_duration);
      return real(type, d);
    };
    return bandWrites;
  };
  const endSteps = (obs: SimObs, from: number) =>
    obs.requests.slice(from).filter((x) => x.startsWith('Set'));

  it('normal end: mute_duration 0 for the whole mute, zoom and band off together, 110 back, mic last', async () => {
    const l = await lab();
    const writes = watch(l.obs);
    await l.mute.muteStart('mute:n', 30);
    expect(l.obs.bandFilter.enabled).toBe(true);
    expect(l.obs.bandFilter.settings.mute_duration).toBe(0);
    l.clock.advance(30_000);
    const from = l.obs.requests.length;
    expect(await l.mute.muteEnd('mute:n', 'expired')).toMatchObject({
      ok: true,
    });
    const steps = endSteps(l.obs, from);
    const zoomOff = steps.indexOf(
      'SetSourceFilterEnabled overlay cam shushu / Votekick Zoom',
    );
    expect(steps[zoomOff + 1]).toBe(
      'SetSourceFilterEnabled overlay cam shushu / Votekick Mute',
    );
    expect(steps.at(-1)).toBe('SetInputMute Micro (Obsolète)');
    expect(writes).toEqual([0, 110]); // 0 at the start, its own value back at the end: nothing in between
    expect(l.obs.bandFilter.settings.mute_duration).toBe(110);
  });

  it('a second mute while one runs joins the scene: no duration written to the band; the scene ends with the LAST one', async () => {
    const l = await lab();
    const writes = watch(l.obs);
    await l.mute.muteStart('mute:a', 30);
    l.clock.advance(20_000);
    await l.mute.muteStart('mute:b', 60);
    expect(writes).toEqual([0]);
    expect(l.obs.bandFilter.settings.mute_duration).toBe(0);
    expect(l.mute.current?.endsAt).toBe(l.clock.now() + 60_000);
    expect(l.mute.owners()).toEqual(['mute:a', 'mute:b']);
    l.clock.advance(10_000);
    // mute:a over: it leaves, the scene stays for mute:b (still muted, band and zoom on).
    expect(await l.mute.muteEnd('mute:a', 'expired')).toBeNull();
    expect(l.obs.bandFilter.enabled).toBe(true);
    expect(l.obs.inputs.get('Micro (Obsolète)')!.muted).toBe(true);
    l.clock.advance(50_000);
    expect(await l.mute.muteEnd('mute:b', 'expired')).toMatchObject({
      ok: true,
    });
    expect(writes).toEqual([0, 110]);
    expect(l.obs.bandFilter.enabled).toBe(false);
    expect(l.obs.inputs.get('Micro (Obsolète)')!.muted).toBe(false);
  });

  it('caution (early end): both effects off together at once, back to the initial state', async () => {
    const l = await lab();
    const before = {
      mic: l.obs.inputs.get('Micro (Obsolète)')!.muted,
      band: { ...l.obs.bandFilter.settings },
      zoomMax: l.obs.zoomFilter.settings.zoom_max,
      drive: { ...l.obs.driveFilter.settings },
    };
    await l.mute.muteStart('mute:c', 60);
    l.obs.voice(0.6);
    l.clock.advance(5_000);
    const from = l.obs.requests.length;
    expect(await l.mute.muteEnd('mute:c', 'caution')).toMatchObject({
      ok: true,
    });
    const steps = endSteps(l.obs, from);
    const zoomOff = steps.indexOf(
      'SetSourceFilterEnabled overlay cam shushu / Votekick Zoom',
    );
    expect(steps[zoomOff + 1]).toBe(
      'SetSourceFilterEnabled overlay cam shushu / Votekick Mute',
    );
    expect(l.obs.inputs.get('Micro (Obsolète)')!.muted).toBe(before.mic);
    expect(l.obs.bandFilter.settings).toEqual(before.band);
    expect(l.obs.zoomFilter.settings.zoom_max).toBe(before.zoomMax);
    expect(l.obs.driveFilter.settings).toEqual(before.drive);
    expect([
      l.obs.driveFilter.enabled,
      l.obs.zoomFilter.enabled,
      l.obs.bandFilter.enabled,
    ]).toEqual([false, false, false]);
    expect(l.obs.zoomFilter.settings.zoom).toBe(REST_ZOOM);
    expect(l.obs.reactionsAfterUnmute()).toEqual([]);
  });
});

describe('MUTED V2: determinism', () => {
  it('a late or repeated end of an old mute does nothing; a repeated start does nothing; an ended mute never comes back', async () => {
    const l = await lab();
    await l.mute.muteStart('mute:a', 30);
    await l.mute.muteStart('mute:a', 30); // repeated
    expect(l.mute.owners()).toEqual(['mute:a']);
    expect(await l.mute.muteEnd('mute:old', 'expired')).toBeNull();
    expect(l.mute.current?.id).toBe('mute:a');
    expect(await l.mute.muteEnd('mute:a', 'caution')).toMatchObject({
      ok: true,
    });
    expect(await l.mute.muteEnd('mute:a', 'expired')).toBeNull();
    // A late watchdog / restart after the caution: nothing is applied again.
    l.clock.advance(60_000);
    await l.mute.tick();
    expect(await (await l.open()).current).toBeNull();
    expect(l.obs.bandFilter.enabled).toBe(false);
    expect(l.obs.inputs.get('Micro (Obsolète)')!.muted).toBe(false);
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
