/* global document, window */
// Status page of the supervised Studio server. Talks only to Electron (preload IPC).
const api = window.raptoruStudio && window.raptoruStudio.server;
const $ = (id) => document.getElementById(id);
const LABEL = {
  stopped: 'Serveur Studio arrêté',
  starting: 'Démarrage du serveur Studio…',
  ready: 'Serveur Studio prêt',
  degraded: 'Serveur Studio ralenti',
  crashed: 'Serveur Studio perdu',
  restarting: 'Relance du serveur Studio…',
  fatal: 'Serveur Studio arrêté : action requise',
};

function render(s) {
  if (!s) return;
  const server = $('step-server');
  const core = $('step-core');
  const ready = $('step-ready');
  const bad = s.state === 'fatal' || s.state === 'crashed';
  $('state').textContent = s.phase || LABEL[s.state] || s.state;
  $('detail').textContent = s.state === 'ready' ? '' : s.detail;
  $('detail').className = bad ? 'detail bad' : 'detail';
  server.dataset.s = s.state === 'ready' ? 'ok' : bad ? 'ko' : 'run';
  core.dataset.s = s.state === 'ready' ? (s.phase ? 'run' : 'ok') : '';
  ready.dataset.s = '';
  core.textContent =
    s.phase && s.state === 'ready'
      ? `Core local — ${s.phase.replace(/^Démarrage du Core local… ?/, '')}`
      : 'Core local';
  // Recovery never needs the server's HTTP API: Electron restarts it.
  $('restart').hidden = ![
    'fatal',
    'crashed',
    'restarting',
    'stopped',
    'degraded',
  ].includes(s.state);
  $('relaunch').hidden = s.state !== 'fatal';
  if (Array.isArray(s.logTail) && s.logTail.length)
    $('log').textContent = s.logTail.slice(-40).join('\n');
}

if (!api) {
  $('detail').textContent = 'Canal Electron indisponible.';
} else {
  api.onState(render);
  api.getState().then(render);
  $('restart').addEventListener('click', () => {
    $('restart').disabled = true;
    api.restart().finally(() => {
      $('restart').disabled = false;
    });
  });
  $('relaunch').addEventListener('click', () => api.relaunchApp());
}
