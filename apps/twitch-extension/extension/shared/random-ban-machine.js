// Mini-jeux › Random Ban V3 — the draw machine (left of the game screen). A scope: one big portrait in its sights, the
// name under it, a strip of thumbnails below (the viewers it passes through). It SHOWS the Core's draw: `play()` runs
// through the strip the Core built after its draw and stops on the Core's target (`stop`). It never picks anyone.
// The stream's own ban alerts are Studio's, untouched: this is the player's view only.

import { reelSchedule } from './random-ban-model.js';

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

const SCOPE = `<svg class="rbm__scope" viewBox="0 0 200 200" aria-hidden="true">
  <circle cx="100" cy="100" r="92" class="rbm__r1"/>
  <circle cx="100" cy="100" r="78" class="rbm__r2" pathLength="100"/>
  <g class="rbm__ticks">${Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r1 = i % 6 === 0 ? 84 : 88;
    return `<line x1="${(100 + Math.cos(a) * r1).toFixed(1)}" y1="${(100 + Math.sin(a) * r1).toFixed(1)}" x2="${(100 + Math.cos(a) * 92).toFixed(1)}" y2="${(100 + Math.sin(a) * 92).toFixed(1)}"/>`;
  }).join('')}</g>
  <path class="rbm__cross" d="M100 2v22M100 176v22M2 100h22M176 100h22"/>
</svg>
<svg class="rbm__lock" viewBox="0 0 200 200" aria-hidden="true">
  <path d="M38 62V38h24M138 38h24v24M162 138v24h-24M62 162H38v-24"/>
</svg>`;

export function createMachine(document, { reduced = false } = {}) {
  const win = document.defaultView ?? globalThis;
  const node = document.createElement('div');
  node.className = 'rbm';
  node.dataset.mode = 'idle';
  node.innerHTML = `<div class="rbm__frame">
      ${SCOPE}
      <div class="rbm__portrait" data-m="portrait"></div>
      <div class="rbm__name" data-m="name"></div>
      <div class="rbm__status" data-m="status"></div>
      <div class="rbm__badge" data-m="badge" hidden></div>
    </div>
    <div class="rbm__strip" aria-hidden="true"><div class="rbm__track" data-m="track"></div></div>`;
  const $ = (k) => node.querySelector(`[data-m="${k}"]`);
  let timers = [];
  let spinTimer = null;
  let trackSig = '';
  let thumbs = [];
  const stopTimers = () => {
    for (const t of timers) win.clearTimeout(t);
    timers = [];
    win.clearInterval(spinTimer);
    spinTimer = null;
  };

  function setTrack(items) {
    const sig = items.map((x) => x.id).join(',');
    if (sig === trackSig) return;
    trackSig = sig;
    thumbs = items;
    $('track').innerHTML = items.map((it, i) => `<span class="rbm__thumb" data-i="${i}">${face(it, 'rb-face rb-face--thumb')}</span>`).join('');
  }
  /** Centers thumbnail `i` under the portrait and marks it. */
  function focus(i, smooth = true) {
    const track = $('track');
    const el = track.children[i];
    track.querySelector('.is-on')?.classList.remove('is-on');
    if (!el) return;
    el.classList.add('is-on');
    const strip = track.parentElement;
    const x = strip.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2);
    track.style.transition = smooth && !reduced ? 'transform 0.18s ease-out' : 'none';
    track.style.transform = `translateX(${x}px)`;
  }
  function show(item, name = item?.name) {
    $('portrait').innerHTML = item ? face(item, 'rb-face rb-face--main') : '<span class="rbm__q">?</span>';
    $('name').textContent = name ?? '';
  }
  const status = (text, tone = '') => {
    $('status').textContent = text;
    $('status').dataset.tone = tone;
  };
  const mode = (m) => {
    node.dataset.mode = m;
  };

  return {
    node,
    get busy() {
      return node.dataset.mode === 'reel';
    },
    /** At rest: the scope empty, the viewers in its sights listed below. */
    idle(pool, text) {
      if (node.dataset.mode === 'reel') return;
      stopTimers();
      mode(pool.length ? 'idle' : 'empty');
      setTrack(pool.slice(0, 40));
      show(null, '');
      $('badge').hidden = true;
      node.classList.remove('is-sniped', 'is-locked');
      status(text, '');
      win.requestAnimationFrame(() => focus(Math.floor(Math.min(pool.length, 40) / 2), false));
    },
    /** Paid, the Core has not drawn yet: the portraits run, nothing is decided here. */
    spin(pool) {
      if (node.dataset.mode === 'reel' || node.dataset.mode === 'spin') return;
      stopTimers();
      mode('spin');
      node.classList.remove('is-sniped', 'is-locked');
      $('badge').hidden = true;
      setTrack(pool.slice(0, 40));
      status('Tirage en cours…', 'wait');
      if (!pool.length) return show(null, '');
      let i = 0;
      const step = () => {
        i = (i + 1) % thumbs.length;
        show(thumbs[i]);
        focus(i, false);
      };
      step();
      if (!reduced) spinTimer = win.setInterval(step, 110);
    },
    /** The Core's strip: through it, slowing down, to the Core's target at `stop`. Resolves when stopped. */
    play(strip) {
      stopTimers();
      mode('reel');
      node.classList.remove('is-sniped', 'is-locked');
      $('badge').hidden = true;
      const items = strip.items.slice(0, strip.stop + 1);
      setTrack(strip.items);
      status('Tirage…', 'wait');
      return new Promise((resolve) => {
        const land = () => {
          show(items[items.length - 1]);
          focus(strip.stop);
          node.classList.add('is-locked');
          mode('result');
          resolve();
        };
        if (reduced || items.length < 2) return land();
        const delays = reelSchedule(items.length);
        let at = 0;
        items.forEach((it, i) => {
          at += delays[i];
          if (i === items.length - 1) timers.push(win.setTimeout(land, at));
          else
            timers.push(
              win.setTimeout(() => {
                show(it);
                focus(i);
              }, at),
            );
        });
      });
    },
    /** The outcome on the target (the Core's words), and the Sniper's. */
    result(target, m) {
      if (node.dataset.mode === 'reel') return;
      stopTimers();
      mode('result');
      node.classList.add('is-locked');
      if (target) show(target);
      status(m.text, m.tone);
      const sn = m.sniper;
      const badge = $('badge');
      badge.hidden = !sn?.text;
      badge.textContent = sn?.text ?? '';
      badge.dataset.tone = sn?.hit ? 'hit' : '';
    },
    /** A Sniper hit: the lock turns green and closes in — once (the caller remembers it). */
    sniped() {
      node.classList.remove('is-sniped');
      void node.offsetWidth;
      node.classList.add('is-sniped');
    },
    destroy: stopTimers,
  };
}
