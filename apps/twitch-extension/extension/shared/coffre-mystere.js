// Démonstration B (architecture socle, Lab only): the viewer side of « Coffre mystère ». Its own look and text only;
// the door to the Core, the server's availability and price, the purchase per intent, the error texts and the history
// come from the shared primitives (module-registry.js, purchase.js, api.js).

import { registerViewerModule } from './module-registry.js';
import { createPurchaseButton } from './purchase.js';

const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS = { queued: 'en route vers le stream', done: 'ouvert', refunded: 'remboursé', failed: 'échec' };

/** Pure: the viewer's recent chests (server's journal for THIS viewer). */
export function coffreHistoryHtml(recent) {
  if (!recent?.length) return '<p class="rp-muted">Aucun coffre pour l’instant.</p>';
  return `<ul class="rp-list">${recent
    .map((r) => `<li><b>${esc(r.result?.item ?? 'coffre')}</b> · ${esc(STATUS[r.status] ?? r.status)}</li>`)
    .join('')}</ul>`;
}

export function createCoffreView({ document, client, module }) {
  const node = document.createElement('section');
  node.className = 'rp-module rp-coffre';
  // The host header already shows the module's name: only its description here.
  node.innerHTML = `<p class="rp-muted">${esc(module.description)}</p>
    <div data-slot="buy"></div><p class="rp-feedback" data-slot="msg" role="status"></p>
    <h3>Mes coffres</h3><div data-slot="history"></div>`;
  const $ = (s) => node.querySelector(`[data-slot="${s}"]`);
  let stopped = false;
  let timer = null;
  const refresh = async () => {
    try {
      const s = await client.moduleState(module.id);
      const a = s.actions?.find((x) => x.name === 'ouvrir');
      buy.update({
        label: a?.label ?? 'Ouvrir',
        price: a?.price ?? 0,
        available: !!a?.available,
        reason: a?.unavailable_reason ?? null,
      });
      $('history').innerHTML = coffreHistoryHtml(s.recent);
    } catch {
      buy.update({ available: false, reason: 'unavailable' });
    }
  };
  const buy = createPurchaseButton({
    document,
    run: (key, price) => client.moduleAct(module.id, 'ouvrir', null, key, price),
    onResult: (r) => {
      $('msg').textContent = r.ok ? 'Coffre acheté : il arrive sur le stream.' : r.message;
      void refresh();
    },
  });
  $('buy').append(buy.node);
  return {
    node,
    start() {
      void refresh();
      timer = setInterval(() => { if (!stopped) void refresh(); }, 5000);
    },
    destroy() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

registerViewerModule('coffre_mystere', createCoffreView, { icon: '🎁' });
