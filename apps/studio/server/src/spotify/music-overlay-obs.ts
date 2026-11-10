// Music Hub — the music overlay in OBS (docs/music/MUSIC_OVERLAYS.md § OBS), on Studio's ONE OBS connection (the same as
// Bonk, the rewards' OBS actions). It only ever ADDS, on an explicit click: a browser source « Raptoru · Musique » in its
// own isolated scene « Raptoru · Musique (overlay) » (never a real scene of the stream), then — asked separately, with a
// confirmation — the same source into the scene the streamer names. Never a deletion, never a replacement, never a
// second copy (looked up by name first). Every result is what OBS answers back, never assumed. Show / hide does NOT go
// through OBS: the page itself fades in and out (Studio's « Afficher / Masquer »), so the source never needs editing.

export interface ObsLike {
  readonly connected: boolean;
  request(
    requestType: string,
    requestData: object,
  ): Promise<Record<string, unknown>>;
}

export const OVERLAY_INPUT = 'Raptoru · Musique';
export const OVERLAY_SCENE = 'Raptoru · Musique (overlay)';

export interface ObsOverlayStatus {
  connected: boolean;
  /** The browser source exists (by its name). */
  installed: boolean;
  /** Its URL is this Studio's overlay page (with its current token). */
  url_ok: boolean;
  /** The scenes that contain it. */
  scenes: string[];
  program_scene: string | null;
  /** It is in the scene on air. */
  on_program: boolean;
  scene_names: string[];
  canvas: { width: number; height: number } | null;
  error: string | null;
}

const offline = (error: string | null = null): ObsOverlayStatus => ({
  connected: false,
  installed: false,
  url_ok: false,
  scenes: [],
  program_scene: null,
  on_program: false,
  scene_names: [],
  canvas: null,
  error,
});

/** A readable error (French, no ids). */
export class ObsOverlayError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export class MusicOverlayObs {
  constructor(
    private readonly obs: () => ObsLike | null,
    private readonly url: () => string,
  ) {}

  private conn() {
    const o = this.obs();
    if (!o?.connected) throw new ObsOverlayError('obs_offline');
    return o;
  }

  async status(): Promise<ObsOverlayStatus> {
    const o = this.obs();
    if (!o?.connected) return offline();
    try {
      const scenes = (await o.request('GetSceneList', {})) as {
        scenes?: { sceneName: string }[];
        currentProgramSceneName?: string;
      };
      const names = (scenes.scenes ?? []).map((s) => s.sceneName).reverse();
      const inputs =
        (
          (await o.request('GetInputList', {
            inputKind: 'browser_source',
          })) as {
            inputs?: { inputName: string }[];
          }
        ).inputs ?? [];
      const installed = inputs.some((i) => i.inputName === OVERLAY_INPUT);
      let url_ok = false;
      const where: string[] = [];
      if (installed) {
        const s = (await o.request('GetInputSettings', {
          inputName: OVERLAY_INPUT,
        })) as { inputSettings?: { url?: string } };
        url_ok = s.inputSettings?.url === this.url();
        for (const scene of names) {
          const items =
            (
              (await o.request('GetSceneItemList', { sceneName: scene })) as {
                sceneItems?: { sourceName: string }[];
              }
            ).sceneItems ?? [];
          if (items.some((i) => i.sourceName === OVERLAY_INPUT))
            where.push(scene);
        }
      }
      const video = (await o
        .request('GetVideoSettings', {})
        .catch(() => null)) as {
        baseWidth?: number;
        baseHeight?: number;
      } | null;
      const program = scenes.currentProgramSceneName ?? null;
      return {
        connected: true,
        installed,
        url_ok,
        scenes: where,
        program_scene: program,
        on_program: !!program && where.includes(program),
        scene_names: names,
        canvas:
          video?.baseWidth && video.baseHeight
            ? { width: video.baseWidth, height: video.baseHeight }
            : null,
        error: null,
      };
    } catch (e) {
      return { ...offline(readable(e)), connected: o.connected };
    }
  }

  /**
   * The source, in its own isolated scene (created if missing). Already there: nothing created (never a duplicate).
   * The answer is what OBS says afterwards.
   */
  async install() {
    const o = this.conn();
    const before = await this.status();
    if (before.installed) return { created: false, status: before };
    if (!before.scene_names.includes(OVERLAY_SCENE))
      await o
        .request('CreateScene', { sceneName: OVERLAY_SCENE })
        .catch((e) => {
          throw new ObsOverlayError(readable(e));
        });
    const canvas = before.canvas ?? { width: 1920, height: 1080 };
    await o
      .request('CreateInput', {
        sceneName: OVERLAY_SCENE,
        inputName: OVERLAY_INPUT,
        inputKind: 'browser_source',
        inputSettings: {
          url: this.url(),
          width: canvas.width,
          height: canvas.height,
          // The page is transparent and quiet: no custom CSS, kept alive when hidden (no reload, no flash).
          css: '',
          shutdown: false,
          restart_when_active: false,
          reroute_audio: false,
        },
        sceneItemEnabled: true,
      })
      .catch((e) => {
        throw new ObsOverlayError(readable(e));
      });
    const after = await this.status();
    if (!after.installed || !after.url_ok)
      throw new ObsOverlayError('obs_not_confirmed');
    return { created: true, status: after };
  }

  /** Adds the existing source to a scene the streamer chose (confirmed in Studio). Already in it: nothing done. */
  async addTo(scene: string) {
    const o = this.conn();
    const before = await this.status();
    if (!before.installed) throw new ObsOverlayError('not_installed');
    if (!before.scene_names.includes(scene))
      throw new ObsOverlayError('unknown_scene', 404);
    if (before.scenes.includes(scene)) return { added: false, status: before };
    await o
      .request('CreateSceneItem', {
        sceneName: scene,
        sourceName: OVERLAY_INPUT,
        sceneItemEnabled: true,
      })
      .catch((e) => {
        throw new ObsOverlayError(readable(e));
      });
    const after = await this.status();
    if (!after.scenes.includes(scene))
      throw new ObsOverlayError('obs_not_confirmed');
    return { added: true, status: after };
  }

  /** Our own source only: its URL back to this Studio's page (a new token, a moved Studio). */
  async repair() {
    const o = this.conn();
    const before = await this.status();
    if (!before.installed) throw new ObsOverlayError('not_installed');
    await o
      .request('SetInputSettings', {
        inputName: OVERLAY_INPUT,
        inputSettings: { url: this.url() },
        overlay: true,
      })
      .catch((e) => {
        throw new ObsOverlayError(readable(e));
      });
    const after = await this.status();
    if (!after.url_ok) throw new ObsOverlayError('obs_not_confirmed');
    return { status: after };
  }
}

function readable(e: unknown) {
  const err = e as { message?: string; code?: number };
  if (err.message === 'obs_offline') return 'obs_offline';
  if (err.message === 'obs_request_timeout') return 'obs_timeout';
  if (err.code === 601) return 'obs_name_taken';
  if (err.code === 600) return 'obs_not_found';
  return 'obs_refused';
}
