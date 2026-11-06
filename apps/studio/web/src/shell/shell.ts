/// Raptoru Studio : la coque. Elle possède la navigation, pas les modules : chaque vue reste montée UNE fois par main.ts et la coque
// l'affiche via `showView` (même instance, mêmes relevés, mêmes lecteurs). Elle ajoute :
//   - la barre latérale (pilotage, favoris épinglés, Communauté, Activité, Système, Laboratoire), l'adresse canonique `?p=` (+ `?tab=`) ;
//   - la palette Ctrl+K (pages, anciens noms, récents) : elle OUVRE des pages, elle n'exécute aucune action métier ;
//   - la supervision compacte : un résumé dans la barre, une ligne par incident, « Vu » conservé ;
//   - un relevé unique (`Pulse`) : supervision et files en direct, pour les compteurs de la barre latérale même pages fermées, et les
//     pages de pilotage (pages/centre, regie, catalog, communaute, activite, labo), montées ici à la première ouverture.
import { mountActivite } from '../pages/activite.js';
import { mountCatalog } from '../pages/catalog.js';
import { mountCentre } from '../pages/centre.js';
import { mountCommunaute } from '../pages/communaute.js';
import { mountLabo } from '../pages/labo.js';
import type { HubCtx, HubView, Pulse } from '../pages/pulse.js';
import { mountRegie } from '../pages/regie.js';
import {
  decisions,
  liveCounts,
  loadChannelPoints,
  loadLive,
  steadyEnds,
} from './regie.js';
import { icon } from './icons.js';
import { loadReadiness, readiness } from '../readiness.js';
import {
  type Page,
  type ViewId,
  PAGES,
  SECTIONS,
  LAB_SECTION,
  addHostModulePages,
  crumbsOf,
  hrefOf,
  pageById,
  pageFromSearch,
  searchPages,
  sectionOf,
} from './registry.js';
import { fetchSupervision, renderBanner } from '../supervision-banner.js';
import { loadFeedSources } from '../activity-feed.js';
import { labOnMainCore, tryGetJson } from '../http.js';
import type { HostModuleStatus } from '../module-states.js';

const BRAND =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#06100e"/><path d="M16 42c9-18 22-18 32 0" fill="none" stroke="#27e3c0" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="26" r="11" fill="#f4c14e"/><path d="M26 27h12M32 21v12" stroke="#06100e" stroke-width="5" stroke-linecap="round"/><circle cx="49" cy="15" r="4" fill="#27e3c0"/></svg>';
const HEADERS = { 'x-raptoru-studio': '1' };
const navCount = new Map<string, string>();
/** Un compteur vivant dans la barre latérale (file TTS, temps de la Tombola…) ; `null` l'efface. */
export function setNavCount(page: string, text: string | null) {
  if ((navCount.get(page) ?? null) === text) return;
  if (text) navCount.set(page, text);
  else navCount.delete(page);
  document
    .querySelector<HTMLElement>('.rs-side')
    ?.dispatchEvent(new CustomEvent('rs-count'));
}
const FAV_KEY = 'raptoru-studio-favs';
const RECENT_KEY = 'raptoru-studio-recent';
const LAST_KEY = 'raptoru-studio-page';
const LEGACY_TAB_KEY = 'raptoru-studio-tab';
export const DEFAULT_FAVS = [
  'tts',
  'tombola',
  'alerts',
  'soundboard',
  'bonk',
  'spotify',
  'commands',
  'sub-wheel',
  'channel-points',
];
export const MAX_FAVS = 10;

const esc = (t: unknown) =>
  String(t ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* mode privé */
    }
  },
};

/** Favoris : identifiants de pages connues, sans doublon, `MAX_FAVS` au plus. Pur (testé). */
export function toggleFav(favs: string[], id: string): string[] {
  const known = favs.filter((f, i) => pageById(f) && favs.indexOf(f) === i);
  if (known.includes(id)) return known.filter((f) => f !== id);
  return pageById(id) ? [...known, id].slice(-MAX_FAVS) : known;
}
/** Récents : la page ouverte en tête, 6 au plus, sans doublon. Pur (testé). */
export const pushRecent = (recent: string[], id: string) =>
  [id, ...recent.filter((r) => r !== id)].slice(0, 6);

export interface ShellDeps {
  /** Affiche une vue existante (et masque les autres) ; `null` = aucune (page de regroupement). `focus` : la partie de
   * la vue qui est la page demandée (ex. Spotify dans Récompenses Twitch), `null` = la vue entière. */
  showView(view: ViewId | null, focus?: string | null): void;
}

type HubId = NonNullable<Page['hub']>;
const HUBS: Record<HubId, (root: HTMLElement, ctx: HubCtx) => HubView> = {
  centre: mountCentre,
  regie: mountRegie,
  modules: mountCatalog,
  communaute: mountCommunaute,
  activite: mountActivite,
  labo: mountLabo,
};

export function mountShell(app: HTMLElement, deps: ShellDeps) {
  let current: Page = PAGES[0]!;
  let incidentsOpen = false;
  /** Le relevé unique : les pages de pilotage et la barre latérale lisent ce seul objet. */
  const pulse: Pulse = {
    supOk: true,
    sup: null,
    hostModules: null,
    counts: navCount,
    favs: store.get(FAV_KEY, DEFAULT_FAVS).filter((f) => pageById(f)),
    recent: store.get(RECENT_KEY, []),
    profile: 'unknown',
    labMain: false,
  };

  const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
    app.querySelector<T>(s)!;
  const hub = $('#rs-hub');
  const side = $('.rs-side');

  // --- Barre latérale -----------------------------------------------------------------------------------------------
  function drawSide() {
    const link = (p: Page, on: boolean) => {
      const c = navCount.get(p.id);
      return `<a class="rs-nav" href="${hrefOf(p)}" data-page="${p.id}" title="${esc(p.label)}"${p.tint ? ` style="--tint:var(--${p.tint})"` : ''}${on ? ' aria-current="page"' : ''}>${icon(p.icon)}<span>${esc(p.label)}</span>${c ? `<em>${esc(c)}</em>` : ''}</a>`;
    };
    const here = sectionOf(current).id;
    const home = (id: string) => link(pageById(id)!, current.id === id);
    $('.rs-sections').innerHTML =
      `${home('centre')}${home('regie')}${home('moderation')}`;
    $('.rs-favs').innerHTML =
      `${pulse.favs.map((f) => link(pageById(f)!, current.id === f)).join('')}${link(pageById('modules')!, current.id === 'modules')}`;
    $('.rs-lab').innerHTML = `${SECTIONS.filter((x) =>
      ['communaute', 'activite', 'systeme'].includes(x.id),
    )
      .map((x) => link(pageById(x.home)!, here === x.id))
      .join('')}${link(pageById(LAB_SECTION.home)!, here === 'labo')}`;
  }
  /** Un compteur change sans réécrire la barre : le survol et le clic en cours restent en place. */
  side.addEventListener('rs-count', () => {
    for (const a of side.querySelectorAll<HTMLElement>('.rs-nav')) {
      const c = navCount.get(a.dataset.page ?? '');
      const em = a.querySelector('em');
      if (!c) em?.remove();
      else if (em) {
        if (em.textContent !== c) em.textContent = c;
      } else a.insertAdjacentHTML('beforeend', `<em>${esc(c)}</em>`);
    }
  });

  // --- Supervision compacte -------------------------------------------------------------------------------------
  function drawSup() {
    const chip = $('.rs-health');
    const strip = $('.rs-incidents');
    const sup = pulse.sup;
    chip.title = 'État de Raptoru : ouvrir le détail';
    const active = sup?.incidents.filter((i) => !i.endedAt) ?? [];
    const ended =
      sup?.incidents.filter((i) => i.endedAt && !i.acknowledged) ?? [];
    const plural = (n: number, a: string, b: string) => `${n} ${n > 1 ? b : a}`;
    chip.className = `rs-health ${!pulse.supOk ? 'is-unknown' : active.length ? 'is-down' : ended.length ? 'is-recovered' : sup ? 'is-ok' : 'is-unknown'}`;
    chip.innerHTML = `<i></i><span>${!pulse.supOk ? 'Supervision indisponible' : active.length ? `${plural(active.length, 'incident', 'incidents')} en cours` : ended.length ? `${plural(ended.length, 'rétabli', 'rétablis')} à confirmer` : sup ? 'Aucun incident' : 'Supervision…'}</span>`;
    // Une ligne, quel que soit le nombre d'incidents : la page reste en place, le détail s'ouvre à la demande.
    const names = [...new Set([...active, ...ended].map((i) => i.label))].join(
      ', ',
    );
    const html =
      pulse.supOk && sup && names
        ? `<details class="rs-inc-bar ${active.length ? 'is-down' : 'is-up'}"${incidentsOpen ? ' open' : ''}><summary><i></i><b>${active.length ? plural(active.length, 'incident', 'incidents') : plural(ended.length, 'rétabli', 'rétablis')}</b><span>${esc(names)}</span><em>Détails</em></summary>${renderBanner({ ...sup, now: new Date().toISOString() })}</details>`
        : '';
    // La durée d'un incident change à chaque relevé : on ne réécrit que si le fond a changé, ou bandeau ouvert.
    const sig = `${names}|${incidentsOpen ? sup?.now : ''}`;
    if (strip.dataset.sig !== sig) {
      strip.dataset.sig = sig;
      strip.innerHTML = html;
    }
    strip.hidden = !html;
    // The full-height views sit under the bar and the incident line.
    document.documentElement.style.setProperty(
      '--topbar-h',
      `${html ? strip.offsetHeight : 0}px`,
    );
  }
  $('.rs-incidents').addEventListener(
    'toggle',
    (e) => {
      incidentsOpen = (e.target as HTMLDetailsElement).open;
    },
    true,
  );

  // --- Le relevé unique -------------------------------------------------------------------------------------------
  function counts() {
    const c = liveCounts(pulse.live, Date.now());
    setNavCount('tts', c.tts);
    setNavCount('alerts', c.alerts);
    setNavCount('tombola', c.tombola);
    const n = decisions(pulse.live, pulse.sup, () => '').length;
    setNavCount('regie', n ? String(n) : null);
  }
  const views = new Map<HubId, { el: HTMLElement; view: HubView }>();
  const ctx: HubCtx = {
    refresh: () => void tick(),
    open: (id) => {
      const p = pageById(id);
      if (p) open(p);
    },
  };
  function hubView(id: HubId) {
    let v = views.get(id);
    if (!v) {
      const el = document.createElement('div');
      el.className = 'rs-hubpage';
      hub.append(el);
      v = { el, view: HUBS[id](el, ctx) };
      views.set(id, v);
    }
    return v;
  }
  const pushHub = () => {
    pulse.profile =
      document.querySelector<HTMLElement>('.rs-profile')?.dataset.profile ??
      'unknown';
    if (current.hub) hubView(current.hub).view.update(pulse);
  };
  async function poll() {
    const h = current.hub;
    const [snap, live] = await Promise.all([
      fetchSupervision(),
      loadLive(h === 'regie'),
    ]);
    pulse.supOk = !!snap;
    if (snap) pulse.sup = snap;
    pulse.live = steadyEnds(pulse.live, live);
    drawSup();
    counts();
    if (h === 'regie') pulse.cp = await loadChannelPoints();
    pushHub(); // ce qui est lu s'affiche sans attendre la vérification complète
    if (h === 'centre' || h === 'modules' || h === 'regie') {
      pulse.input = await loadReadiness();
      pulse.ready = readiness(pulse.input);
      pulse.hostModules =
        (await tryGetJson<{ modules: HostModuleStatus[] }>('/api/modules'))
          ?.modules ?? null;
    }
    if (h === 'activite') pulse.feed = await loadFeedSources();
    pushHub();
  }
  // Deux relevés ne se chevauchent jamais ; un relevé demandé pendant un autre part juste après.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling = false;
  let again = false;
  async function tick() {
    if (polling) {
      again = true;
      return;
    }
    polling = true;
    clearTimeout(timer);
    await poll().catch(() => {});
    polling = false;
    if (again) {
      again = false;
      void tick();
    } else
      timer = setTimeout(
        () => void tick(),
        current.hub === 'regie' ? 2000 : 5000,
      );
  }
  setInterval(counts, 1000); // le temps de la Tombola tourne entre deux relevés
  void labOnMainCore().then((main) => {
    pulse.labMain = main;
    pushHub();
  });

  // --- Navigation -----------------------------------------------------------------------------------------------
  function open(
    p: Page,
    { push = true, search = '' }: { push?: boolean; search?: string } = {},
  ) {
    current = p;
    if (push) history.pushState({ p: p.id }, '', search || hrefOf(p));
    if (p.hub) hubView(p.hub);
    for (const [id, v] of views) {
      v.el.hidden = id !== p.hub;
      v.view.setVisible(id === p.hub);
    }
    hub.hidden = !p.hub;
    deps.showView(p.hub ? null : p.view!, p.hub ? null : (p.anchor ?? null));
    if (p.hub) {
      pushHub();
      void tick(); // des données fraîches, pas au prochain relevé
    }
    // Extension Lab : la surface demandée (TTS, Bonk → panel ; vidéo, mobile) passe par ses propres boutons.
    const surface = new URL(
      search || hrefOf(p),
      location.href,
    ).searchParams.get('surface');
    if (p.view === 'extension-lab' && surface)
      document
        .querySelector<HTMLElement>(
          `#tab-extension-lab [data-surface="${CSS.escape(surface)}"]:not(.on)`,
        )
        ?.click();
    $('.rs-content').scrollTop = 0;
    pulse.recent = pushRecent(pulse.recent, p.id);
    store.set(RECENT_KEY, pulse.recent);
    store.set(LAST_KEY, p.id);
    if (p.view) store.set(LEGACY_TAB_KEY, p.view); // l'ancien Studio retrouve son dernier onglet
    drawSide();
    document.title = `${p.label} · Raptoru Studio`;
  }
  /** Les liens internes (`?p=` ou ancien `?tab=`) changent de page sans recharger les lecteurs. */
  app.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    // L'épingle est posée sur le lien d'un module : elle épingle, elle n'ouvre pas.
    const star = t.closest<HTMLElement>('[data-fav]')?.dataset.fav;
    if (star) {
      e.preventDefault();
      pulse.favs = toggleFav(pulse.favs, star);
      store.set(FAV_KEY, pulse.favs);
      drawSide();
      pushHub();
      return;
    }
    const a = t.closest<HTMLAnchorElement>('a[href]');
    if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey && a.target !== '_blank') {
      const url = new URL(a.href, location.href);
      const page =
        url.origin === location.origin && url.pathname === '/'
          ? pageFromSearch(url.search)
          : undefined;
      if (page) {
        e.preventDefault();
        open(page, {
          search: url.search.includes('surface=') ? `/${url.search}` : '',
        });
        return;
      }
    }
    const ack = t.closest<HTMLElement>('[data-sup-ack]')?.dataset.supAck;
    if (ack)
      void fetch('/api/supervision/ack', {
        method: 'POST',
        headers: { ...HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ id: ack }),
      }).then(() => tick());
    if (t.closest('.rs-search-btn')) palette.open();
    if (t.closest('.rs-health'))
      open(
        pageById(
          pulse.sup?.incidents.some((i) => !i.endedAt) ? 'centre' : 'activite',
        )!,
      );
  });
  addEventListener('popstate', () => {
    const p = pageFromSearch(location.search);
    if (p) open(p, { push: false });
  });

  // --- Palette Ctrl+K ---------------------------------------------------------------------------------------------
  const palette = (() => {
    const dlg = $<HTMLDialogElement>('.rs-palette');
    const input = dlg.querySelector<HTMLInputElement>('input')!;
    const out = dlg.querySelector<HTMLElement>('.rs-pal-list')!;
    let items: Page[] = [];
    let at = 0;
    const draw = () => {
      const q = input.value;
      items = q.trim()
        ? searchPages(q)
        : pulse.recent.flatMap((r) => pageById(r) ?? []).slice(0, 6);
      at = Math.min(at, Math.max(0, items.length - 1));
      out.innerHTML = items.length
        ? `${q.trim() ? '' : '<p class="rs-pal-h">Récents</p>'}${items.map((p, i) => `<a role="option" id="rs-pal-${i}" aria-selected="${i === at}" href="${hrefOf(p)}" data-page="${p.id}">${icon(p.icon)}<span><b>Ouvrir ${esc(p.label)}</b><small>${esc(crumbsOf(p).slice(0, -1).join(' / ') || sectionOf(p).label)} · ${esc(p.desc)}</small></span></a>`).join('')}`
        : `<p class="rs-pal-h">${q.trim() ? 'Aucune page ne correspond.' : 'Tape le nom d’un module, d’un ancien onglet ou d’une action.'}</p>`;
      input.setAttribute(
        'aria-activedescendant',
        items.length ? `rs-pal-${at}` : '',
      );
    };
    input.addEventListener('input', () => {
      at = 0;
      draw();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        at = Math.min(items.length - 1, at + 1);
        draw();
        e.preventDefault();
      }
      if (e.key === 'ArrowUp') {
        at = Math.max(0, at - 1);
        draw();
        e.preventDefault();
      }
      if (e.key === 'Enter' && items[at]) {
        e.preventDefault();
        dlg.close();
        open(items[at]!);
      }
    });
    out.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a')) dlg.close();
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    return {
      open() {
        input.value = '';
        at = 0;
        draw();
        dlg.showModal();
        input.focus();
      },
    };
  })();
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      palette.open();
    }
  });

  // --- Démarrage ------------------------------------------------------------------------------------------------
  const initialSearch = location.search;
  const lastId = store.get<string>(LAST_KEY, '');
  const asked = pageFromSearch(initialSearch);
  const last =
    pageById(store.get<string>(LAST_KEY, '')) ??
    (() => {
      try {
        return pageFromSearch(
          `?tab=${localStorage.getItem(LEGACY_TAB_KEY) ?? ''}`,
        );
      } catch {
        return undefined;
      }
    })();
  open(asked ?? last ?? pageById('centre')!, { push: false });
  history.replaceState(
    { p: current.id },
    '',
    asked ? initialSearch || hrefOf(current) : hrefOf(current),
  );
  // The Core's modules: their pages exist from now on. An address, a favourite or the last page that named one, read
  // before this answer, are honoured now.
  void tryGetJson<{
    modules: (HostModuleStatus & { label: string; description: string })[];
  }>('/api/modules').then((r) => {
    if (!r) return;
    pulse.hostModules = r.modules;
    addHostModulePages(r.modules);
    pulse.favs = store.get(FAV_KEY, DEFAULT_FAVS).filter((f) => pageById(f));
    drawSide();
    const late =
      pageFromSearch(initialSearch) ?? (asked ? undefined : pageById(lastId));
    if (late?.anchor && late !== current) open(late, { push: false });
    else pushHub();
  });
  void tick();
  return {
    open: (id: string) => {
      const p = pageById(id);
      if (p) open(p);
    },
  };
}

/** Squelette HTML du shell (les vues existantes sont insérées dans `.rs-views`). */
export function shellHtml(viewsHtml: string) {
  return `
  <div class="rs-shell">
    <aside class="rs-side" aria-label="Navigation">
      <a class="rs-brand" href="/?p=centre" data-page="centre" aria-label="raptoru_ · Centre de contrôle">${BRAND}<span>raptoru_</span></a>
      <button type="button" class="rs-search-btn" aria-label="Rechercher">${icon('search')}<span>Rechercher…</span><kbd>Ctrl K</kbd></button>
      <nav class="rs-sections" aria-label="Pilotage"></nav>
      <p class="rs-side-h">Modules</p>
      <nav class="rs-favs" aria-label="Modules"></nav>
      <span class="rs-grow"></span>
      <nav class="rs-lab" aria-label="Communauté et système"></nav>
      <div class="rs-side-foot">
        <div class="sim-widget"></div>
        <button type="button" class="rs-health is-unknown"><i></i><span>Supervision…</span></button>
        <span class="topbar-safety rs-profile" data-profile="unknown" data-short="…">Profil en cours de lecture…</span>
        <div class="update-widget"></div>
      </div>
    </aside>
    <div class="rs-main">
      <div class="rs-incidents" hidden></div>
      <div class="rs-content">
        <main id="rs-hub" class="rs-hub" hidden></main>
        ${viewsHtml}
      </div>
    </div>
    <dialog class="rs-palette" aria-label="Rechercher ou ouvrir">
      <div class="rs-pal-in">${icon('search')}<input type="text" placeholder="Rechercher ou ouvrir… (Tombola, Spotify, défis…)" aria-controls="rs-pal-list" role="combobox" aria-expanded="true" autocomplete="off"></div>
      <div class="rs-pal-list" id="rs-pal-list" role="listbox"></div>
    </dialog>
  </div>`;
}
