// Défis (docs/CHALLENGES.md) — Studio's « Défis » page, refonte lot 2 (docs/RAPTORU_STUDIO_UX_UI_2026-11-04.md § D.5):
// a catalogue, an atelier in three visible sections (Présentation · Condition et période · Récompense) with a summary
// and the Core's dry-run beside it, and the follow-up of one challenge. Antoni creates his own challenges; nothing is
// pre-filled, nothing is suggested. The Core decides everything (rules, counting, awards).
// Three distinct operations, never mixed: « Enregistrer le brouillon » (Core draft, nothing counted), « Activer… »
// (the Core counts at once: a retroactive challenge can complete and pay immediately) and « Recompter et verser… »
// (a real run: writes progress and pays what is due — not a refresh). The two last ones confirm with their real scope.

import './challenges.css';
import {
  BLANK_FORM,
  challengePayload,
  conditionText,
  formOf,
  type ChallengeForm,
  type Reward,
} from './challenges-model.js';

type Json = Record<string, unknown>;
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
  status: 'draft' | 'active' | 'suspended' | 'archived';
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
  summary: Json | null;
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
    detail: Json | null;
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

const HEADERS = { 'content-type': 'application/json', 'x-raptoru-studio': '1' };
const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!,
  );
const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n);
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-FR') : '—';
const STATUS_FR: Record<Def['status'], string> = {
  draft: 'Brouillon',
  active: 'Actif',
  suspended: 'Suspendu',
  archived: 'Archivé',
};
const PERIOD_FR = {
  once: 'Unique',
  week: 'Chaque semaine',
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
/** Fields frozen once a challenge was activated (the Core refuses them anyway). */
const LOCKED = new Set([
  'metric',
  'target',
  'period',
  'starts_at',
  'ends_at',
  'retroactive',
  'reward_kind',
  'reward_id',
  'reward_amount',
]);
/** Confirmations: each says what the Core will really do (docs Astra § E.2). */
const CONFIRM: Record<string, string> = {
  suspended:
    'Suspendre ce défi ?\n\nPlus de comptage ni de versement tant qu’il est suspendu. Les récompenses déjà versées restent.',
  resume:
    'Reprendre ce défi ?\n\nLe Core recompte aussitôt et verse les récompenses dues. Les événements survenus pendant la suspension, dans la fenêtre comptée, peuvent compter.',
  archived:
    'Archiver ce défi ?\n\nIl disparaît du site (les succès obtenus restent) et ne peut plus être réactivé. Aucune récompense n’est reprise.',
};

type Mode = 'list' | 'edit' | 'detail';

export function mountChallenges(root: HTMLElement) {
  let defs: Def[] = [];
  let lastRun: Run | null = null;
  let metrics: Metric[] = [];
  let items: Item[] = [];
  let form: ChallengeForm = { ...BLANK_FORM };
  let editing: Def | null = null;
  let isNew = true;
  let preview: Preview | null = null;
  let previewAt: Date | null = null;
  let detail: Detail | null = null;
  let mode: Mode = 'list';
  let flash = '';
  let error = '';
  let visible = false;

  const call = async (path: string, body?: unknown) => {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) {
      const problems = out.problems as Preview['problems'] | undefined;
      const fields = out.fields as string[] | undefined;
      throw new Error(
        problems?.length
          ? problems.map((p) => p.message).join(' ')
          : fields?.length
            ? `${String(out.error)} (${fields.join(', ')})`
            : String(out.error ?? `HTTP ${res.status}`),
      );
    }
    return out;
  };
  const load = async () => {
    try {
      const [list, meta] = await Promise.all([
        call('/api/challenges'),
        metrics.length ? null : call('/api/challenges/meta'),
      ]);
      defs = list.challenges as Def[];
      lastRun = (list.last_run as Run | null) ?? null;
      // The definition being edited, as it is now (its status changed from the list).
      if (editing)
        editing =
          defs.find((d) => d.challenge_id === editing!.challenge_id) ?? editing;
      if (meta) {
        metrics = meta.metrics as Metric[];
        items = meta.items as Item[];
      }
      if (detail)
        detail = (await call(
          `/api/challenges/${detail.challenge.challenge_id}`,
        )) as unknown as Detail;
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
    render();
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      flash = ok;
    } catch (e) {
      flash = `Refusé : ${(e as Error).message}`;
    }
    await load();
  };
  const metricOf = (k: string) => metrics.find((m) => m.key === k);
  const rewardText = (r: Reward) =>
    !r
      ? 'aucune'
      : r.kind === 'jetons'
        ? `${fmt(r.amount)} Jetons`
        : `${items.find((i) => i.reward_id === r.reward_id)?.label ?? r.reward_id} (objet)`;
  const chip = (s: Def['status']) =>
    `<span class="rs-chip is-${s}">${esc(STATUS_FR[s])}</span>`;
  const flashHtml = () =>
    flash
      ? `<p class="rs-flash${flash.startsWith('Refusé') ? ' is-bad' : ''}" role="status">${esc(flash)}</p>`
      : '';
  const goList = () => {
    mode = 'list';
    detail = null;
    preview = null;
    render();
    root.scrollIntoView({ block: 'start' });
  };

  function render() {
    if (!visible) return;
    if (error && !defs.length) {
      root.innerHTML = `<div class="rs-page rs-form ch"><header class="rs-page-head"><h1>Défis</h1></header><p class="rs-muted">Défis indisponibles : ${esc(error)} (Core du profil sans le moteur de défis, ou migration absente).</p></div>`;
      return;
    }
    root.innerHTML = `<div class="rs-page rs-form ch">${mode === 'edit' ? editHtml() : mode === 'detail' && detail ? detailHtml() : listHtml()}</div>`;
  }

  // --- Catalogue ---------------------------------------------------------------------------------------------------
  function listHtml() {
    const active = defs.filter((d) => d.status === 'active');
    const pending = active.reduce((n, d) => n + d.stats.awards.pending, 0);
    const failed = active.reduce((n, d) => n + d.stats.awards.failed, 0);
    const runText = lastRun
      ? `Dernier recomptage : ${when(lastRun.finished_at ?? lastRun.started_at)} (${esc(lastRun.trigger)}, ${lastRun.status === 'done' ? 'ok' : esc(lastRun.status)}).`
      : 'Aucun recomptage pour l’instant.';
    return `<header class="rs-page-head rs-head-row"><div><h1>Défis</h1>
        <p>Le Core compte chaque défi à partir des données des modules et verse la récompense une seule fois par viewer et par période. Aucun défi n’existe par défaut : chacun est créé ici.</p></div>
        <button type="button" class="rs-btn primary" data-act="new">Créer un défi</button></header>
      ${flashHtml()}
      ${
        defs.length
          ? `<section class="rs-panel"><h2>Catalogue</h2><div class="rs-scroll"><table class="rs-tbl"><thead><tr><th>Défi</th><th>Condition</th><th>Récompense</th><th>État</th><th class="num">Participants</th><th class="num">Terminés</th><th>Récompenses</th><th></th></tr></thead><tbody>
          ${defs.map(rowHtml).join('')}
          </tbody></table></div></section>`
          : `<section class="rs-panel ch-empty" data-role="empty"><h2>Aucun défi pour l’instant</h2>
          <p>Un défi se prépare en <b>brouillon</b> (enregistré dans le Core, invisible et jamais compté), puis s’<b>active</b> : il apparaît sur le site, le Core le compte et verse sa récompense.</p>
          <button type="button" class="rs-btn primary" data-act="new">Créer un défi</button></section>`
      }
      <section class="rs-panel ch-run" data-role="run"><h2>Recompter</h2>
        <p>${runText}</p>
        <p class="rs-warn">Recompter n’est pas une actualisation : le Core recalcule ${active.length ? `les <b>${fmt(active.length)}</b> défi(s) actif(s)` : 'les défis actifs (aucun en ce moment)'}, enregistre les progressions et <b>verse réellement</b> les récompenses dues${pending || failed ? ` (${fmt(pending)} à verser, ${fmt(failed)} en échec)` : ''}.</p>
        <button type="button" class="rs-btn" data-act="run">Recompter et verser…</button></section>`;
  }

  function rowHtml(d: Def) {
    return `<tr data-row="${esc(d.challenge_id)}">
      <td><b>${esc(d.title)}</b><small><code>${esc(d.challenge_id)}</code> · ${esc(d.category)}${d.visibility === 'secret' ? ' · secret' : ''} · v${d.version}</small></td>
      <td>${esc(conditionText(d, metricOf(d.metric)))}</td>
      <td>${esc(rewardText(d.reward))}</td>
      <td>${chip(d.status)}</td>
      <td class="num">${fmt(d.stats.participants)}</td>
      <td class="num">${fmt(d.stats.completed)}</td>
      <td>${fmt(d.stats.awards.granted)} versée(s)${d.stats.awards.pending ? ` · ${fmt(d.stats.awards.pending)} à verser` : ''}${d.stats.awards.failed ? ` · <b class="bad">${fmt(d.stats.awards.failed)} en échec</b>` : ''}</td>
      <td class="ch-actions">
        <button type="button" class="rs-btn sm quiet" data-edit="${esc(d.challenge_id)}">Modifier</button>
        <button type="button" class="rs-btn sm quiet" data-view="${esc(d.challenge_id)}">Suivi</button>
        ${statusButtons(d)}
      </td></tr>`;
  }

  function statusButtons(d: Def) {
    const b = (to: string, label: string, cls = 'rs-btn sm quiet') =>
      `<button type="button" class="${cls}" data-status="${to}" data-id="${esc(d.challenge_id)}">${label}</button>`;
    if (d.status === 'draft')
      return `${b('active', 'Activer…')} <button type="button" class="rs-btn sm quiet" data-del="${esc(d.challenge_id)}">Supprimer</button>`;
    if (d.status === 'active')
      return `${b('suspended', 'Suspendre')} ${b('archived', 'Archiver')}`;
    if (d.status === 'suspended')
      return `${b('resume', 'Reprendre…')} ${b('archived', 'Archiver')}`;
    return '';
  }

  // --- Atelier -----------------------------------------------------------------------------------------------------
  function editHtml() {
    const locked = !isNew && editing?.status !== 'draft';
    const bad = new Set(preview?.problems.map((p) => p.field) ?? []);
    const at = (f: string) =>
      `${locked && LOCKED.has(f) ? 'disabled' : ''}${bad.has(f) ? ' aria-invalid="true"' : ''}`;
    const m = metricOf(form.metric);
    const title = isNew
      ? 'Nouveau défi'
      : `${esc(editing?.title)} ${chip(editing!.status)}`;
    return `<header class="rs-page-head rs-head-row"><div>
        <button type="button" class="rs-btn sm quiet rs-back" data-act="list">← Tous les défis</button>
        <h1>${title}</h1>
        <p>${isNew ? 'Brouillon : rien n’est compté ni versé avant l’activation.' : locked ? 'Défi déjà activé : sa condition et sa récompense sont figées (seuls les textes et la visibilité changent). Pour une autre condition, archive-le et crée un nouveau défi.' : 'Brouillon enregistré dans le Core : rien n’est compté ni versé avant l’activation.'}</p></div></header>
      ${flashHtml()}
      <div class="ch-atelier" data-role="editor">
        <div class="ch-form">
          <section class="rs-panel rs-step"><h2><i>1</i> Présentation</h2>
            <div class="rs-fields">
              <label class="span2">Titre <input data-f="title" maxlength="80" value="${esc(form.title)}" ${at('title')}><small>80 caractères au plus, visible sur le site.</small></label>
              <label class="span2">Description <textarea data-f="description" maxlength="400" rows="2" ${at('description')}>${esc(form.description)}</textarea><small>Facultative, 400 caractères au plus.</small></label>
              <label>Visibilité <select data-f="visibility" ${at('visibility')}><option value="public" ${form.visibility === 'public' ? 'selected' : ''}>Public</option><option value="secret" ${form.visibility === 'secret' ? 'selected' : ''}>Secret (montré au viewer une fois terminé)</option></select></label>
              <label>Catégorie <input data-f="category" maxlength="32" value="${esc(form.category)}" ${at('category')}><small>Identifiant court (minuscules, chiffres, tirets).</small></label>
            </div>
            <details class="rs-adv" ${isNew ? 'open' : ''}><summary>Paramètres techniques</summary>
              <div class="rs-fields">
                <label>Identifiant <input data-f="challenge_id" maxlength="48" value="${esc(form.challenge_id)}" ${isNew ? '' : 'disabled'} placeholder="ex. mots-1000" ${at('challenge_id')}><small>${isNew ? 'Figé après le premier enregistrement.' : 'Figé.'}</small></label>
                <label>Icône <input data-f="icon" maxlength="32" value="${esc(form.icon)}" placeholder="facultatif (ex. trophy)" ${at('icon')}><small>Une icône inconnue du site s’affiche en trophée.</small></label>
              </div></details>
          </section>
          <section class="rs-panel rs-step"><h2><i>2</i> Condition et période</h2>
            <div class="rs-fields">
              <label class="span2">Métrique <select data-f="metric" ${at('metric')}><option value="">— choisir —</option>${metrics.map((x) => `<option value="${x.key}" ${form.metric === x.key ? 'selected' : ''} ${x.available ? '' : 'disabled'}>${esc(x.label)}${x.available ? '' : ' (pas de source sur ce Core)'}</option>`).join('')}</select>
                ${m ? `<small data-role="metric-note">Source : ${esc(m.source)}. ${esc(m.history)} Premier enregistrement : ${when(m.first_record_at)}.</small>` : ''}</label>
              <label>Seuil <span class="rs-unit"><input type="number" min="1" data-f="target" value="${esc(form.target)}" ${at('target')}><em>${esc(m?.unit ?? '')}</em></span></label>
              <label>Période <select data-f="period" ${at('period')}>${Object.entries(
                PERIOD_FR,
              )
                .map(
                  ([k, v]) =>
                    `<option value="${k}" ${form.period === k ? 'selected' : ''}>${v}</option>`,
                )
                .join('')}</select>
                <small>${form.period === 'week' ? 'Lundi → dimanche, heure de Paris.' : form.period === 'month' ? 'Mois civil.' : 'Une seule fois par viewer.'}</small></label>
              ${m?.granularity === 'period' ? '<p class="rs-note span2">Cette métrique n’a que des totaux par semaine / mois : un défi unique doit être rétroactif et sans dates.</p>' : ''}
              <label class="rs-check span2"><input type="checkbox" data-f="retroactive" ${form.retroactive ? 'checked' : ''} ${at('retroactive')}> <span><b>Rétroactif</b> — compte l’historique que le Core possède déjà${form.retroactive ? ' : <em>à l’activation, les viewers qui remplissent déjà la condition le terminent et reçoivent la récompense aussitôt.</em>' : '.'}</span></label>
              <label>Début <input type="datetime-local" data-f="starts_at" value="${esc(form.starts_at)}" ${at('starts_at')}><small>Facultatif, heure de ce PC.</small></label>
              <label>Fin <input type="datetime-local" data-f="ends_at" value="${esc(form.ends_at)}" ${at('ends_at')}><small>Facultative, heure de ce PC.</small></label>
            </div>
          </section>
          <section class="rs-panel rs-step"><h2><i>3</i> Récompense</h2>
            <div class="rs-fields">
              <label>Type <select data-f="reward_kind" ${at('reward_kind')}><option value="none" ${form.reward_kind === 'none' ? 'selected' : ''}>Aucune</option><option value="reward" ${form.reward_kind === 'reward' ? 'selected' : ''}>Objet de la Boutique</option><option value="jetons" ${form.reward_kind === 'jetons' ? 'selected' : ''}>Jetons</option></select></label>
              ${form.reward_kind === 'reward' ? `<label>Objet <select data-f="reward_id" ${at('reward_id')}><option value="">— choisir —</option>${items.map((i) => `<option value="${esc(i.reward_id)}" ${form.reward_id === i.reward_id ? 'selected' : ''}>${esc(i.label)} (${esc(i.kind)})</option>`).join('')}</select></label>` : ''}
              ${form.reward_kind === 'jetons' ? `<label>Montant <span class="rs-unit"><input type="number" min="1" data-f="reward_amount" value="${esc(form.reward_amount)}" ${at('reward_amount')}><em>Jetons</em></span></label>` : ''}
            </div>
            ${form.reward_kind === 'reward' && !items.length ? '<p class="rs-note">Aucun objet publié dans la Boutique : crée-le d’abord dans <a href="/?p=shop">Boutique</a>.</p>' : ''}
            <p class="rs-muted">Versée automatiquement, une seule fois par viewer${form.period === 'once' ? '' : ' <b>et par période</b> (elle se répète chaque ' + (form.period === 'week' ? 'semaine' : 'mois') + ')'}. Aucun budget maximal n’est garanti : il dépend du nombre de viewers qui termineront.</p>
          </section>
        </div>
        <aside class="ch-side">
          <section class="rs-panel" data-role="summary"><h2>Résumé</h2>${summaryHtml()}</section>
          <section class="rs-panel"><h2>Vérification</h2>
            <p class="rs-muted">Simulation par le Core, sans aucune écriture.</p>
            <button type="button" class="rs-btn" data-act="check">Vérifier et prévisualiser</button>
            ${previewHtml()}
          </section>
          <section class="rs-panel ch-actions-panel">
            <button type="button" class="rs-btn primary" data-act="save">${isNew ? 'Enregistrer le brouillon' : 'Enregistrer'}</button>
            ${!isNew && editing ? `<div class="ch-state">${statusButtons(editing).replaceAll('rs-btn sm quiet', 'rs-btn')}</div>` : '<p class="rs-muted">L’activation se fera après l’enregistrement, avec sa propre confirmation.</p>'}
            ${!isNew && editing ? `<button type="button" class="rs-btn quiet" data-view="${esc(editing.challenge_id)}">Voir le suivi</button>` : ''}
          </section>
        </aside>
      </div>`;
  }

  function summaryHtml() {
    const p = challengePayload(form);
    const m = metricOf(form.metric);
    const cond =
      form.metric && Number.isFinite(p.target) && p.target > 0
        ? esc(conditionText(p, m))
        : '<span class="rs-muted">Choisis une métrique et un seuil.</span>';
    const reward: Reward = p.reward;
    return `<dl class="rs-dl">
      <dt>Titre</dt><dd>${p.title ? esc(p.title) : '<span class="rs-muted">à saisir</span>'}${p.visibility === 'secret' ? ' · secret' : ''}</dd>
      <dt>Condition</dt><dd>${cond}</dd>
      ${m ? `<dt>Source</dt><dd>${esc(m.source)}</dd>` : ''}
      <dt>Récompense</dt><dd>${reward && reward.kind === 'jetons' && !(reward.amount > 0) ? '<span class="rs-muted">montant à saisir</span>' : esc(rewardText(reward))}${reward && form.period !== 'once' ? ' · par période' : ''}</dd>
      <dt>État</dt><dd>${isNew ? 'Non enregistré' : chip(editing!.status)}</dd>
    </dl>`;
  }

  function previewHtml() {
    if (!preview) return '';
    const p = preview;
    return `<div class="ch-preview" data-role="preview">
      ${p.problems.length ? `<p><b>À corriger avant l’activation :</b></p><ul>${p.problems.map((x) => `<li>${esc(x.message)}</li>`).join('')}</ul>` : '<p class="ok"><b>Condition valide.</b></p>'}
      ${p.windows
        .map(
          (w) =>
            `<p>Si le défi était activé maintenant (${esc(w.period_key === 'all' ? 'période unique' : w.period_key)}, ${w.from ? `du ${when(w.from)}` : 'tout l’historique'} ${w.to ? `au ${when(w.to)}` : 'sans fin'}) : <b>${fmt(w.participants)}</b> viewer(s) compteraient, <b data-role="completing">${fmt(w.completing)}</b> le termineraient aussitôt.</p>${w.top.length ? `<p class="rs-muted">En tête : ${w.top.map((t) => `${esc(t.name)} (${fmt(t.value)})`).join(', ')}</p>` : ''}`,
        )
        .join('')}
      <p class="rs-muted">Calculé ${previewAt ? `à ${previewAt.toLocaleTimeString('fr-FR')}` : ''} ; l’activation recompte et peut donner un autre résultat.</p>
    </div>`;
  }

  // --- Suivi -------------------------------------------------------------------------------------------------------
  function detailHtml() {
    const d = detail!;
    const c = d.challenge;
    return `<header class="rs-page-head rs-head-row"><div>
        <button type="button" class="rs-btn sm quiet rs-back" data-act="list">← Tous les défis</button>
        <h1>Suivi — ${esc(c.title)} ${chip(c.status)}</h1>
        <p>${esc(conditionText(c, metricOf(c.metric)))} Récompense : ${esc(rewardText(c.reward))}.</p></div>
        <button type="button" class="rs-btn" data-edit="${esc(c.challenge_id)}">Modifier</button></header>
      ${flashHtml()}
      <div data-role="detail">
      <section class="rs-panel"><h2>Progressions</h2><div class="rs-scroll">
      <table class="rs-tbl"><thead><tr><th>Période</th><th>Viewer</th><th>Valeur</th><th>Terminé</th></tr></thead><tbody>
      ${d.progress.map((p) => `<tr><td>${esc(p.period_key)}</td><td>${esc(p.name)}</td><td>${fmt(p.value)} / ${fmt(p.target)}</td><td>${p.completed_at ? when(p.completed_at) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="rs-muted">Personne n’a encore progressé.</td></tr>'}
      </tbody></table></div></section>
      <section class="rs-panel"><h2>Récompenses</h2>
      <p class="rs-muted">« Retirer… » ne concerne que les objets : il marque l’attribution retirée et retire l’objet au viewer (même s’il l’avait obtenu ailleurs). Les Jetons ne se reprennent pas d’ici.</p><div class="rs-scroll">
      <table class="rs-tbl"><thead><tr><th>Période</th><th>Viewer</th><th>Récompense</th><th>État</th><th></th></tr></thead><tbody>
      ${
        d.awards
          .map(
            (a) =>
              `<tr><td>${esc(a.period_key)}</td><td>${esc(a.name)}</td><td>${esc(rewardText(a.reward))}</td><td>${esc(AWARD_FR[a.status] ?? a.status)}${a.error ? ` (${esc(a.error)}, ${a.attempts} essai(s))` : ''}${a.revoke_reason ? ` — ${esc(a.revoke_reason)}` : ''}</td><td>${a.status !== 'revoked' && a.reward?.kind === 'reward' ? `<button type="button" class="rs-btn sm quiet" data-revoke="${esc(a.viewer)}" data-name="${esc(a.name)}" data-period="${esc(a.period_key)}">Retirer…</button>` : ''}</td></tr>`,
          )
          .join('') ||
        '<tr><td colspan="5" class="rs-muted">Aucune récompense.</td></tr>'
      }
      </tbody></table></div></section>
      <section class="rs-panel"><h2>Journal (100 dernières lignes)</h2><div class="rs-scroll">
      <table class="rs-tbl"><thead><tr><th>Quand</th><th>Quoi</th><th>Viewer</th><th>Avant → après</th><th>Détail</th></tr></thead><tbody>
      ${d.log.map((l) => `<tr><td>${when(l.at)}</td><td>${esc(LOG_FR[l.kind] ?? l.kind)}</td><td>${esc(l.name ?? l.actor ?? '')}</td><td>${l.before === null && l.after === null ? '' : `${l.before ?? '∅'} → ${l.after ?? '∅'}`}</td><td class="rs-muted">${l.detail ? esc(JSON.stringify(l.detail)) : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="rs-muted">Vide.</td></tr>'}
      </tbody></table></div></section>
      </div>`;
  }

  /** Activation: the rule that will be frozen, retroactivity, reward, and the last dry-run if it was for this form. */
  function activationText(d: Def) {
    const sameForm =
      editing?.challenge_id === d.challenge_id &&
      preview &&
      !preview.problems.length;
    const completing = sameForm
      ? preview!.windows.reduce((n, w) => n + w.completing, 0)
      : null;
    return [
      `Activer « ${d.title} » ?`,
      '',
      `Règle figée après activation : ${conditionText(d, metricOf(d.metric))}`,
      `Récompense : ${rewardText(d.reward)}${d.reward && d.period !== 'once' ? ' (par viewer et par période)' : ' (une fois par viewer)'}.`,
      d.retroactive
        ? `Rétroactif : le Core compte aussitôt l’historique ; les viewers qui remplissent déjà la condition le terminent et reçoivent la récompense immédiatement${completing !== null ? ` (dernière vérification : ${completing} viewer(s))` : ''}.`
        : 'Non rétroactif : seuls les événements à partir de maintenant comptent.',
      'Le défi apparaît sur le site. Un recomptage est lancé tout de suite.',
    ].join('\n');
  }

  function runText() {
    const active = defs.filter((d) => d.status === 'active');
    const pending = active.reduce((n, d) => n + d.stats.awards.pending, 0);
    const failed = active.reduce((n, d) => n + d.stats.awards.failed, 0);
    return [
      'Recompter et verser les récompenses ?',
      '',
      `Le Core recalcule ${active.length} défi(s) actif(s) à partir des données des modules, enregistre les progressions et verse réellement les récompenses dues (actuellement ${pending} à verser, ${failed} en échec, plus les nouvelles complétions).`,
      'Ce n’est pas une simple actualisation de l’écran.',
    ].join('\n');
  }

  // Inputs update the form without redrawing (the cursor stays); selects / checkboxes redraw (dependent fields).
  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const f = el.dataset.f as keyof ChallengeForm | undefined;
    if (!f) return;
    (form as unknown as Record<string, unknown>)[f] =
      el.type === 'checkbox' ? el.checked : el.value;
    if (el.tagName === 'SELECT' || el.type === 'checkbox') {
      preview = null;
      render();
    } else {
      const s = root.querySelector('[data-role="summary"]');
      if (s) s.innerHTML = `<h2>Résumé</h2>${summaryHtml()}`;
    }
  });
  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!el) return;
    const a = el.dataset.act;
    if (a === 'new') {
      form = { ...BLANK_FORM };
      editing = null;
      isNew = true;
      preview = null;
      flash = '';
      mode = 'edit';
      render();
      root.scrollIntoView({ block: 'start' });
    } else if (a === 'list') {
      flash = '';
      goList();
    } else if (a === 'run') {
      if (!confirm(runText())) return;
      void act(() => call('/api/challenges/run', {}), 'Recomptage terminé.');
    } else if (a === 'check')
      void (async () => {
        try {
          preview = (await call(
            '/api/challenges/preview',
            challengePayload(form),
          )) as unknown as Preview;
          previewAt = new Date();
          flash = '';
        } catch (e) {
          preview = null;
          flash = `Refusé : ${(e as Error).message}`;
        }
        render();
      })();
    else if (a === 'save')
      void act(async () => {
        const body = challengePayload(form);
        const out = isNew
          ? await call('/api/challenges', body)
          : await call(`/api/challenges/${body.challenge_id}`, body);
        editing = out.challenge as Def;
        isNew = false;
      }, 'Enregistré.');
    else if (el.dataset.edit) {
      const d = defs.find((x) => x.challenge_id === el.dataset.edit)!;
      form = formOf(d);
      editing = d;
      isNew = false;
      preview = null;
      flash = '';
      mode = 'edit';
      render();
      root.scrollIntoView({ block: 'start' });
    } else if (el.dataset.view)
      void (async () => {
        try {
          detail = (await call(
            `/api/challenges/${el.dataset.view}`,
          )) as unknown as Detail;
          mode = 'detail';
          flash = '';
        } catch (e) {
          flash = `Refusé : ${(e as Error).message}`;
        }
        render();
        root.scrollIntoView({ block: 'start' });
      })();
    else if (el.dataset.status) {
      const d = defs.find((x) => x.challenge_id === el.dataset.id);
      if (!d) return;
      const to = el.dataset.status === 'resume' ? 'active' : el.dataset.status;
      const text =
        el.dataset.status === 'active'
          ? activationText(d)
          : CONFIRM[el.dataset.status];
      if (!confirm(text ?? 'Confirmer ?')) return;
      void act(
        () => call(`/api/challenges/${d.challenge_id}/status`, { status: to }),
        `${STATUS_FR[to as Def['status']] ?? to}.`,
      );
    } else if (el.dataset.del) {
      if (
        !confirm(
          'Supprimer ce brouillon ?\n\nIl n’a jamais été compté ni versé ; son identifiant redevient libre.',
        )
      )
        return;
      void act(async () => {
        await call(`/api/challenges/${el.dataset.del}/delete`, {});
        if (editing?.challenge_id === el.dataset.del) {
          editing = null;
          mode = 'list';
        }
      }, 'Brouillon supprimé.');
    } else if (el.dataset.revoke && detail) {
      const reason = prompt(
        `Retirer l’objet donné à ${el.dataset.name ?? 'ce viewer'} (${el.dataset.period}) ?\n\nL’objet lui est retiré et déséquipé, même s’il l’avait obtenu ailleurs. Raison (visible dans le journal) :`,
      );
      if (!reason || reason.trim().length < 3) return;
      void act(
        () =>
          call(`/api/challenges/${detail!.challenge.challenge_id}/revoke`, {
            period_key: el.dataset.period,
            viewer: el.dataset.revoke,
            reason: reason.trim(),
          }),
        'Récompense retirée.',
      );
    }
  });

  return {
    setVisible(v: boolean) {
      visible = v;
      if (v) void load();
    },
  };
}
