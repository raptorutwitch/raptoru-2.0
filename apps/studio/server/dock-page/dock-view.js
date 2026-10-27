// Dock OBS V1 (docs/OBS_DOCK.md) — the pure part of the dock page: what an activity says (who, what, its state, can
// it be replayed) and its HTML. Every viewer-provided text (pseudo, message, reward title) goes through esc(): the
// dock never inserts viewer HTML; the CSP forbids inline scripts anyway. Tested in apps/studio/server/test/.

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

/** The filter groups (chips), in display order. */
export const GROUPS = [
  { id: 'follow', label: 'Follows', icon: '♥' },
  { id: 'sub', label: 'Abos', icon: '★' },
  { id: 'gift', label: 'Cadeaux', icon: '🎁' },
  { id: 'bits', label: 'Bits', icon: '◆' },
  { id: 'raid', label: 'Raids', icon: '➜' },
  { id: 'donation', label: 'Dons', icon: '€' },
  { id: 'reward', label: 'Points', icon: '●' },
];

const GROUP_OF = {
  follow: 'follow',
  sub: 'sub',
  resub: 'sub',
  gift_targeted: 'gift',
  gift_community: 'gift',
  gift_recipient: 'gift',
  bits: 'bits',
  raid: 'raid',
  donation: 'donation',
  reward: 'reward',
};
export const groupOf = (a) => GROUP_OF[a.type] ?? 'other';

const TIER = { 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3', prime: 'Prime' };
const ALERT_STATUS = {
  queued: 'en attente',
  claimed: 'en cours',
  playing: 'en cours',
  completed: 'jouée',
  failed: 'échec',
  expired: 'non jouée',
};
const POINTS_STATUS = {
  pending: 'en cours',
  done: 'faite',
  partial: 'partielle',
  failed: 'échec',
  ignored: 'ignorée',
};
const PENDING = new Set(['queued', 'claimed', 'playing']);

const nf = (n) => Number(n).toLocaleString('fr-FR').replace(/\s/g, ' ');
/** « 1 bit », « 1 234 bits » (the count stays a number for the plural). */
const plural = (n, one, many) => `${nf(n)} ${Number(n) > 1 ? many : one}`;

/** A person's display name (Twitch: display_name / name, else login), or « Anonyme ». */
export function who(a) {
  const p = a.data?.actor;
  if (a.data?.anonymous || !p) return 'Anonyme';
  return String(p.display_name || p.name || p.login || 'Anonyme');
}

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

/** What happened, in a few words (no viewer text). */
export function what(a) {
  const d = a.data ?? {};
  const tier = TIER[d.tier] ? ` · ${TIER[d.tier]}` : '';
  switch (a.type) {
    case 'follow':
      return 'suit la chaîne';
    case 'sub':
      return `s’abonne${tier}`;
    case 'resub':
      return `se réabonne${tier}${d.months ? ` · ${plural(d.months, 'mois', 'mois')}` : ''}`;
    case 'gift_targeted':
      return `offre un abo${d.recipient ? ` à ${d.recipient.display_name || d.recipient.login}` : ''}${tier}`;
    case 'gift_community':
      return `offre ${plural(d.count ?? 1, 'abo', 'abos')}${tier}`;
    case 'gift_recipient':
      return `reçoit un abo offert${tier}`;
    case 'bits':
      return plural(d.bits ?? 0, 'bit', 'bits');
    case 'raid':
      return `raid · ${plural(d.viewers ?? 0, 'viewer', 'viewers')}`;
    case 'donation':
      return `don · ${money(d.amount)}`;
    case 'reward':
      return `${d.reward?.title ?? 'Récompense'} · ${nf(d.reward?.cost ?? 0)} pts`;
    default:
      return a.type;
  }
}

/**
 * The state shown on the row: for an alert, its animation (or why there is none); for a redemption, Raptoru's
 * processing and a cancellation on Twitch. `tone`: ok / wait / bad / muted.
 */
export function stateOf(a) {
  const s = a.state ?? {};
  if (a.kind === 'channel_points') {
    if (s.twitch_status === 'CANCELED')
      return { label: 'annulée sur Twitch', tone: 'muted' };
    const label = POINTS_STATUS[s.status] ?? s.status ?? '';
    const tone =
      s.status === 'done'
        ? 'ok'
        : s.status === 'failed'
          ? 'bad'
          : s.status === 'pending'
            ? 'wait'
            : 'muted';
    return { label, tone };
  }
  if (s.outcome === 'below_threshold')
    return { label: 'sous le seuil', tone: 'muted' };
  if (s.outcome === 'absorbed') return { label: 'dans un lot', tone: 'muted' };
  const r = s.replay;
  if (r && PENDING.has(r.status))
    return { label: 'rejeu en attente', tone: 'wait' };
  const label = ALERT_STATUS[s.alert_status] ?? '';
  const tone =
    s.alert_status === 'completed'
      ? 'ok'
      : s.alert_status === 'failed'
        ? 'bad'
        : PENDING.has(s.alert_status)
          ? 'wait'
          : 'muted';
  return { label, tone };
}

/** Can this activity's animation be replayed now? (the Core decides again; this only shows the button). */
export function replayable(a) {
  const s = a.state ?? {};
  return (
    a.kind === 'alert' &&
    !!s.alert_id &&
    ['completed', 'failed', 'expired'].includes(s.alert_status) &&
    !(s.replay && PENDING.has(s.replay.status))
  );
}

/** « à l’instant », « 3 min », « 2 h », then the date. */
export function ago(nowMs, iso) {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 45) return 'à l’instant';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 24 * 3600) return `${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  });
}

/**
 * The row of one activity. `ui`: { now, open (detail shown), fresh (just arrived), confirm (replay asked once), busy,
 * recipients (a community gift's recipients, folded into it) }.
 */
export function rowHtml(a, ui = {}) {
  const g = groupOf(a);
  const icon = GROUPS.find((x) => x.id === g)?.icon ?? '•';
  const st = stateOf(a);
  const msg = typeof a.data?.message === 'string' ? a.data.message : '';
  const replay = replayable(a)
    ? `<button type="button" class="act${ui.confirm ? ' confirm' : ''}" data-replay="${esc(a.activity_key)}"
        title="${ui.confirm ? 'Cliquer encore pour rejouer l’animation dans OBS' : 'Rejouer l’animation dans OBS (aucun effet sur l’économie)'}"
        aria-label="Rejouer l’animation"${ui.busy ? ' disabled' : ''}>${ui.confirm ? 'Rejouer ?' : '⟲'}</button>`
    : '';
  const time = new Date(a.occurred_at).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const detail = ui.open
    ? `<div class="detail">
        ${msg ? `<p class="msg-full">${esc(msg)}</p>` : ''}
        <dl>
          <dt>Heure</dt><dd>${esc(time)}</dd>
          ${a.data?.actor?.login ? `<dt>Compte</dt><dd>${esc(a.data.actor.login)}</dd>` : ''}
          ${st.label ? `<dt>${a.kind === 'alert' ? 'Alerte' : 'Traitement'}</dt><dd>${esc(st.label)}</dd>` : ''}
          ${ui.recipients?.length ? `<dt>Reçus par</dt><dd>${ui.recipients.map((n) => esc(n)).join(', ')}</dd>` : ''}
          ${a.state?.replay ? `<dt>Rejeux</dt><dd>${esc(a.state.replay.count)} · dernier : ${esc(ALERT_STATUS[a.state.replay.status] ?? a.state.replay.status)}</dd>` : ''}
          ${a.kind === 'channel_points' && a.state?.reason ? `<dt>Raison</dt><dd>${esc(a.state.reason)}</dd>` : ''}
          ${a.data?.source === 'simulation' ? '<dt>Source</dt><dd>simulation</dd>' : ''}
        </dl>
      </div>`
    : '';
  return `<li class="row g-${g}${ui.fresh ? ' fresh' : ''}${ui.open ? ' open' : ''}" data-key="${esc(a.activity_key)}" tabindex="0">
    <span class="ic" aria-hidden="true">${icon}</span>
    <div class="main">
      <div class="l1"><span class="who">${esc(who(a))}</span><span class="when" title="${esc(time)}">${esc(ago(ui.now ?? Date.now(), a.occurred_at))}</span></div>
      <div class="l2"><span class="what">${esc(what(a))}</span>${st.label ? `<span class="st t-${st.tone}">${esc(st.label)}</span>` : ''}</div>
      ${msg && !ui.open ? `<div class="l3">${esc(msg)}</div>` : ''}
      ${detail}
    </div>
    ${replay}
  </li>`;
}

/** Newest first; at the same time, the later projection first. */
export const byRecency = (x, y) =>
  y.occurred_at > x.occurred_at
    ? 1
    : y.occurred_at < x.occurred_at
      ? -1
      : y.seq - x.seq;

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
