// Mini-jeux › Random Ban — the game screen (UX refonte 13/11, docs/mini-jeux/UX_UI_MINI_JEUX.md). A host module view
// (module-registry.js). The Core decides everything: the buyer's price, availability, the purchase, the draw and its
// target. This view shows `GET /modules/v3/random_ban/state` and sends `launch` with the price the viewer confirmed
// (input.expected_price: never charged above it). One key per intent (purchase.js): a double tap, a retry after a
// lost answer or a reconnection resend the SAME key — one Random Ban, one debit.
// The reel is a SHOW of the Core's result: it scrolls the strip the Core built AFTER its draw and stops where the Core
// put the target. The extension never draws, and the Sniper never reaches the draw.

import { errorLabel } from './api.js';
import { createMiniGames } from './mini-games.js';
import { registerViewerModule } from './module-registry.js';
import { createIntent, isRetryable } from './purchase.js';
import {
  cleanWish,
  exactViewer,
  gaugeModel,
  historyLine,
  matchViewers,
  priceShort,
  priceText,
  resultModel,
  waitText,
} from './random-ban-model.js';

const SHEET = 'modules/arcade/arcade.css';
const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The module's own sheet, once per document (no line in the shells' central style lists). */
function ensureSheet(document) {
  if (document.querySelector('link[data-rb-sheet]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = SHEET;
  link.dataset.rbSheet = '1';
  document.head?.append(link);
}

export const RB_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M12 1.8v4M12 18.2v4M1.8 12h4M18.2 12h4"/></svg>';

const REASONS = {
  module_disabled: 'Random Ban n’est pas encore ouvert.',
  rb_unavailable: 'Indisponible : le bot ne répond pas. Rien n’a été débité.',
  too_many_pending: 'Attends le résultat de tes Random Ban en cours.',
  identity_required: 'Partage ton identité Twitch pour jouer.',
  rb_paused: 'Random Ban est en pause. Rien n’a été débité.',
  viewer_blocked: 'Random Ban est indisponible pour ton compte.',
  viewer_cooldown: 'Délai personnel en cours. Rien n’a été débité.',
  wish_unknown: 'Ce viewer n’est plus dans le chat : vise quelqu’un d’autre.',
  stream_offline: 'Random Ban se joue pendant le live.',
  unavailable: 'Random Ban est indisponible pour le moment.',
};
const reasonText = (code) => REASONS[code] ?? errorLabel(code);

/** Twitch pictures (the Core's cache) or the Lab demo's own; anything else shows the initials. */
const okPicture = (u) =>
  typeof u === 'string' && (/^https:\/\/static-cdn\.jtvnw\.net\/[^\s"'<>]+$/.test(u) || /^\/av\/[\w-]+\.svg$/.test(u));
const hue = (s) => [...String(s ?? '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17);
const initials = (n) => String(n ?? '?').replace(/^@/, '').slice(0, 2).toUpperCase();
const face = (item, cls = 'rb-face') =>
  `<span class="${cls}" style="--h:${hue(item?.name)}"><i>${esc(initials(item?.name))}</i>${
    okPicture(item?.avatar) ? `<img src="${esc(item.avatar)}" alt="" loading="lazy" draggable="false">` : ''
  }</span>`;
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The requests already shown on this device (a refresh never replays a reel, a Sniper never celebrates twice). */
function seenStore(win, key) {
  let set = new Set();
  try {
    set = new Set(JSON.parse(win.sessionStorage.getItem(key) ?? '[]'));
  } catch {
    /* private window, blocked storage: memory only */
  }
  return {
    has: (id) => set.has(id),
    add(id) {
      set.add(id);
      try {
        win.sessionStorage.setItem(key, JSON.stringify([...set].slice(-40)));
      } catch {
        /* memory only */
      }
    },
  };
}

const REEL_MS = 4200;
const REPLAY_WINDOW_MS = 90_000;
const RESULT_HOLD_MS = 9000;

export function createRandomBanGame({ document, client, module }) {
  ensureSheet(document);
  const win = document.defaultView ?? globalThis;
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const node = document.createElement('div');
  node.className = 'rb';
  node.innerHTML = `
    <header class="rb__head">
      <span class="rb__title"><span class="rb__icon">${RB_ICON}</span><b>Random Ban</b></span>
      <span class="rb__price" data-k="price" tabindex="0">
        <svg class="rb__ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="rb__ring-bg"/><circle cx="18" cy="18" r="15.5" class="rb__ring-fg" data-k="ring" pathLength="100"/></svg>
        <span class="rb__coin" aria-hidden="true"></span>
        <strong data-k="amount">—</strong>
        <small data-k="drop" hidden></small>
      </span>
    </header>
    <div class="rb__stage" data-k="stage" aria-live="polite">
      <div class="rb__track" data-k="track"></div>
      <div class="rb__sight" aria-hidden="true"><i></i></div>
      <div class="rb__card" data-k="card" hidden></div>
      <p class="rb__empty" data-k="empty" hidden></p>
    </div>
    <div class="rb__bar">
      <div class="rb__sniper" data-k="sniper">
        <span class="rb__scope" aria-hidden="true">🎯</span>
        <input class="rb__input" data-k="wish" type="text" maxlength="40" autocomplete="off" spellcheck="false"
          role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="rb-sugg"
          aria-label="Sniper : le viewer que tu prédis (facultatif)" placeholder="Sniper : @pseudo (facultatif)">
        <span class="rb__picked" data-k="picked" hidden></span>
        <button type="button" class="rb__clear" data-k="clear" aria-label="Effacer le Sniper" hidden>×</button>
        <ul class="rb__sugg" id="rb-sugg" role="listbox" data-k="sugg" hidden></ul>
      </div>
      <button type="button" class="rb__go" data-k="go" disabled>Lancer</button>
    </div>
    <footer class="rb__foot">
      <p class="rb__msg" data-k="msg" role="status"></p>
      <button type="button" class="rb__histbtn" data-k="histbtn" aria-expanded="false">Historique</button>
    </footer>
    <div class="rb__hist" data-k="hist" hidden role="dialog" aria-label="Derniers Random Ban">
      <div class="rb__histhead"><b>Derniers Random Ban</b><button type="button" class="rb__x" data-k="histclose" aria-label="Fermer">×</button></div>
      <ul class="rb__histlist" data-k="histlist"></ul>
    </div>
    <p class="rb__sr" data-k="sr" aria-live="polite"></p>`;
  const $ = (k) => node.querySelector(`[data-k="${k}"]`);
  const intent = createIntent();
  const played = seenStore(win, 'rb:played');
  const celebrated = seenStore(win, 'rb:sniper');
  let s = null; // the Core's state of the module for this viewer
  let readAt = 0;
  let armed = false;
  let busy = false;
  let disarm = null;
  let tick = null;
  let poll = null;
  let stopped = false;
  let picked = null; // the Sniper account chosen in the suggestions
  let suggestions = [];
  let active = -1;
  let animating = null; // request id whose reel runs
  let shown = null; // request id the stage shows (after its reel)
  let shownAt = 0;
  let lastSr = '';
  let flash = ''; // the message of the last action, kept a few seconds over the state's own

  const st = () => s?.state ?? null;
  const launch = () => s?.actions?.find((a) => a.name === 'launch') ?? null;
  const serverNow = () => {
    const at = st()?.price?.server_now;
    return at ? Date.parse(at) + (Date.now() - readAt) : Date.now();
  };
  const age = (r) => serverNow() - Date.parse(r.created_at);
  const candidates = () => st()?.candidates ?? [];

  // --- Header: the price and its recovery ----------------------------------------------------------------------------
  function drawPrice() {
    const state = st();
    const p = state?.price;
    $('amount').textContent = p ? priceShort(p.price) : '—';
    const g = p ? gaugeModel(p, readAt, Date.now(), state.step_ms, { reducedMotion: reduced }) : null;
    node.classList.toggle('is-series', !!g);
    $('drop').hidden = !g;
    $('ring').style.strokeDasharray = g ? `${(100 * (1 - g.fraction)).toFixed(1)} 100` : '0 100';
    $('price').title = !p
      ? ''
      : g
        ? `Ton prix : ${priceText(g.price)} (série). ${priceText(g.next_price)} dans ${waitText(g.next_in_ms)}, tarif normal dans ${waitText(g.normal_in_ms)}.`
        : `Ton prix : ${priceText(p.price)} (tarif normal).`;
    if (g) $('drop').textContent = `↓ ${mmss(g.next_in_ms)}`;
    const sr = p ? `Ton prix : ${priceText(p.price)}.` : '';
    if (sr !== lastSr) $('sr').textContent = sr;
    lastSr = sr;
    if (g?.stale) void refresh();
  }

  // --- Stage: idle faces, the spin while drawing, the reel, the result ----------------------------------------------
  const cells = (items) =>
    items.map((it) => `<span class="rb__cell" data-id="${esc(it.id)}">${face(it)}<b>${esc(it.name)}</b></span>`).join('');

  function idleStrip() {
    const pool = candidates();
    if (!pool.length) return [];
    const out = [];
    while (out.length < 14) out.push(...pool);
    return out.slice(0, Math.max(14, Math.min(28, pool.length)));
  }

  const setStage = (mode) => {
    node.dataset.stage = mode; // idle | spin | reel | result | empty
  };

  function drawIdle(spin = false) {
    const pool = idleStrip();
    $('card').hidden = true;
    $('empty').hidden = !!pool.length;
    if (!pool.length) {
      setStage('empty');
      $('track').innerHTML = '';
      $('track').dataset.sig = '';
      $('empty').textContent =
        st() && !st().identity ? reasonText('identity_required') : 'Personne dans le chat pour l’instant.';
      return;
    }
    const sig = `idle:${pool.map((p) => p.id).join(',')}`;
    if ($('track').dataset.sig !== sig) {
      $('track').dataset.sig = sig;
      $('track').innerHTML = cells(pool);
      $('track').style.transform = '';
    }
    setStage(spin ? 'spin' : 'idle');
  }

  /** Scrolls the Core's strip and stops on its target (the Core's `stop`). */
  async function playReel(r) {
    animating = r.request_id;
    flash = ''; // « tirage en cours… » is over: the stage tells the rest
    $('msg').textContent = '';
    played.add(r.request_id);
    const { items, stop } = r.strip;
    const track = $('track');
    track.dataset.sig = `reel:${r.request_id}`;
    track.innerHTML = cells(items);
    track.style.transform = '';
    $('card').hidden = true;
    $('empty').hidden = true;
    setStage('reel');
    const stage = $('stage');
    const cell = track.children[0];
    const w = cell ? cell.getBoundingClientRect().width : 72;
    const center = stage.clientWidth / 2;
    const end = center - (stop * w + w / 2);
    const start = center - w / 2 + w * 2;
    if (reduced || typeof track.animate !== 'function') {
      track.style.transform = `translateX(${end}px)`;
    } else {
      const a = track.animate([{ transform: `translateX(${start}px)` }, { transform: `translateX(${end}px)` }], {
        duration: REEL_MS,
        easing: 'cubic-bezier(.1,.75,.12,1)',
        fill: 'forwards',
      });
      await a.finished.catch(() => {});
      track.style.transform = `translateX(${end}px)`;
      a.cancel();
    }
    if (stopped) return;
    track.children[stop]?.classList.add('is-target');
    animating = null;
    shown = r.request_id;
    shownAt = Date.now();
    draw();
  }

  function drawResult(r) {
    const m = resultModel(r);
    setStage('result');
    const card = $('card');
    card.hidden = false;
    card.dataset.tone = m.tone;
    const avatar =
      r.strip?.items?.find((x) => x.id === r.target?.id)?.avatar ??
      candidates().find((x) => x.id === r.target?.id)?.avatar ??
      null;
    const sn = m.sniper;
    const html = `${r.target ? face({ ...r.target, avatar }, 'rb-face rb-face--big') : ''}
      <div class="rb__cardtxt"><b>${esc(m.who ?? 'Random Ban')}</b><span>${esc(m.text)}</span>${
        sn?.text ? `<em class="rb__sn${sn.hit ? ' is-hit' : ''}">${esc(sn.text)}</em>` : ''
      }</div>`;
    if (card.dataset.html !== html) {
      card.dataset.html = html;
      card.innerHTML = html;
    }
    // Sniper hit: celebrated once per request on this device (the bonus itself was paid once by the Core).
    if (sn?.hit && !celebrated.has(r.request_id)) {
      celebrated.add(r.request_id);
      node.classList.remove('is-sniped');
      void node.offsetWidth;
      node.classList.add('is-sniped');
      win.setTimeout(() => node.classList.remove('is-sniped'), 2600);
    }
  }

  function drawStage() {
    if (animating) return; // the reel owns the stage until it stops
    const mine = st()?.mine ?? [];
    // Next reel: the oldest of my recent draws not shown yet on this device (two purchases: one after the other).
    const next = [...mine]
      .reverse()
      .find((r) => r.strip?.items?.length && !played.has(r.request_id) && age(r) < REPLAY_WINDOW_MS);
    if (next) return void playReel(next);
    for (const r of mine) if (r.strip && !played.has(r.request_id)) played.add(r.request_id); // too old: no replay
    const open = mine.find((r) => ['queued', 'searching'].includes(r.status));
    const current = mine.find((r) => r.request_id === shown);
    if (current && !open && (current.status === 'timeout_requested' || Date.now() - shownAt < RESULT_HOLD_MS))
      return drawResult(current);
    // A result without a reel (nobody eligible, refused, canceled): a card, for a few seconds.
    const fresh = mine.find(
      (r) => !r.strip && !['queued', 'searching'].includes(r.status) && age(r) < 20_000 && !played.has(r.request_id),
    );
    if (fresh && !open) {
      played.add(fresh.request_id);
      shown = fresh.request_id;
      shownAt = Date.now();
      return drawResult(fresh);
    }
    if (open) return drawIdle(true);
    shown = null;
    drawIdle();
  }

  // --- Sniper: free text, suggestions, the picked account -----------------------------------------------------------
  function drawSuggestions() {
    const list = $('sugg');
    const input = $('wish');
    const open = !picked && suggestions.length > 0 && document.activeElement === input;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    list.innerHTML = suggestions
      .map(
        (c, i) =>
          `<li role="option" id="rb-o${i}" data-i="${i}" class="${i === active ? 'is-on' : ''}" aria-selected="${i === active}">${face(c, 'rb-face rb-face--xs')}<span>${esc(c.name)}${
            c.login && c.login.toLowerCase() !== String(c.name).toLowerCase() ? ` <small>@${esc(c.login)}</small>` : ''
          }</span>${c.exact ? '<em>exact</em>' : ''}</li>`,
      )
      .join('');
    if (active >= 0) input.setAttribute('aria-activedescendant', `rb-o${active}`);
    else input.removeAttribute('aria-activedescendant');
  }
  function pick(c) {
    picked = c;
    $('wish').value = c.name;
    suggestions = [];
    active = -1;
    drawSniper();
  }
  function drawSniper() {
    const has = !!picked || !!cleanWish($('wish').value);
    $('picked').hidden = !picked;
    $('picked').innerHTML = picked ? `${face(picked, 'rb-face rb-face--xs')}<span>✓</span>` : '';
    $('clear').hidden = !has;
    node.classList.toggle('has-pick', !!picked);
    $('wish').disabled = busy || armed;
    drawSuggestions();
  }
  const onInput = () => {
    picked = null;
    suggestions = matchViewers(candidates(), $('wish').value);
    active = suggestions.length && suggestions[0].exact ? 0 : -1;
    drawSniper();
  };
  const onWishKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggestions.length) return;
      e.preventDefault();
      const n = suggestions.length;
      active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
      drawSuggestions();
    } else if (e.key === 'Enter' && active >= 0 && suggestions[active]) {
      e.preventDefault();
      pick(suggestions[active]);
    } else if (e.key === 'Escape' && suggestions.length) {
      e.stopPropagation();
      suggestions = [];
      drawSuggestions();
    }
  };
  const onSuggest = (e) => {
    const i = e.target.closest?.('[data-i]')?.dataset.i;
    if (i !== undefined) pick(suggestions[Number(i)]);
  };
  const onClear = () => {
    picked = null;
    $('wish').value = '';
    suggestions = [];
    drawSniper();
    $('wish').focus();
  };
  // A suggestion is clicked before the input loses focus (mousedown), never lost to the blur.
  const keepFocus = (e) => e.preventDefault();
  const onBlur = () => win.setTimeout(drawSuggestions, 0);
  const onFocus = () => drawSuggestions();

  /** What the purchase sends for the Sniper: the picked account, else the exact one, else the text as typed. */
  function wishInput() {
    const text = cleanWish($('wish').value);
    if (picked) return { wish_id: picked.id, wish_text: text || picked.name };
    if (!text) return {};
    const exact = exactViewer(candidates(), text);
    return exact ? { wish_id: exact.id, wish_text: text } : { wish_text: text };
  }

  // --- Launch: arm, confirm, send ----------------------------------------------------------------------------------
  function reason() {
    const state = st();
    const a = launch();
    if (!a) return 'unavailable';
    if (!a.available) return a.unavailable_reason;
    if (state && !state.identity) return 'identity_required';
    if (state && !state.ready) return 'rb_unavailable';
    if (state && state.pending >= state.max_pending) return 'too_many_pending';
    return null;
  }

  function drawButton() {
    const price = st()?.price?.price ?? null;
    const why = reason();
    const go = $('go');
    go.disabled = busy || !!why || price === null;
    go.classList.toggle('is-armed', armed);
    go.innerHTML = busy
      ? 'Envoi…'
      : armed
        ? `Confirmer <span>${esc(priceShort(price))}</span>`
        : `Lancer${price === null ? '' : ` <span>${esc(priceShort(price))}</span>`}`;
    if (!armed) $('msg').textContent = flash || (why && !busy ? reasonText(why) : '');
  }

  function draw() {
    if (stopped) return;
    drawPrice();
    drawButton();
    drawSniper();
    drawStage();
    if (!$('hist').hidden) drawHistory();
  }

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
    schedule();
  }
  /** Fast while one of my Random Ban runs (the reel waits for the Core's draw), slow otherwise. */
  function schedule() {
    win.clearTimeout(poll);
    if (stopped) return;
    const running =
      animating || (st()?.mine ?? []).some((r) => ['queued', 'searching', 'timeout_requested'].includes(r.status));
    poll = win.setTimeout(() => void refresh(), running ? 1000 : 4000);
  }

  function say(text, ms = 6000) {
    flash = text;
    $('msg').textContent = text;
    win.setTimeout(() => {
      if (flash !== text) return;
      flash = '';
      if (!stopped) drawButton();
    }, ms);
  }

  const onGo = async () => {
    const state = st();
    const price = state?.price?.price;
    if (busy || !Number.isInteger(price)) return;
    if (!armed) {
      armed = true;
      const wish = wishInput();
      const aim = wish.wish_id
        ? ` · 🎯 ${picked?.name ?? exactViewer(candidates(), wish.wish_text)?.name ?? wish.wish_text}`
        : wish.wish_text
          ? ` · 🎯 « ${wish.wish_text} » (à vérifier)`
          : '';
      $('msg').innerHTML =
        state.price.level > 0
          ? `<b class="rb__up">⬆ Prix en hausse : ${esc(priceText(price))}</b> (normal ${esc(priceShort(state.tiers?.[0] ?? price))})${esc(aim)}`
          : `Confirme : ${esc(priceText(price))}${esc(aim)}`;
      win.clearTimeout(disarm);
      disarm = win.setTimeout(() => {
        armed = false;
        draw();
      }, 5000);
      return draw();
    }
    win.clearTimeout(disarm);
    armed = false;
    busy = true;
    draw();
    const wish = wishInput();
    try {
      const out = await client.moduleAct(module.id, 'launch', { expected_price: price, ...wish }, intent.key());
      intent.close();
      const req = out?.activity?.result?.request;
      const paid = req?.price_paid;
      say(
        req?.sniper === 'unresolved'
          ? `Payé. Pronostic « ${wish.wish_text} » gardé : un modérateur le vérifiera.`
          : Number.isInteger(paid) && paid < price
            ? `Payé ${priceText(paid)} (le prix avait baissé).`
            : 'Payé · tirage en cours…',
      );
      picked = null;
      $('wish').value = '';
      setStage('spin');
    } catch (e) {
      if (!isRetryable(e)) intent.close();
      const code = e?.code ?? e?.message;
      say(
        code === 'price_changed'
          ? 'Ton prix a changé : rien n’a été débité. Vérifie le nouveau prix.'
          : isRetryable(e)
            ? 'Pas de réponse : réessaie, ta demande ne sera jamais payée deux fois.'
            : reasonText(code),
        8000,
      );
    } finally {
      busy = false;
      await refresh();
    }
  };

  // --- History: a secondary panel -------------------------------------------------------------------------------------
  function drawHistory() {
    const recent = st()?.recent ?? [];
    const me = st()?.mine?.[0]?.buyer?.id ?? null;
    $('histlist').innerHTML = recent.length
      ? recent
          .map((r) => {
            const l = historyLine(r);
            return `<li class="${r.buyer?.id === me ? 'is-me' : ''}" data-tone="${l.tone}"><span class="rb__hwho"><b>${esc(l.buyer)}</b>${
              l.target ? ` → <b>${esc(l.target)}</b>` : ''
            }</span><span class="rb__hres">${esc(l.result)}</span><small>${esc(l.meta)}${l.sniper ? ` · ${esc(l.sniper)}` : ''}</small></li>`;
          })
          .join('')
      : '<li class="rb__hnone">Aucun Random Ban pour l’instant.</li>';
  }
  function toggleHistory(open) {
    $('hist').hidden = !open;
    $('histbtn').setAttribute('aria-expanded', String(open));
    if (open) {
      drawHistory();
      $('histclose').focus();
    } else $('histbtn').focus();
  }
  const onHistBtn = () => toggleHistory($('hist').hidden);
  const onHistClose = () => toggleHistory(false);

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (!$('hist').hidden) return toggleHistory(false);
    if (armed) {
      armed = false;
      win.clearTimeout(disarm);
      draw();
    }
  };
  // A Twitch picture that does not load: the initials stay (never a broken image).
  const onImgError = (e) => {
    if (e.target?.tagName === 'IMG') e.target.remove();
  };

  const on = [
    [$('go'), 'click', onGo],
    [$('wish'), 'input', onInput],
    [$('wish'), 'keydown', onWishKey],
    [$('wish'), 'blur', onBlur],
    [$('wish'), 'focus', onFocus],
    [$('sugg'), 'mousedown', keepFocus],
    [$('sugg'), 'click', onSuggest],
    [$('clear'), 'click', onClear],
    [$('histbtn'), 'click', onHistBtn],
    [$('histclose'), 'click', onHistClose],
    [node, 'keydown', onKey],
  ];
  for (const [el, ev, fn] of on) el.addEventListener(ev, fn);
  node.addEventListener('error', onImgError, true);

  return {
    node,
    start() {
      stopped = false;
      void refresh();
      tick = win.setInterval(drawPrice, 1000);
    },
    destroy() {
      stopped = true;
      win.clearInterval(tick);
      win.clearTimeout(poll);
      win.clearTimeout(disarm);
      for (const [el, ev, fn] of on) el.removeEventListener(ev, fn);
      node.removeEventListener('error', onImgError, true);
    },
  };
}

/** The Hub's « Mini-jeux »: the games container, Random Ban first (the only game today). */
export function createRandomBanView({ document, client, module }) {
  ensureSheet(document);
  return createMiniGames({
    document,
    games: [
      {
        id: 'random_ban',
        label: 'Random Ban',
        icon: RB_ICON,
        create: () => createRandomBanGame({ document, client, module }),
      },
    ],
  });
}

registerViewerModule('random_ban_ext', createRandomBanView, {
  icon: '🎯',
  label: 'Mini-jeux',
  description: 'Random Ban : un viewer tiré au sort',
});
