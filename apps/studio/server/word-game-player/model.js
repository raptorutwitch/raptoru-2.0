// Jeu des mots V1 — OBS sound source, pure model (docs/WORD_GAME_PARITY.md § 18). The source plays
// ShuffleWordsSong.ogg once per WINNING MESSAGE. Core records a winning message only with its Wallet
// credit (a refused credit leaves no win), so Core's `recent` wins are exactly what to play: never on
// !mots, !streakmot, a new word or a lone announcement. Kept apart from the DOM to be tested on its own.

/** A win older than this when first seen is not played (a source opened or reloaded late). */
export const FRESH_MS = 30_000;

/** Order of two wins: creation time, then message id. */
const after = (a, b) =>
  a.created_at === b.created_at
    ? a.message_id > b.message_id
    : Date.parse(a.created_at) > Date.parse(b.created_at);

/**
 * From the last wins read (any order) and the cursor (the last win already played or seen; null when
 * nothing is remembered), the wins to play, oldest first, and the new cursor.
 * - No cursor (first read, or nothing remembered): nothing played, the newest win becomes the cursor —
 *   opening or reloading the source never replays the past.
 * - Otherwise: every win after the cursor, still fresh (a win missed during a short reload is played,
 *   an old one is not); reading the same win again never plays it twice.
 */
export function winsToPlay(recent, cursor, now) {
  const wins = [...recent].sort((a, b) =>
    after(a, b) ? 1 : after(b, a) ? -1 : 0,
  );
  const newest = wins.length ? wins[wins.length - 1] : null;
  const next =
    newest && (!cursor || after(newest, cursor)) ? pick(newest) : cursor;
  if (!cursor) return { play: [], cursor: next };
  const play = wins.filter(
    (w) => after(w, cursor) && now - Date.parse(w.created_at) <= FRESH_MS,
  );
  return { play: play.map((w) => w.message_id), cursor: next };
}

const pick = (w) => ({ message_id: w.message_id, created_at: w.created_at });
