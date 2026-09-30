import type { TtsLabCast } from '@raptoru/schemas';
import { tierFor, type TtsRules } from './rules.js';

// TTS V2 cast catalog (what Core needs to decide the cast): characters, their voice pools with the
// legacy weights and categories, and each voice profile's rate (for the duration estimate).
// The visual side (media, calibration, bubble, timings) and the Web Speech matching live in the
// extension's `shared/tts-characters.js`, read by the extension and the Studio player; a Core test
// checks that both lists stay identical.

export type VoiceCategory = TtsLabCast['voice_category'];
export interface CastVoice {
  voice_profile_id: string;
  weight: number;
  category: VoiceCategory;
}
export interface CastCharacter {
  id: string;
  voices: CastVoice[];
}

/** Voice profile id → Web Speech rate (duration estimate only). */
export const VOICE_RATES: Record<string, number> = {
  'mikasa.julie': 0.94,
  'mikasa.hortense': 0.94,
  'mikasa.caroline': 0.94,
  'mikasa.haruka': 0.94,
  'mikasa.ayumi': 0.94,
  'mikasa.sayaka': 0.94,
  'c21.julie': 1.12,
  'c21.hortense': 1.12,
  'c21.nathalie': 1.12,
  'c21.sayaka': 1.12,
  'c21.ayumi': 1.12,
  'c21.haruka': 1.12,
  'zote.paul': 0.85,
  'zote.fr-male': 0.85,
  'andras.paul': 1,
  'andras.fr-male': 1,
  'golem.claude': 0.76,
  'golem.paul': 0.76,
  'variant.bourre': 0.35,
};

const v = (
  voice_profile_id: string,
  weight: number,
  category: VoiceCategory = 'normal',
): CastVoice => ({
  voice_profile_id,
  weight,
  category,
});

export const CAST_CATALOG: CastCharacter[] = [
  {
    id: 'mikasa',
    voices: [
      v('mikasa.julie', 4),
      v('mikasa.hortense', 2),
      v('mikasa.caroline', 1),
      v('mikasa.haruka', 1, 'japanese'),
      v('mikasa.ayumi', 1, 'japanese'),
      v('mikasa.sayaka', 1, 'japanese'),
    ],
  },
  {
    id: 'c21',
    voices: [
      v('c21.julie', 4),
      v('c21.hortense', 2),
      v('c21.nathalie', 1),
      v('c21.sayaka', 1, 'japanese'),
      v('c21.ayumi', 1, 'japanese'),
      v('c21.haruka', 1, 'japanese'),
    ],
  },
  {
    id: 'zote',
    voices: [
      v('zote.paul', 7),
      v('zote.fr-male', 3),
      v('variant.bourre', 1, 'variant'),
    ],
  },
  {
    id: 'andras',
    voices: [
      v('andras.paul', 10),
      v('andras.fr-male', 1),
      v('variant.bourre', 1, 'variant'),
    ],
  },
  {
    id: 'golem',
    voices: [
      v('golem.claude', 6),
      v('golem.paul', 4),
      v('variant.bourre', 1, 'variant'),
    ],
  },
];

const byId = new Map(CAST_CATALOG.map((c) => [c.id, c]));

/** A stored cast is still valid for the catalog (player / recovery checks). */
export function isKnownCast(
  characterId: string,
  voiceProfileId: string,
): boolean {
  return !!byId
    .get(characterId)
    ?.voices.some((x) => x.voice_profile_id === voiceProfileId);
}

function weighted(pool: CastVoice[], random: () => number): CastVoice {
  const total = pool.reduce((s, x) => s + x.weight, 0);
  let r = random() * total;
  for (const x of pool) {
    r -= x.weight;
    if (r < 0) return x;
  }
  return pool[pool.length - 1]!;
}

/** Variant label of a variant voice profile id (`variant.bourre` → `bourre`). */
const variantLabel = (voiceProfileId: string) =>
  voiceProfileId.split('.').pop()!;

/**
 * Legacy cast rules (TTS_System.html + tts-rules.js), decided once by Core at admission:
 * - character: uniform, never the same as the previous TTS of the channel;
 * - rare variant (« bourré ») first: base probability (per character override) × tier curve;
 * - then Japanese voices: 20 % × tier curve, for characters that have them;
 * - otherwise a normal voice by weight.
 * The viewer's visual preselection is never an input.
 */
export function pickCast(
  length: number,
  rules: TtsRules,
  random: () => number,
  lastCharacterId: string | null,
  catalog: CastCharacter[] = CAST_CATALOG,
): TtsLabCast {
  const candidates =
    catalog.length > 1
      ? catalog.filter((c) => c.id !== lastCharacterId)
      : catalog;
  const character = candidates[Math.floor(random() * candidates.length)]!;
  const curve = tierFor(length, rules).painful_voice_weight_multiplier;
  for (const voice of character.voices.filter(
    (x) => x.category === 'variant',
  )) {
    const variant =
      rules.voice_categories.variants[variantLabel(voice.voice_profile_id)];
    if (!variant) continue;
    const base =
      variant.character_probabilities[character.id] ?? variant.base_probability;
    if (random() < Math.min(1, base * curve))
      return {
        character_id: character.id,
        voice_profile_id: voice.voice_profile_id,
        voice_category: 'variant',
      };
  }
  const japanese = character.voices.filter((x) => x.category === 'japanese');
  if (
    japanese.length &&
    random() <
      Math.min(1, rules.voice_categories.japanese.base_probability * curve)
  ) {
    const pick = weighted(japanese, random);
    return {
      character_id: character.id,
      voice_profile_id: pick.voice_profile_id,
      voice_category: 'japanese',
    };
  }
  const pick = weighted(
    character.voices.filter((x) => x.category === 'normal'),
    random,
  );
  return {
    character_id: character.id,
    voice_profile_id: pick.voice_profile_id,
    voice_category: 'normal',
  };
}
