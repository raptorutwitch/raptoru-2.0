// Mini-jeux › Random Ban (docs/mini-jeux/UX_UI_MINI_JEUX.md, SPEC § 1–2): a host module view (module-registry.js).
// The Core decides everything — the buyer's price, the gauge's times, availability, the purchase; this view shows the
// state of `GET /modules/v3/random_ban/state`, projects the gauge between two reads, and sends `launch` with the price
// the viewer confirmed (input.expected_price: never charged above it). One key per intent (purchase.js): a double tap,
// a retry after a lost answer or a reconnection resend the SAME key — one Random Ban, one debit.

import { errorLabel } from './api.js';
import { registerViewerModule } from './module-registry.js';
import { createIntent, isRetryable } from './purchase.js';
import { gaugeModel, priceText, requestLine, sniperLine, sniperReadyText, waitText } from './random-ban-model.js';

const SHEET = 'modules/arcade/arcade.css';
const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The module's own sheet, once per document (no line in the shells' central style lists). */
function ensureSheet(document) {
  if (document.querySelector(`link[data-rb-sheet]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = SHEET;
  link.dataset.rbSheet = '1';
  document.head?.append(link);
}

const REASONS = {
  module_disabled: 'Random Ban depuis l’extension n’est pas encore ouvert.',
  rb_unavailable: 'Random Ban indisponible pour le moment (le bot ne répond pas) : rien n’a été débité.',
  too_many_pending: 'Tu as déjà 2 Random Ban en attente : attends le résultat du premier.',
  identity_required: 'Partage ton identité Twitch pour jouer.',
  rb_paused: 'Random Ban est en pause pour le moment : rien n’a été débité.',
  viewer_blocked: 'Random Ban est indisponible pour ton compte.',
  viewer_cooldown: 'Délai personnel en cours : réessaie un peu plus tard. Rien n’a été débité.',
  wish_unknown: 'Cette personne n’est plus dans le chat : choisis quelqu’un d’autre.',
};
const reasonText = (code) => REASONS[code] ?? errorLabel(code);

export function createRandomBanView({ document, client, module }) {
  ensureSheet(document);
  const win = document.defaultView ?? globalThis;
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const node = document.createElement('section');
  node.className = 'rbx';
  node.innerHTML = `
    <div class="rbx__ticket">
      <div class="rbx__price">
        <span class="rbx__label">Ton prix</span>
        <strong class="rbx__amount" data-k="price">—</strong>
        <span class="rbx__tier" data-k="tier"></span>
      </div>
      <div class="rbx__gauge" data-k="gauge" hidden>
        <div class="rbx__bar" aria-hidden="true"><i data-k="bar"></i></div>
        <p class="rbx__next" data-k="next"></p>
        <p class="rbx__normal" data-k="normal"></p>
      </div>
      <p class="rbx__sr" data-k="sr" aria-live="polite"></p>
    </div>
    <p class="rbx__rules">Le serveur tire au sort un viewer du chat (toi compris, avec 4 fois moins de chances) : timeout de 3 min (abonné) ou 5 min. Chaque lancer fait monter ton prix d’un palier ; un palier revient toutes les 5 min.</p>
    <div class="rbx__sniper">
      <label class="rbx__slabel" for="rbx-wish">🎯 Viser quelqu’un (facultatif)</label>
      <select class="rbx__select" id="rbx-wish" data-k="wish"><option value="">Personne : un tirage simple</option></select>
      <p class="rbx__snote" data-k="snote">Viser ne change pas le tirage : c’est une prédiction.</p>
    </div>
    <div class="rbx__foot">
      <button type="button" class="rbx__cta" data-k="cta" disabled>…</button>
      <p class="rbx__msg" data-k="msg" role="status"></p>
    </div>
    <h3 class="rbx__h">Mes derniers lancers</h3>
    <ul class="rbx__list" data-k="mine"></ul>
    <h3 class="rbx__h">Mes stats</h3>
    <dl class="rbx__stats" data-k="stats"></dl>`;
  const $ = (k) => node.querySelector(`[data-k="${k}"]`);
  const intent = createIntent();
  let s = null; // the Core's state of the module for this viewer
  let readAt = 0;
  let armed = false;
  let busy = false;
  let disarm = null;
  let tick = null;
  let poll = null;
  let lastSr = '';
  let stopped = false;

  const launch = () => s?.actions?.find((a) => a.name === 'launch') ?? null;
  const st = () => s?.state ?? null;

  const drawGauge = () => {
    const state = st();
    const g = state?.price ? gaugeModel(state.price, readAt, Date.now(), state.step_ms, { reducedMotion: reduced }) : null;
    $('gauge').hidden = !g;
    if (!g) return;
    $('bar').style.width = `${(g.fraction * 100).toFixed(2)}%`;
    $('next').textContent = `${priceText(g.next_price)} dans ${waitText(g.next_in_ms)}`;
    $('normal').textContent = `Tarif normal dans ${waitText(g.normal_in_ms)}`;
    // Screen readers: once per step, never every second.
    const sr = `Prix actuel ${priceText(g.price)}. ${priceText(g.next_price)} dans ${waitText(g.next_in_ms, { seconds: false })}.`;
    if (sr.split('.')[0] !== lastSr.split('.')[0]) $('sr').textContent = sr;
    lastSr = sr;
    if (g.stale) void refresh();
  };

  const draw = () => {
    const state = st();
    const a = launch();
    const price = state?.price?.price ?? null;
    $('price').textContent = price === null ? '—' : priceText(price);
    $('tier').textContent = state?.price
      ? state.price.level
        ? `Palier ${state.price.level + 1} sur ${state.tiers?.length ?? 5} · série`
        : 'Tarif normal'
      : '';
    node.classList.toggle('is-series', !!state?.price?.level);
    const reason = !a
      ? 'unavailable'
      : !a.available
        ? a.unavailable_reason
        : state && !state.identity
          ? 'identity_required'
          : state && !state.ready
            ? 'rb_unavailable'
            : state && state.pending >= state.max_pending
              ? 'too_many_pending'
              : null;
    const cta = $('cta');
    cta.disabled = busy || !!reason || price === null;
    cta.textContent = busy
      ? 'Envoi…'
      : armed
        ? `Confirmer — ${priceText(price)}`
        : price === null
          ? 'Random Ban'
          : `Lancer — ${priceText(price)}`;
    cta.classList.toggle('is-armed', armed);
    if (reason && !busy) $('msg').textContent = reasonText(reason);
    // Sniper: the viewers present (never yourself), the selection kept across reads; locked while sending.
    const sel = $('wish');
    const keep = sel.value;
    const cands = state?.candidates ?? [];
    const sig = cands.map((c) => c.id).join(',');
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.replaceChildren(sel.options[0]);
      for (const c of cands) {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name;
        sel.append(o);
      }
      sel.value = cands.some((c) => c.id === keep) ? keep : '';
    }
    sel.disabled = busy || armed;
    $('snote').textContent = sel.value
      ? sniperReadyText(state?.sniper, readAt, Date.now(), state?.price?.server_now ?? new Date().toISOString())
      : 'Viser ne change pas le tirage : c’est une prédiction.';
    const stats = state?.stats;
    $('stats').innerHTML = stats
      ? [
          ['Lancés', stats.launched],
          ['Exclus', stats.landed],
          ['CSC', stats.self],
          ['Subis', stats.received],
          ['Snipers réussis', `${stats.sniper_hits} / ${stats.sniper_tries}`],
          ['Jetons dépensés', priceText(stats.spent)],
          ['Primes gagnées', priceText(stats.earned)],
        ]
          .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
          .join('')
      : '';
    const mine = state?.mine ?? [];
    $('mine').innerHTML = mine.length
      ? mine
          .slice(0, 5)
          .map((r) => {
            const l = requestLine(r);
            const sn = sniperLine(r);
            return `<li class="${l.open ? 'is-open' : ''}${r.sniper === 'hit' ? ' is-hit' : ''}"><b>${esc(l.what)}${sn ? `<small>${esc(sn)}</small>` : ''}</b><span>${esc([l.via, l.paid].filter(Boolean).join(' · '))}</span></li>`;
          })
          .join('')
      : '<li class="rbx__empty">Aucun lancer pour l’instant.</li>';
    drawGauge();
  };

  async function refresh() {
    try {
      const next = await client.moduleState(module.id);
      if (stopped) return;
      s = next;
      readAt = Date.now();
    } catch {
      if (stopped) return;
      s = null; // never a purchase the server cannot honour: the button waits for the next read
    }
    draw();
  }

  const onClick = async () => {
    const price = st()?.price?.price;
    if (busy || !Number.isInteger(price)) return;
    if (!armed) {
      armed = true;
      const wishName = $('wish').selectedOptions[0]?.textContent;
      $('msg').textContent = $('wish').value
        ? `Tu vises ${wishName} (prédiction, le tirage n’en tient pas compte). Confirme pour payer.`
        : 'Le tirage ne dépend que du serveur. Confirme pour payer.';
      clearTimeout(disarm);
      disarm = setTimeout(() => { armed = false; $('msg').textContent = ''; draw(); }, 5000);
      return draw();
    }
    clearTimeout(disarm);
    armed = false;
    busy = true;
    draw();
    try {
      const wish = $('wish').value;
      const out = await client.moduleAct(
        module.id,
        'launch',
        { expected_price: price, ...(wish ? { wish_id: wish } : {}) },
        intent.key(),
      );
      intent.close();
      const paid = out?.activity?.result?.request?.price_paid;
      $('msg').textContent = Number.isInteger(paid) && paid < price
        ? `Payé ${priceText(paid)} (le prix avait baissé) · en file.`
        : 'Payé · ton Random Ban est en file.';
    } catch (e) {
      if (!isRetryable(e)) intent.close();
      const code = e?.code ?? e?.message;
      $('msg').textContent = code === 'price_changed'
        ? 'Ton prix a changé : rien n’a été débité. Vérifie le nouveau prix.'
        : isRetryable(e)
          ? 'Pas de réponse : réessaie, ta demande ne sera jamais payée deux fois.'
          : reasonText(code);
    } finally {
      busy = false;
      await refresh();
    }
  };
  $('cta').addEventListener('click', onClick);
  const onWish = () => draw();
  $('wish').addEventListener('change', onWish);
  const onKey = (e) => {
    if (e.key === 'Escape' && armed) {
      armed = false;
      $('msg').textContent = '';
      draw();
    }
  };
  node.addEventListener('keydown', onKey);

  return {
    node,
    start() {
      void refresh();
      tick = setInterval(drawGauge, 1000);
      poll = setInterval(() => void refresh(), 5000);
    },
    destroy() {
      stopped = true;
      clearInterval(tick);
      clearInterval(poll);
      clearTimeout(disarm);
      $('cta').removeEventListener('click', onClick);
      $('wish').removeEventListener('change', onWish);
      node.removeEventListener('keydown', onKey);
    },
  };
}

// The Hub entry says « Mini-jeux » (UX § 1): with one game, the card opens Random Ban directly.
registerViewerModule('random_ban_ext', createRandomBanView, {
  icon: '🎲',
  label: 'Mini-jeux',
  description: 'Random Ban : exclus un viewer au hasard',
});
