import {
  type AlertEventInput,
  alertVariantFamilyOf,
  type AlertVariantSettings,
} from '@raptoru/schemas';
import {
  ALERT_VARIANTS,
  type AlertVariant,
  ballonVariant,
  BITS_MINIMUM,
  FOLLOW_WEIGHTS,
  GIFT_THRESHOLDS,
  HW_FOLLOW,
  HW_GIFT_TARGETED,
  JERRY_THRESHOLDS,
} from './variants.js';

// Twitch alerts V1 — pure rules: which event makes an alert, with which legacy variant. No database, no clock; the
// random source is injected (deterministic in tests). The chosen variant is stored with the alert: never drawn again.

export type Rng = () => number;

export type AlertDecision =
  | { outcome: 'queued'; variant: AlertVariant }
  /** A community gift recipient: the batch alert already covers it (never one alert per recipient). */
  | { outcome: 'absorbed' }
  /** Bits under the SAMMI minimum (10). */
  | { outcome: 'below_threshold' }
  /** The family is switched off (Studio › Alertes › Variantes). */
  | { outcome: 'disabled' };

/** Weighted draw (legacy follow weights). */
export function weighted(entries: [string, number][], rng: Rng): string {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [id, w] of entries) {
    if (roll < w) return id;
    roll -= w;
  }
  return entries[entries.length - 1]![0];
}

/** The channel's alert profile (Halloween: event shop rules); absent = the usual alerts. */
export interface AlertProfile {
  halloween: boolean;
  ballon: { sub: number[]; prime: number[]; resub: number[] };
  /** Studio › Alertes › Variantes (absent: the usual behaviour). */
  variants?: AlertVariantSettings;
}

/** The Halloween variant of an event, or null (no Halloween variant for it: the usual one plays). */
export function halloweenVariant(
  e: AlertEventInput,
  rng: Rng,
  ballon: AlertProfile['ballon'],
): AlertVariant | null {
  const draw = (pool: number[]) =>
    pool.length
      ? pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!
      : 1;
  switch (e.type) {
    case 'follow':
      return HW_FOLLOW;
    case 'sub': {
      const kind = e.tier === 'prime' ? 'prime' : 'sub';
      return ballonVariant(kind, draw(ballon[kind]));
    }
    case 'resub':
      return ballonVariant('resub', draw(ballon.resub));
    case 'gift_community': {
      const count = e.count ?? 1;
      return JERRY_THRESHOLDS.find(([min]) => count >= min)![1];
    }
    case 'gift_targeted':
      return HW_GIFT_TARGETED;
    default:
      return null;
  }
}

export function decideAlert(
  e: AlertEventInput,
  rng: Rng,
  profile?: AlertProfile | null,
): AlertDecision {
  const usual = decideUsual(e, rng, profile?.variants?.follow);
  if (usual.outcome !== 'queued') return usual;
  const family = alertVariantFamilyOf(e);
  const mode = (family && profile?.variants?.families[family]) || 'auto';
  if (mode === 'off') return { outcome: 'disabled' };
  if (mode === 'usual' || (mode === 'auto' && !profile?.halloween))
    return usual;
  const hw = halloweenVariant(e, rng, profile?.ballon ?? ALL_BALLON);
  // The usual variant travels with it: Studio plays it when a Halloween media is missing (never no alert at all).
  return hw
    ? { outcome: 'queued', variant: { ...hw, fallback: usual.variant } }
    : usual;
}

const ALL_BALLON = {
  sub: [1, 2, 3, 4],
  prime: [1, 2, 3, 4],
  resub: [1, 2, 3, 4],
};

function decideUsual(
  e: AlertEventInput,
  rng: Rng,
  /** The follow variants allowed (absent / none known: all of them). */
  follow?: string[],
): AlertDecision {
  const pick = (id: string) => ({
    outcome: 'queued' as const,
    variant: ALERT_VARIANTS[id]!,
  });
  switch (e.type) {
    case 'follow': {
      const allowed = FOLLOW_WEIGHTS.filter(([id]) => follow?.includes(id));
      return pick(weighted(allowed.length ? allowed : FOLLOW_WEIGHTS, rng));
    }
    case 'sub':
    case 'resub':
      // Same Eren animation for both (decision 16/10/2026); the event type stays distinct.
      return pick('eren_sub');
    case 'gift_community': {
      const count = e.count ?? 1;
      return pick(GIFT_THRESHOLDS.find(([min]) => count >= min)![1]);
    }
    case 'gift_targeted':
      return pick('subgift_targeted');
    case 'gift_recipient':
      return { outcome: 'absorbed' };
    case 'bits':
      return (e.bits ?? 0) >= BITS_MINIMUM
        ? pick('bits_default')
        : { outcome: 'below_threshold' };
    case 'raid':
      return pick('raid_default');
    case 'donation':
      return pick('don_moneytest');
  }
}

/** The display data of an alert (untrusted: escaped by the renderer). Anonymous gifter → legacy wording. */
export function alertData(e: AlertEventInput) {
  const anonymousGifter =
    (e.type === 'gift_targeted' || e.type === 'gift_community') &&
    (e.anonymous === true || !e.actor);
  // The renderer formats it like the legacy page (« 5€ », « $5 », « 5 CAD »).
  const amount = e.amount
    ? (e.amount.value / 10 ** e.amount.decimal_place).toFixed(
        e.amount.decimal_place,
      )
    : undefined;
  return {
    pseudo: anonymousGifter
      ? 'Un généreux anonyme'
      : (e.actor?.display_name ?? 'Anonyme'),
    ...(e.recipient ? { recipient: e.recipient.display_name } : {}),
    ...(e.count !== undefined ? { count: e.count } : {}),
    ...(e.bits !== undefined ? { amount: String(e.bits) } : {}),
    ...(amount ? { amount, currency: e.amount!.currency } : {}),
    ...(e.viewers !== undefined ? { viewers: e.viewers } : {}),
    ...(e.tier ? { tier: e.tier } : {}),
    ...(e.months !== undefined ? { months: e.months } : {}),
    ...(e.message ? { message: e.message } : {}),
    anonymous: anonymousGifter || e.anonymous === true,
  };
}
