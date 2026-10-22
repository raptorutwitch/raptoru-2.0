// Jeu des mots V1 — pure rules (Lot 1). Reference: docs/WORD_GAME_PARITY.md (§ numbers below).
// No DB, network, Twitch, Wallet, timer or file here: callers pass the time, the random source and the
// state, and get back values. The legacy SAMMI deck positions are cited in the parity document.

/** A random source in [0, 1), like Math.random (injected so that every rule stays deterministic). */
export type Rng = () => number;

export interface ActiveWord {
  occurrenceId: string;
  /** The word to find, as in the bank (lowercase, accents kept). */
  word: string;
  /** What the chat was shown. */
  shuffled: string;
  golden: boolean;
  /** Creation instant, ms since epoch. */
  createdAt: number;
}

export interface Chatter {
  id: string;
  displayName: string;
}

/** The single streak of the channel (§ 8). Empty: holderId null, count 0. */
export interface Streak {
  holderId: string | null;
  holderName: string | null;
  count: number;
}

export const EMPTY_STREAK: Streak = {
  holderId: null,
  holderName: null,
  count: 0,
};

// --- constants (§§ 4, 6, 7, 9, 13) ------------------------------------------------------------------

export const GOLDEN_WORD_CHANCE = 10;
export const GOLDEN_WORD_MULTIPLIER = 4;
/** rewards[length] = 100 × length, for 4 to 30 letters (legacy table). */
export const MIN_REWARD_LENGTH = 4;
export const MAX_REWARD_LENGTH = 30;
export const WORD_INTERVAL_MS = { min: 300_000, max: 900_000 };
export const CYCLE_TO_WORD_MS = 500;
export const STREAK_ANNOUNCE_DELAY_MS = 2_000;
export const MOTS_COOLDOWN_MS = 1_000;

// --- draw (§§ 6, 13, 16) -----------------------------------------------------------------------------

/** Uniform integer in [min, max]. */
export function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Delay before the next word: uniform 300 000 – 900 000 ms. */
export function nextWordDelayMs(rng: Rng): number {
  return randomInt(rng, WORD_INTERVAL_MS.min, WORD_INTERVAL_MS.max);
}

/** Legacy roll 1–100, golden when roll < GOLDEN_WORD_CHANCE + 1 (10 %). */
export function isGoldenRoll(roll: number): boolean {
  return roll < GOLDEN_WORD_CHANCE + 1;
}

export function rollGolden(rng: Rng): boolean {
  return isGoldenRoll(randomInt(rng, 1, 100));
}

/** Uniform word of the bank that is not currently active; null when every word is active. */
export function pickWord(
  bank: readonly string[],
  active: Iterable<string>,
  rng: Rng,
): string | null {
  const taken = new Set(active);
  const free = taken.size ? bank.filter((w) => !taken.has(w)) : bank;
  return free.length ? free[Math.floor(rng() * free.length)]! : null;
}

/** Random permutation of the word's characters (it may give the word back, like the legacy). */
export function shuffleLetters(word: string, rng: Rng): string {
  const chars = Array.from(word);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

// --- detection (§ 17) --------------------------------------------------------------------------------

/**
 * Active words contained in the message: substring, case ignored (Unicode lowercase on both sides),
 * accents required (no other transformation). Every occurrence counts. Order: newest word first.
 */
export function matchWords(
  message: string,
  active: readonly ActiveWord[],
): ActiveWord[] {
  const text = message.toLowerCase();
  return active
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => text.includes(w.word.toLowerCase()))
    .sort((a, b) => b.w.createdAt - a.w.createdAt || a.i - b.i)
    .map(({ w }) => w);
}

// --- reward of one word (§§ 4, 5, 6) ------------------------------------------------------------------

export type SpeedTier = 'fast' | 'normal' | 'old';

/** Age in whole seconds (legacy timestamps are seconds). */
export function ageSeconds(createdAt: number, now: number): number {
  return Math.max(0, Math.floor((now - createdAt) / 1000));
}

/**
 * Speed multiplier as an exact fraction: < 30 s → 3 ; < 300 s → 1 ; then 1 + (age − 300) / 1500,
 * capped at 2 (reached at 1 800 s).
 */
export function speedMultiplier(age: number): {
  num: number;
  den: number;
  tier: SpeedTier;
} {
  if (age < 30) return { num: 3, den: 1, tier: 'fast' };
  if (age < 300) return { num: 1, den: 1, tier: 'normal' };
  if (age >= 1800) return { num: 2, den: 1, tier: 'old' };
  return { num: 1200 + age, den: 1500, tier: 'normal' };
}

/** rewards[length] = 100 × length. Length = characters (accents included: « crâne » = 5). */
export function baseReward(word: string): number {
  const length = Array.from(word).length;
  if (length < MIN_REWARD_LENGTH || length > MAX_REWARD_LENGTH)
    throw new RangeError(`no reward for a ${length}-letter word`);
  return 100 * length;
}

/** round((base × mult) / 10) × 10, half up, computed on integers; then × 4 if golden. */
export function wordReward(
  word: string,
  age: number,
  golden: boolean,
): { points: number; tier: SpeedTier; fast: boolean } {
  const { num, den, tier } = speedMultiplier(age);
  const tens = Math.floor((2 * baseReward(word) * num + 10 * den) / (20 * den));
  return {
    points: tens * 10 * (golden ? GOLDEN_WORD_MULTIPLIER : 1),
    tier,
    fast: tier === 'fast',
  };
}

// --- bonuses (§§ 7, 9) --------------------------------------------------------------------------------

export function comboBonus(wordsFound: number): number {
  if (wordsFound >= 5) return 5000;
  return [0, 0, 500, 1000, 2500][wordsFound] ?? 0;
}

/** Bonus for breaking a streak of this length (0 below 3). */
export function breakerBonus(brokenCount: number): number {
  if (brokenCount >= 12) return 4000;
  if (brokenCount >= 8) return 2000;
  if (brokenCount >= 5) return 1000;
  if (brokenCount >= 3) return 500;
  return 0;
}

// --- one message (§§ 4, 7, 8, 9, 21) ------------------------------------------------------------------

export interface WordFind {
  occurrenceId: string;
  word: string;
  golden: boolean;
  fast: boolean;
  tier: SpeedTier;
  age: number;
  /** Points of this word (speed and golden included, combo and breaker excluded). */
  points: number;
  /** Streak of the winner right after this word. */
  streakAfter: number;
}

export interface Breaker {
  bonus: number;
  brokenId: string;
  brokenName: string;
  brokenCount: number;
}

export interface MessageOutcome {
  finds: WordFind[];
  combo: number;
  breaker: Breaker | null;
  /** The single Wallet credit of the message: Σ points + combo + breaker. */
  total: number;
  streak: Streak;
}

/**
 * Everything a message wins, without any side effect. Null when it contains no active word. The streak
 * is processed per word, in detection order: the holder gets +1 per word; another viewer first checks
 * the breaker (holder's streak ≥ 3, at most once per message), then holds the streak with 1.
 */
export function evaluateMessage(input: {
  message: string;
  chatter: Chatter;
  now: number;
  active: readonly ActiveWord[];
  streak: Streak;
}): MessageOutcome | null {
  const found = matchWords(input.message, input.active);
  if (!found.length) return null;
  let streak = { ...input.streak };
  let breaker: Breaker | null = null;
  const finds: WordFind[] = [];
  for (const w of found) {
    if (streak.holderId === input.chatter.id) {
      streak = {
        ...streak,
        holderName: input.chatter.displayName,
        count: streak.count + 1,
      };
    } else {
      const bonus = breakerBonus(streak.count);
      if (!breaker && streak.holderId !== null && bonus > 0)
        breaker = {
          bonus,
          brokenId: streak.holderId,
          brokenName: streak.holderName ?? '',
          brokenCount: streak.count,
        };
      streak = {
        holderId: input.chatter.id,
        holderName: input.chatter.displayName,
        count: 1,
      };
    }
    const age = ageSeconds(w.createdAt, input.now);
    const reward = wordReward(w.word, age, w.golden);
    finds.push({
      occurrenceId: w.occurrenceId,
      word: w.word,
      golden: w.golden,
      fast: reward.fast,
      tier: reward.tier,
      age,
      points: reward.points,
      streakAfter: streak.count,
    });
  }
  const combo = comboBonus(finds.length);
  const total =
    finds.reduce((sum, f) => sum + f.points, 0) + combo + (breaker?.bonus ?? 0);
  return { finds, combo, breaker, total, streak };
}

// --- streak announcements (§ 10) ----------------------------------------------------------------------

/** Announcer memory, within one live session (a new session starts from EMPTY_ANNOUNCER). */
export interface AnnouncerState {
  lastAnnounced: number;
  userId: string | null;
}

export const EMPTY_ANNOUNCER: AnnouncerState = {
  lastAnnounced: 0,
  userId: null,
};

/** After a winning message: announce at 3, then every +3 since the last announcement of this player. */
export function streakAnnouncement(
  state: AnnouncerState,
  streak: Streak,
): { announce: boolean; state: AnnouncerState } {
  let last = state.lastAnnounced;
  if (streak.holderId !== state.userId) last = 0;
  const announce =
    streak.count >= 3 && (last === 0 || streak.count >= last + 3);
  return {
    announce,
    state: {
      lastAnnounced: announce ? streak.count : last,
      userId: streak.holderId,
    },
  };
}

/** Variant 1–4, uniform. */
export function pickVariant(rng: Rng): 1 | 2 | 3 | 4 {
  return randomInt(rng, 1, 4) as 1 | 2 | 3 | 4;
}

const STREAK_TIERS: [number, [string, string, string, string]][] = [
  [
    12,
    [
      '👑 @{X} devient MAÎTRE DES MOTS !',
      '👑 @{X} règne sur le Jeu des mots !',
      '👑 @{X} est au SOMMET !',
      '👑 Le royaume des mots appartient à @{X} !',
    ],
  ],
  [
    8,
    [
      '⚡ @{X} entre en DOMINATION !',
      '⚡ @{X} roule sur le jeu !',
      '⚡ @{X} est en pleine DOMINATION !',
      '⚡ Rien n’arrête @{X} !',
    ],
  ],
  [
    5,
    [
      '🔥🔥 @{X} est INARRÊTABLE !',
      '🔥🔥 @{X} ne s’arrête plus !',
      '🔥🔥 @{X} enchaîne tout !',
      '🔥🔥 Quelle série pour @{X} !',
    ],
  ],
  [
    3,
    [
      '🔥 @{X} est EN FEU !',
      '🔥 @{X} commence à chauffer !',
      '🔥 @{X} prend feu !',
      '🔥 Ça chauffe pour @{X} !',
    ],
  ],
];

/** Text of a streak announcement (§ 12.5), for a streak of at least 3. */
export function streakAnnouncementText(
  name: string,
  count: number,
  variant: 1 | 2 | 3 | 4,
): string {
  const tier = STREAK_TIERS.find(([min]) => count >= min);
  if (!tier) throw new RangeError('a streak is announced from 3');
  return `${tier[1][variant - 1]!.replace('{X}', name)} ${count} mots d’affilée !`;
}

// --- chat texts (§ 12) --------------------------------------------------------------------------------

export const CYCLE_ANNOUNCEMENT =
  'Trouve le mot caché parmi ces lettres et remporte des jetons !';

/** § 12.2 — RÈGLE V1 VALIDÉE : UN SEUL MESSAGE par nouveau mot, doré compris. */
export function publishText(shuffled: string, golden: boolean): string {
  return golden ? `🔸 ${shuffled} 🔸` : `-> ${shuffled} <-`;
}

export function decorateWord(word: string, tier: SpeedTier): string {
  if (tier === 'fast') return `⚡${word}⚡`;
  if (tier === 'old') return `✨${word}✨`;
  return `"${word}"`;
}

/** « 3 500 » : thousands separated by a plain space (as the other chat announcements). */
export const formatJetons = (n: number) =>
  n.toLocaleString('fr-FR').replace(/\s/g, ' ');

/** « d'Aouh », « de Raptoru_ » : d' before a vowel or y (accents ignored, any case), the name kept as it is. */
export function ofName(name: string): string {
  return /^[aeiouy]/i.test(name.normalize('NFD')) ? `d'${name}` : `de ${name}`;
}

/**
 * § 12.3 — ONE announcement per winning message. The words' Jetons (speed, golden and combo included) and the
 * breaker are shown apart; together they are exactly the message's single Wallet credit (`outcome.total`).
 */
export function findAnnouncementText(
  name: string,
  outcome: MessageOutcome,
): string {
  const words = outcome.finds
    .map((f) => decorateWord(f.word, f.tier))
    .join(', ');
  const b = outcome.breaker;
  const wordsJetons = outcome.total - (b?.bonus ?? 0);
  const combo = outcome.combo
    ? ` (⚡ +${formatJetons(outcome.combo)} combo)`
    : '';
  const golden = outcome.finds.some((f) => f.golden)
    ? ` 🪙 x${GOLDEN_WORD_MULTIPLIER}`
    : '';
  const breaker = b
    ? ` et brise la streak de ${b.brokenCount} ${ofName(b.brokenName)} 💥 +${formatJetons(b.bonus)} breaker !`
    : '';
  const gain = `+${formatJetons(wordsJetons)} Jetons${combo}${golden}${breaker}`;
  return outcome.finds.length === 1
    ? `@${name} a trouvé le mot ${words} ! ${gain}`
    : `🔥 @${name} a trouvé ${outcome.finds.length} mots: ${words} ! ${gain} 🔥`;
}

/** § 12.7 — the shuffled forms of the active words, newest first. */
export function motsText(active: readonly ActiveWord[]): string {
  if (!active.length) return 'Aucun mot en cours !';
  const shown = [...active]
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w.createdAt - a.w.createdAt || a.i - b.i)
    .map(({ w }) => w.shuffled);
  return `🎲 Mots restants : ${shown.join(' | ')}`;
}

/** § 12.8 (« 1 mots » kept as in the legacy). */
export function streakmotText(streak: Streak): string {
  if (streak.holderId === null || streak.count === 0)
    return '🔥 Aucune streak du Jeu des mots en cours.';
  if (streak.count < 3)
    return `🔥 @${streak.holderName} est à ${streak.count} mots d’affilée.`;
  return `🔥 @${streak.holderName} est actuellement EN FEU : ${streak.count} mots d’affilée !`;
}
