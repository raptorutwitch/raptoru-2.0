// « Événements » in the Hub (docs/HALLOWEEN.md) — the edition of the moment (Halloween 2026): its interactions, played
// on Raptoru's own screen, and its currency, the Bonbons. Everything is Core's projection for the JWT's viewer: names,
// thumbnails, descriptions, prices, categories, limits, cooldowns, the overlay's state, the ways to earn, the exchange
// rate and its hourly cap. A purchase is two taps (« price » then « Confirmer ? ») with one Idempotency-Key each (a
// network retry never buys twice). Nothing is decided here.

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const REFRESH_MS = 5000;
const CONFIRM_MS = 3500;
const nf = (n) =>
  Number(n || 0)
    .toLocaleString('fr-FR')
    .replace(/\s/g, ' ');

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
  event_closed: 'L’événement est terminé.',
  item_disabled: 'Cet effet n’est plus disponible.',
  item_not_found: 'Cet effet n’existe plus.',
  conversion_cap: 'Limite d’échange atteinte pour cette heure.',
  conversion_closed: 'L’échange de Jetons est fermé.',
  insufficient_tokens: 'Pas assez de Jetons.',
  identity_required: 'Partage ton identité Twitch avec l’extension pour participer.',
  idempotency_conflict: 'Action déjà envoyée.',
  raptoru_paused: 'Raptoru est en pause : réessaie un peu plus tard.',
  viewer_blocked: 'Les interactions te sont fermées pour le moment.',
};
const reasonOf = (e) =>
  REASONS[e?.code ?? e?.message] ?? 'Indisponible pour le moment.';

/**
 * The sections of « Interactions », in this order — the light, cheap ones first, the big screamers (rarer, dearer)
 * last; an empty one is not shown.
 */
export const CATEGORIES = [
  { id: 'disruption', label: 'Perturbations', hint: 'Son écran se dérègle' },
  { id: 'apparition', label: 'Apparitions', hint: 'Quelque chose surgit…' },
  { id: 'sound', label: 'Sons', hint: 'Des bruits inquiétants' },
  { id: 'special', label: 'Spéciaux', hint: 'Les plus élaborés' },
  { id: 'screamer', label: 'Screamers', hint: 'Vidéo + son, plein écran' },
];
const categoryOf = (i) =>
  CATEGORIES.some((c) => c.id === i.category)
    ? i.category
    : i.kind === 'screamer'
      ? 'screamer'
      : i.kind === 'apparition'
        ? 'apparition'
        : 'disruption';
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
  return s >= 60
    ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    : `${s} s`;
}

/** « 12 min » / « 45 s »: a wait counted in minutes when it is long. */
const later = (ms) => (ms >= 120_000 ? `${Math.ceil(ms / 60_000)} min` : clock(ms));

/** What a card says about its availability now (pure, tested). */
export function availability(item, elapsedMs = 0) {
  if (item.available) return { ok: true, text: '' };
  const left = Math.max(0, (item.retry_after_ms ?? 0) - elapsedMs);
  if (
    [
      'item_cooldown',
      'viewer_cooldown',
      'screamer_cooldown',
      'screamer_quota',
    ].includes(item.reason) &&
    left > 0
  )
    return { ok: false, text: clock(left), wait: true };
  if (item.reason === 'busy') return { ok: false, text: 'Occupé' };
  if (item.reason === 'engine_offline')
    return { ok: false, text: 'Hors ligne' };
  if (left <= 0 && item.reason && item.reason.endsWith('cooldown'))
    return { ok: true, text: '' };
  return { ok: false, text: 'Indisponible' };
}

/** The viewer's own gap after a purchase (every item says viewer_cooldown): ms left, 0 when none. */
export function viewerWait(s, elapsedMs = 0) {
  const waits = (s?.items ?? [])
    .filter((i) => i.reason === 'viewer_cooldown')
    .map((i) => i.retry_after_ms ?? 0);
  return waits.length ? Math.max(0, Math.max(...waits) - elapsedMs) : 0;
}

/** The exchange's state in words (pure, tested): null when it can be used now. */
export function conversionNote(s, now = Date.now()) {
  const c = s?.conversion ?? {};
  if (s?.balance === null || s?.balance === undefined)
    return 'Partage ton identité Twitch avec l’extension pour échanger.';
  if (!(c.cap_per_hour > 0))
    return 'L’échange de Jetons est fermé pendant cet événement.';
  if (!(c.remaining > 0)) {
    const left = c.frees_at ? new Date(c.frees_at).getTime() - now : 0;
    return left > 0
      ? `Limite atteinte : de nouveau possible dans ${later(left)}.`
      : 'Limite atteinte pour cette heure.';
  }
  return null;
}

function itemRow(i, s, ui, elapsed) {
  const a = availability(i, elapsed);
  const confirming = ui.confirming === i.item_id;
  const sending = ui.sending === i.item_id;
  const balance = s.balance;
  const poor = balance !== null && balance < i.price;
  const disabled = !a.ok || poor || balance === null || !!ui.sending;
  return `<li class="evs-item${a.ok ? '' : ' is-off'}">
      <img class="evs-ico" src="${esc(i.thumb)}" alt="" loading="lazy">
      <div class="evs-txt"><strong>${esc(i.label)}</strong>${i.description ? `<small>${esc(i.description)}</small>` : ''}
        ${a.text ? `<em class="evs-state${a.wait ? ' is-wait' : ''}"${a.wait ? ` data-wait="${esc(i.item_id)}"` : ''}>${esc(a.text)}</em>` : ''}</div>
      <button type="button" class="evs-buy${confirming || sending ? ' is-confirm' : ''}" data-buy="${esc(i.item_id)}"${disabled ? ' disabled' : ''}
        aria-label="${sending ? `Envoi de ${esc(i.label)}` : confirming ? `Confirmer l’achat de ${esc(i.label)}` : `Acheter ${esc(i.label)} pour ${i.price} Bonbons`}">
        ${sending ? 'Envoi…' : confirming ? 'Confirmer ?' : `${nf(i.price)} 🍬`}</button>
    </li>`;
}

function interactionsHtml(s, ui, elapsed) {
  const items = s.items ?? [];
  const present = CATEGORIES.filter((c) =>
    items.some((i) => categoryOf(i) === c.id),
  );
  const filter = present.some((c) => c.id === ui.filter) ? ui.filter : 'all';
  const shown = present.filter((c) => filter === 'all' || c.id === filter);
  const groups = shown
    .map((c) => {
      const rows = items
        .filter((i) => categoryOf(i) === c.id)
        .map((i) => itemRow(i, s, ui, elapsed))
        .join('');
      return `<section class="evs-group"><h4>${esc(c.label)} <small>${esc(c.hint)}</small></h4><ul class="evs-list">${rows}</ul></section>`;
    })
    .join('');
  const recent = (s.recent ?? [])
    .slice(0, 4)
    .map(
      (p) =>
        `<li><span>${esc(p.label)}</span><em class="st-${esc(p.status)}">${esc(STATUS[p.status] ?? p.status)}${p.refund_status === 'refunded' ? ' · remboursé' : ''}</em></li>`,
    )
    .join('');
  const wait = viewerWait(s, elapsed);
  return `${s.engine_ready ? '' : '<p class="evs-warn">👻 Raptoru n’est pas prêt à avoir peur : les achats reviennent dès que son écran est prêt.</p>'}
    ${wait > 0 ? `<p class="evs-next">⏳ Ton prochain achat dans <b data-next>${clock(wait)}</b></p>` : ''}
    ${
      present.length > 1
        ? `<nav class="evs-filters" aria-label="Catégories"><button type="button" data-filter="all" class="${filter === 'all' ? 'is-on' : ''}">Tout</button>${present
            .map(
              (c) =>
                `<button type="button" data-filter="${c.id}" class="${c.id === filter ? 'is-on' : ''}">${esc(c.label)}</button>`,
            )
            .join('')}</nav>`
        : ''
    }
    ${groups || '<div class="evs-empty">Rien à acheter pour le moment.</div>'}
    ${recent ? `<section class="evs-recent"><h4>Tes derniers achats</h4><ul>${recent}</ul></section>` : ''}`;
}

function bonbonsHtml(s, ui) {
  const earn = s.earn ?? {};
  const c = s.conversion ?? {};
  const note = conversionNote(s, ui.now);
  const n = Math.max(1, Math.min(ui.convertN ?? 1, Math.max(1, c.remaining ?? 1)));
  const ways = [
    earn.sub_reward > 0 &&
      `<li><b>+${nf(earn.sub_reward)}</b> à chaque sub ou resub</li>`,
    earn.gift_giver_per_sub > 0 &&
      `<li><b>+${nf(earn.gift_giver_per_sub)}</b> par sub offert, pour celui qui l’offre</li>`,
    earn.gift_recipient > 0 &&
      `<li><b>+${nf(earn.gift_recipient)}</b> quand on t’offre un sub</li>`,
    c.cap_per_hour > 0 &&
      `<li>en échangeant tes Jetons (ci-dessous)</li>`,
    earn.raffle && '<li>en gagnant les tombolas Bonbons de Raptoru</li>',
  ]
    .filter(Boolean)
    .join('');
  return `<div class="evs-wallet">
      <span class="evs-candy" aria-hidden="true">🍬</span>
      <div><b>${s.balance === null ? '—' : nf(s.balance)}</b> Bonbons<small>gardés jusqu’à la fin de l’événement</small></div>
    </div>
    <section class="evs-group"><h4>Gagner des Bonbons</h4><ul class="evs-ways">${ways}</ul></section>
    <section class="evs-group evs-convert"><h4>Échanger des Jetons</h4>
      <p class="evs-rate">${c.rate ? `${nf(c.rate)} Jetons = 1 Bonbon` : ''}${c.cap_per_hour > 0 ? ` · ${nf(c.cap_per_hour)} Bonbons max par heure` : ''}</p>
      ${
        note
          ? `<p class="evs-note">${esc(note)}</p>`
          : `<p class="evs-rate">Encore <b>${nf(c.remaining)}</b> Bonbon${c.remaining > 1 ? 's' : ''} échangeable${c.remaining > 1 ? 's' : ''} cette heure.</p>
      <div class="evs-convert-row">
        <div class="evs-stepper">
          <button type="button" data-step="-1" aria-label="Moins"${n <= 1 ? ' disabled' : ''}>−</button>
          <output>${n} 🍬</output>
          <button type="button" data-step="1" aria-label="Plus"${n >= (c.remaining ?? 0) ? ' disabled' : ''}>+</button>
        </div>
        <button type="button" class="evs-exchange" data-convert="${n}"${ui.converting ? ' disabled' : ''}>${nf(n * c.rate)} Jetons → ${n} 🍬</button>
      </div>`
      }
    </section>`;
}

/**
 * The module's HTML (pure, tested). `ui`: { section: 'interactions' | 'bonbons', filter, confirming, sending,
 * converting, notice, elapsedMs, convertN, unreachable }. Countdowns carry `data-wait` / `data-next`: the view
 * updates their text in place every second (no rebuild).
 */
export function shopHtml(s, ui = {}) {
  if (!s)
    return ui.unreachable
      ? '<div class="evs-empty">👻 Événement injoignable pour le moment… nouvel essai automatique.</div>'
      : '<div class="evs-empty">Chargement de l’événement…</div>';
  if (!s.enabled)
    return '<div class="evs-empty">Aucun événement en cours pour le moment.</div>';
  const elapsed = ui.elapsedMs ?? 0;
  const section = ui.section === 'bonbons' ? 'bonbons' : 'interactions';
  return `<header class="evs-head">
      <div><small>Événement</small><b>${esc(s.edition?.title ?? 'Événement')}</b></div>
      <span class="evs-pill" aria-label="Ton solde de Bonbons">🍬 ${s.balance === null ? '—' : nf(s.balance)}</span>
      <span class="evs-dot${s.engine_ready ? ' is-on' : ''}" title="${s.engine_ready ? 'Écran de Raptoru prêt' : 'Écran de Raptoru pas prêt'}"></span>
    </header>
    <nav class="evs-tabs" role="tablist">
      <button type="button" role="tab" data-section="interactions" aria-selected="${section === 'interactions'}" class="${section === 'interactions' ? 'is-on' : ''}">Interactions</button>
      <button type="button" role="tab" data-section="bonbons" aria-selected="${section === 'bonbons'}" class="${section === 'bonbons' ? 'is-on' : ''}">Bonbons</button>
    </nav>
    ${section === 'bonbons' ? bonbonsHtml(s, ui) : interactionsHtml(s, ui, elapsed)}
    ${ui.notice ? `<p class="evs-notice evs-toast${ui.notice.bad ? ' is-bad' : ''}" role="status">${esc(ui.notice.text)}</p>` : ''}`;
}

export function createEventShopView({ document, client, onState }) {
  const node = document.createElement('div');
  node.className = 'evs';
  let state = null;
  let loadedAt = 0;
  let section = 'interactions';
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
  let unreachable = false;
  let sending = null;
  // A rebuild between the press and the release of a button loses the click: none while a pointer is down.
  let pressed = false;
  let pending = false;

  const render = () => {
    if (pressed) {
      pending = true;
      return;
    }
    pending = false;
    node.innerHTML = shopHtml(state, {
      unreachable,
      sending,
      section,
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
      unreachable = false;
    } catch {
      // Keep the last state; the next refresh retries. Without any, say so instead of « Chargement » forever.
      unreachable = true;
    }
    render();
  }

  const release = () => {
    pressed = false;
    if (pending) render();
  };
  node.addEventListener('pointerdown', () => {
    pressed = true;
  });
  // After the click that follows this release (same input task), never before it.
  node.addEventListener('pointerup', () => setTimeout(release, 0));
  node.addEventListener('pointercancel', release);
  node.addEventListener('pointerleave', release);

  /** The countdowns, in place; a row whose wait is over gets its button back (one rebuild). */
  const tick = () => {
    if (!state?.items) return;
    const elapsed = Date.now() - loadedAt;
    for (const el of node.querySelectorAll('[data-wait]')) {
      const item = state.items.find((i) => i.item_id === el.dataset.wait);
      const a = item ? availability(item, elapsed) : { ok: true };
      if (a.ok) return render();
      el.textContent = a.text;
    }
    const next = node.querySelector('[data-next]');
    if (next) {
      const left = viewerWait(state, elapsed);
      if (left <= 0) return render();
      next.textContent = clock(left);
    }
  };

  node.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t || t.disabled || busy) return;
    if (t.dataset.section) {
      section = t.dataset.section;
      return render();
    }
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
    // At once: the tap is seen, and no second purchase can start until the Core answers.
    sending = id;
    render();
    try {
      const out = await client.eventsBuy(id);
      take(out?.event_shop);
      say('Envoyé ! Surveille l’écran de Raptoru… 👀');
    } catch (e) {
      say(reasonOf(e), true);
      void load();
    } finally {
      busy = false;
      sending = null;
      render();
    }
  });

  return {
    node,
    start() {
      render();
      void load();
      timer = setInterval(() => void load(), REFRESH_MS);
      // Countdowns move every second without a request, and without rebuilding the module.
      ticker = setInterval(tick, 1000);
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
