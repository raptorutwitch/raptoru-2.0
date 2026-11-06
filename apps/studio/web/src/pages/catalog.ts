import { esc, ic, page, patch, seg, stateChip } from '../ds/ds.js';
import {
  type CatalogFilter,
  inFilter,
  pageStates,
  type PageState,
} from '../module-states.js';
import { icon } from '../shell/icons.js';
import { hrefOf, moduleGroups, type Page } from '../shell/registry.js';
import type { HubView, Pulse } from './pulse.js';

// Le catalogue : toute la chaîne en un écran. Un module du Core sans page apparaît ici tout seul (registre : addHostModulePages), avec
// son état réel. Aucun état inventé : un module que rien ne lit n'en affiche pas.

const LABEL: Record<CatalogFilter, string> = {
  all: 'Tous',
  attention: 'À regarder',
  on: 'Prêts',
  off: 'Coupés',
};
const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const tile = (
  p: Page,
  st: PageState | undefined,
  pinned: boolean,
  count: string | undefined,
) =>
  `<a class="cat-m" href="${hrefOf(p)}" data-page="${p.id}" data-l="${st?.level ?? ''}"${p.tint ? ` style="--tint:var(--${p.tint})"` : ''}>
    <span class="cat-m__ic">${icon(p.icon, '')}</span>
    <b>${esc(p.label)}</b>
    <span class="cat-m__s">${count ? `<em>${esc(count)}</em>` : ''}${st ? `<i></i>${esc(st.text)}` : ''}</span>
    <button type="button" class="cat-m__pin d-ib" data-fav="${p.id}" aria-pressed="${pinned}" aria-label="${pinned ? `Retirer ${esc(p.label)} de la barre latérale` : `Épingler ${esc(p.label)} dans la barre latérale`}" title="${pinned ? 'Retirer de la barre latérale' : 'Épingler dans la barre latérale'}">${ic('star')}</button>
    <small>${esc(p.desc)}</small>
  </a>`;

export function mountCatalog(root: HTMLElement): HubView {
  const p = page(root, { title: 'Modules' });
  p.body.innerHTML = `<div class="cat" data-z="list"></div>`;
  const list = p.body.querySelector<HTMLElement>('[data-z="list"]')!;
  patch(
    p.actions,
    `<label class="d-fld cat-find">${ic('search')}<input type="search" data-find placeholder="Chercher un module" aria-label="Chercher un module"></label><span data-z="seg"></span>`,
  );
  const find = p.actions.querySelector<HTMLInputElement>('[data-find]')!;
  const segEl = p.actions.querySelector<HTMLElement>('[data-z="seg"]')!;
  let filter: CatalogFilter = 'all';
  let last: Pulse | null = null;

  function draw() {
    const u = last;
    if (!u) return;
    const states = pageStates(u.ready, u.hostModules);
    const q = norm(find.value.trim());
    const all = moduleGroups().flatMap((g) => g.pages);
    const hits = (f: CatalogFilter) =>
      all.filter((m) => inFilter(states.get(m.id), f)).length;
    patch(
      segEl,
      seg(
        'data-filter',
        (Object.keys(LABEL) as CatalogFilter[]).map(
          (f) => [f, `${LABEL[f]} ${hits(f)}`] as [string, string],
        ),
        filter,
      ),
    );
    const need = hits('attention');
    patch(
      p.state,
      u.ready
        ? stateChip(
            need ? 'w' : '',
            need ? `${need} à regarder` : 'Tout va bien',
          )
        : stateChip('off', 'Lecture…'),
    );
    const groups = moduleGroups()
      .map((g) => ({
        ...g,
        pages: g.pages.filter(
          (m) =>
            inFilter(states.get(m.id), filter) &&
            (!q ||
              norm(`${m.label} ${m.desc} ${m.keywords ?? ''}`).includes(q)),
        ),
      }))
      .filter((g) => g.pages.length);
    patch(
      list,
      groups
        .map(
          (g) =>
            `<section class="cat-g"><h2 class="d-lb">${esc(g.group)}</h2><div class="cat-w">${g.pages
              .map((m) =>
                tile(
                  m,
                  states.get(m.id),
                  u.favs.includes(m.id),
                  u.counts.get(m.id),
                ),
              )
              .join('')}</div></section>`,
        )
        .join('') ||
        `<p class="d-empty">${q ? 'Aucun module ne correspond.' : 'Aucun module dans ce filtre.'}</p>`,
    );
  }
  find.addEventListener('input', draw);
  root.addEventListener('click', (e) => {
    const f = (e.target as HTMLElement).closest<HTMLElement>('[data-filter]')
      ?.dataset.filter;
    if (f) {
      filter = f as CatalogFilter;
      draw();
    }
  });
  return {
    setVisible() {},
    update(u) {
      last = u;
      draw();
    },
  };
}
