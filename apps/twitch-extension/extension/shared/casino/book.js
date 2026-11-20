// Casino V1 — the emote machine (docs/CASINO.md § 13). The validated prototype's screen (prototypes/casino-emotes,
// src/game.js) on the extension's real machine (frame, reels, bets, audio): same cabinet, same animations — the BONUS
// notes, the expanding-symbol carousel, the free spins, the reels filling up, the finale. What changed: the Core draws
// the WHOLE round (base spin and every free spin) and pays it in one transaction; this screen only plays it, tells the
// Core each stage it has shown (the spectators see it then, never before), resumes an unfinished bonus after a reload,
// and follows another player's rounds as a spectator (no control acts on their game).
import * as Frame from './frame.js';
import { ArcadeAudio as Audio } from './audio.js';
import { ArcadeBets as Bets } from './bets.js';
import { ArcadeSlotsView as View } from './reels.js';
import { Sfx } from './book-sfx.js';
import { BY_ID, playNative, preload, symbolHTML } from './book-symbols.js';
import { newIdempotencyKey } from '../api.js';

const { ICON, fmt, compact, esc } = Frame;
const times = (x) => `×${String(Math.round(x * 10) / 10).replace('.', ',')}`;
const KEEP = 60;
const retryable = (e) => !e?.status || e.status >= 500 || e.code === 'timeout' || e.code === 'network_error';
const BONUS = 'bonus';

const TEMPLATE = `
  <div class="cab" id="game">
    <div class="stage">
      <button type="button" class="notch" data-act="pay" title="Table des gains et règles" aria-label="Table des gains et règles"><span>Gains</span></button>
      <div class="window" id="window">
        <div class="reels" id="reels">${'<div class="reel"><div class="tape"></div></div>'.repeat(5)}</div>
        <div class="xlayer" id="xlayer" aria-hidden="true"></div>
        <div class="plate" id="plate" aria-live="polite"></div>
        <i class="orn tl"></i><i class="orn tr"></i><i class="orn bl"></i><i class="orn br"></i><i class="crest"></i>
        <div class="carousel" id="carousel" hidden></div>
        <div class="fsbanner" id="fsbanner" hidden></div>
        <div class="fsend" id="fsend" hidden></div>
        <div class="closed" id="closed" hidden></div>
      </div>
    </div>
    <div class="betbar" role="group" aria-label="Mise" data-play>
      <span class="legend" aria-hidden="true">Mise</span>
      <button type="button" class="key" data-bet="min" title="Mise minimum" aria-label="Mise minimum">MIN</button>
      <button type="button" class="key cb k-lilac" data-bet="down" title="Baisser la mise" aria-label="Baisser la mise"><i data-i="minus"></i></button>
      <label class="lcd" id="lcd" title="Toucher pour saisir un montant (ex. 1 500 ou 2k)"><input id="bet" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Mise (toucher pour saisir)"></label>
      <button type="button" class="key cb k-lilac" data-bet="up" title="Augmenter la mise" aria-label="Augmenter la mise"><i data-i="plus"></i></button>
      <button type="button" class="key" data-bet="max" title="Mise maximum" aria-label="Mise maximum">MAX</button>
    </div>
    <div class="side">
      <button type="button" class="board" id="board" data-act="hist" title="Derniers gains — toucher pour l’historique" aria-label="Derniers gains, ouvrir l’historique"></button>
      <div class="fsboard" id="fsboard" hidden></div>
      <div class="toggles">
        <button type="button" class="tgl k-amber" data-act="fast" aria-pressed="false" title="Rapide : tours en ≈ 1 s" aria-label="Rapide"><span class="tgl__cap"><i data-i="bolt"></i></span><span class="tgl__lbl"><i class="led"></i>Rapide</span></button>
        <button type="button" class="tgl k-blue" data-act="auto" aria-pressed="false" title="Auto : enchaîne les tours ordinaires. Toucher à nouveau pour l’arrêter." aria-label="Auto"><span class="tgl__cap"><i data-i="auto"></i></span><span class="tgl__lbl"><i class="led"></i>Auto</span></button>
        <button type="button" class="tgl k-lilac" data-act="sound" aria-pressed="false" title="Son (volume : table des gains)" aria-label="Son"><span class="tgl__cap"><i data-i="sound"></i></span><span class="tgl__lbl"><i class="led"></i>Son</span></button>
      </div>
      <div class="launchbox"><button type="button" class="spin" id="spin" aria-label="Lancer"></button></div>
      <div class="wcard" id="wcard" hidden></div>
    </div>
  </div>
  <div class="drawer" id="drawer" hidden></div>
  <div class="toast" id="toast"></div>`;

/** The emote machine in the casino's shadow root `D`. `ctx`: { client, casino (the Core's state), follow? }. */
export function mountBook(D, ctx) {
  const { client } = ctx;
  Frame.useRoot(D);
  const body = D.getElementById('body');
  body.className = 'cz slot-body book-body';
  body.innerHTML = TEMPLATE;
  const $ = (q) => D.querySelector(q);
  body.querySelectorAll('i[data-i]').forEach((i) => (i.outerHTML = ICON[i.dataset.i]));
  const cab = $('#game');
  const plate = $('#plate');
  const spinBtn = $('#spin');
  const board = $('#board');
  const win = $('#window');
  const reelsEl = $('#reels');
  const xlayer = $('#xlayer');
  const W = globalThis;
  const listeners = [];
  const on = (target, ev, fn, opt) => (target.addEventListener(ev, fn, opt), listeners.push([target, ev, fn, opt]));

  let casino = ctx.casino;
  const T = () => casino.tables.book;
  const PAYING = () => Object.keys(T().pays);
  const minCount = (id) => (T().pays[id][2] ? 2 : 3);
  const P = Frame.prefs('casino:book', { bet: 100, sound: false, fast: false, volume: 0.6 });
  const s = P.get();
  Audio.setEnabled(s.sound);
  if (typeof s.volume === 'number') Audio.setVolume(s.volume);
  let balance = casino.me?.balance ?? null;
  let serial = 0;
  const MIN = () => casino.limits.book_min_bet;
  const CAP = () => casino.limits.book_max_bet;
  const maxAllowed = () => Math.max(MIN(), Math.min(CAP(), balance ?? CAP()));
  if (!Number.isInteger(s.bet) || s.bet < MIN()) s.bet = MIN();
  if (s.bet > CAP()) s.bet = CAP();

  const cfg = { reels: 5, rows: 3, strips: T().strips, byId: BY_ID, scatterId: BONUS, lines: T().lines };
  const view = View.create(win, cfg, { audio: Audio, symbolHTML });
  view.renderStatic(cfg.strips.map((x) => Math.floor(Math.random() * x.length)));
  const relayout = () => (view.relayout(), placeCols());
  on(W, 'resize', relayout);
  const ro = W.ResizeObserver ? new W.ResizeObserver(relayout) : null;
  ro?.observe(win);
  void preload();

  let busy = false;
  let auto = false;
  let autoTimer = null;
  let inFree = null; // the feature on screen: { feature, bet, played, total, granted, series }
  let pendingKey = null;
  let hist = [];
  let destroyed = false;
  const watching = !!ctx.follow;
  const name = ctx.follow?.name ?? 'le joueur';
  const idle = () => body.dispatchEvent(new W.CustomEvent('jdm:host-idle', { bubbles: true, composed: true }));
  const refreshWallet = () => body.dispatchEvent(new W.CustomEvent('jdm:host-refresh', { bubbles: true, composed: true }));

  // --- A « phase » Passer can interrupt (the wins, the carousel, an expansion) ------------------------------------
  let present = null;
  let watchFast = false;
  function newPresent() {
    let fire;
    const p = { skipped: false, gate: new Promise((ok) => (fire = ok)) };
    p.skip = () => ((p.skipped = true), fire());
    return (present = p);
  }
  const wait = (ms, Pr = present) => Promise.race([new Promise((ok) => W.setTimeout(ok, ms)), Pr ? Pr.gate : new Promise(() => {})]);
  function countTo(paint, from, to, ms, Pr = present) {
    return new Promise((resolve) => {
      if (ms <= 0 || to <= from || (Pr && Pr.skipped)) return paint(to), resolve();
      const t0 = performance.now();
      const step = (t) => {
        if (Pr && Pr.skipped) return paint(to), resolve();
        const u = Math.max(0, Math.min(1, (t - t0) / ms));
        paint(Math.round(from + (to - from) * (1 - (1 - u) ** 3)));
        if (u < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }
  const fast = () => (watching ? watchFast : s.fast);
  const animateWinners = () => reelsEl.querySelectorAll('.cell.win, .cell.scatter-win, .cell.bonus-glow').forEach((c) => playNative(c, true));

  // --- Plate, last wins ---------------------------------------------------------------------------------------------
  let plateLocked = false;
  let lastWin = '';
  const paintPlate = () => !plateLocked && (plate.innerHTML = lastWin);
  function popPlate() {
    plate.classList.remove('pop', 'old');
    void plate.offsetWidth;
    plate.classList.add('pop');
  }
  let boardSig = null;
  function paintBoard() {
    const h = hist.slice(0, 4);
    const sig = h.map((e) => e.round_id).join();
    if (sig === boardSig) return;
    const fresh = !!boardSig && !!h[0] && !boardSig.startsWith(String(h[0].round_id));
    boardSig = sig;
    const item = (e, i) => {
      const id = e.feature ? e.feature.symbol : e.best;
      const ic = id ? symbolHTML(BY_ID[id]) : '';
      const cls = i === 0 && fresh ? ' new' : '';
      return e.payout
        ? `<span class="bi${cls}">${ic}${e.feature ? '<span class="fs">BONUS</span>' : ''}<b>+${compact(e.payout)}</b></span>`
        : `<span class="bi lose${cls}"><span>mise ${compact(e.bet)}</span><b>—</b></span>`;
    };
    const rows = h.length ? h.map(item).join('') + '<span class="bi empty"></span>'.repeat(4 - h.length) : '<span class="none">Aucun tour pour l’instant.</span>';
    board.innerHTML = `<span class="board__head"><span class="lbl">Derniers gains</span><span class="more" aria-hidden="true">${ICON.chev}</span></span><span class="board__rows">${rows}</span>`;
  }
  const lightOf = (round) => {
    const o = round.outcome;
    const best = o.base.eval.lines.slice().sort((a, b) => b.win - a.win)[0];
    return {
      round_id: round.round_id,
      bet: round.bet,
      payout: round.payout,
      created_at: round.created_at,
      capped: round.capped,
      best: best?.symbol ?? null,
      feature: o.feature ? { symbol: o.feature.symbol, games: o.feature.games, win: o.feature.total } : null,
    };
  };

  // --- Celebrations (the fruit machine's) ---------------------------------------------------------------------------
  async function mega(total, x, from = 0, short = false, kicker = 'Méga gain') {
    const m = D.ownerDocument.createElement('div');
    m.className = 'mega';
    let coins = '';
    for (let i = 0; i < 22; i++) coins += `<i class="cn" style="left:${Math.round(Math.random() * 96)}%;--d:${(1.3 + Math.random() * 1.1).toFixed(2)}s;--w:${(Math.random() * 0.9).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg"></i>`;
    m.innerHTML = `${coins}<span class="kicker">${kicker}</span><b>+${fmt(from)}</b><small>${times(x)} la mise</small>`;
    body.append(m);
    await countTo((v) => (m.querySelector('b').textContent = `+${fmt(v)}`), from, total, short ? 700 : 1700);
    await wait(short ? 450 : 1300);
    m.classList.add('out');
    await new Promise((ok) => W.setTimeout(ok, 360));
    m.remove();
  }
  async function boom(total, x, from = 0, kicker = 'Gros gain') {
    const b = D.ownerDocument.createElement('div');
    b.className = 'boom';
    b.innerHTML = `<span class="kicker">${kicker}</span><b>+${fmt(from)}</b><small>${times(x)} la mise</small>`;
    win.append(b);
    await countTo((v) => (b.querySelector('b').textContent = `+${fmt(v)}`), from, total, 1500);
    await wait(900);
    b.classList.add('out');
    await new Promise((ok) => W.setTimeout(ok, 330));
    b.remove();
  }

  // --- Open or closed (outside the live, closed in Studio): the history stays readable -------------------------------
  function closedReason() {
    const a = casino.availability;
    if (a.games.book) return null;
    return Frame.REFUSAL[a.reason] ?? Frame.REFUSAL.game_closed;
  }
  function paintClosed() {
    const why = watching ? null : closedReason();
    const el = $('#closed');
    el.hidden = !why || busy;
    if (why) el.innerHTML = `<b>${why}</b><small>L’historique reste disponible.</small>`;
  }

  // --- Controls ----------------------------------------------------------------------------------------------------
  function update() {
    if (destroyed) return;
    showBet();
    const closed = !!closedReason() && !watching;
    const st = watching
      ? ['watch', 'play', '', `Spectateur : ${name} joue`]
      : auto
        ? ['stop', 'stop', 'Stop', 'Arrêter Auto']
        : busy
          ? ['busy', 'skip', 'Passer', inFree ? 'Passer (cette animation, même résultat)' : 'Passer (même résultat, tout de suite)']
          : closed
            ? ['closed', 'stop', 'Fermé', closedReason()]
            : ['play', s.fast ? 'ffwd' : 'play', '', s.fast ? 'Lancer (rapide)' : 'Lancer'];
    spinBtn.dataset.state = st[0];
    spinBtn.innerHTML = `<span class="spin__cap">${ICON[st[1]].replace('<svg', `<svg class="fill ${st[1]}"`)}${st[2] ? `<small>${st[2]}</small>` : ''}</span>`;
    spinBtn.setAttribute('aria-label', st[3]);
    spinBtn.title = st[3];
    spinBtn.disabled = watching;
    cab.classList.toggle('is-auto', auto);
    const lock = busy || watching;
    $('[data-bet="down"]').disabled = $('[data-bet="min"]').disabled = lock || s.bet <= MIN();
    $('[data-bet="up"]').disabled = $('[data-bet="max"]').disabled = lock || s.bet >= maxAllowed();
    $('#lcd').classList.toggle('locked', lock);
    $('[data-act="fast"]').setAttribute('aria-pressed', String(s.fast));
    $('[data-act="auto"]').setAttribute('aria-pressed', String(auto));
    D.querySelectorAll('[data-act="sound"]').forEach((b) => b.setAttribute('aria-pressed', String(s.sound)));
    if (!busy) paintPlate();
    paintBoard();
    paintClosed();
  }

  // --- The bet (as on the fruit machine) ----------------------------------------------------------------------------
  const REFUSE = {
    invalid: () => 'Montant invalide : des chiffres, ou « 2k ».',
    min: () => `Mise minimum : ${fmt(MIN())}.`,
    max: () => `Mise maximum : ${fmt(CAP())}.`,
    balance: (b) => `Solde insuffisant pour ${fmt(b)}.`,
  };
  function setBet(v) {
    if (busy || watching) return 'locked';
    // The total bet covers 10 lines: a multiple of 10 (each line's win is then a whole number of Jetons).
    const err = Bets.error(v, { min: MIN(), max: CAP(), balance: balance ?? Infinity }) ?? (v % 10 ? 'invalid' : null);
    if (err) {
      Frame.toast(REFUSE[err](v), true);
      update();
      return err;
    }
    s.bet = v;
    P.save();
    Audio.click();
    update();
    return null;
  }
  const stepBet = (dir) => setBet(Math.ceil(Bets.next(s.bet, dir, { min: MIN(), max: maxAllowed() }) / 10) * 10);
  const betInput = $('#bet');
  let editing = false;
  function showBet() {
    if (!editing) betInput.value = fmt(inFree ? inFree.bet : watching ? (watched?.bet ?? 0) : s.bet);
    betInput.disabled = busy || watching;
  }
  on(betInput, 'focus', () => {
    if (watching) return;
    editing = true;
    betInput.value = String(s.bet);
    betInput.select();
  });
  const commitBet = () => {
    if (!editing) return;
    editing = false;
    const v = Bets.parse(betInput.value);
    if (betInput.value.trim() && v !== s.bet) {
      if (v === null) Frame.toast(REFUSE.invalid(), true);
      else setBet(v);
    }
    showBet();
  };
  on(betInput, 'keydown', (e) => {
    if (e.key === 'Enter') {
      commitBet();
      betInput.blur();
    }
    if (e.key === 'Escape') {
      editing = false;
      showBet();
      betInput.blur();
    }
  });
  on(betInput, 'blur', commitBet);

  // --- Auto (the ordinary spins; it stops when the bonus starts) ------------------------------------------------------
  function stopAuto(reason) {
    W.clearTimeout(autoTimer);
    if (!auto) return;
    auto = false;
    if (reason) Frame.toast(reason);
    update();
  }
  function toggleAuto() {
    if (auto) return stopAuto('Auto arrêté.');
    if (closedReason()) return Frame.toast(closedReason(), true);
    auto = true;
    update();
    if (!busy) void spin();
  }

  // --- The stages the player's screen shows: the spectators get each one then (never before) -------------------------
  let lastReveal = Promise.resolve();
  let playing = null;
  function reveal(roundId, stage, step = null) {
    if (watching) return;
    const go = (n) => client.casinoProgress(roundId, stage, step, s.fast).catch(() => n > 0 && W.setTimeout(() => void go(n - 1), 1200));
    lastReveal = go(1);
  }
  function tellSkip(of, step = null) {
    if (!playing || watching) return;
    const id = playing;
    void lastReveal.finally(() => client.casinoProgress(id, 'skip', step, true, of).catch(() => {}));
  }

  // --- A spin: the Core decides the whole round, the screen plays it ------------------------------------------------
  let stageOf = { of: 'result', step: null }; // what Passer skips now (told to the spectators)
  function skipNow() {
    if (view.isRunning()) view.skip();
    else present?.skip();
    tellSkip(stageOf.of, stageOf.step);
  }
  async function spin() {
    if (watching || destroyed) return;
    if (busy) {
      skipNow();
      if (!inFree) stopAuto();
      return;
    }
    W.clearTimeout(autoTimer);
    const why = closedReason();
    if (why) return stopAuto(), Frame.toast(why, true), update();
    if (balance !== null && s.bet > balance) return stopAuto(), Frame.toast(REFUSE.balance(s.bet), true), update();
    busy = true;
    serial += 1;
    update();
    plateLocked = false;
    lastWin = '';
    plate.innerHTML = '';
    Audio.spinStart();
    const key = (pendingKey ??= newIdempotencyKey());
    let res;
    try {
      res = await client.casinoSpin('book', { bet: s.bet }, key);
      pendingKey = null;
    } catch (e) {
      if (!retryable(e)) pendingKey = null;
      busy = false;
      stopAuto();
      Frame.toast(Frame.refusalText(e), true);
      update();
      void reload();
      idle();
      return;
    }
    if (destroyed) return;
    balance = res.balance;
    serial += 1;
    await playRound(res.round);
    busy = false;
    update();
    idle();
    refreshWallet();
    if (auto) autoTimer = W.setTimeout(() => auto && void spin(), res.round.payout >= res.round.bet * 10 ? 1300 : 450);
  }

  /** The BONUS landing: one note per BONUS, higher each time, as its reel stops. */
  function bonusStops(grid) {
    let k = 0;
    let lastSkippedNote = 0;
    return (r, skipped) => {
      const n = grid[r].filter((id) => id === BONUS).length;
      if (!n) return;
      view.markLanded(r);
      const useful = k + n + (4 - r) >= 3;
      k += n;
      if (!useful) return;
      if (!skipped) Sfx.bonusNote(k);
      else if (k > lastSkippedNote) {
        lastSkippedNote = k;
        W.setTimeout(() => k === lastSkippedNote && Sfx.bonusNote(k), 30);
      }
    };
  }
  const asSpin = (x) => ({ stops: x.stops, grid: x.grid, eval: x.eval });

  /** The player's own round (or a resumed one: `from` = the first free spin still to show). */
  async function playRound(round, { from = null } = {}) {
    const o = round.outcome;
    const b = o.base;
    playing = round.round_id;
    stageOf = { of: 'result', step: null };
    if (from === null) {
      reveal(round.round_id, 'result');
      await view.spin(asSpin(b), { fast: fast(), onReelStop: bonusStops(b.grid) });
      if (destroyed) return;
      const shown = view.markWins(asSpin(b));
      if (shown.wildMax >= 2) Audio.wild();
      await presentLines(asSpin(b), { x: b.eval.total / round.bet, steps: shown.steps, credit: b.eval.total });
    } else view.renderStatic(b.stops);
    if (from === null) {
      hist.unshift(lightOf(round));
      hist.length = Math.min(hist.length, KEEP);
    }
    if (o.feature && !destroyed) {
      stopAuto(auto ? 'Auto arrêté : le bonus commence.' : null);
      if (from === null) await bonusHit(b.eval.scatter);
      await playFeature(round, from ?? 0);
    } else reveal(round.round_id, 'end');
    if (round.capped && !destroyed)
      await Frame.card(
        `<h2>Gain plafonné</h2><div class="big">+${fmt(round.payout)}</div><p>Le tirage valait ${fmt(round.raw_payout)} Jetons : le gain maximum par partie est de ${fmt(casino.limits.max_win)} Jetons (règle du Casino).</p>`,
        [[1, 'Compris', 'gold']],
      );
    paintBoard();
  }

  // The winning combinations one by one; Rapide: all at once; Passer: the end state.
  async function presentLines(r, { x, steps, credit, kick = true, pace = 0 }) {
    if (!credit) return;
    const level = x >= 50 ? 4 : x >= 10 ? 3 : x >= 2 ? 2 : 1;
    plateLocked = true;
    const Pr = newPresent();
    const paint = (v, k) => (plate.innerHTML = `<b>+${fmt(v)}</b><small>${k || times(x)}</small>`);
    popPlate();
    let shownV = 0;
    if (fast()) {
      paint(credit);
      shownV = credit;
    }
    else if (steps.length >= 2) {
      const n = steps.length;
      for (let i = 0; i < n && !Pr.skipped; i++) {
        const st = steps[i];
        const last = i === n - 1;
        const dur = pace || Math.max(280, (n > 4 ? 520 : 640) * 0.86 ** i);
        view.focus(st);
        Audio.lineStep(i);
        await countTo((v) => paint(v, `${i + 1}/${n}`), shownV, shownV + st.win, pace ? dur * 0.7 : last && level >= 3 ? dur * 1.4 : dur * 0.55);
        shownV += st.win;
        await wait(pace ? dur * 0.3 : last ? 240 : dur * 0.45);
      }
      view.settle();
    } else {
      if (steps[0]) view.focus(steps[0], { tag: false });
      await countTo((v) => paint(v), 0, credit, 420);
      shownV = credit;
    }
    animateWinners();
    if (kick && !Pr.skipped && level >= 4) await mega(credit, x, shownV, fast());
    else if (kick && !Pr.skipped && level === 3 && !fast()) await boom(credit, x, shownV);
    view.settle();
    plate.innerHTML = `<b>+${fmt(credit)}</b><small>${times(x)}</small>`;
    lastWin = plate.innerHTML;
    Audio.win(Math.min(3, level));
    plateLocked = false;
  }

  // --- 3 BONUS: the success, then the feature ------------------------------------------------------------------------
  async function bonusHit(scatter) {
    const Pr = newPresent();
    reelsEl.classList.add('bonus-hit');
    scatter.cells.forEach(([r, row]) => reelsEl.querySelectorAll('.reel')[r].querySelector('.tape').children[row + 1]?.classList.add('bonus-glow'));
    animateWinners();
    Sfx.bonusSuccess();
    plateLocked = true;
    plate.className = 'plate';
    plate.innerHTML = `<em>BONUS</em><small>${scatter.count} BONUS · 10 tours gratuits</small>`;
    popPlate();
    await wait(fast() ? 650 : 1700, Pr);
    reelsEl.classList.remove('bonus-hit');
    reelsEl.querySelectorAll('.bonus-glow').forEach((c) => c.classList.remove('bonus-glow'));
  }

  // --- The carousel: driven by the symbol the Core ALREADY drew (it chooses nothing) ------------------------------------
  async function carousel(sym) {
    const Pr = newPresent();
    const c = $('#carousel');
    const order = PAYING();
    const LAPS = 6;
    const target = order.length * (LAPS - 1) + order.indexOf(sym);
    const tiles = Array.from({ length: order.length * LAPS + 4 }, (_, i) => order[i % order.length]);
    c.innerHTML = `<div class="car__title"><small>Tours gratuits</small><b>Le symbole extensible</b></div>
      <div class="car__view"><div class="car__track">${tiles.map((id, i) => `<span class="car__tile" data-i="${i}" data-s="${id}">${symbolHTML(BY_ID[id])}</span>`).join('')}</div><i class="car__mark"></i></div>
      <div class="car__name"></div>`;
    plate.innerHTML = '';
    c.hidden = false;
    c.classList.remove('done', 'out');
    const track = c.querySelector('.car__track');
    const viewEl = c.querySelector('.car__view');
    const tileEl = c.querySelectorAll('.car__tile');
    const step = tileEl[1].offsetLeft - tileEl[0].offsetLeft;
    const center = viewEl.clientWidth / 2 - tileEl[0].offsetWidth / 2;
    const endX = center - target * step;
    const startX = center - 2 * step;
    const dur = fast() ? 1100 : 3200;
    await wait(fast() ? 100 : 350, Pr);
    let lastTile = -1;
    await new Promise((resolve) => {
      const t0 = performance.now();
      const frame = (t) => {
        const u = Pr.skipped || destroyed ? 1 : Math.min(1, (t - t0) / dur);
        const e = 1 - (1 - u) ** 4;
        const xPos = startX + (endX - startX) * e;
        track.style.transform = `translate3d(${xPos.toFixed(1)}px,0,0)`;
        const under = Math.round((center - xPos) / step);
        if (under !== lastTile && !Pr.skipped) {
          lastTile = under;
          Sfx.carouselTick(1 - u);
        }
        if (u < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    const chosen = tileEl[target];
    chosen.classList.add('chosen');
    c.classList.add('done');
    c.querySelector('.car__name').innerHTML = `<b>${esc(BY_ID[sym].name)}</b><small>${minCount(sym) === 2 ? 'fort : s’étend dès 2 rouleaux' : 's’étend dès 3 rouleaux'}</small>`;
    playNative(chosen, true);
    Sfx.carouselLand();
    await wait(fast() ? 650 : 1500, newPresent());
    c.classList.add('out');
    await new Promise((ok) => W.setTimeout(ok, 280));
    c.hidden = true;
    c.classList.remove('done', 'out');
  }

  // --- The free spins -------------------------------------------------------------------------------------------------
  const fsb = $('#fsboard');
  function paintFree() {
    if (!inFree) return;
    const { symbol, played, total, granted } = inFree;
    fsb.innerHTML = `<span class="fsb__head">Tours gratuits</span>
      <span class="fsb__count"><b>${granted - played}</b><small><span>restants</span><span>tour ${played}/${granted}</span></small></span>
      <span class="fsb__sym">${symbolHTML(BY_ID[symbol])}<small>extensible</small></span>
      <span class="fsb__tot"><small>Gain du bonus</small><b>+${fmt(total)}</b></span>
      ${inFree.series > 1 ? `<span class="fsb__series">+10 × ${inFree.series - 1}</span>` : ''}`;
  }
  async function banner(html, ms) {
    const el = $('#fsbanner');
    el.innerHTML = html;
    el.hidden = false;
    el.classList.remove('out');
    void el.offsetWidth;
    el.classList.add('in');
    await wait(ms, newPresent());
    el.classList.add('out');
    await new Promise((ok) => W.setTimeout(ok, 260));
    el.hidden = true;
    el.classList.remove('in', 'out');
  }
  /** The feature begins: the board, the carousel (the drawn symbol), the banner. `instant`: rejoining, no carousel. */
  async function beginFree(symbol, bet, { instant = false } = {}) {
    inFree = { symbol, bet, played: 0, total: 0, granted: T().free_games, series: 1 };
    cab.classList.add('is-free', 'in-free');
    fsb.hidden = false;
    board.hidden = true;
    paintFree();
    update();
    if (!instant) {
      stageOf = { of: 'coffre', step: null };
      await carousel(symbol);
    }
    markSpecial(symbol);
    if (!instant) {
      Sfx.freeStart();
      await banner(`<em>10 tours gratuits</em><span class="fsbanner__sym">${symbolHTML(BY_ID[symbol])}</span><small>${esc(BY_ID[symbol].name)} s’étend</small>`, fast() ? 600 : 1300);
    }
  }
  /** One free spin (the player's own, a resumed one, or the followed player's). */
  async function freeSpin(sp, bet) {
    clearCols();
    inFree.played = sp.i + 1;
    inFree.granted = sp.i + 1 + sp.left - (sp.retrigger ? T().free_games : 0);
    inFree.series = sp.series - (sp.retrigger ? 1 : 0);
    paintFree();
    plateLocked = false;
    lastWin = '';
    plate.innerHTML = '';
    stageOf = { of: 'step', step: sp.i };
    Audio.spinStart();
    await view.spin(asSpin(sp), { fast: fast(), onReelStop: bonusStops(sp.grid) });
    if (destroyed) return;
    const shown = view.markWins(asSpin(sp));
    if (sp.eval.total) await presentLines(asSpin(sp), { x: sp.eval.total / bet, steps: shown.steps, credit: sp.eval.total, kick: false, pace: 200 });
    inFree.total += sp.eval.total;
    paintFree();
    if (sp.expansion) {
      await expand(sp, bet);
      inFree.total += sp.expansion.win;
      paintFree();
    }
    if (sp.win) {
      plate.innerHTML = `<b>+${fmt(sp.win)}</b><small>ce tour · ${times(sp.win / bet)}</small>`;
      lastWin = plate.innerHTML;
    }
    if (sp.retrigger) {
      inFree.granted += T().free_games;
      inFree.series++;
      paintFree();
      Sfx.retrigger();
      await banner(`<em>+10 tours gratuits</em><small>${sp.eval.scatter.count} BONUS · même symbole</small>`, fast() ? 700 : 1500);
    }
    await wait(fast() ? 260 : 650, newPresent());
  }
  async function playFeature(round, from = 0) {
    const f = round.outcome.feature;
    if (from === 0) reveal(round.round_id, 'coffre');
    await beginFree(f.symbol, round.bet, { instant: from > 0 });
    if (from > 0) {
      // Resumed: the spins already shown are counted, not replayed.
      const prev = f.spins[from - 1];
      inFree.total = prev.total;
      inFree.played = from;
      inFree.granted = from + prev.left;
      inFree.series = prev.series;
      paintFree();
    }
    for (const sp of f.spins.slice(from)) {
      if (destroyed) return;
      reveal(round.round_id, 'step', sp.i);
      await freeSpin(sp, round.bet);
    }
    if (destroyed) return;
    reveal(round.round_id, 'end');
    await endFree({ symbol: f.symbol, total: f.total, games: f.games, series: f.series }, round.bet);
  }
  async function endFree(f, bet) {
    clearCols();
    markSpecial(null);
    stageOf = { of: 'end', step: null };
    await finale(f, bet);
    cab.classList.remove('is-free', 'in-free');
    fsb.hidden = true;
    board.hidden = false;
    inFree = null;
    lastWin = `<em>BONUS</em><b>+${fmt(f.total)}</b><small>${times(f.total / bet)}</small>`;
    plate.innerHTML = lastWin;
    popPlate();
  }

  let specialSheet = null;
  function markSpecial(sym) {
    if (specialSheet) D.adoptedStyleSheets = D.adoptedStyleSheets.filter((x) => x !== specialSheet);
    specialSheet = null;
    if (!sym || typeof W.CSSStyleSheet !== 'function') return;
    try {
      specialSheet = new W.CSSStyleSheet();
      specialSheet.replaceSync(`.cab.in-free .reel .cell[data-s="${sym}"]::after { content: '★'; position: absolute; inset: 6% 5%; z-index: 2; border-radius: 12px; pointer-events: none; display: grid; place-items: start end; padding: 1px 3px; font: 900 10px/1 var(--font); color: #2a1600; text-shadow: 0 0 2px #fff3c4; box-shadow: inset 0 0 0 1.5px rgba(255, 225, 140, 0.9), 0 0 9px rgba(255, 190, 60, 0.45); background: radial-gradient(closest-side, rgba(255, 201, 77, 0.14), transparent) , linear-gradient(225deg, #ffd36a 0 15%, transparent 15%); }`);
      D.adoptedStyleSheets = [...D.adoptedStyleSheets, specialSheet];
    } catch {
      specialSheet = null; // an old browser: the ★ mark is only a hint
    }
  }

  // --- The expansion: the symbols light up, then their reels fill one by one -------------------------------------------
  let cols = [];
  const peek = () => parseFloat(W.getComputedStyle(reelsEl).getPropertyValue('--peek')) || 0;
  function placeCols() {
    const reels = reelsEl.querySelectorAll('.reel');
    const wb = win.getBoundingClientRect();
    for (const c of cols) {
      const rb = reels[c.r].getBoundingClientRect();
      const cellH = rb.height / (3 + 2 * peek());
      c.el.style.left = `${rb.left - wb.left}px`;
      c.el.style.width = `${rb.width}px`;
      c.el.style.top = `${rb.top - wb.top + peek() * cellH}px`;
      c.el.style.height = `${3 * cellH}px`;
    }
  }
  function clearCols() {
    cols.forEach((c) => c.el.remove());
    cols = [];
    reelsEl.classList.remove('x-on');
  }
  async function expand(sp, bet) {
    const x = sp.expansion;
    const Pr = newPresent();
    const reels = reelsEl.querySelectorAll('.reel');
    for (const r of x.reels)
      for (let row = 0; row < 3; row++) if (sp.grid[r][row] === x.symbol) reels[r].querySelector('.tape').children[row + 1]?.classList.add('x-seed');
    Sfx.carouselTick(0.2);
    await wait(fast() ? 200 : 520, Pr);
    reelsEl.classList.add('x-on');
    for (let i = 0; i < x.reels.length; i++) {
      const r = x.reels[i];
      const from = sp.grid[r].indexOf(x.symbol);
      const el = D.ownerDocument.createElement('div');
      el.className = 'xcol';
      el.dataset.from = String(from);
      el.innerHTML = `<span class="xcol__cells">${[0, 1, 2].map(() => `<span class="xcell">${symbolHTML(BY_ID[x.symbol])}</span>`).join('')}</span><i class="xcol__sweep"></i>`;
      xlayer.append(el);
      cols.push({ r, el });
      placeCols();
      void el.offsetWidth;
      el.classList.add('fill');
      Sfx.expandFill(i);
      if (!Pr.skipped) await wait(fast() ? 110 : 330, Pr);
    }
    reels.forEach((re) => re.querySelectorAll('.x-seed').forEach((c) => c.classList.remove('x-seed')));
    cols.forEach((c) => playNative(c.el, true));
    xlayer.classList.add('lit');
    const k = x.win / bet;
    const level = k >= 50 ? 4 : k >= 10 ? 3 : k >= 2 ? 2 : 1;
    plateLocked = true;
    plate.className = 'plate';
    popPlate();
    const paintX = (v, tag) => (plate.innerHTML = `<em>${tag}</em><b>+${fmt(v)}</b><small>${times(v / bet)}</small>`);
    if (fast()) paintX(x.win, `Extension · ${x.n} rouleaux`);
    else {
      const lines = T().lines;
      let shownX = 0;
      for (let li = 0; li < lines.length && !Pr.skipped; li++) {
        xlayer.querySelectorAll('.xcell.hit').forEach((c) => c.classList.remove('hit'));
        for (const c of cols) c.el.querySelectorAll('.xcell')[lines[li].rows[c.r]]?.classList.add('hit');
        Audio.lineStep(li);
        const to = Math.round((x.win * (li + 1)) / lines.length);
        await countTo((v) => paintX(v, `Extension · ligne ${li + 1}/${lines.length}`), shownX, to, 140, Pr);
        shownX = to;
        await wait(60, Pr);
      }
      xlayer.querySelectorAll('.xcell.hit').forEach((c) => c.classList.remove('hit'));
    }
    paintX(x.win, `Extension · ${x.n} rouleaux · 10 lignes`);
    Sfx.expandWin(level);
    if (!Pr.skipped && level >= 4) await mega(x.win, k, x.win, fast(), 'Extension géante');
    else if (!Pr.skipped && level === 3 && !fast()) await boom(x.win, k, x.win, 'Belle extension');
    xlayer.classList.remove('lit');
    plateLocked = false;
  }

  // --- The end of the feature -------------------------------------------------------------------------------------------
  async function finale(f, bet) {
    const k = f.total / bet;
    const el = $('#fsend');
    el.innerHTML = `<span class="kicker">Bonus terminé</span><span class="fsend__sym">${symbolHTML(BY_ID[f.symbol])}</span><b>+0</b><small>${times(k)} la mise · ${f.games} tours gratuits${f.series > 1 ? ` · ${f.series - 1} prolongation${f.series > 2 ? 's' : ''}` : ''}</small>`;
    el.hidden = false;
    el.classList.remove('out');
    void el.offsetWidth;
    el.classList.add('in');
    Sfx.bonusEnd(k >= 50);
    const Pr = newPresent();
    await countTo((v) => (el.querySelector('b').textContent = `+${fmt(v)}`), 0, f.total, fast() ? 500 : k >= 50 ? 2200 : 1400, Pr);
    playNative(el, true);
    await wait(fast() ? 900 : 2300, newPresent());
    el.classList.add('out');
    await new Promise((ok) => W.setTimeout(ok, 300));
    el.hidden = true;
  }

  // --- Spectator: the followed player's stages, in order, once (casino.js); no control acts on their game -------------
  let watched = null; // { round_id, bet }
  let wcard = null;
  const cardState = { state: 'wait', text: '', bet: null, win: undefined, extra: '' };
  const card = (o) => (Object.assign(cardState, o), wcard?.set(cardState));
  const waiting = () => card({ state: 'wait', text: 'attend son prochain tour' });
  function enterWatch() {
    body.classList.add('is-watch');
    wcard = Frame.watchCard($('#wcard'), name, { sound: true });
    $('#wcard').hidden = false;
    plateLocked = true;
    plate.innerHTML = '';
    waiting();
    update();
  }
  async function apply(ev, { fast: f = false, late = 0 } = {}) {
    if (destroyed) return;
    watchFast = !!(ev.fast || f);
    const d = ev.data ?? {};
    if (ev.kind === 'presence') {
      if (d.game === null && !busy) card({ state: 'left', text: 'a quitté le jeu', extra: '' });
      return;
    }
    if (ev.kind === 'start') {
      watched = { round_id: ev.round_id, bet: d.bet };
      view.clearWins();
      plate.innerHTML = '';
      card({ state: 'play', text: 'lance…', bet: d.bet, win: null, extra: '' });
      update();
      return;
    }
    if (ev.round_id && watched?.round_id !== ev.round_id) watched = { round_id: ev.round_id, bet: d.bet ?? watched?.bet ?? 0 };
    if (ev.kind === 'result') {
      busy = true;
      update();
      card({ state: 'play', text: 'joue…', bet: watched.bet, win: null });
      const r = { stops: d.stops, grid: d.grid, eval: { lines: d.lines, scatter: d.scatter, total: d.line_win } };
      await view.spin(r, { fast: watchFast, elapsed: late, onReelStop: bonusStops(d.grid) });
      if (destroyed) return;
      const shown = view.markWins(r);
      await presentLines(r, { x: d.line_win / watched.bet, steps: shown.steps, credit: d.line_win });
      if (d.feature) {
        card({ text: 'déclenche le bonus', extra: 'Bonus · 10 tours gratuits' });
        await bonusHit(d.scatter);
      }
      busy = false;
      update();
      return;
    }
    if (ev.kind === 'coffre') {
      busy = true;
      await beginFree(d.symbol, watched.bet);
      return;
    }
    if (ev.kind === 'step') {
      if (!inFree) await beginFree(watched?.symbol ?? 'p1', watched.bet, { instant: true });
      card({ text: `tour gratuit ${d.i + 1}` });
      await freeSpin(d, watched.bet);
      return;
    }
    if (ev.kind === 'end') {
      if (inFree && d.feature) await endFree(d.feature, d.bet);
      busy = false;
      plateLocked = false;
      lastWin = d.payout ? `<b>+${fmt(d.payout)}</b><small>${times(d.payout / d.bet)}</small>` : '';
      plate.innerHTML = lastWin;
      card({ state: 'done', text: 'tour terminé', bet: d.bet, win: d.payout, extra: '' });
      hist.unshift({ round_id: ev.round_id, bet: d.bet, payout: d.payout, best: null, feature: d.feature ? { symbol: d.feature.symbol } : null });
      hist.length = Math.min(hist.length, 8);
      update();
    }
  }
  function watchSkip(ev) {
    if (ev.round_id !== watched?.round_id) return;
    if (view.isRunning()) view.skip();
    else present?.skip();
  }
  /** Rejoining: the player's current round as it is now (no replay of what was already played). */
  async function snapshot(events) {
    const at = events.map((e) => e.kind).lastIndexOf('start');
    if (at < 0) return void (waiting(), update());
    const start = events[at];
    const mine = events.slice(at).filter((e) => e.round_id === start.round_id);
    const res = mine.find((e) => e.kind === 'result');
    const coffre = mine.find((e) => e.kind === 'coffre');
    const steps = mine.filter((e) => e.kind === 'step');
    const end = mine.find((e) => e.kind === 'end');
    watched = { round_id: start.round_id, bet: start.data.bet };
    if (!res) return apply(start);
    if (end || !coffre) {
      view.renderStatic(res.data.stops);
      if (end) return apply({ ...end, data: { ...end.data, feature: null } });
      card({ state: 'play', text: 'joue…', bet: watched.bet, win: null });
      return update();
    }
    await beginFree(coffre.data.symbol, watched.bet, { instant: true });
    const last = steps.at(-1)?.data;
    if (last) {
      view.renderStatic(last.stops);
      inFree.total = last.total;
      inFree.played = last.i + 1;
      inFree.granted = last.i + 1 + last.left;
      inFree.series = last.series;
      paintFree();
    }
    card({ state: 'play', text: 'tours gratuits', bet: watched.bet, win: null, extra: 'Bonus en cours' });
    update();
  }

  // --- History, pay table -------------------------------------------------------------------------------------------
  let histStats = null;
  async function loadHistory() {
    try {
      const h = await client.casinoHistory('book', 50);
      hist = h.rounds.map((e) => ({ ...e, best: e.best?.symbol ?? null }));
      histStats = h.stats;
    } catch {
      /* readable later */
    }
    paintBoard();
  }
  function historyHTML() {
    if (!hist.length) return '<p class="hempty">Pas encore de tour.</p>';
    return `<ul class="hlist">${hist
      .map((e) => {
        const icon = e.feature ? symbolHTML(BY_ID[e.feature.symbol]) : e.best ? symbolHTML(BY_ID[e.best]) : '<span class="hnone">—</span>';
        const tag = e.feature ? `<i class="htag">BONUS${e.feature.games ? ` · ${e.feature.games} tours` : ''}</i>` : e.capped ? '<i class="htag">PLAFONNÉ</i>' : '';
        return `<li class="hrow${e.payout ? ' win' : ''}${e.feature || e.payout >= e.bet * 10 ? ' big' : ''}"><span class="hic">${icon}</span><span class="hmain"><b>${e.payout ? `+${fmt(e.payout)}` : `−${fmt(e.bet)}`}${tag}</b><small>mise ${fmt(e.bet)}${e.created_at ? ` · ${Frame.ago(Date.parse(e.created_at))}` : ''}</small></span></li>`;
      })
      .join('')}</ul>`;
  }
  function openHistory() {
    const k = histStats ?? { rounds: hist.length, won: hist.reduce((a, e) => a + e.payout, 0), best: hist.reduce((a, e) => Math.max(a, e.payout), 0) };
    Frame.drawer({
      side: 'right',
      width: 266,
      title: 'Historique',
      head: () => `<div class="hsum"><span><small>Tours</small><b>${fmt(k.rounds)}</b></span><span><small>Gains cumulés</small><b class="g">${fmt(k.won)}</b></span><span><small>Meilleur gain</small><b class="g">${fmt(k.best)}</b></span></div>`,
      render: historyHTML,
      foot: 'Tes derniers tours à la machine à émotes.',
    });
  }
  function paytableHTML() {
    const bet = inFree ? inFree.bet : watching ? (watched?.bet ?? s.bet) : s.bet;
    const pays = T().pays;
    const val = (id, k) => (pays[id][k] ? compact(Math.floor((bet * pays[id][k]) / 10)) : '');
    const rows = PAYING()
      .map((id) => `<tr><td>${symbolHTML(BY_ID[id])}</td>${[5, 4, 3, 2].map((k) => `<td${k === 2 && pays[id][2] ? ' class="two"' : ''}>${val(id, k)}</td>`).join('')}</tr>`)
      .join('');
    const sc = (k) => compact(T().scatter_pays[k] * bet);
    const lines = T()
      .lines.map((l, i) => {
        const pts = l.rows.map((row, r) => `${r * 6 + 3},${row * 5 + 2.5}`).join(' ');
        return `<svg viewBox="0 0 30 15" style="--c:${View.LINE_COLORS[i % View.LINE_COLORS.length]}"><rect width="30" height="15" rx="2.5"/><polyline points="${pts}"/></svg>`;
      })
      .join('');
    return `<table class="ptab"><thead><tr><th></th><th>×5</th><th>×4</th><th>×3</th><th>×2</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="prule">${symbolHTML(BY_ID.bonus)}<p><b>BONUS = WILD</b> : il remplace tous les symboles sur une ligne. N’importe où, 3 · 4 · 5 BONUS paient <b>${sc(3)} · ${sc(4)} · ${sc(5)}</b> et donnent <b>10 tours gratuits</b>.</p></div>
      <div class="prule"><span class="prule__ico">↔</span><p><b>Tours gratuits</b> : un symbole est tiré au hasard et devient <b>extensible</b>. S’il est sur assez de rouleaux (2 pour les 4 forts, 3 pour les autres, voisins ou non), ces rouleaux se remplissent et il paie sur les <b>10 lignes</b>, en plus des gains normaux. 3 BONUS : +10 tours.</p></div>
      <p class="pcap">Gains de ligne de gauche à droite, une ligne = un gain. Mise ${fmt(bet)} = 10 lignes à ${fmt(bet / 10)}. Gain maximum par partie : ${fmt(casino.limits.max_win)}.</p>
      <div class="plines"><span>10 lignes</span>${lines}</div>
      <label class="pvol"><span>Volume</span><input type="range" min="0" max="100" value="${Math.round(Audio.volume * 100)}" data-vol aria-label="Volume des sons"></label>`;
  }
  const openPaytable = () => Frame.drawer({ side: 'left', width: 236, title: `Table des gains<small>mise ${compact(inFree ? inFree.bet : s.bet)}</small>`, render: paytableHTML });

  // --- Commands ---------------------------------------------------------------------------------------------------------
  on(body, 'click', (e) => {
    const b = e.target.closest('[data-bet], [data-act]');
    if (!b || b.disabled) return;
    const k = b.dataset.bet || b.dataset.act;
    if (watching && k !== 'pay' && k !== 'sound') return;
    if (k === 'down') stepBet(-1);
    else if (k === 'up') stepBet(1);
    else if (k === 'min') setBet(MIN());
    else if (k === 'max') setBet(Math.floor(maxAllowed() / 10) * 10);
    else if (k === 'pay') openPaytable();
    else if (k === 'hist') openHistory();
    else if (k === 'sound') setSound(!s.sound);
    else if (k === 'fast') {
      s.fast = !s.fast;
      P.save();
      update();
    } else if (k === 'auto' && !inFree) toggleAuto();
  });
  on(body, 'input', (e) => e.target.matches?.('[data-vol]') && setVolume(e.target.value / 100));
  function setSound(onOff) {
    s.sound = onOff;
    Audio.setEnabled(onOff);
    P.save();
    update();
    Audio.click();
  }
  function setVolume(v) {
    s.volume = v;
    Audio.setVolume(v);
    P.save();
  }
  on(spinBtn, 'click', () => {
    if (watching) return;
    if (auto && !inFree) return busy ? (void spin(), Frame.toast('Auto arrêté.')) : stopAuto('Auto arrêté.');
    void spin();
  });
  on(win, 'click', () => !watching && busy && skipNow());

  /** The Core's state again (availability, limits, balance): after a refusal, and on every opening. */
  async function reload() {
    serial += 1;
    try {
      casino = await client.casinoState();
      balance = casino.me?.balance ?? balance;
      serial += 1;
    } catch {
      /* the last one */
    }
    update();
  }
  async function start() {
    update();
    await loadHistory();
    // A feature left unfinished (closed tab, other device): it resumes where it was, already paid.
    const resume = casino.me?.resume_book;
    if (resume && !destroyed) {
      busy = true;
      update();
      Frame.toast('Tours gratuits repris là où ils en étaient (déjà crédités).');
      await playRound({ ...resume, mine: true }, { from: Math.max(0, (resume.progress_step ?? -1) + 1) });
      busy = false;
      update();
      idle();
      refreshWallet();
    }
  }
  if (watching) enterWatch();
  else W.setTimeout(() => void start());

  return {
    busy: () => busy || !!present,
    wallet: () => ({ balance, serial, busy: busy || !!present || watching }),
    sync(state) {
      if (destroyed || busy || present || watching) return;
      casino = state;
      balance = state.me?.balance ?? balance;
      update();
    },
    apply,
    skip: watchSkip,
    snapshot,
    destroy() {
      destroyed = true;
      stopAuto();
      W.clearTimeout(autoTimer);
      present?.skip();
      if (view.isRunning()) view.skip();
      ro?.disconnect();
      markSpecial(null);
      for (const [t, ev, fn, opt] of listeners) t.removeEventListener(ev, fn, opt);
    },
  };
}
