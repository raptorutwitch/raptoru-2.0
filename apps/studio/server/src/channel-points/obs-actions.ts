import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CpAction } from '@raptoru/schemas';
import { MuteHolds } from './mute-holds.js';

// Points de chaîne V1 — the OBS actions Studio may run for a reward (docs/CHANNEL_POINTS_V1.md). An allow-list of
// three typed actions on Studio's ONE OBS connection (the Bonk's LabObs): show / hide a scene's source, enable /
// disable a source's filter, switch the program scene. No other obs-websocket request is reachable from a rule.
// A temporary action (duration) is reverted when it ends ONLY if the item is still in the state the action set (a
// change made meanwhile by the streamer or another action is kept). Pending reverts are saved in Studio's storage: a
// Studio restart reverts what is due when OBS answers again (same check); one older than an hour is dropped.
// Temporary scene (P0.2, Creepy and later interactions): the program goes back to the scene it replaced, only if it is
// still on the temporary scene; a second temporary scene over a temporary one goes back to the first original scene.
// Native interactions also use direct requests here: the program scene name, a media input restart, an instant
// screenshot of a source (in memory: never a file), and a temporary mute of an audio input (BRB, P0.2) — reverted like
// the other temporary actions: unmuted when it ends only if still muted (a manual change is kept; an input muted before
// is left muted), after a Studio restart too. Since Random Ban V3 (27/10) that mute is a HOLD of the shared MuteHolds
// (also Votekick's and the Random Ban's): the voice comes back only when no other effect still holds the input.

export interface ObsLike {
  readonly connected: boolean;
  request(
    requestType: string,
    requestData: object,
  ): Promise<Record<string, unknown>>;
}

type Target =
  | { kind: 'source'; scene: string; source: string }
  | { kind: 'filter'; source: string; filter: string }
  | { kind: 'mute'; input: string };
/** A temporary scene: `scene` shown until `at`, then back to `back` if the program is still on `scene`. */
type SceneRevert = { kind: 'scene'; scene: string; back: string; at: number };
type Revert =
  (Target & { set: boolean; restore: boolean; at: number }) | SceneRevert;

const STALE_MS = 60 * 60_000;
const key = (t: Target) =>
  t.kind === 'source'
    ? `source|${t.scene}|${t.source}`
    : t.kind === 'mute'
      ? `mute|${t.input}`
      : `filter|${t.source}|${t.filter}`;

/** A readable failure for the history (French, no ids). */
export class ObsActionError extends Error {}

function readable(e: unknown, what: string): ObsActionError {
  const err = e as { message?: string; code?: number };
  if (err.message === 'obs_offline')
    return new ObsActionError('OBS non connecté');
  if (err.message === 'obs_request_timeout')
    return new ObsActionError('OBS ne répond pas');
  if (err.code === 600)
    return new ObsActionError(`${what} introuvable dans OBS`);
  return new ObsActionError(`OBS a refusé l'action (${what})`);
}

export class ObsActions {
  private reverts: Revert[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  private constructor(
    private readonly file: string,
    private readonly obs: () => ObsLike | null,
    private readonly now: () => number,
    /** Who keeps an audio input muted (shared with Votekick and the Random Ban). */
    readonly holds: MuteHolds,
  ) {}

  static async open(
    file: string,
    obs: () => ObsLike | null,
    now: () => number = Date.now,
  ) {
    const holds = await MuteHolds.open(
      file.replace(/\.json$/, '') + '-mute-holds.json',
      obs,
      now,
    );
    const a = new ObsActions(file, obs, now, holds);
    try {
      const saved = JSON.parse(await readFile(file, 'utf8')) as Revert[];
      if (Array.isArray(saved)) a.reverts = saved;
    } catch {
      /* none pending */
    }
    return a;
  }

  /** Checks due reverts every 250 ms (only work when one is due). */
  start() {
    this.timer ??= setInterval(() => void this.tick(), 250);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  get pending() {
    return this.reverts.length + this.holds.pending;
  }

  private connected() {
    const obs = this.obs();
    if (!obs?.connected) throw new ObsActionError('OBS non connecté');
    return obs;
  }

  private saving: Promise<void> = Promise.resolve();

  /**
   * One write at a time (each writes the reverts as they are at its turn): two changes at the same instant (BRB mutes
   * « Micro » and « Musique Isolée » together) both renamed the same .tmp — the second rename found nothing and that
   * mute was reported failed although OBS had done it.
   */
  private save() {
    const write = this.saving.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(this.reverts));
      await rename(`${this.file}.tmp`, this.file);
    });
    this.saving = write.catch(() => {});
    return write;
  }

  /** The program scene now (native interactions: start conditions). */
  async currentScene() {
    const r = await this.connected()
      .request('GetCurrentProgramScene', {})
      .catch((e) => {
        throw readable(e, 'la scène en cours');
      });
    return String(r.currentProgramSceneName ?? r.sceneName ?? '');
  }

  /** Whether a source's filter is enabled now (native interactions: FX Cam). */
  async filterEnabled(source: string, filter: string) {
    return this.read(this.connected(), { kind: 'filter', source, filter });
  }

  /** A filter's state and settings now (Couleur Cam: the start of its transition). */
  async filter(source: string, filter: string) {
    const r = await this.connected()
      .request('GetSourceFilter', { sourceName: source, filterName: filter })
      .catch((e) => {
        throw readable(e, `le filtre « ${filter} » de « ${source} »`);
      });
    return {
      enabled: r.filterEnabled === true,
      settings: (r.filterSettings ?? {}) as Record<string, unknown>,
    };
  }

  /** Sets some settings of a filter, the others kept (Couleur Cam: one step of its transition). */
  async setFilterSettings(
    source: string,
    filter: string,
    settings: Record<string, number>,
  ) {
    await this.connected()
      .request('SetSourceFilterSettings', {
        sourceName: source,
        filterName: filter,
        filterSettings: settings,
        overlay: true,
      })
      .catch((e) => {
        throw readable(e, `le filtre « ${filter} » de « ${source} »`);
      });
  }

  /** Restarts a media input from its beginning (native interactions). */
  async restartMedia(input: string) {
    await this.connected()
      .request('TriggerMediaInputAction', {
        inputName: input,
        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART',
      })
      .catch((e) => {
        throw readable(e, `le média « ${input} »`);
      });
  }

  /**
   * An instant screenshot of a source (or scene) at its full resolution, PNG, kept in memory by the caller. Taken when
   * asked (no background capture).
   */
  async screenshot(source: string): Promise<Buffer> {
    const r = await this.connected()
      .request('GetSourceScreenshot', {
        sourceName: source,
        imageFormat: 'png',
      })
      .catch((e) => {
        throw readable(e, `la source « ${source} »`);
      });
    const m = /^data:image\/png;base64,(.+)$/s.exec(String(r.imageData ?? ''));
    if (!m) throw new ObsActionError(`capture de « ${source} » vide`);
    return Buffer.from(m[1]!, 'base64');
  }

  /** Mutes an audio input for `ms` (temporary, see the header): a hold of the shared MuteHolds. */
  async temporaryMute(input: string, ms: number) {
    this.connected();
    await this.holds.hold(input, `cp:${input}`, this.now() + ms).catch((e) => {
      throw readable(e, `l'entrée audio « ${input} »`);
    });
  }

  /** Ends a temporary mute now (an interaction that failed after muting): the hold released. */
  async endMute(input: string) {
    await this.holds.release(input, `cp:${input}`);
    // A mute revert saved by an older Studio (before the holds): restored with the usual check.
    const r = this.reverts.find((x) => x.kind === 'mute' && x.input === input);
    if (!r) return;
    r.at = Math.min(r.at, this.now());
    await this.tick();
  }

  /** A temporary scene: switched now, back to the replaced scene after `ms` (see the header). */
  private async temporaryScene(obs: ObsLike, scene: string, ms: number) {
    const before = await this.currentScene();
    await obs
      .request('SetCurrentProgramScene', { sceneName: scene })
      .catch((e) => {
        throw readable(e, `la scène « ${scene} »`);
      });
    if (before === scene) {
      // Already on it: a pending temporary of this scene lasts longer, nothing else to restore.
      const same = this.reverts.find(
        (r): r is SceneRevert => r.kind === 'scene' && r.scene === scene,
      );
      if (same) same.at = Math.max(same.at, this.now() + ms);
      await this.save();
      return;
    }
    // Over another temporary scene: back to that one's original scene, at the later end (never stuck on a temporary).
    const under = this.reverts.find(
      (r): r is SceneRevert => r.kind === 'scene' && r.scene === before,
    );
    const at = Math.max(this.now() + ms, under?.at ?? 0);
    this.reverts = this.reverts.filter((r) => r !== under);
    this.reverts.push({
      kind: 'scene',
      scene,
      back: under?.back ?? before,
      at,
    });
    await this.save();
  }

  private async itemId(obs: ObsLike, scene: string, source: string) {
    try {
      const r = await obs.request('GetSceneItemId', {
        sceneName: scene,
        sourceName: source,
      });
      return Number(r.sceneItemId);
    } catch (e) {
      throw readable(e, `la source « ${source} » de la scène « ${scene} »`);
    }
  }

  private async read(obs: ObsLike, t: Target): Promise<boolean> {
    if (t.kind === 'mute') {
      const r = await obs
        .request('GetInputMute', { inputName: t.input })
        .catch((e) => {
          throw readable(e, `l'entrée audio « ${t.input} »`);
        });
      return r.inputMuted === true;
    }
    if (t.kind === 'source') {
      const id = await this.itemId(obs, t.scene, t.source);
      const r = await obs
        .request('GetSceneItemEnabled', { sceneName: t.scene, sceneItemId: id })
        .catch((e) => {
          throw readable(e, `la source « ${t.source} »`);
        });
      return r.sceneItemEnabled === true;
    }
    const r = await obs
      .request('GetSourceFilter', {
        sourceName: t.source,
        filterName: t.filter,
      })
      .catch((e) => {
        throw readable(e, `le filtre « ${t.filter} » de « ${t.source} »`);
      });
    return r.filterEnabled === true;
  }

  private async write(obs: ObsLike, t: Target, value: boolean) {
    if (t.kind === 'mute') {
      await obs
        .request('SetInputMute', { inputName: t.input, inputMuted: value })
        .catch((e) => {
          throw readable(e, `l'entrée audio « ${t.input} »`);
        });
      return;
    }
    if (t.kind === 'source') {
      const id = await this.itemId(obs, t.scene, t.source);
      await obs
        .request('SetSceneItemEnabled', {
          sceneName: t.scene,
          sceneItemId: id,
          sceneItemEnabled: value,
        })
        .catch((e) => {
          throw readable(e, `la source « ${t.source} »`);
        });
      return;
    }
    await obs
      .request('SetSourceFilterEnabled', {
        sourceName: t.source,
        filterName: t.filter,
        filterEnabled: value,
      })
      .catch((e) => {
        throw readable(e, `le filtre « ${t.filter} » de « ${t.source} »`);
      });
  }

  /** Runs one OBS action of a rule (sounds: Core's / the effects player). Throws ObsActionError with a readable reason. */
  async run(action: CpAction) {
    if (
      action.type === 'sound' ||
      action.type === 'effect_sound' ||
      action.type === 'effect_video'
    )
      throw new ObsActionError('action non OBS');
    if (action.type === 'interaction' || action.type === 'credits')
      throw new ObsActionError('action non OBS');
    const obs = this.connected();
    if (action.type === 'obs_scene' && action.duration_ms)
      return this.temporaryScene(obs, action.scene, action.duration_ms);
    if (action.type === 'obs_scene') {
      await obs
        .request('SetCurrentProgramScene', { sceneName: action.scene })
        .catch((e) => {
          throw readable(e, `la scène « ${action.scene} »`);
        });
      return;
    }
    const target: Target =
      action.type === 'obs_source'
        ? { kind: 'source', scene: action.scene, source: action.source }
        : { kind: 'filter', source: action.source, filter: action.filter };
    const value =
      action.type === 'obs_source' ? action.visible : action.enabled;
    await this.setFor(obs, target, value, action.duration_ms);
  }

  /** Sets a target; with a duration, records its conditional revert (one per target and value, the later end wins). */
  private async setFor(
    obs: ObsLike,
    target: Target,
    value: boolean,
    duration?: number,
  ) {
    const before = duration ? await this.read(obs, target) : null;
    await this.write(obs, target, value);
    if (!duration) return;
    const at = this.now() + duration;
    const same = this.reverts.find(
      (r) => r.kind !== 'scene' && key(r) === key(target) && r.set === value,
    );
    if (same)
      same.at = Math.max(same.at, at); // a second redemption while the first one lasts: one revert, later
    else if (before !== value)
      this.reverts.push({ ...target, set: value, restore: before!, at });
    await this.save();
  }

  /** Reverts what is due, only where nothing changed meanwhile. OBS absent: kept for later (until stale). */
  async tick() {
    await this.holds.tick();
    if (this.busy || !this.reverts.some((r) => r.at <= this.now())) return;
    this.busy = true;
    try {
      const obs = this.obs();
      const done = new Set<Revert>();
      for (const r of [...this.reverts]) {
        if (r.at > this.now()) continue;
        if (!obs?.connected) {
          if (this.now() - r.at >= STALE_MS) done.add(r);
          continue;
        }
        done.add(r);
        try {
          if (r.kind === 'scene') {
            if ((await this.currentScene()) === r.scene)
              await obs.request('SetCurrentProgramScene', {
                sceneName: r.back,
              });
          } else if ((await this.read(obs, r)) === r.set)
            await this.write(obs, r, r.restore);
        } catch {
          /* item gone or OBS refused: nothing to restore */
        }
      }
      // Only what was handled leaves: a revert added meanwhile (an action run during this tick) is kept.
      this.reverts = this.reverts.filter((r) => !done.has(r));
      await this.save();
    } finally {
      this.busy = false;
    }
  }

  /** Read-only lists for the rule editor (scenes, a scene's sources, a source's filters). */
  async lists(scene?: string, source?: string) {
    const obs = this.connected();
    const scenes = (
      ((await obs.request('GetSceneList', {})).scenes ?? []) as {
        sceneName: string;
      }[]
    )
      .map((s) => s.sceneName)
      .reverse();
    const list = async (type: string, data: object, field: string) => {
      const r = await obs
        .request(type, data)
        .catch((): Record<string, unknown> => ({}));
      return (r[field] ?? []) as Record<string, unknown>[];
    };
    const sources = scene
      ? (
          await list('GetSceneItemList', { sceneName: scene }, 'sceneItems')
        ).map((i) => String(i.sourceName))
      : [];
    const filters = source
      ? (
          await list('GetSourceFilterList', { sourceName: source }, 'filters')
        ).map((f) => String(f.filterName))
      : [];
    return { scenes, sources, filters };
  }
}
