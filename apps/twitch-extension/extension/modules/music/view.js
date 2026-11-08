// Music Hub (docs/music/MUSIC_HUB_STATE.md) — the view of the extension's music module (shell v2, loaded on opening).
// FINAL design (Design Lab F3 finale, 08/11: « une seule liste musicale »): a compact field that drops a CURTAIN of
// results over the list while typing (exact version, Jetons confirmation), an economics band (price · requests left ·
// delay) whose sections explain themselves on a click, then ONE list: the track the player CONFIRMS first (« EN COURS »
// / « EN PAUSE »; nothing invented — when the player confirms nothing, the first request is « PROCHAINE MUSIQUE »),
// then the queue (yours withdrawable with a confirmation). The supermods' player sits behind a small icon of the
// « en cours » row; « Musiques de la soirée » behind the clock (real played requests only, paginated by Core).
// The view decides nothing: prices, limits, rights, refusals, refunds and the player's state are Core's (and Studio's),
// shown as they are. Every team action is checked again by Core (a hidden button is not a right).
import { newIdempotencyKey } from '../../shared/api.js';
import { createPoller, everySecond } from '../../app/store.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
const dur = (ms) => {
  if (ms === null || ms === undefined) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const hhmm = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A pasted link or URI (the Core resolves it with the reward's own rules: a track, or refused). */
const LINK = /^(?:spotify:|https?:\/\/|www\.|open\.spotify\.com\/)/i;
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  x: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  trash: svg('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>'),
  note: svg('<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  next: svg('<path d="M6 5.5v13l9-6.5z" fill="currentColor" stroke="none"/><path d="M18 5.5v13"/>'),
  left: svg('<path d="m15 6-6 6 6 6"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  dots: svg('<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  history: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4l3 2"/>'),
};
const EQ = '<span class="mh-eqs" aria-hidden="true"><i></i><i></i><i></i></span>';

/** Core's refusal codes, in words (the details — cooldown, balance, limit — come from Core). */
function refusal(e, st) {
  // The façade's answer is the Core's body: its details sit under `details` (cooldown, limit, balance…).
  const d = { ...(e?.details ?? {}), ...(e?.details?.details ?? {}) };
  switch (e?.code ?? e?.message) {
    case 'requests_closed': return 'Les demandes sont fermées pour le moment.';
    case 'extension_disabled': return 'Les demandes depuis l’extension sont désactivées.';
    case 'studio_unavailable': case 'auth_required': case 'auth_not_configured':
    case 'rate_limited': case 'spotify_unavailable': case 'no_device':
      return 'Le lecteur du stream est indisponible. Réessaie dans un moment.';
    case 'viewer_cooldown': return `Prochaine demande possible dans ${dur(d.cooldown_left_ms)}.`;
    case 'viewer_limit': return `Tu as déjà ${d.max_pending ?? ''} demande${d.max_pending > 1 ? 's' : ''} en attente : attends qu’une passe.`;
    case 'duplicate_track': return 'Ce titre est déjà dans la file.';
    case 'too_long': return `Ce titre dépasse la durée maximale (${Math.round((d.max_duration_seconds ?? 600) / 60)} min).`;
    case 'not_playable': return 'Cette version n’est pas disponible.';
    case 'track_unknown': return 'Ce résultat a expiré : relance la recherche.';
    case 'invalid_reference': return 'Ce lien n’est pas celui d’un titre (album, playlist ou autre site) : copie le lien du morceau.';
    case 'query_too_short': return 'Tape au moins deux lettres.';
    case 'price_changed': return `Le prix a changé : ${fmt(d.price ?? st?.price_tokens)} Jetons. Confirme à nouveau.`;
    case 'insufficient_tokens': return `Il te manque ${fmt(Math.max(0, (d.needed ?? 0) - (d.balance ?? 0)))} Jetons.`;
    case 'search_rate_limited': return 'Trop de recherches d’un coup : patiente quelques secondes.';
    case 'forbidden': return d.permission === 'music.player' ? 'Le lecteur est réservé aux supermods.' : 'Action réservée à l’équipe (permission manquante).';
    case 'team_only': return 'Action réservée à l’équipe.';
    case 'player_controls_disabled': return 'Les commandes du lecteur sont désactivées dans Studio.';
    case 'playing_use_skip': return 'Ce titre joue déjà : utilise « Passer ».';
    case 'not_removable': return 'Cette demande n’est plus dans la file.';
    case 'identity_required': return 'Partage ton identité Twitch pour demander une musique.';
    case 'network_error': return 'Connexion perdue. Réessaie : ta demande ne sera jamais payée deux fois.';
    default: return 'Action impossible pour le moment.';
  }
}

/** How one of YOUR requests left the queue, in words — or null when there is nothing to tell (played, your own withdrawal). */
function ending(h) {
  const t = h.title ? `« ${h.title} »` : 'Ta demande';
  const back = h.refunded ? (h.payment === 'tokens' ? ' · tes Jetons te sont rendus' : ' · tes points te sont rendus') : '';
  if (h.state === 'PLAYED' || h.state === 'SKIPPED') return null;
  if (h.state === 'CANCELED' && h.reason === 'VIEWER_CANCEL') return null;
  if (h.state === 'REMOVED_BY_MOD') return { kind: 'warning', text: `${t} a été retirée par la modération${back}.` };
  if (h.state === 'CANCELED') return { kind: 'warning', text: `${t} a été retirée de la file${back}.` };
  return { kind: 'warning', text: `${t} n’a pas pu être ajoutée${back}.` };
}

export function view(ctx) {
  const { document, client } = ctx;
  const host = ctx.host ?? {};
  const node = document.createElement('div');
  node.className = 'mh';
  node.innerHTML = `
    <div class="mh-top">
      <label class="mh-field">${I.search}<input type="search" data-draft-key="music-search" placeholder="Titre, artiste ou lien Spotify" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="Rechercher un titre ou un artiste, ou coller un lien Spotify" aria-controls="mh-curtain" aria-expanded="false"><button type="button" class="mh-x" data-act="clear" aria-label="Effacer la recherche" hidden>${I.x}</button></label>
      <button type="button" class="mh-clock" data-act="history" aria-pressed="false" aria-label="Musiques de la soirée" title="Musiques de la soirée">${I.history}</button>
    </div>
    <div class="mh-band" data-k="band"></div>
    <section class="mh-main"><div class="mh-scroll" data-k="scroll"><div data-k="body"></div></div></section>
    <div class="mh-curtain" id="mh-curtain" data-k="curtain" role="region" aria-label="Catalogue"><div class="mh-curtain__in"><div class="mh-results" id="mh-results" data-k="results" role="listbox" aria-label="Résultats"></div><div data-k="buy"></div></div></div>
    <div data-k="dialog"></div>
    <p class="mh-toast" data-k="toast" role="status" aria-live="polite"></p>`;
  const $ = (k) => node.querySelector(`[data-k="${k}"]`);
  const input = node.querySelector('input[type="search"]');

  let st = null; // Core's music state
  let failed = null;
  let results = null; // { items, provider, query } | { error } | null
  let searching = false;
  let seq = 0;
  let typing = null;
  let curtain = false;
  let pick = null; // { item, key, busy, error } — the chosen result (the curtain's bar)
  let menuFor = null; // team menu open on this request id
  let dialog = null; // { id } — the withdrawal confirmation
  let sup = false; // the supermods' player card under « en cours »
  let ctlBusy = null; // the player action waiting for Studio's answer
  let tip = null; // the open explanation of the band
  let hist = false; // « Musiques de la soirée » shown instead of the list
  let evening = null; // { items, next, since, live, loading, error }
  let flash = null;
  const scrolls = { queue: 0, history: 0 };
  const withdrawing = new Set();
  let toastTimer = null;
  let ticking = null;
  let io = null;
  let destroyed = false;
  // Notifications: told once per panel session (host memory), « pendant ton absence » for what ended before opening.
  const memory = host.memory ?? {};
  const told = (memory.musicTold ??= new Set());
  const openedAt = Date.now();
  let states = null; // your requests' states at the previous reading (live « ajoutée à la file »)
  let nowOwn = null;
  let quietFocus = false; // the field gets the focus back from Escape: it must not reopen the curtain

  const can = () => st?.can ?? { moderate: false, refund: false, player: false, open_close: false };
  const team = () => can().moderate || can().player;

  const toast = (text, kind = 'ok') => {
    const t = $('toast');
    t.textContent = text;
    t.dataset.kind = kind;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), 4500);
  };

  const poller = createPoller({
    interval: (bad) => (bad ? 8_000 : 4_000),
    async run() {
      try {
        st = await client.musicState();
        st.readAt = Date.now(); // the cooldown moves from this reading, never beyond it
        failed = null;
        notices();
        render();
        return true;
      } catch (e) {
        failed = e;
        render();
        return false;
      }
    },
  });

  /** What changed for YOU since the last reading: told live in the module, kept in the notification centre. */
  function notices() {
    const me = st?.me;
    if (!me) return;
    const next = new Map(me.requests.map((r) => [r.request_id, r.state]));
    if (states) {
      for (const r of me.requests) {
        const was = states.get(r.request_id);
        if ((was === 'RECEIVED' || was === 'SEARCHING') && r.state === 'QUEUED')
          toast(`« ${r.title ?? 'Ta demande'} » a rejoint la file.`);
      }
    }
    states = next;
    const own = st.now_playing?.own ? st.now_playing.request_id : null;
    if (own && nowOwn !== null && own !== nowOwn) toast(`Ta musique passe maintenant : « ${st.now_playing.title} ».`);
    nowOwn = own ?? '';
    for (const h of me.history ?? []) {
      const said = ending(h);
      if (!said || !h.ended_at) continue;
      const at = Date.parse(h.ended_at);
      if (Date.now() - at > 12 * 3_600_000) continue;
      const id = `music:${h.request_id}:${h.state}`;
      if (told.has(id)) continue;
      told.add(id);
      const absent = at < openedAt - 2_000;
      // The extension's notification centre (one per request and outcome: a stable id never duplicates).
      host.notify?.({ id, dedupe_key: id, type: said.kind, title: absent ? 'Pendant ton absence' : 'Musique', message: said.text, created_at: h.ended_at });
      toast(absent ? `Pendant ton absence : ${said.text}` : said.text, 'warn');
    }
  }

  const art = (url, cls = '') => url
    ? `<img class="mh-art ${cls}" src="${esc(url)}" alt="" loading="lazy" decoding="async">`
    : `<span class="mh-art mh-art--none ${cls}" aria-hidden="true">${I.note}</span>`;
  const artists = (a) => esc((a ?? []).join(', '));

  /**
   * A region is replaced only when its content changed, and the control that had the focus gets it back (fix of the
   * 08/11 feedback: every 4 s reading rebuilt the lists — focus lost, the view moving).
   */
  const focusKey = (el) =>
    el.dataset?.key ? `[data-key="${el.dataset.key}"]`
      : el.dataset?.pick !== undefined ? `[data-pick="${el.dataset.pick}"]`
        : el.dataset?.act ? `[data-act="${el.dataset.act}"]${el.dataset.id ? `[data-id="${el.dataset.id}"]` : ''}` : null;
  function put(box, html) {
    if (box.dataset.html === html) return false;
    const a = document.activeElement;
    const key = a && a !== box && box.contains(a) ? focusKey(a) : null;
    box.innerHTML = html;
    box.dataset.html = html;
    if (key) box.querySelector(key)?.focus({ preventScroll: true });
    return true;
  }

  // ------------------------------------------------------------------ the economics band (real rules, Core's)

  const cooldownLeft = () => (st?.me ? Math.max(0, st.me.cooldown_left_ms - (Date.now() - st.readAt)) : 0);

  function renderBand() {
    const box = $('band');
    if (!st) { put(box, ''); return; }
    const me = st.me;
    const left = me ? Math.max(0, me.max_pending - me.pending) : 0;
    const cd = cooldownLeft();
    if (tip === 'wait' && cd <= 0) tip = null;
    if (tip === 'quota' && !me) tip = null;
    const seg = (k, cls, inner) => `<button type="button" class="mh-seg ${cls}" data-act="tip" data-tip="${k}" data-key="tip-${k}" aria-expanded="${tip === k}" aria-controls="mh-tip">${inner}</button>`;
    let html = `<span class="mh-band__lab">${hist ? '' : `À suivre <b>· ${st.queue.length}</b>`}</span>`;
    if (!st.open) html += '<span class="mh-seg mh-seg--closed">Demandes fermées</span>';
    else {
      html += seg('price', 'mh-seg--price', `<b>◆ ${fmt(st.price_tokens)}</b><span class="mh-long">par demande</span>`);
      if (me) html += seg('quota', `mh-seg--quota ${left ? '' : 'is-full'}`, `<b>${left} / ${me.max_pending}</b><span class="mh-long">disponible${left > 1 ? 's' : ''}</span>`);
      if (cd > 0) html += seg('wait', 'mh-seg--wait', `${I.clock}<b>${dur(cd)}</b>`);
    }
    const T = {
      price: `<b>◆ ${fmt(st.price_tokens)} Jetons par demande.</b><small>Débités quand tu confirmes. Rendus une seule fois si tu retires ta demande avant qu’elle commence, ou si elle ne peut pas être ajoutée.</small>`,
      quota: me ? `<b>${left ? `Tu peux encore demander ${left} musique${left > 1 ? 's' : ''}.` : `Tu as déjà ${me.max_pending} demande${me.max_pending > 1 ? 's' : ''} en attente.`}</b><small>Au plus ${me.max_pending} demande${me.max_pending > 1 ? 's' : ''} en attente à la fois : cette limite évite qu’un même viewer monopolise la file. Une place se libère quand une de tes musiques commence.</small>` : '',
      wait: `<b>Prochaine demande dans ${dur(cd)}.</b><small>Un délai sépare deux demandes, compté depuis l’ajout de ta dernière demande, même si tu l’as retirée ensuite.</small>`,
    };
    if (tip) html += `<div class="mh-tip" id="mh-tip" role="note">${T[tip]}</div>`;
    put(box, html);
  }

  // ------------------------------------------------------------------ the list: « en cours » first, then the queue

  function nowHtml() {
    const n = st.now_playing;
    if (!n) return '';
    const by = n.kind === 'request' ? (n.own ? '<span class="mh-who is-me">ta demande</span>' : n.requested_by ? `<span class="mh-who">@${esc(n.requested_by)}</span>` : '') : '';
    const playing = !!n.is_playing;
    return `<div class="mh-now ${playing ? '' : 'is-paused'}" role="group" aria-label="${playing ? 'En cours' : 'En pause'} : ${esc(n.title)}">
      <span class="mh-now__ico">${playing ? EQ : I.pause}</span>${art(n.image_url, 'mh-art--now')}
      <span class="mh-tx"><span class="mh-tag">${playing ? 'En cours' : 'En pause'}</span><b>${esc(n.title)}</b><span>${artists(n.artists)}${by ? ` · ${by}` : ''}</span></span>
      ${can().player ? `<button type="button" class="mh-ico" data-act="sup" data-key="sup" aria-expanded="${sup}" aria-label="Lecteur du stream (supermods)" title="Lecteur du stream (supermods)">${I.sliders}</button>` : '<span></span>'}
    </div>${sup && can().player ? supHtml() : ''}`;
  }

  /** The supermods' player: what Studio confirms, never a guess (a hidden button is not a right: Core checks it). */
  function supHtml() {
    const p = st.player;
    const on = p.controls && p.connected;
    const playing = st.now_playing?.is_playing ?? p.is_playing;
    const busy = (a) => (ctlBusy === a ? 'aria-busy="true"' : '');
    const off = !on || !!ctlBusy;
    const why = !p.connected ? 'Lecteur indisponible (Studio, Spotify fermé ou aucun appareil).' : !p.controls ? 'Commandes du lecteur désactivées dans Studio.' : ctlBusy ? 'En attente de la réponse du lecteur…' : '';
    return `<div class="mh-sup" role="group" aria-label="Lecteur du stream (supermods)"><small>Lecteur du stream · supermods${p.connected && p.device ? ` · ${esc(p.device)}` : ''}</small>
      <button type="button" class="mh-btn" data-act="${playing ? 'pause' : 'resume'}" data-key="pp" ${off ? 'disabled' : ''} ${busy(playing ? 'pause' : 'resume')}>${playing ? `${I.pause} Pause` : `${I.play} Reprendre`}</button>
      <button type="button" class="mh-btn" data-act="skip" data-key="sk" ${off || !st.now_playing ? 'disabled' : ''} ${busy('skip')}>${I.next} Passer</button>
      <input type="range" min="0" max="100" step="5" value="${p.volume_percent ?? 50}" data-act="volume" data-key="vol" ${off ? 'disabled' : ''} aria-label="Volume du lecteur">
      ${why ? `<p class="mh-sup__why">${esc(why)}</p>` : ''}</div>`;
  }

  function queueHtml() {
    if (!st) return `<div class="mh-empty"><small>${failed ? esc(refusal(failed, st)) : 'Chargement…'}</small></div>`;
    const c = can();
    const rows = [...st.queue, ...st.pending.filter((p) => team() || p.own)].filter((e) => !withdrawing.has(e.request_id));
    const now = nowHtml();
    const off = team() && !st.player?.connected ? '<p class="mh-quiet">Lecteur du stream indisponible : rien n’est confirmé en lecture.</p>' : '';
    const tools = c.open_close
      ? `<div class="mh-team"><button type="button" class="mh-btn mh-btn--soft" data-act="${st.open ? 'close' : 'open'}" data-key="oc">${st.open ? 'Fermer les demandes' : 'Ouvrir les demandes'}</button></div>`
      : '';
    if (!rows.length && !now) return `${off}<div class="mh-empty">${I.note}<b>Rien en cours, rien en file</b><small>${st.open ? 'La prochaine musique peut être la tienne.' : 'Les demandes sont fermées pour le moment.'}</small></div>${tools}`;
    if (!rows.length) return `${off}${now}<p class="mh-quiet">Rien d’autre en file pour l’instant.</p>${tools}`;
    const mine = new Map((st.me?.requests ?? []).map((r) => [r.request_id, r]));
    return `${off}${now}<ol class="mh-list">${rows.map((e, i) => {
      const own = e.own;
      const r = mine.get(e.request_id);
      const adding = e.state === 'RECEIVED' || e.state === 'SEARCHING';
      const who = own ? '<span class="mh-who is-me">toi</span>' : `<span class="mh-who">@${esc(e.requested_by)}</span>`;
      const act = own && r?.cancellable
        ? `<button type="button" class="mh-ico mh-ico--trash" data-act="withdraw" data-id="${esc(e.request_id)}" aria-label="Retirer ma demande « ${esc(e.title ?? 'en cours d’ajout')} »">${I.trash}</button>`
        : c.moderate && !own && e.position
          ? `<button type="button" class="mh-ico" data-act="menu" data-id="${esc(e.request_id)}" aria-haspopup="menu" aria-expanded="${menuFor === e.request_id}" aria-label="Modérer la demande de ${esc(e.requested_by)}">${I.dots}</button>`
          : '<span></span>';
      const pay = team() && e.payment ? ` · ${e.payment === 'tokens' ? `◆ ${fmt(e.price_tokens)}` : 'points'}` : '';
      return `<li class="mh-row ${own ? 'is-mine' : ''} ${flash === e.request_id ? 'is-flash' : ''}" data-id="${esc(e.request_id)}">
        <span class="mh-num">${e.position ?? '…'}</span>${art(e.image_url)}
        <span class="mh-tx">${i === 0 && !now ? '<span class="mh-next">Prochaine musique</span>' : ''}<b>${esc(e.title ?? 'Titre en cours d’ajout')}</b><span>${who} · ${adding ? 'ajout en cours…' : artists(e.artists)}${pay}</span></span>
        ${act}
        ${menuFor === e.request_id ? `<span class="mh-menu" role="menu">
          ${c.refund ? `<button type="button" role="menuitem" data-act="remove-refund" data-id="${esc(e.request_id)}">Retirer et rembourser</button>` : ''}
          <button type="button" role="menuitem" class="is-danger" data-act="remove-keep" data-id="${esc(e.request_id)}">Retirer sans rembourser</button>
        </span>` : ''}
      </li>`;
    }).join('')}</ol>${tools}`;
  }

  // ------------------------------------------------------------------ « Musiques de la soirée » (Core, 20 per page)

  async function loadEvening(more = false) {
    if (evening?.loading) return;
    evening = { items: [], next: null, ...(more ? evening : {}), loading: true, error: null };
    renderBody();
    try {
      const r = await client.musicHistory(more ? evening.next : null);
      if (destroyed) return;
      evening = { items: [...(more ? evening.items : []), ...r.items], next: r.next, since: r.since, live: r.live, loading: false, error: null };
    } catch (e) {
      evening = { ...evening, loading: false, error: e };
    }
    renderBody();
  }

  function historyHtml() {
    const ev = evening ?? { items: [], loading: true };
    let lastHour = null;
    const rows = ev.items.map((h) => {
      const hour = new Date(h.at).getHours();
      const sep = hour !== lastHour ? `<li class="mh-hhour">${hour} h</li>` : '';
      lastHour = hour;
      return `${sep}<li class="mh-hrow ${h.own ? 'is-mine' : ''}"><time datetime="${esc(h.at)}">${hhmm(h.at)}</time>${art(h.image_url, 'mh-art--sm')}<span class="mh-tx"><b>${esc(h.title ?? '—')}</b><span>${artists(h.artists)} · ${h.own ? '<span class="mh-who is-me">toi</span>' : `<span class="mh-who">@${esc(h.requested_by)}</span>`}</span></span></li>`;
    }).join('');
    const head = `<div class="mh-hhead"><button type="button" class="mh-back" data-act="history" data-key="back">${I.left} Retour</button><b>Musiques de la soirée</b><small>${ev.since ? (ev.live ? `depuis ${hhmm(ev.since)}` : '12 dernières heures') : ''}</small></div>`;
    if (ev.error && !ev.items.length) return `${head}<div class="mh-empty"><small>${esc(refusal(ev.error))}</small><button type="button" class="mh-btn mh-btn--soft" data-act="hretry" data-key="hretry">Réessayer</button></div>`;
    if (!ev.items.length) return `${head}${ev.loading ? '<div class="mh-skel"></div>'.repeat(4) : `<div class="mh-empty">${I.note}<b>Aucune demande jouée pour l’instant</b><small>Les musiques demandées s’afficheront ici une fois passées.</small></div>`}`;
    return `${head}<ol class="mh-hlist">${rows}</ol>
      ${ev.next ? `<button type="button" class="mh-more" data-act="hmore" data-key="hmore" ${ev.loading ? 'aria-busy="true"' : ''}>Afficher les plus anciennes</button><span data-k="sentinel"></span>` : '<p class="mh-hnote">Seules les demandes sont listées (pas la musique du streamer).</p>'}`;
  }

  function watchSentinel() {
    const Observer = document.defaultView?.IntersectionObserver;
    if (typeof Observer !== 'function') return;
    io ??= new Observer((entries) => {
      if (hist && evening?.next && !evening.loading && entries.some((e) => e.isIntersecting)) void loadEvening(true);
    }, { root: $('scroll'), rootMargin: '0px 0px 60px 0px' });
    io.disconnect();
    const s = node.querySelector('[data-k="sentinel"]');
    if (s) io.observe(s);
  }

  function renderBody() {
    put($('body'), hist ? historyHtml() : queueHtml());
    node.querySelector('.mh-clock').setAttribute('aria-pressed', String(hist));
    renderBand();
    if (hist) watchSentinel();
  }

  function switchView(toHist) {
    scrolls[hist ? 'history' : 'queue'] = $('scroll').scrollTop;
    hist = toHist;
    tip = null;
    renderBody();
    $('scroll').scrollTop = scrolls[hist ? 'history' : 'queue'];
    if (hist && !evening?.items?.length) void loadEvening(false);
  }

  // ------------------------------------------------------------------ the curtain: search, exact version, confirm

  const typed = () => input.value.trim().length >= 2;
  const queuedIds = () => new Set([...(st?.queue ?? []), ...(st?.pending ?? [])].map((e) => e.track_id));

  function renderCurtain() {
    const q = input.value.trim();
    node.querySelector('[data-act="clear"]').hidden = !q;
    $('curtain').classList.toggle('is-open', curtain);
    node.classList.toggle('is-searching', curtain);
    input.setAttribute('aria-expanded', String(curtain));
    const box = $('results');
    let html = '';
    if (searching && !results) html = `${LINK.test(q) ? '<p class="mh-rcap"><span>Lien détecté : recherche du titre exact…</span></p>' : ''}${'<div class="mh-skel"></div>'.repeat(5)}`;
    else if (results?.error) html = `<div class="mh-msg">${esc(results.error === 'unavailable' ? 'Le catalogue ne répond pas pour le moment. Rien n’a été payé.' : refusal({ code: results.error }, st))}${results.error === 'invalid_reference' ? '' : '<br><button type="button" class="mh-more" data-act="retry" data-key="retry">Réessayer</button>'}</div>`;
    else if (results && !results.items.length) html = `<div class="mh-msg">${LINK.test(q) ? 'Ce lien ne correspond à aucun titre disponible.' : `Aucun titre pour « ${esc(q)} ». Essaie l’artiste seul, ou colle le lien du morceau.`}</div>`;
    else if (results) {
      const waiting = queuedIds();
      const n = results.items.length;
      html = `<p class="mh-rcap"><span>${LINK.test(results.query ?? '') ? 'Titre du lien' : 'Catalogue'}</span><span>${n} résultat${n > 1 ? 's' : ''}</span></p>` + results.items.map((i, k) => {
        const flag = !i.playable ? 'Indisponible' : i.too_long ? 'Trop long' : waiting.has(i.id) ? 'Déjà en file' : '';
        const on = pick?.item.id === i.id;
        return `<button type="button" class="mh-hit ${flag ? 'is-off' : ''} ${on ? 'is-sel' : ''}" role="option" aria-selected="${on}" data-pick="${k}" ${flag ? 'aria-disabled="true"' : ''} aria-label="${esc(`${i.title}, ${i.artists.join(', ')}${i.album ? `, ${i.album}` : ''}, ${dur(i.duration_ms)}${flag ? `, ${flag}` : ''}`)}">
          ${art(i.image_url)}<span class="mh-tx"><b>${esc(i.title)}</b><span>${artists(i.artists)}${i.album ? ` · ${esc(i.album)}` : ''}</span></span>
          <span class="mh-end">${flag ? `<span class="mh-why">${flag}</span>` : `<span class="mh-d">${dur(i.duration_ms)}</span><span class="mh-add">${on ? I.check : I.plus}</span>`}</span></button>`;
      }).join('') + `<p class="mh-src">${results.provider === 'lab' ? 'Catalogue de démonstration du Lab : titres et artistes fictifs, aucun service musical réel.' : 'Catalogue : compte musical connecté au Studio du stream.'}</p>`;
    }
    put(box, html);
    if (searching) box.setAttribute('aria-busy', 'true');
    else box.removeAttribute('aria-busy');
    renderBuy();
  }

  function renderBuy() {
    if (!pick) { put($('buy'), ''); return; }
    const i = pick.item;
    const price = st?.price_tokens ?? 0;
    const bal = st?.me?.balance;
    const after = bal === null || bal === undefined ? null : bal - price;
    const line = pick.error
      ? `<span class="mh-buy__err" role="alert">${esc(pick.error)}</span>`
      : `<b>◆ ${fmt(price)}</b>${after !== null ? ` · il te restera ◆ ${fmt(after)}` : ''}`;
    put($('buy'), `<div class="mh-buy" role="group" aria-label="Demander ce titre">${art(i.image_url)}<span class="mh-tx"><b>${esc(i.title)}</b><span>${line}</span></span>
      <span class="mh-buy__acts"><button type="button" class="mh-x" data-act="unpick" data-key="unpick" aria-label="Annuler la sélection">${I.x}</button>
      <button type="button" class="mh-btn mh-btn--go" data-act="confirm" data-key="confirm" ${pick.busy ? 'disabled aria-busy="true"' : ''}>${pick.busy ? 'Envoi…' : `Demander · ◆ ${fmt(price)}`}</button></span></div>`);
  }

  function openCurtain() {
    if (curtain || !typed()) return;
    curtain = true;
    menuFor = null;
    tip = null;
    renderCurtain();
    renderBand();
  }
  function closeCurtain(clear) {
    if (clear) { input.value = ''; results = null; seq++; searching = false; }
    curtain = false;
    pick = null;
    renderCurtain();
  }

  async function runSearch(q) {
    const mine = ++seq;
    searching = true;
    renderCurtain();
    try {
      let r = await client.musicSearch(q);
      const started = Date.now();
      while (r.status === 'pending' && Date.now() - started < 7_000) {
        await sleep(300);
        if (mine !== seq || destroyed) return;
        r = await client.musicSearchResult(r.search_id);
      }
      if (mine !== seq || destroyed) return; // a newer search replaced it
      results = r.status === 'done' ? { items: r.items, provider: r.provider, query: q } : { error: 'unavailable' };
    } catch (e) {
      if (mine !== seq || destroyed) return;
      results = { error: e?.code ?? 'unavailable' };
    }
    searching = false;
    if (pick && !results.items?.some((i) => i.id === pick.item.id)) pick = null;
    renderCurtain();
  }

  const onInput = () => {
    clearTimeout(typing);
    const q = input.value.trim();
    if (q.length < 2) {
      seq++;
      results = null;
      searching = false;
      closeCurtain(false);
      return;
    }
    if (results?.error) results = null;
    if (!curtain) { curtain = true; menuFor = null; tip = null; renderBand(); }
    searching = true; // the previous results stay (dimmed) until the new ones arrive: no blink while typing
    renderCurtain();
    typing = setTimeout(() => runSearch(q), LINK.test(q) ? 0 : 230);
  };

  async function confirm() {
    if (!pick || pick.busy) return;
    pick.busy = true;
    pick.error = null;
    renderBuy();
    const chosen = pick;
    try {
      const r = await client.musicRequest(chosen.key, chosen.item.id, st?.price_tokens ?? null);
      flash = r?.request?.request_id ?? null;
      closeCurtain(true);
      input.blur();
      if (hist) switchView(false);
      toast(`« ${chosen.item.title} » est demandé : il rejoint la file.`);
      await poller.now();
      if (flash) node.querySelector(`.mh-row[data-id="${CSS.escape(flash)}"]`)?.scrollIntoView({ block: 'nearest' });
      setTimeout(() => { flash = null; }, 1_600);
    } catch (e) {
      // A lost answer keeps the SAME key (a retry can never pay twice); a decided refusal gets a new one.
      if (e?.code !== 'network_error') chosen.key = newIdempotencyKey();
      if (e?.code === 'price_changed' && st) st.price_tokens = e.details?.price ?? st.price_tokens;
      chosen.error = refusal(e, st);
      chosen.busy = false;
      renderBuy();
      if (e?.code !== 'network_error') void poller.now();
    }
  }

  // ------------------------------------------------------------------ withdrawal (confirmation, refunded once by Core)

  function renderDialog() {
    if (!dialog) { put($('dialog'), ''); return; }
    const e = [...(st?.queue ?? []), ...(st?.pending ?? [])].find((x) => x.request_id === dialog.id);
    const r = (st?.me?.requests ?? []).find((x) => x.request_id === dialog.id);
    if (!e || !r?.cancellable) { dialog = null; put($('dialog'), ''); return; }
    const back = r.payment === 'tokens' ? 'tes Jetons te seront rendus' : 'tes points de chaîne te seront rendus';
    const adding = e.state === 'RECEIVED' || e.state === 'SEARCHING';
    const text = adding
      ? `Elle est en cours d’ajout : ${back}. Si elle arrive quand même dans la file Spotify, elle sera passée dès son début.`
      : `${back[0].toUpperCase()}${back.slice(1)}. Elle est déjà dans la file Spotify : elle sera passée au moment de sa lecture.`;
    put($('dialog'), `<div class="mh-scrim" data-act="keep-out"><div class="mh-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mh-wt" aria-describedby="mh-wd">
      <div class="mh-dialog__row">${art(e.image_url, 'mh-art--lg')}<div><h3 id="mh-wt">Retirer cette musique ?</h3><p><b>${esc(e.title ?? 'Titre en cours d’ajout')}</b>${e.artists?.length ? ` · ${esc(e.artists[0])}` : ''}</p></div></div>
      <p id="mh-wd">${esc(text)}</p>
      <div class="mh-dialog__acts"><button type="button" class="mh-btn" data-act="keep" data-key="keep">Conserver</button><button type="button" class="mh-btn mh-btn--danger" data-act="confirm-withdraw" data-key="cw">Retirer</button></div></div></div>`);
  }

  async function withdraw(id) {
    if (withdrawing.has(id)) return;
    withdrawing.add(id); // gone from the list at once, confirmed (or put back) by Core
    renderBody();
    try {
      const r = await client.musicCancel(id);
      if (r.outcome === 'songcancel' || r.outcome === 'songcancel_current')
        toast(r.request?.payment === 'tokens' ? 'Demande retirée : tes Jetons te sont rendus.' : 'Demande retirée.');
      else toast(r.outcome === 'songcancel_too_late' ? 'Trop tard : ce titre a déjà commencé.' : 'Cette demande n’est plus dans la file.', 'warn');
    } catch (e) {
      toast(refusal(e, st), 'err');
    }
    await poller.now();
    withdrawing.delete(id);
    renderBody();
  }

  /** A team action. A player action waits for Studio's answer: the view shows what really happened, never a guess. */
  async function moderate(command, success) {
    const player = ['pause', 'resume', 'skip', 'volume'].includes(command.action);
    if (player) { ctlBusy = command.action; renderBody(); }
    try {
      const r = await client.musicModerate(command);
      if (r.job_id) {
        let out = { status: 'pending' };
        for (let n = 0; n < 16 && out.status === 'pending' && !destroyed; n++) {
          await sleep(350);
          out = await client.musicControl(r.job_id);
        }
        toast(out.status === 'done' ? success : out.status === 'pending' ? 'Le lecteur n’a pas encore répondu.' : 'Le lecteur n’a pas confirmé l’action.', out.status === 'done' ? 'ok' : 'warn');
      } else if (player && 'job_id' in r) toast('Le lecteur est indisponible : rien n’a été envoyé.', 'warn');
      else toast(success);
    } catch (e) {
      toast(refusal(e, st), 'err');
    }
    ctlBusy = null;
    menuFor = null;
    await poller.now();
  }

  // ------------------------------------------------------------------ frame

  function render() {
    if (destroyed) return;
    input.disabled = !!st && !st.open;
    renderBody();
    renderCurtain();
    renderDialog();
  }

  const onPointer = (event) => {
    // A press outside the curtain folds it — never while a version is chosen (nothing typed or chosen is lost).
    if (curtain && !pick && !event.target.closest('.mh-curtain, .mh-field, .mh-scrim')) closeCurtain(false);
    if (tip && !event.target.closest('.mh-seg, .mh-tip')) { tip = null; renderBand(); }
  };

  const onClick = (event) => {
    const t = event.target.closest?.('[data-act],[data-pick]');
    if (menuFor && !(t && (t.dataset.act === 'menu' || t.closest('.mh-menu')))) { menuFor = null; renderBody(); if (!t) return; }
    if (!t || !node.contains(t)) return;
    if (t.dataset.pick !== undefined) {
      if (t.getAttribute('aria-disabled') === 'true') return;
      const item = results?.items?.[Number(t.dataset.pick)];
      if (!item) return;
      pick = pick?.item.id === item.id ? null : { item, key: newIdempotencyKey(), busy: false, error: null };
      renderCurtain();
      if (pick) {
        t.scrollIntoView?.({ block: 'nearest' });
        $('buy').querySelector('[data-act="confirm"]:not(:disabled)')?.focus({ preventScroll: true });
      }
      return;
    }
    const a = t.dataset.act;
    const id = t.dataset.id;
    if (a === 'keep-out') { if (event.target === t) { dialog = null; renderDialog(); } return; }
    if (a === 'clear') { closeCurtain(true); input.focus({ preventScroll: true }); }
    else if (a === 'retry') { if (typed()) { results = null; void runSearch(input.value.trim()); } }
    else if (a === 'unpick') { pick = null; renderCurtain(); }
    else if (a === 'confirm') void confirm();
    else if (a === 'tip') { tip = tip === t.dataset.tip ? null : t.dataset.tip; renderBand(); }
    else if (a === 'history') { switchView(!hist); if (curtain && !pick) closeCurtain(false); }
    else if (a === 'hmore') void loadEvening(true);
    else if (a === 'hretry') void loadEvening(false);
    else if (a === 'sup') { sup = !sup; renderBody(); }
    else if (a === 'menu') { menuFor = menuFor === id ? null : id; renderBody(); }
    else if (a === 'withdraw') { dialog = { id, from: id }; renderDialog(); node.querySelector('[data-act="keep"]')?.focus({ preventScroll: true }); }
    else if (a === 'keep') { const back = dialog?.from; dialog = null; renderDialog(); node.querySelector(`[data-act="withdraw"][data-id="${back}"]`)?.focus({ preventScroll: true }); }
    else if (a === 'confirm-withdraw') { const d = dialog; dialog = null; renderDialog(); if (d) void withdraw(d.id); }
    else if (a === 'remove-refund') void moderate({ action: 'remove', request_id: id, refund: true }, 'Retirée et remboursée.');
    else if (a === 'remove-keep') {
      if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = 'Confirmer : sans remboursement'; return; }
      void moderate({ action: 'remove', request_id: id, refund: false }, 'Retirée, sans remboursement.');
    } else if (a === 'skip') void moderate({ action: 'skip' }, 'Musique passée.');
    else if (a === 'pause') void moderate({ action: 'pause' }, 'Lecteur en pause.');
    else if (a === 'resume') void moderate({ action: 'resume' }, 'Lecture reprise.');
    else if (a === 'open') void moderate({ action: 'open' }, 'Demandes ouvertes.');
    else if (a === 'close') void moderate({ action: 'close' }, 'Demandes fermées.');
  };
  const onChange = (event) => {
    if (event.target.dataset?.act === 'volume')
      void moderate({ action: 'volume', volume_percent: Number(event.target.value) }, `Volume réglé à ${event.target.value} %.`);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      const handled = dialog || menuFor || pick || curtain || tip || sup || hist;
      if (!handled) { if (event.target === input) event.preventDefault(); return; }
      event.preventDefault(); // Chrome would clear a type=search field
      event.stopPropagation();
      if (dialog) { const back = dialog.from; dialog = null; renderDialog(); node.querySelector(`[data-act="withdraw"][data-id="${back}"]`)?.focus({ preventScroll: true }); }
      else if (menuFor) { menuFor = null; renderBody(); }
      else if (pick) { pick = null; renderCurtain(); }
      else if (curtain) { closeCurtain(false); quietFocus = true; input.focus({ preventScroll: true }); quietFocus = false; }
      else if (tip) { const k = tip; tip = null; renderBand(); node.querySelector(`[data-key="tip-${k}"]`)?.focus({ preventScroll: true }); }
      else if (sup) { sup = false; renderBody(); node.querySelector('[data-act="sup"]')?.focus({ preventScroll: true }); }
      else if (hist) { switchView(false); node.querySelector('.mh-clock')?.focus({ preventScroll: true }); }
      return;
    }
    if (event.target === input) {
      if (event.key === 'Enter' && typed()) {
        // Enter in the field: search now (no wait for the typing pause).
        event.preventDefault();
        clearTimeout(typing);
        openCurtain();
        void runSearch(input.value.trim());
        return;
      }
      if (event.key === 'ArrowDown' && curtain) {
        const f = node.querySelector('[data-pick]:not([aria-disabled])');
        if (f) { event.preventDefault(); f.focus(); }
      }
      return;
    }
    // Results: arrows move between them, up from the first back to the field.
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && curtain && document.activeElement?.dataset?.pick !== undefined) {
      const rows = [...node.querySelectorAll('[data-pick]')];
      const at = rows.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : at - 1;
      event.preventDefault();
      (next < 0 ? input : rows[next]).focus();
    }
  };
  const onFocus = () => { if (!quietFocus && typed() && results) openCurtain(); };
  input.addEventListener('input', onInput);
  input.addEventListener('focus', onFocus);
  node.addEventListener('pointerdown', onPointer);
  node.addEventListener('click', onClick);
  node.addEventListener('change', onChange);
  node.addEventListener('keydown', onKey);

  render();
  return {
    node,
    start() {
      // A draft kept by the host (data-draft-key) is searched again on return.
      if (typed()) onInput();
      void poller.now();
      ticking = everySecond(renderBand);
    },
    /** A session refresh: absorbed (no host redraw); the music summary changed (open / closed, queue size) → re-read. */
    onState(next, previous) {
      if (JSON.stringify(next?.music ?? null) !== JSON.stringify(previous?.music ?? null)) void poller.now();
      return true;
    },
    destroy() {
      destroyed = true;
      seq++;
      poller.stop();
      ticking?.();
      io?.disconnect();
      clearTimeout(typing);
      clearTimeout(toastTimer);
      input.removeEventListener('input', onInput);
      input.removeEventListener('focus', onFocus);
      node.removeEventListener('pointerdown', onPointer);
      node.removeEventListener('click', onClick);
      node.removeEventListener('change', onChange);
      node.removeEventListener('keydown', onKey);
    },
  };
}
