// Music Hub (docs/music/MUSIC_HUB_STATE.md) — the view of the extension's music module (shell v2, loaded on opening).
// Rechercher → choisir → confirmer, the queue with its estimated wait, the viewer's own requests (withdrawn at once,
// confirmed by Core), and for the team the moderation of the queue and the player. The view decides nothing: prices,
// limits, refusals, refunds and the player's state are Core's (and Studio's), shown as they are — never assumed.
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
const NOTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17.5V6.5l10-2v11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="6.6" cy="17.6" r="2.6" fill="currentColor"/><circle cx="16.6" cy="15.6" r="2.6" fill="currentColor"/></svg>';
const LENS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

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
    case 'price_changed': return `Le prix a changé : ${fmt(d.price ?? st?.price_tokens)} Jetons. Confirme à nouveau.`;
    case 'insufficient_tokens': return `Il te manque ${fmt(Math.max(0, (d.needed ?? 0) - (d.balance ?? 0)))} Jetons.`;
    case 'search_rate_limited': return 'Trop de recherches d’un coup : patiente quelques secondes.';
    case 'forbidden': return 'Action réservée à l’équipe (permission manquante).';
    case 'player_controls_disabled': return 'Les commandes du lecteur sont désactivées dans Studio.';
    case 'playing_use_skip': return 'Ce titre joue déjà : utilise « Passer ».';
    case 'not_removable': return 'Cette demande n’est plus dans la file.';
    case 'identity_required': return 'Partage ton identité Twitch pour demander une musique.';
    case 'network_error': return 'Connexion perdue. Réessaie : ta demande ne sera jamais payée deux fois.';
    default: return 'Action impossible pour le moment.';
  }
}

export function view(ctx) {
  const { document, client } = ctx;
  const team = !!ctx.team;
  const node = document.createElement('div');
  node.className = 'mh';
  node.innerHTML = `
    <section class="mh-now" data-k="now"></section>
    <div class="mh-tabs" role="tablist" aria-label="Musique">
      <button type="button" role="tab" class="mh-tab" data-tab="search">Rechercher</button>
      <button type="button" role="tab" class="mh-tab" data-tab="queue">File</button>
      <button type="button" role="tab" class="mh-tab" data-tab="mine">Mes demandes</button>
    </div>
    <section class="mh-panel" data-panel="search">
      <label class="mh-search">${LENS}<input type="search" data-draft-key="music-search" placeholder="Titre ou artiste" autocomplete="off" spellcheck="false" aria-label="Rechercher un titre ou un artiste"></label>
      <div class="mh-results" data-k="results" role="listbox" aria-label="Résultats"></div>
    </section>
    <section class="mh-panel" data-panel="queue" hidden><div data-k="queue"></div></section>
    <section class="mh-panel" data-panel="mine" hidden><div data-k="mine"></div></section>
    <div class="mh-sheet" data-k="sheet" hidden></div>
    <p class="mh-toast" data-k="toast" role="status" aria-live="polite"></p>
    <p class="mh-foot" data-k="foot"></p>`;
  const $ = (k) => node.querySelector(`[data-k="${k}"]`);
  const input = node.querySelector('input[type="search"]');

  let st = null; // Core's music state
  let failed = null;
  let tab = 'search';
  let results = null; // { items, provider } | { error } | null
  let searching = false;
  let seq = 0;
  let typing = null;
  let pick = null; // { item, key, busy, error }
  let menuFor = null; // team menu open on this request id
  const withdrawing = new Set();
  let toastTimer = null;
  let ticking = null;
  let destroyed = false;

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
        st.readAt = Date.now(); // progress and cooldown move from this reading, never beyond it
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

  // ------------------------------------------------------------------ now playing

  function renderNow() {
    const n = st?.now_playing;
    const p = st?.player;
    const box = $('now');
    if (!p?.connected) {
      box.innerHTML = `<div class="mh-now__off">${NOTE}<span><strong>Lecteur indisponible</strong><small>${st ? 'Le lecteur du stream ne répond pas : rien n’est affiché comme en cours.' : 'Chargement…'}</small></span></div>`;
      return;
    }
    if (!n) {
      box.innerHTML = `<div class="mh-now__off">${NOTE}<span><strong>Rien en cours</strong><small>${esc(p.device ?? '')}</small></span></div>${controls()}`;
      return;
    }
    const who = n.kind === 'request'
      ? `<span class="mh-badge mh-badge--req">${n.own ? 'Ta demande' : `Demandé par ${esc(n.requested_by)}`}</span>`
      : '<span class="mh-badge">Musique du stream</span>';
    box.innerHTML = `
      <div class="mh-now__main">
        ${art(n.image_url, 'mh-art--now')}
        <div class="mh-now__txt">
          <strong title="${esc(n.title)}">${esc(n.title)}</strong>
          <small title="${esc(n.artists.join(', '))}">${esc(n.artists.join(', '))}</small>
          ${who}
        </div>
        <span class="mh-eq ${n.is_playing ? 'is-on' : ''}" aria-label="${n.is_playing ? 'En lecture' : 'En pause'}"><i></i><i></i><i></i></span>
      </div>
      <div class="mh-bar"><span data-k="bar" style="--p:0"></span></div>
      <div class="mh-times"><span data-k="pos">${dur(n.progress_ms)}</span><span>${dur(n.duration_ms)}</span></div>
      ${controls()}`;
    tick();
  }

  function controls() {
    if (!team || !st) return '';
    const p = st.player;
    const playing = st.now_playing?.is_playing ?? p.is_playing;
    const on = p.controls;
    return `<div class="mh-ctl" aria-label="Lecteur (équipe)">
      <button type="button" class="mh-ctl__b" data-act="${playing ? 'pause' : 'resume'}" ${on ? '' : 'disabled'} title="${on ? '' : 'Commandes du lecteur désactivées dans Studio'}">${playing ? '❚❚ Pause' : '▶ Reprendre'}</button>
      <button type="button" class="mh-ctl__b" data-act="skip" ${st.now_playing ? '' : 'disabled'}>⏭ Passer</button>
      <label class="mh-vol" title="${on ? 'Volume du lecteur' : 'Commandes du lecteur désactivées dans Studio'}"><span>Vol.</span><input type="range" min="0" max="100" step="5" value="${p.volume_percent ?? 50}" data-act="volume" ${on ? '' : 'disabled'} aria-label="Volume du lecteur"><b data-k="vol">${p.volume_percent ?? '—'}</b></label>
      <button type="button" class="mh-ctl__b mh-ctl__b--ghost" data-act="${st.open ? 'close' : 'open'}">${st.open ? 'Fermer les demandes' : 'Ouvrir les demandes'}</button>
    </div>`;
  }

  const art = (url, cls = '') => url
    ? `<img class="mh-art ${cls}" src="${esc(url)}" alt="" loading="lazy" decoding="async">`
    : `<span class="mh-art mh-art--none ${cls}" aria-hidden="true">${NOTE}</span>`;

  /** The progress bar and the cooldown, from Core's last reading (never beyond the track's end). */
  function tick() {
    const n = st?.now_playing;
    const bar = $('bar');
    if (n && bar && n.progress_ms !== null && st.readAt) {
      const pos = Math.min(n.duration_ms, n.progress_ms + (n.is_playing ? Date.now() - st.readAt : 0));
      bar.style.setProperty('--p', String(n.duration_ms ? pos / n.duration_ms : 0));
      const t = $('pos');
      if (t) t.textContent = dur(pos);
    }
    const cd = node.querySelector('[data-k="cooldown"]');
    if (cd && st?.me) {
      const left = Math.max(0, st.me.cooldown_left_ms - (Date.now() - st.readAt));
      cd.textContent = left > 0 ? `Prochaine demande dans ${dur(left)}` : '';
    }
  }

  // ------------------------------------------------------------------ search

  function queuedIds() {
    return new Set([...(st?.queue ?? []), ...(st?.pending ?? [])].map((e) => e.track_id));
  }

  function renderResults() {
    const box = $('results');
    const q = input.value.trim();
    if (st && !st.open) {
      box.innerHTML = '<p class="mh-empty">Les demandes sont fermées pour le moment. Tu peux quand même voir la file.</p>';
      return;
    }
    if (q.length < 2) {
      box.innerHTML = '<p class="mh-empty">Tape au moins deux lettres : un titre, un artiste, ou les deux.</p>';
      return;
    }
    if (searching && !results) {
      box.innerHTML = '<p class="mh-empty mh-empty--busy" aria-busy="true">Recherche…</p>';
      return;
    }
    if (!results) return;
    if (results.error) {
      box.innerHTML = `<p class="mh-empty mh-empty--err">${esc(results.error === 'unavailable' ? 'Le catalogue est indisponible pour le moment.' : refusal({ code: results.error }, st))}</p>`;
      return;
    }
    if (!results.items.length) {
      box.innerHTML = `<p class="mh-empty">Aucun titre pour « ${esc(q)} ».</p>`;
      return;
    }
    const waiting = queuedIds();
    box.innerHTML = results.items.map((i, n) => {
      const flag = !i.playable ? 'Indisponible' : i.too_long ? 'Trop long' : waiting.has(i.id) ? 'Déjà en file' : '';
      return `<button type="button" class="mh-row ${flag ? 'is-off' : ''}" role="option" data-pick="${n}" ${flag ? 'aria-disabled="true"' : ''}>
        ${art(i.image_url)}
        <span class="mh-row__txt"><strong title="${esc(i.title)}">${esc(i.title)}</strong><small title="${esc(`${i.artists.join(', ')}${i.album ? ` · ${i.album}` : ''}`)}">${esc(i.artists.join(', '))}${i.album ? ` · ${esc(i.album)}` : ''}</small></span>
        <span class="mh-row__end">${flag ? `<em class="mh-flag">${flag}</em>` : ''}<span class="mh-dur">${dur(i.duration_ms)}</span></span>
      </button>`;
    }).join('');
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
      results = r.status === 'done' ? { items: r.items, provider: r.provider } : { error: 'unavailable' };
    } catch (e) {
      if (mine !== seq || destroyed) return;
      results = { error: e?.code ?? 'unavailable' };
    }
    searching = false;
    renderResults();
    renderFoot();
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
    typing = setTimeout(() => runSearch(q), 280);
  };

  // ------------------------------------------------------------------ confirm

  function renderSheet() {
    const box = $('sheet');
    if (!pick) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const i = pick.item;
    const price = st?.price_tokens ?? 0;
    const me = st?.me;
    const after = me?.balance === null || me?.balance === undefined ? null : me.balance - price;
    const r = st?.rules;
    box.hidden = false;
    box.innerHTML = `
      <div class="mh-sheet__card" role="dialog" aria-modal="false" aria-label="Confirmer la demande">
        <div class="mh-sheet__track">${art(i.image_url, 'mh-art--lg')}
          <span><strong>${esc(i.title)}</strong><small>${esc(i.artists.join(', '))}${i.album ? ` · ${esc(i.album)}` : ''} · ${dur(i.duration_ms)}</small></span>
        </div>
        <ul class="mh-rules">
          <li><span>Prix</span><b class="mh-price">◆ ${fmt(price)}</b></li>
          ${after !== null ? `<li><span>Solde après</span><b class="${after < 0 ? 'is-bad' : ''}">◆ ${fmt(after)}</b></li>` : ''}
          ${r ? `<li><span>Limite</span><b>${me ? `${me.pending}/${me.max_pending}` : r.max_pending_per_viewer} en attente</b></li>` : ''}
          ${r?.viewer_cooldown_seconds ? `<li><span>Délai</span><b>${Math.round(r.viewer_cooldown_seconds / 60)} min entre deux</b></li>` : ''}
        </ul>
        <p class="mh-sheet__note">Retirable tant qu’elle n’a pas commencé : tes Jetons te sont rendus.</p>
        ${pick.error ? `<p class="mh-sheet__err" role="alert">${esc(pick.error)}</p>` : ''}
        <div class="mh-sheet__act">
          <button type="button" class="mh-btn mh-btn--ghost" data-act="sheet-close">Annuler</button>
          <button type="button" class="mh-btn mh-btn--go" data-act="confirm" ${pick.busy ? 'disabled aria-busy="true"' : ''}>${pick.busy ? 'Envoi…' : `Demander · ◆ ${fmt(price)}`}</button>
        </div>
      </div>`;
    if (!pick.busy) box.querySelector('[data-act="confirm"]')?.focus({ preventScroll: true });
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
      tab = 'mine';
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

  // ------------------------------------------------------------------ queue & mine

  function renderQueue() {
    const box = $('queue');
    if (!st) {
      box.innerHTML = `<p class="mh-empty">${failed ? esc(refusal(failed, st)) : 'Chargement…'}</p>`;
      return;
    }
    const rows = [...st.queue, ...(team ? st.pending : [])];
    const head = `<p class="mh-sub">${st.queue.length ? `${st.queue.length} titre${st.queue.length > 1 ? 's' : ''} en file` : 'La file est vide.'}${st.open ? '' : ' · <b>demandes fermées</b>'}</p>`;
    box.innerHTML = head + (rows.length ? `<ol class="mh-list">${rows.map(queueRow).join('')}</ol>` : '') + recent();
  }

  function queueRow(e) {
    const gone = withdrawing.has(e.request_id);
    const own = e.own ? '<span class="mh-badge mh-badge--own">Toi</span>' : '';
    const pay = team && e.payment ? `<span class="mh-badge">${e.payment === 'tokens' ? `◆ ${fmt(e.price_tokens)}` : 'Points'}</span>` : '';
    const label = e.title ?? 'Ajout en cours…';
    const mine = st.me?.requests.find((r) => r.request_id === e.request_id);
    const canWithdraw = e.own && mine?.cancellable && e.state !== 'RECEIVED' && e.state !== 'SEARCHING';
    return `<li class="mh-q ${gone ? 'is-gone' : ''} ${e.own ? 'is-own' : ''}" data-id="${esc(e.request_id)}">
      <span class="mh-q__pos">${e.position ?? '…'}</span>
      ${art(e.image_url)}
      <span class="mh-row__txt"><strong title="${esc(label)}">${esc(label)}</strong><small>${esc(e.artists.join(', '))}${e.artists.length ? ' · ' : ''}${esc(e.requested_by)}${team && e.viewer_login ? ` (@${esc(e.viewer_login)})` : ''}</small></span>
      <span class="mh-row__end">${own}${pay}<span class="mh-dur">${gone ? 'Retrait…' : e.position ? wait(e.eta_ms) : 'ajout…'}</span>
        ${canWithdraw && !gone ? `<button type="button" class="mh-mini" data-act="withdraw" data-id="${esc(e.request_id)}">Retirer</button>` : ''}
        ${team && e.position ? `<button type="button" class="mh-mini mh-mini--icon" data-act="menu" data-id="${esc(e.request_id)}" aria-haspopup="menu" aria-expanded="${menuFor === e.request_id}" aria-label="Modérer cette demande"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.6" fill="currentColor"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><circle cx="13" cy="8" r="1.6" fill="currentColor"/></svg></button>` : ''}
      </span>
      ${menuFor === e.request_id ? `<span class="mh-menu" role="menu">
        <button type="button" role="menuitem" data-act="remove-refund" data-id="${esc(e.request_id)}">Retirer + rembourser</button>
        <button type="button" role="menuitem" class="is-danger" data-act="remove-keep" data-id="${esc(e.request_id)}">Retirer sans rembourser</button>
      </span>` : ''}
    </li>`;
  }

  function recent() {
    if (!st?.recent?.length) return '';
    return `<details class="mh-recent"><summary>Dernières musiques</summary><ul>${st.recent.map((r) => `<li>${esc(r.title ?? '—')} <small>· ${esc(r.requested_by)}</small></li>`).join('')}</ul></details>`;
  }

  function renderMine() {
    const box = $('mine');
    const me = st?.me;
    if (!st) {
      box.innerHTML = '<p class="mh-empty">Chargement…</p>';
      return;
    }
    if (!me) {
      box.innerHTML = `<p class="mh-empty">${esc(refusal({ code: 'identity_required' }, st))}</p>`;
      return;
    }
    const list = me.requests.map((r) => {
      const gone = withdrawing.has(r.request_id);
      const q = st.queue.find((e) => e.request_id === r.request_id);
      const where = r.state === 'PLAYING' ? 'En cours' : q ? `#${q.position} · ${wait(q.eta_ms)}` : 'Ajout en cours…';
      return `<li class="mh-q is-own ${gone ? 'is-gone' : ''}">
        <span class="mh-row__txt"><strong>${esc(r.title ?? 'Ajout en cours…')}</strong><small>${gone ? 'Retrait…' : where}${r.payment === 'tokens' ? ' · payée en Jetons' : ' · points de chaîne'}</small></span>
        <span class="mh-row__end">${r.cancellable && q && !gone ? `<button type="button" class="mh-mini" data-act="withdraw" data-id="${esc(r.request_id)}">Retirer</button>` : ''}</span>
      </li>`;
    }).join('');
    box.innerHTML = `
      <div class="mh-me">
        <span><small>Mes demandes</small><b>${me.pending}/${me.max_pending}</b></span>
        <span><small>Solde</small><b>${me.balance === null ? '—' : `◆ ${fmt(me.balance)}`}</b></span>
        <span><small>Prix</small><b>◆ ${fmt(st.price_tokens)}</b></span>
      </div>
      <p class="mh-sub" data-k="cooldown"></p>
      ${list ? `<ol class="mh-list">${list}</ol>` : '<p class="mh-empty">Aucune demande en attente. Va dans « Rechercher » pour choisir un titre.</p>'}`;
    tick();
  }

  async function withdraw(id) {
    if (withdrawing.has(id)) return;
    withdrawing.add(id); // shown at once, confirmed (or undone) by Core
    render();
    try {
      const r = await client.musicCancel(id);
      if (r.outcome === 'songcancel' || r.outcome === 'songcancel_current')
        toast(r.request?.payment === 'tokens' ? 'Demande retirée : tes Jetons te sont rendus.' : 'Demande retirée.');
      else toast(r.outcome === 'songcancel_too_late' ? 'Trop tard : ce titre a déjà commencé.' : 'Cette demande n’est plus dans la file.', 'warn');
    } catch (e) {
      toast(refusal(e, st), 'err');
    }
    withdrawing.delete(id);
    await poller.now();
  }

  async function moderate(command, success) {
    try {
      const r = await client.musicModerate(command);
      if (r.job_id) {
        // A player control: show what really happened (the player's answer), never an assumed success.
        let out = { status: 'pending' };
        for (let n = 0; n < 16 && out.status === 'pending' && !destroyed; n++) {
          await sleep(350);
          out = await client.musicControl(r.job_id);
        }
        toast(out.status === 'done' ? success : out.status === 'pending' ? 'Le lecteur n’a pas encore répondu.' : 'Le lecteur n’a pas confirmé l’action.', out.status === 'done' ? 'ok' : 'warn');
      } else toast(success);
    } catch (e) {
      toast(refusal(e, st), 'err');
    }
    menuFor = null;
    await poller.now();
  }

  // ------------------------------------------------------------------ frame

  function renderFoot() {
    const provider = results?.provider ?? null;
    $('foot').textContent = provider === 'spotify'
      ? 'Catalogue : compte musical connecté au Studio · paiement en Jetons, jamais en argent.'
      : 'Catalogue de démonstration (Lab) · paiement en Jetons fictifs du Lab.';
  }

  function render() {
    if (destroyed) return;
    for (const b of node.querySelectorAll('[data-tab]')) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
      const n = b.dataset.tab === 'queue' ? st?.queue.length : b.dataset.tab === 'mine' ? st?.me?.pending : null;
      b.dataset.count = n ? String(n) : '';
    }
    for (const p of node.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== tab;
    input.disabled = !!st && !st.open;
    renderNow();
    if (tab === 'search') renderResults();
    if (tab === 'queue') renderQueue();
    if (tab === 'mine') renderMine();
    renderSheet();
    renderFoot();
  }

  // ------------------------------------------------------------------ events

  const onClick = (event) => {
    const t = event.target.closest?.('[data-tab],[data-act],[data-pick]');
    if (!t || !node.contains(t)) return;
    if (t.dataset.tab) {
      tab = t.dataset.tab;
      menuFor = null;
      render();
      return;
    }
    if (t.dataset.pick !== undefined) {
      if (t.getAttribute('aria-disabled') === 'true') return;
      const item = results?.items?.[Number(t.dataset.pick)];
      if (item) {
        pick = { item, key: newIdempotencyKey(), busy: false, error: null };
        renderSheet();
      }
      return;
    }
    const a = t.dataset.act;
    const id = t.dataset.id;
    if (a === 'sheet-close') { pick = null; renderSheet(); input.focus({ preventScroll: true }); }
    else if (a === 'confirm') void confirm();
    else if (a === 'withdraw') void withdraw(id);
    else if (a === 'menu') { menuFor = menuFor === id ? null : id; render(); }
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
    if (event.key === 'Escape' && pick) {
      event.stopPropagation();
      pick = null;
      renderSheet();
      input.focus({ preventScroll: true });
      return;
    }
    // Results: arrows move between them, from the search field too.
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && tab === 'search') {
      const rows = [...node.querySelectorAll('[data-pick]')];
      if (!rows.length) return;
      const at = rows.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : at <= 0 ? -1 : at - 1;
      event.preventDefault();
      (next < 0 ? input : rows[next]).focus();
    }
  };
  input.addEventListener('input', onInput);
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
      node.removeEventListener('click', onClick);
      node.removeEventListener('change', onChange);
      node.removeEventListener('keydown', onKey);
    },
  };
}
