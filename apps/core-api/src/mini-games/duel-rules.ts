import { POINTS_NAME } from './rules.js';

// Duel V1 (Lab) — pure rules (docs/DUEL_PARITY.md). StreamElements parity, no redesign: commands, bets and chat
// texts. No database, no clock: the duel service applies them in transactions.

export const DUEL_RULES = {
  maxBet: 100_000,
  cooldownMs: 30_000,
  expiresMs: 120_000,
} as const;

export type DuelCommand =
  | { kind: 'challenge'; target: string | null; arg: string | null }
  | { kind: 'accept' | 'deny' | 'cancel' };

/** Chat words (without « ! »). Reserved for Commands V2. */
export const DUEL_WORDS = {
  duel: 'challenge',
  accept: 'accept',
  deny: 'deny',
  cancelduel: 'cancel',
} as const;

/** A Twitch login (lowercase, 1–25 letters, digits or « _ »). */
const LOGIN = /^[a-z0-9_]{1,25}$/;

/**
 * `!duel @Bob 500` → challenge (target « bob », arg « 500 »); `!accept` / `!deny` / `!cancelduel`. The target is
 * null when missing or not a possible Twitch login (the service ignores it). Anything else → null.
 */
export function parseDuelCommand(text: string): DuelCommand | null {
  const [head, target, arg] = text.trim().split(/\s+/, 3);
  if (!head?.startsWith('!')) return null;
  const kind =
    DUEL_WORDS[head.slice(1).toLowerCase() as keyof typeof DUEL_WORDS];
  if (!kind) return null;
  if (kind !== 'challenge') return { kind };
  const login = target?.replace(/^@/, '').toLowerCase() ?? '';
  return {
    kind,
    target: LOGIN.test(login) ? login : null,
    arg: arg ?? null,
  };
}

export type DuelBet =
  { amount: number; capped: boolean } | { refused: 'invalid' | 'insufficient' };

/**
 * The bet of a challenge against the challenger's balance (§§ 2, 4): none = free duel (0); number / `k` / `m` /
 * `%` / `all` (of the challenger's balance), rounded down; above 100 000 → brought back to 100 000; never more
 * than the challenger's balance.
 */
export function resolveDuelBet(arg: string | null, balance: number): DuelBet {
  let amount: number;
  const a = arg?.toLowerCase() ?? null;
  if (a === null) amount = 0;
  else if (a === 'all') amount = balance;
  else {
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
  const capped = amount > DUEL_RULES.maxBet;
  if (capped) amount = DUEL_RULES.maxBet;
  if (amount > balance) return { refused: 'insufficient' };
  return { amount, capped };
}

/** The channel's StreamElements texts (win / points won) and the V1 texts (§ 5). `/me` dropped when sending. */
export const DUEL_TEXTS = {
  win: '/me {winner} a gagné contre {loser} ! GG à {winner} 💪 //',
  points_won:
    '/me {winner} a gagné le duel contre {loser} | {winner} remporte {points} ${pointsname} !',
  challenge_bet:
    '@{target}, {challenger} te défie en duel pour {points} ${pointsname} ! Tape !accept ou !deny (2 minutes).',
  challenge_free:
    '@{target}, {challenger} te défie en duel ! Tape !accept ou !deny (2 minutes).',
  denied: '{target} refuse le duel de {challenger}.',
  cancelled: '{challenger} annule son défi contre {target}.',
  self: '@{user}, tu ne peux pas te défier toi-même.',
  insufficient: "@{user}, tu n'as pas assez de ${pointsname} pour ce duel.",
  insufficient_at_accept:
    "Duel annulé : {user} n'a pas assez de ${pointsname} ({points} ${pointsname}).",
  pending:
    "@{user}, tu as déjà un défi en attente (!cancelduel pour l'annuler).",
  target_busy: '@{user}, {target} a déjà un défi en attente.',
  unknown_target: '@{user}, impossible de trouver {target} sur Twitch.',
} as const;

export function duelText(
  key: keyof typeof DUEL_TEXTS,
  vars: Record<string, string | number>,
): string {
  const all: Record<string, string> = { pointsname: POINTS_NAME };
  for (const [k, v] of Object.entries(vars)) all[k] = String(v);
  return DUEL_TEXTS[key]
    .replace(/^\/me\s+/, '')
    .replace(/\$?\{(\w+)\}/g, (m, k: string) => all[k] ?? m);
}
