// Bonk VNext lot 6 — multi-viewer combo. Counts DISTINCT viewers among the Bonks really played
// (never shots: a salve of 10 by one viewer = 1 participant). The window opens on the first Bonk and
// every Bonk refreshes it; when it expires with ≥ 2 viewers, one finisher is thrown, then everything
// resets. State is minimal: a Set of viewer ids, one tally per distinct emote, one timer.
// The finisher's size depends only on the viewer count, deliberately absurd (no aesthetic cap);
// FINISHER.maxSize is a technical bound only (browser / OBS stability).

export const COMBO = Object.freeze({
  /** Window refreshed by every Bonk (canonical legacy BONK_COMBO_WINDOW_MS, bonk-v3-core.js). */
  windowMs: 5000,
  minViewers: 2,
});

export const FINISHER = Object.freeze({
  /** Size (px) for 2…9 viewers; from 10 it keeps growing by `growth` per viewer. */
  sizes: [260, 340, 430, 530, 640, 760, 880, 1000],
  from10: 1100,
  growth: 130,
  /** Technical bound only (texture size, layout): never an aesthetic cap. */
  maxSize: 2400,
});

/** Finisher size for `viewers` distinct viewers (null under the minimum). */
export function finisherSize(viewers) {
  const n = Math.trunc(Number(viewers) || 0);
  if (n < COMBO.minViewers) return null;
  const size =
    n < 10
      ? FINISHER.sizes[n - 2]
      : FINISHER.from10 + (n - 10) * FINISHER.growth;
  return Math.min(FINISHER.maxSize, size);
}

/**
 * @param {object} o
 * @param {(c: {viewers: number, emote: unknown}) => void} o.onFinish called once per closed combo
 * @param {(cb: () => void, ms: number) => unknown} o.timer
 * @param {(handle: unknown) => void} o.cancel
 */
export function createCombo({
  onFinish,
  timer,
  cancel,
  windowMs = COMBO.windowMs,
  minViewers = COMBO.minViewers,
}) {
  let viewers = new Set();
  /** emote key → {emote, count, last} */
  let emotes = new Map();
  let seq = 0;
  let handle = null;

  const reset = () => {
    if (handle !== null) cancel(handle.timer);
    handle = null;
    viewers = new Set();
    emotes = new Map();
  };
  /** Finisher emote: the most used one; on a tie, the most recent (deterministic). */
  const pickEmote = () => {
    let best = null;
    for (const e of emotes.values())
      if (
        !best ||
        e.count > best.count ||
        (e.count === best.count && e.last > best.last)
      )
        best = e;
    return best?.emote ?? null;
  };
  const close = (own) => {
    if (own !== handle) return; // a stale timer never closes a newer window
    const count = viewers.size;
    const emote = pickEmote();
    reset();
    if (count >= minViewers && emote !== null)
      onFinish({ viewers: count, emote });
  };

  return {
    /** One Bonk played. `key`: identity of its emote; `emote`: what the finisher will throw. */
    add({ viewerId, key, emote }) {
      const id = String(viewerId ?? '').trim();
      if (!id || !key) return;
      viewers.add(id);
      const e = emotes.get(key) ?? { emote, count: 0, last: 0 };
      e.count += 1;
      e.last = ++seq;
      emotes.set(key, e);
      if (handle !== null) cancel(handle.timer);
      const own = {};
      handle = own;
      own.timer = timer(() => close(own), windowMs);
    },
    get viewers() {
      return viewers.size;
    },
    get open() {
      return handle !== null;
    },
    reset,
  };
}
