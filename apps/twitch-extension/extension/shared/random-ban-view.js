// Mini-jeux › Random Ban V5 (13/11, docs/mini-jeux/UX_UI_MINI_JEUX.md § 0) — the game screen: the draw machine on the
// left (random-ban-machine.js), the player's controls on the right (charges gauge, Sniper, launch, last draws).
// A host module view (module-registry.js). The Core decides everything: the price, the charges, availability, the
// purchase, the draw and its target. This view shows `GET /modules/v3/random_ban/state` and sends `launch` with the
// price the viewer saw (input.expected_price: never charged above it). Purchase in one click is a per-device
// preference (off by default: a first click arms, a second pays). One key per intent (purchase.js): a double tap, a
// retry after a lost answer or a reconnection resend the SAME key — one Random Ban, one debit. The machine replays the
// Core's strip and stops on the Core's target: the extension never draws, and the Sniper never reaches the draw. The
// stream's ban alerts are Studio's own, untouched and never synchronised with this screen.

import { errorLabel } from './api.js';
import { createMiniGames } from './mini-games.js';
import { createMachine, face } from './random-ban-machine.js';
import { createChargesGauge } from './random-ban-gauge.js';
import { registerViewerModule } from './module-registry.js';
import { createIntent, isRetryable } from './purchase.js';
import {
  chargesModel,
  cleanWish,
  exactViewer,
  historyLine,
  matchViewers,
  priceShort,
  priceText,
  resultModel,
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

/** Random Ban's mark: a die (chance) in a scope (the aim). */
export const RB_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="3.2"/><circle cx="9.6" cy="9.6" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="14.4" cy="14.4" r="1" fill="currentColor" stroke="none"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/></svg>';

const REASONS = {
  module_disabled: 'Random Ban n’est pas encore ouvert.',
  rb_unavailable: 'Indisponible : le bot ne répond pas. Rien n’a été débité.',
  too_many_pending: 'Attends le résultat de tes Random Ban en cours.',
  identity_required: 'Partage ton identité Twitch pour jouer.',
  rb_paused: 'Random Ban est en pause. Rien n’a été débité.',
  viewer_blocked: 'Random Ban est indisponible pour ton compte.',
  viewer_cooldown: 'Délai personnel en cours. Rien n’a été débité.',
  no_charge: 'Plus de charge : attends la prochaine. Rien n’a été débité.',
  rb_busy: 'Trop de Random Ban en ce moment : réessaie un peu plus tard. Rien n’a été débité.',
  wish_unknown: 'Ce viewer n’est plus dans le chat : vise quelqu’un d’autre.',
  stream_offline: 'Random Ban se joue pendant le live.',
  unavailable: 'Random Ban est indisponible pour le moment.',
  offline: 'Connexion perdue : nouvelle tentative…',
};
const reasonText = (code) => REASONS[code] ?? errorLabel(code);

/** The requests already shown on this device (a refresh never replays a draw, a Sniper never celebrates twice). */
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

/** « Achat en un clic »: this device's choice (localStorage; memory only when storage is blocked). */
function prefStore(win, key) {
  let on = false;
  try {
    on = win.localStorage.getItem(key) === '1';
  } catch {
    /* memory only */
  }
  return {
    get: () => on,
    set(v) {
      on = !!v;
      try {
        win.localStorage.setItem(key, on ? '1' : '0');
      } catch {
        /* memory only */
      }
    },
  };
}

const REPLAY_WINDOW_MS = 90_000;
const RESULT_HOLD_MS = 10_000;
const OPEN = ['queued', 'searching', 'timeout_requested'];

export function createRandomBanGame({ document, client, module, back = null }) {
  ensureSheet(document);
  const win = document.defaultView ?? globalThis;
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const machine = createMachine(document, { reduced });
  const gauge = createChargesGauge(document, { reducedMotion: reduced });
  const node = document.createElement('div');
  node.className = 'rb';
  node.innerHTML = `
    <header class="rb__bar">
      <span class="rb__head">
        ${back ? '<button type="button" class="rb__back" data-k="back" aria-label="Retour aux Mini-jeux"><span aria-hidden="true">‹</span> Jeux</button>' : ''}
        <span class="rb__title"><span class="rb__logo">${RB_ICON}</span><b>Random Ban</b></span>
      </span>
      <span class="rb__tools">
        <span class="rb__gauge" data-k="gauge"></span>
        <button type="button" class="rb__info" data-k="infobtn" aria-expanded="false" aria-label="Comment ça marche">?</button>
      </span>
    </header>
    <div class="rb__body">
      <div class="rb__left" data-k="left"></div>
      <div class="rb__right">
        <div class="rb__play">
          <div class="rb__sniper" data-k="sniper">
            <span class="rb__scope" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg></span>
            <input class="rb__input" data-k="wish" type="text" maxlength="40" autocomplete="off" spellcheck="false"
              role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="rb-sugg"
              aria-label="Sniper : le viewer que tu prédis (facultatif)" placeholder="Sniper : @pseudo">
            <span class="rb__snhint" data-k="snhint" hidden></span>
            <span class="rb__picked" data-k="picked" hidden></span>
            <button type="button" class="rb__clear" data-k="clear" aria-label="Effacer le Sniper" hidden>×</button>
            <ul class="rb__sugg" id="rb-sugg" role="listbox" data-k="sugg" hidden></ul>
          </div>
          <button type="button" class="rb__go" data-k="go" disabled>Lancer</button>
        </div>
        <p class="rb__msg" data-k="msg" role="status"></p>
        <section class="rb__recent" aria-label="Derniers tirages">
          <header><b>Derniers tirages</b><button type="button" class="rb__all" data-k="histbtn" aria-expanded="false">Tout voir</button></header>
          <ul data-k="recent"></ul>
        </section>
      </div>
    </div>
    <div class="rb__sheet" data-k="hist" hidden role="dialog" aria-label="Derniers Random Ban">
      <div class="rb__sheethead"><b>Derniers Random Ban</b><button type="button" class="rb__x" data-k="histclose" aria-label="Fermer">×</button></div>
      <ul class="rb__histlist" data-k="histlist"></ul>
    </div>
    <div class="rb__sheet rb__sheet--info" data-k="info" hidden role="dialog" aria-label="Comment ça marche">
      <div class="rb__sheethead"><b>Comment ça marche</b><button type="button" class="rb__x" data-k="infoclose" aria-label="Fermer">×</button></div>
      <ul class="rb__rules" data-k="rules"></ul>
      <label class="rb__pref"><input type="checkbox" data-k="oneclick"> <span><b>Achat en un clic</b><small>Sans demande de confirmation. Le prix reste affiché sur le bouton ; un double clic ne paie jamais deux fois.</small></span></label>
    </div>`;
  const $ = (k) => node.querySelector(`[data-k="${k}"]`);
  $('left').append(machine.node);
  $('gauge').append(gauge.node);
  const intent = createIntent();
  const played = seenStore(win, 'rb:played');
  const celebrated = seenStore(win, 'rb:sniper');
  const oneClick = prefStore(win, 'rb:oneclick');
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
  let animating = null; // request id whose draw the machine replays
  let shown = null; // request id the machine shows (after its draw)
  let shownAt = 0;
  let flash = ''; // the message of the last action, kept a few seconds over the state's own
  let offline = false; // the last read failed: the last state stays shown, nothing can be bought
  let armedPrice = null; // the price the first click armed (a change disarms: never a price the player did not see)
  let armedAt = 0; // a double click is not a confirmation
  let calmUntil = 0; // just after a purchase: a stray extra click never starts another one

  const st = () => s?.state ?? null;
  const launch = () => s?.actions?.find((a) => a.name === 'launch') ?? null;
  const serverNow = () => {
    const at = st()?.charges?.server_now;
    return at ? Date.parse(at) + (Date.now() - readAt) : Date.now();
  };
  const age = (r) => serverNow() - Date.parse(r.created_at);
  const candidates = () => st()?.candidates ?? [];
  const avatarOf = (r, id) =>
    r?.strip?.items?.find((x) => x.id === id)?.avatar ?? candidates().find((x) => x.id === id)?.avatar ?? null;

  // --- The machine ------------------------------------------------------------------------------------------------------
  async function play(r) {
    animating = r.request_id;
    played.add(r.request_id);
    flash = ''; // « tirage en cours… » is over: the machine tells the rest
    drawButton();
    await machine.play(r.strip);
    if (stopped) return;
    animating = null;
    shown = r.request_id;
    shownAt = Date.now();
    draw();
  }

  function result(r) {
    const m = resultModel(r);
    machine.result(r.target ? { ...r.target, avatar: avatarOf(r, r.target.id) } : null, m);
    // Sniper hit: celebrated once per request on this device (the bonus itself was paid once by the Core).
    if (m.sniper?.hit && !celebrated.has(r.request_id)) {
      celebrated.add(r.request_id);
      machine.sniped();
    }
  }

  function drawMachine() {
    if (animating) return; // the machine replays a draw until it stops
    const mine = st()?.mine ?? [];
    // Next draw to replay: the oldest of mine not shown yet on this device (two purchases: one after the other).
    const next = [...mine]
      .reverse()
      .find((r) => r.strip?.items?.length && !played.has(r.request_id) && age(r) < REPLAY_WINDOW_MS);
    if (next) return void play(next);
    for (const r of mine) if (r.strip && !played.has(r.request_id)) played.add(r.request_id); // too old: no replay
    const open = mine.find((r) => ['queued', 'searching'].includes(r.status));
    const current = mine.find((r) => r.request_id === shown);
    if (current && !open && (current.status === 'timeout_requested' || Date.now() - shownAt < RESULT_HOLD_MS))
      return result(current);
    // A result without a draw to replay (nobody eligible, refused, canceled): the card, for a few seconds.
    const fresh = mine.find(
      (r) => !r.strip && !['queued', 'searching'].includes(r.status) && age(r) < 20_000 && !played.has(r.request_id),
    );
    if (fresh && !open) {
      played.add(fresh.request_id);
      shown = fresh.request_id;
      shownAt = Date.now();
      return result(fresh);
    }
    const pool = candidates();
    if (open) return machine.spin(pool);
    shown = null;
    machine.idle(pool, pool.length ? 'Prêt' : 'Personne dans le chat');
  }

  const charges = () => chargesModel(st()?.charges, readAt, Date.now(), { reducedMotion: reduced });
  const mmss = (ms) => {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };

  /** The line under the machine: the one thing the player should know now (never two mechanisms mixed). */
  function drawInfo() {
    const state = st();
    const mine = state?.mine ?? [];
    const r = state?.restriction;
    const left = (ms) => {
      const sec = Math.max(0, Math.ceil((ms - (Date.now() - readAt)) / 1000));
      return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    };
    const run = mine.find((x) => OPEN.includes(x.status));
    const pool = candidates().length;
    let text = `${pool} viewer${pool > 1 ? 's' : ''} dans le viseur`;
    let tone = '';
    if (offline) [text, tone] = ['Connexion perdue · nouvelle tentative…', 'bad'];
    else if (!state) [text, tone] = ['Lecture…', ''];
    else if (!state.identity) [text, tone] = [reasonText('identity_required'), 'warn'];
    else if (state.live === false) [text, tone] = [reasonText('stream_offline'), 'warn'];
    else if (r?.code === 'rb_paused') [text, tone] = ['Random Ban est en pause (modération).', 'warn'];
    else if (r?.code === 'viewer_blocked') [text, tone] = ['Random Ban est bloqué pour ton compte (modération).', 'bad'];
    else if (r?.code === 'viewer_cooldown')
      [text, tone] = [`Délai fixé par la modération : encore ${left(r.wait_ms ?? 0)}`, 'warn'];
    else if (r?.code === 'rb_busy')
      [text, tone] = [`Trop de Random Ban en ce moment : encore ${left(r.wait_ms ?? 0)}`, 'warn'];
    else if (!state.ready) [text, tone] = ['Le bot ne répond pas : rien ne serait débité.', 'bad'];
    else if (run)
      [text, tone] = [
        run.status === 'queued'
          ? 'Ta demande attend son tour…'
          : run.status === 'searching'
            ? 'Le serveur cherche un viewer…'
            : 'Sanction envoyée à Twitch…',
        'wait',
      ];
    else if (charges() && charges().available < 1)
      [text, tone] = [`Plus de charge · la prochaine dans ${mmss(charges().next_in_ms)}`, 'warn'];
    machine.info(text, tone);
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
    node.classList.toggle('has-wish', has && !picked);
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
    } else if ((e.key === 'Enter' || e.key === 'Tab') && active >= 0 && suggestions[active]) {
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

  /** The Sniper's own window (its bonus), never mixed with the price or a moderation delay. */
  function drawSnHint() {
    const sn = st()?.sniper;
    const hint = $('snhint');
    const at = sn && !sn.ready && sn.ready_at ? Date.parse(sn.ready_at) - serverNow() : 0;
    hint.hidden = !(at > 0) || !!picked;
    if (at > 0) {
      const min = Math.ceil(at / 60_000);
      hint.textContent = `prime dans ${min} min`;
      hint.title = `Sniper pour la gloire d’ici là : la prime de ${priceText(sn.bonus)} revient ${min} min après ton dernier Random Ban.`;
    }
  }

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
    if (offline) return 'offline';
    if (!a) return 'unavailable';
    if (!a.available) return a.unavailable_reason;
    if (state && !state.identity) return 'identity_required';
    if (state?.live === false) return 'stream_offline';
    if (state?.restriction) return state.restriction.code;
    if (state && !state.ready) return 'rb_unavailable';
    if (state && state.pending >= state.max_pending) return 'too_many_pending';
    if (charges() && charges().available < 1) return 'no_charge';
    return null;
  }

  function drawButton() {
    const p = st()?.price;
    const price = Number.isInteger(p) ? p : null;
    const why = reason();
    const go = $('go');
    go.disabled = busy || !!why || price === null;
    go.classList.toggle('is-armed', armed);
    go.innerHTML = busy
      ? 'Envoi…'
      : armed
        ? `Confirmer <span>${esc(priceShort(price))}</span>`
        : `Lancer${price === null ? '' : ` <span>${esc(priceShort(price))}</span>`}`;
    go.setAttribute(
      'aria-label',
      armed ? `Confirmer : payer ${priceText(price)}` : price === null ? 'Lancer' : `Lancer un Random Ban pour ${priceText(price)}`,
    );
    if (!armed) $('msg').textContent = flash;
  }

  function drawRecent() {
    const recent = st()?.recent ?? [];
    $('recent').innerHTML = recent.length
      ? recent
          .slice(0, 6)
          .map((r) => {
            const l = historyLine(r);
            const via = l.meta ? l.meta.split(' · ').pop() : '';
            const hit = r.sniper === 'hit' || r.sniper === 'glory_hit';
            return `<li data-tone="${l.tone}">${face({ name: r.target?.name ?? '?', avatar: avatarOf(r, r.target?.id) }, 'rb-face rb-face--xs')}<span class="rb__rl"><b>${esc(l.target ?? 'Personne')}</b><small>par ${esc(l.buyer)}${via ? ` · ${esc(via)}` : ''}</small></span><span class="rb__rr">${
              hit ? '<i class="rb__hitdot" title="Sniper réussi">◎</i>' : ''
            }<span class="rb__pill">${esc(l.result)}</span></span></li>`;
          })
          .join('')
      : '<li class="rb__none">Aucun tirage pour l’instant.</li>';
  }

  function drawRules() {
    const sn = st()?.sniper;
    $('rules').innerHTML = [
      'Le serveur tire au sort un viewer présent dans le chat (toi compris, avec 4 fois moins de chances).',
      'Timeout de 3 min pour un abonné, 5 min sinon. Si rien ne se passe, tu es remboursé.',
      `Prix fixe : ${priceText(st()?.price ?? 25000)} ici et avec !rb, 3 000 points de chaîne avec la récompense.`,
      st()?.charges?.max > 0
        ? `${st().charges.max} charges au plus, communes à l’extension, !rb et aux points de chaîne : un Random Ban lancé en utilise une, une charge revient toutes les ${Math.round(st().charges.recharge_ms / 60_000)} min.`
        : 'Aucune limite de charges pour le moment.',
      `Sniper (facultatif) : prédis la personne tirée. Il ne change jamais le tirage. Touché : +${priceText(sn?.bonus ?? 2000)}${
        sn?.window_ms ? ` (au plus une prime toutes les ${Math.round(sn.window_ms / 60_000)} min)` : ''
      }.`,
    ]
      .map((t) => `<li>${esc(t)}</li>`)
      .join('');
  }

  function draw() {
    if (stopped) return;
    const m = gauge.update(st(), readAt);
    if (m?.stale) void refresh();
    // The price moved while armed (Studio changed it): disarmed, the new price shown before any payment.
    if (armed && st()?.price !== armedPrice) {
      armed = false;
      win.clearTimeout(disarm);
      say('Ton prix a changé : vérifie le nouveau montant avant de lancer.');
    }
    drawButton();
    drawInfo();
    drawSnHint();
    drawSniper();
    drawMachine();
    drawRecent();
    if (!$('hist').hidden) drawHistory();
  }

  async function refresh() {
    try {
      const next = await client.moduleState(module.id);
      if (stopped) return;
      s = next;
      readAt = Date.now();
      offline = false;
    } catch {
      if (stopped) return;
      // The last state stays on screen (no blank game), but nothing can be bought until a read succeeds again.
      offline = true;
    }
    draw();
    schedule();
  }
  /** Fast while one of my Random Ban runs (the machine waits for the Core's draw), slow otherwise. */
  function schedule() {
    win.clearTimeout(poll);
    if (stopped) return;
    const running = animating || (st()?.mine ?? []).some((r) => OPEN.includes(r.status));
    poll = win.setTimeout(() => void refresh(), offline ? 3000 : running ? 1000 : 4000);
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
    const price = state?.price;
    if (busy || !Number.isInteger(price) || Date.now() < calmUntil) return;
    if (!armed && !oneClick.get()) {
      armed = true;
      armedPrice = price;
      armedAt = Date.now();
      const wish = wishInput();
      const aim = wish.wish_id
        ? ` · vise ${picked?.name ?? exactViewer(candidates(), wish.wish_text)?.name ?? wish.wish_text}`
        : wish.wish_text
          ? ` · vise « ${wish.wish_text} » (à vérifier)`
          : '';
      $('msg').innerHTML = `Confirme pour payer ${esc(priceText(price))}${esc(aim)} <button type="button" class="rb__once" data-k="once">Ne plus demander</button>`;
      win.clearTimeout(disarm);
      disarm = win.setTimeout(() => {
        armed = false;
        draw();
      }, 5000);
      return draw();
    }
    if (armed && Date.now() - armedAt < 350) return; // a double click arms, it never pays
    win.clearTimeout(disarm);
    armed = false;
    busy = true;
    draw();
    const wish = wishInput();
    try {
      const out = await client.moduleAct(module.id, 'launch', { expected_price: price, ...wish }, intent.key());
      intent.close();
      const req = out?.activity?.result?.request;
      say(
        req?.sniper === 'unresolved'
          ? `Payé. « ${wish.wish_text} » sera vérifié par un modérateur.`
          : 'Payé · tirage en cours…',
      );
      picked = null;
      $('wish').value = '';
      machine.spin(candidates());
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
      calmUntil = Date.now() + 800;
      await refresh();
    }
  };
  /** « Ne plus demander » (in the confirmation) and the setting in « Comment ça marche ». */
  const onMsgClick = (e) => {
    if (!e.target.closest?.('[data-k="once"]')) return;
    oneClick.set(true);
    armed = false;
    win.clearTimeout(disarm);
    $('oneclick').checked = true;
    say('Achat en un clic activé. Tu peux le retirer dans « ? ».');
    drawButton();
  };
  const onPref = () => {
    oneClick.set($('oneclick').checked);
    drawButton();
  };

  // --- Sheets: the full history, the rules ----------------------------------------------------------------------------
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
      : '<li class="rb__none">Aucun Random Ban pour l’instant.</li>';
  }
  function sheet(k, open, opener) {
    $(k).hidden = !open;
    $(opener).setAttribute('aria-expanded', String(open));
    if (open) $(k).querySelector('.rb__x').focus();
    else $(opener).focus();
  }
  const onHistBtn = () => {
    drawHistory();
    sheet('hist', $('hist').hidden, 'histbtn');
  };
  const onHistClose = () => sheet('hist', false, 'histbtn');
  const onInfo = () => {
    drawRules();
    $('oneclick').checked = oneClick.get();
    sheet('info', $('info').hidden, 'infobtn');
  };
  const onInfoClose = () => sheet('info', false, 'infobtn');
  const onBack = () => back?.();

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (!$('hist').hidden) return onHistClose();
    if (!$('info').hidden) return onInfoClose();
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
    [$('infobtn'), 'click', onInfo],
    [$('infoclose'), 'click', onInfoClose],
    [$('msg'), 'click', onMsgClick],
    [$('oneclick'), 'change', onPref],
    [node, 'keydown', onKey],
    ...(back ? [[$('back'), 'click', onBack]] : []),
  ];
  for (const [el, ev, fn] of on) el.addEventListener(ev, fn);
  node.addEventListener('error', onImgError, true);

  return {
    node,
    start() {
      stopped = false;
      void refresh();
      // The gauge slides continuously (several frames a second, eased by CSS); the amounts stay the Core's.
      tick = win.setInterval(() => {
        const m = gauge.update(st(), readAt);
        if (m?.stale) void refresh();
        // A moderation delay, the channel's limit or the next charge counts down.
        if (st()?.restriction?.wait_ms || (m && m.available < 1)) drawInfo();
      }, 250);
    },
    destroy() {
      stopped = true;
      win.clearInterval(tick);
      win.clearTimeout(poll);
      win.clearTimeout(disarm);
      machine.destroy();
      gauge.destroy();
      for (const [el, ev, fn] of on) el.removeEventListener(ev, fn);
      node.removeEventListener('error', onImgError, true);
    },
  };
}

/** The Hub's « Mini-jeux »: its catalog, Random Ban the first game. */
export function createRandomBanView({ document, client, module }) {
  ensureSheet(document);
  return createMiniGames({
    document,
    games: [
      {
        id: 'random_ban',
        label: 'Random Ban',
        tagline: 'Un viewer tiré au sort, exclu quelques minutes. Vise juste avec le Sniper.',
        icon: RB_ICON,
        create: ({ back }) => createRandomBanGame({ document, client, module, back }),
        async peek() {
          const st = (await client.moduleState(module.id))?.state;
          if (!Number.isInteger(st?.price)) return null;
          const last = st.recent?.[0];
          const c = st.charges?.max > 0 ? `Charges : ${st.charges.available}/${st.charges.max}` : priceShort(st.price);
          return `${c}${last?.target ? ` · dernier : ${last.target.name}` : ''}`;
        },
      },
    ],
  });
}

registerViewerModule('random_ban_ext', createRandomBanView, {
  icon: '🎲',
  label: 'Mini-jeux',
  description: 'Random Ban et les jeux du stream',
});
