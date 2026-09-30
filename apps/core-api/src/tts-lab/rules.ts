// TTS V2 rules: single server-side source of pricing, cooldowns, queue capacity and voice-category
// probabilities. Values ported as is from the legacy production rules (`ebs/core/tts-rules.js`,
// "tts-anti-abuse-v1"); what is new is marked. The client never owns a copy of these values: it
// only displays the public projection sent by Core.

export interface TtsTier {
  id: string;
  min: number;
  /** null = open-ended last tier. */
  max: number | null;
  /** Price in jetons (absolute; legacy defaults = base 7 500 × the legacy multiplier). */
  price: number;
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
      price: 7_500, // legacy ×1
      credit_cost: 1,
      cooldown_seconds: 60,
      painful_voice_weight_multiplier: 1,
    },
    {
      id: '81-150',
      min: 81,
      max: 150,
      price: 11_250, // legacy ×1.5
      credit_cost: 1,
      cooldown_seconds: 90,
      painful_voice_weight_multiplier: 0.8,
    },
    {
      id: '151-300',
      min: 151,
      max: 300,
      price: 15_000, // legacy ×2
      credit_cost: 1,
      cooldown_seconds: 120,
      painful_voice_weight_multiplier: 0.5,
    },
    {
      id: '301-500',
      min: 301,
      max: 500,
      price: 22_500, // legacy ×3
      credit_cost: 1,
      cooldown_seconds: 180,
      painful_voice_weight_multiplier: 0.25,
    },
    {
      id: '501+',
      min: 501,
      max: null,
      price: 37_500, // legacy ×5
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

/** What Studio can edit (TTS → Configuration). Everything else stays a Core constant. */
export interface EditableTtsRules {
  tiers: {
    min: number;
    max: number | null;
    price: number;
    credit_cost: number;
    cooldown_seconds: number;
  }[];
  max_chars: number;
  max_waiting_global: number;
  max_waiting_weight_ms: number | null;
  transition_gap_ms: number;
  max_per_viewer: number;
}

/** Bounds of every editable value (Core refuses anything outside). */
export const TTS_RULE_LIMITS = {
  tiers: [1, 12],
  length: [1, 10_000],
  price: [0, 10_000_000],
  credit_cost: [0, 100],
  cooldown_seconds: [0, 3_600],
  max_chars: [1, 10_000],
  max_waiting_global: [1, 100],
  max_waiting_weight_ms: [5_000, 2 * 3_600_000],
  transition_gap_ms: [0, 30_000],
  max_per_viewer: [1, 10],
} as const;

export const editableRules = (r: TtsRules): EditableTtsRules => ({
  tiers: r.tiers.map(({ min, max, price, credit_cost, cooldown_seconds }) => ({
    min,
    max,
    price,
    credit_cost,
    cooldown_seconds,
  })),
  max_chars: r.max_chars,
  max_waiting_global: r.max_waiting_global,
  max_waiting_weight_ms: r.max_waiting_weight_ms,
  transition_gap_ms: r.transition_gap_ms,
  max_per_viewer: r.max_per_viewer,
});

const isInt = (v: unknown, [lo, hi]: readonly [number, number]) =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Strict validation of an edited configuration. Returns French messages (shown as is in Studio);
 * an empty list means valid. Tiers must start at 1, be contiguous (no overlap, no gap), each with
 * max ≥ min; only the last one may be open (max null). A closed last tier caps the message length.
 */
export function validateEditableRules(e: EditableTtsRules): string[] {
  const errors: string[] = [];
  const L = TTS_RULE_LIMITS;
  if (
    !Array.isArray(e?.tiers) ||
    e.tiers.length < L.tiers[0] ||
    e.tiers.length > L.tiers[1]
  )
    return [`Il faut entre ${L.tiers[0]} et ${L.tiers[1]} paliers.`];
  let expected = 1;
  e.tiers.forEach((t, i) => {
    const n = i + 1;
    if (!isInt(t.min, L.length))
      errors.push(`Palier ${n} : longueur min invalide.`);
    else if (t.min !== expected)
      errors.push(
        t.min > expected
          ? `Palier ${n} : trou entre ${expected - 1} et ${t.min} (le palier doit commencer à ${expected}).`
          : `Palier ${n} : chevauche le palier précédent (doit commencer à ${expected}).`,
      );
    if (t.max === null) {
      if (i !== e.tiers.length - 1)
        errors.push(
          `Palier ${n} : seul le dernier palier peut être ouvert (sans max).`,
        );
    } else if (!isInt(t.max, L.length) || t.max < t.min)
      errors.push(`Palier ${n} : longueur max invalide (≥ min).`);
    if (!isInt(t.price, L.price))
      errors.push(
        `Palier ${n} : prix jetons invalide (entier 0 – ${L.price[1]}).`,
      );
    if (!isInt(t.credit_cost, L.credit_cost))
      errors.push(
        `Palier ${n} : coût en crédits invalide (entier 0 – ${L.credit_cost[1]}).`,
      );
    if (!isInt(t.cooldown_seconds, L.cooldown_seconds))
      errors.push(
        `Palier ${n} : cooldown invalide (0 – ${L.cooldown_seconds[1]} s).`,
      );
    expected = typeof t.max === 'number' ? t.max + 1 : Infinity;
  });
  if (!isInt(e.max_chars, L.max_chars))
    errors.push(`Longueur max du message invalide (1 – ${L.max_chars[1]}).`);
  const last = e.tiers.at(-1);
  if (
    last &&
    typeof last.max === 'number' &&
    isInt(e.max_chars, L.max_chars) &&
    e.max_chars > last.max
  )
    errors.push(
      `Longueur max du message (${e.max_chars}) au-delà du dernier palier (${last.max}) : ouvre le dernier palier ou baisse la longueur max.`,
    );
  if (!isInt(e.max_waiting_global, L.max_waiting_global))
    errors.push(
      `File : nombre max en attente invalide (1 – ${L.max_waiting_global[1]}).`,
    );
  if (
    e.max_waiting_weight_ms !== null &&
    !isInt(e.max_waiting_weight_ms, L.max_waiting_weight_ms)
  )
    errors.push('File : durée max en attente invalide (5 s – 2 h, ou aucune).');
  if (!isInt(e.transition_gap_ms, L.transition_gap_ms))
    errors.push('File : délai entre deux TTS invalide (0 – 30 s).');
  if (!isInt(e.max_per_viewer, L.max_per_viewer))
    errors.push(
      `Viewer : TTS simultanés par viewer invalide (1 – ${L.max_per_viewer[1]}).`,
    );
  return errors;
}

const tierId = (min: number, max: number | null) =>
  max === null ? `${min}+` : `${min}-${max}`;

/** Stored override (tts_lab_settings.rules) for a validated edit. Voice weights follow the tier rank. */
export function overrideFromEditable(e: EditableTtsRules): Partial<TtsRules> {
  const painful = DEFAULT_TTS_RULES.tiers.map(
    (t) => t.painful_voice_weight_multiplier,
  );
  return {
    tiers: e.tiers.map((t, i) => ({
      id: tierId(t.min, t.max),
      min: t.min,
      max: t.max,
      price: t.price,
      credit_cost: t.credit_cost,
      cooldown_seconds: t.cooldown_seconds,
      painful_voice_weight_multiplier:
        painful[Math.min(i, painful.length - 1)]!,
    })),
    max_chars: e.max_chars,
    max_waiting_global: e.max_waiting_global,
    max_waiting_weight_ms: e.max_waiting_weight_ms,
    transition_gap_ms: e.transition_gap_ms,
    max_per_viewer: e.max_per_viewer,
  };
}

/** Rules in force: defaults merged with the stored override (re-validated; invalid → defaults kept). */
export function resolveTtsRules(override: unknown): TtsRules {
  if (!override || typeof override !== 'object') return DEFAULT_TTS_RULES;
  const o = override as Partial<TtsRules> & {
    tiers?: (TtsTier & { price_multiplier?: number })[];
  };
  const merged: TtsRules = {
    ...DEFAULT_TTS_RULES,
    ...o,
    // An override stored before absolute prices (multiplier only) keeps its price.
    tiers: (
      (o.tiers ?? DEFAULT_TTS_RULES.tiers) as (TtsTier & {
        price_multiplier?: number;
      })[]
    ).map((t, i) => ({
      ...t,
      price:
        typeof t.price === 'number'
          ? t.price
          : Math.round(
              DEFAULT_TTS_RULES.base_price * (t.price_multiplier ?? 1),
            ),
      painful_voice_weight_multiplier:
        t.painful_voice_weight_multiplier ??
        DEFAULT_TTS_RULES.tiers[
          Math.min(i, DEFAULT_TTS_RULES.tiers.length - 1)
        ]!.painful_voice_weight_multiplier,
    })),
  };
  const errors = validateEditableRules(editableRules(merged));
  // Stored overrides are validated before saving; a hand-edited invalid row never bricks the module.
  if (errors.length) return DEFAULT_TTS_RULES;
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
    price: tier.price,
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
      ({ id, min, max, price, credit_cost, cooldown_seconds }) => ({
        id,
        min,
        max,
        price,
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
