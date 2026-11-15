// Mini-profil viewer — MAQUETTE (branche design/mini-profil, 15/11/2026). L'avatar du viewer dans l'en-tête du Hub ouvre
// un panneau de compte flottant : identité, wallet complet, progression, restrictions personnelles, Historique et
// Classement (retirés du bas de l'accueil), Préférences (l'ancien ⚙ de l'en-tête).
// DONNÉES FICTIVES UNIQUEMENT : aucun endpoint, aucun solde réel, aucune restriction réelle. Seuls Historique, Classement
// et Préférences réutilisent les comportements existants (callbacks de ui.js). ui.js ne fait que le câbler
// (règle des fichiers centraux, ASTRA-P1-008).
import { fitMoney, fmtAmount as fmt } from './currency.js';
import { hubIcon } from './hub-carousel.js';
import { RUNTIME } from './runtime-config.js';

const AVATAR = (code) => `assets/twemoji/svg/${code}.svg`;
const now = () => Date.now();

/** Scénarios de démonstration (Lab) : tous les cas à vérifier, changeables depuis le panneau. */
const DEMO = {
  standard: {
    name: 'PixelMoustache',
    avatar: AVATAR('1f996'),
    avatarBg: 'linear-gradient(135deg, #3b2a63, #6d3fc4)',
    tags: [{ tone: 'sub', text: 'Abonné · 14 mois' }],
    tokens: 48_250,
    reserved: 300,
    credits: [{ label: 'Bonk', n: 2 }, { label: 'TTS', n: 1 }],
    level: 12,
    xp: 11_380,
    rank: 128,
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
    reserved: 12_500,
    credits: [{ label: 'Bonk', n: 1_240 }, { label: 'Soundboard', n: 98 }, { label: 'TTS', n: 7 }],
    level: 87,
    xp: 86_940,
    rank: 3,
    notices: 0,
    restrictions: [
      { kind: 'cooldown', module: 'Bonk', end: () => now() + 42_000, detail: 'Délai personnel : 1 Bonk toutes les 2 min.' },
    ],
  },
  restrictions: {
    name: 'Mistigri',
    avatar: AVATAR('1f431'),
    avatarBg: 'linear-gradient(135deg, #1f3b4d, #2f7f9e)',
    tags: [],
    tokens: 2_350,
    reserved: 0,
    credits: [],
    level: 4,
    xp: 3_120,
    rank: 2_041,
    notices: 12,
    restrictions: [
      { kind: 'block', module: 'TTS', end: () => now() + 12 * 60_000, detail: 'Le TTS t’est fermé jusqu’à la fin du délai.' },
      { kind: 'cooldown', module: 'Bonk', end: () => now() + 42_000, detail: 'Délai personnel : 1 Bonk toutes les 2 min.' },
      { kind: 'block', module: 'Soundboard', end: null, detail: 'Fermé jusqu’à ce qu’un modérateur le rouvre.' },
    ],
  },
};
const SCENARIOS = [
  ['standard', 'Normal'],
  ['long', 'Pseudo long'],
  ['restrictions', 'Restrictions'],
];
// Rythme Level Up V2 (1 XP/min de présence, 3 XP/message, un par minute) : seulement pour l'estimation affichée.
const XP_PER_LEVEL = 1000;
const XP_PER_MIN_ACTIVE = 4;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ordinal = (n) => (n === 1 ? '1ᵉʳ' : `${fmt(n)}ᵉ`);
const left = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 && s < 600 ? ` ${String(s % 60).padStart(2, '0')}` : ''}`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
};
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const duration = (min) => (min < 60 ? `${Math.max(1, Math.round(min))} min` : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`);

const ICON = {
  shield: '<path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2Z"/>',
  check: '<path d="m8.6 12.2 2.4 2.4 4.4-4.8"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.8"/>',
  ban: '<circle cx="12" cy="12" r="8"/><path d="m6.6 6.6 10.8 10.8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/>',
  chevron: '<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>',
  external: '<path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/>',
  spark: '<path d="M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3M7 7l1.8 1.8M15.2 15.2 17 17M7 17l1.8-1.8M15.2 8.8 17 7"/>',
};
const icon = (name, cls = 'mp-i') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

const isLab = RUNTIME.buildId === 'extension-lab';
let open = false;
let scenario = 'standard';
let panel = null; // built once per scenario, re-attached across the Hub's redraws (scroll, détails, no replayed animation)
let button = null; // the current header avatar (rebuilt with the header)
let ctx = null; // latest callbacks from ui.js
let scrollTop = 0;
let listening = false;

const data = () => DEMO[scenario];
const progress = (d) => (d.xp % XP_PER_LEVEL) / XP_PER_LEVEL;

function avatarHtml(d, cls) {
  return `<span class="mp-ava ${cls}" style="--mp-p:${(progress(d) * 100).toFixed(1)}%">
    <span class="mp-ava__img" style="background:${d.avatarBg}"><img src="${d.avatar}" alt="" draggable="false"></span>
  </span>`;
}

function restrictionsHtml(d) {
  const list = d.restrictions;
  if (!list.length)
    return `<section class="mp-restr is-none" aria-label="Restrictions">
      <span class="mp-restr__icon">${icon('shield')}${icon('check', 'mp-i mp-i--over')}</span>
      <span class="mp-restr__title">Restrictions</span>
      <span class="mp-restr__state">Aucune</span>
    </section>`;
  const rows = list
    .map((r) => {
      const end = r.end?.() ?? null;
      const when = end ? `${r.kind === 'cooldown' ? 'Prochain dans' : 'Fin dans'} ${left(end - now())}` : 'Jusqu’au déblocage';
      return `<details class="mp-r mp-r--${r.kind}">
        <summary>
          ${icon(r.kind === 'cooldown' ? 'clock' : 'ban')}
          <span class="mp-r__what"><b>${esc(r.module)}</b><span>${r.kind === 'cooldown' ? 'Délai' : 'Bloqué'}</span></span>
          <span class="mp-r__left">${end ? left(end - now()) : 'Indéfini'}</span>
          ${icon('chevron', 'mp-i mp-r__chev')}
        </summary>
        <p class="mp-r__detail">${esc(r.detail)}<br><span>${when}${end && r.kind === 'block' ? ` · jusqu’à ${hhmm(end)}` : ''}</span></p>
      </details>`;
    })
    .join('');
  return `<section class="mp-restr is-active" aria-label="Restrictions actives">
    <div class="mp-restr__head">
      <span class="mp-restr__icon">${icon('shield')}</span>
      <span class="mp-restr__title">Restrictions</span>
      <span class="mp-restr__count">${list.length} active${list.length > 1 ? 's' : ''}</span>
    </div>
    <div class="mp-restr__list">${rows}</div>
  </section>`;
}

function build(document) {
  const d = data();
  const inLevel = d.xp % XP_PER_LEVEL;
  const missing = XP_PER_LEVEL - inLevel;
  const credits = d.credits.reduce((s, c) => s + c.n, 0);
  const node = document.createElement('div');
  node.className = 'mp-panel';
  node.id = 'mp-panel';
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', `Profil de ${d.name}`);
  node.tabIndex = -1;
  node.innerHTML = `<div class="mp-scroll">
    <header class="mp-id">
      ${avatarHtml(d, 'mp-ava--lg')}
      <div class="mp-id__text">
        <strong class="mp-name" title="${esc(d.name)}">${esc(d.name)}</strong>
        ${d.tags.length ? `<span class="mp-tags">${d.tags.map((t) => `<span class="mp-tag mp-tag--${t.tone}">${esc(t.text)}</span>`).join('')}</span>` : '<span class="mp-tags"><span class="mp-tag mp-tag--plain">Viewer</span></span>'}
      </div>
    </header>

    <section class="mp-wallet" aria-label="Wallet">
      <div class="mp-cur mp-cur--tokens" title="${fmt(d.tokens)} Jetons">
        <span class="mp-cur__head"><span class="mp-coin mp-coin--tokens" aria-hidden="true"></span>Jetons</span>
        <span class="mp-cur__box"><strong class="mp-cur__val">${fmt(d.tokens)}</strong></span>
        <small class="mp-cur__sub">${d.reserved ? `dont ${fmt(d.reserved)} réservés` : 'disponibles'}</small>
      </div>
      <div class="mp-cur mp-cur--credits" title="${d.credits.length ? d.credits.map((c) => `${c.label} ${fmt(c.n)}`).join(' · ') : 'Aucun crédit'} — propres à chaque module">
        <span class="mp-cur__head"><span class="mp-coin mp-coin--credits" aria-hidden="true"></span>Crédits</span>
        <span class="mp-cur__box"><strong class="mp-cur__val">${fmt(credits)}</strong></span>
        <small class="mp-cur__sub">${d.credits.length ? d.credits.map((c) => `${esc(c.label)} ${fmt(c.n)}`).join(' · ') : 'aucun pour l’instant'}</small>
      </div>
    </section>

    <section class="mp-prog" aria-label="Progression">
      <div class="mp-lvl" aria-hidden="true"><small>Niv.</small><b>${d.level}</b></div>
      <div class="mp-prog__body">
        <div class="mp-prog__top">
          <span class="mp-prog__title">Niveau ${d.level}</span>
          <span class="mp-prog__xp"><b>${fmt(inLevel)}</b> / ${fmt(XP_PER_LEVEL)} XP</span>
        </div>
        <div class="mp-bar" role="progressbar" aria-label="Progression vers le niveau ${d.level + 1}" aria-valuemin="0" aria-valuemax="${XP_PER_LEVEL}" aria-valuenow="${inLevel}">
          <i style="width:${(progress(d) * 100).toFixed(1)}%"></i>
        </div>
        <div class="mp-prog__foot">
          <span><b>${fmt(missing)} XP</b> avant le niveau ${d.level + 1}</span>
          <span class="mp-eta" title="Estimation : 1 XP par minute de présence en live, +3 XP par message (un par minute). Varie selon ta participation.">≈ ${duration(missing / XP_PER_MIN_ACTIVE)} de live</span>
        </div>
      </div>
    </section>

    ${restrictionsHtml(d)}

    <nav class="mp-links" aria-label="Raccourcis">
      <button type="button" class="mp-link mp-link--history" data-mp="history">
        <span class="mp-link__icon"></span>
        <span class="mp-link__text"><b>Historique</b><small>${d.notices ? `${d.notices} nouveauté${d.notices > 1 ? 's' : ''}` : 'Tes dernières actions'}</small></span>
        ${d.notices ? `<span class="mp-link__count">${d.notices > 9 ? '9+' : d.notices}</span>` : ''}
      </button>
      <${ctx?.rankingUrl ? `a href="${esc(ctx.rankingUrl)}" target="_blank" rel="noopener noreferrer"` : 'button type="button"'} class="mp-link mp-link--ranking" data-mp="ranking">
        <span class="mp-link__icon"></span>
        <span class="mp-link__text"><b>Classement</b><small>Tu es ${ordinal(d.rank)}</small></span>
        ${ctx?.rankingUrl ? icon('external', 'mp-i mp-link__ext') : ''}
      </${ctx?.rankingUrl ? 'a' : 'button'}>
    </nav>

    <button type="button" class="mp-row" data-mp="preferences">${icon('gear')}<span>Préférences</span>${icon('chevron', 'mp-i mp-row__chev')}</button>

    ${isLab ? `<footer class="mp-lab">
      <span class="mp-lab__tag">${icon('spark')}Maquette · données fictives</span>
      <span class="mp-lab__seg" role="group" aria-label="Cas de démonstration">${SCENARIOS.map(([id, label]) => `<button type="button" data-mp-demo="${id}" aria-pressed="${id === scenario}">${label}</button>`).join('')}</span>
    </footer>` : ''}
  </div>`;
  // The Hub's own icons (same clock and trophy as the old bottom bar).
  node.querySelector('.mp-link--history .mp-link__icon').append(hubIcon(document, 'clock'));
  node.querySelector('.mp-link--ranking .mp-link__icon').append(hubIcon(document, 'trophy'));
  const scroll = node.querySelector('.mp-scroll');
  scroll.addEventListener('scroll', () => { scrollTop = scroll.scrollTop; more(); }, { passive: true });
  node.addEventListener('toggle', () => more(), true); // a restriction's detail opened or closed
  node.addEventListener('click', (e) => {
    const target = e.target.closest('[data-mp], [data-mp-demo]');
    if (!target) return;
    // Handled here: the Hub's « click outside closes the drawers » (ui.js) must not see it — it would close the
    // Préférences this click just opened (the row is gone from the page by then).
    e.stopPropagation();
    const demo = target.dataset.mpDemo;
    if (demo) {
      scenario = demo;
      const host = panel?.parentElement;
      panel?.remove();
      panel = null;
      scrollTop = 0;
      paintButton();
      if (host) attach(document, host, false);
      panel?.focus({ preventScroll: true });
      return;
    }
    const act = target.dataset.mp;
    if (act === 'history') {
      closeProfile();
      ctx?.openHistory?.();
    } else if (act === 'preferences') {
      closeProfile();
      ctx?.openPreferences?.();
    } else if (act === 'ranking' && !ctx?.rankingUrl) {
      // Lab: no raptoru.fr link configured — said here instead of a dead click.
      const sub = target.querySelector('small');
      if (sub) sub.textContent = 'Lien raptoru.fr absent du Lab';
    } else if (act === 'ranking') closeProfile();
  });
  return node;
}

/** A soft fade at the bottom while something is still below (the panel scrolls inside, never the Hub). */
function more() {
  const scroll = panel?.querySelector('.mp-scroll');
  if (scroll) panel.classList.toggle('has-more', scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 4);
}

function attach(document, hub, entering) {
  panel ??= build(document);
  panel.classList.toggle('is-entering', entering);
  if (entering) panel.addEventListener('animationend', () => panel?.classList.remove('is-entering'), { once: true });
  hub.append(panel);
  const scroll = panel.querySelector('.mp-scroll');
  scroll.scrollTop = scrollTop;
  // Balances: the exact number always, a little smaller when the tile is too narrow (never cut, never wrapped).
  requestAnimationFrame(() => {
    if (!panel) return;
    fitMoney(panel, '.mp-cur__val', 0.62);
    fitMoney(panel, '.mp-name', 0.78);
    more();
  });
}

function paintButton() {
  if (!button) return;
  const d = data();
  button.setAttribute('aria-expanded', String(open));
  button.classList.toggle('is-open', open);
  button.innerHTML = avatarHtml(d, 'mp-ava--sm') + (d.restrictions.length ? '<span class="mp-avatar-btn__dot" aria-hidden="true"></span>' : '');
  button.setAttribute('aria-label', `Mon profil : ${d.name}, niveau ${d.level}${d.restrictions.length ? `, ${d.restrictions.length} restriction${d.restrictions.length > 1 ? 's' : ''} active${d.restrictions.length > 1 ? 's' : ''}` : ''}`);
  button.title = 'Mon profil';
}

export function closeProfile({ focus = false } = {}) {
  if (!open) return;
  open = false;
  panel?.remove();
  scrollTop = 0;
  panel?.querySelectorAll('details[open]').forEach((x) => x.removeAttribute('open'));
  if (button) {
    button.setAttribute('aria-expanded', 'false');
    button.classList.remove('is-open');
    if (focus) button.focus({ preventScroll: true });
  }
}

/**
 * The header avatar (rebuilt with the header at each redraw). `options`: { openHistory, openPreferences, rankingUrl,
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

/** Called at the end of each Hub redraw: the open panel comes back as it was (same node). */
export function attachProfilePanel(document, hub) {
  if (open) attach(document, hub, false);
}
