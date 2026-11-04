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
  type Page,
  type ViewId,
  PAGES,
  SECTIONS,
  LAB_SECTION,
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

const HEADERS = { 'x-raptoru-studio': '1' };
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
    strip.innerHTML = [
      ...active.map(
        (i) =>
          `<div class="rs-inc is-down" role="alert"><b>${esc(i.label)}</b><span>${esc(i.value)}${i.cause ? ` · ${esc(i.cause)}` : ''} · depuis ${t(i.startedAt)}</span><em>${i.action === 'manual' ? 'Action requise' : 'Récupération automatique'}</em>${i.hint ? `<small>${esc(i.hint)}</small>` : ''}</div>`,
      ),
      ...ended.map(
        (i) =>
          `<div class="rs-inc is-up" role="status"><b>${esc(i.label)} rétabli</b><span>de ${t(i.startedAt)} à ${t(i.endedAt!)}${i.cause ? ` · ${esc(i.cause)}` : ''}</span><button type="button" class="rs-btn quiet sm" data-sup-ack="${esc(i.id)}">Vu</button></div>`,
      ),
    ].join('');
    strip.hidden = !(active.length || ended.length);
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
    if (
      current.hub === 'centre' ||
      current.hub === 'activite' ||
      current.hub === 'regie'
    )
      drawHub();
  }
  // Régie : état des points de chaîne (lu à chaque relevé tant que la Régie est ouverte) et message de la dernière action.
  let regieCp: Awaited<ReturnType<typeof loadChannelPoints>> | undefined;
  let regieMsg = '';
  let regieLive: LiveState | undefined;
  let liveMsg = '';
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
  const list = (ids: string[]) =>
    ids.map((id) => pageById(id)).filter((p): p is Page => !!p);
  function drawHub() {
    const h = current.hub;
    if (!h) return;
    const head = (title: string, lead: string) =>
      `<header class="rs-page-head"><h1>${esc(title)}</h1><p>${lead}</p></header>`;
    if (h === 'centre') {
      const active = sup?.incidents.filter((i) => !i.endedAt) ?? [];
      hub.innerHTML = `${head('Centre de contrôle', 'L’état de Studio et des services, ce qui demande ton attention, et tes accès rapides.')}
        <div class="rs-cols">
          <section class="rs-panel"><h2>Santé</h2>
            <p class="rs-state ${!supOk ? 'is-unknown' : active.length ? 'is-down' : 'is-ok'}">${!supOk ? 'Supervision indisponible (serveur Studio injoignable ou supervision absente) : état inconnu.' : active.length ? `${active.length} incident(s) en cours — détails ci-dessus.` : 'Aucun incident confirmé en cours.'}</p>
            <p class="rs-muted">Profil, Core, bot, comptes Twitch, OBS et lecteurs : <a href="${hrefOf(pageById('systeme')!)}" data-page="systeme">Système</a>.</p>
            <h3>Dernières coupures</h3>${sup ? renderHistory(sup.history, 6) : '<p class="rs-muted">—</p>'}
            <p><a href="${hrefOf(pageById('activite')!)}" data-page="activite">Tout l’historique</a></p></section>
          <section class="rs-panel"><h2>Favoris</h2><div class="rs-tiles">${list(favs).map(card).join('') || '<p class="rs-muted">Aucun favori.</p>'}</div>
            <h2>Récents</h2><div class="rs-tiles">${
              list(recent.filter((r) => r !== 'centre'))
                .slice(0, 4)
                .map(card)
                .join('') || '<p class="rs-muted">—</p>'
            }</div></section>
        </div>
        <section class="rs-panel"><h2>Préparer le live</h2><div class="rs-tiles">${list(['regie', 'moderation', 'alerts', 'channel-points', 'tombola', 'simulation']).map(card).join('')}</div></section>`;
    } else if (h === 'regie') {
      hub.innerHTML = `${head('Régie live', 'Pendant le stream : l’état réel, les coupures nommées et l’accès direct aux contrôles de chaque module (mêmes écrans, aucune copie).')}
        ${regieHtml({ sup, supOk, cp: regieCp, message: regieMsg, live: regieLive, liveMessage: liveMsg, profile: document.querySelector<HTMLElement>('.rs-profile')?.dataset.profile ?? 'unknown', href: (id) => hrefOf(pageById(id)!) })}`;
    } else if (h === 'modules') {
      hub.innerHTML = `${head('Modules', 'Toutes les fonctionnalités, regroupées. Un clic ouvre le module ; Ctrl+K pour aller plus vite.')}
        <div class="rs-catalog">${moduleGroups()
          .map(
            (g) =>
              `<section class="rs-panel"><h2>${esc(g.group)}</h2><div class="rs-rows">${g.pages.map((p) => `<a class="rs-row" href="${hrefOf(p)}" data-page="${p.id}">${icon(p.icon)}<b>${esc(p.label)}</b><small>${esc(p.desc)}</small>${favs.includes(p.id) ? '<em class="rs-fav-mark" title="Favori">★</em>' : ''}</a>`).join('')}</div></section>`,
          )
          .join('')}</div>`;
    } else if (h === 'communaute') {
      hub.innerHTML = `${head('Communauté', 'Viewers, progression, cosmétiques et défis. Le Core décide des Jetons, des possessions et des récompenses.')}
        <div class="rs-tiles">${list(['progression', 'shop', 'challenges', 'moderation']).map(card).join('')}</div>
        <p class="rs-muted">Jetons et Daily : gérés par le Core (opérations dans les modules concernés) ; aucune console de solde n’est ajoutée par la refonte.</p>`;
    } else if (h === 'activite') {
      hub.innerHTML = `${head('Activité', 'Incidents et historiques. Le détail de chaque historique reste dans son module.')}
        <div class="rs-cols"><section class="rs-panel"><h2>Coupures et incidents</h2>${sup ? renderHistory(sup.history, 40) : `<p class="rs-muted">${supOk ? 'Chargement…' : 'Supervision indisponible.'}</p>`}</section>
        <section class="rs-panel"><h2>Historiques des modules</h2><div class="rs-tiles">${list(['shop', 'challenges', 'alerts', 'channel-points', 'tombola', 'moderation']).map(card).join('')}</div></section></div>`;
    } else if (h === 'labo') {
      hub.innerHTML = `${head('Laboratoire', 'Outils de test isolés. Ouvrir le Laboratoire ne change pas le profil Studio.')}
        <div class="rs-tiles">${list(['simulation', 'test-lab', 'extension-lab']).map(card).join('')}
          <a class="rs-tile" href="/?p=extension-lab&amp;surface=video">${icon('puzzle')}<span><b>Extension · Vidéo</b><small>Surface vidéo de l’extension</small></span></a>
          <a class="rs-tile" href="/?p=extension-lab&amp;surface=mobile">${icon('puzzle')}<span><b>Extension · Mobile</b><small>Surface mobile de l’extension</small></span></a></div>`;
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
      if (p.hub === 'regie') void pollSup(); // l'état des points de chaîne tout de suite, pas au prochain relevé
    } else {
      hub.hidden = true;
      hub.innerHTML = '';
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
  const asked = pageFromSearch(location.search);
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
    asked ? location.search || hrefOf(current) : hrefOf(current),
  );
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
      <div class="rs-pal-in">${icon('search')}<input type="search" placeholder="Rechercher ou ouvrir… (Tombola, Spotify, défis…)" aria-controls="rs-pal-list" role="combobox" aria-expanded="true" autocomplete="off"></div>
      <div class="rs-pal-list" id="rs-pal-list" role="listbox"></div>
    </dialog>
  </div>`;
}
