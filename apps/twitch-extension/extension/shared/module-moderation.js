// Moderation of a module of the module host, for the channel's team (docs/studio-refonte/architecture/GUIDE_MODERATION.md).
// Generic: written once, shown by the host under ANY module whose policy is visible — the module writes nothing for it.
// The journal is the Core's (who, what, how much, state); a refund is the ORIGINAL debit, once, with a reason; the Core
// checks the permission (refund: moderator) and audits — this panel never decides and never credits an arbitrary amount.

const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS = { queued: 'en attente', done: 'terminé', refunded: 'remboursé', failed: 'échec', canceled: 'annulé' };

/** Pure: the module's journal rows; a refund button only where the policy and the row allow it. */
export function moduleJournalHtml(items, { refund }) {
  if (!items?.length) return '<p class="rp-muted">Rien dans le journal pour l’instant.</p>';
  return `<ul class="rp-list">${items
    .map((r) => {
      const can = refund === 'moderator' && r.amount > 0 && r.status !== 'refunded';
      const why = r.reason ? ` · « ${esc(r.reason)} »` : '';
      return `<li><b>${esc(r.viewer?.display_name ?? '—')}</b> · ${esc(r.action)} · ${r.amount ? `${r.amount} J` : 'gratuit'} · ${esc(STATUS[r.status] ?? r.status)}${why}${
        can ? ` <button type="button" class="btn btn--ghost" data-refund="${esc(r.activity_id)}">Rembourser</button>` : ''
      }</li>`;
    })
    .join('')}</ul>`;
}

export function createModuleModerationPanel({ document, client, module }) {
  const policy = module.moderation ?? { visible: false, refund: 'never' };
  const node = document.createElement('section');
  node.className = 'rp-module-moderation';
  node.innerHTML = `<h3>Modération</h3><p class="rp-feedback" data-slot="msg" role="status"></p><div data-slot="journal"></div>`;
  const $ = (s) => node.querySelector(`[data-slot="${s}"]`);
  let items = [];
  const draw = () => ($('journal').innerHTML = moduleJournalHtml(items, policy));
  const refresh = async () => {
    try {
      const out = await client.moduleModerationActivity();
      items = (out.items ?? []).filter((r) => r.module_id === module.id);
      draw();
    } catch {
      $('journal').innerHTML = '<p class="rp-muted">Journal indisponible.</p>';
    }
  };
  node.addEventListener('click', async (ev) => {
    const id = ev.target?.closest?.('[data-refund]')?.dataset.refund;
    if (!id) return;
    const reason = document.defaultView?.prompt?.('Raison du remboursement (obligatoire) :')?.trim();
    if (!reason) return;
    try {
      const out = await client.moduleModerationRefund(id, reason);
      $('msg').textContent = `Remboursé : ${out.refunded} Jetons.`;
    } catch (e) {
      $('msg').textContent = `Refusé (${e?.code ?? e?.message ?? 'erreur'}).`;
    }
    void refresh();
  });
  return { node, refresh, visible: !!policy.visible };
}
