import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MuteHolds } from '../channel-points/mute-holds.js';
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
//          band and drive enabled (the drive's own settings are never written). The band's mute_duration is 0
//          (« unlimited » for its shader): ONE clock, Studio's — with the mute's length the shader faded the band
//          out by itself before Core's end reached Studio (0.3–1.2 s of zoom without band, 24/10);
//   end:   drive cut → zoom reset (read back: a late write of the drive is reset again) → zoom AND band disabled
//          together (no animation left on screen) → the band's saved mute_duration back → the mic unmuted LAST →
//          read back, retried once.
// After a mute the effect is always at REST — drive, zoom and band disabled, zoom 1 — whatever it was before (decided
// 24/10: a drive left enabled after a test must not keep moving the camera); the mic gets back its own state (muted
// before the vote: stays muted). Only these 4 items are touched. A watchdog ends a mute Core never ended (Core down);
// a Studio restart ends a due mute when OBS answers again. OBS absent at the end: retried until it answers.
// The mic itself is a HOLD of the shared MuteHolds (Random Ban V3, 27/10): its end gives the voice back only when no
// other effect (BRB, the Random Ban streamer mute) still holds it — and never when it was muted before.
// Several OWNERS (27/10): the Random Ban streamer mute plays the same scene (zoom, MUTED band, drive, mic). Each mute
// is recorded under its id with its own end; a second one while the scene runs joins it (no new snapshot); one ending
// releases only its mic hold — the scene is restored when the LAST owner ends (or its watchdog).

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

/**
 * Raptoru's OBS names (decided 23/10: the live mic is « Micro », never « Micro (Obsolète) »; the active collection
 * « Twitch Dofus » carries « Votekick Zoom Drive » on « Micro »). Used by Studio.
 */
export const RAPTORU_MUTE_FX: MuteFxConfig = {
  micInput: 'Micro',
  camSource: 'overlay cam shushu',
  zoomFilter: 'Votekick Zoom',
  bandFilter: 'Votekick Mute',
  driveInput: 'Micro',
  driveFilter: 'Votekick Zoom Drive',
};

/** Core ends the mute on time; this ends it alone if Core never does. */
export const MUTE_WATCHDOG_MS = 5_000;
/** The mic's hold outlives the watchdog a little: released by the restore, this is only the last safety. */
const MIC_HOLD_MARGIN_MS = 60_000;
/**
 * The zoom at rest, written as a DECIMAL. obs-websocket stores a JSON integer (`1`) as an OBS integer, and Audio Move
 * then writes `(long long)(base + factor × level)` = 1 forever (Move 3.x, OBS_DATA_NUM_INT): the zoom froze (live of
 * 23/10, tests A/B of 24/10). JavaScript serialises 1 and 1.0 as `1`, so the rest value is 1.000001 (invisible).
 */
export const REST_ZOOM = 1.000001;
/** A zoom read back is « at rest » within this margin (OBS returns the double it stored). */
const ZOOM_TOLERANCE = 0.001;

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
  /** The mutes sharing the scene: id → its end (ms). Absent (saved by an older Studio): only `id`, until `endsAt`. */
  owners?: Record<string, number>;
}

const ownersOf = (a: Active) => (a.owners ??= { [a.id]: a.endsAt });

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
    private readonly holds: MuteHolds,
  ) {}

  static async open(
    file: string,
    obs: () => ObsLike | null,
    cfg: MuteFxConfig = SAMMI_MUTE_FX,
    now: () => number = Date.now,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    /** Studio's shared holds (ObsActions.holds); absent: this controller's own. */
    holds?: MuteHolds,
  ) {
    const c = new MuteController(
      file,
      obs,
      cfg,
      now,
      sleep,
      holds ??
        (await MuteHolds.open(
          file.replace(/\.json$/, '') + '-mic-holds.json',
          obs,
          now,
        )),
    );
    try {
      const saved = JSON.parse(await readFile(file, 'utf8')) as Active;
      if (saved?.id && saved.snapshot) c.active = saved;
    } catch {
      /* no mute in progress */
    }
    return c;
  }

  /** The mic hold's name: a Random Ban mute keeps its own (`random_ban:<request>`), a Votekick one `votekick:<id>`. */
  private owner(id: string) {
    return id.startsWith('random_ban:') ? id : `votekick:${id}`;
  }

  get current() {
    return this.active && { id: this.active.id, endsAt: this.active.endsAt };
  }

  /** Whether the mute `id` is one of the scene's owners (still running, or being restored). */
  has(id: string) {
    return !!this.active && id in ownersOf(this.active);
  }

  /** The ids of the mutes sharing the scene now. */
  owners() {
    return this.active ? Object.keys(ownersOf(this.active)) : [];
  }

  /** One owner leaves while others remain: its mic hold released, the scene's end follows the others. */
  private async leave(a: Active, id: string) {
    const owners = ownersOf(a);
    delete owners[id];
    if (this.holds.holders(this.cfg.micInput).includes(this.owner(id)))
      await this.holds.release(this.cfg.micInput, this.owner(id));
    a.endsAt = Math.max(...Object.values(owners));
    if (a.id === id) a.id = Object.keys(owners)[0]!;
    await this.save();
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

  /** Mutes for `seconds` (idempotent per id; a second mute while one runs joins the scene as another owner). */
  muteStart(id: string, seconds: number) {
    return this.serial(async () => {
      const obs = this.connected();
      const now = this.now();
      if (this.active && !this.active.ending) {
        const owners = ownersOf(this.active);
        if (!(id in owners)) {
          // Only the watchdog's end moves: the band has no end of its own (mute_duration 0).
          owners[id] = now + seconds * 1000;
          this.active.endsAt = Math.max(this.active.endsAt, owners[id]);
          await this.holds.hold(
            this.cfg.micInput,
            this.owner(id),
            owners[id] + MIC_HOLD_MARGIN_MS,
          );
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
        owners: { [id]: now + seconds * 1000 },
      };
      await this.save(); // before any change: a crash from here is restored at the next start
      try {
        await this.holds.hold(
          this.cfg.micInput,
          this.owner(id),
          this.active.endsAt + MIC_HOLD_MARGIN_MS,
        );
        await this.setZoom(obs, REST_ZOOM);
        await this.setFilter(
          obs,
          this.cfg.camSource,
          this.cfg.zoomFilter,
          true,
        );
        await this.setBand(obs, { mute_duration: 0, manual_time: -1 });
        await this.setFilter(
          obs,
          this.cfg.camSource,
          this.cfg.bandFilter,
          true,
        );
        this.active.bandAt = this.now();
        await this.setFilter(
          obs,
          this.cfg.driveInput,
          this.cfg.driveFilter,
          true,
        );
      } catch (e) {
        // OBS refused a step half way: everything back to the snapshot NOW (the mic never stays cut); a restore OBS
        // cannot finish is replayed by tick(). The caller reports the mute as failed.
        this.active.ending = 'watchdog';
        await this.save();
        await this.restore();
        throw e;
      }
      await this.save();
    });
  }

  /**
   * Ends the mute `id` now (Core: expired or caution). Another owner still running: only this one leaves (its mic hold
   * released, the scene stays). The last one: the scene is restored. An old or unknown id does nothing.
   */
  muteEnd(id: string, reason: 'expired' | 'caution') {
    return this.serial(async () => {
      if (!this.active || !(id in ownersOf(this.active))) return null;
      if (
        !this.active.ending &&
        Object.keys(ownersOf(this.active)).length > 1
      ) {
        await this.leave(this.active, id);
        return null;
      }
      this.active.ending ??= reason;
      await this.save();
      return this.restore();
    });
  }

  /** Watchdog (per owner: one Core never ended leaves; the last one restores) and pending restores (OBS was absent). */
  tick() {
    return this.serial(async () => {
      const a = this.active;
      if (!a) return null;
      if (!a.ending) {
        const owners = ownersOf(a);
        const late = (end: number) => this.now() >= end + MUTE_WATCHDOG_MS;
        for (const [id, end] of Object.entries(owners))
          if (late(end) && Object.keys(owners).length > 1)
            await this.leave(a, id);
        if (!late(a.endsAt)) return null;
      }
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
      await this.setZoom(obs, REST_ZOOM);
      if (Math.abs((await this.zoomValue(obs)) - 1) > ZOOM_TOLERANCE)
        await this.setZoom(obs, REST_ZOOM);
      // 3. Zoom and band disabled at the same moment (no animation left), the band's saved duration back.
      await this.setFilter(obs, this.cfg.camSource, this.cfg.zoomFilter, false);
      await this.setFilter(obs, this.cfg.camSource, this.cfg.bandFilter, false);
      await this.setBand(obs, { mute_duration: s.bandDuration });
      // 4. The voice comes back last: this mute's hold released (the mic stays muted while another effect holds it, or
      //    when it was muted before). A mute started by an older Studio (no hold): its own snapshot, as before.
      const held = this.holds.holders(this.cfg.micInput);
      const mine = Object.keys(ownersOf(a))
        .map((id) => this.owner(id))
        .filter((o) => held.includes(o));
      for (const o of mine) await this.holds.release(this.cfg.micInput, o);
      if (!mine.length && !s.micMuted) await this.setMic(obs, false);
      // 5. Rest state and the mic's own state, read back, retried once.
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
    if (now.driveEnabled) wrong.push('drive');
    if (now.zoomEnabled) wrong.push('zoom');
    if (Math.abs(now.zoom - 1) > ZOOM_TOLERANCE) wrong.push('zoom_value');
    if (now.bandEnabled) wrong.push('band');
    if (now.bandDuration !== s.bandDuration) wrong.push('band_duration');
    // The mic is the holds' (read back there): another effect may rightly keep it muted.
    if (!wrong.length || !retry) return wrong;
    await this.setFilter(obs, this.cfg.driveInput, this.cfg.driveFilter, false);
    await this.setZoom(obs, REST_ZOOM);
    await this.setFilter(obs, this.cfg.camSource, this.cfg.zoomFilter, false);
    await this.setFilter(obs, this.cfg.camSource, this.cfg.bandFilter, false);
    await this.setBand(obs, { mute_duration: s.bandDuration });
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
