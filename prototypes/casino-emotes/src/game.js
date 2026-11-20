// Machine n°2 — l'écran. Même structure, mêmes classes et même comportement que la machine à fruits intégrée
// (apps/twitch-extension/extension/shared/casino/slot.js, copiée ici en vendor/ sans changement) : la vitre et ses
// rouleaux (vendor/reels.js), la plaque de gain, la barre de mise, la colonne de droite (derniers gains, Rapide, Auto,
// Son, le gros bouton). Ce qui est NOUVEAU : les notes des BONUS, le carrousel du symbole extensible, les tours gratuits
// (leur tableau prend la place des « Derniers gains »), le remplissage des rouleaux, la fin du bonus.
// Le tour entier est décidé par le moteur AVANT toute animation (engine.playRound) : l'écran ne fait que le montrer.
import * as Frame from '../vendor/frame.js';
import { ArcadeAudio as Audio } from '../vendor/audio.js';
import { ArcadeBets as Bets } from '../vendor/bets.js';
import { ArcadeSlotsView as View } from '../vendor/reels.js';
import * as Engine from './engine.js';
import { Sfx } from './sfx.js';
import { BY_ID, playNative, symbolHTML } from './symbols.js';

const { ICON, fmt, compact, esc } = Frame;
const times = (x) => `×${String(Math.round(x * 10) / 10).replace('.', ',')}`;
const MIN_BET = 20;
const MAX_BET = 10_000;
const START_BALANCE = 100_000;

const TEMPLATE = `
  <div class="cab" id="game">
    <div class="stage">
      <button type="button" class="notch" data-act="pay" title="Table des gains et règles" aria-label="Table des gains et règles"><span>Gains</span></button>
      <div class="window" id="window">
        <div class="reels" id="reels">${'<div class="reel"><div class="tape"></div></div>'.repeat(5)}</div>
        <div class="xlayer" id="xlayer" aria-hidden="true"></div>
        <div class="plate" id="plate" aria-live="polite"></div>
        <i class="orn tl"></i><i class="orn tr"></i><i class="orn bl"></i><i class="orn br"></i><i class="crest"></i>
        <div class="rbadge testbadge" id="testbadge" hidden><span>Scénario de test</span></div>
        <div class="carousel" id="carousel" hidden></div>
        <div class="fsbanner" id="fsbanner" hidden></div>
        <div class="fsend" id="fsend" hidden></div>
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
    </div>
  </div>
  <div class="drawer" id="drawer" hidden></div>
  <div class="toast" id="toast"></div>`;

export function mountBook(D, { onWallet = () => {}, onRound = () => {}, onState = () => {} } = {}) {
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

  // --- Préférences (ce navigateur) et Jetons FICTIFS ---------------------------------------------------------------
  const P = Frame.prefs('casino:book', { bet: 100, sound: false, fast: false, volume: 0.6 });
  const s = P.get();
  const WAL = Frame.prefs('casino:book:wallet', { balance: START_BALANCE, hist: [] });
  const w = WAL.get();
  Audio.setEnabled(s.sound);
  Audio.setVolume(s.volume);
  let shownBalance = w.balance; // le bandeau : le gain s'y ajoute à la fin de sa présentation, comme la machine à fruits
  const paintWallet = (delta = 0) => onWallet(shownBalance, delta);
  const maxAllowed = () => Math.max(MIN_BET, Math.min(MAX_BET, w.balance));
  if (!Number.isInteger(s.bet) || s.bet < MIN_BET) s.bet = MIN_BET;
  if (s.bet > MAX_BET) s.bet = MAX_BET;

  const cfg = { reels: 5, rows: 3, strips: Engine.STRIPS, byId: BY_ID, scatterId: Engine.BONUS, lines: Engine.LINES };
  const view = View.create(win, cfg, { audio: Audio, symbolHTML });
  const rng = Engine.cryptoRng();
  view.renderStatic(Engine.STRIPS.map((x) => rng.int(x.length)));
  const relayout = () => (view.relayout(), placeCols());
  W.addEventListener('resize', relayout);
  new W.ResizeObserver(relayout).observe(win);

  let busy = false;
  let auto = false;
  let autoTimer = null;
  let inFree = null; // le bonus en cours : { feature, played }
  let armed = null; // le scénario de test du prochain tour (Lab)

  // --- Une « phase » interruptible par Passer (la présentation des gains, le carrousel, une extension) -------------
  let present = null;
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
  const fast = () => s.fast;
  /** Les émotes animées ne s'animent QUE dans les cases gagnantes (lignes, BONUS payés) ; les autres restent figées. */
  const animateWinners = () => reelsEl.querySelectorAll('.cell.win, .cell.scatter-win, .cell.bonus-glow').forEach((c) => playNative(c, true));

  // --- Plaque, derniers gains ---------------------------------------------------------------------------------------
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
    const h = w.hist.slice(0, 4);
    const sig = h.map((e) => e.t).join();
    if (sig === boardSig) return;
    const fresh = !!boardSig && !!h[0] && !boardSig.startsWith(String(h[0].t));
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

  // --- Célébrations : celles de la machine à fruits -----------------------------------------------------------------
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

  // --- État des commandes --------------------------------------------------------------------------------------------
  function update() {
    showBet();
    const st = auto
      ? ['stop', 'stop', 'Stop', 'Arrêter Auto']
      : busy
        ? ['busy', 'skip', 'Passer', inFree ? 'Passer (cette animation, même résultat)' : 'Passer (même résultat, tout de suite)']
        : ['play', s.fast ? 'ffwd' : 'play', '', s.fast ? 'Lancer (rapide)' : 'Lancer'];
    spinBtn.dataset.state = st[0];
    spinBtn.innerHTML = `<span class="spin__cap">${ICON[st[1]].replace('<svg', `<svg class="fill ${st[1]}"`)}${st[2] ? `<small>${st[2]}</small>` : ''}</span>`;
    spinBtn.setAttribute('aria-label', st[3]);
    spinBtn.title = st[3];
    cab.classList.toggle('is-auto', auto);
    const lock = busy;
    $('[data-bet="down"]').disabled = $('[data-bet="min"]').disabled = lock || s.bet <= MIN_BET;
    $('[data-bet="up"]').disabled = $('[data-bet="max"]').disabled = lock || s.bet >= maxAllowed();
    $('#lcd').classList.toggle('locked', lock);
    $('[data-act="fast"]').setAttribute('aria-pressed', String(s.fast));
    $('[data-act="auto"]').setAttribute('aria-pressed', String(auto));
    D.querySelectorAll('[data-act="sound"]').forEach((b) => b.setAttribute('aria-pressed', String(s.sound)));
    if (!busy) paintPlate();
    paintBoard();
    onState({ busy, auto, inFree: !!inFree, balance: w.balance, armed });
  }

  // --- La mise (comme la machine à fruits) --------------------------------------------------------------------------
  const REFUSE = {
    invalid: () => 'Montant invalide : des chiffres, ou « 2k ».',
    min: () => `Mise minimum : ${fmt(MIN_BET)}.`,
    max: () => `Mise maximum : ${fmt(MAX_BET)}.`,
    balance: (b) => `Solde insuffisant pour ${fmt(b)}.`,
  };
  function setBet(v) {
    if (busy) return 'locked';
    const err = Bets.error(v, { min: MIN_BET, max: MAX_BET, balance: w.balance });
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
  const stepBet = (dir) => setBet(Bets.next(s.bet, dir, { min: MIN_BET, max: maxAllowed() }));
  const betInput = $('#bet');
  let editing = false;
  function showBet() {
    if (!editing) betInput.value = fmt(inFree ? inFree.bet : s.bet);
    betInput.disabled = busy;
  }
  betInput.addEventListener('focus', () => {
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
  betInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (commitBet(), betInput.blur());
    if (e.key === 'Escape') ((editing = false), showBet(), betInput.blur());
  });
  betInput.addEventListener('blur', commitBet);

  // --- Auto (les tours ordinaires ; il s'arrête quand le bonus se déclenche) ----------------------------------------
  function stopAuto(reason) {
    W.clearTimeout(autoTimer);
    if (!auto) return;
    auto = false;
    if (reason) Frame.toast(reason);
    update();
  }
  function toggleAuto() {
    if (auto) return stopAuto('Auto arrêté.');
    auto = true;
    update();
    if (!busy) void spin();
  }

  // --- Un tour ------------------------------------------------------------------------------------------------------
  function skipNow() {
    if (view.isRunning()) view.skip();
    else present?.skip();
  }
  async function spin() {
    if (busy) {
      skipNow();
      if (!inFree) stopAuto();
      return;
    }
    W.clearTimeout(autoTimer);
    if (s.bet > w.balance) return stopAuto(), Frame.toast(REFUSE.balance(s.bet), true), update();
    busy = true;
    const test = armed;
    armed = null;
    // Le tirage : tout le tour, bonus compris, AVANT la moindre animation.
    const round = Engine.playRound(rng, s.bet, test);
    w.balance += round.payout - round.bet; // le solde réel (fictif) : débité et crédité d'un coup
    WAL.save();
    shownBalance -= round.bet; // le bandeau : la mise tout de suite, le gain à la fin de sa présentation
    paintWallet(-round.bet);
    update();
    $('#testbadge').hidden = !round.test;
    plateLocked = false;
    lastWin = '';
    plate.innerHTML = '';
    Audio.spinStart();
    await playRound(round);
    shownBalance = w.balance;
    paintWallet(round.payout);
    record(round);
    $('#testbadge').hidden = true;
    busy = false;
    update();
    if (auto) autoTimer = W.setTimeout(() => auto && void spin(), round.payout >= round.bet * 10 ? 1300 : 450);
  }
  function record(round) {
    const best = round.base.eval.lines.slice().sort((a, b) => b.win - a.win)[0];
    w.hist.unshift({
      t: Date.now(),
      bet: round.bet,
      payout: round.payout,
      best: best?.symbol ?? null,
      test: !!round.test,
      feature: round.feature ? { symbol: round.feature.symbol, total: round.feature.total, games: round.feature.games, series: round.feature.series } : null,
    });
    w.hist.length = Math.min(w.hist.length, 60);
    WAL.save();
    onRound(round);
    globalThis.__lastRound = round;
    globalThis.__rounds?.push({ bet: round.bet, payout: round.payout, feature: !!round.feature, test: !!round.test, balance: w.balance });
  }

  /** Les BONUS qui tombent : une note par BONUS révélé, plus haute à chaque fois, à l'arrêt exact de son rouleau. */
  function bonusStops(grid) {
    let k = 0;
    let lastSkippedNote = 0;
    return (r, skipped) => {
      const n = grid[r].filter((id) => id === Engine.BONUS).length;
      if (!n) return;
      view.markLanded(r);
      const useful = k + n + (4 - r) >= 3; // encore assez de rouleaux pour arriver à 3 BONUS
      k += n;
      if (!useful) return;
      if (!skipped) Sfx.bonusNote(k);
      else if (k > lastSkippedNote) {
        lastSkippedNote = k;
        W.setTimeout(() => k === lastSkippedNote && Sfx.bonusNote(k), 30); // Passer : une seule note, la dernière
      }
    };
  }
  const asSpin = (x) => ({ stops: x.stops, grid: x.grid, eval: x.eval });

  async function playRound(round) {
    const b = round.base;
    await view.spin(asSpin(b), { fast: fast(), onReelStop: bonusStops(b.grid) });
    const shown = view.markWins(asSpin(b));
    if (shown.wildMax >= 2) Audio.wild();
    const x = b.eval.total / round.bet;
    await presentLines(asSpin(b), { x, steps: shown.steps, credit: b.eval.total });
    if (round.feature) {
      stopAuto(auto ? 'Auto arrêté : le bonus commence.' : null);
      await bonusHit(b);
      await playFeature(round);
    }
  }

  // Les combinaisons une à une (la machine à fruits) ; Rapide : tout d'un coup ; Passer : l'état final.
  async function presentLines(r, { x, steps, credit, kick = true, pace = 0 }) {
    if (!credit) return;
    const level = x >= 50 ? 4 : x >= 10 ? 3 : x >= 2 ? 2 : 1;
    plateLocked = true;
    const Pr = newPresent();
    const paint = (v, k) => (plate.innerHTML = `<b>+${fmt(v)}</b><small>${k || times(x)}</small>`);
    popPlate();
    let shownV = 0;
    if (fast()) paint(credit), (shownV = credit);
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

  // --- 3 BONUS : la réussite, puis le bonus ---------------------------------------------------------------------------
  async function bonusHit(b) {
    const Pr = newPresent();
    reelsEl.classList.add('bonus-hit');
    b.eval.scatter.cells.forEach(([r, row]) => reelsEl.querySelectorAll('.reel')[r].querySelector('.tape').children[row + 1]?.classList.add('bonus-glow'));
    animateWinners();
    Sfx.bonusSuccess();
    plateLocked = true;
    plate.className = 'plate';
    plate.innerHTML = `<em>BONUS</em><small>${b.eval.scatter.count} BONUS · 10 tours gratuits</small>`;
    popPlate();
    await wait(fast() ? 650 : 1700, Pr);
    reelsEl.classList.remove('bonus-hit');
    reelsEl.querySelectorAll('.bonus-glow').forEach((c) => c.classList.remove('bonus-glow'));
  }

  // --- Le carrousel : piloté par le symbole DÉJÀ tiré (il ne choisit rien) ------------------------------------------
  async function carousel(sym) {
    const Pr = newPresent();
    const c = $('#carousel');
    const order = Engine.PAYING;
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
        const u = Pr.skipped ? 1 : Math.min(1, (t - t0) / dur);
        const e = 1 - (1 - u) ** 4; // ralentit progressivement
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
    c.querySelector('.car__name').innerHTML = `<b>${esc(BY_ID[sym].name)}</b><small>${Engine.minCount(sym) === 2 ? 'fort : s’étend dès 2 rouleaux' : 's’étend dès 3 rouleaux'}</small>`;
    playNative(chosen, true);
    Sfx.carouselLand();
    await wait(fast() ? 650 : 1500, newPresent());
    c.classList.add('out');
    await new Promise((ok) => W.setTimeout(ok, 280));
    c.hidden = true;
    c.classList.remove('done', 'out');
  }

  // --- Les tours gratuits ---------------------------------------------------------------------------------------------
  const fsb = $('#fsboard');
  function paintFree() {
    if (!inFree) return;
    const { feature, played, total, granted } = inFree;
    const sym = feature.symbol;
    fsb.innerHTML = `<span class="fsb__head">Tours gratuits</span>
      <span class="fsb__count"><b>${granted - played}</b><small><span>restants</span><span>tour ${played}/${granted}</span></small></span>
      <span class="fsb__sym">${symbolHTML(BY_ID[sym])}<small>extensible</small></span>
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
  async function playFeature(round) {
    const f = round.feature;
    inFree = { feature: f, bet: round.bet, played: 0, total: 0, granted: Engine.FREE_GAMES, series: 1 };
    cab.classList.add('is-free', 'in-free');
    fsb.hidden = false;
    board.hidden = true;
    paintFree();
    update();
    await carousel(f.symbol);
    markSpecial(f.symbol);
    Sfx.freeStart();
    await banner(`<em>10 tours gratuits</em><span class="fsbanner__sym">${symbolHTML(BY_ID[f.symbol])}</span><small>${esc(BY_ID[f.symbol].name)} s’étend</small>`, fast() ? 600 : 1300);
    for (const sp of f.spins) {
      clearCols();
      inFree.played = sp.i + 1;
      paintFree();
      plateLocked = false;
      lastWin = '';
      plate.innerHTML = '';
      Audio.spinStart();
      await view.spin(asSpin(sp), { fast: fast(), onReelStop: bonusStops(sp.grid) });
      // les gains normaux du tour, puis l'extension (elle paie en plus)
      const shown = view.markWins(asSpin(sp));
      if (sp.eval.total) await presentLines(asSpin(sp), { x: sp.eval.total / round.bet, steps: shown.steps, credit: sp.eval.total, kick: false, pace: 200 });
      inFree.total += sp.eval.total;
      paintFree();
      if (sp.expansion) {
        await expand(sp, round.bet);
        inFree.total += sp.expansion.win;
        paintFree();
      }
      if (sp.win) {
        plate.innerHTML = `<b>+${fmt(sp.win)}</b><small>ce tour · ${times(sp.win / round.bet)}</small>`;
        lastWin = plate.innerHTML;
      }
      if (sp.retrigger) {
        inFree.granted += Engine.FREE_GAMES;
        inFree.series++;
        paintFree();
        Sfx.retrigger();
        await banner(`<em>+10 tours gratuits</em><small>${sp.eval.scatter.count} BONUS · même symbole</small>`, fast() ? 700 : 1500);
      }
      await wait(fast() ? 260 : 650, newPresent());
    }
    clearCols();
    markSpecial(null);
    await finale(round);
    cab.classList.remove('is-free', 'in-free');
    fsb.hidden = true;
    board.hidden = false;
    inFree = null;
    lastWin = `<em>BONUS</em><b>+${fmt(f.total)}</b><small>${times(f.total / round.bet)}</small>`;
    plate.innerHTML = lastWin;
    popPlate();
  }

  let specialSheet = null;
  function markSpecial(sym) {
    if (specialSheet) D.adoptedStyleSheets = D.adoptedStyleSheets.filter((x) => x !== specialSheet);
    specialSheet = null;
    if (!sym) return;
    specialSheet = new CSSStyleSheet();
    specialSheet.replaceSync(`.cab.in-free .reel .cell[data-s="${sym}"]::after { content: '★'; position: absolute; inset: 6% 5%; z-index: 2; border-radius: 12px; pointer-events: none; display: grid; place-items: start end; padding: 1px 3px; font: 900 10px/1 var(--font); color: #2a1600; text-shadow: 0 0 2px #fff3c4; box-shadow: inset 0 0 0 1.5px rgba(255, 225, 140, 0.9), 0 0 9px rgba(255, 190, 60, 0.45); background: radial-gradient(closest-side, rgba(255, 201, 77, 0.14), transparent) , linear-gradient(225deg, #ffd36a 0 15%, transparent 15%); }`);
    D.adoptedStyleSheets = [...D.adoptedStyleSheets, specialSheet];
  }

  // --- L'extension : les symboles concernés s'éclairent, puis leurs rouleaux se remplissent un à un ---------------------
  let cols = [];
  const peek = () => parseFloat(getComputedStyle(reelsEl).getPropertyValue('--peek')) || 0;
  function placeCols() {
    const reels = reelsEl.querySelectorAll('.reel');
    const box = reelsEl.getBoundingClientRect();
    const wb = win.getBoundingClientRect();
    for (const c of cols) {
      const rb = reels[c.r].getBoundingClientRect();
      const cellH = rb.height / (3 + 2 * peek());
      c.el.style.left = `${rb.left - wb.left}px`;
      c.el.style.width = `${rb.width}px`;
      c.el.style.top = `${rb.top - wb.top + peek() * cellH}px`;
      c.el.style.height = `${3 * cellH}px`;
    }
    void box;
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
    // 1. les symboles extensibles déjà là
    for (const r of x.reels)
      for (let row = 0; row < 3; row++)
        if (sp.grid[r][row] === x.symbol) reels[r].querySelector('.tape').children[row + 1]?.classList.add('x-seed');
    Sfx.carouselTick(0.2);
    await wait(fast() ? 200 : 520, Pr);
    // 2. chaque rouleau se remplit, depuis la case où le symbole est tombé, un rouleau après l'autre
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
    // 3. le gain de l'extension
    const k = x.win / bet;
    const level = k >= 50 ? 4 : k >= 10 ? 3 : k >= 2 ? 2 : 1;
    plateLocked = true;
    plate.className = 'plate';
    popPlate();
    const paintX = (v, tag) => (plate.innerHTML = `<em>${tag}</em><b>+${fmt(v)}</b><small>${times(v / bet)}</small>`);
    if (fast()) paintX(x.win, `Extension · ${x.n} rouleaux`);
    else {
      const L = Engine.LINES.length;
      let shownX = 0;
      for (let li = 0; li < L && !Pr.skipped; li++) {
        xlayer.querySelectorAll('.xcell.hit').forEach((c) => c.classList.remove('hit'));
        for (const c of cols) c.el.querySelectorAll('.xcell')[Engine.LINES[li].rows[c.r]]?.classList.add('hit');
        Audio.lineStep(li);
        const to = Math.round((x.win * (li + 1)) / L);
        await countTo((v) => paintX(v, `Extension · ligne ${li + 1}/${L}`), shownX, to, 140, Pr);
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

  // --- La fin du bonus ------------------------------------------------------------------------------------------------
  async function finale(round) {
    const f = round.feature;
    const k = f.total / round.bet;
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

  // --- Historique, table des gains -------------------------------------------------------------------------------------
  function historyHTML() {
    if (!w.hist.length) return '<p class="hempty">Pas encore de tour.</p>';
    return `<ul class="hlist">${w.hist
      .map((e) => {
        const icon = e.feature ? symbolHTML(BY_ID[e.feature.symbol]) : e.best ? symbolHTML(BY_ID[e.best]) : '<span class="hnone">—</span>';
        const tag = e.feature ? `<i class="htag">BONUS · ${e.feature.games} tours</i>` : '';
        return `<li class="hrow${e.payout ? ' win' : ''}${e.feature || e.payout >= e.bet * 10 ? ' big' : ''}"><span class="hic">${icon}</span><span class="hmain"><b>${e.payout ? `+${fmt(e.payout)}` : `−${fmt(e.bet)}`}${tag}${e.test ? '<i class="htag test">TEST</i>' : ''}</b><small>mise ${fmt(e.bet)} · ${Frame.ago(e.t)}</small></span></li>`;
      })
      .join('')}</ul>`;
  }
  function openHistory() {
    const k = { rounds: w.hist.length, won: w.hist.reduce((a, e) => a + e.payout, 0), best: w.hist.reduce((a, e) => Math.max(a, e.payout), 0) };
    Frame.drawer({
      side: 'right',
      width: 266,
      title: 'Historique',
      head: () => `<div class="hsum"><span><small>Tours</small><b>${fmt(k.rounds)}</b></span><span><small>Gains cumulés</small><b class="g">${fmt(k.won)}</b></span><span><small>Meilleur gain</small><b class="g">${fmt(k.best)}</b></span></div>`,
      render: historyHTML,
      foot: 'Tes 60 derniers tours, gardés dans ce navigateur. Jetons fictifs.',
    });
  }
  function paytableHTML() {
    const bet = inFree ? inFree.bet : s.bet;
    const val = (id, k) => (Engine.PAYS[id][k] ? compact(Math.floor((bet * Engine.PAYS[id][k]) / 10)) : '');
    const rows = Engine.PAYING.map((id) => `<tr><td>${symbolHTML(BY_ID[id])}</td>${[5, 4, 3, 2].map((k) => `<td${k === 2 && Engine.PAYS[id][2] ? ' class="two"' : ''}>${val(id, k)}</td>`).join('')}</tr>`).join('');
    const sc = (k) => compact(Engine.SCATTER_PAYS[k] * bet);
    const lines = Engine.LINES.map((l, i) => {
      const pts = l.rows.map((row, r) => `${r * 6 + 3},${row * 5 + 2.5}`).join(' ');
      return `<svg viewBox="0 0 30 15" style="--c:${View.LINE_COLORS[i % View.LINE_COLORS.length]}"><rect width="30" height="15" rx="2.5"/><polyline points="${pts}"/></svg>`;
    }).join('');
    return `<table class="ptab"><thead><tr><th></th><th>×5</th><th>×4</th><th>×3</th><th>×2</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="prule">${symbolHTML(BY_ID.bonus)}<p><b>BONUS = WILD</b> : il remplace tous les symboles sur une ligne. N’importe où, 3 · 4 · 5 BONUS paient <b>${sc(3)} · ${sc(4)} · ${sc(5)}</b> et donnent <b>10 tours gratuits</b>.</p></div>
      <div class="prule"><span class="prule__ico">↔</span><p><b>Tours gratuits</b> : un symbole est tiré au hasard et devient <b>extensible</b>. S’il est sur assez de rouleaux (2 pour les 4 forts, 3 pour les autres, voisins ou non), ces rouleaux se remplissent et il paie sur les <b>10 lignes</b>, en plus des gains normaux. 3 BONUS : +10 tours.</p></div>
      <p class="pcap">Gains de ligne de gauche à droite, une ligne = un gain. Mise ${fmt(bet)} = 10 lignes à ${fmt(bet / 10)}.</p>
      <div class="plines"><span>10 lignes</span>${lines}</div>
      <label class="pvol"><span>Volume</span><input type="range" min="0" max="100" value="${Math.round(Audio.volume * 100)}" data-vol aria-label="Volume des sons"></label>`;
  }
  const openPaytable = () => Frame.drawer({ side: 'left', width: 236, title: `Table des gains<small>mise ${compact(inFree ? inFree.bet : s.bet)}</small>`, render: paytableHTML });

  // --- Commandes ------------------------------------------------------------------------------------------------------
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bet], [data-act]');
    if (!b || b.disabled) return;
    const k = b.dataset.bet || b.dataset.act;
    if (k === 'down') stepBet(-1);
    else if (k === 'up') stepBet(1);
    else if (k === 'min') setBet(MIN_BET);
    else if (k === 'max') setBet(maxAllowed());
    else if (k === 'pay') openPaytable();
    else if (k === 'hist') openHistory();
    else if (k === 'sound') setSound(!s.sound);
    else if (k === 'fast') ((s.fast = !s.fast), P.save(), update());
    else if (k === 'auto') !inFree && toggleAuto();
  });
  body.addEventListener('input', (e) => e.target.matches?.('[data-vol]') && setVolume(e.target.value / 100));
  function setSound(on) {
    s.sound = on;
    Audio.setEnabled(on);
    P.save();
    update();
    Audio.click();
  }
  function setVolume(v) {
    s.volume = v;
    Audio.setVolume(v);
    P.save();
  }
  spinBtn.addEventListener('click', () => {
    if (auto && !inFree) return busy ? (void spin(), Frame.toast('Auto arrêté.')) : stopAuto('Auto arrêté.');
    void spin();
  });
  win.addEventListener('click', () => busy && skipNow());
  W.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === D.ownerDocument.body) {
      e.preventDefault();
      spinBtn.click();
    }
  });

  update();
  paintWallet();

  // --- Le Lab (outils de démonstration, hors de l'interface) ----------------------------------------------------------
  return {
    arm(test) {
      armed = test;
      update();
    },
    give(n) {
      w.balance += n;
      shownBalance += n;
      WAL.save();
      paintWallet(n);
      update();
    },
    reset() {
      if (busy) return false;
      w.balance = START_BALANCE;
      w.hist = [];
      shownBalance = w.balance;
      WAL.save();
      boardSig = null;
      armed = null;
      paintWallet();
      update();
      return true;
    },
    setVolume,
    setSound,
    get busy() {
      return busy;
    },
    spin: () => void spin(),
    skip: skipNow,
  };
}
