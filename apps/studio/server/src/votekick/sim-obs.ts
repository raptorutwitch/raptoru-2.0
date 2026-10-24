import type { ObsLike } from '../channel-points/obs-actions.js';
import { SAMMI_MUTE_FX, type MuteFxConfig } from './mute-controller.js';

// Votekick V2 — a simulated OBS for the mute (tests and the local preview; never a real OBS). It holds the items the
// mute touches plus an unrelated filter (it must never move), and models the Move « Audio Move » drive: while its
// filter is on, the voice writes the zoom filter's `zoom` (even when that filter is off, like the plugin), and one
// write already in flight lands just after the drive is disabled (the audio thread). Every change is recorded with
// what viewers would see, so a sequence can be checked: no reaction and no band once the voice is back.

export interface SimObsFrame {
  step: string;
  micMuted: boolean;
  zoomOn: boolean;
  zoom: number;
  bandOn: boolean;
  driveOn: boolean;
}

export class SimObs implements ObsLike {
  connected = true;
  readonly inputs = new Map<string, { muted: boolean }>();
  readonly filters = new Map<
    string,
    { enabled: boolean; settings: Record<string, unknown> }
  >();
  readonly frames: SimObsFrame[] = [];
  readonly requests: string[] = [];
  /** A drive write in flight (the audio thread), delivered after the next drive change. */
  private inFlight: number | null = null;
  /**
   * Settings OBS stores as INTEGERS: obs-websocket turns a JSON integer (`1`) into obs_data_set_int, a JSON decimal
   * into obs_data_set_double (src/utils/Json.cpp). Key: `source|filter.setting`.
   */
  readonly integerSettings = new Set<string>();
  /** Fails the n-th request from now (OBS leaving mid-way). */
  failAt: number | null = null;

  constructor(readonly cfg: MuteFxConfig = SAMMI_MUTE_FX) {
    this.inputs.set(cfg.micInput, { muted: false });
    this.inputs.set(cfg.driveInput, { muted: false });
    this.filters.set(this.k(cfg.camSource, cfg.zoomFilter), {
      enabled: false,
      settings: { zoom: 1, zoom_max: 1.299 },
    });
    this.filters.set(this.k(cfg.camSource, cfg.bandFilter), {
      enabled: false,
      settings: { mute_duration: 110, anim_out_time: 0.14, manual_time: -1 },
    });
    this.filters.set(this.k(cfg.driveInput, cfg.driveFilter), {
      enabled: false,
      settings: { base_value: 1, factor: 0.75 },
    });
    // Not ours: must never change.
    this.filters.set(this.k(cfg.camSource, 'prison'), {
      enabled: false,
      settings: {},
    });
  }

  private k(source: string, filter: string) {
    return `${source}|${filter}`;
  }

  private get(source: string, filter: string) {
    const f = this.filters.get(this.k(source, filter));
    if (!f) throw Object.assign(new Error('not_found'), { code: 600 });
    return f;
  }

  /** Is the zoom stored by OBS as an integer (then Audio Move can only write 1)? */
  get zoomIsInteger() {
    return this.integerSettings.has(
      `${this.k(this.cfg.camSource, this.cfg.zoomFilter)}.zoom`,
    );
  }

  /**
   * The voice at `level` (0..1): the drive, when on, writes the zoom (and keeps one write in flight) — like Move's Audio
   * Move: an integer setting gets `(long long)value` (OBS_DATA_NUM_INT), so an integer zoom stays 1 whatever the voice.
   */
  voice(level: number) {
    const drive = this.get(this.cfg.driveInput, this.cfg.driveFilter);
    if (!drive.enabled) return;
    const raw = 1 + level * 0.3;
    const z = this.zoomIsInteger ? Math.trunc(raw) : raw;
    this.zoomFilter.settings.zoom = z;
    this.inFlight = z;
    this.frame(`voix ${Math.round(level * 100)} %`);
  }

  get zoomFilter() {
    return this.get(this.cfg.camSource, this.cfg.zoomFilter);
  }
  get bandFilter() {
    return this.get(this.cfg.camSource, this.cfg.bandFilter);
  }
  get driveFilter() {
    return this.get(this.cfg.driveInput, this.cfg.driveFilter);
  }

  private frame(step: string) {
    this.frames.push({
      step,
      micMuted: this.inputs.get(this.cfg.micInput)!.muted,
      zoomOn: this.zoomFilter.enabled,
      zoom: Number(this.zoomFilter.settings.zoom),
      bandOn: this.bandFilter.enabled,
      driveOn: this.driveFilter.enabled,
    });
  }

  async request(type: string, d: Record<string, unknown> & object) {
    if (!this.connected) throw new Error('obs_offline');
    if (this.failAt !== null && this.failAt-- <= 0) {
      this.failAt = null;
      this.connected = false;
      throw new Error('obs_offline');
    }
    const data = d as Record<string, unknown>;
    this.requests.push(
      `${type} ${String(data.inputName ?? `${String(data.sourceName)} / ${String(data.filterName)}`)}`,
    );
    switch (type) {
      case 'GetInputMute':
        return { inputMuted: this.inputs.get(String(data.inputName))!.muted };
      case 'SetInputMute':
        this.inputs.get(String(data.inputName))!.muted =
          data.inputMuted === true;
        this.frame(data.inputMuted ? 'micro coupé' : 'micro rétabli');
        return {};
      case 'GetSourceFilter': {
        const f = this.get(String(data.sourceName), String(data.filterName));
        return { filterEnabled: f.enabled, filterSettings: { ...f.settings } };
      }
      case 'SetSourceFilterEnabled': {
        const f = this.get(String(data.sourceName), String(data.filterName));
        f.enabled = data.filterEnabled === true;
        this.frame(`${String(data.filterName)} ${f.enabled ? 'ON' : 'off'}`);
        if (
          String(data.filterName) === this.cfg.driveFilter &&
          !f.enabled &&
          this.inFlight !== null
        ) {
          // The audio thread's last write lands after the drive was disabled.
          this.zoomFilter.settings.zoom = this.inFlight;
          this.inFlight = null;
          this.frame('écriture tardive du drive');
        }
        return {};
      }
      case 'SetSourceFilterSettings': {
        const f = this.get(String(data.sourceName), String(data.filterName));
        // What travels is JSON: its text decides integer vs decimal, as obs-websocket does.
        const sent = data.filterSettings as Record<string, unknown>;
        for (const [key, value] of Object.entries(sent)) {
          const id = `${this.k(String(data.sourceName), String(data.filterName))}.${key}`;
          // JSON.stringify(1) === '1' (an integer for OBS), JSON.stringify(1.000001) === '1.000001' (a decimal).
          if (typeof value === 'number' && Number.isInteger(value))
            this.integerSettings.add(id);
          else this.integerSettings.delete(id);
        }
        Object.assign(f.settings, sent);
        this.frame(`${String(data.filterName)} réglé`);
        return {};
      }
      default:
        throw new Error(`unexpected ${type}`);
    }
  }

  /**
   * Frames where viewers see the MUTED effect react although the voice is back: the mic live while the band shows,
   * or while the zoom filter is on with a zoom off rest (the voice moves the camera).
   */
  reactionsAfterUnmute() {
    const out: SimObsFrame[] = [];
    let unmutedOnce = false;
    for (const f of this.frames) {
      if (f.step === 'micro rétabli') unmutedOnce = true;
      if (!unmutedOnce || f.micMuted) continue;
      if (f.bandOn || (f.zoomOn && (f.driveOn || Math.abs(f.zoom - 1) > 0.001)))
        out.push(f);
    }
    return out;
  }
}

/** SAMMI's end of mute (VK_MUTE_BROADCASTER lines 16–20 / CAUTION_FINISH 6–10), replayed on a simulated OBS. */
export async function sammiLegacyEnd(obs: ObsLike, cfg = SAMMI_MUTE_FX) {
  await obs.request('SetInputMute', {
    inputName: cfg.micInput,
    inputMuted: false,
  });
  await obs.request('SetSourceFilterEnabled', {
    sourceName: cfg.driveInput,
    filterName: cfg.driveFilter,
    filterEnabled: false,
  });
  await obs.request('SetSourceFilterSettings', {
    sourceName: cfg.camSource,
    filterName: cfg.zoomFilter,
    filterSettings: { zoom: 1 },
  });
  await obs.request('SetSourceFilterEnabled', {
    sourceName: cfg.camSource,
    filterName: cfg.zoomFilter,
    filterEnabled: false,
  });
  await obs.request('SetSourceFilterEnabled', {
    sourceName: cfg.camSource,
    filterName: cfg.bandFilter,
    filterEnabled: false,
  });
}

/** SAMMI's start of mute (VK_MUTE_BROADCASTER lines 4–9). */
export async function sammiLegacyStart(
  obs: ObsLike,
  seconds: number,
  cfg = SAMMI_MUTE_FX,
) {
  await obs.request('SetInputMute', {
    inputName: cfg.micInput,
    inputMuted: true,
  });
  await obs.request('SetSourceFilterSettings', {
    sourceName: cfg.camSource,
    filterName: cfg.zoomFilter,
    filterSettings: { zoom: 1 },
  });
  await obs.request('SetSourceFilterEnabled', {
    sourceName: cfg.camSource,
    filterName: cfg.zoomFilter,
    filterEnabled: true,
  });
  await obs.request('SetSourceFilterEnabled', {
    sourceName: cfg.driveInput,
    filterName: cfg.driveFilter,
    filterEnabled: true,
  });
  await obs.request('SetSourceFilterSettings', {
    sourceName: cfg.camSource,
    filterName: cfg.bandFilter,
    filterSettings: { mute_duration: seconds, manual_time: -1 },
  });
  await obs.request('SetSourceFilterEnabled', {
    sourceName: cfg.camSource,
    filterName: cfg.bandFilter,
    filterEnabled: true,
  });
}
