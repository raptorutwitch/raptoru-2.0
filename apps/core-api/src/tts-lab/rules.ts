// TTS V2 rules: single server-side source of pricing, cooldowns, queue capacity and voice-category
// probabilities. Values ported as is from the legacy production rules (`ebs/core/tts-rules.js`,
// "tts-anti-abuse-v1"); what is new is marked. The client never owns a copy of these values: it
// only displays the public projection sent by Core.

export interface TtsTier {
  id: string;
  min: number;
  /** null = open-ended last tier. */
  max: number | null;
  price_multiplier: number;
  /** Cost when paying with TTS credits (legacy: one channel-points redemption = one TTS). */
  credit_cost: number;
  cooldown_seconds: number;
  /** Multiplier applied to the rare voice categories (japanese / variants) for long messages. */
  painful_voice_weight_multiplier: number;
}

export interface TtsRules {
  version: string;
  base_price: number;
  /** Technical safety cap (code points). Legacy: 800. Long messages stay allowed (tiers). */
  max_chars: number;
  max_per_viewer: number;
  /** Waiting TTS (queued / starting); the one playing does not count (legacy). */
  max_waiting_global: number;
  /** Optional cap on the total estimated duration waiting (ms); null = no cap. */
  max_waiting_weight_ms: number | null;
  tiers: TtsTier[];
  voice_categories: {
    japanese: { base_probability: number };
    variants: Record<
      string,
      {
        base_probability: number;
        character_probabilities: Record<string, number>;
      }
    >;
  };
  speech: {
    /** Estimate of French Web Speech output at rate 1 (characters per second). */
    chars_per_second: number;
    /** Narration « <pseudo> a dit », entry and exit animations around the speech. */
    overhead_ms: number;
  };
  /** Breathing time between two TTS (the player waits it; also part of the wait estimate). */
  transition_gap_ms: number;
  /** A queued TTS not started within this delay fails (and is refunded). */
  expires_after_ms: number;
  /** Lease of a claimed TTS until the player reports `started`. */
  claim_lease_ms: number;
  /** Once playing: estimated duration × this factor + margin, until `completed`. */
  playing_lease_factor: number;
  playing_lease_margin_ms: number;
  heartbeat_fresh_ms: number;
}

export const DEFAULT_TTS_RULES: TtsRules = {
  version: 'tts-v2-lab-1 (legacy tts-anti-abuse-v1)',
  base_price: 7_500,
  max_chars: 2_000, // new: legacy hard limit 800, raised as a safety cap only (priced by tiers)
  max_per_viewer: 1,
  max_waiting_global: 5,
  max_waiting_weight_ms: null, // new: configurable, off by default (no legacy value)
  tiers: [
    {
      id: '1-80',
      min: 1,
      max: 80,
      price_multiplier: 1,
      credit_cost: 1,
      cooldown_seconds: 60,
      painful_voice_weight_multiplier: 1,
    },
    {
      id: '81-150',
      min: 81,
      max: 150,
      price_multiplier: 1.5,
      credit_cost: 1,
      cooldown_seconds: 90,
      painful_voice_weight_multiplier: 0.8,
    },
    {
      id: '151-300',
      min: 151,
      max: 300,
      price_multiplier: 2,
      credit_cost: 1,
      cooldown_seconds: 120,
      painful_voice_weight_multiplier: 0.5,
    },
    {
      id: '301-500',
      min: 301,
      max: 500,
      price_multiplier: 3,
      credit_cost: 1,
      cooldown_seconds: 180,
      painful_voice_weight_multiplier: 0.25,
    },
    {
      id: '501+',
      min: 501,
      max: null,
      price_multiplier: 5,
      credit_cost: 1,
      cooldown_seconds: 300,
      painful_voice_weight_multiplier: 0.1,
    },
  ],
  voice_categories: {
    japanese: { base_probability: 0.2 },
    variants: {
      bourre: {
        base_probability: 0.25,
        character_probabilities: { golem: 0.5 },
      },
    },
  },
  speech: { chars_per_second: 13.5, overhead_ms: 2_400 },
  transition_gap_ms: 1_500,
  expires_after_ms: 30 * 60_000,
  claim_lease_ms: 30_000,
  playing_lease_factor: 2,
  playing_lease_margin_ms: 30_000,
  heartbeat_fresh_ms: 10_000,
};

/** Validates a partial override (stored in tts_lab_settings.rules) against the defaults. */
export function resolveTtsRules(override: unknown): TtsRules {
  if (!override || typeof override !== 'object') return DEFAULT_TTS_RULES;
  const merged = { ...DEFAULT_TTS_RULES, ...(override as Partial<TtsRules>) };
  const tiers = merged.tiers;
  if (!Array.isArray(tiers) || !tiers.length)
    throw new Error('invalid_tts_rules:tiers');
  let expected = 1;
  tiers.forEach((t, i) => {
    if (t.min !== expected || (t.max !== null && t.max < t.min))
      throw new Error('invalid_tts_rules:tier_range');
    if (t.max === null && i !== tiers.length - 1)
      throw new Error('invalid_tts_rules:open_tier');
    if (
      !(t.price_multiplier > 0) ||
      !(t.credit_cost >= 0) ||
      !(t.cooldown_seconds >= 0)
    )
      throw new Error('invalid_tts_rules:tier_values');
    expected = t.max === null ? Infinity : t.max + 1;
  });
  if (tiers.at(-1)!.max !== null)
    throw new Error('invalid_tts_rules:last_tier');
  if (
    !(merged.max_chars > 0) ||
    !(merged.max_waiting_global > 0) ||
    !(merged.max_per_viewer > 0)
  )
    throw new Error('invalid_tts_rules:limits');
  return merged;
}

export function tierFor(length: number, rules: TtsRules): TtsTier {
  const n = Math.max(1, Math.trunc(length));
  const tier = rules.tiers.find(
    (t) => n >= t.min && (t.max === null || n <= t.max),
  );
  if (!tier) throw new Error('tts_tier_not_found');
  return tier;
}

export interface TtsQuote {
  length: number;
  tier_id: string;
  price: number;
  credit_cost: number;
  cooldown_seconds: number;
}

export function quote(length: number, rules: TtsRules): TtsQuote {
  const tier = tierFor(length, rules);
  return {
    length,
    tier_id: tier.id,
    price: Math.round(rules.base_price * tier.price_multiplier),
    credit_cost: tier.credit_cost,
    cooldown_seconds: tier.cooldown_seconds,
  };
}

/** Estimated reading time: narration + animations + text at the voice's rate. */
export function estimateDurationMs(
  length: number,
  voiceRate: number,
  rules: TtsRules,
): number {
  const cps = rules.speech.chars_per_second * Math.max(0.2, voiceRate);
  return Math.round(rules.speech.overhead_ms + (length / cps) * 1000);
}

/** Public projection for the extension (prices, cooldowns, caps). No probabilities needed there. */
export function publicRules(rules: TtsRules) {
  return {
    version: rules.version,
    base_price: rules.base_price,
    max_chars: rules.max_chars,
    tiers: rules.tiers.map(
      ({ id, min, max, price_multiplier, credit_cost, cooldown_seconds }) => ({
        id,
        min,
        max,
        price: Math.round(rules.base_price * price_multiplier),
        credit_cost,
        cooldown_seconds,
      }),
    ),
    speech: rules.speech,
  };
}

/**
 * Legacy text cleanup (`cleanTtsText`): control characters become spaces, whitespace collapses.
 * Returns the normalized text and its length in code points (the unit of every limit).
 */
export function normalizeMessage(raw: string): {
  text: string;
  length: number;
} {
  const text = String(raw ?? '')
    // eslint-disable-next-line no-control-regex -- legacy cleanTtsText: control characters become spaces
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return { text, length: Array.from(text).length };
}
