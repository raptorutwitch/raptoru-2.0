// Dock OBS V1.2 (docs/OBS_DOCK.md) — the pure part of the dock page: event families (identity, filters), what an
// activity says (label, viewer, avatar, state, can it be replayed), the presentation grouping (Bonk only), the
// preferences, the display trash and the HTML. Every viewer-provided text (pseudo, message, reward or sound name) goes
// through esc(): the dock never inserts viewer HTML; the CSP forbids inline scripts anyway. Tested in
// apps/studio/server/test/dock-view.test.js.

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

// --- icons (Lucide shapes, ISC licence; drawn in currentColor) ------------------------------------------------------

const PATHS = {
  heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  award:
    '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6M2 9h20"/>',
  rocket:
    '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  coins:
    '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>',
  sparkle:
    '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  speech:
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  speaker:
    '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.41 7.59A1.4 1.4 0 0 1 5.42 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.42a1.4 1.4 0 0 1 .99.41l3.39 3.39a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6M19.36 18.36a9 9 0 0 0 0-12.73"/>',
  hammer:
    '<path d="m15 12-8.5 8.5a2.12 2.12 0 0 1-3-3L12 9"/><path d="M17.64 15 22 10.64"/><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/>',
  gavel:
    '<path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>',
  ticket:
    '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  minus: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  undo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  spinner: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  trash:
    '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
  select:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  restore:
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  arrowUp: '<path d="m5 12 7-7 7 7M12 19V5"/>',
};
const FILLED = new Set(['heart', 'star']);

/** An inline SVG icon (decorative: the text next to it says the same). Hearts and stars are filled. */
export const icon = (name, cls = 'i') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="${FILLED.has(name) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? PATHS.dot}</svg>`;

// --- families (identity) and the filters (one per kind of event) ----------------------------------------------------

/**
 * The visual families: each its colour (in dock.css, `f-<id>`), its icon and its label. Colour is never the only cue:
 * the icon and the label say it too.
 */
export const FAMILIES = {
  follow: { icon: 'heart', label: 'Follow' },
  sub: { icon: 'star', label: 'Sub' },
  resub: { icon: 'award', label: 'Resub' },
  gift: { icon: 'gift', label: 'Subgift' },
  bits: { icon: 'gem', label: 'Bits' },
  raid: { icon: 'rocket', label: 'Raid' },
  donation: { icon: 'coins', label: 'Don' },
  reward: { icon: 'sparkle', label: 'Récompense' },
  tts: { icon: 'speech', label: 'TTS' },
  soundboard: { icon: 'speaker', label: 'Soundboard' },
  bonk: { icon: 'hammer', label: 'Bonk' },
  random_ban: { icon: 'gavel', label: 'Random Ban' },
  raffle: { icon: 'ticket', label: 'Tombola' },
  other: { icon: 'dot', label: 'Événement' },
};

const FAMILY_OF = {
  follow: 'follow',
  sub: 'sub',
  resub: 'resub',
  gift_targeted: 'gift',
  gift_community: 'gift',
  gift_recipient: 'gift',
  bits: 'bits',
  raid: 'raid',
  donation: 'donation',
  reward: 'reward',
  tts: 'tts',
  soundboard: 'soundboard',
  bonk: 'bonk',
  random_ban: 'random_ban',
  raffle: 'raffle',
};
/** The family of an activity — also its filter. */
export const familyOf = (a) => FAMILY_OF[a.type] ?? 'other';

/** The preference groups, in display order; each filter is a family. */
export const FILTER_GROUPS = [
  {
    id: 'channel',
    label: 'Chaîne Twitch',
    filters: ['follow', 'sub', 'resub', 'gift', 'bits', 'raid', 'donation'],
  },
  { id: 'points', label: 'Points de chaîne', filters: ['reward'] },
  {
    id: 'raptoru',
    label: 'Interactions Raptoru',
    filters: ['tts', 'soundboard', 'bonk', 'random_ban', 'raffle'],
  },
];
export const FILTERS = FILTER_GROUPS.flatMap((g) => g.filters);
const FILTER_LABEL = {
  follow: 'Follows',
  sub: 'Subs',
  resub: 'Resubs',
  gift: 'Subgifts',
  bits: 'Bits',
  raid: 'Raids',
  donation: 'Dons',
  reward: 'Toutes les récompenses',
  tts: 'TTS',
  soundboard: 'Soundboard',
  bonk: 'Bonk',
  random_ban: 'Random Ban',
  raffle: 'Tombola',
};
export const filterLabel = (id) => FILTER_LABEL[id] ?? id;

// --- preferences ----------------------------------------------------------------------------------------------------

const MAX_REWARDS = 200;

/**
 * Default preferences: everything shown, reward costs hidden. `hidden`: filters (families) hidden; `rewards.hidden`:
 * channel points rewards hidden one by one, by their stable Twitch id; `rewards.names`: the last title seen of each
 * reward (for the panel, so a renamed reward keeps its choice).
 */
export const DEFAULT_PREFS = Object.freeze({
  v: 2,
  hidden: [],
  costs: false,
  rewards: { hidden: [], names: {} },
});

/** V1.1 filters → V1.2 filters (« Abos et cadeaux » and « Tombola et Random Ban » are split). */
const V11 = {
  follow: ['follow'],
  sub: ['sub', 'resub', 'gift'],
  bits: ['bits'],
  raid: ['raid'],
  donation: ['donation'],
  reward: ['reward'],
  tts: ['tts'],
  soundboard: ['soundboard'],
  bonk: ['bonk'],
  internal: ['random_ban', 'raffle'],
};

/** Reads stored preferences defensively: V1.1 ones are carried over, unknown filters dropped, wrong types ignored. */
export function readPrefs(raw) {
  const ids = new Set(FILTERS);
  const list = Array.isArray(raw?.hidden) ? raw.hidden : [];
  const hidden =
    raw?.v === 2
      ? list.filter((h) => ids.has(h))
      : list.flatMap((h) => V11[h] ?? []);
  const r =
    raw?.v === 2 && raw.rewards && typeof raw.rewards === 'object'
      ? raw.rewards
      : {};
  const names = {};
  if (r.names && typeof r.names === 'object')
    for (const [id, title] of Object.entries(r.names).slice(-MAX_REWARDS))
      if (typeof title === 'string') names[id] = title.slice(0, 120);
  return {
    v: 2,
    hidden: [...new Set(hidden)],
    costs: raw?.costs === true,
    rewards: {
      hidden: Array.isArray(r.hidden)
        ? [...new Set(r.hidden.filter((x) => typeof x === 'string'))].slice(
            0,
            MAX_REWARDS,
          )
        : [],
      names,
    },
  };
}

/** Learns the rewards seen (id → last title). Returns the preferences unchanged when nothing is new. */
export function learnRewards(prefs, activities) {
  let names = null;
  for (const a of activities) {
    const r = a.type === 'reward' ? a.data?.reward : null;
    if (!r?.id || !r.title) continue;
    if ((names ?? prefs.rewards.names)[r.id] === r.title) continue;
    names ??= { ...prefs.rewards.names };
    delete names[r.id]; // re-inserted last: the most recently seen are kept
    names[r.id] = String(r.title).slice(0, 120);
  }
  if (!names) return prefs;
  const kept = Object.entries(names).slice(-MAX_REWARDS);
  return {
    ...prefs,
    rewards: { ...prefs.rewards, names: Object.fromEntries(kept) },
  };
}

/** Is this activity shown with these preferences (its filter, and for a reward its own choice)? */
export function shownBy(prefs, a) {
  if (prefs.hidden.includes(familyOf(a))) return false;
  const id = a.type === 'reward' ? a.data?.reward?.id : null;
  return !(id && prefs.rewards.hidden.includes(id));
}

// --- the display trash ----------------------------------------------------------------------------------------------

/** How long, and how many, keys the trash keeps (the dock's history is 30 days). */
export const TRASH_DAYS = 31;
export const TRASH_MAX = 5000;

/**
 * The display trash: activity keys hidden from this dock only — never an event deleted, never a business effect.
 * `items`: restorable ({ k, at }, newest first); `purged`: hidden for good (the trash emptied). Both bounded by age and
 * count; stored by the page (localStorage), separate from the preferences and from the canonical history.
 */
export function readTrash(raw, nowMs = Date.now()) {
  const keep = (list) => {
    const seen = new Set();
    const out = [];
    for (const x of Array.isArray(list) ? list : []) {
      if (!x || typeof x.k !== 'string' || typeof x.at !== 'number') continue;
      if (nowMs - x.at > TRASH_DAYS * 86400_000 || seen.has(x.k)) continue;
      seen.add(x.k);
      out.push({ k: x.k, at: x.at });
    }
    return out.sort((p, q) => q.at - p.at).slice(0, TRASH_MAX);
  };
  return { items: keep(raw?.items), purged: keep(raw?.purged) };
}

/** Moves these activity keys into the trash (already there: kept once, newest date). */
export function trashAdd(trash, keys, nowMs = Date.now()) {
  const add = new Set(keys);
  return readTrash(
    {
      items: [
        ...[...add].map((k) => ({ k, at: nowMs })),
        ...trash.items.filter((x) => !add.has(x.k)),
      ],
      purged: trash.purged.filter((x) => !add.has(x.k)),
    },
    nowMs,
  );
}

/** Restores these keys (or all when `keys` is null). */
export function trashRestore(trash, keys = null) {
  const out = keys ? new Set(keys) : null;
  return {
    items: trash.items.filter((x) => out && !out.has(x.k)),
    purged: trash.purged,
  };
}

/** Empties the trash: its items stay hidden, no longer restorable. */
export function trashEmpty(trash, nowMs = Date.now()) {
  return readTrash(
    { items: [], purged: [...trash.items, ...trash.purged] },
    nowMs,
  );
}

/** The set of keys the dock does not show (trash and purged). */
export const trashedKeys = (trash) =>
  new Set([...trash.items, ...trash.purged].map((x) => x.k));

// --- what an activity says ------------------------------------------------------------------------------------------

const TIER = { 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3', prime: 'Prime' };

const nf = (n) => Number(n).toLocaleString('fr-FR').replace(/\s/g, ' ');
const plural = (n, one, many) => `${nf(n)} ${Number(n) > 1 ? many : one}`;
const joined = (...parts) => parts.filter(Boolean).join(' · ');

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

/**
 * The label (shown in capitals next to the family icon) and the secondary note (tier, months, sound, emote, cost…).
 * `named`: the label is a name chosen by the streamer (a reward), kept in its own case.
 */
export function labelOf(a, prefs = DEFAULT_PREFS) {
  const d = a.data ?? {};
  const tier = TIER[d.tier] ?? '';
  switch (a.type) {
    case 'follow':
      return { label: 'Follow' };
    case 'sub':
      return { label: 'Sub', note: tier };
    case 'resub':
      return {
        label: 'Resub',
        note: joined(d.months ? `${nf(d.months)} mois` : '', tier),
      };
    case 'gift_targeted':
      return {
        label: 'Subgift',
        note: joined(
          d.recipient
            ? `à ${d.recipient.display_name || d.recipient.login}`
            : '',
          tier,
        ),
      };
    case 'gift_community':
      return {
        label: (d.count ?? 1) > 1 ? `Subgift × ${nf(d.count)}` : 'Subgift',
        note: tier,
      };
    case 'gift_recipient':
      return { label: 'Sub offert', note: tier };
    case 'bits':
      return { label: plural(d.bits ?? 0, 'bit', 'bits') };
    case 'raid':
      return {
        label: 'Raid',
        note: plural(d.viewers ?? 0, 'viewer', 'viewers'),
      };
    case 'donation':
      return { label: `Don ${money(d.amount)}`.trim() };
    case 'reward':
      return {
        label: d.reward?.title || 'Récompense',
        named: true,
        note:
          prefs.costs && d.reward?.cost ? `${nf(d.reward.cost)} points` : '',
      };
    case 'bonk':
      return { label: 'Bonk' };
    case 'soundboard':
      return { label: 'Soundboard', note: d.sound?.label || d.sound?.id || '' };
    case 'tts':
      return { label: 'TTS' };
    case 'raffle':
      return { label: 'Tombola', note: 'participation' };
    case 'random_ban':
      return {
        label: 'Random Ban',
        note: d.target ? `cible : ${d.target}` : '',
      };
    default:
      return { label: FAMILIES.other.label };
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

// --- pictures -------------------------------------------------------------------------------------------------------

const PICTURE_HOSTS = new Set([
  'static-cdn.jtvnw.net',
  'cdn.7tv.app',
  'cdn.betterttv.net',
  'cdn.frankerfacez.com',
]);
/** An https URL on the Twitch / emote CDNs (the dock's CSP list), else ''. */
function pictureUrl(url, hosts = PICTURE_HOSTS) {
  if (typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hosts.has(u.hostname) ? u.href : '';
  } catch {
    return '';
  }
}
const TWITCH_ONLY = new Set(['static-cdn.jtvnw.net']);

/** A viewer's Twitch picture URL (from the Core's cache), or '' (the initial is shown instead). */
export const avatarOf = (a) =>
  a.data?.anonymous ? '' : pictureUrl(a.data?.actor?.avatar, TWITCH_ONLY);

/** A Bonk's emote picture (Twitch, 7TV, BTTV, FFZ CDNs only — the same list as the dock's CSP), when it has no glyph. */
export function emoteHtml(a) {
  const e = a.type === 'bonk' ? a.data?.emote : null;
  if (!e || e.glyph) return '';
  const src = pictureUrl(e.url);
  return src
    ? `<img class="emote" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : '';
}

/**
 * The avatar box: always the same size (no layout shift). The initial (or the family icon for an anonymous / unknown
 * viewer) sits under the picture, which covers it once loaded; a picture that fails is removed by the page.
 */
function avatarHtml(row) {
  const a = row.items[0];
  const people = participants(row.items);
  const single = people.all.length <= 1;
  const src = single ? avatarOf(a) : '';
  const name = single ? who(a) : '';
  const initial =
    single && name !== 'Anonyme' ? [...name.trim()][0]?.toUpperCase() : '';
  return `<span class="av" aria-hidden="true">${
    initial
      ? `<span class="av-ini">${esc(initial)}</span>`
      : icon(FAMILIES[familyOf(a)].icon, 'i av-ic')
  }${src ? `<img class="av-img" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}${
    single ? '' : `<span class="av-n">${people.all.length}</span>`
  }</span>`;
}

// --- time -----------------------------------------------------------------------------------------------------------

/** « à l’instant » (< 1 min), then « 3 min », « 2 h », « 3 j ». The exact date and time are in the tooltip. */
export function ago(nowMs, iso) {
  const s = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} j`;
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
 * A community gift's recipients are folded into the gift (one business event with several recipients, not a
 * grouping): an absorbed recipient linked by `community_gift_id` is not its own row.
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

/** Two consecutive Bonks at most this far apart share a row… */
export const GROUP_GAP_MS = 90_000;
/** …and a row never spans more than this from its first Bonk. */
export const GROUP_SPAN_MS = 5 * 60_000;

/** V1.2: only Bonks share a row; every other event stays its own row, whoever triggered it. */
export const groupKey = (a) =>
  a.kind === 'interaction' && a.type === 'bonk' ? 'bonk' : null;

/**
 * The rows, newest first, computed again from the raw activities each time (presentation only: nothing is merged
 * anywhere else). `skip(a)`: activities not shown (filters, trash) — removed first, so a hidden event never splits a
 * row. Walked from the oldest: a Bonk joins the row before it when that row is a Bonk row, at most GROUP_GAP_MS after
 * its last Bonk and GROUP_SPAN_MS after its first. A row is keyed by its first Bonk, so a growing row keeps its key, its
 * place and its open detail. The result depends only on the activities' times, types and keys — never on arrival
 * order, reconnections or status changes. Row items: newest first.
 */
export function entries(activities, skip = () => false) {
  const rows = [];
  let cur = null;
  for (const a of [...activities].sort(byTime)) {
    if (folded(a) || skip(a)) continue;
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

/**
 * Does this row open a detail? Only with something the row does not already show: a group's Bonks, a community gift's
 * recipients, a failure's reason. A viewer text is shown on the row (one line); the page makes the row openable only
 * when that line is cut (`text`).
 */
export function detailKind(row, recipients) {
  if (row.items.length > 1) return 'members';
  const a = row.items[0];
  const st = stateOf(a);
  if (recipients?.length || (st.tone === 'bad' && st.reason)) return 'more';
  return textOf(a) ? 'text' : null;
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
        const note = m.data?.emote?.glyph ?? '';
        return `<li><span class="m-when" title="${esc(exact(m.occurred_at))}">${esc(clock(m.occurred_at))}</span><span class="m-who" title="${esc(who(m))}">${esc(who(m))}</span>${note ? `<span class="m-note">${esc(note)}</span>` : emoteHtml(m)}${statusHtml(stateOf(m))}</li>`;
      })
      .join('')}</ol>`;
  const a = row.items[0];
  const st = stateOf(a);
  return [
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
 * The HTML of one row (`row` from entries()). `ui`: { now, prefs, open (detail / whole text shown), fresh (just
 * arrived), selected, busy (replay request in flight), sent (replay just accepted), recipients (a community gift's) }.
 * Layout: [avatar] [icon + LABEL] [viewer] … [state] [replay] / [time · note] / [viewer text, one line].
 */
export function rowHtml(row, ui = {}) {
  const a = row.items[0];
  const many = row.items.length > 1;
  const fam = familyOf(a);
  const l = labelOf(a, ui.prefs ?? DEFAULT_PREFS);
  const label = many ? `${l.label} × ${row.items.length}` : l.label;
  const people = participants(row.items);
  const text = many ? '' : textOf(a);
  const detail = detailKind(row, ui.recipients);
  const open = !!detail && !!ui.open;
  const note = many
    ? people.all.length > 1
      ? `${people.all.length} viewers`
      : ''
    : l.note;
  const replay =
    !many && replayable(a)
      ? `<button type="button" class="act${ui.busy ? ' busy' : ''}${ui.sent ? ' sent' : ''}" data-replay="${esc(a.activity_key)}"
        title="${ui.busy ? 'Rejeu en cours de demande…' : `Rejouer l’animation dans OBS (aucun effet sur l’économie)${a.state?.replay ? ` · déjà rejouée ${esc(a.state.replay.count)} fois` : ''}`}"
        aria-label="Rejouer l’animation"${ui.busy ? ' disabled' : ''}>${icon(ui.busy ? 'spinner' : ui.sent ? 'check' : 'undo')}</button>`
      : '';
  const cls = [
    'row',
    `f-${fam}`,
    ui.fresh && 'fresh',
    open && 'open',
    detail && detail !== 'text' && 'expandable',
    detail === 'text' && 'has-text',
    ui.selected && 'selected',
  ]
    .filter(Boolean)
    .join(' ');
  return `<li class="${cls}" data-key="${esc(row.key)}" tabindex="0"${detail && detail !== 'text' ? ` aria-expanded="${open}"` : ''}${ui.selected ? ' aria-selected="true"' : ''}>
    ${avatarHtml(row)}
    <div class="main">
      <div class="l1"><span class="lab${l.named ? ' named' : ''}" title="${esc(label)}">${icon(FAMILIES[fam].icon)}<span class="lab-t">${esc(label)}</span></span><span class="who" title="${esc(people.all.join(', '))}">${esc(people.text)}</span>${statusHtml(groupState(row.items))}${replay}</div>
      <div class="l2"><span class="when" title="${esc(exact(a.occurred_at))}">${esc(ago(ui.now ?? Date.now(), a.occurred_at))}</span>${note ? `<span class="note" title="${esc(note)}">${esc(note)}</span>` : ''}${many ? '' : emoteHtml(a)}${detail && detail !== 'text' ? `<span class="more">${icon('chevron')}</span>` : ''}</div>
      ${text ? `<p class="l3${open ? ' whole' : ''}">${esc(text)}</p>` : ''}
      ${open && detail !== 'text' ? `<div class="detail">${detailHtml(row, ui.recipients)}</div>` : ''}
    </div>
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

/**
 * Selection: the row keys between `anchor` and `key` (inclusive) in the displayed order — Shift + clic. Without an
 * anchor still displayed, only `key`.
 */
export function rangeKeys(order, anchor, key) {
  const i = order.indexOf(anchor);
  const j = order.indexOf(key);
  if (j < 0) return [];
  if (i < 0) return [key];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

// --- panels ---------------------------------------------------------------------------------------------------------

const box = (attrs, checked, label, extra = '', cls = 'chk') =>
  `<label class="${cls}"${extra}><input type="checkbox" ${attrs}${checked ? ' checked' : ''}><span>${label}</span></label>`;

/**
 * The preferences panel: one group per kind of source (a tri-state box shows / hides the whole group), one box per
 * filter with its family icon, the channel points rewards seen one by one (by stable id), the costs option.
 */
export function prefsHtml(prefs, { rewardsOpen = false } = {}) {
  const hidden = new Set(prefs.hidden);
  const rh = new Set(prefs.rewards.hidden);
  const rewards = Object.entries(prefs.rewards.names).sort((x, y) =>
    x[1].localeCompare(y[1], 'fr'),
  );
  return FILTER_GROUPS.map((g) => {
    const on = g.filters.filter((f) => !hidden.has(f)).length;
    const state =
      on === 0 ? '' : on === g.filters.length ? ' checked' : ' data-mixed="1"';
    const items = g.filters
      .map((f) =>
        box(
          `data-filter="${f}"`,
          !hidden.has(f),
          `${icon(FAMILIES[f].icon)}${esc(filterLabel(f))}`,
          '',
          `chk f-${f}`,
        ),
      )
      .join('');
    const list =
      g.id === 'points'
        ? `<details class="rewards"${rewards.length ? '' : ' hidden'}${rewardsOpen ? ' open' : ''}><summary>Récompenses une par une (${rewards.length})</summary>${rewards
            .map(([id, title]) =>
              box(
                `data-reward="${esc(id)}"${hidden.has('reward') ? ' disabled' : ''}`,
                !rh.has(id),
                esc(title),
                ` title="${esc(title)}"`,
              ),
            )
            .join(
              '',
            )}</details>${box('id="costs"', prefs.costs, 'Afficher les coûts des récompenses')}`
        : '';
    return `<fieldset class="pg"><legend><label class="chk grp"><input type="checkbox" data-group="${g.id}"${state}><span>${esc(g.label)}</span></label></legend><div class="pg-items">${items}</div>${list}</fieldset>`;
  }).join('');
}

/**
 * The trash panel's list: the hidden activities still loaded, as rows (a Bonk salve stays together, its Bonks listed
 * under it), each with its box; `checked`: the activity keys ticked.
 */
export function trashListHtml(
  rows,
  checked,
  now = Date.now(),
  prefs = DEFAULT_PREFS,
) {
  return rows
    .map((row) => {
      const a = row.items[0];
      const fam = familyOf(a);
      const l = labelOf(a, prefs);
      const keys = row.items.map((x) => x.activity_key);
      const all = keys.every((k) => checked.has(k));
      const some = !all && keys.some((k) => checked.has(k));
      const label =
        row.items.length > 1 ? `${l.label} × ${row.items.length}` : l.label;
      const members =
        row.items.length > 1
          ? `<ol class="t-members">${row.items
              .map(
                (m) =>
                  `<li>${box(`data-tkey="${esc(m.activity_key)}"`, checked.has(m.activity_key), `<span class="m-when">${esc(clock(m.occurred_at))}</span> ${esc(who(m))}`)}</li>`,
              )
              .join('')}</ol>`
          : '';
      return `<li class="t-row f-${fam}" data-trow="${esc(row.key)}"><label class="chk"><input type="checkbox" data-tkeys="${esc(keys.join(' '))}"${all ? ' checked' : ''}${some ? ' data-mixed="1"' : ''}><span class="lab">${icon(FAMILIES[fam].icon)}<span class="lab-t">${esc(label)}</span></span><span class="who">${esc(participants(row.items).text)}</span><span class="when" title="${esc(exact(a.occurred_at))}">${esc(ago(now, a.occurred_at))}</span></label>${members}</li>`;
    })
    .join('');
}
