import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ObsLike } from './obs-actions.js';

// Who keeps an audio input muted (Random Ban V3, 27/10). Several effects mute « Micro » — a Votekick mute, BRB, the
// Random Ban streamer mute — and each one used to restore the mic by itself: BRB ending during a Votekick mute gave the
// voice back in the middle of the sanction, and the Votekick mute (which had seen the mic already muted) then left it
// muted for good. Here every effect HOLDS the input under its own name, until a time:
// - the first hold remembers whether the input was muted before (by the streamer or anything else) and mutes it;
// - a hold released (or past its time) gives the voice back ONLY when it was the last one, the input was live before
//   the first hold, and it is still muted (a manual change made meanwhile is kept);
// - saved on disk: a Studio restart releases what is due when OBS answers again; OBS absent at the end → retried.

interface InputHolds {
  /** The input was muted before the first hold: never unmuted by a release. */
  before: boolean;
  /** owner → until (ms). Empty: only the unmute is left to do (OBS was absent). */
  holds: Record<string, number>;
}

export class MuteHolds {
  private inputs: Record<string, InputHolds> = {};
  private busy: Promise<unknown> = Promise.resolve();

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
    const h = new MuteHolds(file, obs, now);
    try {
      const saved = JSON.parse(await readFile(file, 'utf8')) as Record<
        string,
        InputHolds
      >;
      if (saved && typeof saved === 'object') h.inputs = saved;
    } catch {
      /* nothing held */
    }
    return h;
  }

  /** Holds still running and unmutes still owed (all inputs). */
  get pending() {
    return Object.values(this.inputs).reduce(
      (n, e) => n + Math.max(1, Object.keys(e.holds).length),
      0,
    );
  }

  /** The owners holding `input` now (expired ones included until the next tick). */
  holders(input: string) {
    return Object.keys(this.inputs[input]?.holds ?? {});
  }

  /** One change at a time: two effects starting together never both read « live » then both decide. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => {});
    return run;
  }

  /**
   * Mutes `input` for `owner` until `until` (the same owner again: the later end wins). Throws when OBS is absent or
   * refuses (nothing recorded: the caller's effect failed).
   */
  hold(input: string, owner: string, until: number) {
    return this.serial(async () => {
      const obs = this.connected();
      const entry = this.inputs[input];
      if (!entry || !Object.keys(entry.holds).length) {
        // First hold (or a pending unmute OBS never got): the state before is the input's state now, unless an unmute
        // was still owed (then it was live before).
        const before = entry ? entry.before : await this.muted(obs, input);
        this.inputs[input] = { before, holds: { [owner]: until } };
      } else entry.holds[owner] = Math.max(entry.holds[owner] ?? 0, until);
      await this.save(); // before the change: a crash from here is released at the next start
      try {
        await this.setMuted(obs, input, true);
      } catch (e) {
        await this.drop(input, owner);
        throw e;
      }
    });
  }

  /** Ends `owner`'s hold on `input` now (its effect ended or failed). Unknown owner: nothing. */
  release(input: string, owner: string) {
    return this.serial(() => this.drop(input, owner));
  }

  /** Releases the holds past their time and retries the unmutes OBS missed (every 250 ms from ObsActions). */
  tick() {
    return this.serial(async () => {
      const now = this.now();
      for (const [input, entry] of Object.entries(this.inputs)) {
        const due = Object.entries(entry.holds).filter(([, t]) => t <= now);
        if (!due.length && Object.keys(entry.holds).length) continue;
        for (const [owner] of due) delete entry.holds[owner];
        await this.settle(input);
      }
    });
  }

  private async drop(input: string, owner: string) {
    const entry = this.inputs[input];
    if (!entry || !(owner in entry.holds)) return;
    delete entry.holds[owner];
    await this.settle(input);
  }

  /** No hold left: the voice comes back if it was live before and is still muted; OBS absent → kept for tick(). */
  private async settle(input: string) {
    const entry = this.inputs[input]!;
    if (Object.keys(entry.holds).length) return this.save();
    const obs = this.obs();
    if (!entry.before) {
      if (!obs?.connected) return this.save();
      try {
        if (await this.muted(obs, input)) {
          await this.setMuted(obs, input, false);
          if (await this.muted(obs, input))
            await this.setMuted(obs, input, false);
        }
      } catch {
        return this.save(); // OBS refused mid-way: retried by tick()
      }
    }
    delete this.inputs[input];
    await this.save();
  }

  private connected() {
    const obs = this.obs();
    if (!obs?.connected) throw new Error('obs_offline');
    return obs;
  }

  private async muted(obs: ObsLike, input: string) {
    const r = await obs.request('GetInputMute', { inputName: input });
    return r.inputMuted === true;
  }

  private async setMuted(obs: ObsLike, input: string, muted: boolean) {
    await obs.request('SetInputMute', { inputName: input, inputMuted: muted });
  }

  private saving: Promise<void> = Promise.resolve();
  private save() {
    const write = this.saving.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(this.inputs));
      await rename(`${this.file}.tmp`, this.file);
    });
    this.saving = write.catch(() => {});
    return write;
  }
}
