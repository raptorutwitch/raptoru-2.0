// Music Hub (docs/music/MUSIC_HUB_STATE.md) — the view of the extension's music module (shell v2, loaded on opening).
// V2 (retour du 08/11): the SEARCH is the centre — a catalogue list as you type (or a pasted Spotify link), pick the
// exact version, confirm the price. Then the queue with « tes demandes » first (withdrawn at once, even while being
// added), a slim « en cours » strip at the bottom, and the stream's player in a separate panel for supermods only.
// The view decides nothing: prices, limits, rights, refusals, refunds and the player's state are Core's (and Studio's),
// shown as they are — never assumed. Every action of the team is checked again by Core (a hidden button is not a right).
import { newIdempotencyKey } from '../../shared/api.js';
import { createPoller, everySecond } from '../../app/store.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
const dur = (ms) => {
  if (ms === null || ms === undefined) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const wait = (ms) => {
  if (ms === null || ms === undefined) return '';
  const min = Math.round(ms / 60000);
  return min < 1 ? 'tout de suite' : `dans ~${min} min`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A pasted link or URI (the Core resolves it with the reward's own rules: a track, or refused). */
const LINK = /^(?:spotify:|https?:\/\/|www\.|open\.spotify\.com\/)/i;
const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const NOTE = icon('<path d="M9 17.5V6.5l10-2v11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="6.6" cy="17.6" r="2.6" fill="currentColor"/><circle cx="16.6" cy="15.6" r="2.6" fill="currentColor"/>');
const LENS = icon('<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>');
const PLUS = icon('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>');
const CLEAR = icon('<path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>');
const LINKI = icon('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>');
const SLIDERS = icon('<path d="M5 7h9M18 7h1M5 17h3M12 17h7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="10" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.9"/>');
const DOTS = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.6" fill="currentColor"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><circle cx="13" cy="8" r="1.6" fill="currentColor"/></svg>';
const PAUSE = icon('<rect x="7" y="5" width="3.6" height="14" rx="1" fill="currentColor"/><rect x="13.4" y="5" width="3.6" height="14" rx="1" fill="currentColor"/>');
const PLAY = icon('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>');
const NEXT = icon('<path d="M6 5.5v13l9-6.5zM16.5 5.5h2.5v13h-2.5z" fill="currentColor"/>');

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

const STATE_WORD = {
  RECEIVED: 'Ajout en cours…', SEARCHING: 'Ajout en cours…', PLAYING: 'En cours', UNKNOWN: 'À vérifier par l’équipe',
};
const ENDED = {
  PLAYED: 'Jouée', SKIPPED: 'Passée', CANCELED: 'Retirée', REMOVED_BY_MOD: 'Retirée par l’équipe', FAILED: 'Échec',
  TOO_LONG: 'Trop longue', AMBIGUOUS: 'Titre introuvable', VIEWER_LIMIT: 'Refusée (limite)', VIEWER_COOLDOWN: 'Refusée (délai)',
};

export function view(ctx) {
  const { document, client } = ctx;
  const node = document.createElement('div');
  node.className = 'mh';
  node.innerHTML = `
    <div class="mh-top">
      <label class="mh-search">${LENS}<input type="search" data-draft-key="music-search" placeholder="Titre, artiste ou lien Spotify" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="Rechercher un titre ou un artiste" aria-controls="mh-results"><button type="button" class="mh-search__x" data-act="clear" aria-label="Effacer la recherche" hidden>${CLEAR}</button></label>
      <div class="mh-bar">
        <div class="mh-seg" role="tablist" aria-label="Choisir la prochaine musique du stream">
          <button type="button" role="tab" class="mh-tab" data-tab="search">Rechercher</button>
          <button type="button" role="tab" class="mh-tab" data-tab="queue">File</button>
        </div>
        <p class="mh-meta" data-k="meta"></p>
      </div>
    </div>
    <section class="mh-panel" data-panel="search"><div class="mh-results" id="mh-results" data-k="results" role="listbox" aria-label="Résultats"></div></section>
    <section class="mh-panel" data-panel="queue" hidden><div data-k="queue"></div></section>
    <div class="mh-deck" id="mh-deck" data-k="deck" hidden></div>
    <footer class="mh-now" data-k="now"></footer>
    <div class="mh-sheet" data-k="sheet" hidden></div>
    <p class="mh-toast" data-k="toast" role="status" aria-live="polite"></p>`;
  const $ = (k) => node.querySelector(`[data-k="${k}"]`);
  const input = node.querySelector('input[type="search"]');
  const clearBtn = node.querySelector('[data-act="clear"]');

  let st = null; // Core's music state
  let failed = null;
  let tab = 'search';
  let results = null; // { items, provider, query } | { error } | null
  let searching = false;
  let seq = 0;
  let typing = null;
  let pick = null; // { item, key, busy, error, from }
  let menuFor = null; // team menu open on this request id
  let deck = false; // the supermods' player panel open
  let ctlBusy = null; // the player action waiting for Studio's answer
  let historyOpen = false; // « Historique » stays as the viewer left it across readings
  const withdrawing = new Set();
  let toastTimer = null;
  let ticking = null;
  let destroyed = false;

  const can = () => st?.can ?? { moderate: false, refund: false, player: false, open_close: false };
  const team = () => can().moderate || can().player;

  const toast = (text, kind = 'ok') => {
    const t = $('toast');
    t.textContent = text;
    t.dataset.kind = kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.textContent = ''; }, 4500);
  };

  const poller = createPoller({
    interval: (bad) => (bad ? 8_000 : 4_000),
    async run() {
      try {
        st = await client.musicState();
        st.readAt = Date.now(); // the cooldown moves from this reading, never beyond it
        failed = null;
        render();
        return true;
      } catch (e) {
        failed = e;
        render();
        return false;
      }
    },
  });

  const art = (url, cls = '') => url
    ? `<img class="mh-art ${cls}" src="${esc(url)}" alt="" loading="lazy" decoding="async">`
    : `<span class="mh-art mh-art--none ${cls}" aria-hidden="true">${NOTE}</span>`;
  const artists = (a) => esc((a ?? []).join(', '));

  /**
   * A region is replaced only when its content changed, and the control that had the focus gets it back (fix of the
   * 08/11 feedback: every 4 s reading rebuilt the lists — focus lost, « Historique » closed, the view moving).
   */
  const focusKey = (el) =>
    el.dataset?.pick !== undefined ? `[data-pick="${el.dataset.pick}"]`
      : el.dataset?.act ? `[data-act="${el.dataset.act}"]${el.dataset.id ? `[data-id="${el.dataset.id}"]` : ''}`
        : el.dataset?.tab ? `[data-tab="${el.dataset.tab}"]`
          : el.dataset?.idea !== undefined ? '[data-idea]'
            : el.tagName === 'SUMMARY' ? 'summary' : null;
  function put(box, html) {
    if (box.dataset.html === html) return false;
    const a = document.activeElement;
    const key = a && a !== box && box.contains(a) ? focusKey(a) : null;
    box.innerHTML = html;
    box.dataset.html = html;
    if (key) box.querySelector(key)?.focus({ preventScroll: true });
    return true;
  }

  // ------------------------------------------------------------------ top: limits in one line

  function renderMeta() {
    const box = $('meta');
    if (!st) { put(box, ''); return; }
    if (!st.open) { put(box, '<span class="mh-chip mh-chip--off">Demandes fermées</span>'); return; }
    const me = st.me;
    put(box, `<span class="mh-chip mh-chip--price" title="Prix d’une demande">◆ ${fmt(st.price_tokens)}</span>${me
      ? `<button type="button" class="mh-chip" data-tab="queue" title="Tes demandes en attente / maximum" aria-label="Tes demandes : ${me.pending} sur ${me.max_pending}">${me.pending}/${me.max_pending}</button><span class="mh-chip mh-chip--cd" data-k="cooldown" hidden></span>`
      : ''}`);
    tick();
  }

  /** The cooldown, from Core's last reading (never beyond it). */
  function tick() {
    const cd = $('cooldown');
    if (!cd || !st?.me) return;
    const left = Math.max(0, st.me.cooldown_left_ms - (Date.now() - st.readAt));
    cd.hidden = left <= 0;
    cd.textContent = left > 0 ? `⏱ ${dur(left)}` : '';
    cd.title = left > 0 ? `Prochaine demande possible dans ${dur(left)}` : '';
  }

  // ------------------------------------------------------------------ search

  function queuedIds() {
    return new Set([...(st?.queue ?? []), ...(st?.pending ?? [])].map((e) => e.track_id));
  }

  /** Before typing: ideas (the recent songs of the stream) and what the field accepts. */
  function idle() {
    const seen = new Set();
    const ideas = (st?.recent ?? [])
      .filter((r) => r.title && !seen.has(r.title) && seen.add(r.title))
      .slice(0, 6)
      .map((r) => `<button type="button" class="mh-idea" data-idea="${esc(`${r.title} ${(r.artists ?? [])[0] ?? ''}`.trim())}">${art(r.image_url, 'mh-art--xs')}<span><strong>${esc(r.title)}</strong><small>${artists(r.artists)}</small></span></button>`)
      .join('');
    return `${ideas ? `<p class="mh-label">Passées récemment sur le stream</p><div class="mh-ideas">${ideas}</div>` : ''}
      <p class="mh-hint">${LENS}<span>Tape un titre ou un artiste : les versions s’affichent pendant la frappe. Tu peux aussi coller le lien d’un morceau (open.spotify.com/track/…).</span></p>`;
  }

  const skeleton = () => `<div class="mh-skel" aria-hidden="true">${'<span class="mh-skel__row"><i></i><b></b></span>'.repeat(4)}</div>`;

  function renderResults() {
    const box = $('results');
    const q = input.value.trim();
    clearBtn.hidden = !q;
    if (st && !st.open) {
      put(box, '<p class="mh-empty">Les demandes sont fermées pour le moment. La file reste visible dans « File ».</p>');
      return;
    }
    if (q.length < 2) {
      box.removeAttribute('aria-busy');
      put(box, idle());
      return;
    }
    const link = LINK.test(q);
    if (searching && !results) {
      put(box, `${link ? `<p class="mh-label">${LINKI} Lien détecté : recherche du titre exact…</p>` : ''}${skeleton()}`);
      box.setAttribute('aria-busy', 'true');
      return;
    }
    if (!results) return;
    if (results.error) {
      box.removeAttribute('aria-busy');
      put(box, `<div class="mh-empty mh-empty--err"><p>${esc(results.error === 'unavailable' ? 'Le catalogue ne répond pas pour le moment.' : refusal({ code: results.error }, st))}</p>${results.error === 'invalid_reference' ? '' : '<button type="button" class="mh-btn mh-btn--ghost" data-act="retry">Réessayer</button>'}</div>`);
      return;
    }
    if (!results.items.length) {
      box.removeAttribute('aria-busy');
      put(box, `<p class="mh-empty">${link ? 'Ce lien ne correspond à aucun titre disponible.' : `Aucun titre pour « ${esc(q)} ». Essaie l’artiste seul, ou colle le lien du morceau.`}</p>`);
      return;
    }
    const waiting = queuedIds();
    const n = results.items.length;
    put(box, `<p class="mh-label">${LINK.test(results.query ?? '') ? `${LINKI} Titre du lien` : `${n} titre${n > 1 ? 's' : ''} · choisis la bonne version`}</p>` + results.items.map((i, k) => {
      const flag = !i.playable ? 'Indisponible' : i.too_long ? 'Trop long' : waiting.has(i.id) ? 'Déjà en file' : '';
      const sub = `${i.artists.join(', ')}${i.album ? ` · ${i.album}` : ''}`;
      return `<button type="button" class="mh-row ${flag ? 'is-off' : ''}" role="option" aria-selected="false" data-pick="${k}" ${flag ? 'aria-disabled="true"' : ''} aria-label="${esc(`${i.title}, ${sub}, ${dur(i.duration_ms)}${flag ? `, ${flag}` : ''}`)}">
        ${art(i.image_url)}
        <span class="mh-row__txt"><strong>${esc(i.title)}</strong><small>${esc(sub)}</small></span>
        <span class="mh-row__end">${flag ? `<em class="mh-flag">${flag}</em>` : `<span class="mh-dur">${dur(i.duration_ms)}</span>`}<span class="mh-add">${PLUS}</span></span>
      </button>`;
    }).join('') + (results.provider === 'lab'
      ? '<p class="mh-src">Catalogue de démonstration du Lab : titres et artistes fictifs, aucun service musical réel.</p>'
      : '<p class="mh-src">Catalogue : compte musical connecté au Studio du stream.</p>'));
    if (searching) box.setAttribute('aria-busy', 'true');
    else box.removeAttribute('aria-busy');
  }

  async function runSearch(q) {
    const mine = ++seq;
    searching = true;
    renderResults();
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
    renderResults();
  }

  const onInput = () => {
    clearTimeout(typing);
    const q = input.value.trim();
    if (q.length < 2) {
      seq++;
      results = null;
      searching = false;
      renderResults();
      return;
    }
    // The previous results stay on screen (dimmed) until the new ones arrive: no blink while typing.
    if (results?.error) results = null;
    searching = true;
    renderResults();
    typing = setTimeout(() => runSearch(q), LINK.test(q) ? 0 : 260);
  };

  // ------------------------------------------------------------------ confirm

  function renderSheet() {
    const box = $('sheet');
    if (!pick) {
      box.hidden = true;
      put(box, '');
      return;
    }
    const i = pick.item;
    const price = st?.price_tokens ?? 0;
    const me = st?.me;
    const after = me?.balance === null || me?.balance === undefined ? null : me.balance - price;
    const r = st?.rules;
    box.hidden = false;
    put(box, `
      <div class="mh-sheet__card" role="dialog" aria-modal="true" aria-labelledby="mh-sheet-title">
        <div class="mh-sheet__track">${art(i.image_url, 'mh-art--lg')}
          <span><strong id="mh-sheet-title">${esc(i.title)}</strong><small>${artists(i.artists)}</small><small>${i.album ? `${esc(i.album)} · ` : ''}${dur(i.duration_ms)}</small></span>
        </div>
        <ul class="mh-rules">
          <li><span>Prix</span><b class="mh-price">◆ ${fmt(price)}</b></li>
          ${after !== null ? `<li><span>Solde après</span><b class="${after < 0 ? 'is-bad' : ''}">◆ ${fmt(after)}</b></li>` : ''}
          ${r ? `<li><span>En attente</span><b>${me ? `${me.pending}/${me.max_pending}` : r.max_pending_per_viewer}</b></li>` : ''}
          ${r?.viewer_cooldown_seconds ? `<li><span>Délai</span><b>${Math.round(r.viewer_cooldown_seconds / 60)} min entre deux</b></li>` : ''}
        </ul>
        <p class="mh-sheet__note">Retirable tant qu’elle n’a pas commencé, même pendant l’ajout : tes Jetons te sont rendus une seule fois.</p>
        ${pick.error ? `<p class="mh-sheet__err" role="alert">${esc(pick.error)}</p>` : ''}
        <div class="mh-sheet__act">
          <button type="button" class="mh-btn mh-btn--ghost" data-act="sheet-close">Annuler</button>
          <button type="button" class="mh-btn mh-btn--go" data-act="confirm" ${pick.busy ? 'disabled aria-busy="true"' : ''}>${pick.busy ? 'Envoi…' : `Demander · ◆ ${fmt(price)}`}</button>
        </div>
      </div>`);
    // Focus on « Demander » once, when the sheet opens (a reading never moves the focus again).
    if (!pick.busy && !pick.focused) {
      pick.focused = true;
      box.querySelector('[data-act="confirm"]')?.focus({ preventScroll: true });
    }
  }

  async function confirm() {
    if (!pick || pick.busy) return;
    pick.busy = true;
    pick.error = null;
    renderSheet();
    const chosen = pick;
    try {
      await client.musicRequest(chosen.key, chosen.item.id, st?.price_tokens ?? null);
      pick = null;
      toast(`« ${chosen.item.title} » est demandé : il rejoint la file.`);
      tab = 'queue';
      await poller.now();
    } catch (e) {
      // A lost answer keeps the SAME key (a retry can never pay twice); a decided refusal gets a new one.
      if (e?.code !== 'network_error') chosen.key = newIdempotencyKey();
      if (e?.code === 'price_changed' && st) st.price_tokens = e.details?.price ?? st.price_tokens;
      chosen.error = refusal(e, st);
      chosen.busy = false;
      if (e?.code !== 'network_error') void poller.now();
    }
    render();
  }

  // ------------------------------------------------------------------ queue: yours first, then everyone's

  function renderQueue() {
    const box = $('queue');
    if (!st) {
      put(box, `<p class="mh-empty">${failed ? esc(refusal(failed, st)) : 'Chargement…'}</p>`);
      return;
    }
    const c = can();
    const mineRows = (st.me?.requests ?? []).filter((r) => !withdrawing.has(r.request_id));
    const rows = [...st.queue, ...(team() ? st.pending.filter((p) => !p.own) : [])].filter((e) => !withdrawing.has(e.request_id));
    const tools = c.open_close
      ? `<button type="button" class="mh-mini" data-act="${st.open ? 'close' : 'open'}">${st.open ? 'Fermer les demandes' : 'Ouvrir les demandes'}</button>`
      : '';
    const count = rows.filter((e) => e.position).length;
    put(box, `
      ${mineRows.length ? `<p class="mh-label">Tes demandes</p><ol class="mh-list mh-list--mine">${mineRows.map(mineRow).join('')}</ol>` : ''}
      <div class="mh-head"><p class="mh-label">${count ? `${count} titre${count > 1 ? 's' : ''} en file` : 'La file est vide'}${st.open ? '' : ' · demandes fermées'}</p>${tools}</div>
      ${rows.length ? `<ol class="mh-list">${rows.map(queueRow).join('')}</ol>` : `<p class="mh-empty">${st.open ? 'Personne n’a encore demandé de titre : la prochaine peut être la tienne.' : 'Rien en attente.'}</p>`}
      ${history()}`);
  }

  function mineRow(r) {
    const q = st.queue.find((e) => e.request_id === r.request_id);
    const where = r.state === 'PLAYING' ? 'En cours' : q ? `#${q.position} · ${wait(q.eta_ms)}` : STATE_WORD[r.state] ?? '';
    return `<li class="mh-q is-own" data-id="${esc(r.request_id)}">
      ${art(r.image_url ?? q?.image_url)}
      <span class="mh-row__txt"><strong>${esc(r.title ?? 'Titre en cours d’ajout')}</strong><small>${esc(where)}${r.payment === 'tokens' ? ' · Jetons' : ' · points de chaîne'}</small></span>
      <span class="mh-row__end">${r.cancellable ? `<button type="button" class="mh-mini" data-act="withdraw" data-id="${esc(r.request_id)}">Retirer</button>` : ''}</span>
    </li>`;
  }

  function queueRow(e) {
    const c = can();
    const own = e.own ? '<span class="mh-badge mh-badge--own">Toi</span>' : '';
    const pay = team() && e.payment ? `<span class="mh-badge">${e.payment === 'tokens' ? `◆ ${fmt(e.price_tokens)}` : 'Points'}</span>` : '';
    const label = e.title ?? 'Ajout en cours…';
    return `<li class="mh-q ${e.own ? 'is-own' : ''}" data-id="${esc(e.request_id)}">
      <span class="mh-q__pos">${e.position ?? '…'}</span>
      ${art(e.image_url)}
      <span class="mh-row__txt"><strong>${esc(label)}</strong><small>${artists(e.artists)}${e.artists.length ? ' · ' : ''}par ${esc(e.requested_by)}${team() && e.viewer_login ? ` (@${esc(e.viewer_login)})` : ''}</small></span>
      <span class="mh-row__end">${own}${pay}<span class="mh-dur">${e.position ? wait(e.eta_ms) : 'ajout…'}</span>
        ${c.moderate && e.position ? `<button type="button" class="mh-mini mh-mini--icon" data-act="menu" data-id="${esc(e.request_id)}" aria-haspopup="menu" aria-expanded="${menuFor === e.request_id}" aria-label="Modérer cette demande">${DOTS}</button>` : ''}
      </span>
      ${menuFor === e.request_id ? `<span class="mh-menu" role="menu">
        ${c.refund ? `<button type="button" role="menuitem" data-act="remove-refund" data-id="${esc(e.request_id)}">Retirer + rembourser</button>` : ''}
        <button type="button" role="menuitem" class="is-danger" data-act="remove-keep" data-id="${esc(e.request_id)}">Retirer sans rembourser</button>
      </span>` : ''}
    </li>`;
  }

  function history() {
    const mine = st?.me?.history ?? [];
    const recent = st?.recent ?? [];
    if (!mine.length && !recent.length) return '';
    return `<details class="mh-recent" ${historyOpen ? 'open' : ''}><summary>Historique</summary>
      ${mine.length ? `<p class="mh-label">Tes dernières demandes</p><ul>${mine.map((r) => `<li><span>${esc(r.title ?? 'Titre non ajouté')}</span><small>${esc(ENDED[r.state] ?? r.state)}${r.refunded ? (r.payment === 'tokens' ? ' · Jetons rendus' : ' · points rendus') : ''}</small></li>`).join('')}</ul>` : ''}
      ${recent.length ? `<p class="mh-label">Passées sur le stream</p><ul>${recent.map((r) => `<li><span>${esc(r.title ?? '—')}</span><small>par ${esc(r.requested_by)}</small></li>`).join('')}</ul>` : ''}
    </details>`;
  }

  async function withdraw(id) {
    if (withdrawing.has(id)) return;
    withdrawing.add(id); // gone from the active queue at once, confirmed (or put back) by Core
    render();
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
    render();
  }

  /** A team action. A player action waits for Studio's answer: the view shows what really happened, never a guess. */
  async function moderate(command, success) {
    const player = ['pause', 'resume', 'skip', 'volume'].includes(command.action);
    if (player) { ctlBusy = command.action; renderDeck(); }
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

  // ------------------------------------------------------------------ now playing (a strip) and the supermods' deck

  function renderNow() {
    const n = st?.now_playing;
    const p = st?.player;
    const box = $('now');
    const deckBtn = can().player
      ? `<button type="button" class="mh-now__deck ${deck ? 'is-on' : ''}" data-act="deck" aria-expanded="${deck}" aria-controls="mh-deck" title="Lecteur du stream (supermods)">${SLIDERS}<span>Lecteur</span></button>`
      : '';
    let body;
    if (!st) body = '<span class="mh-now__txt"><small>Chargement…</small></span>';
    else if (!p?.connected) body = `<span class="mh-now__ic">${NOTE}</span><span class="mh-now__txt"><small>Lecteur du stream indisponible</small></span>`;
    else if (!n) body = `<span class="mh-now__ic">${NOTE}</span><span class="mh-now__txt"><small>Rien en cours</small></span>`;
    else {
      const who = n.kind === 'request' ? (n.own ? ' · ta demande' : n.requested_by ? ` · par ${esc(n.requested_by)}` : '') : '';
      body = `<span class="mh-eq ${n.is_playing ? 'is-on' : ''}" role="img" aria-label="${n.is_playing ? 'En lecture' : 'En pause'}"><i></i><i></i><i></i></span>
        <span class="mh-now__txt" title="${esc(`${n.title} — ${n.artists.join(', ')}`)}"><strong>${esc(n.title)}</strong><small>${artists(n.artists)}${who}</small></span>`;
    }
    put(box, `${body}${deckBtn}`);
  }

  function renderDeck() {
    const box = $('deck');
    if (!deck || !can().player || !st) {
      box.hidden = true;
      put(box, '');
      return;
    }
    const p = st.player;
    const on = p.controls && p.connected;
    const playing = st.now_playing?.is_playing ?? p.is_playing;
    const busy = (a) => (ctlBusy === a ? 'aria-busy="true"' : '');
    const off = !on || !!ctlBusy;
    const why = !p.connected ? 'Lecteur indisponible (Studio, Spotify fermé ou aucun appareil).' : !p.controls ? 'Commandes du lecteur désactivées dans Studio.' : ctlBusy ? 'En attente de la réponse du lecteur…' : '';
    box.hidden = false;
    put(box, `
      <div class="mh-deck__head"><strong>Lecteur du stream</strong><small>Supermods · le streamer garde la main</small><button type="button" class="mh-mini mh-mini--icon" data-act="deck" aria-label="Fermer le lecteur">${CLEAR}</button></div>
      <p class="mh-deck__state">${p.connected ? `${esc(p.device ?? 'Appareil')} · ${playing ? 'en lecture' : 'en pause'}${p.volume_percent !== null && p.volume_percent !== undefined ? ` · vol. ${p.volume_percent}` : ''}` : 'Indisponible'}</p>
      <div class="mh-ctl" role="group" aria-label="Lecteur du stream">
        <button type="button" class="mh-ctl__b" data-act="${playing ? 'pause' : 'resume'}" ${off ? 'disabled' : ''} ${busy(playing ? 'pause' : 'resume')}>${playing ? `${PAUSE}Pause` : `${PLAY}Reprendre`}</button>
        <button type="button" class="mh-ctl__b" data-act="skip" ${off || !st.now_playing ? 'disabled' : ''} ${busy('skip')}>${NEXT}Passer</button>
        <label class="mh-vol"><span>Vol.</span><input type="range" min="0" max="100" step="5" value="${p.volume_percent ?? 50}" data-act="volume" ${off ? 'disabled' : ''} aria-label="Volume du lecteur"></label>
      </div>
      ${why ? `<p class="mh-deck__why">${esc(why)}</p>` : ''}`);
  }

  // ------------------------------------------------------------------ frame

  function render() {
    if (destroyed) return;
    for (const b of node.querySelectorAll('.mh-tab')) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
      if (b.dataset.tab === 'queue') b.dataset.count = st?.queue.length ? String(st.queue.length) : '';
    }
    for (const p of node.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== tab;
    input.disabled = !!st && !st.open;
    renderMeta();
    if (tab === 'search') renderResults();
    if (tab === 'queue') renderQueue();
    renderNow();
    renderDeck();
    renderSheet();
  }

  // ------------------------------------------------------------------ events

  function closeSheet() {
    const from = pick?.from;
    pick = null;
    renderSheet();
    (node.querySelector(`[data-pick="${from}"]`) ?? input).focus({ preventScroll: true });
  }

  const onClick = (event) => {
    const t = event.target.closest?.('[data-tab],[data-act],[data-pick],[data-idea]');
    if (!t || !node.contains(t)) return;
    if (t.dataset.tab) {
      tab = t.dataset.tab;
      menuFor = null;
      render();
      return;
    }
    if (t.dataset.idea !== undefined) {
      input.value = t.dataset.idea;
      onInput();
      input.focus({ preventScroll: true });
      return;
    }
    if (t.dataset.pick !== undefined) {
      if (t.getAttribute('aria-disabled') === 'true') return;
      const item = results?.items?.[Number(t.dataset.pick)];
      if (item) {
        pick = { item, key: newIdempotencyKey(), busy: false, error: null, from: t.dataset.pick };
        renderSheet();
      }
      return;
    }
    const a = t.dataset.act;
    const id = t.dataset.id;
    if (a === 'sheet-close') closeSheet();
    else if (a === 'confirm') void confirm();
    else if (a === 'clear') { input.value = ''; onInput(); input.focus({ preventScroll: true }); }
    else if (a === 'retry') {
      const q = input.value.trim();
      if (q.length >= 2) { results = null; void runSearch(q); }
    } else if (a === 'withdraw') void withdraw(id);
    else if (a === 'menu') { menuFor = menuFor === id ? null : id; render(); }
    else if (a === 'deck') { deck = !deck; render(); }
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
    if (event.key === 'Escape' && (pick || deck || menuFor)) {
      event.stopPropagation();
      if (pick) closeSheet();
      else { deck = false; menuFor = null; render(); }
      return;
    }
    if (event.key === 'Enter' && event.target === input) {
      // Enter in the field: search now (no wait for the typing pause).
      clearTimeout(typing);
      const q = input.value.trim();
      if (q.length >= 2) void runSearch(q);
      event.preventDefault();
      return;
    }
    // Results: arrows move between them, from the search field too.
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && tab === 'search' && !pick) {
      const rows = [...node.querySelectorAll('[data-pick],[data-idea]')];
      if (!rows.length) return;
      const at = rows.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : at <= 0 ? -1 : at - 1;
      event.preventDefault();
      (next < 0 ? input : rows[next]).focus();
    }
  };
  const onToggle = (event) => {
    if (event.target.classList?.contains('mh-recent')) historyOpen = event.target.open;
  };
  input.addEventListener('input', onInput);
  node.addEventListener('toggle', onToggle, true); // « toggle » does not bubble: captured
  node.addEventListener('click', onClick);
  node.addEventListener('change', onChange);
  node.addEventListener('keydown', onKey);

  render();
  return {
    node,
    start() {
      void poller.now();
      ticking = everySecond(tick);
    },
    /** A session refresh (open / closed, queue size): re-read the module's own state, absorbed (no host redraw). */
    onState() {
      void poller.now();
      return true;
    },
    destroy() {
      destroyed = true;
      seq++;
      poller.stop();
      ticking?.();
      clearTimeout(typing);
      clearTimeout(toastTimer);
      input.removeEventListener('input', onInput);
      node.removeEventListener('toggle', onToggle, true);
      node.removeEventListener('click', onClick);
      node.removeEventListener('change', onChange);
      node.removeEventListener('keydown', onKey);
    },
  };
}
