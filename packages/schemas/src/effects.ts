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
