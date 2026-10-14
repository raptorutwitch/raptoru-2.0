import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Bonk VNext lot 2 — where the Bonks aim, per Studio profile (Lab and Production each have their own
// file, next to their journal). The zone is a fraction of the 1920 × 1080 canvas. Without a file (or
// with an unreadable one) the defaults are exactly the lot 1 behaviour: Manuel, 480 × 300 around
// (960, 400).
// Lot 3: version 2 adds the Auto mode and the pinned camera source. A version 1 file is read as
// version 2 (no pinned source) and rewritten as such at the next save.

export type BonkTargetMode = 'auto' | 'manual' | 'fullscreen';
export interface BonkZone {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Camera source preferred by Auto (OBS source uuid when known, else its name). */
export interface BonkPinned {
  name: string;
  uuid: string | null;
}
export interface BonkSettings {
  version: 2;
  mode: BonkTargetMode;
  manual: BonkZone;
  auto: { pinned: BonkPinned | null };
}

export const CANVAS = { width: 1920, height: 1080 } as const;
/** Smallest zone side (fraction of the canvas side). */
export const MIN_ZONE = 0.05;
export const DEFAULT_SETTINGS: BonkSettings = Object.freeze({
  version: 2,
  mode: 'manual',
  auto: Object.freeze({ pinned: null }),
  manual: Object.freeze({
    x: 720 / CANVAS.width,
    y: 250 / CANVAS.height,
    w: 480 / CANVAS.width,
    h: 300 / CANVAS.height,
  }),
}) as BonkSettings;

const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** The settings, or the reason they are refused (nothing is ever clamped silently). */
export function validateSettings(
  input: unknown,
): { ok: true; settings: BonkSettings } | { ok: false; error: string } {
  const s = input as Partial<BonkSettings> | null;
  if (!s || typeof s !== 'object')
    return { ok: false, error: 'invalid_settings' };
  const version = (s as { version?: unknown }).version;
  if (version !== 1 && version !== 2)
    return { ok: false, error: 'invalid_settings' };
  if (
    s.mode !== 'manual' &&
    s.mode !== 'fullscreen' &&
    !(version === 2 && s.mode === 'auto')
  )
    return { ok: false, error: 'invalid_mode' };
  let pinned: BonkPinned | null = null;
  if (version === 2) {
    const p = (s.auto as { pinned?: unknown } | undefined)?.pinned as
      Partial<BonkPinned> | null | undefined;
    if (p != null) {
      if (
        typeof p.name !== 'string' ||
        !p.name ||
        p.name.length > 256 ||
        (p.uuid != null && (typeof p.uuid !== 'string' || p.uuid.length > 64))
      )
        return { ok: false, error: 'invalid_pinned' };
      pinned = { name: p.name, uuid: p.uuid ?? null };
    }
  }
  const z = s.manual as Partial<BonkZone> | undefined;
  if (!z || ![z.x, z.y, z.w, z.h].every(finite))
    return { ok: false, error: 'invalid_zone' };
  const { x, y, w, h } = z as BonkZone;
  const eps = 1e-9;
  if (
    w < MIN_ZONE - eps ||
    h < MIN_ZONE - eps ||
    x < -eps ||
    y < -eps ||
    x + w > 1 + eps ||
    y + h > 1 + eps
  )
    return { ok: false, error: 'invalid_zone' };
  return {
    ok: true,
    settings: {
      version: 2,
      mode: s.mode,
      manual: { x, y, w, h },
      auto: { pinned },
    },
  };
}

export class BonkSettingsStore {
  private current: BonkSettings = DEFAULT_SETTINGS;
  /** Bumped at every saved change: the overlay applies a new target when it moves. */
  revision = 0;
  private constructor(private readonly file: string) {}

  static async open(file: string) {
    const store = new BonkSettingsStore(file);
    try {
      const checked = validateSettings(
        JSON.parse(await readFile(file, 'utf8')),
      );
      if (checked.ok) store.current = checked.settings;
    } catch {
      /* none or unreadable: defaults (lot 1 behaviour) */
    }
    return store;
  }

  get settings(): BonkSettings {
    return this.current;
  }

  /** Validates, then writes atomically; nothing changes if it is refused. */
  async save(input: unknown) {
    const checked = validateSettings(input);
    if (!checked.ok) throw new Error(checked.error);
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify(checked.settings), {
      mode: 0o600,
    });
    await rename(`${this.file}.tmp`, this.file);
    this.current = checked.settings;
    this.revision += 1;
    return this.current;
  }

  /**
   * What the overlay aims at, in canvas pixels, without Auto: the Manuel zone (also the Auto
   * fallback) or Fullscreen. The runtime replaces the rect with the Auto camera when there is one.
   */
  target() {
    const z = this.current.manual;
    return {
      revision: this.revision,
      mode:
        this.current.mode === 'fullscreen'
          ? ('fullscreen' as const)
          : ('manual' as const),
      rect: {
        x: z.x * CANVAS.width,
        y: z.y * CANVAS.height,
        w: z.w * CANVAS.width,
        h: z.h * CANVAS.height,
      },
    };
  }
}
