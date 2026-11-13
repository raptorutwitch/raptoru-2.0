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
  unresolved: 'pronostic à vérifier par un modérateur',
  revoked: 'Sniper : prime retirée',
};

/** The Sniper line of one request (null: no prediction). */
export function sniperLine(r) {
  if (!r?.wish) return null;
  const name = r.wish.name ?? r.wish.text ?? '?';
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

// --- Sniper: free text with suggestions (UX refonte 13/11) ---------------------------------------------------------

/** What the viewer typed, as the Core reads it: trimmed, « @ » dropped. */
export const cleanWish = (text) => String(text ?? '').trim().replace(/^@+/, '').trim().slice(0, 40);

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The suggestions for a typed name, best first (at most `limit`): the exact account first (login or display name),
 * then the names that start with it, contain it, or are one or two typos away. `exact` marks the only sure match —
 * a suggestion is never picked for the viewer.
 */
export function matchViewers(candidates, text, limit = 5) {
  const q = cleanWish(text).toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const c of candidates ?? []) {
    const login = String(c.login ?? '').toLowerCase();
    const name = String(c.name ?? '').toLowerCase();
    let score = null;
    if (login === q || name === q) score = 0;
    else if (login.startsWith(q) || name.startsWith(q)) score = 1;
    else if (login.includes(q) || name.includes(q)) score = 2;
    else if (q.length >= 3) {
      const d = Math.min(distance(q, login), distance(q, name));
      if (d <= (q.length >= 6 ? 2 : 1)) score = 2 + d;
    }
    if (score !== null) scored.push({ ...c, score, exact: score === 0 });
  }
  return scored
    .sort((a, b) => a.score - b.score || String(a.name).localeCompare(String(b.name), 'fr'))
    .slice(0, limit);
}

/** The one sure account for a typed name (null: none, or ambiguous). Same rule as the Core's. */
export function exactViewer(candidates, text) {
  const q = cleanWish(text).toLowerCase();
  if (!q) return null;
  const byLogin = (candidates ?? []).find((c) => String(c.login ?? '').toLowerCase() === q);
  if (byLogin) return byLogin;
  const byName = (candidates ?? []).filter((c) => String(c.name ?? '').toLowerCase() === q);
  return byName.length === 1 ? byName[0] : null;
}

// --- The result of one draw, as the game screen tells it ------------------------------------------------------------

/**
 * What the stage shows for one request: `phase` (wait: paid, not drawn yet · reel: a strip to scroll · done: nothing to
 * scroll, only a card), the outcome in a few words, its tone, and the Sniper's.
 */
export function resultModel(r) {
  if (!r) return null;
  const open = OPEN_STATUSES.includes(r.status);
  const phase = r.strip?.items?.length ? 'reel' : open ? 'wait' : 'done';
  const who = r.target?.name ?? null;
  const self = !!r.target && r.target.id === r.buyer?.id;
  const minutes = Math.round((r.duration_s ?? 0) / 60);
  const outcome = {
    queued: ['Tirage en préparation…', 'wait'],
    searching: ['Tirage en cours…', 'wait'],
    timeout_requested: ['Sanction en cours…', 'wait'],
    confirmed: [r.streamer_mute ? 'Micro coupé !' : self ? 'CSC ! Tiré toi-même' : `Exclu ${minutes} min`, 'ok'],
    simulated: ['Essai à blanc : personne n’est exclu', 'info'],
    flop: ['Personne d’éligible', 'info'],
    failed: ['Sans effet · remboursé', 'bad'],
    uncertain: ['Sanction non confirmée : un modérateur vérifie', 'bad'],
    canceled: ['Annulé · remboursé', 'bad'],
  }[r.status] ?? [r.status, 'info'];
  const sniper = !r.wish
    ? null
    : {
        name: r.wish.name ?? r.wish.text ?? '?',
        state: r.sniper,
        hit: r.sniper === 'hit' || r.sniper === 'glory_hit',
        bonus: r.sniper === 'hit' ? r.sniper_bonus || 0 : 0,
        text:
          r.sniper === 'hit'
            ? `SNIPER ! +${fr(r.sniper_bonus)} Jetons`
            : r.sniper === 'glory_hit'
              ? 'SNIPER ! pour la gloire'
              : r.sniper === 'unresolved'
                ? 'Pronostic à vérifier'
                : r.sniper === 'armed'
                  ? `Visé : ${r.wish.name ?? r.wish.text}`
                  : ['miss', 'glory'].includes(r.sniper)
                    ? 'Sniper raté'
                    : '',
      };
  return { phase, who, self, text: outcome[0], tone: outcome[1], open, sniper };
}

/** One line of the « Historique » panel: who launched, who was drawn, the result, the price, the Sniper. */
export function historyLine(r) {
  const res = resultModel(r);
  const via = { extension: 'extension', chat: '!rb', channel_points: 'points de chaîne' }[r.source] ?? '';
  const paid = Number.isInteger(r.price_paid) ? priceShort(r.price_paid) : r.source === 'channel_points' ? 'points' : '';
  return {
    id: r.request_id,
    buyer: r.buyer?.name ?? '?',
    target: res.who,
    result: res.text,
    tone: res.tone,
    meta: [via, paid].filter(Boolean).join(' · '),
    sniper: res.sniper ? `🎯 ${res.sniper.name} · ${res.sniper.hit ? 'touché' : r.sniper === 'unresolved' ? 'à vérifier' : r.sniper === 'armed' ? 'en attente' : 'raté'}` : null,
    at: r.created_at,
  };
}

// --- V3 (14/11): the price recovery gauge and the reel's rhythm ------------------------------------------------------

/**
 * The recovery gauge at `nowLocal`: where the buyer's price stands on the tier scale, CONTINUOUSLY (the time left to the
 * normal price over the time from the top tier to it). `fill` 0 = normal price, 1 = the top tier just bought. The tier
 * marks sit at i / (tiers − 1): the fill reaches a mark exactly when the Core's price drops to it. The amounts are the
 * Core's (price, next_price, tiers); the local clock only measures the time elapsed since the read.
 */
export function recoveryModel(price, tiers, readAtLocal, nowLocal, stepMs) {
  const list = Array.isArray(tiers) && tiers.length ? tiers : [price?.price ?? 0];
  const span = Math.max(1, (list.length - 1) * stepMs);
  const g = gaugeModel(price, readAtLocal, nowLocal, stepMs);
  const fill = g ? Math.min(1, g.normal_in_ms / span) : 0;
  return {
    price: price?.price ?? null,
    level: price?.level ?? 0,
    tiers: list,
    fill,
    marks: list.map((t, i) => ({ amount: t, at: list.length > 1 ? i / (list.length - 1) : 0, current: i === (price?.level ?? 0) })),
    next_price: g?.next_price ?? null,
    next_in_ms: g?.next_in_ms ?? 0,
    normal_in_ms: g?.normal_in_ms ?? 0,
    stale: !!g?.stale,
  };
}

/**
 * The reel's rhythm: the delay before each of `steps` portraits (fast, then slowing down on the last ones), adding up
 * to about `totalMs`. Pure, so the suspense is the same everywhere and testable.
 */
export function reelSchedule(steps, totalMs = 3400) {
  if (steps <= 1) return [0];
  const raw = Array.from({ length: steps }, (_, i) => 1 + 9 * Math.pow(i / (steps - 1), 2.6));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((r) => Math.round((r / sum) * totalMs));
}

// --- V4 (14/11): the machine is a carousel — the viewers pass THROUGH the centre ------------------------------------

/**
 * Where a portrait sits at distance `d` from the centre (in portraits, fractional while moving): horizontal offset
 * (in centre-portrait widths), scale and opacity. The centre one is whole; its neighbours smaller and darker.
 */
export function carouselSlot(d) {
  const a = Math.min(Math.abs(d), 3);
  return {
    x: Math.sign(d) * (a <= 1 ? a : 1 + (a - 1) * 0.7),
    scale: 1 - Math.min(a, 2) * 0.24,
    opacity: a >= 2.6 ? 0 : Math.max(0, 1 - a * 0.42),
    front: a < 0.5,
  };
}

/** The reel's position at `t` (0 → 1): fast at once, a long slow-down, a clean stop (no overshoot). */
export const reelProgress = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 4));
