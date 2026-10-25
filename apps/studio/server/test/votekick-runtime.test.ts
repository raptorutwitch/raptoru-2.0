import { mkdtemp, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MuteController,
  RAPTORU_MUTE_FX,
} from '../src/votekick/mute-controller.js';
import { VotekickRuntime } from '../src/votekick/runtime.js';
import { SimObs } from '../src/votekick/sim-obs.js';

// Votekick V2 in Studio: Core's mute task applied on a simulated OBS with Raptoru's names (« Micro », never
// « Micro (Obsolète) »): muted then restored to its previous state, never left cut after a failure, reported once;
// the overlay event and files served.

const OVERLAY = fileURLToPath(new URL('../votekick-overlay', import.meta.url));
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

type Mute = {
  mute_id: string;
  status: 'pending' | 'active' | 'ended' | 'failed';
  seconds: number;
  ends_at: string | null;
  end_reason: 'expired' | 'caution' | null;
};

async function studio(obs: SimObs = new SimObs(RAPTORU_MUTE_FX)) {
  const dir = await mkdtemp(join(tmpdir(), 'vk-rt-'));
  dirs.push(dir);
  const core = {
    mute: null as Mute | null,
    overlay: { action: 'clear' } as Record<string, unknown>,
    reports: [] as { id: string; event: string }[],
    failReports: 0,
  };
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    if (path.endsWith('/studio'))
      return { overlay: core.overlay, mute: core.mute } as T;
    if (path.endsWith('/report')) {
      if (core.failReports > 0) {
        core.failReports--;
        throw new Error('core timeout');
      }
      core.reports.push({
        id: path.split('/mutes/')[1]!.replace('/report', ''),
        event: (body as { event: string }).event,
      });
      return {} as T;
    }
    return { recent: [] } as T;
  };
  const rt = new VotekickRuntime({
    core: call,
    base: '/v1/studio/votekick',
    channelId: '83603689',
    mute: await MuteController.open(
      join(dir, 'votekick-mute.json'),
      () => obs,
      RAPTORU_MUTE_FX,
      Date.now,
      async () => {},
    ),
    overlayDir: OVERLAY,
  });
  return { obs, core, rt, mic: () => obs.inputs.get('Micro')!.muted };
}
const pending = (id = 'mute:00000000-0000-4000-8000-000000000001'): Mute => ({
  mute_id: id,
  status: 'pending',
  seconds: 60,
  ends_at: null,
  end_reason: null,
});

describe('Votekick in Studio: the broadcaster’s mute on « Micro »', () => {
  it('muted on Core’s task, reported once; ended by a caution → « Micro » restored, reported', async () => {
    const s = await studio();
    expect(s.obs.inputs.has('Micro (Obsolète)')).toBe(false);
    s.core.mute = pending();
    await s.rt.tick();
    expect(s.mic()).toBe(true);
    await s.rt.tick();
    expect(s.core.reports).toEqual([
      { id: s.core.mute.mute_id, event: 'started' },
    ]);
    s.core.mute = { ...s.core.mute, status: 'ended', end_reason: 'caution' };
    await s.rt.tick();
    expect(s.mic()).toBe(false);
    expect(s.core.reports.at(-1)).toMatchObject({ event: 'ended' });
    await s.rt.tick();
    expect(s.core.reports).toHaveLength(2);
  });

  it('a mic already muted before the vote stays muted after it', async () => {
    const s = await studio();
    s.obs.inputs.get('Micro')!.muted = true;
    s.core.mute = pending();
    await s.rt.tick();
    s.core.mute = { ...s.core.mute, status: 'ended', end_reason: 'expired' };
    await s.rt.tick();
    expect(s.mic()).toBe(true);
  });

  it('OBS disconnected: never muted, reported failed', async () => {
    const s = await studio();
    s.obs.connected = false;
    s.core.mute = pending();
    await s.rt.tick();
    expect(s.core.reports).toEqual([
      { id: s.core.mute.mute_id, event: 'failed' },
    ]);
    s.obs.connected = true;
    expect(s.mic()).toBe(false);
  });

  it('an OBS element missing: nothing touched (read before any change), reported failed', async () => {
    const obs = new SimObs(RAPTORU_MUTE_FX);
    obs.filters.delete('Micro|Votekick Zoom Drive');
    const s = await studio(obs);
    s.core.mute = pending();
    await s.rt.tick();
    expect(s.core.reports.at(-1)).toMatchObject({ event: 'failed' });
    expect(s.obs.requests.some((r) => r.startsWith('SetInputMute'))).toBe(
      false,
    );
    expect(s.mic()).toBe(false);
  });

  it('OBS refuses a step after the mic was cut: everything restored at once, the mic never stays cut', async () => {
    const obs = new SimObs(RAPTORU_MUTE_FX);
    const real = obs.request.bind(obs);
    let refused = false;
    obs.request = async (type, d) => {
      if (
        !refused &&
        type === 'SetSourceFilterEnabled' &&
        (d as { filterName?: string }).filterName === 'Votekick Mute'
      ) {
        refused = true;
        throw new Error('OBS refused');
      }
      return real(type, d);
    };
    const s = await studio(obs);
    s.core.mute = pending();
    await s.rt.tick();
    expect(s.core.reports.at(-1)).toMatchObject({ event: 'failed' });
    expect(s.mic()).toBe(false);
  });

  it('a lost « started » report is sent again (no second mute in OBS)', async () => {
    const s = await studio();
    s.core.failReports = 1;
    s.core.mute = pending();
    await s.rt.tick();
    expect(s.core.reports).toEqual([]);
    const sets = s.obs.requests.filter((r) =>
      r.startsWith('SetInputMute'),
    ).length;
    await s.rt.tick();
    expect(s.core.reports).toEqual([
      { id: s.core.mute.mute_id, event: 'started' },
    ]);
    expect(
      s.obs.requests.filter((r) => r.startsWith('SetInputMute')).length,
    ).toBe(sets);
  });

  it('Core gave up on the mute (failed) while OBS was muted late: restored at once', async () => {
    const s = await studio();
    s.core.failReports = 5;
    s.core.mute = pending();
    await s.rt.tick();
    expect(s.mic()).toBe(true);
    s.core.mute = { ...s.core.mute, status: 'failed' };
    await s.rt.tick();
    expect(s.mic()).toBe(false);
  });
});

describe('Votekick in Studio: the overlay', () => {
  function get(rt: VotekickRuntime, path: string) {
    const out = { status: 0, body: '' };
    const res = {
      writeHead: (s: number) => ((out.status = s), res),
      end: (b: string | Buffer) => ((out.body = String(b)), res),
    } as unknown as ServerResponse;
    const req = { method: 'GET', headers: {} } as IncomingMessage;
    return rt
      .handle(req, res, new URL(path, 'http://127.0.0.1:4100'))
      .then((handled) => ({ handled, ...out }));
  }

  it('serves Core’s event, the legacy page (studio mode) at /overlay.html and the 23/10 alias, nothing else of the folder', async () => {
    const s = await studio();
    s.core.overlay = { action: 'live', session: 'v1', seq: 3, yes: 2, no: 1 };
    await s.rt.tick();
    expect(JSON.parse((await get(s.rt, '/votekick/event')).body)).toMatchObject(
      {
        action: 'live',
        seq: 3,
      },
    );
    const page = await get(s.rt, '/votekick/overlay.html?studio');
    expect(page.status).toBe(200);
    expect(page.body).toContain("params.has('studio')");
    expect(page.body).toContain('applySammiEvent(JSON.parse(text))'); // the legacy design fed by Studio
    expect(page.body).not.toContain('variants'); // never the exploration page (variant D)
    // The OBS source created on 23/10 keeps working: same page.
    const alias = await get(
      s.rt,
      '/votekick/variants/variants.html?v=D&studio',
    );
    expect(alias.status).toBe(200);
    expect(alias.body).toBe(page.body);
    expect((await get(s.rt, '/votekick/model.js')).status).toBe(404);
    expect(await get(s.rt, '/votekick/../../package.json')).toMatchObject({
      handled: false, // normalised to /package.json: never served from here
    });
    expect(
      (await get(s.rt, '/votekick/variants/../../src/index.ts')).status,
    ).not.toBe(200);
    expect((await get(s.rt, '/other')).handled).toBe(false);
  });
});
