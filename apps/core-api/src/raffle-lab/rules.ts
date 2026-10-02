import {
  DEFAULT_HINT_STYLE,
  DEFAULT_RAFFLE_LABELS,
  type RaffleConfig,
  type RaffleLabels,
  type RaffleScheduler,
} from '@raptoru/schemas';

// Tombola V2 — pure rules (decided by Core only, never by a client): defaults, random jackpot,
// winners count, exact split and the length of the overlay reveal.

/** Default entry commands (all editable in Studio: main command + aliases). */
export const DEFAULT_JOIN_COMMANDS = ['!join', '!enter'];

/**
 * Default configuration. Random jackpot (decision D3): ~78 % of the rounds under 20 000, ~18 %
 * between 20 000 and 40 000, ~4 % between 40 000 and 50 000, rarer towards the top of every band.
 * SUPER 1 in 400 (D6), FULL OSEILLE 1 % (prototype), 60 s, cancel command « !annuletombola » (D10).
 */
export const DEFAULT_RAFFLE_CONFIG: RaffleConfig = {
  currency_id: 'tokens',
  amount_mode: 'random',
  fixed_amount: 25_000,
  prize: 'Lot à remettre',
  random: {
    step: 500,
    bands: [
      { from: 5_000, to: 20_000, pct: 78 },
      { from: 20_000, to: 40_000, pct: 18 },
      { from: 40_000, to: 50_000, pct: 4 },
    ],
  },
  duration_s: 60,
  winners_mode: 'auto',
  winners_custom: 3,
  full: { enabled: true, chance_pct: 1 },
  super: {
    enabled: true,
    one_in: 400,
    jackpot: 200_000,
    currency_id: 'tokens',
  },
  join_commands: [...DEFAULT_JOIN_COMMANDS],
  cancel_commands: ['!annuletombola'],
  extension_button: true,
  overlay_hint: { mode: 'join', text: '', style: { ...DEFAULT_HINT_STYLE } },
  display: {
    intro_s: 2,
    drawing_s: 3,
    join_feedback_ms: 1400,
    result_normal_s: 14,
    result_super_s: 18,
    result_full_s: 16,
    result_giveaway_s: 14,
    cancelled_s: 4,
    empty_s: 5,
    // « Décalage résultat Extension après le stream » (anti-spoil, one value for every viewer).
    stream_margin_s: 5,
    extension_idle_return_s: 12,
  },
  // Off by default: the automatic launches start only once Studio enables them.
  scheduler: {
    enabled: false,
    preset: 'normal',
    first_delay_s: 15 * 60,
    mode: 'random',
    interval_s: 25 * 60,
    interval_min_s: 20 * 60,
    interval_max_s: 30 * 60,
  },
  launch_sounds: { normal: null, super: null, giveaway: null },
  labels: { ...DEFAULT_RAFFLE_LABELS },
};

/**
 * Scheduler presets (proposal, to be confirmed): delay before the first automatic round, then a
 * random interval between two rounds, counted from the end of the previous display.
 */
export const SCHEDULER_PRESETS: Record<
  Exclude<RaffleScheduler['preset'], 'custom'>,
  { first_delay_s: number; min_s: number; max_s: number }
> = {
  rare: { first_delay_s: 30 * 60, min_s: 45 * 60, max_s: 75 * 60 },
  occasional: { first_delay_s: 20 * 60, min_s: 30 * 60, max_s: 45 * 60 },
  normal: { first_delay_s: 15 * 60, min_s: 20 * 60, max_s: 30 * 60 },
  frequent: { first_delay_s: 10 * 60, min_s: 12 * 60, max_s: 20 * 60 },
  very_frequent: { first_delay_s: 5 * 60, min_s: 6 * 60, max_s: 10 * 60 },
};

type EventKind = 'normal' | 'super' | 'giveaway';
/**
 * Titles of an event, computed once here for every surface (overlay, Studio, extension): the name
 * comes from Studio (`labels.event_name`) or the type (« Tombola », « Giveaway »); the agreement of a
 * custom name is the one chosen in Studio (never guessed). Each title is [name, state] so a surface
 * can put the state under the name when it does not fit on one line.
 */
export function eventTitles(labels: RaffleLabels, kind: EventKind) {
  const custom = labels.event_name?.trim();
  const base = custom || (kind === 'giveaway' ? 'Giveaway' : 'Tombola');
  const fem = custom ? labels.event_gender === 'f' : kind !== 'giveaway';
  const name = kind === 'super' ? `Super ${base}` : base;
  const t = (state: string): [string, string] => [name, state];
  return {
    name,
    open: kind === 'super' ? t('') : t(fem ? 'ouverte' : 'ouvert'),
    running: t('en cours'),
    paused: t('en pause'),
    ended: labels.empty_title?.trim()
      ? ([labels.empty_title.trim(), ''] as [string, string])
      : t(fem ? 'terminée' : 'terminé'),
    cancelled: t(fem ? 'annulée' : 'annulé'),
  };
}
/** « Aucune Tombola en cours » / « Aucun Giveaway en cours » / custom name with its agreement. */
export function idleTitle(labels: RaffleLabels, kind: EventKind) {
  const custom = labels.event_name?.trim();
  const fem = custom ? labels.event_gender === 'f' : kind !== 'giveaway';
  return `${fem ? 'Aucune' : 'Aucun'} ${eventTitles(labels, kind).name} en cours`;
}

/** Effective timing of the scheduler (preset values, or the custom ones). */
export function schedulerTiming(s: RaffleScheduler) {
  if (s.preset !== 'custom') return SCHEDULER_PRESETS[s.preset];
  return s.mode === 'fixed'
    ? {
        first_delay_s: s.first_delay_s,
        min_s: s.interval_s,
        max_s: s.interval_s,
      }
    : {
        first_delay_s: s.first_delay_s,
        min_s: s.interval_min_s,
        max_s: s.interval_max_s,
      };
}

/** Next interval (ms), drawn once and stored by Core. */
export function nextIntervalMs(s: RaffleScheduler, random: () => number) {
  const t = schedulerTiming(s);
  return Math.round((t.min_s + (t.max_s - t.min_s) * random()) * 1000);
}

export class RaffleConfigError extends Error {
  readonly code = 'invalid_config';
}

/** Coherence Zod cannot express: contiguous bands summing to 100 %, steps that fit. */
export function validateConfig(c: RaffleConfig) {
  const b = c.random.bands;
  for (let i = 0; i < b.length; i++) {
    if (b[i]!.to <= b[i]!.from)
      throw new RaffleConfigError(
        `band ${i + 1}: « to » must be above « from »`,
      );
    if (i && b[i]!.from !== b[i - 1]!.to)
      throw new RaffleConfigError(
        `band ${i + 1} must start where band ${i} ends`,
      );
  }
  const total = b.reduce((s, x) => s + x.pct, 0);
  if (Math.abs(total - 100) > 0.001)
    throw new RaffleConfigError(
      `the bands must add up to 100 % (got ${total} %)`,
    );
  if (b[0]!.from < c.random.step)
    throw new RaffleConfigError('the minimum must be at least one step');
  // Commands: no duplicate inside a list, and never the same command to join and to cancel.
  if (new Set(c.join_commands).size !== c.join_commands.length)
    throw new RaffleConfigError('duplicate entry command');
  if (new Set(c.cancel_commands).size !== c.cancel_commands.length)
    throw new RaffleConfigError('duplicate cancel command');
  const clash = c.cancel_commands.find((x) => c.join_commands.includes(x));
  if (clash)
    throw new RaffleConfigError(
      `${clash} cannot be both an entry and a cancel command`,
    );
  if (c.scheduler.interval_min_s > c.scheduler.interval_max_s)
    throw new RaffleConfigError(
      'scheduler: the minimum interval is above the maximum',
    );
  // An empty custom overlay text is allowed: the overlay then shows no instruction until it is typed.
}

/**
 * Random jackpot: a band by its weight, then a value inside it, denser at its bottom (u^1.6), rounded
 * down to the step (never under the band start).
 */
export function randomJackpot(
  c: RaffleConfig['random'],
  random: () => number,
): number {
  let pick = random() * 100;
  let band = c.bands[c.bands.length - 1]!;
  for (const b of c.bands) {
    if (pick < b.pct) {
      band = b;
      break;
    }
    pick -= b.pct;
  }
  const raw = band.from + (band.to - band.from) * random() ** 1.6;
  return Math.max(
    band.from,
    Math.min(band.to, Math.floor(raw / c.step) * c.step),
  );
}

/**
 * Automatic winners (decision D4): 1–2 participants → 1; 3 → 1 or 2; from 4, round(√n × 0.8) ± 1,
 * at least 1 and never more winners than losers (floor(n / 2)).
 */
export function autoWinners(n: number, random: () => number): number {
  if (n <= 0) return 0;
  if (n <= 2) return 1;
  if (n === 3) return random() < 0.5 ? 1 : 2;
  const jitter = Math.floor(random() * 3) - 1;
  return Math.max(
    1,
    Math.min(Math.floor(n / 2), Math.round(Math.sqrt(n) * 0.8) + jitter),
  );
}

/** Exact split: the remainder goes one unit at a time to the first winners (sum = total, always). */
export function split(total: number, k: number): number[] {
  if (k <= 0) return [];
  const base = Math.floor(total / k);
  const rest = total - base * k;
  return Array.from({ length: k }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Length of the overlay reveal (ms), mirroring the validated prototype animations: G cards (one by
 * one, the gain counting up; SUPER = every card first, a short pause, then all the gains together),
 * FULL OSEILLE compact roulette. The extension only shows the result after it (+ the stream margin).
 */
export function revealMs(
  kind: 'normal' | 'super' | 'giveaway',
  full: boolean,
  winners: number,
): number {
  if (winners <= 0) return 1500;
  if (full) return 650 + 4300 + 600 + 380 + 900;
  const start = kind === 'super' ? 1300 : 750;
  const gap =
    winners <= 3 ? 1050 : winners <= 6 ? 820 : Math.max(420, 5200 / winners);
  const lastCard = start + (winners - 1) * gap + 520;
  if (kind === 'giveaway') return Math.round(lastCard + 600);
  if (kind === 'super') return Math.round(lastCard + 900 + 900 + 300);
  return Math.round(lastCard + 380 + 700 + 300);
}
