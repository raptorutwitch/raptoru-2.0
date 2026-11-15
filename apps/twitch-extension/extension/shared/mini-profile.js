// Mini-profil viewer (docs/MINI_PROFIL.md). L'avatar du viewer, à droite du wallet dans l'en-tête du Hub, ouvre un
// panneau de compte flottant, sans défilement dans les formats courants : un en-tête commun (avatar, pseudo, abonnement
// et multiplicateur de gains, ⚙ Préférences), une navigation en icônes (Accueil, Restrictions ; Historique et Classement
// ouvrent leur destination habituelle) et des vues empilées dans une même case (hauteur stable).
// Données RÉELLES uniquement, fournies par ui.js à chaque rendu (session du Core pour le viewer du JWT) : rien n'est
// inventé, une donnée absente reste neutre. Ce fichier n'appelle aucune API ; ui.js ne fait que le câbler (ASTRA-P1-008).
import { fitMoney, fmtAmount as fmt, formatCompactAmount } from './currency.js';
import { hubIcon } from './hub-carousel.js';
import { clockLeft, shortLeft } from './viewer-restrictions.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const day = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
const every = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 360) / 10} h`);
const times = (m) => `×${String(Math.round(m * 100) / 100).replace('.', ',')}`;
const MODULE_LABEL = { all: 'Toutes les interactions', tts: 'TTS', soundboard: 'Soundboard', bonk: 'Bonk', raffle: 'Tombola' };
const TIER = { t1: 'Tier 1', t2: 'Tier 2', t3: 'Tier 3' };

const ICON = {
  home: '<path d="M4.5 10.5 12 4.5l7.5 6"/><path d="M6.5 9v9.5h11V9"/><path d="M10 18.5v-5h4v5"/>',
  shield: '<path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2Z"/>',
  shieldOk: '<path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2Z"/><path d="m8.8 12.2 2.2 2.2 4.2-4.6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.8"/>',
  ban: '<circle cx="12" cy="12" r="8"/><path d="m6.6 6.6 10.8 10.8"/>',
  // A real cog (teeth), not a sun: the account's settings.
  cog: '<path d="M10.3 3.6h3.4l.5 2.3 1.6.9 2.2-.8 1.7 2.9-1.7 1.6v1.8l1.7 1.6-1.7 2.9-2.2-.8-1.6.9-.5 2.3h-3.4l-.5-2.3-1.6-.9-2.2.8-1.7-2.9 1.7-1.6v-1.8L4.1 8.9l1.7-2.9 2.2.8 1.6-.9Z"/><circle cx="12" cy="12" r="2.6"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 5v4h-4"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
  trophy: '<path d="M8 4.5h8v4a4 4 0 0 1-8 0Z"/><path d="M8 6H5a3 3 0 0 0 3 3.5M16 6h3a3 3 0 0 1-3 3.5M12 12.5V16M9 19.5h6"/>',
  user: '<circle cx="12" cy="9" r="3.6"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/>',
};
const icon = (name, cls = 'mp-i') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
// Twitch's subscription mark (the star of the sub badge), filled in Twitch purple.
const SUB_STAR = '<svg class="mp-sub__star" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2.8 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9Z"/></svg>';

let open = false;
let view = 'home'; // home | restr | prefs
let panel = null; // one node, kept across the Hub's redraws (no replayed animation, the view and the focus stay)
let button = null; // the current header avatar (rebuilt with the header)
let ctx = null; // the latest data and callbacks from ui.js
let listening = false;
const painted = {}; // last HTML of each part: only what changed is replaced

export const isProfileOpen = () => open;

/** The viewer's active restrictions, as the viewer reads them (module, nature, time) — never who or why. */
function activeRestrictions(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    const label = MODULE_LABEL[r.module] ?? r.module;
    if (r.kind === 'block' && (!r.until || ms(r.until) > now))
      out.push({ kind: 'block', label, end: r.until ? ms(r.until) : null });
    else if (r.kind === 'cooldown' && ms(r.until) > now) {
      const waiting = Boolean(r.wait_until) && ms(r.wait_until) > now;
      out.push({ kind: 'cooldown', label, every: Number(r.delay_s) || 0, end: waiting ? ms(r.wait_until) : null });
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'block' ? -1 : 1));
}

const progress = (lv) => {
  if (!lv || !Number.isFinite(lv.nextLevelXp - lv.levelXp) || lv.nextLevelXp <= lv.levelXp) return null;
  const span = lv.nextLevelXp - lv.levelXp;
  const inLevel = Math.max(0, Math.min(span, lv.xp - lv.levelXp));
  return { span, inLevel, left: span - inLevel, ratio: inLevel / span };
};

function avatarHtml(d, cls) {
  const p = progress(d.level);
  const pic = d.avatar
    ? `<img src="${esc(d.avatar)}" alt="" draggable="false" referrerpolicy="no-referrer">`
    : d.identity
      ? `<span class="mp-ava__initial">${esc((d.name || '?').trim().charAt(0).toUpperCase())}</span>`
      : icon('user', 'mp-i mp-ava__anon');
  return `<span class="mp-ava ${cls}${d.avatar ? ' has-pic' : ''}" style="--mp-p:${p ? (p.ratio * 100).toFixed(1) : 0}%">
    <span class="mp-ava__img">${pic}</span>
  </span>`;
}

/** Subscription mark and the presence-gain multiplier (Loyalty's own rules, read by the Core): extensible chips. */
function statusHtml(d) {
  const l = d.loyalty;
  if (!d.identity) return '<span class="mp-status"><span class="mp-chip mp-chip--plain">Identité non partagée</span></span>';
  if (!l) return d.levelState === 'loading' ? '<span class="mp-status"><span class="mp-chip mp-chip--wait">…</span></span>' : '<span class="mp-status"></span>';
  const s = l.subscription ?? {};
  const chips = [];
  if (s.subscribed) {
    const months = s.months
      ? ` · ${fmt(s.months)} mois cumulés (annoncés le ${day(s.months_at)})`
      : ' · durée inconnue (aucun réabonnement annoncé)';
    const tip = `Abonné ${TIER[s.tier] ?? ''}${s.gift ? ' (abonnement offert)' : ''}${months}`;
    chips.push(`<span class="mp-chip mp-chip--sub" tabindex="0" title="${esc(tip)}" aria-label="${esc(tip)}">${SUB_STAR}<span>Abonné</span></span>`);
  }
  const p = l.presence ?? {};
  if (p.source === 'excluded') {
    chips.push('<span class="mp-chip mp-chip--plain" tabindex="0" title="Ce compte ne gagne pas de Jetons de présence.">Sans gains</span>');
  } else if (typeof p.multiplier === 'number') {
    const why = p.source === 'personal'
      ? 'taux personnel'
      : p.source === 'unknown'
        ? 'pour l’instant : ton abonnement est en cours de vérification'
        : s.subscribed ? `palier ${TIER[s.tier] ?? 'abonné'}` : 'sans abonnement';
    const tip = `Gains de Jetons de présence ${times(p.multiplier)} (${why})${p.credited === false ? ' — gains de présence inactifs sur la chaîne' : ''}`;
    chips.push(`<span class="mp-chip mp-chip--mult${p.multiplier > 1 ? ' is-up' : ''}" tabindex="0" title="${esc(tip)}" aria-label="${esc(tip)}">${times(p.multiplier)}</span>`);
  }
  return `<span class="mp-status">${chips.join('')}</span>`;
}

function homeHtml(d) {
  if (!d.identity)
    return `<div class="mp-empty">
      <span class="mp-empty__icon mp-empty__icon--plain">${icon('user')}</span>
      <strong>Profil non partagé</strong>
      <span>Partage ton identité Twitch avec l’extension pour voir tes Jetons et ton niveau.</span>
    </div>`;
  const credits = d.credits ?? [];
  const total = credits.reduce((s, c) => s + c.n, 0);
  const split = credits.map((c) => `${esc(c.label)} ${fmt(c.n)}`).join(' · ');
  const lv = d.level;
  const p = progress(lv);
  const tokens = d.tokens === null
    ? '<strong class="mp-cur__val is-na">—</strong>'
    : `<strong class="mp-cur__val" data-v="${d.tokens}">${fmt(d.tokens)}</strong>`;
  const creditTile = d.credits === null
    ? `<div class="mp-cur mp-cur--credits"><span class="mp-cur__head"><span class="mp-coin mp-coin--credits" aria-hidden="true"></span>Crédits</span><span class="mp-cur__box"><strong class="mp-cur__val is-na">—</strong></span></div>`
    : total
      ? `<button type="button" class="mp-cur mp-cur--credits" data-mp="credits" aria-expanded="false" title="Crédits gagnés avec les points de chaîne : chacun ne sert que dans son module.">
          <span class="mp-cur__head"><span class="mp-coin mp-coin--credits" aria-hidden="true"></span>Crédits${icon('info', 'mp-i mp-cur__more')}</span>
          <span class="mp-cur__box"><strong class="mp-cur__val" data-v="${total}">${fmt(total)}</strong><span class="mp-cur__split">${split}</span></span>
        </button>`
      : `<div class="mp-cur mp-cur--credits" title="Crédits gagnés avec les points de chaîne"><span class="mp-cur__head"><span class="mp-coin mp-coin--credits" aria-hidden="true"></span>Crédits</span><span class="mp-cur__box"><strong class="mp-cur__val">0</strong></span></div>`;
  const rank = !lv
    ? `<span class="mp-rank is-wait">${d.levelState === 'error' ? 'Classement indisponible' : '…'}</span>`
    : lv.rank
      ? `<span class="mp-rank" title="Ta place au classement des niveaux (XP totale)">${icon('trophy', 'mp-i mp-rank__i')}<b>#${fmt(lv.rank)}</b><span>au classement</span></span>`
      : '<span class="mp-rank is-wait" title="Classé dès ta première XP">Pas encore classé</span>';
  const level = lv
    ? `<div class="mp-lvl" aria-hidden="true"><small>Niv.</small><b>${fmt(lv.level)}</b></div>
      <div class="mp-prog__body">
        <div class="mp-prog__top">${rank}<span class="mp-prog__xp">${p ? `<b>${fmt(p.inLevel)}</b> / ${fmt(p.span)} XP` : ''}</span></div>
        <div class="mp-bar" role="progressbar" aria-label="Niveau ${lv.level}, progression vers le niveau ${lv.level + 1}" aria-valuemin="0" aria-valuemax="${p?.span ?? 0}" aria-valuenow="${p?.inLevel ?? 0}"><i style="width:${p ? (p.ratio * 100).toFixed(1) : 0}%"></i></div>
        <div class="mp-prog__foot">${p ? `<span><b>${fmt(p.left)} XP</b> avant le niveau ${fmt(lv.level + 1)}</span>` : ''}</div>
      </div>`
    : `<div class="mp-lvl is-wait" aria-hidden="true"><small>Niv.</small><b>…</b></div>
      <div class="mp-prog__body"><div class="mp-prog__top">${rank}</div><div class="mp-bar"><i style="width:0"></i></div>
      <div class="mp-prog__foot"><span>${d.levelState === 'error' ? 'Niveau indisponible pour l’instant.' : 'Chargement du niveau…'}</span></div></div>`;
  return `
    <div class="mp-wallet">
      <div class="mp-cur mp-cur--tokens"${d.tokens === null ? '' : ` title="${fmt(d.tokens)} Jetons"`}>
        <span class="mp-cur__head"><span class="mp-coin mp-coin--tokens" aria-hidden="true"></span>Jetons</span>
        <span class="mp-cur__box">${tokens}</span>
      </div>
      ${creditTile}
    </div>
    <div class="mp-prog">${level}</div>`;
}

function restrictionsHtml(list) {
  if (!list.length)
    return `<div class="mp-empty">
      <span class="mp-empty__icon">${icon('shieldOk')}</span>
      <strong>Aucune restriction</strong>
      <span>Tout est ouvert pour toi.</span>
    </div>`;
  return `<ul class="mp-rlist" aria-label="${list.length} restriction${list.length > 1 ? 's' : ''} active${list.length > 1 ? 's' : ''}">${list
    .map((r) => {
      const block = r.kind === 'block';
      const detail = block
        ? r.end ? `Fermé pour toi jusqu’à ${hhmm(r.end)}` : 'Fermé jusqu’à ce qu’un modérateur le rouvre'
        : `1 envoi toutes les ${every(r.every)}${r.end ? ' · en attente' : ''}`;
      // The time left is kept up to date by the Hub's own restriction ticker (data-rl-end, tickRestrictions).
      const short = r.end && r.end - Date.now() >= 3_600_000;
      const left = r.end
        ? `<b class="mp-r__left" data-rl-end="${r.end}" data-rl-format="${short ? 'short' : 'clock'}">${(short ? shortLeft : clockLeft)(r.end - Date.now())}</b>`
        : `<b class="mp-r__left">${block ? 'Indéfini' : 'Actif'}</b>`;
      return `<li class="mp-r mp-r--${r.kind}">
        <span class="mp-r__icon">${icon(block ? 'ban' : 'clock')}</span>
        <span class="mp-r__main">
          <span class="mp-r__line"><b>${esc(r.label)}</b><span class="mp-r__kind">${block ? 'Bloqué' : 'Délai'}</span></span>
          <span class="mp-r__detail" title="${esc(detail)}">${esc(detail)}</span>
        </span>
        ${left}
      </li>`;
    })
    .join('')}</ul>`;
}

function prefsHtml(d) {
  const s = d.sound;
  const disabled = !d.identity || !s.editable || s.busy;
  const note = !d.identity
    ? 'Partage ton identité Twitch avec l’extension pour choisir.'
    : s.error
      ? 'Réglage indisponible pour l’instant : réessaie dans un moment.'
      : 'Ton annonce dans le chat est toujours écrite ; ce choix ne concerne que le son sur le stream.';
  return `<div class="mp-prefs">
    <div class="mp-pref">
      <span class="mp-pref__text">
        <b>Son de Level Up</b>
        <span>Jouer un son lorsque je monte de niveau</span>
      </span>
      <button type="button" class="mp-switch${s.busy ? ' is-busy' : ''}" role="switch" aria-checked="${s.on === true}" data-mp="sound" aria-label="Jouer un son lorsque je monte de niveau"${disabled ? ' disabled' : ''}><i></i></button>
    </div>
    <p class="mp-pref__note${s.error ? ' is-bad' : ''}">${icon('info')}${esc(note)}</p>
    <button type="button" class="mp-pref-row" data-mp="refresh">${icon('refresh')}<span>Actualiser l’extension</span></button>
  </div>`;
}

function headHtml(d) {
  return `${avatarHtml(d, 'mp-ava--lg')}
    <div class="mp-head__text">
      <strong class="mp-name" title="${esc(d.name)}">${esc(d.name)}</strong>
      ${statusHtml(d)}
    </div>
    <button type="button" class="mp-gear" data-mp="prefs" aria-pressed="false" aria-label="Préférences" title="Préférences">${icon('cog')}</button>`;
}

function navHtml(d, nRestr) {
  const n = d.notices;
  const restr = nRestr ? ` · ${nRestr} active${nRestr > 1 ? 's' : ''}` : '';
  const unread = n ? ` · ${n} non lue${n > 1 ? 's' : ''}` : '';
  return `<div class="mp-tabs" role="tablist" aria-label="Mon profil">
      <button type="button" class="mp-tab" role="tab" id="mp-t-home" aria-controls="mp-v-home" data-tab="home" title="Accueil" aria-label="Accueil">${icon('home')}</button>
      <button type="button" class="mp-tab" role="tab" id="mp-t-restr" aria-controls="mp-v-restr" data-tab="restr" title="Restrictions${restr}" aria-label="Restrictions${restr}">${icon('shield')}${nRestr ? `<em class="mp-badge mp-badge--amber">${nRestr}</em>` : ''}</button>
    </div>
    <span class="mp-nav__sep" aria-hidden="true"></span>
    <button type="button" class="mp-short" data-mp="history" title="Historique${unread}" aria-label="Historique${unread}"${d.history ? '' : ' disabled'}><span class="mp-short__icon" data-icon="clock"></span>${n ? `<em class="mp-badge">${n > 9 ? '9+' : n}</em>` : ''}</button>
    ${d.rankingUrl
      ? `<a class="mp-short" data-mp="ranking" href="${esc(d.rankingUrl)}" target="_blank" rel="noopener noreferrer" title="Classement — raptoru.fr, nouvel onglet" aria-label="Classement (raptoru.fr, nouvel onglet)"><span class="mp-short__icon" data-icon="trophy"></span></a>`
      : '<button type="button" class="mp-short" data-mp="ranking" title="Classement — indisponible ici" aria-label="Classement (indisponible)" disabled><span class="mp-short__icon" data-icon="trophy"></span></button>'}`;
}

/** Replaces a part only when its HTML changed (the rest keeps its focus, its open detail, its animation). */
function put(document, key, el, html) {
  if (painted[key] === html) return false;
  const active = document.activeElement;
  const focused = el.contains(active) ? (active.dataset?.mp ?? active.dataset?.tab ?? null) : null;
  el.innerHTML = html;
  painted[key] = html;
  for (const slot of el.querySelectorAll('[data-icon]')) slot.append(hubIcon(document, slot.dataset.icon));
  if (focused) el.querySelector(`[data-mp="${focused}"], [data-tab="${focused}"]`)?.focus({ preventScroll: true });
  return true;
}

function build(document) {
  const node = document.createElement('div');
  node.className = 'mp-panel';
  node.id = 'mp-panel';
  node.setAttribute('role', 'dialog');
  node.tabIndex = -1;
  node.innerHTML = `<header class="mp-head"></header>
    <nav class="mp-nav" aria-label="Mon profil"></nav>
    <div class="mp-body">
      <section class="mp-view" id="mp-v-home" role="tabpanel" aria-labelledby="mp-t-home" data-view="home"></section>
      <section class="mp-view" id="mp-v-restr" role="tabpanel" aria-labelledby="mp-t-restr" data-view="restr"></section>
      <section class="mp-view" aria-label="Préférences" data-view="prefs"></section>
    </div>`;
  for (const k of Object.keys(painted)) delete painted[k];
  node.addEventListener('click', onClick);
  node.addEventListener('keydown', onTabKeys);
  return node;
}

/** Fills the panel from ui.js's data (each Hub redraw): only the parts that changed. */
function fill(document) {
  if (!panel || !ctx) return;
  const d = ctx.data;
  const list = activeRestrictions(d.restrictions);
  panel.setAttribute('aria-label', d.identity ? `Profil de ${d.name}` : 'Mon profil');
  put(document, 'head', panel.querySelector('.mp-head'), headHtml(d));
  put(document, 'nav', panel.querySelector('.mp-nav'), navHtml(d, list.length));
  const homeChanged = put(document, 'home', panel.querySelector('[data-view="home"]'), homeHtml(d));
  put(document, 'restr', panel.querySelector('[data-view="restr"]'), restrictionsHtml(list));
  put(document, 'prefs', panel.querySelector('[data-view="prefs"]'), prefsHtml(d));
  show(view);
  if (homeChanged) requestAnimationFrame(() => fitBalances());
  else fitMoney(panel, '.mp-name', 0.8);
}

/** The exact balance, a little smaller when the tile is too narrow; too long still: the compact form (exact on hover). */
function fitBalances() {
  if (!panel) return;
  for (const v of panel.querySelectorAll('.mp-cur__val[data-v]')) v.textContent = fmt(v.dataset.v);
  fitMoney(panel, '.mp-cur__val', 0.62);
  for (const v of panel.querySelectorAll('.mp-cur__val[data-v]'))
    if (v.scrollWidth > v.parentElement.clientWidth + 1) {
      v.textContent = formatCompactAmount(v.dataset.v).replace(/\u202f/g, '\u00a0');
      fitMoney(v.parentElement, '.mp-cur__val', 0.62);
    }
  fitMoney(panel, '.mp-name', 0.8);
}

/** Shows `next` (home | restr | prefs): the views share one grid cell, so the panel keeps its height. */
function show(next, { focusTab = false } = {}) {
  if (!panel) return;
  const from = panel.dataset.view;
  view = next;
  panel.dataset.view = next;
  for (const t of panel.querySelectorAll('.mp-tab')) {
    const on = t.dataset.tab === next;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on || (next === 'prefs' && t.dataset.tab === 'home') ? 0 : -1;
    if (on && focusTab) t.focus({ preventScroll: true });
  }
  panel.querySelector('.mp-gear')?.setAttribute('aria-pressed', String(next === 'prefs'));
  for (const v of panel.querySelectorAll('.mp-view')) {
    const on = v.dataset.view === next;
    v.classList.toggle('is-on', on);
    v.inert = !on;
    if (on && from && from !== next) {
      // A short fade (mini-profile.css: never a slide, which would overflow its cell).
      v.classList.remove('is-entering');
      void v.offsetWidth;
      v.classList.add('is-entering');
    }
  }
}

function onTabKeys(e) {
  // Accueil ⇄ Restrictions with the arrow keys (the tabs pattern); Historique and Classement are ordinary buttons.
  const tab = e.target.closest?.('.mp-tab');
  if (!tab || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  e.preventDefault();
  show(tab.dataset.tab === 'home' ? 'restr' : 'home', { focusTab: true });
}

function onClick(e) {
  const target = e.target.closest('[data-tab], [data-mp]');
  if (!target) return;
  // Handled here: the Hub's « click outside closes the drawers » (ui.js) must not see it.
  e.stopPropagation();
  if (target.dataset.tab) return show(target.dataset.tab);
  const act = target.dataset.mp;
  if (act === 'prefs') {
    show(view === 'prefs' ? 'home' : 'prefs');
    if (view === 'prefs') ctx?.onPreferences?.(); // ui.js reads the sound choice (once per identity)
    return;
  }
  if (act === 'credits') {
    // Secondary reading: the total ⇄ the credits of each module, in the same place (no height change).
    const on = target.getAttribute('aria-expanded') !== 'true';
    target.setAttribute('aria-expanded', String(on));
    target.classList.toggle('is-split', on);
    return;
  }
  if (act === 'sound') {
    if (!target.disabled) ctx?.setSound?.(target.getAttribute('aria-checked') !== 'true');
    return;
  }
  if (act === 'refresh') {
    target.disabled = true;
    Promise.resolve(ctx?.refresh?.()).catch(() => {}).finally(() => { target.disabled = false; });
    return;
  }
  if (act === 'history') {
    closeProfile();
    ctx?.openHistory?.();
  } else if (act === 'ranking') closeProfile(); // the link opens raptoru.fr in a new tab
}

function attach(document, hub, entering) {
  panel ??= build(document);
  panel.classList.toggle('is-entering', entering);
  if (entering) panel.addEventListener('animationend', (e) => e.target === panel && panel.classList.remove('is-entering'), { once: true });
  hub.append(panel);
  fill(document);
}

function paintButton() {
  if (!button || !ctx) return;
  const d = ctx.data;
  const n = activeRestrictions(d.restrictions).length;
  button.setAttribute('aria-expanded', String(open));
  button.classList.toggle('is-open', open);
  button.innerHTML = avatarHtml(d, 'mp-ava--sm') + (n ? '<span class="mp-avatar-btn__dot" aria-hidden="true"></span>' : '');
  const level = d.level ? `, niveau ${d.level.level}` : '';
  button.setAttribute('aria-label', `Mon profil${d.identity ? ` : ${d.name}${level}` : ''}${n ? `, ${n} restriction${n > 1 ? 's' : ''} active${n > 1 ? 's' : ''}` : ''}`);
  button.title = 'Mon profil';
}

export function closeProfile({ focus = false } = {}) {
  if (!open) return;
  open = false;
  panel?.remove();
  const split = panel?.querySelector('.mp-cur--credits.is-split');
  split?.classList.remove('is-split');
  split?.setAttribute('aria-expanded', 'false');
  if (button) {
    button.setAttribute('aria-expanded', 'false');
    button.classList.remove('is-open');
    if (focus) button.focus({ preventScroll: true });
  }
}

/**
 * The header avatar (rebuilt with the header at each redraw). `options`: { data, openHistory, refresh, closeDrawers,
 * onOpen, onPreferences, setSound } from ui.js — its data and its existing behaviours, nothing new.
 */
export function profileAvatar(document, options) {
  ctx = options;
  if (!listening) {
    listening = true;
    // Outside: closes (the panel and the avatar keep it open). Capture: before any other handler redraws.
    document.addEventListener('pointerdown', (e) => {
      if (!open) return;
      if (panel?.contains(e.target) || button?.contains(e.target)) return;
      closeProfile();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (open && e.key === 'Escape') {
        e.stopPropagation();
        closeProfile({ focus: true });
      }
    });
  }
  button = document.createElement('button');
  button.type = 'button';
  button.className = 'mp-avatar-btn';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'mp-panel');
  paintButton();
  button.addEventListener('click', () => {
    if (open) return closeProfile();
    open = true;
    view = 'home'; // each opening starts on the overview
    if (panel) panel.dataset.view = '';
    paintButton();
    // The notification drawer: one floating thing at a time. Closing it redraws the Hub, which already brings the panel
    // back (attachProfilePanel); otherwise it opens here, with its short entrance.
    ctx?.closeDrawers?.();
    const hub = button?.closest('.rh-hub');
    if (!panel?.isConnected && hub) attach(document, hub, true);
    panel?.focus({ preventScroll: true });
    ctx?.onOpen?.(); // ui.js reads the level and rank again (one request per opening, never polled)
  });
  return button;
}

/** Called at the end of each Hub redraw: the open panel comes back as it was (same node, same view), with fresh data. */
export function attachProfilePanel(document, hub) {
  if (open) attach(document, hub, false);
}
