// Blackjack — the table policy (docs/CASINO.md § 18, Antoni's mandate of 21/11, B). Pure: the service applies it under the
// channel's lobby lock, the local demo runs the same code.
//
// - Anyone may open a NEW table (to play alone against the bank) even when others have free seats; it stays public and
//   joinable, never locked for its creator; one player = one table at a time (the service checks it).
// - Never two empty tables: asking for a new table while one stands empty seats you there (`reuse`). Opening then
//   leaving cannot pile up tables, so their number stays bounded by the players present.
// - A ceiling that follows the crowd: BASE_TABLES open tables, plus one per busy table (at least BUSY_PLAYERS seated),
//   never more than MAX_TABLES. Full tables still open the next one by themselves (plain « find a seat », up to MAX).
// - A table empty for EMPTY_CLOSE_MS, with no pending step, closes (its rounds stay in casino_rounds); the channel
//   always keeps its lowest-numbered table. Numbers are reused: a new table takes the smallest free one.

export const MAX_TABLES = 8;
export const BASE_TABLES = 5;
export const BUSY_PLAYERS = 6;
export const EMPTY_CLOSE_MS = 10 * 60_000;

export interface LobbyTable {
  no: number;
  /** Taken seats (a player who left a round in progress still holds his). */
  players: number;
}
export interface CreatePolicy {
  allowed: boolean;
  reason: null | 'tables_cap' | 'casino_full';
  /** How many tables may be open right now. */
  cap: number;
  open: number;
  /** An empty table a « new table » request reuses (its number), or null. */
  reuse: number | null;
}

export function createPolicy(tables: LobbyTable[]): CreatePolicy {
  const open = tables.length;
  const busy = tables.filter((t) => t.players >= BUSY_PLAYERS).length;
  const cap = Math.min(MAX_TABLES, BASE_TABLES + busy);
  const empty = tables
    .filter((t) => t.players === 0)
    .sort((a, b) => a.no - b.no)[0];
  if (empty) return { allowed: true, reason: null, cap, open, reuse: empty.no };
  if (open >= MAX_TABLES)
    return { allowed: false, reason: 'casino_full', cap, open, reuse: null };
  if (open >= cap)
    return { allowed: false, reason: 'tables_cap', cap, open, reuse: null };
  return { allowed: true, reason: null, cap, open, reuse: null };
}

/** The smallest table number not in use (a closed table leaves its number free). */
export function nextTableNo(used: number[]): number {
  const taken = new Set(used);
  let n = 1;
  while (taken.has(n)) n += 1;
  return n;
}

export interface IdleTable extends LobbyTable {
  id: string;
  /** Last change of the table (ms). */
  since: number;
  /** A step still pending (a round being played, a deal…): never closed. */
  pending: boolean;
}
/** The tables to close now: empty for EMPTY_CLOSE_MS with no pending step — never the channel's lowest-numbered one. */
export function closable(tables: IdleTable[], now: number): string[] {
  const keep = Math.min(...tables.map((t) => t.no));
  return tables
    .filter(
      (t) =>
        t.no !== keep &&
        t.players === 0 &&
        !t.pending &&
        now - t.since >= EMPTY_CLOSE_MS,
    )
    .map((t) => t.id);
}
