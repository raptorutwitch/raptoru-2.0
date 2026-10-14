// TTS V2 — viewer module (D3 UX validated on 2026-09-30, ported from
// `prototypes/tts-v2-extension-ux/d3.html` without redesign: same composition, fixed big card,
// straight horizontal shuffle, cast info block, dense final screen).
//
// What changes from the prototype is only where the data comes from:
//   - price, cooldown, availability, queue and the cast { character_id, voice_profile_id } come
//     from Core (through the EBS); nothing is drawn or priced here;
//   - the shuffle only animates towards the cast Core already decided;
//   - one idempotency key per confirmed message, persisted before sending and reused on every
//     retry / refresh: a message is never paid twice;
//   - after a refresh, the current TTS is found again from the viewer state.
// The view is persistent (created once per opening of the module): the host re-appends the same
// node on each render, so an animation in progress is never restarted by a poll.
import { CHARACTERS, CHARACTERS_BY_ID, resolveCast, voiceTraits } from './tts-characters.js';
import { createCalibration } from './tts-calibration.js';
import { errorLabel, newIdempotencyKey } from './api.js';

// Durations (ms): validation, shuffle, winner highlight, roster leaving, cast block, final recomposition.
const T = { validate: 220, shuffle: 880, flash: 300, leave: 300, cast: 640, hold: 1150 };
const REVEAL_END = T.validate + T.shuffle + T.flash;
const QUEUED_AT = REVEAL_END + T.hold;
const OPEN = ['queued', 'starting', 'playing'];
const POLL_MS = 2000;
const IDS = CHARACTERS.map((c) => c.id);
const byId = CHARACTERS_BY_ID;

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n).toLocaleString('fr-FR');
const codePoints = (t) => Array.from(String(t || '')).length;
/** Legacy cleanup (same as Core): control characters → spaces, whitespace collapsed. */
// eslint-disable-next-line no-control-regex -- control characters are stripped on purpose
const normalize = (raw) => String(raw ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/gu, ' ').replace(/\s+/gu, ' ').trim();
const secs = (s) => (s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${String(s % 60).padStart(2, '0')}` : ''}` : `${s} s`);
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const priceText = (cur, n) => (cur === 'credits' ? `${n} crédit${n > 1 ? 's' : ''}` : `${fmt(n)} J`);
/** Stable shuffle seed of a transaction (a refresh replays the same strip). */
const seedOf = (id) => { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 2147483647; return h || 7; };

const icons = {
  check: '<path d="m5 12 5 5 9-10"/>',
  voice: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
};
const ic = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n]}</svg>`;

const TTS_ERRORS = {
  tts_disabled: 'TTS désactivé',
  tts_paused: 'TTS en pause · rien n’a été débité',
  empty_message: 'Écris un message',
  message_too_long: 'Message trop long',
  message_unreadable: 'Rien à lire dans ce message',
  viewer_blocked: 'TTS indisponible pour ton compte',
  viewer_cooldown: 'Cooldown en cours · rien n’a été débité',
  global_pause: 'Raptoru en pause · rien n’a été débité',
  message_blocked: 'Mot interdit dans le message · rien n’a été débité',
  viewer_busy: 'Ton TTS précédent n’est pas encore terminé',
  queue_full: 'File pleine · réessaie bientôt',
  studio_offline: 'TTS indisponible pour le moment',
  player_offline: 'TTS indisponible pour le moment',
  insufficient_tokens: 'Jetons insuffisants',
  insufficient_credits: 'Crédits TTS insuffisants',
  idempotency_conflict: 'Envoi déjà utilisé : réessaie',
};
const ttsError = (code) => TTS_ERRORS[code] || errorLabel(code);
/** Only these leave the admission uncertain: the same key is sent again, never a new one. */
const UNCERTAIN = new Set(['network_error', 'http_error', 'core_unavailable', undefined]);

/** Surface of the current page (same breakpoints as the prototype, from the real page classes). */
export function ttsV2Surface(doc) {
  const b = doc.body.classList;
  if (b.contains('overlay')) return b.contains('component-view') ? 'video' : 'panel';
  return b.contains('panel-view') ? 'panel' : 'mobile';
}

let sharedCalibration = null;

/**
 * @param {{
 *   document: Document, client: object, surface: 'panel'|'video'|'mobile', assetBase: string,
 *   lab?: boolean,
 *   onPaymentMethod?: (method: string, locked: boolean) => void,
 *   onPurchased?: () => void,
 *   onBack?: () => void,
 * }} options
 */
export function createTtsV2View({ document, client, surface, assetBase, lab = false, onPaymentMethod, onPurchased, onBack }) {
  const win = document.defaultView;
  const CAL = (sharedCalibration ??= createCalibration({ document, assetBase, allowLocalOverride: lab }));
  const REDUCE = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const MAX_TRAITS = surface === 'video' ? 2 : 3;
  const node = document.createElement('div');
  node.className = 'ttsv2';
  node.dataset.surface = surface;

  const S = { text: '', currency: 'tokens', phase: 'compose' };
  let rules = null;
  let moduleState = 'active';
  let viewer = null; // Core viewer state (null = unknown / unreachable)
  let viewerAt = 0;
  let wallet = { tokens: null, credits: null };
  let storeKey = null;
  let tx = null; // { key, text, currency, interaction, queue, animAt }
  let hint = '';
  let hintFrom = ''; // kind of `hint` when it comes from a Core refusal (busy / cooldown)
  let ghost = null; // visual preselection only: never sent, never stored, no effect on the draw
  let startVisual = null;
  let pollTimer = null;
  let destroyed = false;
  let recovered = false;
  let sending = false;
  const timers = new Set();
  const later = (ms, fn) => { const t = win.setTimeout(() => { timers.delete(t); if (!destroyed) fn(); }, Math.max(0, ms)); timers.add(t); };

  // --- local record of the transaction (the key, never the price or the cast) ----------------------------
  const readStore = () => { try { return JSON.parse(win.localStorage.getItem(storeKey) || 'null') || {}; } catch { return {}; } };
  const writeStore = (patch) => { if (!storeKey) return; try { win.localStorage.setItem(storeKey, JSON.stringify({ ...readStore(), ...patch })); } catch { /* unavailable: in memory only */ } };

  // --- Core data -----------------------------------------------------------------------------------------
  function quote(text = S.text) {
    const length = codePoints(normalize(text));
    const tiers = rules?.tiers ?? [];
    // Empty message: first tier's price, as in D3 (the CTA stays disabled until there is text).
    const n = Math.max(1, length);
    const tier = tiers.find((t) => n >= t.min && (t.max === null || n <= t.max)) ?? null;
    const speech = rules?.speech ?? { chars_per_second: 13.5, overhead_ms: 2400 };
    return {
      length,
      over: Boolean(rules) && length > rules.max_chars,
      tier,
      tokens: tier ? tier.price : 0,
      credits: tier ? tier.credit_cost : 0,
      durationS: length ? Math.round((speech.overhead_ms + (length / speech.chars_per_second) * 1000) / 1000) : 0,
      cooldownS: tier ? tier.cooldown_seconds : 0,
    };
  }
  const priceOf = (qt) => (S.currency === 'credits' ? qt.credits : qt.tokens);
  const cooldownLeft = () => (viewer ? Math.max(0, viewer.cooldown_remaining_ms - (Date.now() - viewerAt)) : 0);

  /** Reason that prevents sending (null = possible). Everything blocks BEFORE any payment. */
  function blocker(qt = quote()) {
    if (moduleState === 'disabled') return { kind: 'pause', text: 'TTS désactivé' };
    if (moduleState === 'paused') return { kind: 'pause', text: 'TTS en pause' };
    if (!viewer) return { kind: 'pause', text: 'TTS indisponible pour le moment' };
    if (viewer.blocked) return { kind: 'pause', text: 'TTS indisponible pour ton compte' };
    if (viewer.player_offline) return { kind: 'pause', text: 'TTS indisponible pour le moment' };
    if (cooldownLeft() > 0) return { kind: 'cooldown', text: `Prochain TTS dans ${mmss(cooldownLeft())}` };
    if (viewer.viewer_busy) return { kind: 'busy', text: 'Ton TTS précédent n’est pas encore terminé' };
    if (viewer.queue_full) return { kind: 'full', text: 'File pleine · réessaie bientôt' };
    if (sending || readStore().pending) return { kind: 'busy', text: 'Vérification de ton envoi…' };
    if (!qt.length) return { kind: 'empty', text: '' };
    if (qt.over) return { kind: 'over', text: `Trop long : ${fmt(rules.max_chars)} caractères maximum` };
    const need = priceOf(qt);
    if (S.currency === 'credits') {
      if (wallet.credits === null) return { kind: 'credits', text: 'Crédits TTS indisponibles' };
      if (wallet.credits < need) return { kind: 'credits', text: `Il te manque ${need - wallet.credits} crédit${need - wallet.credits > 1 ? 's' : ''} TTS` };
    } else {
      if (wallet.tokens === null) return { kind: 'tokens', text: 'Solde de jetons indisponible' };
      if (wallet.tokens < need) return { kind: 'tokens', text: `Il te manque ${fmt(need - wallet.tokens)} J` };
    }
    return null;
  }
  /** Kind of the shown hint (busy ≠ cooldown, told apart visually). */
  function hintKind() {
    if (hint) return hintFrom;
    const b = blocker();
    return !b || b.kind === 'empty' ? '' : b.kind;
  }
  function hintText() {
    if (hint) return hint;
    const b = blocker();
    return !b || b.kind === 'empty' ? '' : b.text;
  }

  // --- cast info (from the real VoiceProfile, labels derived, never hardcoded per character) --------------
  const castInfo = (cast) => {
    const r = resolveCast(cast);
    return r.ok ? { character: r.character, voice: r.voice, category: r.category, traits: voiceTraits(r.voice, r.category) } : null;
  };
  function castBlock() {
    const info = tx?.interaction && castInfo(tx.interaction.cast);
    if (!info) return '';
    const traits = info.traits.slice(0, MAX_TRAITS);
    return `<div class="cast" data-cast style="--c:${info.character.accent}"><div class="cast__who">Lu par <b>${esc(info.character.displayName)}</b><span class="cast__voice">${ic('voice')}${esc(info.voice.label)}</span></div>
      <div class="cast__row">${traits.map((t, i) => `<span class="trait" style="--i:${i}">${esc(t)}</span>`).join('')}</div></div>`;
  }

  // --- fragments (D3) ------------------------------------------------------------------------------------
  function factsLine(text) {
    const qt = quote(text);
    if (!qt.length) return `<div class="facts-line" data-slot="meta"><span class="faint">Lecture estimée —</span><span class="faint">Cooldown —</span></div>`;
    return `<div class="facts-line" data-slot="meta"><span>Lecture estimée <b>${secs(qt.durationS)}</b></span><span>Cooldown <b>${secs(qt.cooldownS)}</b></span></div>`;
  }
  const composer = (rows) => {
    const qt = quote();
    const max = rules?.max_chars ?? 0;
    return `<div class="composer"><textarea data-msg data-draft-key="tts-v2-text" rows="${rows}" maxlength="${max * 2}" placeholder="Ton message…" aria-label="Message TTS">${esc(S.text)}</textarea>
      <span class="count tnum${qt.over ? ' is-over' : ''}" data-slot="count">${fmt(qt.length)}/${fmt(max)}</span></div>`;
  };
  // Monnaie : un seul bouton (validé le 14/10/2026, esprit du wallet) — il montre la monnaie choisie et
  // passe à l'autre au clic (Entrée / Espace au clavier). La logique de paiement ne change pas.
  const CUR = {
    tokens: { glyph: '◆', label: 'Jetons', long: 'Jetons' },
    credits: { glyph: '✦', label: 'Crédits', long: 'crédits TTS' },
  };
  const curTitle = (c) => `Payer en ${CUR[c].long} · cliquer pour payer en ${CUR[c === 'tokens' ? 'credits' : 'tokens'].long}`;
  const curToggle = () => {
    const c = S.currency;
    return `<button type="button" class="cur" data-act="cur-toggle" data-cur="${c}" title="${curTitle(c)}" aria-label="${curTitle(c)}"><i class="coin coin--${c}" aria-hidden="true">${CUR[c].glyph}</i><span class="cur__label">${CUR[c].label}</span></button>`;
  };
  /** Bouton monnaie mis à jour sur place (le focus clavier reste dessus). */
  function syncCur(button) {
    const c = S.currency;
    button.dataset.cur = c;
    button.title = curTitle(c);
    button.setAttribute('aria-label', curTitle(c));
    const coin = button.querySelector('.coin');
    coin.className = `coin coin--${c}`;
    coin.textContent = CUR[c].glyph;
    button.querySelector('.cur__label').textContent = CUR[c].label;
  }
  function payBlock() {
    const qt = quote();
    return `<div class="pay" data-cur="${S.currency}"><div class="pay__row">${curToggle()}
      <button class="cta" type="button" data-act="confirm" data-slot="pay" ${blocker() ? 'disabled' : ''}>Confirmer · <span class="cta__price">${priceText(S.currency, priceOf(qt))}</span></button></div>
      <p class="pay-hint" data-slot="pay-hint" data-kind="${hintKind()}" role="status">${esc(hintText())}</p></div>`;
  }
  const ghostCard = () => `<div class="ghost${ghost ? ' has-char' : ''}" data-ghost ${ghost ? `style="--c:${byId[ghost].accent}"` : ''} aria-hidden="true"></div>`;
  const winCard = (final) => {
    const c = byId[tx.interaction.cast.character_id];
    return `<div class="card" style="--c:${c.accent}" aria-label="${final ? 'Lu par' : 'Ton message sera lu par'} ${esc(c.displayName)}"><span data-cal="card" data-animated data-char="${c.id}"></span></div>`;
  };
  const zoneHtml = () => {
    if (S.phase === 'validating') return `<div class="ghost is-draw is-validating" data-ghost data-zone aria-hidden="true"></div>`;
    if (S.phase === 'shuffle') return `<div class="ghost is-draw" data-zone data-shuffle-stage aria-hidden="true"></div>`;
    return `<div class="ghost is-draw is-won" data-zone style="--c:${byId[tx.interaction.cast.character_id].accent}">${winCard(S.phase === 'queued')}</div>`;
  };
  const roster = (arrows, dim) => `<div class="roster${dim ? ' is-dim' : ''}" ${dim ? 'aria-hidden="true"' : ''}><div class="roster__title">Personnages</div>
    <div class="roster__row" data-roster tabindex="${dim ? '-1' : '0'}" role="group" aria-label="Personnages (aperçu seulement, le lecteur reste tiré au sort)">${arrows ? '<button type="button" class="nav" data-act="ghost-step" data-step="-1" aria-label="Personnage précédent">‹</button>' : ''}
    ${CHARACTERS.map((c) => `<button type="button" class="pick" data-act="ghost-pick" data-char="${c.id}" style="--c:${c.accent}" aria-pressed="${!dim && ghost === c.id}" ${dim ? 'tabindex="-1" disabled' : ''} aria-label="Aperçu ${esc(c.displayName)}" title="${esc(c.displayName)}"></button>`).join('')}
    ${arrows ? '<button type="button" class="nav" data-act="ghost-step" data-step="1" aria-label="Personnage suivant">›</button>' : ''}</div></div>`;
  const paidAmount = () => priceText(tx.currency, tx.interaction ? tx.interaction.simulated_cost : priceOf(quote(tx.text)));
  function txStatus() {
    if (S.phase === 'validating') return `<div class="tx" data-slot="tx"><span class="tx__icon"><i class="spin"></i></span><span>Validation…</span></div>`;
    return `<div class="tx tx--ok" data-slot="tx"><span class="tx__icon">${ic('check')}</span><span>Payé · ${paidAmount()}</span></div>`;
  }
  // Live state of the transaction, in the D3 slots (title, position, planned reading, paid line).
  function live() {
    const i = tx.interaction;
    const q = tx.queue ?? { position: null, wait_ms: null };
    const refunded = i.refund_status === 'refunded';
    const title = refunded
      ? 'Remboursé'
      : { queued: 'Ajouté à la file', starting: 'En lecture', playing: 'En lecture', completed: 'Message lu', cancelled: 'Annulé par la modération' }[i.status] ?? 'Lecture non confirmée';
    const position = i.status === 'queued' && q.position ? `#${q.position}` : '—';
    const wait = i.status === 'queued' && q.wait_ms !== null
      ? (q.wait_ms < 2000 ? 'Imminente' : `≈ ${secs(Math.round(q.wait_ms / 1000))}`)
      : i.status === 'starting' || i.status === 'playing' ? 'En cours' : '—';
    return { title, position, wait, refunded };
  }
  function finalTop(video) {
    const qt = quote(tx.text);
    const L = live();
    const one = tx.currency === 'credits' && tx.interaction.simulated_cost === 1;
    const paid = L.refunded
      ? `<p class="paid">${paidAmount()} ${one ? 'remboursé' : 'remboursés'}</p>`
      : `<p class="paid">${paidAmount()} ${one ? 'débité · remboursé' : 'débités · remboursés'} en cas d’échec</p>`;
    const title = `<div class="done3__title"><span class="badge-ok">${ic('check')}</span><h2>${L.title}</h2></div>`;
    if (video) {
      return `${title}<p class="quote" style="--lines:3"><span>« ${esc(tx.text)} »</span></p>
        <div class="facts3"><div><span>Position</span><b class="tnum">${L.position}</b></div><div><span>Lecture prévue dans</span><b class="tnum">${L.wait}</b></div><div><span>Cooldown</span><b class="tnum">${secs(qt.cooldownS)}</b></div></div>${paid}`;
    }
    // Panel / Mobile: same height as the message zone (the card never moves). Panel: amount in the facts line.
    const debit = surface === 'panel' ? `<span><b>${paidAmount()}</b> ${L.refunded ? (one ? 'remboursé' : 'remboursés') : one ? 'débité' : 'débités'}</span>` : '';
    return `${title}<p class="quote" style="--lines:1"><span>« ${esc(tx.text)} »</span></p>
      <div class="facts-inline"><span>Position <b>${L.position}</b></span><span>Lecture prévue dans <b>${L.wait}</b></span><span>Cooldown <b>${secs(qt.cooldownS)}</b></span>${debit}</div>${surface === 'panel' ? '' : paid}`;
  }
  const slot = (arrows) => `<div class="slot${S.phase === 'landing' || S.phase === 'queued' ? ' is-cast' : ''}" data-slot-cast>${roster(arrows, true)}${castBlock()}</div>`;
  const hubBtn = () => `<button class="cta cta--soft" type="button" data-act="hub-back">Retour au Hub</button>`;
  const finalHtml = (video) => (tx?.interaction ? finalTop(video) : '');
  const accent = () => (tx?.interaction ? byId[tx.interaction.cast.character_id].accent : '#a855f7');

  // --- surfaces ------------------------------------------------------------------------------------------
  function stacked(bodyCls) {
    if (S.phase === 'compose') return `<div class="scroll" data-scroll-key="tts-v2"><div class="${bodyCls}">${composer(4)}${factsLine()}${ghostCard()}${roster(true)}</div></div>${payBlock()}`;
    // Transaction: same composition as the preparation, recomposed in place up to the recap.
    return `<div class="scroll" data-scroll-key="tts-v2"><div class="${bodyCls} flow">
      <div class="swap" data-swap><div class="swap__prep">${composer(4)}${factsLine(tx.text)}</div><div class="swap__final done3" data-final style="--c:${accent()}">${finalHtml(false)}</div></div>
      ${zoneHtml()}${slot(true)}</div></div>
      <div class="pay foot"><div class="foot__status">${txStatus()}</div><div class="foot__final">${hubBtn()}</div></div>`;
  }
  function video() {
    if (S.phase === 'compose') {
      return `<div class="cols">
        <div class="col">${composer(9)}${factsLine()}<div class="spacer"></div>${payBlock()}</div>
        <div class="col col--stage col--preview">${ghostCard()}${roster(false)}</div></div>`;
    }
    return `<div class="cols">
      <div class="col col--swap"><div class="swap__prep">${composer(9)}${factsLine(tx.text)}<div class="spacer"></div><div class="pay">${txStatus()}</div></div>
        <div class="swap__final done3" data-final style="--c:${accent()}">${finalHtml(true)}<div class="spacer"></div>${hubBtn()}</div></div>
      <div class="col col--stage col--preview">${zoneHtml()}${slot(false)}</div></div>`;
  }
  const render = () => (surface === 'video' ? video() : stacked(surface === 'mobile' ? 'm-body' : 'body'));
  const stepOf = (ph) => (ph === 'queued' ? 'final' : ph === 'landing' ? 'won' : ph === 'compose' ? '' : 'draw');

  function paint() {
    if (destroyed) return;
    node.innerHTML = render();
    node.querySelectorAll('[data-cal]').forEach((el) => {
      const id = el.dataset.char, kind = el.dataset.cal;
      if (el.hasAttribute('data-animated')) CAL.mountPreview(el, id, kind, { animated: true });
      else { el.replaceChildren(CAL.drawSprite(id, kind, el.clientWidth, el.clientHeight)); }
    });
    node.querySelectorAll('.pick').forEach((btn) => { btn.replaceChildren(CAL.drawSprite(btn.dataset.char, 'portrait', btn.clientWidth, btn.clientHeight)); });
    paintGhost(false);
    const msg = node.querySelector('[data-msg]');
    if (msg && S.phase !== 'compose') { msg.readOnly = true; msg.tabIndex = -1; msg.classList.add('is-locked'); }
    if (S.phase === 'compose') delete node.dataset.step; else node.dataset.step = stepOf(S.phase);
    if (S.phase !== 'queued') delete node.dataset.settled;
    fitCast();
    syncPayment();
  }
  /** The header wallet follows the chosen currency; it is locked during a transaction (D3). */
  function syncPayment() { onPaymentMethod?.(S.currency, S.phase !== 'compose'); }

  // --- updates without repaint (typing, currency, polls) --------------------------------------------------
  function refresh() {
    const meta = node.querySelector('[data-slot="meta"]');
    if (meta && S.phase === 'compose') meta.outerHTML = factsLine();
    const count = node.querySelector('[data-slot="count"]');
    if (count) {
      const qt = quote();
      count.textContent = `${fmt(qt.length)}/${fmt(rules?.max_chars ?? 0)}`;
      count.classList.toggle('is-over', qt.over);
    }
    const pay = node.querySelector('[data-slot="pay"]');
    if (pay) {
      pay.closest('.pay').dataset.cur = S.currency;
      pay.querySelector('.cta__price').textContent = priceText(S.currency, priceOf(quote()));
      pay.disabled = Boolean(blocker());
      const hintEl = node.querySelector('[data-slot="pay-hint"]');
      hintEl.textContent = hintText();
      hintEl.dataset.kind = hintKind();
      const cur = node.querySelector('[data-act="cur-toggle"]');
      if (cur) syncCur(cur);
    }
    syncPayment();
  }
  /** Live recap (position, planned reading, status): content replaced, no replayed animation. */
  function refreshFinal() {
    const final = node.querySelector('[data-final]');
    if (!final || !tx?.interaction) return;
    const video = surface === 'video';
    final.innerHTML = finalTop(video) + (video ? `<div class="spacer"></div>${hubBtn()}` : '');
  }

  // --- ghost card (before purchase): « ? » until a character is preselected ------------------------------
  function ghostLayer(card, id) {
    const layer = document.createElement('div');
    layer.className = `ghost__layer${id ? ' ghost__layer--char' : ''}`;
    if (id) { layer.dataset.char = id; layer.append(CAL.drawSprite(id, 'card', card.clientWidth, card.clientHeight)); } else layer.innerHTML = '<span class="ghost__q">?</span>';
    return layer;
  }
  function paintGhost(animate) {
    const card = node.querySelector('[data-ghost]');
    if (!card) return;
    const shown = S.phase === 'compose' ? ghost : startVisual;
    const next = ghostLayer(card, shown);
    card.classList.toggle('has-char', Boolean(shown));
    if (shown) card.style.setProperty('--c', byId[shown].accent); else card.style.removeProperty('--c');
    const old = [...card.querySelectorAll('.ghost__layer')];
    card.append(next);
    if (animate) {
      next.getBoundingClientRect();
      next.classList.add('is-on');
      old.forEach((l) => { l.classList.remove('is-on'); win.setTimeout(() => l.remove(), 220); });
    } else { old.forEach((l) => l.remove()); next.classList.add('is-on'); }
    if (S.phase === 'compose') node.querySelectorAll('.pick').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.char === ghost)));
  }
  function selectGhost(id) { if (S.phase !== 'compose' || id === ghost) return; ghost = id; paintGhost(true); }
  function stepGhost(dir) {
    const i = ghost ? IDS.indexOf(ghost) : dir > 0 ? -1 : 0;
    selectGhost(IDS[(i + dir + IDS.length) % IDS.length]);
  }
  let swipe = null;
  let swallowClick = false;
  node.addEventListener('pointerdown', (e) => { if (S.phase === 'compose' && e.target.closest?.('[data-ghost], [data-roster]')) swipe = { x: e.clientX, y: e.clientY }; });
  node.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
      stepGhost(dx < 0 ? 1 : -1);
      swallowClick = true;
      win.setTimeout(() => { swallowClick = false; }, 0);
    }
  });
  node.addEventListener('keydown', (e) => {
    if (!e.target.closest?.('[data-roster]')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); stepGhost(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepGhost(-1); }
  });

  // --- shuffle: straight cards, horizontal slide, stops on the winner Core already decided ---------------
  function shuffle(stage, winner, seed) {
    const Wd = stage.clientWidth, H = stage.clientHeight;
    const ch = Math.round(Math.min(H * 0.66, Wd * 0.62)), cw = Math.round(ch * 0.86);
    const spacing = cw * 1.08, top = (H - ch) / 2;
    let r = seed;
    const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
    const N = 13, WIN = 11, seq = [];
    for (let i = 0; i < N; i++) {
      if (i === WIN) { seq.push(winner); continue; }
      const pool = IDS.filter((id) => id !== seq[i - 1] && (i === WIN - 1 || i === WIN + 1 ? id !== winner : true));
      seq.push(pool[Math.floor(rnd() * pool.length)]);
    }
    stage.replaceChildren();
    const cards = seq.map((id) => {
      const el = document.createElement('div');
      el.className = 'sh-card';
      el.style.setProperty('--c', byId[id].accent);
      Object.assign(el.style, { width: `${cw}px`, height: `${ch}px` });
      el.append(CAL.drawSprite(id, 'card', cw, ch));
      stage.append(el);
      return el;
    });
    const clamp = (v) => Math.max(0, Math.min(1, v));
    const place = (p, enter) => {
      cards.forEach((el, i) => {
        const d = i - p, a = Math.abs(d);
        if (a > 2.6) { el.style.visibility = 'hidden'; return; }
        el.style.visibility = 'visible';
        const sc = (1 - 0.12 * Math.min(a, 1)) * (1 + 0.14 * (1 - enter));
        el.style.transform = `translate(${Wd / 2 - cw / 2 + d * spacing}px, ${top}px) scale(${sc})`;
        el.style.opacity = String(enter * clamp((2.6 - a) / 0.7));
        el.style.zIndex = String(100 - Math.round(a * 10));
        el.style.filter = `brightness(${1 - 0.45 * Math.min(a, 1)}) saturate(${1 - 0.3 * Math.min(a, 1)})`;
      });
    };
    const ease = (t) => 1 - Math.pow(1 - t, 2.4);
    const out = (t) => 1 - Math.pow(1 - t, 3);
    return new Promise((resolve) => {
      const t0 = win.performance.now();
      const frame = (now) => {
        if (destroyed) return resolve();
        const t = REDUCE ? 1 : Math.min(1, (now - t0) / T.shuffle);
        place(ease(t) * WIN, REDUCE ? 1 : clamp((now - t0) / 180));
        if (t < 1) { win.requestAnimationFrame(frame); return; }
        const a = byId[winner].accent;
        stage.classList.add('is-won');
        stage.style.setProperty('--c', a);
        cards.forEach((el, i) => {
          if (i === WIN || el.style.visibility === 'hidden') return;
          const dir = i < WIN ? -1 : 1;
          el.animate?.([{ opacity: el.style.opacity, transform: el.style.transform }, { opacity: 0, transform: `${el.style.transform} translateX(${dir * cw * 0.35}px)` }], { duration: REDUCE ? 1 : 220, easing: 'ease-in', fill: 'forwards' });
        });
        const winEl = cards[WIN], canvas = winEl.querySelector('canvas');
        const from = { x: Wd / 2 - cw / 2, y: top, w: cw, h: ch };
        const g0 = win.performance.now();
        const grow = (now2) => {
          if (destroyed) return resolve();
          const k = REDUCE ? 1 : Math.min(1, (now2 - g0) / T.flash), e = out(k);
          const w = from.w + (Wd - from.w) * e, h = from.h + (H - from.h) * e;
          Object.assign(winEl.style, { transform: `translate(${from.x * (1 - e)}px, ${from.y * (1 - e)}px)`, width: `${w}px`, height: `${h}px`, borderRadius: `${16 + 4 * e}px`, filter: `brightness(${1 + 0.35 * Math.sin(Math.PI * e)})`, boxShadow: `0 0 0 ${2 - e}px ${a}, 0 0 ${34 - 12 * e}px ${a}` });
          CAL.drawSprite(winner, 'card', Math.round(w), Math.round(h), canvas);
          if (k < 1) win.requestAnimationFrame(grow); else resolve();
        };
        win.requestAnimationFrame(grow);
      };
      win.requestAnimationFrame(frame);
    });
  }
  function showWinner(zone) {
    const c = byId[tx.interaction.cast.character_id];
    zone.classList.add('is-won');
    zone.style.setProperty('--c', c.accent);
    zone.innerHTML = winCard(false);
    const span = zone.querySelector('[data-cal]');
    span.classList.add('pv');
    span.append(CAL.drawSprite(c.id, 'card', zone.clientWidth, zone.clientHeight));
  }
  /** The cast block never exceeds the roster height (otherwise the card would shrink). */
  function fitCast() {
    const sl = node.querySelector('[data-slot-cast]');
    if (!sl) return;
    const ro = sl.querySelector('.roster'), cast = sl.querySelector('.cast');
    if (!cast) return;
    const limit = ro.offsetHeight;
    if (!limit) return; // detached (host render in progress): measured again on the next paint
    sl.style.height = `${limit}px`;
    const traits = () => [...cast.querySelectorAll('.trait')];
    while (cast.offsetHeight > limit && traits().length > 1) traits().pop().remove();
    if (cast.offsetHeight > limit) {
      const v = cast.querySelector('.cast__voice');
      if (v) { cast.querySelector('.cast__row').prepend(v); v.classList.add('is-row'); }
    }
    while (cast.offsetHeight > limit && traits().length) traits().pop().remove();
  }
  function showCast() { node.querySelector('[data-slot-cast]')?.classList.add('is-cast'); }
  function toFinal() {
    node.dataset.step = 'final';
    const span = node.querySelector('[data-zone] [data-cal]');
    if (span) CAL.mountPreview(span, span.dataset.char, 'card', { animated: true });
    // Once composed, live updates and host renders never replay the entrance animations.
    later(700, () => { if (S.phase === 'queued') node.dataset.settled = '1'; });
  }
  /** Server answered: the cast block and the recap are filled in place (the validation keeps running). */
  function fillTx() {
    const sl = node.querySelector('[data-slot-cast]');
    if (sl) sl.innerHTML = roster(surface !== 'video', true) + castBlock();
    node.querySelectorAll('.pick').forEach((btn) => { btn.replaceChildren(CAL.drawSprite(btn.dataset.char, 'portrait', btn.clientWidth, btn.clientHeight)); });
    const final = node.querySelector('[data-final]');
    if (final) {
      final.style.setProperty('--c', accent());
      const video = surface === 'video';
      final.innerHTML = finalTop(video) + (video ? `<div class="spacer"></div>${hubBtn()}` : '');
    }
    fitCast();
  }

  // --- flow ----------------------------------------------------------------------------------------------
  function setPhase(phase, repaint) {
    S.phase = phase;
    if (repaint) paint();
    else if (phase !== 'queued') node.dataset.step = stepOf(phase);
  }
  /** Plays (or replays after a refresh) the rest of the transaction towards the cast decided by Core. */
  function play(fromMs) {
    const elapsed = Math.max(0, fromMs || 0);
    if (elapsed >= QUEUED_AT) { setPhase('queued', true); node.dataset.step = 'final'; node.dataset.settled = '1'; return; }
    if (elapsed >= REVEAL_END) { setPhase('landing', true); later(QUEUED_AT - elapsed, () => { setPhase('queued'); toFinal(); }); return; }
    setPhase('validating', true);
    fillTx();
    later(T.validate - elapsed, runShuffle);
  }
  async function runShuffle() {
    setPhase('shuffle');
    const zone = node.querySelector('[data-zone]');
    zone.classList.remove('is-validating');
    zone.removeAttribute('data-ghost');
    const st = node.querySelector('[data-slot="tx"]');
    if (st) st.outerHTML = txStatus();
    await CAL.ready;
    await shuffle(zone, tx.interaction.cast.character_id, seedOf(tx.interaction.interaction_id));
    if (destroyed) return;
    setPhase('landing');
    showWinner(zone);
    later(T.leave, () => node.querySelector('.roster')?.classList.add('is-leaving'));
    later(T.cast, showCast);
    later(T.hold, () => { setPhase('queued'); toFinal(); });
  }

  /** Sends (or sends again) the recorded purchase with ITS key. Returns true when Core answered. */
  async function send(pending, startedAt) {
    sending = true;
    try {
      const res = await client.ttsBuy(pending.key, pending.currency, pending.text);
      if (destroyed) return false;
      tx = { ...pending, interaction: res.interaction, queue: res.queue ?? null };
      // animAt: start of the D3 timeline (a refresh resumes the same reveal instead of replaying it).
      const animAt = startedAt ?? Date.now();
      writeStore({ pending: null, interaction_id: res.interaction.interaction_id, animAt });
      onPurchased?.();
      return { animAt };
    } catch (error) {
      if (destroyed) return false;
      if (UNCERTAIN.has(error?.code)) {
        // The purchase may have been recorded: keep the key, the next attempt replays it (never a 2nd debit).
        hintFrom = '';
        hint = 'Connexion perdue · ton envoi sera vérifié';
      } else {
        writeStore({ pending: null });
        hintFrom = error?.code === 'viewer_cooldown' ? 'cooldown' : error?.code === 'viewer_busy' ? 'busy' : '';
        hint = error?.code === 'viewer_cooldown' && error.details?.retry_after_ms
          ? `Prochain TTS dans ${mmss(error.details.retry_after_ms)}`
          : ttsError(error?.code);
      }
      return false;
    } finally {
      sending = false;
    }
  }
  async function confirm() {
    if (S.phase !== 'compose' || sending || readStore().pending) return; // never a 2nd payment
    hint = '';
    if (blocker()) return; // queue full, pause, cooldown, balance: blocked BEFORE any debit
    startVisual = ghost;
    ghost = null; // the preselection is forgotten: it has no effect on the draw
    const pending = { key: newIdempotencyKey(), text: normalize(S.text), currency: S.currency };
    writeStore({ pending }); // recorded before sending: a refresh or a retry reuses this key
    tx = { ...pending, interaction: null, queue: null };
    const t0 = Date.now();
    setPhase('validating', true);
    const ok = await send(pending, t0);
    if (!ok) {
      if (destroyed) return;
      tx = null;
      S.phase = 'compose';
      paint();
      schedulePoll(0);
      return;
    }
    fillTx();
    later(T.validate - (Date.now() - t0), runShuffle);
    schedulePoll(POLL_MS);
  }
  function backToHub() {
    if (S.phase !== 'queued') return;
    if (tx?.interaction) writeStore({ dismissed: tx.interaction.interaction_id });
    tx = null;
    ghost = null;
    startVisual = null;
    S.text = '';
    S.phase = 'compose';
    hint = '';
    paint();
    onBack?.();
  }

  /** After (re)opening: the recorded purchase or the viewer's current TTS is shown again. */
  async function recover() {
    const store = readStore();
    if (store.pending) {
      tx = { ...store.pending, interaction: null, queue: null };
      S.text = store.pending.text;
      S.currency = store.pending.currency;
      setPhase('validating', true);
      const ok = await send(store.pending, null);
      if (destroyed) return;
      if (!ok) { tx = null; S.phase = 'compose'; paint(); return; }
      play(0);
      return;
    }
    const current = viewer?.current;
    if (!current) return paint();
    const i = current.interaction;
    const mine = store.interaction_id === i.interaction_id;
    // Left with « Retour au Hub »: stays dismissed (a new message can be written if Core allows it).
    if (store.dismissed === i.interaction_id || (!OPEN.includes(i.status) && !mine)) return paint();
    tx = { key: i.idempotency_key, text: i.message, currency: i.payment_method, interaction: i, queue: current.queue };
    S.text = i.message;
    S.currency = i.payment_method;
    play(mine && store.animAt ? Date.now() - store.animAt : QUEUED_AT);
  }

  // --- polling (viewer state: availability, queue position, status, refunds) -----------------------------
  function schedulePoll(ms = POLL_MS) {
    win.clearTimeout(pollTimer);
    if (!destroyed) pollTimer = win.setTimeout(poll, ms);
  }
  async function poll() {
    try {
      const res = await client.ttsState();
      if (destroyed) return;
      applyData(res.tts_v2, { wallet: res.wallet, pending_actions: res.pending_actions });
    } catch { /* keep the last state; Core refusals still protect the payment */ }
    schedulePoll(POLL_MS);
  }
  function applyData(v2, hostState) {
    if (v2) {
      rules = v2.rules ?? rules;
      moduleState = v2.module_state ?? moduleState;
      viewer = v2.viewer ?? null;
      viewerAt = Date.now();
    }
    if (hostState) {
      const w = hostState.wallet;
      wallet = {
        tokens: w && !w.unavailable ? Number(w.available) : null,
        credits: Array.isArray(hostState.pending_actions) ? hostState.pending_actions.filter((p) => p.module_id === 'tts').length : null,
      };
    }
    // The current transaction follows Core (position, wait, status, refund).
    const cur = viewer?.current;
    if (tx?.interaction && cur && cur.interaction.interaction_id === tx.interaction.interaction_id) {
      const wasRefunded = tx.interaction.refund_status === 'refunded';
      const changed = JSON.stringify([tx.interaction.status, tx.interaction.refund_status, tx.queue]) !== JSON.stringify([cur.interaction.status, cur.interaction.refund_status, cur.queue]);
      tx.interaction = cur.interaction;
      tx.queue = cur.queue;
      if (changed && S.phase === 'queued') refreshFinal();
      if (!wasRefunded && cur.interaction.refund_status === 'refunded') onPurchased?.(); // wallet given back
    }
    if (S.phase === 'compose') refresh();
  }

  const tick = win.setInterval(() => { if (S.phase === 'compose' && blocker()?.kind === 'cooldown') refresh(); }, 1000);

  // --- events --------------------------------------------------------------------------------------------
  node.addEventListener('input', (e) => {
    if (!e.target.matches?.('[data-msg]') || S.phase !== 'compose') return;
    S.text = e.target.value;
    hint = '';
    refresh();
  });
  node.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-act]');
    if (!b || b.disabled || !node.contains(b)) return;
    const a = b.dataset.act;
    if (a === 'cur-toggle' && S.phase === 'compose') { S.currency = S.currency === 'tokens' ? 'credits' : 'tokens'; hint = ''; refresh(); }
    else if (a === 'confirm') void confirm();
    else if (a === 'ghost-pick' && !swallowClick) selectGhost(b.dataset.char);
    else if (a === 'ghost-step') stepGhost(Number(b.dataset.step));
    else if (a === 'hub-back') backToHub();
  });
  const offCal = CAL.onChange(() => { if (['compose', 'queued', 'landing'].includes(S.phase)) paint(); });

  return {
    node,
    /** Host state (session / poll): module data, wallet, credits. Never repaints by itself. */
    update(mod, hostState) {
      storeKey = `raptoru.tts-v2:${hostState?.channel_id ?? ''}:${hostState?.twitch_user_id ?? ''}`;
      applyData(mod?.tts_v2, hostState);
      if (!recovered) {
        recovered = true;
        paint(); // compose at once; the recorded / current TTS (if any) takes over below
        CAL.ready.then(() => { if (!destroyed) void recover(); });
        schedulePoll(POLL_MS);
      }
    },
    /** Called by the host after it re-appended the node (layout is measurable again). */
    attached() { fitCast(); },
    /** Header currency switch → same choice here (ignored during a transaction). */
    setCurrency(method) { if (S.phase !== 'compose') return; S.currency = method; hint = ''; refresh(); },
    get phase() { return S.phase; },
    destroy() {
      destroyed = true;
      win.clearTimeout(pollTimer);
      win.clearInterval(tick);
      timers.forEach((t) => win.clearTimeout(t));
      offCal();
    },
  };
}
