// Tombola V2 — viewer screen, ported from the validated prototype
// `prototypes/tombola-v2/extension.html` (ring hero, centred template for « aucune Tombola » /
// FULL OSEILLE / annulée) without redesign: same composition, same texts, same states.
//
// Only the data source changes: Core's viewer state through the EBS (GET /raffle/state) — phase,
// timer (Core's remaining time), entries and their source, why a join would be refused, the result
// once Core allows viewers to see it (overlay reveal + stream margin), the history of the stream.
// Nothing is decided or computed here beyond display (seconds left, counts already given by Core).
//
// Anti-flicker (validated): the structure is rebuilt only when the screen changes (aucune → ouverte →
// tirage → résultat…); between two reads only the small values move (seconds, ring, counters, rows,
// join zone), so the scroll, a click in progress and the animations are never reset by polling.
import { errorLabel } from './api.js';

const POLL_ACTIVE_MS = 1000;
const POLL_IDLE_MS = 3000;
const R = 58;
const CIRC = 2 * Math.PI * R;
const LEAVE_MS = 270;

const P = {
  ticket: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2.5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  ext: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18"/><circle cx="6.5" cy="6.5" r=".6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4M12 7.5v1.5M12 15.5V17"/>',
  gift: '<rect x="3" y="8" width="18" height="13" rx="1.5"/><path d="M3 12h18M12 8v13M12 8c-2-4-6-4-6-1.5S10 8 12 8c2 0 6 1 6-1.5S14 4 12 8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};
const ic = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n).toLocaleString('fr-FR').replace(/ /g, ' ');
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
/** Same stable hue as the prototype avatars. */
const hueOf = (n) => [...String(n)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 9);
const initials = (n) => esc(String(n).replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase());
/** Twitch pictures only from Twitch's CDN (Core's cache), the initials stay underneath. */
const img = (url) => (typeof url === 'string' && url.startsWith('https://static-cdn.jtvnw.net/') ? `<img src="${esc(url)}" alt="" loading="lazy" data-pp>` : '');
const avatar = (name, url) => `<span class="av" style="--c:hsl(${hueOf(name)} 65% 62%)">${initials(name)}${img(url)}</span>`;
const pp = (name, source, url) => `<span class="pp ${source === 'extension' ? 'ext' : ''}" style="--h:${hueOf(name)}"><i>${initials(name)}</i>${img(url)}</span>`;
const srcPill = (s) => (s === 'extension'
  ? `<span class="t-pill t-pill--ext">${ic('ext')}Extension</span>`
  : s === 'manual'
    ? `<span class="t-pill">${ic('plus')}Ajouté</span>`
    : `<span class="t-pill t-pill--chat">${ic('chat')}Chat</span>`);
/** Header balance, as the prototype shows it (« 12,4K »). */
const compact = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) < 1000) return fmt(v);
  return `${(Math.floor(v / 100) / 10).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}K`;
};

/** Why a join is refused (Core's code) — the viewer's wording. */
const REFUSAL = {
  identity_required: 'Partage ton identité Twitch pour participer depuis l’Extension',
  extension_join_disabled: 'Inscription depuis le chat uniquement',
  global_pause: 'Raptoru est en pause · inscriptions suspendues',
  module_disabled: 'Inscriptions désactivées',
  raffle_paused: 'Inscriptions en pause par la modération',
  round_paused: 'En pause · reprise bientôt',
  viewer_blocked: 'Inscription indisponible pour ton compte',
  entry_removed: 'Retiré par la modération',
  raffle_closed: 'Inscriptions fermées',
};
/** Refusals after which the chat command still works (the others refuse the chat too). */
const CHAT_STILL_WORKS = new Set(['identity_required', 'extension_join_disabled']);

export function createTombolaV2View({ document, client, onBack, onJoined }) {
  const win = document.defaultView;
  const node = document.createElement('div');
  node.className = 'tmbx';
  node.innerHTML = `<div class="head"><button class="ib" type="button" data-act="back" title="Retour au Hub" aria-label="Retour au Hub">${ic('chevL')}</button><span class="ttl">${ic('ticket')}<span data-slot="hname"></span></span><span class="grow"></span>
      <button class="ib" type="button" data-act="history" title="Historique du stream" aria-label="Historique du stream">${ic('history')}</button>
      <span class="wallet" data-slot="wallet">${ic('coin')}<span>—</span></span></div><div class="body"></div>`;
  const body = node.querySelector('.body');

  let data = null; // Core viewer state
  let me = null; // { viewer_id } or null (identity not shared)
  let receivedAt = 0;
  let view = 'main'; // main · participants · history
  let filter = 'all';
  let joining = false;
  let joinError = null;
  let shownKey = null;
  let leaving = false;
  let drawingSince = null; // { id, at } first time the drawing screen was seen (progress bar)
  let pollTimer = 0;
  let destroyed = false;
  let inFlight = false;
  let dueRead = 0; // closes_at / result_at reached locally: one immediate read
  const slotHtml = new WeakMap();

  const round = () => data?.round ?? null;
  /** Core's titles of a round (fallback only while an older Core answers). */
  const titles = (r) =>
    r?.titles ?? {
      name: 'Tombola',
      open: ['Tombola', 'ouverte'],
      running: ['Tombola', 'en cours'],
      paused: ['Tombola', 'en pause'],
      ended: ['Tombola', 'terminée'],
      cancelled: ['Tombola', 'annulée'],
    };
  const phase = () => data?.phase ?? null;
  const now = () => Date.now();

  // --- time (Core's values, moved locally between two reads) ------------------------------------------
  function leftMs() {
    const r = round();
    if (!r) return 0;
    const left = r.paused ? r.remaining_ms : r.remaining_ms - (now() - receivedAt);
    // Core's remaining time includes the opening announcement: never more than the round length.
    return Math.max(0, Math.min(r.duration_ms, left));
  }
  function resultInMs() {
    const r = round();
    if (!r?.result_at) return 0;
    const serverNow = Date.parse(data.server_time) + (now() - receivedAt);
    return Math.max(0, Date.parse(r.result_at) - serverNow);
  }

  // --- screens -----------------------------------------------------------------------------------------
  function screenKey() {
    if (view === 'history') return 'history';
    if (!data) return 'loading';
    const r = round();
    const p = phase();
    if (view === 'participants' && (p === 'open' || p === 'paused')) return `participants:${r.raffle_id}`;
    if (p === 'open' || p === 'paused') return `open:${r.raffle_id}`;
    if (p === 'drawing') return `drawing:${r.raffle_id}`;
    if (p === 'result') return `result:${r.raffle_id}`;
    if (p === 'cancelled') return `cancelled:${r.raffle_id}`;
    return 'none';
  }
  function label(r) {
    // Core's titles (the same as the overlay's, from Studio's labels).
    const t = (s) => esc(titles(r)[s].join(' ').trim());
    if (r.paused) return `${ic('clock')} ${t('paused')}`;
    if (r.kind === 'super') return `<span class="t-super">${ic('star')} ${esc(titles(r).name)}</span>`;
    if (r.kind === 'giveaway') return `${ic('gift')} ${t('running')}`;
    return `${ic('ticket')} ${t('running')}`;
  }
  function amountHtml(r, cls = 'amt') {
    if (r.kind === 'giveaway') return `<span class="t-amount ${cls}" style="font-family:var(--t-font);font-size:24px">${esc(r.prize)}</span>`;
    return `<span class="t-amount ${cls} ${r.kind === 'super' ? 'is-gold' : ''}">${fmt(r.amount)}<small>${esc(r.currency?.label ?? '')}</small></span>`;
  }
  function counts(r) {
    const c = r.counts ?? { chat: 0, extension: 0, manual: 0 };
    return `<span class="t-pill t-pill--chat">${ic('chat')}${c.chat}</span><span class="t-pill t-pill--ext">${ic('ext')}${c.extension}</span>${c.manual ? `<span class="t-pill">${ic('plus')}${c.manual}</span>` : ''}`;
  }
  function joinZone(r) {
    const cmd = `<code>${esc(data.join_command)}</code>`;
    if (r.joined) {
      const how = r.my_source === 'chat' ? 'Inscrit depuis le chat' : r.my_source === 'manual' ? 'Ajouté par la modération' : 'Inscrit depuis l’Extension';
      return `<div class="joined">${ic('check')}Tu participes</div><span class="fine">${how} · une seule inscription par viewer</span>`;
    }
    const refusal = r.refusal ?? (me ? null : 'identity_required');
    if (refusal) {
      return `<div class="refusal">${ic('lock')}<span>${esc(REFUSAL[refusal] ?? errorLabel(refusal))}</span></div>${CHAT_STILL_WORKS.has(refusal) ? `<span class="alt">ou tape ${cmd} dans le chat</span>` : ''}`;
    }
    return `<button class="t-btn t-btn--ext join" type="button" data-act="join" ${joining ? 'aria-busy="true" disabled' : ''}>${ic('ticket')}${joining ? 'Inscription…' : 'Je participe'}</button><span class="alt">ou tape ${cmd} dans le chat</span>${joinError ? `<span class="join-err" role="alert">${esc(REFUSAL[joinError] ?? errorLabel(joinError))}</span>` : ''}`;
  }
  function heroA(r) {
    const left = leftMs();
    return `<div class="hero ${r.kind === 'super' ? 'is-super' : ''} ${r.paused ? 'is-paused' : left <= 10_000 ? 'is-hot' : ''}">
      <span class="lbl" data-slot="lbl">${label(r)}</span>
      <div class="ringbig"><svg class="t-ring" viewBox="0 0 132 132"><circle class="bg" cx="66" cy="66" r="${R}"/><circle class="fg" cx="66" cy="66" r="${R}" style="stroke-dasharray:${CIRC};stroke-dashoffset:${CIRC * (1 - left / Math.max(1, r.duration_ms))}"/></svg>
        <span class="in"><b data-id="secs">${Math.ceil(left / 1000)}</b><span>secondes</span></span></div>
      ${amountHtml(r)}
      <div class="join-zone" data-slot="join" style="display:flex;flex-direction:column;align-items:center;gap:8px;width:100%">${joinZone(r)}</div>
      <div class="meta-row"><span class="who" data-slot="count">${ic('users')}<b>${r.participants}</b> participants</span><span class="split" data-slot="split">${counts(r)}</span></div>
    </div>`;
  }
  /** Me first (« toi »), then the others, newest first. */
  function people(r) {
    const list = (r.list ?? []).slice().reverse();
    const mine = me ? list.filter((p) => p.viewer_id === me.viewer_id) : [];
    return [...mine, ...list.filter((p) => !me || p.viewer_id !== me.viewer_id)];
  }
  function rows(r, limit) {
    // Preview (5, no filter) on the open screen; the full list (« Tout voir ») with its filters.
    const list = people(r);
    const shown = limit ? list.slice(0, limit) : list.filter((p) => filter === 'all' || p.source === filter);
    if (!shown.length) return '<p class="fine">En attente des premières inscriptions…</p>';
    return shown.map((p) => {
      const isMe = me && p.viewer_id === me.viewer_id;
      return `<div class="row ${isMe ? 'me' : ''}">${avatar(p.display_name, p.avatar_url)}<span class="name">${esc(p.display_name)}${isMe ? ' <span class="muted">(toi)</span>' : ''}</span>${srcPill(p.source)}</div>`;
    }).join('');
  }
  function participantsSec(r, limit) {
    return `<div class="sec"><span data-slot="pcount">Participants · ${r.participants}</span>${limit ? '<a data-act="participants">Tout voir</a>' : ''}</div>
      ${limit ? '' : `<div class="chips" data-slot="chips">${chips()}</div>`}
      <div class="rows" data-slot="rows">${rows(r, limit)}</div>`;
  }
  function chips() {
    return [['all', 'Tous'], ['chat', 'Chat'], ['extension', 'Extension']].map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" type="button" data-filter="${k}">${l}</button>`).join('');
  }
  function openView(r) {
    return `<div class="grid2"><div>${heroA(r)}</div><div>${participantsSec(r, 5)}</div></div>`;
  }
  function drawingView(r) {
    const left = resultInMs();
    return `<div class="drawing"><svg class="spin" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="6"/><circle cx="32" cy="32" r="26" fill="none" stroke="var(--t-teal)" stroke-width="6" stroke-linecap="round" stroke-dasharray="44 200"/></svg>
      <h3>Tirage en cours…</h3><p>Le résultat s’affiche d’abord sur le stream.<br>Il apparaîtra ici juste après.</p>
      <span class="reveal">Résultat dans <b data-id="rv">${Math.ceil(left / 1000)}</b> s <span class="barw"><i data-id="rvbar" style="width:${revealProgress() * 100}%"></i></span></span>
      ${r.joined ? `<span class="t-pill t-pill--ext">${ic('check')}Tu participes</span>` : ''}<span class="fine">${plural(r.participants, 'participant')}</span></div>`;
  }
  function revealProgress() {
    const r = round();
    if (!r?.result_at || !drawingSince) return 0;
    const total = Math.max(1, Date.parse(r.result_at) - drawingSince.at);
    return Math.min(1, Math.max(0, 1 - resultInMs() / total));
  }
  function fullResultView(r) {
    const w = r.winners[0];
    const n = r.participants;
    const cur = esc(r.currency?.short_label ?? '');
    if (r.won)
      return `<div class="stage gold win"><span class="t-full">${ic('crown')} Full oseille</span>
        <span class="orb glow">${pp(w.display_name, r.my_source, w.avatar_url)}</span>
        <span class="kick">Tu rafles tout</span><span class="who">${esc(w.display_name)}</span>
        <span class="t-amount gainbig">+ ${fmt(r.my_gain)}<small>${esc(r.currency?.label ?? '')}</small></span><p>Crédité sur ton wallet.</p></div>`;
    return `<div class="stage gold"><span class="t-full">${ic('crown')} Full oseille</span>
        <span class="orb">${pp(w.display_name, null, w.avatar_url)}</span>
        <span class="who">${esc(w.display_name)}</span><span class="kick">rafle ${fmt(w.amount)} ${cur}</span>
        <span class="rule"></span>${r.joined ? '<h3>Pas cette fois</h3>' : ''}<p>Un seul gagnant sur ${n}. Prochaine occasion à tout moment.</p></div>`;
  }
  function noParticipantView() {
    return `<div class="stage"><span class="orb quiet">${ic('users')}</span><h3>${esc(data?.empty_message ?? 'Aucun participant cette fois !')}</h3>
      <p>Personne ne s’est inscrit : pas de tirage, aucun gagnant.<br>Prochaine occasion à tout moment.</p></div>`;
  }
  function cancelledView() {
    return `<div class="stage"><span class="orb cancel"><svg viewBox="0 0 40 40"><path d="M12 12 L28 28"/><path d="M28 12 L12 28"/></svg></span>
      <h3>${esc(titles(round()).cancelled.join(' ').trim())}</h3><p>Annulation par l’équipe de modération.<br>Rien n’a été débité.</p></div>`;
  }
  function resultView(r) {
    if (r.outcome === 'no_participants' || !r.winners?.length) return noParticipantView();
    if (r.is_full) return fullResultView(r);
    const k = r.winners.length;
    const n = r.participants;
    const gold = r.kind === 'super';
    const giveaway = r.kind === 'giveaway';
    const cur = esc(r.currency?.short_label ?? '');
    const badge = r.kind === 'super'
      ? `<span class="t-super">${ic('star')} ${esc(titles(r).name)}</span>`
      : giveaway
        ? `<span class="t-pill">${ic('gift')}${esc(titles(r).name)}</span>`
        : `<span class="t-caps" style="color:var(--t-teal);font-size:11px">Résultat · ${esc(titles(r).name)}</span>`;
    const each = giveaway ? `Lot : ${esc(r.prize)}` : `${fmt(r.winners[0].amount)} ${cur} chacun`;
    const top = r.won
      ? `<div class="result win ${gold ? 'gold' : ''}">${badge}<h3>Tu as gagné !</h3>${giveaway ? `<span class="prize">${esc(r.prize)}</span><p>Le streamer te remettra ton lot.</p>` : `<span class="t-amount big won-gain">+ ${fmt(r.my_gain)}<small>${esc(r.currency?.label ?? '')}</small></span><p>Crédité sur ton wallet.</p>`}</div>`
      : `<div class="result">${badge}${r.joined ? '<h3>Pas cette fois</h3>' : `<h3>${plural(k, 'gagnant')}</h3>`}<p>${plural(k, 'gagnant')} sur ${n} participants · ${each}</p></div>`;
    return `<div class="grid2"><div>${top}</div><div><div class="sec">Gagnants</div><div class="rows">${r.winners
      .map((w) => {
        const isMe = me && w.viewer_id === me.viewer_id;
        return `<div class="row ${isMe ? 'me' : ''}">${avatar(w.display_name, w.avatar_url)}<span class="name">${esc(w.display_name)}${isMe ? ' <span class="muted">(toi)</span>' : ''}</span>${giveaway ? '<span class="gain">lot</span>' : `<span class="gain ${gold ? 'gold' : ''}">+ ${fmt(w.amount)}</span>`}</div>`;
      })
      .join('')}</div></div></div>`;
  }
  function what(h) {
    return h.kind === 'giveaway' ? esc(h.prize) : `${fmt(h.amount)} ${esc(h.currency?.short_label ?? '')}`;
  }
  function lastBlock() {
    const h = data?.history?.[0];
    if (!h) return '';
    const tag = h.status === 'cancelled' ? `${esc(h.name)} · annulation` : h.is_full ? 'Full oseille' : esc(h.name ?? 'Tombola');
    const end = h.status === 'cancelled' ? '' : h.winners.length ? ` · ${plural(h.winners.length, 'gagnant')}` : ' · aucun participant';
    return `<div class="last"><span>Dernière · ${hhmm(h.at)}</span><b>${tag} · ${what(h)}${end}</b><a data-act="history">Historique du stream</a></div>`;
  }
  function noneView() {
    return `<div class="stage"><span class="orb quiet">${ic('ticket')}</span><h3 data-slot="idletitle">${esc(data?.idle_title ?? 'Aucune Tombola en cours')}</h3>
      <p>Ça peut tomber à tout moment pendant le stream.<br>Tu pourras t’inscrire ici ou avec <b style="color:#b9f5ec">${esc(data?.join_command ?? '!join')}</b>.</p>
      <div data-slot="last">${lastBlock()}</div></div>`;
  }
  function histRow(h) {
    const tag = h.status === 'cancelled'
      ? '<span class="cx">Annulation</span>'
      : h.is_full
        ? '<span class="t-full">Full</span>'
        : h.kind === 'super'
          ? '<span class="t-super">Super</span>'
          : h.kind === 'giveaway'
            ? `<span class="t-pill">${ic('gift')}${esc(h.name ?? 'Giveaway')}</span>`
            : '';
    const names = h.winners.map((w) => w.display_name);
    const sub = h.status === 'cancelled'
      ? 'Annulation par la modération · rien n’a été débité'
      : names.length
        ? `${plural(names.length, 'gagnant')} · ${h.participants} participants · ${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? '…' : ''}`
        : 'Aucun participant';
    return `<div class="h"><span class="t">${hhmm(h.at)}</span><span class="w"><b style="${h.kind === 'super' || h.is_full ? 'color:var(--t-gold)' : ''}">${what(h)}</b><span>${sub}</span></span>
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">${tag}${h.me ? '<span class="me">Gagné</span>' : ''}</span></div>`;
  }
  function historyRows() {
    const list = data?.history ?? [];
    return list.length ? list.map(histRow).join('') : '<p class="fine">Rien pour l’instant sur ce stream.</p>';
  }
  function historyView() {
    const n = data?.history?.length ?? 0;
    return `<div class="sec" style="margin-top:0" data-slot="hcount">Ce stream · ${n}</div><div class="hist" data-slot="hist">${historyRows()}</div>
      <p class="fine" style="margin-top:12px">Seul le stream en cours est affiché.</p>`;
  }
  function bodyHtml(key) {
    const r = round();
    if (key === 'loading') return '<p class="fine">Chargement…</p>';
    if (key === 'history') return historyView();
    if (key === 'none') return noneView();
    if (key.startsWith('participants:')) return participantsSec(r);
    if (key.startsWith('open:')) return openView(r);
    if (key.startsWith('drawing:')) return drawingView(r);
    if (key.startsWith('result:')) return resultView(r);
    if (key.startsWith('cancelled:')) return cancelledView();
    return '';
  }

  // --- rendering ---------------------------------------------------------------------------------------
  function wireImages(el) {
    for (const i of el.querySelectorAll('img[data-pp]:not([data-wired])')) {
      i.dataset.wired = '1';
      i.addEventListener('error', () => i.remove(), { once: true });
    }
  }
  function setSlot(name, html) {
    const el = body.querySelector(`[data-slot="${name}"]`) ?? node.querySelector(`[data-slot="${name}"]`);
    if (!el || slotHtml.get(el) === html) return;
    slotHtml.set(el, html);
    el.innerHTML = html;
    wireImages(el);
  }
  function build(key, mode) {
    body.classList.remove('is-new', 'soft', 'leaving');
    body.innerHTML = bodyHtml(key);
    body.scrollTop = 0;
    // The entrance animation plays only for a new screen, never on a read.
    void body.offsetWidth;
    if (mode) body.classList.add(mode);
    shownKey = key;
    wireImages(body);
    if (key.startsWith('drawing:') && drawingSince?.id !== round()?.raffle_id) drawingSince = { id: round().raffle_id, at: now() };
  }
  function render() {
    if (destroyed) return;
    setSlot('hname', data ? esc(round() ? titles(round()).name : (data.idle_name ?? 'Tombola')) : '');
    node.querySelector('[data-act="history"]').classList.toggle('on', view === 'history');
    const key = screenKey();
    if (key !== shownKey) {
      if (leaving) return;
      const before = shownKey ?? '';
      // End of a round seen live (result / cancelled → aucune): fade back, nothing jumps.
      if (key === 'none' && (before.startsWith('result:') || before.startsWith('cancelled:'))) {
        leaving = true;
        body.classList.add('leaving');
        win.setTimeout(() => {
          leaving = false;
          if (!destroyed) build(screenKey(), 'soft');
        }, LEAVE_MS);
        return;
      }
      build(key, shownKey === null ? '' : 'is-new');
      return;
    }
    updateSlots(key);
  }
  /** Same screen: only what changed in Core's state is written (no node recreated otherwise). */
  function updateSlots(key) {
    const r = round();
    if (key.startsWith('open:')) {
      setSlot('lbl', label(r));
      setSlot('join', joinZone(r));
      setSlot('count', `${ic('users')}<b>${r.participants}</b> participants`);
      setSlot('split', counts(r));
      setSlot('pcount', `Participants · ${r.participants}`);
      setSlot('rows', rows(r, 5));
      const hero = body.querySelector('.hero');
      hero?.classList.toggle('is-paused', !!r.paused);
      tick();
    } else if (key.startsWith('participants:')) {
      setSlot('pcount', `Participants · ${r.participants}`);
      setSlot('chips', chips());
      setSlot('rows', rows(r));
    } else if (key === 'history') {
      setSlot('hcount', `Ce stream · ${data?.history?.length ?? 0}`);
      setSlot('hist', historyRows());
    } else if (key === 'none') {
      setSlot('idletitle', esc(data?.idle_title ?? 'Aucune Tombola en cours'));
      setSlot('last', lastBlock());
    }
  }
  /** Every 250 ms: seconds, ring, amber, « Résultat dans N s » — values only. */
  function tick() {
    const r = round();
    if (!r || destroyed) return;
    const p = phase();
    if (p === 'open' || p === 'paused') {
      const left = leftMs();
      const secs = body.querySelector('[data-id="secs"]');
      if (secs) secs.textContent = String(Math.ceil(left / 1000));
      const fg = body.querySelector('.ringbig .fg');
      if (fg) fg.style.strokeDashoffset = `${CIRC * (1 - left / Math.max(1, r.duration_ms))}`;
      body.querySelector('.hero')?.classList.toggle('is-hot', !r.paused && left <= 10_000);
      if (!r.paused && left <= 0) readSoon();
    } else if (p === 'drawing') {
      const rv = body.querySelector('[data-id="rv"]');
      if (rv) rv.textContent = String(Math.ceil(resultInMs() / 1000));
      const bar = body.querySelector('[data-id="rvbar"]');
      if (bar) bar.style.width = `${revealProgress() * 100}%`;
      if (resultInMs() <= 0) readSoon();
    }
  }
  /** Core's deadline reached locally: read once now instead of waiting for the next poll. */
  function readSoon() {
    if (dueRead && now() - dueRead < 900) return;
    dueRead = now();
    void poll();
  }

  // --- data -----------------------------------------------------------------------------------------
  function setWallet(wallet) {
    const v = wallet && !wallet.unavailable ? compact(wallet.available ?? wallet.points) : '—';
    setSlot('wallet', `${ic('coin')}<span>${esc(v)}</span>`);
  }
  async function poll() {
    if (destroyed || inFlight) return;
    inFlight = true;
    win.clearTimeout(pollTimer);
    try {
      const out = await client.raffleState();
      data = out?.raffle_v2 ?? null;
      me = out?.me ?? null;
      receivedAt = now();
      if (out?.wallet) setWallet(out.wallet);
      if (view === 'participants' && !(phase() === 'open' || phase() === 'paused')) view = 'main';
      render();
    } catch {
      /* the next read catches up; the screen keeps the last Core state */
    } finally {
      inFlight = false;
      if (!destroyed) {
        const p = phase();
        pollTimer = win.setTimeout(poll, p && p !== 'idle' ? POLL_ACTIVE_MS : POLL_IDLE_MS);
      }
    }
  }
  async function join() {
    if (joining) return;
    joining = true;
    joinError = null;
    render();
    try {
      await client.joinRaffle();
      onJoined?.();
    } catch (e) {
      joinError = e?.code ?? 'error';
    } finally {
      joining = false;
      await poll();
      render();
    }
  }

  node.addEventListener('click', (ev) => {
    const t = ev.target;
    const a = t.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'back') {
        if (view !== 'main') {
          view = 'main';
          render();
        } else onBack?.();
      } else if (act === 'history') {
        view = view === 'history' ? 'main' : 'history';
        render();
      } else if (act === 'participants') {
        view = 'participants';
        render();
      } else if (act === 'join') void join();
      return;
    }
    const f = t.closest('[data-filter]');
    if (f) {
      filter = f.dataset.filter;
      render();
    }
  });
  const ticker = win.setInterval(tick, 250);

  return {
    node,
    start() {
      render();
      void poll();
    },
    /** Host state (polled by the host): only the balance is taken from it. */
    update(state) {
      if (state?.wallet) setWallet(state.wallet);
    },
    attached() {
      tick();
    },
    destroy() {
      destroyed = true;
      win.clearTimeout(pollTimer);
      win.clearInterval(ticker);
    },
  };
}
