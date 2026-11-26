// LAB ONLY — vue du module « Interactions » (entrée : module.js ; spécification : docs/chaos/EXTENSION_INTERACTIONS.md).
// Sous-modules, choisis dans l'en-tête de l'extension (sélecteur compact à la place du titre) : Chaos (effets de stream),
// Bonk (le vrai écran Bonk, embarqué tel quel), Régie (équipe seulement).
// Chaos : bandeau « en direct » (ce qui joue, la file, ma place, Mes effets), filtres + favoris, catalogue compact
// réordonnable (appui long), fiche qui s'agrandit depuis sa carte (aperçu, styles, force, contrôles, durée, prix, achat).
// Données : faux Core (model.js) ; aucun appel réseau, aucun Jeton réel ; préférences : prefs.js (localStorage).
import { everySecond } from '../../app/store.js';
import { loadLazyView } from '../../app/lazy-views.js';
import { moduleVariant } from '../../shared/module-registry.js';
import { EFFECTS, ENGINE, GROUPS, SLOTS, controlsFor, defaultChoice, effectById, engineRequest, hueHex, maxDuration, normalizeChoice } from './catalog.js';
import { SCENARIOS, createChaosMock, mmss } from './model.js';
import { glyph, token } from './glyphs.js';
import { preview } from './preview.js';
import { createPrefs } from './prefs.js';
import { createReorder } from './reorder.js';

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
const nth = (n) => (n === 1 ? '1er' : `${n}e`);
const pct = (m) => `${m > 1 ? '+' : '−'}${Math.round(Math.abs(m - 1) * 100)} %`;
const mult = (m) => `×${String(Math.round(m * 100) / 100).replace('.', ',')}`;
const HUES = [[15, 'Rouge'], [40, 'Orange'], [60, 'Jaune'], [140, 'Vert'], [185, 'Cyan'], [225, 'Bleu'], [275, 'Violet'], [320, 'Rose'], [345, 'Framboise'], [361, 'Rouge']];
const hueName = (h) => HUES.find(([max]) => h < max)?.[1] ?? 'Rouge';
const TABS = [
  ['chaos', 'Chaos', 'chaos'],
  ['bonk', 'Bonk', 'bonk'],
  ['regie', 'Régie', 'shield'],
];

export function view(ctx) {
  const { document } = ctx;
  const win = document.defaultView;
  const query = new URLSearchParams(win?.location?.search ?? '');
  const memory = ctx.host.memory;
  const lab = (memory.lab ??= {
    scenario: SCENARIOS[query.get('ixScenario')] ? query.get('ixScenario') : 'normal',
    // Rôle simulé : celui de la page (?ixRole), sinon celui de la session (modérateur de la démo). Le panneau Lab le
    // change ; le vrai Core vérifiera le rôle côté serveur (aucune protection ici).
    role: query.get('ixRole') ? (query.get('ixRole') === 'mod' ? 'mod' : 'viewer') : ctx.team === true ? 'mod' : 'viewer',
    cap: query.get('ixCap') === '60' ? 60 : ENGINE.safetyDurationS,
    open: false,
  });
  const fresh = () =>
    createChaosMock({ scenario: lab.scenario, balance: Number(ctx.state?.wallet?.available) || 12000, simulate: lab.scenario !== 'calme', capS: lab.cap });
  let mock = (memory.mock ??= fresh());
  const prefs = createPrefs(EFFECTS.map((e) => e.id));
  const choices = (memory.choices ??= {});
  let latest = ctx.state;
  let tab = TABS.some(([id]) => id === query.get('ixTab')) ? query.get('ixTab') : (memory.tab ?? 'chaos');
  let group = memory.group ?? 'all';
  let destroyed = false;
  let stopClock = null;
  const now = () => Date.now();
  const isTeam = () => lab.role === 'mod';
  const reduced = () => Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const canHover = () => Boolean(win?.matchMedia?.('(hover: hover) and (pointer: fine)').matches);

  const el = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };
  const btn = (className, label, icon) => {
    const b = el('button', className);
    b.type = 'button';
    if (icon) b.append(glyph(document, icon));
    if (label != null) b.append(el('span', null, label));
    return b;
  };
  const price = (n, className = 'ix-price') => {
    const p = el('span', className);
    if (!n) p.append(el('span', 'ix-price__free', 'Offert'));
    else p.append(el('span', null, fmt(n)), token(document));
    return p;
  };
  let uid = 0;
  const nextId = (p) => `ix-${p}-${++uid}`;

  // ---------------------------------------------------------------------------------------------------------------
  // En-tête : sélecteur compact Chaos · Bonk · Régie, à la place du titre (posé par l'hôte via headAfter).
  // Deux ou trois sous-modules : un sélecteur segmenté, pas un carrousel infini (qui n'aurait rien à faire défiler et
  // perdrait le clavier et la lecture). Molette au survol, glissement du doigt, flèches du clavier : un cran, sans boucle.
  const headbar = el('div', 'ix-headbar');
  const switcher = el('div', 'ix-switch');
  switcher.setAttribute('role', 'tablist');
  switcher.setAttribute('aria-label', 'Interactions');
  const thumb = el('span', 'ix-switch__thumb');
  thumb.setAttribute('aria-hidden', 'true');
  switcher.append(thumb);
  const tabButtons = {};
  const panelIds = {};
  for (const [id, label, icon] of TABS) {
    const b = btn('ix-switch__tab', null, icon);
    b.append(el('span', 'ix-switch__label', label));
    b.dataset.tab = id;
    b.id = nextId(`tab-${id}`);
    b.title = label;
    b.setAttribute('role', 'tab');
    if (id === 'regie') b.append(el('b', 'ix-switch__count'));
    tabButtons[id] = b;
    panelIds[id] = nextId(`panel-${id}`);
    b.setAttribute('aria-controls', panelIds[id]);
    switcher.append(b);
  }
  const headExtra = el('span', 'ix-headbar__extra');
  headbar.append(switcher, headExtra);
  const shownTabs = () => TABS.map(([id]) => id).filter((id) => !tabButtons[id].hidden);
  function placeThumb() {
    const b = tabButtons[tab];
    if (!b?.isConnected || b.hidden || !b.offsetWidth) return void (thumb.style.opacity = '0');
    thumb.style.opacity = '1';
    thumb.style.width = `${b.offsetWidth}px`;
    thumb.style.transform = `translateX(${b.offsetLeft}px)`;
  }
  function goTab(id, { focus = false } = {}) {
    if (!id || id === tab) return;
    tab = memory.tab = id;
    closeSheet({ instant: true });
    closePops();
    paint();
    if (focus) tabButtons[id].focus();
  }
  const step = (k) => {
    const list = shownTabs();
    const i = list.indexOf(tab);
    const j = Math.min(list.length - 1, Math.max(0, i + k));
    if (j !== i) goTab(list[j], { focus: switcher.contains(document.activeElement) });
    return j !== i;
  };
  switcher.addEventListener('click', (event) => goTab(event.target.closest('[data-tab]')?.dataset.tab));
  switcher.addEventListener('keydown', (event) => {
    const list = shownTabs();
    const map = { ArrowRight: 1, ArrowLeft: -1 };
    if (map[event.key]) {
      event.preventDefault();
      step(map[event.key]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      goTab(event.key === 'Home' ? list[0] : list.at(-1), { focus: true });
    }
  });
  let wheelAt = 0;
  switcher.addEventListener(
    'wheel',
    (event) => {
      const d = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!d) return;
      event.preventDefault(); // le pointeur est sur le sélecteur : la molette le pilote, jamais la page dessous
      if (now() - wheelAt < 280) return; // un cran par geste, pas de défilement incontrôlé
      if (step(d > 0 ? 1 : -1)) wheelAt = now();
    },
    { passive: false },
  );
  let swipe = null;
  switcher.addEventListener('pointerdown', (event) => {
    swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  switcher.addEventListener('pointerup', (event) => {
    if (!swipe || swipe.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x;
    swipe = null;
    if (Math.abs(dx) > 28) step(dx < 0 ? 1 : -1);
  });
  const resize = typeof win?.ResizeObserver === 'function' ? new win.ResizeObserver(() => placeThumb()) : null;
  resize?.observe(switcher);

  // ---------------------------------------------------------------------------------------------------------------
  // Structure
  const root = el('div', 'ix');
  const panes = el('div', 'ix-panes');
  const chaosPane = el('section', 'ix-pane ix-pane--chaos');
  const bonkPane = el('section', 'ix-pane ix-pane--bonk');
  const regiePane = el('section', 'ix-pane ix-pane--regie');
  for (const [id, pane] of [['chaos', chaosPane], ['bonk', bonkPane], ['regie', regiePane]]) {
    pane.id = panelIds[id];
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', tabButtons[id].id);
  }
  const sheetLayer = el('div', 'ix-sheet');
  sheetLayer.hidden = true;
  panes.append(chaosPane, bonkPane, regiePane, sheetLayer);
  root.append(panes);

  // ---------------------------------------------------------------------------------------------------------------
  // Chaos › bandeau « en direct » : ce qui joue, la file, ma demande ; Mes effets.
  const live = el('div', 'ix-live');
  const liveMain = btn('ix-live__main');
  liveMain.setAttribute('aria-expanded', 'false');
  const histBtn = btn('ix-live__hist', null, 'history');
  histBtn.setAttribute('aria-label', 'Mes effets');
  histBtn.title = 'Mes effets';
  histBtn.setAttribute('aria-expanded', 'false');
  const histCount = el('b', 'ix-live__count');
  histBtn.append(histCount);
  live.append(liveMain, histBtn);
  const livePop = el('div', 'ix-pop ix-pop--live');
  livePop.id = nextId('pop-live');
  livePop.hidden = true;
  liveMain.setAttribute('aria-controls', livePop.id);
  const histPop = el('div', 'ix-pop ix-pop--mine');
  histPop.id = nextId('pop-mine');
  histPop.hidden = true;
  histBtn.setAttribute('aria-controls', histPop.id);
  const banner = el('div', 'ix-banner');
  banner.hidden = true;

  // Filtres, astuce, catalogue.
  const scroller = el('div', 'ix-scroll');
  const filters = el('div', 'ix-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Familles d’effets');
  for (const [id, label] of [['all', 'Tout'], ['fav', 'Favoris'], ...GROUPS.map((g) => [g.id, g.label])]) {
    const b = btn('ix-chip', label, id === 'fav' ? 'star' : null);
    b.dataset.group = id;
    if (id === 'fav') b.append(el('b', 'ix-chip__count'));
    filters.append(b);
  }
  const labBtn = btn('ix-labbtn', 'Lab', 'lab');
  labBtn.title = 'Maquette : scénario, rôle, plafond de durée (Lab seulement)';
  labBtn.setAttribute('aria-expanded', 'false');
  const filterRow = el('div', 'ix-filterrow');
  filterRow.append(filters, labBtn);
  const tip = el('p', 'ix-tip');
  tip.append(glyph(document, 'grip'), el('span', null, 'Appui long sur un effet pour le déplacer · ☆ pour le garder en favori.'));
  const tipClose = btn('ix-tip__close', null, 'close');
  tipClose.setAttribute('aria-label', 'Masquer l’astuce');
  tip.append(tipClose);
  tip.hidden = prefs.tipSeen();
  tipClose.addEventListener('click', () => {
    prefs.markTipSeen();
    tip.hidden = true;
  });
  const grid = el('div', 'ix-grid');
  grid.setAttribute('role', 'list');
  grid.setAttribute('aria-label', 'Effets');
  const empty = el('p', 'ix-empty');
  empty.hidden = true;
  scroller.append(filterRow, tip, grid, empty);
  chaosPane.append(live, banner, scroller, livePop, histPop);

  // Panneau Lab (jamais montré à un viewer) : scénario, rôle, plafond Sécurité, préférences.
  const labPop = el('div', 'ix-pop ix-pop--lab');
  labPop.hidden = true;
  labPop.innerHTML = '<p class="ix-lab__note"><b>Maquette Lab</b> · faux Core : prix, file, viewers et solde fictifs ; aucun Jeton, aucun appel au Core, aucune protection réelle des rôles.</p>';
  const labRow = (label, node) => {
    const r = el('div', 'ix-lab__row');
    r.append(el('span', 'ix-lab__label', label), node);
    labPop.append(r);
  };
  const scenarioSelect = el('select', 'ix-lab__select');
  for (const [id, label] of Object.entries(SCENARIOS)) {
    const o = el('option', null, label);
    o.value = id;
    o.selected = id === lab.scenario;
    scenarioSelect.append(o);
  }
  scenarioSelect.addEventListener('change', () => {
    lab.scenario = scenarioSelect.value;
    mock = memory.mock = fresh();
    closeSheet({ instant: true });
    paint();
  });
  labRow('Scénario', scenarioSelect);
  const labSeg = (items, get, set) => {
    const s = el('div', 'ix-seg ix-seg--lab');
    for (const [id, label] of items) {
      const b = btn('ix-seg__opt', label);
      b.dataset.v = String(id);
      b.addEventListener('click', () => {
        set(id);
        for (const x of s.children) x.setAttribute('aria-pressed', String(x.dataset.v === String(get())));
        paint();
      });
      b.setAttribute('aria-pressed', String(String(id) === String(get())));
      s.append(b);
    }
    return s;
  };
  labRow('Rôle', labSeg([['viewer', 'Viewer'], ['mod', 'Modérateur']], () => lab.role, (v) => {
    lab.role = v;
    if (v !== 'mod' && tab === 'regie') tab = 'chaos';
  }));
  labRow('Plafond', labSeg([[30, '30 s (défaut Studio)'], [60, '60 s (relevé)']], () => lab.cap, (v) => {
    lab.cap = v;
    mock.setCap(v);
    if (sheet) sheet.rebuild();
  }));
  const resetPrefs = btn('ix-mini', 'Effacer favoris, ordre et réglages');
  resetPrefs.addEventListener('click', () => {
    prefs.reset();
    for (const k of Object.keys(choices)) delete choices[k];
    tip.hidden = false;
    layoutGrid();
    paint();
  });
  labRow('Préférences', resetPrefs);
  chaosPane.append(labPop);

  // --- Cartes du catalogue (créées une fois ; filtrer ou réordonner déplace les mêmes nœuds) ----------------------
  const tiles = new Map();
  for (const e of EFFECTS) {
    const node = el('div', 'ix-tile');
    node.dataset.effect = e.id;
    node.setAttribute('role', 'listitem');
    const main = btn('ix-tile__main');
    const thumbBox = el('span', 'ix-tile__thumb');
    const pv = preview(document, e.id);
    pv.set(e, defaultChoice(e));
    const badge = el('span', 'ix-tile__badge');
    badge.hidden = true;
    thumbBox.append(pv.node, badge);
    const text = el('span', 'ix-tile__text');
    const name = el('strong', 'ix-tile__name', e.label);
    const meta = el('span', 'ix-tile__meta');
    text.append(name, meta);
    main.append(thumbBox, text);
    const fav = btn('ix-tile__fav', null, 'star');
    fav.setAttribute('aria-label', `Favori : ${e.label}`);
    node.append(main, fav);
    main.addEventListener('click', () => openSheet(e.id, node));
    main.addEventListener('keydown', (event) => {
      if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      keyboardMove(e.id, event.key);
    });
    fav.addEventListener('click', () => {
      prefs.toggleFavorite(e.id);
      if (group === 'fav') layoutGrid();
      paint();
    });
    node.addEventListener('pointerenter', () => canHover() && !grid.classList.contains('is-dragging') && pv.live(true));
    node.addEventListener('pointerleave', () => pv.live(false));
    tiles.set(e.id, { node, main, pv, badge, meta, fav, e, thumbBox });
  }
  const visibleIds = () =>
    prefs.order().filter((id) => {
      if (group === 'all') return true;
      if (group === 'fav') return prefs.isFavorite(id);
      return effectById(id).group === group;
    });
  function layoutGrid() {
    const ids = visibleIds();
    grid.replaceChildren(...ids.map((id) => tiles.get(id).node));
    empty.hidden = ids.length > 0;
    empty.replaceChildren(
      ...(group === 'fav' ? [glyph(document, 'star'), el('span', null, 'Aucun favori pour l’instant : touche ☆ sur un effet pour le retrouver ici.')] : [el('span', null, 'Aucun effet ici.')]),
    );
  }
  const reorder = createReorder({
    document,
    grid,
    scroller,
    items: () => [...grid.querySelectorAll('.ix-tile')],
    idOf: (card) => card.dataset.effect,
    onDrop: (ids, from, to) => {
      prefs.markTipSeen();
      tip.hidden = true;
      return prefs.move(ids, from, to);
    },
  });
  function keyboardMove(id, key) {
    const ids = visibleIds();
    const i = ids.indexOf(id);
    let cols = 1;
    try {
      cols = Math.max(1, win.getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/u).length);
    } catch {
      /* une colonne */
    }
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[key];
    const j = Math.min(ids.length - 1, Math.max(0, i + delta));
    if (i < 0 || j === i) return;
    prefs.move(ids, i, j);
    layoutGrid();
    tiles.get(id).main.focus({ preventScroll: false });
  }
  filters.addEventListener('click', (event) => {
    const b = event.target.closest('[data-group]');
    if (!b) return;
    group = memory.group = b.dataset.group;
    layoutGrid();
    paint();
    scroller.scrollTop = 0;
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Fiche d'un effet : s'agrandit depuis sa carte (le contour de la carte devient le panneau, le contenu apparaît
  // ensuite), occupe toute la zone du module ; ‹, Échap ou le ‹ de l'en-tête la referment vers sa carte.
  let sheet = null;
  const cap = () => lab.cap;

  function chipRow({ label, options, current, onPick, meter = false, hintOf }) {
    const row = el('div', 'ix-field');
    const head = el('div', 'ix-field__head');
    const title = el('span', 'ix-field__label', label);
    head.append(title);
    const group_ = el('div', `ix-opts${meter ? ' ix-opts--meter' : ''}`);
    group_.setAttribute('role', 'radiogroup');
    group_.setAttribute('aria-label', label);
    const hint = el('p', 'ix-field__hint');
    options.forEach((o, i) => {
      const b = btn('ix-opt');
      b.dataset.v = o.id;
      b.setAttribute('role', 'radio');
      if (meter) {
        const m = el('i', 'ix-meter');
        m.style.setProperty('--lv', String((i + 1) / options.length));
        b.append(m);
      }
      b.append(el('span', 'ix-opt__label', o.label));
      if (o.mult && o.mult !== 1) b.append(el('span', 'ix-opt__cost', pct(o.mult)));
      if (o.status === 'to_validate') {
        const flag = el('span', 'ix-opt__flag', 'à valider');
        flag.title = o.hint ?? '';
        b.append(flag);
      }
      b.addEventListener('click', () => onPick(o.id));
      group_.append(b);
    });
    // Flèches dans un groupe radio : choisir l'option voisine.
    group_.addEventListener('keydown', (event) => {
      const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!k) return;
      event.preventDefault();
      const list = [...group_.children];
      const i = list.findIndex((b) => b.getAttribute('aria-checked') === 'true');
      const next = list[(i + k + list.length) % list.length];
      next.click();
      next.focus();
    });
    row.append(head, group_, hint);
    const sync = (v) => {
      for (const b of group_.children) {
        const on = b.dataset.v === v;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      const h = hintOf?.(v) ?? options.find((o) => o.id === v)?.hint ?? '';
      hint.textContent = h;
      hint.hidden = !h;
    };
    sync(current);
    return { node: row, sync };
  }

  function sliderRow({ label, icon, min, max, step: stepV, value, format, onInput, onCommit, sub, extraClass = '', ticks = true }) {
    const row = el('div', `ix-field ix-field--slider ${extraClass}`);
    const head = el('div', 'ix-field__head');
    const title = el('label', 'ix-field__label');
    if (icon) title.append(glyph(document, icon));
    title.append(el('span', null, label));
    const out = el('output', 'ix-field__value');
    head.append(title, out);
    const track = el('div', 'ix-range');
    const input = el('input', 'ix-range__input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(stepV);
    input.value = String(value);
    input.id = nextId('range');
    title.htmlFor = input.id;
    const tickBox = el('div', 'ix-range__ticks');
    tickBox.setAttribute('aria-hidden', 'true');
    if (ticks) for (let v = min; v <= max + 1e-9; v += stepV) tickBox.append(el('i'));
    track.append(tickBox, input);
    const foot = el('div', 'ix-range__ends');
    const subEl = el('span', 'ix-range__sub');
    foot.append(el('span', null, format(min)), subEl, el('span', null, format(max)));
    row.append(head, track, foot);
    const sync = (v) => {
      input.value = String(v);
      out.textContent = format(v);
      input.setAttribute('aria-valuetext', format(v));
      track.style.setProperty('--p', String(max > min ? (v - min) / (max - min) : 1));
      subEl.textContent = sub?.(v) ?? '';
    };
    input.addEventListener('input', () => {
      const v = Number(input.value);
      sync(v);
      onInput(v);
    });
    input.addEventListener('change', () => onCommit?.());
    sync(value);
    return { node: row, sync, input };
  }

  function hueRow({ value, onInput, onCommit }) {
    const r = sliderRow({
      label: 'Teinte',
      icon: 'color',
      min: 0,
      max: 359,
      step: 1,
      value,
      format: (v) => hueName(v),
      onInput,
      onCommit,
      extraClass: 'ix-field--hue',
      ticks: false,
    });
    r.node.querySelector('.ix-range__ends').hidden = true;
    const sw = el('i', 'ix-swatch');
    r.node.querySelector('.ix-field__head').append(sw);
    const sync0 = r.sync;
    r.sync = (v) => {
      sync0(v);
      sw.style.background = hueHex(v);
      r.node.style.setProperty('--hue', `${v}deg`);
    };
    r.sync(value);
    r.input.addEventListener('input', () => r.sync(Number(r.input.value)));
    return r;
  }

  function toggleRow({ label, hint, value, onToggle }) {
    const row = el('div', 'ix-field ix-field--toggle');
    const b = btn('ix-switchrow');
    b.setAttribute('role', 'switch');
    const knob = el('i', 'ix-toggle');
    b.append(el('span', 'ix-switchrow__label', label), knob);
    const h = el('p', 'ix-field__hint', hint);
    row.append(b, h);
    const sync = (v) => b.setAttribute('aria-checked', String(Boolean(v)));
    b.addEventListener('click', () => onToggle(b.getAttribute('aria-checked') !== 'true'));
    sync(value);
    return { node: row, sync };
  }

  /** Point visé sur l'aperçu (16:9, comme l'écran du jeu 2560 × 1440) : toucher, glisser, ou flèches au clavier. */
  function attachPicker(pvNode, get, set, label) {
    const pin = btn('ix-pin');
    pin.setAttribute('aria-label', label);
    pin.append(el('i', 'ix-pin__ring'));
    pvNode.append(pin);
    pvNode.classList.add('is-picker');
    pvNode.removeAttribute('aria-hidden');
    const sync = () => {
      const [x, y] = get();
      pin.style.left = `${x * 100}%`;
      pin.style.top = `${y * 100}%`;
      pin.setAttribute('aria-valuetext', `${Math.round(x * 100)} % depuis la gauche, ${Math.round(y * 100)} % depuis le haut`);
      pin.title = `Point visé : ${Math.round(x * 100)} %, ${Math.round(y * 100)} %`;
    };
    const at = (event) => {
      const r = pvNode.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (event.clientY - r.top) / r.height));
      set([Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
      sync();
    };
    let dragging = null;
    pvNode.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      dragging = event.pointerId;
      pvNode.setPointerCapture?.(event.pointerId);
      at(event);
      event.preventDefault();
    });
    pvNode.addEventListener('pointermove', (event) => {
      if (dragging === event.pointerId) at(event);
    });
    const end = (event) => {
      if (dragging !== event.pointerId) return;
      dragging = null;
      set(get(), true);
    };
    pvNode.addEventListener('pointerup', end);
    pvNode.addEventListener('pointercancel', end);
    pin.addEventListener('keydown', (event) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!d) return;
      event.preventDefault();
      const s = event.shiftKey ? 0.1 : 0.02;
      const [x, y] = get();
      set([Math.min(1, Math.max(0, Math.round((x + d[0] * s) * 100) / 100)), Math.min(1, Math.max(0, Math.round((y + d[1] * s) * 100) / 100))], true);
      sync();
    });
    sync();
    return { sync };
  }

  function buildSheet(effectId, mode) {
    const e = effectById(effectId);
    const saved = choices[effectId] ?? (mode === 'viewer' ? prefs.choice(effectId) : null);
    let choice = normalizeChoice(e, saved ?? defaultChoice(e), cap());
    const card = el('div', 'ix-sheet__card');
    card.dataset.effect = e.id;
    card.dataset.mode = mode;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    const content = el('div', 'ix-sheet__content');
    card.append(content);

    // En-tête : retour au catalogue, nom, gêne, favori.
    const head = el('header', 'ix-sheet__head');
    const back = btn('ix-sheet__back', mode === 'mod' ? 'Régie' : 'Effets', 'chevL');
    back.setAttribute('aria-label', mode === 'mod' ? 'Retour à la Régie' : 'Retour au catalogue');
    const title = el('div', 'ix-sheet__title');
    const h = el('h3', null, e.label);
    h.id = nextId('title');
    card.setAttribute('aria-labelledby', h.id);
    const gene = el('span', 'ix-gene');
    gene.title = `Gêne pour le jeu : ${['faible', 'moyenne', 'forte'][e.gene - 1]}`;
    gene.setAttribute('aria-label', gene.title);
    for (let i = 1; i <= 3; i += 1) gene.append(el('i', i <= e.gene ? 'is-on' : null));
    title.append(glyph(document, e.id), h, gene);
    head.append(back, title);
    let favBtn = null;
    if (mode === 'viewer') {
      favBtn = btn('ix-sheet__fav', null, 'star');
      favBtn.setAttribute('aria-label', `Favori : ${e.label}`);
      favBtn.addEventListener('click', () => {
        prefs.toggleFavorite(e.id);
        if (group === 'fav') layoutGrid();
        paint();
      });
      head.append(favBtn);
    }
    back.addEventListener('click', () => closeSheet());

    // Corps : aperçu (et point visé) | réglages.
    const body = el('div', 'ix-sheet__body');
    const visual = el('div', 'ix-sheet__visual');
    const pv = preview(document, e.id, { big: true });
    pv.set(e, choice);
    pv.live(true);
    const tag = el('span', 'ix-pv__tag', 'Aperçu simulé');
    tag.title = 'Une approximation pour se faire une idée : le vrai rendu est celui du moteur, sur le stream.';
    pv.node.append(tag);
    visual.append(pv.node);
    const pointCtl = e.controls.find((k) => k.kind === 'point');
    let picker = null;
    if (pointCtl) {
      // L'image du stream n'existe pas encore côté extension : chargement bref, puis image fictive annoncée comme telle.
      pv.node.dataset.source = 'loading';
      const cap_ = el('p', 'ix-sheet__caption');
      cap_.append(glyph(document, 'target'), el('span', null, 'Touche l’image pour choisir le point visé.'));
      visual.append(cap_);
      picker = attachPicker(
        pv.node,
        () => choice.opts.point,
        (v, commit) => {
          choice.opts.point = v;
          changed(commit);
        },
        'Point visé. Flèches pour le déplacer.',
      );
      win.setTimeout(() => {
        if (!pv.node.isConnected) return;
        pv.node.dataset.source = 'placeholder';
        tag.textContent = 'Image fictive';
        tag.title = 'La capture du stream n’est pas encore branchée : le point choisi vaut pour le vrai écran (coordonnées relatives).';
      }, 650);
    }
    const controls = el('div', 'ix-sheet__controls');
    controls.append(el('p', 'ix-sheet__pitch', e.pitch));
    const rows = [];
    if ((e.styles?.length ?? 0) > 1)
      rows.push(chipRow({ label: 'Style', options: e.styles, current: choice.style, onPick: (v) => ((choice.style = v), changed(true, true)) }));
    if (e.levels?.length)
      rows.push(chipRow({ label: e.levelLabel ?? 'Intensité', options: e.levels, current: choice.level, meter: true, onPick: (v) => ((choice.level = v), changed(true)) }));
    for (const r of rows) controls.append(r.node);
    const extra = el('div', 'ix-sheet__extra');
    controls.append(extra);
    let extraSync = [];
    function buildExtra() {
      extra.replaceChildren();
      extraSync = [];
      for (const k of controlsFor(e, choice)) {
        if (k.kind === 'point') continue;
        let r = null;
        if (k.kind === 'choice')
          r = chipRow({ label: k.label, options: k.options, current: choice.opts[k.id], onPick: (v) => ((choice.opts[k.id] = v), changed(true)) });
        if (k.kind === 'slider')
          r = sliderRow({
            label: k.label,
            icon: k.id === 'factor' ? 'zoom' : null,
            min: k.min,
            max: k.max,
            step: k.step,
            value: choice.opts[k.id],
            format: k.format,
            sub: k.hint,
            onInput: (v) => ((choice.opts[k.id] = v), changed(false)),
            onCommit: () => changed(true),
          });
        if (k.kind === 'hue') r = hueRow({ value: choice.opts[k.id], onInput: (v) => ((choice.opts[k.id] = v), changed(false)), onCommit: () => changed(true) });
        if (k.kind === 'toggle') r = toggleRow({ label: k.label, hint: k.hint, value: choice.opts[k.id], onToggle: (v) => ((choice.opts[k.id] = v), r.sync(v), changed(true)) });
        if (!r) continue;
        extra.append(r.node);
        extraSync.push(() => r.sync(choice.opts[k.id]));
      }
    }
    buildExtra();
    const maxS = maxDuration(e, cap());
    const durRow = sliderRow({
      label: 'Durée',
      icon: 'stopwatch',
      min: e.duration.min,
      max: maxS,
      step: e.duration.step,
      value: Math.min(choice.duration, maxS),
      format: (v) => `${v} s`,
      sub: () => (maxS < e.duration.max ? `${maxS} s au plus pendant ce live` : ''),
      onInput: (v) => ((choice.duration = v), changed(false)),
      onCommit: () => changed(true),
      extraClass: 'ix-field--duration',
    });
    controls.append(durRow.node);
    const info = el('div', 'ix-sheet__info');
    const infoLine = (icon, text) => {
      const p = el('p');
      p.append(glyph(document, icon), el('span', null, text));
      info.append(p);
    };
    infoLine('queue', `${SLOTS[e.slot].rule}. Le même effet déjà à l’écran : le tien passe juste après.`);
    if (e.note) infoLine('info', e.note);
    if (e.studio?.length) infoLine('shield', `Réglé par le streamer : ${e.studio.join(', ')}.`);
    controls.append(info);
    body.append(visual, controls);

    // Pied : issue, détail du prix, bouton compact en deux temps.
    const foot = el('footer', 'ix-sheet__foot');
    const bill = el('div', 'ix-bill');
    bill.hidden = true;
    bill.id = nextId('bill');
    const outcome = el('p', 'ix-outcome');
    const billBtn = btn('ix-billbtn', 'Prix', 'info');
    billBtn.setAttribute('aria-expanded', 'false');
    billBtn.setAttribute('aria-controls', bill.id);
    billBtn.title = 'Comment le prix est calculé';
    const cta = btn('ix-cta');
    const ctaText = el('span', 'ix-cta__text');
    const ctaPrice = el('span', 'ix-cta__price');
    cta.append(ctaText, ctaPrice);
    const error = el('p', 'ix-error');
    error.setAttribute('role', 'alert');
    const bar = el('div', 'ix-sheet__bar');
    bar.append(outcome, billBtn, cta);
    foot.append(bill, bar, error);
    billBtn.addEventListener('click', () => {
      bill.hidden = !bill.hidden;
      billBtn.setAttribute('aria-expanded', String(!bill.hidden));
    });
    content.append(head, body, foot);

    let armed = false;
    let busy = false;
    let armTimer = 0;
    let q = null;
    function changed(commit, restructure = false) {
      armed = false;
      error.textContent = '';
      if (restructure) {
        choice = normalizeChoice(e, choice, cap());
        buildExtra();
      }
      choices[e.id] = choice;
      if (commit && mode === 'viewer') prefs.saveChoice(e.id, choice);
      pv.set(e, choice);
      for (const r of rows) r.sync(r === rows[0] && (e.styles?.length ?? 0) > 1 ? choice.style : choice.level);
      update();
    }
    function update() {
      const t = now();
      q = mode === 'mod' ? { price: 0, lines: [], outcome: { kind: 'now' }, block: null } : mock.quote(e.id, choice, t);
      outcome.replaceChildren();
      outcome.dataset.kind = q.block ? 'block' : q.outcome.kind;
      if (mode === 'mod') outcome.append(glyph(document, 'gift'), el('span', null, 'Offert · passe devant la file'));
      else if (q.block) outcome.append(glyph(document, 'clock'), el('span', null, q.block.detail));
      else if (q.outcome.kind === 'now') outcome.append(glyph(document, 'play'), el('span', null, 'Démarre tout de suite'));
      else outcome.append(glyph(document, 'queue'), el('span', null, `${nth(q.outcome.position)} dans la file · ~${mmss(q.outcome.eta)}`));
      cta.disabled = busy || Boolean(q.block);
      cta.dataset.state = busy ? 'busy' : armed ? 'armed' : 'idle';
      ctaText.textContent = busy ? 'Envoi…' : armed ? 'Confirmer' : mode === 'mod' ? 'Offrir au stream' : q.outcome.kind === 'now' ? 'Lancer' : 'Réserver';
      ctaPrice.replaceChildren(price(q.price, 'ix-price ix-price--cta'));
      cta.setAttribute('aria-label', `${ctaText.textContent} ${e.label} pour ${q.price ? `${fmt(q.price)} Jetons` : 'rien (offert)'}`);
      if (favBtn) favBtn.setAttribute('aria-pressed', String(prefs.isFavorite(e.id)));
      // Détail du prix : chaque coefficient, le total, le solde après achat ; en Lab, la demande exacte au moteur.
      bill.replaceChildren();
      if (mode === 'viewer') {
        const list = el('dl', 'ix-bill__list');
        for (const line of q.lines) list.append(el('dt', null, line.label), el('dd', null, line.value != null ? fmt(line.value) : mult(line.mult)));
        list.append(el('dt', 'ix-bill__total', 'Total'), el('dd', 'ix-bill__total', fmt(q.price)));
        const snap = mock.snapshot(t);
        const after = el('p', 'ix-bill__after', `Solde (fictif) ${fmt(snap.balance)} → ${fmt(Math.max(0, snap.balance - q.price))} après l’achat. Arrondi à 50 Jetons.`);
        bill.append(list, after);
      }
      const req = el('details', 'ix-bill__engine');
      req.append(el('summary', null, 'Lab · demande envoyée au moteur'), el('code', null, JSON.stringify(engineRequest(e, choice))));
      bill.append(req);
      picker?.sync();
      for (const s of extraSync) s();
    }
    // Deux temps, comme shared/purchase.js : le prix, puis « Confirmer » (4 s pour confirmer).
    cta.addEventListener('click', () => {
      if (busy || q?.block) return;
      if (!armed) {
        armed = true;
        win.clearTimeout(armTimer);
        armTimer = win.setTimeout(() => {
          armed = false;
          update();
        }, 4000);
        return update();
      }
      armed = false;
      busy = true;
      update();
      // Le faux Core répond après un court délai réseau.
      win.setTimeout(() => {
        busy = false;
        if (destroyed || sheet?.card !== card) return;
        const t = now();
        const out = mode === 'mod' ? mock.moderation.trigger(e.id, choice, t) : mock.buy(e.id, choice, q.price, t);
        if (!out.ok) {
          error.textContent = out.message;
          return update();
        }
        if (mode === 'mod') regieFlash = `${e.label} offert au stream.`;
        else toast = { id: out.request.id, until: now() + 5000 };
        closeSheet();
        paint();
      }, 350);
    });
    update();
    return {
      card,
      content,
      back,
      update,
      destroy: () => win.clearTimeout(armTimer),
      e,
      mode,
    };
  }

  function openSheet(effectId, fromNode, { mode = 'viewer' } = {}) {
    if (reorder.dragging()) return;
    closePops();
    closeSheet({ instant: true });
    const s = buildSheet(effectId, mode);
    s.from = fromNode ?? null;
    s.rebuild = () => openSheet(effectId, null, { mode });
    sheet = s;
    sheetLayer.replaceChildren(s.card);
    sheetLayer.hidden = false;
    root.classList.add('has-sheet');
    for (const t of tiles.values()) t.pv.live(false);
    const from = fromNode?.isConnected ? fromNode.getBoundingClientRect() : null;
    const to = s.card.getBoundingClientRect();
    if (from && to.width && !reduced() && typeof s.card.animate === 'function') {
      try {
        const clip = `inset(${from.top - to.top}px ${to.right - from.right}px ${to.bottom - from.bottom}px ${from.left - to.left}px round 12px)`;
        s.card.animate([{ clipPath: clip }, { clipPath: 'inset(0px 0px 0px 0px round 14px)' }], { duration: 300, easing: 'cubic-bezier(.2,.75,.25,1)' });
        s.content.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, delay: 110, easing: 'ease-out', fill: 'backwards' });
      } catch {
        /* sans animation */
      }
    }
    s.back.focus({ preventScroll: true, focusVisible: false });
  }

  function closeSheet({ instant = false } = {}) {
    const s = sheet;
    if (!s) return;
    sheet = null;
    s.destroy();
    root.classList.remove('has-sheet');
    const tile = s.mode === 'viewer' ? tiles.get(s.e.id) : null;
    const done = () => {
      if (sheet) return; // une autre fiche s'est ouverte entre-temps
      s.card.remove();
      sheetLayer.hidden = true;
    };
    const target = tile?.node.isConnected ? tile.node.getBoundingClientRect() : null;
    const box = s.card.getBoundingClientRect();
    if (!instant && !reduced() && target && box.width && typeof s.card.animate === 'function') {
      try {
        const clip = `inset(${target.top - box.top}px ${box.right - target.right}px ${box.bottom - target.bottom}px ${target.left - box.left}px round 12px)`;
        s.content.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' });
        s.card.animate([{ clipPath: 'inset(0px 0px 0px 0px round 14px)' }, { clipPath: clip }], { duration: 200, easing: 'cubic-bezier(.4,0,.8,.4)', fill: 'forwards' }).finished.then(done, done);
      } catch {
        done();
      }
    } else done();
    if (!instant) (tile?.main ?? (s.mode === 'mod' ? giftBtn : null))?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Popovers : en direct (ce qui joue et la file), Mes effets, Lab.
  const pops = [
    [livePop, liveMain],
    [histPop, histBtn],
    [labPop, labBtn],
  ];
  function closePops() {
    for (const [pop, trigger] of pops) {
      pop.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
  }
  function togglePop(pop, trigger) {
    const open = pop.hidden;
    closePops();
    pop.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) paint();
  }
  liveMain.addEventListener('click', () => togglePop(livePop, liveMain));
  histBtn.addEventListener('click', () => togglePop(histPop, histBtn));
  labBtn.addEventListener('click', () => togglePop(labPop, labBtn));
  const onDocDown = (event) => {
    if (pops.every(([p]) => p.hidden)) return;
    if (pops.some(([p, t]) => p.contains(event.target) || t.contains(event.target))) return;
    closePops();
  };
  document.addEventListener('pointerdown', onDocDown, true);
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || reorder.dragging()) return;
    if (pops.some(([p]) => !p.hidden)) {
      event.preventDefault();
      const open = pops.find(([p]) => !p.hidden);
      closePops();
      open?.[1].focus();
    } else if (sheet) {
      event.preventDefault();
      closeSheet();
    }
  });

  function describeMine(r) {
    if (r.state === 'queued') return [`${nth(r.position)} dans la file · ~${mmss(r.eta)}`, 'queued'];
    if (r.state === 'active') return [`à l’écran · encore ${mmss(r.remaining)}`, 'active'];
    if (r.state === 'done') return ['est passé', 'done'];
    if (r.state === 'expired') return [`jamais démarré · ${fmt(r.price)} remboursés`, 'refunded'];
    if (r.state === 'removed') return [`arrêté par la modération${r.refunded ? ` · ${fmt(r.price)} remboursés` : ''}`, 'removed'];
    if (r.state === 'cancelled') return [`retiré par la modération${r.refunded ? ` · ${fmt(r.price)} remboursés` : ''}`, 'removed'];
    return [r.state, 'done'];
  }
  const who = (r) => (r.by === 'mod' ? 'Modération' : r.mine ? 'Toi' : r.buyer.name);

  let toast = null; // { id, until } : la confirmation qui suit un achat, dans le bandeau
  function paintLive(snap) {
    const t = now();
    const mineActive = snap.active.find((a) => a.mine);
    const mineQueued = snap.queue.find((q) => q.mine);
    const lead = mineActive ?? snap.active.at(-1) ?? null;
    live.dataset.status = snap.status;
    liveMain.replaceChildren();
    const dot = el('i', 'ix-live__dot');
    liveMain.append(dot);
    const recent = toast && toast.until > t ? snap.mine.find((r) => r.id === toast.id) : null;
    if (recent) {
      liveMain.dataset.kind = 'toast';
      const [text] = describeMine(recent);
      liveMain.append(glyph(document, recent.effect), el('strong', null, `Ton ${recent.label}`), el('span', 'ix-live__sub', text));
    } else if (lead) {
      liveMain.dataset.kind = lead.mine ? 'mine' : 'active';
      const chip = el('span', 'ix-live__now');
      chip.style.setProperty('--p', String(lead.progress ?? 0));
      chip.append(glyph(document, lead.effect), el('strong', null, lead.label), el('span', 'ix-live__sub', lead.mine ? 'le tien' : `par ${who(lead)}`), el('b', 'ix-live__time', mmss(lead.remaining)));
      liveMain.append(chip);
      if (snap.active.length > 1) liveMain.append(el('span', 'ix-live__more', `+${snap.active.length - 1}`));
    } else {
      liveMain.dataset.kind = 'idle';
      liveMain.append(el('span', 'ix-live__idle', snap.status === 'open' ? 'Rien à l’écran' : snap.status === 'paused' ? 'En pause' : 'Hors live'));
    }
    const qn = el('span', 'ix-live__queue');
    qn.dataset.full = String(snap.queue.length >= snap.queueMax);
    qn.append(glyph(document, 'queue'), el('span', null, `${snap.queue.length}/${snap.queueMax}`));
    if (mineQueued) qn.append(el('b', null, `toi ${nth(mineQueued.position)}`));
    liveMain.append(qn, glyph(document, 'chevD', 'ix-ico ix-live__chev'));
    liveMain.setAttribute('aria-label', `En direct : ${snap.active.length} effet${snap.active.length > 1 ? 's' : ''} à l’écran, ${snap.queue.length} en file${mineQueued ? `, ta demande est ${nth(mineQueued.position)}` : ''}. Voir le détail.`);
    const pending = snap.mine.filter((r) => r.state === 'queued' || r.state === 'active').length;
    histCount.textContent = pending ? String(pending) : '';
    histCount.hidden = !pending;

    if (!livePop.hidden) {
      livePop.replaceChildren();
      const sec = (title, count) => {
        const h = el('h4', 'ix-pop__title');
        h.append(el('span', null, title), el('b', null, count));
        livePop.append(h);
      };
      sec('À l’écran', `${snap.active.length}/${snap.maxActive}`);
      if (!snap.active.length) livePop.append(el('p', 'ix-pop__empty', 'Rien pour l’instant.'));
      for (const a of snap.active) {
        const row = el('div', `ix-line${a.mine ? ' is-mine' : ''}`);
        row.style.setProperty('--p', String(a.progress));
        row.append(glyph(document, a.effect), el('strong', null, a.label), el('span', 'ix-line__sub', `${a.summary} · ${who(a)}`), el('b', 'ix-line__time', mmss(a.remaining)));
        livePop.append(row);
      }
      sec('File d’attente', `${snap.queue.length}/${snap.queueMax}`);
      if (!snap.queue.length) livePop.append(el('p', 'ix-pop__empty', 'Personne n’attend : un effet libre part tout de suite.'));
      for (const r of snap.queue) {
        const row = el('div', `ix-line ix-line--queue${r.mine ? ' is-mine' : ''}`);
        row.append(el('b', 'ix-line__pos', String(r.position)), glyph(document, r.effect), el('strong', null, r.label), el('span', 'ix-line__sub', `${who(r)} · départ ~${mmss(r.eta)}`));
        livePop.append(row);
      }
      livePop.append(el('p', 'ix-pop__rules', `${snap.maxActive} effets à la fois au plus · le même effet passe l’un après l’autre · une demande en attente par viewer · jamais démarrée en 3 min : remboursée.`));
    }
    if (!histPop.hidden) {
      histPop.replaceChildren(el('h4', 'ix-pop__title', 'Mes effets'));
      if (!snap.mine.length) histPop.append(el('p', 'ix-pop__empty', 'Tes achats de ce live apparaîtront ici.'));
      for (const r of snap.mine) {
        const [text, kind] = describeMine(r);
        const row = el('div', 'ix-line ix-line--mine');
        row.dataset.kind = kind;
        const main = el('span', 'ix-line__main');
        main.append(el('strong', null, r.label), el('span', 'ix-line__sub', r.summary));
        row.append(glyph(document, r.effect), main, el('span', 'ix-line__state', text), price(r.price, 'ix-price ix-price--sm'));
        histPop.append(row);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Régie (équipe) : pause, tout arrêter, offrir un effet ; à l'écran, file, historique, avec leurs actions.
  const regieTools = el('div', 'ix-regie__tools');
  const pauseBtn = btn('ix-tool', 'Pause', 'pause');
  const stopBtn = btn('ix-tool ix-tool--danger', 'Tout arrêter', 'stop');
  const giftBtn = btn('ix-tool', 'Offrir un effet', 'gift');
  giftBtn.setAttribute('aria-expanded', 'false');
  regieTools.append(pauseBtn, stopBtn, giftBtn);
  const regieGift = el('div', 'ix-regie__gift');
  regieGift.hidden = true;
  for (const e of EFFECTS) {
    const b = btn('ix-gift', null, e.id);
    b.title = e.label;
    b.setAttribute('aria-label', `Offrir ${e.label}`);
    b.addEventListener('click', () => openSheet(e.id, b, { mode: 'mod' }));
    regieGift.append(b);
  }
  const regieScroll = el('div', 'ix-scroll ix-regie');
  const sec = (title) => {
    const s = el('section', 'ix-sec');
    const h = el('h4', 'ix-sec__title');
    const count = el('b', 'ix-sec__count');
    h.append(el('span', null, title), count);
    const list = el('div', 'ix-sec__list');
    s.append(h, list);
    regieScroll.append(s);
    return { count, list };
  };
  const secActive = sec('À l’écran');
  const secQueue = sec('File d’attente');
  const secHistory = sec('Historique récent');
  regieScroll.prepend(regieGift);
  regiePane.append(regieTools, regieScroll);
  const confirmOpen = new Map(); // id → 'cancel' | 'remove' | 'refund' | 'stop'
  let regieFlash = null;

  pauseBtn.addEventListener('click', () => {
    const snap = mock.snapshot(now());
    mock.moderation.setPaused(snap.status === 'open');
    regieFlash = snap.status === 'open' ? 'Chaos en pause : plus aucun achat, la file attend.' : 'Chaos repris.';
    paint();
  });
  stopBtn.addEventListener('click', () => {
    confirmOpen.set('__stop', 'stop');
    paint();
  });
  giftBtn.addEventListener('click', () => {
    regieGift.hidden = !regieGift.hidden;
    giftBtn.setAttribute('aria-expanded', String(!regieGift.hidden));
  });

  function confirmBox(id, kind, r) {
    const box = el('div', 'ix-confirm');
    const reason = el('input', 'ix-confirm__reason');
    reason.type = 'text';
    reason.maxLength = 80;
    reason.placeholder = 'Motif (obligatoire sans remboursement)';
    reason.setAttribute('aria-label', 'Motif');
    const close = () => {
      confirmOpen.delete(id);
      paint();
    };
    const done = (out, text) => {
      if (!out.ok) {
        reason.classList.add('is-required');
        reason.focus();
        regieFlash = out.message;
        return paint();
      }
      confirmOpen.delete(id);
      regieFlash = text;
      paint();
    };
    const acts = el('div', 'ix-confirm__acts');
    if (kind === 'stop') {
      box.append(el('p', null, 'Tout arrêter ? Chaos passe en pause, la file attend. Remboursé d’office si l’effet a joué moins de 25 % de sa durée.'));
      const yes = btn('ix-mini ix-mini--danger', 'Tout arrêter');
      yes.addEventListener('click', () => done(mock.moderation.stopAll(now()), 'Tout est arrêté, Chaos en pause.'));
      const no = btn('ix-mini', 'Retour');
      no.addEventListener('click', close);
      acts.append(yes, no);
      box.append(acts);
      return box;
    }
    const early = r?.state === 'active' && r.progress < 0.25;
    const text =
      kind === 'refund'
        ? `Rembourser ${fmt(r.price)} Jetons à ${r.buyer.name} ?`
        : kind === 'cancel'
          ? `Retirer la demande de ${r.buyer.name} ? Jamais démarrée : remboursement intégral conseillé.`
          : `Arrêter ${r.label} de ${r.buyer.name} ? Joué à ${Math.round((r.progress ?? 0) * 100)} %${early ? ' : remboursement conseillé.' : '.'}`;
    box.append(el('p', null, text), reason);
    if (kind === 'refund') {
      reason.placeholder = 'Motif (obligatoire)';
      const yes = btn('ix-mini ix-mini--ok', 'Rembourser');
      yes.addEventListener('click', () => done(mock.moderation.refund(r.id, reason.value.trim(), now()), `${fmt(r.price)} Jetons rendus à ${r.buyer.name}.`));
      acts.append(yes);
    } else {
      const op = kind === 'cancel' ? mock.moderation.cancel : mock.moderation.remove;
      if (r.price) {
        const withRefund = btn('ix-mini ix-mini--ok', kind === 'cancel' ? 'Retirer et rembourser' : 'Arrêter et rembourser');
        withRefund.addEventListener('click', () => done(op(r.id, { refund: true, reason: reason.value.trim() || null }, now()), `${r.label} retiré, ${fmt(r.price)} Jetons rendus.`));
        acts.append(withRefund);
      }
      const without = btn('ix-mini ix-mini--danger', r.price ? 'Sans rembourser' : kind === 'cancel' ? 'Retirer' : 'Arrêter');
      without.addEventListener('click', () => done(op(r.id, { refund: false, reason: reason.value.trim() || null }, now()), `${r.label} retiré, sans remboursement.`));
      acts.append(without);
    }
    const no = btn('ix-mini', 'Retour');
    no.addEventListener('click', close);
    acts.append(no);
    box.append(acts);
    return box;
  }

  const rowCache = new Map();
  function regieRow(r, kind) {
    const key = `${kind}:${r.id}`;
    let row = rowCache.get(key);
    if (!row) {
      const node = el('div', 'ix-req');
      node.dataset.kind = kind;
      const ico = el('span', 'ix-req__ico');
      ico.append(glyph(document, r.effect));
      const main = el('div', 'ix-req__main');
      const line1 = el('div', 'ix-req__line');
      const line2 = el('div', 'ix-req__sub');
      main.append(line1, line2);
      const action = btn('ix-mini');
      const barEl = el('i', 'ix-req__bar');
      node.append(ico, main, action, barEl);
      action.addEventListener('click', () => {
        const k = kind === 'queue' ? 'cancel' : kind === 'active' ? 'remove' : 'refund';
        if (confirmOpen.get(r.id)) confirmOpen.delete(r.id);
        else confirmOpen.set(r.id, k);
        paint();
      });
      row = { node, line1, line2, action, bar: barEl, confirm: null };
      rowCache.set(key, row);
    }
    row.line1.replaceChildren(el('strong', null, r.label), el('span', 'ix-req__tier', r.summary), price(r.price, 'ix-price ix-price--sm'));
    if (kind === 'queue') row.line2.textContent = `${who(r)} · ${nth(r.position)} · départ ~${mmss(r.eta)} · expire dans ${mmss(r.expiresIn)}`;
    else if (kind === 'active') row.line2.textContent = `${who(r)} · encore ${mmss(r.remaining)}`;
    else {
      const what = { done: 'joué', expired: 'jamais démarré', removed: 'arrêté', cancelled: 'retiré' }[r.state] ?? r.state;
      row.line2.textContent = `${who(r)} · ${what}${r.actor ? ` par ${r.actor}` : ''}${r.refunded ? ' · remboursé' : ''}${r.reason ? ` · « ${r.reason} »` : ''}`;
    }
    row.node.dataset.state = r.state;
    row.node.classList.toggle('is-refunded', r.refunded);
    if (r.progress != null) row.bar.style.setProperty('--p', String(r.progress));
    row.action.replaceChildren(el('span', null, kind === 'queue' ? 'Retirer' : kind === 'active' ? 'Arrêter' : 'Rembourser'));
    row.action.hidden = kind === 'history' && (r.refunded || !r.price);
    row.action.setAttribute('aria-expanded', String(confirmOpen.has(r.id)));
    const want = confirmOpen.get(r.id);
    if (want && !row.confirm) {
      row.confirm = confirmBox(r.id, want, r);
      row.node.append(row.confirm);
    } else if (!want && row.confirm) {
      row.confirm.remove();
      row.confirm = null;
    }
    return row.node;
  }
  function paintList(target, items, kind, emptyText) {
    const nodes = items.map((r) => regieRow(r, kind));
    if (!nodes.length) nodes.push(el('p', 'ix-empty', emptyText));
    target.list.replaceChildren(...nodes);
  }
  let stopBox = null;
  let flashNode = null;
  function paintRegie(snap) {
    pauseBtn.replaceChildren(glyph(document, snap.status === 'paused' ? 'play' : 'pause'), el('span', null, snap.status === 'paused' ? 'Reprendre' : 'Pause'));
    pauseBtn.disabled = snap.status === 'offline';
    stopBtn.disabled = !snap.active.length;
    paintList(secActive, snap.active, 'active', 'Rien à l’écran.');
    paintList(secQueue, snap.queue, 'queue', 'Personne n’attend.');
    paintList(secHistory, snap.history.slice(0, 12), 'history', 'Aucun effet récemment.');
    secActive.count.textContent = `${snap.active.length}/${snap.maxActive}`;
    secQueue.count.textContent = `${snap.queue.length}/${snap.queueMax}`;
    if (confirmOpen.get('__stop') && !stopBox) {
      stopBox = confirmBox('__stop', 'stop');
      regieTools.after(stopBox);
    } else if (!confirmOpen.get('__stop') && stopBox) {
      stopBox.remove();
      stopBox = null;
    }
    const keep = new Set([...snap.active.map((r) => `active:${r.id}`), ...snap.queue.map((r) => `queue:${r.id}`), ...snap.history.slice(0, 12).map((r) => `history:${r.id}`)]);
    for (const k of rowCache.keys()) if (!keep.has(k)) rowCache.delete(k);
    if (regieFlash) {
      flashNode?.remove();
      flashNode = el('p', 'ix-flash', regieFlash);
      flashNode.setAttribute('role', 'status');
      regieTools.after(flashNode);
      const shown = flashNode;
      regieFlash = null;
      win.setTimeout(() => shown.remove(), 3500);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Bonk : le vrai écran Bonk (shared/bonk-view.js), embarqué tel quel dans le sous-module.
  let bonk = null;
  let bonkLoading = false;
  const bonkModule = (state) => (state?.modules ?? []).find((m) => m.id === 'bonk') ?? null;
  async function showBonk() {
    if (bonk || bonkLoading) return drawBonk();
    const mod = bonkModule(latest);
    if (!mod) return void bonkPane.replaceChildren(el('p', 'ix-empty', 'Bonk n’est pas proposé pendant ce live.'));
    bonkLoading = true;
    bonkPane.replaceChildren(el('p', 'ix-empty', 'Chargement de Bonk…'));
    try {
      await loadLazyView('bonk');
    } catch {
      bonkLoading = false;
      return void bonkPane.replaceChildren(el('p', 'ix-empty', 'Bonk n’a pas pu se charger.'));
    }
    bonkLoading = false;
    if (destroyed) return;
    const def = moduleVariant({ module: mod, state: latest, client: ctx.client, document });
    if (!def) return;
    // Même cadre que l'hôte donne à Bonk (ses feuilles visent .jdm-module[data-module="bonk"] .jdm-module__body).
    const wrap = el('section', 'jdm-module is-open ix-bonk');
    wrap.dataset.module = 'bonk';
    const body = el('div', 'jdm-module__body');
    wrap.append(body);
    const bctx = { ...ctx, module: mod, state: latest, body, host: { ...ctx.host, memory: (memory.bonk ??= {}) } };
    bonk = { def, view: def.view(bctx), wrap, body, bctx };
    bonkPane.replaceChildren(wrap);
    drawBonk();
  }
  function drawBonk() {
    if (!bonk) return;
    const mod = bonkModule(latest);
    if (!mod) return;
    const c = { ...bonk.bctx, module: mod, state: latest, body: bonk.body };
    bonk.body.replaceChildren();
    bonk.def.rendered?.(bonk.view, c);
    if (bonk.view.node) bonk.body.append(bonk.view.node);
    // Le « ? » du tutoriel Bonk : à droite du sélecteur, comme dans son propre en-tête.
    const help = bonk.def.headAfter?.(bonk.view, c);
    headExtra.replaceChildren();
    if (help && tab === 'bonk') headExtra.append(help);
  }

  // ---------------------------------------------------------------------------------------------------------------
  /** [état, pastille sur l’aperçu (un temps, court), raison à la place du prix (blocage), aide]. */
  function tileState(info) {
    const b = info.block;
    if (!b) return info.playing ? ['playing', mmss(info.playing.remaining), null, `À l’écran, lancé par ${info.playing.mine ? 'toi' : info.playing.by}. Le tien passera juste après.`] : ['ok', null, null, null];
    if (b.code === 'cooldown' || b.code === 'global_cooldown') return ['cooldown', b.label, null, b.detail];
    if (b.code === 'mine_active' || b.code === 'mine_queued') return ['mine', null, b.label, b.detail];
    if (b.code === 'insufficient_funds') return ['poor', null, null, b.detail];
    return ['blocked', null, b.label, b.detail];
  }

  function paint() {
    if (destroyed) return;
    const t = now();
    const snap = mock.snapshot(t);
    const team = isTeam();
    if (!team && tab === 'regie') tab = 'chaos';
    tabButtons.regie.hidden = !team;
    tabButtons.bonk.hidden = !bonkModule(latest);
    if (tabButtons[tab].hidden) tab = 'chaos';
    root.dataset.tab = tab;
    root.dataset.status = snap.status;
    for (const [id, b] of Object.entries(tabButtons)) {
      b.setAttribute('aria-selected', String(id === tab));
      b.tabIndex = id === tab ? 0 : -1;
    }
    const count = tabButtons.regie.querySelector('.ix-switch__count');
    count.textContent = snap.queue.length ? String(snap.queue.length) : '';
    count.hidden = !snap.queue.length;
    switcher.dataset.count = String(shownTabs().length);
    placeThumb();
    chaosPane.hidden = tab !== 'chaos';
    bonkPane.hidden = tab !== 'bonk';
    regiePane.hidden = tab !== 'regie';
    if (tab !== 'bonk') headExtra.replaceChildren();

    // Bandeau d'état : ce qui concerne tout le module, en une phrase.
    const bannerText =
      snap.status === 'offline'
        ? ['offline', 'clock', 'Hors live : les effets reviennent au prochain live.']
        : snap.status === 'paused'
          ? ['paused', 'pause', 'Le streamer a mis les effets en pause. Ta place en file est gardée.']
          : snap.exclusive
            ? ['info', 'shield', `${snap.game} est en plein écran exclusif : seuls Brouillard, Paupières et Flash passent.`]
            : snap.safe
              ? ['info', 'shield', 'Mode doux ce soir : les effets lumineux sont coupés.']
              : null;
    banner.hidden = !bannerText;
    if (bannerText) {
      banner.dataset.tone = bannerText[0];
      banner.replaceChildren(glyph(document, bannerText[1]), el('span', null, bannerText[2]));
    }
    paintLive(snap);

    for (const b of filters.querySelectorAll('[data-group]')) b.setAttribute('aria-pressed', String(b.dataset.group === group));
    const favCount = filters.querySelector('.ix-chip__count');
    favCount.textContent = prefs.favoriteCount() ? String(prefs.favoriteCount()) : '';
    favCount.hidden = !prefs.favoriteCount();

    for (const info of snap.effects) {
      const tile = tiles.get(info.id);
      const [kind, badge, reason, help] = tileState(info);
      tile.node.dataset.state = kind;
      tile.badge.hidden = !badge;
      tile.badge.dataset.kind = kind;
      tile.badge.textContent = badge ?? '';
      if (reason) tile.meta.replaceChildren(el('span', 'ix-tile__reason', reason));
      else tile.meta.replaceChildren(el('span', 'ix-from', 'dès'), price(info.minPrice));
      const fav = prefs.isFavorite(info.id);
      tile.node.classList.toggle('is-fav', fav);
      tile.fav.setAttribute('aria-pressed', String(fav));
      tile.main.title = help ?? '';
      tile.main.setAttribute('aria-label', `${tile.e.label}, dès ${fmt(info.minPrice)} Jetons${badge ? `, ${badge}` : ''}${reason ? `, ${reason}` : ''}${help ? `. ${help}` : ''}`);
    }
    if (!reorder.dragging()) sheet?.update();
    if (tab === 'regie') paintRegie(snap);
    if (tab === 'bonk') void showBonk();
  }

  layoutGrid();
  const askOpen = query.get('ixOpen');

  return {
    node: root,
    /** L'en-tête de l'extension appelle headAfter à chaque rendu : toujours le même nœud (sélecteur et son état). */
    headbar: () => {
      win.requestAnimationFrame?.(placeThumb);
      return headbar;
    },
    start() {
      stopClock = everySecond((t) => {
        mock.tick(t);
        paint();
      });
      paint();
      if (askOpen && effectById(askOpen) && tab === 'chaos') win.requestAnimationFrame?.(() => openSheet(askOpen, tiles.get(askOpen)?.node));
    },
    /** Le ‹ de l'en-tête referme d'abord ce qui est ouvert (fiche, détail) avant de revenir au Hub. */
    back() {
      if (sheet) {
        closeSheet();
        return true;
      }
      if (pops.some(([p]) => !p.hidden)) {
        closePops();
        return true;
      }
      return false;
    },
    rendered(c) {
      latest = c.state ?? latest;
      if (tab === 'bonk') drawBonk();
    },
    onState(next) {
      latest = next;
      if (tab === 'bonk') drawBonk();
      return true;
    },
    destroy() {
      destroyed = true;
      stopClock?.();
      stopClock = null;
      sheet?.destroy();
      reorder.destroy();
      resize?.disconnect();
      document.removeEventListener('pointerdown', onDocDown, true);
      bonk?.view.destroy?.();
      bonk = null;
    },
  };
}
