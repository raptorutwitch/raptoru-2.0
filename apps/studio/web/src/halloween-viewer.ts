// Studio › Halloween « Trouver un viewer » (docs/HALLOWEEN.md): search a viewer (those with Bonbons, then every viewer
// the channel has seen — Twitch name or id), see their Bonbons balance, their purchases (effect, when, cost, status,
// refund) and every movement; « Créditer » fills the credit form with them. Read only here: the credit itself is the
// existing grant (one idempotency key per entry). Core's data only.

type Json = Record<string, unknown>;
type Call = (path: string, body?: unknown) => Promise<Json>;

export interface ViewerHit {
  viewer_id: string;
  name: string;
  balance: number;
}
export interface ViewerHistory {
  viewer_id: string;
  balance: number;
  purchases: {
    label: string;
    price: number;
    status: string;
    refund_status: string;
    error: string | null;
    created_at: string;
  }[];
  ledger: {
    kind: string;
    amount: number;
    balance_after: number;
    actor: string;
    reason: string | null;
    created_at: string;
  }[];
}

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const when = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
const STATUS: Record<string, string> = {
  queued: 'en attente',
  executing: 'à l’écran',
  completed: 'joué',
  failed: 'non joué',
  unknown: 'joué ?',
};
const KIND: Record<string, string> = {
  grant: 'cadeau Studio',
  remove: 'retrait Studio',
  sub_reward: 'sub',
  gift_reward: 'sub offert',
  convert: 'échange de Jetons',
  purchase: 'achat',
  refund: 'remboursement',
  raffle: 'Tombola',
};

/** The card's HTML (pure). */
export function viewerFinderHtml(
  query: string,
  hits: ViewerHit[] | null,
  picked: { name: string; history: ViewerHistory | null } | null,
  error: string | null,
) {
  const list = hits
    ? hits.length
      ? `<ul class="hw-hits">${hits
          .map(
            (h) =>
              `<li><button type="button" class="hw-hit" data-pick="${esc(h.viewer_id)}" data-name="${esc(h.name)}"><b>${esc(h.name)}</b> <small>${esc(h.viewer_id)}</small><span>${h.balance} 🍬</span></button></li>`,
          )
          .join('')}</ul>`
      : '<p class="hw-hint">Aucun viewer trouvé.</p>'
    : '';
  const h = picked?.history;
  const detail = picked
    ? `<div class="hw-viewer">
        <div class="hw-viewer-head"><b>${esc(picked.name)}</b> <small>${esc(h?.viewer_id ?? '')}</small>
          <span class="hw-balance">${h ? `${h.balance} 🍬` : '…'}</span>
          <button type="button" class="primary" data-credit="${esc(h?.viewer_id ?? '')}" data-name="${esc(picked.name)}"${h ? '' : ' disabled'}>Créditer</button></div>
        ${
          h
            ? `<div class="hw-cols"><div><h4>Achats (${h.purchases.length})</h4><ul class="hw-log">${
                h.purchases
                  .map(
                    (p) =>
                      `<li><time>${when(p.created_at)}</time> ${esc(p.label)} · ${p.price} 🍬 · <span class="hw-st ${esc(p.status)}">${esc(STATUS[p.status] ?? p.status)}${p.refund_status === 'refunded' ? ' · remboursé' : ''}</span>${p.error ? ` <small>(${esc(p.error)})</small>` : ''}</li>`,
                  )
                  .join('') || '<li class="hw-hint">Aucun achat.</li>'
              }</ul></div>
              <div><h4>Mouvements</h4><ul class="hw-log">${
                h.ledger
                  .map(
                    (l) =>
                      `<li><time>${when(l.created_at)}</time> ${l.amount > 0 ? '+' : ''}${l.amount} 🍬 <small>${esc(KIND[l.kind] ?? l.kind)}${l.reason ? ` · ${esc(l.reason)}` : ''} → ${l.balance_after}</small></li>`,
                  )
                  .join('') || '<li class="hw-hint">Aucun mouvement.</li>'
              }</ul></div></div>`
            : ''
        }
      </div>`
    : '';
  return `<form class="hw-find" data-form="find">
      <input name="q" maxlength="64" value="${esc(query)}" placeholder="Pseudo Twitch ou id" aria-label="Viewer à trouver"/>
      <button type="submit">Chercher</button>
    </form>
    ${error ? `<p class="hw-hint bad">${esc(error)}</p>` : ''}${list}${detail}`;
}

/**
 * Mounts the card in `el`. `onCredit(id, name)`: « Créditer » (the panel fills its credit form). `refresh()` re-reads
 * the picked viewer (after a credit).
 */
export function mountViewerFinder(
  el: HTMLElement,
  call: Call,
  onCredit: (viewerId: string, name: string) => void,
  errorText: (code: string) => string,
) {
  let query = '';
  let hits: ViewerHit[] | null = null;
  let picked: {
    id: string;
    name: string;
    history: ViewerHistory | null;
  } | null = null;
  let error: string | null = null;
  const render = () => {
    el.innerHTML = viewerFinderHtml(query, hits, picked, error);
  };
  const load = async (id: string) => {
    try {
      const h = (await call(
        `/api/halloween/admin/viewers/${id}`,
      )) as unknown as ViewerHistory;
      if (picked?.id === id) picked.history = h;
      error = null;
    } catch (e) {
      error = errorText((e as Error).message);
    }
    render();
  };
  el.addEventListener('submit', (ev) => {
    const form = (ev.target as HTMLElement).closest<HTMLFormElement>(
      '[data-form="find"]',
    );
    if (!form) return;
    ev.preventDefault();
    query = String(new FormData(form).get('q') ?? '').trim();
    void call(
      `/api/halloween/admin/viewers?q=${encodeURIComponent(query)}`,
    ).then(
      (r) => {
        hits = r as unknown as ViewerHit[];
        error = null;
        render();
      },
      (e: Error) => {
        error = errorText(e.message);
        render();
      },
    );
  });
  el.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const pick = t.closest<HTMLElement>('[data-pick]');
    if (pick) {
      picked = {
        id: pick.dataset.pick!,
        name: pick.dataset.name ?? pick.dataset.pick!,
        history: null,
      };
      render();
      void load(picked.id);
      return;
    }
    const credit = t.closest<HTMLElement>('[data-credit]');
    if (credit?.dataset.credit)
      onCredit(credit.dataset.credit, credit.dataset.name ?? '');
  });
  render();
  return {
    refresh() {
      if (picked) void load(picked.id);
    },
  };
}
