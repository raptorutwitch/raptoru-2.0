import {
  BLANK_FORM,
  challengePayload,
  conditionText,
  engineState,
  formOf,
  type ChallengeForm,
  type Engine,
  type Reward,
} from '../challenges-model.js';
import {
  choiceBox,
  confirmBox,
  errText,
  esc,
  fld,
  fmt,
  ic,
  keyed,
  menu,
  page,
  patch,
  poller,
  pp,
  seg,
  stateChip,
  sw,
  toast,
  type IcName,
} from '../ds/ds.js';
import { ApiError, getJson, postJson } from '../http.js';
import { slug } from './progression-model.js';

// Les Défis : on construit la condition en la lisant, comme une phrase dont chaque mot se choisit, et on voit la carte telle que
// le site l'affichera. Trois opérations jamais mêlées : enregistrer un brouillon (rien n'est compté), activer (le Core compte
// aussitôt et peut verser) et recompter (une vraie passe qui paie, pas une actualisation). Antoni crée seul ses défis : rien
// n'est prérempli, rien n'est suggéré. Le Core décide de tout.

type Status = 'draft' | 'active' | 'suspended' | 'archived';
interface Metric {
  key: string;
  label: string;
  unit: string;
  source: string;
  granularity: 'exact' | 'period';
  history: string;
  available: boolean;
  first_record_at: string | null;
}
interface Item {
  reward_id: string;
  kind: string;
  label: string;
}
interface Def {
  challenge_id: string;
  version: number;
  title: string;
  description: string;
  category: string;
  icon: string | null;
  metric: string;
  target: number;
  period: 'once' | 'week' | 'month';
  starts_at: string | null;
  ends_at: string | null;
  retroactive: boolean;
  visibility: 'public' | 'secret';
  reward: Reward;
  status: Status;
  activated_at: string | null;
  stats: {
    participants: number;
    completed: number;
    awards: { pending: number; failed: number; granted: number };
  };
}
interface Run {
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger: string;
  summary: Record<string, unknown> | null;
  error: string | null;
}
interface Detail {
  challenge: Def;
  progress: {
    period_key: string;
    viewer: string;
    name: string;
    value: number;
    target: number;
    completed_at: string | null;
  }[];
  awards: {
    period_key: string;
    viewer: string;
    name: string;
    reward: Reward;
    status: string;
    attempts: number;
    error: string | null;
    granted_at: string | null;
    revoke_reason: string | null;
  }[];
  log: {
    id: number;
    period_key: string | null;
    viewer: string | null;
    kind: string;
    before: number | null;
    after: number | null;
    name: string | null;
    detail: Record<string, unknown> | null;
    actor: string | null;
    at: string;
  }[];
}
interface Preview {
  problems: { field: string; code: string; message: string }[];
  windows: {
    period_key: string;
    from: string | null;
    to: string | null;
    participants: number;
    completing: number;
    top: { viewer: string; name: string; value: number }[];
  }[];
}

const STATUS_FR: Record<Status, string> = {
  draft: 'Brouillon',
  active: 'Actif',
  suspended: 'Suspendu',
  archived: 'Archivé',
};
const STATUS_TAG: Record<Status, string> = {
  draft: 'off',
  active: 'ok',
  suspended: 'warn',
  archived: 'off',
};
const PERIODS = [
  ['once', 'Une seule fois', 'Une fois par viewer.'],
  ['week', 'Chaque semaine', 'Lundi → dimanche, heure de Paris.'],
  ['month', 'Chaque mois', 'Mois civil.'],
] as const;
const PERIOD_SITE: Record<string, string> = {
  once: 'Unique',
  week: 'Chaque semaine (lundi → dimanche)',
  month: 'Chaque mois',
};
const AWARD_FR: Record<string, string> = {
  pending: 'à verser',
  granted: 'versée',
  failed: 'échec (réessayée)',
  revoked: 'retirée',
};
const LOG_FR: Record<string, string> = {
  progress: 'Progression',
  completed: 'Terminé',
  below_target: 'Repassé sous le seuil',
  award_granted: 'Récompense versée',
  award_failed: 'Récompense en échec',
  award_revoked: 'Récompense retirée',
  admin: 'Administration',
};
const METRIC_ICON: Record<string, IcName> = {
  words_found: 'note',
  words_fast: 'bolt',
  raffle_joins: 'ticket',
  raffle_wins: 'trophy',
  daily_claims: 'repeat',
  random_ban_sent: 'ban',
  random_ban_landed: 'ban',
  random_ban_received: 'shield',
  paid_bonk: 'hand',
  paid_tts: 'mic',
  paid_soundboard: 'sound',
  duels_won: 'crown',
  watch_minutes: 'clock',
  messages: 'chat',
};
const iconOf = (k: string): IcName => METRIC_ICON[k] ?? 'star';
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'jamais';
const periodName = (k: string | null) => {
  if (!k || k === 'all') return 'Unique';
  const w = /^w(\d{4})-(\d{2})-(\d{2})$/.exec(k);
  if (w)
    return `Semaine du ${new Date(`${w[1]}-${w[2]}-${w[3]}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
  const m = /^m(\d{4})-(\d{2})$/.exec(k);
  return m
    ? new Date(`${m[1]}-${m[2]}-15T12:00:00Z`).toLocaleDateString('fr-FR', {
        month: 'long',
        year: 'numeric',
      })
    : k;
};
const plural = (n: number, u: string) =>
  Math.abs(n) <= 1 ? u.replace(/s$/, '') : u;
/** La règle du seuil : logarithmique, de 1 à 1 million. */
const LOG_MAX = 6;
const target2x = (v: number) => (Math.log10(Math.max(1, v)) / LOG_MAX) * 100;
const x2target = (x: number) => {
  const raw = 10 ** ((x / 100) * LOG_MAX);
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
  return Math.max(1, Math.round(raw / mag) * mag);
};

/** Ce que le Core refuse, dans ses mots : les problèmes de la définition, ou les champs. */
function refus(e: unknown) {
  const d = (e as ApiError).details as
    { problems?: { message: string }[]; fields?: string[] } | undefined;
  if (d?.problems?.length) return d.problems.map((p) => p.message).join(' ');
  if (d?.fields?.length) return `Champs à revoir : ${d.fields.join(', ')}.`;
  return errText(e);
}

export function mountChallengesPage(root: HTMLElement) {
  const p = page(root, { title: 'Défis', mod: 'challenges' });
  p.body.innerHTML = `<div class="ch">
    <div class="ch-list" data-mode="list">
      <section class="ch-cat">
        <div class="ch-line" data-z="filter"></div>
        <div class="ch-rows" data-z="rows"></div>
      </section>
      <aside class="ch-rail" data-z="rail"></aside>
    </div>
    <div class="ch-edit" data-mode="edit" data-role="editor" hidden>
      <section class="ch-build">
        <div class="ch-line"><button type="button" class="d-btn ghost sm" data-act="list">${ic('back')}Tous les défis</button><span class="d-faint" data-z="lock"></span></div>
        <input class="ch-title" data-f="title" maxlength="80" placeholder="Nom du défi" aria-label="Titre du défi">
        <input class="ch-desc" data-f="description" maxlength="400" placeholder="Une description, si elle aide" aria-label="Description">
        <div class="ch-phrase" data-z="phrase"></div>
        <div class="ch-pick" data-z="pick"></div>
        <div class="ch-time" data-z="time"></div>
        <details class="d-acc" data-z="tech"><summary>Détails techniques</summary>
          <div class="ch-tech">
            <label class="ch-fl"><span>Identifiant</span><span class="d-fld"><input type="text" data-f="challenge_id" maxlength="48" placeholder="ex. mots-1000"></span></label>
            <label class="ch-fl"><span>Catégorie</span><span class="d-fld"><input type="text" data-f="category" maxlength="32"></span></label>
            <label class="ch-fl"><span>Icône</span><span class="d-fld"><input type="text" data-f="icon" maxlength="32" placeholder="facultatif"></span></label>
          </div>
        </details>
      </section>
      <aside class="ch-side">
        <div data-role="summary" data-z="summary"></div>
        <div class="ch-check"><button type="button" class="d-btn" data-act="check">${ic('eye')}Vérifier et prévisualiser</button><div data-z="preview"></div></div>
        <div class="ch-acts" data-z="acts"></div>
      </aside>
    </div>
    <div class="ch-follow" data-mode="detail" data-role="detail" hidden data-z="detail"></div>
  </div>`;
  const z = (k: string) =>
    p.body.querySelector<HTMLElement>(`[data-z="${k}"]`)!;
  const input = (k: string) =>
    p.body.querySelector<HTMLInputElement>(`[data-f="${k}"]`)!;

  let defs: Def[] = [];
  let lastRun: Run | null = null;
  let engine: Engine | undefined;
  let metrics: Metric[] = [];
  let items: Item[] = [];
  let loaded = false;
  let error = '';
  let mode: 'list' | 'edit' | 'detail' = 'list';
  let filter = 'all';
  let form: ChallengeForm = { ...BLANK_FORM };
  let editing: Def | null = null;
  let isNew = true;
  let idTouched = false;
  let open: 'metric' | 'target' | 'period' | 'reward' = 'metric';
  let preview: Preview | null = null;
  let previewAt: Date | null = null;
  let detail: Detail | null = null;
  let busy = false;

  const metricOf = (k: string) => metrics.find((m) => m.key === k);
  const locked = () => !isNew && editing?.status !== 'draft';
  const rewardText = (r: Reward) =>
    !r
      ? 'aucune'
      : r.kind === 'jetons'
        ? `${fmt(r.amount)} Jetons`
        : `${items.find((i) => i.reward_id === r.reward_id)?.label ?? r.reward_id} (objet)`;

  // --- Lectures ---------------------------------------------------------------------------------------------------------
  async function read() {
    try {
      const [list, meta] = await Promise.all([
        getJson<{ challenges: Def[]; last_run: Run | null; engine?: Engine }>(
          '/api/challenges',
        ),
        metrics.length
          ? null
          : getJson<{ metrics: Metric[]; items: Item[] }>(
              '/api/challenges/meta',
            ),
      ]);
      defs = list.challenges;
      lastRun = list.last_run;
      engine = list.engine;
      if (meta) {
        metrics = meta.metrics;
        items = meta.items;
      }
      if (editing)
        editing =
          defs.find((d) => d.challenge_id === editing!.challenge_id) ?? editing;
      if (detail)
        detail = await getJson<Detail>(
          `/api/challenges/${detail.challenge.challenge_id}`,
        );
      loaded = true;
      error = '';
    } catch (e) {
      error = errText(e);
    }
    paint();
  }
  const tick = poller(read, 6000);
  /** Une opération à la fois ; un refus du Core est dit dans ses mots, puis tout est relu. */
  async function go(
    btn: HTMLElement | null,
    fn: () => Promise<unknown>,
    done: string,
  ) {
    if (busy) return false;
    busy = true;
    btn?.classList.add('is-busy');
    let ok = false;
    try {
      await fn();
      toast(done);
      ok = true;
    } catch (e) {
      toast(refus(e), { bad: true });
    } finally {
      busy = false;
      btn?.classList.remove('is-busy');
    }
    await read();
    return ok;
  }

  // --- Dessin -----------------------------------------------------------------------------------------------------------
  function paintHead() {
    const e = engineState(engine, lastRun, metrics, Date.now());
    patch(
      p.state,
      error && !loaded
        ? stateChip('r', 'Défis injoignables')
        : !loaded
          ? stateChip('w', 'Lecture…')
          : stateChip(
              e.tone === 'ok'
                ? ''
                : e.tone === 'off'
                  ? 'off'
                  : e.tone === 'down'
                    ? 'r'
                    : 'w',
              e.short,
            ),
    );
    patch(
      p.actions,
      mode === 'list'
        ? `<button type="button" class="d-btn" data-act="run">${ic('repeat')}Recompter et verser…</button><button type="button" class="d-btn pri" data-act="new">${ic('plus')}Créer un défi</button>`
        : '',
    );
  }
  function statusMenu(d: Def, anchor: HTMLElement) {
    const s = (to: string, label: string, kind?: 'bad' | 'ok') => ({
      label,
      kind,
      run: () => void changeStatus(d, to, anchor),
    });
    menu(anchor, '', [
      {
        label: 'Modifier',
        icon: 'sliders',
        run: () => openEdit(d),
      },
      { label: 'Suivi', icon: 'pulse', run: () => void openDetail(d) },
      '-',
      d.status === 'draft' && s('active', 'Activer…', 'ok'),
      d.status === 'active' && s('suspended', 'Suspendre'),
      d.status === 'suspended' && s('resume', 'Reprendre…', 'ok'),
      (d.status === 'active' || d.status === 'suspended') &&
        s('archived', 'Archiver…', 'bad'),
      d.status === 'draft' && {
        label: 'Supprimer le brouillon…',
        kind: 'bad',
        run: () => void del(d, anchor),
      },
    ]);
  }
  function paintList() {
    const counts = (k: string) =>
      k === 'all' ? defs.length : defs.filter((d) => d.status === k).length;
    patch(
      z('filter'),
      defs.length
        ? seg(
            'data-filter',
            [
              ['all', `Tous ${counts('all')}`],
              ['active', `Actifs ${counts('active')}`],
              ['draft', `Brouillons ${counts('draft')}`],
              ['suspended', `Suspendus ${counts('suspended')}`],
              ['archived', `Archivés ${counts('archived')}`],
            ],
            filter,
          )
        : '',
    );
    const list = defs.filter((d) => filter === 'all' || d.status === filter);
    keyed(
      z('rows'),
      list.map((d) => {
        const m = metricOf(d.metric);
        const part = d.stats.participants;
        const pct = part ? (d.stats.completed / part) * 100 : 0;
        const a = d.stats.awards;
        return {
          key: d.challenge_id,
          html: `<div class="ch-r d-in" data-row="${esc(d.challenge_id)}">
          <button type="button" class="ch-r__m" data-open="${esc(d.challenge_id)}">
            <span class="ch-ic">${ic(iconOf(d.metric))}</span>
            <span class="ch-r__t"><b>${esc(d.title)}</b><small>${fmt(d.target)} ${esc(plural(d.target, m?.unit ?? ''))} · ${esc(m?.label ?? d.metric)} · ${esc(PERIODS.find(([k]) => k === d.period)?.[1] ?? '')}${d.visibility === 'secret' ? ' · secret' : ''}</small></span>
            <span class="ch-r__n"><span class="ch-bar"><i style="width:${pct}%"></i></span><small>${fmt(d.stats.completed)} / ${fmt(part)} terminés</small></span>
            <span class="ch-r__w"><b>${esc(rewardText(d.reward))}</b><small>${fmt(a.granted)} versée${a.granted > 1 ? 's' : ''}${a.pending ? ` · ${fmt(a.pending)} à verser` : ''}${a.failed ? ` · <em>${fmt(a.failed)} en échec</em>` : ''}</small></span>
            <span class="d-tag ${STATUS_TAG[d.status]}">${STATUS_FR[d.status]}</span>
          </button>
          <button type="button" class="d-btn ghost sm" data-view="${esc(d.challenge_id)}">Suivi</button>
          <button type="button" class="d-ib" data-more="${esc(d.challenge_id)}" aria-label="Actions pour ${esc(d.title)}">${ic('more')}</button></div>`,
        };
      }),
      !loaded
        ? `<div class="d-empty">${esc(error || 'Lecture…')}</div>`
        : defs.length
          ? '<div class="d-empty">Aucun défi dans ce filtre.</div>'
          : `<div class="ch-none" data-role="empty"><b>Aucun défi pour l’instant</b><p>Un défi se prépare en brouillon, invisible et jamais compté, puis s’active : il apparaît sur le site, Raptoru le compte et verse sa récompense.</p><button type="button" class="d-btn pri" data-act="new">Créer un défi</button></div>`,
    );
    const e = engineState(engine, lastRun, metrics, Date.now());
    const active = defs.filter((d) => d.status === 'active');
    const pending = active.reduce((n, d) => n + d.stats.awards.pending, 0);
    const failed = active.reduce((n, d) => n + d.stats.awards.failed, 0);
    patch(
      z('rail'),
      `<section class="ch-eng" data-role="engine"><h3>${ic('pulse')}Moteur</h3><p class="${e.tone === 'down' ? 'bad' : e.tone === 'ok' ? 'ok' : ''}">${esc(e.text)}</p>${e.missing ? `<p class="d-note">${esc(e.missing)}</p>` : ''}</section>
      <section class="ch-eng" data-role="run"><h3>${ic('repeat')}Recompter</h3>
        <p>${lastRun ? `Dernier passage ${esc(when(lastRun.finished_at ?? lastRun.started_at))} (${lastRun.trigger === 'manual' ? 'à la main' : 'automatique'}), ${lastRun.status === 'done' ? 'réussi' : esc(lastRun.status)}.` : 'Aucun passage pour l’instant.'}</p>
        <p class="d-note">Recompter n’est pas une actualisation : Raptoru recalcule ${active.length ? `${fmt(active.length)} défi${active.length > 1 ? 's' : ''} actif${active.length > 1 ? 's' : ''}` : 'les défis actifs (aucun en ce moment)'}, enregistre les progressions et verse les récompenses dues${pending || failed ? ` (${fmt(pending)} à verser, ${fmt(failed)} en échec)` : ''}.</p></section>`,
    );
  }

  // --- Atelier ----------------------------------------------------------------------------------------------------------
  const tok = (
    k: typeof open,
    text: string,
    empty: boolean,
    ic0: IcName | '' = '',
  ) =>
    `<button type="button" class="ch-tok ${open === k ? 'on d-vf' : ''} ${empty ? 'empty' : ''}" data-tok="${k}" ${locked() ? 'disabled' : ''}>${ic0 ? ic(ic0) : ''}${esc(text)}</button>`;
  function paintPhrase() {
    const m = metricOf(form.metric);
    const n = Number(form.target);
    const per =
      PERIODS.find(([k]) => k === form.period)?.[1].toLowerCase() ?? '';
    const reward =
      form.reward_kind === 'none'
        ? 'rien de plus'
        : form.reward_kind === 'jetons'
          ? form.reward_amount
            ? `${fmt(Number(form.reward_amount))} Jetons`
            : 'des Jetons'
          : (items.find((i) => i.reward_id === form.reward_id)?.label ??
            'un objet');
    patch(
      z('phrase'),
      `<span>Un viewer doit atteindre</span>${tok('target', form.target ? `${fmt(n)}${m ? ` ${plural(n, m.unit)}` : ''}` : 'combien ?', !form.target)}<span>de</span>${tok('metric', m?.label ?? 'quoi ?', !m, m ? iconOf(m.key) : '')}<span>,</span>${tok('period', per, false)}<span>, et reçoit</span>${tok('reward', reward, form.reward_kind === 'none')}`,
    );
  }
  function paintPick() {
    const lk = locked();
    const dis = lk ? 'disabled' : '';
    const m = metricOf(form.metric);
    let html: string;
    if (open === 'metric')
      html = `<div class="ch-tiles">${metrics
        .map(
          (x) =>
            `<button type="button" class="ch-tile ${form.metric === x.key ? 'on' : ''}" data-metric="${esc(x.key)}" ${x.available && !lk ? '' : 'disabled'} title="${esc(x.available ? x.history : 'Pas de source ici')}">${ic(iconOf(x.key))}<span>${esc(x.label)}</span></button>`,
        )
        .join('')}</div>${
        m
          ? `<div data-role="metric-note"><p class="d-note">${esc(m.history)}${m.first_record_at ? ` Premier enregistrement : ${esc(when(m.first_record_at))}.` : ''}</p>
          ${m.granularity === 'period' ? '<p class="d-note">Cette mesure n’a que des totaux par semaine ou par mois : un défi unique doit être rétroactif et sans dates.</p>' : ''}
          <details class="d-acc"><summary>Détails techniques</summary><p class="d-note">Source : ${esc(m.source)}</p></details></div>`
          : ''
      }`;
    else if (open === 'target') {
      const v = Number(form.target) || 1;
      const top = preview?.windows[0]?.top ?? [];
      html = `<div class="ch-goal"><div class="d-row"><span>Seuil</span>${fld(`data-f="target" min="1" max="1000000000" aria-label="Seuil" ${dis}`, form.target, m?.unit ?? '')}</div>
        <div class="ch-ruler"><input type="range" class="d-range" data-tgt min="0" max="100" step="0.5" value="${target2x(v)}" aria-label="Seuil sur la règle" ${dis}>
          <div class="ch-ticks">${[1, 10, 100, '1 k', '10 k', '100 k', '1 M'].map((t) => `<span>${t}</span>`).join('')}</div>
          ${top.map((t) => `<i class="ch-pin" style="left:${target2x(t.value)}%" title="${esc(t.name)} : ${fmt(t.value)}"></i>`).join('')}</div>
        ${top.length ? '<p class="d-note">Les repères : où en sont les premiers viewers d’après la dernière vérification.</p>' : ''}</div>`;
    } else if (open === 'period')
      html = `<div class="ch-pers">${PERIODS.map(
        ([k, l, hint]) =>
          `<button type="button" class="ch-per ${form.period === k ? 'on' : ''}" data-per="${k}" ${dis}><span class="ch-cal ${k}">${k === 'once' ? '<i></i>' : k === 'week' ? '<i></i><i></i><i></i><i></i>' : '<i></i><i></i>'}</span><b>${l}</b><small>${hint}</small></button>`,
      ).join('')}</div>`;
    else
      html = `<div class="ch-pers">${(
        [
          ['none', 'x', 'Aucune', 'Le défi se suffit.'],
          ['jetons', 'coin', 'Des Jetons', 'Versés sur le Wallet.'],
          ['reward', 'gift', 'Un objet', 'Titre, badge, cadre ou bannière.'],
        ] as const
      )
        .map(
          ([k, i0, l, hint]) =>
            `<button type="button" class="ch-per ${form.reward_kind === k ? 'on' : ''}" data-rw="${k}" ${dis}>${ic(i0)}<b>${l}</b><small>${hint}</small></button>`,
        )
        .join('')}</div>
        ${form.reward_kind === 'jetons' ? `<div class="d-row"><span>Montant</span>${fld(`data-f="reward_amount" min="1" aria-label="Montant" ${dis}`, form.reward_amount, 'Jetons')}</div>` : ''}
        ${
          form.reward_kind === 'reward'
            ? items.length
              ? `<div class="ch-objs">${items.map((i) => `<button type="button" class="d-tag ${form.reward_id === i.reward_id ? 'ok' : ''}" data-rw-item="${esc(i.reward_id)}" ${dis}>${esc(i.label)}</button>`).join('')}</div>`
              : '<p class="d-note">Aucun objet publié : crée-le d’abord dans la <a href="/?p=shop">Boutique</a>.</p>'
            : ''
        }
        <p class="d-note">${engine?.enabled ? 'Versée automatiquement' : 'Versée au prochain « Recompter et verser » (comptage automatique coupé)'}, une seule fois par viewer${form.period === 'once' ? '' : ` et par ${form.period === 'week' ? 'semaine' : 'mois'}`}. Aucun budget maximal n’est garanti : il dépend du nombre de viewers qui termineront.</p>`;
    z('pick').innerHTML = html;
  }
  /** Le temps compté, en repères : passé, activation, à venir. Une schéma, les vraies dates sont écrites dessous. */
  function paintTime() {
    const lk = locked();
    const f = form;
    const now = 50;
    const at = (v: string) => {
      const d = Date.parse(v);
      return d < Date.now() ? 26 : 68;
    };
    const from = f.starts_at ? at(f.starts_at) : f.retroactive ? 2 : now;
    const to = f.ends_at ? Math.max(from + 6, at(f.ends_at) + 18) : 100;
    const beats =
      f.period === 'once'
        ? ''
        : Array.from({ length: f.period === 'week' ? 12 : 5 }, (_, i) => {
            const x = ((i + 1) / (f.period === 'week' ? 13 : 6)) * 100;
            return x > from && x < to
              ? `<i class="ch-beat" style="left:${x}%"></i>`
              : '';
          }).join('');
    z('time').innerHTML =
      `<div class="ch-tl" aria-hidden="true"><span class="ch-tl__past"></span><span class="ch-tl__on" style="left:${from}%;width:${to - from}%"></span>${beats}<i class="ch-now" style="left:${now}%"></i><small style="left:${now}%">Activation</small><small class="l">Passé</small><small class="r">${f.ends_at ? 'Fin' : 'Sans fin'}</small></div>
      <div class="ch-tlrow">
        <div class="d-row"><span>Compter le passé</span>${sw(f.retroactive, 'data-f="retroactive"', 'Rétroactif', { disabled: lk })}</div>
        <label class="ch-fl"><span>Début, heure de ce PC</span><span class="d-fld"><input type="datetime-local" data-f="starts_at" value="${esc(f.starts_at)}" ${lk ? 'disabled' : ''}></span></label>
        <label class="ch-fl"><span>Fin, heure de ce PC</span><span class="d-fld"><input type="datetime-local" data-f="ends_at" value="${esc(f.ends_at)}" ${lk ? 'disabled' : ''}></span></label>
      </div>
      ${f.retroactive ? '<p class="d-note warn">Rétroactif : à l’activation, les viewers qui remplissent déjà la condition le terminent et reçoivent la récompense aussitôt.</p>' : ''}`;
  }
  function paintSummary() {
    const b = challengePayload(form);
    const m = metricOf(form.metric);
    const r = b.reward;
    const u = plural(b.target || 0, m?.unit ?? '');
    patch(
      z('summary'),
      `<div class="ch-state"><span class="d-lb">Sur raptoru.fr</span><span class="d-tag ${isNew ? 'off' : STATUS_TAG[editing!.status]}">${isNew ? 'Non enregistré' : STATUS_FR[editing!.status]}</span></div>
      <div class="ch-card ${b.visibility === 'secret' ? 'secret' : ''}">
        <header><span class="ch-cic">${ic(m ? iconOf(m.key) : 'trophy')}</span><div><h4>${esc(b.title || 'Nom du défi')}</h4><p>${esc(PERIOD_SITE[b.period] ?? '')}</p></div></header>
        ${b.description ? `<p class="ch-cdesc">${esc(b.description)}</p>` : ''}
        <p class="ch-cgoal">${ic('eye')}${b.target > 0 && m ? `Objectif : ${fmt(b.target)} ${esc(u)}, ${esc(m.label)}${b.retroactive ? '' : ' (compté depuis l’ouverture)'}` : 'Choisis une mesure et un seuil.'}</p>
        <div class="ch-cprog"><span></span></div>
        <p class="ch-cnum"><b>0</b> / ${b.target > 0 ? fmt(b.target) : '?'} ${esc(u)}</p>
        <p class="ch-crw">${r ? (r.kind === 'jetons' ? `${ic('coin')}<b>${r.amount > 0 ? fmt(r.amount) : '?'} Jetons</b>` : `${ic('gift')}<b>${esc(rewardText(r))}</b>`) : 'Sans récompense'}${r && form.period !== 'once' ? '<small>par période</small>' : ''}</p>
      </div>
      <div class="ch-vis">${seg(
        'data-vis',
        [
          ['public', 'Public'],
          ['secret', 'Secret'],
        ],
        form.visibility,
        'block',
      )}<small>${form.visibility === 'secret' ? 'Montré au viewer une fois terminé.' : 'Visible par tous sur le site.'}</small></div>`,
    );
  }
  function paintPreview() {
    const r = preview;
    patch(
      z('preview'),
      r
        ? `<div class="ch-prev" data-role="preview">
        ${r.problems.length ? `<p class="bad"><b>À corriger avant l’activation :</b></p><ul>${r.problems.map((x) => `<li>${esc(x.message)}</li>`).join('')}</ul>` : '<p class="ok"><b>Condition valide.</b></p>'}
        ${r.windows
          .map(
            (w) =>
              `<p>Activé maintenant (${esc(periodName(w.period_key))}) : <b>${fmt(w.participants)}</b> viewer${w.participants > 1 ? 's' : ''} compteraient, <b data-role="completing">${fmt(w.completing)}</b> le termineraient aussitôt.</p>${w.top.length ? `<p class="d-note">En tête : ${w.top.map((t) => `${esc(t.name)} (${fmt(t.value)})`).join(', ')}</p>` : ''}`,
          )
          .join('')}
        <p class="d-note">Calculé ${previewAt ? `à ${previewAt.toLocaleTimeString('fr-FR')}` : ''}, sans rien écrire. L’activation recompte et peut donner un autre résultat.</p></div>`
        : '<p class="d-note">Une simulation, sans aucune écriture.</p>',
    );
  }
  function paintActs() {
    const d = editing;
    const st = (to: string, label: string, cls = '') =>
      d
        ? `<button type="button" class="d-btn ${cls}" data-status="${to}" data-id="${esc(d.challenge_id)}">${label}</button>`
        : '';
    patch(
      z('acts'),
      `<button type="button" class="d-btn pri" data-act="save">${isNew ? 'Enregistrer le brouillon' : 'Enregistrer'}</button>
      ${isNew || !d ? '<p class="d-note">L’activation vient après, avec sa propre confirmation.</p>' : ''}
      ${d?.status === 'draft' ? st('active', 'Activer…') : ''}
      ${d?.status === 'active' ? `${st('suspended', 'Suspendre')}${st('archived', 'Archiver…', 'bad')}` : ''}
      ${d?.status === 'suspended' ? `${st('resume', 'Reprendre…')}${st('archived', 'Archiver…', 'bad')}` : ''}
      ${d?.status === 'draft' ? `<button type="button" class="d-btn bad" data-del="${esc(d.challenge_id)}">Supprimer</button>` : ''}
      ${d ? `<button type="button" class="d-btn ghost" data-view="${esc(d.challenge_id)}">Voir le suivi</button>` : ''}`,
    );
  }
  const syncInputs = () => {
    for (const k of [
      'title',
      'description',
      'challenge_id',
      'category',
      'icon',
    ] as const)
      input(k).value = form[k];
    input('challenge_id').disabled = !isNew;
    (z('tech') as HTMLDetailsElement).open = isNew;
    patch(
      z('lock'),
      isNew
        ? 'Brouillon : rien n’est compté ni versé avant l’activation.'
        : locked()
          ? `${ic('lock')} Défi déjà activé : sa condition et sa récompense sont figées. Seuls les textes et la visibilité changent.`
          : 'Brouillon enregistré : rien n’est compté ni versé avant l’activation.',
    );
  };
  function paintEdit() {
    paintPhrase();
    paintPick();
    paintTime();
    paintSummary();
    paintPreview();
    paintActs();
  }
  /** Quand la condition change : la phrase, la carte ; la dernière vérification ne vaut plus. */
  const conditionChanged = () => {
    preview = null;
    paintPhrase();
    paintSummary();
    paintPreview();
  };

  // --- Suivi ------------------------------------------------------------------------------------------------------------
  function paintDetail() {
    if (!detail) return;
    const d = detail;
    const c = d.challenge;
    const m = metricOf(c.metric);
    patch(
      z('detail'),
      `<div class="ch-line"><button type="button" class="d-btn ghost sm" data-act="list">${ic('back')}Tous les défis</button><span class="d-sp"></span><button type="button" class="d-btn sm" data-edit="${esc(c.challenge_id)}">Modifier</button></div>
      <div class="ch-fh"><span class="ch-ic">${ic(iconOf(c.metric))}</span><div><h2>${esc(c.title)} <span class="d-tag ${STATUS_TAG[c.status]}">${STATUS_FR[c.status]}</span></h2><p>${esc(conditionText(c, m))} Récompense : ${esc(rewardText(c.reward))}.</p></div></div>
      <div class="ch-fcols">
        <section><h3>Progressions</h3><div class="ch-fl-s">${
          d.progress
            .map(
              (x) =>
                `<div class="ch-pr ${x.completed_at ? 'done' : ''}">${pp(x.name, 26)}<span class="ch-pr__n"><b>${esc(x.name)}</b><small>${esc(periodName(x.period_key))}${x.completed_at ? ` · terminé le ${esc(when(x.completed_at))}` : ''}</small></span><span class="ch-pr__v"><span class="ch-bar"><i style="width:${Math.min(100, (x.value / Math.max(1, x.target)) * 100)}%"></i></span><small>${fmt(x.value)} / ${fmt(x.target)}</small></span></div>`,
            )
            .join('') || '<p class="d-faint">Personne n’a encore progressé.</p>'
        }</div></section>
        <section><h3>Récompenses</h3><div class="ch-fl-s">${
          d.awards
            .map(
              (a) =>
                `<div class="ch-aw"><span><b>${esc(a.name)}</b><small>${esc(periodName(a.period_key))} · ${esc(rewardText(a.reward))}</small></span><span class="d-tag ${a.status === 'granted' ? 'ok' : a.status === 'failed' ? 'bad' : a.status === 'pending' ? 'warn' : 'off'}">${esc(AWARD_FR[a.status] ?? a.status)}</span>${a.status !== 'revoked' && a.reward?.kind === 'reward' ? `<button type="button" class="d-btn bad sm" data-revoke="${esc(a.viewer)}" data-name="${esc(a.name)}" data-period="${esc(a.period_key)}">Retirer…</button>` : ''}${a.error ? `<small class="ch-awe" title="${esc(a.error)}">Versement en échec, ${a.attempts} essai${a.attempts > 1 ? 's' : ''}</small>` : ''}${a.revoke_reason ? `<small class="ch-awe">${esc(a.revoke_reason)}</small>` : ''}</div>`,
            )
            .join('') || '<p class="d-faint">Aucune récompense.</p>'
        }</div><p class="d-note">« Retirer » ne concerne que les objets : l’objet est retiré au viewer, même s’il l’avait obtenu ailleurs. Les Jetons ne se reprennent pas d’ici.</p>
        <h3>Journal</h3><div class="ch-log">${
          d.log
            .map(
              (l) =>
                `<div title="${esc(l.detail ? JSON.stringify(l.detail) : '')}"><time>${esc(when(l.at))}</time><b>${esc(LOG_FR[l.kind] ?? l.kind)}</b><span>${esc(l.name ?? l.actor ?? '')}</span><small>${l.before === null && l.after === null ? '' : `${l.before ?? '∅'} → ${l.after ?? '∅'}`}</small></div>`,
            )
            .join('') || '<p class="d-faint">Vide.</p>'
        }</div></section>
      </div>`,
    );
  }

  function paint() {
    paintHead();
    for (const el of p.body.querySelectorAll<HTMLElement>('[data-mode]'))
      el.hidden = el.dataset.mode !== mode;
    if (mode === 'list') paintList();
    if (mode === 'detail') paintDetail();
    if (mode === 'edit') {
      paintSummary();
      paintActs();
      if (!metrics.length) return;
      if (!z('pick').childElementCount) paintEdit();
    }
  }

  // --- Opérations ---------------------------------------------------------------------------------------------------------
  function openEdit(d: Def | null) {
    editing = d;
    isNew = !d;
    form = d ? formOf(d) : { ...BLANK_FORM };
    idTouched = false;
    preview = null;
    open = 'metric';
    mode = 'edit';
    paint();
    syncInputs();
    paintEdit();
    if (!d) input('title').focus();
    // Un objet créé entre-temps dans la Boutique doit pouvoir servir de récompense.
    void getJson<{ metrics: Metric[]; items: Item[] }>(
      '/api/challenges/meta',
    ).then(
      (m) => {
        metrics = m.metrics;
        items = m.items;
        paintPhrase();
        paintPick();
      },
      () => null,
    );
  }
  async function openDetail(d: Def) {
    try {
      detail = await getJson<Detail>(`/api/challenges/${d.challenge_id}`);
      mode = 'detail';
      paint();
    } catch (e) {
      toast(refus(e), { bad: true });
    }
  }
  const activationText = (d: Def) => {
    const same =
      editing?.challenge_id === d.challenge_id &&
      preview &&
      !preview.problems.length;
    const completing = same
      ? preview!.windows.reduce((n, w) => n + w.completing, 0)
      : null;
    return [
      `Règle figée après activation : ${conditionText(d, metricOf(d.metric))}`,
      `Récompense : ${rewardText(d.reward)}${d.reward && d.period !== 'once' ? ' (par viewer et par période).' : ' (une fois par viewer).'}`,
      d.retroactive
        ? `Rétroactif : l’historique est compté aussitôt ; les viewers qui remplissent déjà la condition le terminent et reçoivent la récompense immédiatement${completing !== null ? ` (dernière vérification : ${completing} viewer(s))` : ''}.`
        : 'Non rétroactif : seuls les événements à partir de maintenant comptent.',
      'Le défi apparaît sur le site. Un recomptage est lancé tout de suite.',
    ].join(' ');
  };
  async function changeStatus(d: Def, how: string, btn: HTMLElement | null) {
    const to = how === 'resume' ? 'active' : how;
    const asks: Record<string, [string, string, string]> = {
      active: [`Activer « ${d.title} » ?`, activationText(d), 'Activer'],
      suspended: [
        'Suspendre ce défi ?',
        'Plus de comptage ni de versement tant qu’il est suspendu. Les récompenses déjà versées restent.',
        'Suspendre',
      ],
      resume: [
        'Reprendre ce défi ?',
        'Le défi est recompté aussitôt et les récompenses dues sont versées. Les événements survenus pendant la suspension, dans la fenêtre comptée, peuvent compter.',
        'Reprendre',
      ],
      archived: [
        'Archiver ce défi ?',
        'Il disparaît du site, les succès obtenus restent, et il ne peut plus être réactivé. Aucune récompense n’est reprise.',
        'Archiver',
      ],
    };
    const [title, body, yes] = asks[how]!;
    if (
      !(await confirmBox({
        title,
        body,
        yes,
        no: 'Annuler',
        danger: how === 'archived',
      }))
    )
      return;
    await go(
      btn,
      () =>
        postJson(`/api/challenges/${d.challenge_id}/status`, { status: to }),
      `${STATUS_FR[to as Status] ?? to}.`,
    );
    if (mode === 'edit') {
      syncInputs();
      paintEdit();
    }
  }
  async function del(d: Def, btn: HTMLElement | null) {
    if (
      !(await confirmBox({
        title: 'Supprimer ce brouillon ?',
        body: 'Il n’a jamais été compté ni versé ; son identifiant redevient libre.',
        yes: 'Supprimer',
        no: 'Garder',
      }))
    )
      return;
    await go(
      btn,
      async () => {
        await postJson(`/api/challenges/${d.challenge_id}/delete`, {});
        if (editing?.challenge_id === d.challenge_id) {
          editing = null;
          mode = 'list';
        }
      },
      'Brouillon supprimé.',
    );
  }

  p.root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    const a = b.dataset.act;
    const byId = (id?: string) => defs.find((d) => d.challenge_id === id);
    if (a === 'new') return openEdit(null);
    if (a === 'list') {
      mode = 'list';
      detail = null;
      editing = null;
      preview = null;
      return paint();
    }
    if (b.dataset.filter) {
      filter = b.dataset.filter;
      return paintList();
    }
    if (b.dataset.open) {
      const d = byId(b.dataset.open);
      return d?.status === 'draft' ? openEdit(d) : void (d && openDetail(d));
    }
    if (b.dataset.more) {
      const d = byId(b.dataset.more);
      if (d) statusMenu(d, b);
      return;
    }
    if (b.dataset.view) {
      const d = byId(b.dataset.view);
      if (d) void openDetail(d);
      return;
    }
    if (b.dataset.edit) {
      const d = byId(b.dataset.edit);
      if (d) {
        detail = null;
        openEdit(d);
      }
      return;
    }
    if (b.dataset.tok) {
      open = b.dataset.tok as typeof open;
      paintPhrase();
      return paintPick();
    }
    if (b.dataset.metric) {
      form.metric = b.dataset.metric;
      conditionChanged();
      paintPick();
      return;
    }
    if (b.dataset.per) {
      form.period = b.dataset.per as ChallengeForm['period'];
      conditionChanged();
      paintPick();
      paintTime();
      return;
    }
    if (b.dataset.rw) {
      form.reward_kind = b.dataset.rw as ChallengeForm['reward_kind'];
      conditionChanged();
      return paintPick();
    }
    if (b.dataset.rwItem) {
      form.reward_id = b.dataset.rwItem;
      conditionChanged();
      return paintPick();
    }
    if (b.dataset.vis) {
      form.visibility = b.dataset.vis as ChallengeForm['visibility'];
      return paintSummary();
    }
    if (a === 'run') {
      const active = defs.filter((d) => d.status === 'active');
      const pending = active.reduce((n, d) => n + d.stats.awards.pending, 0);
      const failed = active.reduce((n, d) => n + d.stats.awards.failed, 0);
      void confirmBox({
        title: 'Recompter et verser les récompenses ?',
        body: `Raptoru recalcule ${active.length} défi(s) actif(s) à partir des données des modules, enregistre les progressions et verse réellement les récompenses dues (actuellement ${pending} à verser, ${failed} en échec, plus les nouvelles complétions). Ce n’est pas une simple actualisation de l’écran.`,
        yes: 'Recompter et verser',
        no: 'Annuler',
        danger: false,
      }).then((yes) => {
        if (yes)
          void go(
            b,
            () => postJson('/api/challenges/run', {}),
            'Recomptage terminé.',
          );
      });
      return;
    }
    if (a === 'check') {
      void (async () => {
        b.classList.add('is-busy');
        try {
          preview = await postJson<Preview>(
            '/api/challenges/preview',
            challengePayload(form),
          );
          previewAt = new Date();
        } catch (x) {
          preview = null;
          toast(refus(x), { bad: true });
        }
        b.classList.remove('is-busy');
        paintPreview();
        if (open === 'target') paintPick();
      })();
      return;
    }
    if (a === 'save') {
      void go(
        b,
        async () => {
          const body = challengePayload(form);
          const out = await postJson<{ challenge: Def }>(
            isNew ? '/api/challenges' : `/api/challenges/${body.challenge_id}`,
            body,
          );
          editing = out.challenge;
          isNew = false;
        },
        'Enregistré.',
      ).then(() => {
        syncInputs();
        paintActs();
        paintSummary();
      });
      return;
    }
    if (b.dataset.status) {
      const d = byId(b.dataset.id);
      if (d) void changeStatus(d, b.dataset.status, b);
      return;
    }
    if (b.dataset.del) {
      const d = byId(b.dataset.del);
      if (d) void del(d, b);
      return;
    }
    if (b.dataset.revoke && detail) {
      const id = detail.challenge.challenge_id;
      void choiceBox({
        title: `Retirer l’objet de ${b.dataset.name ?? 'ce viewer'}`,
        body: 'L’objet lui est retiré et déséquipé, même s’il l’avait obtenu ailleurs.',
        choices: [],
        field: { label: 'Raison (visible dans le journal)', required: true },
        yes: 'Retirer',
        danger: true,
      }).then((r) => {
        if (!r) return;
        if (r.text.length < 3)
          return toast('Raison de 3 caractères au moins.', { bad: true });
        void go(
          b,
          () =>
            postJson(`/api/challenges/${id}/revoke`, {
              period_key: b.dataset.period,
              viewer: b.dataset.revoke,
              reason: r.text,
            }),
          'Récompense retirée.',
        );
      });
    }
  });
  p.root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-tgt]')) {
      form.target = String(x2target(Number(t.value)));
      const n = p.body.querySelector<HTMLInputElement>('[data-f="target"]');
      if (n) n.value = form.target;
      return conditionChanged();
    }
    const f = t.dataset.f as keyof ChallengeForm | undefined;
    if (!f) return;
    (form as unknown as Record<string, unknown>)[f] =
      t.type === 'checkbox' ? t.checked : t.value;
    if (f === 'challenge_id') idTouched = true;
    if (f === 'title' && isNew && !idTouched) {
      form.challenge_id = slug(t.value);
      input('challenge_id').value = form.challenge_id;
    }
    if (f === 'target') {
      const r = p.body.querySelector<HTMLInputElement>('[data-tgt]');
      if (r) r.value = String(target2x(Number(t.value) || 1));
    }
    if (f === 'retroactive' || f === 'starts_at' || f === 'ends_at') {
      preview = null;
      paintPreview();
      if (f === 'retroactive') paintTime();
      paintSummary();
      return;
    }
    if (f === 'title' || f === 'description') return paintSummary();
    if (f === 'target' || f === 'reward_amount') {
      preview = null;
      paintPhrase();
      paintSummary();
      paintPreview();
    }
  });

  return {
    setVisible(v: boolean) {
      if (v) tick.start();
      else tick.stop();
    },
  };
}
