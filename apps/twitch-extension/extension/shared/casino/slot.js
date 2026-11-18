// Casino — the slot machine screen (docs/CASINO.md § 2), the validated V7/V8 prototype wired to the Core: the bet is
// checked, drawn, paid and recorded by the Core (one intent = one key: a lost answer replays the same round, never a
// second payment); this screen only animates the round it receives — reels, lines one by one, the Coffre. The history,
// the Replay and the share read the Core's rounds; a spectator plays another viewer's round at the player's pace.
import * as Frame from './frame.js';
import { ArcadeAudio as Audio } from './audio.js';
import { ArcadeBets as Bets } from './bets.js';
import { CoffreView } from './coffre-view.js';
import { ArcadeSlotsView as View } from './reels.js';
import { ArcadeSymbols as Sym } from './symbols.js';
import { newIdempotencyKey } from '../api.js';

const { ICON, fmt, compact, esc } = Frame;
const KEEP = 100;
const retryable = (e) => !e?.status || e.status >= 500 || e.code === 'timeout' || e.code === 'network_error';
const times = (x) => `×${String(Math.round(x * 10) / 10).replace('.', ',')}`;

/** The machine's configuration for the views, from the Core's table (display only). */
export function slotConfig(table) {
  const byId = Object.fromEntries(table.symbols.map((s) => [s.id, s]));
  return {
    reels: 5,
    rows: 3,
    symbols: table.symbols,
    byId,
    scatterId: 'bonus',
    wildId: 'wild',
    lines: table.lines,
    strips: table.strips,
  };
}
/** A round of the Core as the reels' view expects it. */
const asSpin = (round) => {
  const o = round.outcome;
  return { stops: o.stops, grid: o.grid, eval: { lines: o.lines, scatter: o.scatter, total: o.line_win, mult: 1 } };
};

const TEMPLATE = `
  <div class="cab" id="game">
    <div class="stage">
      <button type="button" class="notch" data-act="pay" title="Table des gains et règles" aria-label="Table des gains et règles"><span>Gains</span></button>
      <div class="window" id="window">
        <div class="reels" id="reels">${'<div class="reel"><div class="tape"></div></div>'.repeat(5)}</div>
        <div class="plate" id="plate" aria-live="polite"></div>
        <i class="orn tl"></i><i class="orn tr"></i><i class="orn bl"></i><i class="orn br"></i><i class="crest"></i>
        <div class="rbadge" id="spect" hidden><i data-i="replay"></i><span>Replay</span></div>
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
    <div class="rstrip" id="rstrip" role="status" hidden></div>
    <div class="side">
      <button type="button" class="board" id="board" data-act="hist" title="Derniers gains — toucher pour l’historique complet" aria-label="Derniers gains, ouvrir l’historique"></button>
      <div class="toggles">
        <button type="button" class="tgl k-amber" data-act="fast" aria-pressed="false" title="Rapide : tours en ≈ 1 s" aria-label="Rapide"><span class="tgl__cap"><i data-i="bolt"></i></span><span class="tgl__lbl"><i class="led"></i>Rapide</span></button>
        <button type="button" class="tgl k-blue" data-act="auto" aria-pressed="false" title="Auto : enchaîne les tours. Toucher à nouveau pour l’arrêter tout de suite." aria-label="Auto"><span class="tgl__cap"><i data-i="auto"></i></span><span class="tgl__lbl"><i class="led"></i>Auto</span></button>
        <button type="button" class="tgl k-lilac" data-act="sound" aria-pressed="false" title="Son" aria-label="Son"><span class="tgl__cap"><i data-i="sound"></i></span><span class="tgl__lbl"><i class="led"></i>Son</span></button>
      </div>
      <div class="launchbox"><button type="button" class="spin" id="spin" aria-label="Lancer"></button></div>
    </div>
  </div>
  <div class="drawer" id="drawer" hidden></div>
  <div class="toast" id="toast"></div>`;

/**
 * The slot screen inside the casino's shadow root `D` (its `#body`). `ctx`: { client, casino (the Core's state), watch
 * (a round id: spectator mode), onLeave(), notify(event) }. Returns { busy(), destroy() }.
 */
export function mountSlot(D, ctx) {
  const { client } = ctx;
  const body = D.getElementById('body');
  body.className = 'cz slot-body';
  body.innerHTML = TEMPLATE;
  const $ = (s) => D.querySelector(s);
  body.querySelectorAll('i[data-i]').forEach((i) => (i.outerHTML = ICON[i.dataset.i]));
  Sym.install(D.getElementById('body'));
  const cab = $('#game');
  const plate = $('#plate');
  const spinBtn = $('#spin');
  const board = $('#board');
  const win = $('#window');
  const W = globalThis;
  const listeners = [];
  const on = (target, ev, fn, opt) => (target.addEventListener(ev, fn, opt), listeners.push([target, ev, fn, opt]));

  let casino = ctx.casino;
  let cfg = slotConfig(casino.tables.slot);
  const P = Frame.prefs('casino:slot', { bet: 100, sound: false, fast: false });
  const s = P.get();
  Audio.setEnabled(s.sound);
  let balance = casino.me?.balance ?? null;
  const limits = () => casino.limits;
  const MIN = () => limits().slot_min_bet;
  const CAP = () => limits().slot_max_bet;
  const maxAllowed = () => Math.max(MIN(), Math.min(CAP(), balance ?? CAP()));
  if (!Number.isInteger(s.bet) || s.bet < MIN()) s.bet = MIN();
  if (s.bet > CAP()) s.bet = CAP();

  const view = View.create(win, cfg, { audio: Audio, symbolHTML: Sym.symbolHTML });
  const randomStops = () => cfg.strips.map((x) => Math.floor(Math.random() * x.length)); // décor du repos
  view.renderStatic(randomStops());
  const relayout = () => view.relayout();
  on(W, 'resize', relayout);
  const ro = W.ResizeObserver ? new W.ResizeObserver(relayout) : null;
  ro?.observe(win);

  let busy = false;
  let auto = false;
  let spect = null; // a Replay (own round), or the followed player: { follow: true }
  const name = ctx.follow?.name ?? 'le joueur'; // spectator: the followed player
  let watched = null; // spectator: the round followed { round_id, bet, best }
  let autoTimer = null;
  let pendingKey = null; // the intent's key until the Core decided (a lost answer resends it)
  let hist = []; // the viewer's last rounds (Core, newest first)
  let destroyed = false;
  let presentingCredit = 0;
  /** The bet on screen: the player's own, a Replay's, or the followed player's. */
  const shownBet = () => (spect?.follow ? (watched?.bet ?? 0) : spect ? spect.round.bet : s.bet);

  const idle = () => {
    body.dispatchEvent(new globalThis.CustomEvent('jdm:host-idle', { bubbles: true, composed: true }));
  };
  const refreshWallet = () => body.dispatchEvent(new globalThis.CustomEvent('jdm:host-refresh', { bubbles: true, composed: true }));

  // --- Présentation des gains (V7) : interrompable à tout moment par Passer / STOP / un toucher sur les rouleaux ----
  let present = null;
  function newPresent() {
    let fire;
    const p = { skipped: false, gate: new Promise((ok) => (fire = ok)) };
    p.skip = () => ((p.skipped = true), fire());
    return p;
  }
  const wait = (ms, Pr = present) => Promise.race([new Promise((ok) => W.setTimeout(ok, ms)), Pr ? Pr.gate : new Promise(() => {})]);
  function countTo(paint, from, to, ms, Pr = present) {
    return new Promise((resolve) => {
      if (ms <= 0 || to <= from || (Pr && Pr.skipped)) return paint(to), resolve();
      const t0 = performance.now();
      const step = (t) => {
        if (Pr && Pr.skipped) return resolve();
        const u = Math.max(0, Math.min(1, (t - t0) / ms));
        paint(Math.round(from + (to - from) * (1 - (1 - u) ** 3)));
        if (u < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  // --- Plaque de gain, tableau des derniers gains ---------------------------------------------------------------------
  let plateLocked = false;
  let lastWin = '';
  const paintPlate = () => {
    if (plateLocked) return;
    plate.classList.remove('fs');
    plate.innerHTML = lastWin;
  };
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
    const fresh = !!boardSig && !!h[0] && !boardSig.startsWith(h[0].round_id);
    boardSig = sig;
    const symOf = (e) => (e.coffre ? 'bonus' : e.best ? e.best.symbol : null);
    const item = (e, i) => {
      const id = symOf(e);
      const ic = id ? Sym.symbolHTML(cfg.byId[id]) : '';
      const cls = `${i === 0 && fresh ? ' new' : ''}`;
      return e.payout
        ? `<span class="bi${cls}">${ic}${e.coffre ? '<span class="fs">COFFRE</span>' : ''}<b>+${compact(e.payout)}</b></span>`
        : `<span class="bi lose${cls}"><span>mise ${compact(e.bet)}</span><b>—</b></span>`;
    };
    const rows = h.length ? h.map(item).join('') + '<span class="bi empty"></span>'.repeat(4 - h.length) : '<span class="none">Aucun tour pour l’instant.</span>';
    board.innerHTML = `<span class="board__head"><span class="lbl">Derniers gains</span><span class="more" aria-hidden="true">${ICON.chev}</span></span><span class="board__rows">${rows}</span>`;
  }

  // --- Célébrations (V6/V7) -----------------------------------------------------------------------------------------
  async function mega(total, x, from = 0, short = false) {
    const m = D.ownerDocument.createElement('div');
    m.className = 'mega';
    let coins = '';
    for (let i = 0; i < 26; i++) coins += `<i class="cn" style="left:${Math.round(Math.random() * 96)}%;--d:${(1.3 + Math.random() * 1.1).toFixed(2)}s;--w:${(Math.random() * 0.9).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg"></i>`;
    m.innerHTML = `${coins}<span class="kicker">Méga gain</span><b>+${fmt(from)}</b><small>${times(x)} la mise</small>`;
    body.append(m);
    await countTo((v) => (m.querySelector('b').textContent = `+${fmt(v)}`), from, total, short ? 700 : 1700);
    await wait(short ? 450 : from >= total ? 1700 : 900);
    m.classList.add('out');
    await wait(360);
    m.remove();
  }
  async function boom(total, x, from = 0) {
    const b = D.ownerDocument.createElement('div');
    b.className = 'boom';
    b.innerHTML = `<span class="kicker">Gros gain</span><b>+${fmt(from)}</b><small>${times(x)} la mise</small>`;
    win.append(b);
    await countTo((v) => (b.querySelector('b').textContent = `+${fmt(v)}`), from, total, 1600);
    await wait(from >= total ? 1300 : 650);
    b.classList.add('out');
    await wait(330);
    b.remove();
  }

  // --- Ouverture : le Casino peut être fermé (hors live, fermé dans Studio) — l'historique reste lisible ---------------
  function closedReason() {
    const a = casino.availability;
    if (a.games.slot) return null;
    return Frame.REFUSAL[a.reason] ?? Frame.REFUSAL.game_closed;
  }
  function paintClosed() {
    const why = spect ? null : closedReason();
    const el = $('#closed');
    el.hidden = !why || busy;
    if (why) el.innerHTML = `<b>${why}</b><small>L’historique et les Replays restent disponibles.</small>`;
  }

  // --- L'état des commandes ---------------------------------------------------------------------------------------
  function update() {
    if (destroyed) return;
    showBet();
    const closed = !!closedReason() && !spect;
    const st = spect?.follow
      ? ['watch', 'eye', 'En direct', `Spectateur : tu regardes ${name} jouer`]
      : spect && !busy
      ? ['replay', 'close', 'Retour', spect.live ? 'Quitter la partie' : 'Quitter le replay']
      : auto
        ? ['stop', 'stop', 'Stop', 'Arrêter Auto']
        : busy
          ? ['busy', 'skip', 'Passer', 'Passer (même résultat, tout de suite)']
          : closed
            ? ['closed', 'stop', 'Fermé', closedReason()]
            : ['play', s.fast ? 'ffwd' : 'play', '', s.fast ? 'Lancer (rapide)' : 'Lancer'];
    spinBtn.dataset.state = st[0];
    spinBtn.innerHTML = `<span class="spin__cap">${ICON[st[1]].replace('<svg', `<svg class="fill ${st[1]}"`)}${st[2] ? `<small>${st[2]}</small>` : ''}</span>`;
    spinBtn.setAttribute('aria-label', st[3]);
    spinBtn.title = st[3];
    cab.classList.toggle('is-auto', auto);
    spinBtn.disabled = !!spect?.follow;
    const lock = busy || !!spect;
    $('[data-bet="down"]').disabled = $('[data-bet="min"]').disabled = lock || s.bet <= MIN();
    $('[data-bet="up"]').disabled = $('[data-bet="max"]').disabled = lock || s.bet >= maxAllowed();
    $('#lcd').classList.toggle('locked', lock);
    $('[data-act="fast"]').setAttribute('aria-pressed', String(s.fast));
    $('[data-act="auto"]').setAttribute('aria-pressed', String(auto));
    $('[data-act="sound"]').setAttribute('aria-pressed', String(s.sound));
    if (!busy) paintPlate();
    if (!presentingCredit) paintBoard();
    paintClosed();
  }

  // --- La mise ------------------------------------------------------------------------------------------------------
  const REFUSE = {
    invalid: () => 'Montant invalide : des chiffres, ou « 2k ».',
    min: () => `Mise minimum : ${fmt(MIN())}.`,
    max: () => `Mise maximum : ${fmt(CAP())}.`,
    balance: (b) => `Solde insuffisant pour ${fmt(b)}.`,
  };
  function setBet(v) {
    if (busy || spect) return 'locked';
    const err = Bets.error(v, { min: MIN(), max: CAP(), balance: balance ?? Infinity });
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
  const stepBet = (dir) => setBet(Bets.next(s.bet, dir, { min: MIN(), max: maxAllowed() }));
  const betInput = $('#bet');
  let editing = false;
  function showBet() {
    if (!editing) betInput.value = fmt(shownBet());
    betInput.disabled = busy || !!spect;
  }
  on(betInput, 'focus', () => {
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

  // --- Auto ---------------------------------------------------------------------------------------------------------
  function stopAuto(reason) {
    W.clearTimeout(autoTimer);
    if (!auto) return;
    auto = false;
    if (reason) Frame.toast(reason);
    update();
  }
  function toggleAuto() {
    if (spect) return;
    if (auto) return stopAuto('Auto arrêté.');
    if (closedReason()) return Frame.toast(closedReason(), true);
    auto = true;
    update();
    if (!busy) void spin();
  }

  // --- Un tour : le Core décide, l'écran le joue -------------------------------------------------------------------
  async function spin() {
    if (spect || destroyed) return;
    if (busy) {
      // Passer : le même résultat, tout de suite (rouleaux, puis décompte des gains) ; et Auto s'arrête.
      if (view.isRunning()) view.skip();
      else present?.skip();
      tellSkip(playing, 'result');
      stopAuto();
      return;
    }
    W.clearTimeout(autoTimer);
    const why = closedReason();
    if (why) return stopAuto(), Frame.toast(why, true), update();
    if (balance !== null && s.bet > balance) return stopAuto(), Frame.toast(REFUSE.balance(s.bet), true), update();
    busy = true;
    update();
    plateLocked = false;
    lastWin = '';
    plate.innerHTML = '';
    Audio.spinStart();
    const key = (pendingKey ??= newIdempotencyKey());
    let res;
    try {
      res = await client.casinoSpin('slot', { bet: s.bet }, key);
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
    await playRound(res.round, { fast: s.fast });
    busy = false;
    update();
    idle();
    refreshWallet();
    if (auto) autoTimer = W.setTimeout(() => auto && void spin(), res.round.payout >= res.round.bet * 10 ? 1300 : 450);
  }

  /**
   * The player's screen has shown a stage of their round: the spectators may see it now (the Core publishes it, never
   * before). Fire and forget, one retry; a lost one is published by the Core once overdue, or with the next stage.
   */
  let lastReveal = Promise.resolve();
  function reveal(roundId, stage, step = null, fast = false) {
    const go = (n) => client.casinoProgress(roundId, stage, step, fast).catch(() => n > 0 && W.setTimeout(() => void go(n - 1), 1200));
    lastReveal = go(1);
  }
  /** Passer: the spectators jump to the same end (after the stage itself: the Core accepts it only once public). */
  function tellSkip(roundId, of, step = null) {
    if (!roundId) return;
    void lastReveal.finally(() => client.casinoProgress(roundId, 'skip', step, true, of).catch(() => {}));
  }
  let playing = null; // the player's round on screen (for Passer)

  /** Plays a round the Core decided: the reels, the lines one by one, the Coffre (the player's own, or a Replay). */
  async function playRound(round, { fast = false, replay = false, from = null } = {}) {
    const r = asSpin(round);
    const line = round.outcome.line_win;
    const coffre = round.outcome.coffre;
    const x = line / round.bet;
    const level = line === 0 ? 0 : x >= 50 ? 4 : x >= 10 ? 3 : x >= 2 ? 2 : 1;
    const own = !replay;
    if (from === 'settled') view.renderStatic(r.stops);
    else {
      // The reels start on the player's screen: the result goes to the spectators now (never before this screen has
      // it), and they play the same animation on the same timeline (the Core's clock): both land together.
      if (own) {
        reveal(round.round_id, 'result', null, fast);
        playing = round.round_id;
        $('#reels').dataset.round = round.round_id; // (the round on the reels: read by the Lab's timing checks)
      }
      await view.spin(r, { fast });
    }
    if (destroyed) return;
    const shown = view.markWins(r);
    if (shown.wildMax >= 2) Audio.wild();
    if (own) {
      presentingCredit = round.payout;
      hist.unshift(light(round));
      hist.length = Math.min(hist.length, KEEP);
    }
    if (from !== 'settled' || !coffre) await presentLines(r, { level, x, steps: shown.steps, fast, credit: line });
    if (coffre && !destroyed) {
      if (own) stopAuto(); // le Coffre ne démarre jamais seul : le joueur relance lui-même
      plateLocked = true;
      plate.className = 'plate';
      plate.innerHTML = `<em>COFFRE</em><small>${coffre.k} BONUS</small>`;
      popPlate();
      if (from !== 'settled') await new Promise((ok) => W.setTimeout(ok, fast ? 350 : 1100));
      Audio.bonus();
      await CoffreView.play(
        { script: coffre, bet: round.bet, credit: coffre.win, paid: round.capped ? Math.max(0, round.payout - (round.outcome.line_win ?? 0)) : coffre.win, step: round.mine && !replay ? (round.progress_step ?? -1) : -1 },
        {
          replay,
          seed: round.round_id,
          getFast: () => s.fast,
          toggleFast,
          host: body,
          // Each stage goes to the spectators as it STARTS on the player's screen (the opening, a respin, the finale):
          // they play it at the same time. It also keeps the progress for a reconnection.
          onBegin: own ? (stage, i) => reveal(round.round_id, stage, i, s.fast) : null,
          onSkip: own ? (at) => at && tellSkip(round.round_id, at.of, at.step) : null,
          onCredit: () => refreshWallet(),
        },
      );
      plateLocked = false;
      lastWin = `<em>COFFRE</em><b>+${fmt(round.payout)}</b><small>${times(round.payout / round.bet)}</small>`;
      plate.className = 'plate';
      plate.innerHTML = lastWin;
      popPlate();
    }
    if (round.capped && own)
      await Frame.card(
        `<h2>Gain plafonné</h2><div class="big">+${fmt(round.payout)}</div><p>Le tirage valait ${fmt(round.raw_payout)} Jetons : le gain maximum par partie est de ${fmt(limits().max_win)} Jetons (règle du Casino).</p>`,
        [[1, 'Compris', 'gold']],
      );
    presentingCredit = 0;
    paintBoard();
  }

  // V7 : les combinaisons gagnantes se dévoilent une à une ; Rapide : tout d'un coup ; Passer : l'état final.
  async function presentLines(r, { level, x, steps, fast, credit }) {
    plate.classList.remove('old');
    if (!credit) return;
    plateLocked = true;
    const Pr = (present = newPresent());
    const final = () => `<b>+${fmt(credit)}</b><small>${times(x)}</small>`;
    const paint = (v, k) => (plate.innerHTML = `<b>+${fmt(v)}</b><small>${k || times(x)}</small>`);
    popPlate();
    let shown = 0;
    if (fast) {
      paint(credit);
      shown = credit;
    } else if (steps.length >= 2) {
      const n = steps.length;
      for (let i = 0; i < n && !Pr.skipped; i++) {
        const st = steps[i];
        const last = i === n - 1;
        const dur = Math.max(300, (n > 4 ? 560 : 680) * 0.86 ** i);
        view.focus(st);
        Audio.lineStep(i);
        plate.classList.remove('tick');
        void plate.offsetWidth;
        plate.classList.add('tick');
        await countTo((v) => paint(v, `${i + 1}/${n}`), shown, shown + st.win, last && level >= 3 ? dur * 1.4 : dur * 0.55);
        shown += st.win;
        await wait(last ? 260 : dur * 0.45);
      }
      view.settle();
    } else {
      if (steps[0]) view.focus(steps[0], { tag: false });
      if (level < 3) {
        await countTo((v) => paint(v), 0, credit, 450);
        shown = credit;
      }
    }
    if (Pr.skipped) shown = credit;
    if (!Pr.skipped && level >= 4) await mega(credit, x, shown, fast);
    else if (!Pr.skipped && level === 3 && !fast) await boom(credit, x, shown);
    view.settle();
    plate.innerHTML = final();
    if (steps.length >= 2 || level >= 3) popPlate();
    lastWin = plate.innerHTML;
    Audio.win(Math.min(3, level));
    if (present === Pr) present = null;
    plateLocked = false;
  }

  // --- Replay (ses tours) et spectateur (le tour d'un autre, à son rythme) ------------------------------------------
  function enterSpect(round, live) {
    spect = { round, live };
    $('#body').classList.add('is-spect');
    $('#spect').hidden = false;
    $('#spect span').textContent = live ? 'En direct' : 'Replay';
    $('#rstrip').hidden = false;
    $('#rstrip').innerHTML = `${live ? `<span>Joueur <b>${esc(round.viewer_name)}</b></span>` : ''}<span>Mise <b>${fmt(round.bet)}</b></span><span>Gain <b class="${round.payout ? 'g' : ''}">${round.payout && (!live || round.phase === 'result' || round.phase === 'done') ? '+' + fmt(round.payout) : live ? '…' : 'aucun'}</b></span><span class="when">${live ? 'spectateur' : Frame.ago(Date.parse(round.created_at))}${round.outcome.coffre ? ' · Coffre' : ''}</span>`;
    plateLocked = true;
    plate.className = 'plate replay';
    plate.innerHTML = live ? '<em>EN DIRECT</em>' : round.payout ? `<em>REPLAY</em><b>+${fmt(round.payout)}</b>` : '<em>REPLAY</em><small>aucun gain</small>';
    update();
  }
  function endSpect() {
    if (!spect) return;
    if (view.isRunning()) view.skip();
    spect = null;
    view.clearWins();
    view.renderStatic(randomStops());
    $('#body').classList.remove('is-spect');
    $('#spect').hidden = true;
    $('#rstrip').hidden = true;
    plateLocked = false;
    plate.className = 'plate';
    paintPlate();
    update();
  }
  async function replay(id) {
    if (busy) return;
    stopAuto();
    let round;
    try {
      round = (await client.casinoRound(id)).round;
    } catch (e) {
      return Frame.toast(Frame.refusalText(e), true);
    }
    busy = true;
    enterSpect(round, false);
    Frame.toast('Replay : simple consultation, ton solde ne change pas.');
    await playRound(round, { replay: true });
    busy = false;
    update();
    idle();
  }
  // --- Spectateur : on suit UN joueur (casino.js lit le flux du Core et nous donne ses étapes, dans l'ordre) --------
  // Chaque étape arrive une fois que l'écran du joueur l'a montrée : on la joue avec la même animation (un peu après
  // lui). Aucune commande n'agit : ni mise, ni Lancer, ni Auto, ni Rapide, ni Passer, ni le Coffre.
  let watchFast = false; // le rythme de l'étape en cours (Rapide du joueur, ou un spectateur en retard)
  let cof = null; // le Coffre suivi : { feed(item), control }
  let ackFn = null;
  const ackWait = () => new Promise((ok) => (ackFn = ok));
  const ack = () => {
    const f = ackFn;
    ackFn = null;
    f?.();
  };
  function strip(gain = '…') {
    $('#rstrip').innerHTML = `<span>Mise <b>${watched ? fmt(watched.bet) : '—'}</b></span><span>Gain <b class="${gain.startsWith('+') ? 'g' : ''}">${gain}</b></span><span class="when">en direct</span>`;
  }
  function note(text) {
    plateLocked = true;
    plate.className = 'plate replay';
    plate.innerHTML = `<small>${text}</small>`;
  }
  function closeCoffre() {
    if (!cof) return;
    cof.control.close?.();
    cof = null;
    ack();
  }
  function openCoffre(roundId, bet, data, steps, instant) {
    closeCoffre();
    const q = [];
    let take = null;
    const control = {};
    const c = { script: { k: data.k, start: data.start, steps: steps.slice(), total: 0, full: false, filled: data.k, jackpots: [], cols: 0, doubler: false }, bet, credit: 0, paid: 0, step: steps.length - 1 };
    const mine = {
      control,
      feed: (item) => {
        if (take) {
          const t = take;
          take = null;
          t(item);
        } else q.push(item);
      },
    };
    cof = mine;
    void CoffreView.play(c, {
      follow: () => new Promise((ok) => (q.length ? ok(q.shift()) : (take = ok))),
      spectator: name,
      seed: roundId,
      instant,
      control,
      host: body,
      getFast: () => watchFast,
      onReady: ack,
      onStep: ack,
    }).then(() => {
      if (cof === mine) cof = null;
    });
  }
  const winPlate = (payout, bet, coffre) => {
    plateLocked = false;
    plate.className = 'plate';
    lastWin = payout ? `${coffre ? '<em>COFFRE</em>' : ''}<b>+${fmt(payout)}</b><small>${times(payout / bet)}</small>` : '';
    plate.innerHTML = lastWin;
    if (payout) popPlate();
  };
  function pushHist(roundId, d) {
    hist.unshift({ round_id: roundId, bet: d.bet, payout: d.payout, best: watched?.best ?? null, coffre: d.coffre ? { total: d.coffre.total, full: d.coffre.full } : null });
    hist.length = Math.min(hist.length, 8);
    paintBoard();
  }

  /** One stage of the followed player (in order, once). `fast`: the player's Rapide / Passer, or a late spectator. */
  async function apply(ev, { fast = false, late = 0 } = {}) {
    if (destroyed) return;
    watchFast = !!(ev.fast || fast);
    const d = ev.data ?? {};
    if (ev.kind === 'presence') {
      if (d.game === null && !busy) note(`${esc(name)} a quitté le jeu.`);
      return;
    }
    if (ev.kind === 'start') {
      closeCoffre();
      watched = { round_id: ev.round_id, bet: d.bet, best: null };
      view.clearWins();
      note(`${esc(name)} lance…`);
      strip();
      update();
      return;
    }
    if (ev.round_id && watched?.round_id !== ev.round_id) watched = { round_id: ev.round_id, bet: d.bet ?? watched?.bet ?? 0, best: null };
    if (ev.kind === 'result') {
      busy = true;
      update();
      const r = asSpin({ outcome: d });
      // `late`: how long ago the player's reels started (the Core's clock): ours start there, both land together.
      $('#reels').dataset.round = ev.round_id; // (the round on the reels: read by the Lab's timing checks)
      await view.spin(r, { fast: watchFast, elapsed: late });
      if (destroyed) return;
      const shown = view.markWins(r);
      if (shown.wildMax >= 2) Audio.wild();
      watched.best = d.lines.slice().sort((a, b) => b.win - a.win)[0] ?? null;
      const x = d.line_win / watched.bet;
      const level = d.line_win === 0 ? 0 : x >= 50 ? 4 : x >= 10 ? 3 : x >= 2 ? 2 : 1;
      await presentLines(r, { level, x, steps: shown.steps, fast: watchFast, credit: d.line_win });
      if (d.coffre) {
        plateLocked = true;
        plate.className = 'plate';
        plate.innerHTML = `<em>COFFRE</em><small>${d.coffre.k} BONUS</small>`;
        popPlate();
        Audio.bonus();
      }
      busy = false;
      update();
      return;
    }
    if (ev.kind === 'coffre') {
      busy = true;
      update();
      const w = ackWait();
      openCoffre(ev.round_id, watched.bet, d, [], false);
      await w;
      return;
    }
    if (ev.kind === 'step') {
      if (!cof) return; // (the Coffre was closed under us: its next stage is the end)
      const w = ackWait();
      cof.feed({ step: d });
      await w;
      return;
    }
    if (ev.kind === 'end') {
      if (cof) {
        const w = ackWait();
        cof.feed({ end: d.coffre });
        await w;
      }
      busy = false;
      winPlate(d.payout, d.bet, !!d.coffre);
      strip(d.payout ? `+${fmt(d.payout)}` : 'aucun');
      pushHist(ev.round_id, d);
      update();
    }
  }

  /** The player pressed Passer on a stage this screen is playing: the same jump to the end (the same result). */
  function watchSkip(ev) {
    if (ev.round_id !== watched?.round_id) return;
    const at = ev.data?.at ?? '';
    if (at === 'result') {
      if (view.isRunning()) view.skip();
      else present?.skip();
    } else cof?.control.skip?.();
  }

  /** Rejoining (a new spectator, a refresh, a lost connection): the player's current round as it is now, no replay. */
  async function snapshot(events, { lateOf = () => Infinity } = {}) {
    closeCoffre();
    const at = events.map((e) => e.kind).lastIndexOf('start');
    const pres = [...events].reverse().find((e) => e.kind === 'presence');
    if (at < 0) {
      watched = null;
      view.clearWins();
      note(pres?.data.game === null ? `${esc(name)} a quitté le jeu.` : `En attente du prochain tour de ${esc(name)}…`);
      strip('—');
      update();
      return;
    }
    const start = events[at];
    const mine = events.slice(at).filter((e) => e.round_id === start.round_id);
    const res = mine.find((e) => e.kind === 'result');
    const cofE = mine.find((e) => e.kind === 'coffre');
    const end = mine.find((e) => e.kind === 'end');
    watched = { round_id: start.round_id, bet: start.data.bet, best: null };
    if (!res) return apply(start);
    // Its reels are still turning on the player's screen: join them where they are (the same landing).
    if (!cofE && lateOf(res) < 3500) {
      await apply(start);
      await apply(res, { late: lateOf(res) });
      if (end) await apply(end);
      return;
    }
    const r = asSpin({ outcome: res.data });
    view.renderStatic(r.stops);
    view.showWins(r);
    watched.best = res.data.lines.slice().sort((a, b) => b.win - a.win)[0] ?? null;
    if (end) {
      winPlate(end.data.payout, end.data.bet, !!end.data.coffre);
      strip(end.data.payout ? `+${fmt(end.data.payout)}` : 'aucun');
      update();
      return;
    }
    strip();
    if (cofE) {
      busy = true;
      update();
      const w = ackWait();
      openCoffre(start.round_id, watched.bet, cofE.data, mine.filter((e) => e.kind === 'step').map((e) => e.data), true);
      await w;
    }
    update();
  }

  function enterWatch() {
    spect = { live: true, follow: true, round: { bet: 0 } };
    body.classList.add('is-watch');
    $('#spect').hidden = false;
    $('#spect').innerHTML = `<i class="live-dot"></i><span>Spectateur · ${esc(name)}</span>`;
    $('#rstrip').hidden = false;
    strip('—');
    note(`En attente du prochain tour de ${esc(name)}…`);
    update();
  }

  // --- Historique, partage, table des gains -------------------------------------------------------------------------
  let histStats = null;
  async function loadHistory() {
    try {
      const h = await client.casinoHistory('slot', 50);
      hist = h.rounds;
      histStats = h.stats;
    } catch {
      /* lisible plus tard */
    }
    paintBoard();
  }
  const light = (round) => ({
    round_id: round.round_id,
    bet: round.bet,
    payout: round.payout,
    net: round.payout - round.bet,
    capped: round.capped,
    created_at: round.created_at,
    best: round.outcome.lines.slice().sort((a, b) => b.win - a.win)[0] ?? null,
    coffre: round.outcome.coffre ? { total: round.outcome.coffre.total, full: round.outcome.coffre.full } : null,
  });
  function historyHead() {
    const k = histStats ?? { rounds: hist.length, won: hist.reduce((a, e) => a + e.payout, 0), best: hist.reduce((a, e) => Math.max(a, e.payout), 0) };
    return `<div class="hsum"><span><small>Tours</small><b>${fmt(k.rounds)}</b></span><span><small>Gains cumulés</small><b class="g">${fmt(k.won)}</b></span><span><small>Meilleur gain</small><b class="g">${fmt(k.best)}</b></span></div>`;
  }
  function historyHTML() {
    if (!hist.length) return '<p class="hempty">Pas encore de tour.</p>';
    return `<ul class="hlist">${hist
      .map((e) => {
        const big = e.payout >= e.bet * 10 || e.coffre;
        const icon = e.coffre ? Sym.symbolHTML(cfg.byId.bonus) : e.best ? Sym.symbolHTML(cfg.byId[e.best.symbol]) : '<span class="hnone">—</span>';
        const amount = e.payout ? `+${fmt(e.payout)}` : `−${fmt(e.bet)}`;
        const tag = e.coffre ? `<i class="htag">COFFRE${e.coffre.full ? ' · GRAND' : ''}</i>` : e.capped ? '<i class="htag">PLAFONNÉ</i>' : '';
        return `<li class="hrow${e.payout ? ' win' : ''}${big ? ' big' : ''}"><span class="hic">${icon}</span><span class="hmain"><b>${amount}${tag}</b><small>mise ${fmt(e.bet)} · ${Frame.ago(Date.parse(e.created_at))}</small></span><span class="hacts"><button type="button" data-replay="${e.round_id}" title="Revoir ce tour" aria-label="Revoir ce tour">${ICON.replay}</button><button type="button" data-share="${e.round_id}" title="Partager dans le chat" aria-label="Partager dans le chat"${e.shared ? ' disabled' : ''}>${ICON.share}</button></span></li>`;
      })
      .join('')}</ul>`;
  }
  async function share(id) {
    const ok = await Frame.card(
      '<h2>Partager dans le chat</h2><div class="chatline"><span class="chatline__who">LeCroupier_</span><span class="chatline__msg">annoncera ce tour, tel qu’il a été joué (le Core relit la vraie partie).</span></div><p class="fine">Un partage par tour, et pas plus d’un toutes les quelques minutes.</p>',
      [
        [0, 'Annuler', 'sec'],
        [1, 'Partager', 'go'],
      ],
      undefined,
      'share',
    );
    if (!ok) return;
    try {
      const out = await client.casinoShare(id);
      const e = hist.find((x) => x.round_id === id);
      if (e) e.shared = true;
      Frame.toast(out.already ? 'Déjà partagé.' : `LeCroupier_ : ${esc(out.text)}`, false, 4200);
    } catch (e) {
      const wait = e?.details?.retry_in_s;
      Frame.toast(`${Frame.refusalText(e)}${wait ? ` (${wait} s)` : ''}`, true, 3200);
    }
  }
  function openHistory() {
    void loadHistory().then(() => d?.repaint());
    const d = Frame.drawer({
      side: 'right',
      width: 266,
      title: 'Historique',
      head: historyHead,
      render: historyHTML,
      foot: 'Tes tours, gardés par le Core. Revoir ne change jamais ton solde.',
      onClick(e, dr) {
        const r = e.target.closest('[data-replay]');
        if (r) return dr.close(), void replay(r.dataset.replay);
        const sh = e.target.closest('[data-share]');
        if (sh) return void share(sh.dataset.share).then(() => dr.repaint());
      },
    });
  }
  function paytableHTML() {
    const bet = shownBet();
    const val = (sym, k) => (sym.pays[k] ? compact(Math.floor((bet * sym.pays[k]) / 100)) : '');
    const order = ['sept', 'diamant', 'bar', 'cloche', 'raisin', 'cerise', 'citron', 'wild'];
    const rows = order
      .map((id) => {
        const sym = cfg.byId[id];
        return `<tr class="${id === 'wild' ? 'wildrow' : ''}"><td>${Sym.symbolHTML(sym)}</td>${[5, 4, 3, 2].map((k) => `<td${k === 2 && sym.pays[2] ? ' class="two"' : ''}>${val(sym, k)}</td>`).join('')}</tr>`;
      })
      .join('');
    const lines = cfg.lines
      .map((l, i) => {
        const pts = l.rows.map((row, r) => `${r * 6 + 3},${row * 5 + 2.5}`).join(' ');
        return `<svg viewBox="0 0 30 15" style="--c:${View.LINE_COLORS[i % View.LINE_COLORS.length]}"><rect width="30" height="15" rx="2.5"/><polyline points="${pts}"/></svg>`;
      })
      .join('');
    return `<table class="ptab"><thead><tr><th></th><th>×5</th><th>×4</th><th>×3</th><th>×2</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="prule">${Sym.symbolHTML(cfg.byId.wild)}<p><b>WILD</b> remplace tous les symboles, sauf BONUS.</p></div>
      <div class="prule">${Sym.symbolHTML(cfg.byId.bonus)}<p><b>3 · 4 · 5 BONUS</b> n’importe où : <b>le Coffre</b>. Les BONUS deviennent des pièces ; chaque nouvelle pièce remet les 3 relances. MINI ×20 · MAJEUR ×100 · MÉGA ×500 · grille pleine : GRAND ×1 000.</p></div>
      <p class="pcap">Gain maximum par partie : <b>${fmt(limits().max_win)} Jetons</b>.</p>
      <div class="plines"><span>10 lignes</span>${lines}</div>`;
  }
  function openPaytable() {
    Frame.drawer({ side: 'left', width: 236, title: `Table des gains<small>mise ${compact(shownBet())}</small>`, render: paytableHTML });
  }

  // --- Commandes ----------------------------------------------------------------------------------------------------
  function toggleFast() {
    s.fast = !s.fast;
    P.save();
    update();
  }
  on(body, 'click', (e) => {
    const b = e.target.closest('[data-bet], [data-act]');
    if (!b || b.disabled) return;
    // Spectator: only the rules and the sound (this browser); nothing acts on the followed player's game.
    if (spect?.follow && b.dataset.act !== 'pay' && b.dataset.act !== 'sound') return;
    const k = b.dataset.bet || b.dataset.act;
    if (k === 'down') stepBet(-1);
    else if (k === 'up') stepBet(1);
    else if (k === 'min') setBet(MIN());
    else if (k === 'max') setBet(maxAllowed());
    else if (k === 'pay') openPaytable();
    else if (k === 'hist') openHistory();
    else if (k === 'sound') {
      s.sound = !s.sound;
      Audio.setEnabled(s.sound);
      P.save();
      update();
      Audio.click();
    } else if (k === 'fast') toggleFast();
    else if (k === 'auto') toggleAuto();
  });
  on(spinBtn, 'click', () => {
    if (spect?.follow) return;
    if (spect) return busy ? (view.isRunning() ? view.skip() : present?.skip()) : endSpect();
    if (auto) return busy ? (void spin(), Frame.toast('Auto arrêté.')) : stopAuto('Auto arrêté.');
    void spin();
  });
  on(win, 'click', () => !spect?.follow && busy && (spect ? view.skip() : void spin()));
  on(W, 'keydown', (e) => {
    if (spect?.follow) return;
    if (e.key === 'Escape' && spect && !Frame.drawerOpen() && !D.querySelector('.card')) return endSpect();
    if (e.code === 'Space' && e.target === D.ownerDocument.body && !D.querySelector('.cof')) {
      e.preventDefault();
      spinBtn.click();
    }
  });
  on(D, 'error', (e) => e.target?.tagName === 'IMG' && Sym.repair?.(e), true);

  /** The Core's state again (availability, limits, balance): after a refusal, and on every opening. */
  async function reload() {
    try {
      casino = await client.casinoState();
      balance = casino.me?.balance ?? balance;
      cfg = slotConfig(casino.tables.slot);
    } catch {
      /* the last one */
    }
    update();
  }

  async function start() {
    if (ctx.follow) return enterWatch();
    update();
    await loadHistory();
    // A Coffre left unfinished (closed tab, other device, reconnection): it resumes where it was, already paid.
    const resume = casino.me?.resume;
    if (resume && !destroyed) {
      busy = true;
      update();
      Frame.toast('Coffre repris là où il en était (déjà crédité).');
      await playRound({ ...resume, mine: true }, { from: 'settled' });
      busy = false;
      update();
      idle();
      refreshWallet();
    }
  }
  // A spectator is ready at once (casino.js hands it the player's stages as soon as it is mounted).
  if (ctx.follow) enterWatch();
  else setTimeout(() => void start());

  return {
    busy: () => busy || !!present,
    /** Spectator: the followed player's next stage, or a snapshot to rejoin them (casino.js). */
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
      for (const [t, ev, fn, opt] of listeners) t.removeEventListener(ev, fn, opt);
      closeCoffre();
      D.querySelector('.cof')?.remove();
    },
  };
}
