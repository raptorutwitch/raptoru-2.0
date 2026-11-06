import { esc, ic } from '../ds/ds.js';
import {
  AWARD,
  monthLabel,
  recoveryLabel,
  SOURCE,
  STATUS,
  time,
  type SwSpinView,
} from './sub-wheel-view.js';

// Roue du Sub, les droits d'un viewer (partie pure et testée) : trouvé par son pseudo, ce qu'il peut utiliser, ses vrais tirages et
// gains, et trois opérations bien séparées : Rattraper (ses propres tours, aucun nouveau droit), Accorder une roue (un nouveau droit,
// seulement s'il n'en a plus à utiliser), Relancer un tirage (exceptionnel, payé en plus). Le Core vérifie et journalise chaque action.

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
  /** null : pas encore de recherche. */
  hits: SwViewerHit[] | null;
  viewer: SwViewerAdmin | null;
  grantOpen: boolean;
}

const n = (v: number) => v.toLocaleString('fr-FR');
const plural = (k: number, one: string, many: string) =>
  `${n(k)} ${k > 1 ? many : one}`;

/** L'onglet Droits : la recherche par pseudo, le viewer s'ouvre dans le tiroir. */
export function rightsSearch(ui: SwRightsUi, v2Available: boolean) {
  if (!v2Available)
    return '<p class="whl-line">Le Core connecté ne gère pas encore les droits de la Roue du Sub V2.</p>';
  const hits =
    ui.hits === null
      ? '<p class="d-note">Cherche un viewer pour voir ses tours, ses tirages et ses gains, lui accorder une roue ou le rattraper.</p>'
      : ui.hits.length
        ? `<div class="whl-hits">${ui.hits
            .map(
              (h) =>
                `<button type="button" class="d-btn ${ui.viewer?.viewer.id === h.id ? 'on' : 'ghost'} sm" data-act="swr-pick" data-id="${esc(h.id)}">${esc(h.name)}${h.login && h.login !== h.name.toLowerCase() ? ` <small>${esc(h.login)}</small>` : ''}</button>`,
            )
            .join('')}</div>`
        : '<div class="d-empty">Aucun viewer trouvé pour ce pseudo.</div>';
  return `<form class="whl-form" data-role="swr-search"><label class="d-fld">${ic('search')}<input type="text" data-f="swr-q" maxlength="64" placeholder="Pseudo, ex. wenuyr" aria-label="Pseudo" value="${esc(ui.query)}"></label><button class="d-btn sm">Chercher</button></form>${hits}`;
}

function grantForm(v: SwViewerAdmin) {
  return `<form class="whl-form col" data-role="swr-grant">
    <div class="whl-two"><label class="d-fld"><select data-f="swr-tier" aria-label="Tier"><option value="1">T1</option><option value="2">T2</option><option value="3">T3</option></select></label>
      <label class="d-fld"><input type="number" data-f="swr-months" min="1" max="200" value="1" aria-label="Roue, en mois"><span>mois</span></label></div>
    <label class="d-fld"><input type="text" data-f="swr-note" maxlength="200" required placeholder="Motif, ex. roue promise le 20/10" aria-label="Motif"></label>
    <div class="d-row"><span>La lancer tout de suite</span><span class="d-sw"><input type="checkbox" role="switch" data-f="swr-now" checked aria-label="La lancer tout de suite"><i></i></span></div>
    <div class="whl-acts"><button class="d-btn pri sm">Accorder à ${esc(v.viewer.name)}</button><button type="button" class="d-btn ghost sm" data-act="swr-grant-close">Annuler</button></div>
  </form>`;
}

function rightsList(v: SwViewerAdmin) {
  if (!v.rights.length) return '<p class="d-note">Aucun tour en attente.</p>';
  return v.rights
    .map((r) => {
      const action = r.blocked
        ? '<span class="d-tag warn">À vérifier</span>'
        : r.status === 'owed'
          ? `<button type="button" class="d-btn sm" data-act="swr-launch" data-spin="${esc(r.spin_id)}">Lancer</button>`
          : '';
      return `<div class="whl-r ${r.blocked ? 'watch' : ''}">
        <span class="whl-who__t"><b>T${r.tier} · ${monthLabel(r.right, r.months)}</b><small>${esc(time(r.right?.acquired_at ?? r.created_at))}</small></span>
        <span class="whl-r__a">${action}</span>
        <div class="whl-r__m d-tags"><span class="d-tag off">${esc(r.redraw_of ? 'nouveau tirage' : (SOURCE[r.source] ?? r.source))}</span><small>${esc(STATUS[r.status])}</small></div>
      </div>`;
    })
    .join('');
}

function drawsList(v: SwViewerAdmin) {
  if (!v.draws.length)
    return '<p class="d-note">Aucun tirage pour l’instant.</p>';
  return v.draws
    .map((d) => {
      const replay =
        (d.status === 'failed' || d.status === 'skipped') && d.amount !== null
          ? `<button type="button" class="d-btn ghost sm" data-act="swr-replay" data-spin="${esc(d.spin_id)}" data-amount="${d.amount}" data-award="${esc(d.award.status)}">Rejouer l’animation</button>`
          : '';
      const action =
        replay +
        (d.redraw_pending
          ? '<small>relance en attente</small>'
          : `<button type="button" class="d-btn ghost sm" data-act="swr-redraw" data-spin="${esc(d.spin_id)}" data-amount="${d.amount ?? ''}" data-award="${esc(d.award.status)}" data-at="${esc(time(d.shown_at ?? d.created_at))}">Relancer un tirage</button>`);
      const rec = recoveryLabel(d);
      return `<div class="whl-r">
        <span class="whl-who__t"><b>${esc(time(d.shown_at ?? d.created_at))}</b><small>${esc(STATUS[d.status])}</small></span>
        <span class="whl-r__a"><b class="whl-amt">${d.amount === null ? '—' : `${n(d.amount)} jetons`}</b><small>${esc(AWARD[d.award.status] || '—')}</small></span>
        ${d.redraw_of ? '<div class="whl-r__m"><span class="d-tag off">nouveau tirage</span></div>' : ''}
        ${rec ? `<p class="whl-rec">${esc(rec)}</p>` : ''}
        <div class="whl-acts">${action}</div>
      </div>`;
    })
    .join('');
}

/** Le tiroir d'un viewer. */
export function viewerCard(v: SwViewerAdmin, ui: SwRightsUi) {
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
  return `<p class="whl-stats">${stats.join(' · ')}</p>
    <div class="whl-acts">
      ${c.available ? `<button type="button" class="d-btn pri sm" data-act="swr-catchup">Rattraper : lancer ${plural(c.available, 'tour', 'tours')}</button>` : ''}
      <button type="button" class="d-btn sm" data-act="swr-grant-open"${v.can_grant && !ui.grantOpen ? '' : ' disabled'}>Accorder une roue</button>
    </div>
    ${v.can_grant ? '' : `<p class="d-note">${plural(usable, 'tour', 'tours')} à utiliser d’abord : aucun nouveau droit tant qu’il en a.</p>`}
    ${ui.grantOpen && v.can_grant ? grantForm(v) : ''}
    <h4 class="whl-h4">Tours à utiliser</h4>${rightsList(v)}
    <h4 class="whl-h4">Tirages</h4>${drawsList(v)}
    <details class="d-acc"><summary>Ce que fait chaque action</summary><dl class="whl-legend">
      <dt>Rattraper</dt><dd>lance ses tours déjà gagnés : aucun nouveau droit, aucun gain en plus.</dd>
      <dt>Accorder une roue</dt><dd>crée un droit (tour perdu), seulement s’il n’a plus de tour à utiliser.</dd>
      <dt>Rejouer l’animation</dt><dd>remontre un tirage jamais affiché : le même gain, rien de re-crédité.</dd>
      <dt>Relancer un tirage</dt><dd>exceptionnel : un nouveau tirage payé EN PLUS, jamais un remplacement.</dd>
    </dl></details>
    <p class="d-note">Ses tours restent enregistrés, hors live comme sans OBS : il peut aussi les lancer lui-même avec !roue oui pendant un live.</p>`;
}

/** La confirmation d'un rejeu : le MÊME tirage remontré, rien de re-crédité. */
export function replayConfirm(name: string, amount: number, award: string) {
  return `Rejouer l’animation du tirage de ${name} ?\n\nC’est le MÊME tirage : ${n(amount)} jetons, ${(AWARD[award as SwSpinView['award']['status']] || award).toLowerCase()}. Rien n’est re-crédité ; la roue passe à la prochaine place libre du lecteur.`;
}

/** La confirmation d'une relance : le gain d'avant, payé en plus, jamais un remplacement. */
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
