// Casino (docs/CASINO.md) — the extension's entry: two game tiles of the Mini-jeux catalogue (the slot machine, the
// roulette) and a band under them, « Regarder les parties en direct ». Each screen lives in a Shadow DOM (the validated
// casino styles stay inside; the extension's stay outside) and takes the extension's real header (its title, its ‹ back
// to the catalogue). The Core decides everything; offline or closed, the games say so and the history stays readable.
// A spectator follows a PLAYER (follow.js: the Core's feed of their revealed stages): every round, every Coffre, the
// other game, on the same screens as the player's, with no control of theirs. A player says which game they have open
// (their spectators follow them). The games' code loads with their first screen.
import * as Frame from './frame.js';
import { createFollower } from './follow.js';

const LOADERS = { slot: () => import('./slot.js').then((m) => m.mountSlot), roulette: () => import('./roulette.js').then((m) => m.mountRoulette) };

const { ICON, esc, fmt, compact } = Frame;
// The shared frame, then each game's own sheet (as the validated prototype loaded them: their class names never meet).
const SHEETS = { base: 'modules/casino/casino.css', slot: 'modules/casino/slot.css', roulette: 'modules/casino/roulette.css' };
const GAME = {
  slot: { label: 'Machine à sous', icon: ICON.slots },
  roulette: { label: 'Roulette', icon: ICON.roulette },
};

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
// The sheets as constructed stylesheets, adopted by the shadow root: they belong to the root, not to an element, so
// they survive the panel moving the screen (a redraw detaches and re-attaches it). A <link> inside the root is unloaded
// and loaded again at each move: frames drawn without the casino's styles (icons at their natural size: the flash, the
// « zoom » seen on 18/11). Read once per page from a parsed <link> (same origin, no fetch), shared by every screen.
const CAN_ADOPT = (() => {
  try {
    return typeof globalThis.ShadowRoot !== 'undefined' && 'adoptedStyleSheets' in globalThis.ShadowRoot.prototype && typeof new globalThis.CSSStyleSheet().replaceSync === 'function';
  } catch {
    return false;
  }
})();
const CONSTRUCTED = new Map(); // href → Promise<CSSStyleSheet | null>
function constructed(D, href) {
  if (CONSTRUCTED.has(href)) return CONSTRUCTED.get(href);
  const p = new Promise((ok) => {
    const l = D.ownerDocument.createElement('link');
    l.rel = 'stylesheet';
    l.media = 'print'; // parsed, never applied here
    l.href = href;
    const done = (cs) => {
      l.remove();
      if (!cs) CONSTRUCTED.delete(href); // a failure is retried at the next opening
      ok(cs);
    };
    l.addEventListener('load', () => {
      try {
        const cs = new globalThis.CSSStyleSheet();
        cs.replaceSync([...l.sheet.cssRules].map((r) => r.cssText).join('\n'));
        done(cs);
      } catch {
        done(null);
      }
    });
    l.addEventListener('error', () => done(null));
    (D.ownerDocument.head ?? D.ownerDocument.documentElement).append(l); // loads even while the screen is detached
  });
  CONSTRUCTED.set(href, p);
  return p;
}
/** Only the open game's sheet stays in the shadow root (the shared one always, first). */
async function useSheets(D, game) {
  const hrefs = [SHEETS.base, ...(game in SHEETS && game !== 'base' ? [SHEETS[game]] : [])];
  if (CAN_ADOPT) {
    const list = await Promise.all(hrefs.map((h) => constructed(D, h)));
    if (list.every(Boolean)) {
      D.adoptedStyleSheets = list;
      for (const l of D.querySelectorAll('link[data-sheet]')) l.remove();
      return;
    }
  }
  // Without constructed sheets (an old browser): <link> elements, as before.
  for (const l of D.querySelectorAll('link[data-sheet]')) if (!hrefs.includes(l.dataset.sheet)) l.remove();
  await Promise.all(hrefs.map((h) => sheet(D, h)));
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

// A spectator this far behind the player's screen (a hidden tab coming back) plays the stages fast to catch up.
const CATCH_UP_MS = 6000;
const STATE = { playing: 'En jeu', bonus: 'Coffre', idle: 'Entre deux tours' };
// The followed player survives a refresh of the page (this tab only): the spectator comes back to them.
const FOLLOW_KEY = 'casino:follow';
const remembered = () => {
  try {
    const v = JSON.parse(globalThis.sessionStorage?.getItem(FOLLOW_KEY) ?? 'null');
    return v && typeof v.id === 'string' && /^\d{1,32}$/.test(v.id) ? v : null;
  } catch {
    return null;
  }
};
const remember = (p) => {
  try {
    if (p) globalThis.sessionStorage?.setItem(FOLLOW_KEY, JSON.stringify({ id: p.id, name: p.name, game: p.game }));
    else globalThis.sessionStorage?.removeItem(FOLLOW_KEY);
  } catch {
    /* memory only */
  }
};
const initial = (name) => esc(String(name ?? '?').trim().charAt(0).toUpperCase() || '?');

/** The game of a snapshot: its round's, else where the player is. */
function gameOf(events, fallback) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'start') return e.game;
    if (e.kind === 'presence' && e.data?.game) return e.data.game;
  }
  return fallback;
}

/**
 * One casino screen for Mini-jeux: `kind` = 'slot' | 'roulette' (play) | 'live' (who plays now, then follow one of
 * them); `follow` = a player { id, name } to follow at once. Returns the Mini-jeux game view.
 */
function casinoScreen({ document, client, kind, follow = null }) {
  const { host, D } = shell(document);
  let game = null; // the mounted game screen
  let screen = kind; // 'slot' | 'roulette' | 'live' | 'follow'
  let followed = null; // the followed player { id, name, game }
  let follower = null;
  let liveLoop = null; // the players list's long-poll
  let presenceTimer = null;
  let present = null; // the game this viewer has open (player)
  let destroyed = false;
  let token = 0; // each opening invalidates the previous one's async work
  let moved = null; // the CSS animations noted before the panel moves this screen (detaching → attached)
  const cssAnimations = () =>
    typeof D.getAnimations === 'function' && typeof W.CSSAnimation !== 'undefined' ? D.getAnimations().filter((a) => a instanceof W.CSSAnimation) : [];
  const W = globalThis;
  const body = () => D.getElementById('body');
  const redrawHeader = () => host.dispatchEvent(new globalThis.CustomEvent('jdm:host-redraw', { bubbles: true, composed: true }));

  function fail(e, retry) {
    const b = body();
    b.className = 'cz is-error';
    b.innerHTML = `<div class="cz-err"><b>Le Casino ne répond pas.</b><small>${esc(Frame.refusalText(e))}</small><button type="button" class="btn go" data-retry>Réessayer</button></div>`;
    b.querySelector('[data-retry]').addEventListener('click', () => void retry());
  }

  /** The game this viewer has open (their spectators follow them from one game to the other); a beat every minute. */
  function setPresence(g) {
    W.clearInterval(presenceTimer);
    if (present === g) return;
    const was = present;
    present = g;
    if (g || was) void client.casinoPresence(g).catch(() => {});
    if (g) presenceTimer = W.setInterval(() => !W.document?.hidden && void client.casinoPresence(g).catch(() => {}), 60_000);
  }

  function stopAll() {
    token += 1;
    follower?.stop();
    follower = null;
    liveLoop = null;
    game?.destroy();
    game = null;
  }

  /** Mounts a game screen (player, or spectator with `opts.follow`). */
  async function mount(next, opts = {}) {
    const my = token;
    Frame.useRoot(D);
    const b = body();
    b.className = 'cz is-loading';
    b.innerHTML = '<p class="cz-load">Chargement du Casino…</p>';
    let casino;
    let mountFn;
    try {
      [casino, mountFn] = await Promise.all([client.casinoState(), LOADERS[next](), useSheets(D, next)]);
    } catch (e) {
      if (my === token) fail(e, () => (opts.follow ? followPlayer(followed) : open(next)));
      return null;
    }
    if (destroyed || my !== token) return null;
    Frame.useRoot(D);
    game = mountFn(D, { client, casino, follow: opts.follow ?? null, onLeave: () => void openLive() });
    redrawHeader();
    return casino;
  }

  /** Plays a game (the viewer's own rounds). */
  async function open(next) {
    if (destroyed) return;
    stopAll();
    screen = next;
    followed = null;
    const casino = await mount(next);
    if (casino?.me) setPresence(next);
  }

  /** « Parties en direct »: who is playing now (updated as they start, stop, change game). */
  async function openLive() {
    if (destroyed) return;
    stopAll();
    remember(null);
    setPresence(null);
    screen = 'live';
    followed = null;
    redrawHeader();
    const my = token;
    Frame.useRoot(D);
    try {
      await useSheets(D, 'live');
    } catch {
      /* the shared sheet: retried by the next screen */
    }
    if (my !== token) return;
    const b = body();
    b.className = 'cz live-body';
    let players = [];
    let reason = null;
    const paint = () => {
      b.innerHTML = `<div class="live">
        <header class="live__head"><b>Parties en direct</b><small>Choisis un joueur : tu vois ses parties comme lui, tour après tour, sans pouvoir y toucher.</small></header>
        ${
          players.length
            ? `<ul class="live__list">${players
                .map(
                  (p) => `<li class="live__row">
                    <span class="live__av" aria-hidden="true">${initial(p.name)}</span>
                    <span class="live__who"><b>${esc(p.name)}</b><small>${GAME[p.game]?.label ?? 'Casino'}${p.bet ? ` · mise ${compact(p.bet)}` : ''}</small></span>
                    <span class="live__st ${p.state}">${STATE[p.state] ?? ''}</span>
                    <button type="button" class="btn go live__go" data-follow="${esc(p.id)}">${ICON.eye}<span>Regarder</span></button>
                  </li>`,
                )
                .join('')}</ul>`
            : '<p class="live__empty">Personne ne joue en ce moment.<br><small>Les joueurs apparaissent ici dès qu’ils ouvrent la machine à sous ou la roulette.</small></p>'
        }
        ${reason ? `<p class="live__note">${esc(reason)}</p>` : ''}
      </div>`;
      b.querySelectorAll('svg').forEach((s) => s.setAttribute('aria-hidden', 'true'));
    };
    b.onclick = (e) => {
      const id = e.target.closest('[data-follow]')?.dataset.follow;
      const p = id && players.find((x) => x.id === id);
      if (p) void followPlayer(p);
    };
    paint();
    let after = -1;
    let fails = 0;
    liveLoop = my;
    while (liveLoop === my && !destroyed) {
      if (W.document?.hidden) {
        await new Promise((ok) => W.setTimeout(ok, 1000));
        continue;
      }
      try {
        const res = await client.casinoLive(after, after < 0 ? 0 : 20_000);
        if (liveLoop !== my) return;
        fails = 0;
        after = res.cursor;
        players = res.players ?? [];
        paint();
      } catch (e) {
        if (liveLoop !== my) return;
        fails += 1;
        reason = fails > 1 ? Frame.refusalText(e) : null;
        paint();
        await new Promise((ok) => W.setTimeout(ok, Math.min(8000, 500 * 2 ** fails)));
      }
    }
  }

  /**
   * Follows ONE player: their stages from the Core's feed, played in order on the screen of the game they are in —
   * every round, every Coffre, the other game — until the spectator leaves. A late spectator (a hidden tab, a slow
   * device) plays the waiting stages faster; rejoining (first time, a refresh, a lost cursor) starts from a snapshot.
   */
  async function followPlayer(p) {
    if (destroyed) return;
    stopAll();
    setPresence(null);
    screen = 'follow';
    followed = { id: p.id, name: p.name ?? 'le joueur', game: p.game ?? 'slot' };
    remember(followed);
    // What this screen played (read by the Lab's checks: a stage is played once, every round reaches its end).
    host.dataset.stages = '0';
    host.dataset.ends = '0';
    const my = token;
    let mounted = null;
    const ensure = async (g) => {
      if (!g || g === mounted) return my === token && !!game;
      game?.destroy();
      game = null;
      mounted = g;
      followed.game = g;
      await mount(g, { follow: { id: followed.id, name: followed.name } });
      return my === token && !!game;
    };
    const f = createFollower({
      client,
      player: followed.id,
      onPlayer: (pl) => {
        if (pl?.name && followed) followed.name = pl.name;
      },
      onStatus: (st) => body()?.classList.toggle('is-retry', st === 'retry'),
      onSkip: (ev) => game?.skip?.(ev), // the player's Passer: the animation playing here jumps to its end
    });
    follower = f;
    if (!(await ensure(followed.game))) return;
    while (follower === f && !destroyed) {
      const item = await f.next();
      if (follower !== f || destroyed) return;
      try {
        if (item.kind === 'snapshot') {
          const g = gameOf(item.events, item.player?.game ?? mounted);
          if (!(await ensure(g))) return;
          await game.snapshot(item.events, { lateOf: f.lateOf });
          host.dataset.seq = String(item.events.at(-1)?.seq ?? host.dataset.seq ?? 0);
          continue;
        }
        const g = item.kind === 'presence' ? item.data?.game : item.game;
        if (g && g !== mounted && !(await ensure(g))) return;
        // Each stage starts where the player's screen is (`late`, the Core's clock): the reels and the ball land with the
        // player's. A Passer already pressed, or a spectator far behind (a hidden tab coming back), plays it fast.
        const late = f.lateOf(item);
        await game.apply(item, { fast: f.skipped(item) || late > CATCH_UP_MS, late });
        host.dataset.stages = String(Number(host.dataset.stages) + 1);
        host.dataset.seq = String(item.seq);
        if (item.kind === 'end') host.dataset.ends = String(Number(host.dataset.ends) + 1);
      } catch (e) {
        // one stage that cannot be shown never freezes the following ones
        globalThis.console?.warn?.('[casino] spectator stage', e);
      }
    }
  }

  return {
    node: host,
    ownsHeader: true,
    headLabel: () => (screen === 'follow' ? `Spectateur · ${followed?.name ?? ''}` : screen === 'live' ? 'Parties en direct' : GAME[screen].label),
    headIcon: () => (screen === 'live' || screen === 'follow' ? ICON.eye : (GAME[screen]?.icon ?? null)),
    busy: () => screen !== 'follow' && !!game?.busy?.(),
    start() {
      const back = kind === 'live' && !follow ? remembered() : null;
      if (follow || back) void followPlayer(follow ?? back);
      else if (kind === 'live') void openLive();
      else void open(kind);
    },
    destroy() {
      destroyed = true;
      stopAll();
      setPresence(null);
      W.clearInterval(presenceTimer);
    },
    /** The header's ‹ while following: back to the players (not the catalogue). */
    back() {
      if (screen !== 'follow') return false;
      void openLive();
      return true;
    },
    /**
     * The panel has just moved this screen (a redraw re-attaches its node): the browser restarted every CSS animation
     * of the shadow root. The one-shot ones (a plate's pop, a badge, the Coffre's entrance…) had already played: they
     * are put back at their end, so nothing pops again. Loops (a glow, a blinking dot) simply go on.
     */
    detaching() {
      moved = cssAnimations().map((a) => ({ el: a.effect?.target, name: a.animationName, t: a.currentTime }));
    },
    attached() {
      const before = moved;
      moved = null;
      for (const a of cssAnimations()) {
        const was = before?.find((x) => x.el === a.effect?.target && x.name === a.animationName);
        if (was && typeof was.t === 'number') a.currentTime = was.t; // a loop or a running one: where it was
        else if (a.effect?.getComputedTiming?.().iterations !== Infinity && (a.currentTime ?? 0) < 80) a.finish(); // had ended
      }
    },
  };
}

const TILE_ICON = {
  slot: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="10" width="36" height="28" rx="6" fill="#2a1a46" stroke="#f2c65f" stroke-width="2.5"/><path d="M18 10v28M30 10v28" stroke="#f2c65f" stroke-width="2"/><text x="12" y="29" font-size="10" font-weight="900" fill="#ff5c7a" font-family="Arial Black,Impact,sans-serif">7</text><text x="22" y="29" font-size="10" font-weight="900" fill="#ff5c7a" font-family="Arial Black,Impact,sans-serif">7</text><text x="34" y="29" font-size="10" font-weight="900" fill="#ff5c7a" font-family="Arial Black,Impact,sans-serif">7</text></svg>',
  roulette: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17" fill="#3a1020" stroke="#f2c65f" stroke-width="2.5"/><circle cx="24" cy="24" r="11" fill="none" stroke="#f2c65f" stroke-width="1.5" stroke-dasharray="3 3"/><circle cx="24" cy="24" r="4" fill="#f2c65f"/><circle cx="34" cy="16" r="2.6" fill="#fff"/></svg>',
};
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';

/**
 * The casino in the Mini-jeux catalogue: two game tiles, and under them a band (not a game) « Regarder les parties en
 * direct » — how many play now, who (a touch on one follows them), updated as they come and go. Hidden when the Core
 * does not offer the casino to this viewer.
 */
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

  /** The band: painted from the players list, kept current by a long-poll while the catalogue shows it. */
  function band(el, { open }) {
    let alive = true;
    let players = [];
    const paint = () => {
      const n = players.length;
      const who = players
        .slice(0, 4)
        .map((p) => `<button type="button" class="mg__av" data-follow="${esc(p.id)}" title="Regarder ${esc(p.name)}" aria-label="Regarder ${esc(p.name)}">${initial(p.name)}</button>`)
        .join('');
      el.classList.toggle('is-empty', !n);
      el.innerHTML = `<button type="button" class="mg__bandmain" data-live aria-label="Regarder les parties en direct${n ? `, ${n} en jeu` : ''}">
          <span class="mg__bandic">${EYE}${n ? `<i class="mg__bandn">${n}</i>` : ''}</span>
          <span class="mg__bandtx"><b>Regarder les parties en direct</b><small>${n ? `${n} viewer${n > 1 ? 's' : ''} en jeu en ce moment` : 'Personne ne joue en ce moment'}</small></span>
        </button>
        ${n ? `<span class="mg__avs">${who}${n > 4 ? `<span class="mg__more">+${n - 4}</span>` : ''}</span><button type="button" class="mg__bandgo" data-live>Regarder ›</button>` : ''}`;
    };
    el.onclick = (e) => {
      const id = e.target.closest('[data-follow]')?.dataset.follow;
      const p = id && players.find((x) => x.id === id);
      if (p) return open({ follow: p });
      if (e.target.closest('[data-live]')) open({});
    };
    (async () => {
      let after = -1;
      let fails = 0;
      try {
        const st = await state();
        players = st.players ?? [];
        after = st.live_cursor ?? -1;
      } catch {
        /* the long-poll below */
      }
      paint();
      while (alive) {
        if (globalThis.document?.hidden) {
          await new Promise((ok) => globalThis.setTimeout(ok, 1000));
          continue;
        }
        try {
          const res = await client.casinoLive(after, after < 0 ? 0 : 20_000);
          if (!alive) return;
          fails = 0;
          after = res.cursor;
          players = res.players ?? [];
          paint();
        } catch {
          fails += 1;
          await new Promise((ok) => globalThis.setTimeout(ok, Math.min(15_000, 1000 * 2 ** fails)));
        }
      }
    })();
    return () => {
      alive = false;
      el.onclick = null;
    };
  }

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
      band: true,
      label: 'Parties en direct',
      available,
      mount: band,
      create: (arg = {}) => casinoScreen({ document, client, kind: 'live', follow: arg.follow ?? null }),
    },
  ];
}
