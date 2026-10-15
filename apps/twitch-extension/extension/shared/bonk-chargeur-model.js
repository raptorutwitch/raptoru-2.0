// Bonk lot 5 — chargeur model (pure, no DOM). Validated UX: prototypes/bonk-salves-ux/serie7/final.html.
// The chargeur is the viewer's ordered selection of munitions. Manuel: each click fires the next one as
// an individual Bonk (nothing prepaid). Auto: one click sends every remaining munition as one salve,
// admitted and paid by Core atomically. Core owns the bounds (max shots, cadence) and the price.

/** Auto speeds, clicked in this order. The delay between two starts is clamped to Core's bounds. */
export const BONK_SPEEDS = Object.freeze([
  { name: 'Lent', ms: 420 },
  { name: 'Moyen', ms: 260 },
  { name: 'Rapide', ms: 160 },
  { name: 'Très rapide', ms: 95 },
]);

/**
 * @param {{maxShots: number}} limits Core's max munitions per salve (also the chargeur's capacity).
 */
export function createChargeurModel(limits) {
  const m = {
    /** @type {{emote: {id: string}, qty: number}[]} in loading (= firing) order */
    items: [],
    /** Munitions already gone (Manuel shots, or the salve in flight). */
    pos: 0,
    mode: 'manual',
    /** 1..4, index + 1 in BONK_SPEEDS. */
    speed: 2,
    /** An Auto salve is being played: the switch and the chargeur are locked. */
    busy: false,
    maxShots: limits.maxShots,
  };

  const total = () => m.items.reduce((n, i) => n + i.qty, 0);
  const remaining = () => total() - Math.min(m.pos, total());
  const sequence = () => m.items.flatMap((i) => Array(i.qty).fill(i.emote));
  /** Munitions of `id` still to fire (Manuel order: the carousel order). */
  function leftOf(id) {
    let before = 0;
    for (const it of m.items) {
      if (it.emote.id === id)
        return it.qty - Math.max(0, Math.min(it.qty, m.pos - before));
      before += it.qty;
    }
    return 0;
  }
  function nextId() {
    let before = 0;
    for (const it of m.items) {
      if (m.pos < before + it.qty) return it.emote.id;
      before += it.qty;
    }
    return null;
  }

  return {
    state: m,
    total,
    remaining,
    sequence,
    leftOf,
    nextId,
    setMaxShots(n) {
      m.maxShots = n;
    },
    /** One catalogue click = one munition. Refused when full. */
    add(emote) {
      if (m.busy) return { ok: false, reason: 'busy' };
      if (total() >= m.maxShots) return { ok: false, reason: 'full' };
      const it = m.items.find((i) => i.emote.id === emote.id);
      if (it) it.qty += 1;
      else m.items.push({ emote, qty: 1 });
      return { ok: true, first: total() === 1 };
    },
    /** Click on a loaded emote: one munition less. */
    dec(id) {
      const it = m.items.find((i) => i.emote.id === id);
      if (!it || m.busy) return false;
      it.qty -= 1;
      if (it.qty <= 0) m.items = m.items.filter((i) => i !== it);
      m.pos = Math.min(m.pos, total());
      return true;
    },
    /** Right click / long press: the whole emote out. */
    remove(id) {
      if (m.busy || !m.items.some((i) => i.emote.id === id)) return false;
      m.items = m.items.filter((i) => i.emote.id !== id);
      m.pos = Math.min(m.pos, total());
      return true;
    },
    /** Empties the chargeur; returns what « Annuler » puts back. */
    clear() {
      const snapshot = {
        items: m.items.map((i) => ({ ...i })),
        pos: m.pos,
      };
      m.items = [];
      m.pos = 0;
      return snapshot;
    },
    restore(snapshot) {
      m.items = snapshot.items.map((i) => ({ ...i }));
      m.pos = Math.min(snapshot.pos, total());
    },
    /** « ↻ Recharger » (free): the whole selection is loaded again. */
    rearm() {
      m.pos = 0;
    },
    /** Switching Manuel ↔ Auto keeps the chargeur exactly as it is (no reset, no reload). */
    setMode(mode) {
      if (m.busy) return false;
      m.mode = mode;
      return true;
    },
    cycleSpeed() {
      m.speed = (m.speed % BONK_SPEEDS.length) + 1;
      return m.speed;
    },
    cadenceMs(bounds) {
      const ms = BONK_SPEEDS[m.speed - 1].ms;
      return Math.min(bounds.max, Math.max(bounds.min, ms));
    },
    /** What the price button does now. */
    action() {
      if (!total()) return 'none';
      if (m.busy) return 'send'; // the salve in flight: its remaining price, locked
      if (!remaining()) return 'rearm';
      return m.mode === 'auto' ? 'send' : 'fire';
    },
    /** Manuel: one Bonk. Auto: every remaining munition (the salve). */
    price(cost) {
      return m.mode === 'auto' ? remaining() * cost : cost;
    },
    /** Manuel click: the next munition, consumed at once (the next click already reads the one after). */
    fire() {
      if (m.mode !== 'manual' || m.busy || !remaining()) return null;
      const index = m.pos;
      const emote = sequence()[index];
      m.pos += 1;
      return { index, emote };
    },
    /** A refused Manuel shot gives its munition back (only if nothing was fired after it). */
    unfire(shot) {
      if (shot && m.pos === shot.index + 1) m.pos = shot.index;
    },
    /** Auto click: the remaining munitions, in firing order (the chargeur is locked until `endSalve`). */
    salve() {
      if (m.mode !== 'auto' || m.busy || !remaining()) return null;
      m.busy = true;
      return sequence().slice(m.pos);
    },
    /** Admitted salve played: the chargeur reloads (the selection stays for the next one). */
    endSalve(admitted) {
      m.busy = false;
      if (admitted) m.pos = 0;
    },
  };
}
