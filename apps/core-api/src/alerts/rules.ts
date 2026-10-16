import type { AlertEventInput } from '@raptoru/schemas';
import {
  ALERT_VARIANTS,
  type AlertVariant,
  BITS_MINIMUM,
  FOLLOW_WEIGHTS,
  GIFT_THRESHOLDS,
} from './variants.js';

// Twitch alerts V1 — pure rules: which event makes an alert, with which legacy variant. No database, no clock; the
// random source is injected (deterministic in tests). The chosen variant is stored with the alert: never drawn again.

export type Rng = () => number;

export type AlertDecision =
  | { outcome: 'queued'; variant: AlertVariant }
  /** A community gift recipient: the batch alert already covers it (never one alert per recipient). */
  | { outcome: 'absorbed' }
  /** Bits under the SAMMI minimum (10). */
  | { outcome: 'below_threshold' };

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

export function decideAlert(e: AlertEventInput, rng: Rng): AlertDecision {
  const pick = (id: string) => ({
    outcome: 'queued' as const,
    variant: ALERT_VARIANTS[id]!,
  });
  switch (e.type) {
    case 'follow':
      return pick(weighted(FOLLOW_WEIGHTS, rng));
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
  const amount = e.amount
    ? `${(e.amount.value / 10 ** e.amount.decimal_place).toFixed(e.amount.decimal_place)} ${e.amount.currency}`
    : undefined;
  return {
    pseudo: anonymousGifter
      ? 'Un généreux anonyme'
      : (e.actor?.display_name ?? 'Anonyme'),
    ...(e.recipient ? { recipient: e.recipient.display_name } : {}),
    ...(e.count !== undefined ? { count: e.count } : {}),
    ...(e.bits !== undefined ? { amount: String(e.bits) } : {}),
    ...(amount ? { amount } : {}),
    ...(e.viewers !== undefined ? { viewers: e.viewers } : {}),
    ...(e.tier ? { tier: e.tier } : {}),
    ...(e.months !== undefined ? { months: e.months } : {}),
    ...(e.message ? { message: e.message } : {}),
    anonymous: anonymousGifter || e.anonymous === true,
  };
}
