import type { CmdAction, CmdConfig, CmdTeamRights } from '@raptoru/schemas';
import { COLORS, ic, ICONS } from './commands-icons.js';
import {
  blank,
  type Category,
  categoryOf,
  changes,
  CHECK,
  type CommandItem,
  cooldownShort,
  cooldownText,
  COOLDOWN_PRESETS,
  counts,
  dur,
  example,
  FIELD,
  groups,
  GROUPS,
  insertAt,
  type ListResponse,
  type ListUi,
  MODES,
  NO_CATEGORY,
  previewText,
  quotaShort,
  quotaText,
  reapply,
  REASON,
  RIGHTS,
  same,
  SAVE_ERROR,
  stateOf,
  STEP,
  syntax,
  TO,
  unitOf,
  VARIABLES,
  variableMissing,
  visible,
  whoSentence,
  whoShort,
  WINDOWS,
  word,
} from './commands-model.js';

// « Commandes » tab — Commands V2 in Studio (phase D), port of the validated prototype V6.3
// (prototypes/commands-v6/). Everything goes through Core's Commands V2 routes, relayed by Studio
// (/api/commands/*): Core validates every change (expected_version), decides « Tester », owns the
// categories, the rights, the history, the invocations and the steps. This page only shows and sends
// intentions. Runtime state (« Sortie chat réelle », executor, chat ingestion): /api/lab-chat/output.

type Json = Record<string, unknown>;
type View = 'lib' | 'cmd' | 'new' | 'history' | 'rights' | 'categories';
interface ApiError extends Error {
  status?: number;
  body?: Json;
}
interface Runtime {
  enabled: boolean;
  executor_absent?: boolean;
  ingress_running?: boolean;
  write_scope?: boolean;
}
interface HistoryEntry {
  id: number;
  command_id: string | null;
  version: number | null;
  action: string;
  actor_id: string;
  actor_login: string | null;
  actor_role: string;
  via: string;
  changes: { field: string; before: unknown; after: unknown }[];
  created_at: string;
}
interface Invocation {
  invocation_id: string;
  command_id: string;
  trigger: string;
  viewer_login: string;
  viewer_display_name: string;
  source: string;
  decision: 'accepted' | 'rejected';
  reason: string | null;
  reason_detail: Json | null;
  status: string;
  created_at: string;
  steps: {
    seq: number;
    kind: string;
    status: string;
    error: string | null;
    twitch_message_id: string | null;
  }[];
}
interface StepRow {
  step_id: string;
  /** Null for a Jeu des mots message (origin word_game: no Commands invocation). */
  invocation_id: string | null;
  origin?: 'commands' | 'word_game';
  kind: string;
  params: { mode?: string; text?: string };
  status: string;
  attempt_count: number;
  error: { code?: string; message?: string } | null;
  twitch_message_id: string | null;
  created_at: string;
  finished_at: string | null;
}
interface Decision {
  decision: 'accepted' | 'rejected';
  reason: string | null;
  message: string;
  detail: Json;
  checks: { check: string; ok: boolean }[];
  raw_args: string;
  args: Record<string, string | number>;
  rendered: {
    reply: { mode: string; text: string; reply_to: string | null } | null;
    actions: {
      type: string;
      mode?: string;
      text?: string;
      module?: string;
      operation?: string;
    }[];
    reply_first: boolean;
  } | null;
  viewer: { groups: string[]; role: string; follower: boolean | null };
  live: boolean;
  follower_source: string | null;
}
type RoleRights = { rights: CmdTeamRights; version: number };

const FAV_KEY = 'raptoru-commands-fav';
const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const clone = <T>(x: T): T => structuredClone(x);
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
const day = (iso: string) => {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'Aujourd’hui';
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString())
    return 'Hier';
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
};
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  if (m < 1440) return `il y a ${Math.round(m / 60)} h`;
  return `il y a ${Math.round(m / 1440)} j`;
};
const who = (by: string) =>
  by.startsWith('studio:')
    ? 'Studio'
    : by.startsWith('system:')
      ? `module ${by.slice(7)}`
      : by.replace(/^extension:/, 'Extension · ');
const fmt = (n: number) => n.toLocaleString('fr-FR');

async function api<T = Json>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-raptoru-studio': '1', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok)
    throw Object.assign(new Error(String(json.error ?? `http_${res.status}`)), {
      status: res.status,
      body: json,
    }) as ApiError;
  return json as T;
}

/** Full form of a new command (Core fills nothing more, and validates it all). */
const fresh = (category: string | null): CmdConfig =>
  ({
    ...blank(category),
    appearance: { icon: 'chat', color: '#8b5cf6' },
    args: [],
    actions: [],
    reply_first: false,
    when: 'always',
    refuse: { mode: 'silent', text: '' },
    team_lock: false,
  }) as CmdConfig;

/** Fictitious viewers for « Tester » (any login / role / badges can be typed). */
const TEST_VIEWERS: {
  label: string;
  id: string;
  login: string;
  display_name: string;
  role: 'viewer' | 'moderator' | 'broadcaster';
  badges: string[];
}[] = [
  {
    label: 'Viewer',
    id: '900101',
    login: 'pixelmamie',
    display_name: 'PixelMamie',
    role: 'viewer',
    badges: [],
  },
  {
    label: 'Abonné',
    id: '900102',
    login: 'kevdu59',
    display_name: 'Kevdu59',
    role: 'viewer',
    badges: ['subscriber'],
  },
  {
    label: 'VIP',
    id: '900103',
    login: 'luna_bzh',
    display_name: 'luna_bzh',
    role: 'viewer',
    badges: ['vip'],
  },
  {
    label: 'Modérateur',
    id: '900104',
    login: 'aouh',
    display_name: 'Aouh',
    role: 'moderator',
    badges: ['moderator'],
  },
  {
    label: 'Streamer',
    id: '900100',
    login: 'raptoru_',
    display_name: 'Raptoru_',
    role: 'broadcaster',
    badges: ['broadcaster'],
  },
];
const BADGES = ['subscriber', 'founder', 'vip', 'moderator', 'broadcaster'];

export function mountCommands(root: HTMLElement) {
  root.classList.add('cmd2');
  const ui = {
    view: 'lib' as View,
    side: 'all' as ListUi['side'],
    cat: 'all',
    group: true,
    q: '',
    sort: { key: 'name' as 'name' | 'who' | 'limit' | 'uses', dir: 1 },
    list: null as ListResponse | null,
    loadError: '',
    id: null as string | null,
    base: null as CommandItem | null,
    draft: null as CmdConfig | null,
    tab: 'settings' as 'settings' | 'history',
    pop: null as string | null,
    cdCustom: false,
    adv: false,
    look: false,
    panel: null as null | 'test' | 'help',
    conflict: null as null | {
      by: string;
      version: number;
      both: string[];
      theirs: string[];
    },
    saving: false,
    savedAt: '',
    error: '',
    aliasErr: '',
    test: {
      preset: 0,
      ...clone(TEST_VIEWERS[0]!),
      follower: 'unknown' as 'unknown' | 'true' | 'false',
      message: '',
      res: null as Decision | null,
      busy: false,
      error: '',
    },
    hist: 'runs' as 'runs' | 'changes' | 'steps',
    histData: null as null | {
      invocations?: Invocation[];
      entries?: HistoryEntry[];
      steps?: StepRow[];
    },
    cmdHist: null as null | {
      invocations: Invocation[];
      entries: HistoryEntry[];
    },
    rights: null as null | { moderator: RoleRights; supermod: RoleRights },
    rightsDraft: null as null | {
      moderator: CmdTeamRights;
      supermod: CmdTeamRights;
    },
    rightsMsg: '',
    runtime: null as Runtime | null,
    nw: null as CmdConfig | null,
    catEdit: null as string | null,
    order: [] as string[],
  };
  let visibleTab = false;
  let fav = new Set<string>();
  try {
    fav = new Set(
      JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[],
    );
  } catch {
    /* no storage: favourites not remembered */
  }
  const saveFav = () => {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...fav]));
    } catch {
      /* ignore */
    }
  };
  const cats = (): Category[] => ui.list?.categories ?? [];
  const cur = () =>
    ui.list?.commands.find((c) => c.command_id === ui.id) ?? null;
  const D = (): CmdConfig | null =>
    ui.view === 'new' ? ui.nw : ui.view === 'cmd' ? ui.draft : null;
  const dirty = () =>
    !!ui.base &&
    !!ui.draft &&
    Object.keys(changes(ui.base.config, ui.draft)).length > 0;
  const locked = (f: string) => !!ui.base?.locked_fields.includes(f);
  const lockNote = () =>
    `Verrouillé par le module ${ui.base?.owner_module ?? ''}`;

  // ------------------------------------------------------------------ data
  async function loadList() {
    try {
      ui.list = await api<ListResponse>('/api/commands');
      ui.loadError = '';
      // A command open in the page: keep its server version current (never its draft).
      if (ui.view === 'cmd' && ui.base) {
        const now = cur();
        if (now && !dirty()) {
          ui.base = now;
          ui.draft = clone(now.config);
        } else if (now)
          ui.base = {
            ...now,
            config: ui.base.config,
            version: ui.base.version,
          };
      }
    } catch (e) {
      ui.loadError =
        (e as ApiError).status === 503
          ? 'Core Lab non démarré : lance le Labo depuis l’onglet Studio.'
          : `Liste indisponible (${(e as Error).message}).`;
    }
  }
  async function loadRuntime() {
    try {
      ui.runtime = await api<Runtime>('/api/lab-chat/output');
    } catch {
      ui.runtime = null;
    }
  }
  async function refresh() {
    await Promise.all([loadList(), loadRuntime()]);
    rerender();
  }

  // ------------------------------------------------------------------ list (V6.3)
  const sortRows = <T extends { c: CommandItem }>(rows: T[]) => {
    const by = {
      name: (a: T, b: T) => a.c.config.name.localeCompare(b.c.config.name),
      who: (a: T, b: T) =>
        whoShort(a.c.config.audience).localeCompare(
          whoShort(b.c.config.audience),
        ),
      limit: (a: T, b: T) =>
        (a.c.config.cooldown.enabled ? a.c.config.cooldown.seconds : 0) -
        (b.c.config.cooldown.enabled ? b.c.config.cooldown.seconds : 0),
      uses: (a: T, b: T) => (b.c.uses_30d ?? 0) - (a.c.uses_30d ?? 0),
    }[ui.sort.key];
    return rows.sort(
      (a, b) =>
        by(a, b) * ui.sort.dir ||
        a.c.config.name.localeCompare(b.c.config.name),
    );
  };
  const listUi = (): ListUi => ({
    side: ui.side,
    cat: ui.cat,
    group: ui.group,
    q: ui.q,
  });
  const rows = () =>
    sortRows(visible(ui.list?.commands ?? [], cats(), listUi(), fav));
  const shownOrder = () =>
    groups(rows(), cats(), listUi()).flatMap(([, l]) =>
      l.map((x) => x.c.command_id),
    );

  const catTag = (c: CommandItem) => {
    const k = categoryOf(c, cats());
    return `<span class="lcat" style="--c:${k.color}" data-tip="Catégorie : ${esc(k.name)}"><i></i>${esc(k.name)}</span>`;
  };
  const stateCell = (c: CommandItem) => {
    const st = stateOf(c);
    const icon = (name: string, tip: string, cls = '') =>
      `<span class="lst-ic ${cls}" data-tip="${esc(tip)}" title="${esc(tip)}">${ic(name)}</span>`;
    const issue =
      st.key === 'ok' || st.key === 'off'
        ? ''
        : `<span class="st st--${st.tone}" data-tip="${esc(st.why)}" title="${esc(st.why)}"><i></i>${esc(st.label)}</span>`;
    const sys =
      c.kind === 'system'
        ? icon(
            'cube',
            `Commande système · fournie par le module ${c.owner_module ?? ''}`,
          )
        : '';
    const lock = c.config.team_lock
      ? icon(
          'lock',
          'Verrouillée par le streamer : l’équipe peut la consulter, pas la modifier',
        )
      : '';
    const hid = c.config.listed
      ? ''
      : icon('eyeoff', 'Cachée de la liste publique');
    const tip = c.config.enabled
      ? 'Active — cliquer pour désactiver'
      : 'Désactivée — cliquer pour activer';
    return `<span class="lst-state">${issue}${sys}${lock}${hid}<button type="button" class="sw ${c.config.enabled ? 'on' : ''}" data-toggle="${c.command_id}" role="switch" aria-checked="${c.config.enabled}" aria-label="Activer !${esc(c.config.name)}" title="${tip}"></button></span>`;
  };
  function row(
    { c, via }: { c: CommandItem; via: string | null },
    showCat: boolean,
  ) {
    const cfg = c.config;
    const q = cfg.quota;
    return `<div class="lr ${cfg.enabled ? '' : 'off'}" data-open="${c.command_id}" tabindex="0" role="row">
      <span class="lname"><span class="tile" style="--c:${cfg.appearance.color}">${ic(cfg.appearance.icon)}</span><span class="lname__t"><span class="lname__a"><span class="cn">${esc(cfg.name)}</span>${via ? `<span class="via">via !${esc(via)}</span>` : ''}${showCat ? catTag(c) : ''}</span><span class="desc">${esc(cfg.description || 'Sans description')}</span></span></span>
      <span class="lcol" title="${esc(whoShort(cfg.audience))}"><span>${esc(whoShort(cfg.audience))}</span></span>
      <span class="lcol" title="${esc(`${cooldownText(cfg.cooldown)} · ${quotaText(q)}`)}"><span class="${cfg.cooldown.enabled ? '' : 'faint'}">${esc(cooldownShort(cfg.cooldown))}</span>${q.enabled ? `<small>max ${esc(quotaShort(q))}</small>` : ''}</span>
      <span class="lcol num r ${c.uses_30d ? '' : 'faint'}">${c.uses_30d ? fmt(c.uses_30d) : '—'}</span>
      ${stateCell(c)}
      <span class="tfav"><button type="button" class="ib ib--sm star ${fav.has(c.command_id) ? 'on' : ''}" data-fav="${c.command_id}" aria-label="Favori" title="${fav.has(c.command_id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${ic('star')}</button></span></div>`;
  }
  const sortBtn = (k: typeof ui.sort.key, l: string, cls = '') =>
    `<button type="button" class="${cls} ${ui.sort.key === k ? 'on' : ''}" data-sort="${k}">${l}${ui.sort.key === k ? ic(ui.sort.dir > 0 ? 'down' : 'up') : ''}</button>`;
  const NAMES: Record<string, string> = {
    all: 'Toutes les commandes',
    fav: 'Favoris',
    check: 'À vérifier',
    off: 'Désactivées',
    hidden: 'Cachées du public',
  };
  function catFilter() {
    const all = ui.list?.commands ?? [];
    const n = (id: string | null) =>
      all.filter(
        (c) =>
          (categoryOf(c, cats()) === NO_CATEGORY ? null : c.config.category) ===
          id,
      ).length;
    const none = n(null);
    const k =
      ui.cat === 'all'
        ? null
        : ui.cat === 'none'
          ? NO_CATEGORY
          : (cats().find((x) => x.category_id === ui.cat) ?? NO_CATEGORY);
    return `<span class="lcatf"><label class="lsel ${k ? 'lsel--on' : ''}" style="--c:${k ? k.color : 'transparent'}"><i></i><select class="inp" data-cat aria-label="Catégorie">
        <option value="all" ${ui.cat === 'all' ? 'selected' : ''}>Toutes les catégories</option>
        ${cats()
          .map(
            (f) =>
              `<option value="${f.category_id}" ${ui.cat === f.category_id ? 'selected' : ''}>${esc(f.name)} (${n(f.category_id)})</option>`,
          )
          .join('')}
        ${none ? `<option value="none" ${ui.cat === 'none' ? 'selected' : ''}>Sans catégorie (${none})</option>` : ''}</select></label>
      <button type="button" class="lgrp ${ui.group ? 'on' : ''}" data-group aria-pressed="${ui.group}" title="${ui.group ? 'Ne plus grouper' : 'Grouper par catégorie'}">${ic('folder')}<span>Grouper</span></button>
      <button type="button" class="lnk lnk--sm" data-goview="categories">${ic('pencil')}Gérer les catégories</button></span>`;
  }
  function libHtml() {
    if (!ui.list)
      return `<div class="mhead"><h1>Commandes</h1></div><div class="empty">${esc(ui.loadError || 'Chargement…')}</div>`;
    const list = rows();
    const gs = groups(list, cats(), listUi());
    const showCat = ui.cat === 'all' && !ui.group;
    const k =
      ui.cat === 'all'
        ? ''
        : ` · ${ui.cat === 'none' ? 'Sans catégorie' : (cats().find((x) => x.category_id === ui.cat)?.name ?? '')}`;
    const res = ui.list.reserved_words;
    const body = gs
      .map(([f, l]) =>
        f
          ? `<section class="lgroup"><div class="lgh" style="--c:${f.color}"><span class="lgh__i">${ic(f.icon)}</span><span class="lgh__t">${esc(f.name)}</span><em>${l.length}</em></div>${l.map((x) => row(x, showCat)).join('')}</section>`
          : l.map((x) => row(x, showCat)).join(''),
      )
      .join('');
    const empty = ui.list.commands.length
      ? `<div class="empty">Aucune commande${ui.q ? ` pour « ${esc(ui.q)} »` : ''}.</div>`
      : `<div class="empty">Aucune commande pour l’instant.<br><button type="button" class="btn btn--primary" style="margin-top:12px" data-new>${ic('plus')}Nouvelle commande</button></div>`;
    return `<div class="mhead"><h1>${esc(NAMES[ui.side])}${esc(k)}<small>${list.length}</small></h1><span class="grow"></span>
        <label class="msearch">${ic('search')}<input class="inp" data-q placeholder="Chercher un nom ou un alias" value="${esc(ui.q)}" spellcheck="false"></label>
        <button type="button" class="ib" data-panel="help" title="Aide">${ic('help')}</button>
        <button type="button" class="btn btn--primary" data-new>${ic('plus')}Nouvelle commande</button></div>
      <div class="lfilters lfilters--studio">${catFilter()}</div>
      <div class="lst lst--studio"><div class="lhead">${sortBtn('name', 'Commande')}${sortBtn('who', 'Accès')}${sortBtn('limit', 'Cooldown')}${sortBtn('uses', 'Utilisée (30 j)', 'r')}<span class="r">État</span><span></span></div>
        <div class="lbody scroll">${body || empty}${res.length ? `<p class="reserved">${ic('lock')}Mots réservés par les modules (jamais utilisables ici) : ${res.map((w) => `<b>!${esc(w.word)}</b> <span class="faint">(${esc(w.module === 'raffle' ? 'Tombola' : w.module)})</span>`).join(', ')}</p>` : ''}</div></div>`;
  }

  // ------------------------------------------------------------------ shell (sidebar: state filters, settings, runtime)
  function shell(main: string) {
    const all = ui.list?.commands ?? [];
    const n = counts(all, cats(), listUi(), fav);
    const nav = (
      k: ListUi['side'],
      i: string,
      l: string,
      cnt: number,
      attn = false,
    ) =>
      `<button type="button" class="nav ${ui.view === 'lib' && ui.side === k ? 'on' : ''} ${attn ? 'nav--attn' : ''}" data-side="${k}">${ic(i)}<span>${l}</span><b>${cnt}</b></button>`;
    const go = (v: View, i: string, l: string) =>
      `<button type="button" class="nav ${ui.view === v ? 'on' : ''}" data-goview="${v}">${ic(i)}<span>${l}</span></button>`;
    const r = ui.runtime;
    const rt = r
      ? `<div class="ctxbox rtbox"><span>Exécution</span>
        <p class="rt"><i class="dot ${r.enabled ? 'dot--ok' : ''}"></i>Sortie chat réelle : <b>${r.enabled ? 'ON' : 'OFF'}</b></p>
        <p class="rt"><i class="dot ${r.ingress_running ? 'dot--ok' : ''}"></i>Ingestion chat : <b>${r.ingress_running ? 'active' : 'inactive'}</b></p>
        ${r.enabled ? `<p class="rt"><i class="dot ${r.executor_absent ? 'dot--bad' : 'dot--ok'}"></i>Exécuteur : <b>${r.executor_absent ? 'absent' : 'présent'}</b></p>` : ''}
        <p class="rt rt--hint">${r.enabled ? (r.executor_absent ? 'Les réponses attendent puis expirent : allume l’ingestion chat (onglet Tombola).' : 'Les réponses partent dans le chat Twitch.') : 'Les commandes sont décidées et enregistrées, rien n’est envoyé dans le chat.'}</p></div>`
      : '';
    return `<div class="body"><aside class="side scroll">
        <h5>Commandes</h5>${nav('all', 'list', 'Toutes', n.all)}${nav('fav', 'star', 'Favoris', n.fav)}${nav('check', 'warn', 'À vérifier', n.check, n.check > 0)}${nav('off', 'off', 'Désactivées', n.off)}${nav('hidden', 'eyeoff', 'Cachées du public', n.hidden)}
        <h5>Réglages</h5>${go('categories', 'folder', 'Catégories')}${go('history', 'history', 'Historique')}${go('rights', 'users', 'Droits de l’équipe')}
        ${rt}</aside><section class="main">${main}</section></div>`;
  }

  // ------------------------------------------------------------------ controls (validated prototype)
  const lockRo = (txt: string) =>
    `<div class="ro"><span class="lk" title="${esc(lockNote())}">${ic('lock')}</span><span>${esc(txt)}</span></div>`;
  const chips = (list: string[], kind: string, placeholder: string) =>
    `<div class="chips">${list.map((v) => `<span class="chip">${esc(v)}<button type="button" data-chipdel="${kind}|${esc(v)}" aria-label="Retirer ${esc(v)}">${ic('x')}</button></span>`).join('')}<input class="chip-in" data-chipin="${kind}" placeholder="${placeholder}" autocomplete="off" spellcheck="false"></div>`;
  const preview = (m: {
    mode: CmdConfig['reply']['mode'];
    text: string;
    to: string;
    to_login?: string;
  }) => {
    if (m.mode === 'silent') return '';
    const t = esc(previewText(m)).replace(
      /^(@\S+)/,
      '<span class="cl-at">$1</span>',
    );
    const line =
      m.mode === 'announce'
        ? `<div class="cl cl--ann"><span class="cl-tag">Annonce</span><b class="cl-bot">LeCroupier_</b> ${t}</div>`
        : m.mode === 'reply'
          ? `<div class="cl"><span class="cl-re">↳ En réponse à @PixelMamie</span><b class="cl-bot">LeCroupier_</b> ${t}</div>`
          : m.mode === 'me'
            ? `<div class="cl"><b class="cl-bot">LeCroupier_</b> <i class="cl-me">${t}</i></div><div class="cl cl--silent">/me n’est pas envoyé aujourd’hui (voir l’aide).</div>`
            : `<div class="cl"><b class="cl-bot">LeCroupier_</b> ${t}</div>`;
    return `<div class="pvw"><span class="pvw__t">Aperçu dans le chat <span class="faint">(exemple)</span></span><div class="pv">${line}</div></div>`;
  };
  function varsPanel(d: CmdConfig) {
    return `<div class="popw"><button type="button" class="pick" data-pop="vars" aria-expanded="${ui.pop === 'vars'}">${ic('plus')}Insérer une variable${ic('down')}</button>${
      ui.pop === 'vars'
        ? `<div class="pop pop--vars" role="listbox" aria-label="Variables">${VARIABLES.map(
            ([v, name, desc, , needs]) => {
              const off = variableMissing(d, needs);
              return `<button type="button" class="vrow ${off ? 'vrow--off' : ''}" ${off ? 'disabled' : `data-insert="${v}"`} role="option"><b>${esc(name)}</b><code>${v}</code><small>${esc(desc)}${off ? ` — demande ${needs === 'mention' ? 'un @pseudo' : 'un nombre'} après la commande (Paramètres avancés)` : ''}</small></button>`;
            },
          ).join('')}</div>`
        : ''
    }</div>`;
  }
  function replyHtml(d: CmdConfig) {
    const r = d.reply;
    if (locked('reply'))
      return (
        lockRo(`${MODES.find((m) => m[0] === r.mode)![1]} · « ${r.text} »`) +
        preview(r)
      );
    const to = TO.find((x) => x[0] === r.to)!;
    return `<div class="reply">
      <div class="seg seg--modes" role="radiogroup" aria-label="Comment le bot répond">${MODES.map(([k, l, i, desc, ok]) => `<button type="button" class="${r.mode === k ? 'on' : ''} ${ok ? '' : 'unsup'}" data-rmode="${k}" title="${esc(desc)}" role="radio" aria-checked="${r.mode === k}">${ic(i)}<span>${l}</span>${ok ? '' : '<em>non supporté</em>'}</button>`).join('')}</div>
      ${r.mode === 'me' ? `<p class="err">${ic('warn')}/me n’est pas supporté aujourd’hui : ce message ne serait pas envoyé. Choisis « Message » ou « Annonce ».</p>` : ''}
      ${
        r.mode === 'silent'
          ? '<p class="hint">Le bot n’écrit rien.</p>'
          : `<textarea class="inp" rows="2" data-rtext maxlength="500" placeholder="Ce que le bot écrit — ex. Câlin de {display_name} !">${esc(r.text)}</textarea>
      <div class="rbar">
        ${
          r.mode === 'reply'
            ? `<span class="faint" title="Twitch affiche le message du viewer au-dessus de la réponse">${ic('at')}Répond dans le fil du viewer</span>`
            : `<div class="popw"><button type="button" class="pick ${r.to !== 'none' ? 'on' : ''}" data-pop="to" aria-expanded="${ui.pop === 'to'}">${ic('at')}S’adresser à : <b>${r.to === 'user' ? `@${esc(r.to_login ?? '…')}` : esc(to[1])}</b>${ic('down')}</button>${
                ui.pop === 'to'
                  ? `<div class="pop pop--to">${TO.map(([k, l, desc]) => `<button type="button" class="popt ${r.to === k ? 'on' : ''}" data-to="${k}" ${k === 'target' && !d.args.some((a) => a.type === 'mention') ? 'disabled title="Demande un @pseudo après la commande (Paramètres avancés)"' : ''}><b>${l}</b><small>${desc}</small></button>`).join('')}${r.to === 'user' ? `<input class="inp" data-tologin value="${esc(r.to_login ?? '')}" placeholder="pseudo, sans @">` : ''}</div>`
                  : ''
              }</div>`
        }
        ${varsPanel(d)}
        <button type="button" class="lnk lnk--help" data-panel="help">${ic('help')}Aide sur les réponses</button></div>
      ${preview(r)}`
      }</div>`;
  }
  function whoHtml(d: CmdConfig) {
    const a = d.audience;
    const lg = locked('audience.groups');
    return `${lg ? lockRo(whoShort(a)) : `<div class="opts" role="group" aria-label="Groupes autorisés">${GROUPS.map(([k, l]) => `<button type="button" class="opt opt--tg ${a.groups.includes(k) ? 'on' : ''}" data-grp="${k}" aria-pressed="${a.groups.includes(k)}">${a.groups.includes(k) ? ic('check') : ''}${l}</button>`).join('')}</div>`}
      <div class="people"><span>Autoriser aussi des personnes précises</span>${locked('audience.allow') ? lockRo(a.allow.join(', ') || 'Personne') : chips(a.allow, 'allow', '+ pseudo')}</div>
      <div class="people"><span>Exclure des personnes</span>${locked('audience.deny') ? lockRo(a.deny.join(', ') || 'Personne') : chips(a.deny, 'deny', '+ pseudo')}</div>
      <p class="sentence"><b>${esc(whoShort(a))}</b> <span class="faint">${esc(whoSentence(a))}</span></p>`;
  }
  const scopeSeg = (attr: string, v: string) =>
    `<div class="seg seg--sm" role="radiogroup" aria-label="Portée"><button type="button" class="${v === 'viewer' ? 'on' : ''}" data-${attr}="viewer">Par personne</button><button type="button" class="${v === 'global' ? 'on' : ''}" data-${attr}="global">Pour tout le chat</button></div>`;
  const toggleRow = (attr: string, on: boolean, label: string) =>
    `<label class="tgl"><button type="button" class="sw ${on ? 'on' : ''}" data-${attr} role="switch" aria-checked="${on}" aria-label="${esc(label)}"></button><span>${label}</span></label>`;
  function cooldownHtml(d: CmdConfig) {
    const c = d.cooldown;
    if (locked('cooldown')) return lockRo(cooldownText(c));
    if (!c.enabled)
      return `${toggleRow('cdon', false, 'Limiter la fréquence')}<p class="hint">Aucun cooldown : la commande peut être relancée tout de suite.</p>`;
    const preset = COOLDOWN_PRESETS.some(([x]) => x === c.seconds);
    const custom = ui.cdCustom || !preset;
    const unit = { s: 1, min: 60, h: 3600 }[c.unit];
    return `${toggleRow('cdon', true, 'Limiter la fréquence')}
      <div class="lim"><div class="opts">${COOLDOWN_PRESETS.map(([x, l]) => `<button type="button" class="opt ${!custom && c.seconds === x ? 'on' : ''}" data-cdpreset="${x}">${l}</button>`).join('')}<button type="button" class="opt ${custom ? 'on' : ''}" data-cdcustom>Personnalisé…</button></div>
        ${
          custom
            ? `<div class="lrow__f">Attendre <input class="inp inp--n" data-cdval value="${c.seconds / unit}" inputmode="numeric" aria-label="Durée"><select class="inp inp--u" data-cdunit aria-label="Unité">${[
                ['s', 'secondes'],
                ['min', 'minutes'],
                ['h', 'heures'],
              ]
                .map(
                  ([v, t]) =>
                    `<option value="${v}" ${c.unit === v ? 'selected' : ''}>${t}</option>`,
                )
                .join('')}</select> entre deux utilisations</div>`
            : ''
        }
        ${scopeSeg('cdscope', c.scope)}
        <p class="sentence">${esc(cooldownText(c))}</p></div>`;
  }
  function quotaHtml(d: CmdConfig) {
    const q = d.quota;
    if (locked('quota')) return lockRo(quotaText(q));
    if (!q.enabled)
      return `${toggleRow('mxon', false, 'Limiter le nombre d’utilisations')}<p class="hint">Illimité.</p>`;
    return `${toggleRow('mxon', true, 'Limiter le nombre d’utilisations')}
      <div class="lim"><div class="lrow__f">Maximum <input class="inp inp--n" data-mxcount value="${q.max}" inputmode="numeric" aria-label="Nombre maximum"> utilisation${q.max > 1 ? 's' : ''} <select class="inp inp--w" data-mxper aria-label="Période">${WINDOWS.map(([v, t]) => `<option value="${v}" ${q.window === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        ${scopeSeg('mxscope', q.scope)}
        <p class="sentence">${esc(quotaText(q))}</p>
        <p class="hint">Indépendant du cooldown : les deux peuvent se combiner.</p></div>`;
  }
  function listedHtml(d: CmdConfig) {
    if (locked('listed'))
      return lockRo(
        d.listed
          ? 'Visible dans la liste publique'
          : 'Cachée de la liste publique',
      );
    return `<label class="tgl"><button type="button" class="sw ${d.listed ? 'on' : ''}" data-listed role="switch" aria-checked="${d.listed}"></button><span>${d.listed ? 'Visible dans la liste des commandes' : 'Cachée de la liste des commandes'}</span></label><p class="hint">${d.listed ? 'Les viewers la verront dans l’Extension, avec ses alias et sa description.' : 'Elle fonctionne toujours, mais n’apparaît pas dans la liste publique.'}</p>`;
  }
  const catSelect = (d: CmdConfig) =>
    locked('category')
      ? lockRo(categoryOf({ config: d } as CommandItem, cats()).name)
      : `<select class="inp inp--w" data-category><option value="">Sans catégorie</option>${cats()
          .map(
            (f) =>
              `<option value="${f.category_id}" ${d.category === f.category_id ? 'selected' : ''}>${esc(f.name)}</option>`,
          )
          .join('')}</select>`;
  const whenSeg = (d: CmdConfig) =>
    locked('when')
      ? lockRo(
          {
            always: 'Tout le temps',
            live: 'Pendant le live',
            offline: 'Hors live',
          }[d.when],
        )
      : `<div class="seg">${[
          ['always', 'Tout le temps'],
          ['live', 'Pendant le live'],
          ['offline', 'Hors live'],
        ]
          .map(
            ([k, l]) =>
              `<button type="button" class="${d.when === k ? 'on' : ''}" data-when="${k}">${l}</button>`,
          )
          .join('')}</div>`;

  function actionsHtml(d: CmdConfig) {
    const mod = d.actions.filter((a) => a.type === 'module');
    const chat = d.actions.filter(
      (a): a is Extract<CmdAction, { type: 'chat' }> => a.type === 'chat',
    );
    const lk = locked('actions');
    const modes = MODES.filter((m) => m[0] !== 'silent');
    return `${mod.map((a) => `<div class="locked">${ic('lock')}<div><b>Action du module ${esc(a.module)} · ${esc(a.operation)}</b><span>Fournie par le module, protégée. Elle n’est pas exécutée par Commands V2 aujourd’hui : le module la gère lui-même.</span></div></div>`).join('')}
      ${
        chat.length
          ? `<ol class="steps">${chat
              .map(
                (
                  a,
                  i,
                ) => `<li class="step open"><div class="step__h"><span class="step__n">${i + 1}</span>${ic('chat')}<span class="step__t">Envoyer un autre message</span>${lk ? '' : `<button type="button" class="ib ib--sm" data-amove="${a.id}:-1" aria-label="Monter">${ic('up')}</button><button type="button" class="ib ib--sm" data-amove="${a.id}:1" aria-label="Descendre">${ic('down')}</button><button type="button" class="ib ib--sm" data-adel="${a.id}" aria-label="Retirer">${ic('trash')}</button>`}</div>
          <div class="step__b sf">${lk ? `<span>${esc(a.text)}</span>` : `<select class="inp inp--w" data-amode="${a.id}">${modes.map(([k, l, , , ok]) => `<option value="${k}" ${a.mode === k ? 'selected' : ''} ${ok || a.mode === k ? '' : 'disabled'}>${l}${ok ? '' : ' (non supporté)'}</option>`).join('')}</select><input class="inp" data-atext="${a.id}" value="${esc(a.text)}" maxlength="500" placeholder="Texte du message"><select class="inp inp--w" data-aerr="${a.id}" title="Si cet envoi échoue"><option value="continue" ${a.on_error === 'continue' ? 'selected' : ''}>Si échec : continuer</option><option value="stop" ${a.on_error === 'stop' ? 'selected' : ''}>Si échec : arrêter</option></select>`}</div></li>`,
              )
              .join('')}</ol>`
          : ''
      }
      ${lk ? '' : `<button type="button" class="lnk" data-addchat>${ic('plus')}Ajouter un message</button>`}
      <p class="hint">Aujourd’hui : des messages chat (Message, Annonce, Réponse Twitch). Sons, OBS et Jetons arriveront plus tard.${chat.length ? ` ${d.reply_first ? 'La réponse part avant ces messages.' : 'La réponse part après ces messages.'}` : ''}</p>`;
  }
  function advOn(d: CmdConfig) {
    const out: string[] = [];
    if (d.args.length)
      out.push(
        `Le viewer ajoute : ${d.args.map((a) => (a.type === 'mention' ? `@${a.name}` : a.name) + (a.required ? '' : ' (facultatif)')).join(', ')}`,
      );
    if (d.refuse.mode !== 'silent')
      out.push(
        d.refuse.mode === 'explain'
          ? 'Explique pourquoi quand elle ne peut pas être utilisée'
          : 'Message personnalisé quand elle ne peut pas être utilisée',
      );
    if (d.reply_first && d.actions.length) out.push('Répond avant les actions');
    if (d.team_lock) out.push('Verrouillée pour l’équipe');
    return out;
  }
  function advHtml(d: CmdConfig) {
    const on = advOn(d);
    const T = [
      ['mention', '@pseudo'],
      ['number', 'Nombre'],
      ['text', 'Texte'],
    ];
    const c = ui.base;
    return `<section class="fs fs--adv"><button type="button" class="advh" data-adv aria-expanded="${ui.adv}">${ic(ui.adv ? 'down' : 'next')}<b>Paramètres avancés</b><span>${on.length ? `${on.length} réglage${on.length > 1 ? 's' : ''} actif${on.length > 1 ? 's' : ''}` : 'Rien de particulier'}</span></button>
      ${
        ui.adv
          ? `<div class="advb">
        <div class="fr"><label>Ce que le viewer écrit après la commande</label><div><div class="syntax"><code>${esc(syntax(d))}</code>${d.args.length ? `<span class="faint">Exemple : <b class="mono">${esc(example(d))}</b></span>` : ''}</div>
          ${
            locked('args')
              ? lockRo(syntax(d))
              : `${d.args.map((a, i) => `<div class="argrow"><input class="inp" data-arg="${i}" value="${esc(a.name)}" aria-label="Nom" maxlength="24"><div class="seg">${T.map(([k, l]) => `<button type="button" class="${a.type === k ? 'on' : ''}" data-argtype="${i}:${k}">${l}</button>`).join('')}</div><label class="check"><input type="checkbox" data-argreq="${i}" ${a.required ? 'checked' : ''}> obligatoire</label><button type="button" class="ib ib--sm" data-argdel="${i}" aria-label="Retirer">${ic('trash')}</button></div>`).join('')}
          ${d.args.length < 5 ? `<button type="button" class="lnk" data-argadd>${ic('plus')}Ajouter (ex. un @pseudo, un nombre)</button>` : ''}<p class="hint">Un texte prend tout le reste du message : mets-le en dernier.</p>`
          }</div></div>
        <div class="fr"><label>Si la commande ne peut pas être utilisée</label><div>${
          locked('refuse')
            ? lockRo(d.refuse.mode)
            : `<div class="seg">${[
                ['silent', 'Ne rien envoyer'],
                ['explain', 'Expliquer pourquoi'],
                ['custom', 'Message personnalisé'],
              ]
                .map(
                  ([k, l]) =>
                    `<button type="button" class="${d.refuse.mode === k ? 'on' : ''}" data-refuse="${k}">${l}</button>`,
                )
                .join(
                  '',
                )}</div>${d.refuse.mode === 'custom' ? `<input class="inp" style="margin-top:8px" data-refusetext value="${esc(d.refuse.text)}" maxlength="300" placeholder="ex. Cette commande est réservée aux abonnés.">` : ''}`
        }<p class="hint">Pas le droit, trop tôt, pas pendant le live, argument manquant… Au plus une réponse de refus par minute et par personne.</p></div></div>
        ${d.actions.length ? `<div class="fr"><label>Ordre</label><label class="check"><input type="checkbox" data-replyfirst ${d.reply_first ? 'checked' : ''} ${locked('reply_first') ? 'disabled' : ''}> Envoyer la réponse avant les autres messages</label></div>` : ''}
        <div class="fr"><label>Équipe</label><div><label class="check"><input type="checkbox" data-teamlock ${d.team_lock ? 'checked' : ''} ${locked('team_lock') ? 'disabled' : ''}> Verrouiller : l’équipe peut la voir, pas la modifier</label><p class="hint">Ce que chaque rôle peut modifier se règle dans <button type="button" class="lnk" data-goview="rights">Droits de l’équipe</button>.</p></div></div>
        ${c && c.kind === 'system' ? `<div class="fr"><label>Module</label><div><p class="hint" style="margin-top:7px">Fournie par le module ${esc(c.owner_module ?? '')}. Champs verrouillés : ${c.locked_fields.map((f) => esc(FIELD[f] ?? f)).join(', ') || 'aucun'}. Tes réglages des autres champs sont gardés quand le module se met à jour.</p><button type="button" class="btn btn--sm" data-reset>${ic('reset')}Remettre les réglages d’origine</button></div></div>` : ''}
      </div>`
          : on.length
            ? `<ul class="advsum">${on.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
            : ''
      }</section>`;
  }
  function brief(d: CmdConfig, uses: number | null) {
    const adv = advOn(d);
    return `<aside class="rail"><h6>En bref</h6><dl>
      <dt>Le viewer tape</dt><dd class="mono">${esc(syntax(d))}${d.aliases.length ? `<small>ou ${d.aliases.map((a) => `!${esc(a)}`).join(', ')}</small>` : ''}</dd>
      <dt>Le bot</dt><dd>${d.reply.mode === 'silent' ? 'N’écrit rien' : esc(MODES.find((m) => m[0] === d.reply.mode)![1])}${d.actions.filter((a) => a.type === 'chat').length ? `<small>+ ${d.actions.filter((a) => a.type === 'chat').length} autre(s) message(s)</small>` : ''}</dd>
      <dt>Qui peut l’utiliser</dt><dd>${esc(whoShort(d.audience))}</dd>
      <dt>Limites</dt><dd>${esc(cooldownText(d.cooldown))}<br>${esc(quotaText(d.quota))}</dd>
      <dt>Quand</dt><dd>${{ always: 'Tout le temps', live: 'Pendant le live', offline: 'Hors live' }[d.when]}</dd>
      <dt>Liste publique</dt><dd>${d.listed ? 'Visible' : 'Cachée'}</dd>
      ${adv.length ? `<dt>Avancé</dt><dd>${adv.map(esc).join('<br>')}</dd>` : ''}</dl>
      ${preview(d.reply)}
      ${ui.view === 'cmd' ? `<button type="button" class="btn btn--wide" data-panel="test">${ic('play')}Tester la commande</button>` : ''}
      ${uses !== null ? `<p class="stat"><b class="num">${fmt(uses)}</b> utilisation${uses > 1 ? 's' : ''} sur 30 jours</p>` : ''}</aside>`;
  }

  // ------------------------------------------------------------------ command page
  function banner(c: CommandItem) {
    const out: string[] = [];
    for (const i of c.issues ?? []) {
      if (i.code === 'word_reserved')
        out.push(
          `<div class="banner banner--bad">${ic('warn')}<div><b>!${esc(i.word)} appartient au module ${esc(i.module === 'raffle' ? 'Tombola' : i.module)} : ce mot ne lance pas cette commande.</b><span class="faint">Le module garde toujours ses mots. Retire ce mot (nom ou alias) ou change-le dans le module.</span></div></div>`,
        );
      if (i.code === 'last_send_failed')
        out.push(
          `<div class="banner banner--warn">${ic('warn')}<div><b>Le dernier envoi dans le chat : ${esc(STEP[i.status]?.[0] ?? i.status)}${i.error ? ` (${esc(i.error)})` : ''} — ${esc(ago(i.at))}.</b><div class="row"><button type="button" class="btn btn--sm btn--ghost" data-tab="history">Voir l’historique</button></div></div></div>`,
        );
      if (i.code === 'me_unsupported')
        out.push(
          `<div class="banner banner--warn">${ic('warn')}<div><b>Un message en /me n’est pas envoyé aujourd’hui.</b><span class="faint">Twitch ne propose pas /me par la voie d’envoi utilisée. Choisis Message, Annonce ou Réponse Twitch.</span></div></div>`,
        );
    }
    if (ui.conflict)
      out.push(
        `<div class="banner banner--bad">${ic('users')}<div><b>Modifiée entre-temps (${esc(who(ui.conflict.by))}, version ${ui.conflict.version}). Tes modifications ont été réappliquées sur cette nouvelle version : vérifie, puis enregistre.</b>${ui.conflict.both.length ? `<span>Modifié des deux côtés : ${ui.conflict.both.map((f) => esc(FIELD[f] ?? f)).join(', ')} — ta version est gardée dans le formulaire.</span>` : ''}<div class="row"><button type="button" class="btn btn--sm" data-conflictok>Compris</button><button type="button" class="btn btn--sm btn--ghost" data-cancel>Abandonner mes modifications</button></div></div></div>`,
      );
    return out.join('');
  }
  function settingsHtml(d: CmdConfig) {
    const c = ui.base!;
    return `<div class="sheet-grid"><div class="form">
      <section class="fs"><h2>Commande</h2>
        <div class="fr"><label for="f-name">Nom</label><div>${locked('name') ? lockRo(`!${d.name}`) : `<div class="namebox"><input id="f-name" class="inp" data-name value="${esc(d.name)}" maxlength="25" spellcheck="false"></div>`}</div></div>
        <div class="fr"><label>Alias</label><div>${
          locked('aliases')
            ? lockRo(d.aliases.map((a) => `!${a}`).join(' ') || 'Aucun')
            : chips(
                d.aliases.map((a) => `!${a}`),
                'alias',
                '+ alias',
              )
        }${ui.aliasErr ? `<p class="err">${ic('warn')}${esc(ui.aliasErr)}</p>` : '<p class="hint">D’autres mots qui lancent la même commande. Core vérifie qu’ils sont libres en enregistrant.</p>'}</div></div>
        <div class="fr"><label>Description</label><div>${locked('description') ? lockRo(d.description) : `<input class="inp" data-desc value="${esc(d.description)}" maxlength="120" placeholder="Ce que les viewers lisent dans la liste">`}</div></div>
        <div class="fr"><label>Catégorie</label><div>${catSelect(d)}</div></div>
        <div class="fr"><label>Liste publique</label><div>${listedHtml(d)}</div></div>
        <div class="fr"><label>Disponible</label><div>${whenSeg(d)}</div></div></section>
      <section class="fs"><h2>Réponse</h2>${replyHtml(d)}</section>
      <section class="fs"><h2>Qui peut l’utiliser</h2>${whoHtml(d)}</section>
      <section class="fs"><h2>Cooldown</h2>${cooldownHtml(d)}</section>
      <section class="fs"><h2>Utilisations</h2>${quotaHtml(d)}</section>
      <section class="fs"><h2>Autres messages</h2>${actionsHtml(d)}</section>
      ${advHtml(d)}
      ${c.kind === 'custom' ? `<p class="dzone"><button type="button" class="btn btn--sm btn--danger" data-remove>${ic('trash')}Supprimer la commande</button></p>` : ''}</div>${brief(d, c.uses_30d ?? 0)}</div>`;
  }
  const invRow = (x: Invocation, showCmd: boolean) => {
    const name = showCmd
      ? ui.list?.commands.find((c) => c.command_id === x.command_id)?.config
          .name
      : null;
    const sent = x.steps
      .map(
        (s) =>
          `<span class="res res--${STEP[s.status]?.[1] ?? 'off'}" title="${esc(`${s.kind} · ${s.status}${s.error ? ` · ${s.error}` : ''}`)}">${esc(STEP[s.status]?.[0] ?? s.status)}${s.error ? ` · ${esc(s.error)}` : ''}</span>`,
      )
      .join('');
    return `<div class="arow"><time>${clock(x.created_at)}</time><span class="res res--${x.decision === 'accepted' ? 'ok' : 'warn'}">${x.decision === 'accepted' ? 'Acceptée' : 'Refusée'}</span><div class="arow__t">${name ? `<span class="cn">${esc(name)}</span> · ` : ''}${esc(x.viewer_display_name)} <span class="faint">!${esc(x.trigger)} · ${x.source === 'twitch' ? 'Twitch' : 'simulateur'}</span>${x.reason ? `<small>${esc(REASON[x.reason] ?? x.reason)}${x.reason_detail?.message ? ` — ${esc(x.reason_detail.message)}` : ''}</small>` : ''}${x.steps.length ? `<small class="sent">Chat : ${sent}</small>` : x.decision === 'accepted' ? '<small class="faint">Aucun message à envoyer</small>' : ''}</div></div>`;
  };
  const byDay = <T extends { created_at: string }>(
    list: T[],
    f: (x: T) => string,
    empty: string,
  ) => {
    if (!list.length) return `<p class="empty">${empty}</p>`;
    let d = '';
    return list
      .map(
        (x) =>
          `${day(x.created_at) !== d ? `<div class="aday">${(d = day(x.created_at))}</div>` : ''}${f(x)}`,
      )
      .join('');
  };
  const val = (v: unknown) =>
    v === null || v === undefined
      ? '—'
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);
  const changeRow = (x: HistoryEntry, showCmd: boolean) => {
    const name =
      showCmd && x.command_id
        ? ui.list?.commands.find((c) => c.command_id === x.command_id)?.config
            .name
        : null;
    const act =
      {
        create: 'Création',
        update: 'Modification',
        delete: 'Suppression',
        reset: 'Remise d’origine',
        system_sync: 'Mise à jour du module',
        rights: 'Droits de l’équipe',
      }[x.action] ?? x.action;
    return `<div class="arow"><time>${clock(x.created_at)}</time><span class="who">${esc(x.actor_login ?? (x.via === 'studio' ? 'Studio' : x.actor_id))}<em>${esc(x.via === 'studio' ? 'Studio' : x.via === 'extension' ? 'Extension' : 'système')}</em></span><div class="arow__t"><b>${esc(act)}</b>${name ? ` · <span class="cn">${esc(name)}</span>` : ''}${x.changes.map((ch) => `<div class="diff"><span>${esc(FIELD[ch.field] ?? ch.field)}</span>${ch.before !== null && ch.before !== undefined ? `<del>${esc(val(ch.before))}</del>${ic('next')}` : ''}<ins>${esc(val(ch.after))}</ins></div>`).join('')}</div></div>`;
  };
  function historyTab() {
    const h = ui.cmdHist;
    if (!h) return '<p class="empty">Chargement…</p>';
    return `<div class="actcols"><section><h3>Utilisations et refus</h3><div class="alist">${byDay(h.invocations, (x) => invRow(x, false), 'Aucune utilisation.')}</div></section><section><h3>Modifications</h3><div class="alist">${byDay(h.entries, (x) => changeRow(x, false), 'Aucune modification.')}</div></section></div>`;
  }
  function cmdHtml() {
    const c = ui.base;
    const d = ui.draft;
    if (!c || !d) return libHtml();
    const i = ui.order.indexOf(c.command_id);
    const k = categoryOf(c, cats());
    const err = ui.error;
    return `<div class="ptop"><button type="button" class="btn btn--ghost btn--sm" data-back>${ic('back')}Commandes</button><span class="crumb">${esc(k.name)}</span><span class="grow"></span>
        ${i >= 0 ? `<span class="pos num">${i + 1} / ${ui.order.length}</span><button type="button" class="ib" data-nav="-1" ${i <= 0 ? 'disabled' : ''} aria-label="Précédente">${ic('prev')}</button><button type="button" class="ib" data-nav="1" ${i >= ui.order.length - 1 ? 'disabled' : ''} aria-label="Suivante">${ic('next')}</button>` : ''}</div>
      <div class="page scroll"><div class="pin">
        <div class="phead"><div class="look"><button type="button" class="tile tile--lg" style="--c:${d.appearance.color}" data-look title="Icône et couleur" ${locked('appearance') ? 'disabled' : ''}>${ic(d.appearance.icon)}<span class="pen">${ic('pencil')}</span></button>${ui.look ? `<div class="pop pop--look"><div class="icons" style="--c:${d.appearance.color}">${ICONS.map((x) => `<button type="button" class="${d.appearance.icon === x ? 'on' : ''}" data-icon="${x}" aria-label="${x}">${ic(x)}</button>`).join('')}</div><div class="swatches">${COLORS.map((x) => `<button type="button" class="${d.appearance.color === x ? 'on' : ''}" style="--sw:${x}" data-color="${x}" aria-label="Couleur ${x}"></button>`).join('')}</div></div>` : ''}</div>
          <div class="phead__t"><h1><span class="cn">${esc(d.name)}</span></h1><p class="desc">${esc(d.description || 'Sans description')}</p><p class="origin">${c.kind === 'system' ? `${ic('cube')}Commande système · module ${esc(c.owner_module ?? '')}` : 'Créée dans Raptoru'}${!c.config.listed ? ` · ${ic('eyeoff')}cachée du public` : ''}${c.config.team_lock ? ` · ${ic('lock')}verrouillée pour l’équipe` : ''}</p></div>
          <div class="phead__a"><button type="button" class="ib star ${fav.has(c.command_id) ? 'on' : ''}" data-fav="${c.command_id}" aria-label="Favori">${ic('star')}</button><label class="tgl"><button type="button" class="sw ${c.config.enabled ? 'on' : ''}" data-toggle="${c.command_id}" role="switch" aria-checked="${c.config.enabled}" ${locked('enabled') ? `disabled title="${esc(lockNote())}"` : ''}></button><span>${c.config.enabled ? 'Active' : 'Désactivée'}</span></label></div></div>
        ${banner(c)}
        <div class="tabs"><button type="button" class="${ui.tab === 'settings' ? 'on' : ''}" data-tab="settings">Réglages</button><button type="button" class="${ui.tab === 'history' ? 'on' : ''}" data-tab="history">Historique</button></div>
        ${ui.tab === 'settings' ? settingsHtml(d) : historyTab()}</div></div>
      ${ui.tab === 'settings' ? `<footer class="pfoot"><span class="state ${dirty() || err ? 'dirty' : ''}">${ui.saving ? '<span class="spin"></span>Enregistrement…' : err ? `${ic('warn')}${esc(err)}` : dirty() ? 'Modifications non enregistrées' : ui.savedAt ? `${ic('check')}Enregistrée à ${ui.savedAt}` : `${ic('check')}À jour · version ${c.version} · modifiée ${esc(ago(c.updated_at))} par ${esc(who(c.updated_by))}`}</span><span class="grow"></span><button type="button" class="btn btn--ghost" data-cancel ${dirty() ? '' : 'disabled'}>Annuler</button><button type="button" class="btn btn--primary" data-save ${dirty() && !ui.saving ? '' : 'disabled'}>Enregistrer</button></footer>` : ''}`;
  }

  // ------------------------------------------------------------------ creation
  function newHtml() {
    const d = ui.nw!;
    const nm = word(d.name);
    const block = !nm
      ? 'Donne un nom'
      : d.reply.mode !== 'silent' && !d.reply.text.trim()
        ? 'Écris la réponse'
        : '';
    return `<div class="ptop"><button type="button" class="btn btn--ghost btn--sm" data-back>${ic('back')}Commandes</button><span class="crumb">Nouvelle commande</span></div>
      <div class="page scroll"><div class="pin"><div class="phead"><div class="phead__t"><h1>Nouvelle commande</h1><p class="desc">L’essentiel suffit. Autres messages et paramètres avancés se règlent ensuite.</p></div></div>
      <div class="sheet-grid"><div class="form">
        <section class="fs"><h2>Commande</h2><div class="fr"><label for="n-name">Nom</label><div><div class="namebox"><input id="n-name" class="inp" data-name value="${esc(d.name)}" placeholder="ex. calin" maxlength="25" spellcheck="false" autocomplete="off"></div></div></div>
          <div class="fr"><label>Alias</label><div>${chips(
            d.aliases.map((a) => `!${a}`),
            'alias',
            '+ alias',
          )}${ui.aliasErr ? `<p class="err">${ic('warn')}${esc(ui.aliasErr)}</p>` : ''}</div></div>
          <div class="fr"><label>Description</label><input class="inp" data-desc value="${esc(d.description)}" maxlength="120" placeholder="Ce que les viewers lisent dans la liste"></div>
          <div class="fr"><label>Catégorie</label><div>${catSelect(d)}</div></div>
          <div class="fr"><label>Liste publique</label><div>${listedHtml(d)}</div></div>
          <div class="fr"><label>Disponible</label><div>${whenSeg(d)}</div></div></section>
        <section class="fs"><h2>Réponse</h2>${replyHtml(d)}</section>
        <section class="fs"><h2>Qui peut l’utiliser</h2>${whoHtml(d)}</section>
        <section class="fs"><h2>Cooldown</h2>${cooldownHtml(d)}</section>
        <section class="fs"><h2>Utilisations</h2>${quotaHtml(d)}</section></div>${brief(d, null)}</div></div></div>
      <footer class="pfoot"><span class="state ${block || ui.error ? 'dirty' : ''}">${ui.saving ? '<span class="spin"></span>Création…' : ui.error ? `${ic('warn')}${esc(ui.error)}` : block || `${ic('check')}Prête`}</span><span class="grow"></span><button type="button" class="btn btn--ghost" data-create="off" ${block || ui.saving ? 'disabled' : ''}>Créer désactivée</button><button type="button" class="btn btn--primary" data-create="on" ${block || ui.saving ? 'disabled' : ''}>Créer et activer</button></footer>`;
  }

  // ------------------------------------------------------------------ global history, categories, rights
  function historyHtml() {
    const h = ui.histData;
    const body = !h
      ? '<p class="empty">Chargement…</p>'
      : ui.hist === 'runs'
        ? byDay(
            h.invocations ?? [],
            (x) => invRow(x, true),
            'Aucune utilisation.',
          )
        : ui.hist === 'changes'
          ? byDay(
              h.entries ?? [],
              (x) => changeRow(x, true),
              'Aucune modification.',
            )
          : byDay(
              h.steps ?? [],
              (s) =>
                `<div class="arow"><time>${clock(s.created_at)}</time><span class="res res--${STEP[s.status]?.[1] ?? 'off'}">${esc(STEP[s.status]?.[0] ?? s.status)}</span><div class="arow__t">${esc(s.params.text ?? '')}<small>${esc({ normal: 'Message', announce: 'Annonce', reply: 'Réponse Twitch', me: '/me' }[s.params.mode ?? ''] ?? s.params.mode ?? '')} · ${esc(s.origin === 'word_game' ? 'Jeu des mots' : s.kind === 'refusal' ? 'réponse de refus' : s.kind === 'reply' ? 'réponse' : 'autre message')}${s.attempt_count > 1 ? ` · ${s.attempt_count} tentatives` : ''}${s.error?.code ? ` · ${esc(s.error.code)}` : ''}${s.twitch_message_id ? ' · preuve Twitch reçue' : ''}</small></div></div>`,
              'Aucun envoi.',
            );
    return `<div class="mhead"><h1>Historique</h1></div><div class="page scroll"><div class="pin pin--wide"><div class="seg">${[
      ['runs', 'Utilisations et refus'],
      ['changes', 'Modifications'],
      ['steps', 'Envois dans le chat'],
    ]
      .map(
        ([k, l]) =>
          `<button type="button" class="${ui.hist === k ? 'on' : ''}" data-hist="${k}">${l}</button>`,
      )
      .join('')}</div>
      <p class="hint">${ui.hist === 'runs' ? 'Chaque message qui a nommé une commande : acceptée ou refusée (avec la raison), et ce qui est parti dans le chat.' : ui.hist === 'changes' ? 'Qui a modifié quoi, avant → après.' : 'Les messages envoyés (ou non) par LeCroupier_ : envoyé, échec, incertain (jamais renvoyé), expiré.'}</p>
      <div class="alist alist--big">${body}</div></div></div>`;
  }
  function categoriesHtml() {
    const all = ui.list?.commands ?? [];
    const list = cats();
    return `<div class="mhead"><h1>Catégories</h1></div><div class="page scroll"><div class="pin pin--wide">
      <p class="lead">Tes catégories rangent la liste des commandes (et, plus tard, la liste publique). Supprimer une catégorie garde ses commandes, qui passent dans « Sans catégorie ».</p>
      <div class="catlist">${list
        .map(
          (
            k,
            i,
          ) => `<div class="catrow"><div class="look"><button type="button" class="tile tile--md" style="--c:${k.color}" data-catlook="${k.category_id}" title="Icône et couleur">${ic(k.icon)}</button>${
            ui.catEdit === k.category_id
              ? `<div class="pop pop--look"><div class="icons" style="--c:${k.color}">${ICONS.map((x) => `<button type="button" class="${k.icon === x ? 'on' : ''}" data-caticon="${k.category_id}|${x}" aria-label="${x}">${ic(x)}</button>`).join('')}</div><div class="swatches">${COLORS.map((x) => `<button type="button" class="${k.color === x ? 'on' : ''}" style="--sw:${x}" data-catcolor="${k.category_id}|${x}" aria-label="Couleur ${x}"></button>`).join('')}</div></div>`
              : ''
          }</div>
          <input class="inp" data-catname="${k.category_id}" value="${esc(k.name)}" maxlength="24" aria-label="Nom de la catégorie">
          <span class="faint">${all.filter((c) => c.config.category === k.category_id).length} commande(s)</span><span class="grow"></span>
          <button type="button" class="ib ib--sm" data-catmove="${k.category_id}|-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter">${ic('up')}</button><button type="button" class="ib ib--sm" data-catmove="${k.category_id}|1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Descendre">${ic('down')}</button><button type="button" class="ib ib--sm" data-catdel="${k.category_id}" aria-label="Supprimer">${ic('trash')}</button></div>`,
        )
        .join('')}
        <div class="catrow catrow--new"><span class="tile tile--md" style="--c:#94a3b8">${ic('folder')}</span><input class="inp" data-catnew placeholder="Nouvelle catégorie — ex. Infos, Fun, Modération" maxlength="24"><button type="button" class="btn btn--sm btn--primary" data-catadd>${ic('plus')}Ajouter</button></div></div>
      ${ui.error ? `<p class="err">${ic('warn')}${esc(ui.error)}</p>` : ''}
      <p class="note">${all.filter((c) => categoryOf(c, list) === NO_CATEGORY).length} commande(s) sans catégorie.</p></div></div>`;
  }
  function rightsHtml() {
    const r = ui.rightsDraft;
    if (!r || !ui.rights)
      return `<div class="mhead"><h1>Droits de l’équipe</h1></div><p class="empty">Chargement…</p>`;
    const cell = (role: 'moderator' | 'supermod', k: keyof CmdTeamRights) => {
      const v = r[role][k];
      const on =
        typeof v === 'boolean' ? v : (v as { allowed: boolean }).allowed;
      const extra =
        k === 'cooldown' && on
          ? `<span class="rng">cooldown d’au moins <input class="inp inp--n" data-rightv="${role}:cooldown.min_seconds" value="${r[role].cooldown.min_seconds}"> s</span>`
          : k === 'volume' && on
            ? `<span class="rng">entre <input class="inp inp--n" data-rightv="${role}:volume.min" value="${r[role].volume.min}"> et <input class="inp inp--n" data-rightv="${role}:volume.max" value="${r[role].volume.max}"> %</span>`
            : '';
      return `<td><label class="check"><input type="checkbox" data-right="${role}:${k}" ${on ? 'checked' : ''} aria-label="${role} ${k}"></label>${extra}</td>`;
    };
    const dirtyRole = (role: 'moderator' | 'supermod') =>
      !same(r[role], ui.rights![role].rights);
    return `<div class="mhead"><h1>Droits de l’équipe</h1></div><div class="page scroll"><div class="pin pin--wide">
      <p class="lead">Ce que les modérateurs et supermodos peuvent modifier depuis l’Extension (Modération › Commandes). Le streamer peut tout configurer. Une commande verrouillée reste en lecture seule pour l’équipe.</p>
      <table class="rights"><thead><tr><th></th><th>Modérateurs</th><th>Supermodos</th></tr></thead><tbody>
        ${RIGHTS.map(([k, l, s]) => `<tr><th>${l}${s ? `<small>${s}</small>` : ''}</th>${cell('moderator', k)}${cell('supermod', k)}</tr>`).join('')}
        <tr class="always"><th>Rechercher, consulter, tester, voir l’historique</th><td>${ic('check')}Toujours</td><td>${ic('check')}Toujours</td></tr></tbody></table>
      <div class="row rightsave">${(['moderator', 'supermod'] as const).map((role) => `<button type="button" class="btn ${dirtyRole(role) ? 'btn--primary' : ''}" data-rightsave="${role}" ${dirtyRole(role) ? '' : 'disabled'}>Enregistrer ${role === 'moderator' ? 'modérateurs' : 'supermodos'}</button>`).join('')}${ui.rightsMsg ? `<span class="${ui.rightsMsg.startsWith('!') ? 'err' : 'faint'}">${esc(ui.rightsMsg.replace(/^!/, ''))}</span>` : ''}</div>
      <p class="note">${ic('lock')} Jamais depuis l’Extension : les autres messages, les paramètres avancés, les catégories.</p></div></div>`;
  }

  // ------------------------------------------------------------------ panels (help, test)
  function helpHtml() {
    return `<div class="help">
      <h6>Comment le bot répond</h6>${MODES.map(([, l, i, desc]) => `<div class="hrow">${ic(i)}<div><b>${l}</b><span>${esc(desc)}</span></div></div>`).join('')}
      <h6>S’adresser à quelqu’un</h6><p>Ajoute « @pseudo » au début du message : celui qui tape la commande, la personne qu’il a mentionnée (ex. <b>!hug @Aouh</b>, il faut alors un @pseudo dans les paramètres avancés), ou toujours le même pseudo. En « Réponse Twitch », pas besoin : Twitch montre déjà à qui le bot répond.</p>
      <h6>Variables</h6><p>« Insérer une variable », sous le texte, ajoute un mot remplacé au moment de l’envoi :</p><table class="vtab">${VARIABLES.map(([v, name, desc, ex]) => `<tr><td><b>${esc(name)}</b><small><code>${v}</code></small></td><td>${esc(desc)}<small>ex. ${esc(ex)}</small></td></tr>`).join('')}</table>
      <h6>Qui peut l’utiliser</h6><p>Active un ou plusieurs groupes : ils s’additionnent (VIP + Abonnés). « Tout le monde » remplace tous les autres. Les personnes ajoutées à la main peuvent l’utiliser en plus, ou seules si aucun groupe n’est actif. Une personne exclue ne peut jamais l’utiliser. Personne n’a de passe-droit : le streamer et l’équipe suivent les mêmes règles (groupe Streamer, Modérateurs…).</p>
      <h6>Cooldown et utilisations</h6><p><b>Cooldown</b> : un temps minimum entre deux utilisations (par personne ou pour tout le chat). <b>Utilisations</b> : un plafond sur une période (heure, live, jour, total). Les alias partagent les compteurs de leur commande. Les deux peuvent se combiner.</p>
      <h6>Tester</h6><p>« Tester la commande » pose la question à Core avec la version enregistrée : même décision qu’un vrai message, rien n’est écrit ni envoyé.</p></div>`;
  }
  function testHtml() {
    const c = ui.base!;
    const t = ui.test;
    const d = t.res;
    const det = d?.detail ?? {};
    const extra = d
      ? [
          det.remaining_s !== undefined
            ? `Cooldown : encore ${dur(Number(det.remaining_s))} (${det.scope === 'viewer' ? 'par personne' : 'pour tout le chat'})`
            : '',
          det.used !== undefined
            ? `Utilisations : ${String(det.used)} sur ${String(det.max)}`
            : '',
          det.syntax ? `Syntaxe : ${String(det.syntax)}` : '',
          det.follower_source
            ? `Follow : ${det.follower_source === 'test' ? 'valeur du test' : 'inconnu (pas encore de lecture Twitch)'}`
            : '',
        ].filter(Boolean)
      : [];
    const rendered = d?.rendered;
    const lines = rendered
      ? [
          ...(rendered.reply_first && rendered.reply ? [rendered.reply] : []),
          ...rendered.actions.filter((a) => a.type === 'chat'),
          ...(!rendered.reply_first && rendered.reply ? [rendered.reply] : []),
        ]
      : [];
    return `<div class="diag"><p class="note" style="margin-top:0">Core décide avec la version enregistrée, exactement comme pour un vrai message. Rien n’est écrit, rien n’est envoyé.</p>
      <div class="diag__f">
        <label><span>Qui</span><select class="inp" data-tpreset>${TEST_VIEWERS.map((v, i) => `<option value="${i}" ${t.preset === i ? 'selected' : ''}>${v.label} · ${v.display_name}</option>`).join('')}</select></label>
        <div class="tgrid"><label><span>Pseudo</span><input class="inp" data-tfield="display_name" value="${esc(t.display_name)}"></label><label><span>Login</span><input class="inp" data-tfield="login" value="${esc(t.login)}"></label><label><span>Id Twitch</span><input class="inp" data-tfield="id" value="${esc(t.id)}"></label>
        <label><span>Rôle chat</span><select class="inp" data-tfield="role">${[
          ['viewer', 'Viewer'],
          ['moderator', 'Modérateur'],
          ['broadcaster', 'Streamer'],
        ]
          .map(
            ([k, l]) =>
              `<option value="${k}" ${t.role === k ? 'selected' : ''}>${l}</option>`,
          )
          .join('')}</select></label></div>
        <div class="tbadges"><span>Badges</span>${BADGES.map((b) => `<label class="check"><input type="checkbox" data-tbadge="${b}" ${t.badges.includes(b) ? 'checked' : ''}> ${b}</label>`).join('')}</div>
        <div class="tbadges"><span>Follower</span><div class="seg seg--sm">${[
          ['unknown', 'Inconnu'],
          ['true', 'Oui'],
          ['false', 'Non'],
        ]
          .map(
            ([k, l]) =>
              `<button type="button" class="${t.follower === k ? 'on' : ''}" data-tfollow="${k}">${l}</button>`,
          )
          .join('')}</div></div>
        <label><span>Message</span><input class="inp" data-tmsg value="${esc(t.message || example(c.config))}" spellcheck="false"></label>
        <div class="row"><button type="button" class="btn btn--primary btn--sm" data-trun ${t.busy ? 'disabled' : ''}>${ic('play')}Tester</button>${t.error ? `<span class="err">${esc(t.error)}</span>` : ''}</div></div>
      ${
        d
          ? `<div class="verdict verdict--${d.decision === 'accepted' ? 'ok' : 'no'}">${ic(d.decision === 'accepted' ? 'check' : 'warn')}<div><b>${d.decision === 'accepted' ? `Acceptée pour ${esc(t.display_name)}.` : `Refusée : ${esc(REASON[d.reason ?? ''] ?? d.reason)}`}</b><span>${esc(d.message)}</span><span class="faint">Groupes vus : ${esc(d.viewer.groups.join(', ') || 'aucun')} · ${d.live ? 'en live' : 'hors live'}</span></div></div>
        <ol class="checks">${d.checks.map((x) => `<li class="ck ck--${x.ok ? 'ok' : 'no'}">${ic(x.ok ? 'check' : 'x')}<div><b>${esc(CHECK[x.check] ?? x.check)}</b>${!x.ok && extra.length ? `<small>${extra.map(esc).join(' · ')}</small>` : ''}</div></li>`).join('')}</ol>
        ${
          Object.keys(d.args).length
            ? `<p class="note">Arguments compris : ${Object.entries(d.args)
                .map(([k, v]) => `<b>${esc(k)}</b> = ${esc(v)}`)
                .join(', ')}</p>`
            : ''
        }
        ${lines.length ? `<div class="pvw"><span class="pvw__t">Ce qui serait envoyé (rendu final de Core)</span><div class="pv">${lines.map((l) => `<div class="cl ${l.mode === 'announce' ? 'cl--ann' : ''}">${l.mode === 'announce' ? '<span class="cl-tag">Annonce</span>' : ''}${l.mode === 'reply' ? '<span class="cl-re">↳ en réponse au message</span>' : ''}<b class="cl-bot">LeCroupier_</b> ${l.mode === 'me' ? `<i class="cl-me">${esc(l.text)}</i> <em class="faint">(non envoyé : /me)</em>` : esc(l.text)}</div>`).join('')}</div></div>` : d.decision === 'accepted' ? '<p class="note">Aucun message (mode Rien).</p>' : ''}`
          : ''
      }</div>`;
  }
  function panelHtml() {
    if (!ui.panel) return '';
    const title =
      ui.panel === 'help'
        ? 'Aide'
        : `Tester !${esc(ui.base?.config.name ?? '')}`;
    return `<div class="veil" data-closepanel></div><aside class="drawer"><header class="dh"><b>${title}</b><span class="grow"></span><button type="button" class="ib" data-closepanel aria-label="Fermer">${ic('x')}</button></header><div class="db scroll">${ui.panel === 'test' && dirty() ? '<p class="note" style="margin-top:0">Modifications non enregistrées : le test utilise la version enregistrée.</p>' : ''}${ui.panel === 'help' ? helpHtml() : testHtml()}</div></aside>`;
  }

  // ------------------------------------------------------------------ render
  function render() {
    const keep = [...root.querySelectorAll<HTMLElement>('.scroll')].map(
      (s) => s.scrollTop,
    );
    const main =
      ui.view === 'cmd'
        ? cmdHtml()
        : ui.view === 'new'
          ? newHtml()
          : ui.view === 'history'
            ? historyHtml()
            : ui.view === 'rights'
              ? rightsHtml()
              : ui.view === 'categories'
                ? categoriesHtml()
                : libHtml();
    root.innerHTML = shell(main) + panelHtml();
    [...root.querySelectorAll<HTMLElement>('.scroll')].forEach(
      (s, i) => (s.scrollTop = keep[i] ?? 0),
    );
  }
  const keyOf = (el: Element | null) => {
    if (!el || el === document.body) return null;
    const a = [...el.attributes].find((x) => x.name.startsWith('data-'));
    return a
      ? `[${a.name}="${CSS.escape(a.value)}"]`
      : el.id
        ? `#${el.id}`
        : null;
  };
  function rerender() {
    const a = document.activeElement as HTMLInputElement | null;
    const k = root.contains(a) ? keyOf(a) : null;
    const start = a && 'selectionStart' in a ? a.selectionStart : null;
    const end = a && 'selectionEnd' in a ? a.selectionEnd : null;
    render();
    const el = k ? root.querySelector<HTMLInputElement>(k) : null;
    if (el) {
      el.focus({ preventScroll: true });
      if (start !== null && el.setSelectionRange)
        try {
          el.setSelectionRange(start, end ?? start);
        } catch {
          /* not a text field */
        }
    }
  }
  function toast(text: string) {
    root.querySelector('.toast')?.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `${ic('check')}<span>${esc(text)}</span>`;
    root.append(t);
    setTimeout(() => t.remove(), 4200);
  }
  const errText = (e: unknown) => {
    const b = (e as ApiError).body ?? {};
    const code = String(b.error ?? (e as Error).message);
    const issues = Array.isArray(b.issues)
      ? ` : ${(b.issues as string[]).slice(0, 3).join(' · ')}`
      : '';
    const wordInfo = b.word
      ? ` (!${String(b.word)}${b.command ? ` → !${String(b.command)}` : b.module ? ` → ${String(b.module)}` : ''})`
      : '';
    return `${SAVE_ERROR[code] ?? code}${wordInfo}${issues}`;
  };

  // ------------------------------------------------------------------ actions
  function open(id: string) {
    const c = ui.list?.commands.find((x) => x.command_id === id);
    if (!c) return;
    if (ui.view === 'lib') ui.order = shownOrder();
    Object.assign(ui, {
      view: 'cmd',
      id,
      base: clone(c),
      draft: clone(c.config),
      tab: 'settings',
      pop: null,
      cdCustom: false,
      adv: false,
      look: false,
      panel: null,
      conflict: null,
      error: '',
      savedAt: '',
      aliasErr: '',
      cmdHist: null,
    });
    ui.test.res = null;
    ui.test.message = '';
  }
  const leave = () => !dirty() || confirm('Quitter sans enregistrer ?');
  async function loadCmdHistory() {
    if (!ui.base) return;
    const id = ui.base.command_id;
    try {
      const [inv, h] = await Promise.all([
        api<{ invocations: Invocation[] }>(
          `/api/commands/invocations?command_id=${id}&limit=50`,
        ),
        api<{ entries: HistoryEntry[] }>(
          `/api/commands/${id}/history?limit=50`,
        ),
      ]);
      if (ui.base?.command_id === id)
        ui.cmdHist = { invocations: inv.invocations, entries: h.entries };
    } catch (e) {
      ui.cmdHist = { invocations: [], entries: [] };
      ui.error = errText(e);
    }
    rerender();
  }
  async function loadHistory() {
    try {
      ui.histData =
        ui.hist === 'runs'
          ? await api('/api/commands/invocations?limit=100')
          : ui.hist === 'changes'
            ? await api('/api/commands/history?limit=100')
            : await api('/api/commands/steps?limit=100');
    } catch (e) {
      ui.histData = {};
      toast(errText(e));
    }
    rerender();
  }
  async function loadRights() {
    try {
      ui.rights = await api('/api/commands/rights');
      ui.rightsDraft = {
        moderator: clone(ui.rights!.moderator.rights),
        supermod: clone(ui.rights!.supermod.rights),
      };
    } catch (e) {
      ui.rightsMsg = `!${errText(e)}`;
    }
    rerender();
  }
  /** Saves the draft with the version it was read at; a 409 never overwrites anybody. */
  async function save() {
    const c = ui.base;
    const d = ui.draft;
    if (!c || !d) return;
    const ch = changes(c.config, d);
    if (!Object.keys(ch).length) return;
    ui.saving = true;
    ui.error = '';
    rerender();
    try {
      const out = await api<CommandItem>(
        `/api/commands/${c.command_id}/update`,
        { expected_version: c.version, changes: ch },
      );
      await loadList();
      ui.base = cur() ?? { ...c, ...out };
      ui.draft = clone(ui.base.config);
      ui.conflict = null;
      ui.savedAt = clock(new Date().toISOString());
      toast(`!${out.config.name} enregistrée`);
    } catch (e) {
      const err = e as ApiError;
      if (
        err.status === 409 &&
        err.body?.error === 'version_conflict' &&
        err.body.current
      ) {
        const current = err.body.current as CommandItem;
        const r = reapply(c.config, d, current.config);
        await loadList();
        ui.base = cur() ?? current;
        ui.draft = r.draft;
        ui.conflict = {
          by: current.updated_by,
          version: current.version,
          both: r.both,
          theirs: r.theirs,
        };
      } else ui.error = errText(e);
    }
    ui.saving = false;
    rerender();
  }
  /** One-field change applied right away (switch in the list / page header). */
  async function quick(c: CommandItem, changesNow: Partial<CmdConfig>) {
    try {
      await api(`/api/commands/${c.command_id}/update`, {
        expected_version: c.version,
        changes: changesNow,
      });
      await loadList();
      if (ui.view === 'cmd' && ui.base?.command_id === c.command_id) {
        const f = cur()!;
        const keepDraft = ui.draft
          ? { ...ui.draft, ...changesNow }
          : clone(f.config);
        ui.base = f;
        ui.draft = keepDraft;
      }
    } catch (e) {
      const err = e as ApiError;
      await loadList();
      toast(
        err.status === 409
          ? 'Modifiée ailleurs entre-temps : la liste est rechargée, recommence.'
          : errText(e),
      );
    }
    rerender();
  }
  async function create(enabled: boolean) {
    const d = ui.nw!;
    ui.saving = true;
    ui.error = '';
    rerender();
    try {
      const out = await api<CommandItem>('/api/commands', {
        config: { ...d, name: word(d.name), enabled },
      });
      await loadList();
      ui.nw = null;
      ui.saving = false;
      open(out.command_id);
      toast(`!${out.config.name} créée${enabled ? '' : ' (désactivée)'}`);
    } catch (e) {
      ui.saving = false;
      ui.error = errText(e);
    }
    rerender();
  }
  async function cat(path: string, body: Json, msg = '') {
    ui.error = '';
    try {
      const out = await api<{ categories: Category[] }>(path, body);
      if (ui.list) ui.list.categories = out.categories;
      await loadList();
      if (msg) toast(msg);
    } catch (e) {
      ui.error = errText(e);
    }
    rerender();
  }

  // ------------------------------------------------------------------ events
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const at = <T extends HTMLElement = HTMLElement>(s: string) =>
      t.closest<T>(s);
    let b: HTMLElement | null;
    const d = D();
    if (ui.pop && !at('.popw')) ui.pop = null;
    if (ui.look && !at('.look')) ui.look = false;
    if (ui.catEdit && !at('.look')) ui.catEdit = null;
    if ((b = at('[data-toggle]'))) {
      e.stopPropagation();
      const c = ui.list?.commands.find(
        (x) => x.command_id === b!.dataset.toggle,
      );
      if (c) void quick(c, { enabled: !c.config.enabled });
      return;
    }
    if ((b = at('[data-fav]'))) {
      const id = b.dataset.fav!;
      if (fav.has(id)) fav.delete(id);
      else fav.add(id);
      saveFav();
      return rerender();
    }
    if (at('[data-new]')) {
      if (!leave()) return;
      ui.nw = fresh(ui.cat !== 'all' && ui.cat !== 'none' ? ui.cat : null);
      Object.assign(ui, {
        view: 'new',
        base: null,
        draft: null,
        error: '',
        pop: null,
        aliasErr: '',
        cdCustom: false,
      });
      render();
      return root.querySelector<HTMLInputElement>('[data-name]')?.focus();
    }
    if ((b = at('[data-open]'))) return (open(b.dataset.open!), render());
    if (at('[data-back]')) {
      if (!leave()) return;
      Object.assign(ui, {
        view: 'lib',
        base: null,
        draft: null,
        nw: null,
        panel: null,
        error: '',
      });
      return render();
    }
    if ((b = at('[data-nav]'))) {
      if (!leave()) return;
      const o = ui.order;
      const id = o[o.indexOf(ui.base!.command_id) + Number(b.dataset.nav)];
      if (id) open(id);
      ui.order = o;
      return render();
    }
    if ((b = at('[data-side]'))) {
      if (!leave()) return;
      Object.assign(ui, {
        side: b.dataset.side as ListUi['side'],
        view: 'lib',
        base: null,
        draft: null,
      });
      return render();
    }
    if ((b = at('[data-goview]'))) {
      if (!leave()) return;
      ui.view = b.dataset.goview as View;
      Object.assign(ui, { base: null, draft: null, panel: null, error: '' });
      if (ui.view === 'history') void loadHistory();
      if (ui.view === 'rights') void loadRights();
      return render();
    }
    if ((b = at('[data-hist]'))) {
      ui.hist = b.dataset.hist as typeof ui.hist;
      ui.histData = null;
      void loadHistory();
      return rerender();
    }
    if (at('[data-group]')) return ((ui.group = !ui.group), rerender());
    if ((b = at('[data-sort]'))) {
      const k = b.dataset.sort as typeof ui.sort.key;
      ui.sort =
        ui.sort.key === k ? { key: k, dir: -ui.sort.dir } : { key: k, dir: 1 };
      return rerender();
    }
    if ((b = at('[data-tab]'))) {
      ui.tab = b.dataset.tab as typeof ui.tab;
      if (ui.tab === 'history') void loadCmdHistory();
      return rerender();
    }
    if ((b = at('[data-panel]'))) {
      ui.panel = b.dataset.panel as 'test' | 'help';
      return rerender();
    }
    if (at('[data-closepanel]')) return ((ui.panel = null), rerender());
    if (at('[data-save]')) return void save();
    if (at('[data-cancel]')) {
      if (ui.base) ui.draft = clone(ui.base.config);
      ui.conflict = null;
      ui.error = '';
      return rerender();
    }
    if (at('[data-conflictok]')) return ((ui.conflict = null), rerender());
    if ((b = at('[data-create]')))
      return void create(b.dataset.create === 'on');
    if (at('[data-remove]') && ui.base) {
      const c = ui.base;
      if (!confirm(`Supprimer !${c.config.name} ? Son historique est gardé.`))
        return;
      void api(`/api/commands/${c.command_id}/delete`, {
        expected_version: c.version,
      })
        .then(async () => {
          await loadList();
          Object.assign(ui, { view: 'lib', base: null, draft: null });
          toast(`!${c.config.name} supprimée`);
          render();
        })
        .catch((err: unknown) => ((ui.error = errText(err)), rerender()));
      return;
    }
    if (at('[data-reset]') && ui.base) {
      const c = ui.base;
      if (!confirm('Remettre les réglages d’origine du module ?')) return;
      void api(`/api/commands/${c.command_id}/reset`, {
        expected_version: c.version,
      })
        .then(async () => {
          await loadList();
          open(c.command_id);
          toast('Réglages d’origine remis');
          render();
        })
        .catch((err: unknown) => ((ui.error = errText(err)), rerender()));
      return;
    }
    // --- categories
    if ((b = at('[data-catlook]')))
      return (
        (ui.catEdit =
          ui.catEdit === b.dataset.catlook ? null : b.dataset.catlook!),
        rerender()
      );
    if ((b = at('[data-caticon]'))) {
      const [id, icon] = b.dataset.caticon!.split('|');
      return void cat(`/api/commands/categories/${id}/update`, { icon });
    }
    if ((b = at('[data-catcolor]'))) {
      const [id, color] = b.dataset.catcolor!.split('|');
      return void cat(`/api/commands/categories/${id}/update`, { color });
    }
    if ((b = at('[data-catmove]'))) {
      const [id, delta] = b.dataset.catmove!.split('|');
      const ids = cats().map((k) => k.category_id);
      const i = ids.indexOf(id!);
      const j = i + Number(delta);
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      return void cat('/api/commands/categories/order', { order: ids });
    }
    if ((b = at('[data-catdel]'))) {
      const k = cats().find((x) => x.category_id === b!.dataset.catdel);
      const n = (ui.list?.commands ?? []).filter(
        (c) => c.config.category === k?.category_id,
      ).length;
      if (
        !k ||
        !confirm(
          `Supprimer la catégorie « ${k.name} » ?${n ? ` Ses ${n} commande(s) passeront dans « Sans catégorie ».` : ''}`,
        )
      )
        return;
      return void cat(
        `/api/commands/categories/${k.category_id}/delete`,
        {},
        `Catégorie « ${k.name} » supprimée`,
      );
    }
    if (at('[data-catadd]')) {
      const input = root.querySelector<HTMLInputElement>('[data-catnew]');
      const name = input?.value.trim() ?? '';
      if (!name) return input?.focus();
      const used = cats().map((k) => k.color);
      const color = COLORS.find((x) => !used.includes(x)) ?? COLORS[0]!;
      return void cat(
        '/api/commands/categories',
        { name, icon: 'folder', color },
        `Catégorie « ${name} » ajoutée`,
      );
    }
    // --- rights
    if ((b = at('[data-rightsave]'))) {
      const role = b.dataset.rightsave as 'moderator' | 'supermod';
      void api('/api/commands/rights', {
        role,
        expected_version: ui.rights![role].version,
        rights: ui.rightsDraft![role],
      })
        .then(async () => {
          ui.rightsMsg = 'Droits enregistrés.';
          await loadRights();
        })
        .catch(async (err: unknown) => {
          const er = err as ApiError;
          ui.rightsMsg =
            er.status === 409
              ? '!Modifiés ailleurs entre-temps : les droits actuels sont rechargés, refais ton changement.'
              : `!${errText(err)}`;
          if (er.status === 409) await loadRights();
          else rerender();
        });
      return;
    }
    // --- test
    if ((b = at('[data-tfollow]')))
      return (
        (ui.test.follower = b.dataset.tfollow as typeof ui.test.follower),
        rerender()
      );
    if (at('[data-trun]') && ui.base) {
      const t = ui.test;
      t.busy = true;
      t.error = '';
      rerender();
      const message =
        root.querySelector<HTMLInputElement>('[data-tmsg]')?.value ??
        example(ui.base.config);
      t.message = message;
      void api<Decision>('/api/commands/test', {
        message,
        viewer: {
          id: t.id,
          login: t.login.toLowerCase(),
          display_name: t.display_name,
          role: t.role,
          badges: t.badges,
          ...(t.follower === 'unknown'
            ? {}
            : { follower: t.follower === 'true' }),
        },
      })
        .then((r) => (t.res = r))
        .catch((err: unknown) => (t.error = errText(err)))
        .finally(() => ((t.busy = false), rerender()));
      return;
    }
    // --- look
    if (at('[data-look]')) return ((ui.look = !ui.look), rerender());
    if (d && (b = at('[data-icon]')))
      return (
        (d.appearance = { ...d.appearance, icon: b.dataset.icon! }),
        rerender()
      );
    if (d && (b = at('[data-color]')))
      return (
        (d.appearance = { ...d.appearance, color: b.dataset.color! }),
        rerender()
      );
    if (!d) return;
    // --- form controls
    if ((b = at('[data-pop]')))
      return (
        (ui.pop = ui.pop === b.dataset.pop ? null : b.dataset.pop!),
        rerender()
      );
    if ((b = at('[data-rmode]'))) {
      const mode = b.dataset.rmode as CmdConfig['reply']['mode'];
      d.reply = {
        ...d.reply,
        mode,
        ...(mode === 'reply' ? { to: 'none' } : {}),
      };
      if (d.reply.to !== 'user') delete d.reply.to_login;
      return rerender();
    }
    if ((b = at('[data-to]'))) {
      const to = b.dataset.to as CmdConfig['reply']['to'];
      d.reply = { ...d.reply, to };
      if (to !== 'user') {
        delete d.reply.to_login;
        ui.pop = null;
      }
      return rerender();
    }
    if ((b = at('[data-insert]'))) {
      const el = root.querySelector<HTMLTextAreaElement>('[data-rtext]');
      const s = el?.selectionStart ?? d.reply.text.length;
      const r = insertAt(
        d.reply.text,
        s,
        el?.selectionEnd ?? s,
        b.dataset.insert!,
      );
      d.reply = { ...d.reply, text: r.text };
      ui.pop = null;
      render();
      const ta = root.querySelector<HTMLTextAreaElement>('[data-rtext]');
      ta?.focus();
      ta?.setSelectionRange(r.caret, r.caret);
      return;
    }
    if ((b = at('[data-grp]'))) {
      const k = b.dataset.grp as CmdConfig['audience']['groups'][number];
      const g = d.audience.groups;
      d.audience = {
        ...d.audience,
        groups: g.includes(k)
          ? g.filter((x) => x !== k)
          : k === 'everyone'
            ? ['everyone']
            : [...g.filter((x) => x !== 'everyone'), k],
      };
      return rerender();
    }
    if (at('[data-cdon]'))
      return (
        (d.cooldown = { ...d.cooldown, enabled: !d.cooldown.enabled }),
        (ui.cdCustom = false),
        rerender()
      );
    if ((b = at('[data-cdpreset]'))) {
      const s = Number(b.dataset.cdpreset);
      d.cooldown = { ...d.cooldown, seconds: s, unit: unitOf(s) };
      ui.cdCustom = false;
      return rerender();
    }
    if (at('[data-cdcustom]')) return ((ui.cdCustom = true), rerender());
    if ((b = at('[data-cdscope]')))
      return (
        (d.cooldown = {
          ...d.cooldown,
          scope: b.dataset.cdscope as 'viewer' | 'global',
        }),
        rerender()
      );
    if (at('[data-mxon]'))
      return (
        (d.quota = { ...d.quota, enabled: !d.quota.enabled }),
        rerender()
      );
    if ((b = at('[data-mxscope]')))
      return (
        (d.quota = {
          ...d.quota,
          scope: b.dataset.mxscope as 'viewer' | 'global',
        }),
        rerender()
      );
    if (at('[data-listed]')) return ((d.listed = !d.listed), rerender());
    if ((b = at('[data-when]')))
      return ((d.when = b.dataset.when as CmdConfig['when']), rerender());
    if ((b = at('[data-chipdel]'))) {
      const [k, v] = b.dataset.chipdel!.split('|');
      if (k === 'alias') d.aliases = d.aliases.filter((a) => `!${a}` !== v);
      else
        d.audience = {
          ...d.audience,
          [k as 'allow']: d.audience[k as 'allow'].filter((x) => x !== v),
        };
      return rerender();
    }
    if (at('[data-adv]')) return ((ui.adv = !ui.adv), rerender());
    if ((b = at('[data-refuse]')))
      return (
        (d.refuse = {
          ...d.refuse,
          mode: b.dataset.refuse as CmdConfig['refuse']['mode'],
        }),
        rerender()
      );
    if (at('[data-argadd]'))
      return (
        (d.args = [
          ...d.args,
          { name: `arg${d.args.length + 1}`, type: 'mention', required: true },
        ]),
        rerender()
      );
    if ((b = at('[data-argdel]')))
      return (
        (d.args = d.args.filter((_, i) => i !== Number(b!.dataset.argdel))),
        rerender()
      );
    if ((b = at('[data-argtype]'))) {
      const [i, type] = b.dataset.argtype!.split(':');
      d.args = d.args.map((a, k) =>
        k === Number(i) ? { ...a, type: type as 'mention' } : a,
      );
      return rerender();
    }
    if (at('[data-addchat]')) {
      d.actions = [
        ...d.actions,
        {
          id: crypto.randomUUID(),
          type: 'chat',
          v: 1,
          on_error: 'continue',
          mode: 'normal',
          text: '',
          to: 'none',
        },
      ];
      return rerender();
    }
    if ((b = at('[data-adel]')))
      return (
        (d.actions = d.actions.filter((a) => a.id !== b!.dataset.adel)),
        rerender()
      );
    if ((b = at('[data-amove]'))) {
      const [id, delta] = b.dataset.amove!.split(':');
      const list = [...d.actions];
      const i = list.findIndex((a) => a.id === id);
      const j = i + Number(delta);
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j]!, list[i]!];
      d.actions = list;
      return rerender();
    }
  });

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const d = D();
    if (t.matches('[data-q]')) return ((ui.q = t.value), rerender());
    if (t.matches('[data-tfield]'))
      return void ((ui.test as unknown as Record<string, string>)[
        t.dataset.tfield!
      ] = t.value);
    if (t.matches('[data-tmsg]')) return void (ui.test.message = t.value);
    if (!d) return;
    if (t.matches('[data-name]')) return ((d.name = word(t.value)), rerender());
    if (t.matches('[data-desc]'))
      return ((d.description = t.value), rerender());
    if (t.matches('[data-rtext]'))
      return ((d.reply = { ...d.reply, text: t.value }), rerender());
    if (t.matches('[data-tologin]'))
      return (
        (d.reply = { ...d.reply, to_login: word(t.value) || undefined }),
        rerender()
      );
    if (t.matches('[data-refusetext]'))
      return ((d.refuse = { ...d.refuse, text: t.value }), rerender());
    if (t.matches('[data-atext]')) {
      d.actions = d.actions.map((a) =>
        a.id === t.dataset.atext && a.type === 'chat'
          ? { ...a, text: t.value }
          : a,
      );
      return rerender();
    }
    if (t.matches('[data-arg]')) {
      d.args = d.args.map((a, i) =>
        i === Number(t.dataset.arg)
          ? { ...a, name: t.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }
          : a,
      );
      return rerender();
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const d = D();
    if (t.matches('[data-cat]')) return ((ui.cat = t.value), rerender());
    if (t.matches('[data-tpreset]')) {
      const v = TEST_VIEWERS[Number(t.value)]!;
      Object.assign(ui.test, {
        preset: Number(t.value),
        ...clone(v),
        res: null,
      });
      return rerender();
    }
    if (t.matches('[data-tfield]'))
      return void ((ui.test as unknown as Record<string, string>)[
        t.dataset.tfield!
      ] = t.value);
    if (t.matches('[data-tbadge]')) {
      const b = t.dataset.tbadge!;
      ui.test.badges = t.checked
        ? [...ui.test.badges, b]
        : ui.test.badges.filter((x) => x !== b);
      return rerender();
    }
    if (t.matches('[data-catname]')) {
      const id = t.dataset.catname!;
      const k = cats().find((x) => x.category_id === id);
      if (k && t.value.trim() && t.value.trim() !== k.name)
        void cat(`/api/commands/categories/${id}/update`, {
          name: t.value.trim(),
        });
      return;
    }
    if (t.matches('[data-right]') && ui.rightsDraft) {
      const [role, k] = t.dataset.right!.split(':') as [
        'moderator' | 'supermod',
        keyof CmdTeamRights,
      ];
      const r = ui.rightsDraft[role] as unknown as Record<string, unknown>;
      const v = r[k];
      r[k] =
        typeof v === 'boolean'
          ? t.checked
          : { ...(v as object), allowed: t.checked };
      ui.rightsMsg = '';
      return rerender();
    }
    if (t.matches('[data-rightv]') && ui.rightsDraft) {
      const [role, path] = t.dataset.rightv!.split(':') as [
        'moderator' | 'supermod',
        string,
      ];
      const [k, sub] = path.split('.') as ['cooldown' | 'volume', string];
      (ui.rightsDraft[role][k] as unknown as Record<string, number>)[sub] =
        Math.max(0, Math.round(Number(t.value) || 0));
      return rerender();
    }
    if (!d) return;
    if (t.matches('[data-category]'))
      return ((d.category = t.value || null), rerender());
    if (t.matches('[data-cdval]') || t.matches('[data-cdunit]')) {
      const box = t.closest('.lrow__f')!;
      const unit =
        (box.querySelector<HTMLSelectElement>('[data-cdunit]')!.value as
          's' | 'min' | 'h') ?? 's';
      const n = Math.max(
        1,
        Math.round(
          Number(box.querySelector<HTMLInputElement>('[data-cdval]')!.value) ||
            1,
        ),
      );
      const seconds = Math.min(86_400, n * { s: 1, min: 60, h: 3600 }[unit]);
      d.cooldown = {
        ...d.cooldown,
        seconds,
        unit:
          seconds === n * { s: 1, min: 60, h: 3600 }[unit]
            ? unit
            : unitOf(seconds),
      };
      return rerender();
    }
    if (t.matches('[data-mxcount]'))
      return (
        (d.quota = {
          ...d.quota,
          max: Math.min(10_000, Math.max(1, Math.round(Number(t.value) || 1))),
        }),
        rerender()
      );
    if (t.matches('[data-mxper]'))
      return (
        (d.quota = {
          ...d.quota,
          window: t.value as CmdConfig['quota']['window'],
        }),
        rerender()
      );
    if (t.matches('[data-argreq]')) {
      d.args = d.args.map((a, i) =>
        i === Number(t.dataset.argreq) ? { ...a, required: t.checked } : a,
      );
      return rerender();
    }
    if (t.matches('[data-replyfirst]'))
      return ((d.reply_first = t.checked), rerender());
    if (t.matches('[data-teamlock]'))
      return ((d.team_lock = t.checked), rerender());
    if (t.matches('[data-amode]')) {
      d.actions = d.actions.map((a) =>
        a.id === t.dataset.amode && a.type === 'chat'
          ? { ...a, mode: t.value as 'normal' }
          : a,
      );
      return rerender();
    }
    if (t.matches('[data-aerr]')) {
      d.actions = d.actions.map((a) =>
        a.id === t.dataset.aerr ? { ...a, on_error: t.value as 'stop' } : a,
      );
      return rerender();
    }
  });

  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLInputElement;
    const typing = t.matches('input, textarea, select');
    if (e.key === 'Escape') {
      if (ui.panel) return ((ui.panel = null), rerender());
      if (ui.pop || ui.look || ui.catEdit)
        return (
          (ui.pop = null),
          (ui.look = false),
          (ui.catEdit = null),
          rerender()
        );
    }
    if (e.key === '/' && !typing && ui.view === 'lib') {
      e.preventDefault();
      return root.querySelector<HTMLInputElement>('[data-q]')?.focus();
    }
    if (
      (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
      (t.matches('.lr') || t.matches('[data-q]'))
    ) {
      e.preventDefault();
      const r = [...root.querySelectorAll<HTMLElement>('.lr')];
      const i = t.matches('[data-q]') ? -1 : r.indexOf(t);
      return r[
        Math.max(
          0,
          Math.min(r.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)),
        )
      ]?.focus();
    }
    if (e.key === 'Enter' && t.matches('.lr')) return t.click();
    if (e.key === 'Enter' && t.matches('[data-catnew]'))
      return root.querySelector<HTMLElement>('[data-catadd]')?.click();
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && ui.view === 'cmd') {
      e.preventDefault();
      return void (dirty() && save());
    }
    const d = D();
    if (e.key === 'Enter' && d && t.matches('[data-chipin]')) {
      e.preventDefault();
      const k = t.dataset.chipin!;
      ui.aliasErr = '';
      if (k === 'alias') {
        const w = word(t.value);
        const words = (ui.list?.commands ?? [])
          .filter((c) => c.command_id !== ui.base?.command_id)
          .flatMap((c) => [c.config.name, ...c.config.aliases]);
        const res = ui.list?.reserved_words.find((x) => x.word === w);
        if (!w) ui.aliasErr = 'Écris un alias';
        else if (w === d.name || d.aliases.includes(w))
          ui.aliasErr = `!${w} est déjà utilisé par cette commande`;
        else if (res)
          ui.aliasErr = `!${w} appartient au module ${res.module === 'raffle' ? 'Tombola' : res.module}`;
        else if (words.includes(w))
          ui.aliasErr = `!${w} lance déjà une autre commande`;
        else d.aliases = [...d.aliases, w];
      } else {
        const v = word(t.value);
        if (v) {
          const other = k === 'allow' ? 'deny' : 'allow';
          d.audience = {
            ...d.audience,
            [k]: d.audience[k as 'allow'].includes(v)
              ? d.audience[k as 'allow']
              : [...d.audience[k as 'allow'], v],
            [other]: d.audience[other].filter((x) => x !== v),
          };
        }
      }
      rerender();
      root.querySelector<HTMLInputElement>(`[data-chipin="${k}"]`)?.focus();
    }
  });

  // ------------------------------------------------------------------ lifecycle
  let timer: number | undefined;
  return {
    setVisible(v: boolean) {
      visibleTab = v;
      clearInterval(timer);
      if (!v) return;
      void refresh();
      // Light refresh while visible: runtime state, and the list when it is shown (never a draft).
      timer = window.setInterval(() => {
        if (!visibleTab) return;
        void loadRuntime().then(async () => {
          if (ui.view === 'lib') await loadList();
          if (!root.querySelector(':focus') || ui.view === 'lib') rerender();
        });
      }, 5000);
    },
  };
}
