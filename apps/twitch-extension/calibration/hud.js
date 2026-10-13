// Calibration HUD (Video Component geometry, docs/TWITCH_GEOMETRY_CALIBRATION_2026-10.md).
// Injected by scripts/build-calibration.mjs into the packaged video_component.html only. Fixed overlay:
// it reserves no space in the page flow and never touches the Raptoru UI. Reads the viewport, the
// Twitch helper's context (only the fields it actually sends: n/a otherwise) and counts resizes.
// Nothing leaves the page: values are shown here and logged to the console ([CALIBRATION]).

const doc = document;
const win = window;
const twitch = win.Twitch?.ext ?? null;

const loadedAt = Date.now();
const instanceId = (
  crypto.randomUUID?.() ?? String(Math.random()).slice(2)
).slice(0, 8);
const LOADS_KEY = 'raptoru.calibration.loads';
let loads = 'n/a';
try {
  loads = Number(localStorage.getItem(LOADS_KEY) || 0) + 1;
  localStorage.setItem(LOADS_KEY, String(loads));
} catch {
  /* storage unavailable: n/a */
}

// Twitch helper context fields that describe the geometry or the player state (documented
// onContext fields; a field Twitch does not send stays n/a).
const CONTEXT_FIELDS = [
  'displayResolution',
  'videoResolution',
  'isTheatreMode',
  'isFullScreen',
  'arePlayerControlsVisible',
  'mode',
  'playbackMode',
];
let context = null;
let contextUpdates = 0;
let twitchVisible = 'n/a';
let visibilityUpdates = 0;

const counts = { window: 0, visualViewport: 0, observer: 0 };
let lastResizeAt = null;

const pad = (n, w = 2) => String(n).padStart(w, '0');
const clock = (t) => {
  if (t === null) return 'n/a';
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};
const age = () => {
  const s = Math.floor((Date.now() - loadedAt) / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const size = (w, h) =>
  w === undefined || w === null
    ? 'n/a'
    : `${Math.round(w * 100) / 100}×${Math.round(h * 100) / 100}`;
const shown = (v) =>
  v === undefined || v === null || v === '' ? 'n/a' : String(v);

function snapshot() {
  const el = doc.documentElement;
  const vv = win.visualViewport;
  const root = doc.getElementById('drawer')?.getBoundingClientRect();
  return {
    inner: size(win.innerWidth, win.innerHeight),
    client: size(el.clientWidth, el.clientHeight),
    scroll: size(el.scrollWidth, el.scrollHeight),
    dpr: win.devicePixelRatio,
    visualViewport: vv ? size(vv.width, vv.height) : 'n/a',
    visualViewportScale: vv ? vv.scale : 'n/a',
    root: root ? size(root.width, root.height) : 'n/a',
    documentVisibility: doc.visibilityState,
    twitchVisible,
    resizes: { ...counts },
    lastResizeAt: clock(lastResizeAt),
    context: Object.fromEntries(
      CONTEXT_FIELDS.map((k) => [k, shown(context?.[k])]),
    ),
    contextKeys: context ? Object.keys(context) : [],
    instanceId,
    loads,
  };
}

// --- DOM -------------------------------------------------------------------------------------------
const make = (tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const hud = make('section', 'calib-hud');
hud.setAttribute('aria-label', 'HUD de calibration');
const head = make('div', 'calib-hud__head');
const title = make('strong', 'calib-hud__title', 'CALIBRATION');
const gridBtn = make('button', 'calib-hud__btn', 'Grille');
gridBtn.type = 'button';
gridBtn.setAttribute('aria-pressed', 'false');
const minBtn = make('button', 'calib-hud__btn', '–');
minBtn.type = 'button';
minBtn.title = 'Réduire le HUD';
head.append(title, gridBtn, minBtn);
const body = make('dl', 'calib-hud__body');
hud.append(head, body);

const pill = make('button', 'calib-pill');
pill.type = 'button';
pill.title = 'Afficher le HUD de calibration';
pill.hidden = true;

const grid = make('div', 'calib-grid');
grid.hidden = true;
grid.setAttribute('aria-hidden', 'true');
const edges = ['top', 'bottom', 'left', 'right'].map((side) => {
  const bar = make('div', `calib-edge calib-edge--${side}`);
  bar.append(make('span', 'calib-edge__label'));
  return bar;
});
const crossH = make('div', 'calib-cross calib-cross--h');
const crossV = make('div', 'calib-cross calib-cross--v');
const center = make('div', 'calib-center');
const dims = make('div', 'calib-dims');
const rulers = make('div', 'calib-rulers');
grid.append(rulers, crossH, crossV, center, dims, ...edges);

function row(label, value) {
  body.append(make('dt', '', label), make('dd', '', value));
}

function render() {
  const s = snapshot();
  body.replaceChildren();
  const c = s.context;
  row('inner', s.inner);
  row('client', s.client);
  row('scroll', s.scroll);
  row('root', s.root);
  row('dpr · vv', `${s.dpr} · ${s.visualViewport} @${s.visualViewportScale}`);
  row(
    'visible',
    `doc ${s.documentVisibility} · tw ${s.twitchVisible} (${visibilityUpdates})`,
  );
  row(
    'resize',
    `${counts.window + counts.visualViewport + counts.observer} · ${s.lastResizeAt}`,
  );
  row(
    '',
    `win ${counts.window} · vv ${counts.visualViewport} · obs ${counts.observer}`,
  );
  row('display', c.displayResolution);
  row('video', c.videoResolution);
  row('théâtre·fs', `${c.isTheatreMode} · ${c.isFullScreen}`);
  row(
    'player',
    `ctrl ${c.arePlayerControlsVisible} · ${c.mode} · ${c.playbackMode}`,
  );
  row(
    'ctx',
    twitch
      ? `${contextUpdates} maj · ${s.contextKeys.length} champs`
      : 'helper absent',
  );
  row('instance', `${instanceId} · #${loads} · ${age()}`);
  pill.textContent = `📐 ${s.inner}`;
  if (!grid.hidden) renderGrid(s);
}

function renderGrid(s) {
  const w = win.innerWidth;
  const h = win.innerHeight;
  edges[0].firstChild.textContent = 'HAUT · y=0';
  edges[1].firstChild.textContent = `BAS · y=${h}`;
  edges[2].firstChild.textContent = 'GAUCHE · x=0';
  edges[3].firstChild.textContent = `DROITE · x=${w}`;
  dims.replaceChildren(
    make('strong', '', `${w} × ${h}`),
    make(
      'span',
      '',
      `ratio ${(w / h).toFixed(3)} (3:2 = 1.500) · dpr ${s.dpr}`,
    ),
    make('span', '', `client ${s.client} · scroll ${s.scroll}`),
  );
  rulers.replaceChildren();
  for (let x = 100; x < w; x += 100) {
    const mark = make('span', 'calib-ruler calib-ruler--x', String(x));
    mark.style.left = `${x}px`;
    rulers.append(mark);
  }
  for (let y = 100; y < h; y += 100) {
    const mark = make('span', 'calib-ruler calib-ruler--y', String(y));
    mark.style.top = `${y}px`;
    rulers.append(mark);
  }
}

// --- instrumentation -------------------------------------------------------------------------------
let settle = null;
function changed(source) {
  if (source) {
    counts[source] += 1;
    lastResizeAt = Date.now();
  }
  clearTimeout(settle);
  // Stabilised: one update after the burst (a drag fires dozens of events).
  settle = setTimeout(() => {
    render();
    console.info('[CALIBRATION]', snapshot());
  }, 150);
}

win.addEventListener('resize', () => changed('window'));
win.visualViewport?.addEventListener('resize', () => changed('visualViewport'));
if (typeof ResizeObserver === 'function') {
  let first = true;
  const observer = new ResizeObserver(() => {
    // The first callback is the initial observation, not a resize.
    if (first) return void (first = false);
    changed('observer');
  });
  observer.observe(doc.documentElement);
  const root = doc.getElementById('drawer');
  if (root) observer.observe(root);
}
doc.addEventListener('visibilitychange', () => changed(null));
twitch?.onContext?.((ctx) => {
  context = ctx && typeof ctx === 'object' ? { ...ctx } : null;
  contextUpdates += 1;
  changed(null);
});
twitch?.onVisibilityChanged?.((visible) => {
  twitchVisible = Boolean(visible);
  visibilityUpdates += 1;
  changed(null);
});
setInterval(() => {
  if (!hud.hidden) render();
}, 1000);

gridBtn.addEventListener('click', () => {
  grid.hidden = !grid.hidden;
  gridBtn.setAttribute('aria-pressed', String(!grid.hidden));
  render();
});
minBtn.addEventListener('click', () => {
  hud.hidden = true;
  pill.hidden = false;
  render();
});
pill.addEventListener('click', () => {
  hud.hidden = false;
  pill.hidden = true;
  render();
});

doc.body.append(grid, hud, pill);
render();
console.info('[CALIBRATION] loaded', snapshot());
