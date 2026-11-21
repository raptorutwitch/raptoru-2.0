// Blackjack — the players' reactions at a table (docs/CASINO.md § 18, Antoni's mandate of 21/11, C). A seated player
// sends one of the allowed ids (never free text, never Jetons); every screen following the table receives it with the
// table's state (the long-poll answers for a new reaction too) and shows it briefly above that seat.
//
// In memory, like the presence (one Core process in Production): a reaction lives REACTION_KEEP_MS, a table keeps its
// last REACTION_KEEP_N. A Core restart loses the last few seconds of reactions, nothing else. The numbers `n` follow the
// clock (never reused after a restart), so a screen never mistakes a new reaction for one it has already shown.
// Anti-spam: one reaction per REACTION_GAP_MS per viewer, at most REACTION_BURST per REACTION_WINDOW_MS.
import { CasinoError } from '../errors.js';

/** The ids the Core accepts. Their pictures live in the extension (assets/casino/reactions/reactions.js). */
export const REACTION_IDS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'] as const;
export const REACTION_KEEP_MS = 10_000;
export const REACTION_KEEP_N = 16;
export const REACTION_GAP_MS = 1_500;
export const REACTION_WINDOW_MS = 30_000;
export const REACTION_BURST = 8;

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
  private readonly users = new Map<string, number[]>();
  private last = 0;

  /** A reaction from `user` at `seat`: its number. Too fast → 429 react_rate (retry_in_ms). */
  push(tableId: string, user: string, seat: number, r: string, now: number) {
    const times = (this.users.get(user) ?? []).filter(
      (t) => now - t < REACTION_WINDOW_MS,
    );
    const prev = times[times.length - 1];
    const wait =
      prev !== undefined && now - prev < REACTION_GAP_MS
        ? REACTION_GAP_MS - (now - prev)
        : times.length >= REACTION_BURST
          ? REACTION_WINDOW_MS - (now - times[0]!)
          : 0;
    if (wait > 0)
      throw new CasinoError(429, 'react_rate', { retry_in_ms: wait });
    times.push(now);
    this.users.set(user, times);
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
    for (const [u, t] of this.users)
      if (!t.length || now - t[t.length - 1]! >= REACTION_WINDOW_MS)
        this.users.delete(u);
  }
}
