// Dock OBS V1.1 (docs/OBS_DOCK.md) — the pure part of the dock page: categories, what an activity says (title,
// viewer, state, can it be replayed), the presentation grouping and the HTML. Every viewer-provided text (pseudo,
// message, reward or sound name) goes through esc(): the dock never inserts viewer HTML; the CSP forbids inline
// scripts anyway. Tested in apps/studio/server/test/dock-view.test.js.

/** Escapes text for HTML content and attribute values. */
export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"'`]/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;',
      })[c],
  );

// --- icons (Lucide shapes, ISC licence; stroke icons drawn in currentColor) ----------------------------------------

const PATHS = {
  heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6M2 9h20"/>',
  rocket:
    '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  banknote:
    '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  sparkle:
    '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  speech:
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  music:
    '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  hammer:
    '<path d="m15 12-8.5 8.5a2.12 2.12 0 0 1-3-3L12 9"/><path d="M17.64 15 22 10.64"/><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/>',
  ticket:
    '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
  gavel:
    '<path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  minus: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  undo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  arrowUp: '<path d="m5 12 7-7 7 7M12 19V5"/>',
};

/** An inline SVG icon (decorative: the text next to it says the same). */
export const icon = (name, cls = 'i') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? PATHS.dot}</svg>`;

// --- categories -----------------------------------------------------------------------------------------------------

/** The categories (filters and colours), in display order. Colour is never the only cue: each has its own icon. */
export const CATS = [
  { id: 'follow', label: 'Follows', icon: 'heart' },
  { id: 'sub', label: 'Abos et cadeaux', icon: 'star' },
  { id: 'bits', label: 'Bits', icon: 'gem' },
  { id: 'raid', label: 'Raids', icon: 'rocket' },
  { id: 'donation', label: 'Dons', icon: 'banknote' },
  { id: 'reward', label: 'Points de chaîne', icon: 'sparkle' },
  { id: 'tts', label: 'TTS', icon: 'speech' },
  { id: 'soundboard', label: 'Soundboard', icon: 'music' },
  { id: 'bonk', label: 'Bonk', icon: 'hammer' },
  { id: 'internal', label: 'Tombola et Random Ban', icon: 'ticket' },
];

const CAT_OF = {
  follow: 'follow',
  sub: 'sub',
  resub: 'sub',
  gift_targeted: 'sub',
  gift_community: 'sub',
  gift_recipient: 'sub',
  bits: 'bits',
  raid: 'raid',
  donation: 'donation',
  reward: 'reward',
  tts: 'tts',
  soundboard: 'soundboard',
  bonk: 'bonk',
  raffle: 'internal',
  random_ban: 'internal',
};
export const catOf = (a) => CAT_OF[a.type] ?? 'internal';

const ICON_OF = {
  gift_targeted: 'gift',
  gift_community: 'gift',
  gift_recipient: 'gift',
  random_ban: 'gavel',
};
const iconOf = (a) =>
  ICON_OF[a.type] ?? CATS.find((c) => c.id === catOf(a))?.icon ?? 'dot';

// --- preferences ----------------------------------------------------------------------------------------------------

/** Default preferences: everything shown, reward costs hidden. */
export const DEFAULT_PREFS = Object.freeze({ hidden: [], costs: false });

/** Reads stored preferences defensively (unknown categories dropped, wrong types ignored). */
export function readPrefs(raw) {
  const ids = new Set(CATS.map((c) => c.id));
  const hidden = Array.isArray(raw?.hidden)
    ? [...new Set(raw.hidden.filter((h) => ids.has(h)))]
    : [];
  return { hidden, costs: raw?.costs === true };
}

// --- what an activity says ------------------------------------------------------------------------------------------

const TIER = { 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3', prime: 'Prime' };

const nf = (n) => Number(n).toLocaleString('fr-FR').replace(/\s/g, ' ');
/** « 1 bit », « 1 234 bits » (the count stays a number for the plural). */
const plural = (n, one, many) => `${nf(n)} ${Number(n) > 1 ? many : one}`;

/** A person's display name (Twitch: display_name / name, else login), or « Anonyme ». */
export function who(a) {
  const p = a.data?.actor;
  if (a.data?.anonymous || !p) return 'Anonyme';
  return String(p.display_name || p.name || p.login || 'Anonyme');
}

/** A stable identity for « same viewer » (id, else name). */
const whoId = (a) =>
  a.data?.anonymous ? 'anon' : String(a.data?.actor?.id ?? who(a));

/** A donation amount in its own currency (never converted, never summed with another currency). */
export function money(amount) {
  if (!amount || typeof amount.value !== 'number') return '';
  const v = amount.value / 10 ** (amount.decimal_place ?? 0);
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: amount.currency,
    }).format(v);
  } catch {
    return `${v} ${amount.currency ?? ''}`.trim();
  }
}

const joined = (...parts) => parts.filter(Boolean).join(' · ');

/**
 * The bold coloured title and its short note (no viewer text in the note, except names chosen by the streamer:
 * reward, sound). `caps`: a generic title (shown in capitals); a reward or sound name keeps its own case.
 */
export function titleOf(a, prefs = DEFAULT_PREFS) {
  const d = a.data ?? {};
  const tier = TIER[d.tier] ?? '';
  switch (a.type) {
    case 'follow':
      return { title: 'Nouveau follow', caps: true };
    case 'sub':
      return { title: 'Nouvel abo', note: tier, caps: true };
    case 'resub':
      return {
        title: 'Réabonnement',
        note: joined(d.months ? `${nf(d.months)} mois` : '', tier),
        caps: true,
      };
    case 'gift_targeted':
      return {
        title: 'Abo offert',
        note: joined(
          d.recipient
            ? `à ${d.recipient.display_name || d.recipient.login}`
            : '',
          tier,
        ),
        caps: true,
      };
    case 'gift_community':
      return {
        title:
          (d.count ?? 1) > 1 ? `${nf(d.count)} abos offerts` : 'Abo offert',
        note: tier,
        caps: true,
      };
    case 'gift_recipient':
      return { title: 'Abo offert reçu', note: tier, caps: true };
    case 'bits':
      return { title: plural(d.bits ?? 0, 'bit', 'bits'), caps: true };
    case 'raid':
      return {
        title: 'Raid',
        note: plural(d.viewers ?? 0, 'viewer', 'viewers'),
        caps: true,
      };
    case 'donation':
      return { title: `Don ${money(d.amount)}`.trim(), caps: true };
    case 'reward':
      return {
        title: d.reward?.title || 'Récompense',
        note: prefs.costs && d.reward?.cost ? `${nf(d.reward.cost)} pts` : '',
      };
    case 'bonk':
      return { title: 'Bonk', note: d.emote?.glyph ?? '', caps: true };
    case 'soundboard':
      return { title: d.sound?.label || d.sound?.id || 'Son' };
    case 'tts':
      return { title: 'TTS', caps: true };
    case 'raffle':
      return { title: 'Tombola', note: 'participation', caps: true };
    case 'random_ban':
      return {
        title: 'Random Ban',
        note: d.target ? `→ ${d.target}` : '!rb',
        caps: true,
      };
    default:
      return { title: a.type, caps: true };
  }
}

/** The viewer text worth a preview line and the detail (message, TTS text, reward input). */
export const textOf = (a) =>
  typeof a.data?.message === 'string' && a.data.message.trim()
    ? a.data.message
    : '';

const PENDING_ALERT = new Set(['queued', 'claimed', 'playing']);
const ALERT_LABEL = {
  queued: 'Alerte en attente',
  claimed: 'Alerte en cours',
  playing: 'Alerte en cours',
  completed: 'Alerte jouée',
  failed: 'Alerte en échec',
  expired: 'Alerte non jouée',
};
const POINTS_LABEL = {
  pending: 'En cours de traitement',
  done: 'Traitée',
  partial: 'Traitée en partie',
  failed: 'Échec du traitement',
  ignored: 'Ignorée',
};
/** An interaction's status: [label, tone]. */
const IX = {
  accepted: ['Acceptée', 'wait'],
  queued: ['En attente', 'wait'],
  executing: ['En cours', 'wait'],
  starting: ['En cours', 'wait'],
  playing: ['En cours', 'wait'],
  searching: ['Tirage en cours', 'wait'],
  timeout_requested: ['Sanction demandée', 'wait'],
  completed: ['Exécutée', 'ok'],
  confirmed: ['Sanction appliquée', 'ok'],
  simulated: ['Simulée', 'ok'],
  flop: ['Flop', 'muted'],
  failed: ['Échec', 'bad'],
  execution_unknown: ['Résultat inconnu', 'bad'],
  uncertain: ['Résultat incertain', 'bad'],
  cancelled: ['Annulée', 'muted'],
};

/**
 * The state as an icon tone and its tooltip: for an alert, its animation (or why there is none); for a redemption,
 * Raptoru's processing and a cancellation on Twitch; for an interaction, its lifecycle, review and refund. `tone`:
 * ok / wait / bad / muted. `reason`: a failure's reason (for the detail, never on the main line).
 */
export function stateOf(a) {
  const s = a.state ?? {};
  if (a.kind === 'channel_points') {
    if (s.twitch_status === 'CANCELED')
      return { label: 'Annulée sur Twitch', tone: 'muted' };
    const tone =
      s.status === 'done'
        ? 'ok'
        : s.status === 'failed' || s.status === 'partial'
          ? 'bad'
          : s.status === 'pending'
            ? 'wait'
            : 'muted';
    return {
      label: POINTS_LABEL[s.status] ?? s.status ?? '',
      tone,
      reason: tone === 'bad' ? (s.reason ?? undefined) : undefined,
    };
  }
  if (a.kind === 'interaction') {
    const [label, tone] = IX[s.status] ?? [s.status ?? '', 'muted'];
    const review = s.review_status === 'pending';
    return {
      label: joined(
        review ? 'En attente de validation' : label,
        s.refund_status === 'refunded' ? 'remboursée' : '',
      ),
      tone: review ? 'wait' : tone,
      reason: s.error,
    };
  }
  if (s.outcome === 'below_threshold')
    return { label: 'Sous le seuil : pas d’animation', tone: 'muted' };
  if (s.outcome === 'absorbed')
    return { label: 'Dans un lot : pas d’animation propre', tone: 'muted' };
  const r = s.replay;
  if (r && PENDING_ALERT.has(r.status))
    return { label: 'Rejeu en attente', tone: 'wait' };
  const tone =
    s.alert_status === 'completed'
      ? 'ok'
      : s.alert_status === 'failed'
        ? 'bad'
        : PENDING_ALERT.has(s.alert_status)
          ? 'wait'
          : 'muted';
  return { label: ALERT_LABEL[s.alert_status] ?? '', tone };
}

const EMOTE_HOSTS = new Set([
  'static-cdn.jtvnw.net',
  'cdn.7tv.app',
  'cdn.betterttv.net',
  'cdn.frankerfacez.com',
]);

/** A Bonk's emote picture (Twitch, 7TV, BTTV, FFZ CDNs only — the same list as the dock's CSP), when it has no glyph. */
export function emoteHtml(a) {
  const e = a.type === 'bonk' ? a.data?.emote : null;
  if (!e || e.glyph || typeof e.url !== 'string') return '';
  try {
    const u = new URL(e.url);
    if (u.protocol !== 'https:' || !EMOTE_HOSTS.has(u.hostname)) return '';
    return `<img class="emote" src="${esc(u.href)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  } catch {
    return '';
  }
}

const TONE_ICON = { ok: 'check', bad: 'x', wait: 'clock', muted: 'minus' };

/** Can this activity's animation be replayed now? (the Core decides again; this only shows the button). */
export function replayable(a) {
  const s = a.state ?? {};
  return (
    a.kind === 'alert' &&
    !!s.alert_id &&
    ['completed', 'failed', 'expired'].includes(s.alert_status) &&
    !(s.replay && PENDING_ALERT.has(s.replay.status))
  );
}

// --- time -----------------------------------------------------------------------------------------------------------

const STEPS = [5, 10, 15, 20, 30, 45];

/**
 * « il y a quelques secondes » (< 1 min), « il y a quelques minutes » (< 5 min), then 5, 10, 15, 20, 30, 45 minutes,
 * hours, days up to 15, then « il y a plus de 15 jours ». The exact time is in the tooltip.
 */
export function ago(nowMs, iso) {
  const s = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return 'il y a quelques secondes';
  if (s < 300) return 'il y a quelques minutes';
  if (s < 3600)
    return `il y a ${STEPS.filter((x) => x * 60 <= s).at(-1)} minutes`;
  const h = Math.floor(s / 3600);
  if (h < 24) return h === 1 ? 'il y a 1 heure' : `il y a ${h} heures`;
  const d = Math.floor(h / 24);
  if (d <= 15) return d === 1 ? 'il y a 1 jour' : `il y a ${d} jours`;
  return 'il y a plus de 15 jours';
}

/** The exact time, for tooltips: « 27/10/2026 21:04:05 ». */
export const exact = (iso) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const clock = (iso) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

// --- ordering, folding, grouping ------------------------------------------------------------------------------------

/** Newest first; at the same time, the later projection first. */
export const byRecency = (x, y) =>
  y.occurred_at > x.occurred_at
    ? 1
    : y.occurred_at < x.occurred_at
      ? -1
      : y.seq - x.seq;

/** Oldest first, ties by key: an order that never depends on when a change was projected. */
const byTime = (x, y) =>
  x.occurred_at < y.occurred_at
    ? -1
    : x.occurred_at > y.occurred_at
      ? 1
      : x.activity_key < y.activity_key
        ? -1
        : x.activity_key > y.activity_key
          ? 1
          : 0;

/**
 * A community gift's recipients are folded into the gift (one row per batch, not one per recipient): an absorbed
 * recipient linked to a gift by `community_gift_id` is not shown as its own row.
 */
export const folded = (a) =>
  a.type === 'gift_recipient' &&
  a.state?.outcome === 'absorbed' &&
  !!a.data?.community_gift_id;

/** The recipients of each community gift (by community_gift_id), from the loaded activities. */
export function recipientsByGift(activities) {
  const out = new Map();
  for (const a of activities) {
    if (!folded(a)) continue;
    const id = a.data.community_gift_id;
    const list = out.get(id) ?? [];
    list.push(who(a));
    out.set(id, list);
  }
  return out;
}

/** Two consecutive compatible triggers at most this far apart share a row… */
export const GROUP_GAP_MS = 90_000;
/** …and a row never spans more than this from its first trigger. */
export const GROUP_SPAN_MS = 5 * 60_000;

/** What can share a row: every Bonk, the same sound, every TTS. Anything else stays alone. */
export function groupKey(a) {
  if (a.kind !== 'interaction') return null;
  if (a.type === 'bonk' || a.type === 'tts') return a.type;
  if (a.type === 'soundboard')
    return `sound:${a.data?.sound?.id ?? a.data?.sound?.label ?? ''}`;
  return null;
}

/**
 * The rows, newest first, computed again from the raw activities each time (presentation only: nothing is merged
 * anywhere else). Hidden categories and folded gift recipients go first, so a hidden event never splits a row.
 * Walked from the oldest: a trigger joins the row before it when it has the same group key and comes at most
 * GROUP_GAP_MS after that row's last trigger and GROUP_SPAN_MS after its first. A row is keyed by its first trigger,
 * so a growing row keeps its key, its place and its open detail. The result depends only on the activities' times,
 * types and keys — never on arrival order, reconnections or status changes. Row items: newest first.
 */
export function entries(activities, prefs = DEFAULT_PREFS) {
  const hidden = new Set(prefs.hidden);
  const rows = [];
  let cur = null;
  for (const a of [...activities].sort(byTime)) {
    if (folded(a) || hidden.has(catOf(a))) continue;
    const k = groupKey(a);
    const t = Date.parse(a.occurred_at);
    if (
      k &&
      cur?.gk === k &&
      t - cur.last <= GROUP_GAP_MS &&
      t - cur.first <= GROUP_SPAN_MS
    ) {
      cur.items.unshift(a);
      cur.last = t;
      continue;
    }
    cur = k
      ? { key: `g:${a.activity_key}`, gk: k, items: [a], first: t, last: t }
      : null;
    rows.push(cur ?? { key: a.activity_key, gk: null, items: [a] });
  }
  return rows.reverse().map(({ key, gk, items }) => ({ key, gk, items }));
}

/** « Alice », « Alice et Bob », « Alice, Bob +3 » (first triggers first) — never one name for several viewers. */
export function participants(items) {
  const seen = new Map();
  for (const a of [...items].reverse())
    if (!seen.has(whoId(a))) seen.set(whoId(a), who(a));
  const all = [...seen.values()];
  const text =
    all.length <= 1
      ? (all[0] ?? '')
      : all.length === 2
        ? `${all[0]} et ${all[1]}`
        : `${all[0]}, ${all[1]} +${all.length - 2}`;
  return { text, all };
}

/** A row's state: the worst of its triggers (failure, then pending, then done), with the counts in the tooltip. */
export function groupState(items) {
  if (items.length === 1) return stateOf(items[0]);
  const n = { ok: 0, wait: 0, bad: 0, muted: 0 };
  for (const a of items) n[stateOf(a).tone] += 1;
  const tone = n.bad ? 'bad' : n.wait ? 'wait' : n.ok ? 'ok' : 'muted';
  const label = joined(
    n.ok && `${n.ok} exécuté${n.ok > 1 ? 's' : ''}`,
    n.wait && `${n.wait} en attente`,
    n.bad && `${n.bad} en échec`,
    n.muted && `${n.muted} annulé${n.muted > 1 ? 's' : ''}`,
  );
  return { label, tone };
}

/** Does this row open a detail? Only with something useful in it: viewer text, recipients, members, a failure. */
export function hasDetail(row, recipients) {
  if (row.items.length > 1) return true;
  const a = row.items[0];
  const st = stateOf(a);
  return !!(
    textOf(a) ||
    recipients?.length ||
    (st.tone === 'bad' && st.reason)
  );
}

// --- HTML -----------------------------------------------------------------------------------------------------------

const statusHtml = (st) => {
  const label = st.reason ? `${st.label} : ${st.reason}` : st.label;
  return label
    ? `<span class="st t-${st.tone}" title="${esc(label)}" role="img" aria-label="${esc(label)}">${icon(TONE_ICON[st.tone])}</span>`
    : '';
};

function detailHtml(row, recipients) {
  if (row.items.length > 1)
    return `<ol class="members">${row.items
      .map((m) => {
        const t = textOf(m);
        const note = m.type === 'bonk' ? (m.data?.emote?.glyph ?? '') : '';
        return `<li><span class="m-when" title="${esc(exact(m.occurred_at))}">${esc(clock(m.occurred_at))}</span><span class="m-who">${esc(who(m))}</span>${note ? `<span class="m-note">${esc(note)}</span>` : emoteHtml(m)}${statusHtml(stateOf(m))}${t ? `<p class="m-text">${esc(t)}</p>` : ''}</li>`;
      })
      .join('')}</ol>`;
  const a = row.items[0];
  const st = stateOf(a);
  const text = textOf(a);
  return [
    text && `<p class="msg-full">${esc(text)}</p>`,
    recipients?.length &&
      `<p class="meta"><b>Reçus par</b> ${recipients.map((n) => esc(n)).join(', ')}</p>`,
    st.tone === 'bad' &&
      st.reason &&
      `<p class="meta t-bad"><b>${esc(st.label)}</b> ${esc(st.reason)}</p>`,
  ]
    .filter(Boolean)
    .join('');
}

/**
 * The HTML of one row (`row` from entries()). `ui`: { now, prefs, open (detail shown), fresh (just arrived), confirm
 * (replay asked once), busy, recipients (a community gift's recipients, folded into it) }.
 */
export function rowHtml(row, ui = {}) {
  const a = row.items[0];
  const many = row.items.length > 1;
  const t = titleOf(a, ui.prefs ?? DEFAULT_PREFS);
  const title = many ? `${t.title} × ${row.items.length}` : t.title;
  const people = participants(row.items);
  const text = many ? '' : textOf(a);
  const detail = hasDetail(row, ui.recipients);
  const open = detail && !!ui.open;
  const replay =
    !many && replayable(a)
      ? `<button type="button" class="act${ui.confirm ? ' confirm' : ''}" data-replay="${esc(a.activity_key)}"
        title="${ui.confirm ? 'Cliquer encore pour rejouer l’animation dans OBS' : `Rejouer l’animation dans OBS (aucun effet sur l’économie)${a.state?.replay ? ` · déjà rejouée ${esc(a.state.replay.count)} fois` : ''}`}"
        aria-label="Rejouer l’animation"${ui.busy ? ' disabled' : ''}>${ui.confirm ? 'Rejouer ?' : icon('undo')}</button>`
      : '';
  return `<li class="row c-${catOf(a)}${ui.fresh ? ' fresh' : ''}${open ? ' open' : ''}${detail ? ' expandable' : ''}" data-key="${esc(row.key)}"${detail ? ` tabindex="0" aria-expanded="${open}"` : ''}>
    <span class="ic">${icon(iconOf(a))}</span>
    <div class="main">
      <div class="l1"><span class="title${t.caps ? ' caps' : ''}">${esc(title)}</span>${!many && t.note ? `<span class="note">${esc(t.note)}</span>` : ''}${many ? '' : emoteHtml(a)}${statusHtml(groupState(row.items))}</div>
      <div class="l2"><span class="who" title="${esc(people.all.join(', '))}">${esc(people.text)}</span><span class="tail"><span class="when" title="${esc(exact(a.occurred_at))}">${esc(ago(ui.now ?? Date.now(), a.occurred_at))}</span>${detail ? `<span class="more">${icon('chevron')}</span>` : ''}</span></div>
      ${text && !open ? `<p class="l3">${esc(text)}</p>` : ''}
      ${open ? `<div class="detail">${detailHtml(row, ui.recipients)}</div>` : ''}
    </div>
    ${replay}
  </li>`;
}

/** Parses server-sent events from text chunks: returns the complete events and the rest to keep. */
export function parseSse(buffer) {
  const events = [];
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? '';
  for (const p of parts) {
    let type = 'message';
    const data = [];
    for (const line of p.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length) events.push({ type, data: data.join('\n') });
  }
  return { events, rest };
}
