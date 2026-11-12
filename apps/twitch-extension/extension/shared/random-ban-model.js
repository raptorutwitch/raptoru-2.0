// Random Ban (Mini-jeux) — the view's PURE part (docs/mini-jeux/UX_UI_MINI_JEUX.md § 4, SPEC § 2.4): the gauge
// projected from the Core's own times, the request statuses in the viewer's words, the history lines. The Core decides
// every price; this only projects it between two reads (the local clock never sets an amount).

import { formatCompactAmount } from './currency.js';

// A plain no-break space: the narrow one (U+202F) is missing from the big price's font (seen in Chromium: « 30000 »).
const fr = (n) => Number(n || 0).toLocaleString('fr-FR').replace(/\s/g, ' ');

/** « 4 min 10 s » / « 45 s » / « 16 min ». */
export function waitText(ms, { seconds = true } = {}) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  if (!seconds) return `${Math.max(1, Math.ceil(s / 60))} min`;
  if (!m) return `${s} s`;
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

/**
 * The gauge at `nowLocal`, from the Core's quote read at `readAtLocal` (server_now ↔ readAtLocal: the local clock only
 * measures the time elapsed since the read, never the time itself).
 * Returns null at the normal price (no gauge).
 */
export function gaugeModel(price, readAtLocal, nowLocal, stepMs, { reducedMotion = false } = {}) {
  if (!price || !price.level || !price.next_drop_at) return null;
  const serverNow = Date.parse(price.server_now) + Math.max(0, nowLocal - readAtLocal);
  const nextIn = Math.max(0, Date.parse(price.next_drop_at) - serverNow);
  const normalIn = Math.max(0, Date.parse(price.normal_at) - serverNow);
  let fraction = stepMs > 0 ? Math.min(1, nextIn / stepMs) : 0;
  // Reduced motion: the bar moves by whole minutes, never continuously.
  if (reducedMotion && stepMs > 0) fraction = Math.min(1, Math.ceil(nextIn / 60_000) * 60_000 / stepMs);
  return {
    level: price.level,
    price: price.price,
    next_price: price.next_price,
    fraction,
    next_in_ms: nextIn,
    normal_in_ms: normalIn,
    /** The step fell: read the Core again (the amount shown is always the server's). */
    stale: nextIn === 0,
  };
}

const STATUS = {
  queued: 'payé · en file',
  searching: 'tirage en cours',
  timeout_requested: 'sanction envoyée',
  confirmed: 'exclu',
  flop: 'personne d’éligible',
  failed: 'sans effet · remboursé',
  uncertain: 'à vérifier par un modérateur',
  canceled: 'annulé · remboursé',
  simulated: 'essai à blanc',
};
export const OPEN_STATUSES = ['queued', 'searching', 'timeout_requested'];

/** One request in the viewer's words. */
export function requestLine(r) {
  const who = r.target?.name ?? null;
  const what =
    r.status === 'confirmed' && who
      ? r.streamer_mute
        ? `micro de ${who} coupé`
        : r.target?.id === r.buyer?.id
          ? 'CSC ! tu t’es tiré toi-même'
          : `${who} exclu ${Math.round((r.duration_s ?? 0) / 60)} min`
      : r.status === 'simulated' && who
        ? `essai à blanc · ${who}`
        : (STATUS[r.status] ?? r.status);
  const paid = Number.isInteger(r.price_paid) ? `${fr(r.price_paid)} Jetons` : r.source === 'channel_points' ? 'points de chaîne' : '';
  const via = { extension: 'extension', chat: '!rb', channel_points: 'points de chaîne' }[r.source] ?? '';
  return { what, paid, via, open: OPEN_STATUSES.includes(r.status), at: r.created_at };
}

const SNIPER = {
  armed: 'Sniper : en attente du tirage',
  hit: 'SNIPER ! prime gagnée',
  miss: 'Sniper raté',
  glory: 'Sniper raté (pour la gloire)',
  glory_hit: 'SNIPER ! pour la gloire (sans prime)',
  void: 'Sniper sans effet',
  revoked: 'Sniper : prime retirée',
};

/** The Sniper line of one request (null: no prediction). */
export function sniperLine(r) {
  if (!r?.wish) return null;
  const name = r.wish.name ?? '?';
  const what = SNIPER[r.sniper] ?? '';
  return `🎯 ${name} · ${what}${r.sniper === 'hit' && r.sniper_bonus ? ` +${fr(r.sniper_bonus)}` : ''}`;
}

/** The Sniper's readiness in the viewer's words (the final decision is the server's, at the result). */
export function sniperReadyText(sniper, readAtLocal, nowLocal, serverNow) {
  if (!sniper) return '';
  if (sniper.ready || !sniper.ready_at) return `Sniper prêt : +${fr(sniper.bonus)} Jetons si le tirage tombe sur ta cible.`;
  const left = Date.parse(sniper.ready_at) - (Date.parse(serverNow) + Math.max(0, nowLocal - readAtLocal));
  return left > 0
    ? `Sniper pour la gloire : prime possible dans ${waitText(left, { seconds: false })} (aucun Random Ban d’ici là).`
    : `Sniper prêt : +${fr(sniper.bonus)} Jetons si le tirage tombe sur ta cible.`;
}

/** « 50 K » in tight places, the exact amount elsewhere. */
export const priceText = (n) => `${fr(n)} Jetons`;
export const priceShort = (n) => formatCompactAmount(n);
