import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ObsLike } from '../channel-points/obs-actions.js';

// Votekick V2 — the broadcaster's mute in OBS (docs/VOTEKICK_V2.md § Mute). Replaces SAMMI's VK_MUTE_BROADCASTER /
// CAUTION_FINISH sequences, whose restore made the MUTED effect react after the unmute:
// - SAMMI unmuted the mic FIRST, then cut the audio drive, reset the zoom and hid the band: the voice was back while
//   the camera still reacted to it and the band was still on screen;
// - the band's end was the shader's clock (mute_duration) while the mic's end was SAMMI's 1 s loop (it drifts): never
//   together; a caution cut the band without its exit;
// - nothing restored OBS when SAMMI restarted or its loop was cut: drive, zoom and band stayed on.
// Here, ONE deterministic sequence per mute, keyed by the mute id (a late or repeated order of an old mute does
// nothing):
//   start: snapshot of the 4 items it owns → saved to disk → mic muted first (no voice leaks) → zoom reset → zoom,
//          band (mute_duration = the mute) and drive enabled;
//   end:   drive cut → zoom reset (read back: a late write of the drive is reset again) and disabled → the band's exit
//          played now (mute_duration = elapsed + exit) then disabled → the mic unmuted LAST → each item back to its
//          snapshot, read back, retried once.
// Only the 4 items it owns are touched (the mic input, the drive filter, the zoom filter, the band filter); a mic
// that was muted before the vote stays muted. A watchdog ends a mute Core never ended (Core down); a Studio restart
// ends a due mute when OBS answers again. OBS absent at the end: retried until it answers.

export interface MuteFxConfig {
  /** The audio input muted. SAMMI: « Micro (Obsolète) » — hidden in every scene in the 22/10 collection: to check. */
  micInput: string;
  /** The source carrying the zoom and band filters (SAMMI: « overlay cam shushu »). */
  camSource: string;
  zoomFilter: string;
  bandFilter: string;
  /** The Move « Audio Move » filter writing the zoom from the voice, and the audio input it sits on. */
  driveInput: string;
  driveFilter: string;
}

/** The names SAMMI drives today (decks_data.json, OBS collection of 22/10/2026). */
export const SAMMI_MUTE_FX: MuteFxConfig = {
  micInput: 'Micro (Obsolète)',
  camSource: 'overlay cam shushu',
  zoomFilter: 'Votekick Zoom',
  bandFilter: 'Votekick Mute',
  driveInput: 'Micro (Obsolète)',
  driveFilter: 'Votekick Zoom Drive',
};

/** The band's exit when its filter does not say (the shader's default anim_out_time). */
const DEFAULT_EXIT_MS = 450;
/** Core ends the mute on time; this ends it alone if Core never does. */
export const MUTE_WATCHDOG_MS = 5_000;

interface Snapshot {
  micMuted: boolean;
  driveEnabled: boolean;
  zoomEnabled: boolean;
  zoom: number;
  bandEnabled: boolean;
  bandDuration: number;
}

interface Active {
  id: string;
  startedAt: number;
  endsAt: number;
  /** When the band filter was enabled (its shader clock starts there). */
  bandAt: number;
  snapshot: Snapshot;
  /** Set once the end is decided (the restore may wait for OBS). */
  ending: 'expired' | 'caution' | 'watchdog' | null;
}

export interface MuteReport {
  id: string;
  ok: boolean;
  /** Items not back to their snapshot after one retry. */
  mismatches: string[];
}

export class MuteController {
  private active: Active | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy: Promise<unknown> = Promise.resolve();
  readonly reports: MuteReport[] = [];

  private constructor(
    private readonly file: string,
    private readonly obs: () => ObsLike | null,
    private readonly cfg: MuteFxConfig,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  static async open(
    file: string,
    obs: () => ObsLike | null,
    cfg: MuteFxConfig = SAMMI_MUTE_FX,
    now: () => number = Date.now,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {
    const c = new MuteController(file, obs, cfg, now, sleep);
    try {
      const saved = JSON.parse(await readFile(file, 'utf8')) as Active;
      if (saved?.id && saved.snapshot) c.active = saved;
    } catch {
      /* no mute in progress */
    }
    return c;
  }

  get current() {
    return this.active && { id: this.active.id, endsAt: this.active.endsAt };
  }

  /** Checks the watchdog / a pending restore every 250 ms. */
  start() {
    this.timer ??= setInterval(() => void this.tick(), 250);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One at a time: a start and an end never interleave their OBS requests. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => {});
    return run;
  }

  /** Mutes for `seconds` (idempotent per id; a second mute while one runs only moves its end). */
  muteStart(id: string, seconds: number) {
    return this.serial(async () => {
      const obs = this.connected();
      const now = this.now();
      if (this.active && !this.active.ending) {
        if (this.active.id !== id) {
          this.active.endsAt = Math.max(
            this.active.endsAt,
            now + seconds * 1000,
          );
          await this.setBand(obs, {
            mute_duration: (this.active.endsAt - this.active.bandAt) / 1000,
          });
          await this.save();
        }
        return;
      }
      if (this.active) return; // an end is still being restored: never stacked over it
      const snapshot = await this.snapshot(obs);
      this.active = {
        id,
        startedAt: now,
        endsAt: now + seconds * 1000,
        bandAt: now,
        snapshot,
        ending: null,
      };
      await this.save(); // before any change: a crash from here is restored at the next start
      await this.setMic(obs, true);
      await this.setZoom(obs, 1);
      await this.setFilter(obs, this.cfg.camSource, this.cfg.zoomFilter, true);
      await this.setBand(obs, { mute_duration: seconds, manual_time: -1 });
      await this.setFilter(obs, this.cfg.camSource, this.cfg.bandFilter, true);
      this.active.bandAt = this.now();
      await this.setFilter(
        obs,
        this.cfg.driveInput,
        this.cfg.driveFilter,
        true,
      );
      await this.save();
    });
  }

  /** Ends the mute `id` now (Core: expired or caution). An old or unknown id does nothing. */
  muteEnd(id: string, reason: 'expired' | 'caution') {
    return this.serial(async () => {
      if (!this.active || this.active.id !== id) return null;
      this.active.ending ??= reason;
      await this.save();
      return this.restore();
    });
  }

  /** Watchdog and pending restores (OBS was absent). */
  tick() {
    return this.serial(async () => {
      const a = this.active;
      if (!a) return null;
      if (!a.ending && this.now() < a.endsAt + MUTE_WATCHDOG_MS) return null;
      a.ending ??= 'watchdog';
      return this.restore();
    });
  }

  private async restore(): Promise<MuteReport | null> {
    const a = this.active!;
    const obs = this.obs();
    if (!obs?.connected) return null; // kept: retried by tick() when OBS answers
    const s = a.snapshot;
    try {
      // 1. The drive stops writing the zoom; 2. zoom back to rest, read back (a late write is reset again), disabled.
      await this.setFilter(
        obs,
        this.cfg.driveInput,
        this.cfg.driveFilter,
        false,
      );
      await this.setZoom(obs, 1);
      if ((await this.zoomValue(obs)) !== 1) await this.setZoom(obs, 1);
      await this.setFilter(obs, this.cfg.camSource, this.cfg.zoomFilter, false);
      // 3. The band plays its exit now (its shader clock started at bandAt), then is disabled.
      const band = await this.filter(
        obs,
        this.cfg.camSource,
        this.cfg.bandFilter,
      );
      if (band.enabled) {
        const exitMs =
          Number(band.settings.anim_out_time) > 0
            ? Number(band.settings.anim_out_time) * 1000
            : DEFAULT_EXIT_MS;
        const elapsedS = (this.now() - a.bandAt) / 1000;
        await this.setBand(obs, {
          mute_duration: Math.max(0.01, elapsedS + exitMs / 1000),
        });
        await this.sleep(exitMs + 50);
        await this.setFilter(
          obs,
          this.cfg.camSource,
          this.cfg.bandFilter,
          false,
        );
      }
      // 4. The voice comes back last, only if it was live before the vote.
      if (!s.micMuted) await this.setMic(obs, false);
      // 5. Each item to its snapshot, read back, retried once.
      const mismatches = await this.verify(obs, s, true);
      const report = { id: a.id, ok: mismatches.length === 0, mismatches };
      this.reports.unshift(report);
      this.reports.length = Math.min(this.reports.length, 20);
      this.active = null;
      await rm(this.file, { force: true });
      return report;
    } catch {
      return null; // OBS refused or left mid-way: the whole restore is replayed by tick() (every step is idempotent)
    }
  }

  private async verify(
    obs: ObsLike,
    s: Snapshot,
    retry: boolean,
  ): Promise<string[]> {
    const now = await this.snapshot(obs);
    const wrong: string[] = [];
    if (now.driveEnabled !== s.driveEnabled) wrong.push('drive');
    if (now.zoomEnabled !== s.zoomEnabled) wrong.push('zoom');
    if (now.zoom !== s.zoom) wrong.push('zoom_value');
    if (now.bandEnabled !== s.bandEnabled) wrong.push('band');
    if (now.micMuted !== s.micMuted) wrong.push('mic');
    if (!wrong.length || !retry) return wrong;
    await this.setFilter(
      obs,
      this.cfg.driveInput,
      this.cfg.driveFilter,
      s.driveEnabled,
    );
    await this.setZoom(obs, s.zoom);
    await this.setFilter(
      obs,
      this.cfg.camSource,
      this.cfg.zoomFilter,
      s.zoomEnabled,
    );
    await this.setFilter(
      obs,
      this.cfg.camSource,
      this.cfg.bandFilter,
      s.bandEnabled,
    );
    await this.setBand(obs, { mute_duration: s.bandDuration });
    await this.setMic(obs, s.micMuted);
    return this.verify(obs, s, false);
  }

  // --- OBS (the only requests this module sends) ------------------------------------------------------------------

  private connected() {
    const obs = this.obs();
    if (!obs?.connected) throw new Error('obs_offline');
    return obs;
  }

  private async snapshot(obs: ObsLike): Promise<Snapshot> {
    const mic = await obs.request('GetInputMute', {
      inputName: this.cfg.micInput,
    });
    const drive = await this.filter(
      obs,
      this.cfg.driveInput,
      this.cfg.driveFilter,
    );
    const zoom = await this.filter(
      obs,
      this.cfg.camSource,
      this.cfg.zoomFilter,
    );
    const band = await this.filter(
      obs,
      this.cfg.camSource,
      this.cfg.bandFilter,
    );
    return {
      micMuted: mic.inputMuted === true,
      driveEnabled: drive.enabled,
      zoomEnabled: zoom.enabled,
      zoom: Number(zoom.settings.zoom ?? 1),
      bandEnabled: band.enabled,
      bandDuration: Number(band.settings.mute_duration ?? 0),
    };
  }

  private async filter(obs: ObsLike, source: string, filter: string) {
    const r = await obs.request('GetSourceFilter', {
      sourceName: source,
      filterName: filter,
    });
    return {
      enabled: r.filterEnabled === true,
      settings: (r.filterSettings ?? {}) as Record<string, unknown>,
    };
  }

  private async zoomValue(obs: ObsLike) {
    return Number(
      (await this.filter(obs, this.cfg.camSource, this.cfg.zoomFilter)).settings
        .zoom ?? 1,
    );
  }

  private setFilter(obs: ObsLike, source: string, filter: string, on: boolean) {
    return obs.request('SetSourceFilterEnabled', {
      sourceName: source,
      filterName: filter,
      filterEnabled: on,
    });
  }

  private setZoom(obs: ObsLike, zoom: number) {
    return obs.request('SetSourceFilterSettings', {
      sourceName: this.cfg.camSource,
      filterName: this.cfg.zoomFilter,
      filterSettings: { zoom },
      overlay: true,
    });
  }

  private setBand(obs: ObsLike, settings: Record<string, number>) {
    return obs.request('SetSourceFilterSettings', {
      sourceName: this.cfg.camSource,
      filterName: this.cfg.bandFilter,
      filterSettings: settings,
      overlay: true,
    });
  }

  private setMic(obs: ObsLike, muted: boolean) {
    return obs.request('SetInputMute', {
      inputName: this.cfg.micInput,
      inputMuted: muted,
    });
  }

  private async save() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.active));
    await rename(`${this.file}.tmp`, this.file);
  }
}
