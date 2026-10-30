// « Événements » in the Hub (docs/HALLOWEEN.md) — the edition of the moment (Halloween 2026): its interactions, played
// on Raptoru's own screen, and its currency, the Bonbons. Everything is Core's projection for the JWT's viewer: names,
// thumbnails, descriptions, prices, categories, limits, cooldowns, the overlay's state, the ways to earn (the Jetons
// exchange is gone since 30/10). A purchase is two taps (« price » then « Confirmer ? ») with one Idempotency-Key each (a
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
  insufficient_tokens: 'Pas assez de Jetons.',
  identity_required:
    'Partage ton identité Twitch avec l’extension pour participer.',
  idempotency_conflict: 'Action déjà envoyée.',
  raptoru_paused: 'Raptoru est en pause : réessaie un peu plus tard.',
  viewer_blocked: 'Les interactions te sont fermées pour le moment.',
  already_owned: 'Tu possèdes déjà ce titre.',
  insufficient_funds: 'Pas assez de Bonbons.',
  offer_unavailable: 'Ce titre n’est plus en vente.',
  offer_disabled: 'Ce titre n’est plus en vente.',
  offer_closed: 'Ce titre n’est plus en vente.',
  offer_not_open: 'Ce titre n’est pas encore en vente.',
  item_unavailable: 'Ce titre n’est plus en vente.',
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

function bonbonsHtml(s) {
  const earn = s.earn ?? {};
  const ways = [
    earn.presence &&
      `<li><b>+${nf(earn.presence.bonbons)}</b> toutes les ${nf(earn.presence.every_min)} min passées sur le live</li>`,
    earn.sub_reward > 0 &&
      `<li><b>+${nf(earn.sub_reward)}</b> à chaque sub</li>`,
    earn.prime_reward > 0 &&
      earn.prime_reward !== earn.sub_reward &&
      `<li><b>+${nf(earn.prime_reward)}</b> pour un sub Prime</li>`,
    earn.resub_reward > 0 &&
      `<li><b>+${nf(earn.resub_reward)}</b> quand tu partages ton réabonnement</li>`,
    earn.gift_giver_per_sub > 0 &&
      `<li><b>+${nf(earn.gift_giver_per_sub)}</b> par sub offert, pour celui qui l’offre</li>`,
    earn.gift_recipient > 0 &&
      `<li><b>+${nf(earn.gift_recipient)}</b> quand on t’offre un sub</li>`,
    earn.bits &&
      `<li><b>+${nf(earn.bits.bonbons)}</b> tous les ${nf(earn.bits.step)} Bits</li>`,
    earn.donation_per_euro > 0 &&
      `<li><b>+${nf(earn.donation_per_euro)}</b> par euro de don (avec ton pseudo Twitch)</li>`,
    earn.raffle && '<li>en gagnant les tombolas Bonbons de Raptoru</li>',
  ]
    .filter(Boolean)
    .join('');
  return `<div class="evs-wallet">
      <span class="evs-candy" aria-hidden="true">🍬</span>
      <div><b>${s.balance === null ? '—' : nf(s.balance)}</b> Bonbons<small>gardés jusqu’à la fin de l’événement</small></div>
    </div>
    <section class="evs-group"><h4>Gagner des Bonbons</h4><ul class="evs-ways">${ways}</ul></section>`;
}

/**
 * The module's HTML (pure, tested). `ui`: { section: 'interactions' | 'bonbons', filter, confirming, sending,
 * notice, elapsedMs, unreachable }. Countdowns carry `data-wait` / `data-next`: the view
 * updates their text in place every second (no rebuild).
 */
const RARITY = {
  common: 'Commun',
  rare: 'Rare',
  epic: 'Épique',
  legendary: 'Légendaire',
};

/** « Titres »: permanent rewards bought with the Bonbons (pure, tested). `t`: the Core's /events/titles. */
export function titlesHtml(t, ui = {}) {
  const balance = t.balance ?? null;
  const rows = (t.items ?? []).map((i) => {
    const key = `title:${i.offer_id}`;
    const confirming = ui.confirming === key;
    const sending = ui.sending === key;
    const poor = balance !== null && balance < i.price;
    const action = i.owned
      ? '<span class="evs-owned">Possédé ✓</span>'
      : `<button type="button" class="evs-buy${confirming || sending ? ' is-confirm' : ''}" data-buy-title="${esc(i.offer_id)}"${!t.open || poor || balance === null || ui.sending ? ' disabled' : ''}
          aria-label="${confirming ? `Confirmer l’achat du titre ${esc(i.label)}` : `Acheter le titre ${esc(i.label)} pour ${i.price} Bonbons`}">
          ${sending ? 'Achat…' : confirming ? 'Confirmer ?' : `${nf(i.price)} 🍬`}</button>`;
    const state = i.owned
      ? ''
      : !t.open
        ? 'Indisponible'
        : balance === null
          ? 'Partage ton identité Twitch pour l’acheter'
          : poor
            ? 'Pas assez de Bonbons'
            : 'Disponible';
    return `<li class="evs-item evs-title-row${i.owned ? ' is-owned' : ''}">
      <div class="evs-txt"><strong class="evs-title-name" data-look="${esc(i.id)}">${esc(i.label)}</strong>
        ${i.rarity && RARITY[i.rarity] ? `<span class="evs-rarity is-${esc(i.rarity)}">${RARITY[i.rarity]}</span>` : ''}
        ${i.description ? `<small>${esc(i.description)}</small>` : ''}
        ${state ? `<em class="evs-state">${esc(state)}</em>` : ''}</div>
      ${action}
    </li>`;
  });
  return `<p class="evs-note evs-titles-note">🏷️ <b>Récompenses permanentes</b> : un titre acheté reste à toi, même après Halloween
      (contrairement aux effets et screamers, joués une fois). Retrouve-le dans ta collection sur raptoru.fr.</p>
    ${rows.length ? `<ul class="evs-list">${rows.join('')}</ul>` : '<div class="evs-empty">Aucun titre en vente pour le moment.</div>'}`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
/** A title's look from the Core (colour, gradient, weight, glow), applied through the DOM (no inline style). */
function paintTitles(root, t) {
  for (const el of root.querySelectorAll('[data-look]')) {
    const st = (t?.items ?? []).find((i) => i.id === el.dataset.look)?.style;
    if (!st) continue;
    if (st.gradient && HEX.test(st.gradient.from) && HEX.test(st.gradient.to)) {
      el.style.backgroundImage = `linear-gradient(${Number(st.gradient.angle) || 90}deg, ${st.gradient.from}, ${st.gradient.to})`;
      el.style.backgroundClip = 'text';
      el.style.webkitBackgroundClip = 'text';
      el.style.color = 'transparent';
    } else if (st.color && HEX.test(st.color)) el.style.color = st.color;
    el.style.fontWeight = st.weight === 'normal' ? '500' : '800';
    if (st.effect && st.effect !== 'none')
      el.style.textShadow = `0 0 8px ${HEX.test(st.color ?? '') ? st.color : 'rgba(255, 170, 60, 0.8)'}`;
  }
}

export function shopHtml(s, ui = {}) {
  if (!s)
    return ui.unreachable
      ? '<div class="evs-empty">👻 Événement injoignable pour le moment… nouvel essai automatique.</div>'
      : '<div class="evs-empty">Chargement de l’événement…</div>';
  if (!s.enabled)
    return '<div class="evs-empty">Aucun événement en cours pour le moment.</div>';
  const elapsed = ui.elapsedMs ?? 0;
  const hasTitles = ui.titles?.enabled === true;
  const section =
    ui.section === 'bonbons'
      ? 'bonbons'
      : ui.section === 'titles' && hasTitles
        ? 'titles'
        : 'interactions';
  return `<header class="evs-head">
      <div><small>Événement</small><b>${esc(s.edition?.title ?? 'Événement')}</b></div>
      <span class="evs-pill" aria-label="Ton solde de Bonbons">🍬 ${s.balance === null ? '—' : nf(s.balance)}</span>
      <span class="evs-dot${s.engine_ready ? ' is-on' : ''}" title="${s.engine_ready ? 'Écran de Raptoru prêt' : 'Écran de Raptoru pas prêt'}"></span>
    </header>
    <nav class="evs-tabs" role="tablist">
      <button type="button" role="tab" data-section="interactions" aria-selected="${section === 'interactions'}" class="${section === 'interactions' ? 'is-on' : ''}">Interactions</button>
      ${hasTitles ? `<button type="button" role="tab" data-section="titles" aria-selected="${section === 'titles'}" class="${section === 'titles' ? 'is-on' : ''}">Titres</button>` : ''}
      <button type="button" role="tab" data-section="bonbons" aria-selected="${section === 'bonbons'}" class="${section === 'bonbons' ? 'is-on' : ''}">Bonbons</button>
    </nav>
    ${section === 'bonbons' ? bonbonsHtml(s) : section === 'titles' ? titlesHtml(ui.titles, ui) : interactionsHtml(s, ui, elapsed)}
    ${ui.notice ? `<p class="evs-notice evs-toast${ui.notice.bad ? ' is-bad' : ''}" role="status">${esc(ui.notice.text)}</p>` : ''}`;
}

export function createEventShopView({ document, client, onState }) {
  const node = document.createElement('div');
  node.className = 'evs';
  let state = null;
  let titles = null;
  let loadedAt = 0;
  let section = 'interactions';
  let filter = 'all';
  let confirming = null;
  let confirmTimer = null;
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
      notice,
      titles,
      elapsedMs: Date.now() - loadedAt,
    });
    paintTitles(node, titles);
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
      const [s, t] = await Promise.all([
        client.eventsState(),
        // An older Core has no titles: the tab simply does not show.
        client.eventsTitles ? client.eventsTitles().catch(() => null) : null,
      ]);
      take(s);
      titles = t && t.enabled === true ? t : null;
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
    const offer = t.dataset.buyTitle;
    const id = t.dataset.buy ?? (offer ? `title:${offer}` : null);
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
      if (offer) {
        const out = await client.eventsBuyTitle(offer);
        take(out?.event_shop);
        if (out?.titles?.enabled) titles = out.titles;
        say('Titre ajouté à ta collection, pour toujours ! 🎃');
      } else {
        const out = await client.eventsBuy(id);
        take(out?.event_shop);
        say('Envoyé ! Surveille l’écran de Raptoru… 👀');
      }
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
