import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

// Music Hub — the OBS music overlays (docs/music/MUSIC_OVERLAYS.md). One OBS browser source (Studio's page
// /music-overlay/overlay.html, its token in the URL's hash like the effects player) shows what plays, in the look of the
// preset « à l'antenne ». Six real archetypes (distinct compositions, not recolours), built-in presets that look right
// at once, the streamer's own variants (saved, renamed, duplicated, reset), shown / hidden from Studio without touching
// OBS. Stored in Studio (<spotify dir>/music-overlays.json), versioned; an older or damaged setting is repaired field by
// field from its preset's defaults (never a broken overlay, never a silent loss: the unreadable file is kept aside).

export const ARCHETYPES = [
  'minimal',
  'clean',
  'glass',
  'neon',
  'editorial',
  'focus',
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const OverlaySettings = z.strictObject({
  archetype: z.enum(ARCHETYPES),
  /** Overall scale: compact 0.8, standard 1, large 1.3. */
  size: z.enum(['compact', 'standard', 'large']),
  /** The widget's width at the standard size (px of the 1920 × 1080 canvas). */
  width: z.number().int().min(220).max(1100),
  position: z.enum([
    'top-left',
    'top-center',
    'top-right',
    'middle-left',
    'middle-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
  ]),
  /** Distance to the canvas edges (px). */
  margin: z.number().int().min(0).max(240),
  /** Which side the cover sits on, and the text's alignment. */
  align: z.enum(['start', 'center', 'end']),
  orientation: z.enum(['horizontal', 'vertical']),
  /** Flottant (minimal): « titre — artiste » on one line, or the title over the artist (a compact two-line strip). */
  layout: z.enum(['line', 'stack']),
  radius: z.number().int().min(0).max(48),
  spacing: z.enum(['tight', 'normal', 'airy']),
  cover: z.strictObject({
    show: z.boolean(),
    size: z.enum(['small', 'medium', 'large']),
    shape: z.enum(['square', 'rounded', 'circle']),
  }),
  /** The palette chosen (its colours are copied below; `custom` once a colour is changed by hand). */
  palette: z.enum([
    'nuit',
    'aurore',
    'givre',
    'braise',
    'menthe',
    'papier',
    'custom',
  ]),
  colors: z.strictObject({
    accent: Hex,
    /** The title (and the main text). */
    text: Hex,
    artist: Hex,
    /** Secondary text: « En cours », album, time. */
    muted: Hex,
    background: Hex,
    /** Background opacity, %. */
    opacity: z.number().int().min(0).max(100),
    /** Text opacity, % (independent of the background's; never below 50: the text never vanishes). */
    text_opacity: z.number().int().min(50).max(100),
    /** 0 none, 1 soft, 2 strong, 3 outline (a game behind a transparent background). */
    text_shadow: z.number().int().min(0).max(3),
    border: z.boolean(),
    /** The border's strength, %. */
    border_opacity: z.number().int().min(5).max(100),
    /** 0 none … 3 deep. */
    shadow: z.number().int().min(0).max(3),
    gradient: z.boolean(),
    /** The accent taken from the cover of each track (the palette's accent when it cannot be read). */
    auto_accent: z.boolean(),
  }),
  font: z.enum(['moderne', 'condensee', 'editoriale', 'mono']),
  /** % of the archetype's own sizes. */
  title_scale: z.number().int().min(70).max(160),
  artist_scale: z.number().int().min(70).max(160),
  weight: z.enum(['regular', 'bold', 'black']),
  long_text: z.enum(['scroll', 'wrap', 'ellipsis']),
  /** A text too long for its room (long_text « scroll »): back and forth with pauses, or a continuous ticker. */
  marquee: z.strictObject({
    mode: z.enum(['bounce', 'loop']),
    speed: z.enum(['slow', 'normal', 'fast']),
  }),
  /**
   * A confirmed viewer request: a small tab sliding out from behind the strip (« Demandé par @pseudo »), never in the
   * text's flow. Only from Core's exact attribution (the page gets `request` only then).
   */
  request_tab: z.strictObject({
    show: z.boolean(),
    side: z.enum(['top', 'bottom']),
    align: z.enum(['start', 'center', 'end']),
    size: z.enum(['small', 'normal']),
    background: Hex,
    text: Hex,
    opacity: z.number().int().min(30).max(100),
    radius: z.number().int().min(0).max(16),
    animate: z.boolean(),
    duration_ms: z.number().int().min(150).max(1200),
  }),
  show: z.strictObject({
    label: z.boolean(),
    title: z.boolean(),
    artist: z.boolean(),
    album: z.boolean(),
    progress: z.boolean(),
    time: z.boolean(),
    requester: z.boolean(),
    request_badge: z.boolean(),
    pause_state: z.boolean(),
  }),
  animation: z.strictObject({
    enter: z.enum(['none', 'fade', 'slide', 'rise', 'scale']),
    change: z.enum(['none', 'crossfade', 'slide', 'flip', 'pop']),
    intensity: z.enum(['subtle', 'normal', 'strong']),
    duration_ms: z.number().int().min(150).max(1500),
    /** A slow decorative glow (never driven by the audio: there is no audio data). */
    ambient: z.boolean(),
  }),
  display: z.strictObject({
    /** Always while music plays; an announce at each new track; or compact always + expanded at each new track. */
    mode: z.enum(['always', 'announce', 'hybrid']),
    announce_s: z.number().int().min(3).max(60),
    on_pause: z.enum(['show', 'dim', 'compact', 'hide']),
    /** Nothing playing / Spotify closed: hidden, or a quiet « Aucune musique ». */
    on_idle: z.enum(['hide', 'placeholder']),
    /** A request starting: always announced (expanded) whatever the mode. */
    request_spotlight: z.boolean(),
  }),
});
export type OverlaySettings = z.infer<typeof OverlaySettings>;

export const PALETTES: Record<
  Exclude<OverlaySettings['palette'], 'custom'>,
  { label: string; on_accent: string } & Pick<
    OverlaySettings['colors'],
    'accent' | 'text' | 'artist' | 'muted' | 'background'
  >
> = {
  nuit: {
    label: 'Nuit',
    accent: '#34d399',
    on_accent: '#0d1512',
    artist: '#d9d3ea',
    text: '#f5f3ff',
    muted: '#b8b0d0',
    background: '#120f1d',
  },
  aurore: {
    label: 'Aurore',
    accent: '#f472b6',
    on_accent: '#1f0a16',
    artist: '#f3d9e6',
    text: '#fff7fb',
    muted: '#e5c3d6',
    background: '#2a1030',
  },
  givre: {
    label: 'Givre',
    accent: '#7dd3fc',
    on_accent: '#06131d',
    artist: '#d4e5f2',
    text: '#f0f9ff',
    muted: '#b5cde0',
    background: '#0b1726',
  },
  braise: {
    label: 'Braise',
    accent: '#fb923c',
    on_accent: '#1f0d03',
    artist: '#f4dcc8',
    text: '#fff7ed',
    muted: '#e8c4a8',
    background: '#1f0f08',
  },
  menthe: {
    label: 'Menthe',
    accent: '#a3e635',
    on_accent: '#0f1a04',
    artist: '#dde9cc',
    text: '#f7fee7',
    muted: '#c6d6b0',
    background: '#0f1a0c',
  },
  papier: {
    label: 'Papier',
    accent: '#e11d48',
    on_accent: '#ffffff',
    artist: '#3a3632',
    text: '#1c1917',
    muted: '#57534e',
    background: '#faf7f2',
  },
};

/** A palette's colours (never its label: the setting is strict). */
const hues = (k: keyof typeof PALETTES) => {
  const { accent, text, artist, muted, background } = PALETTES[k];
  return { accent, text, artist, muted, background };
};
/** The request tab in a palette's accent. */
const tabOf = (k: keyof typeof PALETTES) => ({
  background: PALETTES[k].accent,
  text: PALETTES[k].on_accent,
});

const BASE: OverlaySettings = {
  archetype: 'clean',
  size: 'standard',
  width: 520,
  position: 'bottom-left',
  margin: 48,
  align: 'start',
  orientation: 'horizontal',
  layout: 'line',
  radius: 16,
  spacing: 'normal',
  cover: { show: true, size: 'medium', shape: 'rounded' },
  palette: 'nuit',
  colors: {
    ...hues('nuit'),
    opacity: 82,
    text_opacity: 100,
    text_shadow: 0,
    border: true,
    border_opacity: 14,
    shadow: 2,
    gradient: false,
    auto_accent: false,
  },
  font: 'moderne',
  title_scale: 100,
  artist_scale: 100,
  weight: 'bold',
  long_text: 'scroll',
  marquee: { mode: 'bounce', speed: 'normal' },
  request_tab: {
    show: false,
    side: 'bottom',
    align: 'start',
    size: 'normal',
    ...tabOf('nuit'),
    opacity: 100,
    radius: 8,
    animate: true,
    duration_ms: 420,
  },
  show: {
    label: true,
    title: true,
    artist: true,
    album: false,
    progress: true,
    time: true,
    requester: true,
    request_badge: true,
    pause_state: true,
  },
  animation: {
    enter: 'slide',
    change: 'crossfade',
    intensity: 'normal',
    duration_ms: 520,
    ambient: false,
  },
  display: {
    mode: 'always',
    announce_s: 10,
    on_pause: 'show',
    on_idle: 'hide',
    request_spotlight: true,
  },
};

type Nested =
  | 'cover'
  | 'colors'
  | 'show'
  | 'animation'
  | 'display'
  | 'marquee'
  | 'request_tab';
const over = (
  o: Partial<Omit<OverlaySettings, Nested>> & {
    marquee?: Partial<OverlaySettings['marquee']>;
    request_tab?: Partial<OverlaySettings['request_tab']>;
    cover?: Partial<OverlaySettings['cover']>;
    colors?: Partial<OverlaySettings['colors']>;
    show?: Partial<OverlaySettings['show']>;
    animation?: Partial<OverlaySettings['animation']>;
    display?: Partial<OverlaySettings['display']>;
  },
): OverlaySettings => ({
  ...BASE,
  ...o,
  cover: { ...BASE.cover, ...o.cover },
  colors: { ...BASE.colors, ...o.colors },
  show: { ...BASE.show, ...o.show },
  animation: { ...BASE.animation, ...o.animation },
  display: { ...BASE.display, ...o.display },
  marquee: { ...BASE.marquee, ...o.marquee },
  request_tab: { ...BASE.request_tab, ...o.request_tab },
});

export interface Builtin {
  id: string;
  name: string;
  description: string;
  settings: OverlaySettings;
}

/** The ready-made presets: the six archetypes at their best, and two for a situation. Never modified (variants are). */
export const BUILTINS: Builtin[] = [
  {
    id: 'minimal',
    name: 'Flottant',
    description:
      'Une pastille discrète, toujours là sans gêner : titre et artiste sur une ligne.',
    settings: over({
      archetype: 'minimal',
      width: 440,
      radius: 48,
      position: 'top-right',
      margin: 36,
      cover: { size: 'small', shape: 'circle' },
      colors: {
        opacity: 84,
        shadow: 1,
        border: true,
        border_opacity: 12,
        text_shadow: 1,
      },
      title_scale: 105,
      show: { label: false, album: false, progress: true, time: false },
      request_tab: { show: true, side: 'bottom', align: 'end' },
      animation: { enter: 'fade', change: 'crossfade', duration_ms: 420 },
    }),
  },
  {
    id: 'clean',
    name: 'Cartouche',
    description:
      'Le classique lisible : pochette, titre, artiste, progression, demandeur.',
    settings: over({ archetype: 'clean' }),
  },
  {
    id: 'glass',
    name: 'Verre',
    description:
      'Haut de gamme : la pochette floutée en fond, du relief, des bords fins.',
    settings: over({
      archetype: 'glass',
      width: 560,
      radius: 28,
      palette: 'givre',
      colors: {
        ...hues('givre'),
        opacity: 38,
        border: true,
        shadow: 3,
        auto_accent: true,
      },
      cover: { size: 'large', shape: 'rounded' },
      request_tab: tabOf('givre'),
      animation: { enter: 'rise', change: 'crossfade', duration_ms: 700 },
    }),
  },
  {
    id: 'neon',
    name: 'Néon',
    description:
      'Expressif : un accent lumineux, une lueur qui respire, un éclat à chaque titre.',
    settings: over({
      archetype: 'neon',
      width: 540,
      radius: 14,
      palette: 'aurore',
      colors: {
        ...hues('aurore'),
        background: '#0d0614',
        opacity: 86,
        border: true,
        shadow: 2,
      },
      font: 'condensee',
      request_tab: tabOf('aurore'),
      title_scale: 110,
      weight: 'black',
      animation: {
        enter: 'scale',
        change: 'pop',
        intensity: 'normal',
        duration_ms: 560,
        ambient: true,
      },
    }),
  },
  {
    id: 'editorial',
    name: 'Éditorial',
    description:
      'La typographie d’abord : un grand titre, une hiérarchie forte, la pochette en retrait.',
    settings: over({
      archetype: 'editorial',
      width: 760,
      radius: 0,
      position: 'bottom-left',
      margin: 64,
      palette: 'nuit',
      colors: { opacity: 0, border: false, shadow: 0, gradient: true },
      cover: { show: true, size: 'small', shape: 'square' },
      font: 'editoriale',
      title_scale: 100,
      weight: 'regular',
      long_text: 'wrap',
      show: { album: true, time: false },
      animation: { enter: 'slide', change: 'slide', duration_ms: 640 },
    }),
  },
  {
    id: 'focus',
    name: 'Projecteur',
    description:
      'Pour annoncer : grande pochette, tout le détail, puis il s’efface.',
    settings: over({
      archetype: 'focus',
      width: 380,
      orientation: 'vertical',
      align: 'center',
      radius: 22,
      position: 'middle-right',
      margin: 56,
      cover: { size: 'large', shape: 'rounded' },
      colors: { opacity: 88, shadow: 3, gradient: true, auto_accent: true },
      show: { album: true },
      animation: { enter: 'rise', change: 'flip', duration_ms: 760 },
      display: { mode: 'announce', announce_s: 12 },
    }),
  },
  {
    id: 'hybride',
    name: 'Hybride',
    description:
      'Une pastille en permanence, qui s’agrandit en cartouche à chaque nouveau titre.',
    settings: over({
      archetype: 'clean',
      position: 'bottom-right',
      display: { mode: 'hybrid', announce_s: 9 },
      animation: { enter: 'slide', change: 'crossfade', duration_ms: 560 },
    }),
  },
  {
    id: 'jeu',
    name: 'Jeu chargé',
    description:
      'Pour les jeux très visuels : un petit bandeau contrasté, le titre puis l’artiste, la demande en languette.',
    settings: over({
      archetype: 'minimal',
      layout: 'stack',
      width: 380,
      radius: 12,
      position: 'top-center',
      margin: 18,
      cover: { show: false, size: 'small', shape: 'rounded' },
      palette: 'custom',
      colors: {
        background: '#0c0a12',
        text: '#ffffff',
        artist: '#ddd8ea',
        opacity: 84,
        text_shadow: 1,
        border: true,
        border_opacity: 14,
        shadow: 1,
      },
      title_scale: 110,
      show: { label: false, progress: false, time: false, album: false },
      request_tab: { show: true, side: 'bottom', align: 'center' },
      animation: { enter: 'fade', change: 'crossfade', intensity: 'subtle' },
      display: { on_pause: 'hide' },
    }),
  },
];

export const builtin = (id: string) => BUILTINS.find((b) => b.id === id);

/**
 * A setting read from disk (any age) → a valid one: each field checked on its own, a missing or invalid field takes the
 * preset's default (an update never breaks a saved variant; the streamer's other choices are kept). `repaired` only
 * when a saved value was invalid: an option that did not exist yet simply takes its default.
 */
export function repairSettings(raw: unknown, defaults: OverlaySettings) {
  const shape = OverlaySettings.shape as Record<string, z.ZodType>;
  const src = migrate(
    (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>,
  );
  const out: Record<string, unknown> = {};
  let repaired = false;
  const check = (field: z.ZodType, v: unknown, def: unknown) => {
    if (v === undefined) return def;
    const ok = field.safeParse(v);
    if (!ok.success) repaired = true;
    return ok.success ? ok.data : def;
  };
  for (const [k, def] of Object.entries(defaults)) {
    const field = shape[k]!;
    const v = src[k];
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      const inner = (field as unknown as { shape: Record<string, z.ZodType> })
        .shape;
      if (v !== undefined && (!v || typeof v !== 'object')) repaired = true;
      const s = (v && typeof v === 'object' ? v : {}) as Record<
        string,
        unknown
      >;
      const o: Record<string, unknown> = {};
      for (const [ik, idef] of Object.entries(def))
        o[ik] = check(inner[ik]!, s[ik], idef);
      out[k] = o;
    } else out[k] = check(field, v, def);
  }
  return { settings: OverlaySettings.parse(out), repaired };
}

/**
 * v1 → v2 (09/11): a saved variant keeps the look it had — its artist in its secondary colour, the text without shadow
 * at full opacity, the border at its former strength, one line, the request in the text (the tab off: one switch away).
 */
function migrate(src: Record<string, unknown>) {
  const c = src.colors as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object' || c.artist !== undefined) return src;
  const tab = src.request_tab as Record<string, unknown> | undefined;
  return {
    layout: 'line',
    ...src,
    colors: {
      text_opacity: 100,
      text_shadow: 0,
      border_opacity: 14,
      ...c,
      artist: c.muted,
    },
    request_tab: tab === undefined ? { show: false } : tab,
  };
}

export const Variant = z.strictObject({
  id: z.string().regex(/^v-[a-z0-9]{8}$/),
  name: z.string().trim().min(1).max(40),
  /** The built-in preset it came from (« Revenir aux valeurs par défaut » goes back to it). */
  base: z.string().regex(/^[a-z]{2,20}$/),
  settings: OverlaySettings,
  updated_at: z.string(),
});
export type Variant = z.infer<typeof Variant>;

const STORE_VERSION = 2;

export interface OverlayState {
  visible: boolean;
  active: string;
  variants: Variant[];
}

/**
 * The overlays' setting in Studio (one JSON file, written atomically). `version` moves with every change: the OBS page
 * and the editor follow it (long poll).
 */
export class OverlayStore {
  version = 1;
  private s: OverlayState = { visible: false, active: 'clean', variants: [] };
  /** Fields repaired at load (an older or damaged variant) — told in the editor, never silent. */
  repaired: string[] = [];
  private constructor(
    private readonly file: string,
    readonly token: string,
    private readonly now: () => number,
  ) {}

  static async open(dir: string, now: () => number = Date.now) {
    await mkdir(dir, { recursive: true });
    const tokenFile = join(dir, 'music-overlay-token');
    let token = '';
    try {
      token = (await readFile(tokenFile, 'utf8')).trim();
    } catch {
      /* first start */
    }
    if (!/^[a-f0-9]{32}$/.test(token)) {
      token = randomBytes(16).toString('hex');
      await writeFile(tokenFile, token, { mode: 0o600 });
    }
    const store = new OverlayStore(
      join(dir, 'music-overlays.json'),
      token,
      now,
    );
    await store.load();
    return store;
  }

  private async load() {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      // Unreadable: kept aside (never lost), the defaults go on.
      await rename(this.file, `${this.file}.unreadable-${this.now()}`).catch(
        () => {},
      );
      this.repaired.push('fichier illisible (mis de côté)');
      return;
    }
    const r = (raw ?? {}) as {
      v?: number;
      visible?: unknown;
      active?: unknown;
      variants?: unknown;
    };
    const variants: Variant[] = [];
    for (const x of Array.isArray(r.variants) ? r.variants : []) {
      const v = (x ?? {}) as Record<string, unknown>;
      const base = builtin(String(v.base ?? '')) ?? builtin('clean')!;
      const id =
        typeof v.id === 'string' && /^v-[a-z0-9]{8}$/.test(v.id)
          ? v.id
          : newId();
      const name =
        typeof v.name === 'string' && v.name.trim()
          ? v.name.trim().slice(0, 40)
          : `Variante ${variants.length + 1}`;
      const { settings, repaired } = repairSettings(v.settings, base.settings);
      if (repaired) this.repaired.push(name);
      variants.push({
        id,
        name,
        base: base.id,
        settings,
        updated_at:
          typeof v.updated_at === 'string'
            ? v.updated_at
            : new Date(this.now()).toISOString(),
      });
    }
    this.s = {
      visible: r.visible === true,
      active:
        typeof r.active === 'string' &&
        (builtin(r.active) || variants.some((v) => v.id === r.active))
          ? r.active
          : 'clean',
      variants,
    };
    if (this.repaired.length || r.v !== STORE_VERSION) await this.save();
  }

  private async save() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(
      `${this.file}.tmp`,
      JSON.stringify({ v: STORE_VERSION, ...this.s }, null, 1),
      { mode: 0o600 },
    );
    await rename(`${this.file}.tmp`, this.file);
    this.version++;
  }

  get state(): OverlayState {
    return this.s;
  }

  /** The preset shown on stream (a variant, else a built-in), resolved. */
  get onAir(): { id: string; name: string; settings: OverlaySettings } {
    const v = this.s.variants.find((x) => x.id === this.s.active);
    if (v) return v;
    const b = builtin(this.s.active) ?? builtin('clean')!;
    return b;
  }

  async setVisible(visible: boolean) {
    this.s = { ...this.s, visible };
    await this.save();
  }

  async setActive(id: string) {
    if (!builtin(id) && !this.s.variants.some((v) => v.id === id))
      throw Object.assign(new Error('unknown_preset'), { status: 404 });
    this.s = { ...this.s, active: id };
    await this.save();
  }

  /** Create (no id) or update a variant; the setting is checked whole (an invalid one is refused, nothing written). */
  async saveVariant(input: {
    id?: string | null;
    base: string;
    name?: string | null;
    settings: unknown;
  }) {
    const base = builtin(input.base);
    if (!base) throw Object.assign(new Error('unknown_base'), { status: 400 });
    const parsed = OverlaySettings.safeParse(input.settings);
    if (!parsed.success)
      throw Object.assign(new Error('invalid_overlay'), {
        status: 400,
        body: { issues: parsed.error.issues.map((i) => i.path.join('.')) },
      });
    const at = new Date(this.now()).toISOString();
    const existing = input.id
      ? this.s.variants.find((v) => v.id === input.id)
      : null;
    if (input.id && !existing)
      throw Object.assign(new Error('unknown_preset'), { status: 404 });
    const name = (input.name ?? existing?.name ?? `Mon ${base.name}`)
      .trim()
      .slice(0, 40);
    if (!name) throw Object.assign(new Error('name_required'), { status: 400 });
    const v: Variant = {
      id: existing?.id ?? newId(),
      name,
      base: existing?.base ?? base.id,
      settings: parsed.data,
      updated_at: at,
    };
    if (!existing && this.s.variants.length >= 40)
      throw Object.assign(new Error('too_many_variants'), { status: 409 });
    this.s = {
      ...this.s,
      variants: existing
        ? this.s.variants.map((x) => (x.id === v.id ? v : x))
        : [...this.s.variants, v],
    };
    await this.save();
    return v;
  }

  async duplicate(id: string, name?: string | null) {
    const src =
      this.s.variants.find((v) => v.id === id) ??
      (builtin(id)
        ? {
            name: builtin(id)!.name,
            base: id,
            settings: builtin(id)!.settings,
          }
        : null);
    if (!src) throw Object.assign(new Error('unknown_preset'), { status: 404 });
    return this.saveVariant({
      base: src.base,
      name: name ?? `${src.name} (copie)`.slice(0, 40),
      settings: src.settings,
    });
  }

  async rename(id: string, name: string) {
    const v = this.s.variants.find((x) => x.id === id);
    if (!v) throw Object.assign(new Error('unknown_preset'), { status: 404 });
    return this.saveVariant({ id, base: v.base, name, settings: v.settings });
  }

  /** Back to its built-in preset's values (the name stays). */
  async reset(id: string) {
    const v = this.s.variants.find((x) => x.id === id);
    if (!v) throw Object.assign(new Error('unknown_preset'), { status: 404 });
    return this.saveVariant({
      id,
      base: v.base,
      name: v.name,
      settings: builtin(v.base)!.settings,
    });
  }

  async remove(id: string) {
    if (!this.s.variants.some((v) => v.id === id))
      throw Object.assign(new Error('unknown_preset'), { status: 404 });
    const variants = this.s.variants.filter((v) => v.id !== id);
    // The one on stream deleted: back to its built-in look (never an empty overlay).
    const gone = this.s.variants.find((v) => v.id === id)!;
    this.s = {
      ...this.s,
      variants,
      active: this.s.active === id ? gone.base : this.s.active,
    };
    await this.save();
  }
}

const newId = () => `v-${randomBytes(6).toString('hex').slice(0, 8)}`;
