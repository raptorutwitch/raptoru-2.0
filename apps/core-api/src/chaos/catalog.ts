// Chaos V2 — the viewer catalogue as the Core decides it (docs/chaos/CONTRAT_LOT2.md § 2.4): presets, levels, controls,
// durations, the normalized choice, the engine request and the price. A PORT of the LOGIC of the extension's catalogue
// (apps/twitch-extension/extension/modules/interactions/catalog.js): same metadata, same functions, same arithmetic in
// the same order — labels, hints and phrases stay in the extension. Locked by apps/twitch-extension/test/
// chaos-core-parity.test.js: for every reachable setting of every effect, identical normalized choice, engine request
// and price. Change both files together, never one.
import { REGISTRY, type RegValue } from './registry.js';

/** Resolved engine parameters (numbers, enums, colours), as Params.Resolve gives them. */
export type Params = Readonly<Record<string, RegValue | undefined>>;
type Out = Record<string, RegValue>;
export type Opt = number | boolean | string | number[];
export interface Choice {
  style: string | null;
  level: string | null;
  duration: number;
  opts: Record<string, Opt>;
}
/** What a client sends (untrusted, already shape-checked by the route): every field optional. */
export interface ChoiceInput {
  style?: string | null;
  level?: string | null;
  duration?: number | null;
  opts?: Record<string, Opt | undefined>;
}
type When = (c: Choice) => boolean;
interface Transition {
  in: { kind: string; duration_ms?: number };
  out: { kind: string; duration_ms?: number };
}
export type Control =
  | {
      kind: 'choice';
      id: string;
      def: string;
      when?: When;
      options: { id: string; params?: Out; transition?: Transition }[];
    }
  | {
      kind: 'slider';
      id: string;
      param?: string;
      apply?: (v: number) => Out;
      min?: number;
      max?: number;
      step?: number;
      stops?: number[];
      def: number | 'variant' | 'level';
      when?: When;
    }
  | {
      kind: 'toggle';
      id: string;
      on?: Out;
      off?: Out;
      def: boolean;
      when?: When;
    }
  | { kind: 'hue'; id: string; param: string; def: number; when?: When }
  | {
      kind: 'point';
      id: string;
      params: [string, string];
      def: [number, number];
      when?: When;
    };
interface DurSpec {
  min: number;
  max: number;
  step: number;
  def: number;
}
export interface Preset {
  id: string;
  /** The registry variant this viewer preset plays (« Un clignement » = naturel). */
  variant?: string;
  default?: boolean;
  duration?: Partial<DurSpec> | { fixed: (c: Choice) => number };
  /** Quick purchases: N charges that come back with time instead of the per-viewer delay. */
  charges?: { max: number; rechargeS: number };
}
export interface Effect {
  id: string;
  label: string;
  slot: string;
  capture: boolean;
  photosensitive?: boolean;
  /** One for the whole channel every N s after its end (Flash). */
  globalCooldown?: number;
  presets?: Preset[];
  levels: { id: string; default?: boolean }[] | null;
  controls: Control[];
  duration: DurSpec;
  gene: (p: Params, c: Choice) => number;
}

/** Three duration ceilings (EXTENSION_INTERACTIONS.md § 5): the registry's, Studio's Safety, the range sold here. */
export const ENGINE = Object.freeze({
  minDurationS: REGISTRY.limits.min_duration_ms / 1000,
  maxDurationS: REGISTRY.limits.max_duration_ms / 1000,
  maxTransitionMs: REGISTRY.limits.max_transition_ms,
  safetyDurationS: REGISTRY.safetyDefaults.max_duration_ms / 1000,
  safetyMaxActive: REGISTRY.safetyDefaults.max_active_effects,
});
export const SLOTS: Readonly<Record<string, { capacity: number }>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(REGISTRY.slots).map(([id, s]) => [
        id,
        { capacity: s.max_active },
      ]),
    ),
  );

const DUR = (def = 10, max = 60, min = 5, step = 5): DurSpec => ({
  min,
  max,
  step,
  def,
});
const POINT: Control = {
  kind: 'point',
  id: 'point',
  params: ['focus_x', 'focus_y'],
  def: [0.5, 0.5],
};
/** Visible area of a disc of radius r (in screen heights), over the 16:9 screen. */
const visibleArea = (r: number) => Math.min(1, (Math.PI * r * r) / (16 / 9));
const shut = (c: Choice) => Number(c.opts.shut ?? 0.4);

type EffectDef = Omit<Effect, 'slot' | 'levels'> & {
  levels?: Effect['levels'];
};

// The 13 public effects of the engine, in the extension's order. `gene` = the gêne of the setting measured on the REAL
// resolved values (defaults → variant → level → request), relative to the effect's reference setting.
const DEFS: EffectDef[] = [
  {
    id: 'flip',
    label: 'Écran retourné',
    capture: true,
    presets: [{ id: 'rotate180', default: true }],
    controls: [
      {
        kind: 'choice',
        id: 'entry',
        def: 'ramp',
        options: [
          { id: 'ramp' },
          {
            id: 'slow',
            transition: {
              in: { kind: 'ramp', duration_ms: 1500 },
              out: { kind: 'ramp', duration_ms: 1500 },
            },
          },
          {
            id: 'cut',
            transition: { in: { kind: 'cut' }, out: { kind: 'cut' } },
          },
        ],
      },
    ],
    duration: DUR(10),
    gene: () => 1,
  },
  {
    id: 'mirror',
    label: 'Miroir',
    capture: true,
    presets: [
      { id: 'horizontal', default: true },
      { id: 'vertical' },
      { id: 'alterne' },
    ],
    controls: [
      {
        kind: 'choice',
        id: 'rhythm',
        def: 'normal',
        when: (c) => c.style === 'alterne',
        options: [
          { id: 'fast', params: { interval_ms: 2000 } },
          { id: 'normal', params: { interval_ms: 3000 } },
          { id: 'slow', params: { interval_ms: 5000 } },
        ],
      },
      {
        kind: 'choice',
        id: 'entry',
        def: 'card',
        options: [
          { id: 'card' },
          {
            id: 'cut',
            transition: { in: { kind: 'cut' }, out: { kind: 'cut' } },
          },
        ],
      },
    ],
    duration: DUR(10),
    gene: (p, c) =>
      c.style === 'alterne' ? 1 + 1.5 / (+p.interval_ms! / 1000) : 1,
  },
  {
    id: 'shake',
    label: 'Tremblement',
    capture: true,
    presets: [
      { id: 'leger' },
      { id: 'secousse', default: true },
      { id: 'vibration' },
      { id: 'rafales' },
      { id: 'seisme' },
      { id: 'impact', duration: { min: 3, max: 3, step: 1, def: 3 } },
    ],
    controls: [
      {
        kind: 'slider',
        id: 'intensity',
        param: 'intensity',
        min: 0.2,
        max: 1,
        step: 0.05,
        def: 'variant',
      },
    ],
    duration: DUR(10),
    gene: (p, c) => {
      const amp = Math.max(+p.amp_x!, +p.amp_y!) * +p.intensity!;
      const duty =
        (
          {
            impact: Math.min(1, ((+p.decay_ms! / 1000) * 2) / c.duration),
            rafales: Math.min(
              1,
              (+p.decay_ms! / 1000 + 0.05) / (+p.interval_ms! / 1000),
            ),
            seisme: 0.75,
          } as Record<string, number>
        )[String(p.mode)] ?? 1;
      return (amp * duty) / (2.4 * 0.7);
    },
  },
  {
    id: 'zoom',
    label: 'Zoom',
    capture: true,
    presets: [
      { id: 'progressif', default: true },
      { id: 'brutal' },
      { id: 'pulsations', duration: { min: 5, max: 20, step: 5, def: 10 } },
      { id: 'aller_retour', duration: { min: 5, max: 15, step: 5, def: 10 } },
      { id: 'intermittent', duration: { min: 5, max: 20, step: 5, def: 10 } },
    ],
    controls: [
      {
        kind: 'slider',
        id: 'factor',
        param: 'factor',
        min: 1.5,
        max: 6,
        step: 0.5,
        def: 'variant',
      },
      POINT,
    ],
    duration: DUR(10),
    gene: (p, c) => {
      const hidden = (1 - 1 / (+p.factor! * +p.factor!)) / 0.75;
      if (p.mode !== 'pulsations') return hidden;
      const zoomedS = Math.min(
        c.duration,
        (+p.pulses! * (+p.attack_ms! + +p.hold_ms! + +p.release_ms!)) / 1000,
      );
      return (hidden * durationFactor(zoomedS)) / durationFactor(c.duration);
    },
  },
  {
    id: 'drunk',
    label: 'Ivresse',
    capture: true,
    presets: [
      { id: 'pompette' },
      { id: 'ivre', default: true },
      { id: 'ivre_mort' },
      { id: 'vertige' },
    ],
    levels: [
      { id: 'leger', default: false },
      { id: 'marque', default: true },
      { id: 'extreme' },
    ],
    controls: [
      { kind: 'toggle', id: 'rising', on: { progression: 1 }, def: false },
    ],
    duration: DUR(15),
    gene: (p) => {
      const d =
        0.4 * (+p.sway! / 4) +
        0.3 * (+p.double! / 0.4) +
        0.3 * (+p.blur! / 0.25);
      return (
        (Math.sqrt(d) * +p.intensity! * (1 - +p.progression! / 2)) /
        (0.65 * 0.75)
      );
    },
  },
  {
    id: 'tunnel',
    label: 'Vision tunnel',
    capture: true,
    levels: [
      { id: 'leger' },
      { id: 'marque', default: true },
      { id: 'extreme' },
    ],
    controls: [
      {
        kind: 'choice',
        id: 'motion',
        def: 'fixe',
        options: [
          { id: 'fixe', params: { mode: 'fixe' } },
          { id: 'retrecit', params: { mode: 'retrecit' } },
          { id: 'derive', params: { mode: 'derive' } },
        ],
      },
      { kind: 'toggle', id: 'zoomOn', off: { zoom: 1 }, def: true },
      {
        kind: 'slider',
        id: 'zoom',
        param: 'zoom',
        min: 1.1,
        max: 3.5,
        step: 0.1,
        def: 'level',
        when: (c) => c.opts.zoomOn !== false,
      },
      POINT,
    ],
    duration: DUR(10),
    gene: (p) => {
      const r =
        p.mode === 'retrecit'
          ? (+p.radius! * (1 + +p.shrink!)) / 2
          : +p.radius!;
      const raw =
        +p.darkness! * (1 - visibleArea(r)) +
        visibleArea(r) * (1 - 1 / (+p.zoom! * +p.zoom!));
      return (
        raw /
        (0.93 * (1 - visibleArea(0.28)) + visibleArea(0.28) * (1 - 1 / 2.25))
      );
    },
  },
  {
    id: 'blink',
    label: 'Paupières',
    capture: false,
    presets: [
      { id: 'naturel', default: true },
      {
        id: 'ponctuel',
        variant: 'naturel',
        duration: { fixed: (c) => Math.max(2, Math.ceil(shut(c) + 1.6)) },
        charges: { max: 10, rechargeS: 6 },
      },
      { id: 'serie', duration: { min: 5, max: 60, step: 5, def: 10 } },
      { id: 'lent' },
      { id: 'fatigue' },
      { id: 'resistance' },
      { id: 'ferme', duration: { min: 3, max: 15, step: 1, def: 5 } },
    ],
    levels: [
      { id: 'leger' },
      { id: 'marque' },
      { id: 'extreme', default: true },
    ],
    controls: [
      {
        kind: 'slider',
        id: 'hold',
        min: 0.1,
        max: 5,
        step: 0.1,
        def: 0.1,
        when: (c) => c.style === 'naturel',
        apply: (v) => ({ hold_ms: Math.round(v * 1000) }),
      },
      {
        kind: 'slider',
        id: 'shut',
        min: 0.2,
        max: 3,
        step: 0.1,
        def: 0.4,
        when: (c) => c.style === 'ponctuel',
        apply: (v) => ({ hold_ms: Math.round(v * 1000) }),
      },
      {
        kind: 'slider',
        id: 'count',
        param: 'count',
        min: 2,
        max: 6,
        step: 1,
        def: 3,
        when: (c) => c.style === 'serie',
      },
      {
        kind: 'slider',
        id: 'pause',
        min: 1.5,
        max: 8,
        step: 0.5,
        def: 2,
        when: (c) => c.style === 'serie',
        apply: (v) => ({ interval_ms: Math.round(v * 1000) }),
      },
      {
        kind: 'slider',
        id: 'slowness',
        min: 0.3,
        max: 1.5,
        step: 0.1,
        def: 0.5,
        when: (c) => c.style === 'lent',
        apply: (v) => ({
          close_ms: Math.round(v * 1000),
          open_ms: Math.round(v * 900),
        }),
      },
    ],
    duration: DUR(10),
    gene: (p, c) => {
      const d = c.duration;
      const s = (+p.close_ms! / 2 + +p.hold_ms! + +p.open_ms! / 2) / 1000;
      const cycle = (+p.close_ms! + +p.hold_ms! + +p.open_ms!) / 1000;
      let frac: number;
      if (p.mode === 'ferme')
        frac = Math.max(0, d - (+p.close_ms! + +p.open_ms!) / 2000) / d;
      else if (p.mode === 'resistance') frac = 0.75;
      else if (p.mode === 'somnolence') frac = Math.min(1, 0.25 + 4 / d);
      else if (p.mode === 'serie')
        frac =
          (+p.count! * s) /
          (+p.count! * (cycle + 0.12) + +p.interval_ms! / 1000);
      else
        frac = Math.min(
          1,
          (s *
            Math.max(1, Math.floor(d / (cycle + +p.interval_ms! / 1000)) + 1)) /
            d,
        );
      return Math.min(1, frac) * Math.min(1, +p.intensity!);
    },
  },
  {
    id: 'flash',
    label: 'Flash',
    capture: false,
    photosensitive: true,
    globalCooldown: 60,
    presets: [
      { id: 'court' },
      { id: 'intense', default: true },
      { id: 'longue' },
    ],
    controls: [],
    duration: DUR(6, 9, 3, 3),
    gene: (p) =>
      (+p.blind_ms! + +p.recovery_ms! / 2 + (+p.ghost_ms! * +p.ghost!) / 6) /
      (1400 + 1300 + 750),
  },
  {
    id: 'fog',
    label: 'Brouillard',
    capture: false,
    presets: [{ id: 'nappes', default: true }],
    levels: [
      { id: 'marque', default: true },
      { id: 'dense' },
      { id: 'extreme' },
    ],
    controls: [],
    duration: DUR(15, 60, 10),
    gene: (p) =>
      (+p.density! * +p.opacity! * (0.6 + 0.4 * +p.thickness!)) /
      (0.6 * 0.85 * 0.68),
  },
  {
    id: 'blur',
    label: 'Flou',
    capture: true,
    presets: [
      { id: 'constant', default: true },
      { id: 'pulse' },
      { id: 'progressif' },
      { id: 'vague' },
    ],
    controls: [
      {
        kind: 'slider',
        id: 'amount',
        param: 'amount',
        min: 15,
        max: 95,
        step: 5,
        def: 55,
      },
    ],
    duration: DUR(10),
    gene: (p) => {
      const avg =
        p.mode === 'constant'
          ? +p.amount!
          : p.mode === 'progressif'
            ? +p.amount! / 2
            : (+p.amount! + +p.minimum!) / 2;
      return avg / 55;
    },
  },
  {
    id: 'pixelate',
    label: 'Pixelisation',
    capture: true,
    presets: [
      { id: 'constante', default: true },
      { id: 'progressive' },
      { id: 'intermittente' },
    ],
    controls: [
      {
        kind: 'slider',
        id: 'block',
        param: 'block',
        stops: [6, 8, 10, 14, 20, 28, 40, 56, 80, 112],
        def: 28,
      },
    ],
    duration: DUR(10),
    gene: (p) => Math.sqrt(+p.block! / 28) * (p.mode === 'constant' ? 1 : 0.55),
  },
  {
    id: 'color',
    label: 'Couleur',
    capture: true,
    presets: [
      { id: 'nb', default: true },
      { id: 'film_noir' },
      { id: 'sepia' },
      { id: 'inversion' },
      { id: 'delave' },
      { id: 'sature' },
      { id: 'rouge' },
    ],
    controls: [
      {
        kind: 'slider',
        id: 'saturation',
        param: 'saturation',
        min: 1.5,
        max: 3,
        step: 0.25,
        def: 'variant',
        when: (c) => c.style === 'sature',
      },
      {
        kind: 'hue',
        id: 'hue',
        param: 'tint',
        def: 350,
        when: (c) => c.style === 'rouge',
      },
    ],
    duration: DUR(15),
    gene: (p) =>
      (
        ({
          inversion: 1.5,
          nb: +p.contrast! > 1.3 ? 1.2 : 1,
          sepia: 0.9,
          teinte: 1,
          desature: 0.6,
          sature: 0.5 + 0.2 * (+p.saturation! - 1.5),
        }) as Record<string, number>
      )[String(p.mode)] ?? 1,
  },
  {
    id: 'vhs',
    label: 'VHS / glitch',
    capture: true,
    presets: [
      { id: 'legere' },
      { id: 'abimee', default: true },
      { id: 'tracking' },
      { id: 'glitch_bref' },
      { id: 'glitch_violent' },
    ],
    controls: [],
    duration: DUR(10),
    gene: (p) =>
      (0.4 * +p.intensity! +
        0.3 * +p.tracking! +
        0.3 * +p.glitch! * (0.5 + 0.5 * +p.glitch_rate!)) /
      (0.4 * 0.85 + 0.3 * 0.5 + 0.3 * 0.3 * 0.65),
  },
];

export const EFFECTS: readonly Effect[] = Object.freeze(
  DEFS.map((e) => ({
    slot: REGISTRY.effects[e.id]!.slot,
    ...e,
    levels: e.levels ?? null,
  })),
);

/** Fourchettes chosen by Antoni on 28/11 (one activation, mildest to most severe setting, in Jetons). */
export const PRICE_RANGES: Readonly<Record<string, readonly [number, number]>> =
  Object.freeze({
    color: [8000, 25000],
    vhs: [5000, 25000],
    pixelate: [15000, 100000],
    blur: [15000, 100000],
    shake: [5000, 35000],
    zoom: [10000, 75000],
    drunk: [10000, 75000],
    tunnel: [10000, 75000],
    mirror: [15000, 75000],
    fog: [15000, 100000],
    blink: [5000, 90000],
    flash: [8000, 25000],
    flip: [25000, 100000],
  });

const BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));
export const effectById = (id: string) => BY_ID.get(id) ?? null;
export const presetOf = (e: Effect, c: { style: string | null }) =>
  e.presets?.find((s) => s.id === c.style) ?? null;
export const variantOf = (e: Effect, c: { style: string | null }) =>
  presetOf(e, c)?.variant ?? presetOf(e, c)?.id ?? null;
export const controlsFor = (e: Effect, c: Choice) =>
  e.controls.filter((k) => !k.when || k.when(c));

export interface DurationRange extends DurSpec {
  fixed: boolean;
}

/** Duration range sold for this setting: the preset's, else the effect's, under the Safety ceiling (capS). */
export function durationRange(
  e: Effect,
  c: Choice,
  capS: number = ENGINE.safetyDurationS,
): DurationRange {
  const p = presetOf(e, c)?.duration;
  if (p && 'fixed' in p) {
    const s = Math.min(p.fixed(c), capS, ENGINE.maxDurationS);
    return { min: s, max: s, step: 1, def: s, fixed: true };
  }
  const r = { ...e.duration, ...(p ?? {}) };
  const max = Math.max(r.min, Math.min(r.max, capS, ENGINE.maxDurationS));
  return {
    min: r.min,
    max,
    step: r.step,
    def: Math.min(r.def, max),
    fixed: false,
  };
}

/** A control's default: fixed, or what the preset / level gives its parameter (`'variant'`, `'level'`). */
function controlDefault(e: Effect, c: Choice, k: Control): Opt {
  if (k.def !== 'variant' && k.def !== 'level') return k.def;
  const param = 'param' in k ? k.param : undefined;
  return resolveParams(e, { ...c, opts: {} })[param ?? ''] as Opt;
}

export function defaultChoice(e: Effect): Choice {
  const c: Choice = {
    style: (e.presets?.find((s) => s.default) ?? e.presets?.[0])?.id ?? null,
    level: e.levels?.find((l) => l.default)?.id ?? null,
    duration: 10,
    opts: {},
  };
  for (const k of e.controls)
    if (!(k.id in c.opts)) c.opts[k.id] = controlDefault(e, c, k);
  c.duration = durationRange(e, c).def;
  return c;
}

const snap = (k: Extract<Control, { kind: 'slider' }>, v: number) => {
  if (k.stops)
    return k.stops.reduce(
      (best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best),
      k.stops[0]!,
    );
  return Math.min(k.max!, Math.max(k.min!, Math.round(v / k.step!) * k.step!));
};

/**
 * A setting consistent with the catalogue and the ceiling (unknown values → default). `reset`: the controls that follow
 * the preset / level go back to its value (the viewer just changed it).
 */
export function normalizeChoice(
  e: Effect,
  c: ChoiceInput | Choice | null | undefined,
  capS: number,
  { reset = false }: { reset?: boolean } = {},
): Choice {
  const out = defaultChoice(e);
  if (c?.style && e.presets?.some((s) => s.id === c.style)) out.style = c.style;
  if (c?.level && e.levels?.some((l) => l.id === c.level)) out.level = c.level;
  for (const k of e.controls) {
    const v =
      reset && (k.def === 'variant' || k.def === 'level')
        ? undefined
        : c?.opts?.[k.id];
    if (v === undefined) {
      out.opts[k.id] = controlDefault(e, out, k);
      continue;
    }
    if (k.kind === 'choice' && k.options.some((o) => o.id === v))
      out.opts[k.id] = v;
    else if (k.kind === 'slider' && Number.isFinite(Number(v)))
      out.opts[k.id] = Math.round(snap(k, Number(v)) * 1000) / 1000;
    else if (k.kind === 'point' && Array.isArray(v))
      out.opts[k.id] = v.map((x) =>
        Math.min(1, Math.max(0, Math.round(Number(x) * 100) / 100 || 0)),
      );
    else if (k.kind === 'hue' && Number.isFinite(Number(v)))
      out.opts[k.id] = ((Math.round(Number(v)) % 360) + 360) % 360;
    else if (k.kind === 'toggle') out.opts[k.id] = Boolean(v);
    else out.opts[k.id] = controlDefault(e, out, k);
  }
  const range = durationRange(e, out, capS);
  const d = Number(c?.duration);
  out.duration = range.fixed
    ? range.def
    : Number.isFinite(d)
      ? Math.min(
          range.max,
          Math.max(range.min, Math.round(d / range.step) * range.step),
        )
      : range.def;
  return out;
}

/** Hue (0–360°) → #rrggbb (saturation 65 %, lightness 50 %): what the engine's colour parameter receives. */
export function hueHex(h: number) {
  const s = 0.65;
  const l = 0.5;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** Parameters and transition the controls ask for (the « request » layer of the engine). */
function requestParts(e: Effect, c: Choice) {
  const params: Record<string, RegValue | undefined> = {};
  let transition: Transition | null = null;
  for (const k of controlsFor(e, c)) {
    const v = c.opts?.[k.id];
    if (v === undefined) continue; // not set yet: the engine keeps the preset's value
    if (k.kind === 'choice') {
      const o = k.options.find((x) => x.id === v);
      Object.assign(params, o?.params ?? {});
      if (o?.transition) transition = o.transition;
    } else if (k.kind === 'slider')
      Object.assign(
        params,
        k.apply ? k.apply(v as number) : { [k.param!]: v as number },
      );
    else if (k.kind === 'point') {
      const [x, y] = v as number[];
      params[k.params[0]] = x;
      params[k.params[1]] = y;
    } else if (k.kind === 'hue') params[k.param] = hueHex(v as number);
    else if (k.kind === 'toggle')
      Object.assign(params, (v ? k.on : k.off) ?? {});
  }
  return { params, transition };
}

/** Parameters as the engine resolves them: defaults → variant → level → request (Params.Resolve). */
export function resolveParams(e: Effect, c: Choice): Params {
  const r = REGISTRY.effects[e.id];
  if (!r) return {};
  const p: Record<string, RegValue | undefined> = Object.fromEntries(
    Object.entries(r.params).map(([k, v]) => [k, v.def]),
  );
  const variant = variantOf(e, c);
  if (variant) Object.assign(p, r.variants[variant]?.params ?? {});
  if (c.level) Object.assign(p, r.levels[c.level]?.params ?? {});
  Object.assign(p, requestParts(e, c).params);
  return p;
}

export interface EngineRequest {
  effect: string;
  duration_ms: number;
  variant?: string;
  level?: string;
  params?: Record<string, RegValue | undefined>;
  transition?: Transition;
}

/** What the Core sends to the engine for this setting (external source: exposed parameters only). */
export function engineRequest(e: Effect, c: Choice): EngineRequest {
  const { params, transition } = requestParts(e, c);
  const req: EngineRequest = {
    effect: e.id,
    duration_ms: Math.round(c.duration * 1000),
  };
  const variant = variantOf(e, c);
  if (variant) req.variant = variant;
  if (c.level) req.level = c.level;
  if (Object.keys(params).length) req.params = params;
  if (transition) req.transition = transition;
  return req;
}

/** Duration: a fixed part plus a part per second — 10 s ×1, 30 s ×2.4, 60 s ×4.5. */
export const durationFactor = (s: number) =>
  Math.round((0.3 + 0.07 * s) * 1000) / 1000;

export function gene(e: Effect, c: Choice) {
  return Math.max(0.05, e.gene(resolveParams(e, c), c));
}

/** Raw severity: measured gêne × duration factor. */
export const severity = (e: Effect, c: Choice) =>
  gene(e, c) * durationFactor(c.duration);

/** Every reachable setting of an effect under a ceiling (presets × levels × control extremes × durations). */
export function* reachableSettings(
  e: Effect,
  capS: number = ENGINE.maxDurationS,
): Generator<Choice> {
  for (const style of e.presets?.map((x) => x.id) ?? [null])
    for (const level of e.levels?.map((l) => l.id) ?? [null]) {
      const c0 = normalizeChoice(e, { style, level }, capS, { reset: true });
      const variants = [c0];
      for (const k of controlsFor(e, c0)) {
        const values: Opt[] =
          k.kind === 'choice'
            ? k.options.map((o) => o.id)
            : k.kind === 'slider'
              ? k.stops
                ? [k.stops[0]!, k.stops.at(-1)!]
                : [k.min!, k.max!]
              : k.kind === 'toggle'
                ? [true, false]
                : [];
        for (const v of values)
          variants.push(
            normalizeChoice(
              e,
              { ...c0, opts: { ...c0.opts, [k.id]: v } },
              capS,
            ),
          );
      }
      for (const c of variants) {
        const r = durationRange(e, c, capS);
        for (const d of r.fixed ? [r.def] : [r.min, r.max])
          yield normalizeChoice(e, { ...c, duration: d }, capS);
      }
    }
}

const maxSeverityMemo = new Map<string, number>();
/** The effect's most severe setting (under the absolute 60 s ceiling): the one that costs the maximum. */
export function maxSeverity(e: Effect) {
  if (!maxSeverityMemo.has(e.id)) {
    let m = 0;
    for (const c of reachableSettings(e)) m = Math.max(m, severity(e, c));
    maxSeverityMemo.set(e.id, m);
  }
  return maxSeverityMemo.get(e.id)!;
}

/** Price by range: min + (max − min) × S, S = severity / the effect's maximum severity (0 < S ≤ 1), rounded to 50. */
export function rangePrice(e: Effect, c: Choice) {
  const [lo, hi] = PRICE_RANGES[e.id]!;
  const share = Math.min(1, severity(e, c) / maxSeverity(e));
  return {
    total: Math.round((lo + (hi - lo) * share) / 50) * 50,
    share,
    range: [lo, hi] as [number, number],
  };
}
