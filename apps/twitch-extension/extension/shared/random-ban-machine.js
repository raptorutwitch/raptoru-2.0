// Mini-jeux › Random Ban V4/V5 — the draw machine (left of the game screen). A carousel: the viewers pass THROUGH the
// centre (the big portrait), their neighbours smaller and darker on each side; a light scope frames the centre. It
// SHOWS the Core's draw: `play()` scrolls the strip the Core built after its draw and stops on the Core's target
// (`stop`). It never picks anyone. The stream's own ban alerts are Studio's, untouched: this is the player's view only.
// One requestAnimationFrame loop, only while something moves; seven reused slots, never a node per viewer.

import { carouselSlot, reelProgress } from './random-ban-model.js';

const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Twitch pictures (the Core's cache) or the Lab demo's own; anything else shows the initials. */
export const okPicture = (u) =>
  typeof u === 'string' && (/^https:\/\/static-cdn\.jtvnw\.net\/[^\s"'<>]+$/.test(u) || /^\/av\/[\w-]+\.svg$/.test(u));
const hue = (s) => [...String(s ?? '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17);
const initials = (n) => String(n ?? '?').replace(/^@/, '').slice(0, 2).toUpperCase();

/** A round portrait: the picture over the initials (a picture that fails to load is removed, the initials stay). */
export const face = (item, cls = 'rb-face') =>
  `<span class="${cls}" style="--h:${hue(item?.name)}"><i>${esc(initials(item?.name))}</i>${
    okPicture(item?.avatar) ? `<img src="${esc(item.avatar)}" alt="" draggable="false">` : ''
  }</span>`;

const SLOTS = 7; // the centre and three on each side (the outer ones fade out while moving)
const SPIN_SPEED = 7; // portraits per second while the Core draws
const REEL_MS = 3600;

const SIGHT = `<svg class="rbm__sight" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="47" class="rbm__ring"/>
  <path class="rbm__ticks" d="M50 0v7M50 93v7M0 50h7M93 50h7"/>
  <path class="rbm__corners" d="M16 30V16h14M70 16h14v14M84 70v14H70M30 84H16V70"/>
</svg>`;

export function createMachine(document, { reduced = false } = {}) {
  const win = document.defaultView ?? globalThis;
  const node = document.createElement('div');
  node.className = 'rbm';
  node.dataset.mode = 'idle';
  node.innerHTML = `<div class="rbm__frame">
      <div class="rbm__deck" data-m="deck"></div>
      ${SIGHT}
      <div class="rbm__badge" data-m="badge" hidden></div>
      <div class="rbm__name" data-m="name"></div>
      <div class="rbm__status" data-m="status"></div>
    </div>
    <p class="rbm__info" data-m="info"></p>`;
  const $ = (k) => node.querySelector(`[data-m="${k}"]`);
  const deck = $('deck');
  const slots = Array.from({ length: SLOTS }, () => {
    const el = document.createElement('span');
    el.className = 'rbm__slot';
    el.dataset.idx = '';
    deck.append(el);
    return el;
  });

  let items = []; // what passes through the centre
  let loop = false; // the pool loops (idle, spin); the Core's strip does not
  let pos = 0; // fractional index at the centre
  let raf = 0;
  let anim = null; // { kind: 'spin', from, at } | { kind: 'reel', from, to, at, done }
  let placeholder = true; // idle: the centre is a « ? », the viewers wait around it

  const itemAt = (i) => {
    if (!items.length) return null;
    if (loop) return items[((i % items.length) + items.length) % items.length];
    return items[i] ?? null;
  };

  /** Puts every slot where `pos` says (cheap: transforms and opacity; a portrait is rebuilt only when it changes). */
  function layout() {
    const base = Math.floor(pos);
    const frac = pos - base;
    const width = deck.clientWidth || 200;
    const size = Math.min(width * 0.54, deck.clientHeight * 0.84 || 999, 168);
    node.style.setProperty('--size', `${size.toFixed(1)}px`);
    slots.forEach((el, k) => {
      const idx = base + k - 3;
      const d = k - 3 - frac;
      const it = itemAt(idx);
      const s = carouselSlot(d);
      const centreHole = placeholder && s.front;
      const key = it && !centreHole ? `${idx}:${it.id}` : '';
      if (el.dataset.idx !== key) {
        el.dataset.idx = key;
        el.innerHTML = key ? face(it, 'rb-face rb-face--slot') : '';
      }
      el.style.transform = `translate(-50%, -50%) translateX(${(s.x * size).toFixed(1)}px) scale(${s.scale.toFixed(3)})`;
      el.style.opacity = key ? s.opacity.toFixed(3) : '0';
      el.style.setProperty('--dim', s.dim.toFixed(3));
      el.style.zIndex = String(10 - Math.round(Math.abs(d) * 2));
      el.classList.toggle('is-front', s.front);
    });
    const centre = placeholder ? null : itemAt(Math.round(pos));
    $('name').textContent = centre?.name ?? '';
  }

  function frame(now) {
    raf = 0;
    if (!anim) return;
    if (anim.kind === 'spin') pos = anim.from + ((now - anim.at) / 1000) * SPIN_SPEED;
    else {
      const t = (now - anim.at) / (anim.ms || REEL_MS);
      pos = anim.from + (anim.to - anim.from) * reelProgress(t);
      if (t >= 1) {
        pos = anim.to;
        const done = anim.done;
        anim = null;
        layout();
        return done();
      }
    }
    layout();
    raf = win.requestAnimationFrame(frame);
  }
  const run = (a) => {
    anim = a;
    if (!raf) raf = win.requestAnimationFrame(frame);
  };
  const halt = () => {
    anim = null;
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
  };

  const status = (text, tone = '') => {
    $('status').textContent = text;
    $('status').dataset.tone = tone;
  };
  const mode = (m) => {
    node.dataset.mode = m;
  };
  const badge = (text, tone = '') => {
    $('badge').hidden = !text;
    $('badge').textContent = text ?? '';
    $('badge').dataset.tone = tone;
  };
  const reset = () => {
    node.classList.remove('is-sniped', 'is-locked');
    badge(null);
  };
  const samePool = (pool) => loop && items.length === pool.length && items.every((x, i) => x.id === pool[i]?.id);

  return {
    node,
    get busy() {
      return node.dataset.mode === 'reel';
    },
    /** At rest: an empty sight in the centre, the viewers it could land on around it. */
    idle(pool, text) {
      if (node.dataset.mode === 'reel') return;
      halt();
      reset();
      mode(pool.length ? 'idle' : 'empty');
      if (!samePool(pool) || !placeholder) {
        items = pool;
        loop = true;
        pos = Math.floor(pool.length / 2);
      }
      placeholder = true;
      status(text, '');
      layout();
    },
    /** Paid, the Core has not drawn yet: the viewers run through the centre, nothing is decided here. */
    spin(pool) {
      if (node.dataset.mode === 'reel' || node.dataset.mode === 'spin') return;
      reset();
      mode('spin');
      items = pool;
      loop = true;
      placeholder = !pool.length;
      status('Tirage en cours…', 'wait');
      if (reduced || !pool.length) {
        halt();
        return layout();
      }
      run({ kind: 'spin', from: pos, at: win.performance?.now?.() ?? Date.now() });
    },
    /**
     * The Core's strip: through the centre, slowing down, a clean stop on the Core's target. Resolves when stopped.
     * `ms`: the reel's length (anti-spoil: it lands when the stream's alert reveals the target).
     */
    play(strip, ms = REEL_MS) {
      halt();
      reset();
      mode('reel');
      items = strip.items;
      loop = false;
      placeholder = false;
      status('Tirage…', 'wait');
      return new Promise((resolve) => {
        const land = () => {
          node.classList.add('is-locked');
          mode('result');
          resolve();
        };
        if (reduced || strip.stop < 1) {
          pos = strip.stop;
          layout();
          return land();
        }
        pos = 0;
        layout();
        run({ kind: 'reel', from: 0, to: strip.stop, ms, at: win.performance?.now?.() ?? Date.now(), done: land });
      });
    },
    /** The outcome on the target (the Core's words), and the Sniper's. */
    result(target, m) {
      if (node.dataset.mode === 'reel') return;
      halt();
      mode('result');
      node.classList.add('is-locked');
      const centre = itemAt(Math.round(pos));
      if (target && centre?.id !== target.id) {
        // No strip to land on (a refresh, a result without a draw): the target alone in the centre.
        items = [target];
        loop = false;
        pos = 0;
      }
      placeholder = !target;
      layout();
      if (!target) $('name').textContent = '';
      status(m.text, m.tone);
      const sn = m.sniper;
      badge(sn?.text || null, sn?.tone ?? '');
    },
    /** A Sniper hit: the sight turns green and closes in — once (the caller remembers it). */
    sniped() {
      node.classList.remove('is-sniped');
      void node.offsetWidth;
      node.classList.add('is-sniped');
    },
    /** The line under the machine: what the player should know now (availability, a delay, the connection). */
    info(text, tone = '') {
      $('info').textContent = text ?? '';
      $('info').dataset.tone = tone;
    },
    relayout: layout,
    destroy: halt,
  };
}
