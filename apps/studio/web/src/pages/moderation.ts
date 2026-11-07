import {
  esc,
  ic,
  page,
  patch,
  poller,
  pop,
  pp,
  seg,
  stateChip,
} from '../ds/ds.js';
import { tryGetJson } from '../http.js';
import {
  globalPause,
  learn,
  modErr,
  modGet,
  onModChange,
  onModJump,
  openViewer,
  patchSheet,
  refreshOpenItem,
  resetTrail,
  ROLE,
  searchViewers,
  setModHost,
  setModMe,
  type ModJump,
  type SearchHit,
  type Sheet,
} from '../mod/mod.js';
import type { CatalogModule } from '../module-host.js';
import { setNavCount } from '../shell/shell.js';
import { mountDesk } from './moderation-desk.js';
import { mountJournal } from './moderation-journal.js';
import { mountLabWallet, mountOthers } from './moderation-others.js';
import { mountRestrictions } from './moderation-restrictions.js';
import { mountTeam, mountWords } from './moderation-team.js';
import type { Ctx, Overview, View } from './moderation-ui.js';

// La Modération : une table de régie pour le streamer, à la souris et au clavier. Mêmes lectures et mêmes commandes du Core que la
// console de l'extension, avec Studio pour acteur ; le Core vérifie les droits, décide, enregistre et audite. Inventaire des
// fonctions : docs/studio-refonte/INVENTAIRE_MODERATION.md.

type Tab =
  'desk' | 'journal' | 'restrictions' | 'team' | 'words' | 'others' | 'wallet';
const TABS: { id: Tab; label: string }[] = [
  { id: 'desk', label: 'Files' },
  { id: 'journal', label: 'Historique' },
  { id: 'restrictions', label: 'Restrictions' },
  { id: 'team', label: 'Équipe' },
  { id: 'words', label: 'Mots surveillés' },
  { id: 'others', label: 'Autres modules' },
  { id: 'wallet', label: 'Wallet de test' },
];
const KEYS = [
  ['/', 'Chercher un viewer'],
  ['1 à 7', 'Changer de vue'],
  ['↑ ↓ ou J K', 'Parcourir une file'],
  ['← →', 'Changer de file'],
  ['L', 'Laisser passer'],
  ['R', 'Retirer ou refuser…'],
  ['B', 'Bloquer…'],
  ['V', 'Fiche du viewer'],
  ['Échap', 'Fermer le détail'],
] as const;

export function mountModeration(root: HTMLElement) {
  const p = page(root, { title: 'Modération', mod: 'sanction' });
  p.actions.innerHTML = `<div class="md-find"><label class="d-fld">${ic('search')}<input type="search" data-find placeholder="Chercher un viewer" aria-label="Chercher un viewer" autocomplete="off"><kbd>/</kbd></label><div class="md-drop" data-drop hidden></div></div><span data-z="gp"></span>`;
  p.body.innerHTML = `<div class="md">
    <div class="md-pause" data-z="pause" hidden></div>
    <nav class="md-tabs" data-z="tabs" aria-label="Vues de la modération"></nav>
    <div class="md-work" data-z="work"><div class="md-views" data-z="views"></div><aside class="md-insp" data-z="insp" aria-label="Détail" inert></aside></div>
  </div>`;
  const z = (k: string) => root.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  const input = root.querySelector<HTMLInputElement>('[data-find]')!;
  const drop = root.querySelector<HTMLElement>('[data-drop]')!;

  const ctx: Ctx = {
    o: null,
    err: '',
    lab: true,
    hosts: null,
    go: (j) => to(j),
  };
  let restrCount: number | null = null;
  const views: Record<Tab, View> = {
    desk: mountDesk(ctx),
    journal: mountJournal(),
    restrictions: mountRestrictions((n) => {
      restrCount = n;
      paintTabs();
    }),
    team: mountTeam(),
    words: mountWords(),
    others: mountOthers(ctx),
    wallet: mountLabWallet(),
  };
  let tab: Tab = 'desk';
  for (const [id, v] of Object.entries(views)) {
    v.el.dataset.view = id;
    v.el.hidden = id !== tab;
    z('views').append(v.el);
  }
  const tabs = () => TABS.filter((t) => t.id !== 'wallet' || ctx.lab);

  function paintTabs() {
    const rev = reviews();
    patch(
      z('tabs'),
      `${seg(
        'data-tab',
        tabs().map((t) => {
          const n =
            t.id === 'desk' ? rev : t.id === 'restrictions' ? restrCount : 0;
          return [
            t.id,
            `${t.label}${n ? `<em class="${t.id === 'desk' ? 'warn' : ''}">${n}</em>` : ''}`,
          ] as const;
        }),
        tab,
        'md-seg',
      )}<span class="d-sp"></span><button type="button" class="d-ib" data-keys aria-label="Raccourcis clavier" title="Raccourcis clavier">?</button>`,
    );
  }
  const reviews = () =>
    [
      ...(ctx.o?.tts.waiting ?? []),
      ...(ctx.o?.tts.current ? [ctx.o.tts.current] : []),
    ].filter((i) => i.review_status === 'pending').length;

  function paintHead() {
    const o = ctx.o;
    const rev = reviews();
    patch(
      p.state,
      !o
        ? ctx.err
          ? stateChip('r', ctx.err)
          : stateChip('off', 'Lecture…')
        : o.global.paused
          ? stateChip('w', 'Pause globale')
          : ctx.err
            ? stateChip('r', `Lecture interrompue · ${ctx.err}`)
            : rev
              ? stateChip('w', `${rev} à vérifier`)
              : stateChip(
                  '',
                  ctx.lab
                    ? 'Interactions ouvertes'
                    : 'Production · tout est réel',
                ),
    );
    patch(
      z('gp'),
      o?.global.paused
        ? ''
        : `<button type="button" class="d-btn ghost" data-pause ${o ? '' : 'disabled'}>${ic('pause')}Pause globale</button>`,
    );
    const paused = !!o?.global.paused;
    z('pause').hidden = !paused;
    patch(
      z('pause'),
      paused
        ? `${ic('pause')}<span>Pause globale : nouvelles interactions refusées${o?.global.refused ? ` (${o.global.refused})` : ''}. Ce qui joue continue.</span><button type="button" class="d-btn sm" data-resume>Lever</button>`
        : '',
    );
  }

  // --- Relevés ------------------------------------------------------------------------------------------------------------
  let reads = 0;
  async function read() {
    try {
      const o = await modGet<Overview>('overview');
      ctx.o = o;
      ctx.err = '';
      setModMe(o.me ?? null);
      for (const i of [
        ...o.tts.waiting,
        ...o.tts.recent,
        ...o.soundboard.waiting,
        ...o.soundboard.playing,
      ])
        learn(i.viewer_id, i.viewer_display_name);
    } catch (e) {
      ctx.err = modErr(e);
    }
    // Le catalogue et le décompte des restrictions bougent peu : un relevé sur cinq.
    if (reads++ % 5 === 0) {
      const a = await tryGetJson<{ modules: CatalogModule[] }>('/api/modules');
      ctx.hosts = a?.modules ?? null;
      if (tab !== 'restrictions') void views.restrictions.read?.();
    }
    const rev = reviews();
    setNavCount('moderation', rev ? String(rev) : null);
    paintHead();
    paintTabs();
    views[tab].paint();
    await views[tab].read?.();
    refreshOpenItem();
  }
  const tick = poller(read, 2000);
  const clock = poller(() => views[tab].tick?.(), 1000);
  onModChange(() => {
    reads = 0;
    tick.now();
  });

  // --- Vues ---------------------------------------------------------------------------------------------------------------
  function show(id: Tab) {
    if (id === tab) return;
    views[tab].el.hidden = true;
    tab = id;
    views[id].el.hidden = false;
    paintTabs();
    views[id].paint();
    void views[id].read?.();
  }
  function to(j: ModJump) {
    views[j.tab].enter?.(j);
    if (j.tab === tab) {
      views[tab].paint();
      void views[tab].read?.();
    } else show(j.tab);
  }
  onModJump(to);

  // --- Détail à droite ----------------------------------------------------------------------------------------------------
  let closers: (() => void)[] = [];
  const closeInsp = () => {
    const fns = closers;
    closers = [];
    z('work').classList.remove('has-insp');
    z('insp').inert = true;
    for (const f of fns) f();
    views.desk.closed?.();
  };
  const host = (o: {
    kicker?: string;
    title: string;
    body: string;
    foot?: string;
  }): Sheet => {
    const prev = closers;
    const mine: (() => void)[] = [];
    closers = mine;
    // Après `visit` : le fil de retour voit déjà le nouveau détail.
    queueMicrotask(() => {
      for (const f of prev) f();
    });
    const el = document.createElement('section');
    el.className = 'md-sheet';
    el.innerHTML = `<header class="d-drawer__h"><div><small data-k></small><h2 data-t></h2></div><button type="button" class="d-ib" data-close aria-label="Fermer le détail">${ic('x')}</button></header><div class="d-drawer__b" data-b></div><footer class="d-drawer__f" data-f hidden></footer>`;
    z('insp').replaceChildren(el);
    z('insp').inert = false;
    z('work').classList.add('has-insp');
    const s: Sheet = {
      el,
      set: (x) => patchSheet(el, x),
      close: closeInsp,
      isOpen: () => el.isConnected && closers === mine,
      onClose: (f) => mine.push(f),
    };
    s.set(o);
    el.querySelector<HTMLElement>('[data-close]')!.onclick = closeInsp;
    return s;
  };

  // --- Recherche de viewer -----------------------------------------------------------------------------------------------
  let found: SearchHit[] = [];
  let at = 0;
  let timer: ReturnType<typeof setTimeout>;
  let searchSeq = 0;
  const closeDrop = () => {
    drop.hidden = true;
  };
  const paintDrop = () => {
    drop.innerHTML = `<small class="d-lb">${input.value.trim() ? 'Résultats' : 'Actifs récemment'}</small>${
      found
        .slice(0, 8)
        .map(
          (v, k) =>
            `<button type="button" class="md-hit ${k === at ? 'on' : ''}" data-hit="${esc(v.viewer_id)}">${pp(v.display_name, 22)}<b>${esc(v.display_name)}</b>${v.restriction ? `<span class="d-tag ${v.restriction === 'block' ? 'bad' : 'warn'}">${ic(v.restriction === 'block' ? 'ban' : 'clock')}</span>` : ''}${v.role && v.role !== 'viewer' ? `<small>${esc(ROLE[v.role] ?? v.role)}</small>` : ''}</button>`,
        )
        .join('') ||
      `<p class="d-note">Personne pour « ${esc(input.value)} ».</p>`
    }`;
    drop.hidden = false;
  };
  const search = async () => {
    const mine = ++searchSeq;
    const list = await searchViewers(input.value).catch(() => []);
    if (mine !== searchSeq || document.activeElement !== input) return;
    found = list;
    at = 0;
    paintDrop();
  };
  input.addEventListener('focus', () => void search());
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void search(), 180);
  });
  input.addEventListener('blur', () => setTimeout(closeDrop, 160));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(1, Math.min(8, found.length));
      at = (at + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      paintDrop();
    }
    if (e.key === 'Enter' && found[at]) {
      openHit(found[at]!.viewer_id);
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      input.value = '';
      closeDrop();
      input.blur();
    }
  });
  const openHit = (id: string) => {
    resetTrail();
    input.value = '';
    closeDrop();
    input.blur();
    openViewer(id);
  };

  // --- Clavier et clics de la page ----------------------------------------------------------------------------------------
  function help(b: HTMLElement) {
    pop(
      b,
      `<h3>Raccourcis</h3><dl class="md-keys">${KEYS.map(([k, l]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(l)}</dd>`).join('')}</dl>`,
      undefined,
      { cls: 'd-form' },
    );
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input:not([type="checkbox"]), textarea, select')) return;
    if (document.querySelector('dialog[open], .d-pop:popover-open')) return;
    if (e.key === '/') {
      e.preventDefault();
      return input.focus();
    }
    if (e.key === '?')
      return help(root.querySelector<HTMLElement>('[data-keys]')!);
    if (e.key === 'Escape' && z('work').classList.contains('has-insp'))
      return closeInsp();
    const n = Number(e.key);
    const list = tabs();
    if (n >= 1 && n <= list.length) return show(list[n - 1]!.id);
    if (views[tab].key?.(e)) e.preventDefault();
  };
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.tab) return show(b.dataset.tab as Tab);
    if (b.matches('[data-keys]')) return help(b);
    if (b.dataset.hit) return openHit(b.dataset.hit);
    if (b.matches('[data-pause]')) return void globalPause(b, true);
    if (b.matches('[data-resume]')) return void globalPause(b, false);
  });

  void tryGetJson<{ effective?: string }>('/api/profile').then((pr) => {
    ctx.lab = pr?.effective !== 'production';
    if (!ctx.lab && tab === 'wallet') show('desk');
    paintTabs();
    paintHead();
  });
  paintTabs();
  paintHead();

  return {
    setVisible(v: boolean) {
      if (v) {
        setModHost(host);
        addEventListener('keydown', onKey);
        tick.start();
        clock.start();
        views[tab].paint();
      } else {
        setModHost(null);
        removeEventListener('keydown', onKey);
        tick.stop();
        clock.stop();
        closeInsp();
      }
    },
  };
}
