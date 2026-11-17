// Casino — the roulette screen (docs/CASINO.md § 4), the validated V7/V9 prototype (prototypes/casino-v9-coffre,
// roulette.html + shared/table-game.js) wired to the Core. The mat, the chips and the trays live in this screen
// (display only); the bets are checked, drawn, paid and recorded by the Core (one intent = one key: a lost answer replays
// the same round, never a second payment); the wheel only plays the round it receives (its pocket, and the Core's seed
// for the ball). The history, the Replay and the share read the Core's rounds; a spectator watches another viewer's
// round. Each bet is a multiple of the Core's step (20 Jetons); the per-spin maximum and the win cap are the Core's.
import * as Frame from './frame.js';
import { ArcadeAudio as Audio } from './audio.js';
import { ArcadeBets as Bets } from './bets.js';
import { ArcadeChips as Chips } from './chips.js';
import { ArcadeTable as T } from './table.js';
import { ArcadeWheel } from './wheel.js';
import { newIdempotencyKey } from '../api.js';

const { ICON, fmt, compact, chipText, esc } = Frame;
const KEEP = 100;
const ALLIN = 'allin';
const COLOR = { red: 'Rouge', black: 'Noir', green: 'Zéro' };
const retryable = (e) => !e?.status || e.status >= 500 || e.code === 'timeout' || e.code === 'network_error';
const own = (id) => Object.prototype.hasOwnProperty.call(T.SPOTS, id);
const pill = (n) => `<span class="np c-${T.color(n)}">${n}</span>`;

/** A round of the Core as the wheel and the mat expect it. */
const asResult = (round) => {
  const o = round.outcome;
  return { pocket: o.pocket, number: o.number, color: T.color(o.number), seed: o.seed, bets: o.bets, wins: o.wins ?? [], stake: round.bet, gross: round.payout, net: round.payout - round.bet };
};
/** A history row (the Core's light shape) from a full round. */
const light = (round) => ({
  round_id: round.round_id,
  game: 'roulette',
  bet: round.bet,
  payout: round.payout,
  net: round.payout - round.bet,
  capped: round.capped,
  created_at: round.created_at,
  shared: !!round.shared,
  number: round.outcome.number,
  color: round.outcome.color,
});

// --- The full mat: the 0 on the left, 3 rows of 12, the 2:1 on the right, dozens then even chances below -----------
const at = (r, c, rs = 1, cs = 1) => `style="--r:${r};--c:${c};--rs:${rs};--cs:${cs}"`;
function matHTML() {
  let html = `<button type="button" class="spot zero" data-spot="n0" data-n="0" ${at(1, 1, 3)} aria-label="Numéro 0">0</button>`;
  for (let n = 1; n <= 36; n++) {
    const i = Math.floor((n - 1) / 3);
    const k = (n - 1) % 3;
    html += `<button type="button" class="spot ${T.color(n)}" data-spot="n${n}" data-n="${n}" ${at(3 - k, i + 2)} aria-label="Numéro ${n}">${n}</button>`;
  }
  ['c1', 'c2', 'c3'].forEach((c, k) => (html += `<button type="button" class="spot col${k === 2 ? ' tr' : ''}" data-spot="${c}" ${at(3 - k, 14)} aria-label="Colonne ${k + 1}">2:1</button>`));
  ['d1', 'd2', 'd3'].forEach((d, i) => (html += `<button type="button" class="spot side" data-spot="${d}" ${at(4, 2 + i * 4, 1, 4)} aria-label="Douzaine ${T.SPOTS[d].label}"><span class="lab">${T.SPOTS[d].label}</span></button>`));
  [
    ['low', '<span class="lab">1–18</span>'],
    ['even', '<span class="lab">Pair</span>'],
    ['red', '<i class="dia red"></i>'],
    ['black', '<i class="dia black"></i>'],
    ['odd', '<span class="lab">Impair</span>'],
    ['high', '<span class="lab">19–36</span>'],
  ].forEach(([id, l], i) => (html += `<button type="button" class="spot side" data-spot="${id}" ${at(5, 2 + i * 2, 1, 2)} aria-label="${T.SPOTS[id].label}">${l}</button>`));
  html += `<div class="felt bl" ${at(4, 1, 2)} aria-hidden="true"></div><div class="felt br" ${at(4, 14, 2)} aria-hidden="true"></div>`;
  return html;
}

const TEMPLATE = `
  <div class="rt" id="game">
    <div class="plateau">
      <button type="button" class="notch" data-act="pay" title="Paiements et règles" aria-label="Paiements et règles"><span>Paiements</span></button>
      <div class="mat" id="mat" data-play>${matHTML()}</div>
      <div class="closed" id="closed" role="status" hidden></div>
    </div>
    <div class="bar" data-play>
      <div class="left">
        <div class="histrow">
          <button type="button" class="board" id="board" data-act="hist" title="Derniers numéros — toucher pour l’historique complet" aria-label="Derniers numéros, ouvrir l’historique"></button>
          <button type="button" class="snd" data-act="sound" title="Son" aria-label="Son" aria-pressed="false"><i data-i="sound"></i></button>
        </div>
        <div class="chips" id="chips" role="radiogroup" aria-label="Valeur du jeton"></div>
        <div class="aitag" id="aitag" role="status" hidden></div>
      </div>
      <div class="tray" role="group" aria-label="Actions sur les jetons">
        <button type="button" class="act k-orange" data-act="undo" title="Annuler le dernier jeton posé" aria-label="Annuler le dernier jeton"><span class="act__cap"><i data-i="undo"></i></span><span class="act__lbl">Annuler</span></button>
        <button type="button" class="act k-red" data-act="clear" title="Effacer toutes les mises du tapis" aria-label="Effacer toutes les mises"><span class="act__cap"><i data-i="trash"></i></span><span class="act__lbl">Effacer</span></button>
        <button type="button" class="act k-blue" data-act="rebet" title="Reposer les jetons du tour précédent" aria-label="Reposer les jetons du tour précédent"><span class="act__cap"><i data-i="rebet"></i></span><span class="act__lbl">Reposer</span></button>
        <button type="button" class="act k-violet" data-act="double" title="Doubler toutes les mises" aria-label="Doubler toutes les mises"><span class="act__cap"><b>×2</b></span><span class="act__lbl">Doubler</span></button>
      </div>
      <div class="go">
        <button type="button" class="launch" id="spin"></button>
        <button type="button" class="fastsw" data-act="fast" aria-pressed="false" title="Rapide\u00a0: résultat immédiat, la roue ne tourne pas (s’applique au prochain lancer)" aria-label="Rapide"><i data-i="bolt"></i><span class="st">RAPIDE</span></button>
      </div>
    </div>
  </div>
  <div class="wover" id="stagew" hidden>
    <div class="wheel" id="wheel"><svg role="img" aria-label="Roulette"></svg><div class="wres" id="wres" hidden></div></div>
    <div class="wside">
      <div class="wkick" id="wkick"></div>
      <div class="banner" id="banner" aria-live="polite"></div>
      <button type="button" class="skip" id="skip"></button>
    </div>
  </div>
  <div class="spect" id="spect" hidden><span id="spectText"></span><button type="button" class="xbtn" data-act="endspect" aria-label="Quitter le replay"></button></div>
  <div class="drawer" id="drawer" hidden></div>
  <div class="toast" id="toast"></div>`;

/**
 * The roulette screen inside the casino's shadow root `D` (its `#body`). `ctx`: { client, casino (the Core's state),
 * watch (a round id: spectator mode), onLeave() }. Returns { busy(), destroy() }.
 */
export function mountRoulette(D, ctx) {
  const { client } = ctx;
  const body = D.getElementById('body');
  body.className = 'cz roulette-body';
  body.innerHTML = TEMPLATE;
  const $ = (q) => D.querySelector(q);
  body.querySelectorAll('i[data-i]').forEach((i) => (i.outerHTML = ICON[i.dataset.i]));
  $('[data-act="endspect"]').innerHTML = ICON.close;
  const mat = $('#mat');
  const stagew = $('#stagew');
  const wres = $('#wres');
  const banner = $('#banner');
  const skipBtn = $('#skip');
  const board = $('#board');
  const spinBtn = $('#spin');
  const chipsEl = $('#chips');
  const W = globalThis;
  const listeners = [];
  const on = (target, ev, fn, opt) => {
    target.addEventListener(ev, fn, opt);
    listeners.push([target, ev, fn, opt]);
  };
  const wheel = ArcadeWheel.create($('#wheel'), { audio: Audio });

  let casino = ctx.casino;
  let balance = casino.me?.balance ?? null; // the Core's; null: no shared identity (the Core refuses the spin)
  const limits = () => casino.limits;
  const STEP = () => limits().roulette_step ?? 20;
  const MAXT = () => limits().roulette_max_total;
  const bal = () => balance ?? Infinity;

  // The viewer's own settings and mat (this browser only), cleaned: only the mat's spots, only whole steps.
  const P = Frame.prefs('casino:roulette', { chip: null, custom: null, bets: {}, last: null, sound: false, fast: false });
  const s = P.get();
  const legal = (v) => Number.isSafeInteger(v) && v >= STEP() && v % STEP() === 0;
  const clean = (b) => Object.fromEntries(Object.entries(b && typeof b === 'object' ? b : {}).filter(([id, v]) => own(id) && legal(v)));
  s.bets = clean(s.bets);
  if (T.total(s.bets) > MAXT()) s.bets = {};
  s.last = s.last && Object.keys(clean(s.last)).length ? clean(s.last) : null;
  if (!legal(s.custom)) s.custom = null;
  if (s.chip !== ALLIN && !legal(s.chip)) s.chip = null;
  Audio.setEnabled(s.sound);
  const save = () => P.save();

  let busy = false;
  let spect = null; // a Replay (own round) or a spectator's round: { round, live }
  let pending = null; // { key, sig }: the intent's key, kept for the same bets until the Core decided
  let skipAsked = false; // Passer before the Core answered: the wheel goes straight to its end
  let hist = []; // the viewer's last rounds (Core, newest first)
  let histStats = null;
  let lastResult = null;
  let chipSet = [];
  let destroyed = false;
  let stageTimer = null;
  let closeTimer = null;
  let closing = null;
  let aiTimer = null;
  let press = null;
  const undoStack = [];
  const total = () => T.total(s.bets);

  const idle = () => body.dispatchEvent(new W.CustomEvent('jdm:host-idle', { bubbles: true, composed: true }));
  const refreshWallet = () => body.dispatchEvent(new W.CustomEvent('jdm:host-refresh', { bubbles: true, composed: true }));

  // --- The mat's local checks (the Core re-checks everything) ------------------------------------------------------
  const REFUSE = {
    empty: () => 'Pose au moins un jeton.',
    min: () => `Jeton minimum\u00a0: ${fmt(STEP())}.`,
    max: () => `Maximum ${fmt(MAXT())} par tour.`,
    balance: () => 'Solde insuffisant.',
    invalid: () => 'Montant invalide\u00a0: des chiffres, ou «\u00a02k\u00a0».',
    step: () => `Le jeton libre doit être un multiple de ${STEP()} (ex.\u00a040, 100, 1\u00a0500).`,
    spent: () => 'Tout ce que tu peux miser est déjà sur le tapis.',
    maxWin: () => `Ces mises pourraient rapporter plus que le gain maximum par partie (${fmt(limits().max_win)} Jetons).`,
  };
  const refuse = (k) => Frame.toast(REFUSE[k](), true);
  /** The most these bets could pay on one number: the Core refuses a set above the win cap before the draw. */
  function bestWin(bets) {
    let best = 0;
    for (let n = 0; n <= 36; n++) best = Math.max(best, T.settle(bets, n).gross);
    return best;
  }
  /** Why the mat cannot hold these bets (null: it can). */
  function whyNot(bets) {
    const t = T.total(bets);
    if (t > MAXT()) return 'max';
    if (t > bal()) return 'balance';
    if (bestWin(bets) > limits().max_win) return 'maxWin';
    return null;
  }

  // --- Chips: the six of the balance's tier + the custom chip + ALL-IN ----------------------------------------------
  function pickChips() {
    chipSet = Chips.tierFor(balance ?? 0).chips;
    if (s.chip !== s.custom && s.chip !== ALLIN && !chipSet.includes(s.chip)) s.chip = chipSet[1];
    if (!s.chip) s.chip = chipSet[1];
  }
  /** ALL-IN: what remains legally playable now (balance, per-spin maximum, chips already down), in whole steps. */
  const allIn = () => Chips.allIn({ balance: bal(), staked: total(), maxTotal: MAXT(), min: STEP(), step: STEP() });

  /** The mat showed the last result: back to a neutral mat at the first gesture. */
  function settled() {
    if (!lastResult) return;
    lastResult = null;
    clearResult();
  }
  function place(spot) {
    if (busy || spect) return;
    settled();
    const all = s.chip === ALLIN;
    const amount = all ? allIn().amount : s.chip;
    if (!amount) return refuse(total() ? 'spent' : 'balance');
    const next = { ...s.bets, [spot]: (s.bets[spot] || 0) + amount };
    const no = whyNot(next);
    if (no) return refuse(no);
    s.bets = next;
    undoStack.push([spot, amount]);
    save();
    if (all) Audio.allIn();
    else Audio.click();
    update();
    if (all) burst(spot);
  }
  function remove(spot) {
    if (busy || spect || !s.bets[spot]) return;
    settled();
    const v = s.chip === ALLIN ? 0 : s.bets[spot] - s.chip; // ALL-IN chosen: the whole stack goes
    if (v >= STEP()) s.bets[spot] = v;
    else delete s.bets[spot];
    save();
    update();
  }
  function undo() {
    if (busy || spect) return;
    settled();
    const last = undoStack.pop();
    if (!last) return clear();
    const [spot, amount] = last;
    const v = (s.bets[spot] || 0) - amount;
    if (v > 0) s.bets[spot] = v;
    else delete s.bets[spot];
    save();
    update();
  }
  function clear() {
    if (busy || spect) return;
    settled();
    s.bets = {};
    undoStack.length = 0;
    save();
    update();
  }
  function double() {
    if (busy || spect || !total()) return;
    settled();
    const next = Object.fromEntries(Object.entries(s.bets).map(([id, v]) => [id, v * 2]));
    const no = whyNot(next);
    if (no) return refuse(no);
    s.bets = next;
    undoStack.length = 0;
    save();
    update();
  }
  function rebet() {
    if (busy || spect || !s.last) return false;
    settled();
    const no = whyNot(s.last);
    if (no) {
      refuse(no);
      return false;
    }
    s.bets = { ...s.last };
    undoStack.length = 0;
    save();
    update();
    return true;
  }
  /** Rejouer: the last spin's chips back on the mat and launched, in one gesture. */
  function rebetAndSpin() {
    if (rebet() && total()) void spin();
  }
  const sameAsLast = () => !!s.last && JSON.stringify(s.bets) === JSON.stringify(s.last);
  function setChip(v) {
    if (busy || spect) return;
    s.chip = v;
    save();
    if (v === ALLIN) Audio.allIn();
    else Audio.click();
    update();
    if (v === ALLIN) allInChosen(allIn());
  }
  /** The custom chip: an allowed amount typed by the viewer, a whole multiple of the step. */
  function setCustom(text) {
    const v = Bets.parse(text);
    const err = v === null ? 'invalid' : Chips.customError(v, { min: STEP(), maxTotal: MAXT(), balance: bal(), step: STEP() });
    if (err) {
      refuse(err);
      return err;
    }
    s.custom = v;
    s.chip = v;
    save();
    Audio.click();
    update();
    return null;
  }
  function editCustom(anchor) {
    const cap = Math.floor(Math.min(MAXT(), bal()) / STEP()) * STEP();
    const range = cap >= STEP() ? `De ${fmt(STEP())} à ${fmt(cap)} Jetons, en multiples de ${STEP()} (plafond par tour et solde).` : 'Solde insuffisant pour un jeton.';
    const el = Frame.pop(
      anchor,
      `<div class="chipedit"><b>Jeton libre</b><form><input inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="ex.\u00a01\u00a0500 ou 2k" aria-label="Montant du jeton libre" value="${s.custom || ''}"><button type="submit" class="btn go">OK</button></form><p>${range}</p></div>`,
      { side: 'above', key: 'custom' },
    );
    if (!el) return;
    const input = el.querySelector('input');
    input.focus();
    input.select();
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!setCustom(input.value)) Frame.closePop();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') Frame.closePop();
    });
  }

  /** A short flash: replays the CSS animation `cls` on `el`. */
  const flash = (el, cls) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    W.setTimeout(() => el.classList.remove(cls), 750);
  };
  // ALL-IN chosen: a flash on the chip, and the amount really at stake (with the per-spin maximum when it limits).
  function allInChosen(a) {
    flash(chipsEl.querySelector('[data-allin]'), 'flash');
    flash(chipsEl, 'flash');
    if (!a.amount) return Frame.toast(total() ? 'ALL-IN\u00a0: tout ce que tu peux miser est déjà sur le tapis.' : 'Solde insuffisant pour un ALL-IN.', true);
    const tag = $('#aitag');
    tag.innerHTML = `ALL-IN <b>${fmt(a.amount)}</b><small>${a.capped ? `plafond ${compact(MAXT())} par tour` : total() ? 'le reste de ton solde' : 'tout ton solde'}</small>`;
    tag.hidden = false;
    flash(tag, 'in');
    W.clearTimeout(aiTimer);
    aiTimer = W.setTimeout(() => (tag.hidden = true), 2800);
  }
  // ALL-IN placed: a golden wave on the spot.
  function burst(spot) {
    const el = mat.querySelector(`[data-spot="${spot}"]`);
    if (!el) return;
    el.insertAdjacentHTML('beforeend', '<span class="burst" aria-hidden="true"></span>');
    W.setTimeout(() => el.querySelector('.burst')?.remove(), 900);
  }

  // --- Painting -----------------------------------------------------------------------------------------------------
  /** The stacks: a chip in the colour of the biggest value it holds, and its amount (only new or changed ones move). */
  function paintStacks() {
    mat.querySelectorAll('.stack').forEach((x) => {
      if (!s.bets[x.dataset.for]) x.remove();
    });
    for (const [id, v] of Object.entries(s.bets)) {
      const el = mat.querySelector(`[data-spot="${id}"]`);
      if (!el) continue;
      const st = el.querySelector('.stack');
      const txt = chipText(v);
      if (!st) {
        el.insertAdjacentHTML('beforeend', `<span class="stack" data-for="${id}" data-v="${Chips.tone(v)}">${txt}</span>`);
      } else if (st.textContent !== txt) {
        st.textContent = txt;
        st.dataset.v = Chips.tone(v);
        st.style.animation = 'none';
        void st.offsetWidth;
        st.style.animation = '';
      }
    }
  }
  // The last numbers (the newest ringed in gold).
  function paintBoard() {
    const nums = hist
      .slice(0, 9)
      .map((e) => e.number)
      .filter(Number.isInteger);
    board.innerHTML = `<span class="lbl">Derniers</span><span class="nums">${nums.length ? nums.map(pill).join('') : '<span class="none">aucun tirage</span>'}</span><span class="more" aria-hidden="true">${ICON.chev}</span>`;
  }
  let chipSig = '';
  function paintChips() {
    const sig = `${chipSet.join()}|${s.custom}`;
    if (sig !== chipSig) {
      chipSig = sig;
      const custom = s.custom
        ? `<button type="button" class="chip custom" data-custom role="radio" title="Jeton libre\u00a0: ${fmt(s.custom)} (toucher à nouveau pour le changer)" aria-label="Jeton libre, ${fmt(s.custom)}">${chipText(s.custom)}<span class="pen">${ICON.pencil}</span></button>`
        : `<button type="button" class="chip custom unset" data-custom role="radio" title="Jeton libre\u00a0: choisis ton montant" aria-label="Jeton libre\u00a0: choisir un montant">?<span class="pen">${ICON.pencil}</span></button>`;
      const allin = '<button type="button" class="chip allin" data-allin role="radio"><span>ALL</span><span>IN</span></button>';
      chipsEl.innerHTML = chipSet.map((v) => `<button type="button" class="chip" data-v="${v}" data-chip="${v}" role="radio" aria-label="Jeton ${fmt(v)}">${chipText(v)}</button>`).join('') + custom + allin;
    }
    const lock = busy || !!spect;
    chipsEl.querySelectorAll('[data-chip]').forEach((c) => {
      const v = Number(c.dataset.chip);
      const isOn = v === s.chip && s.chip !== s.custom;
      c.classList.toggle('on', isOn);
      c.setAttribute('aria-checked', String(isOn));
      c.disabled = lock || v > bal();
    });
    const cc = chipsEl.querySelector('[data-custom]');
    const con = !!s.custom && s.chip === s.custom;
    cc.classList.toggle('on', con);
    cc.setAttribute('aria-checked', String(con));
    cc.disabled = lock;
    // ALL-IN: its value follows the balance, the per-spin maximum and what is already down.
    const ai = chipsEl.querySelector('[data-allin]');
    const a = allIn();
    const aon = s.chip === ALLIN;
    ai.classList.toggle('on', aon);
    ai.classList.toggle('spent', aon && !a.amount);
    ai.setAttribute('aria-checked', String(aon));
    ai.disabled = lock || (!aon && !a.amount);
    const what = a.amount
      ? `${fmt(a.amount)} Jetons${a.capped ? ` (plafond de ${fmt(MAXT())} par tour)` : total() ? ' (le reste de ton solde)' : ' (tout ton solde)'}`
      : total()
        ? 'tout est déjà sur le tapis'
        : 'solde insuffisant';
    ai.title = `ALL-IN\u00a0: ${what}`;
    ai.setAttribute('aria-label', `Jeton ALL-IN\u00a0: ${what}`);
  }

  // --- Open or closed: the Casino can be closed (off live, closed in Studio) — the history stays readable -----------
  function closedReason() {
    const a = casino.availability;
    if (a.games.roulette) return null;
    return Frame.REFUSAL[a.reason] ?? Frame.REFUSAL.game_closed;
  }
  function paintClosed() {
    const why = spect || ctx.watch ? null : closedReason();
    const el = $('#closed');
    el.hidden = !why;
    if (why) el.innerHTML = `<b>${why}</b><small>L’historique et les Replays restent disponibles.</small>`;
  }

  function update() {
    if (destroyed) return;
    pickChips();
    paintStacks();
    const t = total();
    const last = s.last;
    const fast = s.fast;
    const closed = spect ? null : closedReason();
    const short = balance !== null && t > balance;
    spinBtn.className = `launch${busy ? ' is-busy' : ''}${fast && !busy ? ' fast' : ''}`;
    let label;
    if (busy) {
      spinBtn.innerHTML = `<span class="t">${ICON.skip.replace('<svg', '<svg class="fill"')}Passer</span>`;
      label = 'Passer';
    } else if (closed) {
      spinBtn.innerHTML = '<span class="t">Fermé</span>';
      label = closed;
    } else if (short) {
      // The chips left on the mat exceed the balance (after a lost ALL-IN, for instance): LANCER waits.
      spinBtn.innerHTML = '<span class="t">Solde insuffisant</span>';
      label = 'Solde insuffisant pour ces jetons';
    } else if (t) {
      spinBtn.innerHTML = `<span class="t">Lancer</span><small><i></i>${fmt(t)}</small>`;
      label = `Lancer, ${fmt(t)} misés${fast ? ', rapide' : ''}`;
    } else if (last) {
      spinBtn.innerHTML = `<span class="t">${ICON.rebet.replace('<svg', '<svg class="line"')}Rejouer</span><small><i></i>${fmt(T.total(last))}</small>`;
      label = 'Rejouer les mêmes jetons';
    } else {
      spinBtn.innerHTML = '<span class="t">Pose tes jetons</span>';
      label = 'Aucun jeton posé';
    }
    spinBtn.disabled = !busy && (!!closed || (t ? short : !last));
    spinBtn.setAttribute('aria-label', label);
    paintChips();
    const lock = busy || !!spect;
    for (const k of ['undo', 'clear', 'double']) $(`[data-act="${k}"]`).disabled = lock || !t;
    $('[data-act="rebet"]').disabled = lock || !last || sameAsLast();
    $('[data-act="fast"]').setAttribute('aria-pressed', String(fast));
    $('[data-act="sound"]').setAttribute('aria-pressed', String(s.sound));
    if (!busy) paintBoard();
    paintClosed();
  }

  // --- The draw: the wheel takes the whole game area; it fades at the stop (or on a touch), the mat shows the result
  function kick(mode) {
    const k = $('#wkick');
    if (mode === 'replay') k.innerHTML = 'Replay<b>consultation, solde inchangé</b>';
    else if (mode === 'live') k.innerHTML = `En direct<b>${esc(spect.round.viewer_name)} · mise ${fmt(spect.round.bet)}</b>`;
    else if (mode === 'result') k.innerHTML = `Solde<b>${fmt(balance ?? 0)}</b>`;
    else k.innerHTML = `Rien ne va plus<b>mise ${fmt(total())}</b>`;
  }
  function openStage() {
    W.clearTimeout(stageTimer);
    stagew.classList.remove('out');
    stagew.hidden = false;
    banner.className = 'banner';
    banner.innerHTML = '';
    skipBtn.innerHTML = `${ICON.skip}Passer`;
    kick(spect ? (spect.live ? 'live' : 'replay') : 'spin');
    const w = $('#wheel');
    w.style.animation = 'none';
    void w.offsetWidth;
    w.style.animation = '';
  }
  function closeStage() {
    W.clearTimeout(stageTimer);
    if (stagew.hidden) return Promise.resolve();
    if (closing) return closing;
    stagew.classList.add('out');
    closing = new Promise((ok) => {
      closeTimer = W.setTimeout(() => {
        stagew.hidden = true;
        stagew.classList.remove('out');
        wres.hidden = true;
        closing = null;
        ok();
        if (!busy && !spect) idle();
      }, 400);
    });
    return closing;
  }
  const clearResult = () => {
    mat.classList.remove('done');
    mat.querySelectorAll('.hit, .won, .lost').forEach((x) => x.classList.remove('hit', 'won', 'lost'));
    mat.querySelectorAll('.gtag').forEach((x) => x.remove());
  };
  function markMat(r) {
    mat.classList.add('done');
    mat.querySelector(`[data-n="${r.number}"]`)?.classList.add('hit');
    const won = new Map(r.wins.map((w) => [w.id, w.gross]));
    for (const id of Object.keys(r.bets)) {
      const el = mat.querySelector(`[data-spot="${id}"]`);
      if (!el) continue;
      el.classList.add(won.has(id) ? 'won' : 'lost');
      if (won.has(id)) el.insertAdjacentHTML('beforeend', `<span class="gtag">+${compact(won.get(id))}</span>`);
    }
  }
  /** The result beside the wheel; mode: 'own' (then on the mat too) | 'replay' | 'live'. */
  function showResult(r, mode) {
    wres.className = 'wres';
    wres.innerHTML = `<span class="n c-${r.color}">${r.number}</span>`;
    wres.hidden = false;
    banner.className = `banner show${r.gross ? '' : ' lose'}`;
    banner.innerHTML = `<span class="np c-${r.color}">${r.number}</span><span class="bl">${COLOR[r.color]}</span><b>${r.gross ? `+${fmt(r.gross)}` : 'Perdu'}</b>`;
    skipBtn.innerHTML = mode === 'replay' ? 'Fermer' : mode === 'live' ? 'Retour' : 'Revenir au tapis';
    kick(mode === 'own' ? 'result' : mode);
    if (mode !== 'own') return;
    markMat(r);
    paintBoard();
    stageTimer = W.setTimeout(() => void closeStage(), s.fast ? 1300 : 2200);
  }
  /** The wheel plays the Core's result (its seed: the same ball for the player, the spectators and the Replay). */
  async function play(r, { fast = false } = {}) {
    const done = wheel.spin(r, { fast });
    if (skipAsked && wheel.isRunning()) wheel.skip();
    skipAsked = false;
    await done;
  }
  /** Passer: the same result, now — during the whole draw, the Core's answer included. */
  function skip() {
    if (wheel.isRunning()) wheel.skip();
    else if (busy) skipAsked = true;
  }

  // --- A spin: the Core decides, the screen plays it --------------------------------------------------------------
  async function spin() {
    if (spect || destroyed) return;
    if (busy) return skip();
    const why = closedReason();
    if (why) return Frame.toast(why, true);
    const bets = { ...s.bets };
    if (!Object.keys(bets).length) return refuse('empty');
    const no = whyNot(bets);
    if (no) return refuse(no);
    busy = true;
    skipAsked = false;
    settled();
    update();
    Frame.closePop();
    $('#aitag').hidden = true;
    clearResult();
    wres.hidden = true;
    openStage();
    const sig = JSON.stringify(bets);
    if (pending?.sig !== sig) pending = { key: newIdempotencyKey(), sig };
    let res;
    try {
      res = await client.casinoSpin('roulette', { bets }, pending.key);
      pending = null;
    } catch (e) {
      if (!retryable(e)) pending = null;
      busy = false;
      Frame.toast(Frame.refusalText(e), true);
      update();
      void closeStage();
      void reload();
      return;
    }
    if (destroyed) return;
    balance = res.balance;
    const r = asResult(res.round);
    await play(r, { fast: s.fast });
    if (destroyed) return;
    s.last = { ...r.bets };
    save();
    hist.unshift(light(res.round));
    hist.length = Math.min(hist.length, KEEP);
    lastResult = r;
    if (r.gross > 0) Audio.win(r.net >= r.stake * 5 ? 3 : r.net > 0 ? 2 : 1);
    busy = false;
    update();
    showResult(r, 'own');
    refreshWallet();
  }

  // --- Replay (own rounds) and spectator (another viewer's round) — read-only ---------------------------------------
  // The badge: a Replay recalls its round (prototype); a live round names its player (its stake is beside the wheel,
  // its result only once the wheel stops).
  function paintSpect() {
    const { round, live } = spect;
    const gain = round.payout ? `+${fmt(round.payout)}` : 'perdu';
    $('#spectText').innerHTML = live
      ? `<b class="rtag">En direct</b>${esc(round.viewer_name)}`
      : `<b class="rtag">Replay</b>le ${round.outcome.number} · misé ${fmt(round.bet)} · <i>${gain}</i>`;
  }
  function enterSpect(round, live) {
    spect = { round, live };
    Frame.closePop();
    body.classList.add('is-spect');
    stagew.classList.add('replay');
    $('#spect').hidden = false;
    $('[data-act="endspect"]').setAttribute('aria-label', live ? 'Retour' : 'Quitter le replay');
    paintSpect();
    wres.hidden = true;
    openStage();
    update();
  }
  function endSpect() {
    if (!spect) return;
    if (wheel.isRunning()) wheel.skip();
    spect = null;
    body.classList.remove('is-spect');
    stagew.classList.remove('replay');
    $('#spect').hidden = true;
    clearResult();
    void closeStage();
    update();
    if (ctx.watch) ctx.onLeave?.(); // a spectator goes back to the catalogue
  }
  async function replay(id) {
    if (busy || spect) return;
    let round;
    try {
      round = (await client.casinoRound(id)).round;
    } catch (e) {
      return Frame.toast(Frame.refusalText(e), true);
    }
    if (destroyed || busy) return;
    busy = true;
    enterSpect(round, false);
    const r = asResult(round);
    await play(r);
    busy = false;
    if (destroyed) return;
    if (spect?.round === round) showResult(r, 'replay');
    update();
    idle();
  }
  /** Spectator: another viewer's round. Already well under way: its final state at once; fresh: the same flight. */
  async function watch(id) {
    let res;
    try {
      res = await client.casinoRound(id);
    } catch (e) {
      Frame.toast(Frame.refusalText(e), true);
      return ctx.onLeave?.();
    }
    if (destroyed) return;
    const round = res.round;
    const age = (Date.parse(res.server_now) || Date.now()) - Date.parse(round.created_at);
    busy = true;
    enterSpect(round, true);
    const r = asResult(round);
    await play(r, { fast: !(age <= 2000) });
    busy = false;
    if (destroyed) return;
    if (spect?.round === round) showResult(r, 'live');
    update();
    idle();
  }

  // --- History, share, payouts ------------------------------------------------------------------------------------
  async function loadHistory() {
    try {
      const h = await client.casinoHistory('roulette', 50);
      hist = h.rounds;
      histStats = h.stats;
    } catch {
      /* readable later */
    }
    if (!busy && !destroyed) paintBoard();
  }
  function historyHead() {
    const k = histStats ?? { rounds: hist.length, staked: hist.reduce((a, e) => a + e.bet, 0), won: hist.reduce((a, e) => a + e.payout, 0) };
    const net = k.won - k.staked;
    return `<div class="hsum"><span><small>Tours</small><b>${fmt(k.rounds)}</b></span><span><small>Misé</small><b>${fmt(k.staked)}</b></span><span><small>Bilan</small><b class="${net >= 0 ? 'g' : 'l'}">${net > 0 ? '+' : net < 0 ? '−' : ''}${fmt(Math.abs(net))}</b></span></div>`;
  }
  function historyHTML() {
    const rows = hist.filter((e) => Number.isInteger(e.number));
    if (!rows.length) return '<p class="hempty">Pas encore de tirage.</p>';
    return `<ul class="hlist">${rows
      .map((e) => {
        const net = e.payout - e.bet;
        return `<li class="hrow${e.payout ? ' win' : ''}${net >= e.bet * 5 ? ' big' : ''}"><span class="hic">${pill(e.number)}</span><span class="hmain"><b>${e.payout ? `+${fmt(e.payout)}` : `−${fmt(e.bet)}`}</b><small>${COLOR[T.color(e.number)]} · misé ${fmt(e.bet)} · ${Frame.ago(Date.parse(e.created_at))}</small></span><span class="hacts"><button type="button" data-replay="${esc(e.round_id)}" title="Revoir ce tirage" aria-label="Revoir ce tirage">${ICON.replay}</button><button type="button" data-share="${esc(e.round_id)}" title="Partager dans le chat" aria-label="Partager dans le chat"${e.shared ? ' disabled' : ''}>${ICON.share}</button></span></li>`;
      })
      .join('')}</ul>`;
  }
  async function share(id) {
    const ok = await Frame.card(
      '<h2>Partager dans le chat</h2><div class="chatline"><span class="chatline__who">LeCroupier_</span><span class="chatline__msg">annoncera ce tirage, tel qu’il a été joué (le Core relit la vraie partie).</span></div><p class="fine">Un partage par tirage, et pas plus d’un toutes les quelques minutes.</p>',
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
      Frame.toast(out.already ? 'Déjà partagé.' : `LeCroupier_\u00a0: ${esc(out.text)}`, false, 4200);
    } catch (e) {
      const wait = e?.details?.retry_in_s;
      Frame.toast(`${Frame.refusalText(e)}${wait ? ` (${wait}\u00a0s)` : ''}`, true, 3200);
    }
  }
  function openHistory() {
    const d = Frame.drawer({
      side: 'right',
      width: 272,
      title: 'Historique',
      head: historyHead,
      render: historyHTML,
      foot: 'Tes tirages, gardés par le Core. Revoir ne change jamais ton solde.',
      onClick(e, dr) {
        const r = e.target.closest('[data-replay]');
        if (r) {
          dr.close();
          return void replay(r.dataset.replay);
        }
        const sh = e.target.closest('[data-share]');
        if (sh) void share(sh.dataset.share).then(() => Frame.drawerOpen() && dr.repaint());
      },
    });
    void loadHistory().then(() => Frame.drawerOpen() && d.repaint());
  }
  const payHTML = () =>
    `<b class="pop__t">Paiements <small>mise comprise</small></b><dl class="pays"><dt>Numéro</dt><dd>×36</dd><dt>Colonne <i>2:1</i></dt><dd>×3</dd><dt>Douzaine</dt><dd>×3</dd><dt>Chances simples<small>rouge, noir, pair, impair, 1–18, 19–36</small></dt><dd>×2</dd></dl><p class="pop__n"><span class="np c-green">0</span> fait perdre tout, sauf les jetons posés sur le 0.</p><p class="pop__n">Jusqu’à ${fmt(MAXT())} par tour, chaque mise en multiples de ${STEP()}\u202f; gain maximum par partie\u00a0: ${fmt(limits().max_win)}. Clic droit ou appui long sur une case\u00a0: retirer un jeton.</p>`;

  // --- Commands -----------------------------------------------------------------------------------------------------
  // The mat: a click places, a right click or a long press (450 ms) removes; a hover (or a press) shows what it covers.
  const spotOf = (e) => e.target.closest('[data-spot]');
  function hover(spot) {
    mat.querySelectorAll('.cov').forEach((x) => x.classList.remove('cov'));
    if (!spot || busy) return;
    const sp = T.SPOTS[spot];
    if (sp.number !== undefined) return;
    mat.querySelectorAll('[data-n]').forEach((c) => {
      if (sp.covers(Number(c.dataset.n))) c.classList.add('cov');
    });
  }
  const endPress = () => press && W.clearTimeout(press.t);
  on(mat, 'contextmenu', (e) => {
    const b = spotOf(e);
    if (!b) return;
    e.preventDefault();
    remove(b.dataset.spot);
  });
  on(mat, 'pointerdown', (e) => {
    const b = spotOf(e);
    if (!b || e.button !== 0) return;
    const p = { long: false, t: null };
    p.t = W.setTimeout(() => {
      p.long = true;
      remove(b.dataset.spot);
    }, 450);
    press = p;
  });
  on(mat, 'pointerup', endPress);
  on(mat, 'pointerleave', endPress);
  on(mat, 'click', (e) => {
    const b = spotOf(e);
    if (!b) return;
    const long = press?.long;
    press = null;
    if (!long) place(b.dataset.spot);
  });
  on(mat, 'pointerover', (e) => hover(spotOf(e)?.dataset.spot ?? null));
  on(mat, 'pointerleave', () => hover(null));

  on(body, 'click', (e) => {
    const c = e.target.closest('[data-chip]');
    if (c) return void (!c.disabled && setChip(Number(c.dataset.chip)));
    const ai = e.target.closest('[data-allin]');
    if (ai) return void (!ai.disabled && setChip(ALLIN));
    const cu = e.target.closest('[data-custom]');
    if (cu) {
      if (cu.disabled) return;
      if (s.custom && s.chip !== s.custom && !e.target.closest('.pen')) return setChip(s.custom);
      return editCustom(cu);
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const k = b.dataset.act;
    if (k === 'pay') Frame.pop(b, payHTML(), { side: 'right' });
    else if (k === 'hist') openHistory();
    else if (k === 'sound') {
      s.sound = !s.sound;
      Audio.setEnabled(s.sound);
      save();
      update();
      Audio.click();
    } else if (k === 'fast') {
      // the bolt lights up, « RAPIDE » shows, LANCER takes a bolt: no message
      s.fast = !s.fast;
      save();
      update();
    } else if (k === 'undo') undo();
    else if (k === 'clear') clear();
    else if (k === 'double') double();
    else if (k === 'rebet') rebet();
    else if (k === 'endspect') endSpect();
  });
  on(spinBtn, 'click', async () => {
    if (spect) return busy ? skip() : endSpect();
    if (busy) return skip();
    await closeStage();
    if (!total() && s.last) return rebetAndSpin();
    void spin();
  });
  on(stagew, 'click', (e) => {
    if (busy) return skip(); // Passer
    if (spect) {
      if (e.target.closest('#skip')) endSpect(); // Fermer (Replay) · Retour (spectator)
      return;
    }
    void closeStage();
  });
  on(W, 'keydown', (e) => {
    if (e.key === 'Escape' && spect && !Frame.drawerOpen() && !D.querySelector('.card')) return endSpect();
    if (e.code !== 'Space' || e.target !== D.ownerDocument.body) return;
    e.preventDefault();
    if (spect) {
      if (busy) skip();
      return;
    }
    spinBtn.click();
  });

  /** The Core's state again (availability, limits, balance): after a refusal. */
  async function reload() {
    try {
      casino = await client.casinoState();
      balance = casino.me?.balance ?? balance;
    } catch {
      /* the last one */
    }
    update();
  }

  async function start() {
    if (ctx.watch) return watch(ctx.watch);
    await loadHistory();
  }
  if (ctx.watch) body.classList.add('is-spect'); // no betting control shows before the watched round arrives
  update();
  W.setTimeout(() => void start());

  return {
    busy: () => busy || (!stagew.hidden && !spect),
    destroy() {
      destroyed = true;
      for (const t of [stageTimer, closeTimer, aiTimer, press?.t]) W.clearTimeout(t);
      if (wheel.isRunning()) wheel.skip();
      Frame.closePop();
      for (const [t, ev, fn, opt] of listeners) t.removeEventListener(ev, fn, opt);
    },
  };
}
