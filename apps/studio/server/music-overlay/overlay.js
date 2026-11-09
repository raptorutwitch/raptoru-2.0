// Raptoru — the music overlay page (docs/music/MUSIC_OVERLAYS.md). The SAME page renders in OBS (browser source, its
// token in the URL's hash) and in Studio's editor (an iframe fed by postMessage: ?preview, or ?card for the gallery).
// In OBS it only READS Studio's state (long poll: an answer as soon as something changes, at most every 25 s otherwise);
// it never calls Spotify, never decides anything. The editor's demo data only ever reaches its own iframe, never OBS.
// Performance: the DOM changes only when the track, the preset or the visibility changes; between two changes the
// progress bar is ONE CSS transition to the track's end and the clock text moves once a second (only when shown).

const params = new URLSearchParams(location.search);
const PREVIEW = params.has('preview') || params.has('card');
const CARD = params.has('card');
const stage = document.getElementById('stage');
if (CARD) document.documentElement.classList.add('mo-card');

const svg = (d, fill = false) =>
  `<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  note: svg(
    '<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
  ),
  pause: svg(
    '<rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/>',
    true,
  ),
  req: svg(
    '<path d="M12 20.5s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1z"/>',
    true,
  ),
};

const FONTS = {
  moderne:
    '"Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, sans-serif',
  condensee:
    '"Bahnschrift", "DIN Alternate", "Arial Narrow", "Segoe UI", sans-serif',
  editoriale: 'Georgia, Cambria, "Times New Roman", serif',
  mono: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
};
const SIZE = { compact: 0.82, standard: 1, large: 1.28 };
const SPACE = { tight: 0.78, normal: 1, airy: 1.3 };
/** Cover sizes (em) per archetype. */
const COVER = {
  minimal: { small: 1.7, medium: 2, large: 2.4 },
  /** Flottant in two lines: the cover spans both. */
  stack: { small: 2.3, medium: 2.7, large: 3.1 },
  clean: { small: 3.3, medium: 4.2, large: 5.3 },
  glass: { small: 3.8, medium: 4.8, large: 6 },
  neon: { small: 3.1, medium: 3.9, large: 4.8 },
  editorial: { small: 4.4, medium: 5.8, large: 7.4 },
  focus: { small: 9, medium: 12, large: 15 },
};
const INTENSITY = { subtle: [8, 0.98], normal: [18, 0.94], strong: [38, 0.86] };
const WEIGHT = { regular: 500, bold: 700, black: 900 };
const SHADOW = [
  'none',
  '0 4px 14px rgba(0,0,0,.28)',
  '0 10px 30px rgba(0,0,0,.38)',
  '0 18px 50px rgba(0,0,0,.5)',
];
const ORIENTABLE = new Set(['clean', 'glass', 'focus']);
/** Scrolling speed of a long text, px of the 1920 × 1080 canvas per second (× the size). */
const MQ_SPEED = { slow: 26, normal: 40, fast: 62 };

const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const motionOk = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- colours ----------------------------------------------------------------------------------------------------------
const rgb = (hex) => {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]) =>
  `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;
const mix = (a, b, t) => {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};
const lum = (hex) => {
  const c = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const onColor = (hex) => (lum(hex) > 0.42 ? '#141018' : '#ffffff');
/** The text's shadow: none, soft, strong, an outline (dark under a light text, light under a dark one). */
const textShadow = (c) => {
  const k = lum(c.text) > 0.4 ? '0,0,0' : '255,255,255';
  return [
    'none',
    `0 1px 2px rgba(${k},.55)`,
    `0 1px 2px rgba(${k},.8), 0 0 10px rgba(${k},.45)`,
    `0 0 1px rgba(${k},1), 0 0 2px rgba(${k},.95), 0 1px 3px rgba(${k},.9), 0 0 8px rgba(${k},.5)`,
  ][c.text_shadow];
};

/** The cover's accent (once per cover; the palette's when it cannot be read — e.g. a CDN refusing CORS). */
const accents = new Map();
function coverAccent(url, done) {
  if (!url) return null;
  if (accents.has(url)) return accents.get(url);
  accents.set(url, null);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      let best = null;
      let score = -1;
      for (let i = 0; i < d.length; i += 4) {
        const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
        const max = Math.max(r, gg, b);
        const min = Math.min(r, gg, b);
        const sat = max ? (max - min) / max : 0;
        const val = max / 255;
        const sc = sat * (0.4 + val) * (val > 0.18 ? 1 : 0.2);
        if (sc > score) {
          score = sc;
          best = [r, gg, b];
        }
      }
      if (!best || score < 0.08) return;
      // Readable on a dark widget: lifted to a bright, saturated tone.
      let hex = toHex(best);
      while (lum(hex) < 0.22) hex = mix(hex, '#ffffff', 0.18);
      accents.set(url, hex);
      done();
    } catch {
      /* tainted canvas: the palette's accent stays */
    }
  };
  img.src = url;
  return null;
}

// --- model ------------------------------------------------------------------------------------------------------------
const model = {
  preset: null,
  live: null,
  liveAt: 0,
  visible: false,
  pulse: 0,
  offline: false,
};
let shownGen = null;
let announceUntil = 0;
let announceTimer = null;
let lastPulse = null;
let wasVisible = false;
let shellKey = '';
let bodyKey = '';
let timeTicker = null;
let coverKey = '';

const anchor = document.createElement('div');
anchor.className = 'mo-anchor';
const center = document.createElement('div');
center.className = 'mo-center';
// The request tab: outside the widget (never cut by its overflow), behind it, in a clip at its edge it slides out of.
const tabclip = document.createElement('div');
tabclip.className = 'mo-tabclip';
const tab = document.createElement('div');
tab.className = 'mo-tab';
tabclip.append(tab);
center.append(tabclip);
anchor.append(center);
stage.append(anchor);

const settings = () => model.preset?.settings;
const hasTrack = (l) =>
  !!l?.track && ['playing', 'paused', 'stale'].includes(l.state);
const posNow = () => {
  const l = model.live;
  const d = l?.track?.duration_ms;
  if (!l || l.position_ms == null) return 0;
  const p =
    l.position_ms +
    (l.state === 'playing' ? performance.now() - model.liveAt : 0);
  return d ? Math.min(Math.max(0, p), d) : Math.max(0, p);
};

/** What to show now: the full widget, its compact form, a quiet « aucune musique », or nothing. */
function decideForm(now) {
  const s = settings();
  if (!s) return 'hidden';
  const l = model.live;
  if (CARD) return hasTrack(l) ? 'full' : 'idle';
  if (!PREVIEW && (!model.visible || model.offline)) return 'hidden';
  const mode = s.display.mode;
  if (!hasTrack(l)) {
    if (s.display.on_idle !== 'placeholder' || mode === 'announce')
      return 'hidden';
    return mode === 'hybrid' ? 'compact-idle' : 'idle';
  }
  const announcing = now < announceUntil;
  let form =
    mode === 'always'
      ? 'full'
      : mode === 'announce'
        ? announcing
          ? 'full'
          : 'hidden'
        : announcing
          ? 'full'
          : 'compact';
  if (l.state === 'paused' && form !== 'hidden') {
    if (s.display.on_pause === 'hide') form = 'hidden';
    else if (s.display.on_pause === 'compact')
      form = mode === 'announce' ? 'hidden' : 'compact';
  }
  return form;
}

function announce(now) {
  const s = settings();
  if (!s) return;
  announceUntil = now + s.display.announce_s * 1000;
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => update(), s.display.announce_s * 1000 + 30);
}

// --- variables of the preset ------------------------------------------------------------------------------------------
function paint(s) {
  const st = anchor.style;
  const c = s.colors;
  const acc =
    (c.auto_accent &&
      coverAccent(model.live?.cover, () => paint(settings()))) ||
    c.accent;
  const size = SIZE[s.size];
  const [dist, scl] = INTENSITY[s.animation.intensity];
  const bg = c.opacity / 100;
  const shade = mix(c.background, acc, 0.22);
  const vars = {
    '--mo-accent': acc,
    '--mo-on-accent': onColor(acc),
    '--mo-text': rgba(c.text, c.text_opacity / 100),
    '--mo-artist': rgba(c.artist, c.text_opacity / 100),
    '--mo-muted': rgba(c.muted, c.text_opacity / 100),
    '--mo-tshadow': textShadow(c),
    '--mo-bgc': c.background,
    '--mo-bg': c.gradient
      ? `linear-gradient(135deg, ${rgba(c.background, bg)}, ${rgba(shade, bg)})`
      : rgba(c.background, bg),
    '--mo-glass-fallback': `linear-gradient(135deg, ${acc}, ${shade})`,
    '--mo-line': rgba(c.text, c.border_opacity / 100),
    '--mo-trackc': rgba(c.text, 0.16),
    '--mo-rulec': rgba(c.text, 0.28),
    '--mo-scrim': rgba(c.background, 0.82),
    '--mo-cover-bg': mix(acc, '#1b1726', 0.78),
    '--mo-alight': mix(acc, '#ffffff', 0.32),
    '--mo-shadow': SHADOW[c.shadow],
    '--mo-radius': `${s.radius}px`,
    '--mo-margin': `${s.margin}px`,
    '--mo-w': `${Math.round(s.width * size)}px`,
    '--mo-u': `${(16 * size).toFixed(2)}px`,
    '--mo-s': SPACE[s.spacing],
    '--mo-ts': s.title_scale / 100,
    '--mo-as': s.artist_scale / 100,
    '--mo-weight': WEIGHT[s.weight],
    '--mo-font': FONTS[s.font],
    '--mo-dur': motionOk() ? `${s.animation.duration_ms}ms` : '1ms',
    '--mo-dist': `${dist}px`,
    '--mo-scl': scl,
    '--mo-cover': `${COVER[layoutOf(s) === 'stack' ? 'stack' : s.archetype][s.cover.size]}em`,
    '--mo-tab-bg': rgba(s.request_tab.background, s.request_tab.opacity / 100),
    '--mo-tab-fg': s.request_tab.text,
    '--mo-tab-r': `${s.request_tab.radius}px`,
    '--mo-tab-fs': s.request_tab.size === 'small' ? '0.68em' : '0.8em',
    '--mo-tab-dur':
      s.request_tab.animate && motionOk()
        ? `${s.request_tab.duration_ms}ms`
        : '0ms',
    '--mo-cover-r':
      s.cover.shape === 'circle'
        ? '50%'
        : s.cover.shape === 'rounded'
          ? `${Math.min(18, Math.max(6, s.radius * 0.6))}px`
          : '3px',
  };
  for (const [k, v] of [18, 30, 45, 55, 60, 70].map((p) => [
    `--mo-a${p}`,
    rgba(acc, p / 100),
  ]))
    vars[k] = v;
  for (const [k, v] of Object.entries(vars)) st.setProperty(k, String(v));
  anchor.dataset.pos = s.position;
  anchor.dataset.enter = motionOk() ? s.animation.enter : 'fade';
}

// --- the widget's HTML ------------------------------------------------------------------------------------------------
/** Flottant's composition (the compact form of the other models is always one line). */
const layoutOf = (s) => (s.archetype === 'minimal' ? s.layout : 'line');

function parts(s, l, form) {
  const t = l?.track;
  const paused = l?.state === 'paused';
  const stale = l?.state === 'stale';
  // With the tab on, the request is told by the tab only (never also in the text's flow).
  const req =
    l?.request && s.show.request_badge && !s.request_tab.show
      ? l.request
      : null;
  const by = req?.by && s.show.requester ? req.by : null;
  // A request: « ♥ Demande de X » (the pill: « ♥ X »); X only when its name is known and shown.
  const chip = req
    ? `<span class="mo-req">${ICON.req}${by ? `<span>Demande de</span><b>${esc(by)}</b>` : '<b>Demande</b>'}</span>`
    : '';
  const pill = req
    ? `<span class="mo-req">${ICON.req}<b>${esc(by ?? 'Demande')}</b></span>`
    : '';
  const word =
    paused && s.show.pause_state
      ? 'En pause'
      : stale
        ? 'Non confirmé'
        : 'En cours';
  const label = s.show.label
    ? `<div class="mo-label">${paused && s.show.pause_state ? `<span class="mo-pause">${ICON.pause}</span>` : ''}<span>${word}</span>${chip}</div>`
    : chip
      ? `<div class="mo-label">${chip}</div>`
      : '';
  const artists = (t?.artists ?? []).filter(Boolean).join(', ');
  const fit = (cls, text) =>
    `<div class="${cls} mo-fit"><span>${esc(text)}</span></div>`;
  const dur = t?.duration_ms;
  const time =
    s.show.time && dur ? '<span class="mo-time" data-time="both"></span>' : '';
  const prog =
    (s.show.progress || s.show.time) && dur
      ? `<div class="mo-prog">${s.show.progress ? '<div class="mo-bar"><i data-bar></i></div>' : ''}${time}</div>`
      : '';
  const cover = s.cover.show
    ? l?.cover
      ? `<div class="mo-cover"><img src="${esc(l.cover)}" alt="" referrerpolicy="no-referrer" decoding="async"></div>`
      : `<div class="mo-cover mo-cover--none">${ICON.note}</div>`
    : '';
  return {
    t,
    paused,
    stale,
    req,
    by,
    chip,
    pill,
    word,
    label,
    cover,
    prog,
    title: s.show.title && t ? fit('mo-title', t.title) : '',
    artist: s.show.artist && artists ? fit('mo-artist', artists) : '',
    album: s.show.album && t?.album ? fit('mo-album', t.album) : '',
    hair:
      s.show.progress && dur
        ? '<div class="mo-bar mo-hair"><i data-bar></i></div>'
        : '',
    form,
  };
}

const idleBody = () =>
  `<div class="mo-body"><div class="mo-idle">${ICON.note}<span>Aucune musique</span></div></div>`;

function body(arch, s, p) {
  if (p.form === 'idle' || p.form === 'compact-idle') return idleBody();
  switch (arch) {
    case 'minimal': {
      if (layoutOf(s) === 'stack') {
        // Two lines: the title, then the artist, each scrolling on its own when too long.
        const lead =
          p.cover ||
          (p.paused && s.show.pause_state
            ? `<span class="mo-note">${ICON.pause}</span>`
            : '<span class="mo-mark"></span>');
        return `<div class="mo-body">${lead}<div class="mo-text">${p.title}${p.artist}</div>${p.pill}</div>${p.hair}`;
      }
      const line = `${p.title ? `<b>${esc(p.t.title)}</b>` : ''}${p.title && p.artist ? '<i>—</i>' : ''}${p.artist ? `<em>${esc((p.t.artists ?? []).join(', '))}</em>` : ''}`;
      const lead =
        p.cover ||
        `<span class="mo-note">${p.paused ? ICON.pause : ICON.note}</span>`;
      return `<div class="mo-body">${lead}<div class="mo-line mo-fit"><span>${line}</span></div>${p.pill}</div>${p.hair}`;
    }
    case 'neon':
      return `<div class="mo-body">${p.cover}<div class="mo-text">${p.label}${p.title}${p.artist}${p.album}</div><span class="mo-flash"></span></div>${p.hair}`;
    case 'editorial': {
      const rule =
        s.show.progress && p.t?.duration_ms
          ? '<span class="mo-rule"><i data-bar></i></span>'
          : '<span class="mo-rule"></span>';
      const time =
        s.show.time && p.t?.duration_ms
          ? '<span class="mo-time" data-time="both"></span>'
          : '';
      const label = `<div class="mo-label">${s.show.label ? `<span>${p.word}</span>` : ''}${rule}${time}</div>`;
      const reqline = p.req
        ? `<div class="mo-reqline">${ICON.req}<span>Demandée par</span><b>${esc(p.by ?? 'un viewer')}</b></div>`
        : '';
      return `<div class="mo-body"><div class="mo-text">${label}${p.title}${p.artist}${p.album}${reqline}</div>${p.cover}</div>`;
    }
    case 'focus': {
      const d = p.t?.duration_ms;
      const prog =
        d && (s.show.progress || s.show.time)
          ? `<div class="mo-prog">${s.show.progress ? '<div class="mo-bar"><i data-bar></i></div>' : ''}${s.show.time ? '<span class="mo-time" data-time="pos"></span><span class="mo-time" data-time="dur"></span>' : ''}</div>`
          : '';
      const label = s.show.label
        ? `<div class="mo-label">${p.paused && s.show.pause_state ? `<span class="mo-pause">${ICON.pause}</span>` : ''}<span>${p.word}</span></div>`
        : '';
      const banner = p.req
        ? `<div class="mo-banner">${ICON.req}<span>Demandée par</span><b>${esc(p.by ?? 'un viewer')}</b></div>`
        : '';
      return `<div class="mo-body">${p.cover}<div class="mo-text">${label}${p.title}${p.artist}${p.album}${prog}</div></div>${banner}`;
    }
    default: // clean, glass
      return `<div class="mo-body">${p.cover}<div class="mo-text">${p.label}${p.title}${p.artist}${p.album}${p.prog}</div></div>`;
  }
}

function shell(arch, s, p, form) {
  const el = document.createElement('div');
  const compact = form === 'compact' || form === 'compact-idle';
  const a = compact ? 'minimal' : arch;
  el.className = `mo mo--${a}`;
  // Gallery cards: still (no scrolling text).
  el.dataset.long = CARD ? 'ellipsis' : s.long_text;
  el.dataset.align = s.align;
  el.dataset.orient = ORIENTABLE.has(a) ? s.orientation : 'horizontal';
  el.dataset.layout =
    compact && s.archetype !== 'minimal' ? 'line' : layoutOf(s);
  el.classList.toggle('has-border', s.colors.border);
  el.classList.toggle('no-cover', !s.cover.show);
  el.classList.toggle('is-ambient', s.animation.ambient && motionOk());
  if (a === 'editorial') {
    el.classList.toggle('has-box', s.colors.opacity > 0);
    el.classList.toggle(
      'has-scrim',
      s.colors.opacity === 0 && s.colors.gradient,
    );
  }
  if (compact && s.archetype !== 'minimal') {
    el.style.width = `min(var(--mo-w), ${Math.round(Math.min(s.width, 440) * SIZE[s.size])}px)`;
    el.style.setProperty('--mo-cover', `${COVER.minimal[s.cover.size]}em`);
  }
  return el;
}

function stateClasses(el, s, p) {
  el.classList.toggle('is-playing', model.live?.state === 'playing');
  el.classList.toggle('is-paused', !!p.paused);
  el.classList.toggle('is-stale', !!p.stale);
  el.classList.toggle('is-dim', !!p.paused && s.display.on_pause === 'dim');
}

function glassLayers(el, l) {
  if (!el.classList.contains('mo--glass')) return;
  let bg = el.querySelector(':scope > .mo-glass-bg');
  if (!bg) {
    bg = document.createElement('div');
    bg.className = 'mo-glass-bg';
    const tint = document.createElement('div');
    tint.className = 'mo-glass-tint';
    el.prepend(bg, tint);
  }
  bg.style.backgroundImage = l?.cover
    ? `url("${String(l.cover).replace(/["\\]/g, '')}")`
    : '';
}

// --- after the DOM: progress, clock, long texts -----------------------------------------------------------------------
function syncProgress() {
  const l = model.live;
  const d = l?.track?.duration_ms;
  const root =
    center.querySelector('.mo:not(.mo-swap-out)') ?? center.firstElementChild;
  if (!root) return;
  if (d) {
    const pos = posNow();
    const playing = l.state === 'playing';
    for (const bar of root.querySelectorAll('[data-bar]')) {
      bar.style.transition = 'none';
      bar.style.transform = `scaleX(${(pos / d).toFixed(4)})`;
      if (playing) {
        void bar.offsetWidth;
        bar.style.transition = `transform ${Math.max(0, d - pos)}ms linear`;
        bar.style.transform = 'scaleX(1)';
      }
    }
  }
  tickTime();
  clearInterval(timeTicker);
  timeTicker = null;
  if (d && l.state === 'playing' && root.querySelector('[data-time]'))
    timeTicker = setInterval(tickTime, 1000);
}

function tickTime() {
  const d = model.live?.track?.duration_ms;
  if (!d) return;
  const pos = posNow();
  for (const el of center.querySelectorAll('[data-time]')) {
    const k = el.dataset.time;
    el.textContent =
      k === 'pos'
        ? clock(pos)
        : k === 'dur'
          ? clock(d)
          : `${clock(pos)} / ${clock(d)}`;
  }
}

/**
 * A text longer than its room (measured): it scrolls, wraps or ends in « … » as the preset says. Scrolling is ONE
 * animation per text, started when the text is built (never again at a mere refresh of the state):
 * - back and forth: the start shown, a pause, a steady glide to the end, a pause, a smooth return, again;
 * - continuous: a ticker, the text followed by its copy after a gap, so the loop never jumps.
 * Less motion asked by the system: an ellipsis instead. A text that fits never moves.
 */
function fitTexts(root, s) {
  for (const el of root.querySelectorAll('.mo-fit')) marquee(el, s, root);
}

function marquee(el, s, root) {
  const span = el.firstElementChild;
  if (!span) return;
  el._mq?.cancel();
  el._mq = null;
  if (el.dataset.orig !== undefined) {
    span.innerHTML = el.dataset.orig;
    delete el.dataset.orig;
  }
  el.classList.remove('is-marquee', 'is-loop', 'is-clip');
  if (root.dataset.long !== 'scroll' || el.scrollWidth - el.clientWidth <= 2)
    return;
  if (!motionOk() || !span.animate) {
    el.classList.add('is-clip');
    return;
  }
  const speed = MQ_SPEED[s.marquee.speed] * SIZE[s.size];
  el.classList.add('is-marquee');
  if (s.marquee.mode === 'loop') {
    el.classList.add('is-loop');
    el.dataset.orig = span.innerHTML;
    span.innerHTML = `<span class="mo-mq">${el.dataset.orig}</span><span class="mo-mq" aria-hidden="true">${el.dataset.orig}</span>`;
    const dist = span.firstElementChild.getBoundingClientRect().width;
    el._mq = span.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(${-dist}px)` }],
      { duration: (dist / speed) * 1000, iterations: Infinity, delay: 1500 },
    );
    return;
  }
  const over = span.offsetWidth - el.clientWidth;
  const go = (over / speed) * 1000;
  const back = Math.max(1100, go * 0.6);
  const [rest, end] = [1800, 1300];
  const T = rest + go + end + back;
  el._mq = span.animate(
    [
      { transform: 'translateX(0)', offset: 0 },
      {
        transform: 'translateX(0)',
        offset: rest / T,
        easing: 'cubic-bezier(.4,0,.6,1)',
      },
      { transform: `translateX(${-over}px)`, offset: (rest + go) / T },
      {
        transform: `translateX(${-over}px)`,
        offset: (rest + go + end) / T,
        easing: 'cubic-bezier(.4,0,.3,1)',
      },
      { transform: 'translateX(0)', offset: 1 },
    ],
    { duration: T, iterations: Infinity },
  );
}

// --- the request tab --------------------------------------------------------------------------------------------------
let tabKey = null;
let tabTimer = null;
/**
 * The tab follows the request of the track shown: out (after `delay`, the strip first) when there is one, in when
 * there is none; another request: in, then out with the new name. Only from `live.request` (Core's exact attribution).
 */
function syncTab(s, l, form, delay) {
  const t = s.request_tab;
  tabclip.dataset.side = t.side;
  tabclip.dataset.align = t.align;
  const on =
    t.show &&
    s.show.request_badge &&
    !!l?.request &&
    hasTrack(l) &&
    (form === 'full' || form === 'compact');
  const by = on && s.show.requester && l.request.by ? l.request.by : '';
  const key = on ? `${l.gen}|${by}` : null;
  if (key === tabKey) return;
  tabKey = key;
  clearTimeout(tabTimer);
  const out = () => {
    tab.innerHTML = by
      ? `<span>Demandé par</span><b>@${esc(by)}</b>`
      : '<b>Demande viewer</b>';
    void tab.offsetWidth;
    tabclip.classList.add('is-out');
  };
  const dur = t.animate && motionOk() ? t.duration_ms : 0;
  if (tabclip.classList.contains('is-out')) {
    tabclip.classList.remove('is-out');
    if (key) tabTimer = setTimeout(out, dur + 80);
  } else if (key) tabTimer = setTimeout(out, delay);
}
function hideTab() {
  clearTimeout(tabTimer);
  tabKey = null;
  tabclip.classList.remove('is-out');
}

// --- the frame --------------------------------------------------------------------------------------------------------
function update() {
  const s = settings();
  if (!s) {
    anchor.classList.remove('is-shown');
    return;
  }
  const now = performance.now();
  const l = model.live;
  // A new occurrence, a test of the animation, the overlay just shown: an announce (announce / hybrid modes).
  if (hasTrack(l) && l.gen !== shownGen) {
    const first = shownGen === null;
    shownGen = l.gen;
    if (!first || PREVIEW) announce(now);
    if (!first && s.display.request_spotlight && l.request) announce(now);
  }
  if (lastPulse !== null && model.pulse !== lastPulse) announce(now);
  const pulsed = lastPulse !== null && model.pulse !== lastPulse;
  lastPulse = model.pulse;
  const visibleNow = PREVIEW || (model.visible && !model.offline);
  if (visibleNow && !wasVisible && !PREVIEW) announce(now);
  wasVisible = visibleNow;

  paint(s);
  const form = decideForm(now);
  if (form === 'hidden') {
    anchor.classList.remove('is-shown');
    hideTab();
    clearInterval(timeTicker);
    timeTicker = null;
    return;
  }
  const p = parts(s, l, form);
  const sk = `${form === 'compact' || form === 'compact-idle' ? 'c' : 'f'}|${JSON.stringify(s)}`;
  // The cover is not in the key: arriving a moment after the title, it is put in place (no rebuild, no restart).
  const bk = `${form}|${l?.gen}|${p.t?.title}|${p.t?.artists}|${p.t?.album}|${l?.state}|${p.req ? `r:${p.by}` : ''}`;
  const changedTrack = bodyKey && bk.split('|')[1] !== bodyKey.split('|')[1];
  const appearing = !anchor.classList.contains('is-shown') || pulsed;
  let built = false;
  let root = center.querySelector(':scope > .mo');
  if (sk !== shellKey || !root) {
    // A new preset or form: built at once (the editor's changes show without an animation).
    const el = shell(s.archetype, s, p, form);
    el.innerHTML = body(form === 'compact' ? 'minimal' : s.archetype, s, p);
    const old = root;
    const swap = old && shellKey && shellKey[0] !== sk[0] && motionOk();
    if (old) old.replaceWith(el);
    else center.append(el);
    built = true;
    if (swap) {
      // Compact ↔ full (hybrid): one form fades into the other.
      el.classList.add('mo-swap-in');
      el.dataset.chg = 'crossfade';
    }
    root = el;
    shellKey = sk;
    bodyKey = bk;
  } else if (bk !== bodyKey) {
    const chg = changedTrack && motionOk() ? s.animation.change : 'none';
    const oldBody = root.querySelector(':scope > .mo-body');
    const tmp = document.createElement('div');
    tmp.innerHTML = body(form === 'compact' ? 'minimal' : s.archetype, s, p);
    const fresh = [...tmp.children];
    for (const n of [...root.children])
      if (!n.matches('.mo-glass-bg, .mo-glass-tint')) n.remove();
    if (oldBody && chg !== 'none') {
      // The old content leaves where it stood while the new one comes in.
      oldBody.style.left = `${oldBody.offsetLeft}px`;
      oldBody.style.top = `${oldBody.offsetTop}px`;
      oldBody.style.width = `${oldBody.offsetWidth}px`;
    }
    root.append(...fresh);
    if (oldBody && chg !== 'none') {
      oldBody.classList.add('mo-swap-out');
      oldBody.dataset.chg = chg;
      root.append(oldBody);
      const nb = root.querySelector(':scope > .mo-body:not(.mo-swap-out)');
      nb?.classList.add('mo-swap-in');
      if (nb) nb.dataset.chg = chg;
      setTimeout(() => oldBody.remove(), s.animation.duration_ms + 80);
    }
    bodyKey = bk;
    built = true;
  } else if (coverKey !== `${l?.cover}`) {
    const old = root.querySelector(
      ':scope > .mo-body:not(.mo-swap-out) .mo-cover',
    );
    if (old && p.cover) {
      const t = document.createElement('div');
      t.innerHTML = p.cover;
      old.replaceWith(t.firstElementChild);
    }
  }
  coverKey = `${l?.cover}`;
  stateClasses(root, s, p);
  glassLayers(root, l);
  if (pulsed) hideTab();
  syncTab(
    s,
    l,
    form,
    appearing
      ? s.animation.duration_ms * 0.6
      : changedTrack
        ? s.animation.duration_ms * 0.5
        : 0,
  );
  if (appearing) {
    if (pulsed && motionOk()) {
      // « Tester l'animation »: the entrance again, from hidden.
      anchor.classList.remove('is-shown');
      anchor.style.transition = 'none';
      void anchor.offsetWidth;
      anchor.style.transition = '';
      root.classList.remove('is-flash');
      void root.offsetWidth;
      root.classList.add('is-flash');
    }
    requestAnimationFrame(() => anchor.classList.add('is-shown'));
  }
  syncProgress();
  if (built) requestAnimationFrame(() => fitTexts(root, s));
  if (CARD) fitCard(root);
}
// The fonts loaded after the first measure: measured again (a text may now fit, or not).
document.fonts?.ready.then(() => {
  const root = center.querySelector(':scope > .mo');
  if (root && settings()) fitTexts(root, settings());
});

/** Gallery card: the widget alone, centred, scaled to fit the card (its layout size, never a transformed one). */
function fitCard(root) {
  requestAnimationFrame(() => {
    const k = Math.min(
      1,
      (innerWidth * 0.9) / root.offsetWidth,
      (innerHeight * 0.84) / root.offsetHeight,
    );
    anchor.style.transform = `translate(-50%, -50%) scale(${k.toFixed(3)})`;
  });
}

function receive(data) {
  model.preset = data.preset ?? model.preset;
  if ('visible' in data) model.visible = !!data.visible;
  if ('pulse' in data) model.pulse = data.pulse;
  if ('live' in data) {
    model.live = data.live;
    model.liveAt = performance.now();
  }
  update();
}

// --- Studio's editor (iframe): the preview data, never sent to OBS ------------------------------------------------------
if (PREVIEW) {
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'mo:preview') return;
    receive(e.data);
  });
  parent.postMessage({ type: 'mo:ready' }, location.origin);
} else {
  // --- OBS: Studio's state (long poll). Studio gone: the widget fades out, then comes back with Studio. ---------------
  const token = location.hash.slice(1);
  let since = 0;
  let fails = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    if (!/^[a-f0-9]{32}$/.test(token)) return; // not the URL Studio gave: nothing shown
    for (;;) {
      try {
        const res = await fetch(`state?since=${since}`, {
          headers: { 'x-overlay-token': token },
          cache: 'no-store',
        });
        if (res.status === 403) return; // a token from another Studio: the source's URL must be repaired in Studio
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        since = data.version;
        fails = 0;
        if (model.offline) model.offline = false;
        receive(data);
      } catch {
        fails++;
        if (fails >= 2 && !model.offline) {
          model.offline = true;
          update();
        }
        await sleep(Math.min(10_000, 500 * 2 ** fails));
      }
    }
  })();
}
