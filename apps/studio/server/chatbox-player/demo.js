// Chatbox Raptoru — the demonstration (docs/CHATBOX.md § 9.1): the three profiles side by side on the same simulated
// messages, at their real size (scaled down only when the window is too narrow), « Origine » / « Modernisée » switched
// at once, dark / bright / busy backgrounds. The simulator's feed only: nothing reaches OBS or Twitch.

const token = location.hash.slice(1);
const HEADERS = { 'content-type': 'application/json', 'x-raptoru-studio': '1' };
const stage = document.getElementById('stage');
let state = null;
let preset = 'modernisee';
let view = 'all';
let explain = false;

const api = async (path, body) => {
  const r = await fetch(
    `/api/chatbox${path}`,
    body
      ? { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }
      : { headers: HEADERS },
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const mainScene = (profile) => state.scenes.find((s) => s.profile === profile);

function frame(profile, presetId) {
  const scene = mainScene(profile);
  const p = scene.placement;
  const params = new URLSearchParams({
    profile,
    scene: scene.id,
    feed: 'demo',
    fit: '1',
  });
  if (explain) params.set('explain', '1');
  if (presetId) params.set('preset', presetId);
  const wrap = document.createElement('div');
  wrap.className = 'frame';
  const f = document.createElement('iframe');
  f.title = `${profile} ${presetId || 'réglages enregistrés'}`;
  f.width = String(p.w);
  f.height = String(p.h);
  f.src = `player.html?${params}#${token}`;
  wrap.dataset.w = String(p.w);
  wrap.dataset.h = String(p.h);
  wrap.append(f);
  return wrap;
}

const presetName = (id) =>
  id
    ? (state.builtins.find((b) => b.id === id)?.name ?? id)
    : 'Réglages enregistrés';

function render() {
  stage.textContent = '';
  const cols =
    view === 'all'
      ? state.profiles.map((p) => ({ profile: p.id, title: p.label, preset }))
      : ['modernisee', 'origine'].map((id) => ({
          profile: view,
          title: state.profiles.find((p) => p.id === view).label,
          preset: id,
        }));
  for (const c of cols) {
    const col = document.createElement('section');
    col.className = 'col';
    const h = document.createElement('h2');
    h.textContent = c.title;
    const small = document.createElement('small');
    small.textContent = presetName(c.preset);
    small.dataset.presetLabel = '';
    h.append(small);
    col.append(h, frame(c.profile, c.preset));
    col.dataset.fixed = view === 'all' ? '' : '1';
    stage.append(col);
  }
  fit();
}

/** Real size when it fits; otherwise every frame is scaled by the same factor (a preview, never the OBS page). */
function fit() {
  const frames = [...stage.querySelectorAll('.frame')];
  const total =
    frames.reduce((s, f) => s + Number(f.dataset.w), 0) +
    28 * (frames.length - 1) +
    48;
  const k = Math.min(1, window.innerWidth / total);
  for (const f of frames) {
    const w = Number(f.dataset.w);
    const h = Number(f.dataset.h);
    f.style.width = `${w * k}px`;
    f.style.height = `${h * k}px`;
    f.querySelector('iframe').style.transform = k < 1 ? `scale(${k})` : '';
  }
}

function setOn(group, attr, value) {
  for (const b of document.querySelectorAll(
    `[data-group="${group}"] [${attr}]`,
  ))
    b.classList.toggle('on', b.getAttribute(attr) === value);
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.scenario !== undefined) {
    if (b.dataset.scenario === 'stop') await api('/demo', { stop: true });
    else if (b.dataset.scenario === 'clear')
      await api('/demo', { clear: true });
    else await api('/demo', { scenario: b.dataset.scenario });
  } else if (b.dataset.preset !== undefined) {
    preset = b.dataset.preset;
    setOn('preset', 'data-preset', preset);
    if (view !== 'all') return;
    // Instant switch: the pages keep their messages and take the other preset.
    for (const f of stage.querySelectorAll('iframe'))
      f.contentWindow.postMessage(
        { type: 'chatbox:preset', preset },
        location.origin,
      );
    for (const s of stage.querySelectorAll('[data-preset-label]'))
      s.textContent = presetName(preset);
  } else if (b.dataset.bg) {
    stage.className = `stage bg-${b.dataset.bg}`;
    setOn('bg', 'data-bg', b.dataset.bg);
  } else if (b.dataset.view) {
    view = b.dataset.view;
    setOn('view', 'data-view', view);
    render();
  }
});

document.querySelector('[data-explain]').addEventListener('change', (e) => {
  explain = e.target.checked;
  render();
});
window.addEventListener('resize', fit);

state = await api('/');
const sc = document.querySelector('[data-group="scenario"]');
sc.innerHTML = '<span class="lb">Scénario</span>';
for (const s of [
  ...state.demo.scenarios,
  { id: 'stop', label: 'Arrêter' },
  { id: 'clear', label: 'Vider' },
]) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.scenario = s.id;
  btn.textContent = s.label;
  sc.append(btn);
}
render();
