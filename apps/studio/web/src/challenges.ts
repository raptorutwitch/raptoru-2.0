// Défis (docs/CHALLENGES.md) — Studio's « Défis » tab: Antoni creates his own challenges (a metric, a threshold, a
// period, retroactive or not, a reward from the Boutique catalogue or Jetons), checks them (server rules + who would
// count / complete right now), activates, suspends, archives; follows progress, awards and the log; recounts on demand
// and takes back an item given by mistake. The Core decides everything; nothing is pre-filled, nothing is suggested.

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

export function mountChallenges(root: HTMLElement) {
  let defs: Def[] = [];
  let lastRun: Run | null = null;
  let metrics: Metric[] = [];
  let items: Item[] = [];
  let form: ChallengeForm = { ...BLANK_FORM };
  let editing: Def | null = null;
  let isNew = true;
  let preview: Preview | null = null;
  let detail: Detail | null = null;
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

  function render() {
    if (!visible) return;
    if (error && !defs.length) {
      root.innerHTML = `<div class="hw"><h2>🏆 Défis</h2><p class="muted">Défis indisponibles : ${esc(error)} (Core du profil sans le moteur de défis, ou migration absente).</p></div>`;
      return;
    }
    const locked = !isNew && editing?.status !== 'draft';
    const dis = (f: string) => (locked && LOCKED.has(f) ? 'disabled' : '');
    const m = metricOf(form.metric);
    const runText = lastRun
      ? `Dernier recomptage : ${when(lastRun.finished_at ?? lastRun.started_at)} (${esc(lastRun.trigger)}, ${lastRun.status === 'done' ? 'ok' : esc(lastRun.status)})`
      : 'Aucun recomptage pour l’instant.';
    root.innerHTML = `<div class="hw ch">
      <header class="hw-head"><h2>🏆 Défis</h2><span class="hw-flash">${esc(flash)}</span></header>
      <p class="muted">Le Core compte chaque défi à partir des données des modules et verse la récompense une seule fois par viewer et par période. Aucun défi n’existe par défaut : chaque défi est créé ici. ${runText} <button type="button" data-act="run">Recompter maintenant</button></p>
      <div class="hw-grid">
        <section class="card wide"><h3>Défis</h3>
          <table class="tbl"><thead><tr><th>Défi</th><th>Condition</th><th>Récompense</th><th>État</th><th>Participants</th><th>Terminés</th><th>Récompenses</th><th></th></tr></thead><tbody>
          ${
            defs
              .map(
                (d) => `<tr data-row="${esc(d.challenge_id)}">
                  <td><b>${esc(d.title)}</b><br><code>${esc(d.challenge_id)}</code> · ${esc(d.category)}${d.visibility === 'secret' ? ' · secret' : ''} · v${d.version}</td>
                  <td>${esc(conditionText(d, metricOf(d.metric)))}</td>
                  <td>${esc(rewardText(d.reward))}</td>
                  <td>${esc(STATUS_FR[d.status])}</td>
                  <td>${fmt(d.stats.participants)}</td>
                  <td>${fmt(d.stats.completed)}</td>
                  <td>${fmt(d.stats.awards.granted)} versée(s)${d.stats.awards.pending ? ` · ${fmt(d.stats.awards.pending)} à verser` : ''}${d.stats.awards.failed ? ` · <b>${fmt(d.stats.awards.failed)} en échec</b>` : ''}</td>
                  <td class="ch-actions">
                    <button type="button" class="link" data-edit="${esc(d.challenge_id)}">Modifier</button>
                    <button type="button" class="link" data-view="${esc(d.challenge_id)}">Suivi</button>
                    ${d.status === 'draft' ? `<button type="button" class="link" data-status="active" data-id="${esc(d.challenge_id)}">Activer</button> <button type="button" class="link" data-del="${esc(d.challenge_id)}">Supprimer</button>` : ''}
                    ${d.status === 'active' ? `<button type="button" class="link" data-status="suspended" data-id="${esc(d.challenge_id)}">Suspendre</button>` : ''}
                    ${d.status === 'suspended' ? `<button type="button" class="link" data-status="active" data-id="${esc(d.challenge_id)}">Reprendre</button>` : ''}
                    ${d.status !== 'archived' && d.status !== 'draft' ? `<button type="button" class="link" data-status="archived" data-id="${esc(d.challenge_id)}">Archiver</button>` : ''}
                  </td></tr>`,
              )
              .join('') ||
            '<tr><td colspan="8" class="muted">Aucun défi. Crée le premier ci-dessous.</td></tr>'
          }
          </tbody></table>
          <button type="button" data-act="new">Nouveau défi</button>
        </section>
        <section class="card wide" data-role="editor"><h3>${isNew ? 'Nouveau défi (brouillon)' : `Modifier « ${esc(editing?.title)} » — ${esc(STATUS_FR[editing!.status])}`}</h3>
          ${locked ? '<p class="muted">Défi déjà activé : sa condition et sa récompense sont figées (seuls les textes et la visibilité changent). Pour une autre condition, archive-le et crée un nouveau défi.</p>' : ''}
          <div class="row-in">
            <label>Identifiant <input data-f="challenge_id" maxlength="48" value="${esc(form.challenge_id)}" ${isNew ? '' : 'disabled'} placeholder="ex. mots-1000"></label>
            <label>Titre <input data-f="title" maxlength="80" value="${esc(form.title)}"></label>
            <label>Catégorie <input data-f="category" maxlength="32" value="${esc(form.category)}"></label>
            <label>Icône <input data-f="icon" maxlength="32" value="${esc(form.icon)}" placeholder="facultatif (ex. trophy)"></label>
            <label>Visibilité <select data-f="visibility"><option value="public" ${form.visibility === 'public' ? 'selected' : ''}>Public</option><option value="secret" ${form.visibility === 'secret' ? 'selected' : ''}>Secret (montré une fois terminé)</option></select></label>
          </div>
          <label class="row">Description <input data-f="description" maxlength="400" value="${esc(form.description)}"></label>
          <h4>Condition</h4>
          <div class="row-in">
            <label>Métrique <select data-f="metric" ${dis('metric')}><option value="">— choisir —</option>${metrics.map((x) => `<option value="${x.key}" ${form.metric === x.key ? 'selected' : ''} ${x.available ? '' : 'disabled'}>${esc(x.label)}${x.available ? '' : ' (pas de source sur ce Core)'}</option>`).join('')}</select></label>
            <label>Seuil <input type="number" min="1" data-f="target" value="${esc(form.target)}" ${dis('target')}> ${esc(m?.unit ?? '')}</label>
            <label>Période <select data-f="period" ${dis('period')}>${Object.entries(
              PERIOD_FR,
            )
              .map(
                ([k, v]) =>
                  `<option value="${k}" ${form.period === k ? 'selected' : ''}>${v}</option>`,
              )
              .join('')}</select></label>
            <label><input type="checkbox" data-f="retroactive" ${form.retroactive ? 'checked' : ''} ${dis('retroactive')}> rétroactif (compte l’historique existant)</label>
            <label>Début <input type="datetime-local" data-f="starts_at" value="${esc(form.starts_at)}" ${dis('starts_at')}></label>
            <label>Fin <input type="datetime-local" data-f="ends_at" value="${esc(form.ends_at)}" ${dis('ends_at')}></label>
          </div>
          ${m ? `<p class="muted" data-role="metric-note">Source : ${esc(m.source)}. ${esc(m.history)} Premier enregistrement : ${when(m.first_record_at)}.${m.granularity === 'period' ? ' Totaux par semaine / mois seulement : un défi unique doit être rétroactif et sans dates.' : ''}</p>` : ''}
          <h4>Récompense</h4>
          <div class="row-in">
            <label>Type <select data-f="reward_kind" ${dis('reward_kind')}><option value="none" ${form.reward_kind === 'none' ? 'selected' : ''}>Aucune</option><option value="reward" ${form.reward_kind === 'reward' ? 'selected' : ''}>Objet de la Boutique</option><option value="jetons" ${form.reward_kind === 'jetons' ? 'selected' : ''}>Jetons</option></select></label>
            ${form.reward_kind === 'reward' ? `<label>Objet <select data-f="reward_id" ${dis('reward_id')}><option value="">— choisir —</option>${items.map((i) => `<option value="${esc(i.reward_id)}" ${form.reward_id === i.reward_id ? 'selected' : ''}>${esc(i.label)} (${esc(i.kind)})</option>`).join('')}</select></label>` : ''}
            ${form.reward_kind === 'jetons' ? `<label>Montant <input type="number" min="1" data-f="reward_amount" value="${esc(form.reward_amount)}" ${dis('reward_amount')}> Jetons</label>` : ''}
          </div>
          ${form.reward_kind === 'reward' && !items.length ? '<p class="muted">Aucun objet publié dans la Boutique : crée-le d’abord dans l’onglet Boutique.</p>' : ''}
          <p class="muted">Versée automatiquement, une seule fois par viewer${form.period === 'once' ? '' : ' et par période'}.</p>
          <div class="row-in">
            <button type="button" data-act="check">Vérifier et prévisualiser</button>
            <button type="button" data-act="save">${isNew ? 'Enregistrer le brouillon' : 'Enregistrer'}</button>
          </div>
          ${previewHtml()}
        </section>
        ${detailHtml()}
      </div></div>`;
  }

  function previewHtml() {
    if (!preview) return '';
    const p = preview;
    return `<div class="ch-preview" data-role="preview">
      ${p.problems.length ? `<p><b>À corriger avant l’activation :</b></p><ul>${p.problems.map((x) => `<li>${esc(x.message)}</li>`).join('')}</ul>` : '<p><b>Condition valide.</b></p>'}
      ${p.windows
        .map(
          (w) =>
            `<p>Si le défi était activé maintenant (${esc(w.period_key === 'all' ? 'période unique' : w.period_key)}, ${w.from ? `du ${when(w.from)}` : 'tout l’historique'} ${w.to ? `au ${when(w.to)}` : 'sans fin'}) : <b>${fmt(w.participants)}</b> viewer(s) compteraient, <b data-role="completing">${fmt(w.completing)}</b> le termineraient aussitôt.</p>${w.top.length ? `<p class="muted">En tête : ${w.top.map((t) => `${esc(t.name)} (${fmt(t.value)})`).join(', ')}</p>` : ''}`,
        )
        .join('')}
    </div>`;
  }

  function detailHtml() {
    if (!detail) return '';
    const d = detail;
    return `<section class="card wide" data-role="detail"><h3>Suivi — ${esc(d.challenge.title)}</h3>
      <h4>Progressions</h4>
      <table class="tbl"><thead><tr><th>Période</th><th>Viewer</th><th>Valeur</th><th>Terminé</th></tr></thead><tbody>
      ${d.progress.map((p) => `<tr><td>${esc(p.period_key)}</td><td>${esc(p.name)}</td><td>${fmt(p.value)} / ${fmt(p.target)}</td><td>${p.completed_at ? when(p.completed_at) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Personne n’a encore progressé.</td></tr>'}
      </tbody></table>
      <h4>Récompenses</h4>
      <table class="tbl"><thead><tr><th>Période</th><th>Viewer</th><th>Récompense</th><th>État</th><th></th></tr></thead><tbody>
      ${
        d.awards
          .map(
            (a) =>
              `<tr><td>${esc(a.period_key)}</td><td>${esc(a.name)}</td><td>${esc(rewardText(a.reward))}</td><td>${esc(AWARD_FR[a.status] ?? a.status)}${a.error ? ` (${esc(a.error)}, ${a.attempts} essai(s))` : ''}${a.revoke_reason ? ` — ${esc(a.revoke_reason)}` : ''}</td><td>${a.status !== 'revoked' && a.reward?.kind === 'reward' ? `<button type="button" class="link" data-revoke="${esc(a.viewer)}" data-period="${esc(a.period_key)}">Retirer…</button>` : ''}</td></tr>`,
          )
          .join('') ||
        '<tr><td colspan="5" class="muted">Aucune récompense.</td></tr>'
      }
      </tbody></table>
      <h4>Journal (100 dernières lignes)</h4>
      <table class="tbl"><thead><tr><th>Quand</th><th>Quoi</th><th>Viewer</th><th>Avant → après</th><th>Détail</th></tr></thead><tbody>
      ${d.log.map((l) => `<tr><td>${when(l.at)}</td><td>${esc(LOG_FR[l.kind] ?? l.kind)}</td><td>${esc(l.name ?? l.actor ?? '')}</td><td>${l.before === null && l.after === null ? '' : `${l.before ?? '∅'} → ${l.after ?? '∅'}`}</td><td class="muted">${l.detail ? esc(JSON.stringify(l.detail)) : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Vide.</td></tr>'}
      </tbody></table>
      <button type="button" data-act="close-detail">Fermer le suivi</button>
    </section>`;
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
      render();
    } else if (a === 'run')
      void act(async () => {
        const r = await call('/api/challenges/run', {});
        flash = '';
        return r;
      }, 'Recomptage terminé.');
    else if (a === 'check')
      void (async () => {
        try {
          preview = (await call(
            '/api/challenges/preview',
            challengePayload(form),
          )) as unknown as Preview;
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
    else if (a === 'close-detail') {
      detail = null;
      render();
    } else if (el.dataset.edit) {
      const d = defs.find((x) => x.challenge_id === el.dataset.edit)!;
      form = formOf(d);
      editing = d;
      isNew = false;
      preview = null;
      render();
      root
        .querySelector('[data-role="editor"]')
        ?.scrollIntoView({ block: 'start' });
    } else if (el.dataset.view)
      void (async () => {
        try {
          detail = (await call(
            `/api/challenges/${el.dataset.view}`,
          )) as unknown as Detail;
        } catch (e) {
          flash = `Refusé : ${(e as Error).message}`;
        }
        render();
      })();
    else if (el.dataset.status) {
      const to = el.dataset.status;
      const labels: Record<string, string> = {
        active:
          'Activer ce défi ? Le Core le compte aussitôt (rétroactif : les viewers qui remplissent déjà la condition le terminent et reçoivent la récompense).',
        suspended:
          'Suspendre ce défi ? Plus de comptage ni de versement tant qu’il est suspendu.',
        archived:
          'Archiver ce défi ? Il disparaît du site (les succès obtenus restent) et ne peut plus être réactivé.',
      };
      if (!confirm(labels[to] ?? 'Confirmer ?')) return;
      void act(
        () => call(`/api/challenges/${el.dataset.id}/status`, { status: to }),
        `${STATUS_FR[to as Def['status']] ?? to}.`,
      );
    } else if (el.dataset.del) {
      if (!confirm('Supprimer ce brouillon ?')) return;
      void act(
        () => call(`/api/challenges/${el.dataset.del}/delete`, {}),
        'Brouillon supprimé.',
      );
    } else if (el.dataset.revoke && detail) {
      const reason = prompt('Raison du retrait (visible dans le journal) :');
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
