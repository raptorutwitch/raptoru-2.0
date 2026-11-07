import type { CmdConfig, CmdTeamRights } from '@raptoru/schemas';
import {
  blank,
  type Category,
  categoryOf,
  changes,
  type CommandItem,
  cooldownShort,
  counts,
  example,
  groups,
  insertAt,
  type ListResponse,
  type ListUi,
  quotaShort,
  reapply,
  SAVE_ERROR,
  stateOf,
  TO,
  unitOf,
  visible,
  whoShort,
  word,
} from '../commands-model.js';
import {
  ago,
  confirmBox,
  errText,
  esc,
  fmt,
  hhmm,
  ic,
  keyed,
  menu,
  page,
  panelBtn,
  patch,
  poller,
  pop,
  stateChip,
  toast,
} from '../ds/ds.js';
import { type ApiError, getJson, postJson, tryGetJson } from '../http.js';
import {
  type Decision,
  newTester,
  previewItems,
  TEST_VIEWERS,
  verdictHtml,
  viewerBtn,
  viewerForm,
} from './commands-chat.js';
import {
  bannersHtml,
  type EditCtx,
  headHtml,
  lookHtml,
  mirrorHtml,
  modName,
  replyHtml,
  RULE_POPS,
  rulesHtml,
  stepsHtml,
  whoDid,
} from './commands-editor.js';
import { openJournal } from './commands-journal.js';
import { COLORS, lookIc } from './commands-look.js';
import {
  catsGrp,
  helpGrp,
  outputGrp,
  type Rights,
  type RightsDraft,
  rightsGrp,
  type Role,
  type Runtime,
} from './commands-team.js';

// Commandes du chat (Commands V2). À gauche la bibliothèque, au centre l'éditeur, à droite le faux chat qui réagit pendant qu'on
// écrit. Tout passe par le relais Studio vers le Core : il valide chaque changement (`expected_version`), décide de chaque test,
// garde catégories, droits et journal. Le brouillon reste local jusqu'à « Enregistrer » ; un relevé ne l'écrase jamais.

const FAV_KEY = 'raptoru-commands-fav';
const clone = <T>(x: T): T => structuredClone(x);
type Sort = 'name' | 'who' | 'limit' | 'uses';
const SORTS: [Sort, string][] = [
  ['name', 'Par nom'],
  ['who', 'Par accès'],
  ['limit', 'Par délai'],
  ['uses', 'Les plus utilisées'],
];
const FILTERS: [ListUi['side'], string][] = [
  ['all', 'Toutes'],
  ['fav', 'Favoris'],
  ['check', 'À vérifier'],
  ['off', 'Coupées'],
  ['hidden', 'Cachées'],
];

/** Formulaire complet d'une nouvelle commande (le Core ne complète rien de plus et valide tout). */
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

/** Réécrit `el` en gardant le champ où l'on écrit et sa sélection. */
function keep(el: HTMLElement, fn: () => void) {
  const a = document.activeElement as HTMLInputElement | null;
  if (!a || !el.contains(a)) return fn();
  const attr = [...a.attributes].find((x) => x.name.startsWith('data-'));
  const sel = attr ? `[${attr.name}="${CSS.escape(attr.value)}"]` : null;
  const [s, e] = [a.selectionStart ?? null, a.selectionEnd ?? null];
  fn();
  if (a.isConnected) return;
  const next = sel ? el.querySelector<HTMLInputElement>(sel) : null;
  next?.focus({ preventScroll: true });
  try {
    if (s !== null) next?.setSelectionRange(s, e);
  } catch {
    /* pas un champ de texte */
  }
}

export function mountCommandsPage(root: HTMLElement) {
  const p = page(root, { title: 'Commandes', mod: 'commands', panel: true });
  p.body.innerHTML = `<div class="cdx">
    <aside class="cdx-lib" aria-label="Bibliothèque de commandes">
      <label class="d-fld cdx-find">${ic('search')}<input type="search" data-q placeholder="Chercher une commande" aria-label="Chercher un nom ou un alias" spellcheck="false"></label>
      <div class="cdx-filters" data-z="filters"></div>
      <div class="cdx-list d-scroll" data-z="list"></div>
      <div data-z="reserved"></div>
    </aside>
    <section class="cdx-edit" aria-label="Éditeur">
      <div class="cdx-sheet d-scroll" data-z="sheet">
        <header class="cdx-head" data-z="head"></header>
        <div data-z="ban"></div>
        <div class="cdx-sec" data-z="reply"></div>
        <div class="cdx-sec" data-z="steps"></div>
        <div class="cdx-sec" data-z="rules"></div>
      </div>
      <div class="d-empty cdx-none" data-z="none" hidden></div>
      <footer class="cdx-bar" data-z="bar"></footer>
    </section>
    <section class="cdx-chat" aria-label="Aperçu dans le chat">
      <header class="cdx-chath"><span class="d-lb">Dans le chat</span><span class="d-tag off" data-z="kind">Exemple</span><span class="d-sp"></span><span data-z="viewer"></span></header>
      <div class="cdx-feed d-scroll" data-z="feed"><div data-z="lines"></div><div data-z="verdict"></div></div>
      <form class="cdx-compose" data-tform><label class="d-fld">${ic('chat')}<input type="text" data-tmsg aria-label="Message du viewer" maxlength="500" spellcheck="false" autocomplete="off"></label><button class="d-btn pri sm" data-trun>${ic('play')}Tester</button></form>
      <p class="cdx-chatnote" data-z="note"></p>
    </section>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  const search = p.body.querySelector<HTMLInputElement>('[data-q]')!;
  const composer = p.body.querySelector<HTMLInputElement>('[data-tmsg]')!;
  const trun = p.body.querySelector<HTMLButtonElement>('[data-trun]')!;

  const S = {
    list: null as ListResponse | null,
    loadError: '',
    runtime: null as Runtime | null,
    runtimeRead: false,
    side: 'all' as ListUi['side'],
    cat: 'all',
    group: true,
    q: '',
    sort: { key: 'name' as Sort, dir: 1 },
    /** La commande ouverte ; `isNew` : une création, sans `base`. */
    id: null as string | null,
    isNew: false,
    base: null as CommandItem | null,
    draft: null as CmdConfig | null,
    conflict: null as EditCtx['conflict'],
    saving: false,
    savedAt: '',
    error: '',
    aliasErr: '',
    cdCustom: false,
    t: newTester(),
    rights: null as Rights | null,
    rightsDraft: null as RightsDraft | null,
    rightsMsg: '',
  };
  let visibleNow = false;
  let fav = new Set<string>();
  try {
    fav = new Set(
      JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[],
    );
  } catch {
    /* sans stockage : favoris non retenus */
  }
  const saveFav = () => {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...fav]));
    } catch {
      /* ignoré */
    }
  };

  const cats = (): Category[] => S.list?.categories ?? [];
  const all = () => S.list?.commands ?? [];
  const cur = () => all().find((c) => c.command_id === S.id) ?? null;
  const dirty = () =>
    S.isNew
      ? !!S.draft && !!(S.draft.name || S.draft.reply.text.trim())
      : !!S.base &&
        !!S.draft &&
        Object.keys(changes(S.base.config, S.draft)).length > 0;
  const ctx = (): EditCtx => ({
    d: S.draft!,
    base: S.base,
    cats: cats(),
    fav: !!S.id && fav.has(S.id),
    aliasErr: S.aliasErr,
    cdCustom: S.cdCustom,
    conflict: S.conflict,
  });
  const listUi = (): ListUi => ({
    side: S.side,
    cat: S.cat,
    group: S.group,
    q: S.q,
  });

  /** Un refus du Core à l'enregistrement, avec le mot en cause et ses raisons. */
  const saveErr = (e: unknown) => {
    const x = e as ApiError;
    const b = x.details ?? {};
    const issues = Array.isArray(b.issues)
      ? ` : ${(b.issues as string[]).slice(0, 3).join(' · ')}`
      : '';
    const w = b.word
      ? ` (!${String(b.word)}${b.command ? ` → !${String(b.command)}` : b.module ? ` → ${String(b.module)}` : ''})`
      : '';
    return `${SAVE_ERROR[x.code] ?? errText(e)}${w}${issues}`;
  };

  // --- Lectures ---------------------------------------------------------------------------------------------------------
  async function loadList() {
    try {
      S.list = await getJson<ListResponse>('/api/commands');
      S.loadError = '';
      const now = cur();
      if (S.base) {
        if (!now) {
          // Supprimée ailleurs : un brouillon en cours reste à l'écran, l'enregistrement dira le refus du Core.
          if (!dirty()) close();
        } else if (!dirty()) {
          S.base = now;
          S.draft = clone(now.config);
        } else
          S.base = {
            ...now,
            config: S.base.config,
            version: S.base.version,
          };
      }
      if (!S.draft && !S.isNew) {
        const first = shownIds()[0];
        if (first) open(first);
      }
    } catch (e) {
      S.loadError = errText(e);
    }
  }
  async function loadRuntime() {
    S.runtime = await tryGetJson<Runtime>('/api/lab-chat/output');
    S.runtimeRead = true;
  }
  async function loadRights() {
    try {
      S.rights = await getJson<Rights>('/api/commands/rights');
      S.rightsDraft = {
        moderator: clone(S.rights.moderator.rights),
        supermod: clone(S.rights.supermod.rights),
      };
    } catch (e) {
      S.rightsMsg = `!${errText(e)}`;
    }
    paintPanel();
  }
  const tick = poller(async () => {
    await Promise.all([loadList(), loadRuntime()]);
    paintHead();
    paintLib();
    paintPanel();
    // Un brouillon en cours ne bouge pas sous la main ; sans brouillon, l'éditeur suit le Core.
    if (!dirty()) paintEditor();
  }, 5000);

  // --- Bibliothèque -----------------------------------------------------------------------------------------------------
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
    }[S.sort.key];
    return rows.sort(
      (a, b) =>
        by(a, b) * S.sort.dir || a.c.config.name.localeCompare(b.c.config.name),
    );
  };
  const rows = () => sortRows(visible(all(), cats(), listUi(), fav));
  const shownIds = () =>
    groups(rows(), cats(), listUi()).flatMap(([, l]) =>
      l.map((x) => x.c.command_id),
    );
  const rowHtml = (c: CommandItem, via: string | null) => {
    const cfg = c.config;
    const st = stateOf(c);
    const flag = (icon: 'lock' | 'eye' | 'layers', tip: string) =>
      `<span class="cdx-flag" title="${esc(tip)}" aria-label="${esc(tip)}">${ic(icon)}</span>`;
    const sel = c.command_id === S.id;
    const q = cfg.quota;
    return `<div class="cdx-li ${cfg.enabled ? '' : 'off'} ${sel ? 'on d-vf' : ''}" data-open="${c.command_id}" tabindex="0" role="button" aria-current="${sel}">
      <span class="cdx-tile" style="--c:${esc(cfg.appearance.color)}">${lookIc(cfg.appearance.icon)}</span>
      <span class="cdx-li__t"><b>!${esc(cfg.name)}</b>${via ? `<em>via !${esc(via)}</em>` : ''}${st.key !== 'ok' && st.key !== 'off' ? `<span class="d-tag ${st.tone === 'bad' ? 'bad' : 'warn'}" title="${esc(st.why)}">${esc(st.label)}</span>` : ''}</span>
      <small class="cdx-li__m" title="${esc(`${whoShort(cfg.audience)} · ${cooldownShort(cfg.cooldown)}${q.enabled ? ` · max ${quotaShort(q)}` : ''}`)}">${esc(whoShort(cfg.audience))} · ${esc(cooldownShort(cfg.cooldown))}${c.uses_30d ? ` · ${fmt(c.uses_30d)} ×` : ''}</small>
      <span class="cdx-li__e">${c.kind === 'system' ? flag('layers', `Commande du module ${modName(c.owner_module ?? '')}`) : ''}${cfg.team_lock ? flag('lock', 'Verrouillée pour l’équipe') : ''}${cfg.listed ? '' : flag('eye', 'Cachée de la liste publique')}
        <button type="button" class="d-ib cdx-star ${fav.has(c.command_id) ? 'on' : ''}" data-fav="${c.command_id}" aria-label="${fav.has(c.command_id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${ic('star')}</button>
        <span class="d-sw" title="${cfg.enabled ? 'Activée' : 'Coupée'}"><input type="checkbox" role="switch" data-toggle="${c.command_id}" ${cfg.enabled ? 'checked' : ''} ${c.locked_fields.includes('enabled') ? 'disabled' : ''} aria-label="Activer !${esc(cfg.name)}"><i></i></span></span></div>`;
  };
  function paintLib() {
    const n = counts(all(), cats(), listUi(), fav);
    const none = all().filter(
      (c) => categoryOf(c, cats()).category_id === '',
    ).length;
    const k = (id: string) =>
      all().filter((c) => c.config.category === id).length;
    patch(
      z('filters'),
      `<div class="cdx-chipline">${FILTERS.filter(
        ([f]) => f === 'all' || n[f] > 0 || S.side === f,
      )
        .map(
          ([f, l]) =>
            `<button type="button" class="cdx-f ${S.side === f ? 'on' : ''} ${f === 'check' ? 'warn' : ''}" data-side="${f}" aria-pressed="${S.side === f}">${l}<i>${n[f]}</i></button>`,
        )
        .join('')}</div>
      <div class="cdx-line"><label class="d-fld"><select data-cat aria-label="Catégorie"><option value="all" ${S.cat === 'all' ? 'selected' : ''}>Toutes les catégories</option>${cats()
        .map(
          (f) =>
            `<option value="${esc(f.category_id)}" ${S.cat === f.category_id ? 'selected' : ''}>${esc(f.name)} (${k(f.category_id)})</option>`,
        )
        .join(
          '',
        )}${none ? `<option value="none" ${S.cat === 'none' ? 'selected' : ''}>Sans catégorie (${none})</option>` : ''}</select></label>
      <button type="button" class="d-ib ${S.group ? 'is-on' : ''}" data-group aria-pressed="${S.group}" aria-label="${S.group ? 'Ne plus grouper par catégorie' : 'Grouper par catégorie'}" title="Grouper par catégorie">${ic('layers')}</button>
      <button type="button" class="d-ib" data-sort aria-label="Trier" title="Trier : ${esc(SORTS.find((s) => s[0] === S.sort.key)![1])}">${ic('filter')}</button></div>`,
    );
    const items = groups(rows(), cats(), listUi()).flatMap(([f, l]) => [
      ...(f
        ? [
            {
              key: `g:${f.category_id}`,
              html: `<h4 class="cdx-gh" style="--c:${esc(f.color)}">${lookIc(f.icon)}<span>${esc(f.name)}</span><i>${l.length}</i></h4>`,
            },
          ]
        : []),
      ...l.map((x) => ({
        key: x.c.command_id,
        html: rowHtml(x.c, x.via),
      })),
    ]);
    const empty = !S.list
      ? S.loadError
        ? `<div class="d-empty">${esc(S.loadError)}<br><button type="button" class="d-btn sm cdx-retry" data-retry>Réessayer</button></div>`
        : '<div class="d-skel" style="height:220px"></div>'
      : all().length
        ? `<div class="d-empty">Aucune commande${S.q ? ` pour « ${esc(S.q)} »` : ' ici'}.</div>`
        : '<div class="d-empty">Aucune commande pour l’instant.</div>';
    keyed(z('list'), items, empty);
    const res = S.list?.reserved_words ?? [];
    patch(
      z('reserved'),
      res.length
        ? `<details class="d-acc cdx-res"><summary>${ic('lock')}Mots gardés par les modules (${res.length})</summary><div class="d-tags">${res.map((w) => `<span class="d-tag off" title="${esc(modName(w.module))}">!${esc(w.word)}</span>`).join('')}</div></details>`
        : '',
    );
  }

  // --- En-tête, éditeur, chat ---------------------------------------------------------------------------------------------
  function paintHead() {
    const r = S.runtime;
    patch(
      p.state,
      !S.list
        ? stateChip(S.loadError ? 'r' : 'w', S.loadError || 'Lecture…')
        : !S.runtimeRead || !r
          ? stateChip('off', 'Sortie chat inconnue')
          : !r.enabled
            ? stateChip('off', 'Rien n’est envoyé dans le chat')
            : r.write_scope === false
              ? stateChip('w', 'Écriture non autorisée pour le bot')
              : r.executor_absent
                ? stateChip('w', 'Réponses en attente : bot absent')
                : stateChip('live', 'Réponses envoyées dans le chat'),
    );
    patch(
      p.actions,
      `<button type="button" class="d-btn ghost" data-journal>${ic('hist')}Journal</button><button type="button" class="d-btn pri" data-new>${ic('plus')}Nouvelle commande</button>${panelBtn(p.panel.isOpen())}`,
    );
  }
  function paintBar() {
    const c = S.base;
    const d = S.draft;
    if (!d) return patch(z('bar'), '');
    if (S.isNew) {
      const nm = word(d.name);
      const block = !nm
        ? 'Donne un nom'
        : d.reply.mode !== 'silent' && !d.reply.text.trim()
          ? 'Écris la réponse'
          : '';
      return patch(
        z('bar'),
        `<span class="cdx-st ${block || S.error ? 'warn' : ''}">${S.saving ? 'Création…' : esc(S.error || block || 'Prête')}</span><span class="d-sp"></span><button type="button" class="d-btn ghost" data-discard>Annuler</button><button type="button" class="d-btn" data-create="off" ${block || S.saving ? 'disabled' : ''}>Créer désactivée</button><button type="button" class="d-btn pri" data-create="on" ${block || S.saving ? 'disabled' : ''}>Créer et activer</button>`,
      );
    }
    const dt = dirty();
    patch(
      z('bar'),
      `<span class="cdx-st ${dt || S.error ? 'warn' : ''}">${
        S.saving
          ? 'Enregistrement…'
          : S.error
            ? esc(S.error)
            : dt
              ? 'Pas encore enregistré'
              : S.savedAt
                ? `Enregistrée à ${esc(S.savedAt)}`
                : c
                  ? `À jour · modifiée ${esc(ago(c.updated_at))} par ${esc(whoDid(c.updated_by))}`
                  : ''
      }</span><span class="d-sp"></span>${dt ? '<button type="button" class="d-btn ghost" data-cancel>Annuler</button>' : ''}<button type="button" class="d-btn ${dt ? 'pri' : ''}" data-save ${dt && !S.saving ? '' : 'disabled'}>Enregistrer</button>`,
    );
  }
  /** Ce qui suit la frappe sans toucher au champ où l'on écrit. */
  function paintLive() {
    if (!S.draft) return;
    keep(z('rules'), () => patch(z('rules'), rulesHtml(ctx())));
    paintBar();
    paintChat();
    repaintPop();
  }
  function paintEditor() {
    const on = !!S.draft;
    z('sheet').hidden = !on;
    z('none').hidden = on;
    if (!on) {
      patch(
        z('none'),
        all().length
          ? 'Choisis une commande à gauche.'
          : S.list
            ? `<p>Une commande, c’est un mot dans le chat et ce que le bot répond.</p><button type="button" class="d-btn pri" data-new>${ic('plus')}Créer la première</button>`
            : '',
      );
      patch(z('bar'), '');
      paintChat();
      return;
    }
    const c = ctx();
    for (const [k, html] of [
      ['head', headHtml(c)],
      ['ban', bannersHtml(c)],
      ['reply', replyHtml(c)],
      ['steps', stepsHtml(c)],
    ] as const)
      keep(z(k), () => patch(z(k), html));
    paintLive();
  }
  function paintChat() {
    const d = S.draft;
    const t = S.t;
    composer.disabled = !d;
    trun.disabled = !d || S.isNew || t.busy;
    composer.placeholder = d ? example(d) : '';
    patch(z('viewer'), d ? viewerBtn(t) : '');
    if (!d) {
      z('kind').hidden = true;
      keyed(z('lines'), [], '');
      patch(z('verdict'), '');
      patch(z('note'), '');
      return;
    }
    z('kind').hidden = false;
    keyed(z('lines'), previewItems(d, t));
    patch(z('verdict'), verdictHtml(t));
    const r = S.runtime;
    patch(
      z('note'),
      S.isNew
        ? 'Enregistre la commande pour pouvoir la tester.'
        : dirty()
          ? 'Tester utilise la version enregistrée.'
          : r?.enabled
            ? 'Tester ne fait rien partir, même sortie chat allumée.'
            : 'Tester ne fait rien partir.',
    );
  }
  const paintPanel = () =>
    keep(p.panel.body, () =>
      p.panel.set(
        `${outputGrp(S.runtime)}${catsGrp(cats(), all())}${rightsGrp(S.rights, S.rightsDraft, S.rightsMsg)}${helpGrp()}`,
      ),
    );
  function paintAll() {
    paintHead();
    paintLib();
    paintEditor();
    paintPanel();
  }

  // --- Sélection -----------------------------------------------------------------------------------------------------------
  function resetEdit() {
    Object.assign(S, {
      conflict: null,
      error: '',
      savedAt: '',
      aliasErr: '',
      cdCustom: false,
    });
    const t = newTester();
    // Le viewer choisi reste d'une commande à l'autre ; le message et la décision, non.
    S.t = { ...S.t, message: '', res: null, ran: '', error: t.error };
    composer.value = '';
  }
  function open(id: string) {
    const c = all().find((x) => x.command_id === id);
    if (!c) return;
    Object.assign(S, {
      id,
      isNew: false,
      base: clone(c),
      draft: clone(c.config),
    });
    resetEdit();
  }
  function close() {
    Object.assign(S, { id: null, isNew: false, base: null, draft: null });
    resetEdit();
  }
  const leave = async () =>
    !dirty() ||
    confirmBox({
      title: 'Quitter sans enregistrer ?',
      body: `Tes changements sur ${S.isNew ? 'cette nouvelle commande' : `!${S.base?.config.name}`} seront perdus.`,
      yes: 'Quitter',
      no: 'Rester',
    });

  // --- Actions -------------------------------------------------------------------------------------------------------------
  /** Enregistre le brouillon à la version lue ; un 409 n'écrase jamais personne. */
  async function save() {
    const c = S.base;
    const d = S.draft;
    if (!c || !d || S.saving) return;
    const ch = changes(c.config, d);
    if (!Object.keys(ch).length) return;
    S.saving = true;
    S.error = '';
    paintBar();
    try {
      const out = await postJson<CommandItem>(
        `/api/commands/${c.command_id}/update`,
        { expected_version: c.version, changes: ch },
      );
      await loadList();
      S.base = cur() ?? { ...c, ...out };
      S.draft = clone(S.base.config);
      S.conflict = null;
      S.savedAt = hhmm(new Date().toISOString());
      toast(`!${out.config.name} enregistrée`);
    } catch (e) {
      const err = e as ApiError;
      if (
        err.status === 409 &&
        err.code === 'version_conflict' &&
        err.details?.current
      ) {
        const current = err.details.current as CommandItem;
        const r = reapply(c.config, d, current.config);
        await loadList();
        S.base = cur() ?? current;
        S.draft = r.draft;
        S.conflict = {
          by: current.updated_by,
          version: current.version,
          both: r.both,
        };
      } else S.error = saveErr(e);
    }
    S.saving = false;
    paintAll();
  }
  /** Un seul champ, appliqué tout de suite (l'interrupteur d'une commande). */
  async function quick(c: CommandItem, now: Partial<CmdConfig>) {
    try {
      await postJson(`/api/commands/${c.command_id}/update`, {
        expected_version: c.version,
        changes: now,
      });
      await loadList();
      if (S.base?.command_id === c.command_id) {
        const f = cur()!;
        const draft = S.draft ? { ...S.draft, ...now } : clone(f.config);
        S.base = f;
        S.draft = draft;
      }
    } catch (e) {
      const err = e as ApiError;
      await loadList();
      toast(
        err.status === 409
          ? 'Modifiée ailleurs entre-temps : la liste est relue, recommence.'
          : saveErr(e),
        { bad: true },
      );
      // Refusé : l'interrupteur revient à l'état du Core.
      z('list').replaceChildren();
      delete z('head').dataset.sig;
    }
    paintAll();
  }
  async function create(enabled: boolean) {
    const d = S.draft!;
    S.saving = true;
    S.error = '';
    paintBar();
    try {
      const out = await postJson<CommandItem>('/api/commands', {
        config: { ...d, name: word(d.name), enabled },
      });
      await loadList();
      S.saving = false;
      open(out.command_id);
      toast(`!${out.config.name} créée${enabled ? '' : ' (coupée)'}`);
    } catch (e) {
      S.saving = false;
      S.error = saveErr(e);
    }
    paintAll();
  }
  async function removeCmd() {
    const c = S.base;
    if (!c) return;
    const yes = await confirmBox({
      title: `Supprimer !${c.config.name} ?`,
      body: 'Elle ne répondra plus dans le chat. Son journal est gardé.',
      yes: 'Supprimer',
    });
    if (!yes) return;
    try {
      await postJson(`/api/commands/${c.command_id}/delete`, {
        expected_version: c.version,
      });
      close();
      await loadList();
      toast(`!${c.config.name} supprimée`);
    } catch (e) {
      S.error = saveErr(e);
    }
    paintAll();
  }
  async function resetCmd() {
    const c = S.base;
    if (!c) return;
    const yes = await confirmBox({
      title: 'Remettre les réglages d’origine ?',
      body: `!${c.config.name} revient aux réglages du module ${modName(c.owner_module ?? '')}.`,
      yes: 'Remettre',
    });
    if (!yes) return;
    try {
      await postJson(`/api/commands/${c.command_id}/reset`, {
        expected_version: c.version,
      });
      await loadList();
      open(c.command_id);
      toast('Réglages d’origine remis');
    } catch (e) {
      S.error = saveErr(e);
    }
    paintAll();
  }
  async function cat(path: string, body: object, msg = '') {
    try {
      const out = await postJson<{ categories: Category[] }>(path, body);
      if (S.list) S.list.categories = out.categories;
      await loadList();
      if (msg) toast(msg);
    } catch (e) {
      toast(saveErr(e), { bad: true });
    }
    paintAll();
    repaintPop();
  }
  async function saveRights(role: Role) {
    try {
      await postJson('/api/commands/rights', {
        role,
        expected_version: S.rights![role].version,
        rights: S.rightsDraft![role],
      });
      S.rightsMsg = 'Droits enregistrés.';
      await loadRights();
    } catch (e) {
      const conflict = (e as ApiError).status === 409;
      S.rightsMsg = conflict
        ? '!Modifiés ailleurs entre-temps : les droits actuels sont relus, refais ton changement.'
        : `!${errText(e)}`;
      if (conflict) await loadRights();
      else paintPanel();
    }
  }
  async function runTest() {
    const t = S.t;
    if (!S.base || t.busy) return;
    const message = t.message.trim() || example(S.base.config);
    t.busy = true;
    t.error = '';
    paintChat();
    try {
      t.res = await postJson<Decision>('/api/commands/test', {
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
      });
      t.ran = message;
      t.ranBy = t.display_name;
    } catch (e) {
      t.res = null;
      t.error = saveErr(e);
    }
    t.busy = false;
    paintChat();
    z('feed').scrollTop = z('feed').scrollHeight;
  }

  // --- Réglages sur place --------------------------------------------------------------------------------------------------
  let openPop: { el: HTMLElement; html: () => string } | null = null;
  function repaintPop() {
    const o = openPop;
    if (!o) return;
    keep(o.el, () => patch(o.el, o.html()));
    // Le contenu a pu grandir : la surcouche reste dans la fenêtre.
    const r = o.el.getBoundingClientRect();
    if (r.bottom > innerHeight - 12)
      o.el.style.top = `${Math.max(12, innerHeight - 12 - r.height)}px`;
  }
  function openIn(anchor: HTMLElement, html: () => string, cls = '') {
    const el = pop(anchor, html(), wire, {
      cls: `d-form cdx-pop ${cls}`,
      onClose: () => {
        if (openPop?.el === el) openPop = null;
      },
    });
    openPop = { el, html };
  }
  const openRule = (b: HTMLElement) =>
    openIn(b, () => RULE_POPS[b.dataset.rule!]!(ctx()));
  /** Une modification de structure : l'éditeur et l'aperçu suivent, le brouillon reste local. */
  const edited = () => paintEditor();
  function setTo(to: CmdConfig['reply']['to'], login?: string) {
    const d = S.draft!;
    d.reply = { ...d.reply, to };
    if (to !== 'user') delete d.reply.to_login;
    else if (login !== undefined) d.reply.to_login = word(login) || undefined;
    edited();
  }
  function toMenu(b: HTMLElement) {
    const d = S.draft!;
    menu(
      b,
      'S’adresser à',
      TO.map(([k, l, desc]) => ({
        label: l,
        icon: d.reply.to === k ? ('check' as const) : undefined,
        hint: k === 'target' ? desc : undefined,
        disabled: k === 'target' && !d.args.some((a) => a.type === 'mention'),
        run: () => {
          if (k !== 'user') return setTo(k);
          setTo('user');
          openIn(
            z('reply').querySelector<HTMLElement>('[data-tomenu]') ?? b,
            () =>
              `<h3>Toujours la même personne</h3><label class="d-fld cdx-wide"><input type="text" data-tologin value="${esc(S.draft?.reply.to_login ?? '')}" placeholder="pseudo, sans @" aria-label="Pseudo"></label>`,
          );
        },
      })),
    );
  }
  function moreMenu(b: HTMLElement) {
    const c = S.base!;
    menu(b, '', [
      {
        label: 'Journal de cette commande',
        icon: 'hist',
        run: () => openJournal(all(), c),
      },
      c.kind === 'system' && {
        label: 'Remettre les réglages d’origine',
        icon: 'repeat',
        run: () => void resetCmd(),
      },
      c.kind === 'custom' && {
        label: 'Supprimer la commande',
        icon: 'trash',
        kind: 'bad',
        run: () => void removeCmd(),
      },
    ]);
  }
  function sortMenu(b: HTMLElement) {
    menu(
      b,
      'Trier',
      SORTS.map(([k, l]) => ({
        label: l,
        icon: S.sort.key === k ? ('check' as const) : undefined,
        hint: S.sort.key === k ? (S.sort.dir > 0 ? '' : 'inversé') : undefined,
        run: () => {
          S.sort =
            S.sort.key === k
              ? { key: k, dir: -S.sort.dir }
              : { key: k, dir: 1 };
          paintLib();
        },
      })),
    );
  }
  function addChip(t: HTMLInputElement) {
    const d = S.draft;
    if (!d) return;
    const k = t.dataset.chipin!;
    S.aliasErr = '';
    if (k === 'alias') {
      const w = word(t.value);
      const words = all()
        .filter((c) => c.command_id !== S.base?.command_id)
        .flatMap((c) => [c.config.name, ...c.config.aliases]);
      const res = S.list?.reserved_words.find((x) => x.word === w);
      if (!w) S.aliasErr = 'Écris un alias.';
      else if (w === d.name || d.aliases.includes(w))
        S.aliasErr = `!${w} est déjà utilisé par cette commande.`;
      else if (res) S.aliasErr = `!${w} appartient à ${modName(res.module)}.`;
      else if (words.includes(w))
        S.aliasErr = `!${w} lance déjà une autre commande.`;
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
    edited();
    const again = (
      t.closest('.d-pop') ?? z('head')
    ).querySelector<HTMLInputElement>(`[data-chipin="${k}"]`);
    if (again) {
      again.value = S.aliasErr ? t.value : '';
      again.focus();
    }
  }

  // --- Événements : la page et ses surcouches passent par les mêmes mains ---------------------------------------------------------
  function onClick(e: Event) {
    const t = e.target as HTMLElement;
    const at = <T extends HTMLElement = HTMLElement>(s: string) =>
      t.closest<T>(s);
    let b: HTMLElement | null;
    const d = S.draft;
    if (at('input[data-toggle]')) {
      const c = all().find(
        (x) =>
          x.command_id === at<HTMLElement>('[data-toggle]')!.dataset.toggle,
      );
      if (c) void quick(c, { enabled: !c.config.enabled });
      return;
    }
    if ((b = at('[data-fav]'))) {
      const id = b.dataset.fav!;
      if (!fav.delete(id)) fav.add(id);
      saveFav();
      paintLib();
      if (id === S.id) paintEditor();
      return;
    }
    if (at('[data-new]')) {
      void leave().then((ok) => {
        if (!ok) return;
        Object.assign(S, {
          id: null,
          isNew: true,
          base: null,
          draft: fresh(S.cat !== 'all' && S.cat !== 'none' ? S.cat : null),
        });
        resetEdit();
        paintAll();
        z('head').querySelector<HTMLInputElement>('[data-name]')?.focus();
      });
      return;
    }
    if ((b = at('[data-open]'))) {
      const id = b.dataset.open!;
      if (id === S.id) return;
      void leave().then((ok) => {
        if (!ok) return;
        open(id);
        paintAll();
        z('sheet').scrollTop = 0;
      });
      return;
    }
    if (at('[data-journal]')) return openJournal(all());
    if (at('[data-history]') && S.base) return openJournal(all(), S.base);
    if (at('[data-retry]')) return tick.now();
    if ((b = at('[data-side]'))) {
      S.side = b.dataset.side as ListUi['side'];
      return paintLib();
    }
    if (at('[data-group]')) {
      S.group = !S.group;
      return paintLib();
    }
    if ((b = at('[data-sort]'))) return sortMenu(b);
    if ((b = at('[data-more]'))) return moreMenu(b);
    if (at('[data-save]')) return void save();
    if (at('[data-cancel]')) {
      if (S.base) S.draft = clone(S.base.config);
      S.conflict = null;
      S.error = '';
      return paintEditor();
    }
    if (at('[data-discard]')) {
      close();
      if (shownIds()[0]) open(shownIds()[0]!);
      return paintAll();
    }
    if (at('[data-conflictok]')) {
      S.conflict = null;
      return paintEditor();
    }
    if ((b = at('[data-create]')))
      return void create(b.dataset.create === 'on');
    if (at('[data-reset]')) return void resetCmd();
    if (at('[data-opencats]')) {
      openPop?.el.hidePopover();
      return p.panel.open('catégories');
    }
    if (at('[data-openrights]')) {
      openPop?.el.hidePopover();
      return p.panel.open('droits');
    }
    if ((b = at('[data-rule]'))) return openRule(b);
    if ((b = at('[data-tomenu]'))) return toMenu(b);
    if ((b = at('[data-tviewer]')))
      return openIn(b, () => viewerForm(S.t), 'cdx-pop--viewer');
    // --- apparence
    if ((b = at('[data-look]')) && d)
      return openIn(b, () => lookHtml(S.draft!.appearance));
    if ((b = at('[data-catlook]'))) {
      const id = b.dataset.catlook!;
      return openIn(b, () =>
        lookHtml(
          cats().find((x) => x.category_id === id) ?? cats()[0]!,
          `${id}|`,
        ),
      );
    }
    if ((b = at('[data-icon]'))) {
      const [id, icon] = b.dataset.icon!.includes('|')
        ? b.dataset.icon!.split('|')
        : [null, b.dataset.icon!];
      if (id)
        return void cat(`/api/commands/categories/${id}/update`, { icon });
      if (d) d.appearance = { ...d.appearance, icon: icon! };
      return edited();
    }
    if ((b = at('[data-color]'))) {
      const [id, color] = b.dataset.color!.includes('|')
        ? b.dataset.color!.split('|')
        : [null, b.dataset.color!];
      if (id)
        return void cat(`/api/commands/categories/${id}/update`, { color });
      if (d) d.appearance = { ...d.appearance, color: color! };
      return edited();
    }
    // --- catégories et droits
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
      if (!k) return;
      const n = all().filter((c) => c.config.category === k.category_id).length;
      void confirmBox({
        title: `Supprimer la catégorie « ${k.name} » ?`,
        body: n
          ? `Ses ${n} commande${n > 1 ? 's' : ''} passeront dans « Sans catégorie ».`
          : 'Elle est vide.',
        yes: 'Supprimer',
      }).then((yes) => {
        if (yes)
          void cat(
            `/api/commands/categories/${k.category_id}/delete`,
            {},
            `Catégorie « ${k.name} » supprimée`,
          );
      });
      return;
    }
    if ((b = at('[data-rightsave]')))
      return void saveRights(b.dataset.rightsave as Role);
    // --- test
    if ((b = at('[data-tfollow]'))) {
      S.t.follower = b.dataset.tfollow as typeof S.t.follower;
      S.t.res = null;
      repaintPop();
      return paintChat();
    }
    if (!d) return;
    // --- brouillon
    if ((b = at('[data-rmode]'))) {
      const mode = b.dataset.rmode as CmdConfig['reply']['mode'];
      d.reply = {
        ...d.reply,
        mode,
        ...(mode === 'reply' ? { to: 'none' as const } : {}),
      };
      if (d.reply.to !== 'user') delete d.reply.to_login;
      return edited();
    }
    if ((b = at('[data-insert]'))) {
      const el = z('reply').querySelector<HTMLTextAreaElement>('[data-rtext]');
      const s = el?.selectionStart ?? d.reply.text.length;
      const r = insertAt(
        d.reply.text,
        s,
        el?.selectionEnd ?? s,
        b.dataset.insert!,
      );
      d.reply = { ...d.reply, text: r.text };
      edited();
      const ta = z('reply').querySelector<HTMLTextAreaElement>('[data-rtext]');
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
      return edited();
    }
    if (at('[data-cdon]')) {
      d.cooldown = { ...d.cooldown, enabled: !d.cooldown.enabled };
      S.cdCustom = false;
      return edited();
    }
    if ((b = at('[data-cdpreset]'))) {
      if (b.dataset.cdpreset === 'custom') S.cdCustom = true;
      else {
        const s = Number(b.dataset.cdpreset);
        d.cooldown = { ...d.cooldown, seconds: s, unit: unitOf(s) };
        S.cdCustom = false;
      }
      return edited();
    }
    if ((b = at('[data-cdscope]'))) {
      d.cooldown = {
        ...d.cooldown,
        scope: b.dataset.cdscope as 'viewer' | 'global',
      };
      return edited();
    }
    if (at('[data-mxon]')) {
      d.quota = { ...d.quota, enabled: !d.quota.enabled };
      return edited();
    }
    if ((b = at('[data-mxscope]'))) {
      d.quota = { ...d.quota, scope: b.dataset.mxscope as 'viewer' | 'global' };
      return edited();
    }
    if (at('[data-listed]')) {
      d.listed = !d.listed;
      return edited();
    }
    if ((b = at('[data-when]'))) {
      d.when = b.dataset.when as CmdConfig['when'];
      return edited();
    }
    if ((b = at('[data-chipdel]'))) {
      const [k, v] = b.dataset.chipdel!.split('|');
      if (k === 'alias') d.aliases = d.aliases.filter((a) => `!${a}` !== v);
      else
        d.audience = {
          ...d.audience,
          [k as 'allow']: d.audience[k as 'allow'].filter((x) => x !== v),
        };
      return edited();
    }
    if ((b = at('[data-refuse]'))) {
      d.refuse = {
        ...d.refuse,
        mode: b.dataset.refuse as CmdConfig['refuse']['mode'],
      };
      return edited();
    }
    if (at('[data-argadd]')) {
      d.args = [
        ...d.args,
        { name: `arg${d.args.length + 1}`, type: 'mention', required: true },
      ];
      return edited();
    }
    if ((b = at('[data-argdel]'))) {
      const i = Number(b.dataset.argdel);
      d.args = d.args.filter((_, k) => k !== i);
      return edited();
    }
    if ((b = at('[data-argtype]'))) {
      const [i, type] = b.dataset.argtype!.split(':');
      d.args = d.args.map((a, k) =>
        k === Number(i) ? { ...a, type: type as 'mention' } : a,
      );
      return edited();
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
      edited();
      z('steps')
        .querySelector<HTMLInputElement>(
          `[data-atext="${d.actions.at(-1)!.id}"]`,
        )
        ?.focus();
      return;
    }
    if ((b = at('[data-adel]'))) {
      const id = b.dataset.adel;
      d.actions = d.actions.filter((a) => a.id !== id);
      return edited();
    }
    if ((b = at('[data-amove]'))) {
      const [id, delta] = b.dataset.amove!.split(':');
      const list = [...d.actions];
      const i = list.findIndex((a) => a.id === id);
      const j = i + Number(delta);
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j]!, list[i]!];
      d.actions = list;
      return edited();
    }
  }

  function onInput(e: Event) {
    const t = e.target as HTMLInputElement;
    const d = S.draft;
    if (t.matches('[data-q]')) {
      S.q = t.value;
      return paintLib();
    }
    if (t.matches('[data-tmsg]')) {
      S.t.message = t.value;
      return paintChat();
    }
    if (t.matches('[data-chipin]') && S.aliasErr) {
      S.aliasErr = '';
      return patch(z('ban'), bannersHtml(ctx()));
    }
    if (t.matches('[data-tfield]')) {
      (S.t as unknown as Record<string, string>)[t.dataset.tfield!] = t.value;
      S.t.res = null;
      return paintChat();
    }
    if (!d) return;
    if (t.matches('[data-name]')) {
      const v = word(t.value);
      if (v !== t.value) t.value = v;
      d.name = v;
      return paintLive();
    }
    if (t.matches('[data-desc]')) {
      d.description = t.value;
      return paintLive();
    }
    if (t.matches('[data-rtext]')) {
      d.reply = { ...d.reply, text: t.value };
      const m = z('reply').querySelector<HTMLElement>('[data-mirror]');
      if (m) m.innerHTML = mirrorHtml(t.value, d);
      return paintLive();
    }
    if (t.matches('[data-tologin]')) {
      d.reply = { ...d.reply, to_login: word(t.value) || undefined };
      return paintLive();
    }
    if (t.matches('[data-refusetext]')) {
      d.refuse = { ...d.refuse, text: t.value };
      return paintLive();
    }
    if (t.matches('[data-atext]')) {
      d.actions = d.actions.map((a) =>
        a.id === t.dataset.atext && a.type === 'chat'
          ? { ...a, text: t.value }
          : a,
      );
      return paintLive();
    }
    if (t.matches('[data-arg]')) {
      const v = t.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (v !== t.value) t.value = v;
      d.args = d.args.map((a, i) =>
        i === Number(t.dataset.arg) ? { ...a, name: v } : a,
      );
      return paintLive();
    }
  }

  function onChange(e: Event) {
    const t = e.target as HTMLInputElement;
    const d = S.draft;
    if (t.matches('[data-cat]')) {
      S.cat = t.value;
      return paintLib();
    }
    if (t.matches('[data-tpreset]')) {
      Object.assign(S.t, {
        preset: Number(t.value),
        ...structuredClone(TEST_VIEWERS[Number(t.value)]!),
        res: null,
      });
      repaintPop();
      return paintChat();
    }
    if (t.matches('[data-tbadge]')) {
      const b = t.dataset.tbadge!;
      S.t.badges = t.checked
        ? [...S.t.badges, b]
        : S.t.badges.filter((x) => x !== b);
      S.t.res = null;
      return paintChat();
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
    if (t.matches('[data-right]') && S.rightsDraft) {
      const [role, k] = t.dataset.right!.split(':') as [
        Role,
        keyof CmdTeamRights,
      ];
      const r = S.rightsDraft[role] as unknown as Record<string, unknown>;
      const v = r[k];
      r[k] =
        typeof v === 'boolean'
          ? t.checked
          : { ...(v as object), allowed: t.checked };
      S.rightsMsg = '';
      return paintPanel();
    }
    if (t.matches('[data-rightv]') && S.rightsDraft) {
      const [role, path] = t.dataset.rightv!.split(':') as [Role, string];
      const [k, sub] = path.split('.') as ['cooldown' | 'volume', string];
      (S.rightsDraft[role][k] as unknown as Record<string, number>)[sub] =
        Math.max(0, Math.round(Number(t.value) || 0));
      return paintPanel();
    }
    if (!d) return;
    if (t.matches('[data-category]')) {
      d.category = t.value || null;
      return edited();
    }
    if (t.matches('[data-cdval], [data-cdunit]')) {
      const box = t.closest('.cdx-inline')!;
      const unit = box.querySelector<HTMLSelectElement>('[data-cdunit]')!
        .value as 's' | 'min' | 'h';
      const n = Math.max(
        1,
        Math.round(
          Number(box.querySelector<HTMLInputElement>('[data-cdval]')!.value) ||
            1,
        ),
      );
      const mul = { s: 1, min: 60, h: 3600 }[unit];
      const seconds = Math.min(86_400, n * mul);
      d.cooldown = {
        ...d.cooldown,
        seconds,
        unit: seconds === n * mul ? unit : unitOf(seconds),
      };
      S.cdCustom = true;
      return edited();
    }
    if (t.matches('[data-mxcount]')) {
      d.quota = {
        ...d.quota,
        max: Math.min(10_000, Math.max(1, Math.round(Number(t.value) || 1))),
      };
      return edited();
    }
    if (t.matches('[data-mxper]')) {
      d.quota = {
        ...d.quota,
        window: t.value as CmdConfig['quota']['window'],
      };
      return edited();
    }
    if (t.matches('[data-argreq]')) {
      d.args = d.args.map((a, i) =>
        i === Number(t.dataset.argreq) ? { ...a, required: t.checked } : a,
      );
      return edited();
    }
    if (t.matches('[data-replyfirst]')) {
      d.reply_first = t.checked;
      return edited();
    }
    if (t.matches('[data-teamlock]')) {
      d.team_lock = t.checked;
      return edited();
    }
    if (t.matches('[data-amode]')) {
      d.actions = d.actions.map((a) =>
        a.id === t.dataset.amode && a.type === 'chat'
          ? { ...a, mode: t.value as 'normal' }
          : a,
      );
      return edited();
    }
    if (t.matches('[data-aerr]')) {
      d.actions = d.actions.map((a) =>
        a.id === t.dataset.aerr ? { ...a, on_error: t.value as 'stop' } : a,
      );
      return edited();
    }
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLInputElement;
    if (e.key === 'Enter' && t.matches('[data-chipin]')) {
      e.preventDefault();
      return addChip(t);
    }
    if (
      (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
      t.matches('.cdx-li, [data-q]')
    ) {
      e.preventDefault();
      const r = [...z('list').querySelectorAll<HTMLElement>('.cdx-li')];
      const i = t.matches('[data-q]') ? -1 : r.indexOf(t);
      r[
        Math.max(
          0,
          Math.min(r.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)),
        )
      ]?.focus();
      return;
    }
    if (e.key === 'Enter' && t.matches('.cdx-li')) t.click();
  }
  /** Un seul pont pour la page et pour chaque surcouche : elles vivent hors de `root`. */
  function wire(el: HTMLElement) {
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    el.addEventListener('keydown', onKey as EventListener);
  }
  wire(p.root);
  p.root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target as HTMLElement;
    if (f.matches('[data-tform]')) return void runTest();
    if (f.matches('[data-catform]')) {
      const input = f.querySelector<HTMLInputElement>('[data-catnew]')!;
      const name = input.value.trim();
      if (!name) return input.focus();
      const used = cats().map((k) => k.color);
      void cat(
        '/api/commands/categories',
        {
          name,
          icon: 'folder',
          color: COLORS.find((x) => !used.includes(x)) ?? COLORS[0]!,
        },
        `Catégorie « ${name} » ajoutée`,
      );
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!visibleNow) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && dirty() && !S.isNew) {
      e.preventDefault();
      void save();
    }
    const typing = (e.target as HTMLElement).matches?.(
      'input, textarea, select',
    );
    if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      search.focus();
    }
  });

  paintAll();
  return {
    setVisible(v: boolean) {
      visibleNow = v;
      if (v) {
        tick.start();
        void loadRights();
      } else tick.stop();
    },
  };
}
