import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILTINS,
  OverlaySettings,
  OverlayStore,
  builtin,
  repairSettings,
} from '../src/spotify/music-overlays.js';
import {
  MusicOverlayHost,
  type OverlayLive,
} from '../src/spotify/music-overlay-host.js';
import {
  MusicOverlayObs,
  OVERLAY_INPUT,
  OVERLAY_SCENE,
  type ObsLike,
} from '../src/spotify/music-overlay-obs.js';

// Music Hub — the OBS music overlays (docs/music/MUSIC_OVERLAYS.md): the presets and the streamer's variants (valid,
// repaired field by field, never lost), the page's long poll (token, versions), the OBS assistant (only adds, never a
// duplicate, confirmed by OBS or refused).

const dir = () => mkdtemp(join(tmpdir(), 'mo-'));
const PAGE_DIR = join(import.meta.dirname, '..', 'music-overlay');

describe('presets', () => {
  it('every built-in is a valid setting, and the six archetypes are all there', () => {
    for (const b of BUILTINS)
      expect(OverlaySettings.safeParse(b.settings).success, b.id).toBe(true);
    expect(new Set(BUILTINS.map((b) => b.settings.archetype))).toEqual(
      new Set(['minimal', 'clean', 'glass', 'neon', 'editorial', 'focus']),
    );
  });

  it('an older or damaged variant is repaired field by field (its other choices kept)', () => {
    const base = builtin('neon')!.settings;
    const { settings, repaired } = repairSettings(
      {
        ...base,
        width: 99_999, // out of range
        font: 'comic', // unknown
        colors: { ...base.colors, accent: '#ABCDEF', opacity: 'x' },
        show: { title: false }, // a field missing from an older version
        removed_field: true,
      },
      base,
    );
    expect(repaired).toBe(true);
    expect(settings.width).toBe(base.width);
    expect(settings.font).toBe(base.font);
    expect(settings.colors.accent).toBe('#ABCDEF');
    expect(settings.colors.opacity).toBe(base.colors.opacity);
    expect(settings.show.title).toBe(false);
    expect(settings.show.artist).toBe(base.show.artist);
    expect(OverlaySettings.safeParse(settings).success).toBe(true);
  });

  it('variants: created, renamed, duplicated, reset, deleted; saved across a restart; the one on air never vanishes', async () => {
    const d = await dir();
    const st = await OverlayStore.open(d);
    expect(st.onAir.id).toBe('clean');
    expect(st.token).toMatch(/^[a-f0-9]{32}$/);
    const v = await st.saveVariant({
      base: 'glass',
      settings: { ...builtin('glass')!.settings, radius: 40 },
    });
    expect(v.name).toBe('Mon Verre');
    await st.setActive(v.id);
    await st.setVisible(true);
    await st.rename(v.id, 'Soirée chill');
    const copy = await st.duplicate(v.id);
    expect(copy.name).toBe('Soirée chill (copie)');
    await st.reset(copy.id);
    // Invalid: refused whole, nothing written.
    await expect(
      st.saveVariant({
        id: v.id,
        base: 'glass',
        settings: { ...v.settings, radius: 900 },
      }),
    ).rejects.toMatchObject({ message: 'invalid_overlay', status: 400 });
    const again = await OverlayStore.open(d);
    expect(again.token).toBe(st.token);
    expect(again.state.visible).toBe(true);
    expect(again.onAir).toMatchObject({ id: v.id, name: 'Soirée chill' });
    expect(again.onAir.settings.radius).toBe(40);
    expect(
      again.state.variants.find((x) => x.id === copy.id)!.settings,
    ).toEqual(builtin('glass')!.settings);
    // The variant on air deleted: its model goes on air (never an empty overlay).
    await again.remove(v.id);
    expect(again.onAir.id).toBe('glass');
  });

  it('a damaged file: its variants repaired at load (told), an unreadable one kept aside, never lost', async () => {
    const d = await dir();
    await writeFile(
      join(d, 'music-overlays.json'),
      JSON.stringify({
        v: 0,
        visible: true,
        active: 'v-abcdef12',
        variants: [
          {
            id: 'v-abcdef12',
            name: 'Vieille',
            base: 'clean',
            settings: { size: 'enorme' },
          },
        ],
      }),
    );
    const st = await OverlayStore.open(d);
    expect(st.repaired).toEqual(['Vieille']);
    expect(st.onAir.settings).toEqual(builtin('clean')!.settings);
    const d2 = await dir();
    await writeFile(join(d2, 'music-overlays.json'), '{ pas du json');
    const st2 = await OverlayStore.open(d2);
    expect(st2.repaired).toEqual(['fichier illisible (mis de côté)']);
    expect(
      (await readdir(d2)).some((f) =>
        f.startsWith('music-overlays.json.unreadable-'),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------- the page and its state

async function host(live: OverlayLive) {
  const store = await OverlayStore.open(await dir());
  let current = live;
  const h = new MusicOverlayHost({
    store,
    dir: PAGE_DIR,
    origin: 'http://127.0.0.1:1',
    live: () => current,
    obs: () => null,
  });
  const server: Server = createServer((req, res) => {
    void h.handle(req, res, new URL(req.url!, 'http://x')).then((done) => {
      if (!done) res.writeHead(404).end();
    });
  }).listen(0);
  const port = (server.address() as AddressInfo).port;
  const get = (path: string, token?: string) =>
    new Promise<{
      status: number;
      body: string;
      headers: Record<string, unknown>;
    }>((ok, ko) => {
      const r = request(
        { port, path, headers: token ? { 'x-overlay-token': token } : {} },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () =>
            ok({ status: res.statusCode!, body, headers: res.headers }),
          );
        },
      );
      r.on('error', ko);
      r.end();
    });
  return {
    h,
    store,
    get,
    set: (l: OverlayLive) => (current = l),
    close: () => server.close(),
  };
}

const LIVE: OverlayLive = {
  state: 'playing',
  gen: 1,
  track: {
    title: 'Tainted Love',
    artists: ['Soft Cell'],
    album: null,
    duration_ms: 153_800,
  },
  position_ms: 42_000,
  cover: null,
  request: null,
};

describe('the OBS page', () => {
  it('serves its files with a strict CSP; its state only with the token', async () => {
    const t = await host(LIVE);
    const page = await t.get('/music-overlay/overlay.html');
    expect(page.status).toBe(200);
    expect(String(page.headers['content-security-policy'])).toContain(
      "connect-src 'self'",
    );
    expect(String(page.headers['content-security-policy'])).toContain(
      'frame-ancestors',
    );
    expect((await t.get('/music-overlay/../src/index.ts')).status).toBe(404);
    expect((await t.get('/music-overlay/state?since=0')).status).toBe(403);
    expect(
      (await t.get('/music-overlay/state?since=0', 'f'.repeat(32))).status,
    ).toBe(403);
    const ok = await t.get('/music-overlay/state?since=0', t.store.token);
    expect(ok.status).toBe(200);
    const s = JSON.parse(ok.body);
    expect(s).toMatchObject({
      visible: false,
      preset: { id: 'clean' },
      live: { track: { title: 'Tainted Love' } },
    });
    expect(ok.body).not.toContain(t.store.token);
    t.close();
  });

  it('long poll: answers at once on a new version, waits for a change otherwise', async () => {
    const t = await host(LIVE);
    const first = JSON.parse(
      (await t.get('/music-overlay/state?since=0', t.store.token)).body,
    );
    const waiting = t.get(
      `/music-overlay/state?since=${first.version}`,
      t.store.token,
    );
    let done = false;
    void waiting.then(() => (done = true));
    await new Promise((r) => setTimeout(r, 150));
    expect(done).toBe(false);
    t.set({ ...LIVE, gen: 2, track: { ...LIVE.track!, title: 'Obsesión' } });
    t.h.bump();
    const next = JSON.parse((await waiting).body);
    expect(next.version).toBeGreaterThan(first.version);
    expect(next.live.track.title).toBe('Obsesión');
    // A change of the setting (show / hide) reaches it too.
    const w2 = t.get(
      `/music-overlay/state?since=${next.version}`,
      t.store.token,
    );
    await t.h.api('POST', '/overlays/visible', async () => ({ visible: true }));
    expect(JSON.parse((await w2).body).visible).toBe(true);
    t.close();
  });

  it('« Tester sur le stream » is a pulse with the real track (never demo data)', async () => {
    const t = await host(LIVE);
    const out = (await t.h.api(
      'POST',
      '/overlays/pulse',
      async () => ({}),
    )) as { pulse: number };
    expect(out.pulse).toBe(1);
    expect(t.h.payload()).toMatchObject({
      pulse: 1,
      live: { track: { title: 'Tainted Love' } },
    });
    t.close();
  });
});

// ---------------------------------------------------------------------------------------------- OBS assistant

function fakeObs(o: { connected?: boolean; lie?: boolean } = {}) {
  const scenes = new Map<string, string[]>([
    ['Jeu', ['Caméra', 'Capture']],
    ['Pause', ['Image']],
  ]);
  const inputs = new Map<string, { kind: string; url?: string }>([
    ['Caméra', { kind: 'dshow_input' }],
  ]);
  let program = 'Jeu';
  const calls: string[] = [];
  const obs: ObsLike = {
    connected: o.connected !== false,
    async request(type, data: Record<string, unknown>) {
      calls.push(type);
      switch (type) {
        case 'GetSceneList':
          return {
            scenes: [...scenes.keys()]
              .reverse()
              .map((sceneName) => ({ sceneName })),
            currentProgramSceneName: program,
          };
        case 'GetInputList':
          return {
            inputs: [...inputs]
              .filter(([, v]) => v.kind === data.inputKind)
              .map(([inputName]) => ({ inputName })),
          };
        case 'GetInputSettings':
          return {
            inputSettings: { url: inputs.get(String(data.inputName))?.url },
          };
        case 'GetSceneItemList':
          return {
            sceneItems: (scenes.get(String(data.sceneName)) ?? []).map(
              (sourceName) => ({ sourceName }),
            ),
          };
        case 'GetVideoSettings':
          return { baseWidth: 1920, baseHeight: 1080 };
        case 'CreateScene':
          scenes.set(String(data.sceneName), []);
          return {};
        case 'CreateInput': {
          if (inputs.has(String(data.inputName)))
            throw Object.assign(new Error('exists'), { code: 601 });
          if (!o.lie) {
            inputs.set(String(data.inputName), {
              kind: String(data.inputKind),
              url: (data.inputSettings as { url: string }).url,
            });
            scenes.get(String(data.sceneName))!.push(String(data.inputName));
          }
          return {};
        }
        case 'CreateSceneItem':
          scenes.get(String(data.sceneName))!.push(String(data.sourceName));
          return {};
        case 'SetInputSettings':
          inputs.get(String(data.inputName))!.url = (
            data.inputSettings as { url: string }
          ).url;
          return {};
      }
      throw new Error(`unexpected ${type}`);
    },
  };
  return {
    obs,
    scenes,
    inputs,
    calls,
    setProgram: (s: string) => (program = s),
  };
}

describe('the OBS assistant (it only adds; OBS confirms)', () => {
  const URL_ = 'http://127.0.0.1:4100/music-overlay/overlay.html#abc';

  it('offline: says so, never claims anything', async () => {
    const f = fakeObs({ connected: false });
    const m = new MusicOverlayObs(
      () => f.obs,
      () => URL_,
    );
    expect(await m.status()).toMatchObject({
      connected: false,
      installed: false,
    });
    await expect(m.install()).rejects.toMatchObject({ message: 'obs_offline' });
    expect(f.calls).toEqual([]);
  });

  it('installs in its OWN scene (no real scene touched), never twice; adds to a chosen scene, once; repairs its URL', async () => {
    const f = fakeObs();
    const m = new MusicOverlayObs(
      () => f.obs,
      () => URL_,
    );
    const out = await m.install();
    expect(out.created).toBe(true);
    expect(f.scenes.get(OVERLAY_SCENE)).toEqual([OVERLAY_INPUT]);
    expect(f.scenes.get('Jeu')).toEqual(['Caméra', 'Capture']); // untouched
    expect(out.status).toMatchObject({
      installed: true,
      url_ok: true,
      on_program: false,
      scenes: [OVERLAY_SCENE],
    });
    // A second click: nothing created.
    expect((await m.install()).created).toBe(false);
    expect(f.calls.filter((c) => c === 'CreateInput')).toHaveLength(1);
    // Added to the scene on air, at the streamer's request; then again: nothing.
    expect((await m.addTo('Jeu')).status.on_program).toBe(true);
    expect((await m.addTo('Jeu')).added).toBe(false);
    expect(f.scenes.get('Jeu')).toEqual(['Caméra', 'Capture', OVERLAY_INPUT]);
    await expect(m.addTo('Inconnue')).rejects.toMatchObject({
      message: 'unknown_scene',
    });
    // A new token / port: its own URL repaired, nothing else.
    const m2 = new MusicOverlayObs(
      () => f.obs,
      () => `${URL_}2`,
    );
    expect((await m2.status()).url_ok).toBe(false);
    expect((await m2.repair()).status.url_ok).toBe(true);
    expect(f.inputs.get('Caméra')).toEqual({ kind: 'dshow_input' });
  });

  it('OBS does not confirm the creation: refused, never « installed »', async () => {
    const f = fakeObs({ lie: true });
    const m = new MusicOverlayObs(
      () => f.obs,
      () => URL_,
    );
    await expect(m.install()).rejects.toMatchObject({
      message: 'obs_not_confirmed',
    });
  });

  it('another source already has the name: told, nothing replaced', async () => {
    const f = fakeObs();
    f.inputs.set(OVERLAY_INPUT, { kind: 'text_gdiplus' });
    const m = new MusicOverlayObs(
      () => f.obs,
      () => URL_,
    );
    await expect(m.install()).rejects.toMatchObject({
      message: 'obs_name_taken',
    });
    expect(f.inputs.get(OVERLAY_INPUT)).toEqual({ kind: 'text_gdiplus' });
  });
});

describe('the page files', () => {
  it('no secret, no Spotify call, no remote script in the page', async () => {
    const js = await readFile(join(PAGE_DIR, 'overlay.js'), 'utf8');
    expect(js).not.toMatch(/api\.spotify\.com|accounts\.spotify/);
    expect(js).toContain('x-overlay-token');
    const html = await readFile(join(PAGE_DIR, 'overlay.html'), 'utf8');
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
  });
});
