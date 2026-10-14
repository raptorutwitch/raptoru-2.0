// Picker d'emotes groupé : recherche toujours visible, rail de sections, défilement continu.
// Le composant est persistant : l'hôte le recrée une seule fois puis appelle setData/setState à
// chaque rendu. Seules les sections dont le contenu change sont reconstruites, et seules les
// tranches proches de la zone visible possèdent des cellules dans le DOM.
//
// Données attendues (déjà normalisées par l'hôte) :
//   groups: [{ id, label, keywords?, matchLabel?, icon?, iconNode?, iconSrc?, avatarUrl?,
//             family?: { id, label, tone?, icon?, iconSrc?, iconNode? }, virtual?, reorderable?,
//             parts?: [{ id, label, iconSrc?, keywords?, emotes }], emotes: [item] }]
//   (parts : sous-groupes affichés avec un petit sous-titre dans la même section)
//   item:   { id, label, src?, animated?, glyph?, disabled?, hint? }  (hint : infobulle)  (src animée si l'emote l'est)
// L'hôte reste propriétaire des favoris, de la sélection et de l'envoi.

export const CHUNK_ROWS = 6;
export const SEARCH_LIMIT = 300;
const NEAR_MARGIN = 400;

const fold = (value) => String(value ?? '').toLocaleLowerCase('fr').normalize('NFD')
  .replace(/[̀-ͯ]/g, '');

/** Signature d'une section : ne change que si son rendu doit changer. */
export function sectionSignature(group) {
  const parts = [group.label, group.avatarUrl ?? '', group.icon ?? ''];
  for (const part of group.parts ?? []) parts.push(`part:${part.id}|${part.label}|${part.emotes.length}`);
  for (const item of group.emotes) {
    parts.push(`${item.id}|${item.src ?? ''}|${item.animated ? 1 : 0}|${item.disabled ? 1 : 0}`);
  }
  return parts.join('\n');
}

/**
 * Recherche par nom d'emote ou par chaîne. Une chaîne qui correspond apporte toutes ses emotes.
 * Les résultats restent groupés par section, dans l'ordre du catalogue, plafonnés à `limit`.
 */
export function searchEmoteGroups(groups, query, limit = SEARCH_LIMIT) {
  const needle = fold(query).trim();
  if (!needle) return { groups: [], total: 0, shown: 0 };
  const seen = new Set();
  const result = [];
  let total = 0;
  let shown = 0;
  for (const group of groups) {
    // matchLabel: false pour les catégories (Emoji) : seul le nom des emotes compte.
    const groupMatch = group.matchLabel !== false
      && [group.label, ...(group.keywords ?? [])].some((text) => fold(text).includes(needle));
    const matches = [];
    for (const item of group.emotes) {
      if (seen.has(item.id)) continue;
      if (!groupMatch && !fold(item.label).includes(needle)) continue;
      seen.add(item.id);
      total += 1;
      if (shown < limit) {
        matches.push(item);
        shown += 1;
      }
    }
    if (matches.length) result.push({ ...group, emotes: matches });
  }
  return { groups: result, total, shown };
}

/** Nombre de colonnes/hauteur d'une grille auto-fill (cellules carrées). */
export function gridMetrics(width, count, minCell, gap) {
  const columns = Math.max(1, Math.floor((width + gap) / (minCell + gap)));
  const cell = (width - gap * (columns - 1)) / columns;
  const rows = Math.ceil(count / columns);
  return { columns, height: rows ? rows * cell + (rows - 1) * gap : 0 };
}

export function createEmotePicker({ label = 'Emotes', placeholder = 'Emote ou chaîne…', railKey = null } = {}) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const nav = make('nav', 'rl-picker__nav');
  nav.setAttribute('aria-label', `Sections · ${label}`);
  nav.dataset.scrollKey = 'rl-picker-nav';

  const searchRow = make('div', 'rl-picker__search');
  searchRow.setAttribute('role', 'search');
  const input = make('input', 'rl-picker__input');
  input.type = 'search';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', placeholder);
  input.dataset.draftKey = 'rl-picker-search';
  searchRow.append(make('span', 'rl-picker__search-icon', '⌕'), input);

  const scroller = make('div', 'rl-picker__scroll');
  scroller.dataset.scrollKey = 'rl-picker-scroll';
  scroller.setAttribute('aria-label', label);
  const sectionsHost = make('div', 'rl-picker__sections');
  const resultsHost = make('div', 'rl-picker__results');
  resultsHost.hidden = true;
  const star = make('button', 'rl-picker__star');
  star.type = 'button';
  // Étoile vectorielle : contour/remplissage/halo pilotés par CSS (discrète au repos).
  const starSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  starSvg.setAttribute('viewBox', '0 0 24 24');
  starSvg.setAttribute('aria-hidden', 'true');
  const starPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  starPath.setAttribute('d', 'M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.6l-5.3 2.9 1.1-5.9-4.4-4.1 6-.8z');
  starPath.setAttribute('stroke-linejoin', 'round');
  starSvg.append(starPath);
  star.append(starSvg);
  star.tabIndex = -1;
  star.hidden = true;
  scroller.append(sectionsHost, resultsHost, star);

  let handlers = { onSelect() {}, onFavorite() {}, onReorder() {} };
  let groups = [];
  const sections = new Map(); // id -> { group, signature, root, chunks: [{ node, items, rendered }] }
  const cellsById = new Map(); // id -> Set<button> (cellules actuellement rendues)
  let view = { selected: new Set(), favorites: new Set(), queue: new Map(), next: null };
  let query = '';
  let searchTimer = null;
  let hoverCell = null;
  let activeSectionId = null;
  let metricsWidth = 0;
  let extras = null;
  // Entrée fixe en tête de la colonne (ex. source Twitch non liée de Bonk) : survit aux reconstructions.
  let lead = null;

  // --- cellules ---------------------------------------------------------------------------------

  function applyCellState(cell) {
    const id = cell.dataset.id;
    const selected = view.selected.has(id);
    const queueIndex = view.queue.get(id);
    cell.classList.toggle('is-selected', selected);
    cell.classList.toggle('is-queued', queueIndex != null);
    cell.classList.toggle('is-next', view.next === id);
    cell.classList.toggle('is-favorite', view.favorites.has(id));
    if (queueIndex != null) cell.dataset.queueIndex = String(queueIndex);
    else delete cell.dataset.queueIndex;
    cell.setAttribute('aria-pressed', String(selected));
  }
  // Les emotes animées s'animent directement dans la grille (URL animée du catalogue). Seules les
  // tranches proches de la zone visible ont des <img>, en chargement paresseux.
  function renderCell(item, { reorderable = false } = {}) {
    const cell = make('button', 'rl-picker__cell');
    cell.type = 'button';
    cell.dataset.id = item.id;
    cell.title = item.hint ?? item.label;
    cell.setAttribute('aria-label', item.label);
    if (item.animated) cell.dataset.animated = '';
    if (reorderable) cell.dataset.reorder = '';
    if (item.disabled) {
      cell.disabled = true;
      cell.classList.add('is-disabled');
    }
    if (item.src) {
      const image = make('img', 'rl-picker__img');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.draggable = false;
      image.referrerPolicy = 'no-referrer';
      image.src = item.src;
      cell.append(image);
    } else {
      cell.append(make('span', 'rl-picker__glyph', item.glyph ?? '◌'));
    }
    let set = cellsById.get(item.id);
    if (!set) cellsById.set(item.id, (set = new Set()));
    set.add(cell);
    applyCellState(cell);
    return cell;
  }
  function forgetCells(container) {
    for (const cell of container.querySelectorAll('.rl-picker__cell')) {
      cellsById.get(cell.dataset.id)?.delete(cell);
      if (cell === hoverCell) hideStar();
    }
  }

  // --- tranches paresseuses ---------------------------------------------------------------------

  const cellMetrics = () => {
    const style = getComputedStyle(scroller);
    return {
      min: parseFloat(style.getPropertyValue('--rl-cell')) || 40,
      gap: parseFloat(style.getPropertyValue('--rl-gap')) || 4,
    };
  };
  // Tranches = lignes complètes : leur taille dépend du nombre de colonnes réel. Tant que le
  // picker est détaché (colonnes inconnues), on découpe par défaut puis on redécoupe une fois.
  let columns = 0;
  const measureColumns = () => {
    const width = sectionsHost.clientWidth;
    if (!width) return 0;
    const { min, gap } = cellMetrics();
    return gridMetrics(width, 1, min, gap).columns;
  };
  const chunkSize = () => (columns || 8) * CHUNK_ROWS;
  function placeholderHeight(chunk) {
    const width = sectionsHost.clientWidth;
    if (!width) return null;
    const { min, gap } = cellMetrics();
    return gridMetrics(width, chunk.items.length, min, gap).height;
  }
  function renderChunk(chunk) {
    if (chunk.rendered) return;
    chunk.rendered = true;
    chunk.node.style.height = '';
    const fragment = document.createDocumentFragment();
    for (const item of chunk.items) fragment.append(renderCell(item, { reorderable: chunk.reorderable }));
    chunk.node.append(fragment);
  }
  function releaseChunk(chunk) {
    if (!chunk.rendered) return;
    const height = chunk.node.offsetHeight;
    forgetCells(chunk.node);
    chunk.node.replaceChildren();
    chunk.node.style.height = `${height}px`;
    chunk.rendered = false;
  }
  // Géométrie réelle, appelée au défilement (rAF), au redimensionnement et après rattachement.
  function reconcile() {
    if (!scroller.isConnected || !scroller.clientHeight || query) return;
    const bounds = scroller.getBoundingClientRect();
    for (const section of sections.values()) {
      for (const chunk of section.chunks) {
        const box = chunk.node.getBoundingClientRect();
        const near = box.bottom >= bounds.top - NEAR_MARGIN && box.top <= bounds.bottom + NEAR_MARGIN;
        const far = box.bottom < bounds.top - NEAR_MARGIN * 2 || box.top > bounds.bottom + NEAR_MARGIN * 2;
        if (near) renderChunk(chunk);
        else if (far) releaseChunk(chunk);
      }
    }
  }
  function refreshLayout() {
    const next = measureColumns();
    if (next && next !== columns) {
      columns = next;
      metricsWidth = sectionsHost.clientWidth;
      for (const section of sections.values()) {
        const built = buildSection(section.group);
        forgetCells(section.root);
        section.root.replaceWith(built.root);
        section.root = built.root;
        section.chunks = built.chunks;
      }
    } else {
      const width = sectionsHost.clientWidth;
      if (width && width !== metricsWidth) {
        metricsWidth = width;
        for (const section of sections.values()) {
          for (const chunk of section.chunks) {
            if (!chunk.rendered) chunk.node.style.height = `${placeholderHeight(chunk) ?? 0}px`;
          }
        }
      }
    }
    reconcile();
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(refreshLayout).observe(scroller);

  // --- sections -------------------------------------------------------------------------------

  function buildSection(group) {
    const root = make('section', 'rl-picker__section');
    root.dataset.sectionId = group.id;
    if (group.family) root.dataset.family = group.family.id;
    if (group.family?.tone) root.style.setProperty('--rl-tone', group.family.tone);
    // Première section d'une famille : intitulé discret (Twitch, Bits, Emoji) au-dessus.
    if (group.familyStart) root.append(make('div', 'rl-picker__family', group.family.label));
    const head = make('h3', 'rl-picker__head');
    head.append(
      make('span', 'rl-picker__head-label', group.label),
      make('span', 'rl-picker__head-count', String(group.emotes.length)),
    );
    root.append(head);
    const chunks = [];
    const size = chunkSize();
    // Sous-groupes (ex. provenance 7TV / BTTV / FFZ d'un contexte) : petit sous-titre discret.
    for (const part of group.parts ?? [{ emotes: group.emotes }]) {
      if (part.label) {
        const sub = make('div', 'rl-picker__sub');
        if (part.iconSrc) {
          const icon = make('img', 'rl-picker__sub-icon');
          icon.alt = '';
          icon.src = part.iconSrc;
          sub.append(icon);
        }
        sub.append(make('span', 'rl-picker__sub-label', part.label), make('span', 'rl-picker__sub-count', String(part.emotes.length)));
        root.append(sub);
      }
      for (let start = 0; start < part.emotes.length; start += size) {
        const node = make('div', 'rl-picker__grid');
        const chunk = {
          node,
          items: part.emotes.slice(start, start + size),
          rendered: false,
          reorderable: Boolean(group.reorderable),
        };
        const height = placeholderHeight(chunk);
        if (height != null) node.style.height = `${height}px`;
        chunks.push(chunk);
        root.append(node);
      }
    }
    return { root, chunks };
  }

  // --- rail : entrées simples + familles repliables (état local persistant) --------------------

  const readExpanded = () => {
    try {
      const value = JSON.parse(localStorage.getItem(railKey) ?? '[]');
      return new Set(Array.isArray(value) ? value.map(String) : []);
    } catch {
      return new Set();
    }
  };
  const expanded = railKey ? readExpanded() : new Set();
  const writeExpanded = () => {
    try {
      if (railKey) localStorage.setItem(railKey, JSON.stringify([...expanded]));
    } catch { /* stockage indisponible : l'état reste valable pour la session */ }
  };
  const navItems = new Map(); // section id -> bouton
  const familyBlocks = new Map(); // family id -> { block, toggle }
  let navSignature = '';

  function iconFor(entry) {
    const icon = make('span', 'rl-picker__nav-icon');
    const src = entry.avatarUrl ?? entry.iconSrc;
    if (src) {
      const image = make('img', entry.avatarUrl ? 'rl-picker__nav-avatar' : 'rl-picker__nav-emoji');
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.src = src;
      image.addEventListener('error', () => image.replaceWith(make('span', null, entry.icon ?? '•')), { once: true });
      icon.append(image);
    } else if (entry.iconNode) {
      icon.append(entry.iconNode);
    } else {
      icon.textContent = entry.icon ?? '•';
    }
    return icon;
  }
  function buildNavItem(group) {
    const item = make('button', 'rl-picker__nav-item');
    item.type = 'button';
    item.dataset.sectionId = group.id;
    item.title = group.label;
    item.setAttribute('aria-label', group.label);
    item.append(iconFor(group));
    return item;
  }
  function renderNav() {
    const signature = groups.map((group) => [
      group.id, group.label, group.avatarUrl ?? '', group.iconSrc ?? '', group.family?.id ?? '',
    ].join('|')).join('\n');
    if (signature === navSignature) return;
    navSignature = signature;
    navItems.clear();
    familyBlocks.clear();
    nav.replaceChildren();
    if (lead) nav.append(lead);
    for (const group of groups) {
      const item = buildNavItem(group);
      navItems.set(group.id, item);
      const family = group.family;
      if (!family) {
        nav.append(item);
        continue;
      }
      let entry = familyBlocks.get(family.id);
      if (!entry) {
        const block = make('div', 'rl-picker__nav-block');
        block.dataset.familyId = family.id;
        if (family.tone) block.style.setProperty('--rl-tone', family.tone);
        const toggle = make('button', 'rl-picker__nav-item rl-picker__nav-family');
        toggle.type = 'button';
        toggle.dataset.familyId = family.id;
        toggle.append(iconFor(family), make('span', 'rl-picker__nav-caret', '▸'));
        const children = make('div', 'rl-picker__nav-children');
        block.append(toggle, children);
        nav.append(block);
        entry = { block, toggle, children };
        familyBlocks.set(family.id, entry);
        syncFamily(family.id, family.label);
      }
      entry.children.append(item);
    }
    activeSectionId = null;
  }
  function syncFamily(id, label = familyBlocks.get(id)?.toggle.dataset.label) {
    const entry = familyBlocks.get(id);
    if (!entry) return;
    const open = expanded.has(id);
    entry.toggle.dataset.label = label;
    entry.block.classList.toggle('is-open', open);
    entry.toggle.setAttribute('aria-expanded', String(open));
    entry.toggle.title = open ? `${label} · replier` : `${label} · déplier`;
    entry.toggle.setAttribute('aria-label', entry.toggle.title);
  }

  // Ordre d'affichage des sections (la Map garde l'ordre d'insertion, pas l'ordre affiché).
  let ordered = [];

  function setData(nextGroups) {
    const seenFamilies = new Set();
    groups = nextGroups.map((group) => {
      const familyStart = Boolean(group.family) && !seenFamilies.has(group.family.id);
      if (group.family) seenFamilies.add(group.family.id);
      return { ...group, familyStart };
    });
    const nextIds = new Set(groups.map((group) => group.id));
    for (const [id, section] of sections) {
      if (nextIds.has(id)) continue;
      dropSection(section);
      sections.delete(id);
    }
    let previous = null;
    ordered = [];
    for (const group of groups) {
      const signature = [
        sectionSignature(group),
        group.family?.id ?? '',
        group.family?.tone ?? '',
        group.familyStart ? group.family.label : '',
      ].join('\n');
      let section = sections.get(group.id);
      if (!section || section.signature !== signature) {
        const built = buildSection(group);
        if (section) {
          // Une section qui change au-dessus de la zone visible ne doit pas faire sauter la vue.
          const above = section.root.offsetTop + section.root.offsetHeight <= scroller.scrollTop;
          const before = section.root.offsetHeight;
          section.root.replaceWith(built.root);
          forgetCells(section.root);
          if (above) scroller.scrollTop += built.root.offsetHeight - before;
        }
        section = { group, signature, root: built.root, chunks: built.chunks };
        sections.set(group.id, section);
      }
      section.group = group;
      // Ordre : insère uniquement si la position a changé (sinon aucune mutation).
      const expected = previous ? previous.root.nextSibling : sectionsHost.firstChild;
      if (expected !== section.root) {
        if (previous) previous.root.after(section.root);
        else sectionsHost.prepend(section.root);
      }
      previous = section;
      ordered.push(section);
    }
    renderNav();
    if (query) renderResults();
    queueMicrotask(() => {
      refreshLayout();
      syncActiveSection();
    });
  }
  function dropSection(section) {
    forgetCells(section.root);
    section.root.remove();
  }

  function setState(next) {
    view = {
      selected: new Set(next.selected ?? []),
      favorites: new Set(next.favorites ?? []),
      queue: new Map(next.queue ?? []),
      next: next.next ?? null,
    };
    for (const set of cellsById.values()) for (const cell of set) applyCellState(cell);
    if (hoverCell) syncStar();
  }

  // --- recherche --------------------------------------------------------------------------------

  function renderResults() {
    forgetCells(resultsHost);
    resultsHost.replaceChildren();
    const searchable = groups.filter((group) => !group.virtual).flatMap((group) => (group.parts
      ? group.parts.map((part) => ({
        ...group,
        id: part.id,
        label: `${group.label} · ${part.label}`,
        keywords: [...(group.keywords ?? []), ...(part.keywords ?? [])],
        emotes: part.emotes,
      }))
      : [group]));
    const found = searchEmoteGroups(searchable, query);
    for (const group of found.groups) {
      const head = make('h3', 'rl-picker__head');
      const label = group.family && group.family.id !== 'twitch'
        ? `${group.family.label} · ${group.label}`
        : group.label;
      head.append(
        make('span', 'rl-picker__head-label', label),
        make('span', 'rl-picker__head-count', String(group.emotes.length)),
      );
      const grid = make('div', 'rl-picker__grid');
      for (const item of group.emotes) grid.append(renderCell(item));
      const section = make('section', 'rl-picker__section');
      if (group.family?.tone) section.style.setProperty('--rl-tone', group.family.tone);
      section.append(head, grid);
      resultsHost.append(section);
    }
    if (!found.total) resultsHost.append(make('p', 'rl-picker__empty', 'Aucune emote trouvée.'));
    else if (found.total > found.shown) {
      resultsHost.append(make('p', 'rl-picker__empty', `${found.total - found.shown} autres résultats · précise ta recherche.`));
    }
  }
  function applyQuery(value) {
    const wasSearching = Boolean(query);
    query = value.trim();
    scroller.classList.toggle('is-searching', Boolean(query));
    sectionsHost.hidden = Boolean(query);
    resultsHost.hidden = !query;
    nav.classList.toggle('is-searching', Boolean(query));
    hideStar();
    if (query) {
      renderResults();
      scroller.scrollTop = 0;
    } else if (wasSearching) {
      forgetCells(resultsHost);
      resultsHost.replaceChildren();
      queueMicrotask(reconcile);
    }
  }
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applyQuery(input.value), 120);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !input.value) return;
    event.preventDefault();
    event.stopPropagation();
    input.value = '';
    applyQuery('');
  });

  // --- navigation + scrollspy -------------------------------------------------------------------

  function syncActiveSection() {
    if (query) return;
    const top = scroller.scrollTop + 8;
    let current = null;
    for (const section of ordered) {
      if (section.root.offsetTop <= top) current = section;
      else break;
    }
    current ??= ordered[0];
    const id = current?.group.id ?? null;
    if (id === activeSectionId) return;
    activeSectionId = id;
    for (const [sectionId, item] of navItems) {
      const active = sectionId === id;
      item.classList.toggle('is-active', active);
      if (active) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    }
    // Section active dans une famille repliée : le parent garde un indicateur discret.
    const familyId = current?.group.family?.id ?? null;
    for (const [fid, entry] of familyBlocks) entry.block.classList.toggle('has-active', fid === familyId);
    const item = navItems.get(id);
    const visible = item && (!familyId || expanded.has(familyId)) ? item : familyBlocks.get(familyId)?.toggle;
    if (visible && nav.isConnected && nav.clientHeight) {
      const outside = visible.offsetTop < nav.scrollTop
        || visible.offsetTop + visible.offsetHeight > nav.scrollTop + nav.clientHeight;
      if (outside) nav.scrollTop = visible.offsetTop - nav.clientHeight / 2;
    }
  }
  let scrollFrame = 0;
  scroller.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      reconcile();
      syncActiveSection();
    });
  }, { passive: true });
  nav.addEventListener('click', (event) => {
    const toggle = event.target.closest('.rl-picker__nav-family');
    if (toggle) {
      const id = toggle.dataset.familyId;
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      writeExpanded();
      syncFamily(id);
      return;
    }
    const item = event.target.closest('.rl-picker__nav-item');
    const section = item && sections.get(item.dataset.sectionId);
    if (!section) return;
    if (query) {
      input.value = '';
      applyQuery('');
    }
    scroller.scrollTop = section.root.offsetTop;
    syncActiveSection();
  });

  // --- délégation : sélection, favori au survol, réorganisation des favoris --------------------

  // Étoile unique posée dans le coin de la cellule survolée. Zone cliquable limitée à l'étoile,
  // et ignorée juste après son apparition : un clic rapide sur une emote ne peut pas la mettre
  // en favori par accident.
  const STAR_ARM_MS = 250;
  let starShownAt = 0;
  let starPressed = false;
  function hideStar() {
    star.hidden = true;
    hoverCell = null;
  }
  function syncStar() {
    const favorite = view.favorites.has(hoverCell.dataset.id);
    star.classList.toggle('is-active', favorite);
    star.setAttribute('aria-pressed', String(favorite));
    const name = hoverCell.getAttribute('aria-label');
    star.title = favorite ? `Retirer ${name} des favoris (F)` : `Ajouter ${name} aux favoris (F)`;
    star.setAttribute('aria-label', star.title);
  }
  function showStar(cell) {
    if (hoverCell === cell) return;
    hoverCell = cell;
    if (cell.disabled || drag?.active) {
      star.hidden = true;
      return;
    }
    const size = star.offsetWidth || 24;
    star.style.top = `${cell.offsetTop}px`;
    star.style.left = `${cell.offsetLeft + cell.offsetWidth - size}px`;
    star.hidden = false;
    starShownAt = performance.now();
    syncStar();
  }
  scroller.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch' || drag?.active) return;
    const cell = event.target.closest('.rl-picker__cell');
    if (cell) showStar(cell);
  });
  scroller.addEventListener('pointerleave', () => { if (!drag?.active) hideStar(); });
  scroller.addEventListener('focusin', (event) => {
    const cell = event.target.closest('.rl-picker__cell');
    if (cell) showStar(cell);
  });
  scroller.addEventListener('focusout', (event) => {
    if (!scroller.contains(event.relatedTarget)) hideStar();
  });
  star.addEventListener('pointerdown', () => { starPressed = true; });

  // Réorganisation (section marquée reorderable, souris uniquement) : on déplace la cellule
  // au-delà d'un petit seuil, un repère vertical montre l'emplacement, le relâchement valide.
  let drag = null;
  let suppressClick = false;
  const dropMark = make('div', 'rl-picker__drop');
  dropMark.hidden = true;
  scroller.append(dropMark);
  function reorderSection() {
    return ordered.find((section) => section.group.reorderable) ?? null;
  }
  function endDrag(commit) {
    const current = drag;
    drag = null;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragUp);
    document.removeEventListener('keydown', onDragKey, true);
    if (!current?.active) return;
    current.cell.classList.remove('is-dragging');
    current.ghost.remove();
    dropMark.hidden = true;
    scroller.classList.remove('is-reordering');
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (!commit || current.dropIndex == null) return;
    const ids = current.ids.filter((id) => id !== current.id);
    const from = current.ids.indexOf(current.id);
    const to = current.dropIndex > from ? current.dropIndex - 1 : current.dropIndex;
    ids.splice(to, 0, current.id);
    if (ids.some((id, index) => id !== current.ids[index])) handlers.onReorder(ids);
  }
  function onDragMove(event) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      const section = reorderSection();
      if (!section) return endDrag(false);
      drag.active = true;
      drag.ids = section.group.emotes.map((item) => item.id);
      drag.cell.classList.add('is-dragging');
      drag.ghost = make('div', 'rl-picker__ghost');
      drag.ghost.append(drag.cell.firstElementChild.cloneNode(true));
      scroller.append(drag.ghost);
      scroller.classList.add('is-reordering');
      hideStar();
    }
    event.preventDefault();
    const box = scroller.getBoundingClientRect();
    const half = drag.cell.offsetWidth / 2;
    drag.ghost.style.left = `${event.clientX - box.left + scroller.scrollLeft - half}px`;
    drag.ghost.style.top = `${event.clientY - box.top + scroller.scrollTop - half}px`;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.rl-picker__cell[data-reorder]');
    if (!target || !scroller.contains(target)) return;
    const rect = target.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    drag.dropIndex = drag.ids.indexOf(target.dataset.id) + (before ? 0 : 1);
    const gap = cellMetrics().gap;
    dropMark.style.top = `${target.offsetTop}px`;
    dropMark.style.height = `${target.offsetHeight}px`;
    dropMark.style.left = `${before ? target.offsetLeft - gap / 2 - 1.5 : target.offsetLeft + target.offsetWidth + gap / 2 - 1.5}px`;
    dropMark.hidden = false;
  }
  function onDragUp() { endDrag(true); }
  function onDragKey(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    endDrag(false);
  }
  scroller.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || star.contains(event.target)) return;
    const cell = event.target.closest('.rl-picker__cell[data-reorder]');
    if (!cell || cell.disabled) return;
    drag = { id: cell.dataset.id, cell, x: event.clientX, y: event.clientY, active: false, dropIndex: null };
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragUp);
    document.addEventListener('keydown', onDragKey, true);
  });

  scroller.addEventListener('click', (event) => {
    if (suppressClick) return;
    if (star.contains(event.target)) {
      const armed = starPressed && performance.now() - starShownAt >= STAR_ARM_MS;
      starPressed = false;
      if (!hoverCell) return;
      // Étoile pas encore armée : le clic visait l'emote (clic rapide), c'est une sélection.
      if (!armed) return handlers.onSelect(hoverCell.dataset.id);
      handlers.onFavorite(hoverCell.dataset.id);
      syncStar();
      return;
    }
    starPressed = false;
    const cell = event.target.closest('.rl-picker__cell');
    if (cell && !cell.disabled) handlers.onSelect(cell.dataset.id);
  });
  scroller.addEventListener('keydown', (event) => {
    const cell = event.target.closest?.('.rl-picker__cell');
    if (!cell || event.key.toLowerCase() !== 'f' || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    handlers.onFavorite(cell.dataset.id);
  });

  return {
    nav,
    searchRow,
    input,
    scroller,
    setHandlers(next) { handlers = { ...handlers, ...next }; },
    setData,
    // Contrôles propres à l'hôte (ex. OAuth Twitch), affichés au bout de la ligne de recherche.
    setLead(node) {
      if (node === lead) return;
      lead?.remove();
      lead = node ?? null;
      if (lead) nav.prepend(lead);
    },
    setExtras(node) {
      extras?.remove();
      extras = node ?? null;
      if (extras) searchRow.append(extras);
    },
    setState,
    get query() { return query; },
    // Après rattachement au DOM par l'hôte (rendu global) : recalcul sans reconstruire.
    attached() {
      queueMicrotask(() => {
        refreshLayout();
        syncActiveSection();
      });
    },
  };
}
