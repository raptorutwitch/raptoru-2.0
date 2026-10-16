import { randomInt } from 'node:crypto';

// Roulette and Slot V1 (Lab) — pure rules (docs/ROULETTE_SLOT_PARITY.md). StreamElements parity, no redesign:
// bets, draws, net gains and chat texts. No database, no clock: the service applies them in one transaction.

export type MiniGame = 'roulette' | 'slot';

export const MINI_GAME_RULES = {
  roulette: {
    minBet: 20,
    cooldownMs: 10_000,
    winChance: 0.5,
    netMultiplier: 1,
  },
  slot: { minBet: 20, cooldownMs: 2_000, netMultiplier: 24 },
} as const;

/** The channel's StreamElements reels, in its order (§ 3): cherries, orange, grapes, watermelon, melon. */
export const SLOT_SYMBOLS = ['🍒', '🍊', '🍇', '🍉', '🍈'] as const;

/** Chat words (without « ! ») → game; StreamElements aliases included. Reserved for Commands V2. */
export const MINI_GAME_WORDS: Record<string, MiniGame> = {
  roulette: 'roulette',
  gamble: 'roulette',
  slots: 'slot',
  slot: 'slot',
  slotmachine: 'slot',
  sm: 'slot',
  smp: 'slot',
};

/**
 * The channel's StreamElements messages, verbatim (§ 5), typos and channel emotes included. StreamElements
 * variables: {user}, {bet}, {points}, ${pointsname}, {emotes}. The leading `/me` cannot be sent by
 * LeCroupier_'s Twitch API: it is dropped when sending (normal message, never a literal « /me »).
 */
export const TEXTS = {
  roulette_win:
    '/me {user} gagne {bet} ${pointsname} à la roulette et possède maintenant {points} ${pointsname} ! 😎',
  roulette_lose:
    '/me {user} perd {bet} ${pointsname} à la roulette et possède maintenant {points} ${pointsname} ! ;)',
  roulette_allin_win:
    '/me ✨ {user} a eu uneuuuuh chatte et remporte {bet} ${pointsname} ✨ {user} a maintenant {points} ${pointsname} raptor199Pog',
  roulette_allin_lose:
    '/me {user} a all in et a totu perdu de ses {bet} ${pointsname} raptor199Money Gros naze !',
  slot_win: '@{user} {emotes} tu remportes {points} ${pointsname} ! 🍀',
  slot_lose: '@{user} {emotes} tu perds {points} ${pointsname} 😳',
} as const;

export const POINTS_NAME = 'Jetons';

/** A random number in [0, 1). */
export type Rng = () => number;
export const cryptoRng: Rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

/** `!roulette 100` → { game, arg: '100' }; anything else → null. */
export function parseCommand(
  text: string,
): { game: MiniGame; arg: string | null } | null {
  const [head, arg] = text.trim().split(/\s+/, 2);
  if (!head?.startsWith('!')) return null;
  const game = MINI_GAME_WORDS[head.slice(1).toLowerCase()];
  return game ? { game, arg: arg ?? null } : null;
}

export type BetRefusal = 'invalid' | 'below_min' | 'insufficient';
export type Bet = { amount: number; allIn: boolean } | { refused: BetRefusal };

/** The bet of a message, against the viewer's balance (§ 4). Always rounded down. */
export function resolveBet(
  game: MiniGame,
  arg: string | null,
  balance: number,
): Bet {
  const min = MINI_GAME_RULES[game].minBet;
  let amount: number;
  let allIn = false;
  const a = arg?.toLowerCase() ?? null;
  if (a === null) {
    if (game === 'roulette') return { refused: 'invalid' };
    amount = min;
  } else if (a === 'all') {
    if (game !== 'roulette') return { refused: 'invalid' };
    amount = balance;
    allIn = true;
  } else {
    const pct = /^(\d{1,3})%$/.exec(a);
    const num = /^(\d{1,12}(?:[.,]\d{1,3})?)([km])?$/.exec(a);
    if (pct) {
      const p = Number(pct[1]);
      if (p < 1 || p > 100) return { refused: 'invalid' };
      amount = Math.floor((balance * p) / 100);
    } else if (num) {
      const mult = num[2] === 'k' ? 1_000 : num[2] === 'm' ? 1_000_000 : 1;
      amount = Math.floor(Number(num[1]!.replace(',', '.')) * mult);
    } else return { refused: 'invalid' };
  }
  if (amount < min) return { refused: 'below_min' };
  if (amount > balance) return { refused: 'insufficient' };
  return { amount, allIn };
}

export interface Draw {
  won: boolean;
  /** Slot only: the three reels. */
  symbols: string[] | null;
}

export function draw(game: MiniGame, rng: Rng): Draw {
  if (game === 'roulette')
    return { won: rng() < MINI_GAME_RULES.roulette.winChance, symbols: null };
  const reels = [0, 1, 2].map(
    () => SLOT_SYMBOLS[Math.floor(rng() * SLOT_SYMBOLS.length)]!,
  );
  return { won: reels.every((s) => s === reels[0]), symbols: reels };
}

/** Net change of the balance: +1× (Roulette) / +24× (Slot) the bet on a win, −the bet on a loss. */
export const netGain = (game: MiniGame, bet: number, won: boolean) =>
  won ? bet * MINI_GAME_RULES[game].netMultiplier : -bet;

/** The chat answer of a game. */
export function resultText(p: {
  game: MiniGame;
  won: boolean;
  allIn: boolean;
  user: string;
  bet: number;
  delta: number;
  balanceAfter: number;
  symbols: string[] | null;
}): string {
  const key: keyof typeof TEXTS =
    p.game === 'slot'
      ? p.won
        ? 'slot_win'
        : 'slot_lose'
      : `roulette_${p.allIn ? 'allin_' : ''}${p.won ? 'win' : 'lose'}`;
  const vars: Record<string, string> = {
    user: p.user,
    bet: String(p.bet),
    // Roulette: the balance after the game. Slot: the amount of the result (net gain +24× or the bet lost).
    points: String(p.game === 'slot' ? Math.abs(p.delta) : p.balanceAfter),
    pointsname: POINTS_NAME,
    emotes: (p.symbols ?? []).join(' '),
  };
  return TEXTS[key]
    .replace(/^\/me\s+/, '')
    .replace(/\$?\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}
