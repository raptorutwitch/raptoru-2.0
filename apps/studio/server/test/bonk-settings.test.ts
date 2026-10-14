import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  dragZone,
  fromPixels,
  MIN_ZONE,
  SNAP,
  toPixels,
  DEFAULT_ZONE,
} from '../../web/src/bonk-zone.js';
import { LabObs } from '../src/bonk-lab/obs.js';
import {
  BonkSettingsStore,
  DEFAULT_SETTINGS,
  validateSettings,
} from '../src/bonk-lab/settings.js';

// Bonk VNext lot 2 — where the Bonks aim: settings per profile, the zone editor's geometry, the
// read-only OBS capture.

const file = async () =>
  join(await mkdtemp(join(tmpdir(), 'bonk-settings-')), 'bonk-settings.json');

describe('Bonk target settings (per profile file)', () => {
  it('defaults: Manuel, exactly the lot 1 zone (480 × 300 around 960 × 400)', async () => {
    const store = await BonkSettingsStore.open(await file());
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    expect(store.target()).toEqual({
      revision: 0,
      mode: 'manual',
      rect: { x: 720, y: 250, w: 480, h: 300 },
    });
  });

  it('saves atomically, bumps the revision, and is read back by a new Studio start', async () => {
    const f = await file();
    const store = await BonkSettingsStore.open(f);
    const zone = { x: 0.1, y: 0.5, w: 0.3, h: 0.4 };
    await store.save({ version: 1, mode: 'fullscreen', manual: zone });
    expect(store.revision).toBe(1);
    expect(existsSync(`${f}.tmp`)).toBe(false);
    const reopened = await BonkSettingsStore.open(f);
    expect(reopened.settings).toEqual({
      version: 1,
      mode: 'fullscreen',
      manual: zone,
    });
    expect(reopened.target().mode).toBe('fullscreen');
  });

  it('refuses anything invalid (nothing clamped, nothing written)', async () => {
    const f = await file();
    const store = await BonkSettingsStore.open(f);
    for (const [input, error] of [
      [null, 'invalid_settings'],
      [{ mode: 'auto', manual: DEFAULT_ZONE }, 'invalid_mode'],
      [
        { mode: 'manual', manual: { x: 0, y: 0, w: 0.01, h: 0.5 } },
        'invalid_zone',
      ],
      [
        { mode: 'manual', manual: { x: 0.9, y: 0, w: 0.2, h: 0.5 } },
        'invalid_zone',
      ],
      [
        { mode: 'manual', manual: { x: -0.1, y: 0, w: 0.2, h: 0.5 } },
        'invalid_zone',
      ],
      [
        { mode: 'manual', manual: { x: 'a', y: 0, w: 0.2, h: 0.5 } },
        'invalid_zone',
      ],
    ] as const) {
      expect(validateSettings(input)).toEqual({ ok: false, error });
      await expect(store.save(input)).rejects.toThrow(error);
    }
    expect(existsSync(f)).toBe(false);
    expect(store.revision).toBe(0);
  });

  it('an unreadable or invalid file falls back to the defaults', async () => {
    const f = await file();
    writeFileSync(f, '{broken');
    expect((await BonkSettingsStore.open(f)).settings).toEqual(
      DEFAULT_SETTINGS,
    );
    writeFileSync(
      f,
      JSON.stringify({ version: 1, mode: 'manual', manual: { x: 2 } }),
    );
    expect((await BonkSettingsStore.open(f)).settings).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('Lab and Production keep separate files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bonk-profiles-'));
    const lab = await BonkSettingsStore.open(
      join(dir, 'bonk-lab', 'bonk-settings.json'),
    );
    const prod = await BonkSettingsStore.open(
      join(dir, 'production', 'bonk', 'bonk-settings.json'),
    );
    await prod.save({ ...DEFAULT_SETTINGS, mode: 'fullscreen' });
    expect(
      (
        await BonkSettingsStore.open(
          join(dir, 'bonk-lab', 'bonk-settings.json'),
        )
      ).settings,
    ).toEqual(DEFAULT_SETTINGS);
    expect(lab.settings.mode).toBe('manual');
    expect(
      JSON.parse(
        readFileSync(
          join(dir, 'production', 'bonk', 'bonk-settings.json'),
          'utf8',
        ),
      ).mode,
    ).toBe('fullscreen');
  });
});

describe('zone editor geometry (Studio web)', () => {
  const start = { x: 0.3, y: 0.3, w: 0.3, h: 0.3 };
  type Box = { x: number; y: number; w: number; h: number };
  const close = (a: Box, b: Box) => {
    for (const k of ['x', 'y', 'w', 'h'] as const)
      expect(a[k]).toBeCloseTo(b[k], 9);
  };

  it('moves inside the canvas only, and snaps to its edges', () => {
    close(dragZone(start, 'move', 0.1, -0.1), {
      x: 0.4,
      y: 0.2,
      w: 0.3,
      h: 0.3,
    });
    close(dragZone(start, 'move', -1, 2), { x: 0, y: 0.7, w: 0.3, h: 0.3 });
    const snapped = dragZone(start, 'move', -0.3 + SNAP / 2, 0);
    expect(snapped.x).toBe(0);
  });

  it('resizes by each handle, never under the minimum size nor out of the canvas', () => {
    close(dragZone(start, 'e', 0.1, 0), { x: 0.3, y: 0.3, w: 0.4, h: 0.3 });
    expect(dragZone(start, 'w', 0.1, 0).x).toBeCloseTo(0.4, 9);
    expect(dragZone(start, 'w', 0.1, 0).w).toBeCloseTo(0.2, 9);
    expect(dragZone(start, 'n', 0, -0.1).y).toBeCloseTo(0.2, 9);
    expect(dragZone(start, 's', 0, 0.2).h).toBeCloseTo(0.5, 9);
    const se = dragZone(start, 'se', 1, 1);
    expect(se.x + se.w).toBeCloseTo(1, 9);
    expect(se.y + se.h).toBeCloseTo(1, 9);
    const nw = dragZone(start, 'nw', 1, 1);
    expect(nw.w).toBeCloseTo(MIN_ZONE, 9);
    expect(nw.h).toBeCloseTo(MIN_ZONE, 9);
    expect(nw.x + nw.w).toBeCloseTo(0.6, 9); // the opposite corner does not move
  });

  it('pixels ↔ fractions: typed values are kept valid', () => {
    expect(toPixels(DEFAULT_ZONE)).toEqual({ x: 720, y: 250, w: 480, h: 300 });
    expect(fromPixels({ x: 720, y: 250, w: 480, h: 300 })).toEqual(
      DEFAULT_ZONE,
    );
    const z = fromPixels({ x: 1900, y: -50, w: 5000, h: 10 });
    expect(z.w).toBe(1);
    expect(z.x).toBe(0);
    expect(z.y).toBe(0);
    expect(z.h).toBe(MIN_ZONE);
  });
});

describe('OBS capture for the zone editor (read-only)', () => {
  it('captures the program scene with Get requests only', async () => {
    const requests: { type: string; data: Record<string, unknown> }[] = [];
    class Socket extends EventTarget {
      constructor(readonly url: string) {
        super();
        queueMicrotask(() => this.emit({ op: 0, d: { rpcVersion: 1 } }));
      }
      emit(packet: unknown) {
        this.dispatchEvent(
          new MessageEvent('message', { data: JSON.stringify(packet) }),
        );
      }
      send(raw: string) {
        const p = JSON.parse(raw);
        if (p.op === 1)
          return queueMicrotask(() => this.emit({ op: 2, d: {} }));
        requests.push({ type: p.d.requestType, data: p.d.requestData });
        const responseData =
          p.d.requestType === 'GetCurrentProgramScene'
            ? { currentProgramSceneName: 'Just Chatting' }
            : { imageData: 'data:image/jpg;base64,AAAA' };
        queueMicrotask(() =>
          this.emit({
            op: 7,
            d: {
              requestId: p.d.requestId,
              requestStatus: { result: true },
              responseData,
            },
          }),
        );
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', Socket);
    const obs = new LabObs();
    await obs.connect(4455, '');
    expect(await obs.programScreenshot()).toBe('data:image/jpg;base64,AAAA');
    expect(requests.map((r) => r.type)).toEqual([
      'GetCurrentProgramScene',
      'GetSourceScreenshot',
    ]);
    expect(requests[1]!.data).toMatchObject({ sourceName: 'Just Chatting' });
    obs.disconnect();
    vi.unstubAllGlobals();
  });
});
