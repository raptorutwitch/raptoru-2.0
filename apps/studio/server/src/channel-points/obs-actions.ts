import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CpAction } from '@raptoru/schemas';

// Points de chaîne V1 — the OBS actions Studio may run for a reward (docs/CHANNEL_POINTS_V1.md). An allow-list of
// three typed actions on Studio's ONE OBS connection (the Bonk's LabObs): show / hide a scene's source, enable /
// disable a source's filter, switch the program scene. No other obs-websocket request is reachable from a rule.
// A temporary action (duration) is reverted when it ends ONLY if the item is still in the state the action set (a
// change made meanwhile by the streamer or another action is kept). Pending reverts are saved in Studio's storage: a
// Studio restart reverts what is due when OBS answers again (same check); one older than an hour is dropped.

export interface ObsLike {
  readonly connected: boolean;
  request(
    requestType: string,
    requestData: object,
  ): Promise<Record<string, unknown>>;
}

type Target =
  | { kind: 'source'; scene: string; source: string }
  | { kind: 'filter'; source: string; filter: string };
type Revert = Target & { set: boolean; restore: boolean; at: number };

const STALE_MS = 60 * 60_000;
const key = (t: Target) =>
  t.kind === 'source'
    ? `source|${t.scene}|${t.source}`
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
  ) {}

  static async open(
    file: string,
    obs: () => ObsLike | null,
    now: () => number = Date.now,
  ) {
    const a = new ObsActions(file, obs, now);
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
    return this.reverts.length;
  }

  private connected() {
    const obs = this.obs();
    if (!obs?.connected) throw new ObsActionError('OBS non connecté');
    return obs;
  }

  private async save() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.reverts));
    await rename(`${this.file}.tmp`, this.file);
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

  /** Runs one OBS action of a rule (sound actions are Core's). Throws ObsActionError with a readable reason. */
  async run(action: CpAction) {
    const obs = this.connected();
    if (action.type === 'sound') throw new ObsActionError('action non OBS');
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
    const before = action.duration_ms ? await this.read(obs, target) : null;
    await this.write(obs, target, value);
    if (!action.duration_ms) return;
    const at = this.now() + action.duration_ms;
    const same = this.reverts.find(
      (r) => key(r) === key(target) && r.set === value,
    );
    if (same)
      same.at = Math.max(same.at, at); // a second redemption while the first one lasts: one revert, later
    else if (before !== value)
      this.reverts.push({ ...target, set: value, restore: before!, at });
    await this.save();
  }

  /** Reverts what is due, only where nothing changed meanwhile. OBS absent: kept for later (until stale). */
  async tick() {
    if (this.busy || !this.reverts.some((r) => r.at <= this.now())) return;
    this.busy = true;
    try {
      const obs = this.obs();
      const keep: Revert[] = [];
      for (const r of this.reverts) {
        if (r.at > this.now()) {
          keep.push(r);
          continue;
        }
        if (!obs?.connected) {
          if (this.now() - r.at < STALE_MS) keep.push(r);
          continue;
        }
        try {
          if ((await this.read(obs, r)) === r.set)
            await this.write(obs, r, r.restore);
        } catch {
          /* item gone or OBS refused: nothing to restore */
        }
      }
      this.reverts = keep;
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
