// Mini-profil viewer — MAQUETTE V2 (branche design/mini-profil, 15/11/2026). L'avatar du viewer dans l'en-tête du Hub
// ouvre un panneau de compte flottant, sans défilement : un en-tête commun (avatar, pseudo, ⚙ Préférences), une
// navigation (onglets Accueil et Restrictions ; accès directs Historique et Classement) et des vues empilées dans la même
// case de grille — la hauteur du panneau ne bouge pas d'un onglet à l'autre.
// DONNÉES FICTIVES UNIQUEMENT : aucun endpoint, aucun solde, aucune restriction ni préférence réels. Historique,
// Classement et « Actualiser » réutilisent les comportements existants (callbacks de ui.js), rien d'autre.
// ui.js ne fait que le câbler (règle des fichiers centraux, ASTRA-P1-008).
import { fitMoney, fmtAmount as fmt, formatCompactAmount } from './currency.js';
import { hubIcon } from './hub-carousel.js';
import { RUNTIME } from './runtime-config.js';

const AVATAR = (code) => `assets/twemoji/svg/${code}.svg`;
const now = () => Date.now();
const min = 60_000;

/**
 * Cas de démonstration (Lab ; ?mpDemo=standard|long|restrictions, la vitrine lab-modules/mini-profil.html les change).
 * Les « Jetons réservés » de la première maquette ont disparu : le Core renvoie toujours 0 (ext-facade.ts).
 * Les crédits sont ceux des points de chaîne, propres à chaque module : le total à l'accueil, le détail au toucher.
 */
const DEMO = {
  standard: {
    name: 'PixelMoustache',
    avatar: AVATAR('1f996'),
    avatarBg: 'linear-gradient(135deg, #3b2a63, #6d3fc4)',
    tags: [{ tone: 'sub', text: 'Abonné · 14 mois' }],
    tokens: 48_250,
    credits: [{ label: 'Bonk', n: 2 }, { label: 'TTS', n: 1 }],
    level: 12,
    xp: 11_380,
    notices: 3,
    restrictions: [],
  },
  long: {
    name: 'LeChevalierDuDimancheSoir',
    avatar: AVATAR('1f98a'),
    avatarBg: 'linear-gradient(135deg, #5a2a1d, #c2562b)',
    tags: [
      { tone: 'vip', text: 'VIP' },
      { tone: 'sub', text: 'Abonné · 3 ans' },
    ],
    tokens: 1_254_380_920,
    credits: [{ label: 'Bonk', n: 1_240 }, { label: 'Soundboard', n: 98 }, { label: 'TTS', n: 7 }],
    level: 87,
    xp: 86_940,
    notices: 0,
    restrictions: [
      { kind: 'cooldown', module: 'Bonk', end: () => now() + 42_000, detail: () => '1 Bonk toutes les 2 min' },
    ],
  },
  restrictions: {
    name: 'Mistigri',
    avatar: AVATAR('1f431'),
    avatarBg: 'linear-gradient(135deg, #1f3b4d, #2f7f9e)',
    tags: [],
    tokens: 2_350,
    credits: [],
    level: 4,
    xp: 3_120,
    notices: 12,
    restrictions: [
      { kind: 'block', module: 'TTS', end: () => now() + 12 * min, detail: (end) => `Fermé pour toi jusqu’à ${hhmm(end)}` },
      { kind: 'cooldown', module: 'Bonk', end: () => now() + 42_000, detail: () => '1 Bonk toutes les 2 min' },
      { kind: 'block', module: 'Soundboard', end: null, detail: () => 'Fermé jusqu’à ce qu’un modérateur le rouvre' },
    ],
  },
};
// Rythme Level Up V2 (1 XP/min de présence, 3 XP/message, un par minute) : seulement pour l'estimation affichée.
const XP_PER_LEVEL = 1000;
const XP_PER_MIN_ACTIVE = 4;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const left = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
};
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const duration = (m) => (m < 60 ? `${Math.max(1, Math.round(m))} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`);

const ICON = {
  home: '<path d="M4.5 10.5 12 4.5l7.5 6"/><path d="M6.5 9v9.5h11V9"/><path d="M10 18.5v-5h4v5"/>',
  shield: '<path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2Z"/>',
  shieldOk: '<path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2Z"/><path d="m8.8 12.2 2.2 2.2 4.2-4.6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.8"/>',
  ban: '<circle cx="12" cy="12" r="8"/><path d="m6.6 6.6 10.8 10.8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/>',
  back: '<path d="m14.5 6.5-5.5 5.5 5.5 5.5"/>',
  go: '<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>',
  external: '<path d="M9 6h9v9M18 6 6.5 17.5"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 5v4h-4"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
};
const icon = (name, cls = 'mp-i') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

const isLab = RUNTIME.buildId === 'extension-lab';
const asked = isLab ? new URLSearchParams(globalThis.location?.search ?? '').get('mpDemo') : null;
let scenario = asked && DEMO[asked] ? asked : 'standard';
let open = false;
let view = 'home'; // home | restr | prefs
let soundDemo = false; // aperçu local du réglage « son Level Up » (aucune préférence réelle lue ni écrite)
let panel = null; // built once per case, re-attached across the Hub's redraws (same node: no replayed animation)
let button = null; // the current header avatar (rebuilt with the header)
let ctx = null; // latest callbacks from ui.js
let listening = false;

const data = () => DEMO[scenario];
const progress = (d) => (d.xp % XP_PER_LEVEL) / XP_PER_LEVEL;

function avatarHtml(d, cls) {
  return `<span class="mp-ava ${cls}" style="--mp-p:${(progress(d) * 100).toFixed(1)}%">
    <span class="mp-ava__img" style="background:${d.avatarBg}"><img src="${d.avatar}" alt="" draggable="false"></span>
  </span>`;
}

function homeHtml(d) {
  const inLevel = d.xp % XP_PER_LEVEL;
  const missing = XP_PER_LEVEL - inLevel;
  const credits = d.credits.reduce((s, c) => s + c.n, 0);
  const split = d.credits.map((c) => `${esc(c.label)} ${fmt(c.n)}`).join(' · ');
  return `
    <div class="mp-wallet">
      <div class="mp-cur mp-cur--tokens" title="${fmt(d.tokens)} Jetons">
        <span class="mp-cur__head"><span class="mp-coin mp-coin--tokens" aria-hidden="true"></span>Jetons</span>
        <span class="mp-cur__box"><strong class="mp-cur__val" data-v="${d.tokens}">${fmt(d.tokens)}</strong></span>
      </div>
      ${credits
        ? `<button type="button" class="mp-cur mp-cur--credits" data-mp="credits" aria-expanded="false"
            title="Crédits gagnés avec les points de chaîne : chacun ne sert que dans son module.">
            <span class="mp-cur__head"><span class="mp-coin mp-coin--credits" aria-hidden="true"></span>Crédits${icon('info', 'mp-i mp-cur__more')}</span>
            <span class="mp-cur__box">
              <strong class="mp-cur__val" data-v="${credits}">${fmt(credits)}</strong>
              <span class="mp-cur__split">${split}</span>
            </span>
          </button>`
        : `<div class="mp-cur mp-cur--credits is-empty" title="Crédits gagnés avec les points de chaîne">
            <span class="mp-cur__head"><span class="mp-coin mp-coin--credits" aria-hidden="true"></span>Crédits</span>
            <span class="mp-cur__box"><strong class="mp-cur__val">0</strong></span>
          </div>`}
    </div>
    <div class="mp-prog">
      <div class="mp-lvl" aria-hidden="true"><small>Niv.</small><b>${d.level}</b></div>
      <div class="mp-prog__body">
        <div class="mp-prog__top">
          <span class="mp-prog__title">Niveau Rapidos</span>
          <span class="mp-prog__xp"><b>${fmt(inLevel)}</b> / ${fmt(XP_PER_LEVEL)} XP</span>
        </div>
        <div class="mp-bar" role="progressbar" aria-label="Niveau ${d.level}, progression vers le niveau ${d.level + 1}" aria-valuemin="0" aria-valuemax="${XP_PER_LEVEL}" aria-valuenow="${inLevel}">
          <i style="width:${(progress(d) * 100).toFixed(1)}%"></i>
        </div>
        <div class="mp-prog__foot">
          <span><b>${fmt(missing)} XP</b> avant le niveau ${d.level + 1}</span>
          <span class="mp-eta" title="Estimation : 1 XP par minute de présence en live, +3 XP par message (un par minute). Varie selon ta participation.">≈ ${duration(missing / XP_PER_MIN_ACTIVE)}</span>
        </div>
      </div>
    </div>`;
}

function restrictionsHtml(d) {
  const list = d.restrictions;
  if (!list.length)
    return `<div class="mp-empty">
      <span class="mp-empty__icon">${icon('shieldOk')}</span>
      <strong>Aucune restriction</strong>
      <span>Tout est ouvert pour toi.</span>
    </div>`;
  return `<ul class="mp-rlist" aria-label="${list.length} restriction${list.length > 1 ? 's' : ''} active${list.length > 1 ? 's' : ''}">${list
    .map((r) => {
      const end = r.end?.() ?? null;
      const block = r.kind === 'block';
      return `<li class="mp-r mp-r--${r.kind}">
        <span class="mp-r__icon">${icon(block ? 'ban' : 'clock')}</span>
        <span class="mp-r__main">
          <span class="mp-r__line"><b>${esc(r.module)}</b><span class="mp-r__kind">${block ? 'Bloqué' : 'Délai'}</span></span>
          <span class="mp-r__detail" title="${esc(r.detail(end))}">${esc(r.detail(end))}</span>
        </span>
        <span class="mp-r__left" title="${end ? `${block ? 'Fin' : 'Prochain'} dans ${left(end - now())}` : 'Sans date de fin'}">${end ? left(end - now()) : 'Indéfini'}</span>
      </li>`;
    })
    .join('')}</ul>`;
}

function prefsHtml() {
  return `<div class="mp-prefs">
    <div class="mp-pref">
      <span class="mp-pref__text">
        <b>Son de Level Up</b>
        <span>Jouer un son lorsque je monte de niveau</span>
      </span>
      <button type="button" class="mp-switch" role="switch" aria-checked="${soundDemo}" data-mp="sound" aria-label="Jouer un son lorsque je monte de niveau"><i></i></button>
    </div>
    <p class="mp-pref__note">${icon('info')}Aperçu : ce réglage arrive avec Level Up V2. Ici, rien n’est enregistré.</p>
    <button type="button" class="mp-pref-row" data-mp="refresh">${icon('refresh')}<span>Actualiser l’extension</span></button>
  </div>`;
}

function build(document) {
  const d = data();
  const node = document.createElement('div');
  node.className = 'mp-panel';
  node.id = 'mp-panel';
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', `Profil de ${d.name}`);
  node.tabIndex = -1;
  const count = d.restrictions.length;
  const rankAttrs = ctx?.rankingUrl
    ? `a href="${esc(ctx.rankingUrl)}" target="_blank" rel="noopener noreferrer" title="Classement — raptoru.fr, nouvel onglet"`
    : 'button type="button" title="Classement — le lien raptoru.fr n’est pas configuré dans le Lab"';
  node.innerHTML = `
    <header class="mp-head">
      ${avatarHtml(d, 'mp-ava--lg')}
      <div class="mp-head__text">
        <strong class="mp-name" title="${esc(d.name)}">${esc(d.name)}</strong>
        <span class="mp-tags">${(d.tags.length ? d.tags : [{ tone: 'plain', text: 'Viewer' }]).map((t) => `<span class="mp-tag mp-tag--${t.tone}">${esc(t.text)}</span>`).join('')}</span>
      </div>
      <button type="button" class="mp-gear" data-mp="prefs" aria-pressed="false" aria-label="Préférences" title="Préférences">${icon('gear')}</button>
    </header>

    <nav class="mp-nav" aria-label="Mon profil">
      <div class="mp-tabs" role="tablist" aria-label="Sections">
        <span class="mp-tabs__pill" aria-hidden="true"></span>
        <button type="button" class="mp-tab" role="tab" id="mp-t-home" aria-controls="mp-v-home" data-tab="home">${icon('home')}<span>Accueil</span></button>
        <button type="button" class="mp-tab" role="tab" id="mp-t-restr" aria-controls="mp-v-restr" data-tab="restr">${icon('shield')}<span>Restrictions</span>${count ? `<em class="mp-tab__count" aria-label="${count} active${count > 1 ? 's' : ''}">${count}</em>` : ''}</button>
      </div>
      <button type="button" class="mp-short mp-short--history" data-mp="history" title="Historique — tes dernières actions">
        <span class="mp-short__icon"></span><span>Historique</span>${icon('go', 'mp-i mp-short__go')}
        ${d.notices ? `<em class="mp-short__count" aria-label="${d.notices} non lue${d.notices > 1 ? 's' : ''}">${d.notices > 9 ? '9+' : d.notices}</em>` : ''}
      </button>
      <${rankAttrs} class="mp-short mp-short--ranking" data-mp="ranking">
        <span class="mp-short__icon"></span><span>Classement</span>${icon('external', 'mp-i mp-short__go')}
      </${ctx?.rankingUrl ? 'a' : 'button'}>
    </nav>

    <div class="mp-body">
      <section class="mp-view mp-view--home" id="mp-v-home" role="tabpanel" aria-labelledby="mp-t-home" data-view="home">${homeHtml(d)}</section>
      <section class="mp-view mp-view--restr" id="mp-v-restr" role="tabpanel" aria-labelledby="mp-t-restr" data-view="restr">${restrictionsHtml(d)}</section>
      <section class="mp-view mp-view--prefs" aria-label="Préférences" data-view="prefs">${prefsHtml()}</section>
    </div>`;
  node.querySelector('.mp-short--history .mp-short__icon').append(hubIcon(document, 'clock'));
  node.querySelector('.mp-short--ranking .mp-short__icon').append(hubIcon(document, 'trophy'));
  node.addEventListener('click', onClick);
  node.addEventListener('keydown', onTabKeys);
  return node;
}

/** Shows `next` (home | restr | prefs): the views share one grid cell, so the panel keeps its height. */
function show(next, { focusTab = false } = {}) {
  if (!panel) return;
  const from = view;
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
    if (on && from !== next) {
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
  if (act === 'prefs') return show(view === 'prefs' ? 'home' : 'prefs');
  if (act === 'credits') {
    // Secondary reading: the total ⇄ the credits of each module, in the same place (no height change).
    const on = target.getAttribute('aria-expanded') !== 'true';
    target.setAttribute('aria-expanded', String(on));
    target.classList.toggle('is-split', on);
    return;
  }
  if (act === 'sound') {
    soundDemo = !soundDemo;
    target.setAttribute('aria-checked', String(soundDemo));
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
  } else if (act === 'ranking' && !ctx?.rankingUrl) {
    target.classList.add('is-unset'); // Lab: no raptoru.fr link — the tooltip says so, never a dead page
  } else if (act === 'ranking') closeProfile();
}

function attach(document, hub, entering) {
  panel ??= build(document);
  panel.classList.toggle('is-entering', entering);
  if (entering) panel.addEventListener('animationend', (e) => e.target === panel && panel.classList.remove('is-entering'), { once: true });
  hub.append(panel);
  show(view);
  // The exact balance always, a little smaller when the tile is too narrow (never cut); the name on one line.
  requestAnimationFrame(() => {
    if (!panel) return;
    // Too long even a little smaller (125 % zoom, billions): the extension's compact form, the exact one on hover.
    for (const v of panel.querySelectorAll('.mp-cur__val[data-v]')) v.textContent = fmt(v.dataset.v);
    fitMoney(panel, '.mp-cur__val', 0.62);
    for (const v of panel.querySelectorAll('.mp-cur__val[data-v]'))
      if (v.scrollWidth > v.parentElement.clientWidth + 1) {
        v.textContent = formatCompactAmount(v.dataset.v).replace(/\u202f/g, '\u00a0'); // « 1 254 M », readable in bold
        fitMoney(v.parentElement, '.mp-cur__val', 0.62);
      }
    fitMoney(panel, '.mp-name', 0.8);
  });
}

function paintButton() {
  if (!button) return;
  const d = data();
  const n = d.restrictions.length;
  button.setAttribute('aria-expanded', String(open));
  button.classList.toggle('is-open', open);
  button.innerHTML = avatarHtml(d, 'mp-ava--sm') + (n ? '<span class="mp-avatar-btn__dot" aria-hidden="true"></span>' : '');
  button.setAttribute('aria-label', `Mon profil : ${d.name}, niveau ${d.level}${n ? `, ${n} restriction${n > 1 ? 's' : ''} active${n > 1 ? 's' : ''}` : ''}`);
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
 * The header avatar (rebuilt with the header at each redraw). `options`: { openHistory, rankingUrl, refresh,
 * closeDrawers } from ui.js — the existing behaviours, nothing new.
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
    paintButton();
    // The notification / preference drawers: one floating thing at a time. Closing one redraws the Hub, which
    // already brings the panel back (attachProfilePanel); otherwise it opens here, with its short entrance.
    ctx?.closeDrawers?.();
    const hub = button?.closest('.rh-hub');
    if (!panel?.isConnected && hub) attach(document, hub, true);
    panel?.focus({ preventScroll: true });
  });
  return button;
}

/** Called at the end of each Hub redraw: the open panel comes back as it was (same node, same view). */
export function attachProfilePanel(document, hub) {
  if (open) attach(document, hub, false);
}
