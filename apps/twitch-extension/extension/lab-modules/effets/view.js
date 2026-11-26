// LAB ONLY — vue du module « Effets live » (entrée : module.js ; spécification : docs/chaos/EXTENSION_EFFETS_LIVE.md).
// Trois onglets : Chaos (catalogue, réglage, achat, suivi), Bonk (le vrai écran Bonk, embarqué tel quel), Régie (équipe).
// Données : faux Core (model.js) ; aucun appel réseau, aucun Jeton réel. Trois directions d'affichage du catalogue
// (A Vitrine, B Liste, C Scène) se comparent depuis le panneau « Lab » de la vue.
import { everySecond } from '../../app/store.js';
import { loadLazyView } from '../../app/lazy-views.js';
import { moduleVariant } from '../../shared/module-registry.js';
import { EFFECTS, GROUPS, SLOTS, TIER_LABELS, defaultDuration, defaultTier, effectById } from './catalog.js';
import { SCENARIOS, createChaosMock, mmss } from './model.js';
import { glyph, preview, token } from './glyphs.js';

const DIRECTIONS = { a: 'Vitrine', b: 'Liste', c: 'Scène' };
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
const nth = (n) => (n === 1 ? '1er' : `${n}e`);

export function view(ctx) {
  const { document } = ctx;
  const query = new URLSearchParams(globalThis.location?.search ?? '');
  const memory = ctx.host.memory;
  const lab = (memory.lab ??= {
    dir: DIRECTIONS[query.get('ixDir')] ? query.get('ixDir') : 'a',
    scenario: SCENARIOS[query.get('ixScenario')] ? query.get('ixScenario') : 'normal',
    role: query.get('ixRole') === 'mod' ? 'mod' : 'viewer',
    open: false,
  });
  const fresh = () =>
    createChaosMock({ scenario: lab.scenario, balance: Number(ctx.state?.wallet?.available) || 12000, simulate: lab.scenario !== 'calme' });
  let mock = (memory.mock ??= fresh());
  let latest = ctx.state;
  let tab = ['chaos', 'bonk', 'regie'].includes(query.get('ixTab')) ? query.get('ixTab') : 'chaos';
  let group = 'all';
  let selected = null; // effet ouvert (A : feuille ; B : ligne dépliée ; C : carte de la scène)
  let stageIndex = 0;
  let trackOpen = false;
  let stopClock = null;
  let destroyed = false;
  const now = () => Date.now();
  const isTeam = () => lab.role === 'mod' || ctx.team === true;

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
  const price = (n, className = 'fx-price') => {
    const p = el('span', className);
    if (!n) p.append(el('span', 'fx-price__free', 'Offert'));
    else p.append(el('span', null, fmt(n)), token(document));
    return p;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Structure
  const root = el('div', 'fx');
  root.dataset.dir = lab.dir;
  const top = el('div', 'fx-top');
  const tabs = el('div', 'fx-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Effets live');
  const tabButtons = {};
  for (const [id, label, icon] of [['chaos', 'Chaos', 'chaos'], ['bonk', 'Bonk', 'bonk'], ['regie', 'Régie', 'shield']]) {
    const b = btn('fx-tab', label, icon);
    b.dataset.tab = id;
    b.setAttribute('role', 'tab');
    if (id === 'regie') b.append(el('span', 'fx-tab__count'));
    tabButtons[id] = b;
    tabs.append(b);
  }
  const topEnd = el('div', 'fx-top__end');
  const labToggle = btn('fx-labtoggle', 'Lab', 'lab');
  labToggle.title = 'Maquette : directions, scénarios, rôle (Lab seulement)';
  topEnd.append(labToggle);
  top.append(tabs, topEnd);

  // Panneau Lab : comparer les directions, changer de scénario et de rôle. Jamais montré à un viewer.
  const labPanel = el('div', 'fx-lab');
  labPanel.innerHTML = `<p class="fx-lab__note"><b>Maquette Lab</b> · données fictives (prix, file, viewers) ; aucun Jeton, aucun appel au Core.</p>`;
  const labRow = (label, node) => {
    const row = el('div', 'fx-lab__row');
    row.append(el('span', 'fx-lab__label', label), node);
    labPanel.append(row);
  };
  const seg = (items, current, onPick, key) => {
    const s = el('div', 'fx-seg fx-seg--lab');
    for (const [id, label] of items) {
      const b = btn('fx-seg__opt', label);
      b.dataset[key] = id;
      b.setAttribute('aria-pressed', String(id === current));
      b.addEventListener('click', () => onPick(id));
      s.append(b);
    }
    return s;
  };
  const dirSeg = seg(Object.entries(DIRECTIONS).map(([id, l]) => [id, `${id.toUpperCase()} · ${l}`]), lab.dir, (id) => {
    lab.dir = id;
    root.dataset.dir = id;
    selected = null;
    buildCatalog();
    paint();
  }, 'dir');
  labRow('Direction', dirSeg);
  const scenarioSelect = el('select', 'fx-lab__select');
  for (const [id, label] of Object.entries(SCENARIOS)) {
    const o = el('option', null, label);
    o.value = id;
    o.selected = id === lab.scenario;
    scenarioSelect.append(o);
  }
  scenarioSelect.addEventListener('change', () => {
    lab.scenario = scenarioSelect.value;
    mock = memory.mock = fresh();
    selected = null;
    buildCatalog();
    paint();
  });
  labRow('Scénario', scenarioSelect);
  const roleSeg = seg([['viewer', 'Viewer'], ['mod', 'Modérateur']], lab.role, (id) => {
    lab.role = id;
    if (id !== 'mod' && tab === 'regie') tab = 'chaos';
    paint();
  }, 'role');
  labRow('Rôle', roleSeg);
  labPanel.hidden = !lab.open;
  labToggle.addEventListener('click', () => {
    lab.open = !lab.open;
    labPanel.hidden = !lab.open;
    labToggle.setAttribute('aria-expanded', String(lab.open));
  });

  const panes = el('div', 'fx-panes');
  const chaosPane = el('section', 'fx-pane fx-pane--chaos');
  const bonkPane = el('section', 'fx-pane fx-pane--bonk');
  const regiePane = el('section', 'fx-pane fx-pane--regie');
  panes.append(chaosPane, bonkPane, regiePane);

  const track = el('div', 'fx-track');
  track.setAttribute('aria-live', 'polite');
  root.append(top, labPanel, panes, track);

  // ---------------------------------------------------------------------------------------------------------------
  // Chaos : bandeau d'état, « à l'écran », filtres, catalogue
  const banner = el('div', 'fx-banner');
  const now_ = el('div', 'fx-now');
  const nowLabel = el('span', 'fx-now__label', 'À l’écran');
  const nowList = el('div', 'fx-now__list');
  const nowQueue = el('span', 'fx-now__queue');
  now_.append(nowLabel, nowList, nowQueue);
  const filters = el('div', 'fx-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Familles d’effets');
  for (const [id, label] of [['all', 'Tout'], ...GROUPS.map((g) => [g.id, g.label])]) {
    const b = btn('fx-chip', label);
    b.dataset.group = id;
    filters.append(b);
  }
  const catalog = el('div', 'fx-catalog');
  const scroller = el('div', 'fx-scroll');
  scroller.append(filters, catalog);
  chaosPane.append(banner, now_, scroller);

  const visible = () => EFFECTS.filter((e) => group === 'all' || e.group === group);

  /** État affiché d'un effet sur sa carte / sa ligne : [classe, texte de la pastille, texte d'aide]. */
  function tileState(info) {
    const b = info.block;
    if (!b) return info.playing ? ['playing', `En cours · ${mmss(info.playing.remaining)}`, `En ce moment, lancé par ${info.playing.by}. Le tien passera juste après.`] : ['ok', null, null];
    if (b.code === 'cooldown' || b.code === 'global_cooldown') return ['cooldown', b.label, b.detail];
    if (b.code === 'mine_active' || b.code === 'mine_queued') return ['mine', b.label, b.detail];
    if (b.code === 'insufficient_funds') return ['poor', 'Solde', b.detail];
    return ['blocked', b.label, b.detail];
  }

  // --- Configurateur : aperçu, palier, durée, issue, prix, bouton en deux temps ---------------------------------
  function configurator(effect, { mode = 'viewer', compact = false, onDone } = {}) {
    const e = effectById(effect);
    const choice = (memory.choice ??= {})[`${mode}:${effect}`] ??= { tier: defaultTier(e), duration: defaultDuration(e) };
    const box = el('div', `fx-cfg${compact ? ' fx-cfg--compact' : ''}`);
    box.dataset.effect = effect;
    const pv = preview(document, effect, choice.tier, { live: true, big: true });
    const head = el('div', 'fx-cfg__head');
    const title = el('div', 'fx-cfg__title');
    title.append(glyph(document, effect, 'fx-ico fx-cfg__ico'), el('strong', null, e.label));
    head.append(title, el('p', 'fx-cfg__pitch', e.pitch));
    const rows = el('div', 'fx-cfg__rows');
    const tierSeg = el('div', 'fx-seg');
    tierSeg.setAttribute('role', 'radiogroup');
    tierSeg.setAttribute('aria-label', e.tierKind === 'level' ? 'Intensité' : 'Style');
    if (e.tiers.length > 1) {
      e.tiers.forEach((t, i) => {
        const b = btn('fx-seg__opt', TIER_LABELS[t] ?? t);
        b.dataset.tier = t;
        b.setAttribute('role', 'radio');
        if (e.tierKind === 'level') {
          const meter = el('i', 'fx-meter');
          meter.style.setProperty('--lv', String((i + 1) / e.tiers.length));
          b.prepend(meter);
        }
        tierSeg.append(b);
      });
      const r = el('div', 'fx-cfg__row');
      r.append(el('span', 'fx-cfg__label', e.tierKind === 'level' ? 'Intensité' : 'Style'), tierSeg);
      rows.append(r);
    }
    const durSeg = el('div', 'fx-seg fx-seg--dur');
    durSeg.setAttribute('role', 'radiogroup');
    durSeg.setAttribute('aria-label', 'Durée');
    for (const d of e.durations) {
      const b = btn('fx-seg__opt', `${d} s`);
      b.dataset.duration = String(d);
      b.setAttribute('role', 'radio');
      durSeg.append(b);
    }
    const dr = el('div', 'fx-cfg__row');
    dr.append(el('span', 'fx-cfg__label', 'Durée'), durSeg);
    rows.append(dr);
    const stack = el('p', 'fx-cfg__stack');
    stack.append(glyph(document, 'queue'), el('span', null, `${SLOTS[e.slot].rule}. Même effet déjà à l’écran : le tien passe juste après.`));

    const foot = el('div', 'fx-cfg__foot');
    const outcome = el('p', 'fx-cfg__outcome');
    const cta = btn('fx-cta');
    const ctaText = el('span', 'fx-cta__text');
    const ctaPrice = el('span', 'fx-cta__price');
    cta.append(ctaText, ctaPrice);
    const error = el('p', 'fx-cfg__error');
    foot.append(outcome, cta, error);
    // Deux colonnes sur grand écran (aperçu et texte | réglages et achat) ; une seule colonne sinon (display: contents).
    const side = el('div', 'fx-cfg__side');
    side.append(pv, head, stack);
    const main = el('div', 'fx-cfg__main');
    main.append(rows, foot);
    box.append(side, main);

    let armed = false;
    let busy = false;
    let armTimer = null;
    let q = null;
    function update() {
      const t = now();
      q = mode === 'mod' ? { price: 0, outcome: { kind: 'now' }, block: null } : mock.quote(effect, choice.tier, choice.duration, t);
      for (const b of tierSeg.children) b.setAttribute('aria-checked', String(b.dataset.tier === choice.tier));
      for (const b of durSeg.children) b.setAttribute('aria-checked', String(Number(b.dataset.duration) === choice.duration));
      pv.dataset.tier = choice.tier;
      outcome.replaceChildren();
      outcome.dataset.kind = q.block ? 'block' : q.outcome.kind;
      if (mode === 'mod') outcome.append(glyph(document, 'gift'), el('span', null, 'Offert par la modération · passe devant la file'));
      else if (q.block) outcome.append(glyph(document, 'clock'), el('span', null, q.block.detail));
      else if (q.outcome.kind === 'now') outcome.append(glyph(document, 'play'), el('span', null, 'Démarre tout de suite'));
      else outcome.append(glyph(document, 'queue'), el('span', null, `En file · ${nth(q.outcome.position)} · environ ${mmss(q.outcome.eta)} d’attente`));
      cta.disabled = busy || Boolean(q.block);
      cta.dataset.state = busy ? 'busy' : armed ? 'armed' : 'idle';
      ctaText.textContent = busy ? 'Envoi…' : armed ? 'Confirmer ?' : mode === 'mod' ? 'Lancer pour le stream' : q.outcome.kind === 'now' ? 'Lancer' : 'Mettre en file';
      ctaPrice.replaceChildren(price(q.price, 'fx-price fx-price--cta'));
    }
    box.addEventListener('click', (event) => {
      const t = event.target.closest('button');
      if (!t || !box.contains(t)) return;
      if (t.dataset.tier) choice.tier = t.dataset.tier;
      else if (t.dataset.duration) choice.duration = Number(t.dataset.duration);
      else if (t === cta) return void act();
      else return;
      armed = false;
      error.textContent = '';
      update();
    });
    // Deux temps, comme shared/purchase.js : le prix, puis la confirmation (4 s pour confirmer).
    function act() {
      if (busy || q?.block) return;
      if (!armed) {
        armed = true;
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { armed = false; update(); }, 4000);
        return update();
      }
      armed = false;
      busy = true;
      update();
      // Le faux Core répond après un court délai réseau.
      setTimeout(() => {
        busy = false;
        if (destroyed) return;
        const t = now();
        const out = mode === 'mod' ? mock.moderation.trigger(effect, choice.tier, choice.duration, t) : mock.buy(effect, choice.tier, choice.duration, q.price, t);
        if (!out.ok) {
          error.textContent = out.message;
          update();
          return;
        }
        onDone?.(out);
      }, 350);
    }
    update();
    return { node: box, update, destroy: () => clearTimeout(armTimer) };
  }

  // --- Direction A : vitrine (cartes) + feuille de réglage -----------------------------------------------------
  // --- Direction B : liste, réglage déplié dans la ligne ----------------------------------------------------------
  // --- Direction C : scène (une grande carte à la fois, réglage dessous) ------------------------------------------
  let tiles = new Map();
  let cfg = null; // configurateur ouvert
  const sheet = el('div', 'fx-sheet');
  sheet.hidden = true;
  const sheetBackdrop = el('div', 'fx-sheet__backdrop');
  const sheetPanel = el('div', 'fx-sheet__panel');
  sheetPanel.setAttribute('role', 'dialog');
  sheetPanel.setAttribute('aria-modal', 'false');
  const sheetClose = btn('fx-sheet__close', null, 'close');
  sheetClose.setAttribute('aria-label', 'Fermer');
  sheet.append(sheetBackdrop, sheetPanel);
  root.append(sheet);
  sheetBackdrop.addEventListener('click', () => select(null));
  sheetClose.addEventListener('click', () => select(null));

  function bought(out) {
    trackFocus = out.request.id;
    select(null);
    paint();
  }

  function select(id) {
    selected = id;
    cfg?.destroy();
    cfg = null;
    if (lab.dir === 'a') {
      sheet.hidden = !id;
      sheetPanel.replaceChildren();
      if (id) {
        cfg = configurator(id, { onDone: bought });
        sheetPanel.append(sheetClose, cfg.node);
        sheetPanel.setAttribute('aria-label', `Régler ${effectById(id).label}`);
      }
    } else if (lab.dir === 'b') {
      for (const [eid, t] of tiles) {
        t.node.classList.toggle('is-open', eid === id);
        t.body.replaceChildren();
        t.head.setAttribute('aria-expanded', String(eid === id));
      }
      if (id) {
        cfg = configurator(id, { compact: true, onDone: bought });
        tiles.get(id)?.body.append(cfg.node);
        tiles.get(id)?.node.scrollIntoView?.({ block: 'start' });
      }
    } else if (lab.dir === 'c') {
      buildStage();
    }
    paint();
  }

  function buildCatalog() {
    cfg?.destroy();
    cfg = null;
    sheet.hidden = true;
    tiles = new Map();
    catalog.replaceChildren();
    catalog.dataset.dir = lab.dir;
    const list = visible();
    if (lab.dir === 'c') {
      stageIndex = Math.min(stageIndex, list.length - 1);
      return buildStage();
    }
    for (const e of list) {
      if (lab.dir === 'a') {
        const node = btn('fx-tile');
        node.dataset.effect = e.id;
        const pv = preview(document, e.id, defaultTier(e));
        const badge = el('span', 'fx-badge');
        const name = el('span', 'fx-tile__name', e.label);
        const meta = el('span', 'fx-tile__meta');
        node.append(pv, badge, name, meta);
        node.addEventListener('click', () => select(e.id));
        node.addEventListener('pointerenter', () => { pv.dataset.live = '1'; });
        node.addEventListener('pointerleave', () => { delete pv.dataset.live; });
        catalog.append(node);
        tiles.set(e.id, { node, badge, meta, e });
      } else {
        const node = el('div', 'fx-row');
        node.dataset.effect = e.id;
        const head = btn('fx-row__head');
        head.setAttribute('aria-expanded', 'false');
        const ico = el('span', 'fx-row__ico');
        ico.append(glyph(document, e.id));
        const text = el('span', 'fx-row__text');
        text.append(el('strong', 'fx-row__name', e.label), el('span', 'fx-row__pitch', e.pitch));
        const badge = el('span', 'fx-badge');
        const meta = el('span', 'fx-row__meta');
        head.append(ico, text, badge, meta);
        head.addEventListener('click', () => select(selected === e.id ? null : e.id));
        const body = el('div', 'fx-row__body');
        node.append(head, body);
        catalog.append(node);
        tiles.set(e.id, { node, head, body, badge, meta, e });
      }
    }
    if (selected && !list.some((e) => e.id === selected)) selected = null;
    if (selected) select(selected);
  }

  function buildStage() {
    cfg?.destroy();
    catalog.replaceChildren();
    tiles = new Map();
    const list = visible();
    const e = list[stageIndex] ?? list[0];
    if (!e) return;
    selected = e.id;
    const stage = el('div', 'fx-stage');
    const prev = btn('fx-stage__nav', null, 'chevL');
    prev.setAttribute('aria-label', 'Effet précédent');
    const next = btn('fx-stage__nav', null, 'chevR');
    next.setAttribute('aria-label', 'Effet suivant');
    const card = el('div', 'fx-stage__card');
    const badge = el('span', 'fx-badge');
    card.append(badge);
    cfg = configurator(e.id, { compact: true, onDone: bought });
    card.append(cfg.node);
    stage.append(prev, card, next);
    const dots = el('div', 'fx-dots');
    list.forEach((x, i) => {
      const d = btn('fx-dot');
      d.setAttribute('aria-label', x.label);
      d.setAttribute('aria-current', String(i === stageIndex));
      d.addEventListener('click', () => { stageIndex = i; buildStage(); paint(); });
      dots.append(d);
    });
    const go = (k) => { stageIndex = (stageIndex + k + list.length) % list.length; buildStage(); paint(); };
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    catalog.append(stage, dots);
    tiles.set(e.id, { node: card, badge, meta: null, e });
  }

  filters.addEventListener('click', (event) => {
    const b = event.target.closest('[data-group]');
    if (!b) return;
    group = b.dataset.group;
    stageIndex = 0;
    selected = null;
    buildCatalog();
    paint();
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Suivi : la dernière demande du viewer, en une ligne au pied du module ; « Mes effets » au toucher.
  let trackFocus = null;
  const trackMain = btn('fx-track__main');
  const trackList = el('div', 'fx-track__list');
  trackList.hidden = true;
  track.append(trackList, trackMain);
  trackMain.addEventListener('click', () => {
    trackOpen = !trackOpen;
    trackList.hidden = !trackOpen;
    trackMain.setAttribute('aria-expanded', String(trackOpen));
  });

  function describeMine(r) {
    if (r.state === 'queued') return [`${nth(r.position)} dans la file · environ ${mmss(r.eta)}`, 'queued'];
    if (r.state === 'active') return [`à l’écran · encore ${mmss(r.remaining)}`, 'active'];
    if (r.state === 'done') return ['est passé', 'done'];
    if (r.state === 'expired') return [`pas joué à temps · ${fmt(r.price)} Jetons remboursés`, 'refunded'];
    if (r.state === 'removed') return [`arrêté par la modération${r.refunded ? ` · ${fmt(r.price)} Jetons remboursés` : ''}`, 'removed'];
    if (r.state === 'cancelled') return [`annulé par la modération${r.refunded ? ` · ${fmt(r.price)} Jetons remboursés` : ''}`, 'removed'];
    return [r.state, 'done'];
  }

  function paintTrack(snap) {
    const mine = snap.mine;
    const focus = mine.find((r) => r.id === trackFocus) ?? mine.find((r) => r.state === 'queued' || r.state === 'active') ?? null;
    const recent = focus ?? mine.find((r) => r.finished && now() - r.finished < 8000) ?? null;
    track.hidden = (!recent && !mine.length) || (tab !== 'chaos' && !(recent && (recent.state === 'queued' || recent.state === 'active')));
    trackMain.replaceChildren();
    if (recent) {
      const [text, kind] = describeMine(recent);
      trackMain.dataset.kind = kind;
      const bar = el('i', 'fx-track__bar');
      if (recent.progress != null) bar.style.setProperty('--p', String(recent.progress));
      trackMain.append(glyph(document, recent.effect), el('strong', null, `Ton ${recent.label}`), el('span', null, text), bar);
    } else {
      trackMain.dataset.kind = 'idle';
      trackMain.append(glyph(document, 'clock'), el('strong', null, 'Mes effets'), el('span', null, `${mine.length} récents`));
    }
    trackList.replaceChildren(el('p', 'fx-track__title', 'Mes effets récents'));
    for (const r of mine) {
      const [text, kind] = describeMine(r);
      const row = el('div', 'fx-track__row');
      row.dataset.kind = kind;
      row.append(glyph(document, r.effect), el('strong', null, `${r.label} · ${TIER_LABELS[r.tier] ?? r.tier} · ${r.duration} s`), el('span', null, text), price(r.price));
      trackList.append(row);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Régie (équipe) : pause, tout arrêter, offrir un effet ; en cours, file, historique, avec leurs actions.
  const regieTools = el('div', 'fx-regie__tools');
  const pauseBtn = btn('fx-tool', 'Mettre en pause', 'pause');
  const stopBtn = btn('fx-tool fx-tool--danger', 'Tout arrêter', 'stop');
  const giftBtn = btn('fx-tool', 'Offrir un effet', 'gift');
  regieTools.append(pauseBtn, stopBtn, giftBtn);
  const regieGift = el('div', 'fx-regie__gift');
  regieGift.hidden = true;
  const regieScroll = el('div', 'fx-scroll fx-regie');
  const sec = (title) => {
    const s = el('section', 'fx-sec');
    const h = el('h3', 'fx-sec__title');
    const count = el('span', 'fx-sec__count');
    h.append(el('span', null, title), count);
    const list = el('div', 'fx-sec__list');
    s.append(h, list);
    regieScroll.append(s);
    return { s, count, list };
  };
  const secActive = sec('À l’écran');
  const secQueue = sec('File d’attente');
  const secHistory = sec('Historique récent');
  regiePane.append(regieTools, regieGift, regieScroll);
  const confirmOpen = new Map(); // id → 'cancel' | 'remove' | 'refund' | 'stop'
  let flash = null;

  pauseBtn.addEventListener('click', () => {
    const snap = mock.snapshot(now());
    mock.moderation.setPaused(snap.status === 'open');
    flash = snap.status === 'open' ? 'Chaos en pause : plus aucun achat, la file attend.' : 'Chaos repris.';
    paint();
  });
  stopBtn.addEventListener('click', () => {
    confirmOpen.set('__stop', 'stop');
    paint();
  });
  giftBtn.addEventListener('click', () => {
    regieGift.hidden = !regieGift.hidden;
    giftBtn.setAttribute('aria-expanded', String(!regieGift.hidden));
    if (!regieGift.hidden) buildGift();
  });

  let giftCfg = null;
  function buildGift(effectId = 'mirror') {
    giftCfg?.destroy();
    regieGift.replaceChildren();
    const pick = el('div', 'fx-gift__pick');
    for (const e of EFFECTS) {
      const b = btn('fx-gift__fx', null, e.id);
      b.title = e.label;
      b.setAttribute('aria-label', e.label);
      b.setAttribute('aria-pressed', String(e.id === effectId));
      b.addEventListener('click', () => buildGift(e.id));
      pick.append(b);
    }
    giftCfg = configurator(effectId, {
      mode: 'mod',
      compact: true,
      onDone: () => {
        flash = `${effectById(effectId).label} offert au stream.`;
        regieGift.hidden = true;
        paint();
      },
    });
    regieGift.append(pick, giftCfg.node);
  }

  function confirmBox(id, kind, r) {
    const box = el('div', 'fx-confirm');
    const reason = el('input', 'fx-confirm__reason');
    reason.type = 'text';
    reason.maxLength = 80;
    reason.placeholder = 'Motif (obligatoire sans remboursement)';
    reason.setAttribute('aria-label', 'Motif');
    const close = () => { confirmOpen.delete(id); paint(); };
    const done = (out, text) => {
      confirmOpen.delete(id);
      flash = out.ok ? text : out.message;
      paint();
    };
    if (kind === 'stop') {
      box.append(el('p', null, 'Arrêter tout ce qui est à l’écran ? Chaos passe en pause, la file attend. Remboursé d’office si l’effet a joué moins de 25 % de sa durée.'));
      const yes = btn('fx-mini fx-mini--danger', 'Tout arrêter');
      yes.addEventListener('click', () => done(mock.moderation.stopAll(now()), 'Tout est arrêté, Chaos en pause.'));
      const no = btn('fx-mini', 'Retour');
      no.addEventListener('click', close);
      const acts = el('div', 'fx-confirm__acts');
      acts.append(yes, no);
      box.append(acts);
      return box;
    }
    const early = r?.state === 'active' && r.progress < 0.25;
    const text = kind === 'refund'
      ? `Rembourser ${fmt(r.price)} Jetons à ${r.buyer.name} ?`
      : kind === 'cancel'
        ? `Retirer la demande de ${r.buyer.name} de la file ?`
        : `Arrêter ${r.label} de ${r.buyer.name} ? Joué à ${Math.round((r.progress ?? 0) * 100)} %${early ? ' : remboursement conseillé.' : '.'}`;
    box.append(el('p', null, text));
    box.append(reason);
    const acts = el('div', 'fx-confirm__acts');
    const need = () => reason.value.trim().length >= 3;
    if (kind === 'refund') {
      const yes = btn('fx-mini fx-mini--ok', 'Rembourser');
      yes.addEventListener('click', () => {
        if (!need()) return reason.focus();
        done(mock.moderation.refund(r.id, reason.value.trim(), now()), `${fmt(r.price)} Jetons rendus à ${r.buyer.name}.`);
      });
      acts.append(yes);
    } else {
      const op = kind === 'cancel' ? mock.moderation.cancel : mock.moderation.remove;
      if (r.price) {
        const withRefund = btn('fx-mini fx-mini--ok', kind === 'cancel' ? 'Annuler et rembourser' : 'Arrêter et rembourser');
        withRefund.addEventListener('click', () => done(op(r.id, { refund: true, reason: reason.value.trim() || null }, now()), `${r.label} retiré, ${fmt(r.price)} Jetons rendus.`));
        acts.append(withRefund);
      }
      const without = btn('fx-mini fx-mini--danger', r.price ? 'Sans rembourser' : kind === 'cancel' ? 'Annuler' : 'Arrêter');
      without.addEventListener('click', () => {
        if (r.price && !need()) {
          reason.classList.add('is-required');
          return reason.focus();
        }
        done(op(r.id, { refund: false, reason: reason.value.trim() || null }, now()), `${r.label} retiré, sans remboursement.`);
      });
      acts.append(without);
    }
    const no = btn('fx-mini', 'Retour');
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
      const node = el('div', 'fx-req');
      node.dataset.kind = kind;
      const ico = el('span', 'fx-req__ico');
      ico.append(glyph(document, r.effect));
      const main = el('div', 'fx-req__main');
      const line1 = el('div', 'fx-req__line');
      const line2 = el('div', 'fx-req__sub');
      main.append(line1, line2);
      const side = el('div', 'fx-req__side');
      const action = btn('fx-mini');
      side.append(action);
      const bar = el('i', 'fx-req__bar');
      node.append(ico, main, side, bar);
      action.addEventListener('click', () => {
        const k = kind === 'queue' ? 'cancel' : kind === 'active' ? 'remove' : 'refund';
        if (confirmOpen.get(r.id)) confirmOpen.delete(r.id);
        else confirmOpen.set(r.id, k);
        paint();
      });
      row = { node, line1, line2, action, bar, side, confirm: null };
      rowCache.set(key, row);
    }
    row.line1.replaceChildren(el('strong', null, r.label), el('span', 'fx-req__tier', `${TIER_LABELS[r.tier] ?? r.tier} · ${r.duration} s`), price(r.price, 'fx-price fx-price--sm'));
    const who = r.by === 'mod' ? 'Offert par la modération' : r.mine ? 'Toi' : r.buyer.name;
    if (kind === 'queue') row.line2.textContent = `${who} · ${nth(r.position)} · départ ~${mmss(r.eta)} · expire dans ${mmss(r.expiresIn)}`;
    else if (kind === 'active') row.line2.textContent = `${who} · encore ${mmss(r.remaining)}`;
    else {
      const what = { done: 'joué', expired: 'expiré', removed: 'arrêté', cancelled: 'annulé' }[r.state] ?? r.state;
      const by = r.actor ? ` par ${r.actor}` : '';
      const why = r.reason ? ` · « ${r.reason} »` : '';
      const refund = r.refunded ? ' · remboursé' : '';
      row.line2.textContent = `${who} · ${what}${by}${refund}${why}`;
    }
    row.node.dataset.state = r.state;
    row.node.classList.toggle('is-refunded', r.refunded);
    if (r.progress != null) row.bar.style.setProperty('--p', String(r.progress));
    const actLabel = kind === 'queue' ? 'Annuler' : kind === 'active' ? 'Arrêter' : 'Rembourser';
    row.action.replaceChildren(el('span', null, actLabel));
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

  function paintList(target, items, kind, empty) {
    const nodes = items.map((r) => regieRow(r, kind));
    if (!nodes.length) nodes.push(el('p', 'fx-empty', empty));
    target.list.replaceChildren(...nodes);
  }

  let stopBox = null;
  function paintRegie(snap) {
    pauseBtn.replaceChildren(glyph(document, snap.status === 'paused' ? 'play' : 'pause'), el('span', null, snap.status === 'paused' ? 'Reprendre' : 'Mettre en pause'));
    pauseBtn.disabled = snap.status === 'offline';
    stopBtn.disabled = !snap.active.length;
    paintList(secActive, snap.active, 'active', 'Rien à l’écran.');
    paintList(secQueue, snap.queue, 'queue', 'Personne n’attend.');
    paintList(secHistory, snap.history.slice(0, 12), 'history', 'Aucun effet récemment.');
    secActive.count.textContent = String(snap.active.length);
    secQueue.count.textContent = `${snap.queue.length}/${snap.queueMax}`;
    secHistory.count.textContent = '';
    if (confirmOpen.get('__stop') && !stopBox) {
      stopBox = confirmBox('__stop', 'stop');
      regieTools.after(stopBox);
    } else if (!confirmOpen.get('__stop') && stopBox) {
      stopBox.remove();
      stopBox = null;
    }
    // Les lignes disparues de la vue sont oubliées (une ligne d'historique garde son état tant qu'elle reste).
    const live = new Set([...snap.active.map((r) => `active:${r.id}`), ...snap.queue.map((r) => `queue:${r.id}`), ...snap.history.slice(0, 12).map((r) => `history:${r.id}`)]);
    for (const k of rowCache.keys()) if (!live.has(k)) rowCache.delete(k);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Bonk : le vrai écran Bonk (shared/bonk-view.js), embarqué tel quel dans l'onglet.
  let bonk = null; // { def, view, wrap, body }
  let bonkLoading = false;
  const bonkModule = (state) => (state?.modules ?? []).find((m) => m.id === 'bonk') ?? null;
  async function showBonk() {
    if (bonk || bonkLoading) return drawBonk();
    const mod = bonkModule(latest);
    if (!mod) {
      bonkPane.replaceChildren(el('p', 'fx-empty', 'Bonk n’est pas proposé pendant ce live.'));
      return;
    }
    bonkLoading = true;
    bonkPane.replaceChildren(el('p', 'fx-empty', 'Chargement de Bonk…'));
    try {
      await loadLazyView('bonk');
    } catch {
      bonkLoading = false;
      bonkPane.replaceChildren(el('p', 'fx-empty', 'Bonk n’a pas pu se charger.'));
      return;
    }
    bonkLoading = false;
    if (destroyed) return;
    const def = moduleVariant({ module: mod, state: latest, client: ctx.client, document });
    if (!def) return;
    // Même cadre que l'hôte donne à Bonk (ses feuilles visent .jdm-module[data-module="bonk"] .jdm-module__body).
    const wrap = el('section', 'jdm-module is-open fx-bonk');
    wrap.dataset.module = 'bonk';
    const body = el('div', 'jdm-module__body');
    wrap.append(body);
    const bctx = { ...ctx, module: mod, state: latest, body, host: { ...ctx.host, memory: (memory.bonk ??= {}) } };
    const v = def.view(bctx);
    bonk = { def, view: v, wrap, body, bctx };
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
    // Le « ? » du tutoriel Bonk : à droite des onglets, comme dans son en-tête.
    const help = bonk.def.headAfter?.(bonk.view, c);
    topEnd.querySelector('.fx-bonkhelp')?.remove();
    if (help && tab === 'bonk') {
      help.classList.add('fx-bonkhelp');
      topEnd.prepend(help);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  tabs.addEventListener('click', (event) => {
    const b = event.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    selected = lab.dir === 'c' ? selected : null;
    if (lab.dir === 'a') sheet.hidden = true;
    paint();
  });

  function paint() {
    if (destroyed) return;
    const t = now();
    const snap = mock.snapshot(t);
    const team = isTeam();
    if (!team && tab === 'regie') tab = 'chaos';
    root.dataset.tab = tab;
    root.dataset.status = snap.status;
    for (const [id, b] of Object.entries(tabButtons)) {
      b.setAttribute('aria-selected', String(id === tab));
      b.tabIndex = id === tab ? 0 : -1;
    }
    tabButtons.regie.hidden = !team;
    tabButtons.regie.querySelector('.fx-tab__count').textContent = snap.queue.length ? String(snap.queue.length) : '';
    tabButtons.bonk.hidden = !bonkModule(latest);
    chaosPane.hidden = tab !== 'chaos';
    bonkPane.hidden = tab !== 'bonk';
    regiePane.hidden = tab !== 'regie';
    if (tab !== 'bonk') topEnd.querySelector('.fx-bonkhelp')?.remove();
    for (const b of labPanel.querySelectorAll('[data-dir]')) b.setAttribute('aria-pressed', String(b.dataset.dir === lab.dir));
    for (const b of labPanel.querySelectorAll('[data-role]')) b.setAttribute('aria-pressed', String(b.dataset.role === lab.role));

    // Bandeau : ce qui concerne tout le module, en une phrase.
    const bannerText = snap.status === 'offline'
      ? ['offline', 'Hors live : les effets reviennent au prochain live.']
      : snap.status === 'paused'
        ? ['paused', 'Le streamer a mis les effets en pause. Ta place en file est gardée.']
        : snap.exclusive
          ? ['info', `${snap.game} est en plein écran exclusif : seuls Brouillard, Clignement et Flash passent.`]
          : snap.safe
            ? ['info', 'Mode doux ce soir : les effets lumineux sont coupés.']
            : null;
    banner.hidden = !bannerText;
    if (bannerText) {
      banner.dataset.tone = bannerText[0];
      banner.replaceChildren(glyph(document, bannerText[0] === 'paused' ? 'pause' : bannerText[0] === 'offline' ? 'clock' : 'shield'), el('span', null, bannerText[1]));
    }

    // À l'écran : ce qui joue, et la file.
    nowList.replaceChildren();
    for (const a of snap.active) {
      const chip = el('span', 'fx-nowchip');
      chip.style.setProperty('--p', String(a.progress));
      chip.append(glyph(document, a.effect), el('span', null, effectById(a.effect).label), el('b', null, mmss(a.remaining)));
      chip.title = `${a.label} · ${a.by === 'mod' ? 'Modération' : a.buyer.name}`;
      if (a.mine) chip.classList.add('is-mine');
      nowList.append(chip);
    }
    if (!snap.active.length) nowList.append(el('span', 'fx-now__empty', snap.status === 'open' ? 'Rien pour l’instant : lance le premier !' : '—'));
    nowQueue.replaceChildren(glyph(document, 'queue'), el('span', null, `File ${snap.queue.length}/${snap.queueMax}`));
    nowQueue.dataset.full = String(snap.queue.length >= snap.queueMax);

    for (const b of filters.querySelectorAll('[data-group]')) b.setAttribute('aria-pressed', String(b.dataset.group === group));

    // Cartes / lignes.
    for (const info of snap.effects) {
      const tile = tiles.get(info.id);
      if (!tile) continue;
      const [kind, badge, help] = tileState(info);
      tile.node.dataset.state = kind;
      tile.badge.hidden = !badge;
      tile.badge.dataset.kind = kind;
      tile.badge.textContent = badge ?? '';
      if (tile.meta) {
        tile.meta.replaceChildren(el('span', 'fx-from', 'dès'), price(info.minPrice));
        tile.meta.title = help ?? '';
      }
      tile.node.title = help ?? '';
      if (lab.dir === 'a') tile.node.setAttribute('aria-label', `${effectById(info.id).label}, dès ${fmt(info.minPrice)} Jetons${badge ? `, ${badge}` : ''}`);
    }
    cfg?.update();
    if (!regieGift.hidden) giftCfg?.update();
    paintTrack(snap);
    if (tab === 'regie') paintRegie(snap);
    if (flash) {
      const f = el('p', 'fx-flash', flash);
      regiePane.querySelector('.fx-flash')?.remove();
      regieTools.after(f);
      const shown = flash;
      flash = null;
      setTimeout(() => { if (f.textContent === shown) f.remove(); }, 3500);
    }
    if (tab === 'bonk') void showBonk();
  }

  buildCatalog();
  if (query.get('ixOpen') && effectById(query.get('ixOpen'))) select(query.get('ixOpen'));

  return {
    node: root,
    start() {
      stopClock = everySecond((t) => {
        mock.tick(t);
        paint();
      });
      paint();
    },
    /** Rafraîchissement de l'hôte (nouvel état de session) : le solde, Bonk. */
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
      cfg?.destroy();
      giftCfg?.destroy();
      bonk?.view.destroy?.();
      bonk = null;
    },
  };
}
