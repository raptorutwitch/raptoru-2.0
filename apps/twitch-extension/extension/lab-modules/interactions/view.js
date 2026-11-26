// LAB ONLY — vue du module « Interactions » (entrée : module.js ; spécification : docs/chaos/EXTENSION_INTERACTIONS.md).
// Un conteneur et une navigation : Chaos (effets de stream, palette framboise) et Bonk (le vrai écran Bonk, embarqué tel
// quel, avec ses couleurs), choisis dans l'en-tête de l'extension. La modération des effets n'est pas un onglet viewer :
// c'est la section « FX » de la vraie console de modération (lab-moderation.js), ouverte par le bouclier de l'en-tête
// (app/panel.js, modérateurs seulement ; `moderationSection()` dit laquelle : FX sur Chaos, Bonk sur Bonk).
// Chaos : bandeau « en direct » (ce qui joue, la file, ma place, Mes effets, mes crédits), filtres + favoris, catalogue
// compact réordonnable (appui long), fiche générique qui s'agrandit depuis sa carte (aperçu, préréglages, force,
// contrôles, durée, paiement en Jetons ou avec un crédit). Tout est décrit par catalog.js : aucun cas par effet ici.
// Données : faux Core partagé (store.js → model.js) ; aucun appel réseau, aucun Jeton réel ; préférences : prefs.js.
import { loadLazyView } from '../../app/lazy-views.js';
import { moduleVariant } from '../../shared/module-registry.js';
import { EFFECTS, ENGINE, GROUPS, PLANNED, usePriceGrid, controlsFor, defaultChoice, durationRange, effectById, engineRequest, hueHex, normalizeChoice } from './catalog.js';
import { SCENARIOS, conditionsFor, creditTerms, mmss } from './model.js';
import { getMock, lab, changed as mockChanged, resetMock, subscribe } from './store.js';
import { glyph, token } from './glyphs.js';
import { preview } from './preview.js';
import { createPrefs } from './prefs.js';
import { createReorder } from './reorder.js';

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
  // Faux Core et réglages Lab (scénario, rôle, plafond Sécurité 30 / 60 s, effets à venir) : store.js, partagés avec la
  // section FX de la console de modération ; il avance seul chaque seconde et survit à un rechargement.
  let mock = getMock();
  const prefs = createPrefs([...EFFECTS, ...PLANNED].map((e) => e.id));
  const choices = (memory.choices ??= {});
  let latest = ctx.state;
  let tab = TABS.some(([id]) => id === query.get('ixTab')) ? query.get('ixTab') : (memory.tab ?? 'chaos');
  let group = memory.group ?? 'all';
  let destroyed = false;
  let stopClock = null;
  const now = () => Date.now();
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
  panes.append(chaosPane, bonkPane, sheetLayer);
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
    mock = resetMock();
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
  // Le rôle est celui de la session (démo d'un modérateur : lab-moderation.js) : la page repart avec le rôle choisi.
  labRow('Rôle', labSeg([['viewer', 'Viewer'], ['mod', 'Modérateur']], () => lab.role, (v) => {
    if (v === lab.role) return;
    const u = new URL(win.location.href);
    u.searchParams.set('ixRole', v);
    win.location.replace(u.href);
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
  labRow(
    'Tarifs',
    labSeg([['fourchettes', 'Fourchettes'], ['proposee', 'Proposition'], ['maquette', 'Maquette']], () => lab.prices, (v) => {
      lab.prices = v;
      usePriceGrid(v);
      if (sheet) sheet.rebuild();
    }),
    'Fourchettes retenues le 28/11 (min–max par activation, docs/chaos/TARIFS.md) ; aucun prix de Production.',
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
    const back = btn('ix-sheet__back', 'Effets', 'chevL');
    back.setAttribute('aria-label', 'Retour au catalogue');
    const title = el('div', 'ix-sheet__title');
    const h = el('h3', null, e.label);
    h.id = nextId('title');
    card.setAttribute('aria-labelledby', h.id);
    title.append(glyph(document, e.id), h);
    head.append(back, title);
    // « Conditions » (lien jaune) : les règles qui touchent CET achat, à la demande ; ce qui l'empêche reste écrit en
    // clair au-dessus du bouton. Se ferme au second clic, au clic à côté, avec Échap.
    const condBtn = btn('ix-condlink', 'Conditions');
    const cond = el('div', 'ix-cond');
    cond.hidden = true;
    cond.id = nextId('cond');
    cond.setAttribute('role', 'region');
    cond.setAttribute('aria-label', `Conditions : ${e.label}`);
    condBtn.setAttribute('aria-expanded', 'false');
    condBtn.setAttribute('aria-controls', cond.id);
    const paintCond = () =>
      cond.replaceChildren(
        ...conditionsFor(e, choice, cap()).map(({ icon, text }) => {
          const p = el('p');
          p.append(glyph(document, icon), el('span', null, text));
          return p;
        }),
      );
    const toggleCond = (open = cond.hidden) => {
      if (open) paintCond();
      cond.hidden = !open;
      condBtn.setAttribute('aria-expanded', String(open));
      return true;
    };
    condBtn.addEventListener('click', () => toggleCond());
    head.append(condBtn);
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
    body.append(visual, controls);

    // Pied : moyen de paiement (Jetons ou crédit), charges, issue, détail du prix, bouton compact. La fiche reste ouverte
    // après un achat : solde, charges et file se mettent à jour, on relance si les règles le permettent.
    const foot = el('footer', 'ix-sheet__foot');
    const payBox = el('div', 'ix-pay');
    const bill = el('div', 'ix-bill');
    bill.hidden = true;
    bill.id = nextId('bill');
    // Charges (Un clignement) : dix segments, discrets, dans la barre du bouton.
    const gauge = el('span', 'ix-charges');
    gauge.hidden = true;
    gauge.setAttribute('role', 'img');
    const gaugeBar = el('span', 'ix-charges__bar');
    const gaugeText = el('span', 'ix-charges__text');
    gauge.append(glyph(document, 'bolt'), gaugeBar, gaugeText);
    const outcome = el('p', 'ix-outcome');
    outcome.setAttribute('aria-live', 'polite');
    // « Ne plus demander confirmation » : toujours visible, décochée par défaut, gardée dans le navigateur ; cochée, un
    // clic sur « Lancer » achète directement (rien d'autre ne change : règles, charges, solde revérifiés à chaque achat).
    const quick = el('label', 'ix-quick');
    const quickBox = el('input');
    quickBox.type = 'checkbox';
    quick.append(quickBox, el('span', null, 'Ne plus demander confirmation'));
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
    bar.append(gauge, outcome, quick, billBtn, cta);
    foot.append(payBox, bill, bar, error);
    billBtn.addEventListener('click', () => {
      bill.hidden = !bill.hidden;
      billBtn.setAttribute('aria-expanded', String(!bill.hidden));
      update();
    });
    content.append(head, body, foot);
    card.append(cond);

    function paintPay(snap) {
      payBox.replaceChildren();
      const mine = snap.credits.filter((c) => c.effect === e.id);
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
    let doneTimer = 0;
    let lastClick = 0; // deux clics à moins de 0,25 s = un double clic involontaire, un seul achat
    let intent = null; // clé d'idempotence de l'intention en cours : un renvoi ne débite jamais deux fois
    let done = null; // { text, until } : la confirmation d'un achat, dans la fiche
    let q = null;
    let lastKey = '';
    function changed(commit, restructure = false) {
      armed = false;
      intent = null;
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
      if (commit) prefs.saveChoice(e.id, choice);
      pv.set(e, choice);
      presetRow?.sync(choice.style);
      levelRow?.sync(choice.level);
      if (durRow) durRow.sync(choice.duration);
      picker?.sync();
      for (const sync of extraSync) sync();
      if (!cond.hidden) paintCond();
      lastKey = '';
      update();
    }
    /** Le pied d'après le faux Core ; appelé chaque seconde : rien n'est reconstruit si rien n'a changé. */
    function update() {
      const t = now();
      const snap = mock.snapshot(t);
      q = mock.quote(e.id, choice, t, undefined, payCredit ? { credit: payCredit } : {});
      const confirmOn = !prefs.quickBuy();
      const flash = done && done.until > t ? done : null;
      const key = JSON.stringify([q.price, q.block, q.outcome, q.charges && [q.charges.n, q.charges.nextS], payCredit, armed, busy, flash?.text, snap.balance, snap.credits.map((c) => c.id), bill.hidden, confirmOn, prefs.isFavorite(e.id)]);
      if (key === lastKey) return;
      lastKey = key;
      paintPay(snap);
      outcome.replaceChildren();
      outcome.dataset.kind = flash ? (flash.kind ?? 'ok') : q.block ? 'block' : q.outcome.kind;
      if (flash) outcome.append(glyph(document, flash.kind === 'refunded' ? 'refund' : 'check'), el('span', null, flash.text));
      else if (q.block) outcome.append(glyph(document, q.block.code === 'no_charge' ? 'bolt' : 'clock'), el('span', null, q.block.detail));
      else if (q.outcome.kind === 'now') outcome.append(glyph(document, 'play'), el('span', null, 'Démarre tout de suite'));
      else if (q.outcome.kind === 'burst') outcome.append(glyph(document, 'queue'), el('span', null, `Après ${q.outcome.position - 1} clignement${q.outcome.position > 2 ? 's' : ''} · ~${mmss(q.outcome.eta)}`));
      else outcome.append(glyph(document, 'queue'), el('span', null, `${nth(q.outcome.position)} dans la file · ~${mmss(q.outcome.eta)}`));
      quickBox.checked = !confirmOn;
      gauge.hidden = !q.charges;
      if (q.charges) {
        const { n, max, nextS } = q.charges;
        if (gaugeBar.childElementCount !== max) gaugeBar.replaceChildren(...Array.from({ length: max }, () => el('i')));
        [...gaugeBar.children].forEach((seg, i) => seg.classList.toggle('is-on', i < n));
        gaugeText.textContent = nextS ? `${n}/${max} · +1 dans ${nextS} s` : `${n}/${max}`;
        gauge.dataset.empty = String(n === 0);
        gauge.setAttribute('aria-label', nextS ? `Charges : ${n} sur ${max}, la prochaine revient dans ${nextS} secondes` : `Charges : ${max} sur ${max}`);
        gauge.title = gauge.getAttribute('aria-label');
      }
      cta.disabled = busy || Boolean(q.block);
      cta.dataset.state = busy ? 'busy' : armed ? 'armed' : 'idle';
      cta.dataset.pay = q.credit ? 'credit' : 'jetons';
      ctaText.textContent = busy ? 'Envoi…' : armed ? 'Confirmer' : q.credit ? 'Utiliser mon crédit' : q.outcome.kind === 'now' || q.charges ? 'Lancer' : 'Réserver';
      ctaPrice.replaceChildren(q.credit ? glyph(document, 'ticket') : price(q.price, 'ix-price ix-price--cta'));
      cta.setAttribute('aria-label', `${ctaText.textContent} ${e.label}${q.credit ? ' avec ton crédit' : ` pour ${q.price ? `${fmt(q.price)} Jetons` : 'rien (offert)'}`}`);
      if (favBtn) favBtn.setAttribute('aria-pressed', String(prefs.isFavorite(e.id)));
      if (bill.hidden) return;
      // Détail du prix : chaque facteur (gêne mesurée sur le réglage réel, durée), le total, le solde après achat ; en
      // Lab, la demande exacte envoyée au moteur.
      bill.replaceChildren();
      const list = el('dl', 'ix-bill__list');
      for (const line of q.lines) list.append(el('dt', null, line.label), el('dd', null, line.value != null ? fmt(line.value) : line.pct != null ? `${line.pct} %` : line.mult != null ? mult(line.mult) : ''));
      list.append(el('dt', 'ix-bill__total', 'Prix'), el('dd', 'ix-bill__total', fmt(q.fullPrice)));
      if (q.credit) list.append(el('dt', 'ix-bill__credit', 'Payé avec ton crédit'), el('dd', 'ix-bill__credit', '0'));
      bill.append(list, el('p', 'ix-bill__after', q.credit ? `Ton solde ne bouge pas (${fmt(snap.balance)} Jetons, fictifs). Le crédit est rendu si l’effet ne démarre pas.` : `Solde (fictif) ${fmt(snap.balance)} → ${fmt(Math.max(0, snap.balance - q.price))} après l’achat. Arrondi à 50 Jetons.`));
      const req = el('details', 'ix-bill__engine');
      req.append(el('summary', null, 'Lab · demande envoyée au moteur'), el('code', null, JSON.stringify(engineRequest(e, choice))));
      bill.append(req);
    }
    quickBox.addEventListener('change', () => {
      prefs.setQuickBuy(quickBox.checked);
      armed = false;
      win.clearTimeout(armTimer);
      lastKey = '';
      update();
    });
    /** Envoi au faux Core (après un court délai réseau). Une intention = une clé : jamais deux débits pour un clic. */
    function submit() {
      if (busy || !q || q.block) return;
      armed = false;
      busy = true;
      win.clearTimeout(armTimer);
      intent ??= `ix-${e.id}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sent = { choice: structuredClone(choice), price: q.price, credit: payCredit, key: intent };
      update();
      win.setTimeout(() => {
        busy = false;
        if (destroyed || sheet?.card !== card) return;
        const out = mock.buy(e.id, sent.choice, sent.price, now(), undefined, { credit: sent.credit, key: sent.key });
        intent = null;
        if (!out.ok) {
          error.textContent = out.message;
          lastKey = '';
          return update();
        }
        error.textContent = '';
        if (sent.credit) payCredit = null;
        const o = out.outcome;
        // Échec au démarrage (Studio, moteur…) : déjà remboursé par le Core ; la fiche le dit au lieu de « c'est parti ».
        const failed = out.request.state === 'failed';
        done = failed
          ? { text: `Pas démarré (${(out.request.reason ?? 'panne').toLowerCase()}) : ${out.request.credit ? 'crédit rendu' : `${fmt(out.request.price)} Jetons rendus`}`, until: now() + 4000, kind: 'refunded' }
          : { text: o.kind === 'now' ? `${e.label} : c’est parti !` : o.kind === 'burst' ? `Clignement envoyé (${nth(o.position)} en attente)` : `Réservé : ${nth(o.position)} dans la file`, until: now() + 2600 };
        toast = { id: out.request.id, until: now() + 5000 };
        mockChanged(); // solde, file, modération : à jour partout tout de suite
        ctx.host.refresh?.(); // le solde de l'en-tête (Lab : celui du faux Core)
        win.clearTimeout(doneTimer);
        doneTimer = win.setTimeout(() => update(), 2700);
      }, 350);
    }
    // Deux temps par défaut, comme shared/purchase.js : le prix, puis « Confirmer » (4 s pour confirmer) ; un seul si le
    // viewer a coché « Ne plus demander confirmation ». Le prix est toujours sur le bouton ; le Core revérifie tout.
    // Protection : rien pendant l'envoi (une requête à la fois), et un double clic (< 0,25 s) ne compte qu'une fois ; un
    // clic volontaire après la réponse est un nouvel achat.
    cta.addEventListener('click', () => {
      const t = now();
      const double = t - lastClick < 250;
      lastClick = t;
      if (busy || q?.block || double) return;
      if (!armed && !prefs.quickBuy()) {
        armed = true;
        win.clearTimeout(armTimer);
        armTimer = win.setTimeout(() => {
          armed = false;
          update();
        }, 4000);
        return update();
      }
      submit();
    });
    update();
    return {
      card,
      content,
      back,
      update,
      startLive: () => pv.live(true),
      condOpen: () => !cond.hidden,
      inCond: (target) => cond.contains(target) || condBtn.contains(target),
      closeCond: () => !cond.hidden && toggleCond(false),
      destroy: () => {
        win.clearTimeout(armTimer);
        win.clearTimeout(doneTimer);
      },
      e,
      mode,
    };
  }

  function openSheet(effectId, fromNode, { credit = null } = {}) {
    if (reorder.dragging()) return;
    closePops();
    closeSheet({ instant: true });
    const s = buildSheet(effectId, 'viewer', { credit });
    s.from = fromNode ?? null;
    s.rebuild = () => openSheet(effectId, null);
    sheet = s;
    sheetLayer.replaceChildren(s.card);
    sheetLayer.hidden = false;
    root.classList.add('has-sheet');
    for (const t of tiles.values()) t.pv.live(false);
    const from = fromNode?.isConnected ? fromNode.getBoundingClientRect() : null;
    const to = s.card.getBoundingClientRect();
    let anim = null;
    if (from && to.width && to.height && !reduced() && typeof s.card.animate === 'function') {
      try {
        // La fiche part de sa carte : transformation et opacité seulement (composées par le GPU, rien à repeindre à
        // chaque image, même avec un aperçu chargé comme VHS) ; le contenu apparaît à la fin.
        s.card.style.transformOrigin = '0 0';
        const t0 = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
        anim = s.card.animate([{ transform: t0, opacity: 0.5 }, { transform: 'none', opacity: 1 }], { duration: 230, easing: 'cubic-bezier(.2,.75,.25,1)' });
        s.content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: 120, easing: 'ease-out', fill: 'backwards' });
      } catch {
        anim = null;
      }
    }
    // L'aperçu animé démarre une fois la fiche en place : jamais deux animations lourdes en même temps.
    const live = () => sheet === s && s.startLive();
    if (anim?.finished) anim.finished.then(live, live);
    else live();
    s.back.focus({ preventScroll: true, focusVisible: false });
  }

  function closeSheet({ instant = false } = {}) {
    const s = sheet;
    if (!s) return;
    sheet = null;
    s.destroy();
    root.classList.remove('has-sheet');
    const tile = tiles.get(s.e.id);
    const done = () => {
      if (sheet) return; // une autre fiche s'est ouverte entre-temps
      s.card.remove();
      sheetLayer.hidden = true;
    };
    const target = tile?.node.isConnected ? tile.node.getBoundingClientRect() : null;
    const box = s.card.getBoundingClientRect();
    if (!instant && !reduced() && target?.width && box.width && typeof s.card.animate === 'function') {
      try {
        s.card.style.transformOrigin = '0 0';
        const t1 = `translate(${target.left - box.left}px, ${target.top - box.top}px) scale(${target.width / box.width}, ${target.height / box.height})`;
        s.content.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' });
        s.card.animate([{ transform: 'none', opacity: 1 }, { transform: t1, opacity: 0.35 }], { duration: 190, easing: 'cubic-bezier(.4,0,.8,.4)', fill: 'forwards' }).finished.then(done, done);
      } catch {
        done();
      }
    } else done();
    if (!instant) (tile?.main ?? null)?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Popovers : en direct (ce qui joue et la file), Mes effets / Mes crédits, Lab.
  const pops = [
    [livePop, liveMain],
    [histPop, histBtn],
    [labPop, labBtn],
  ];
  let logOpen = false; // historique des crédits : petit panneau dans « Crédits », fermé par défaut
  let creditInfo = null; // le crédit dont on lit le détail (origine, motif)
  let histKey = '';
  function closePops() {
    for (const [pop, trigger] of pops) {
      pop.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
    creditBtn.setAttribute('aria-expanded', 'false');
    logOpen = false;
    creditInfo = null;
  }
  function togglePop(pop, trigger) {
    const open = pop.hidden;
    closePops();
    pop.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) paint();
  }
  const openHist = (which, trigger) => {
    if (!histPop.hidden && histTab === which) return closePops();
    histTab = which;
    closePops();
    histPop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    histKey = '';
    paint();
  };
  liveMain.addEventListener('click', () => togglePop(livePop, liveMain));
  histBtn.addEventListener('click', () => openHist('effects', histBtn));
  creditBtn.addEventListener('click', () => openHist('credits', creditBtn));
  labBtn.addEventListener('click', () => togglePop(labPop, labBtn));
  function closeLog() {
    logOpen = false;
    const log = histPop.querySelector('.ix-pop__log');
    if (log) log.hidden = true;
    histPop.querySelector('.ix-logbtn')?.setAttribute('aria-expanded', 'false');
    histKey = '';
  }
  // Clic à côté : ferme le panneau ouvert (Conditions de la fiche, historique des crédits, puis le popover).
  const onDocDown = (event) => {
    const t = event.target;
    if (sheet?.condOpen() && !sheet.inCond(t)) sheet.closeCond();
    if (pops.every(([p]) => p.hidden)) return;
    if (logOpen && !histPop.querySelector('.ix-pop__log')?.contains(t) && !histPop.querySelector('.ix-logbtn')?.contains(t)) {
      closeLog();
      if (histPop.contains(t)) return;
    }
    if (pops.some(([p, tr]) => p.contains(t) || tr.contains(t)) || creditBtn.contains(t)) return;
    closePops();
  };
  document.addEventListener('pointerdown', onDocDown, true);
  // Échap : sur tout le document tant que le module est affiché (un repeint du popover peut ôter le focus).
  const onKey = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !root.isConnected || reorder.dragging()) return;
    if (logOpen) {
      event.preventDefault();
      closeLog();
      histPop.querySelector('.ix-logbtn')?.focus();
    } else if (pops.some(([p]) => !p.hidden)) {
      event.preventDefault();
      const open = pops.find(([p]) => !p.hidden);
      const trigger = open?.[0] === histPop && histTab === 'credits' ? creditBtn : open?.[1];
      closePops();
      trigger?.focus();
    } else if (sheet?.closeCond()) {
      event.preventDefault();
    } else if (sheet) {
      event.preventDefault();
      closeSheet();
    }
  };
  document.addEventListener('keydown', onKey);

  function describeMine(r) {
    const back = r.credit ? 'crédit rendu' : `${fmt(r.price)} remboursés`;
    if (r.state === 'queued') return [`${nth(r.position)} dans la file · ~${mmss(r.eta)}`, 'queued'];
    if (r.state === 'active') return [`à l’écran · encore ${mmss(r.remaining)}`, 'active'];
    if (r.state === 'done') return [r.refunded ? `est passé · ${back}` : 'est passé', 'done'];
    if (r.state === 'expired') return [`jamais démarré · ${back}`, 'refunded'];
    if (r.state === 'removed') return [`arrêté par la modération${r.refunded ? ` · ${back}` : ''}`, 'removed'];
    if (r.state === 'cancelled') return [`retiré par la modération${r.refunded ? ` · ${back}` : ''}`, 'removed'];
    if (r.state === 'interrupted') return [`interrompu (Studio)${r.refunded ? ` · ${back}` : ''}`, 'refunded'];
    if (r.state === 'failed') return [`n’a pas pu démarrer (${(r.reason ?? 'panne').toLowerCase()})${r.refunded ? ` · ${back}` : ''}`, 'refunded'];
    return [r.state, 'done'];
  }
  const who = (r) => (r.by === 'mod' ? 'Modération' : r.mine ? 'Toi' : r.buyer.name);
  const LOG = { granted: 'Reçu', used: 'Utilisé', restored: 'Restitué', revoked: 'Annulé' };
  const LOG_HINT = { granted: 'offert', used: 'effet lancé', restored: 'l’effet n’a pas joué', revoked: 'retiré par la modération' };
  /** La contrainte essentielle d'un crédit, en quelques caractères (le détail s'ouvre au clic). */
  const shortTerms = (c) => (c.constraints?.maxS ? `${c.constraints.maxS} s max` : 'au choix') + (c.constraints?.levels?.length || c.constraints?.presets?.length ? ' · +' : '');

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
      liveMain.append(el('span', 'ix-live__idle', { open: 'Rien à l’écran', paused: 'Achats suspendus', disabled: 'Chaos désactivé', engine_down: 'Studio interrompu' }[snap.status] ?? 'Hors live'));
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
      // Reconstruit seulement si son contenu change (un clic n'est jamais perdu dans un repeint).
      const key = JSON.stringify([histTab, logOpen, creditInfo, snap.mine.map((r) => [r.id, r.state, r.position, r.eta, r.remaining, r.refunded]), snap.credits.map((c) => c.id), snap.creditLog.length, prefs.helpSeen()]);
      if (key !== histKey) {
        histKey = key;
        paintHist(snap);
      }
    }
  }

  function paintHist(snap) {
    // Le focus reste sur le même bouton après le repeint (clavier, lecteur d'écran).
    const active = histPop.contains(document.activeElement) ? document.activeElement : null;
    const refocus = active ? [active.className, active.textContent] : null;
    queueMicrotask(() => {
      if (!refocus || histPop.contains(document.activeElement)) return;
      [...histPop.querySelectorAll('button')].find((b) => b.className === refocus[0] && b.textContent === refocus[1])?.focus({ preventScroll: true });
    });
    histPop.replaceChildren();
    const head = el('div', 'ix-pop__head');
    const seg = el('div', 'ix-seg ix-seg--pop');
    seg.setAttribute('role', 'tablist');
    seg.setAttribute('aria-label', 'Mes effets ou mes crédits');
    for (const [id, label, count] of [
      ['effects', 'Effets', 0],
      ['credits', 'Crédits', snap.credits.length],
    ]) {
      const b = btn('ix-seg__opt', label);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(histTab === id));
      if (count) b.append(el('b', 'ix-seg__count', String(count)));
      b.addEventListener('click', () => {
        histTab = id;
        logOpen = false;
        creditInfo = null;
        paint();
      });
      seg.append(b);
    }
    head.append(seg);
    if (histTab === 'credits' && snap.creditLog.length) {
      const logBtn = btn('ix-logbtn', null, 'history');
      logBtn.title = 'Historique des crédits';
      logBtn.setAttribute('aria-label', 'Historique des crédits');
      logBtn.setAttribute('aria-expanded', String(logOpen));
      logBtn.addEventListener('click', () => {
        logOpen = !logOpen;
        paint();
      });
      head.append(logBtn);
    }
    histPop.append(head);
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
      return;
    }
    // Aide ponctuelle : une fois, puis plus jamais (pas d'explication permanente).
    if (!prefs.helpSeen() && snap.credits.length) {
      const help = el('p', 'ix-pop__help');
      help.append(el('span', null, 'Un crédit lance cet effet une fois, sans Jetons ; il est rendu si l’effet ne joue pas.'));
      const ok = btn('ix-pop__helpx', null, 'close');
      ok.setAttribute('aria-label', 'Compris');
      ok.title = 'Compris';
      ok.addEventListener('click', () => {
        prefs.markHelpSeen();
        paint();
      });
      help.append(ok);
      histPop.append(help);
    }
    if (!snap.credits.length) histPop.append(el('p', 'ix-pop__empty', 'Aucun crédit pour l’instant.'));
    for (const c of snap.credits) {
      const e = effectById(c.effect);
      const row = el('div', 'ix-cline');
      const main = btn('ix-cline__main');
      main.setAttribute('aria-expanded', String(creditInfo === c.id));
      main.title = 'Détail du crédit';
      main.append(glyph(document, c.effect), el('strong', null, e.label), el('span', 'ix-cline__terms', shortTerms(c)));
      main.addEventListener('click', () => {
        creditInfo = creditInfo === c.id ? null : c.id;
        paint();
      });
      const use = btn('ix-mini ix-mini--use', 'Utiliser');
      use.setAttribute('aria-label', `Utiliser mon crédit ${e.label}`);
      use.addEventListener('click', () => openSheet(c.effect, tiles.get(c.effect)?.node, { credit: c.id }));
      row.append(main, use);
      histPop.append(row);
      if (creditInfo === c.id) histPop.append(el('p', 'ix-cline__more', `${creditTerms(c)} · ${SOURCE[c.source.kind] ?? ''} (${c.source.by}) · « ${c.reason} »`));
    }
    if (logOpen) {
      const log = el('div', 'ix-pop__log');
      log.setAttribute('role', 'region');
      log.setAttribute('aria-label', 'Historique des crédits');
      for (const l of snap.creditLog.slice(0, 8)) {
        const row = el('div', 'ix-logline');
        const kind = el('span', `ix-logkind ix-logkind--${l.kind}`, LOG[l.kind] ?? l.kind);
        kind.title = LOG_HINT[l.kind] ?? '';
        row.append(kind, el('span', 'ix-logline__what', `${effectById(l.effect).label}${l.reason ? ` · « ${l.reason} »` : ''}`), el('span', 'ix-logline__at', new Date(l.at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })));
        log.append(row);
      }
      histPop.append(log);
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
    if (tab === 'chaos') headExtra.replaceChildren();

    // Bandeau d'état : ce qui concerne tout le module, en une phrase.
    const bannerText =
      snap.status === 'offline'
        ? ['offline', 'clock', 'Hors live : les effets reviennent au prochain live.']
        : snap.status === 'disabled'
          ? ['offline', 'shield', 'Chaos est désactivé pendant ce live.']
          : snap.status === 'engine_down'
            ? ['paused', 'pause', 'Studio ne répond plus : rien n’est débité, les achats reprennent dès son retour.']
            : snap.status === 'paused'
          ? ['paused', 'pause', 'Les achats d’effets sont suspendus. Ta place en file est gardée.']
          : snap.captureDown
            ? ['info', 'shield', 'Studio ne capte pas l’image du jeu en ce moment : seuls Brouillard, Paupières et Flash passent.']
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
      // Une carte n'est repeinte que si son état change (pas 13 cartes reconstruites chaque seconde).
      const key = JSON.stringify([kind, badge, reason, help, info.minPrice, info.credits]);
      if (tile.key === key) continue;
      tile.key = key;
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
      // Le faux Core avance seul (store.js) : la vue se repeint à chaque seconde et après chaque achat ou action.
      stopClock = subscribe(() => paint());
      paint();
      if (askOpen && effectById(askOpen) && !effectById(askOpen).planned && tab === 'chaos') win.requestAnimationFrame?.(() => openSheet(askOpen, tiles.get(askOpen)?.node));
      // Lab (?ixMod=1) : le bouclier de l'en-tête, comme un modérateur le toucherait.
      else if (askMod && ctx.team === true) win.setTimeout(() => document.querySelector('.jdm-modshield')?.click(), 60);
    },
    /** Section de la console de modération du bouclier de l'en-tête : FX sur Chaos, Bonk sur Bonk. */
    moderationSection: () => (tab === 'bonk' ? 'bonk' : 'chaos'),
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
    onState(next, prev) {
      latest = next;
      if (tab === 'bonk') drawBonk();
      return JSON.stringify(next?.wallet ?? null) === JSON.stringify(prev?.wallet ?? null);
    },
    destroy() {
      destroyed = true;
      stopClock?.();
      stopClock = null;
      sheet?.destroy();
      reorder.destroy();
      resize?.disconnect();
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey);
      bonk?.view.destroy?.();
      bonk = null;
    },
  };
}
