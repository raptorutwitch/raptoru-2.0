import { createClient, errorLabel, isDemo } from './shared/api.js';

const status = document.getElementById('status');
const runtime = document.getElementById('config-runtime');
const modules = document.getElementById('config-modules');
const help = document.getElementById('config-help');
const controls = document.getElementById('config-controls');
const ttsState = document.getElementById('config-tts-state');
const pauseButton = document.getElementById('config-tts-pause');
const modeButton = document.getElementById('config-tts-mode');
const feedback = document.getElementById('config-feedback');
let token = null;
let currentSession = null;
let busy = false;
const client = createClient({ getToken: () => token });

const row = (label, value, kind = '') => {
  const item = document.createElement('div');
  item.className = 'config-runtime__row';
  const left = document.createElement('span');
  left.className = 'config-runtime__label';
  left.textContent = label;
  const right = document.createElement('strong');
  right.className = `config-runtime__value ${kind ? `is-${kind}` : ''}`;
  right.textContent = value;
  item.append(left, right);
  return item;
};

function render(session) {
  currentSession = session;
  runtime.replaceChildren();
  modules.replaceChildren();
  const available = session?.interactions?.available !== false;
  status.textContent = available ? 'Extension opérationnelle' : 'Interactions en pause';
  runtime.append(
    row('EBS', session?.ok ? 'connecté' : 'indisponible', session?.ok ? 'ok' : 'warn'),
    row('SAMMI', available ? 'heartbeat accepté' : 'reconnexion nécessaire', available ? 'ok' : 'warn'),
    row('Mode', isDemo() ? 'aperçu local' : 'Production'),
    row('Panel', 'panel.html'),
  );
  for (const module of session?.modules ?? []) {
    const item = document.createElement('li');
    item.textContent = `${module.label || module.id} — actif`;
    modules.append(item);
  }
  if (!modules.childElementCount) {
    const item = document.createElement('li');
    item.textContent = 'Aucun module actif.';
    modules.append(item);
  }

  const tts = session?.moderation?.tts ?? { mode: 'instant', paused: false };
  const canControl = isDemo() || Boolean(tts.can_moderate);
  controls.hidden = !canControl;
  pauseButton.textContent = tts.paused ? 'Reprendre le TTS' : 'Mettre le TTS en pause';
  modeButton.textContent = tts.mode === 'approval' ? 'Passer en lecture instantanée' : 'Valider avant lecture';
  ttsState.textContent = tts.paused
    ? 'En pause'
    : tts.mode === 'approval'
      ? 'Validation requise'
      : 'Lecture instantanée';
  ttsState.classList.toggle('is-paused', Boolean(tts.paused));
  pauseButton.disabled = busy;
  modeButton.disabled = busy;
  help.textContent = available
    ? (canControl
      ? 'Pause suspend et reprend la lecture en cours sans perdre la file. Le mode de validation s’applique aux nouvelles demandes.'
      : 'Cette page est réservée au broadcaster et aux modérateurs de la chaîne.')
    : 'SAMMI doit republier un heartbeat valide avant toute dépense. Les soldes et crédits restent intacts.';
}

async function refresh({ keepFeedback = false } = {}) {
  try {
    if (!keepFeedback) feedback.textContent = '';
    render(await client.session());
  } catch (error) {
    status.textContent = 'Connexion impossible';
    runtime.replaceChildren(row('Service', errorLabel(error?.code), 'warn'));
    modules.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Configuration non chargée.' }));
  }
}

async function updateTts(patch, confirmation) {
  if (busy || !currentSession) return;
  busy = true;
  feedback.className = 'config-feedback';
  feedback.textContent = 'Enregistrement…';
  render(currentSession);
  try {
    if (Object.prototype.hasOwnProperty.call(patch, 'paused')) {
      await (patch.paused ? client.pauseTts() : client.resumeTts());
    } else {
      await client.setTtsModeration(patch);
    }
    feedback.className = 'config-feedback is-ok';
    feedback.textContent = confirmation;
    await refresh({ keepFeedback: true });
  } catch (error) {
    feedback.className = 'config-feedback is-error';
    feedback.textContent = errorLabel(error?.code);
  } finally {
    busy = false;
    if (currentSession) render(currentSession);
  }
}

pauseButton.addEventListener('click', () => {
  const paused = !Boolean(currentSession?.moderation?.tts?.paused);
  updateTts(
    { paused },
    paused ? 'TTS suspendu. La lecture et la file sont conservées.' : 'TTS repris.',
  );
});

modeButton.addEventListener('click', () => {
  const approval = currentSession?.moderation?.tts?.mode !== 'approval';
  updateTts(
    { mode: approval ? 'approval' : 'instant' },
    approval ? 'Les nouveaux TTS devront être validés.' : 'Les nouveaux TTS seront lus instantanément.',
  );
});

const twitch = window.Twitch?.ext;
if (isDemo()) refresh();
else if (twitch) {
  twitch.onAuthorized((auth) => { token = auth.token; refresh(); });
} else {
  status.textContent = 'Helper Twitch indisponible';
  help.textContent = 'Cette page doit être ouverte depuis la console Twitch.';
}
