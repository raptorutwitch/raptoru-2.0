// Bonk VNext lot 5 — cadence of a salve. Core admits a salve as N individual Bonks and hands them to
// Studio together; the renderer starts shot k+1 `cadence_ms` after shot k started (never earlier). A
// later start (image decode, density wait) simply shifts the next slots: no shot is skipped or hurried.

/**
 * Milliseconds to wait before starting shot `i`.
 * @param {{volley: {id: string, index: number, cadence_ms: number} | null}} i
 * @param {{volley: string, at: number} | null} last start of the previous shot of a salve
 * @param {number} now same clock as `last.at`
 */
export function volleyDelay(i, last, now) {
  const v = i.volley;
  if (!v || v.index === 0 || !last || last.volley !== v.id) return 0;
  return Math.max(0, last.at + v.cadence_ms - now);
}

/** After shot `i` started at `now`: what the next shot of its salve waits on (null outside a salve). */
export const shotStarted = (i, now) =>
  i.volley ? { volley: i.volley.id, at: now } : null;

/** True while shot `i` is followed by another shot of its salve (ask Studio for it at once). */
export const moreInVolley = (i) =>
  !!i?.volley && i.volley.index < i.volley.count - 1;
