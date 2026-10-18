import { z } from 'zod';

// FX Cam (P0.2, 18/10/2026, docs/EFFECTS_PLAYER.md § 11) — the SAMMI « FX cam » reward: the viewer types the name of a
// camera effect; OBS renders it (one obs-shaderfilter filter per effect on the scene « overlay cam shushu », each with
// its own entry / hold / exit animation on elapsed_time_enable). Raptoru only enables the filter for `durationMs`, then
// disables it. The viewer's text only SELECTS an entry of this fixed list: never a filter name of its own, never code.
// Adding an effect = a filter in OBS + its name here.

export const FX_CAM = {
  /** The scene the filters are on (filters of a scene). */
  source: 'overlay cam shushu',
  /** SAMMI: a 100 counter decremented by a 100 ms timer (« FX JANITOR ») → about 10 s; every shader ends before. */
  durationMs: 10_000,
  /** SAMMI only accepts the scenes with the camera (« Y'a pas de cam là... » elsewhere). */
  from: ['Scène Dessin', 'Scène Fullscreen'],
  /** The filters SAMMI accepts (its order: the list shown to viewers). */
  effects: ['prison', 'bighead', 'pixel', 'drunk', 'glitch', 'rage'],
} as const;

export const FxCamEffectId = z.enum(FX_CAM.effects);
export type FxCamEffectId = z.infer<typeof FxCamEffectId>;

/**
 * The viewer's text → an allowed effect, or null. As SAMMI: case ignored, surrounding spaces ignored; also any space
 * inside (« big head »). No alias: SAMMI had none.
 */
export function resolveFxCam(text: string | null | undefined) {
  const name = (text ?? '').toLowerCase().replace(/\s+/g, '');
  return FxCamEffectId.safeParse(name).data ?? null;
}
