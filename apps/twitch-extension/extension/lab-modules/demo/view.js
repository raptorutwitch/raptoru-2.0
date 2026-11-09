// LAB ONLY — the view of the fictitious module (entry: module.js). It uses only what the socle gives every module:
//   - the host context (ctx.host.refresh, ctx.state) and the live hooks of module-registry.js (onState);
//   - the shared 1-second clock (app/store.js everySecond): no timer of its own, nothing left running after destroy.
// Its state (a counter, the seconds spent, the session updates received) lives while the module is open and goes
// with it, like every view of the host.
import { everySecond } from '../../app/store.js';
import { labDemoEvent, removeLabDemo } from './module.js';

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

export function view(ctx) {
  const { document } = ctx;
  labDemoEvent('view');
  const node = document.createElement('div');
  node.className = 'labdemo';
  node.innerHTML = `
    <p class="labdemo__note">Module fictif du Lab : jamais embarqué dans un paquet, jamais montré aux viewers.</p>
    <div class="labdemo__grid">
      <div class="labdemo__stat"><span>Compteur</span><strong data-k="count">0</strong></div>
      <div class="labdemo__stat"><span>Ouvert depuis</span><strong data-k="seconds">0 s</strong></div>
      <div class="labdemo__stat"><span>Mises à jour de session</span><strong data-k="updates">0</strong></div>
      <div class="labdemo__stat"><span>Solde lu dans la session</span><strong data-k="balance">—</strong></div>
    </div>
    <div class="labdemo__actions">
      <button type="button" class="labdemo__btn labdemo__btn--main" data-act="plus">+1</button>
      <button type="button" class="labdemo__btn" data-act="refresh">Relire la session</button>
      <button type="button" class="labdemo__btn labdemo__btn--off" data-act="remove">Retirer le module</button>
    </div>`;
  const out = (k) => node.querySelector(`[data-k="${k}"]`);
  let count = 0;
  let seconds = 0;
  let updates = 0;
  let stopClock = null;
  const showBalance = (state) => { out('balance').textContent = state?.wallet ? fmt(state.wallet.available) : '—'; };
  showBalance(ctx.state);

  const onClick = (event) => {
    const act = event.target.closest?.('[data-act]')?.dataset.act;
    if (act === 'plus') out('count').textContent = fmt(++count);
    if (act === 'refresh') ctx.host.refresh();
    if (act === 'remove') {
      removeLabDemo();
      ctx.host.refresh(); // the next session read no longer offers it: the host closes it (destroy) and redraws the Hub
    }
  };
  node.addEventListener('click', onClick);

  return {
    node,
    start() {
      labDemoEvent('start');
      stopClock = everySecond(() => { out('seconds').textContent = `${fmt(++seconds)} s`; });
    },
    /** A new session while open: shown here, absorbed (the host does not redraw, the counter stays). */
    onState(next) {
      out('updates').textContent = fmt(++updates);
      showBalance(next);
      return true;
    },
    destroy() {
      stopClock?.();
      stopClock = null;
      node.removeEventListener('click', onClick);
      labDemoEvent('destroy');
    },
  };
}
