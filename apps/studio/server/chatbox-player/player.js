/* global EventSource */
// Chatbox Raptoru — the OBS page (docs/CHATBOX.md § 5.2). One page for every profile and scene, chosen by its address:
// player.html?profile=<id>&scene=<id>[&feed=demo][&explain=1][&fit=1][&preset=<id>]#<token>. It only displays: Studio
// decides what is shown (visibility rules) and sends the profile's settings, applied at once without a reload. The
// stack glides with FLIP (transform only, never an animated height). A page left on an older Studio build reloads.

import {
  accentColor,
  buildCatalog,
  liftColor,
  nameColor,
  parse,
  soloSize,
} from './engine.js';

const q = new URLSearchParams(location.search);
const token = location.hash.slice(1);
const opt = {
  profile: q.get('profile') ?? 'just-chatting',
  scene: q.get('scene') ?? '',
  feed: q.get('feed') === 'demo' ? 'demo' : 'live',
  explain: q.get('explain') === '1',
  fit: q.get('fit') === '1',
  preset: q.get('preset') ?? '',
};

const box = document.getElementById('box');
const log = document.getElementById('log');
const bar = document.querySelector('#progress span');

let S = null; // the profile's settings
let P = { x: 0, y: 0, w: 480, h: 640, zoom: 1 }; // the scene's placement
let catalog = new Map();
let build = null;
let idleTimer = null;
const arrivals = [];

const hexRgb = (hex) =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const rgba = (hex, a) =>
  `rgba(${hexRgb(hex).join(',')},${Math.max(0, Math.min(1, a))})`;
const px = (n) => `${n}px`;

function cardBackground(c) {
  if (c.style === 'none') return 'transparent';
  if (c.style === 'gradient')
    return `linear-gradient(90deg, ${rgba(c.color, c.opacity)} 0%, ${rgba(c.color, c.opacity * 0.72)} 58%, ${rgba(c.color, 0)} 100%)`;
  return rgba(c.color, c.opacity);
}

function textShadow(t) {
  if (!(t > 0)) return 'none';
  return `0 1px ${(1 + 1.5 * t).toFixed(2)}px rgba(0,0,0,${(0.35 + 0.55 * t).toFixed(2)}), 0 0 ${(2 + 7 * t).toFixed(1)}px rgba(0,0,0,${(0.18 + 0.32 * t).toFixed(2)})`;
}

function applySettings(s) {
  S = s;
  const v = {
    '--name-font': `'${s.name.family}'`,
    '--name-weight': s.name.weight,
    '--name-size': px(s.name.size),
    '--text-font': `'${s.text.family}'`,
    '--text-weight': s.text.weight,
    '--text-size': px(s.text.size),
    '--lh': s.text.lineHeight,
    '--text-color': s.text.color,
    '--badge': px(s.badge.size),
    '--emote': px(s.emote.size),
    '--gif-w': px(s.gif.maxWidth),
    '--gif-h': px(s.gif.maxHeight),
    '--card-bg': cardBackground(s.card),
    '--card-bg-hl':
      s.card.style === 'none'
        ? rgba(s.card.color, 0.45)
        : rgba(s.card.color, Math.max(s.card.opacity, 0.35)),
    '--border': rgba(s.card.border, s.card.borderOpacity),
    '--border-w': px(s.card.borderWidth),
    '--radius': px(s.card.radius),
    '--pad-x': px(s.card.padX),
    '--pad-y': px(s.card.padY),
    '--gap': px(s.card.gap),
    '--edge': px(s.card.edge),
    '--card-shadow':
      s.card.shadow > 0
        ? `0 ${(4 + 8 * s.card.shadow).toFixed(1)}px ${(12 + 22 * s.card.shadow).toFixed(1)}px rgba(0,0,0,${(0.45 * s.card.shadow).toFixed(2)})`
        : 'none',
    '--text-shadow': textShadow(s.textShadow),
    '--emote-shadow':
      s.textShadow >= 0.5
        ? `drop-shadow(0 1px 2px rgba(0,0,0,${(0.55 * s.textShadow).toFixed(2)}))`
        : 'none',
    '--bar': px(s.roles.bar),
    '--c-broadcaster': s.roles.broadcaster,
    '--c-moderator': s.roles.moderator,
    '--c-vip': s.roles.vip,
    '--others': s.latest.others,
    '--enter-ms': `${s.enter.duration}ms`,
    '--enter-d': px(s.enter.distance),
    '--fade-ms': `${s.presence.fade}ms`,
    '--progress-h': px(s.presence.progress),
    '--opacity': s.opacity,
  };
  for (const [k, val] of Object.entries(v))
    box.style.setProperty(k, String(val));
  box.className = [
    `enter-${s.enter.style}`,
    s.latest.enabled ? 'latest-on' : '',
    s.latest.enabled && s.latest.dimText ? 'dim-text' : '',
    s.card.width === 'fit' ? 'fit' : '',
    s.presence.mode === 'idle' && s.presence.progress > 0 ? 'has-progress' : '',
    box.classList.contains('is-idle-hidden') && s.presence.mode === 'idle'
      ? 'is-idle-hidden'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (s.presence.mode === 'permanent') {
    clearTimeout(idleTimer);
    box.classList.remove('is-idle-hidden');
  }
  enforceLimit();
  trimOverflow();
  topFade();
}

function applyPlacement(p) {
  P = p;
  const z = p.zoom || 1;
  box.style.left = px(opt.fit ? 0 : p.x);
  box.style.top = px(opt.fit ? 0 : p.y);
  box.style.width = px(p.w / z);
  box.style.height = px(p.h / z);
  box.style.zoom = String(z);
  trimOverflow();
  topFade();
}

function img(src, cls, alt, onFail) {
  const i = document.createElement('img');
  i.className = cls;
  i.src = src;
  i.alt = alt;
  i.decoding = 'async';
  i.draggable = false;
  i.addEventListener('error', () => onFail(i));
  return i;
}

function emoteImg(e, cls) {
  return img(e.url, cls, e.code, (i) => {
    if (e.fallbackUrl && i.src !== e.fallbackUrl) {
      i.src = e.fallbackUrl;
      return;
    }
    if (e.provider === 'unicode') {
      const span = document.createElement('span');
      span.className = 'fallback-emoji';
      span.textContent = e.code;
      i.closest('.stack')?.replaceWith(span);
      return;
    }
    if (cls === 'base')
      i.closest('.stack')?.replaceWith(document.createTextNode(e.code));
    else i.remove();
  });
}

function renderBody(body, nodes) {
  for (const n of nodes) {
    if (n.type === 'text') body.append(document.createTextNode(n.value));
    else if (n.type === 'mention') {
      const m = document.createElement('span');
      m.className = 'mention';
      m.textContent = n.value;
      body.append(m);
    } else if (n.type === 'gif') {
      body.append(
        img(n.media.url, 'gif', n.media.placeholder || 'GIF', (i) =>
          i.remove(),
        ),
      );
    } else {
      const st = document.createElement('span');
      st.className = `stack${n.orphan ? ' is-orphan' : ''}`;
      st.append(emoteImg(n.base, 'base'));
      for (const o of n.overlays) st.append(emoteImg(o, 'zero'));
      body.append(st);
    }
  }
}

function build_(m) {
  const d = m.decision ?? { mode: 'normal' };
  const a = document.createElement('article');
  const parsed = parse(m, catalog);
  a.className = [
    'msg',
    m.role ? `role-${m.role}` : '',
    m.action ? 'is-action' : '',
    d.mode === 'highlight' ? 'is-hl' : '',
    d.mode === 'hide' ? 'is-hidden' : '',
    parsed.emoteOnly ? 'is-emote-only' : '',
  ]
    .filter(Boolean)
    .join(' ');
  a.dataset.id = m.id;
  a.dataset.user = m.user.id;
  if (d.mode === 'highlight')
    a.style.setProperty('--hl', accentColor(m.accent, S.accent));
  if (parsed.emoteOnly)
    a.style.setProperty('--solo', px(soloSize(parsed.units, S.emote.solo)));

  const bg = document.createElement('div');
  bg.className = 'bg';
  const meta = document.createElement('header');
  meta.className = 'meta';
  const badges = document.createElement('span');
  badges.className = 'badges';
  for (const b of m.user.badges ?? [])
    if (b.url) badges.append(img(b.url, 'badge', b.set, (i) => i.remove()));
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = m.user.name;
  const color = nameColor(m.user.login, m.user.color);
  name.style.color = S.nameContrast ? liftColor(color) : color;
  meta.append(badges, name);
  if (d.mode === 'highlight' && d.label) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = d.label;
    meta.append(tag);
  }
  a.append(bg, meta);
  if (m.reply) {
    const r = document.createElement('div');
    r.className = 'reply';
    r.textContent = `en réponse à ${m.reply.name} : ${m.reply.text}`;
    a.append(r);
  }
  const body = document.createElement('div');
  body.className = 'body';
  renderBody(body, parsed.nodes);
  a.append(body);
  if (opt.explain && d.reason && d.reason !== 'message ordinaire') {
    const why = document.createElement('div');
    why.className = 'why';
    why.textContent = d.mode === 'hide' ? `Masqué : ${d.reason}` : d.reason;
    a.append(why);
  }
  return a;
}

const available = () => {
  const cs = getComputedStyle(box);
  return (
    box.clientHeight -
    Number.parseFloat(cs.paddingTop) -
    Number.parseFloat(cs.paddingBottom)
  );
};

function trimOverflow() {
  const gap = Number.parseFloat(getComputedStyle(log).rowGap) || 0;
  while (log.children.length > 1) {
    const first = log.firstElementChild;
    if (log.scrollHeight - first.offsetHeight - gap <= available() + 48) break;
    first.remove();
  }
}

function enforceLimit() {
  if (!S) return;
  while (log.children.length > S.maxMessages) log.firstElementChild?.remove();
}

function topFade() {
  if (!S) return;
  const { mode, size } = S.topFade;
  let fade = 0;
  if (mode === 'always') fade = size;
  else if (mode === 'overflow')
    fade = Math.max(0, Math.min(size, log.scrollHeight - (available() - size)));
  box.style.setProperty('--fade-top', px(fade));
}

function markLatest() {
  let latest = null;
  for (const el of log.children) {
    el.classList.remove('latest');
    if (
      !el.classList.contains('is-hidden') &&
      !el.classList.contains('leaving')
    )
      latest = el;
  }
  latest?.classList.add('latest');
}

/** FLIP: the messages already shown glide to their new place instead of jumping. */
function glide(change, ms) {
  const before = new Map(
    [...log.children].map((el) => [el, el.getBoundingClientRect().top]),
  );
  change();
  const z = P.zoom || 1;
  for (const [el, top] of before) {
    if (!el.isConnected) continue;
    const delta = (top - el.getBoundingClientRect().top) / z;
    if (Math.abs(delta) < 0.5) continue;
    el.style.transition = 'none';
    el.style.transform = `translateY(${delta}px)`;
    requestAnimationFrame(() => {
      el.style.transition = `transform ${ms}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      el.style.transform = '';
    });
  }
}

function wake(at = Date.now()) {
  if (!S || S.presence.mode !== 'idle') return;
  const left = S.presence.seconds * 1000 - (Date.now() - at);
  clearTimeout(idleTimer);
  if (left <= 0) {
    box.classList.add('is-idle-hidden');
    return;
  }
  box.classList.remove('is-idle-hidden');
  bar.style.transition = 'none';
  bar.style.transform = `scaleX(${left / (S.presence.seconds * 1000)})`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bar.style.transition = `transform ${left}ms linear`;
      bar.style.transform = 'scaleX(0)';
    }),
  );
  idleTimer = setTimeout(() => box.classList.add('is-idle-hidden'), left);
}

function add(m) {
  if (!S || log.querySelector(`[data-id="${CSS.escape(m.id)}"]`)) return;
  const now = Date.now();
  arrivals.push(now);
  while (arrivals.length && now - arrivals[0] > 1000) arrivals.shift();
  const burst = arrivals.length >= 4;
  const ms = Math.round(S.enter.duration * (burst ? 0.4 : 1));
  const el = build_(m);
  el.style.setProperty('--enter-ms', `${ms}ms`);
  el.classList.add('entering');
  el.addEventListener('animationend', () => el.classList.remove('entering'), {
    once: true,
  });
  glide(() => {
    log.append(el);
    enforceLimit();
    trimOverflow();
  }, ms);
  markLatest();
  topFade();
  if (m.decision?.mode !== 'hide') wake();
}

function removeWhere(test) {
  const gone = [...log.children].filter(test);
  if (!gone.length) return;
  for (const el of gone) el.classList.add('leaving');
  setTimeout(() => {
    glide(() => gone.forEach((el) => el.remove()), 320);
    markLatest();
    topFade();
  }, 220);
}

function reset(messages) {
  log.textContent = '';
  for (const m of messages) log.append(build_(m));
  enforceLimit();
  trimOverflow();
  markLatest();
  topFade();
  const last = [...messages].reverse().find((m) => m.decision?.mode !== 'hide');
  if (S?.presence.mode === 'idle') {
    if (last) wake(last.at);
    else box.classList.add('is-idle-hidden');
  }
}

async function loadCatalog() {
  try {
    const r = await fetch(`catalog.json?t=${encodeURIComponent(token)}`, {
      cache: 'no-store',
    });
    if (r.ok) catalog = buildCatalog((await r.json()).emotes);
  } catch {
    /* the emotes stay as text until the next catalogue */
  }
}

async function loadPreset(preset) {
  const r = await fetch(
    `settings.json?t=${encodeURIComponent(token)}&profile=${encodeURIComponent(opt.profile)}&preset=${encodeURIComponent(preset)}`,
    { cache: 'no-store' },
  );
  if (!r.ok) return;
  opt.preset = preset;
  applySettings((await r.json()).settings);
  reset(lastHistory());
}

// The messages currently shown, as data (a preset switch re-renders them without waiting for new ones).
const shown = new Map();
const lastHistory = () => [...shown.values()];

function connect() {
  const params = new URLSearchParams({
    t: token,
    profile: opt.profile,
    scene: opt.scene,
    feed: opt.feed,
    ...(opt.explain ? { explain: '1' } : {}),
    ...(opt.preset ? { preset: opt.preset } : {}),
  });
  const es = new EventSource(`events?${params}`);
  let ready = Promise.resolve();
  const on = (type, fn) =>
    es.addEventListener(type, (e) => {
      const data = JSON.parse(e.data);
      ready = ready.then(() => fn(data)).catch(() => {});
    });
  on('hello', async (d) => {
    if (build && d.build !== build) {
      location.reload();
      return;
    }
    build = d.build;
    applySettings(d.settings);
    applyPlacement(d.placement);
    await loadCatalog();
  });
  on('settings', (d) => {
    if (d.settings && !opt.preset) applySettings(d.settings);
    if (d.placement) applyPlacement(d.placement);
    reset(lastHistory());
  });
  on('catalog', () => loadCatalog());
  on('history', (d) => {
    shown.clear();
    for (const m of d.messages) shown.set(m.id, m);
    reset(d.messages);
  });
  on('msg', (d) => {
    shown.set(d.message.id, d.message);
    while (shown.size > 160) shown.delete(shown.keys().next().value);
    add(d.message);
  });
  on('delete', (d) => {
    shown.delete(d.id);
    removeWhere((el) => el.dataset.id === d.id);
  });
  on('clear_user', (d) => {
    for (const [id, m] of shown) if (m.user.id === d.userId) shown.delete(id);
    removeWhere((el) => el.dataset.user === d.userId);
  });
  on('clear', () => {
    shown.clear();
    removeWhere(() => true);
  });
}

// Studio's editor (same origin): unsaved settings and placements are previewed live, a preset compared at once.
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || typeof e.data !== 'object')
    return;
  if (e.data.type === 'chatbox:draft') {
    if (e.data.settings) applySettings(e.data.settings);
    if (e.data.placement) applyPlacement(e.data.placement);
    reset(lastHistory());
  } else if (
    e.data.type === 'chatbox:preset' &&
    typeof e.data.preset === 'string'
  ) {
    void loadPreset(e.data.preset);
  }
});

new ResizeObserver(() => {
  trimOverflow();
  topFade();
}).observe(box);

connect();
