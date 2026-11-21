// Ported unchanged from the validated casino prototype (prototypes/casino-v8 · reels.js); docs/CASINO.md.
// Display only: every result comes from the Core.
// Animation des rouleaux : elle REÇOIT un tour déjà décidé (engine/slots.js) et le montre, sans jamais le changer.
// Chaque rouleau fait défiler la vraie bande (les symboles qui précèdent l'arrêt tiré), accélère, file avec un flou,
// freine, dépasse un peu et revient (rebond amorti). Arrêts successifs 1 → 5 ; « rapide » : presque simultanés.
// Deux BONUS déjà tombés : les rouleaux suivants ralentissent (suspense), le résultat restant celui tiré.
import { esc } from './frame.js';

const PROFILES = {
  normal: { accel: 260, firstStop: 1050, gap: 290, decel: 420, settle: 320, over: 0.34, windup: 0.16, vmin: 0.021, anticipation: 850 },
  // Rapide : moins d'une seconde, mais on voit encore défiler et rebondir chaque rouleau.
  fast: { accel: 110, firstStop: 470, gap: 70, decel: 220, settle: 240, over: 0.26, windup: 0.08, vmin: 0.024, anticipation: 0 },
};
// Les couleurs des 10 lignes : seulement pour les miniatures de la table des gains (plus aucun tracé sur les rouleaux).
const LINE_COLORS = ['#f2c65f', '#7cc4ff', '#ff5c7a', '#5ee6a0', '#ffa45c', '#c39bff', '#ff8fb1', '#62e3d3', '#ffe08a', '#9fb6ff'];

function create(rootEl, cfg, { audio, symbolHTML }) {
  const reelsEl = rootEl.querySelector('.reels');
  const reels = [...reelsEl.querySelectorAll('.reel')];
  const tapes = reels.map((r) => r.querySelector('.tape'));
  let cur = cfg.strips.map(() => 0);
  let running = null;

  // La fenêtre montre 3 cases + `peek` case au-dessus et au-dessous (aperçu des voisins, assombri).
  // Relu à chaque mise en page : les formats de l'extension changent la part de bande visible (container queries).
  const readPeek = () => parseFloat(getComputedStyle(reelsEl).getPropertyValue('--peek')) || 0;
  let PEEK = readPeek();
  const cellH = () => reels[0].clientHeight / (3 + 2 * PEEK);
  function cellsHTML(r, from, count) {
    const strip = cfg.strips[r];
    const L = strip.length;
    let html = '';
    for (let k = 0; k < count; k++) {
      const id = strip[(((from + k) % L) + L) % L];
      html += `<div class="cell" data-s="${id}">${symbolHTML(cfg.byId[id])}</div>`;
    }
    return html;
  }
  function place(tape, offsetCells) {
    tape.style.transform = `translate3d(0, ${(-(offsetCells - PEEK) * cellH()).toFixed(2)}px, 0)`;
  }
  /** Le repos : la cellule au-dessus, les 3 visibles, la cellule au-dessous. */
  function renderStatic(stops) {
    cur = stops.slice();
    tapes.forEach((t, r) => {
      t.innerHTML = cellsHTML(r, stops[r] - 1, 5);
      t.classList.remove('blur');
      place(t, 1);
    });
  }
  function relayout() {
    if (running) return;
    PEEK = readPeek();
    tapes.forEach((t) => place(t, 1));
    if (shownExplore) explore(...shownExplore);
    else if (shownFocus) focus(shownFocus); // repositionne la pastille
  }

  function spin(result, opts = {}) {
    clearWins();
    PEEK = readPeek();
    const P = PROFILES[opts.fast || opts.reduced ? 'fast' : 'normal'];
    const perReel = result.grid.map((col) => col.filter((id) => id === cfg.scatterId).length);
    const stopAt = [];
    const antic = [];
    let extra = 0;
    let seen = 0;
    for (let r = 0; r < cfg.reels; r++) {
      if (!opts.fast && !opts.reduced && seen >= 2) {
        extra += P.anticipation;
        antic[r] = true;
      }
      stopAt[r] = P.firstStop + r * P.gap + extra;
      seen += perReel[r];
    }
    const plan = tapes.map((tape, r) => {
      const L = cfg.strips[r].length;
      const effective = stopAt[r] - P.accel / 2 - P.decel / 2;
      let dist = (((cur[r] - result.stops[r]) % L) + L) % L;
      while (dist + P.over < P.vmin * effective) dist += L;
      tape.innerHTML = cellsHTML(r, result.stops[r] - 1, dist + 5);
      place(tape, dist + 1);
      return { r, dist, v: (dist + P.over) / effective, stopAt: stopAt[r], decelStart: stopAt[r] - P.decel, stopped: false, settled: false, blur: false };
    });
    const pos = (pl, t) => {
      if (pl.snapAt !== undefined) {
        const u = Math.min(1, (t - pl.snapAt) / 200);
        return pl.dist + P.over * 0.7 * Math.cos(1.5 * Math.PI * u) * (1 - u) * (1 - u);
      }
      if (t < P.accel) return (pl.v * t * t) / (2 * P.accel) - P.windup * Math.sin((Math.PI * t) / P.accel);
      if (t < pl.decelStart) return (pl.v * P.accel) / 2 + pl.v * (t - P.accel);
      const pd = (pl.v * P.accel) / 2 + pl.v * (pl.decelStart - P.accel);
      if (t < pl.stopAt) {
        const u = (t - pl.decelStart) / P.decel;
        return pd + (pl.dist + P.over - pd) * (1 - (1 - u) * (1 - u));
      }
      const u = Math.min(1, (t - pl.stopAt) / P.settle);
      return pl.dist + P.over * Math.cos(1.5 * Math.PI * u) * (1 - u) * (1 - u);
    };
    return new Promise((resolve) => {
      // `elapsed` (ms): a spectator joins the player's timeline where it is (the same reels, the same stops, at the same time).
      const elapsed = Math.max(0, opts.elapsed ?? 0);
      const t0 = performance.now() - elapsed;
      let skipped = false;
      let anticSound = false;
      running = {
        skip() {
          if (skipped) return;
          skipped = true;
          const t = performance.now() - t0;
          let any = false;
          plan.forEach((pl) => {
            if (pl.stopped) return;
            pl.snapAt = t;
            pl.stopAt = t;
            any = true;
          });
          if (any) audio.reelStop(2);
        },
      };
      let shownAt = 0;
      const frame = (ts) => {
        if (!shownAt) reelsEl.dataset.startAt = String((shownAt = Date.now())); // the first frame on screen (Lab timing checks)
        const t = Math.max(0, ts - t0); // un premier frame peut dater d'avant t0
        let all = true;
        for (const pl of plan) {
          const tape = tapes[pl.r];
          const p = pos(pl, t);
          place(tape, pl.dist + 1 - p);
          const fastPhase = pl.snapAt === undefined && t > P.accel * 0.55 && t < pl.decelStart + P.decel * 0.35;
          if (fastPhase !== pl.blur) {
            pl.blur = fastPhase;
            tape.classList.toggle('blur', fastPhase);
          }
          if (!pl.stopped && t >= pl.stopAt) {
            pl.stopped = true;
            reels[pl.r].classList.remove('anticipate');
            if (!skipped && pl.stopAt >= elapsed) audio.reelStop(pl.r);
            if (opts.onReelStop) opts.onReelStop(pl.r, skipped);
            const next = pl.r + 1;
            if (antic[next] && !skipped) {
              reels[next].classList.add('anticipate');
              if (!anticSound) audio.anticipation();
              anticSound = true;
            }
          }
          const settleEnd = pl.stopAt + (pl.snapAt !== undefined ? 200 : P.settle);
          if (t >= settleEnd) pl.settled = true;
          if (!pl.settled) all = false;
        }
        if (all) {
          running = null;
          reels.forEach((r) => r.classList.remove('anticipate'));
          renderStatic(result.stops);
          reelsEl.dataset.landAt = String(Date.now()); // every reel at rest on screen (read by the Lab's timing checks)
          resolve({ skipped });
        } else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  const skip = () => running && running.skip();
  const isRunning = () => !!running;
  const cellEl = (reel, row) => tapes[reel].children[row + 1];

  function center(reel, row) {
    const box = reelsEl.getBoundingClientRect();
    const rb = reels[reel].getBoundingClientRect();
    return [rb.left - box.left + rb.width / 2, rb.top - box.top + (PEEK + row + 0.5) * cellH()];
  }
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR').replace(/[\s  ]/g, ' ');
  /** Le gain d'une combinaison, en petite pastille sous son dernier symbole ; gardée dans le cadre. */
  function tag(reel, row, text) {
    reelsEl.querySelectorAll('.ltag').forEach((t) => t.remove());
    const [x, y] = center(reel, row);
    const h = cellH();
    const t = document.createElement('span');
    t.className = 'ltag';
    t.textContent = text;
    reelsEl.append(t);
    const box = reelsEl.getBoundingClientRect();
    const w = t.offsetWidth; // (sa largeur de mise en page : l'animation d'entrée la rétrécit au départ)
    t.style.left = `${Math.max(w / 2 + 2, Math.min(box.width - w / 2 - 2, x))}px`;
    t.style.top = `${Math.min(box.height - 10, y + Math.min(h * 0.42, reels[0].clientWidth * 0.5))}px`;
  }
  function mark(cells, cls) {
    cells.forEach(([r, row]) => cellEl(r, row) && cellEl(r, row).classList.add(cls));
  }
  function unmark(cls) {
    reelsEl.querySelectorAll(`.cell.${cls}`).forEach((c) => c.classList.remove(cls));
  }

  /**
   * V7 : aucune ligne dessinée. Les symboles gagnants s'éclairent, les autres s'assombrissent à peine. Renvoie les
   * combinaisons dans l'ordre du décompte (de la plus petite à la plus grosse, le BONUS en dernier) ; leur somme est
   * exactement le gain du tour (engine/slots.js : lignes + dispersion). Elles ne font qu'être MONTRÉES.
   */
  let shownFocus = null;
  let shownExplore = null;
  let lastSteps = null; // les combinaisons du tour sur les rouleaux (null : aucun tour marqué, ou des rouleaux relancés)
  function markWins(result) {
    clearWins();
    const ev = result.eval;
    const steps = ev.lines
      .map((w) => ({ kind: 'line', cells: w.cells, win: w.win, line: w.line, symbol: w.symbol, count: w.count, wilds: w.wilds ?? [] }))
      .sort((a, b) => a.win - b.win || a.line - b.line);
    // V8 : les BONUS ne paient plus directement (ils ouvrent le Coffre) : pas d'étape « BONUS +0 », mais ils s'éclairent
    if (ev.scatter.count >= 3 && ev.scatter.win > 0) steps.push({ kind: 'scatter', cells: ev.scatter.cells, win: ev.scatter.win });
    lastSteps = steps;
    if (!steps.length && ev.scatter.count < 3) return { steps, wildMax: 0 };
    reelsEl.classList.add('has-win');
    ev.lines.forEach((w) => mark(w.cells, 'win'));
    if (ev.scatter.count >= 3) mark(ev.scatter.cells, 'scatter-win');
    // Chaque WILD qui complète une combinaison : anneau ; dans plusieurs : il bondit et dit combien.
    const use = new Map();
    ev.lines.forEach((w) => (w.wilds || []).forEach(([r, row]) => use.set(`${r}:${row}`, (use.get(`${r}:${row}`) || 0) + 1)));
    let wildMax = 0;
    use.forEach((n, key) => {
      const [r, row] = key.split(':').map(Number);
      const el = cellEl(r, row);
      if (!el) return;
      el.classList.add('wild-hit');
      if (n >= 2) {
        el.classList.add('wild-multi');
        el.insertAdjacentHTML('beforeend', `<span class="wildtag">×${n}</span>`);
      }
      wildMax = Math.max(wildMax, n);
    });
    return { steps, wildMax };
  }
  /** Une combinaison au premier plan (pulsation, liseré vif, son gain) ; les autres gagnants restent à demi éclairés. */
  function focus(step, { tag: withTag = true } = {}) {
    unmark('focus');
    reelsEl.classList.add('seq');
    shownFocus = withTag ? step : null; // (relu au redimensionnement pour replacer la pastille)
    // relancer la pulsation même si un symbole était déjà au premier plan (WILD partagé)
    step.cells.forEach(([r, row]) => {
      const el = cellEl(r, row);
      if (!el) return;
      void el.offsetWidth;
      el.classList.add('focus');
    });
    reelsEl.querySelectorAll('.ltag').forEach((t) => t.remove());
    if (!withTag) return; // une seule combinaison : la plaque dit déjà son gain
    const [reel, row] = step.cells[step.cells.length - 1];
    tag(step.kind === 'scatter' ? 2 : reel, step.kind === 'scatter' ? 1 : row, `${step.kind === 'scatter' ? 'BONUS ' : ''}+${fmt(step.win)}`);
  }
  /** Fin du décompte : tous les symboles gagnants éclairés ensemble, sans pastille. */
  function settle() {
    unmark('focus');
    shownFocus = null;
    reelsEl.classList.remove('seq');
    reelsEl.querySelectorAll('.ltag').forEach((t) => t.remove());
  }
  /**
   * Explorer une ligne (récapitulatif de la plaque, table des gains) : ses 5 cases tracées (`path`), ses symboles
   * comptés au premier plan (`counted`, s'il y en a), `text` en pastille. `explore(null)` : retour à l'état du tour.
   */
  function explore(path, counted = null, text = '') {
    settle();
    unmark('path');
    shownExplore = path || counted?.length ? [path, counted, text] : null;
    reelsEl.classList.toggle('explore', !!shownExplore);
    if (!shownExplore) return;
    if (path) mark(path, 'path');
    if (counted?.length) focus({ cells: counted }, { tag: false });
    const [reel, row] = (counted?.length ? counted : path).at(-1);
    if (text) tag(reel, row, text);
  }
  /** Tout d'un coup (revoir, Rapide) : marquer et montrer l'état final. */
  function showWins(result) {
    const m = markWins(result);
    settle();
    return m;
  }
  function clearWins() {
    shownFocus = null;
    shownExplore = null;
    lastSteps = null;
    reelsEl.classList.remove('has-win', 'seq', 'explore');
    ['win', 'focus', 'scatter-win', 'landed', 'wild-hit', 'wild-multi', 'path'].forEach(unmark);
    reelsEl.querySelectorAll('.wildtag, .ltag').forEach((t) => t.remove());
  }
  function markLanded(reel) {
    for (let row = 0; row < cfg.rows; row++) {
      const el = cellEl(reel, row);
      if (el && el.dataset.s === cfg.scatterId) el.classList.add('landed');
    }
  }

  const wins = () => lastSteps;
  const exploring = () => !!shownExplore;
  return { renderStatic, relayout, spin, skip, isRunning, markWins, focus, settle, explore, exploring, wins, showWins, clearWins, markLanded };
}

/** La miniature d'une ligne (5 rouleaux × 3 rangées) : table des gains et récapitulatif ; sa couleur vient de `--c`. */
const lineSVG = (rows) => `<svg viewBox="0 0 30 15" aria-hidden="true"><rect width="30" height="15" rx="2.5"/><polyline points="${rows.map((row, r) => `${r * 6 + 3},${row * 5 + 2.5}`).join(' ')}"/></svg>`;
const lineColor = (i) => LINE_COLORS[i % LINE_COLORS.length];
const fmtN = (n) => Math.round(n).toLocaleString('fr-FR').replace(/[\s  ]/g, ' ');
/** Table des gains : une des 10 lignes (miniature + nom), un bouton qui la montre sur les rouleaux (`explorer.probe`). */
const plineHTML = (l, i) => {
  const name = esc(l.name ?? `Ligne ${i + 1}`);
  return `<button type="button" class="pline" data-line="${i}" style="--c:${lineColor(i)}" title="Voir la ligne « ${name} » sur les rouleaux" aria-label="Ligne ${name} : la voir sur les rouleaux">${lineSVG(l.rows)}<small>${name}</small></button>`;
};
// Exact au Core (slot.ts / book.ts evaluate) : une ligne paie ses symboles identiques qui se suivent depuis le 1er rouleau.
const LINES_NOTE = 'Les 10 lignes. Chacune paie ses symboles identiques qui se suivent depuis le 1er rouleau, à gauche. Ailleurs, des symboles identiques ne rapportent rien (une diagonale qui ne part pas du 1er rouleau, par exemple). Touche une ligne pour la voir sur les rouleaux.';

/**
 * Explorer les lignes d'un tour (retour d'Antoni du 21/11), pour les deux machines. La plaque d'un tour à plusieurs
 * combinaisons porte une puce par combinaison (sa ligne en miniature, son gain) : survol (souris), focus (clavier) ou
 * toucher → la ligne s'éclaire sur les rouleaux (ses 5 cases tracées, les symboles comptés, son nom et son gain), les
 * autres symboles s'estompent. Toucher à nouveau, ou ailleurs : retour au tour. `probe(i)` montre n'importe laquelle
 * des 10 lignes (table des gains) — pour voir que des symboles identiques hors de ces lignes ne paient pas. Affichage
 * seulement : les combinaisons et leurs gains sont ceux du Core (markWins), jamais recalculés.
 * `label(step)` : le texte (déjà échappé) de la machine, « Bosse · 3 × Cerise (dont 1 WILD) ».
 */
function explorer(view, { plate, root, on, lines, label, unsure = () => false }) {
  let steps = null;
  let pin = -1; // la puce choisie (clic, toucher) ; -2 : une ligne montrée depuis la table des gains
  const pathOf = (li) => lines[li]?.rows.map((row, r) => [r, row]) ?? null;
  const nameOf = (li) => lines[li]?.name ?? `Ligne ${li + 1}`;
  const show = (i) => {
    const st = steps?.[i];
    if (!st || view.wins() !== steps || view.isRunning()) return; // une puce d'un tour qui n'est plus sur les rouleaux
    const line = st.kind === 'line';
    view.explore(line ? pathOf(st.line) : null, st.cells, `${line ? nameOf(st.line) : 'BONUS'} +${fmtN(st.win)}`);
  };
  const pressed = () => plate.querySelectorAll('[data-lstep]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.lstep) === pin)));
  const back = () => view.exploring() && view.explore(null);
  const clear = () => {
    pin = -1;
    pressed();
    back();
  };
  const rest = () => (pin >= 0 ? show(pin) : pin === -1 && back());
  const chip = (e) => e.target.closest?.('[data-lstep]');
  on(plate, 'pointerover', (e) => e.pointerType === 'mouse' && chip(e) && show(Number(chip(e).dataset.lstep)));
  on(plate, 'pointerout', (e) => e.pointerType === 'mouse' && chip(e) && !chip(e).contains(e.relatedTarget) && rest());
  on(plate, 'focusin', (e) => chip(e) && show(Number(chip(e).dataset.lstep)));
  on(plate, 'focusout', (e) => chip(e) && rest());
  on(plate, 'click', (e) => {
    const b = chip(e);
    if (!b) return;
    e.stopPropagation(); // jamais « Passer » (un toucher sur la vitre)
    const i = Number(b.dataset.lstep);
    pin = pin === i ? -1 : i;
    pressed();
    if (pin === i) show(i);
    else back();
  });
  on(root, 'click', (e) => pin !== -1 && !e.target.closest?.('[data-lstep], [data-line]') && clear());
  /** Une des 10 lignes sur les rouleaux (table des gains) : son tracé ; si elle a payé ce tour, ses symboles et son gain. */
  const probe = (li) => {
    if (view.isRunning() || !pathOf(li)) return;
    const won = view.wins();
    const st = won?.find((x) => x.kind === 'line' && x.line === li);
    pin = -2;
    pressed();
    // « rien ce tour » seulement quand c'est sûr : un tour marqué sur les rouleaux, sans gain hors lignes (`unsure`).
    view.explore(pathOf(li), st?.cells ?? null, st ? `${nameOf(li)} +${fmtN(st.win)}` : won && !unsure() ? `${nameOf(li)} · rien ce tour` : nameOf(li));
  };
  return {
    /** Les puces d'un tour (les `steps` de markWins, tels quels) ; '' s'il n'y a qu'une combinaison. */
    html(list) {
      steps = list;
      pin = -1;
      if (list.length < 2) return '';
      return `<span class="lrecap" role="group" aria-label="Lignes gagnantes : survole ou touche une ligne pour la voir">${list
        .map((st, i) => {
          const line = st.kind === 'line';
          const txt = `${label(st)} : +${fmtN(st.win)}`;
          return `<button type="button" class="lchip" data-lstep="${i}" aria-pressed="false" title="${txt}" aria-label="${txt}"${line ? ` style="--c:${lineColor(st.line)}"` : ''}>${line ? lineSVG(lines[st.line]?.rows ?? []) : '<em>BONUS</em>'}<b>+${fmtN(st.win)}</b></button>`;
        })
        .join('')}</span>`;
    },
    probe,
    /** Le `onClick` de la table des gains : une ligne touchée ferme la table et se montre sur les rouleaux. */
    paytableClick(e, dr) {
      const b = e.target.closest?.('[data-line]');
      if (!b) return;
      dr.close();
      probe(Number(b.dataset.line));
    },
  };
}

export const ArcadeSlotsView = { create, LINE_COLORS, lineSVG, plineHTML, LINES_NOTE, explorer };
