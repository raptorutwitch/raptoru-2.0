import {
  AWARD,
  esc,
  monthLabel,
  recoveryLabel,
  SOURCE,
  STATUS,
  type SwSpinView,
  time,
} from './sub-wheel-view.js';

// Roue du Sub V2 — Studio « Droits » (RV2-2, pure part, tested): one viewer found by its pseudo, what it can use now,
// its real draws and gains, and the three operations kept apart — « Lancer » (catch up: its own tours, no new right),
// « Accorder une roue » (a new right, only when it has none to use) and « Relancer un tirage » (an exceptional new draw,
// paid on its own). Studio only shows what Core decided; Core checks and journals every action.

export interface SwViewerHit {
  id: string;
  login: string | null;
  name: string;
}

export interface SwViewerAdmin {
  viewer: SwViewerHit;
  counts: {
    available: number;
    requested: number;
    blocked: number;
    drawing: number;
    draws: number;
  };
  gains: { awarded: number; pending: number };
  can_grant: boolean;
  rights: (SwSpinView & { blocked: boolean; redraw_of: string | null })[];
  draws: (SwSpinView & {
    shown_at: string | null;
    redraw_of: string | null;
    redraw_pending: boolean;
  })[];
}

export interface SwRightsUi {
  query: string;
  /** null: no search yet. */
  hits: SwViewerHit[] | null;
  viewer: SwViewerAdmin | null;
  grantOpen: boolean;
}

const n = (v: number) => v.toLocaleString('fr-FR');
const plural = (k: number, one: string, many: string) =>
  `${n(k)} ${k > 1 ? many : one}`;

function search(ui: SwRightsUi) {
  const hits =
    ui.hits === null
      ? ''
      : ui.hits.length
        ? `<div class="cp-buttons swr-hits">${ui.hits
            .map(
              (h) =>
                `<button type="button" class="cp-ghost${ui.viewer?.viewer.id === h.id ? ' swr-hit--on' : ''}" data-act="swr-pick" data-id="${esc(h.id)}">${esc(h.name)}${h.login && h.login !== h.name.toLowerCase() ? ` <small>${esc(h.login)}</small>` : ''}</button>`,
            )
            .join('')}</div>`
        : '<p class="cp-muted">Aucun viewer trouvé pour ce pseudo.</p>';
  return `<form class="sw-toolbar" data-role="swr-search">
      <label class="cp-inline">Pseudo <input data-f="swr-q" maxlength="64" size="18" placeholder="ex. wenuyr" value="${esc(ui.query)}"/></label>
      <button type="submit">Chercher</button>
    </form>${hits}`;
}

function grantForm(v: SwViewerAdmin) {
  return `<form class="sw-grant" data-role="swr-grant">
    <label>Tier <select data-f="swr-tier"><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select></label>
    <label>Roue (mois) <input data-f="swr-months" type="number" min="1" max="200" value="1" style="width:4.5em"/></label>
    <label class="sw-grow">Motif <input data-f="swr-note" maxlength="200" required placeholder="ex. roue promise le 20/10"/></label>
    <label class="cp-inline"><input type="checkbox" data-f="swr-now" checked/> la lancer tout de suite</label>
    <button type="submit" class="cp-primary">Accorder à ${esc(v.viewer.name)}</button>
    <button type="button" data-act="swr-grant-close">Annuler</button>
  </form>`;
}

function rightsTable(v: SwViewerAdmin) {
  if (!v.rights.length) return '<p class="cp-muted">Aucun tour en attente.</p>';
  return `<table class="cp-history sw-rights"><thead><tr><th>Tour</th><th>Provenance</th><th>État</th><th></th></tr></thead><tbody>${v.rights
    .map((r) => {
      const action = r.blocked
        ? '<span class="cp-tag cp-tag--warn">À vérifier</span>'
        : r.status === 'owed'
          ? `<button type="button" class="cp-ghost" data-act="swr-launch" data-spin="${esc(r.spin_id)}">Lancer</button>`
          : '';
      return `<tr${r.blocked ? ' class="sw-blocked"' : ''}>
        <td>T${r.tier} · ${monthLabel(r.right, r.months)}<br><small>${esc(time(r.right?.acquired_at ?? r.created_at))}</small></td>
        <td><span class="cp-tag">${esc(r.redraw_of ? 'nouveau tirage' : (SOURCE[r.source] ?? r.source))}</span></td>
        <td><small>${esc(STATUS[r.status])}</small></td>
        <td class="sw-act">${action}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}

function drawsTable(v: SwViewerAdmin) {
  if (!v.draws.length)
    return '<p class="cp-muted">Aucun tirage pour l’instant.</p>';
  return `<table class="cp-history sw-rights"><thead><tr><th>Tirage</th><th>Gain</th><th>Crédit</th><th></th></tr></thead><tbody>${v.draws
    .map((d) => {
      const replay =
        (d.status === 'failed' || d.status === 'skipped') && d.amount !== null
          ? `<button type="button" class="cp-ghost" data-act="swr-replay" data-spin="${esc(d.spin_id)}" data-amount="${d.amount}" data-award="${esc(d.award.status)}">Rejouer l’animation</button> `
          : '';
      const action =
        replay +
        (d.redraw_pending
          ? '<small class="cp-muted">relance en attente</small>'
          : `<button type="button" class="cp-ghost swr-redraw" data-act="swr-redraw" data-spin="${esc(d.spin_id)}" data-amount="${d.amount ?? ''}" data-award="${esc(d.award.status)}" data-at="${esc(time(d.shown_at ?? d.created_at))}">Relancer un tirage…</button>`);
      return `<tr>
        <td>${esc(time(d.shown_at ?? d.created_at))}${d.redraw_of ? ' <span class="cp-tag">nouveau tirage</span>' : ''}<br><small>${esc(STATUS[d.status])}</small>${recoveryLabel(d) ? `<br><small class="sw-recovery">${esc(recoveryLabel(d))}</small>` : ''}</td>
        <td>${d.amount === null ? '—' : `<b>${n(d.amount)}</b> jetons`}</td>
        <td><small>${esc(AWARD[d.award.status] || '—')}</small></td>
        <td class="sw-act">${action}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}

function viewerCard(v: SwViewerAdmin, ui: SwRightsUi) {
  const c = v.counts;
  const usable = c.available + c.requested;
  const stats = [
    `<b>${n(c.available)}</b> disponible${c.available > 1 ? 's' : ''}`,
    `<b>${n(c.requested)}</b> demandé${c.requested > 1 ? 's' : ''}`,
    c.blocked ? `<b>${n(c.blocked)}</b> à vérifier` : '',
    c.drawing ? `<b>${n(c.drawing)}</b> en cours` : '',
    `<b>${n(c.draws)}</b> tirage${c.draws > 1 ? 's' : ''}`,
    `<b>${n(v.gains.awarded)}</b> jetons gagnés`,
    v.gains.pending ? `${n(v.gains.pending)} en attente de crédit` : '',
  ].filter(Boolean);
  return `<div class="sw-block swr-card">
    <h3>${esc(v.viewer.name)} <small class="cp-muted">${v.viewer.login ? `${esc(v.viewer.login)} · ` : ''}${esc(v.viewer.id)}</small>
      <button type="button" class="cp-ghost" data-act="swr-refresh">Actualiser</button></h3>
    <p class="swr-stats">${stats.join(' · ')}</p>
    <div class="cp-buttons">
      ${c.available ? `<button type="button" class="cp-primary" data-act="swr-catchup">Rattraper : lancer ${plural(c.available, 'tour', 'tours')}</button>` : ''}
      <button type="button" class="swr-grant-btn" data-act="swr-grant-open"${v.can_grant && !ui.grantOpen ? '' : ' disabled'}>Accorder une roue…</button>
      ${v.can_grant ? '' : `<small class="cp-muted">${plural(usable, 'tour', 'tours')} à utiliser d’abord : aucun nouveau droit tant qu’il en a.</small>`}
    </div>
    ${ui.grantOpen && v.can_grant ? grantForm(v) : ''}
    <h4>Tours à utiliser</h4>${rightsTable(v)}
    <h4>Tirages</h4>${drawsTable(v)}
    <dl class="swr-legend">
      <dt>Rattraper</dt><dd>lance ses tours déjà gagnés : aucun nouveau droit, aucun gain en plus.</dd>
      <dt>Accorder une roue</dt><dd>crée un droit (tour perdu), seulement s’il n’a plus de tour à utiliser.</dd>
      <dt>Rejouer l’animation</dt><dd>remontre un tirage jamais affiché : le même gain, rien de re-crédité.</dd>
      <dt>Relancer un tirage</dt><dd>exceptionnel : un nouveau tirage payé EN PLUS, jamais un remplacement.</dd>
    </dl>
    <p class="cp-muted">Ses tours restent enregistrés, hors live comme sans OBS : il peut aussi les lancer lui-même avec
      !roue oui pendant un live.</p>
  </div>`;
}

export function rightsTab(ui: SwRightsUi, v2Available: boolean) {
  if (!v2Available)
    return '<p class="sw-banner">Le Core connecté ne gère pas encore les droits de la Roue du Sub V2.</p>';
  return `<div class="sw-block"><h3>Droits d’un viewer <small class="cp-muted">diffuseur</small></h3>${search(ui)}</div>
    ${ui.viewer ? viewerCard(ui.viewer, ui) : ''}`;
}

/** The replay confirmation: the SAME draw shown again, nothing credited again. */
export function replayConfirm(name: string, amount: number, award: string) {
  return `Rejouer l’animation du tirage de ${name} ?\n\nC’est le MÊME tirage : ${n(amount)} jetons, ${(AWARD[award as SwSpinView['award']['status']] || award).toLowerCase()}. Rien n’est re-crédité ; la roue passe à la prochaine place libre du lecteur.`;
}

/** The redraw confirmation, in plain words (the previous gain, paid on top, never a replacement). */
export function redrawConfirm(
  name: string,
  at: string,
  amount: number | null,
  award: string,
) {
  const gain =
    amount === null
      ? 'n’a rien rapporté (non affiché)'
      : `a rapporté ${n(amount)} jetons (${AWARD[award as SwSpinView['award']['status']] || award})`;
  return `Relancer un VRAI tirage pour ${name} ?\n\nSon tirage du ${at} ${gain}.\nUn NOUVEAU tirage sera fait à la prochaine roue et payé EN PLUS : ce n’est pas un remplacement.`;
}
