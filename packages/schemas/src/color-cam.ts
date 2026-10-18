import { z } from 'zod';

// Couleur Cam (P0.2, 18/10/2026, docs/EFFECTS_PLAYER.md § 12) — the SAMMI « Couleur Cam » reward (button ID45 « Couleur
// Shushu »): the viewer types a colour; the Shushu cam frame (browser source « Overlay Shushu ») takes it through a
// native OBS « Correction des couleurs » filter, animated in 2 s (SAMMI « Motion: Filter Settings », smooth In/Out). The
// colour stays until the next one (no reset). SAMMI drove the filter of the group « Groupe 2 » (which only holds
// « Overlay Shushu »); Raptoru drives a dedicated filter on the source itself (decided by Antoni, 18/10/2026). The
// viewer's text only SELECTS a preset of this fixed list: never an OBS value of its own.

/** The 26 SAMMI presets, values exactly as in SAMMI (its order: index → the four lists of the button). */
export const COLOR_CAM_PRESETS = [
  {
    name: 'saumon',
    hue_shift: 2.09,
    contrast: 2.4,
    brightness: -0.1163,
    saturation: -0.53,
  },
  {
    name: 'fuschia',
    hue_shift: 31,
    contrast: 1.08,
    brightness: -0.0233,
    saturation: -0.28,
  },
  {
    name: 'magenta',
    hue_shift: 55,
    contrast: 0.38,
    brightness: -0.0233,
    saturation: 0,
  },
  {
    name: 'violet',
    hue_shift: 80,
    contrast: -0.58,
    brightness: -0.0233,
    saturation: 1.97,
  },
  {
    name: 'myrtille',
    hue_shift: 100.47,
    contrast: -0.58,
    brightness: 0.0465,
    saturation: 1.06,
  },
  {
    name: 'bleu sombre',
    hue_shift: 100.47,
    contrast: -0.17,
    brightness: -0.1279,
    saturation: 0.63,
  },
  {
    name: 'bleu',
    hue_shift: 144.42,
    contrast: -0.21,
    brightness: -0.0349,
    saturation: 3.19,
  },
  {
    name: 'cyan',
    hue_shift: 163.26,
    contrast: -0.21,
    brightness: -0.0349,
    saturation: 3.19,
  },
  {
    name: 'turquoise',
    hue_shift: 180,
    contrast: 0,
    brightness: -0.0116,
    saturation: 2.22,
  },
  {
    name: 'orange',
    hue_shift: -18.84,
    contrast: 0.08,
    brightness: 0.0233,
    saturation: 1.5,
  },
  {
    name: 'gold',
    hue_shift: -29.3,
    contrast: 0.38,
    brightness: 0.0233,
    saturation: 5,
  },
  {
    name: 'jaune',
    hue_shift: -49,
    contrast: -0.08,
    brightness: 0.0233,
    saturation: 3.59,
  },
  {
    name: 'lime',
    hue_shift: -73,
    contrast: -0.08,
    brightness: 0.0233,
    saturation: 1.97,
  },
  {
    name: 'vert pomme',
    hue_shift: -89,
    contrast: -0.37,
    brightness: -0.0581,
    saturation: 2.91,
  },
  {
    name: 'vert',
    hue_shift: -108.84,
    contrast: 0.04,
    brightness: -0.2209,
    saturation: 1.38,
  },
  {
    name: 'emeraude',
    hue_shift: -144.42,
    contrast: -0.42,
    brightness: 0,
    saturation: 2.28,
  },
  {
    name: 'rouge',
    hue_shift: 0,
    contrast: -0.42,
    brightness: 0,
    saturation: 1.97,
  },
  {
    name: 'ivoire',
    hue_shift: 0,
    contrast: 2.83,
    brightness: 0.0465,
    saturation: -1,
  },
  {
    name: 'gris',
    hue_shift: 0,
    contrast: 0,
    brightness: -0.0233,
    saturation: -1,
  },
  {
    name: 'canard',
    hue_shift: -180,
    contrast: 0,
    brightness: -0.0233,
    saturation: -0.53,
  },
  {
    name: 'marron',
    hue_shift: -23.02,
    contrast: -0.67,
    brightness: -0.0233,
    saturation: -0.47,
  },
  {
    name: 'givre',
    hue_shift: 173.72,
    contrast: 3,
    brightness: -0.0233,
    saturation: -0.78,
  },
  {
    name: 'rose',
    hue_shift: 52.33,
    contrast: 1.96,
    brightness: -0.0233,
    saturation: -0.72,
  },
  {
    name: 'beige',
    hue_shift: -8.37,
    contrast: 1.96,
    brightness: -0.0233,
    saturation: -0.72,
  },
  {
    name: 'bleu ciel',
    hue_shift: -180,
    contrast: 1.96,
    brightness: -0.0233,
    saturation: -0.72,
  },
  {
    name: 'noir',
    hue_shift: 100,
    contrast: -0.67,
    brightness: -0.1279,
    saturation: -1,
  },
] as const;

export const COLOR_CAM = {
  /** The Shushu cam frame (browser source) and the dedicated native filter Antoni adds on it. */
  source: 'Overlay Shushu',
  filter: 'Raptoru — Couleur Cam',
  /** SAMMI: four « Motion: Filter Settings » of 2000 ms, smooth In/Out. */
  transitionMs: 2000,
  /** SAMMI only accepts the scenes with the camera (refund « pas la bonne scène » elsewhere). */
  from: ['Scène Dessin', 'Scène Fullscreen'],
  /** Fixed gamma of the SAMMI filter (« Groupe 2 », never animated by SAMMI): the presets were tuned on it. */
  gamma: 0.47,
  /** SAMMI aliases for a random preset (before accents are dropped: « aléatoire »). */
  random: ['aleatoire', 'random'],
} as const;

export const ColorCamId = z.enum(
  COLOR_CAM_PRESETS.map((p) => p.name) as [string, ...string[]],
);
export type ColorCamId = z.infer<typeof ColorCamId>;

/** A colour's filter settings (the native colour correction filter's keys). */
export function colorCamSettings(name: ColorCamId) {
  const p = COLOR_CAM_PRESETS.find((x) => x.name === name)!;
  return {
    gamma: COLOR_CAM.gamma,
    contrast: p.contrast,
    brightness: p.brightness,
    saturation: p.saturation,
    hue_shift: p.hue_shift,
  };
}

/**
 * The viewer's text → a preset, or null. SAMMI matched the exact text; here case, accents and extra spaces are ignored
 * (« Bleu  Ciel » = bleu ciel, « émeraude » = emeraude). « aléatoire » / « random »: a preset at random (as SAMMI).
 */
export function resolveColorCam(
  text: string | null | undefined,
  random: () => number = Math.random,
): ColorCamId | null {
  const name = (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  if ((COLOR_CAM.random as readonly string[]).includes(name))
    return COLOR_CAM_PRESETS[
      Math.min(
        COLOR_CAM_PRESETS.length - 1,
        Math.floor(random() * COLOR_CAM_PRESETS.length),
      )
    ]!.name;
  return ColorCamId.safeParse(name).data ?? null;
}
