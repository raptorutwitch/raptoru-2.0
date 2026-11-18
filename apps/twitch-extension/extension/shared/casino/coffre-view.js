// Ported unchanged from the validated casino prototype (prototypes/casino-v8 · coffre-view.js); docs/CASINO.md.
// Display only: every result comes from the Core.
// Le Coffre du Raptor — l'écran du bonus (V8). Il JOUE un scénario déjà tiré et déjà crédité (shared/coffre.js) : il ne
// tire rien et ne calcule aucun gain. Passer termine l'animation en cours ; Rapide la raccourcit ; Auto enchaîne les
// relances ; rien de tout cela ne touche au scénario. Les valeurs affichées viennent du scénario, case par case, et
// sont recontrôlées après chaque relance (audit.mismatch).
import * as Frame from './frame.js';
import { ArcadeAudio } from './audio.js';
import { ArcadeSymbols } from './symbols.js';

const Audio = ArcadeAudio;
const { fmt, compact, ICON } = Frame;

const JACKS = [
  ['mini', 'MINI', 20],
  ['majeur', 'MAJEUR', 100],
  ['mega', 'MÉGA', 500],
  ['grand', 'GRAND', 1000],
];
const RANK = { mini: 0, majeur: 1, mega: 2, grand: 3 };
const xs = (v) => `×${String(v).replace('.', ',')}`;
const tierOf = (v) => (v >= 10 ? 3 : v >= 3 ? 2 : v >= 1 ? 1 : 0);
const sumBoard = (b) => b.reduce((t, x) => t + (x ? x.v : 0), 0);
const startBoard = (S) => {
  const b = new Array(15).fill(null);
  S.start.forEach(({ cell, v }) => (b[cell] = { kind: 'value', v }));
  return b;
};
// Les symboles des cases sans pièce et ceux qui défilent : du DÉCOR, choisi par une graine stable (la partie), pour
// que le joueur, un spectateur et le Replay voient les mêmes. Ils ne décident de rien.
const FACES = ['cerise', 'citron', 'raisin', 'cloche', 'bar', 'diamant', 'sept'];
const TAPE = ['cerise', 'citron', 'bonus', 'raisin', 'cloche', 'citron', 'bar', 'cerise', 'diamant', 'raisin', 'sept', 'bonus'];
const hash = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** Les Jetons d'un montant en « × la mise » : arrondi vers le bas, comme le crédit. */
const jet = (v, bet) => Math.floor(v * bet);

/**
 * Joue un Coffre. c = { script, bet, credit, paid?, step } (paid : le montant payé si le gain a été plafonné ; step :
 * dernière relance déjà montrée, -1 au départ).
 * o = { replay, onStep(i), onReady() (the grid is on screen), getFast(), toggleFast(), host, seed (the round: the
 * decor), spectator (the player's name), follow(i) (spectator: resolves with { step } once the player played respin i,
 * or { end }; c.script then holds only the stages already revealed), instant (rejoin without the intro), onCredit() }.
 * Renvoie une promesse résolue à la fermeture, avec un
 * compte rendu : { shown (Jetons affichés à la fin), mismatch (écarts écran/scénario), ms, skips }.
 */
/**
 * The grid after each respin, rebuilt from the Core's script for display (the coins, and their values once the respin's
 * doublings are applied). Never a total: the totals are the script's.
 */
function withBoards(script) {
  if (script.steps.every((st) => st.board)) return { ...script, steps: script.steps.slice() };
  let b = startBoard(script);
  const steps = script.steps.map((st) => {
    b = boardAfter(b, st);
    return { ...st, board: b };
  });
  return { ...script, steps };
}
/** The grid after one respin (its coins, then its columns ×2 and its doubler), from the grid before it. */
function boardAfter(prev, st) {
  const b = prev.map((x) => (x ? { ...x } : null));
  for (const c of st.coins) b[c.cell] = { kind: c.kind, v: c.v };
  for (const col of st.cols) for (let k = col * 3; k < col * 3 + 3; k++) if (b[k].kind === 'value') b[k] = { kind: 'value', v: b[k].v * 2 };
  if (st.doubled) for (let k = 0; k < 15; k++) if (b[k] && b[k].kind === 'value') b[k] = { kind: 'value', v: b[k].v * 2 };
  return b;
}

function play(c, o = {}) {
  const S = withBoards(c.script);
  const bet = c.bet;
  const host = o.host || Frame.byId('body');
  const fast = () => !!(o.getFast && o.getFast());
  const T = (normal, rapide = 0) => (fast() ? rapide : normal);
  let auto = !!o.replay || !!o.follow;
  let anim = null; // l'animation en cours (Passer la termine)
  let go = null; // la relance attendue (bouton, Auto)
  let autoTimer = null;
  let phase = 'intro';
  const audit = { mismatch: 0, skips: 0, t0: performance.now() };

  // --- La scène -------------------------------------------------------------------------------------------------
  const el = document.createElement('div');
  el.className = `cof${o.replay ? ' is-replay' : ''}${o.follow ? ' is-spect' : ''}`;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Le Coffre du Raptor');
  const cells = Array.from({ length: 15 }, (_, i) => `<div class="cc" data-c="${i}" style="grid-column:${Math.floor(i / 3) + 1};grid-row:${(i % 3) + 1}"></div>`).join('');
  const reelsBg = [0, 1, 2, 3, 4].map((k) => `<i class="creel" data-reel="${k}" style="grid-column:${k + 1}"></i>`).join('');
  const cols = reelsBg + [0, 1, 2, 3, 4].map((k) => `<i class="ccol" data-col="${k}" style="grid-column:${k + 1}"><span>×2</span></i>`).join('');
  const tgl = (act, k, icon, label, title) => `<button type="button" class="tgl ${k}" data-cof="${act}" aria-pressed="false" title="${title}" aria-label="${label}"><span class="tgl__cap">${ICON[icon]}</span><span class="tgl__lbl"><i class="led"></i>${label}</span></button>`;
  const demoTag = o.spectator ? `<span class="cof__tag replay">Spectateur · ${Frame.esc(o.spectator)}</span>` : '';
  el.innerHTML = `
    <div class="cof__jack">${JACKS.map(([id, label, v]) => `<span class="jk j-${id}" data-j="${id}"><em>${label}</em><b>${compact(jet(v, bet))}</b></span>`).join('')}</div>
    <div class="cof__vault" data-cof="vault">
      <div class="cof__grid">${cols}${cells}</div>
      <div class="cof__fx"></div>
    </div>
    <div class="cof__meter">
      <span class="rs"><small>Relances</small><span class="pips"><i></i><i></i><i></i></span></span>
      <span class="filled"><small>Cases</small><b>0/15</b></span>
      <span class="tot"><small>Gain du Coffre</small><b>0</b><em></em></span>
    </div>
    <div class="cof__side">
      <div class="cof__info"><b>Le Coffre</b><small>${S.k} BONUS · mise ${compact(bet)}</small>${o.replay ? '<span class="cof__tag replay">Replay · déjà crédité</span>' : demoTag}</div>
      <div class="toggles">${tgl('fast', 'k-amber', 'bolt', 'Rapide', 'Rapide : animations courtes, même résultat')}${tgl('auto', 'k-blue', 'auto', 'Auto', 'Auto : enchaîne les relances. Toucher à nouveau pour l’arrêter tout de suite.')}${tgl('skip', 'k-lilac', 'skip', 'Passer', 'Passer : termine l’animation en cours (même résultat)')}</div>
      <div class="launchbox"><button type="button" class="spin" data-cof="go"></button></div>
    </div>`;
  host.append(el);
  const $ = (s) => el.querySelector(s);
  const cellEl = (i) => el.querySelector(`.cc[data-c="${i}"]`);
  const fx = $('.cof__fx');
  const goBtn = $('[data-cof="go"]');

  // --- Commandes : toujours là. Relancer · Passer · Auto / Stop Auto · Rapide -----------------------------------
  function paintControls() {
    const st = o.follow
      ? ['watch', 'eye', 'En direct', `Spectateur : ${o.spectator ?? 'le joueur'} relance lui-même`]
      : phase === 'end'
        ? ['done', 'close', o.replay ? 'Fin' : 'Retour', o.replay ? 'Quitter le replay' : 'Retour à la machine']
        : auto
          ? ['stop', 'stop', 'Stop', 'Arrêter Auto']
          : anim
            ? ['busy', 'skip', 'Passer', 'Passer (même résultat, tout de suite)']
            : phase === 'wait'
              ? ['go', 'play', 'Relancer', 'Relancer (la prochaine relance)']
              : ['busy', 'skip', 'Passer', 'Passer'];
    goBtn.dataset.state = st[0];
    goBtn.innerHTML = `<span class="spin__cap">${ICON[st[1]].replace('<svg', `<svg class="fill ${st[1]}"`)}<small>${st[2]}</small></span>`;
    goBtn.setAttribute('aria-label', st[3]);
    goBtn.title = st[3];
    $('[data-cof="fast"]').setAttribute('aria-pressed', String(fast()));
    $('[data-cof="auto"]').setAttribute('aria-pressed', String(auto));
    $('[data-cof="auto"] .tgl__lbl').lastChild.textContent = auto ? 'Stop' : 'Auto';
    $('[data-cof="skip"]').disabled = !anim;
    goBtn.disabled = !!o.follow;
    el.classList.toggle('is-auto', auto);
  }
  function skip() {
    if (!anim || anim.skipped) return;
    audit.skips++;
    anim.skip();
  }
  function setAuto(on) {
    auto = on;
    clearTimeout(autoTimer);
    if (auto && go && phase === 'wait') go(); // activée pendant l'attente : la relance part tout de suite
    paintControls();
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cof]');
    if (!b || b.disabled) return;
    const k = b.dataset.cof;
    if (o.follow) return; // a spectator never acts on the player's Coffre
    if (k === 'fast') {
      if (o.toggleFast) o.toggleFast();
      paintControls();
    }
    else if (k === 'auto') setAuto(!auto);
    else if (k === 'skip' || k === 'vault') skip();
    else if (k === 'go') {
      if (phase === 'end') return close();
      if (auto) return setAuto(false); // Stop : plus aucune relance ne part ; l'animation en cours se termine normalement
      if (anim) return skip();
      if (go && phase === 'wait') go();
    }
  });
  const onKey = (e) => {
    if (!el.isConnected) return;
    if (e.code === 'Space' && (e.target === document.body || (e.composedPath?.() ?? []).includes(el))) {
      e.preventDefault();
      e.stopPropagation();
      goBtn.click();
    } else if (e.key === 'Escape' && o.replay) {
      e.stopPropagation();
      close();
    }
  };
  globalThis.addEventListener('keydown', onKey, true);
  if (o.control) o.control.close = () => close();

  // --- Attentes interrompables (Passer) ---------------------------------------------------------------------------
  function begin() {
    let fire;
    anim = { skipped: false, gate: new Promise((ok) => (fire = ok)) };
    anim.skip = () => ((anim.skipped = true), fire());
    paintControls();
    return anim;
  }
  function end() {
    anim = null;
    paintControls();
  }
  const wait = (ms) => (ms <= 0 || !anim || anim.skipped ? Promise.resolve() : Promise.race([new Promise((ok) => setTimeout(ok, ms)), anim.gate]));
  const skipped = () => !anim || anim.skipped;
  function countTo(paint, from, to, ms) {
    return new Promise((resolve) => {
      if (ms <= 0 || to <= from || skipped()) return paint(to), resolve();
      const A = anim;
      const t0 = performance.now();
      const stepF = (t) => {
        if (A.skipped) return paint(to), resolve();
        const u = Math.max(0, Math.min(1, (t - t0) / ms));
        paint(Math.round(from + (to - from) * (1 - (1 - u) ** 3)));
        if (u < 1) requestAnimationFrame(stepF);
        else resolve();
      };
      requestAnimationFrame(stepF);
    });
  }

  // --- Peindre : une case, le compteur, le total, les jackpots ----------------------------------------------------
  const SYM = (id) => ArcadeSymbols.symbolHTML({ id, name: id });
  const seed = String(o.seed || `${S.k}:${S.total}:${S.steps.length}`);
  const faceAt = (step, cell) => FACES[hash(`${seed}:${step}:${cell}`) % FACES.length];
  // Une pièce verrouillée : le médaillon BONUS qui a gardé sa place, sa valeur en grand, les Jetons dessous.
  function coinHTML(b) {
    if (b.kind === 'value') return `<span class="coin t${tierOf(b.v)}"><i class="star"></i><b>${xs(b.v)}</b><small>${compact(jet(b.v, bet))}</small></span>`;
    if (b.kind === 'doubler') return '<span class="coin dbl"><i class="star"></i><b>×2</b><small>grille</small></span>';
    const j = JACKS.find((x) => x[0] === b.kind);
    return `<span class="coin jk-${b.kind}"><b>${j[1]}</b><small>${compact(jet(j[2], bet))}</small></span>`;
  }
  /** Une case sans pièce : un symbole de décor, éteint (il ne paie rien dans le Coffre). */
  function paintFace(i, step) {
    const e = cellEl(i);
    const id = faceAt(step, i);
    e.classList.remove('rolling', 'locked');
    delete e.dataset.k;
    delete e.dataset.v;
    if (e.dataset.face === id && e.firstChild && e.firstChild.classList && e.firstChild.classList.contains('cface')) return;
    e.dataset.face = id;
    e.innerHTML = `<span class="cface">${SYM(id)}</span>`;
  }
  /** Une case libre qui tourne : une bande de symboles qui défile (décor), différente à chaque case. */
  function roll(i, step) {
    const e = cellEl(i);
    const h = hash(`${seed}:t${step}:${i}`);
    let tape = '';
    for (let n = 0; n < 6; n++) tape += `<span class="ctile">${SYM(TAPE[(h + n * 5) % TAPE.length])}</span>`;
    e.classList.add('rolling');
    e.classList.remove('locked', 'stopped');
    delete e.dataset.k;
    delete e.dataset.face;
    e.innerHTML = `<span class="ctape" style="--d:${(0.26 + (h % 7) / 100).toFixed(2)}s">${tape}${tape}</span>`;
  }
  function paintCell(i, b, cls = '', step = -1) {
    const e = cellEl(i);
    e.classList.remove('rolling');
    if (!b) return paintFace(i, step);
    delete e.dataset.face;
    e.classList.add('locked');
    e.dataset.k = b.kind;
    e.dataset.v = b.v;
    e.innerHTML = coinHTML(b);
    if (cls) {
      const coin = e.firstChild;
      void coin.offsetWidth;
      coin.classList.add(...cls.split(' '));
    }
  }
  let shownBoard = new Array(15).fill(null);
  function paintBoard(b, step) {
    b.forEach((x, i) => {
      const cur = shownBoard[i];
      if (!x) return paintFace(i, step);
      if (cur && x.kind === cur.kind && x.v === cur.v && cellEl(i).dataset.k) return;
      paintCell(i, x, '', step);
    });
    shownBoard = b.slice();
  }
  function paintCounter(n, mode = '') {
    const pips = el.querySelectorAll('.pips i');
    pips.forEach((p, k) => p.classList.toggle('on', k < n));
    const rs = $('.rs');
    rs.classList.remove('reset', 'drop');
    if (mode) {
      void rs.offsetWidth;
      rs.classList.add(mode);
    }
    rs.classList.toggle('last', n === 1);
  }
  let shownTotal = 0;
  function paintTotal(v) {
    shownTotal = v;
    $('.tot b').textContent = fmt(v);
    $('.tot em').textContent = v ? xs(Math.round((v / bet) * 10) / 10) : '';
  }
  const paintFilled = (n) => ($('.filled b').textContent = `${n}/15`);
  function paintCols(list) {
    list.forEach((k) => el.querySelector(`.ccol[data-col="${k}"]`).classList.add('done'));
  }
  function wonJack(id) {
    el.querySelector(`.jk[data-j="${id}"]`).classList.add('won');
  }
  /** Une annonce au centre du coffre (jackpot, doubleur, grille pleine). */
  async function banner(html, cls, ms) {
    if (skipped()) return;
    const b = document.createElement('div');
    b.className = `cban ${cls}`;
    b.innerHTML = html;
    fx.append(b);
    await wait(ms);
    b.classList.add('out');
    await wait(T(260, 120));
    b.remove();
  }
  /** L'état exact après la relance i (ou le départ, i = -1) : utilisé par Passer et à la reprise. */
  function settleTo(i) {
    const st = i >= 0 ? S.steps[i] : null;
    fx.innerHTML = '';
    el.querySelectorAll('.ccol.antic').forEach((x) => x.classList.remove('antic'));
    paintBoard(st ? st.board : startBoard(S), i);
    paintCounter(st ? st.counter : 3);
    paintFilled(st ? st.filled : S.k);
    paintTotal(jet(st ? st.total : sumBoard(startBoard(S)), bet));
    for (let k = 0; k <= i; k++) {
      paintCols(S.steps[k].cols);
      for (const x of S.steps[k].coins) if (RANK[x.kind] !== undefined) wonJack(x.kind);
    }
  }
  /** Contrôle : l'écran montre exactement la grille du scénario. */
  function auditBoard(i) {
    const want = i >= 0 ? S.steps[i].board : startBoard(S);
    for (let k = 0; k < 15; k++) {
      const e = cellEl(k);
      const w = want[k];
      const ok = w ? e.dataset.k === w.kind && Number(e.dataset.v) === w.v : !e.dataset.k;
      if (!ok) audit.mismatch++;
    }
    if ($('.tot b').textContent !== fmt(jet(i >= 0 ? S.steps[i].total : sumBoard(startBoard(S)), bet))) audit.mismatch++;
  }

  async function reveal(k, b, step) {
    const e = cellEl(k);
    e.classList.remove('rolling');
    delete e.dataset.face;
    shownBoard[k] = b;
    if (!skipped() && T(1, 0)) {
      e.innerHTML = `<span class="cface cbonus">${SYM('bonus')}</span>`;
      if (Audio.scatter) Audio.scatter(1);
      await wait(T(260));
    }
    if (shownBoard[k] !== b) return; // (Passer a déjà tout peint)
    paintCell(k, b, b.kind === 'value' ? 'lock' : 'lock big', step);
    if (b.kind === 'value') Audio.coffreCoin(tierOf(b.v));
    else Audio.coffreJackpot(RANK[b.kind] ?? 0);
  }

  // --- Les phases -------------------------------------------------------------------------------------------------
  async function intro() {
    begin();
    el.classList.add('enter');
    paintCounter(0);
    paintTotal(0);
    paintFilled(0);
    for (let k = 0; k < 15; k++) paintFace(k, -1);
    await banner('<em>Le Coffre</em><b>du Raptor</b>', 'title', T(900, 250));
    // les BONUS deviennent les premières pièces, à leur place
    let total = 0;
    for (const { cell, v } of S.start) {
      if (skipped()) break;
      await reveal(cell, { kind: 'value', v }, -1);
      paintFilled(shownBoard.filter(Boolean).length);
      const before = total;
      total += jet(v, bet);
      await countTo(paintTotal, before, total, T(240));
      await wait(T(120));
    }
    for (let n = 1; n <= 3 && !skipped(); n++) {
      paintCounter(n);
      await wait(T(140));
    }
    settleTo(-1);
    el.classList.remove('enter');
    end();
  }

  async function respin(i) {
    const st = S.steps[i];
    const prev = i > 0 ? S.steps[i - 1] : null;
    const prevBoard = prev ? prev.board : startBoard(S);
    const prevTotal = jet(prev ? prev.total : sumBoard(prevBoard), bet);
    begin();
    // 1. les cases libres tournent comme des rouleaux ; les pièces verrouillées ne bougent pas
    const empties = prevBoard.map((b, k) => (b ? -1 : k)).filter((k) => k >= 0);
    empties.forEach((k) => roll(k, i));
    Audio.coffreSpin();
    await wait(T(480, 120));
    // 2. arrêts colonne par colonne ; le dernier rouleau qui tourne encore se fait attendre (plus encore quand la
    //    grille pleine approche) ; une nouvelle pièce : le BONUS tombe, puis se verrouille avec sa valeur
    const landed = new Map(st.coins.map((x) => [x.cell, x]));
    const board = prevBoard.slice();
    const spinning = [0, 1, 2, 3, 4].filter((col) => empties.some((k) => Math.floor(k / 3) === col));
    const lastCol = spinning[spinning.length - 1];
    for (const col of [0, 1, 2, 3, 4]) {
      if (skipped()) break;
      if (!spinning.includes(col)) continue;
      if (col === lastCol && spinning.length > 1) {
        const close = empties.length <= 3 || board.filter(Boolean).length >= 11;
        el.querySelector(`.ccol[data-col="${col}"]`).classList.add('antic');
        await wait(T(close ? 900 : 420, 0));
        el.querySelector(`.ccol[data-col="${col}"]`).classList.remove('antic');
      }
      if (skipped()) break;
      let any = false;
      if (Audio.reelStop) Audio.reelStop(col);
      for (let k = col * 3; k < col * 3 + 3; k++) {
        if (board[k]) continue;
        const x = landed.get(k);
        if (!x) {
          paintFace(k, i);
          cellEl(k).classList.add('stopped');
          continue;
        }
        board[k] = { kind: x.kind, v: x.v };
        any = true;
        reveal(k, board[k], i); // sans attendre : le rouleau suivant s'arrête pendant que la pièce se verrouille
      }
      if (any) paintFilled(board.filter(Boolean).length);
      await wait(T(any ? 240 : 160, 30));
    }
    if (!skipped()) await wait(T(320, 60)); // la dernière pièce finit de se verrouiller
    // 3. les jackpots tombés : annoncés un par un, et leur plaque s'allume
    for (const x of st.coins) {
      if (RANK[x.kind] === undefined || skipped()) continue;
      const j = JACKS.find((q) => q[0] === x.kind);
      wonJack(x.kind);
      const t0 = jet(sumBoard(board), bet) - jet(j[2], bet);
      countTo(paintTotal, Math.max(shownTotal, t0), jet(sumBoard(board), bet), T(700));
      await banner(`<em>${j[1]}</em><b>+${fmt(jet(j[2], bet))}</b>`, `jack j-${x.kind}`, T(1000 + RANK[x.kind] * 250, 350));
    }
    // 4. le compteur : une pièce = retour à 3 ; sinon une relance de moins
    if (!skipped()) {
      paintCounter(st.counter, st.coins.length ? 'reset' : 'drop');
      if (st.coins.length) Audio.coffreReset();
      else Audio.coffreDrop();
      if (!st.coins.length) await wait(T(260, 80));
    }
    // 5. une colonne complète double ses pièces
    for (const col of st.cols) {
      if (skipped()) break;
      paintCols([col]);
      Audio.coffreDouble();
      for (let k = col * 3; k < col * 3 + 3; k++)
        if (board[k].kind === 'value') {
          board[k] = { kind: 'value', v: board[k].v * 2 };
          paintCell(k, board[k], 'up');
          shownBoard[k] = board[k];
        }
      await countTo(paintTotal, shownTotal, jet(sumBoard(board), bet), T(450));
      await banner('<em>Colonne complète</em><b>pièces ×2</b>', 'col', T(650, 200));
    }
    // 6. le doubleur : toutes les pièces de la grille doublent
    if (st.doubled && !skipped()) {
      const d = st.coins.find((x) => x.kind === 'doubler');
      cellEl(d.cell).firstChild.classList.add('fire');
      Audio.coffreDouble();
      const wave = document.createElement('i');
      wave.className = 'cwave';
      const r = cellEl(d.cell).getBoundingClientRect();
      const g = $('.cof__vault').getBoundingClientRect();
      wave.style.left = `${r.left - g.left + r.width / 2}px`;
      wave.style.top = `${r.top - g.top + r.height / 2}px`;
      fx.append(wave);
      await wait(T(380, 100));
      board.forEach((b, k) => b && b.kind === 'value' && ((board[k] = { kind: 'value', v: b.v * 2 }), paintCell(k, board[k], 'up'), (shownBoard[k] = board[k])));
      await countTo(paintTotal, shownTotal, jet(sumBoard(board), bet), T(500));
      await banner('<em>Doubleur</em><b>toute la grille ×2</b>', 'dbl', T(800, 250));
    }
    // 7. le total de la relance
    if (!skipped()) await countTo(paintTotal, Math.max(prevTotal, shownTotal), jet(st.total, bet), T(st.coins.length ? 380 : 0));
    settleTo(i); // l'état exact du scénario (même si l'animation a été passée)
    auditBoard(i);
    end();
  }

  async function finale() {
    begin();
    let from = jet(S.steps.length ? S.steps[S.steps.length - 1].total : sumBoard(startBoard(S)), bet);
    if (S.full) {
      wonJack('grand');
      el.classList.add('is-full');
      Audio.coffreJackpot(3);
      const g = jet(1000, bet);
      countTo(paintTotal, from, from + g, T(1400));
      await banner(`<em>Grille pleine</em><b>GRAND +${fmt(g)}</b>`, 'jack j-grand', T(2000, 600));
    }
    paintTotal(c.credit);
    if ($('.tot b').textContent !== fmt(jet(S.total, bet))) audit.mismatch++;
    if (jet(S.total, bet) !== c.credit) audit.mismatch++;
    // la fin : le total, célébré selon son montant
    const x = S.total;
    const lvl = S.full ? 'grand' : x >= 100 ? 'huge' : x >= 30 ? 'big' : x >= 10 ? 'good' : 'small';
    const kicker = { grand: 'GRAND !', huge: 'Coffre énorme', big: 'Gros coffre', good: 'Beau coffre', small: 'Coffre terminé' }[lvl];
    const bits = [`${S.filled}/15 cases`, ...S.jackpots.map((j) => JACKS.find((q) => q[0] === j)[1]), S.cols ? `${S.cols} colonne${S.cols > 1 ? 's' : ''} ×2` : '', S.doubler ? 'doubleur' : ''].filter(Boolean);
    let rain = '';
    const n = { grand: 34, huge: 26, big: 14 }[lvl] || 0;
    for (let k = 0; k < n; k++) rain += `<i class="cn" style="left:${Math.round(Math.random() * 96)}%;--d:${(1.3 + Math.random() * 1.1).toFixed(2)}s;--w:${(Math.random() * 0.9).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg"></i>`;
    const f = document.createElement('div');
    f.className = `cfin ${lvl}`;
    f.innerHTML = `${rain}<span class="kicker">${kicker}</span><b>+0</b><small>${xs(Math.round(x * 10) / 10)} la mise</small><p>${bits.join(' · ')}</p>${c.paid < c.credit ? `<p class="fine">Plafonné : le tirage valait +${fmt(c.credit)} (gain maximum par partie).</p>` : ''}${o.replay ? '<p class="fine">Replay : ce gain a été crédité à l’époque.</p>' : o.spectator ? `<p class="fine">Gain de ${Frame.esc(o.spectator)}, déjà sur son solde.</p>` : '<p class="fine">Déjà sur ton solde.</p>'}`;
    $('.cof__vault').append(f);
    Audio.win(lvl === 'small' ? 1 : lvl === 'good' ? 2 : 3);
    const paid = c.paid ?? c.credit;
    await countTo((v) => (f.querySelector('b').textContent = `+${fmt(v)}`), 0, paid, T(lvl === 'small' ? 700 : 1500, 250));
    f.querySelector('b').textContent = `+${fmt(paid)}`;
    if (!o.replay && !o.follow && o.onCredit) o.onCredit(); // le solde affiché reçoit le gain maintenant (il est crédité depuis le tirage)
    end();
  }

  // --- La partie : rien n'avance seul en manuel ---------------------------------------------------------------------
  function waitGo() {
    phase = 'wait';
    paintControls();
    return new Promise((ok) => {
      go = () => ((go = null), clearTimeout(autoTimer), (phase = 'run'), ok());
      if (auto) autoTimer = setTimeout(() => auto && go && go(), T(480, 160));
    });
  }
  let closeFn;
  const closed = new Promise((ok) => (closeFn = ok));
  function close() {
    if (phase === 'closed') return;
    phase = 'closed';
    clearTimeout(autoTimer);
    if (anim) anim.skip();
    globalThis.removeEventListener('keydown', onKey, true);
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
    closeFn({ shown: c.credit, mismatch: audit.mismatch, skips: audit.skips, ms: Math.round(performance.now() - audit.t0) });
  }

  (async () => {
    paintControls();
    const from = Math.min(c.step, S.steps.length - 1); // (une fin déjà atteinte : on remontre la fin)
    if (from < 0 && !o.instant) await intro();
    else {
      settleTo(from);
      if (!o.follow) Frame.toast('Coffre repris là où il en était (déjà crédité).');
    }
    auditBoard(from);
    if (o.onReady) o.onReady();
    if (o.follow) {
      // Spectator: the player's respins arrive one by one, once the player's screen played them (the Core never sends
      // the next ones ahead); { step } plays it, { end } closes the scenario with its totals.
      for (let i = from + 1; ; i++) {
        phase = 'wait';
        paintControls();
        const item = await o.follow(i);
        if (phase === 'closed') return;
        if (!item || item.end) {
          if (item?.end) {
            const e = item.end;
            Object.assign(S, { total: e.total, full: e.full, filled: e.filled, jackpots: e.jackpots, cols: e.cols, doubler: e.doubler });
            c.credit = e.win;
            c.paid = e.paid ?? e.win;
          }
          break;
        }
        S.steps[i] = { ...item.step, board: boardAfter(i > 0 ? S.steps[i - 1].board : startBoard(S), item.step) };
        phase = 'run';
        await respin(i);
        if (phase === 'closed') return;
        if (o.onStep) o.onStep(i);
      }
    } else
      for (let i = from + 1; i < S.steps.length; i++) {
        await waitGo();
        if (phase === 'closed') return;
        phase = 'run';
        await respin(i);
        if (phase === 'closed') return;
        if (o.onStep) o.onStep(i);
      }
    if (phase === 'closed') return;
    phase = 'run';
    await finale();
    if (phase === 'closed') return;
    phase = 'end';
    paintControls();
    if (o.onStep) o.onStep(S.steps.length);
    // en Auto (ou en replay), la fin se referme seule après un moment ; Retour la ferme tout de suite
    if (auto) autoTimer = setTimeout(close, T(3200, 1400));
  })();
  return closed;
}

export const CoffreView = { play };
