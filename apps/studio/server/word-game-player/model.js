// Jeu des mots V1 — OBS sound source, pure model (docs/WORD_GAME_PARITY.md § 18). The source plays
// ShuffleWordsSong.ogg once per WINNING MESSAGE. Core pushes an event only for a committed win (Wallet
// credit included; never for a replay, a refused credit, !mots, !streakmot, a new word or a lone
// announcement), and only live: nothing is replayed on (re)connection. Kept apart from the DOM to be
// tested on its own.

/** Message ids remembered as played (a duplicate delivery never plays twice, even after a reload). */
export const PLAYED_MEMORY = 50;

/** Volume (0–1) of the winning sound, sent by Studio with each win; an older Studio sends none: full volume. */
export function soundVolume(win) {
  const v = Number(win?.volume);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

/**
 * One received win event against the ids already played: whether to play it, and the ids to remember
 * (the last PLAYED_MEMORY ones).
 */
export function admit(played, messageId) {
  if (typeof messageId !== 'string' || !messageId || played.includes(messageId))
    return { play: false, played };
  return { play: true, played: [...played, messageId].slice(-PLAYED_MEMORY) };
}
