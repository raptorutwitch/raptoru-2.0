// Soundboard — the module's whole screen, out of ui.js (docs/studio-refonte/architecture/MIGRATIONS.md). A module
// variant (module-registry.js) like TTS V2 and Tombola V2, with the same lifecycle: created when the viewer opens the
// Soundboard, drawn at each host redraw (`rendered`), a new state it can ignore is absorbed (`onState`: identical state,
// or a card being dragged — the new state is drawn once the card is dropped), destroyed when the viewer leaves.
//
// What it owns: the form's drafts (kept between visits in host.memory), the preview (its audio), the toast of the last
// send, the volume popover (built once per visit, shown in the host's header via `headIcon`), the drag, the cooldown
// countdown and its listeners (Escape, a click outside). What it asks the host (ctx.host): the session's payment choice
// and header switch, the action runner (busy flag, refresh, notifications), the module restriction, whether
// interactions are open, a redraw, the viewer-facing reason of an error. Core stays the authority on every send.

import { registerModuleVariant } from './module-registry.js';
import { createCurrencySwitch, normalizeSearchQuery } from './ui-primitives.js';
import { hoverMarquee } from './hover-marquee.js';
import { walletPaymentMethods, walletCanPayTokens } from './wallet-payment.js';
import { createSoundPreview, soundPreviewUrls } from './soundboard-preview.js';
import { createSoundboardFeedback } from './soundboard-feedback.js';
import { readStoredIds, writeStoredIds, rememberStoredId } from './stored-ids.js';
import {
  SOUNDBOARD_ALIAS_MAX_LENGTH,
  SOUNDBOARD_ALIASES_KEY,
  SOUNDBOARD_FAVORITES_KEY,
  SOUNDBOARD_ORDER_KEY,
  SOUNDBOARD_RECENTS_KEY,
  aliasValue,
  moveSoundboardItem,
  normalizeSoundboardAlias,
  normalizeSoundboardOrder,
  readStoredAliases,
  reorderSoundboardVisibleSubset,
  soundboardDropSlot,
  soundboardSoundLabel,
  soundboardSoundMatchesQuery,
  sortSoundboardSounds,
  writeStoredAliases,
} from './soundboard-model.js';

const SBX_ICON_PATHS = {
  play: '<path d="M8.5 6.2v11.6a.9.9 0 0 0 1.4.8l9.2-5.8a.9.9 0 0 0 0-1.6L9.9 5.4a.9.9 0 0 0-1.4.8Z" fill="currentColor"/>',
  star: '<path class="sbx-star" d="M11.1 3.9a1 1 0 0 1 1.8 0l2.07 4.2 4.63.68a1 1 0 0 1 .56 1.7l-3.35 3.27.79 4.61a1 1 0 0 1-1.45 1.06L12 17.24l-4.15 2.18a1 1 0 0 1-1.45-1.06l.79-4.61-3.35-3.27a1 1 0 0 1 .56-1.7l4.63-.68Z" stroke-linejoin="round"/>',
  speaker: '<path d="M4.5 9.6v4.8h3.2l4.3 3.7V5.9L7.7 9.6Z" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path class="sbx-wave sbx-wave--1" d="M15.3 9.4a3.6 3.6 0 0 1 0 5.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path class="sbx-wave sbx-wave--2" d="M17.9 6.9a7.2 7.2 0 0 1 0 10.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path class="sbx-mute" d="m15.6 9.8 4.4 4.4m0-4.4-4.4 4.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  search: '<circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  close: '<path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  sort: '<path d="M8 5v14m0 0-3-3m3 3 3-3M16 19V5m0 0-3 3m3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  send: '<path d="M5 12h12m-4.5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8.2v4.3l2.8 1.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

function sbxIcon(name) {
  const svg = globalThis.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `sbx-icon sbx-icon--${name}`);
  svg.innerHTML = SBX_ICON_PATHS[name];
  return svg;
}

function sbxEqualizer() {
  const { document } = globalThis;
  const eq = document.createElement('span');
  eq.className = 'sbx-eq';
  eq.setAttribute('aria-hidden', 'true');
  eq.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  return eq;
}

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

/** The form's state, kept between visits (host.memory): the selection, the search, the sort and the filter. */
const DRAFT_DEFAULTS = { selectedId: null, query: '', searchOpen: true, sort: 'custom', favoritesOnly: false, view: 'all' };

export function createSoundboardView({ document, client, host, root }) {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const drafts = host.memory;
  for (const [key, value] of Object.entries(DRAFT_DEFAULTS)) if (!(key in drafts)) drafts[key] = value;
  const isStudioPreview = new URLSearchParams(globalThis.location?.search || '').get('studio') === '1';
  const creditBalance = (state) => (state?.pending_actions ?? [])
    .filter((action) => action.module_id === 'soundboard')
    .reduce((total, action) => total + Math.max(0, Number(action.credits_remaining ?? 1)), 0);
  /** The module body of the current draw (the host's .jdm-module__body: the Soundboard's CSS container). */
  let currentBody = null;
  /** The current draw's handle: its drag, its countdown, its search and selection. */
  let mount = null;
  // Local preview (its audio, the sound heard, the volume) and the toast of the last send: this visit's.
  const soundPreview = createSoundPreview({ document, root: () => currentBody });
  const feedback = createSoundboardFeedback({ document, root: () => currentBody, reasonFor: (error) => host.errorReason(error) });

  // --- Volume des aperçus (haut-parleur du titre) : réglage local, n'affecte que ce viewer ---
  // Built once per visit and shown in the module's header (headIcon): the host's redraws move it, never rebuild it.
  let volumeOpen = false;
  const volumeZone = el('div', 'sbx-vol');
  const volumeHandle = el('button', 'sbx-vol-trigger');
  volumeHandle.type = 'button';
  volumeHandle.append(sbxIcon('speaker'));
  volumeHandle.setAttribute('aria-controls', 'soundboard-preview-volume-popover');
  // Each control of the popover gets its focus back after a host redraw (Escape keeps reaching the panel).
  volumeHandle.dataset.draftKey = 'soundboard-volume-handle';
  const volumePopover = el('div', 'sbx-vol__pop');
  volumePopover.id = 'soundboard-preview-volume-popover';
  volumePopover.setAttribute('role', 'dialog');
  volumePopover.setAttribute('aria-label', 'Volume des aperçus');
  volumePopover.addEventListener('click', (event) => event.stopPropagation());
  const volumeHead = el('div', 'sbx-vol__head');
  const volumeValue = el('span', 'sbx-vol__value');
  volumeHead.append(el('strong', '', 'Volume des aperçus'), volumeValue);
  const volumeRow = el('div', 'sbx-vol__row');
  const volumeMute = el('button', 'sbx-vol__mute');
  volumeMute.type = 'button';
  volumeMute.dataset.draftKey = 'soundboard-volume-mute';
  volumeMute.append(sbxIcon('speaker'));
  const volumeRange = el('input', 'sbx-vol__range');
  volumeRange.type = 'range';
  volumeRange.min = '0';
  volumeRange.max = '100';
  volumeRange.step = '5';
  volumeRange.setAttribute('aria-label', 'Volume des aperçus');
  // Focus given back after a redraw (a new state while the popover is open): Escape and the keyboard keep working.
  volumeRange.dataset.draftKey = 'soundboard-preview-volume';
  volumeRow.append(volumeMute, volumeRange);
  volumePopover.append(volumeHead, volumeRow, el('p', 'sbx-vol__note', 'Pour toi seulement · rien n’est joué sur le stream'));
  volumeZone.append(volumeHandle, volumePopover);
  let volumeBeforeMute = soundPreview.volume || 60;
  const paintVolume = () => {
    const volume = soundPreview.volume;
    const level = volume === 0 ? 'mute' : volume < 50 ? 'low' : 'high';
    volumeZone.dataset.level = level;
    volumeValue.textContent = volume ? `${volume} %` : 'Muet';
    volumeRange.value = String(volume);
    volumeRange.style.setProperty('--v', `${volume}%`);
    volumeMute.setAttribute('aria-label', volume ? 'Couper les aperçus' : 'Réactiver les aperçus');
    volumeMute.title = volumeMute.getAttribute('aria-label');
  };
  const setPreviewVolume = (value) => {
    soundPreview.setVolume(value); // saved locally, applied at once to the preview being heard
    paintVolume();
  };
  volumeRange.addEventListener('input', () => setPreviewVolume(volumeRange.value));
  volumeMute.addEventListener('click', () => {
    if (soundPreview.volume) {
      volumeBeforeMute = soundPreview.volume;
      setPreviewVolume(0);
    } else setPreviewVolume(volumeBeforeMute || 60);
  });
  paintVolume();
  const syncVolume = (open, { focus = false } = {}) => {
    volumeOpen = Boolean(open);
    volumeZone.classList.toggle('is-open', volumeOpen);
    volumePopover.setAttribute('aria-hidden', String(!volumeOpen));
    volumeHandle.setAttribute('aria-expanded', String(volumeOpen));
    volumeHandle.setAttribute('aria-label', volumeOpen
      ? 'Fermer le volume des aperçus'
      : 'Régler le volume des aperçus');
    volumeHandle.title = 'Volume des aperçus';
    for (const control of volumePopover.querySelectorAll('input, button')) {
      control.tabIndex = volumeOpen ? 0 : -1;
    }
    if (focus && volumeOpen) {
      requestAnimationFrame(() => volumeRange.focus({ preventScroll: true }));
    }
  };
  volumeHandle.addEventListener('click', (event) => {
    event.stopPropagation();
    syncVolume(!volumeOpen, { focus: !volumeOpen });
  });
  // Only focus moving to another element (keyboard) closes it: a click inside (mute, slider) must not close it under
  // the pointer, a redraw moving the zone neither; a click elsewhere is handled by onClick below.
  volumeZone.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    if (volumeOpen && next && !volumeZone.contains(next)) syncVolume(false);
  });
  syncVolume(volumeOpen);

  function draw(mod, body, state) {
    mount?.destroy(); // the previous draw's drag, countdown and listeners
    mount = null;
    currentBody = body;
    const pending = (state?.pending_actions ?? []).filter((action) => action.module_id === 'soundboard');
    const interactions = host.interactions();
    const interactionsAvailable = interactions.available;
    const sounds = Array.isArray(mod.sounds) ? mod.sounds : [];
    const soundById = new Map(sounds.map((sound) => [String(sound.id), sound]));
    const soundIds = new Set(soundById.keys());
    if (!soundIds.has(drafts.selectedId)) drafts.selectedId = null;
    if (!['custom', 'alpha', 'price'].includes(drafts.sort)) drafts.sort = 'custom';
    if (!['all', 'favorites', 'recents'].includes(drafts.view)) drafts.view = 'all';
    drafts.searchOpen = true;
    let selectedSound = drafts.selectedId;
    let selectedCreditRedemption = null;
    let favorites = readStoredIds(SOUNDBOARD_FAVORITES_KEY).filter((id) => soundIds.has(id));
    let recents = readStoredIds(SOUNDBOARD_RECENTS_KEY).filter((id) => soundIds.has(id));
    let customOrder = normalizeSoundboardOrder(readStoredIds(SOUNDBOARD_ORDER_KEY), [...soundIds]);
    let aliases = readStoredAliases(SOUNDBOARD_ALIASES_KEY, soundIds);
    writeStoredIds(SOUNDBOARD_FAVORITES_KEY, favorites);
    writeStoredIds(SOUNDBOARD_RECENTS_KEY, recents);
    writeStoredIds(SOUNDBOARD_ORDER_KEY, customOrder);
    writeStoredAliases(SOUNDBOARD_ALIASES_KEY, aliases);
    const displayLabelFor = (sound) => soundboardSoundLabel(sound, aliases);

    body.classList.add('rl-soundboard', 'sbx');

    const { displayMethods, spendMethods } = walletPaymentMethods(mod, state);
    const methods = displayMethods.length ? displayMethods : ['tokens'];
    const supportsPaymentMethod = (method) => spendMethods.includes(method);
    if (!methods.includes(host.payment.get())) host.payment.set(methods[0]);
    const tokenCostOf = (sound) => Number(sound?.token_cost ?? mod.token_cost ?? 500);
    const creditCostOf = (sound) => Number(sound?.credit_cost ?? 1);

    // État d'un son vu par le viewer. Core reste l'autorité (il refuse de toute façon) : ceci
    // n'est qu'un affichage, recalculé chaque seconde pendant un cooldown.
    const availability = (sound) => {
      if (sound?.enabled === false) return { kind: 'disabled', label: 'Indisponible', hint: 'Ce son est désactivé' };
      const left = (sound?.cooldown_until ? Date.parse(sound.cooldown_until) : 0) - Date.now();
      if (left > 0) {
        const seconds = Math.ceil(left / 1000);
        return { kind: 'cooldown', label: `${seconds} s`, hint: `Disponible dans ${seconds} s`, left };
      }
      if (sound?.running && sound.playback_mode === 'ignore_if_running') {
        return { kind: 'running', label: 'En cours', hint: 'Ce son est déjà en cours de lecture' };
      }
      return null;
    };
    const durationText = (sound) => {
      if (String(sound.id) === 'random') return 'Son surprise';
      const ms = Number(sound.duration_ms || 0);
      return ms ? `${(ms / 1000).toFixed(1).replace('.', ',')} s` : '';
    };

    // --- En-tête : recherche, tri, filtres, état du lecteur -------------------------------------
    const head = el('div', 'sbx-head');
    const searchBox = el('label', 'sbx-search');
    const search = el('input', 'sbx-search__input');
    search.id = 'soundboard-search';
    search.type = 'search';
    search.placeholder = 'Rechercher un son';
    search.value = drafts.query;
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.setAttribute('aria-label', 'Rechercher un son');
    search.dataset.draftKey = 'soundboard-query';
    const clearSearch = el('button', 'sbx-search__clear');
    clearSearch.type = 'button';
    clearSearch.setAttribute('aria-label', 'Effacer la recherche');
    clearSearch.append(sbxIcon('close'));
    searchBox.append(sbxIcon('search'), search, clearSearch);

    const sortWrap = el('div', 'sbx-sort');
    const sortButton = el('button', 'sbx-iconbtn sbx-sort__button');
    sortButton.type = 'button';
    sortButton.title = 'Trier';
    sortButton.setAttribute('aria-haspopup', 'menu');
    sortButton.setAttribute('aria-expanded', 'false');
    sortButton.setAttribute('aria-label', 'Trier le catalogue');
    sortButton.append(sbxIcon('sort'));
    const sortMenu = el('div', 'sbx-menu');
    sortMenu.setAttribute('role', 'menu');
    sortMenu.hidden = true;
    const SORTS = [['custom', 'Mon ordre'], ['alpha', 'A → Z'], ['price', 'Prix croissant']];
    const sortItems = SORTS.map(([value, label]) => {
      const item = el('button', 'sbx-menu__item', label);
      item.type = 'button';
      item.dataset.sort = value;
      item.setAttribute('role', 'menuitemradio');
      item.addEventListener('click', () => {
        drafts.sort = value;
        openSortMenu(false);
        syncSort();
        renderGrid();
      });
      return item;
    });
    const sortNote = el('p', 'sbx-menu__note', 'Mon ordre : maintiens une carte pour la déplacer.');
    sortMenu.append(...sortItems, sortNote);
    sortWrap.append(sortButton, sortMenu);
    const syncSort = () => {
      for (const item of sortItems) {
        const on = item.dataset.sort === drafts.sort;
        item.classList.toggle('is-active', on);
        item.setAttribute('aria-checked', String(on));
      }
      sortButton.classList.toggle('is-set', drafts.sort !== 'custom');
    };
    const openSortMenu = (open) => {
      sortMenu.hidden = !open;
      sortWrap.classList.toggle('is-open', open);
      sortButton.setAttribute('aria-expanded', String(open));
    };
    sortButton.addEventListener('click', () => openSortMenu(sortMenu.hidden));
    // A press inside the menu (a mouse click on an item) first takes the focus off « Trier »: the menu must not close
    // under the pointer. Focus leaving for good (keyboard, a click elsewhere) still closes it.
    let sortPressing = false;
    sortWrap.addEventListener('pointerdown', () => {
      sortPressing = true;
      setTimeout(() => { sortPressing = false; }, 0);
    });
    sortWrap.addEventListener('focusout', (event) => {
      const next = event.relatedTarget;
      queueMicrotask(() => {
        if (sortPressing || sortWrap.contains(next) || sortWrap.contains(document.activeElement)) return;
        openSortMenu(false);
      });
    });
    sortWrap.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || sortMenu.hidden) return;
      event.stopPropagation();
      openSortMenu(false);
      sortButton.focus({ preventScroll: true });
    });
    syncSort();

    const filters = el('div', 'sbx-filters');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Afficher');
    const VIEWS = [['all', 'Tous'], ['favorites', 'Favoris'], ['recents', 'Récents']];
    const filterButtons = VIEWS.map(([id, label]) => {
      const chip = el('button', 'sbx-filter');
      chip.type = 'button';
      chip.dataset.view = id;
      if (id === 'favorites') chip.append(sbxIcon('star'));
      chip.append(el('span', 'sbx-filter__label', label), el('span', 'sbx-filter__count'));
      chip.addEventListener('click', () => {
        drafts.view = id;
        drafts.favoritesOnly = id === 'favorites';
        syncFilters();
        renderGrid();
      });
      return chip;
    });
    filters.append(...filterButtons);
    const syncFilters = () => {
      for (const chip of filterButtons) {
        const on = chip.dataset.view === drafts.view;
        chip.classList.toggle('is-active', on);
        chip.setAttribute('aria-pressed', String(on));
        const count = chip.dataset.view === 'favorites' ? favorites.length
          : chip.dataset.view === 'recents' ? recents.length : sounds.length;
        chip.querySelector('.sbx-filter__count').textContent = String(count);
      }
    };
    syncFilters();

    // Lecteur du Studio : information discrète (Core refuse de toute façon sans lecteur prêt).
    const status = el('span', 'sbx-status');
    if (mod.player_ready === false) {
      status.classList.add('is-offline');
      status.title = 'Le lecteur audio du Studio n’est pas prêt : un envoi serait refusé sans rien consommer.';
      status.append(el('span', 'sbx-status__dot'), el('span', '', 'Lecteur hors ligne'));
    } else if (mod.player_ready === true) {
      status.classList.add('is-online');
      status.title = 'Lecteur audio du Studio prêt';
      status.append(el('span', 'sbx-status__dot'), el('span', '', 'Lecteur prêt'));
    }

    const searchRow = el('div', 'sbx-head__row');
    searchRow.append(searchBox, sortWrap);
    const filterRow = el('div', 'sbx-head__row sbx-head__row--filters');
    filterRow.append(filters, status);
    head.append(searchRow, filterRow);

    // --- Grille ----------------------------------------------------------------------------------
    const grid = el('div', 'sbx-grid');
    grid.setAttribute('role', 'list');
    grid.setAttribute('aria-label', 'Catalogue Soundboard');
    grid.dataset.scrollKey = 'soundboard-grid';
    hoverMarquee(grid, '.sbx-card', '.sbx-card__name', '.sbx-card__label');

    const visibleSounds = () => {
      let candidates = sounds.filter((sound) => soundboardSoundMatchesQuery(sound, drafts.query, aliases));
      if (drafts.view === 'favorites') {
        candidates = candidates.filter((sound) => favorites.includes(String(sound.id)));
      } else if (drafts.view === 'recents') {
        return recents.map((id) => candidates.find((sound) => String(sound.id) === id)).filter(Boolean);
      }
      return sortSoundboardSounds(candidates, {
        sort: drafts.sort,
        customOrder,
        recents,
        aliases,
        paymentMethod: host.payment.get(),
        moduleTokenCost: mod.token_cost,
      });
    };

    const selectSound = (sound) => {
      selectedSound = String(sound.id);
      drafts.selectedId = selectedSound;
      setActionState();
      // La barre d'action grandit à la sélection : la carte choisie reste entièrement visible dans la grille.
      requestAnimationFrame(() => {
        const card = grid.querySelector('.sbx-card.is-selected');
        if (!card) return;
        const view = grid.getBoundingClientRect();
        const rect = card.getBoundingClientRect();
        if (rect.bottom > view.bottom) grid.scrollTop += rect.bottom - view.bottom + 6;
        else if (rect.top < view.top) grid.scrollTop -= view.top - rect.top + 4;
      });
    };

    // Réordonnancement personnel (tri « Mon ordre ») : appui long puis glisser, ou Alt+flèches. Insertion stricte
    // (moveSoundboardItem) : seules les cartes entre l'origine et la destination se décalent d'une place. Pendant le
    // geste, aucune carte ne change de place dans le DOM : les positions sont relevées au départ (soundboardDropSlot
    // les lit, la destination ne dépend donc jamais de cartes en mouvement), la carte suit le pointeur et les autres
    // glissent en transform. Au lâcher, les mêmes nœuds sont remis dans le nouvel ordre (aucune reconstruction, aucun
    // flash) et l'ordre est enregistré une seule fois. Échap, pointercancel ou un rendu forcé annulent sans rien écrire.
    let dragPending = null;
    let dragSession = null;
    let dragJustDroppedId = null;
    let renderAfterDrag = false; // a new server state arrived during the drag: drawn once it ends
    let cooldownTimer = null;
    const dragDelayMs = 300;
    const bindGlobalPointerTracking = (onMove, onUp, onCancel) => {
      const target = globalThis.window;
      if (!target || typeof target.addEventListener !== 'function') return () => {};
      target.addEventListener('pointermove', onMove, { passive: false });
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onCancel);
      return () => {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onCancel);
      };
    };
    const clearDragPending = () => {
      const current = dragPending;
      dragPending = null;
      if (!current) return;
      if (current.timer !== null) globalThis.clearTimeout?.(current.timer);
      current.detach?.();
    };
    /** Nouvel ordre visible : ordre personnel enregistré, puis les mêmes nœuds remis en place (pas de rendu). */
    const applyVisibleOrder = (visibleIds, nextIds) => {
      customOrder = reorderSoundboardVisibleSubset(customOrder, visibleIds, nextIds);
      writeStoredIds(SOUNDBOARD_ORDER_KEY, customOrder);
      const byId = new Map([...grid.querySelectorAll('.sbx-card')].map((card) => [String(card.dataset.soundId), card]));
      grid.append(...nextIds.map((id) => byId.get(id)).filter(Boolean));
    };
    const layoutDrag = (session) => {
      const { slots, cards, from } = session;
      const box = grid.getBoundingClientRect();
      const x = session.pointerX - box.left;
      const y = session.pointerY - box.top + grid.scrollTop;
      // La carte suit le pointeur avec la même prise qu'au départ, y compris quand la grille défile.
      const origin = slots[from];
      session.item.style.transform = `translate(${x - session.grabX - origin.left}px, ${y - session.grabY - origin.top}px) scale(1.04)`;
      const target = soundboardDropSlot(slots, x, y, session.target);
      if (target === session.target) return;
      session.target = target;
      cards.forEach((card, index) => {
        if (index === from) return;
        const next = index > from && index <= target ? index - 1 : index < from && index >= target ? index + 1 : index;
        card.style.transform = next === index
          ? ''
          : `translate(${slots[next].left - slots[index].left}px, ${slots[next].top - slots[index].top}px)`;
      });
      session.marker.style.transform = `translate(${slots[target].left}px, ${slots[target].top}px)`;
    };
    // Bord haut / bas de la grille pendant le glisser : elle défile seule.
    const autoScroll = (session) => {
      if (dragSession !== session) return;
      const box = grid.getBoundingClientRect();
      const edge = Math.min(36, box.height / 4);
      const step = session.pointerY < box.top + edge ? -7 : session.pointerY > box.bottom - edge ? 7 : 0;
      if (step) {
        const before = grid.scrollTop;
        grid.scrollTop += step;
        if (grid.scrollTop !== before) layoutDrag(session);
      }
      session.frame = globalThis.requestAnimationFrame?.(() => autoScroll(session)) ?? null;
    };
    const onDragKey = (event) => {
      if (event.key !== 'Escape' || !dragSession) return;
      event.preventDefault();
      event.stopPropagation();
      finishDrag();
    };
    const finishDrag = ({ commit = false } = {}) => {
      clearDragPending();
      const session = dragSession;
      if (!session) return;
      dragSession = null;
      session.detach?.();
      if (session.frame !== null) globalThis.cancelAnimationFrame?.(session.frame);
      grid.removeEventListener('scroll', session.onScroll);
      globalThis.removeEventListener?.('keydown', onDragKey, true);
      session.marker.remove();
      const { item, cards, from, target, visibleIds } = session;
      // Le clic qui suit le lâcher n'est ni une sélection ni une désélection.
      dragJustDroppedId = session.soundId;
      globalThis.setTimeout?.(() => {
        if (dragJustDroppedId === session.soundId) dragJustDroppedId = null;
      }, 0);
      if (!item.isConnected) return;
      const dropped = item.getBoundingClientRect();
      grid.classList.add('is-settling');
      for (const card of cards) card.style.transform = '';
      if (commit && target !== from) applyVisibleOrder(visibleIds, moveSoundboardItem(visibleIds, from, target));
      // La carte part de là où elle a été lâchée et rejoint sa place ; les autres y sont déjà.
      const landed = item.getBoundingClientRect();
      item.style.transform = `translate(${dropped.left - landed.left}px, ${dropped.top - landed.top}px)`;
      void item.offsetWidth;
      grid.classList.remove('is-settling', 'is-dragging');
      item.classList.remove('is-dragging');
      item.style.transform = '';
      if (renderAfterDrag) {
        renderAfterDrag = false;
        globalThis.setTimeout?.(() => host.redraw(), 220);
      }
    };
    const beginDrag = (current) => {
      if (dragPending !== current || dragSession || drafts.sort !== 'custom') return;
      current.detach?.();
      dragPending = null;
      const item = current.item;
      const cards = [...grid.querySelectorAll('.sbx-card')];
      const from = cards.indexOf(item);
      if (from < 0) return;
      const box = grid.getBoundingClientRect();
      const slots = cards.map((card) => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left - box.left, top: rect.top - box.top + grid.scrollTop, width: rect.width, height: rect.height };
      });
      const marker = el('div', 'sbx-drop-slot');
      marker.setAttribute('aria-hidden', 'true');
      marker.style.width = `${slots[from].width}px`;
      marker.style.height = `${slots[from].height}px`;
      grid.append(marker);
      grid.classList.add('is-dragging');
      item.classList.add('is-dragging');
      const session = {
        item,
        cards,
        slots,
        from,
        target: -1,
        marker,
        soundId: current.soundId,
        pointerId: current.pointerId,
        grabX: current.clientX - box.left - slots[from].left,
        grabY: current.clientY - box.top + grid.scrollTop - slots[from].top,
        pointerX: current.lastX ?? current.clientX,
        pointerY: current.lastY ?? current.clientY,
        visibleIds: cards.map((card) => String(card.dataset.soundId)),
        detach: null,
        frame: null,
        onScroll: null,
      };
      dragSession = session;
      session.target = from;
      session.marker.style.transform = `translate(${slots[from].left}px, ${slots[from].top}px)`;
      session.onScroll = () => layoutDrag(session);
      grid.addEventListener('scroll', session.onScroll, { passive: true });
      globalThis.addEventListener?.('keydown', onDragKey, true);
      layoutDrag(session);
      session.detach = bindGlobalPointerTracking(
        (event) => {
          if (event.pointerId !== session.pointerId) return;
          event.preventDefault?.();
          session.pointerX = Number(event.clientX) || 0;
          session.pointerY = Number(event.clientY) || 0;
          layoutDrag(session);
        },
        (event) => {
          if (event.pointerId !== session.pointerId) return;
          event.preventDefault?.();
          finishDrag({ commit: true });
        },
        (event) => {
          if (event.pointerId === session.pointerId) finishDrag();
        },
      );
      session.frame = globalThis.requestAnimationFrame?.(() => autoScroll(session)) ?? null;
    };
    // Tactile : une fois le glisser commencé, le doigt déplace la carte, pas la grille (sinon pointercancel).
    grid.addEventListener('touchmove', (event) => {
      if (dragSession && event.cancelable) event.preventDefault();
    }, { passive: false });
    const dragExcludedTarget = (target) => Boolean(target?.closest?.('.sbx-card__play, .sbx-card__fav, .sbx-alias'));
    const startDragPending = (item, soundId, event) => {
      if (drafts.sort !== 'custom' || drafts.view !== 'all' || dragSession
        || event.isPrimary === false || (event.button !== undefined && event.button !== 0)
        || dragExcludedTarget(event.target)) return;
      clearDragPending();
      const pointerId = event.pointerId ?? 1;
      const current = {
        item,
        soundId,
        pointerId,
        clientX: Number(event.clientX) || 0,
        clientY: Number(event.clientY) || 0,
        lastX: null,
        lastY: null,
        timer: null,
        detach: null,
      };
      dragPending = current;
      current.detach = bindGlobalPointerTracking(
        (moveEvent) => {
          if (moveEvent.pointerId !== pointerId || dragPending !== current) return;
          current.lastX = Number(moveEvent.clientX) || 0;
          current.lastY = Number(moveEvent.clientY) || 0;
          // Bouger avant l'appui long = clic ou défilement, jamais un déplacement.
          if (Math.hypot(current.lastX - current.clientX, current.lastY - current.clientY) > 10) clearDragPending();
        },
        (upEvent) => {
          if (upEvent.pointerId === pointerId && dragPending === current) clearDragPending();
        },
        (upEvent) => {
          if (upEvent.pointerId === pointerId && dragPending === current) clearDragPending();
        },
      );
      current.timer = globalThis.setTimeout?.(() => beginDrag(current), dragDelayMs) ?? null;
    };
    const reorderWithKeyboard = (soundId, key) => {
      if (drafts.sort !== 'custom' || drafts.view !== 'all') return false;
      const visibleIds = [...grid.querySelectorAll('.sbx-card')].map((item) => String(item.dataset.soundId));
      const index = visibleIds.indexOf(String(soundId));
      if (index < 0) return false;
      let columns = 1;
      try {
        columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/u).length);
      } catch { /* une colonne par défaut */ }
      const delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -columns : columns;
      const target = Math.min(visibleIds.length - 1, Math.max(0, index + delta));
      if (target === index) return false;
      // Même règle que le glisser : insertion, jamais d'échange.
      applyVisibleOrder(visibleIds, moveSoundboardItem(visibleIds, index, target));
      grid.querySelector(`.sbx-card[data-sound-id="${CSS.escape(String(soundId))}"] .sbx-card__main`)
        ?.focus({ preventScroll: true });
      return true;
    };

    // Nom personnel (clic droit / Maj+F2) : stocké localement, n'affecte que ce viewer.
    const openAliasEditor = (sound, card, returnFocus = null) => {
      if (card.querySelector('.sbx-alias')) return;
      const soundId = String(sound.id);
      const originalLabel = String(sound.label ?? soundId);
      const currentAlias = aliasValue(aliases, soundId);
      const form = el('form', 'sbx-alias');
      form.setAttribute('aria-label', `Nom personnel de ${originalLabel}`);
      const input = el('input', 'sbx-alias__input');
      input.type = 'text';
      input.maxLength = SOUNDBOARD_ALIAS_MAX_LENGTH;
      input.value = currentAlias;
      input.placeholder = originalLabel;
      input.autocomplete = 'off';
      input.setAttribute('aria-label', `Nom personnel de ${originalLabel}`);
      input.dataset.draftKey = `soundboard-alias-${soundId}`;
      const save = el('button', 'sbx-alias__btn sbx-alias__btn--save', '✓');
      save.type = 'submit';
      save.setAttribute('aria-label', 'Valider le nom personnel');
      const restore = el('button', 'sbx-alias__btn', '↺');
      restore.type = 'button';
      restore.hidden = !currentAlias;
      restore.setAttribute('aria-label', 'Restaurer le nom original');
      restore.title = 'Restaurer le nom original';
      form.append(input, save, restore);
      for (const type of ['click', 'pointerdown']) form.addEventListener(type, (event) => event.stopPropagation());
      form.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      const persistAlias = (value) => {
        const next = normalizeSoundboardAlias(value);
        if (!next || normalizeSearchQuery(next) === normalizeSearchQuery(originalLabel)) delete aliases[soundId];
        else aliases[soundId] = next;
        writeStoredAliases(SOUNDBOARD_ALIASES_KEY, aliases);
        renderGrid();
      };
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        persistAlias(input.value);
      });
      restore.addEventListener('click', (event) => {
        event.preventDefault();
        persistAlias('');
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        renderGrid();
        queueMicrotask(() => returnFocus?.focus?.({ preventScroll: true }));
      });
      card.classList.add('is-editing');
      card.append(form);
      input.focus({ preventScroll: true });
      input.select();
    };

    const syncCard = (card) => {
      const sound = soundById.get(String(card.dataset.soundId));
      if (!sound) return;
      const soundId = String(sound.id);
      const unavailable = availability(sound);
      const playing = !unavailable && sound.running === true;
      card.dataset.state = unavailable?.kind ?? (playing ? 'playing' : 'available');
      const selected = soundId === selectedSound;
      card.classList.toggle('is-selected', selected);
      const main = card.querySelector('.sbx-card__main');
      main.disabled = Boolean(unavailable);
      main.setAttribute('aria-pressed', String(selected));
      main.title = unavailable ? unavailable.hint : aliases[soundId] ? `Nom original : ${sound.label ?? soundId}` : displayLabelFor(sound);
      const meta = card.querySelector('.sbx-card__meta');
      meta.replaceChildren();
      if (unavailable?.kind === 'cooldown') {
        meta.append(sbxIcon('clock'), el('span', '', unavailable.label));
        const total = Number(sound.cooldown_ms || 0);
        card.style.setProperty('--sbx-cd', total > 0 ? String(Math.min(1, unavailable.left / total)) : '0');
      } else {
        card.style.removeProperty('--sbx-cd');
        if (unavailable) meta.append(el('span', '', unavailable.label));
        else if (playing) meta.append(sbxEqualizer(), el('span', '', 'En lecture'));
        else meta.append(el('span', '', durationText(sound)));
      }
      const favoriteOn = favorites.includes(soundId);
      card.classList.toggle('is-favorite', favoriteOn);
      const fav = card.querySelector('.sbx-card__fav');
      fav.setAttribute('aria-pressed', String(favoriteOn));
      fav.setAttribute('aria-label', favoriteOn
        ? `Retirer ${displayLabelFor(sound)} des favoris`
        : `Ajouter ${displayLabelFor(sound)} aux favoris`);
      fav.title = favoriteOn ? 'Retirer des favoris' : 'Ajouter aux favoris';
    };

    const buildCard = (sound) => {
      const soundId = String(sound.id);
      const label = displayLabelFor(sound);
      const card = el('div', 'sbx-card');
      card.dataset.soundId = soundId;
      card.setAttribute('role', 'listitem');
      if (soundId === 'random') card.classList.add('is-random');

      const main = el('button', 'sbx-card__main');
      main.type = 'button';
      main.setAttribute('aria-label', `Sélectionner ${label}`);
      main.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown');

      const play = el('button', 'sbx-card__play');
      play.type = 'button';
      play.dataset.soundId = soundId;
      play.dataset.soundLabel = label;
      if (!soundPreviewUrls(sound).length || sound.studio_placeholder === true) {
        play.disabled = true;
        play.classList.add('is-empty');
        play.append(el('span', 'sbx-card__dice', soundId === 'random' ? '🎲' : '·'));
        play.title = soundId === 'random' ? 'Son choisi au hasard à l’envoi' : 'Aperçu indisponible';
        play.setAttribute('aria-label', play.title);
      } else {
        play.append(sbxIcon('play'), sbxEqualizer());
      }
      play.addEventListener('click', (event) => {
        event.stopPropagation();
        if (soundPreview.soundId === soundId) soundPreview.stop();
        else void soundPreview.play(sound, play, { notice: showBarNotice });
      });

      const text = el('span', 'sbx-card__text');
      const name = el('span', 'sbx-card__name');
      // Sous-élément : porte l'ellipse au repos et glisse (transform) au survol en vue compacte.
      name.append(el('span', 'sbx-card__label', label));
      text.append(name, el('span', 'sbx-card__meta'));

      const fav = el('button', 'sbx-card__fav');
      fav.type = 'button';
      fav.append(sbxIcon('star'));
      fav.addEventListener('pointerdown', (event) => event.stopPropagation());
      fav.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        favorites = favorites.includes(soundId) ? favorites.filter((id) => id !== soundId) : [soundId, ...favorites];
        writeStoredIds(SOUNDBOARD_FAVORITES_KEY, favorites);
        syncFilters();
        if (drafts.view === 'favorites') renderGrid();
        else syncCard(card);
        fav.classList.toggle('is-popping', favorites.includes(soundId));
      });
      fav.addEventListener('animationend', () => fav.classList.remove('is-popping'));

      main.addEventListener('click', (event) => {
        if (dragJustDroppedId === soundId) {
          event.preventDefault();
          dragJustDroppedId = null;
          return;
        }
        selectSound(sound);
      });
      main.addEventListener('keydown', (event) => {
        if (event.key === 'F2' && event.shiftKey) {
          event.preventDefault();
          openAliasEditor(sound, card, main);
          return;
        }
        if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
          && reorderWithKeyboard(soundId, event.key)) {
          event.preventDefault();
          event.stopPropagation();
        }
      });
      card.addEventListener('pointerdown', (event) => startDragPending(card, soundId, event));
      card.addEventListener('contextmenu', (event) => {
        // Appui long tactile : le menu contextuel ne doit ni ouvrir le nom personnel ni couper le déplacement.
        if (dragSession || dragPending) {
          event.preventDefault();
          return;
        }
        if (dragExcludedTarget(event.target)) return;
        event.preventDefault();
        openAliasEditor(sound, card, main);
      });
      card.append(main, play, text, fav);
      syncCard(card);
      return card;
    };

    const emptyMessage = () => {
      if (drafts.query.trim()) return ['Aucun son trouvé', `Rien ne correspond à « ${drafts.query.trim()} ».`];
      if (drafts.view === 'favorites') return ['Pas encore de favori', 'Touche l’étoile d’une carte pour la retrouver ici.'];
      if (drafts.view === 'recents') return ['Aucun son récent', 'Tes derniers envois apparaîtront ici.'];
      return ['Soundboard vide', 'Aucun son n’est disponible pour le moment.'];
    };

    const renderGrid = () => {
      const previousScrollTop = grid.scrollTop;
      const candidates = visibleSounds();
      if (!candidates.length) {
        const [title, copy] = emptyMessage();
        const empty = el('div', 'sbx-empty');
        empty.append(el('strong', '', title), el('span', '', copy));
        grid.replaceChildren(empty);
      } else {
        grid.replaceChildren(...candidates.map(buildCard));
      }
      grid.classList.toggle('is-reorderable', drafts.sort === 'custom' && drafts.view === 'all');
      setActionState();
      soundPreview.syncButtons();
      grid.scrollTop = previousScrollTop;
    };

    grid.addEventListener('click', (event) => {
      // Clic de fin de glisser (pointeur relâché sur une autre carte) : ni sélection ni désélection globale.
      if (dragJustDroppedId) {
        event.stopPropagation();
        return;
      }
      if (event.target === grid || event.target?.closest?.('.sbx-empty')) deselectSound();
    });
    search.addEventListener('input', () => {
      drafts.query = search.value;
      clearSearch.hidden = !search.value;
      renderGrid();
    });
    const resetSearch = () => {
      const had = Boolean(search.value || drafts.query);
      drafts.query = '';
      search.value = '';
      clearSearch.hidden = true;
      if (had) renderGrid();
    };
    clearSearch.hidden = !search.value;
    clearSearch.addEventListener('click', (event) => {
      event.preventDefault();
      resetSearch();
      search.focus({ preventScroll: true });
    });
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !search.value) return;
      event.preventDefault();
      event.stopPropagation();
      resetSearch();
    });

    // --- Barre d'action : son choisi, monnaie, prix, envoi -----------------------------------------
    const dock = el('div', 'sbx-dock');
    const toastSlot = el('div', 'sbx-toast-slot');
    const bar = el('div', 'sbx-bar');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Envoyer le son sélectionné');
    const barSound = el('div', 'sbx-bar__sound');
    const barEyebrow = el('span', 'sbx-bar__eyebrow');
    const barName = el('strong', 'sbx-bar__name');
    barSound.append(barEyebrow, barName);

    const walletSwitch = createCurrencySwitch({
      className: 'sbx-wallet',
      ariaLabel: 'Payer avec',
      tipPlacement: 'above',
      onChange: (method) => {
        host.payment.set(method);
        setActionState();
        if (drafts.sort === 'price') renderGrid();
      },
    });
    const wallet = walletSwitch.node;

    const price = el('div', 'sbx-price');
    const priceValue = el('span', 'sbx-price__value');
    const priceUnit = el('span', 'sbx-price__unit');
    price.append(el('span', 'sbx-price__coin'), priceValue, priceUnit);

    const send = el('button', 'sbx-send');
    send.type = 'button';
    send.append(el('span', 'sbx-send__label', 'Envoyer'), sbxIcon('send'), el('span', 'sbx-send__spinner'));
    bar.append(barSound, wallet, price, send);
    dock.append(toastSlot, bar);

    let barNotice = null;
    let barNoticeTimer = null;
    function showBarNotice(message) {
      barNotice = message;
      clearTimeout(barNoticeTimer);
      barNoticeTimer = setTimeout(() => {
        barNotice = null;
        if (body.isConnected) setActionState();
      }, 3500);
      setActionState();
    }

    const setActionState = () => {
      const sound = soundById.get(String(selectedSound || ''));
      const studioPlaceholder = isStudioPreview && sound?.studio_placeholder === true;
      const creditCost = creditCostOf(sound);
      const tokenCost = tokenCostOf(sound);
      selectedCreditRedemption = sound
        ? pending.find((action) => Number(action.credits_remaining ?? 0) >= creditCost) ?? null
        : null;
      if (!methods.includes(host.payment.get())) host.payment.set(methods[0]);
      const method = host.payment.get();
      host.payment.sync(methods, (next) => {
        host.payment.set(next);
        setActionState();
      });
      const usingCredits = method === 'credits';
      const unavailable = sound ? availability(sound) : null;
      const hasEnoughTokens = walletCanPayTokens(state.wallet, tokenCost);
      const methodSupported = supportsPaymentMethod(method);
      const methodAvailable = usingCredits ? Boolean(selectedCreditRedemption) : hasEnoughTokens;
      const cost = usingCredits ? creditCost : tokenCost;
      const unit = usingCredits ? `crédit${creditCost > 1 ? 's' : ''}` : 'jetons';
      const restricted = host.restriction();
      const hint = !sound ? ''
        : studioPlaceholder ? 'Placeholder Studio · aucune action réelle'
          : restricted ? restricted.kind === 'cooldown' ? 'Cooldown en cours' : 'Indisponible pour ton compte'
          : unavailable ? unavailable.hint
            : mod.player_ready === false ? 'Lecteur du Studio hors ligne'
            : !interactionsAvailable && !state?.lab_mode
              ? interactions.identityShared ? 'Interactions en pause, rien ne sera consommé' : 'Partage ton identité Twitch pour envoyer'
              : !methodSupported ? 'Paiement indisponible pour cette monnaie'
                : usingCredits && !selectedCreditRedemption ? 'Aucun crédit Soundboard disponible'
                  : !usingCredits && !hasEnoughTokens
                    ? state?.wallet?.unavailable === true ? 'Solde de jetons indisponible' : 'Jetons insuffisants'
                    : '';

      body.dataset.paymentMethod = method;
      body.classList.toggle('has-selection', Boolean(sound));
      bar.dataset.empty = String(!sound);
      bar.dataset.method = method;
      walletSwitch.sync({
        method,
        methods,
        amounts: {
          tokens: state?.wallet?.unavailable ? null : state?.wallet?.available,
          credits: Array.isArray(state?.pending_actions) ? creditBalance(state) : null,
        },
      });
      const eyebrow = barNotice || (!sound
        ? mod.player_ready === false ? 'Lecteur du Studio hors ligne' : 'Écoute avec ▶, puis choisis un son'
        : hint || 'Prêt à envoyer');
      barEyebrow.textContent = eyebrow;
      barEyebrow.dataset.tone = barNotice || hint || mod.player_ready === false ? 'warn' : sound ? 'ok' : 'muted';
      barName.textContent = sound ? displayLabelFor(sound) : 'Choisis un son';
      const nextPrice = sound ? fmt(cost) : '—';
      if (priceValue.textContent !== nextPrice || price.dataset.method !== method) {
        priceValue.textContent = nextPrice;
        price.classList.remove('is-bump');
        void price.offsetWidth;
        price.classList.add('is-bump');
      }
      price.dataset.method = method;
      priceUnit.textContent = unit;
      send.disabled = studioPlaceholder || !sound || !methodSupported || !methodAvailable || Boolean(unavailable) || Boolean(restricted)
        || (!interactionsAvailable && !state?.lab_mode);
      const summary = sound ? `Envoyer ${displayLabelFor(sound)} pour ${fmt(cost)} ${unit}` : 'Choisis d’abord un son';
      send.setAttribute('aria-label', summary);
      send.title = summary;
      for (const card of grid.querySelectorAll('.sbx-card')) {
        const selected = card.dataset.soundId === selectedSound;
        if (card.classList.contains('is-selected') !== selected) syncCard(card);
      }
    };

    const deselectSound = () => {
      soundPreview.stop();
      selectedSound = null;
      drafts.selectedId = null;
      setActionState();
    };

    const clearSound = () => {
      soundPreview.stop();
      if (selectedSound) {
        rememberStoredId(SOUNDBOARD_RECENTS_KEY, selectedSound);
        recents = readStoredIds(SOUNDBOARD_RECENTS_KEY).filter((id) => soundIds.has(id));
      }
      selectedSound = null;
      drafts.selectedId = null;
      syncFilters();
      renderGrid();
    };

    // The outcome of a send is the Soundboard's own toast (the host stays quiet: feedbackScope).
    const settled = (ok, error) => feedback.set(ok ? 'success' : 'error', error);
    send.addEventListener('click', () => {
      const sound = soundById.get(String(selectedSound || ''));
      const method = host.payment.get();
      if (!sound || send.disabled || !supportsPaymentMethod(method)) return;
      if (method === 'credits') {
        return host.run(body, () => selectedCreditRedemption
          ? client.useRedemption(selectedCreditRedemption.redemption_id, 'soundboard', { sound_id: selectedSound })
          : Promise.reject(Object.assign(new Error('insufficient_credits'), { code: 'insufficient_credits' })), {
          feedbackScope: 'soundboard',
          onSuccess: clearSound,
          onSettled: settled,
        });
      }
      if (!walletCanPayTokens(state.wallet, tokenCostOf(sound))) return;
      return host.run(body, () => client.spendTokens('soundboard', { sound_id: selectedSound }), {
        feedbackScope: 'soundboard',
        onSuccess: clearSound,
        onSettled: settled,
      });
    });

    body.append(head, grid, dock);
    renderGrid();
    // Compte à rebours sur place tant qu'un son est en cooldown (arrêté au prochain rendu).
    if (sounds.some((sound) => sound.cooldown_until && Date.parse(sound.cooldown_until) > Date.now())) {
      cooldownTimer = setInterval(() => {
        for (const card of grid.querySelectorAll('.sbx-card[data-state="cooldown"]')) syncCard(card);
        if (selectedSound) setActionState();
      }, 1000);
    }
    mount = {
      closeSearch: resetSearch,
      deselect: deselectSound,
      holdState: () => {
        if (!dragSession) return false;
        renderAfterDrag = true;
        return true;
      },
      destroy: () => {
        finishDrag(); // a drag cut short by a redraw: its listeners go, nothing is reordered
        clearInterval(cooldownTimer);
      },
    };
    // Hauteur disponible sous l'en-tête : la grille défile dans le module, la barre reste visible.
    requestAnimationFrame(() => {
      if (!body.isConnected) return;
      const top = body.getBoundingClientRect().top + (document.scrollingElement?.scrollTop ?? 0);
      body.style.setProperty('--sb-top', `${Math.max(0, Math.round(top))}px`);
      // Marges du conteneur sous le module (padding bas du panel) : rien ne doit déborder la page.
      const page = document.scrollingElement;
      const overflow = page ? page.scrollHeight - page.clientHeight : 0;
      if (overflow > 0) body.style.setProperty('--sb-bottom', `${6 + overflow}px`);
    });
    // The toast of the last send, in the dock's slot (its own timer: soundboard-feedback.js).
    (body.querySelector('.sbx-toast-slot') ?? body).append(feedback.overlay());
  }

  // --- Listeners of the visit, on the PANEL root (removed by destroy) -----------------------------
  // Escape: the host's own popups (notifications, preferences, tutorial) take it first (their handler, registered earlier
  // on the same root, marks it defaultPrevented). Otherwise the Soundboard uses it and it stops here, as it always did:
  // it never reaches the page (the Video Overlay would close its drawer).
  const onKey = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !mount) return;
    event.preventDefault();
    event.stopPropagation();
    if (volumeOpen) {
      syncVolume(false);
      return;
    }
    if (drafts.searchOpen) mount.closeSearch();
  };
  // Une interaction dans le catalogue reste une interaction interne : elle ne doit pas faire disparaître la barre pendant
  // qu'un viewer choisit un tri, active Favoris ou clique une carte. Seul un clic hors du corps Soundboard replie
  // automatiquement la zone ; le bouton et Escape restent explicites.
  const onClickCapture = (event) => {
    if (!drafts.searchOpen || event.target?.closest?.('.rl-soundboard')) return;
    const current = mount;
    queueMicrotask(() => {
      if (drafts.searchOpen) current?.closeSearch();
    });
  };
  const onClick = (event) => {
    const target = event.target;
    if (volumeOpen && !target?.closest?.('.sbx-vol')) syncVolume(false);
    if (!mount || !target?.closest?.('.rl-soundboard')) return;
    // Une carte et ses contrôles restent dans leur flux d'interaction. Tout clic dans le reste du module désélectionne
    // la carte courante.
    if (target.closest('.sbx-card, .sbx-dock, .sbx-head, .sbx-vol')) return;
    mount.deselect();
  };
  root.addEventListener('keydown', onKey);
  root.addEventListener('click', onClickCapture, true);
  root.addEventListener('click', onClick);

  return {
    /** No node of its own: the Soundboard draws into the host's module body (its CSS container). */
    node: null,
    headIcon: () => volumeZone,
    draw: draw,
    attached: () => soundPreview.syncButtons(),
    /** A new state the screen can do without: identical (the raffle countdown aside), or a card being dragged. */
    absorb(next, prev) {
      const stable = (s) => (s?.raffle ? { ...s, raffle: { ...s.raffle, ends_in_s: null } } : s);
      if (JSON.stringify(stable(prev)) === JSON.stringify(stable(next))) return true;
      return mount?.holdState() === true;
    },
    destroy() {
      mount?.destroy();
      mount = null;
      soundPreview.stop();
      feedback.clear();
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('click', onClickCapture, true);
      root.removeEventListener('click', onClick);
      currentBody = null;
    },
  };
}

// Module variant (module-registry.js): the Soundboard screen.
registerModuleVariant({
  id: 'soundboard',
  match: () => true,
  intro: false,
  headClass: 'jdm-module__screen-head--soundboard',
  view: (ctx) => createSoundboardView(ctx),
  headIcon: (view) => view.headIcon(),
  rendered: (view, { module, body, state }) => view.draw(module, body, state),
  onState: (view, next, prev) => view.absorb(next, prev),
});
