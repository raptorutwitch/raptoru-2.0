import {
  choiceBox,
  confirmBox,
  drawer,
  errText,
  esc,
  fld,
  fmt,
  grp,
  ic,
  keyed,
  numrow,
  page,
  panelBtn,
  patch,
  poller,
  pop,
  pp,
  ring,
  row,
  run,
  scrub,
  seg,
  stateChip,
  sw,
  toast,
} from '../ds/ds.js';
import { getJson, postJson, tryGetJson } from '../http.js';
import {
  cardHtml,
  coreStyle,
  gem,
  imageUrl,
  lookAttr,
  paintLooks,
  RARITIES,
  RARITY_FR,
  titleHtml,
  type Look,
  type Wearer,
} from './player-card.js';
import {
  curveXp,
  dailyHtml,
  dailyLabel,
  fitCurve,
  hoursFor,
  requestId,
  slug,
  type DailySteps,
  type Rules,
} from './progression-model.js';

// Progression : la vraie carte d'un viewer, sa semaine et son mois, ce qu'on lui attribue ; la courbe se tire et montre son effet ;
// les marches du Daily se tirent ; le catalogue des titres et badges. Studio relaie : le Core compte, décide et journalise.

type Scene = 'viewers' | 'xp' | 'catalog';
interface Reward {
  reward_id: string;
  kind: string;
  label: string;
  description: string;
  rarity: string;
  category: string;
  unlock_level: number | null;
  active: boolean;
  sort: number;
  status?: string;
  style?: Look;
  image?: string | null;
}
interface State {
  enabled: boolean;
  rules: Rules;
  catalog: Reward[];
}
interface BoardRow {
  rank: number;
  twitchUserId: string;
  login: string | null;
  displayName: string;
  level: number;
  xp: number;
  watchMinutes: number;
  messages: number;
  title: { label: string; rarity: string; style: Look } | null;
}
interface Board {
  since: string | null;
  entries: BoardRow[];
}
interface SearchRow {
  twitch_user_id: string;
  login: string;
  display_name: string | null;
  level: number;
  xp: number;
}
interface Period {
  xp: number;
  watchMinutes: number;
  messages: number;
}
interface InvItem {
  id: string;
  kind: string;
  label: string;
  rarity: string;
  source: string;
  reference: string | null;
  style: Look;
  image: string | null;
}
interface Detail {
  level: number;
  xp: number;
  rank: number | null;
  levelXp: number;
  nextLevelXp: number;
  watchMinutes: number;
  messages: number;
  totals: { watchMinutes: number; messages: number };
  imported: { level: number; watchMinutes: number; messages: number } | null;
  periods: { week: Period; month: Period };
  equipped: {
    title: string | null;
    badges: string[];
    frame: string | null;
    banner: string | null;
  };
  inventory: InvItem[];
}
interface Journal {
  movements: {
    kind: string;
    amount: number;
    actor: string;
    reason: string | null;
    at: string;
  }[];
  sources: {
    login: string;
    level: number;
    measuredAt: string;
    attachedBy: string | null;
  }[];
}
interface ImportStatus {
  imported: number;
  pending: number;
  ambiguous: number;
  conflict: number;
  lastMeasuredAt: string | null;
}
interface Waiting {
  login: string;
  status: string;
  twitchUserId: string | null;
  level: number;
  watchMinutes: number;
  messages: number;
  candidates: string[];
}
interface ImportResult {
  read: number;
  imported?: number;
  would_import?: number;
  already: number;
  by_id: number;
  by_login: number;
  unresolved: string[];
  ambiguous: string[];
  conflicts: string[];
}

const SCENES = [
  ['viewers', 'Viewers'],
  ['xp', 'XP et Daily'],
  ['catalog', 'Titres et badges'],
] as const;
const PERIODS = [
  ['all', 'Général'],
  ['week', 'Semaine'],
  ['month', 'Mois'],
] as const;
const BYS = [
  ['xp', 'XP'],
  ['watch', 'Présence'],
  ['messages', 'Messages'],
] as const;
const ADJUST = [
  ['add', 'Ajouter'],
  ['remove', 'Retirer'],
  ['set_xp', 'Fixer l’XP'],
  ['set_level', 'Fixer le niveau'],
] as const;
const SOURCE_FR: Record<string, string> = {
  level: 'niveau',
  event: 'événement',
  manual: 'manuel',
  import: 'reprise',
  purchase: 'achat',
  reward: 'récompense',
};
const JOURNAL_FR: Record<string, string> = {
  import: 'Reprise',
  grant: 'Ajout',
  correction: 'Correction',
};
const WAITING_FR: Record<string, string> = {
  pending: 'Inconnu pour l’instant',
  ambiguous: 'Ambigu',
  conflict: 'Conflit',
};
const KIND_GROUP = [
  ['title', 'Titres'],
  ['badge', 'Badges'],
  ['frame', 'Cadres'],
  ['banner', 'Bannières'],
] as const;
const LEVEL_SPANS = [
  ['50', '50'],
  ['100', '100'],
  ['250', '250'],
] as const;
const REFUS = {
  below_zero: 'Refusé : l’XP ne peut pas passer sous 0.',
  not_owned: 'Ce viewer n’a plus cet objet.',
  reward_unknown: 'Cet objet n’existe plus.',
};
const hours = (m: number) =>
  m < 60 ? `${fmt(m)} min` : `${fmt(Math.round(m / 60))} h`;
const timeFr = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const blankReward = (): Reward => ({
  reward_id: '',
  kind: 'title',
  label: '',
  description: '',
  rarity: 'common',
  category: 'general',
  unlock_level: null,
  active: true,
  sort: 0,
});

export function mountProgressionPage(root: HTMLElement) {
  coreStyle();
  const p = page(root, {
    title: 'Progression',
    mod: 'progression',
    panel: true,
  });
  p.body.innerHTML = `<div class="pg">
    <div class="pg-v" data-scene-z="viewers">
      <aside class="pg-roster">
        <label class="d-fld pg-q">${ic('search')}<input type="search" data-role="q" maxlength="40" placeholder="Pseudo Twitch ou identifiant" aria-label="Chercher un viewer"></label>
        <div class="pg-filters" data-z="filters"></div>
        <div class="pg-list" data-z="list"></div>
      </aside>
      <section class="pg-sheet detail" aria-label="Fiche du viewer">
        <div class="d-empty pg-pick" data-z="pick">Choisis un viewer : tu verras son profil, sa collection et son journal.</div>
        <div class="pg-sheet__b" data-z="sheet" hidden>
          <div data-z="card"></div>
          <div class="pg-stats" data-z="stats"></div>
          <p class="d-note" data-z="origin"></p>
          <div class="pg-cols">
            <div>
              <h3 class="pg-h">Collection</h3>
              <div data-z="inv"></div>
              <form class="pg-grant" data-grant>
                <h3 class="pg-h">Attribuer</h3>
                <button type="button" class="d-btn pg-choose" data-act="grant-pick" data-role="grant-reward">${ic('plus')}Choisir un titre ou un badge</button>
                <div class="pg-inline"><span data-z="grant-src"></span><label class="d-fld"><input type="text" data-role="grant-ref" maxlength="80" placeholder="Référence (facultatif)" aria-label="Référence"></label></div>
                <button class="d-btn pri" data-act="grant" disabled>Attribuer</button>
              </form>
            </div>
            <div>
              <form class="pg-adjust" data-adjust>
                <h3 class="pg-h">XP à la main</h3>
                <span data-z="adj-mode"></span>
                <div class="pg-inline"><label class="d-fld pg-adjv"><input type="number" min="0" step="1" data-role="adj-value" placeholder="Valeur" aria-label="Valeur"></label><label class="d-fld"><input type="text" data-role="adj-reason" maxlength="200" placeholder="Raison (gardée au journal)" aria-label="Raison"></label></div>
                <button class="d-btn" data-act="adjust">Appliquer</button>
              </form>
              <h3 class="pg-h">Journal</h3>
              <div class="pg-journal" data-z="journal"></div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="pg-x" data-scene-z="xp" hidden>
      <section class="pg-curve" aria-label="Courbe des niveaux">
        <div class="pg-line"><span class="d-lb">Courbe des niveaux</span><span class="d-faint">Tire les deux points : la courbe passe par eux</span><span class="d-sp"></span><span class="d-faint">Jusqu’au niveau</span><span data-z="span"></span></div>
        <div class="pg-chart" data-z="chart"></div>
        <div class="pg-miles" data-z="miles"></div>
      </section>
      <aside class="pg-earn" data-z="earn"></aside>
      <section class="pg-daily" aria-label="Paliers du Daily">
        <div class="pg-line"><span class="d-lb">Daily</span><span class="d-faint">Tire les marches ou écris le montant</span><span class="d-sp"></span><span data-z="daily-acts"></span></div>
        <div data-z="daily"></div>
      </section>
    </div>

    <div class="pg-c" data-scene-z="catalog" hidden>
      <section class="pg-shelf">
        <div class="pg-line"><span data-z="cat-filter"></span><label class="d-fld pg-q">${ic('search')}<input type="search" data-cat-q maxlength="40" placeholder="Chercher" aria-label="Chercher un titre ou un badge"></label><span class="d-sp"></span><button type="button" class="d-btn" data-act="reward-new">${ic('plus')}Nouveau</button></div>
        <div class="pg-items" data-z="items"></div>
      </section>
      <aside class="pg-rform" data-role="reward-form" data-z="rform"></aside>
    </div>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  const q = p.body.querySelector<HTMLInputElement>('[data-role="q"]')!;
  const adjValue = p.body.querySelector<HTMLInputElement>(
    '[data-role="adj-value"]',
  )!;
  const adjReason = p.body.querySelector<HTMLInputElement>(
    '[data-role="adj-reason"]',
  )!;
  const grantRef = p.body.querySelector<HTMLInputElement>(
    '[data-role="grant-ref"]',
  )!;
  const grantBtn =
    p.body.querySelector<HTMLButtonElement>('[data-act="grant"]')!;
  const chooseBtn = p.body.querySelector<HTMLElement>(
    '[data-act="grant-pick"]',
  )!;

  let scene: Scene = 'viewers';
  let st: State | null = null;
  let error = '';
  let board: Board | null = null;
  let boardMissing = false;
  let period = 'all';
  let by = 'xp';
  let hits: SearchRow[] | null = null;
  let sel: {
    id: string;
    name: string;
    detail: Detail;
    journal: Journal;
  } | null = null;
  let grantPick: Reward | null = null;
  let grantSource = 'manual';
  let adjMode = 'add';
  let adjKey = requestId();
  let imp: ImportStatus | null = null;
  let lastImport: ImportResult | null = null;
  let lastDry = false;
  let saved: Rules | null = null;
  let draft: Rules | null = null;
  let span = 100;
  let hover: number | null = null;
  let daily: DailySteps | null = null;
  let dailySaved = '';
  let form = blankReward();
  let isNew = true;
  let idTouched = false;
  let fKind = 'all';
  let catQ = '';

  const rulesDirty = () =>
    !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const curveChanged = () =>
    !!draft &&
    !!saved &&
    (draft.curve_base !== saved.curve_base ||
      draft.curve_exponent !== saved.curve_exponent);
  const rewards = () =>
    (st?.catalog ?? []).filter((r) => r.kind === 'title' || r.kind === 'badge');

  // --- Lectures ---------------------------------------------------------------------------------------------------------
  async function readBoard() {
    const b = await getJson<Board>(
      `/api/progression/leaderboard?by=${by}&period=${period}`,
    ).catch(() => {
      // Un Core plus ancien n'a pas ce classement : la recherche reste.
      boardMissing = true;
      return null;
    });
    if (b) {
      board = b;
      boardMissing = false;
    }
    paintRoster();
  }
  async function readViewer(id: string, name: string) {
    const [detail, journal] = await Promise.all([
      getJson<Detail>(`/api/progression/viewers/${id}`),
      getJson<Journal>(`/api/progression/viewers/${id}/history`),
    ]);
    sel = { id, name, detail, journal };
    paintSheet();
    paintRoster();
  }
  async function read() {
    try {
      st = await getJson<State>('/api/progression/state');
      saved = st.rules;
      if (!draft || !rulesDirty()) draft = structuredClone(st.rules);
      error = '';
    } catch (e) {
      error = errText(e);
    }
    const d = await tryGetJson<DailySteps>('/api/daily/config');
    if (d && (!daily || daily.steps.join() === dailySaved)) {
      daily = d;
      dailySaved = d.steps.join();
    }
    imp = await tryGetJson<ImportStatus>('/api/progression/import/status');
    await readBoard();
    if (sel) await readViewer(sel.id, sel.name).catch(() => null);
    paint();
  }
  const tick = poller(read, 6000);
  /** Après une action : tout est relu, seul le Core dit ce qui a changé. */
  const reload = () => tick.now();

  // --- Dessin -----------------------------------------------------------------------------------------------------------
  function paintHead() {
    patch(
      p.state,
      !st
        ? stateChip(
            error ? 'r' : 'w',
            error ? 'Progression injoignable' : 'Lecture…',
          )
        : st.enabled
          ? stateChip('', 'Active')
          : stateChip('off', 'Inactive'),
    );
    patch(
      p.actions,
      `${rulesDirty() ? '<button type="button" class="d-btn ghost sm" data-act="rules-revert">Annuler</button><button type="button" class="d-btn pri sm" data-act="rules-apply">Appliquer</button>' : ''}
      ${seg('data-scene', SCENES, scene)}
      ${st ? `<button type="button" class="d-btn ${st.enabled ? 'ghost' : 'pri'}" data-act="toggle">${st.enabled ? 'Désactiver…' : 'Activer'}</button>` : ''}
      ${panelBtn(p.panel.isOpen())}`,
    );
  }
  function paintRoster() {
    patch(
      z('filters'),
      `${seg('data-period', PERIODS, period, 'block')}${seg('data-by', BYS, by, 'block')}`,
    );
    const value = (e: BoardRow) =>
      by === 'watch'
        ? hours(e.watchMinutes)
        : by === 'messages'
          ? fmt(e.messages)
          : `${fmt(e.xp)} XP`;
    const list = z('list');
    const cur = sel?.id;
    if (hits)
      return keyed(
        list,
        hits.map((h) => ({
          key: h.twitch_user_id,
          html: `<button type="button" class="pg-hit d-in ${cur === h.twitch_user_id ? 'on' : ''}" data-pick="${esc(h.twitch_user_id)}" data-name="${esc(h.display_name ?? h.login)}">${pp(h.display_name ?? h.login, 30)}<span class="pg-who"><b>${esc(h.display_name ?? h.login)}</b><small>${esc(h.login)}</small></span><span class="pg-val"><b>${h.level}</b><small>${fmt(Number(h.xp))} XP</small></span></button>`,
        })),
        '<div class="d-empty">Aucun viewer connu sous ce pseudo.</div>',
      );
    keyed(
      list,
      (board?.entries ?? []).map((e) => ({
        key: e.twitchUserId,
        html: `<button type="button" class="pg-hit d-in ${cur === e.twitchUserId ? 'on' : ''}" data-pick="${esc(e.twitchUserId)}" data-name="${esc(e.displayName)}"><span class="pg-rk">${e.rank}</span>${pp(e.displayName, 30)}<span class="pg-who"><b>${esc(e.displayName)}</b>${e.title ? `<span class="pg-tl" ${lookAttr(e.title.style)}>${esc(e.title.label)}</span>` : `<small>niveau ${e.level}</small>`}</span><span class="pg-val"><b>${esc(value(e))}</b>${e.title ? `<small>niveau ${e.level}</small>` : ''}</span></button>`,
      })),
      `<div class="d-empty">${
        boardMissing
          ? 'Cherche un pseudo pour ouvrir sa fiche.'
          : period === 'all'
            ? 'Personne n’a encore d’XP.'
            : period === 'week'
              ? 'Personne n’a encore gagné d’XP cette semaine.'
              : 'Personne n’a encore gagné d’XP ce mois-ci.'
      }</div>`,
    );
    paintLooks(list);
  }
  const wearer = (s: NonNullable<typeof sel>): Wearer => {
    const inv = s.detail.inventory;
    const eq = s.detail.equipped;
    const by = (id: string | null) => inv.find((i) => i.id === id);
    const t = by(eq.title);
    return {
      name: s.name,
      title: t && { label: t.label, rarity: t.rarity, style: t.style },
      badges: eq.badges.flatMap((b) => {
        const i = by(b);
        return i
          ? [{ label: i.label, rarity: i.rarity, image: imageUrl(i.image) }]
          : [];
      }),
      frame: imageUrl(by(eq.frame)?.image),
      banner: imageUrl(by(eq.banner)?.image),
    };
  };
  function paintSheet() {
    z('pick').hidden = !!sel;
    z('sheet').hidden = !sel;
    if (!sel) return;
    const d = sel.detail;
    const span = Math.max(1, d.nextLevelXp - d.levelXp);
    const done = Math.max(0, Math.min(1, (d.xp - d.levelXp) / span));
    patch(
      z('card'),
      cardHtml(wearer(sel), {
        titleEmpty: 'Aucun titre équipé',
        aside: `<div class="pg-dial" title="${fmt(d.xp - d.levelXp)} / ${fmt(span)} XP vers le niveau ${d.level + 1}">${ring(done, 33, 5, 78)}<span><b>${d.level}</b><small>niveau</small></span></div>`,
      }),
    );
    paintLooks(z('card'));
    const stat = (label: string, v: string, sub = '') =>
      `<div><span class="d-lb">${label}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const per = (x: Period) =>
      `${fmt(x.watchMinutes)} min · ${fmt(x.messages)} msg`;
    patch(
      z('stats'),
      `${stat('XP', fmt(d.xp), `${fmt(d.nextLevelXp - d.xp)} vers le niveau ${d.level + 1}`)}
      ${stat('Rang', d.rank ? `${d.rank}${d.rank === 1 ? 're' : 'e'}` : 'aucun')}
      ${stat('Présence', hours(d.totals.watchMinutes))}
      ${stat('Messages', fmt(d.totals.messages))}
      ${stat('Semaine', `+${fmt(d.periods.week.xp)} XP`, per(d.periods.week))}
      ${stat('Mois', `+${fmt(d.periods.month.xp)} XP`, per(d.periods.month))}`,
    );
    patch(
      z('origin'),
      `Dont ${fmt(d.watchMinutes)} min relevées par Raptoru (liste des chatters, pas une preuve de visionnage) et ${fmt(d.messages)} messages comptés.${d.imported ? ` Repris de WizeBot : niveau ${d.imported.level}, ${fmt(d.imported.watchMinutes)} min, ${fmt(d.imported.messages)} messages.` : ''}`,
    );
    const eq = new Set(
      [
        d.equipped.title,
        d.equipped.frame,
        d.equipped.banner,
        ...d.equipped.badges,
      ].filter(Boolean),
    );
    patch(
      z('inv'),
      d.inventory.length
        ? KIND_GROUP.map(([k, label]) => {
            const items = d.inventory.filter((i) => i.kind === k);
            return items.length
              ? `<div class="pg-invg"><small>${label}</small>${items
                  .map(
                    (i) =>
                      `<div class="pg-it">${itemLook(i)}<span class="pg-it__m">${eq.has(i.id) ? '<span class="d-tag ok">Équipé</span>' : ''}<small>${esc(SOURCE_FR[i.source] ?? i.source)}${i.reference ? ` · ${esc(i.reference)}` : ''}</small></span><button type="button" class="d-btn bad sm" data-revoke="${esc(i.id)}">Retirer…</button></div>`,
                  )
                  .join('')}</div>`
              : '';
          }).join('')
        : '<p class="d-faint pg-none">Inventaire vide.</p>',
    );
    paintLooks(z('inv'));
    patch(
      z('journal'),
      `${sel.journal.sources.map((h) => `<p class="d-note">WizeBot « ${esc(h.login)} » : niveau ${h.level}, relevé le ${esc(new Date(h.measuredAt).toLocaleDateString('fr-FR'))}, rattaché ${h.attachedBy === 'manual' ? 'à la main' : h.attachedBy === 'id' ? 'par identifiant Twitch' : 'par pseudo'}.</p>`).join('')}
      ${
        sel.journal.movements
          .map(
            (m) =>
              `<div class="pg-mv"><time>${esc(timeFr(m.at))}</time><b class="${m.amount < 0 ? 'neg' : ''}">${m.amount > 0 ? '+' : ''}${fmt(m.amount)} XP</b><span>${esc(JOURNAL_FR[m.kind] ?? m.kind)} · ${esc(m.actor)}${m.reason ? ` · ${esc(m.reason)}` : ''}</span></div>`,
          )
          .join('') ||
        '<p class="d-faint pg-none">Aucun ajustement ni reprise.</p>'
      }`,
    );
  }
  const itemLook = (i: {
    kind: string;
    label: string;
    rarity: string;
    style?: Look;
    image?: string | null;
  }) => {
    const img = imageUrl(i.image);
    return i.kind === 'title'
      ? titleHtml({ label: i.label, rarity: i.rarity, style: i.style })
      : `<span class="pg-thumb ${i.kind}" data-r="${esc(i.rarity)}">${img ? `<img src="${esc(img)}" alt="">` : gem(i.rarity)}</span><b class="pg-it__n">${esc(i.label)}</b>`;
  };
  function paintForms() {
    patch(
      z('grant-src'),
      seg(
        'data-grant-source',
        [
          ['manual', 'Manuel'],
          ['event', 'Événement'],
        ],
        grantSource,
      ),
    );
    patch(z('adj-mode'), seg('data-adj-mode', ADJUST, adjMode, 'block'));
  }

  // --- Courbe -----------------------------------------------------------------------------------------------------------
  const handleLevels = () => ({
    a: Math.max(3, Math.round(span * 0.3)),
    b: span,
  });
  let yMax = 1;
  const fitY = () => {
    if (!draft) return;
    yMax = Math.max(1, curveXp(span, draft) * 1.12);
  };
  const box = { w: 0, h: 0, l: 56, r: 16, t: 10, b: 24 };
  const px = (lv: number) =>
    box.l + ((lv - 1) / (span - 1)) * (box.w - box.l - box.r);
  const py = (xp: number) =>
    box.h - box.b - (xp / yMax) * (box.h - box.t - box.b);
  const path = (r: Pick<Rules, 'curve_base' | 'curve_exponent'>) => {
    let d = '';
    for (let i = 0; i <= 80; i++) {
      const lv = 1 + ((span - 1) * i) / 80;
      d += `${i ? 'L' : 'M'}${px(lv).toFixed(1)} ${py(curveXp(lv, r)).toFixed(1)}`;
    }
    return d;
  };
  function paintChart() {
    if (!draft) return;
    const el = z('chart');
    box.w = el.clientWidth;
    box.h = el.clientHeight;
    if (!box.w || !box.h) return;
    const d = draft;
    const held = document.activeElement?.getAttribute('data-grip');
    const { a, b } = handleLevels();
    const curve = path(d);
    const ticks = 5;
    let grid = '';
    for (let i = 1; i <= ticks; i++) {
      const lv = Math.round((span / ticks) * i);
      grid += `<line class="tick" x1="${px(lv)}" x2="${px(lv)}" y1="${box.t}" y2="${box.h - box.b}"/><text class="lb" x="${px(lv)}" y="${box.h - 7}" text-anchor="middle">${lv}</text>`;
    }
    for (let i = 1; i <= 3; i++) {
      const xp = (yMax / 3.3) * i;
      grid += `<text class="lb" x="${box.l - 8}" y="${py(xp) + 4}" text-anchor="end">${fmt(Math.round(xp / 100) * 100)}</text><line class="tick" x1="${box.l}" x2="${box.w - box.r}" y1="${py(xp)}" y2="${py(xp)}"/>`;
    }
    const pins = rewards()
      .filter((r) => r.unlock_level && r.unlock_level <= span && r.active)
      .map(
        (r) =>
          `<g class="pin" transform="translate(${px(r.unlock_level!)} ${py(curveXp(r.unlock_level!, d))})"><title>${esc(r.label)} : niveau ${r.unlock_level}</title><path d="M0 0v-16"/><circle cy="-19" r="3.5"/></g>`,
      )
      .join('');
    const me =
      sel && sel.detail.level <= span
        ? `<g class="me" transform="translate(${px(sel.detail.level)} ${py(curveXp(sel.detail.level, d))})"><circle r="4.5"/><text y="-11" text-anchor="middle">${esc(sel.name)}</text></g>`
        : '';
    const h = hover
      ? `<g class="hov"><line x1="${px(hover)}" x2="${px(hover)}" y1="${box.t}" y2="${box.h - box.b}"/><circle cx="${px(hover)}" cy="${py(curveXp(hover, d))}" r="3"/></g>`
      : '';
    const grip = (k: 'a' | 'b', lv: number) =>
      `<g class="grip" data-grip="${k}" tabindex="0" role="slider" aria-label="XP du niveau ${lv}" aria-valuenow="${curveXp(lv, d)}" transform="translate(${px(lv)} ${py(curveXp(lv, d))})"><circle r="16" class="hit"/><circle r="7"/><text y="-13" text-anchor="middle">${fmt(curveXp(lv, d))}</text></g>`;
    el.innerHTML = `<svg width="${box.w}" height="${box.h}" role="img" aria-label="XP totale à atteindre selon le niveau">
      ${grid}
      ${rulesDirty() && saved ? `<path class="was" d="${path(saved)}"/>` : ''}
      <path class="area" d="${curve}L${px(span)} ${box.h - box.b}L${px(1)} ${box.h - box.b}Z"/><path class="now" d="${curve}"/>
      ${pins}${me}${h}${grip('a', a)}${grip('b', b)}
    </svg>${hover ? `<div class="pg-tip" style="left:${Math.min(box.w - 170, px(hover) + 10)}px">Niveau <b>${hover}</b> · ${fmt(curveXp(hover, d))} XP${hoursFor(curveXp(hover, d), d.xp_per_minute) === null ? '' : ` · ≈ ${fmt(Math.round(hoursFor(curveXp(hover, d), d.xp_per_minute)!))} h`}</div>` : ''}`;
    if (held) el.querySelector<SVGElement>(`[data-grip="${held}"]`)?.focus();
    const marks = [0.1, 0.25, 0.5, 0.75, 1].map((f) =>
      Math.max(2, Math.round(span * f)),
    );
    patch(
      z('miles'),
      marks
        .map((lv) => {
          const xp = curveXp(lv, d);
          const hrs = hoursFor(xp, d.xp_per_minute);
          return `<div><span class="d-lb">Niveau ${lv}</span><b>${fmt(xp)} XP</b><small>${hrs === null ? 'présence sans XP' : `≈ ${fmt(Math.round(hrs))} h de présence`}</small></div>`;
        })
        .join(''),
    );
    patch(z('span'), seg('data-span', LEVEL_SPANS, String(span)));
  }
  function paintEarn() {
    if (!draft) return;
    const d = draft;
    if (z('earn').contains(document.activeElement)) return;
    patch(
      z('earn'),
      `${grp(
        'Ce qui rapporte',
        'level',
        `${numrow('XP par minute de présence', fld('data-rule="xp_per_minute" step="0.1" min="0" max="100"', d.xp_per_minute))}
        ${numrow('XP par message', fld('data-rule="message_xp" min="0" max="1000"', d.message_xp))}
        ${numrow('Délai entre deux messages', fld('data-rule="message_cooldown_s" min="5" max="3600"', d.message_cooldown_s, 's'))}
        ${numrow('Longueur minimale', fld('data-rule="message_min_chars" min="1" max="100"', d.message_min_chars, 'car'))}
        ${row('Chat compté seulement en live', sw(d.live_only, 'data-rule="live_only"', 'Chat compté seulement en live'))}`,
      )}
      ${grp(
        'Courbe',
        'pulse',
        `${numrow('Base', fld('data-rule="curve_base" min="1" max="100000"', d.curve_base))}
        ${numrow('Exposant', fld('data-rule="curve_exponent" step="0.05" min="1" max="3"', d.curve_exponent))}`,
      )}
      <p class="d-note">${rulesDirty() ? 'Pas encore appliqué : le trait pâle est la courbe actuelle.' : 'L’XP déjà acquise ne change jamais.'}</p>`,
    );
  }
  function paintDaily() {
    const changed = !!daily && daily.steps.join() !== dailySaved;
    patch(
      z('daily-acts'),
      daily
        ? `<span class="pg-acts"><button type="button" class="d-btn ghost sm" data-act="daily-default">Valeurs d’origine</button><button type="button" class="d-btn ghost sm" data-act="daily-remove" ${daily.steps.length > 1 ? '' : 'disabled'}>Retirer le dernier</button><button type="button" class="d-btn sm" data-act="daily-add" ${daily.steps.length < daily.bounds.max_steps ? '' : 'disabled'}>${ic('plus')}Ajouter un palier</button><button type="button" class="d-btn pri sm" data-act="daily-save" ${changed ? '' : 'disabled'}>Enregistrer…</button></span>`
        : '',
    );
    const html = dailyHtml(daily);
    if (!z('daily').contains(document.activeElement)) patch(z('daily'), html);
  }

  // --- Catalogue --------------------------------------------------------------------------------------------------------
  function paintItems() {
    patch(
      z('cat-filter'),
      seg(
        'data-cat-kind',
        [
          ['all', 'Tout'],
          ['title', 'Titres'],
          ['badge', 'Badges'],
        ],
        fKind,
      ),
    );
    const s = catQ.trim().toLowerCase();
    const list = rewards().filter(
      (r) =>
        (fKind === 'all' || r.kind === fKind) &&
        (!s ||
          `${r.reward_id} ${r.label} ${r.category}`.toLowerCase().includes(s)),
    );
    const line = (r: Reward) =>
      `<button type="button" class="pg-reward d-in ${!isNew && form.reward_id === r.reward_id ? 'on d-vf' : ''} ${r.active ? '' : 'off'}" data-reward="${esc(r.reward_id)}"><span class="pg-reward__l">${itemLook(r)}</span><span class="pg-reward__m">${r.unlock_level ? `<span class="d-tag ok">Niveau ${r.unlock_level}</span>` : ''}${r.status === 'draft' ? '<span class="d-tag off">Brouillon</span>' : ''}${r.active ? '' : '<span class="d-tag off">Inactif</span>'}<small>${esc(RARITY_FR[r.rarity] ?? r.rarity)} · ${esc(r.category)}</small></span></button>`;
    const auto = list
      .filter((r) => r.unlock_level)
      .sort((a, b) => a.unlock_level! - b.unlock_level!);
    const hand = list.filter((r) => !r.unlock_level);
    patch(
      z('items'),
      list.length
        ? `${auto.length ? `<small class="pg-g">Débloqués par niveau</small>${auto.map(line).join('')}` : ''}${hand.length ? `<small class="pg-g">Événement ou à la main</small>${hand.map(line).join('')}` : ''}`
        : `<div class="d-empty">${rewards().length ? 'Rien ne correspond.' : 'Aucune récompense pour l’instant : « Nouveau » en crée une.'}</div>`,
    );
    paintLooks(z('items'));
  }
  function paintForm() {
    const f = form;
    z('rform').innerHTML = `<div class="pg-rprev" data-z="rprev"></div>
      <div class="d-row"><span>Type</span>${seg(
        'data-rkind',
        [
          ['title', 'Titre'],
          ['badge', 'Badge'],
        ],
        f.kind,
      )}</div>
      <label class="pg-fl"><span>Nom affiché</span><span class="d-fld"><input type="text" data-f="label" maxlength="60" value="${esc(f.label)}"></span></label>
      <div class="pg-fl"><span>Rareté</span><span class="pg-rar">${RARITIES.map((r) => `<button type="button" data-rarity="${r}" class="${f.rarity === r ? 'on' : ''}" aria-pressed="${f.rarity === r}">${gem(r)}${RARITY_FR[r]}</button>`).join('')}</span></div>
      <div class="d-row"><span>Débloqué au niveau</span>${fld('data-f="unlock_level" min="1" max="10000" placeholder="aucun"', f.unlock_level ?? '')}</div>
      <div class="d-row"><span>Actif</span>${sw(f.active, 'data-f="active"', 'Actif')}</div>
      <details class="d-acc" ${isNew ? 'open' : ''}><summary>Détails techniques</summary>
        <label class="pg-fl"><span>Identifiant</span><span class="d-fld"><input type="text" data-f="reward_id" maxlength="48" value="${esc(f.reward_id)}" ${isNew ? '' : 'disabled'} placeholder="ex. citrouille-2026"></span></label>
        <label class="pg-fl"><span>Catégorie</span><span class="d-fld"><input type="text" data-f="category" maxlength="32" value="${esc(f.category)}"></span></label>
      </details>
      <button type="button" class="d-btn pri" data-act="reward">${isNew ? 'Créer' : 'Mettre à jour'}</button>
      <p class="d-note">${f.unlock_level ? 'Donné à tous ceux qui ont atteint ce niveau.' : 'Sans niveau : donné par événement ou à la main.'} Apparence, cadres, bannières et vente : <a href="/?p=shop">Boutique</a>.</p>`;
    paintFormPreview();
  }
  function paintFormPreview() {
    const f = form;
    const live = rewards().find((r) => r.reward_id === f.reward_id);
    patch(
      z('rprev'),
      f.kind === 'title'
        ? `<span class="d-faint">Sur le profil</span><b class="pg-rp-n">Pseudo</b>${titleHtml({ label: f.label || 'Nom du titre', rarity: f.rarity, style: live?.style })}`
        : `<span class="d-faint">Sur le profil</span><b class="pg-rp-n">Pseudo</b><span class="pg-thumb badge" data-r="${esc(f.rarity)}">${live?.image ? `<img src="${esc(imageUrl(live.image)!)}" alt="">` : gem(f.rarity)}</span>`,
    );
    paintLooks(z('rprev'));
  }

  // --- Réglages à la demande ---------------------------------------------------------------------------------------------
  function paintPanel() {
    const excl = draft?.excluded_logins ?? [];
    const i = imp;
    const res = lastImport;
    p.panel.set(`${grp(
      'Règles d’XP',
      'level',
      row(
        'Courbe et gains',
        '<button type="button" class="d-btn sm" data-go-xp>Ouvrir</button>',
        'xp minute message délai longueur courbe base exposant live',
      ),
    )}
    ${grp(
      'Comptes exclus',
      'shield',
      `<div class="d-row col" data-k="exclus bots comptes pseudos"><div class="d-tags">${excl.map((l) => `<button type="button" class="d-tag" data-excl="${esc(l)}" title="Retirer ${esc(l)}">${esc(l)} ${ic('x')}</button>`).join('') || '<span class="d-faint">Aucun.</span>'}</div>
      <form class="pg-inline" data-exclform><label class="d-fld"><input type="text" data-newexcl maxlength="25" placeholder="Ajouter un pseudo" aria-label="Pseudo à exclure"></label><button class="d-ib" aria-label="Ajouter">${ic('plus')}</button></form><small>Ces comptes ne gagnent jamais d’XP. Le streamer non plus.</small></div>`,
      'bots',
    )}
    ${grp(
      'Présence',
      'eye',
      '<div class="d-row col" data-k="présence chatters relevé"><small>Un viewer compte quand il apparaît dans deux relevés de suite des chatters, toutes les 2 minutes. Un spectateur absent de cette liste n’est pas compté.</small></div>',
    )}
    ${grp(
      'Reprise WizeBot',
      'hist',
      `<div class="d-row col" data-k="wizebot reprise import historique">
        ${
          i
            ? `<dl class="d-kv"><dt>Rattachés</dt><dd>${fmt(i.imported)}</dd><dt>Inconnus pour l’instant</dt><dd>${fmt(i.pending)}</dd><dt>Ambigus</dt><dd>${fmt(i.ambiguous)}</dd><dt>Conflits</dt><dd>${fmt(i.conflict)}</dd>${i.lastMeasuredAt ? `<dt>Dernier relevé</dt><dd>${esc(new Date(i.lastMeasuredAt).toLocaleString('fr-FR'))}</dd>` : ''}</dl>`
            : '<small>État de la reprise indisponible.</small>'
        }
        <small>Démarre chaque viewer à son niveau WizeBot, une seule fois. Chaque ligne est gardée ; celles qu’on ne peut pas rattacher avec certitude attendent : elles se rattachent seules au retour du viewer, ou ici.</small>
        <div class="pg-wrap"><button type="button" class="d-btn sm" data-act="dry-run">Simuler</button><button type="button" class="d-btn sm" data-act="import">Importer…</button><button type="button" class="d-btn sm" data-act="resolve">Rattacher les lignes en attente</button><button type="button" class="d-btn sm" data-act="waiting">Historiques en attente</button><button type="button" class="d-btn bad sm" data-act="revert">Annuler l’import…</button></div>
        ${
          res
            ? `<dl class="d-kv"><dt>${lastDry ? 'Simulation, rien écrit' : 'Import terminé'}</dt><dd>${fmt(res.read)} lus</dd><dt>${lastDry ? 'À rattacher' : 'Rattachés'}</dt><dd>${fmt((lastDry ? res.would_import : res.imported) ?? 0)}</dd><dt>Par identifiant / pseudo</dt><dd>${fmt(res.by_id)} / ${fmt(res.by_login)}</dd><dt>Déjà rattachés</dt><dd>${fmt(res.already)}</dd><dt>Inconnus</dt><dd>${fmt(res.unresolved.length)}</dd><dt>Ambigus</dt><dd>${fmt(res.ambiguous.length)}</dd><dt>Conflits</dt><dd>${fmt(res.conflicts.length)}</dd></dl>`
            : ''
        }</div>`,
      'import',
    )}`);
  }
  function paint() {
    paintHead();
    for (const el of p.body.querySelectorAll<HTMLElement>('[data-scene-z]'))
      el.hidden = el.dataset.sceneZ !== scene;
    if (error && !st) {
      patch(z('list'), `<div class="d-empty">${esc(error)}</div>`);
      return;
    }
    paintForms();
    if (scene === 'viewers') paintSheet();
    if (scene === 'xp') {
      if (!drag) fitY();
      paintChart();
      paintEarn();
      paintDaily();
    }
    if (scene === 'catalog') {
      paintItems();
      if (!z('rform').childElementCount) paintForm();
    }
    paintPanel();
  }
  new ResizeObserver(() => scene === 'xp' && paintChart()).observe(z('chart'));

  // --- Actions ----------------------------------------------------------------------------------------------------------
  async function applyRules(btn: HTMLElement | null) {
    if (!draft || !saved) return;
    if (
      curveChanged() &&
      !(await confirmBox({
        title: 'Appliquer la nouvelle courbe ?',
        body: 'Les niveaux de tous les viewers suivent aussitôt cette courbe. L’XP ne change pas. Les titres et badges liés à un niveau sont donnés à ceux qui l’atteignent, et ne sont pas repris ensuite.',
        yes: 'Appliquer',
        no: 'Annuler',
        danger: false,
      }))
    )
      return;
    const before = saved;
    const undoable = !curveChanged();
    const rules = draft;
    const ok = await run(btn, () =>
      postJson('/api/progression/settings', { rules }),
    );
    if (!ok) return;
    toast('Règles appliquées', {
      undo: undoable
        ? () =>
            void run(
              null,
              () => postJson('/api/progression/settings', { rules: before }),
              'Règles précédentes rétablies',
            ).then(() => {
              draft = null;
              reload();
            })
        : undefined,
    });
    draft = null;
    reload();
  }
  function openWaiting() {
    const dr = drawer({
      kicker: 'Reprise WizeBot',
      title: 'Historiques en attente',
      body: `<form class="pg-inline" data-wform><label class="d-fld">${ic('search')}<input type="search" data-role="wq" maxlength="25" placeholder="Début du pseudo WizeBot" aria-label="Pseudo WizeBot"></label><button class="d-btn sm">Afficher</button></form><div data-wlist></div><p class="d-note">Rattacher seulement après avoir vérifié l’identité par l’identifiant Twitch, jamais sur la seule ressemblance des pseudos. Un viewer n’a qu’un historique WizeBot.</p>`,
    });
    const list = dr.el.querySelector<HTMLElement>('[data-wlist]')!;
    const show = async () => {
      const q =
        dr.el.querySelector<HTMLInputElement>('[data-role="wq"]')!.value;
      await run(null, async () => {
        const rows = await getJson<Waiting[]>(
          `/api/progression/import/waiting?q=${encodeURIComponent(q)}`,
        );
        list.innerHTML =
          rows
            .map(
              (w) =>
                `<div class="pg-wait"><div><b>${esc(w.login)}</b>${w.twitchUserId ? `<small>id ${esc(w.twitchUserId)}</small>` : ''}<small>${esc(WAITING_FR[w.status] ?? w.status)} · niveau ${w.level} · ${fmt(w.watchMinutes)} min · ${fmt(w.messages)} msg</small>${w.candidates.length ? `<small>Comptes sous ce pseudo : ${w.candidates.map(esc).join(', ')}</small>` : ''}</div><button type="button" class="d-btn sm" data-attach="${esc(w.login)}">Rattacher…</button></div>`,
            )
            .join('') || '<div class="d-empty">Rien en attente.</div>';
      });
    };
    dr.el.addEventListener('submit', (e) => {
      e.preventDefault();
      void show();
    });
    dr.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-attach]');
      if (!b) return;
      const login = b.dataset.attach!;
      pop(
        b,
        `<form class="d-form"><h3>Rattacher « ${esc(login)} »</h3>
          <label class="d-fld"><input type="text" data-a-id inputmode="numeric" placeholder="Identifiant Twitch vérifié" aria-label="Identifiant Twitch"></label>
          <label class="d-fld"><input type="text" data-a-why maxlength="200" placeholder="Comment l’identité a été vérifiée" aria-label="Vérification"></label>
          <button class="d-btn pri sm">Rattacher</button></form>`,
        (el) => {
          el.addEventListener('submit', (ev) => {
            ev.preventDefault();
            const viewer = el.querySelector<HTMLInputElement>('[data-a-id]')!;
            const reason = el.querySelector<HTMLInputElement>('[data-a-why]')!;
            if (!viewer.value.trim() || reason.value.trim().length < 3)
              return toast('Identifiant et vérification requis.', {
                bad: true,
              });
            void run(
              el.querySelector('button'),
              () =>
                postJson('/api/progression/import/attach', {
                  login,
                  viewer: viewer.value.trim(),
                  reason: reason.value.trim(),
                }),
              'Historique rattaché.',
            ).then((ok) => {
              if (!ok) return;
              el.hidePopover();
              void show();
              reload();
            });
          });
        },
      );
    });
    void show();
  }
  function chooseReward() {
    const list = rewards().filter((r) => r.active && r.status !== 'draft');
    const html = (s: string) =>
      list
        .filter((r) => !s || r.label.toLowerCase().includes(s))
        .map(
          (r) =>
            `<button type="button" class="pg-opt" data-choice="${esc(r.reward_id)}">${itemLook(r)}<small>${r.kind === 'title' ? 'Titre' : 'Badge'}</small></button>`,
        )
        .join('') || '<div class="d-empty">Aucune récompense.</div>';
    pop(
      chooseBtn,
      `<div class="pg-choices"><label class="d-fld">${ic('search')}<input type="search" data-cf placeholder="Chercher" aria-label="Chercher une récompense"></label><div data-cl>${html('')}</div></div>`,
      (el) => {
        paintLooks(el);
        el.addEventListener('input', () => {
          const box = el.querySelector<HTMLElement>('[data-cl]')!;
          box.innerHTML = html(
            el
              .querySelector<HTMLInputElement>('[data-cf]')!
              .value.toLowerCase(),
          );
          paintLooks(box);
        });
        el.addEventListener('click', (e) => {
          const c = (e.target as HTMLElement).closest<HTMLElement>(
            '[data-choice]',
          );
          if (!c) return;
          grantPick = list.find((r) => r.reward_id === c.dataset.choice)!;
          chooseBtn.innerHTML = itemLook(grantPick);
          paintLooks(chooseBtn);
          grantBtn.disabled = false;
          el.hidePopover();
        });
      },
    );
  }

  p.root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('button');
    const hit = t.closest<HTMLElement>('[data-pick]');
    if (hit) {
      adjKey = requestId();
      void readViewer(hit.dataset.pick!, hit.dataset.name!).catch((x) =>
        toast(errText(x), { bad: true }),
      );
      return;
    }
    if (!b) return;
    const a = b.dataset.act;
    if (b.dataset.scene) {
      scene = b.dataset.scene as Scene;
      if (scene === 'catalog' && !z('rform').childElementCount) paintForm();
      return paint();
    }
    if (b.dataset.period || b.dataset.by) {
      period = b.dataset.period ?? period;
      by = b.dataset.by ?? by;
      return void readBoard();
    }
    if (b.matches('[data-go-xp]')) {
      scene = 'xp';
      p.panel.close();
      return paint();
    }
    if (b.dataset.span) {
      span = Number(b.dataset.span);
      fitY();
      return paintChart();
    }
    if (b.dataset.grantSource) {
      grantSource = b.dataset.grantSource;
      return paintForms();
    }
    if (b.dataset.adjMode) {
      adjMode = b.dataset.adjMode;
      adjKey = requestId();
      return paintForms();
    }
    if (b.dataset.catKind) {
      fKind = b.dataset.catKind;
      return paintItems();
    }
    if (b.dataset.reward) {
      form = {
        ...blankReward(),
        ...rewards().find((r) => r.reward_id === b.dataset.reward),
      };
      isNew = false;
      paintForm();
      return paintItems();
    }
    if (b.dataset.rkind && isNew) {
      form.kind = b.dataset.rkind;
      return paintForm();
    }
    if (b.dataset.rarity) {
      form.rarity = b.dataset.rarity;
      return paintForm();
    }
    if (b.dataset.revoke && sel) {
      const s = sel;
      const it = s.detail.inventory.find((i) => i.id === b.dataset.revoke);
      if (!it) return;
      void choiceBox({
        title: `Retirer « ${it.label} »`,
        body:
          it.source === 'purchase'
            ? 'L’objet est retiré sans remboursement. Pour rembourser l’achat, passe par la Boutique.'
            : `${s.name} ne l’aura plus.`,
        choices: [],
        field: { label: 'Raison (gardée dans l’historique)', required: true },
        yes: 'Retirer',
        danger: true,
      }).then((r) => {
        if (!r) return;
        void run(
          b,
          () =>
            postJson('/api/progression/revoke', {
              reward_id: it.id,
              viewer: s.id,
              reason: r.text,
            }),
          'Retiré.',
          REFUS,
        ).then(reload);
      });
      return;
    }
    if (b.dataset.excl && draft) {
      draft.excluded_logins = (draft.excluded_logins ?? []).filter(
        (l) => l !== b.dataset.excl,
      );
      return paint();
    }
    if (a === 'grant-pick') return chooseReward();
    if (a === 'rules-apply') return void applyRules(b);
    if (a === 'rules-revert') {
      draft = saved && structuredClone(saved);
      return paint();
    }
    if (a === 'toggle' && st) {
      const on = st.enabled;
      void (async () => {
        if (
          on &&
          !(await confirmBox({
            title: 'Désactiver la progression ?',
            body: 'La présence et le chat ne rapportent plus d’XP tant qu’elle est désactivée. Les niveaux, l’XP et les inventaires sont conservés.',
            yes: 'Désactiver',
          }))
        )
          return;
        await run(
          b,
          () => postJson('/api/progression/settings', { enabled: !on }),
          on ? 'Progression désactivée.' : 'Progression activée.',
        );
        reload();
      })();
      return;
    }
    if (a === 'daily-add' && daily) {
      daily = { ...daily, steps: [...daily.steps, daily.steps.at(-1) ?? 0] };
      return paintDaily();
    }
    if (a === 'daily-remove' && daily) {
      daily = { ...daily, steps: daily.steps.slice(0, -1) };
      return paintDaily();
    }
    if (a === 'daily-default' && daily) {
      daily = { ...daily, steps: [...daily.default_steps] };
      return paintDaily();
    }
    if (a === 'daily-save' && daily) {
      const steps = daily.steps;
      void confirmBox({
        title: 'Enregistrer ces paliers du Daily ?',
        body: `${steps.map((v, i) => `${dailyLabel(i, false)} : ${fmt(v)}`).join(' · ')}. Appliqués aux prochains !daily. Les récompenses déjà reçues ne changent pas ; rien n’est versé après coup.`,
        yes: 'Enregistrer',
        no: 'Annuler',
        danger: false,
      }).then((yes) => {
        if (!yes) return;
        void run(
          b,
          () => postJson('/api/daily/config', { steps }),
          'Paliers du Daily enregistrés.',
        ).then((ok) => {
          if (!ok) return;
          dailySaved = steps.join();
          paintDaily();
        });
      });
      return;
    }
    if (a === 'reward-new') {
      form = blankReward();
      isNew = true;
      idTouched = false;
      paintForm();
      paintItems();
      return;
    }
    if (a === 'reward') {
      const body = {
        reward_id: form.reward_id.trim(),
        kind: form.kind,
        label: form.label.trim(),
        description: form.description,
        rarity: form.rarity,
        category: form.category.trim() || 'general',
        unlock_level: form.unlock_level,
        active: form.active,
        sort: form.sort,
      };
      void run(
        b,
        () => postJson('/api/progression/rewards', body),
        'Récompense enregistrée.',
        { invalid_request: 'Il manque un nom ou un identifiant valable.' },
      ).then((ok) => {
        if (!ok) return;
        isNew = false;
        reload();
        setTimeout(paintForm, 300);
      });
      return;
    }
    if (a === 'dry-run' || a === 'import') {
      const dry = a === 'dry-run';
      void (async () => {
        if (
          !dry &&
          !(await confirmBox({
            title: 'Importer les niveaux WizeBot ?',
            body: 'Pour de vrai, une seule fois par viewer. « Simuler » montre d’abord les chiffres.',
            yes: 'Importer',
            no: 'Annuler',
            danger: false,
          }))
        )
          return;
        await run(
          b,
          async () => {
            lastImport = await postJson<ImportResult>(
              `/api/progression/import/wizebot${dry ? '/dry-run' : ''}`,
              {},
            );
            lastDry = dry;
          },
          dry
            ? 'Simulation terminée, rien n’a été écrit.'
            : 'Import WizeBot terminé.',
        );
        reload();
      })();
      return;
    }
    if (a === 'resolve')
      return void run(b, async () => {
        const r = await postJson<{ imported: number }>(
          '/api/progression/import/resolve',
          {},
        );
        toast(`${r.imported} historique(s) rattaché(s).`);
        reload();
      });
    if (a === 'waiting') return openWaiting();
    if (a === 'revert') {
      void confirmBox({
        title: 'Annuler l’import WizeBot ?',
        body: 'Les XP importées sont retirées. L’XP gagnée depuis reste.',
        yes: 'Annuler l’import',
        no: 'Garder',
      }).then((yes) => {
        if (!yes) return;
        void run(
          b,
          () => postJson('/api/progression/import/revert', {}),
          'Import annulé.',
        ).then(reload);
      });
    }
  });
  p.root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target as HTMLElement;
    if (f.matches('[data-exclform]') && draft) {
      const i = f.querySelector<HTMLInputElement>('[data-newexcl]')!;
      const login = i.value.trim().toLowerCase();
      if (!/^[a-z0-9_]{1,25}$/.test(login))
        return toast('Pseudo Twitch invalide.', { bad: true });
      draft.excluded_logins = [
        ...new Set([...(draft.excluded_logins ?? []), login]),
      ];
      paint();
      return;
    }
    const btn = f.querySelector<HTMLElement>('[data-act]:not([type="button"])');
    if (f.matches('[data-grant]') && sel && grantPick) {
      const s = sel;
      const reward = grantPick;
      void run(
        btn,
        () =>
          postJson('/api/progression/grant', {
            reward_id: reward.reward_id,
            viewers: [s.id],
            source: grantSource,
            reference: grantRef.value.trim() || null,
          }),
        'Attribué.',
        REFUS,
      ).then((ok) => {
        if (!ok) return;
        grantRef.value = '';
        grantPick = null;
        grantBtn.disabled = true;
        chooseBtn.innerHTML = `${ic('plus')}Choisir un titre ou un badge`;
        reload();
      });
    }
    if (f.matches('[data-adjust]') && sel) {
      const value = Number(adjValue.value);
      const reason = adjReason.value.trim();
      if (
        !adjValue.value ||
        !Number.isInteger(value) ||
        value < 0 ||
        reason.length < 3
      )
        return toast('Valeur entière et raison de 3 caractères au moins.', {
          bad: true,
        });
      const s = sel;
      void run(
        btn,
        () =>
          postJson('/api/progression/adjust', {
            viewer: s.id,
            mode: adjMode,
            value,
            reason,
            request_id: adjKey,
          }),
        'XP ajustée.',
        REFUS,
      ).then((ok) => {
        if (!ok) return;
        adjKey = requestId();
        adjValue.value = '';
        adjReason.value = '';
        reload();
      });
    }
  });

  let searching = 0;
  p.root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t === q) {
      const text = q.value.trim();
      const mine = ++searching;
      if (!text) {
        hits = null;
        return paintRoster();
      }
      setTimeout(() => {
        if (mine !== searching) return;
        void getJson<SearchRow[]>(
          `/api/progression/viewers?q=${encodeURIComponent(text)}`,
        ).then(
          (r) => {
            if (mine !== searching) return;
            hits = r;
            paintRoster();
          },
          (x) => toast(errText(x), { bad: true }),
        );
      }, 180);
      return;
    }
    if (t === adjValue || t === adjReason) adjKey = requestId();
    if (t.matches('[data-cat-q]')) {
      catQ = t.value;
      return paintItems();
    }
    const rule = t.dataset.rule as keyof Rules | undefined;
    if (rule && draft) {
      (draft as unknown as Record<string, unknown>)[rule] =
        t.type === 'checkbox' ? t.checked : Number(t.value);
      if (!drag) fitY();
      paintChart();
      paintHead();
      return;
    }
    const step = t.dataset.dailyStep;
    if (step !== undefined && daily) {
      const steps = [...daily.steps];
      steps[Number(step)] = Number(t.value);
      daily = { ...daily, steps };
      setDailyBars();
      paintDailyActs();
      return;
    }
    const f = t.dataset.f;
    if (f) {
      if (f === 'unlock_level')
        form.unlock_level = t.value.trim() ? Number(t.value) : null;
      else if (f === 'active') form.active = t.checked;
      else (form as unknown as Record<string, string>)[f] = t.value;
      if (f === 'reward_id') idTouched = true;
      if (f === 'label' && isNew && !idTouched) {
        form.reward_id = slug(t.value);
        p.body.querySelector<HTMLInputElement>('[data-f="reward_id"]')!.value =
          form.reward_id;
      }
      paintFormPreview();
    }
  });
  const paintDailyActs = () => {
    const save = p.body.querySelector<HTMLButtonElement>(
      '[data-act="daily-save"]',
    );
    if (save && daily) save.disabled = daily.steps.join() === dailySaved;
  };
  const setDailyBars = () => {
    if (!daily) return;
    const top = Math.max(1, ...daily.steps, ...daily.default_steps);
    p.body.querySelectorAll<HTMLElement>('[data-dgrip]').forEach((g, i) => {
      g.style.setProperty('--h', `${(daily!.steps[i]! / top) * 100}%`);
      g.querySelector('b')!.textContent = fmt(daily!.steps[i]);
    });
  };

  // --- Tirer un point de la courbe, une marche du Daily ------------------------------------------------------------------
  let drag: { k: 'a' | 'b'; top: number } | null = null;
  let stepDrag: { i: number; box: DOMRect; top: number } | null = null;
  const setGrip = (k: 'a' | 'b', xp: number) => {
    if (!draft) return;
    const { a, b } = handleLevels();
    const other = k === 'a' ? curveXp(b, draft) : curveXp(a, draft);
    Object.assign(
      draft,
      fitCurve(
        { level: a, xp: k === 'a' ? xp : other },
        { level: b, xp: k === 'b' ? xp : other },
      ),
    );
    const put = (name: string, v: number) => {
      const el = p.body.querySelector<HTMLInputElement>(
        `[data-rule="${name}"]`,
      );
      if (el) el.value = String(v);
    };
    put('curve_base', draft.curve_base);
    put('curve_exponent', draft.curve_exponent);
    paintChart();
    paintHead();
  };
  p.body.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    const g = t.closest<SVGElement>('[data-grip]');
    if (g) {
      e.preventDefault();
      drag = { k: g.getAttribute('data-grip') as 'a' | 'b', top: yMax };
      z('chart').setPointerCapture(e.pointerId);
      return;
    }
    const s = t.closest<HTMLElement>('[data-dgrip]');
    if (s && daily) {
      e.preventDefault();
      const box = p.body
        .querySelector<HTMLElement>('[data-steps]')!
        .getBoundingClientRect();
      stepDrag = {
        i: Number(s.dataset.dgrip),
        box,
        top: Math.max(1, ...daily.steps, ...daily.default_steps),
      };
      s.setPointerCapture(e.pointerId);
    }
  });
  p.body.addEventListener('pointermove', (e) => {
    if (drag) {
      const r = z('chart').getBoundingClientRect();
      const y = e.clientY - r.top;
      const xp = ((box.h - box.b - y) / (box.h - box.t - box.b)) * drag.top;
      return setGrip(drag.k, Math.max(1, Math.round(xp)));
    }
    if (stepDrag && daily) {
      // La zone de tirage s'arrête au-dessus du champ et du numéro.
      const h = stepDrag.box.height - 58;
      const f = (stepDrag.box.top + h + 4 - e.clientY) / h;
      const i = stepDrag.i;
      const lo = daily.steps[i - 1] ?? 0;
      const hi = Math.min(
        daily.bounds.max_value,
        daily.steps[i + 1] ?? daily.bounds.max_value,
      );
      const v = Math.min(
        hi,
        Math.max(lo, Math.round((f * stepDrag.top) / 50) * 50),
      );
      if (v === daily.steps[i]) return;
      const steps = [...daily.steps];
      steps[i] = v;
      daily = { ...daily, steps };
      setDailyBars();
      const inp = p.body.querySelector<HTMLInputElement>(
        `[data-daily-step="${i}"]`,
      );
      if (inp) inp.value = String(v);
      paintDailyActs();
      return;
    }
    const c = (e.target as HTMLElement).closest('[data-z="chart"]');
    const next = c
      ? Math.round(
          1 +
            ((e.clientX - c.getBoundingClientRect().left - box.l) /
              (box.w - box.l - box.r)) *
              (span - 1),
        )
      : null;
    const lv = next !== null && next >= 2 && next <= span ? next : null;
    if (lv !== hover) {
      hover = lv;
      if (scene === 'xp') paintChart();
    }
  });
  p.body.addEventListener('pointerup', () => {
    if (drag) {
      drag = null;
      fitY();
      paintChart();
    }
    if (stepDrag) {
      stepDrag = null;
      paintDaily();
    }
  });
  p.body.addEventListener('keydown', (e) => {
    const g = (e.target as Element).closest?.('[data-grip]');
    if (!g || !draft || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const k = g.getAttribute('data-grip') as 'a' | 'b';
    const { a, b } = handleLevels();
    const xp = curveXp(k === 'a' ? a : b, draft);
    setGrip(k, Math.round(xp * (e.key === 'ArrowUp' ? 1.03 : 0.97)));
    p.body.querySelector<SVGElement>(`[data-grip="${k}"]`)?.focus();
  });
  scrub(p.root, (i) => i.dispatchEvent(new Event('input', { bubbles: true })));

  return {
    setVisible(v: boolean) {
      if (v) tick.start();
      else tick.stop();
    },
  };
}
