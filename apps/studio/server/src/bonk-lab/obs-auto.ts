import {
  chooseTarget,
  fetchTree,
  flatten,
  scoreCandidates,
  type AutoStatus,
  type Candidate,
  type ObsSceneItem,
  type Pinned,
} from './obs-scene.js';

// Bonk VNext lot 3 — the live Auto target. OBS events mark the scene graph out of date and trigger
// a full re-read (debounced); a light periodic re-read covers missed events. An event that can hide
// or remove a camera (scene switch, visibility, removal) drops the current result at once: until the
// next read, Auto has no target and the Manuel zone is used — never a camera's last position.

/** obs-websocket subscriptions: Config, Scenes, Inputs, SceneItems + SceneItemTransformChanged. */
export const AUTO_EVENTS = 2 | 4 | 8 | 128 | (1 << 19);
export const DEBOUNCE_MS = 150;
const INVALIDATE_MS = 20;
export const RESYNC_MS = 10_000;
/** Without a successful read for this long, Auto is not trusted. */
export const STALE_MS = 15_000;

/** Events that may change what is on screen. */
const SCENE_EVENTS = new Set([
  'CurrentProgramSceneChanged',
  'SceneNameChanged',
  'SceneRemoved',
  'SceneItemCreated',
  'SceneItemRemoved',
  'SceneItemEnableStateChanged',
  'SceneItemListReindexed',
  'SceneItemTransformChanged',
  'InputCreated',
  'InputRemoved',
  'InputNameChanged',
  'VideoSettingsChanged',
  'CurrentSceneCollectionChanged',
]);

export interface ObsPort {
  readonly connected: boolean;
  request(type: string, data: object): Promise<Record<string, unknown>>;
}

export interface AutoSnapshot {
  status: AutoStatus | 'obs_offline' | 'syncing' | 'stale';
  chosen: Candidate | null;
  reason: string;
  candidates: Candidate[];
  scene: string | null;
  canvas: { width: number; height: number } | null;
  pinned: Pinned | null;
}

interface Result {
  at: number;
  scene: string;
  canvas: { width: number; height: number };
  candidates: Candidate[];
}

export class ObsAuto {
  private result: Result | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  /** Last read failure (status display). */
  error: string | null = null;

  constructor(
    private readonly obs: ObsPort,
    private readonly now: () => number = Date.now,
  ) {}

  start() {
    this.interval ??= setInterval(() => void this.resync(), RESYNC_MS);
  }
  stop() {
    if (this.interval) clearInterval(this.interval);
    if (this.timer) clearTimeout(this.timer);
    this.interval = null;
    this.timer = null;
  }

  /** OBS (re)connected: read at once. */
  onConnected() {
    this.schedule(0);
  }

  onEvent(type: string, data: Record<string, unknown>) {
    if (!SCENE_EVENTS.has(type)) return;
    if (this.hides(type, data)) {
      this.result = null; // never keep a geometry that may have just disappeared
      this.generation += 1; // a read already running answers for the old scene
      this.schedule(INVALIDATE_MS);
    } else this.schedule(DEBOUNCE_MS);
  }

  /** Can this event hide or remove a camera candidate (or switch the scene)? */
  private hides(type: string, data: Record<string, unknown>) {
    if (
      type === 'CurrentProgramSceneChanged' ||
      type === 'SceneRemoved' ||
      type === 'VideoSettingsChanged' ||
      type === 'CurrentSceneCollectionChanged'
    )
      return true;
    const candidates = this.result?.candidates ?? [];
    if (type === 'InputRemoved' || type === 'InputNameChanged')
      return candidates.some(
        (c) => c.name === (data.inputName ?? data.oldInputName),
      );
    if (type === 'SceneItemRemoved' || type === 'SceneItemEnableStateChanged') {
      if (
        type === 'SceneItemEnableStateChanged' &&
        data.sceneItemEnabled === true
      )
        return false; // showing something never removes a camera
      return candidates.some((c) =>
        c.chain.some(
          (l) => l.scene === data.sceneName && l.id === data.sceneItemId,
        ),
      );
    }
    return false;
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.resync();
    }, ms);
  }

  /** Reads the whole program tree; a read overtaken by a newer event is discarded. */
  async resync() {
    if (!this.obs.connected) {
      this.result = null;
      return;
    }
    const generation = ++this.generation;
    try {
      const video = await this.obs.request('GetVideoSettings', {});
      const program = await this.obs.request('GetCurrentProgramScene', {});
      const scene = String(program.currentProgramSceneName ?? '');
      const tree = await fetchTree(scene, async (name, group) => {
        const r = await this.obs.request(
          group ? 'GetGroupSceneItemList' : 'GetSceneItemList',
          { sceneName: name },
        );
        return (r.sceneItems ?? []) as ObsSceneItem[];
      });
      const canvas = {
        width: Number(video.baseWidth) || 1920,
        height: Number(video.baseHeight) || 1080,
      };
      if (generation !== this.generation) return;
      this.result = {
        at: this.now(),
        scene,
        canvas,
        candidates: scoreCandidates(flatten(tree, canvas)),
      };
      this.error = null;
    } catch (e) {
      if (generation !== this.generation) return;
      this.result = null;
      this.error = (e as Error).message;
    }
  }

  /** Where Auto aims now for this pinned source (computed on demand: a new pin applies at once). */
  snapshot(pinned: Pinned | null): AutoSnapshot {
    const base = { pinned, scene: null, canvas: null, candidates: [] };
    if (!this.obs.connected)
      return {
        ...base,
        status: 'obs_offline',
        chosen: null,
        reason: 'OBS déconnecté',
      };
    const r = this.result;
    if (!r)
      return {
        ...base,
        status: 'syncing',
        chosen: null,
        reason: 'lecture de la scène OBS',
      };
    if (this.now() - r.at > STALE_MS)
      return {
        ...base,
        status: 'stale',
        chosen: null,
        reason: 'OBS ne répond plus',
        scene: r.scene,
      };
    const choice = chooseTarget(r.candidates, pinned);
    return {
      ...choice,
      pinned,
      scene: r.scene,
      canvas: r.canvas,
      candidates: r.candidates,
    };
  }
}
