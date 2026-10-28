// Halloween shop (docs/HALLOWEEN.md) — « Halloween » in the Hub: the viewer's Bonbons, the capped Jetons → Bonbons
// exchange, and the effects that play on Raptoru's own screen (screamers, apparitions, drawn effects). Everything is
// Core's projection for the JWT's viewer: prices, limits, cooldowns, balance. A purchase is two taps (« Acheter » then
// « Confirmer ») and one Idempotency-Key per tap (a network retry never buys twice). Nothing is decided here.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const REFRESH_MS = 5000;
const CONFIRM_MS = 3500;
const nf = (n) => Number(n || 0).toLocaleString('fr-FR').replace(/\s/g, ' ');

export const REASONS = {
  insufficient_bonbons: 'Pas assez de Bonbons.',
  busy: 'Un effet est déjà en cours… retente dans un instant.',
  viewer_cooldown: 'Tu viens d’acheter : patiente un peu.',
  item_cooldown: 'Cet effet récupère…',
  screamer_cooldown: 'Laisse-le respirer entre deux screamers…',
  screamer_quota: 'Assez de screamers pour cette heure.',
  screamers_closed: 'Les screamers sont fermés.',
  engine_offline: 'Raptoru n’est pas prêt à avoir peur (overlay hors ligne).',
  media_missing: 'Indisponible pour le moment.',
  event_closed: 'La boutique Halloween est fermée.',
  item_disabled: 'Cet effet n’est plus disponible.',
  item_not_found: 'Cet effet n’existe plus.',
  conversion_cap: 'Limite d’échange atteinte pour cette heure.',
  conversion_closed: 'L’échange de Jetons est fermé.',
  insufficient_tokens: 'Pas assez de Jetons.',
  identity_required: 'Partage ton identité Twitch avec l’extension pour acheter.',
  idempotency_conflict: 'Action déjà envoyée.',
};
const reasonOf = (e) => REASONS[e?.code ?? e?.message] ?? 'Indisponible pour le moment.';

const KINDS = [
  { id: 'all', label: 'Tout' },
  { id: 'effect', label: 'Effets' },
  { id: 'apparition', label: 'Apparitions' },
  { id: 'screamer', label: 'Screamers' },
];
const KIND_LABEL = { effect: 'Effet', apparition: 'Apparition', screamer: 'Screamer' };
const STATUS = {
  queued: 'en route…',
  executing: 'à l’écran !',
  completed: 'joué',
  failed: 'non joué',
  unknown: 'joué ?',
};

/** « 2:05 » / « 45 s ». */
export function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
}

/** What a card says about its availability now (pure, tested). */
export function availability(item, elapsedMs = 0) {
  if (item.available) return { ok: true, text: '' };
  const left = Math.max(0, (item.retry_after_ms ?? 0) - elapsedMs);
  if (['item_cooldown', 'viewer_cooldown', 'screamer_cooldown', 'screamer_quota'].includes(item.reason) && left > 0)
    return { ok: false, text: clock(left), wait: true };
  if (item.reason === 'busy') return { ok: false, text: 'Occupé' };
  if (item.reason === 'engine_offline') return { ok: false, text: 'Hors ligne' };
  if (left <= 0 && item.reason && item.reason.endsWith('cooldown')) return { ok: true, text: '' };
  return { ok: false, text: 'Indisponible' };
}

/** The shop's HTML (pure, tested). `ui`: { filter, confirming, converting, notice, elapsedMs, convertN }. */
export function shopHtml(s, ui = {}) {
  if (!s) return '<div class="evs-empty">Chargement de la boutique…</div>';
  if (!s.enabled) return '<div class="evs-empty">🎃 La boutique Halloween est fermée pour le moment.</div>';
  const elapsed = ui.elapsedMs ?? 0;
  const filter = ui.filter ?? 'all';
  const items = (s.items ?? []).filter((i) => filter === 'all' || i.kind === filter);
  const conv = s.conversion ?? {};
  const n = Math.max(1, Math.min(ui.convertN ?? 1, Math.max(1, conv.remaining ?? 1)));
  const balance = s.balance;
  const earn = s.earn ?? {};
  const cards = items
    .map((i) => {
      const a = availability(i, elapsed);
      const confirming = ui.confirming === i.item_id;
      const poor = balance !== null && balance < i.price;
      const disabled = !a.ok || poor || balance === null;
      return `<article class="evs-card k-${esc(i.kind)}${a.ok ? '' : ' is-off'}">
        <div class="evs-thumb"><img src="${esc(i.thumb)}" alt="" loading="lazy">
          <span class="evs-kind">${esc(KIND_LABEL[i.kind] ?? i.kind)}</span>
          ${a.text ? `<span class="evs-state${a.wait ? ' is-wait' : ''}">${esc(a.text)}</span>` : ''}</div>
        <div class="evs-meta"><strong title="${esc(i.description)}">${esc(i.label)}</strong>
          <button type="button" class="evs-buy${confirming ? ' is-confirm' : ''}" data-buy="${esc(i.item_id)}"${disabled ? ' disabled' : ''}
            aria-label="${confirming ? `Confirmer l’achat de ${esc(i.label)}` : `Acheter ${esc(i.label)} pour ${i.price} Bonbons`}">
            ${confirming ? 'Confirmer ?' : `${nf(i.price)} 🍬`}</button></div>
      </article>`;
    })
    .join('');
  const recent = (s.recent ?? [])
    .slice(0, 4)
    .map(
      (p) =>
        `<li><span>${esc(p.label)}</span><em class="st-${esc(p.status)}">${esc(STATUS[p.status] ?? p.status)}${p.refund_status === 'refunded' ? ' · remboursé' : ''}</em></li>`,
    )
    .join('');
  return `<div class="evs-top">
      <div class="evs-balance" aria-label="Ton solde de Bonbons">
        <span class="evs-candy" aria-hidden="true">🍬</span>
        <span><b>${balance === null ? '—' : nf(balance)}</b> Bonbons</span>
      </div>
      <p class="evs-earn">Gagne des Bonbons : sub ${nf(earn.sub_reward)} · par sub offert ${nf(earn.gift_giver_per_sub)} · sub reçu ${nf(earn.gift_recipient)}</p>
      ${s.engine_ready ? '' : '<p class="evs-warn">👻 Raptoru n’est pas prêt à avoir peur : les achats reviennent dès que son écran est prêt.</p>'}
    </div>
    ${
      conv.cap_per_hour > 0 && balance !== null
        ? `<div class="evs-convert">
        <div><b>Échanger des Jetons</b><small>${conv.remaining > 0 ? `encore ${nf(conv.remaining)} / ${nf(conv.cap_per_hour)} cette heure` : 'limite atteinte pour cette heure'}</small></div>
        <div class="evs-stepper">
          <button type="button" data-step="-1" aria-label="Moins"${n <= 1 ? ' disabled' : ''}>−</button>
          <output>${n} 🍬</output>
          <button type="button" data-step="1" aria-label="Plus"${n >= (conv.remaining ?? 0) ? ' disabled' : ''}>+</button>
        </div>
        <button type="button" class="evs-exchange" data-convert="${n}"${conv.remaining > 0 && !ui.converting ? '' : ' disabled'}>
          ${nf(n * conv.rate)} Jetons → ${n} 🍬</button>
      </div>`
        : ''
    }
    <nav class="evs-filters" aria-label="Filtrer">${KINDS.map(
      (k) => `<button type="button" data-filter="${k.id}" class="${k.id === filter ? 'is-on' : ''}">${k.label}</button>`,
    ).join('')}</nav>
    ${ui.notice ? `<p class="evs-notice${ui.notice.bad ? ' is-bad' : ''}" role="status">${esc(ui.notice.text)}</p>` : ''}
    <div class="evs-grid">${cards || '<div class="evs-empty">Rien ici pour le moment.</div>'}</div>
    ${recent ? `<section class="evs-recent"><h4>Tes derniers achats</h4><ul>${recent}</ul></section>` : ''}`;
}

export function createEventShopView({ document, client, onState }) {
  const node = document.createElement('div');
  node.className = 'evs';
  let state = null;
  let loadedAt = 0;
  let filter = 'all';
  let confirming = null;
  let confirmTimer = null;
  let converting = false;
  let convertN = 1;
  let notice = null;
  let noticeTimer = null;
  let timer = null;
  let ticker = null;
  let busy = false;

  const render = () => {
    node.innerHTML = shopHtml(state, {
      filter,
      confirming,
      converting,
      notice,
      convertN,
      elapsedMs: Date.now() - loadedAt,
    });
  };
  const say = (text, bad = false) => {
    notice = { text, bad };
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice = null;
      render();
    }, 5000);
    render();
  };
  const take = (s) => {
    if (!s || typeof s !== 'object') return;
    state = s;
    loadedAt = Date.now();
    onState?.(s);
  };
  async function load() {
    try {
      take(await client.eventsState());
    } catch {
      /* keep the last state; the next refresh retries */
    }
    render();
  }

  node.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t || t.disabled || busy) return;
    if (t.dataset.filter) {
      filter = t.dataset.filter;
      return render();
    }
    if (t.dataset.step) {
      convertN = Math.max(1, convertN + Number(t.dataset.step));
      return render();
    }
    if (t.dataset.convert) {
      busy = true;
      converting = true;
      render();
      try {
        const out = await client.eventsConvert(Number(t.dataset.convert));
        take(out?.event_shop);
        convertN = 1;
        say(`+${out?.bonbons ?? t.dataset.convert} 🍬 — bon appétit !`);
      } catch (e) {
        say(reasonOf(e), true);
      } finally {
        busy = false;
        converting = false;
        render();
      }
      return;
    }
    const id = t.dataset.buy;
    if (!id) return;
    if (confirming !== id) {
      confirming = id;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => {
        confirming = null;
        render();
      }, CONFIRM_MS);
      return render();
    }
    confirming = null;
    clearTimeout(confirmTimer);
    busy = true;
    try {
      const out = await client.eventsBuy(id);
      take(out?.event_shop);
      say('Envoyé ! Surveille l’écran de Raptoru… 👀');
    } catch (e) {
      say(reasonOf(e), true);
      void load();
    } finally {
      busy = false;
      render();
    }
  });

  return {
    node,
    start() {
      render();
      void load();
      timer = setInterval(() => void load(), REFRESH_MS);
      // Countdowns move every second without a request.
      ticker = setInterval(() => {
        if (state?.items?.some((i) => !i.available && i.retry_after_ms)) render();
      }, 1000);
    },
    attached() {},
    destroy() {
      clearInterval(timer);
      clearInterval(ticker);
      clearTimeout(confirmTimer);
      clearTimeout(noticeTimer);
    },
  };
}
