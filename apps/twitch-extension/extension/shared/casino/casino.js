// Casino (docs/CASINO.md) — the extension's entry: three tiles of the Mini-jeux catalogue (the slot machine, the
// roulette, the rounds being played now) and their screens. Each screen lives in a Shadow DOM (the validated casino
// styles stay inside; the extension's stay outside) and takes the extension's real header (its title, its ‹ back to
// the catalogue). The Core decides everything; offline or closed, the games say so and the history stays readable.
// A spectator opens a round from « Parties en cours »: he sees the same round as the player, never a control of his.
// The games' code loads with their first screen (a Mini-jeux catalogue without the casino open loads none of it).
import * as Frame from './frame.js';

const LOADERS = { slot: () => import('./slot.js').then((m) => m.mountSlot), roulette: () => import('./roulette.js').then((m) => m.mountRoulette) };

const { ICON, esc, fmt, compact } = Frame;
// The shared frame, then each game's own sheet (as the validated prototype loaded them: their class names never meet).
const SHEETS = { base: 'modules/casino/casino.css', slot: 'modules/casino/slot.css', roulette: 'modules/casino/roulette.css' };
const LIVE_POLL_MS = 4000;
const GAME = {
  slot: { label: 'Machine à sous', icon: ICON.slots },
  roulette: { label: 'Roulette', icon: ICON.roulette },
};
const PHASE = { draw: 'Tirage', bonus: 'Coffre', result: 'Résultat' };

/** Loads a sheet into the shadow root (shown once loaded: no unstyled flash); resolves at once if already there. */
function sheet(D, href) {
  let l = D.querySelector(`link[data-sheet="${href}"]`);
  if (l) return l.dataset.loaded ? Promise.resolve() : new Promise((ok) => (l.addEventListener('load', ok), l.addEventListener('error', ok)));
  l = D.ownerDocument.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  l.dataset.sheet = href;
  const done = new Promise((ok) => {
    const fin = () => ((l.dataset.loaded = '1'), ok());
    l.addEventListener('load', fin);
    l.addEventListener('error', fin);
  });
  // In the prototype's order: the shared sheet first, then the game's (it wins at equal specificity).
  D.insertBefore(l, D.getElementById('body'));
  return done;
}
/** Only the open game's sheet stays in the shadow root (the shared one always). */
function useSheets(D, game) {
  for (const l of D.querySelectorAll('link[data-sheet]')) if (l.dataset.sheet !== SHEETS.base && l.dataset.sheet !== SHEETS[game]) l.remove();
  const base = sheet(D, SHEETS.base);
  return Promise.all([base, game in SHEETS && game !== 'base' ? sheet(D, SHEETS[game]) : null]);
}

/** A casino screen: its shadow root and its body. */
function shell(document) {
  const host = document.createElement('div');
  host.className = 'cz-host';
  host.style.cssText = 'display:block;width:100%;height:100%;position:relative';
  const D = host.attachShadow({ mode: 'open' });
  D.innerHTML = '<div id="body" class="cz is-loading" aria-busy="true"><p class="cz-load">Chargement du Casino…</p></div>';
  return { host, D };
}

/**
 * One casino screen for Mini-jeux: `kind` = 'slot' | 'roulette' | 'live'; `watch` = a round id (spectator).
 * Returns the Mini-jeux game view: { node, start, destroy, busy, ownsHeader, headLabel, headIcon }.
 */
function casinoScreen({ document, client, kind }) {
  const { host, D } = shell(document);
  let game = null;
  let screen = kind; // 'slot' | 'roulette' | 'live'
  let watching = null; // the round watched (spectator)
  let destroyed = false;
  let liveTimer = null;
  const W = globalThis;
  const body = () => D.getElementById('body');
  const redrawHeader = () => host.dispatchEvent(new globalThis.CustomEvent('jdm:host-redraw', { bubbles: true, composed: true }));

  function fail(e, retry) {
    const b = body();
    b.className = 'cz is-error';
    b.innerHTML = `<div class="cz-err"><b>Le Casino ne répond pas.</b><small>${esc(Frame.refusalText(e))}</small><button type="button" class="btn go" data-retry>Réessayer</button></div>`;
    b.querySelector('[data-retry]').addEventListener('click', () => void retry());
  }

  async function open(next, watch = null) {
    if (destroyed) return;
    game?.destroy();
    game = null;
    W.clearTimeout(liveTimer);
    Frame.useRoot(D);
    screen = next;
    watching = watch;
    const b = body();
    b.className = 'cz is-loading';
    b.innerHTML = '<p class="cz-load">Chargement du Casino…</p>';
    let casino;
    let mount;
    try {
      [casino, mount] = await Promise.all([client.casinoState(), next === 'live' ? null : LOADERS[next](), useSheets(D, next)]);
    } catch (e) {
      return fail(e, () => open(next, watch));
    }
    if (destroyed) return;
    Frame.useRoot(D);
    const ctx = { client, casino, watch: watch?.round_id ?? null, onLeave: () => void open('live') };
    if (next === 'live') game = mountLive(D, { client, casino, onWatch: (r) => void open(r.game, r) });
    else game = mount(D, ctx);
    redrawHeader();
  }

  /** « Parties en cours »: the rounds being played now (light list, read every 4 s while this screen is open). */
  function mountLive(D2, { client: c, casino, onWatch }) {
    const b = body();
    b.className = 'cz live-body';
    let rows = casino.active ?? [];
    const paint = () => {
      b.innerHTML = `<div class="live">
        <header class="live__head"><b>Parties en cours</b><small>Regarde les autres viewers jouer : tu vois la même partie qu’eux, sans pouvoir miser à leur place.</small></header>
        ${
          rows.length
            ? `<ul class="live__list">${rows
                .map(
                  (r) => `<li class="live__row">
                    <span class="live__ic" aria-hidden="true">${GAME[r.game]?.icon ?? ''}</span>
                    <span class="live__who"><b>${esc(r.viewer_name)}</b><small>${GAME[r.game]?.label ?? r.game} · mise ${compact(r.bet)}</small></span>
                    <span class="live__st ${r.phase}">${PHASE[r.phase] ?? ''}${r.phase === 'bonus' && r.steps ? ` · relance ${Math.max(0, r.progress_step + 1)}/${r.steps}` : ''}${r.phase === 'result' && r.payout !== null ? ` · ${r.payout ? '+' + fmt(r.payout) : 'perdu'}` : ''}</span>
                    <button type="button" class="btn go live__go" data-watch="${esc(r.round_id)}">${ICON.eye}<span>Regarder</span></button>
                  </li>`,
                )
                .join('')}</ul>`
            : '<p class="live__empty">Aucune partie en cours pour l’instant.<br><small>Elles apparaissent ici dès qu’un viewer joue pendant le live.</small></p>'
        }
        ${casino.availability.open ? '' : `<p class="live__note">${esc(Frame.REFUSAL[casino.availability.reason] ?? '')}</p>`}
      </div>`;
      b.querySelectorAll('svg').forEach((s) => s.setAttribute('aria-hidden', 'true'));
    };
    const onClick = (e) => {
      const id = e.target.closest('[data-watch]')?.dataset.watch;
      const r = id && rows.find((x) => x.round_id === id);
      if (r) onWatch(r);
    };
    b.addEventListener('click', onClick);
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const st = await c.casinoState();
        rows = st.active ?? [];
        casino = st;
        paint();
      } catch {
        /* the next read */
      }
      if (alive) liveTimer = W.setTimeout(tick, LIVE_POLL_MS);
    };
    paint();
    liveTimer = W.setTimeout(tick, LIVE_POLL_MS);
    return {
      busy: () => false,
      destroy() {
        alive = false;
        W.clearTimeout(liveTimer);
        b.removeEventListener('click', onClick);
      },
    };
  }

  return {
    node: host,
    ownsHeader: true,
    headLabel: () => (watching ? 'Spectateur' : screen === 'live' ? 'Parties en cours' : GAME[screen].label),
    headIcon: () => (screen === 'live' ? ICON.eye : GAME[screen]?.icon ?? null),
    busy: () => !!game?.busy?.(),
    start() {
      void open(kind);
    },
    destroy() {
      destroyed = true;
      W.clearTimeout(liveTimer);
      game?.destroy();
      game = null;
    },
    /** The header's ‹ while watching: back to the rounds in progress (not the catalogue). */
    back() {
      if (!watching) return false;
      void open('live');
      return true;
    },
  };
}

const TILE_ICON = {
  slot: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="10" width="36" height="28" rx="6" fill="#2a1a46" stroke="#f2c65f" stroke-width="2.5"/><path d="M18 10v28M30 10v28" stroke="#f2c65f" stroke-width="2"/><text x="12" y="29" font-size="10" font-weight="900" fill="#ff5c7a" font-family="Arial Black,Impact,sans-serif">7</text><text x="22" y="29" font-size="10" font-weight="900" fill="#ff5c7a" font-family="Arial Black,Impact,sans-serif">7</text><text x="34" y="29" font-size="10" font-weight="900" fill="#ff5c7a" font-family="Arial Black,Impact,sans-serif">7</text></svg>',
  roulette: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17" fill="#3a1020" stroke="#f2c65f" stroke-width="2.5"/><circle cx="24" cy="24" r="11" fill="none" stroke="#f2c65f" stroke-width="1.5" stroke-dasharray="3 3"/><circle cx="24" cy="24" r="4" fill="#f2c65f"/><circle cx="34" cy="16" r="2.6" fill="#fff"/></svg>',
  live: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 24s7-12 19-12 19 12 19 12-7 12-19 12S5 24 5 24z" fill="#1d1a3a" stroke="#f2c65f" stroke-width="2.5"/><circle cx="24" cy="24" r="6" fill="#f2c65f"/><circle cx="38" cy="11" r="4" fill="#ff3d5a"/></svg>',
};

/** The casino's tiles for the Mini-jeux catalogue (hidden when the Core does not offer the casino to this viewer). */
export function casinoGames({ document, client }) {
  let cached = null;
  let at = 0;
  const state = async () => {
    if (cached && Date.now() - at < 10_000) return cached;
    cached = await client.casinoState();
    at = Date.now();
    return cached;
  };
  const available = async () => {
    try {
      await state();
      return true;
    } catch (e) {
      // Not offered (Production without CASINO_EXTENSION, an older Core): no tile. A network error: the tile stays.
      return !(e?.status === 404 || e?.code === 'not_available');
    }
  };
  const closedLine = (st, game) =>
    st.availability.games[game] ? null : st.availability.reason === 'stream_offline' ? 'Ouvert pendant le live' : 'Fermé pour le moment';
  return [
    {
      id: 'casino_slot',
      label: 'Machine à sous',
      tagline: 'Cinq rouleaux, dix lignes, et le Coffre du Raptor.',
      icon: TILE_ICON.slot,
      available,
      create: () => casinoScreen({ document, client, kind: 'slot' }),
      async peek() {
        const st = await state();
        return closedLine(st, 'slot') ?? `Mise ${fmt(st.limits.slot_min_bet)} à ${fmt(st.limits.slot_max_bet)}`;
      },
    },
    {
      id: 'casino_roulette',
      label: 'Roulette',
      tagline: 'Roulette européenne : plusieurs mises, une bille.',
      icon: TILE_ICON.roulette,
      available,
      create: () => casinoScreen({ document, client, kind: 'roulette' }),
      async peek() {
        const st = await state();
        return closedLine(st, 'roulette') ?? `Jusqu’à ${fmt(st.limits.roulette_max_total)} par tour`;
      },
    },
    {
      id: 'casino_live',
      label: 'Parties en cours',
      tagline: 'Regarde les autres viewers jouer, en direct.',
      cta: 'Regarder',
      icon: TILE_ICON.live,
      available,
      create: () => casinoScreen({ document, client, kind: 'live' }),
      async peek() {
        const st = await state();
        const n = st.active?.length ?? 0;
        return n ? `${n} partie${n > 1 ? 's' : ''} en ce moment` : 'Aucune partie en ce moment';
      },
    },
  ];
}
