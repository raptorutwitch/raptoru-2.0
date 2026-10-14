import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObsAuto, STALE_MS, type ObsPort } from '../src/bonk-lab/obs-auto.js';
import {
  BONK_SOURCE_NAME,
  chooseTarget,
  clipPolygon,
  fetchTree,
  flatten,
  scoreCandidates,
  signedArea,
  type ObsSceneItem,
  type ObsTransform,
  type Pinned,
} from '../src/bonk-lab/obs-scene.js';

// Bonk VNext lot 3 — Auto target from the OBS scene graph. Fixtures shaped like real
// GetSceneItemList / GetGroupSceneItemList answers; expected boxes computed by hand.

const T = (o: Partial<ObsTransform> = {}): ObsTransform => ({
  positionX: 0,
  positionY: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  alignment: 5, // top-left
  boundsType: 'OBS_BOUNDS_NONE',
  boundsAlignment: 0,
  boundsWidth: 0,
  boundsHeight: 0,
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
  cropToBounds: false,
  sourceWidth: 1920,
  sourceHeight: 1080,
  ...o,
});
let nextId = 1;
const input = (
  name: string,
  kind: string,
  t: ObsTransform,
  enabled = true,
): ObsSceneItem => ({
  sceneItemId: nextId++,
  sourceName: name,
  sourceUuid: `uuid-${name}`,
  sourceType: 'OBS_SOURCE_TYPE_INPUT',
  inputKind: kind,
  isGroup: false,
  sceneItemEnabled: enabled,
  sceneItemTransform: t,
});
const nested = (
  name: string,
  t: ObsTransform,
  enabled = true,
): ObsSceneItem => ({
  sceneItemId: nextId++,
  sourceName: name,
  sourceUuid: `uuid-${name}`,
  sourceType: 'OBS_SOURCE_TYPE_SCENE',
  inputKind: null,
  isGroup: false,
  sceneItemEnabled: enabled,
  sceneItemTransform: t,
});
const group = (
  name: string,
  t: ObsTransform,
  enabled = true,
): ObsSceneItem => ({
  ...nested(name, t, enabled),
  isGroup: true,
});
type Store = Record<string, ObsSceneItem[]>;
const CANVAS = { width: 1920, height: 1080 };

async function resolve(
  store: Store,
  program: string,
  { canvas = CANVAS, pinned = null as Pinned | null } = {},
) {
  const tree = await fetchTree(program, async (name) => store[name] ?? []);
  const visible = flatten(tree, canvas);
  const candidates = scoreCandidates(visible);
  return { visible, candidates, ...chooseTarget(candidates, pinned) };
}
const box = (r: { x: number; y: number; w: number; h: number }) =>
  [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 100) / 100);

describe('geometry: final box on the canvas (libobs model)', () => {
  it('direct camera: position + scale', async () => {
    const r = await resolve(
      {
        Live: [
          input(
            'Webcam',
            'dshow_input',
            T({ positionX: 1400, positionY: 760, scaleX: 0.25, scaleY: 0.25 }),
          ),
        ],
      },
      'Live',
    );
    expect(box(r.chosen!.rect)).toEqual([1400, 760, 480, 270]);
  });

  it('crop before scale', async () => {
    const r = await resolve(
      {
        Live: [
          input(
            'Webcam',
            'dshow_input',
            T({
              positionX: 100,
              positionY: 100,
              scaleX: 0.5,
              scaleY: 0.5,
              cropLeft: 240,
              cropRight: 240,
            }),
          ),
        ],
      },
      'Live',
    );
    expect(box(r.chosen!.rect)).toEqual([100, 100, 720, 540]);
  });

  it('bounds: scale inner (centred inside the box), stretch, scale outer cropped to bounds', async () => {
    const inner = await resolve(
      {
        Live: [
          input(
            'Webcam',
            'dshow_input',
            T({
              positionX: 200,
              positionY: 200,
              boundsType: 'OBS_BOUNDS_SCALE_INNER',
              boundsWidth: 600,
              boundsHeight: 600,
            }),
          ),
        ],
      },
      'Live',
    );
    expect(box(inner.chosen!.rect)).toEqual([200, 331.25, 600, 337.5]);
    const stretch = await resolve(
      {
        Live: [
          input(
            'Webcam',
            'dshow_input',
            T({
              boundsType: 'OBS_BOUNDS_STRETCH',
              boundsWidth: 400,
              boundsHeight: 400,
            }),
          ),
        ],
      },
      'Live',
    );
    expect(box(stretch.chosen!.rect)).toEqual([0, 0, 400, 400]);
    const outer = await resolve(
      {
        Live: [
          input(
            'Webcam',
            'dshow_input',
            T({
              positionX: 100,
              positionY: 100,
              boundsType: 'OBS_BOUNDS_SCALE_OUTER',
              boundsWidth: 400,
              boundsHeight: 400,
              cropToBounds: true,
            }),
          ),
        ],
      },
      'Live',
    );
    expect(box(outer.chosen!.rect)).toEqual([100, 100, 400, 400]);
  });

  it('rotation around the alignment point: 90° and 30° (axis-aligned box of the turned quad)', async () => {
    const turned = (rotation: number) =>
      resolve(
        {
          Live: [
            input(
              'Webcam',
              'dshow_input',
              T({
                positionX: 960,
                positionY: 540,
                alignment: 0,
                rotation,
                scaleX: 0.25,
                scaleY: 0.25,
              }),
            ),
          ],
        },
        'Live',
      );
    expect(box((await turned(90)).chosen!.rect)).toEqual([825, 300, 270, 480]);
    const w = 480 * Math.cos(Math.PI / 6) + 270 * Math.sin(Math.PI / 6);
    const h = 480 * Math.sin(Math.PI / 6) + 270 * Math.cos(Math.PI / 6);
    expect(box((await turned(30)).chosen!.rect)).toEqual(
      box({ x: 960 - w / 2, y: 540 - h / 2, w, h }),
    );
    // Top-left alignment: it turns around its top-left corner (OBS), not its centre.
    const corner = await resolve(
      {
        Live: [
          input(
            'Webcam',
            'dshow_input',
            T({
              positionX: 600,
              positionY: 200,
              rotation: 90,
              scaleX: 0.25,
              scaleY: 0.25,
            }),
          ),
        ],
      },
      'Live',
    );
    expect(box(corner.chosen!.rect)).toEqual([330, 200, 270, 480]);
  });

  it('camera in a group; group and child transforms compose', async () => {
    const r = await resolve(
      {
        Live: [
          group(
            'Groupe Cam',
            T({
              positionX: 100,
              positionY: 50,
              sourceWidth: 600,
              sourceHeight: 400,
            }),
          ),
        ],
        'Groupe Cam': [
          input(
            'Webcam',
            'dshow_input',
            T({ positionX: 20, positionY: 30, scaleX: 0.25, scaleY: 0.25 }),
          ),
        ],
      },
      'Live',
    );
    expect(box(r.chosen!.rect)).toEqual([120, 80, 480, 270]);
    expect(r.chosen!.path).toEqual(['Live', 'Groupe Cam', 'Webcam']);
  });

  it('camera in a nested scene: scaled parent; the parent crop clips the child', async () => {
    const r = await resolve(
      {
        Live: [
          nested('Scène Cam', T({ positionX: 960, scaleX: 0.5, scaleY: 0.5 })),
        ],
        'Scène Cam': [
          input('Webcam', 'dshow_input', T({ scaleX: 0.5, scaleY: 0.5 })),
        ],
      },
      'Live',
    );
    expect(box(r.chosen!.rect)).toEqual([960, 0, 480, 270]);
    expect(r.chosen!.path).toEqual(['Live', 'Scène Cam', 'Webcam']);
    const cropped = await resolve(
      {
        Live: [
          nested(
            'Scène Cam',
            T({ positionX: 960, scaleX: 0.5, scaleY: 0.5, cropRight: 960 }),
          ),
        ],
        'Scène Cam': [
          input(
            'Webcam',
            'dshow_input',
            T({ positionX: 800, scaleX: 0.25, scaleY: 0.25 }),
          ),
        ],
      },
      'Live',
    );
    // Only the part left of x = 960 (nested space) is drawn: 800..960 → ×0.5 at 960 + 400.
    expect(box(cropped.visible[0]!.rect)).toEqual([1360, 0, 80, 135]);
  });

  it('nested scene inside a group inside the program scene', async () => {
    const r = await resolve(
      {
        Live: [
          group(
            'Habillage',
            T({
              positionX: 40,
              positionY: 40,
              sourceWidth: 1920,
              sourceHeight: 1080,
            }),
          ),
        ],
        Habillage: [
          nested(
            'Scène Cam',
            T({ positionX: 100, positionY: 100, scaleX: 0.5, scaleY: 0.5 }),
          ),
        ],
        'Scène Cam': [
          input('Webcam', 'dshow_input', T({ scaleX: 0.5, scaleY: 0.5 })),
        ],
      },
      'Live',
    );
    expect(box(r.chosen!.rect)).toEqual([140, 140, 480, 270]);
    expect(r.chosen!.path).toEqual([
      'Live',
      'Habillage',
      'Scène Cam',
      'Webcam',
    ]);
  });

  it('partly off the canvas: only the visible part; another canvas size maps to 1920 × 1080', async () => {
    const off = await resolve(
      {
        Live: [
          input(
            'Webcam',
            'dshow_input',
            T({ positionX: 1800, positionY: 900, scaleX: 0.25, scaleY: 0.25 }),
          ),
        ],
      },
      'Live',
    );
    expect(box(off.visible[0]!.rect)).toEqual([1800, 900, 120, 180]);
    const big = await resolve(
      {
        Live: [
          input(
            'Webcam',
            'dshow_input',
            T({ positionX: 1920, positionY: 1080, scaleX: 0.25, scaleY: 0.25 }),
          ),
        ],
      },
      'Live',
      { canvas: { width: 2560, height: 1440 } },
    );
    expect(box(big.chosen!.rect)).toEqual([1440, 810, 360, 202.5]);
    // Same answer through the Bonk overlay source stretched over that canvas.
    const viaOverlay = await resolve(
      {
        Live: [
          input(
            BONK_SOURCE_NAME,
            'browser_source',
            T({ scaleX: 2560 / 1920, scaleY: 1440 / 1080 }),
          ),
          input(
            'Webcam',
            'dshow_input',
            T({ positionX: 1920, positionY: 1080, scaleX: 0.25, scaleY: 0.25 }),
          ),
        ],
      },
      'Live',
      { canvas: { width: 2560, height: 1440 } },
    );
    expect(box(viaOverlay.chosen!.rect)).toEqual([1440, 810, 360, 202.5]);
    expect(viaOverlay.candidates.map((c) => c.name)).toEqual(['Webcam']);
  });

  it('horizontal flip (negative scale): the box extends on the other side of the anchor, as OBS', async () => {
    const r = await resolve(
      {
        Live: [
          input(
            'Webcam',
            'dshow_input',
            T({ positionX: 1880, positionY: 100, scaleX: -0.25, scaleY: 0.25 }),
          ),
        ],
      },
      'Live',
    );
    expect(box(r.chosen!.rect)).toEqual([1400, 100, 480, 270]);
  });

  it('real OBS structure (2026-10-14): scene → nested scene → cropped group → flipped cropped nested scene → dshow camera', async () => {
    // Transforms exactly as read from Antoni's OBS (obs-websocket 5.7.4), the camera is « Cam ».
    const store: Store = {
      'Scène Dessin': [
        input('Écran', 'monitor_capture', T(), false),
        nested(
          'overlay cam shushu',
          T({
            cropLeft: 143,
            cropRight: 125,
            positionX: 1233,
            positionY: 601,
            scaleX: 0.3834827244281769,
            scaleY: 0.38333332538604736,
          }),
        ),
        input(
          'Chatbox Dessin',
          'browser_source',
          T({
            positionX: 43,
            positionY: 361,
            sourceWidth: 440,
            sourceHeight: 719,
          }),
        ),
        input(BONK_SOURCE_NAME, 'browser_source', T()),
      ],
      'overlay cam shushu': [
        group(
          'Rognage',
          T({
            cropTop: 189,
            positionX: 338,
            positionY: 126,
            sourceWidth: 1272,
            sourceHeight: 907,
          }),
        ),
        group(
          'Groupe 2',
          T({
            positionX: 35.00006103515625,
            positionY: 41.000213623046875,
            sourceWidth: 1740,
            sourceHeight: 979,
          }),
        ),
      ],
      Rognage: [
        nested(
          'Camera',
          T({
            cropBottom: 294,
            cropLeft: 450,
            cropRight: 693,
            cropTop: 232,
            positionX: 1271.6365966796875,
            scaleX: -1.636597990989685,
            scaleY: 1.6366782188415527,
          }),
        ),
      ],
      'Groupe 2': [
        input(
          'Overlay Shushu',
          'browser_source',
          T({
            positionX: 0,
            positionY: 0,
            sourceWidth: 1631,
            sourceHeight: 978,
          }),
        ),
      ],
      Camera: [
        input(
          'Cam',
          'dshow_input',
          T({
            positionX: 561,
            positionY: 338,
            sourceWidth: 640,
            sourceHeight: 480,
          }),
        ),
      ],
    };
    const r = await resolve(store, 'Scène Dessin');
    expect(r.status).toBe('ready');
    expect(r.chosen!.name).toBe('Cam');
    expect(r.chosen!.path).toEqual([
      'Scène Dessin',
      'overlay cam shushu',
      'Rognage',
      'Camera',
      'Cam',
    ]);
    // By hand: Cam [561,1201]×[338,818] in « Camera », cropped to [450,1227]×[232,786], flipped
    // ×−1.6366 from x = 1271.64, group crop top 189 then +(338, 126−189), parent crop left 143,
    // ×0.3835 / ×0.3833 from (1233, 601).
    expect(box(r.chosen!.rect)).toEqual([1324.1, 649.3, 401.67, 275.13]);
    expect(r.candidates.map((c) => c.name)).toEqual(['Cam']);
  });

  it('clipPolygon keeps the overlap of convex polygons', () => {
    const square = (x: number, y: number, s: number) =>
      [
        [x, y],
        [x + s, y],
        [x + s, y + s],
        [x, y + s],
      ] as [number, number][];
    const poly = clipPolygon(square(0, 0, 10), square(5, 5, 10));
    const xs = poly.map((p) => p[0]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([5, 10]);
    expect(Math.abs(signedArea(poly))).toBeCloseTo(25, 9);
    // Partly outside on two sides, and a rotated (diamond) clip window.
    expect(
      Math.abs(signedArea(clipPolygon(square(-5, -5, 10), square(0, 0, 100)))),
    ).toBeCloseTo(25, 9);
    const diamond: [number, number][] = [
      [5, 0],
      [10, 5],
      [5, 10],
      [0, 5],
    ];
    expect(
      Math.abs(signedArea(clipPolygon(square(0, 0, 10), diamond))),
    ).toBeCloseTo(50, 9);
  });
});

describe('candidates: deterministic, explainable, conservative', () => {
  const cam = (x = 1400, y = 760, s = 0.25, name = 'Webcam Logitech C920') =>
    input(
      name,
      'dshow_input',
      T({ positionX: x, positionY: y, scaleX: s, scaleY: s }),
    );

  it('fullscreen Browser Source + small webcam: the webcam', async () => {
    const r = await resolve(
      { Live: [input('Alertes', 'browser_source', T()), cam()] },
      'Live',
    );
    expect(r.status).toBe('ready');
    expect(r.chosen!.name).toBe('Webcam Logitech C920');
    expect(r.candidates.map((c) => c.name)).toEqual(['Webcam Logitech C920']);
    expect(r.reason).toBe('seule caméra fiable');
    expect(r.chosen!.reasons[0]).toBe('type caméra (dshow_input) +100');
  });

  it('Game Capture + Display Capture + images + webcam: the webcam only', async () => {
    const r = await resolve(
      {
        Live: [
          input('Jeu', 'game_capture', T()),
          input('Écran 2', 'monitor_capture', T({ scaleX: 0.5, scaleY: 0.5 })),
          input(
            'Cadre webcam',
            'image_source',
            T({
              positionX: 1380,
              positionY: 740,
              sourceWidth: 520,
              sourceHeight: 310,
            }),
          ),
          cam(),
        ],
      },
      'Live',
    );
    expect(r.candidates.map((c) => c.name)).toEqual(['Webcam Logitech C920']);
    expect(r.chosen!.name).toBe('Webcam Logitech C920');
  });

  it('hidden camera, or camera in a hidden group: no candidate → fallback', async () => {
    const hidden = await resolve(
      {
        Live: [
          input(
            'Webcam',
            'dshow_input',
            T({ scaleX: 0.25, scaleY: 0.25 }),
            false,
          ),
        ],
      },
      'Live',
    );
    expect(hidden.status).toBe('no_candidate');
    expect(hidden.chosen).toBeNull();
    const hiddenGroup = await resolve(
      {
        Live: [
          group(
            'Groupe Cam',
            T({ sourceWidth: 600, sourceHeight: 400 }),
            false,
          ),
        ],
        'Groupe Cam': [cam(0, 0)],
      },
      'Live',
    );
    expect(hiddenGroup.chosen).toBeNull();
  });

  it('several cameras: the clearly biggest; two of similar size → hesitation (no target)', async () => {
    const two = await resolve(
      {
        Live: [cam(0, 0, 0.5, 'Cam visage'), cam(1400, 760, 0.25, 'Cam mains')],
      },
      'Live',
    );
    expect(two.chosen!.name).toBe('Cam visage');
    expect(two.reason).toBe('la plus grande caméra fiable');
    const close = await resolve(
      {
        Live: [
          cam(0, 0, 0.25, 'Cam visage'),
          cam(1400, 760, 0.24, 'Cam mains'),
        ],
      },
      'Live',
    );
    expect(close.status).toBe('ambiguous');
    expect(close.chosen).toBeNull();
  });

  it('pinned source: wins even when smaller; absent → best visible, else fallback (never its old box)', async () => {
    const store = {
      Live: [cam(0, 0, 0.5, 'Cam visage'), cam(1400, 760, 0.25, 'Cam mains')],
    };
    const pinned = { name: 'Cam mains', uuid: 'uuid-Cam mains' };
    const r = await resolve(store, 'Live', { pinned });
    expect(r.status).toBe('ready');
    expect(r.chosen!.name).toBe('Cam mains');
    expect(r.reason).toBe('source épinglée');
    const absent = await resolve(
      { Live: [cam(0, 0, 0.5, 'Cam visage')] },
      'Live',
      { pinned },
    );
    expect(absent.status).toBe('pinned_absent');
    expect(absent.chosen!.name).toBe('Cam visage');
    const nothing = await resolve({ Live: [] }, 'Live', { pinned });
    expect(nothing.status).toBe('pinned_absent');
    expect(nothing.chosen).toBeNull();
    // Renamed in OBS: still recognised by its uuid.
    const renamed = await resolve(
      {
        Live: [
          {
            ...cam(1400, 760, 0.25, 'Cam mains (nouveau nom)'),
            sourceUuid: 'uuid-Cam mains',
          },
        ],
      },
      'Live',
      { pinned },
    );
    expect(renamed.chosen!.name).toBe('Cam mains (nouveau nom)');
  });

  it('NDI / unknown kinds: reliable only with a camera name and not fullscreen', async () => {
    const phone = await resolve(
      {
        Live: [
          input('Cam téléphone', 'ndi_source', T({ scaleX: 0.3, scaleY: 0.3 })),
        ],
      },
      'Live',
    );
    expect(phone.chosen!.name).toBe('Cam téléphone');
    expect(phone.chosen!.score).toBe(70);
    const feed = await resolve(
      { Live: [input('Cam PC jeu', 'ndi_source', T())] },
      'Live',
    );
    expect(feed.chosen).toBeNull();
    const unknown = await resolve(
      {
        Live: [
          input(
            'Webcam effet',
            'some_plugin_source',
            T({ scaleX: 0.3, scaleY: 0.3 }),
          ),
        ],
      },
      'Live',
    );
    expect(unknown.status).toBe('no_candidate');
    expect(unknown.candidates[0]!.reliable).toBe(false);
    // …but it can be pinned.
    const pinnedUnknown = await resolve(
      {
        Live: [
          input(
            'Webcam effet',
            'some_plugin_source',
            T({ scaleX: 0.3, scaleY: 0.3 }),
          ),
        ],
      },
      'Live',
      { pinned: { name: 'Webcam effet', uuid: 'uuid-Webcam effet' } },
    );
    expect(pinnedUnknown.chosen!.name).toBe('Webcam effet');
  });

  it('the same source shown twice counts once (its biggest visible instance)', async () => {
    const big = cam(0, 0, 0.5, 'Webcam');
    const small = { ...cam(1400, 760, 0.25, 'Webcam'), sceneItemId: 999 };
    const r = await resolve({ Live: [big, small] }, 'Live');
    expect(r.candidates).toHaveLength(1);
    expect(box(r.chosen!.rect)).toEqual([0, 0, 960, 540]);
    expect(r.status).toBe('ready');
  });
});

describe('live Auto: events, re-reads, never a stale box', () => {
  afterEach(() => vi.useRealTimers());

  function fakeObs(store: Store, program = { name: 'Live' }) {
    let connected = true;
    const calls: string[] = [];
    const port: ObsPort & { connected: boolean } = {
      get connected() {
        return connected;
      },
      set connected(v: boolean) {
        connected = v;
      },
      async request(type: string, data: Record<string, unknown>) {
        calls.push(type);
        if (type === 'GetVideoSettings')
          return { baseWidth: 1920, baseHeight: 1080 };
        if (type === 'GetCurrentProgramScene')
          return { currentProgramSceneName: program.name };
        return { sceneItems: store[String(data.sceneName)] ?? [] };
      },
    };
    return { port, calls, program };
  }
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  it('scene switch: the old box is dropped at once, the new scene is read', async () => {
    vi.useFakeTimers();
    const webcam = input(
      'Webcam',
      'dshow_input',
      T({ positionX: 1400, positionY: 760, scaleX: 0.25, scaleY: 0.25 }),
    );
    const store: Store = {
      Live: [webcam],
      Jeu: [input('Jeu', 'game_capture', T())],
    };
    const obs = fakeObs(store);
    const auto = new ObsAuto(obs.port, () => Date.now());
    await auto.resync();
    expect(auto.snapshot(null).chosen!.name).toBe('Webcam');
    obs.program.name = 'Jeu';
    auto.onEvent('CurrentProgramSceneChanged', { sceneName: 'Jeu' });
    expect(auto.snapshot(null)).toMatchObject({
      status: 'syncing',
      chosen: null,
    });
    await vi.advanceTimersByTimeAsync(50);
    await flush();
    expect(auto.snapshot(null)).toMatchObject({
      status: 'no_candidate',
      chosen: null,
      scene: 'Jeu',
    });
  });

  it('pinned camera hidden: no box at once (not even its last one), then the next best / fallback', async () => {
    vi.useFakeTimers();
    const face = input(
      'Cam visage',
      'dshow_input',
      T({ scaleX: 0.5, scaleY: 0.5 }),
    );
    const hands = input(
      'Cam mains',
      'dshow_input',
      T({ positionX: 1400, positionY: 760, scaleX: 0.25, scaleY: 0.25 }),
    );
    const store: Store = { Live: [face, hands] };
    const obs = fakeObs(store);
    const auto = new ObsAuto(obs.port, () => Date.now());
    const pinned = { name: 'Cam mains', uuid: 'uuid-Cam mains' };
    await auto.resync();
    expect(auto.snapshot(pinned).chosen!.name).toBe('Cam mains');
    store.Live = [face, { ...hands, sceneItemEnabled: false }];
    auto.onEvent('SceneItemEnableStateChanged', {
      sceneName: 'Live',
      sceneItemId: hands.sceneItemId,
      sceneItemEnabled: false,
    });
    expect(auto.snapshot(pinned).chosen).toBeNull();
    await vi.advanceTimersByTimeAsync(50);
    await flush();
    expect(auto.snapshot(pinned)).toMatchObject({ status: 'pinned_absent' });
    expect(auto.snapshot(pinned).chosen!.name).toBe('Cam visage');
  });

  it('camera inside a group hidden through its group: dropped at once too', async () => {
    vi.useFakeTimers();
    const grp = group('Groupe Cam', T({ sourceWidth: 600, sourceHeight: 400 }));
    const store: Store = {
      Live: [grp],
      'Groupe Cam': [
        input('Webcam', 'dshow_input', T({ scaleX: 0.25, scaleY: 0.25 })),
      ],
    };
    const auto = new ObsAuto(fakeObs(store).port, () => Date.now());
    await auto.resync();
    expect(auto.snapshot(null).chosen).not.toBeNull();
    auto.onEvent('SceneItemEnableStateChanged', {
      sceneName: 'Live',
      sceneItemId: grp.sceneItemId,
      sceneItemEnabled: false,
    });
    expect(auto.snapshot(null).chosen).toBeNull();
  });

  it('unrelated changes (an alert toggling) keep the box; a move is re-read after 150 ms', async () => {
    vi.useFakeTimers();
    const webcam = input(
      'Webcam',
      'dshow_input',
      T({ positionX: 1400, positionY: 760, scaleX: 0.25, scaleY: 0.25 }),
    );
    const alert = input('Alerte', 'browser_source', T());
    const store: Store = { Live: [alert, webcam] };
    const obs = fakeObs(store);
    const auto = new ObsAuto(obs.port, () => Date.now());
    await auto.resync();
    auto.onEvent('SceneItemEnableStateChanged', {
      sceneName: 'Live',
      sceneItemId: alert.sceneItemId,
      sceneItemEnabled: false,
    });
    expect(auto.snapshot(null).chosen!.name).toBe('Webcam');
    store.Live = [
      alert,
      {
        ...webcam,
        sceneItemTransform: { ...webcam.sceneItemTransform, positionX: 100 },
      },
    ];
    auto.onEvent('SceneItemTransformChanged', {
      sceneName: 'Live',
      sceneItemId: webcam.sceneItemId,
    });
    for (let i = 0; i < 5; i++)
      auto.onEvent('SceneItemTransformChanged', {
        sceneName: 'Live',
        sceneItemId: webcam.sceneItemId,
      });
    const before = obs.calls.length;
    await vi.advanceTimersByTimeAsync(149);
    expect(obs.calls.length).toBe(before); // debounced
    await vi.advanceTimersByTimeAsync(2);
    await flush();
    expect(auto.snapshot(null).chosen!.rect.x).toBe(100);
  });

  it('a read overtaken by a hiding event is discarded', async () => {
    const webcam = input(
      'Webcam',
      'dshow_input',
      T({ scaleX: 0.25, scaleY: 0.25 }),
    );
    const store: Store = { Live: [webcam] };
    const obs = fakeObs(store);
    let block = false;
    let release: () => void = () => {};
    const slow: ObsPort = {
      get connected() {
        return true;
      },
      async request(type, data) {
        // The answer is taken now (camera visible), delivered later.
        const answer = await obs.port.request(type, data);
        if (block && type === 'GetSceneItemList')
          await new Promise<void>((r) => (release = r));
        return answer;
      },
    };
    const auto = new ObsAuto(slow, () => Date.now());
    await auto.resync();
    expect(auto.snapshot(null).chosen).not.toBeNull();
    block = true;
    const pending = auto.resync();
    await flush();
    store.Live = [{ ...webcam, sceneItemEnabled: false }];
    auto.onEvent('SceneItemEnableStateChanged', {
      sceneName: 'Live',
      sceneItemId: webcam.sceneItemId,
      sceneItemEnabled: false,
    });
    release();
    await pending;
    expect(auto.snapshot(null).chosen).toBeNull();
    auto.stop();
  });

  it('OBS disconnected → offline; no successful read for 15 s → stale (both: Manuel)', async () => {
    let now = 1_000_000;
    const store: Store = {
      Live: [input('Webcam', 'dshow_input', T({ scaleX: 0.25, scaleY: 0.25 }))],
    };
    const obs = fakeObs(store);
    const auto = new ObsAuto(obs.port, () => now);
    await auto.resync();
    expect(auto.snapshot(null).status).toBe('ready');
    now += STALE_MS + 1;
    expect(auto.snapshot(null)).toMatchObject({
      status: 'stale',
      chosen: null,
    });
    obs.port.connected = false;
    expect(auto.snapshot(null)).toMatchObject({
      status: 'obs_offline',
      chosen: null,
    });
  });
});

describe('OBS client: Auto subscriptions, read-only', () => {
  it('asks for the scene events, forwards them, reports each connection; still only Get requests', async () => {
    const { LabObs } = await import('../src/bonk-lab/obs.js');
    const { AUTO_EVENTS } = await import('../src/bonk-lab/obs-auto.js');
    let identify: Record<string, unknown> = {};
    const sent: string[] = [];
    const sockets: (EventTarget & { emit(p: unknown): void })[] = [];
    class Socket extends EventTarget {
      constructor(readonly url: string) {
        super();
        sockets.push(this);
        queueMicrotask(() => this.emit({ op: 0, d: { rpcVersion: 1 } }));
      }
      emit(packet: unknown) {
        this.dispatchEvent(
          new MessageEvent('message', { data: JSON.stringify(packet) }),
        );
      }
      send(raw: string) {
        const p = JSON.parse(raw);
        if (p.op === 1) {
          identify = p.d;
          queueMicrotask(() => this.emit({ op: 2, d: {} }));
        } else sent.push(p.d.requestType);
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', Socket);
    const obs = new LabObs(AUTO_EVENTS);
    const events: string[] = [];
    let connections = 0;
    obs.onEvent = (type) => events.push(type);
    obs.onConnected = () => (connections += 1);
    await obs.connect(4455, '');
    expect(identify.eventSubscriptions).toBe(AUTO_EVENTS);
    expect(AUTO_EVENTS & (1 << 19)).toBeTruthy(); // SceneItemTransformChanged (high volume)
    expect(connections).toBe(1);
    sockets.at(-1)!.emit({
      op: 5,
      d: {
        eventType: 'CurrentProgramSceneChanged',
        eventData: { sceneName: 'Jeu' },
      },
    });
    expect(events).toEqual(['CurrentProgramSceneChanged']);
    expect(sent.every((t) => t.startsWith('Get'))).toBe(true);
    obs.disconnect();
    vi.unstubAllGlobals();
  });
});
