import { z } from 'zod';

// Effects player (P0.1, 17/10/2026) — the catalogue of effect sounds Studio can play at once on its effects player (an
// OBS browser source), outside the Soundboard: no queue, no price, no cooldown, never offered in the extension. Fixed
// in code (no import from Studio): each entry is a media of Studio's storage, imported by copy from its original
// (apps/studio/server/src/effects/import-cli.ts), named by its original file. `volume` is the original playback volume
// (SAMMI button, 0-100), the default of a new rule. Neutral ids (the sound, never a Twitch reward).

export const EFFECT_SOUNDS = [
  {
    id: 'eren-scream',
    label: 'Eren — cri',
    file: 'ErenScream.ogg',
    volume: 100,
  },
  {
    id: 'tiens-bon',
    label: 'Tiens bon !',
    file: 'Tiens bon !.ogg',
    volume: 41,
  },
  {
    id: 'quoicoubaka-bibou',
    label: 'Quoicoubaka bibou',
    file: 'Quoicoubaka bibou.ogg',
    volume: 85,
  },
  {
    id: 'pas-mal-les-bzez',
    label: 'Pas mal les bzez',
    file: 'Pas mal les bzez_1.ogg',
    volume: 84,
  },
  {
    id: 'glory-holes',
    label: 'Glory holes',
    file: 'Glory holes.ogg',
    volume: 100,
  },
  {
    id: 'karma-arreteuh',
    label: 'Karma — Arrêteuh',
    file: 'Karma Arreteuh.ogg',
    volume: 100,
  },
] as const;

export type EffectSound = (typeof EFFECT_SOUNDS)[number];

export const EffectSoundId = z.enum(
  EFFECT_SOUNDS.map((s) => s.id) as [EffectSound['id'], ...EffectSound['id'][]],
);
export type EffectSoundId = z.infer<typeof EffectSoundId>;

/** Effect volume, in percent of the file's level (0 = muted, 100 = as recorded). */
export const EffectVolume = z.number().int().min(0).max(100);

/**
 * Effect videos (P0.2): full-frame videos (1920×1080, object-fit contain) played at once by the effects player, over
 * everything, with their own sound. Each entry carries the legacy presentation, copied from its original overlay:
 * - `volume`: the legacy effective volume (overlay value × its global volume), the default of a new rule;
 * - `mirror`: chance of a horizontal mirror per play;
 * - `rise`: slides up from +550 px (2.2 s, linear) while fading in (220 ms), fades out (500 ms) before its end;
 * - `ducking`: several plays of the same video at once — each one's volume = max(volume × min, volume − (n − 1) ×
 *   volume × step), only the `audible` oldest ones heard (the others muted), 450 ms ramps.
 */
export const EFFECT_VIDEOS = [
  {
    // NTM (SAMMI « ntm » → obs-browser event pdc_fuck_you → Alerte_system.html: volume 0.2 × VOLUME_GLOBAL 0.5,
    // minVolume 0.025, duckingStep 0.05, maxAudibleInstances 4, randomMirror 0.35, stacked, style default).
    id: 'fuck-you',
    label: 'NTM — Fuck You',
    file: 'Fuck You.webm',
    volume: 10,
    mirror: 0.35,
    rise: true,
    ducking: { audible: 4, step: 0.25, min: 0.125 },
  },
] as const;

export type EffectVideo = (typeof EFFECT_VIDEOS)[number];

export const EffectVideoId = z.enum(
  EFFECT_VIDEOS.map((v) => v.id) as [EffectVideo['id'], ...EffectVideo['id'][]],
);
export type EffectVideoId = z.infer<typeof EffectVideoId>;
