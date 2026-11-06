import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Twitch alerts — visual calibration (17/10/2026): where each variant is drawn in the single 1920×1080 OBS source.
// Studio's own data (never Core's variants, never the media): per variant, the whole animation (`media`, which also
// carries its texts) and the text layer (`text`, relative to the animation) each get an offset in stage pixels and a
// uniform scale (origin: the stage's top-left corner — the engine applies `translate(x, y) scale(s)`). An absent
// variant or element is drawn exactly as before (offset 0, scale 1). The OBS source receives the SAVED values with
// each claimed alert, so a change applies from the next alert on, never to one already playing.
// Sub-elements (17/10/2026): a variant whose texts are made of distinct blocks (bits: the « × N » badge and the
// sentence) may also place each block on its own (`parts`, inside the text layer, scaled around the block's centre).
// Look (06/11/2026, Studio › Alertes): when the texts show and leave, their transitions and the media's, the pseudo's colour,
// the wording, the volume. Same path as the placement: saved here, handed over with the claim, applied by the engine
// (alerts-player/timeline.js withLook). It never changes when an alert ends, so Core's lease and the frozen variant still hold.

export interface Place {
  x: number;
  y: number;
  scale: number;
}
export interface VariantPlacement {
  media: Place;
  text: Place;
  /** Optional text blocks placed on their own (id → place); absent = where the layout puts them. */
  parts?: Record<string, Place>;
  look?: VariantLook;
}

export interface Transition {
  kind: string;
  ms: number;
}
/** Each field absent = what the variant's style does. */
export interface VariantLook {
  showAt?: number;
  hideAt?: number;
  subtitles?: { showAt?: number; hideAt?: number; text?: string }[];
  text?: string;
  textEnter?: Transition;
  textExit?: Transition;
  mediaEnter?: Transition;
  mediaExit?: Transition;
  nameColor?: string;
  volume?: number;
}

export const IDENTITY: Place = { x: 0, y: 0, scale: 1 };
const LIMIT = { offset: 3840, minScale: 0.1, maxScale: 5 };
const ID = /^[a-z0-9_]{1,64}$/;
const MAX_VARIANTS = 200;
const PART_ID = /^[a-zA-Z0-9_]{1,32}$/;
const MAX_PARTS = 8;
/** Same list as FX_KINDS in alerts-player/timeline.js (checked by a test). */
export const TRANSITIONS = [
  'cut',
  'fade',
  'rise',
  'drop',
  'left',
  'right',
  'zoom',
];
const MAX_MS = 120_000;
const MAX_FX_MS = 5_000;
const MAX_TEXT = 160;
const MAX_SUBTITLES = 8;

const isIdentity = (p: Place) => p.x === 0 && p.y === 0 && p.scale === 1;

function place(raw: unknown): Place | null {
  if (raw === undefined) return { ...IDENTITY };
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const x = Number(r.x ?? 0);
  const y = Number(r.y ?? 0);
  const scale = Number(r.scale ?? 1);
  if (![x, y, scale].every(Number.isFinite)) return null;
  if (Math.abs(x) > LIMIT.offset || Math.abs(y) > LIMIT.offset) return null;
  if (scale < LIMIT.minScale || scale > LIMIT.maxScale) return null;
  // 0.01 px / 0.0001 scale is far below what can be seen; keeps the file readable.
  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    scale: Math.round(scale * 10_000) / 10_000,
  };
}

const ms = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_MS;
const wording = (v: unknown) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT;
const LOOK_KEYS = new Set([
  'showAt',
  'hideAt',
  'subtitles',
  'text',
  'textEnter',
  'textExit',
  'mediaEnter',
  'mediaExit',
  'nameColor',
  'volume',
]);

/** The look's fields, each one checked; a wrong one refuses the whole save. */
function look(raw: unknown): VariantLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !LOOK_KEYS.has(k))) return null;
  const out: VariantLook = {};
  for (const k of ['showAt', 'hideAt'] as const) {
    if (r[k] === undefined) continue;
    if (!ms(r[k])) return null;
    out[k] = r[k] as number;
  }
  if (
    out.showAt !== undefined &&
    out.hideAt !== undefined &&
    out.showAt >= out.hideAt
  )
    return null;
  if (r.text !== undefined) {
    if (!wording(r.text)) return null;
    out.text = r.text as string;
  }
  for (const k of [
    'textEnter',
    'textExit',
    'mediaEnter',
    'mediaExit',
  ] as const) {
    if (r[k] === undefined) continue;
    const t = r[k] as Partial<Transition> | null;
    if (
      !t ||
      !TRANSITIONS.includes(String(t.kind)) ||
      !Number.isInteger(t.ms) ||
      t.ms! < 0 ||
      t.ms! > MAX_FX_MS
    )
      return null;
    out[k] = { kind: String(t.kind), ms: t.ms! };
  }
  if (r.nameColor !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(String(r.nameColor))) return null;
    out.nameColor = String(r.nameColor);
  }
  if (r.volume !== undefined) {
    if (typeof r.volume !== 'number' || !(r.volume >= 0 && r.volume <= 1))
      return null;
    out.volume = Math.round(r.volume * 100) / 100;
  }
  if (r.subtitles !== undefined) {
    if (!Array.isArray(r.subtitles) || r.subtitles.length > MAX_SUBTITLES)
      return null;
    out.subtitles = [];
    for (const raw of r.subtitles as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') return null;
      const s: NonNullable<VariantLook['subtitles']>[number] = {};
      if (raw.showAt !== undefined) {
        if (!ms(raw.showAt)) return null;
        s.showAt = raw.showAt as number;
      }
      if (raw.hideAt !== undefined) {
        if (!ms(raw.hideAt)) return null;
        s.hideAt = raw.hideAt as number;
      }
      if (raw.text !== undefined) {
        if (!wording(raw.text)) return null;
        s.text = raw.text as string;
      }
      out.subtitles.push(s);
    }
  }
  return out;
}

/** One variant's placement, or null when a value is missing its type, not finite or out of range. */
export function validatePlacement(raw: unknown): VariantPlacement | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const media = place(r.media);
  const text = place(r.text);
  if (!media || !text) return null;
  const saved = r.look === undefined ? null : look(r.look);
  if (r.look !== undefined && !saved) return null;
  const extra = saved && Object.keys(saved).length ? { look: saved } : {};
  if (r.parts === undefined) return { media, text, ...extra };
  if (!r.parts || typeof r.parts !== 'object') return null;
  const entries = Object.entries(r.parts as Record<string, unknown>);
  if (entries.length > MAX_PARTS) return null;
  const parts: Record<string, Place> = {};
  for (const [id, value] of entries) {
    const p = PART_ID.test(id) && value !== undefined ? place(value) : null;
    if (!p) return null;
    if (!isIdentity(p)) parts[id] = p; // identity = where the layout puts it: not stored
  }
  return Object.keys(parts).length
    ? { media, text, parts, ...extra }
    : { media, text, ...extra };
}

export class AlertPlacementStore {
  private variants = new Map<string, VariantPlacement>();
  private constructor(private readonly file: string) {}

  /** Reads the saved file; absent, unreadable or partly invalid → the valid entries only (defaults for the rest). */
  static async open(file: string) {
    const store = new AlertPlacementStore(file);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return store; // none yet, or corrupt: every variant drawn as before
    }
    const entries = (raw as { variants?: unknown })?.variants;
    if (entries && typeof entries === 'object')
      for (const [id, value] of Object.entries(entries).slice(
        0,
        MAX_VARIANTS,
      )) {
        const p = ID.test(id) ? validatePlacement(value) : null;
        if (p) store.variants.set(id, p);
      }
    return store;
  }

  /** The saved placement of a variant (identity when none). */
  get(id: string): VariantPlacement {
    return (
      this.variants.get(id) ?? { media: { ...IDENTITY }, text: { ...IDENTITY } }
    );
  }

  all(): Record<string, VariantPlacement> {
    return Object.fromEntries(this.variants);
  }

  /** Validates, then writes the whole file atomically; nothing changes if it is refused. Identity = removed. */
  async save(id: string, input: unknown) {
    if (!ID.test(id))
      throw Object.assign(new Error('bad_variant'), { status: 400 });
    const p = validatePlacement(input);
    if (!p)
      throw Object.assign(new Error('invalid_placement'), { status: 400 });
    const next = new Map(this.variants);
    if (isIdentity(p.media) && isIdentity(p.text) && !p.parts && !p.look)
      next.delete(id);
    else next.set(id, p);
    if (next.size > MAX_VARIANTS)
      throw Object.assign(new Error('too_many_variants'), { status: 400 });
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(
      tmp,
      JSON.stringify(
        { version: 1, variants: Object.fromEntries(next) },
        null,
        2,
      ),
    );
    await rename(tmp, this.file);
    this.variants = next;
    return this.get(id);
  }
}
