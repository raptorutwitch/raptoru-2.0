import { esc, fmt, ic, page, patch, poller, pp } from '../ds/ds.js';
import { tryGetJson } from '../http.js';
import {
  modGet,
  openViewer,
  searchViewers,
  type SearchHit,
} from '../mod/mod.js';
import { icon } from '../shell/icons.js';
import { hrefOf, pageById, type Page } from '../shell/registry.js';
import type { HubView } from './pulse.js';

// Communauté : retrouver un viewer, puis ce qu'on construit pour eux. La recherche ouvre la même fiche que la Modération. Les
// chiffres viennent des lectures des pages elles-mêmes ; un chiffre illisible n'est pas affiché.

const DOORS: [string, (f: Facts) => string][] = [
  [
    'progression',
    (f) => (f.xp === null ? '' : f.xp ? 'Comptage actif' : 'Comptage coupé'),
  ],
  [
    'shop',
    (f) =>
      f.items === null
        ? ''
        : `${fmt(f.items)} article${f.items > 1 ? 's' : ''}`,
  ],
  [
    'challenges',
    (f) =>
      f.defis === null ? '' : `${fmt(f.defis)} défi${f.defis > 1 ? 's' : ''}`,
  ],
  ['moderation', (f) => (f.team === null ? '' : `Équipe de ${fmt(f.team)}`)],
];
interface Facts {
  xp: boolean | null;
  items: number | null;
  defis: number | null;
  team: number | null;
}

export function mountCommunaute(root: HTMLElement): HubView {
  const p = page(root, { title: 'Communauté' });
  p.body.innerHTML = `<div class="co">
    <form class="co-find" data-find><label class="d-fld">${ic('search')}<input type="search" data-q placeholder="Retrouver un viewer" aria-label="Retrouver un viewer" autocomplete="off"></label><div class="co-hits" data-hits></div></form>
    <nav class="co-doors" data-doors></nav>
  </div>`;
  const q = p.body.querySelector<HTMLInputElement>('[data-q]')!;
  const hits = p.body.querySelector<HTMLElement>('[data-hits]')!;
  const doors = p.body.querySelector<HTMLElement>('[data-doors]')!;
  let facts: Facts = { xp: null, items: null, defis: null, team: null };
  let seq = 0;
  let timer = 0;

  const paint = () =>
    patch(
      doors,
      DOORS.map(([id, fact]) => {
        const d = pageById(id) as Page;
        return `<a class="co-d" href="${hrefOf(d)}" data-page="${d.id}"${d.tint ? ` style="--tint:var(--${d.tint})"` : ''}><span class="co-d__ic">${icon(d.icon, '')}</span><span class="co-d__t"><b>${esc(d.label)}</b><small>${esc(d.desc)}</small></span><em>${esc(fact(facts))}</em>${ic('chevron')}</a>`;
      }).join(''),
    );
  const read = poller(async () => {
    const [xp, items, defis, team] = await Promise.all([
      tryGetJson<{ enabled?: boolean }>('/api/progression/state'),
      tryGetJson<unknown[] | { items?: unknown[] }>('/api/cosmetics/items'),
      tryGetJson<unknown[] | { challenges?: unknown[] }>('/api/challenges'),
      modGet<{ members: unknown[] }>('team').catch(() => null),
    ]);
    const size = (v: unknown, k: string) =>
      Array.isArray(v)
        ? v.length
        : ((v as Record<string, unknown[]> | null)?.[k]?.length ?? null);
    facts = {
      xp: xp ? !!xp.enabled : null,
      items: size(items, 'items'),
      defis: size(defis, 'challenges'),
      team: team?.members.length ?? null,
    };
    paint();
  }, 15000);

  async function search() {
    const mine = ++seq;
    const text = q.value.trim();
    if (text.length < 2) return patch(hits, '');
    let list: SearchHit[] | null = null;
    try {
      list = await searchViewers(text);
    } catch {
      /* dit ci-dessous */
    }
    if (mine !== seq) return;
    patch(
      hits,
      list === null
        ? '<p class="d-note bad">Recherche indisponible.</p>'
        : list.length
          ? list
              .map(
                (v) =>
                  `<button type="button" class="co-v" data-viewer="${esc(v.viewer_id)}">${pp(v.display_name, 26)}<b>${esc(v.display_name)}</b>${v.role && v.role !== 'viewer' ? `<span class="d-tag">${esc(v.role)}</span>` : ''}${v.restriction ? `<span class="d-tag bad">${v.restriction === 'block' ? 'Bloqué' : 'En cooldown'}</span>` : ''}</button>`,
              )
              .join('')
          : '<p class="d-note">Personne à ce nom.</p>',
    );
  }
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void search(), 220);
  });
  p.body.addEventListener('submit', (e) => {
    e.preventDefault();
    void search();
  });
  p.body.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-viewer]')
      ?.dataset.viewer;
    if (id) openViewer(id);
  });
  paint();
  return {
    setVisible(v) {
      if (v) read.start();
      else read.stop();
    },
    update() {},
  };
}
