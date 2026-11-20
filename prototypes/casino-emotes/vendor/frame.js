// Casino (docs/CASINO.md) — the shared frame of the two games, ported from the validated prototype (casino V7/V8,
// shared/frame.js): numbers, icons, messages, drawers, cards, bubbles, count-ups. The games live in a Shadow DOM (their
// validated styles never leak into the extension, the extension's never into them): `useRoot(shadowRoot)` names the one
// open casino screen. The real header (back, title, Jetons) is the extension's own: nothing of it is drawn here.

let D = null;
/** The open casino screen's shadow root (one at a time). */
export function useRoot(root) {
  D = root;
}
export const byId = (id) => D?.getElementById(id) ?? null;
const win = () => globalThis;

const NB = ' ';
const NNB = ' ';
export const fmt = (n) =>
  Math.round(n)
    .toLocaleString('fr-FR')
    .replace(/[\s\u00a0\u202f]/g, NB);
/** The extension's formatCompactAmount: 3 significant digits, truncated, never rounded up: 6 K · 58,9 K · 2,5 M. */
export function compact(value) {
  const neg = value < 0;
  const amount = Math.max(0, Math.trunc(Math.abs(value)));
  if (amount < 1000) return (neg ? '−' : '') + String(amount);
  const [divisor, unit] = amount < 1e6 ? [1e3, 'K'] : [1e6, 'M'];
  const decimals = Math.max(0, 3 - String(Math.trunc(amount / divisor)).length);
  const scaled = Math.floor(amount / (divisor / 10 ** decimals)) / 10 ** decimals;
  return `${neg ? '−' : ''}${scaled.toLocaleString('fr-FR', { maximumFractionDigits: decimals }).replace(/[\u00a0\u202f]/g, NNB)}${NNB}${unit}`;
}
/** A chip's or a cell's short amount: 20, 250, 1K, 2,5K, 25K. */
export const chipText = (n) => (n < 1000 ? String(n) : `${String(Math.floor(n / 100) / 10).replace('.', ',')}K`);
export const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></svg>',
  hist: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4.5V8h3.5"/><path d="M12 8v4.2l2.8 1.8"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path class="off" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/><path class="on-hide" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" class="fill"><path d="M13.4 2.2 4.8 13.4h6.1l-1.3 8.4 8.6-11.4h-6.1z"/></svg>',
  auto: '<svg viewBox="0 0 24 24"><path d="M18.6 9A7.4 7.4 0 1 0 19.4 13.6"/><path d="M19.6 4.6V9.2H15"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>',
  play: '<svg viewBox="0 0 24 24" class="fill"><path d="M8 5.2v13.6c0 .8.9 1.3 1.6.8l10.3-6.8a1 1 0 0 0 0-1.6L9.6 4.4C8.9 3.9 8 4.4 8 5.2z"/></svg>',
  ffwd: '<svg viewBox="0 0 24 24" class="fill"><path d="M3 6.4v11.2c0 .7.8 1.1 1.4.7l7.6-5.6a.9.9 0 0 0 0-1.4L4.4 5.7C3.8 5.3 3 5.7 3 6.4zM12 6.4v11.2c0 .7.8 1.1 1.4.7l7.6-5.6a.9.9 0 0 0 0-1.4l-7.6-5.6c-.6-.4-1.4 0-1.4.7z"/></svg>',
  skip: '<svg viewBox="0 0 24 24" class="fill"><path d="M4 6.2v11.6c0 .7.8 1.1 1.4.7l8.1-5.8a.9.9 0 0 0 0-1.4L5.4 5.5C4.8 5.1 4 5.5 4 6.2z"/><rect x="15.5" y="5" width="3.6" height="14" rx="1.2"/></svg>',
  stop: '<svg viewBox="0 0 24 24" class="fill"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
  replay: '<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.7h3.7"/><path d="M10.5 9.5v5l4-2.5z" fill="currentColor" stroke="none"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M5 5h14v10H10l-4 3.5V15H5z"/><path d="M9.5 10h5M12 7.5v5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 6.5 4.5 11 9 15.5"/><path d="M5 11h9.5a5 5 0 0 1 0 10H12"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M9.5 7V5h5v2M7 7l1 12h8l1-12"/></svg>',
  rebet: '<svg viewBox="0 0 24 24"><path d="M17 3.5 20.5 7 17 10.5"/><path d="M20 7H9a5 5 0 0 0-5 5M7 20.5 3.5 17 7 13.5"/><path d="M4 17h11a5 5 0 0 0 5-5"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M5 19l1-4L15.5 5.5a2.1 2.1 0 0 1 3 3L9 18z"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  slots: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M9 5v14M15 5v14"/></svg>',
  roulette: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 3.5V9M12 15v5.5M3.5 12H9M15 12h5.5"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" class="c"/><path d="M12 8.6 15.4 12 12 15.4 8.6 12z" class="d"/></svg>',
};

let toastTimer = null;
export function toast(text, bad = false, ms = 2200) {
  const t = byId('toast');
  if (!t) return;
  t.innerHTML = text;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  win().clearTimeout(toastTimer);
  toastTimer = win().setTimeout(() => t.classList.remove('show'), ms);
}

let drawerSeq = 0;
/** A side drawer over the game (the game stays visible beside it); closed by ×, Escape or a click beside it. */
export function drawer({ side = 'left', width = 236, title, tools = '', head, foot = '', render, onClick, onClose }) {
  const el = byId('drawer');
  const toolsHTML = () => (typeof tools === 'function' ? tools() : tools);
  el.innerHTML = `<div class="drawer__scrim" data-close></div><aside class="drawer__panel" style="--dw:${width}px" role="dialog" aria-label="${title.replace(/<[^>]+>/g, ' ').trim()}"><div class="drawer__head"><b>${title}</b><span class="drawer__tools">${toolsHTML()}</span><button type="button" class="xbtn" data-close aria-label="Fermer">${ICON.close}</button></div>${head ? `<div class="drawer__sum">${head()}</div>` : ''}<div class="drawer__body">${render()}</div>${foot ? `<p class="drawer__foot">${foot}</p>` : ''}</aside>`;
  // This drawer, not another one opened since (a late repaint — history loaded after a close — never writes into it).
  const mine = String((drawerSeq += 1));
  el.dataset.drawer = mine;
  // Only the CONTENT is replaced: the panel itself is never rebuilt (its entry animation would replay).
  const paint = () => {
    if (el.hidden || el.dataset.drawer !== mine || !el.querySelector('.drawer__body')) return;
    el.querySelector('.drawer__tools').innerHTML = toolsHTML();
    if (head) el.querySelector('.drawer__sum').innerHTML = head();
    el.querySelector('.drawer__body').innerHTML = render();
  };
  el.className = `drawer ${side}`;
  el.hidden = false;
  el.onclick = (e) => {
    if (e.target.closest('[data-close]')) return close();
    if (onClick) onClick(e, api);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  win().addEventListener('keydown', onKey);
  function close() {
    el.hidden = true;
    el.innerHTML = '';
    win().removeEventListener('keydown', onKey);
    if (onClose) onClose();
  }
  const api = { close, repaint: paint, el };
  return api;
}
export const drawerOpen = () => !!byId('drawer') && !byId('drawer').hidden;

/** A small bubble hooked to an element: closed by a click elsewhere. side: 'above' | 'right' | 'below'. */
export function pop(anchor, inner, { side = 'below', key } = {}) {
  const host = byId('body');
  let el = byId('pop');
  const id = key || anchor.dataset.act;
  if (el && el.dataset.for === id) return el.remove(), null;
  if (el) el.remove();
  el = D.ownerDocument.createElement('div');
  el.id = 'pop';
  el.className = `pop ${side}`;
  el.dataset.for = id;
  el.innerHTML = inner;
  host.append(el);
  const hb = host.getBoundingClientRect();
  const ab = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (side === 'right') {
    el.style.left = `${Math.min(hb.width - w - 4, ab.right - hb.left + 6)}px`;
    el.style.top = `${Math.max(4, Math.min(hb.height - h - 4, ab.top - hb.top + ab.height / 2 - h / 2))}px`;
  } else {
    el.style.left = `${Math.max(4, Math.min(hb.width - w - 4, ab.left - hb.left + ab.width / 2 - w / 2))}px`;
    el.style.top = side === 'above' ? `${Math.max(4, ab.top - hb.top - h - 8)}px` : `${ab.bottom - hb.top + 6}px`;
  }
  el.style.setProperty('--ax', `${ab.left + ab.width / 2 - hb.left - parseFloat(el.style.left)}px`);
  const off = (e) => {
    const path = e.composedPath?.() ?? [];
    if (path.includes(el) || path.includes(anchor)) return;
    el.remove();
    win().removeEventListener('pointerdown', off, true);
  };
  win().setTimeout(() => win().addEventListener('pointerdown', off, true));
  return el;
}
export const closePop = () => {
  const el = byId('pop');
  if (el) el.remove();
};

/** A card in the middle of the game. buttons: [[value, label, 'go'|'sec'|'gold']] → Promise(value). */
export function card(inner, buttons = [[true, 'OK', 'go']], host = byId('body'), cls = '') {
  return new Promise((resolve) => {
    const c = D.ownerDocument.createElement('div');
    c.className = `card ${cls}`;
    c.innerHTML = `<div class="card__in">${inner}<div class="row">${buttons.map(([, l, k], i) => `<button type="button" class="btn ${k}" data-i="${i}">${l}</button>`).join('')}</div></div>`;
    c.onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      c.remove();
      resolve(buttons[Number(b.dataset.i)][0]);
    };
    host.append(c);
  });
}

/** Counts from 0 to `to` in `ms` (fast first, slow at the end). */
export function countUp(paint, to, ms) {
  return new Promise((resolve) => {
    if (ms <= 0 || to <= 0) return paint(to), resolve();
    const t0 = performance.now();
    const step = (t) => {
      const u = Math.max(0, Math.min(1, (t - t0) / ms));
      paint(Math.round(to * (1 - (1 - u) ** 3)));
      if (u < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
};

/** The viewer's own small settings (Rapide, Son, last bet): this browser only. */
export function prefs(key, initial) {
  let v = initial;
  try {
    const raw = win().localStorage.getItem(key);
    if (raw) v = { ...initial, ...JSON.parse(raw) };
  } catch {
    /* memory only */
  }
  return {
    get: () => v,
    save() {
      try {
        win().localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* memory only */
      }
    },
  };
}

/** The Core's refusal codes, in French (never the Core's raw code on screen). */
export const REFUSAL = {
  insufficient_tokens: 'Solde insuffisant.',
  below_min: 'Mise trop basse.',
  above_max: 'Mise au-dessus du maximum.',
  above_max_win: 'Ces mises pourraient dépasser le gain maximum par partie.',
  invalid_bet: 'Montant invalide.',
  invalid_amount: 'Chaque jeton vaut au moins 20.',
  not_multiple: 'Chaque mise doit être un multiple de 20.',
  unknown_spot: 'Case inconnue.',
  empty: 'Pose au moins un jeton.',
  too_many_bets: 'Trop de mises différentes.',
  stream_offline: 'Le Casino n’ouvre que pendant le live.',
  casino_closed: 'Le Casino est fermé pour le moment.',
  game_closed: 'Ce jeu est fermé pour le moment.',
  not_approved: 'Le Casino n’est pas encore ouvert.',
  viewer_blocked: 'Tu ne peux pas jouer pour le moment.',
  global_pause: 'Les interactions sont en pause.',
  balance_cap: 'Ton solde atteindrait son plafond.',
  idempotency_conflict: 'Cette partie est déjà en cours : réessaie.',
  rate_limited: 'Doucement : trop de demandes, réessaie dans un instant.',
  share_cooldown: 'Tu as déjà partagé récemment.',
  share_busy: 'LeCroupier_ vient de parler : réessaie dans quelques secondes.',
  chat_unavailable: 'Le chat est indisponible pour le moment.',
  share_too_old: 'Cette partie est trop ancienne pour être partagée.',
  identity_required: 'Partage ton identité Twitch avec l’extension pour jouer.',
  casino_unavailable: 'Le Casino ne répond pas : réessaie, rien n’a été payé deux fois.',
  network_error: 'Connexion perdue : réessaie (la même partie n’est jamais payée deux fois).',
  timeout: 'Pas de réponse : réessaie (la même partie n’est jamais payée deux fois).',
};
export const refusalText = (e) => REFUSAL[e?.code] ?? REFUSAL[e?.message] ?? 'Ça n’a pas marché : réessaie.';

/**
 * The spectator's card (docs/CASINO.md § 6, 19/11): the followed player, live, the round's stake (gold) and win (green,
 * neutral when nothing) — never a win before the Core revealed it (`win: null` = still hidden). Built once in `host`,
 * then only its texts change: its live dot never restarts. `set({ state, text, bet, win, extra })`:
 * state = play | wait | done | left · bet = Jetons or null · win = undefined (no round) | null (hidden) | Jetons.
 */
export function watchCard(host, name, { sound = false } = {}) {
  host.innerHTML = `<div class="wc" role="status" aria-live="polite">
    <div class="wc__top"><span class="wc__live"><i class="live-dot"></i>EN DIRECT</span>${sound ? `<button type="button" class="wc__snd" data-act="sound" title="Son (ce navigateur)" aria-label="Son" aria-pressed="false">${ICON.sound}</button>` : ''}</div>
    <div class="wc__who"><span class="wc__av" aria-hidden="true">${esc(String(name).slice(0, 1).toUpperCase())}</span><span class="wc__id"><b>${esc(name)}</b><small class="wc__st" data-wc="st"></small></span></div>
    <div class="wc__amt wc__bet"><small>Mise</small><b data-wc="bet">—</b></div>
    <div class="wc__amt wc__win"><small>Gain</small><b data-wc="win">—</b></div>
    <div class="wc__extra" data-wc="extra" hidden></div>
  </div>`;
  const el = (k) => host.querySelector(`[data-wc="${k}"]`);
  const text = (e, t) => e.textContent !== t && (e.textContent = t);
  return {
    set({ state = 'wait', text: st = '', bet = null, win, extra = '' } = {}) {
      const s = el('st');
      text(s, st);
      s.className = `wc__st is-${state}`;
      text(el('bet'), bet ? fmt(bet) : '—');
      const w = el('win');
      text(w, win === undefined ? '—' : win === null ? '…' : win > 0 ? `+${fmt(win)}` : '0');
      w.className = win > 0 ? 'is-pos' : '';
      const x = el('extra');
      text(x, extra);
      x.hidden = !extra;
    },
  };
}
