// Raptoru Studio — le SHELL de la refonte (docs/RAPTORU_STUDIO_UX_UI_2026-11-04.md § B.3, C, E.3).
// Il possède la navigation, pas les modules : chaque vue existante reste montée UNE fois par main.ts et le shell
// l'affiche via `showView` (même instance, mêmes pollers, mêmes lecteurs). Il ajoute :
//   - six rubriques + Laboratoire à part, favoris (6 au plus), fil d'Ariane, adresse canonique `?p=` (+ `?tab=` alias) ;
//   - la palette Ctrl+K (pages, anciens noms, récents) — elle OUVRE des pages, elle n'exécute aucune action métier ;
//   - la supervision compacte : un résumé dans l'en-tête, une ligne par incident, « Vu » conservé (même route) ;
//   - les pages de regroupement (Centre de contrôle, Régie, Modules, Communauté, Activité, Laboratoire).
import {
  LIVE_ACTIONS,
  loadLive,
  type LiveState,
  CP_OFF_CONFIRM,
  CP_ON_CONFIRM,
  loadChannelPoints,
  regieHtml,
  setChannelPoints,
} from './regie.js';
import { icon } from './icons.js';
import {
  type Check,
  loadReadiness,
  readiness,
  readinessHtml,
} from '../readiness.js';
import {
  type Page,
  type ViewId,
  PAGES,
  SECTIONS,
  LAB_SECTION,
  addHostModulePages,
  crumbsOf,
  hrefOf,
  moduleGroups,
  pageById,
  pageFromSearch,
  searchPages,
  sectionOf,
} from './registry.js';
import {
  fetchSupervision,
  renderHistory,
  type SupervisionSnapshot,
} from '../supervision-banner.js';
import {
  type FeedFilter,
  feedHtml,
  loadFeedSources,
  mergeFeed,
} from '../activity-feed.js';
import { labOnMainCore, tryGetJson } from '../http.js';
import {
  type CatalogFilter,
  type HostModuleStatus,
  inFilter,
  pageStates,
} from '../module-states.js';

const HEADERS = { 'x-raptoru-studio': '1' };
const LEVEL_CLASS: Record<string, string> = {
  ok: 'is-ok',
  warn: 'is-warn',
  error: 'is-down',
  unknown: 'is-warn',
  off: 'is-off',
};
const FAV_KEY = 'raptoru-studio-favs';
const RECENT_KEY = 'raptoru-studio-recent';
const LAST_KEY = 'raptoru-studio-page';
const LEGACY_TAB_KEY = 'raptoru-studio-tab';
export const DEFAULT_FAVS = [
  'tombola',
  'alerts',
  'channel-points',
  'challenges',
];
export const MAX_FAVS = 6;

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

export function mountShell(app: HTMLElement, deps: ShellDeps) {
  let favs: string[] = store
    .get(FAV_KEY, DEFAULT_FAVS)
    .filter((f) => pageById(f));
  let recent: string[] = store.get(RECENT_KEY, []);
  let current: Page = PAGES[0]!;
  let sup: SupervisionSnapshot | null = null;
  let supOk = true; // le serveur Studio a-t-il répondu au dernier relevé ?

  const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
    app.querySelector<T>(s)!;
  const hub = $('#rs-hub');

  // --- Barre latérale -----------------------------------------------------------------------------------------------
  function drawSide() {
    const link = (p: Page, on: boolean, cls = '') =>
      `<a class="rs-nav ${cls}" href="${hrefOf(p)}" data-page="${p.id}"${on ? ' aria-current="page"' : ''}>${icon(p.icon)}<span>${esc(p.label)}</span></a>`;
    const here = sectionOf(current).id;
    $('.rs-sections').innerHTML = SECTIONS.map((s) =>
      link(pageById(s.home)!, here === s.id),
    ).join('');
    $('.rs-favs').innerHTML = favs.length
      ? favs.map((f) => link(pageById(f)!, current.id === f, 'rs-fav')).join('')
      : '<p class="rs-hint">Étoile ☆ en haut d’une page pour l’épingler ici.</p>';
    $('.rs-lab').innerHTML = link(pageById(LAB_SECTION.home)!, here === 'labo');
  }

  // --- En-tête --------------------------------------------------------------------------------------------------
  function drawHead() {
    const crumbs = crumbsOf(current);
    const sec = sectionOf(current);
    $('.rs-crumbs').innerHTML = crumbs
      .map((c, i) =>
        i === 0 && crumbs.length > 1
          ? `<a href="${hrefOf(pageById(sec.home)!)}" data-page="${sec.home}">${esc(c)}</a>`
          : `<span${i === crumbs.length - 1 ? ' aria-current="location"' : ''}>${esc(c)}</span>`,
      )
      .join('<span class="rs-sep" aria-hidden="true">/</span>');
    const fav = favs.includes(current.id);
    const star = $('.rs-star');
    star.hidden = !!current.hub && current.id !== 'regie';
    star.setAttribute('aria-pressed', String(fav));
    star.title = fav ? 'Retirer des favoris' : 'Ajouter aux favoris';
    star.innerHTML = `${icon('star')}<span class="rs-sr">${star.title}</span>`;
    document.title = `${current.label} · Raptoru Studio`;
  }

  // --- Supervision compacte -------------------------------------------------------------------------------------
  function drawSup() {
    const chip = $('.rs-health');
    const strip = $('.rs-incidents');
    if (!supOk) {
      chip.className = 'rs-health is-unknown';
      chip.innerHTML = `<i></i>Supervision indisponible`;
      strip.innerHTML = '';
      strip.hidden = true;
      return;
    }
    const active = sup?.incidents.filter((i) => !i.endedAt) ?? [];
    const ended =
      sup?.incidents.filter((i) => i.endedAt && !i.acknowledged) ?? [];
    chip.className = `rs-health ${active.length ? 'is-down' : ended.length ? 'is-recovered' : sup ? 'is-ok' : 'is-unknown'}`;
    chip.innerHTML = `<i></i>${active.length ? `${active.length} incident${active.length > 1 ? 's' : ''} en cours` : ended.length ? `${ended.length} rétabli${ended.length > 1 ? 's' : ''} à confirmer` : sup ? 'Aucun incident' : 'Supervision…'}`;
    const t = (iso: string) =>
      new Date(iso).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      });
    const rows = [
      ...active.map(
        (i) =>
          `<div class="rs-inc is-down" role="alert"><b>${esc(i.label)}</b><span>${esc(i.value)}${i.cause ? ` · ${esc(i.cause)}` : ''} · depuis ${t(i.startedAt)}</span><em>${i.action === 'manual' ? 'Action requise' : 'Récupération automatique'}</em>${i.hint ? `<small>${esc(i.hint)}</small>` : ''}</div>`,
      ),
      ...ended.map(
        (i) =>
          `<div class="rs-inc is-up" role="status"><b>${esc(i.label)} rétabli</b><span>de ${t(i.startedAt)} à ${t(i.endedAt!)}${i.cause ? ` · ${esc(i.cause)}` : ''}</span><button type="button" class="rs-btn quiet sm" data-sup-ack="${esc(i.id)}">Vu</button></div>`,
      ),
    ].join('');
    // One line, whatever the number of incidents: the page stays in place; the detail opens on demand.
    const names = [...active, ...ended].map((i) => i.label).join(', ');
    const html = rows
      ? `<details class="rs-inc-bar ${active.length ? 'is-down' : 'is-up'}"${incidentsOpen ? ' open' : ''}><summary><i></i><b>${active.length ? `${active.length} incident${active.length > 1 ? 's' : ''}` : `${ended.length} rétabli${ended.length > 1 ? 's' : ''}`}</b><span>${esc(names)}</span><em>Détails</em></summary>${rows}</details>`
      : '';
    if (strip.dataset.sig !== html) {
      strip.dataset.sig = html;
      strip.innerHTML = html;
    }
    strip.hidden = !html;
    // The full-height views (Modération, Commandes, Extension Lab) sit under the bar and the incident line.
    document.documentElement.style.setProperty(
      '--topbar-h',
      `${$('.rs-top').offsetHeight + (html ? strip.offsetHeight : 0)}px`,
    );
  }
  async function pollSup() {
    const snap = await fetchSupervision();
    supOk = !!snap;
    if (snap) sup = snap;
    drawSup();
    if (current.hub === 'regie')
      [regieCp, regieLive] = await Promise.all([
        loadChannelPoints(),
        loadLive(),
      ]);
    // Refonte F4: « Prêt pour le live », read from the modules' own routes while the Centre or the catalogue is open.
    if (
      current.hub === 'centre' ||
      current.hub === 'modules' ||
      current.hub === 'regie'
    ) {
      ready = readiness(await loadReadiness());
      hostModules =
        (await tryGetJson<{ modules: HostModuleStatus[] }>('/api/modules'))
          ?.modules ?? null;
    }
    if (current.hub === 'activite') feed = await loadFeedSources();
    if (
      current.hub === 'centre' ||
      current.hub === 'activite' ||
      current.hub === 'regie' ||
      current.hub === 'modules'
    )
      drawHub();
  }
  // Régie : état des points de chaîne (lu à chaque relevé tant que la Régie est ouverte) et message de la dernière action.
  let regieCp: Awaited<ReturnType<typeof loadChannelPoints>> | undefined;
  let ready: Check[] | undefined;
  let regieMsg = '';
  let regieLive: LiveState | undefined;
  let liveMsg = '';
  let hostModules: HostModuleStatus[] | null = null;
  let feed: Awaited<ReturnType<typeof loadFeedSources>> | undefined;
  let feedFilter: FeedFilter = 'all';
  let catalogFilter: CatalogFilter = 'all';
  let incidentsOpen = false;
  let labMain = false;
  void labOnMainCore().then((main) => {
    labMain = main;
    if (current.hub === 'labo') drawHub();
  });
  $('.rs-incidents').addEventListener(
    'toggle',
    (e) => {
      incidentsOpen = (e.target as HTMLDetailsElement).open;
    },
    true,
  );
  hub.addEventListener('click', (e) => {
    const liveId = (e.target as HTMLElement).closest<HTMLElement>('[data-live]')
      ?.dataset.live;
    const action = liveId ? LIVE_ACTIONS[liveId] : undefined;
    if (action) {
      if (action.confirm && !confirm(action.confirm)) return;
      void action
        .run()
        .then(
          () => {
            liveMsg = `${action.label.replace('…', '')} : fait.`;
          },
          (err: Error) => {
            liveMsg = `Refusé : ${err.message}`;
          },
        )
        .then(pollSup);
      return;
    }
    if (!(e.target as HTMLElement).closest('[data-regie="cp"]') || !regieCp)
      return;
    const on = !regieCp.enabled;
    if (!confirm(on ? CP_ON_CONFIRM : CP_OFF_CONFIRM)) return;
    void setChannelPoints(on)
      .then(
        () => {
          regieMsg = on
            ? 'Automatisations activées.'
            : 'Automatisations coupées.';
        },
        (err: Error) => {
          regieMsg = `Refusé : ${err.message}`;
        },
      )
      .then(pollSup);
  });

  // --- Pages de regroupement ------------------------------------------------------------------------------------
  const card = (p: Page) =>
    `<a class="rs-tile" href="${hrefOf(p)}" data-page="${p.id}">${icon(p.icon)}<span><b>${esc(p.label)}</b><small>${esc(p.desc)}</small></span></a>`;
  const chip = (p: Page) =>
    `<a class="rs-tile" href="${hrefOf(p)}" data-page="${p.id}">${icon(p.icon)}<span><b>${esc(p.label)}</b></span></a>`;
  const list = (ids: string[]) =>
    ids.map((id) => pageById(id)).filter((p): p is Page => !!p);
  /** Rewrites the page only when it changed; what the streamer unfolded stays unfolded across refreshes. */
  function setHub(html: string) {
    if (hub.dataset.sig === html) return;
    hub.dataset.sig = html;
    const open = new Set(
      [...hub.querySelectorAll<HTMLElement>('details[open]')].map(
        (d) =>
          d.closest<HTMLElement>('[data-check]')?.dataset.check ?? d.className,
      ),
    );
    hub.innerHTML = html;
    for (const d of hub.querySelectorAll<HTMLDetailsElement>('details'))
      d.open = open.has(
        d.closest<HTMLElement>('[data-check]')?.dataset.check ?? d.className,
      );
  }
  function drawHub() {
    const h = current.hub;
    if (!h) return;
    const head = (title: string, lead: string) =>
      `<header class="rs-page-head"><h1>${esc(title)}</h1><p>${lead}</p></header>`;
    if (h === 'centre') {
      const active = sup?.incidents.filter((i) => !i.endedAt) ?? [];
      const profile =
        document.querySelector<HTMLElement>('.rs-profile')?.dataset.profile;
      setHub(`${head('Centre de contrôle', 'Ce qui demande ton attention avant et pendant le live.')}
        <div class="rs-centre">
          <div>${readinessHtml(
            ready,
            (id) => hrefOf(pageById(id) ?? pageById('centre')!),
            profile === 'lab',
          )}</div>
          <div>
            <section class="rs-panel"><h2>Santé</h2>
              <p class="rs-status ${!supOk ? 'is-warn' : active.length ? 'is-down' : 'is-ok'}"><i></i>${!supOk ? 'Supervision indisponible' : active.length ? `${active.length} incident${active.length > 1 ? 's' : ''} en cours` : 'Aucun incident en cours'}</p>
              ${sup?.history.length ? `<h3>Dernières coupures</h3>${renderHistory(sup.history, 4)}` : ''}
              <p class="rs-links"><a href="${hrefOf(pageById('activite')!)}" data-page="activite">Activité</a><a href="${hrefOf(pageById('systeme')!)}" data-page="systeme">Système</a></p></section>
            <section class="rs-panel"><h2>Accès rapides</h2><div class="rs-tiles is-compact">${
              [
                ...list(favs),
                ...list(
                  recent.filter((r) => r !== 'centre' && !favs.includes(r)),
                ),
              ]
                .slice(0, 6)
                .map(chip)
                .join('') || '<p class="rs-muted">Aucun favori.</p>'
            }</div></section>
          </div>
        </div>`);
    } else if (h === 'regie') {
      // What needs a look right now, among all the modules: without leaving the page, without a list to keep.
      const watch = [...pageStates(ready, hostModules)].filter(
        ([, st]) => st.level === 'error' || st.level === 'warn',
      );
      setHub(`${head('Régie live', 'Tenir le stream : les files, ce qui demande un regard, et les contrôles de chaque module.')}
        ${regieHtml({ sup, supOk, cp: regieCp, message: regieMsg, live: regieLive, liveMessage: liveMsg, profile: document.querySelector<HTMLElement>('.rs-profile')?.dataset.profile ?? 'unknown', href: (id) => hrefOf(pageById(id) ?? pageById('regie')!) })}
        ${
          watch.length
            ? `<section class="rs-panel"><h2>À surveiller</h2><div class="rs-rows">${watch
                .map(([id, st]) => {
                  const p = pageById(id);
                  return p
                    ? `<a class="rs-row rs-row-2" href="${hrefOf(p)}" data-page="${p.id}"><b>${esc(p.label)}</b><span class="rs-status ${LEVEL_CLASS[st.level]}"><i></i>${esc(st.text)}</span></a>`
                    : '';
                })
                .join('')}</div></section>`
            : ''
        }`);
    } else if (h === 'modules') {
      const states = pageStates(ready, hostModules);
      const groups = moduleGroups()
        .map((g) => ({
          ...g,
          pages: g.pages.filter((p) =>
            inFilter(states.get(p.id), catalogFilter),
          ),
        }))
        .filter((g) => g.pages.length);
      const FILTERS: [CatalogFilter, string][] = [
        ['all', 'Tous'],
        ['attention', 'À regarder'],
        ['on', 'Prêts'],
        ['off', 'Coupés'],
      ];
      const status = (id: string) => {
        const s = states.get(id);
        return s
          ? `<span class="rs-status ${LEVEL_CLASS[s.level]}"><i></i>${esc(s.text)}</span>`
          : '<span></span>';
      };
      setHub(`<header class="rs-page-head rs-head-row"><div><h1>Modules</h1><p>L’état réel de chaque module. Un clic l’ouvre.</p></div>
        <div class="rs-seg" role="group" aria-label="Filtrer les modules">${FILTERS.map(([id, label]) => `<button type="button" data-filter="${id}" aria-pressed="${catalogFilter === id}">${label}</button>`).join('')}</div></header>
        <div class="rs-catalog">${
          groups
            .map(
              (g) =>
                `<section class="rs-panel"><h2>${esc(g.group)}</h2><div class="rs-rows">${g.pages.map((p) => `<a class="rs-row" href="${hrefOf(p)}" data-page="${p.id}">${icon(p.icon)}<b>${esc(p.label)}</b><small>${esc(p.desc)}</small>${favs.includes(p.id) ? '<em class="rs-fav-mark" title="Favori">★</em>' : ''}${status(p.id)}</a>`).join('')}</div></section>`,
            )
            .join('') || '<p class="rs-muted">Aucun module dans ce filtre.</p>'
        }</div>`);
    } else if (h === 'communaute') {
      setHub(`${head('Communauté', 'Viewers, progression, cosmétiques et défis.')}
        <div class="rs-tiles">${list(['progression', 'shop', 'challenges', 'moderation']).map(card).join('')}</div>`);
    } else if (h === 'activite') {
      const missing = [
        ...(sup ? [] : ['coupures']),
        ...(feed?.modules ? [] : ['journal des modules']),
        ...(feed?.audit ? [] : ['audit de modération']),
      ];
      const items = mergeFeed(
        sup?.history ?? [],
        feed?.modules ?? [],
        feed?.audit ?? [],
        (id) => pageById(id.replace(/_/g, '-'))?.label ?? id,
      );
      setHub(`${head('Activité', 'Ce qui s’est passé : coupures, actions des modules, décisions de modération.')}
        <section class="rs-panel">${
          feed === undefined
            ? '<p class="rs-muted">Lecture…</p>'
            : feedHtml(
                items,
                feedFilter,
                (id) => hrefOf(pageById(id) ?? pageById('activite')!),
                missing,
              )
        }</section>
        <section class="rs-panel"><h2>Historiques détaillés</h2><div class="rs-tiles">${list(['shop', 'challenges', 'alerts', 'channel-points', 'tombola', 'moderation']).map(card).join('')}</div></section>`);
    } else if (h === 'labo') {
      setHub(`${head('Laboratoire', 'Tester sans Twitch, sans OBS réel et sans Jetons réels.')}
        <div class="rs-tiles">${list(
          labMain
            ? ['simulation', 'extension-lab', 'socle-modules']
            : ['simulation', 'test-lab', 'extension-lab', 'socle-modules'],
        )
          .map(card)
          .join('')}
          <a class="rs-tile" href="/?p=extension-lab&amp;surface=video">${icon('puzzle')}<span><b>Extension · Vidéo</b><small>Surface vidéo de l’extension</small></span></a>
          <a class="rs-tile" href="/?p=extension-lab&amp;surface=mobile">${icon('puzzle')}<span><b>Extension · Mobile</b><small>Surface mobile de l’extension</small></span></a></div>`);
    }
  }

  // --- Navigation -----------------------------------------------------------------------------------------------
  function open(
    p: Page,
    { push = true, search = '' }: { push?: boolean; search?: string } = {},
  ) {
    current = p;
    if (push) history.pushState({ p: p.id }, '', search || hrefOf(p));
    if (p.hub) {
      deps.showView(null);
      hub.hidden = false;
      drawHub();
      hub.scrollTop = 0;
      // Live data now, not at the next tick.
      if (p.hub !== 'communaute' && p.hub !== 'labo') void pollSup();
    } else {
      hub.hidden = true;
      hub.innerHTML = '';
      delete hub.dataset.sig;
      deps.showView(p.view!, p.anchor ?? null);
    }
    // Extension Lab : la surface demandée (TTS, Bonk → panel ; vidéo, mobile) passe par ses propres boutons.
    const surface = new URL(
      search || hrefOf(p),
      location.href,
    ).searchParams.get('surface');
    if (p.view === 'extension-lab' && surface)
      document
        .querySelector<HTMLElement>(
          `#tab-extension-lab [data-surface="${CSS.escape(surface)}"]:not(.active)`,
        )
        ?.click();
    window.scrollTo(0, 0);
    recent = pushRecent(recent, p.id);
    store.set(RECENT_KEY, recent);
    store.set(LAST_KEY, p.id);
    if (p.view) store.set(LEGACY_TAB_KEY, p.view); // l'ancien Studio retrouve son dernier onglet
    app.classList.remove('rs-drawer-open');
    drawSide();
    drawHead();
  }
  /** Les liens internes (`?p=` ou ancien `?tab=`) changent de page sans recharger les lecteurs. */
  app.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
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
    const t = e.target as HTMLElement;
    const ack = t.closest<HTMLElement>('[data-sup-ack]')?.dataset.supAck;
    if (ack)
      void fetch('/api/supervision/ack', {
        method: 'POST',
        headers: { ...HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ id: ack }),
      }).then(() => pollSup());
    if (t.closest('.rs-star')) {
      favs = toggleFav(favs, current.id);
      store.set(FAV_KEY, favs);
      drawSide();
      drawHead();
      if (current.hub) drawHub();
    }
    const filter = t.closest<HTMLElement>('[data-filter]')?.dataset.filter;
    if (filter) {
      catalogFilter = filter as CatalogFilter;
      drawHub();
    }
    const feedTo = t.closest<HTMLElement>('[data-feed]')?.dataset.feed;
    if (feedTo) {
      feedFilter = feedTo as FeedFilter;
      drawHub();
    }
    if (t.closest('.rs-menu')) app.classList.toggle('rs-drawer-open');
    if (t.closest('.rs-scrim')) app.classList.remove('rs-drawer-open');
    if (t.closest('.rs-search-btn')) palette.open();
    if (t.closest('.rs-health'))
      open(
        pageById(
          sup?.incidents.some((i) => !i.endedAt) ? 'centre' : 'activite',
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
      items = q.trim() ? searchPages(q) : list(recent).slice(0, 6);
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
    hostModules = r.modules;
    addHostModulePages(r.modules);
    favs = store.get(FAV_KEY, DEFAULT_FAVS).filter((f) => pageById(f));
    drawSide();
    const late =
      pageFromSearch(initialSearch) ?? (asked ? undefined : pageById(lastId));
    if (late?.anchor && late !== current) open(late, { push: false });
    else if (current.hub === 'modules') drawHub();
  });
  const loop = async () => {
    await pollSup();
    setTimeout(() => void loop(), 5000);
  };
  void loop();
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
      <div class="rs-brand"><i aria-hidden="true"></i><b>Raptoru</b><span>Studio</span></div>
      <button type="button" class="rs-search-btn">${icon('search')}<span>Rechercher…</span><kbd>Ctrl K</kbd></button>
      <nav class="rs-sections" aria-label="Rubriques"></nav>
      <p class="rs-side-h">Favoris</p>
      <nav class="rs-favs" aria-label="Favoris"></nav>
      <div class="rs-side-foot">
        <nav class="rs-lab" aria-label="Laboratoire"></nav>
        <span class="topbar-safety rs-profile" data-profile="unknown">Profil en cours de lecture…</span>
        <div class="update-widget"></div>
      </div>
    </aside>
    <div class="rs-scrim" aria-hidden="true"></div>
    <div class="rs-main">
      <header class="topbar rs-top">
        <button type="button" class="rs-menu" aria-label="Menu">${icon('menu')}</button>
        <nav class="rs-crumbs" aria-label="Emplacement"></nav>
        <button type="button" class="rs-star" aria-pressed="false"></button>
        <span class="rs-grow"></span>
        <div class="sim-widget"></div>
        <button type="button" class="rs-health is-unknown"><i></i>Supervision…</button>
      </header>
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
