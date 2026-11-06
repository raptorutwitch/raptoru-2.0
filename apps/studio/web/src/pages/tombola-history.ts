import { actionLabel, actorName, openViewer, ROLE } from '../mod/mod.js';
import {
  drawer,
  errText,
  esc,
  hhmm,
  ic,
  fmt,
  patch,
  pp,
  run,
  stateChip,
  toast,
  type Drawer,
} from '../ds/ds.js';
import {
  api,
  ERRORS,
  filterHistory,
  groupHistory,
  histState,
  reward,
  type Card,
  type HistFilter,
  type HistoryItem,
} from './tombola-model.js';

// L'historique : une liste qu'on parcourt comme un journal de soirée, le stream en cours d'abord. Chaque ligne se lit seule
// (heure, gain, gagnants, état) et ouvre la fiche complète de la manche.

const FILTERS: [HistFilter, string][] = [
  ['all', 'Toutes'],
  ['special', 'Super, Full, Lots'],
  ['auto', 'Automatiques'],
  ['cancelled', 'Annulées'],
  ['failed', 'Paiements en échec'],
];
const hms = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '';

function stateTag(h: HistoryItem) {
  switch (histState(h)) {
    case 'running':
      return '<span class="d-tag ok">En cours</span>';
    case 'cancelled':
      return '<span class="d-tag off">Annulée</span>';
    case 'empty':
      return '<span class="d-tag off">Sans inscrit</span>';
    case 'failed':
      return `<span class="d-tag bad">${h.payouts.failed} échec${h.payouts.failed > 1 ? 's' : ''}</span>`;
    case 'give':
      return '<span class="d-tag">À remettre</span>';
    case 'paid':
      return '<span class="tb-paid"><i class="d-dot"></i>Payé</span>';
    default:
      return '<span class="d-tag off">Sans gagnant</span>';
  }
}
function rowHtml(h: HistoryItem) {
  const gold = h.kind === 'super' || h.is_full === true;
  const badge = h.is_full
    ? '<span class="d-tag gold">Full</span>'
    : h.kind === 'super'
      ? '<span class="d-tag gold">Super</span>'
      : '';
  const who = h.winners.slice(0, 3);
  return `<button type="button" class="tb-hr" data-round="${esc(h.raffle_id)}" aria-label="Ouvrir la manche de ${hhmm(h.opened_at)}"><time>${hhmm(h.opened_at)}</time><b class="${gold ? 'gold' : ''}">${esc(reward(h))}</b><span class="tb-hs">${badge}${stateTag(h)}</span><small>${h.participants} inscrit${h.participants > 1 ? 's' : ''}${h.origin === 'automatic' ? ' · auto' : ''}</small><span class="tb-stack">${who.map((w) => pp(w.display_name, 20)).join('')}${h.winners.length > 3 ? `<em>+${h.winners.length - 3}</em>` : ''}</span></button>`;
}

/** Monte la liste filtrable dans `host` ; `onOpen` reçoit la manche choisie. */
export function mountHistory(host: HTMLElement, onOpen: (id: string) => void) {
  host.innerHTML = `<label class="d-fld tb-hq">${ic('search')}<input type="search" data-hq placeholder="Un gagnant, un lot" aria-label="Chercher dans l’historique"></label><div class="d-tags tb-filters" data-f></div><div class="tb-hlist" data-l></div>`;
  const q = host.querySelector<HTMLInputElement>('[data-hq]')!;
  const fEl = host.querySelector<HTMLElement>('[data-f]')!;
  const lEl = host.querySelector<HTMLElement>('[data-l]')!;
  let filter: HistFilter = 'all';
  let list: HistoryItem[] = [];
  let session: string | null = null;
  let failedOnly = 0;
  const draw = () => {
    failedOnly = list.filter((h) => h.payouts.failed > 0).length;
    patch(
      fEl,
      FILTERS.filter(([k]) => k !== 'failed' || failedOnly || filter === k)
        .map(
          ([k, l]) =>
            `<button type="button" class="d-tag ${filter === k ? (k === 'failed' ? 'bad' : 'ok') : k === 'failed' ? 'bad' : 'off'}" data-hf="${k}" aria-pressed="${filter === k}">${l}${k === 'failed' ? ` ${failedOnly}` : ''}</button>`,
        )
        .join(''),
    );
    const shown = filterHistory(list, filter, q.value);
    patch(
      lEl,
      shown.length
        ? groupHistory(shown, session)
            .map(
              (g) =>
                `<h4 class="d-lb">${esc(g.label)}<span>${g.items.length}</span></h4>${g.items.map(rowHtml).join('')}`,
            )
            .join('')
        : `<div class="d-empty">${list.length ? 'Rien pour ce filtre.' : 'Aucune manche pour l’instant.'}</div>`,
    );
  };
  q.addEventListener('input', draw);
  host.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const f = t.closest<HTMLElement>('[data-hf]')?.dataset.hf as
      HistFilter | undefined;
    if (f) {
      filter = filter === f ? 'all' : f;
      return draw();
    }
    const id = t.closest<HTMLElement>('[data-round]')?.dataset.round;
    if (id) onOpen(id);
  });
  return {
    paint(items: HistoryItem[], sessionId: string | null) {
      list = items;
      session = sessionId;
      draw();
    },
  };
}

const FAILURES: Record<string, string> = {
  balance_cap: 'solde du viewer au maximum',
  currency_unavailable: 'monnaie indisponible',
  unknown_currency: 'monnaie inconnue',
};
// Le Core écrit « code: message ».
const failureText = (f?: string | null) =>
  FAILURES[(f ?? '').split(':')[0]!] ?? f ?? '';

/** Relancer un paiement en échec : le Core ne crédite jamais deux fois. */
export async function retryPayout(
  btn: HTMLElement | null,
  raffleId: string,
  viewerId: string,
) {
  await run(
    btn,
    async () => {
      const out = await api<{ ok: boolean; failure?: string | null }>(
        '/actions',
        {
          command: {
            action: 'retry_payout',
            raffle_id: raffleId,
            viewer_id: viewerId,
          },
        },
      );
      if (out.ok) toast('Paiement effectué');
      else
        toast(`Encore en échec : ${failureText(out.failure)}`, { bad: true });
    },
    undefined,
    ERRORS,
  );
}

export const winnerState = (w: Card['winners'][number], raffleId: string) =>
  w.payout_status === 'paid'
    ? '<span class="tb-paid"><i class="d-dot"></i>Payé</span>'
    : w.payout_status === 'failed'
      ? `<span class="d-tag bad">Échec</span><button type="button" class="d-btn sm" data-retry="${esc(raffleId)}:${esc(w.viewer_id)}">Relancer</button>`
      : w.payout_status === 'none'
        ? '<span class="d-tag">À remettre</span>'
        : '<span class="tb-paid"><i class="d-dot w"></i>Paiement…</span>';

/** « Tombola · pause » de la modération devient « Pause » : ici, on sait de quoi on parle. */
const actionText = (a: string) => {
  const t = (
    a === 'raffle_retry_payout' ? 'Paiement relancé' : actionLabel(a)
  ).replace(/^Tombola · /, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const STATES: Record<string, string> = {
  opening: 'Ouverture',
  open: 'Ouverte',
  paused: 'En pause',
  drawing: 'Tirage en cours',
  revealing: 'Révélation',
  revealed: 'Résultat à l’écran',
  finished: 'Terminée',
  cancelled: 'Annulée',
};
const KINDS: Record<string, string> = {
  normal: 'Normale',
  super: 'Super',
  giveaway: 'Giveaway',
};

function ficheHtml(c: Card) {
  const t = c.timeline;
  const steps: [string, string | null | undefined][] = [
    ['Ouverte', t.opened_at],
    ['Fermée', t.closed_at],
    ['Tirage', t.drawn_at],
    ['Sur le stream', t.reveal_at],
    ['Résultat viewers', t.viewer_result_at],
    ['Annulée', t.cancelled_at],
    ['Terminée', c.status === 'cancelled' ? null : t.finished_at],
  ];
  const active = c.entries.filter((e) => !e.removed_at);
  const name = (id?: string | null) =>
    c.entries.find((e) => e.viewer_id === id)?.display_name ?? id ?? '';
  const pic = (id: string) =>
    c.entries.find((e) => e.viewer_id === id)?.avatar_url;
  const src = (e: Card['entries'][number]) =>
    e.source === 'extension'
      ? '<span class="d-tag ext">Extension</span>'
      : e.source === 'manual'
        ? `<span class="d-tag">Ajouté${e.added_by ? ` par ${esc(actorName(e.added_by))}` : ''}</span>`
        : `<span class="d-tag ok">${esc(e.command ?? 'Chat')}</span>`;
  const detail = (a: Card['audit'][number]) => {
    const after = a.after ?? {};
    return [
      a.viewer_id ? esc(name(a.viewer_id)) : '',
      after.added_s ? `+ ${String(after.added_s)} s` : '',
      after.forced_over_block && !a.reason ? 'forcé malgré le blocage' : '',
      a.reason ? esc(a.reason) : '',
    ]
      .filter(Boolean)
      .join(' · ');
  };
  return `<div class="d-tags tb-fsum">${stateChip(c.status === 'cancelled' ? 'off' : '', c.outcome === 'no_participants' ? 'Terminée, aucun participant' : (STATES[c.status] ?? c.status))}<span class="d-tag ${c.kind === 'super' ? 'gold' : ''}">${esc(KINDS[c.kind] ?? c.kind)}</span>${c.is_full ? '<span class="d-tag gold">Full oseille</span>' : ''}<span class="d-tag off">${c.origin === 'automatic' ? 'Automatique' : `Lancée par ${esc(actorName(c.opened_by))}`}</span><span class="d-tag off">${Math.round(c.duration_ms / 1000)} s</span></div>
    ${c.cancelled_by ? `<p class="d-note">Annulée par ${esc(actorName(c.cancelled_by))}${c.cancel_reason ? `, ${esc(c.cancel_reason)}` : ''}.</p>` : ''}
    <h4 class="d-lb tb-fh">Déroulé</h4>
    <div class="tb-steps">${steps
      .filter(([, v]) => v)
      .map(([l, v]) => `<span><small>${l}</small><b>${hms(v)}</b></span>`)
      .join('')}</div>
    <h4 class="d-lb tb-fh">Gagnants et paiements</h4>
    ${
      c.winners
        .map(
          (w) =>
            `<div class="tb-fw">${pp(w.display_name, 32, pic(w.viewer_id))}<span class="tb-cut"><b>${w.position}. ${esc(w.display_name)}</b><small>${
              w.payout_status === 'paid'
                ? `${fmt(w.credited)} crédités à ${hhmm(w.paid_at)}`
                : w.payout_status === 'failed'
                  ? `${esc(failureText(w.failure))} · ${w.attempts} tentative${w.attempts > 1 ? 's' : ''}`
                  : ''
            }</small></span><span class="d-num">${c.kind === 'giveaway' ? 'Lot' : `${fmt(w.expected)} ${esc(w.currency?.short_label ?? '')}`}</span>${winnerState(w, c.raffle_id)}</div>`,
        )
        .join('') || '<p class="d-note">Aucun gagnant.</p>'
    }
    <h4 class="d-lb tb-fh">Participants<span>${active.length}</span></h4>
    <div class="tb-fps">${
      c.entries
        .map(
          (e) =>
            `<button type="button" class="tb-fp ${e.removed_at ? 'out' : ''}" data-viewer="${esc(e.viewer_id)}">${pp(e.display_name, 24, e.avatar_url)}<span class="tb-cut">${esc(e.display_name)}${e.removed_at ? `<small>retiré par ${esc(actorName(e.removed_by))}${e.removed_reason ? `, ${esc(e.removed_reason)}` : ''}</small>` : ''}</span><time>${hhmm(e.created_at)}</time>${src(e)}</button>`,
        )
        .join('') || '<p class="d-note">Personne ne s’est inscrit.</p>'
    }</div>
    <h4 class="d-lb tb-fh">Actions</h4>
    ${
      c.audit
        .map(
          (a) =>
            `<div class="tb-fa"><time>${hms(a.created_at)}</time><span class="tb-cut">${esc(actionText(a.action))}${detail(a) ? `<small>${detail(a)}</small>` : ''}</span><em>${esc(actorName(a.actor))}${a.role in ROLE ? `, ${ROLE[a.role]!.toLowerCase()}` : ''}</em></div>`,
        )
        .join('') || '<p class="d-note">Aucune action enregistrée.</p>'
    }
    <details class="d-acc" style="margin-top:12px"><summary>Détails techniques</summary><dl class="d-kv"><dt>Référence</dt><dd>${esc(c.raffle_id)}</dd><dt>Stream</dt><dd>${esc(c.session_id ?? 'Hors stream')}</dd><dt>Statut</dt><dd>${esc(c.status)}</dd><dt>Gagnants</dt><dd>${esc(c.winners_mode ?? '')}</dd>${c.winners
      .filter((w) => w.ledger_id !== null)
      .map(
        (w) =>
          `<dt>Mouvement</dt><dd>${esc(w.display_name)} · n° ${w.ledger_id}</dd>`,
      )
      .join('')}</dl></details>`;
}

let reload: (() => void) | null = null;
/** Relit la fiche ouverte (la page l'appelle à chaque relevé). */
export const refreshFiche = () => reload?.();

/** La fiche complète d'une manche : déroulé, gagnants et paiements, participants, actions. */
export function openFiche(id: string) {
  const d: Drawer = drawer({
    kicker: 'Tombola',
    title: 'Manche',
    body: '<div class="d-skel" style="height:220px"></div>',
    onClose: () => {
      reload = null;
    },
  });
  d.el.classList.add('tb-fiche');
  let last: Card | null = null;
  const load = async () => {
    try {
      last = await api<Card>(`/rounds/${id}`);
    } catch (e) {
      return d.set({
        body: `<p class="d-note bad">${esc(errText(e, ERRORS))}</p>`,
      });
    }
    if (!d.el.open) return;
    d.set({
      kicker: `Manche de ${hhmm(last.timeline.opened_at)}, le ${new Date(last.timeline.opened_at!).toLocaleDateString('fr-FR')}`,
      title: reward(last),
      body: ficheHtml(last),
    });
  };
  void load();
  reload = () => {
    if (last && !['finished', 'cancelled'].includes(last.status)) void load();
  };
  d.el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const r = t.closest<HTMLElement>('[data-retry]');
    if (r) {
      const [raffle, viewer] = r.dataset.retry!.split(':');
      void retryPayout(r, raffle!, viewer!).then(load);
      return;
    }
    const v = t.closest<HTMLElement>('[data-viewer]')?.dataset.viewer;
    if (v) openViewer(v);
  });
}

/** Ouvrir l'historique pendant une manche, sans quitter l'arène. */
export function openHistoryDrawer(
  items: HistoryItem[],
  sessionId: string | null,
) {
  const d = drawer({ kicker: 'Tombola', title: 'Historique', body: '' });
  const box = document.createElement('div');
  box.className = 'tb-hbox';
  d.el.querySelector('[data-b]')!.append(box);
  mountHistory(box, openFiche).paint(items, sessionId);
}
