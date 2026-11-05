// Moderation of a module of the module host, for the channel's team (docs/studio-refonte/architecture/GUIDE_MODERATION.md).
// Generic: written once, shown by the host under ANY module whose policy is visible — the module writes nothing for it.
// The journal is the Core's (who, what, how much, state); a refund is the ORIGINAL debit, once, with a reason; the Core
// checks the permission (refund: moderator) and audits — this panel never decides and never credits an arbitrary amount.

import { errorLabel } from './api.js';

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
        can ? ` <button type="button" class="btn btn--sm" data-refund="${esc(r.activity_id)}">Rembourser</button>` : ''
      }</li>`;
    })
    .join('')}</ul>`;
}

export function createModuleModerationPanel({ document, client, module, heading = true }) {
  const policy = module.moderation ?? { visible: false, refund: 'never' };
  const node = document.createElement('section');
  node.className = 'rp-module-moderation';
  // The reason is typed INLINE: no window.prompt (an extension frame may not show browser dialogs).
  node.innerHTML = `${heading ? '<h3>Modération</h3>' : ''}<p class="rp-feedback" data-slot="msg" role="status"></p>
    <form data-slot="form" hidden><label>Motif du remboursement <input name="reason" maxlength="200" required></label>
    <button type="submit" class="rl-pay__cta">Rembourser</button> <button type="button" data-cancel>Annuler</button></form>
    <div data-slot="journal"></div>`;
  const $ = (s) => node.querySelector(`[data-slot="${s}"]`);
  let items = [];
  let pending = null;
  let busy = false;
  const draw = () => ($('journal').innerHTML = moduleJournalHtml(items, policy));
  const refresh = async () => {
    try {
      const out = await client.moduleModerationActivity(module.id);
      items = out.items ?? [];
      draw();
    } catch {
      $('journal').innerHTML = '<p class="rp-muted">Journal indisponible.</p>';
    }
  };
  const close = () => {
    pending = null;
    $('form').hidden = true;
  };
  node.addEventListener('click', (ev) => {
    if (ev.target?.closest?.('[data-cancel]')) return close();
    const id = ev.target?.closest?.('[data-refund]')?.dataset.refund;
    if (!id) return;
    pending = id;
    $('form').hidden = false;
    $('form').querySelector('input').focus?.();
  });
  node.addEventListener('submit', async (ev) => {
    ev.preventDefault?.();
    const reason = $('form').querySelector('input').value.trim();
    if (!pending || !reason || busy) return;
    busy = true;
    try {
      const out = await client.moduleModerationRefund(pending, reason);
      $('msg').textContent = `Remboursé : ${out.refunded} Jetons.`;
      $('form').querySelector('input').value = '';
      close();
    } catch (e) {
      $('msg').textContent = `Refusé : ${errorLabel(e?.code ?? e?.message)}`;
    } finally {
      busy = false;
    }
    void refresh();
  });
  return { node, refresh, visible: !!policy.visible };
}

/**
 * Every moderable module of the host in one place (the D4 console's « Modules »): the SAME panel and the same API as the
 * panel under each module — never a second implementation.
 */
export function createHostModerationSection({ document, client }) {
  const node = document.createElement('div');
  node.className = 'rp-host-moderation';
  const panels = new Map();
  const refresh = async () => {
    if (typeof client.moduleModerationList !== 'function') {
      node.innerHTML = '<p class="rp-muted">Modules du socle indisponibles avec cette version.</p>';
      return;
    }
    let modules;
    try {
      modules = (await client.moduleModerationList()).modules ?? [];
    } catch {
      node.innerHTML = '<p class="rp-muted">Modules du socle indisponibles (serveur).</p>';
      return;
    }
    node.textContent = '';
    if (!modules.length) node.innerHTML = '<p class="rp-muted">Aucun module du socle à modérer.</p>';
    for (const m of modules) {
      let p = panels.get(m.id);
      if (!p) {
        p = createModuleModerationPanel({ document, client, module: m, heading: false });
        panels.set(m.id, p);
      }
      const head = document.createElement('h2');
      head.textContent = m.enabled ? m.label : `${m.label} (coupé)`;
      node.append(head, p.node);
      void p.refresh();
    }
  };
  return { node, refresh };
}
