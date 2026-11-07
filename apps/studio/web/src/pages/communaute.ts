import { ago, esc, fmt, ic, page, patch, poller, pp } from '../ds/ds.js';
import { tryGetJson } from '../http.js';
import {
  modGet,
  openViewer,
  ROLE,
  searchViewers,
  type SearchHit,
} from '../mod/mod.js';
import { icon } from '../shell/icons.js';
import { hrefOf, pageById, type Page } from '../shell/registry.js';
import type { HubView } from './pulse.js';

// Communauté : les gens d'abord. Retrouver un viewer, voir qui mène et qui compose l'équipe, puis ce qu'on construit pour eux. La
// recherche ouvre la même fiche que la Modération. Un chiffre ou une liste illisible n'est pas affiché.

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
];
interface Facts {
  xp: boolean | null;
  items: number | null;
  defis: number | null;
}
interface Member {
  viewer_id: string;
  display_name: string;
  role: string;
  last_seen: string | null;
}
interface Top {
  rank: number;
  twitchUserId: string;
  displayName: string;
  level: number;
  xp: number;
}

export function mountCommunaute(root: HTMLElement): HubView {
  const p = page(root, { title: 'Communauté' });
  p.body.innerHTML = `<div class="co">
    <div class="co-main">
      <form class="co-find" data-find><label class="d-fld">${ic('search')}<input type="search" data-q placeholder="Retrouver un viewer" aria-label="Retrouver un viewer" autocomplete="off"></label><div class="co-hits" data-hits></div></form>
      <section><h2 class="d-lb">Le plus d’XP</h2><div data-top></div></section>
    </div>
    <div class="co-side">
      <section><h2 class="d-lb">Équipe</h2><div data-team></div><a class="d-btn ghost sm" href="?p=moderation" data-page="moderation" data-mod-tab="team">${ic('shield')}Droits de l’équipe</a></section>
      <section><h2 class="d-lb">Pour les viewers</h2><nav class="co-doors" data-doors></nav></section>
    </div>
  </div>`;
  const q = p.body.querySelector<HTMLInputElement>('[data-q]')!;
  const hits = p.body.querySelector<HTMLElement>('[data-hits]')!;
  const doors = p.body.querySelector<HTMLElement>('[data-doors]')!;
  const top = p.body.querySelector<HTMLElement>('[data-top]')!;
  const team = p.body.querySelector<HTMLElement>('[data-team]')!;
  let facts: Facts = { xp: null, items: null, defis: null };
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
    const [xp, items, defis, staff, board] = await Promise.all([
      tryGetJson<{ enabled?: boolean }>('/api/progression/state'),
      tryGetJson<unknown[] | { items?: unknown[] }>('/api/cosmetics/items'),
      tryGetJson<unknown[] | { challenges?: unknown[] }>('/api/challenges'),
      modGet<{ members: Member[] }>('team').catch(() => null),
      tryGetJson<{ entries: Top[] }>(
        '/api/progression/leaderboard?by=xp&period=all',
      ),
    ]);
    const size = (v: unknown, k: string) =>
      Array.isArray(v)
        ? v.length
        : ((v as Record<string, unknown[]> | null)?.[k]?.length ?? null);
    facts = {
      xp: xp ? !!xp.enabled : null,
      items: size(items, 'items'),
      defis: size(defis, 'challenges'),
    };
    paint();
    patch(
      team,
      staff
        ? staff.members
            .map(
              (m) =>
                `<button type="button" class="co-v" data-viewer="${esc(m.viewer_id)}">${pp(m.display_name, 26)}<b>${esc(m.display_name)}</b><span class="d-tag">${esc(ROLE[m.role] ?? m.role)}</span>${m.last_seen ? `<small>${esc(ago(m.last_seen))}</small>` : ''}</button>`,
            )
            .join('')
        : '<p class="d-note">Équipe illisible pour le moment.</p>',
    );
    patch(
      top,
      !board
        ? '<p class="d-note">Classement indisponible sur ce profil.</p>'
        : board.entries.length
          ? board.entries
              .slice(0, 8)
              .map(
                (r) =>
                  `<button type="button" class="co-v" data-viewer="${esc(r.twitchUserId)}"><em>${r.rank}</em>${pp(r.displayName, 26)}<b>${esc(r.displayName)}</b><small>Niveau ${fmt(r.level)} · ${fmt(r.xp)} XP</small></button>`,
              )
              .join('')
          : '<p class="d-empty">Personne au classement pour l’instant.</p>',
    );
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
    const t = e.target as HTMLElement;
    const id = t.closest<HTMLElement>('[data-viewer]')?.dataset.viewer;
    if (id) openViewer(id);
    const tab = t.closest<HTMLElement>('[data-mod-tab]')?.dataset.modTab;
    if (tab)
      window.dispatchEvent(new CustomEvent('raptoru:mod-tab', { detail: tab }));
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
