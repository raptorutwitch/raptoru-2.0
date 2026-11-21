// Blackjack — the players' reactions at a table (docs/CASINO.md § 18, Antoni's mandate of 21/11, C). A seated player
// sends one of the allowed ids (never free text, never Jetons); every screen following the table receives it with the
// table's state (the long-poll answers for a new reaction too) and shows it briefly above that seat.
//
// In memory, like the presence (one Core process in Production): a reaction lives REACTION_KEEP_MS, a table keeps its
// last REACTION_KEEP_N. A Core restart loses the last few seconds of reactions, nothing else. The numbers `n` follow the
// clock (never reused after a restart), so a screen never mistakes a new reaction for one it has already shown.
// Anti-spam (Antoni's mandate of 22/11): a bucket of REACTION_BURST tokens per viewer, one more every REACTION_REFILL_MS —
// a burst of 5, then one every 2 s, never more than 5 saved up. A refusal costs nothing (429 react_rate, retry_in_ms)
// and is never stored. The extension mirrors the same bucket for an immediate answer; this one decides.
import { CasinoError } from '../errors.js';

/** The ids the Core accepts. Their pictures live in the extension (assets/casino/reactions/reactions.js). */
export const REACTION_IDS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'] as const;
export const REACTION_KEEP_MS = 10_000;
export const REACTION_KEEP_N = 32;
export const REACTION_BURST = 5;
export const REACTION_REFILL_MS = 2_000;

export interface Reaction {
  n: number;
  seat: number;
  r: string;
  at: number;
}

export const isReactionId = (r: unknown): r is (typeof REACTION_IDS)[number] =>
  typeof r === 'string' && (REACTION_IDS as readonly string[]).includes(r);

export class TableReactions {
  private readonly tables = new Map<string, Reaction[]>();
  private readonly users = new Map<string, { tokens: number; at: number }>();
  private last = 0;

  /** A reaction from `user` at `seat`: its number. Too fast → 429 react_rate (retry_in_ms). */
  push(tableId: string, user: string, seat: number, r: string, now: number) {
    const b = this.users.get(user) ?? { tokens: REACTION_BURST, at: now };
    b.tokens = Math.min(
      REACTION_BURST,
      b.tokens + Math.max(0, now - b.at) / REACTION_REFILL_MS,
    );
    b.at = now;
    if (b.tokens < 1)
      throw new CasinoError(429, 'react_rate', {
        retry_in_ms: Math.ceil((1 - b.tokens) * REACTION_REFILL_MS),
      });
    b.tokens -= 1;
    this.users.set(user, b);
    if (this.users.size > 2_000) this.prune(now);
    const n = (this.last = Math.max(this.last + 1, now));
    const list = (this.tables.get(tableId) ?? []).filter(
      (x) => now - x.at < REACTION_KEEP_MS,
    );
    list.push({ n, seat, r, at: now });
    this.tables.set(tableId, list.slice(-REACTION_KEEP_N));
    return n;
  }
  /** The table's latest reaction number (0: none since this Core started). */
  seq(tableId: string) {
    return this.tables.get(tableId)?.at(-1)?.n ?? 0;
  }
  /** What a screen receives: the recent reactions, their age (the screen never replays an old one). */
  view(tableId: string, now: number) {
    const list = (this.tables.get(tableId) ?? []).filter(
      (x) => now - x.at < REACTION_KEEP_MS,
    );
    return {
      seq: this.seq(tableId),
      list: list.map((x) => ({
        n: x.n,
        seat: x.seat,
        r: x.r,
        age_ms: now - x.at,
      })),
    };
  }
  /** A closed table. */
  drop(tableId: string) {
    this.tables.delete(tableId);
  }
  private prune(now: number) {
    // A bucket full again is the same as no bucket at all.
    for (const [u, b] of this.users)
      if (b.tokens + (now - b.at) / REACTION_REFILL_MS >= REACTION_BURST)
        this.users.delete(u);
  }
}
