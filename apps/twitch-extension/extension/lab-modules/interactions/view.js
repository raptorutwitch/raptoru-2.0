// LAB ONLY — vue du module « Interactions » (entrée : module.js ; spécification : docs/chaos/EXTENSION_INTERACTIONS.md).
// Un conteneur et une navigation : Chaos (effets de stream, palette framboise) et Bonk (le vrai écran Bonk, embarqué tel
// quel, avec ses couleurs), choisis dans l'en-tête de l'extension. La modération des effets n'est pas un onglet viewer :
// c'est la section « FX » de la console de modération (moderation-fx.js), ouverte ici par l'équipe seulement.
// Chaos : bandeau « en direct » (ce qui joue, la file, ma place, Mes effets, mes crédits), filtres + favoris, catalogue
// compact réordonnable (appui long), fiche générique qui s'agrandit depuis sa carte (aperçu, préréglages, force,
// contrôles, durée, paiement en Jetons ou avec un crédit). Tout est décrit par catalog.js : aucun cas par effet ici.
// Données : faux Core (model.js) ; aucun appel réseau, aucun Jeton réel ; préférences : prefs.js (localStorage).
import { everySecond } from '../../app/store.js';
import { loadLazyView } from '../../app/lazy-views.js';
import { moduleVariant } from '../../shared/module-registry.js';
import { EFFECTS, ENGINE, GROUPS, PLANNED, SLOTS, controlsFor, defaultChoice, durationRange, effectById, engineRequest, hueHex, normalizeChoice } from './catalog.js';
import { SCENARIOS, createChaosMock, creditTerms, mmss } from './model.js';
import { glyph, token } from './glyphs.js';
import { preview } from './preview.js';
import { createPrefs } from './prefs.js';
import { createReorder } from './reorder.js';
import { createFxModeration } from './moderation-fx.js';

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
const nth = (n) => (n === 1 ? '1er' : `${n}e`);
const mult = (m) => `×${String(Math.round(m * 100) / 100).replace('.', ',')}`;
const HUES = [[15, 'Rouge'], [40, 'Orange'], [60, 'Jaune'], [140, 'Vert'], [185, 'Cyan'], [225, 'Bleu'], [275, 'Violet'], [320, 'Rose'], [345, 'Framboise'], [361, 'Rouge']];
const hueName = (h) => HUES.find(([max]) => h < max)?.[1] ?? 'Rouge';
const TABS = [
  ['chaos', 'Chaos', 'chaos'],
  ['bonk', 'Bonk', 'bonk'],
];
const SOURCE = { streamer: 'offert par le streamer', moderator: 'offert par la modération', reward: 'récompense' };

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
    // Plafond Sécurité de Studio simulé : 30 s (réglage actuel), 60 s (s'il est relevé dans Studio).
    cap: query.get('ixCap') === '60' ? 60 : ENGINE.safetyDurationS,
    planned: query.get('ixPlanned') === '1',
  });
  const fresh = () => createChaosMock({ scenario: lab.scenario, simulate: lab.scenario !== 'calme', capS: lab.cap });
  let mock = (memory.mock ??= fresh());
  const prefs = createPrefs([...EFFECTS, ...PLANNED].map((e) => e.id));
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
  // En-tête : sélecteur compact Chaos · Bonk à la place du titre (posé par l'hôte via headAfter). Deux sous-modules :
  // un sélecteur segmenté (pas un carrousel infini). Molette au survol, glissement du doigt, flèches : un cran, sans boucle.
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
    tabButtons[id] = b;
    panelIds[id] = nextId(`panel-${id}`);
    b.setAttribute('aria-controls', panelIds[id]);
    switcher.append(b);
  }
  const headExtra = el('span', 'ix-headbar__extra');
  // Équipe seulement : la section FX de la console de modération (jamais un onglet que le viewer ne peut pas ouvrir).
  const modBtn = btn('ix-modbtn', 'FX', 'shield');
  modBtn.title = 'Modération des effets (équipe)';
  modBtn.setAttribute('aria-label', 'Modération des effets FX (équipe)');
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
    closeModeration();
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
    swipe = { x: event.clientX, id: event.pointerId };
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
  for (const [id, pane] of [['chaos', chaosPane], ['bonk', bonkPane]]) {
    pane.id = panelIds[id];
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', tabButtons[id].id);
  }
  const sheetLayer = el('div', 'ix-sheet');
  sheetLayer.hidden = true;
  const modLayer = el('div', 'ix-modlayer');
  modLayer.hidden = true;
  panes.append(chaosPane, bonkPane, modLayer, sheetLayer);
  root.append(panes);

  // ---------------------------------------------------------------------------------------------------------------
  // Chaos › bandeau « en direct » : ce qui joue, la file, ma demande ; Mes effets ; mes crédits.
  const live = el('div', 'ix-live');
  const liveMain = btn('ix-live__main');
  liveMain.setAttribute('aria-expanded', 'false');
  const creditBtn = btn('ix-live__credits', null, 'ticket');
  creditBtn.setAttribute('aria-expanded', 'false');
  const creditCount = el('b', 'ix-live__ccount');
  creditBtn.append(creditCount);
  const histBtn = btn('ix-live__hist', null, 'history');
  histBtn.setAttribute('aria-label', 'Mes effets');
  histBtn.title = 'Mes effets';
  histBtn.setAttribute('aria-expanded', 'false');
  const histCount = el('b', 'ix-live__count');
  histBtn.append(histCount);
  live.append(liveMain, creditBtn, histBtn);
  const livePop = el('div', 'ix-pop ix-pop--live');
  livePop.id = nextId('pop-live');
  livePop.hidden = true;
  liveMain.setAttribute('aria-controls', livePop.id);
  const histPop = el('div', 'ix-pop ix-pop--mine');
  histPop.id = nextId('pop-mine');
  histPop.hidden = true;
  histBtn.setAttribute('aria-controls', histPop.id);
  creditBtn.setAttribute('aria-controls', histPop.id);
  let histTab = 'effects'; // 'effects' | 'credits'
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
  labBtn.title = 'Maquette : scénario, rôle, plafond de durée, effets à venir (Lab seulement)';
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

  // Panneau Lab (jamais montré à un viewer) : scénario, rôle, plafond Sécurité, effets à venir, préférences.
  const labPop = el('div', 'ix-pop ix-pop--lab');
  labPop.hidden = true;
  labPop.innerHTML = '<p class="ix-lab__note"><b>Maquette Lab</b> · faux Core : prix, file, viewers, solde et crédits fictifs ; aucun Jeton, aucun appel au Core, aucune protection réelle des rôles.</p>';
  const labRow = (label, node, hint) => {
    const r = el('div', 'ix-lab__row');
    r.append(el('span', 'ix-lab__label', label), node);
    labPop.append(r);
    if (hint) labPop.append(el('p', 'ix-lab__hint', hint));
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
    if (v !== 'mod') closeModeration();
  }));
  labRow(
    'Durée max',
    labSeg([[30, '30 s · Sécurité actuelle'], [60, '60 s · simulé']], () => lab.cap, (v) => {
      lab.cap = v;
      mock.setCap(v);
      if (sheet) sheet.rebuild();
    }),
    'Studio › Chaos › Sécurité borne toute activation (30 s aujourd’hui) ; « 60 s » simule ce plafond relevé. Le registre du moteur va jusqu’à 60 s.',
  );
  labRow('À venir', labSeg([[false, 'Masqués'], [true, 'Montrer']], () => lab.planned, (v) => {
    lab.planned = v;
    layoutGrid();
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
  for (const e of [...EFFECTS, ...PLANNED]) {
    const node = el('div', `ix-tile${e.planned ? ' is-planned' : ''}`);
    node.dataset.effect = e.id;
    node.setAttribute('role', 'listitem');
    const main = btn('ix-tile__main');
    const thumbBox = el('span', 'ix-tile__thumb');
    const pv = preview(document, e.id);
    if (!e.planned) pv.set(e, defaultChoice(e));
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
    const ribbon = el('span', 'ix-tile__credit');
    ribbon.append(glyph(document, 'ticket'));
    ribbon.hidden = true;
    node.append(main, fav, ribbon);
    if (e.planned) {
      main.setAttribute('aria-disabled', 'true');
      main.title = 'À venir : pas encore dans le moteur.';
      meta.append(el('span', 'ix-tile__reason', 'À venir'));
    } else main.addEventListener('click', () => openSheet(e.id, node));
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
    tiles.set(e.id, { node, main, pv, badge, meta, fav, ribbon, e, thumbBox });
  }
  const visibleIds = () =>
    prefs.order().filter((id) => {
      const e = effectById(id);
      if (e.planned && !lab.planned) return false;
      if (group === 'all') return true;
      if (group === 'fav') return prefs.isFavorite(id);
      return e.group === group;
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
  // Contrôles génériques de la fiche (les mêmes pour tous les effets : catalog.js décrit lesquels).
  let sheet = null;
  const cap = () => lab.cap;

  function chipRow({ label, options, current, onPick, meter = false, disabled = () => false }) {
    const row = el('div', 'ix-field');
    const head = el('div', 'ix-field__head');
    head.append(el('span', 'ix-field__label', label));
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
      if (o.status === 'to_validate') {
        const flag = el('span', 'ix-opt__flag', 'à valider');
        flag.title = o.hint ?? '';
        b.append(flag);
      }
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-disabled') === 'true') return;
        onPick(o.id);
      });
      group_.append(b);
    });
    group_.addEventListener('keydown', (event) => {
      const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!k) return;
      event.preventDefault();
      const list = [...group_.children].filter((b) => b.getAttribute('aria-disabled') !== 'true');
      const i = list.findIndex((b) => b.getAttribute('aria-checked') === 'true');
      const next = list[(i + k + list.length) % list.length];
      next?.click();
      next?.focus();
    });
    row.append(head, group_, hint);
    const sync = (v) => {
      for (const b of group_.children) {
        const on = b.dataset.v === v;
        b.setAttribute('aria-checked', String(on));
        b.setAttribute('aria-disabled', String(disabled(b.dataset.v)));
        b.tabIndex = on ? 0 : -1;
      }
      const h = options.find((o) => o.id === v)?.hint ?? '';
      hint.textContent = h;
      hint.hidden = !h;
    };
    sync(current);
    return { node: row, sync };
  }

  /** Glissière : continue (min/max/step) ou à crans (`stops`, valeurs choisies une à une). */
  function sliderRow({ label, icon, min, max, step: stepV, stops, value, format, onInput, onCommit, sub, extraClass = '', ticks = true }) {
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
    const lo = stops ? 0 : min;
    const hi = stops ? stops.length - 1 : max;
    input.min = String(lo);
    input.max = String(hi);
    input.step = String(stops ? 1 : stepV);
    input.id = nextId('range');
    title.htmlFor = input.id;
    const tickBox = el('div', 'ix-range__ticks');
    tickBox.setAttribute('aria-hidden', 'true');
    const count = stops ? stops.length : Math.round((max - min) / stepV) + 1;
    if (ticks && count <= 24) for (let i = 0; i < count; i += 1) tickBox.append(el('i'));
    track.append(tickBox, input);
    const foot = el('div', 'ix-range__ends');
    const subEl = el('span', 'ix-range__sub');
    foot.append(el('span', null, format(stops ? stops[0] : min)), subEl, el('span', null, format(stops ? stops.at(-1) : max)));
    row.append(head, track, foot);
    const toValue = (raw) => (stops ? stops[Math.round(raw)] : raw);
    const toRaw = (v) => (stops ? Math.max(0, stops.indexOf(v)) : v);
    const sync = (v) => {
      input.value = String(toRaw(v));
      out.textContent = format(v);
      input.setAttribute('aria-valuetext', format(v));
      track.style.setProperty('--p', String(hi > lo ? (toRaw(v) - lo) / (hi - lo) : 1));
      subEl.textContent = sub?.(v) ?? '';
    };
    input.addEventListener('input', () => {
      const v = toValue(Number(input.value));
      sync(v);
      onInput(v);
    });
    input.addEventListener('change', () => onCommit?.());
    sync(value);
    return { node: row, sync, input };
  }

  function hueRow({ value, onInput, onCommit }) {
    const r = sliderRow({ label: 'Teinte', icon: 'color', min: 0, max: 359, step: 1, value, format: (v) => hueName(v), onInput, onCommit, extraClass: 'ix-field--hue', ticks: false });
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
    b.append(el('span', 'ix-switchrow__label', label), el('i', 'ix-toggle'));
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

  // ---------------------------------------------------------------------------------------------------------------
  // Fiche d'un effet : s'agrandit depuis sa carte, occupe toute la zone du module ; ‹, Échap ou le ‹ de l'en-tête la
  // referment vers sa carte. `pay` : un crédit présélectionné (venu de « Mes crédits »).
  function buildSheet(effectId, mode, { credit: preCredit = null } = {}) {
    const e = effectById(effectId);
    const saved = choices[effectId] ?? (mode === 'viewer' ? prefs.choice(effectId) : null);
    let choice = normalizeChoice(e, saved ?? defaultChoice(e), cap());
    let payCredit = mode === 'viewer' ? preCredit : null; // id du crédit choisi pour payer
    const card = el('div', 'ix-sheet__card');
    card.dataset.effect = e.id;
    card.dataset.mode = mode;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    const content = el('div', 'ix-sheet__content');
    card.append(content);

    // En-tête : retour, nom, favori.
    const head = el('header', 'ix-sheet__head');
    const back = btn('ix-sheet__back', mode === 'mod' ? 'FX' : 'Effets', 'chevL');
    back.setAttribute('aria-label', mode === 'mod' ? 'Retour à la modération FX' : 'Retour au catalogue');
    const title = el('div', 'ix-sheet__title');
    const h = el('h3', null, e.label);
    h.id = nextId('title');
    card.setAttribute('aria-labelledby', h.id);
    title.append(glyph(document, e.id), h);
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
    let picker = null;
    if ((e.controls ?? []).some((k) => k.kind === 'point')) {
      // L'image du stream n'existe pas encore côté extension : chargement bref, puis image fictive annoncée comme telle.
      pv.node.dataset.source = 'loading';
      const caption = el('p', 'ix-sheet__caption');
      caption.append(glyph(document, 'target'), el('span', null, 'Touche l’image pour choisir le point visé.'));
      visual.append(caption);
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
    const creditOf = () => (payCredit ? mock.snapshot(now()).credits.find((c) => c.id === payCredit) ?? null : null);
    const allowedLevel = (id) => {
      const k = creditOf()?.constraints;
      return !k?.levels?.length || k.levels.includes(id);
    };
    const presetRow =
      (e.presets?.length ?? 0) > 1
        ? chipRow({ label: e.presetLabel ?? 'Préréglage', options: e.presets, current: choice.style, onPick: (v) => ((choice.style = v), changed(true, true)), disabled: (id) => Boolean(creditOf()?.constraints?.presets?.length && !creditOf().constraints.presets.includes(id)) })
        : null;
    const levelRow = e.levels?.length
      ? chipRow({ label: e.levelLabel ?? 'Intensité', options: e.levels, current: choice.level, meter: true, onPick: (v) => ((choice.level = v), changed(true, true)), disabled: (id) => !allowedLevel(id) })
      : null;
    for (const r of [presetRow, levelRow]) if (r) controls.append(r.node);
    const extra = el('div', 'ix-sheet__extra');
    const durBox = el('div', 'ix-sheet__duration');
    controls.append(extra, durBox);
    let extraSync = [];
    let durRow = null;
    let durFixed = null; // la valeur affichée d'une durée fixe (elle suit le réglage, ex. « Un clignement »)
    function buildExtra() {
      extra.replaceChildren();
      extraSync = [];
      for (const k of controlsFor(e, choice)) {
        if (k.kind === 'point') continue;
        let r = null;
        if (k.kind === 'choice') r = chipRow({ label: k.label, options: k.options, current: choice.opts[k.id], onPick: (v) => ((choice.opts[k.id] = v), changed(true, true)) });
        if (k.kind === 'slider')
          r = sliderRow({
            label: k.label,
            icon: k.icon,
            min: k.min,
            max: k.max,
            step: k.step,
            stops: k.stops,
            value: choice.opts[k.id],
            format: k.format,
            sub: k.hint,
            onInput: (v) => ((choice.opts[k.id] = v), changed(false)),
            onCommit: () => changed(true),
          });
        if (k.kind === 'hue') r = hueRow({ value: choice.opts[k.id], onInput: (v) => ((choice.opts[k.id] = v), changed(false)), onCommit: () => changed(true) });
        if (k.kind === 'toggle') r = toggleRow({ label: k.label, hint: k.hint, value: choice.opts[k.id], onToggle: (v) => ((choice.opts[k.id] = v), changed(true, true)) });
        if (!r) continue;
        extra.append(r.node);
        extraSync.push(() => r.sync(choice.opts[k.id]));
      }
    }
    // Durée : glissière bornée par l'effet, le préréglage, le plafond Sécurité (et le crédit) ; fixe pour certains préréglages.
    function buildDuration() {
      durBox.replaceChildren();
      const range = durationRange(e, choice, cap());
      const creditMax = creditOf()?.constraints?.maxS;
      const max = creditMax ? Math.max(range.min, Math.min(range.max, creditMax)) : range.max;
      if (range.fixed || max === range.min) {
        const fixed = el('div', 'ix-field ix-field--fixed');
        const head = el('div', 'ix-field__head');
        const label = el('span', 'ix-field__label');
        label.append(glyph(document, 'stopwatch'), el('span', null, 'Durée'));
        durFixed = el('output', 'ix-field__value', `${choice.duration} s`);
        head.append(label, durFixed);
        fixed.append(head, el('p', 'ix-field__hint', range.fixed ? 'Fixée par le préréglage : juste le temps de l’effet.' : `Ce réglage dure ${range.min} s.`));
        durBox.append(fixed);
        durRow = null;
        return;
      }
      durFixed = null;
      const why = creditMax && creditMax < range.max ? `${creditMax} s au plus avec ton crédit` : range.max < Math.min(e.duration.max, ENGINE.maxDurationS) && range.max === cap() ? `${range.max} s au plus pendant ce live` : '';
      durRow = sliderRow({
        label: 'Durée',
        icon: 'stopwatch',
        min: range.min,
        max,
        step: range.step,
        value: Math.min(choice.duration, max),
        format: (v) => `${v} s`,
        sub: () => why,
        onInput: (v) => ((choice.duration = v), changed(false)),
        onCommit: () => changed(true),
        extraClass: 'ix-field--duration',
      });
      durBox.append(durRow.node);
    }
    buildExtra();
    buildDuration();
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

    // Pied : moyen de paiement (Jetons ou crédit), issue, détail du prix, bouton compact en deux temps.
    const foot = el('footer', 'ix-sheet__foot');
    const payBox = el('div', 'ix-pay');
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
    foot.append(payBox, bill, bar, error);
    billBtn.addEventListener('click', () => {
      bill.hidden = !bill.hidden;
      billBtn.setAttribute('aria-expanded', String(!bill.hidden));
    });
    content.append(head, body, foot);

    function paintPay(snap) {
      payBox.replaceChildren();
      const mine = mode === 'viewer' ? snap.credits.filter((c) => c.effect === e.id) : [];
      if (payCredit && !mine.some((c) => c.id === payCredit)) payCredit = null;
      payBox.hidden = !mine.length;
      if (!mine.length) return;
      const seg = el('div', 'ix-paywith');
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', 'Payer avec');
      const opt = (id, label, icon) => {
        const b = btn('ix-paywith__opt', label, icon);
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String((payCredit ?? 'jetons') === id));
        b.addEventListener('click', () => {
          payCredit = id === 'jetons' ? null : id;
          choice = normalizeChoice(e, choice, cap());
          changed(true, true);
        });
        return b;
      };
      seg.append(el('span', 'ix-paywith__label', 'Payer avec'), opt('jetons', 'Jetons', null));
      for (const c of mine) seg.append(opt(c.id, `Mon crédit · ${creditTerms(c)}`, 'ticket'));
      payBox.append(seg);
    }

    let armed = false;
    let busy = false;
    let armTimer = 0;
    let q = null;
    function changed(commit, restructure = false) {
      armed = false;
      error.textContent = '';
      if (restructure) {
        choice = normalizeChoice(e, choice, cap(), { reset: true });
        const k = creditOf()?.constraints;
        if (k?.maxS) choice.duration = Math.min(choice.duration, k.maxS);
        if (k?.levels?.length && !k.levels.includes(choice.level)) choice.level = k.levels.at(-1);
        buildExtra();
        buildDuration();
      }
      const range = durationRange(e, choice, cap());
      if (range.fixed) choice.duration = range.def;
      if (durFixed) durFixed.textContent = `${choice.duration} s`;
      choices[e.id] = choice;
      if (commit && mode === 'viewer') prefs.saveChoice(e.id, choice);
      pv.set(e, choice);
      presetRow?.sync(choice.style);
      levelRow?.sync(choice.level);
      if (durRow) durRow.sync(choice.duration);
      update();
    }
    function update() {
      const t = now();
      const snap = mock.snapshot(t);
      paintPay(snap);
      q = mode === 'mod' ? { price: 0, fullPrice: 0, lines: [], outcome: { kind: 'now' }, block: null } : mock.quote(e.id, choice, t, undefined, payCredit ? { credit: payCredit } : {});
      outcome.replaceChildren();
      outcome.dataset.kind = q.block ? 'block' : q.outcome.kind;
      if (mode === 'mod') outcome.append(glyph(document, 'gift'), el('span', null, 'Offert · passe devant la file'));
      else if (q.block) outcome.append(glyph(document, 'clock'), el('span', null, q.block.detail));
      else if (q.outcome.kind === 'now') outcome.append(glyph(document, 'play'), el('span', null, 'Démarre tout de suite'));
      else outcome.append(glyph(document, 'queue'), el('span', null, `${nth(q.outcome.position)} dans la file · ~${mmss(q.outcome.eta)}`));
      cta.disabled = busy || Boolean(q.block);
      cta.dataset.state = busy ? 'busy' : armed ? 'armed' : 'idle';
      cta.dataset.pay = q.credit ? 'credit' : 'jetons';
      ctaText.textContent = busy ? 'Envoi…' : armed ? 'Confirmer' : mode === 'mod' ? 'Offrir au stream' : q.credit ? 'Utiliser mon crédit' : q.outcome.kind === 'now' ? 'Lancer' : 'Réserver';
      ctaPrice.replaceChildren(q.credit ? glyph(document, 'ticket') : price(q.price, 'ix-price ix-price--cta'));
      cta.setAttribute('aria-label', `${ctaText.textContent} ${e.label}${q.credit ? ' avec ton crédit' : ` pour ${q.price ? `${fmt(q.price)} Jetons` : 'rien (offert)'}`}`);
      if (favBtn) favBtn.setAttribute('aria-pressed', String(prefs.isFavorite(e.id)));
      // Détail du prix : chaque facteur (gêne mesurée sur le réglage réel, durée), le total, le solde après achat ; en
      // Lab, la demande exacte envoyée au moteur.
      bill.replaceChildren();
      if (mode === 'viewer') {
        const list = el('dl', 'ix-bill__list');
        for (const line of q.lines) list.append(el('dt', null, line.label), el('dd', null, line.value != null ? fmt(line.value) : mult(line.mult)));
        list.append(el('dt', 'ix-bill__total', 'Prix'), el('dd', 'ix-bill__total', fmt(q.fullPrice)));
        if (q.credit) list.append(el('dt', 'ix-bill__credit', 'Payé avec ton crédit'), el('dd', 'ix-bill__credit', '0'));
        bill.append(list, el('p', 'ix-bill__after', q.credit ? `Ton solde ne bouge pas (${fmt(snap.balance)} Jetons, fictifs). Le crédit est rendu si l’effet ne démarre pas.` : `Solde (fictif) ${fmt(snap.balance)} → ${fmt(Math.max(0, snap.balance - q.price))} après l’achat. Arrondi à 50 Jetons.`));
      }
      const req = el('details', 'ix-bill__engine');
      req.append(el('summary', null, 'Lab · demande envoyée au moteur'), el('code', null, JSON.stringify(engineRequest(e, choice))));
      bill.append(req);
      picker?.sync();
      for (const s of extraSync) s();
      levelRow?.sync(choice.level);
      presetRow?.sync(choice.style);
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
        const out = mode === 'mod' ? mock.moderation.trigger(e.id, choice, t) : mock.buy(e.id, choice, q.price, t, undefined, payCredit ? { credit: payCredit } : {});
        if (!out.ok) {
          error.textContent = out.message;
          return update();
        }
        if (mode === 'mod') modView?.say?.(`${e.label} offert au stream.`);
        else toast = { id: out.request.id, until: now() + 5000 };
        closeSheet();
        paint();
      }, 350);
    });
    update();
    return { card, content, back, update, destroy: () => win.clearTimeout(armTimer), e, mode };
  }

  function openSheet(effectId, fromNode, { mode = 'viewer', credit = null } = {}) {
    if (reorder.dragging()) return;
    closePops();
    closeSheet({ instant: true });
    const s = buildSheet(effectId, mode, { credit });
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
    const target = tile?.node.isConnected && modLayer.hidden ? tile.node.getBoundingClientRect() : null;
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
    if (!instant) (tile?.main ?? null)?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Modération FX (équipe) : la section de la console de modération, par-dessus le module.
  let modView = null;
  function openModeration() {
    if (!isTeam()) return;
    closePops();
    closeSheet({ instant: true });
    modView ??= createFxModeration({
      document,
      getMock: () => mock,
      now,
      onClose: () => closeModeration(),
      onGift: (effectId, from) => openSheet(effectId, from, { mode: 'mod' }),
    });
    modLayer.replaceChildren(modView.node);
    modLayer.hidden = false;
    root.classList.add('has-mod');
    modView.paint();
    modView.focus();
  }
  function closeModeration() {
    if (modLayer.hidden) return;
    modLayer.hidden = true;
    root.classList.remove('has-mod');
    modBtn.focus({ preventScroll: true });
  }
  modBtn.addEventListener('click', () => (modLayer.hidden ? openModeration() : closeModeration()));

  // ---------------------------------------------------------------------------------------------------------------
  // Popovers : en direct (ce qui joue et la file), Mes effets / Mes crédits, Lab.
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
    creditBtn.setAttribute('aria-expanded', 'false');
  }
  function togglePop(pop, trigger) {
    const open = pop.hidden;
    closePops();
    pop.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) paint();
  }
  liveMain.addEventListener('click', () => togglePop(livePop, liveMain));
  histBtn.addEventListener('click', () => {
    if (!histPop.hidden && histTab === 'effects') return closePops();
    histTab = 'effects';
    closePops();
    histPop.hidden = false;
    histBtn.setAttribute('aria-expanded', 'true');
    paint();
  });
  creditBtn.addEventListener('click', () => {
    if (!histPop.hidden && histTab === 'credits') return closePops();
    histTab = 'credits';
    closePops();
    histPop.hidden = false;
    creditBtn.setAttribute('aria-expanded', 'true');
    paint();
  });
  labBtn.addEventListener('click', () => togglePop(labPop, labBtn));
  const onDocDown = (event) => {
    if (pops.every(([p]) => p.hidden)) return;
    if (pops.some(([p, t]) => p.contains(event.target) || t.contains(event.target)) || creditBtn.contains(event.target)) return;
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
    } else if (!modLayer.hidden) {
      event.preventDefault();
      closeModeration();
    }
  });

  function describeMine(r) {
    const back = r.credit ? 'crédit rendu' : `${fmt(r.price)} remboursés`;
    if (r.state === 'queued') return [`${nth(r.position)} dans la file · ~${mmss(r.eta)}`, 'queued'];
    if (r.state === 'active') return [`à l’écran · encore ${mmss(r.remaining)}`, 'active'];
    if (r.state === 'done') return [r.refunded ? `est passé · ${back}` : 'est passé', 'done'];
    if (r.state === 'expired') return [`jamais démarré · ${back}`, 'refunded'];
    if (r.state === 'removed') return [`arrêté par la modération${r.refunded ? ` · ${back}` : ''}`, 'removed'];
    if (r.state === 'cancelled') return [`retiré par la modération${r.refunded ? ` · ${back}` : ''}`, 'removed'];
    return [r.state, 'done'];
  }
  const who = (r) => (r.by === 'mod' ? 'Modération' : r.mine ? 'Toi' : r.buyer.name);
  const LOG = { granted: 'reçu', used: 'utilisé', restored: 'rendu (l’effet n’a pas joué)', revoked: 'retiré par la modération' };

  let toast = null; // { id, until } : la confirmation qui suit un achat, dans le bandeau
  function paintLive(snap) {
    const t = now();
    const mineActive = snap.active.find((a) => a.mine);
    const mineQueued = snap.queue.find((q) => q.mine);
    const lead = mineActive ?? snap.active.at(-1) ?? null;
    live.dataset.status = snap.status;
    liveMain.replaceChildren();
    liveMain.append(el('i', 'ix-live__dot'));
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
      liveMain.append(el('span', 'ix-live__idle', snap.status === 'open' ? 'Rien à l’écran' : snap.status === 'paused' ? 'Achats suspendus' : 'Hors live'));
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
    creditBtn.hidden = !snap.credits.length && !snap.creditLog.length;
    creditCount.textContent = snap.credits.length ? String(snap.credits.length) : '';
    creditCount.hidden = !snap.credits.length;
    creditBtn.title = snap.credits.length ? `Mes crédits d’effets : ${snap.credits.length}` : 'Mes crédits d’effets';
    creditBtn.setAttribute('aria-label', creditBtn.title);

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
      histPop.replaceChildren();
      const tabs = el('div', 'ix-pop__tabs');
      tabs.setAttribute('role', 'tablist');
      for (const [id, label] of [['effects', 'Mes effets'], ['credits', `Mes crédits${snap.credits.length ? ` · ${snap.credits.length}` : ''}`]]) {
        const b = btn('ix-pop__tab', label);
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(histTab === id));
        b.addEventListener('click', () => {
          histTab = id;
          paint();
        });
        tabs.append(b);
      }
      histPop.append(tabs);
      if (histTab === 'effects') {
        if (!snap.mine.length) histPop.append(el('p', 'ix-pop__empty', 'Tes achats de ce live apparaîtront ici.'));
        for (const r of snap.mine) {
          const [text, kind] = describeMine(r);
          const row = el('div', 'ix-line ix-line--mine');
          row.dataset.kind = kind;
          const main = el('span', 'ix-line__main');
          main.append(el('strong', null, r.label), el('span', 'ix-line__sub', r.summary));
          row.append(glyph(document, r.effect), main, el('span', 'ix-line__state', text), r.credit ? el('span', 'ix-line__paid', 'crédit') : price(r.price, 'ix-price ix-price--sm'));
          histPop.append(row);
        }
      } else {
        histPop.append(el('p', 'ix-pop__intro', 'Un crédit lance un effet précis gratuitement, une seule fois. Rendu si l’effet ne démarre pas.'));
        if (!snap.credits.length) histPop.append(el('p', 'ix-pop__empty', 'Aucun crédit pour l’instant.'));
        for (const c of snap.credits) {
          const e = effectById(c.effect);
          const row = el('div', 'ix-line ix-line--credit');
          const main = el('span', 'ix-line__main');
          main.append(el('strong', null, e.label), el('span', 'ix-line__sub', `${creditTerms(c)} · ${SOURCE[c.source.kind] ?? ''} (${c.source.by}) · « ${c.reason} »`));
          const use = btn('ix-mini ix-mini--use', 'Utiliser', 'ticket');
          use.addEventListener('click', () => openSheet(c.effect, tiles.get(c.effect)?.node, { credit: c.id }));
          row.append(glyph(document, c.effect), main, use);
          histPop.append(row);
        }
        if (snap.creditLog.length) {
          histPop.append(el('h4', 'ix-pop__title', 'Historique des crédits'));
          for (const l of snap.creditLog.slice(0, 6)) {
            const row = el('div', 'ix-line ix-line--log');
            row.append(glyph(document, l.effect), el('span', 'ix-line__sub', `${effectById(l.effect).label} · ${LOG[l.kind] ?? l.kind}${l.reason ? ` · « ${l.reason} »` : ''}`), el('span', 'ix-line__state', new Date(l.at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })));
            histPop.append(row);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Bonk : le vrai écran Bonk (shared/bonk-view.js), embarqué tel quel, avec ses couleurs (thème du conteneur).
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
    const help = bonk.def.headAfter?.(bonk.view, c);
    headExtra.replaceChildren();
    if (help && tab === 'bonk') headExtra.append(help);
  }

  // ---------------------------------------------------------------------------------------------------------------
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
    tabButtons.bonk.hidden = !bonkModule(latest);
    if (tabButtons[tab].hidden) tab = 'chaos';
    root.dataset.tab = tab;
    headbar.dataset.tab = tab;
    root.dataset.status = snap.status;
    for (const [id, b] of Object.entries(tabButtons)) {
      b.setAttribute('aria-selected', String(id === tab));
      b.tabIndex = id === tab ? 0 : -1;
    }
    placeThumb();
    chaosPane.hidden = tab !== 'chaos';
    bonkPane.hidden = tab !== 'bonk';
    if (tab === 'chaos') {
      headExtra.replaceChildren(...(team ? [modBtn] : []));
      modBtn.setAttribute('aria-expanded', String(!modLayer.hidden));
      modBtn.dataset.count = snap.queue.length ? String(snap.queue.length) : '';
    }
    if (!team && !modLayer.hidden) closeModeration();

    // Bandeau d'état : ce qui concerne tout le module, en une phrase.
    const bannerText =
      snap.status === 'offline'
        ? ['offline', 'clock', 'Hors live : les effets reviennent au prochain live.']
        : snap.status === 'paused'
          ? ['paused', 'pause', 'Les achats d’effets sont suspendus. Ta place en file est gardée.']
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
      tile.ribbon.hidden = !info.credits;
      tile.ribbon.title = info.credits ? `Tu as ${info.credits === 1 ? 'un crédit' : `${info.credits} crédits`} pour cet effet` : '';
      tile.node.classList.toggle('has-credit', info.credits > 0);
      tile.main.title = help ?? '';
      tile.main.setAttribute('aria-label', `${tile.e.label}, dès ${fmt(info.minPrice)} Jetons${info.credits ? ', crédit disponible' : ''}${badge ? `, ${badge}` : ''}${reason ? `, ${reason}` : ''}${help ? `. ${help}` : ''}`);
    }
    for (const id of prefs.order()) {
      const tile = tiles.get(id);
      const fav = prefs.isFavorite(id);
      tile.node.classList.toggle('is-fav', fav);
      tile.fav.setAttribute('aria-pressed', String(fav));
    }
    if (!reorder.dragging()) sheet?.update();
    if (!modLayer.hidden) modView?.paint();
    if (tab === 'bonk') void showBonk();
  }

  layoutGrid();
  const askOpen = query.get('ixOpen');
  const askMod = query.get('ixMod') === '1';

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
      if (askOpen && effectById(askOpen) && !effectById(askOpen).planned && tab === 'chaos') win.requestAnimationFrame?.(() => openSheet(askOpen, tiles.get(askOpen)?.node));
      else if (askMod && isTeam()) win.requestAnimationFrame?.(() => openModeration());
    },
    /** Le ‹ de l'en-tête referme d'abord ce qui est ouvert (fiche, modération, détail) avant de revenir au Hub. */
    back() {
      if (sheet) {
        closeSheet();
        return true;
      }
      if (!modLayer.hidden) {
        closeModeration();
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
      modView?.destroy();
      reorder.destroy();
      resize?.disconnect();
      document.removeEventListener('pointerdown', onDocDown, true);
      bonk?.view.destroy?.();
      bonk = null;
    },
  };
}
