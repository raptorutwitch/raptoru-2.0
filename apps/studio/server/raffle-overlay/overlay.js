/* global document, location, fetch, localStorage, Audio, getComputedStyle, performance, requestAnimationFrame, setTimeout, clearTimeout, setInterval, URLSearchParams */
// Tombola V2 — the single OBS browser source (1920×1080, transparent), ported from the validated
// prototype prototypes/tombola-v2/overlay.html: opening C4, join feedback FIFO, Reveal G (normal /
// SUPER / giveaway), compact FULL OSEILLE roulette, cancellation, + « Aucun participant ».
// Anchored top-right (56 px / 56 px) in every phase. Never reloaded between rounds.
//
// The only input is Core's snapshot (through Studio, token in the URL hash): the overlay decides
// nothing — phases, timer (closes_at), winners and their amounts, FULL, the launch sound and its time
// window all come from Core. A reload rebuilds the current state without replaying the opening, the
// sound or old join feedbacks; a reveal in progress resumes where it is.
import { avatar, esc, fmt, hintMessage, ic } from './kit.js';
import {
  createFeed,
  FULL_TIMELINE,
  phaseOf,
  revealGTimeline,
  secondsLeft,
  serverNow,
  soundToPlay,
  totalSeconds,
} from './model.js';

const $ = (id) => document.getElementById(id);
const tb = $('tb');
const params = new URLSearchParams(location.search);
/** Studio preview: same page, never plays the launch sound (OBS is the only player). */
const PREVIEW = params.get('preview') === '1';
const token = location.hash.slice(1);
const POLL_LIVE_MS = 250;
const POLL_IDLE_MS = 1000;
const RING_R = 56;
const RING_C = 2 * Math.PI * RING_R;
const STATE = [
  'timeup',
  'timeup-red',
  'on',
  'announce',
  'drawing',
  'result',
  'exit',
  'cancel',
  'is-hot',
  'paused',
  'empty',
];

let snap = null;
let receivedAt = 0;
let phase = 'idle';
let builtId = null; // round whose opening block is built
let revealedId = null; // round whose reveal is on screen
let hydrating = true; // first snapshot after a (re)load: rebuild, never replay
const feed = createFeed();
/**
 * Core's clock, as a stable offset from the local clock: each read gives an estimate (server_time
 * at the middle of the request); it is only corrected when it drifts by more than 150 ms, so the
 * seconds never flicker back at a boundary (12 → 13 → 12) because of network jitter.
 */
let clockOffset = null;
const now = () =>
  clockOffset === null ? Date.now() : Date.now() + clockOffset;
const round = () => snap?.round ?? null;

// --- launch sound: once per round, never again after a reload --------------------------------------
const PLAYED_KEY = 'raptoru.tombola.sound.played';
const played = new Set(readPlayed());
function readPlayed() {
  try {
    return JSON.parse(localStorage.getItem(PLAYED_KEY) || '[]');
  } catch {
    return [];
  }
}
function markPlayed(id) {
  played.add(id);
  try {
    localStorage.setItem(PLAYED_KEY, JSON.stringify([...played].slice(-30)));
  } catch {
    /* in memory only */
  }
}
const soundState = (s) => (document.documentElement.dataset.tmbSound = s);
function maybePlaySound(r) {
  const s = soundToPlay(r, now(), played);
  if (!s) return;
  markPlayed(r.raffle_id);
  if (PREVIEW) return soundState(`preview:${r.raffle_id}`);
  const audio = new Audio(s.url);
  audio.volume = s.volume;
  soundState(`loading:${r.raffle_id}`);
  // A missing or corrupt file fails quietly: the overlay goes on without sound.
  audio.addEventListener('error', () => soundState(`error:${r.raffle_id}`), {
    once: true,
  });
  audio.play().then(
    () => soundState(`played:${r.raffle_id}`),
    () => soundState(`error:${r.raffle_id}`),
  );
}

// ================================================================================================
// Opening C4: built once per round; the timer only updates values in place.
// ================================================================================================
const XMARK =
  '<span class="xmark"><svg viewBox="0 0 40 40"><path d="M10 10 L30 30"/><path d="M30 10 L10 30"/></svg></span>';
function heroRing(r) {
  const box = 128;
  const m = box / 2;
  return `<span class="hero-ring">
      <svg class="t-ring" viewBox="0 0 ${box} ${box}"><circle class="bg" cx="${m}" cy="${m}" r="${RING_R}"/><circle class="fg" id="ringFg" cx="${m}" cy="${m}" r="${RING_R}" style="stroke-dasharray:${RING_C}"/></svg>
      <svg class="spin" viewBox="0 0 ${box} ${box}"><circle cx="${m}" cy="${m}" r="${RING_R}" fill="none" stroke="${r.kind === 'super' ? 'var(--t-gold)' : 'var(--t-teal)'}" stroke-linecap="round" stroke-dasharray="${RING_C * 0.28} ${RING_C}"/></svg>
      <span class="num"><b class="sec" id="sec"></b><span class="u" id="secU">secondes</span><span class="pz" aria-label="pause"><i></i><i></i></span></span><span class="emptyic">${ic('users')}</span>${XMARK}</span>`;
}
function money4(r, fromZero) {
  if (r.kind === 'giveaway')
    return `<span class="money"><span class="prize">${esc(r.prize)}</span></span>`;
  return `<span class="money"><span class="t-amount amt"><span id="amt">${fmt(fromZero ? 0 : r.amount)}</span></span><span class="cur">${esc(r.currency?.label ?? '')}</span></span>`;
}
function title4(r) {
  if (timeupOn) return 'Temps écoulé';
  // Core's titles (Studio labels): [name, state].
  const t = (state) => r.titles?.[state] ?? ['Tombola', ''];
  if (phase === 'cancel') return t('cancelled');
  if (phase === 'drawing') return 'Tirage en cours';
  if (phase === 'empty') return t('ended');
  if (phase === 'paused') return t('paused');
  return t('open');
}
/** Instruction under the block (display only): hidden · main entry command · custom text. */
function hintHtml() {
  const h = snap?.overlay_hint;
  if (!h || h.mode === 'none') return '';
  if (h.mode === 'custom')
    return h.text && h.text.trim() ? hintMessage(h.text.trim(), h.style) : '';
  return `<span class="cmd">${esc(snap.join_command ?? '!join')}</span>`;
}
function buildOpen(r, countUpNow) {
  const op = $('op');
  op.className = 'op op-c4';
  op.innerHTML = `<span class="ttl4" id="t4"></span>${money4(r, countUpNow)}${heroRing(r)}<span class="people"><span class="stack" id="stack"></span><span class="pc" title="participants">${ic('users')}<b id="pcount">0</b></span></span><span class="emptymsg" id="emptymsg">${esc(snap?.labels?.empty_message ?? 'Aucun participant cette fois !')}</span><span id="hint">${hintHtml()}</span>`;
  tb.classList.toggle('is-super', r.kind === 'super');
  lastSec = null;
  paintPeople(r, true);
  if (countUpNow) countUp(r);
}
let lastSec = null;
function paintTimer() {
  const r = round();
  if (!r || builtId !== r.raffle_id) return;
  const secs = secondsLeft(r, now());
  const total = totalSeconds(r);
  const quiet =
    (phase === 'drawing' && !timeupOn) ||
    phase === 'empty' ||
    phase === 'cancel';
  const sec = $('sec');
  if (sec) {
    const txt = quiet ? '' : timeupOn ? '0' : String(secs);
    if (sec.textContent !== txt) sec.textContent = txt;
  }
  const u = $('secU');
  if (u) {
    const t = phase === 'drawing' ? 'tirage' : 'secondes';
    if (u.textContent !== t) u.textContent = t;
  }
  const fg = $('ringFg');
  // Paused: the ring stays exactly where it was when Core paused (no catching up).
  if (fg && !ringFrozen) {
    // One step per second: fast move then a soft ease-out (CSS), never a constant slide.
    const offset =
      phase === 'cancel'
        ? 0
        : timeupOn
          ? RING_C
          : RING_C * (1 - Math.min(secs, total) / total);
    if (fg.style.strokeDashoffset !== `${offset}`)
      fg.style.strokeDashoffset = `${offset}`;
  }
  const t4 = $('t4');
  if (t4) {
    const t = title4(r);
    const [name, state] = Array.isArray(t) ? t : [t, ''];
    const html = `<span class="tn">${esc(name)}</span>${state ? ` <span class="ts">${esc(state)}</span>` : ''}`;
    if (t4.dataset.t !== html) {
      t4.dataset.t = html;
      t4.innerHTML = html;
    }
  }
  const hot = phase === 'running' && secs <= 10;
  tb.classList.toggle('is-hot', hot);
  if (hot && sec && lastSec !== null && lastSec !== secs) {
    sec.classList.remove('tick');
    void sec.offsetWidth;
    sec.classList.add('tick');
  }
  lastSec = secs;
}
/** Amount counting up at the opening (SUPER: slower, two steps). Never on a reload. */
function countUp(r) {
  if (r.kind === 'giveaway') return;
  const to = r.amount;
  const dur = r.kind === 'super' ? 1300 : 650;
  const t0 = performance.now() + (r.kind === 'super' ? 350 : 0);
  const step = (t) => {
    const el = $('amt');
    if (!el || builtId !== r.raffle_id) return;
    const k = Math.max(0, Math.min(1, (t - t0) / dur));
    el.textContent = fmt(
      k === 1 ? to : Math.round((to * (1 - (1 - k) ** 3)) / 100) * 100,
    );
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/** The last 5 pictures (newest on top): added one by one, never rebuilt on a read. */
function paintPeople(r, rebuild) {
  const st = $('stack');
  if (!st) return;
  const want = (r.recent ?? []).slice(0, 5);
  const ids = want.map((p) => p.viewer_id);
  if (rebuild) st.innerHTML = want.map((p) => avatar(p, 'still')).join('');
  else {
    const have = [...st.children].map((e) => e.dataset.id);
    for (const e of [...st.children])
      if (!ids.includes(e.dataset.id)) e.remove(); // removed by moderation
    want
      .filter((p) => !have.includes(p.viewer_id))
      .reverse()
      .forEach((p) => st.insertAdjacentHTML('afterbegin', avatar(p)));
    while (st.children.length > 5) st.lastElementChild.remove();
  }
  wireImages(st);
  [...st.children].forEach((e, i) => (e.style.zIndex = String(10 - i)));
  const pc = $('pcount');
  const n = String(r.participants ?? 0);
  if (pc && pc.textContent !== n) {
    pc.textContent = n;
    if (!rebuild) {
      pc.classList.remove('bump');
      void pc.offsetWidth;
      pc.classList.add('bump');
    }
  }
}
function wireImages(el) {
  for (const i of el.querySelectorAll('img[data-pp]:not([data-wired])')) {
    i.dataset.wired = '1';
    i.addEventListener('error', () => i.remove(), { once: true });
  }
}

// ================================================================================================
// Join feedback FIFO: one at a time (Core's join_feedback_ms), PP + Pseudo ✓, colour = source.
// ================================================================================================
const fifo = [];
let showing = false;
function enqueue(e) {
  fifo.push(e);
  pump();
}
function pump() {
  if (showing || !fifo.length) return;
  showing = true;
  const v = fifo.shift();
  const el = document.createElement('span');
  el.className = `join ${v.source === 'extension' ? 'ext' : ''}`;
  el.innerHTML = `${avatar(v)}<span class="jn">${esc(v.display_name)}</span><span class="ok">${ic('check')}</span>`;
  $('feed').append(el);
  wireImages(el);
  void el.offsetWidth;
  el.classList.add('in');
  const hold = fifo.length > 4 ? 900 : (snap?.join_feedback_ms ?? 1400);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => {
      el.remove();
      showing = false;
      pump();
    }, 200);
  }, hold);
}
/** The draw and the result cut the queue: no more join feedback on screen. */
function flushFeed() {
  fifo.length = 0;
  document.querySelectorAll('.join').forEach((e) => e.remove());
  showing = false;
}

// ================================================================================================
// Reveals (Reveal G and the compact FULL roulette). Amounts are Core's, the timeline Core's.
// ================================================================================================
let revealTimers = [];
const later = (fn, ms) => revealTimers.push(setTimeout(fn, Math.max(0, ms)));
function clearReveal() {
  revealTimers.forEach(clearTimeout);
  revealTimers = [];
}
function ctx(r) {
  const W = (r.reveal?.winners ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  return {
    W,
    k: W.length,
    sup: r.kind === 'super',
    give: r.kind === 'giveaway',
    label: r.currency?.label ?? '',
    short: r.currency?.short_label ?? '',
    amount: r.amount,
    prize: r.prize,
    pool: r.reveal?.pool ?? [],
    name: r.titles?.name ?? 'Tombola',
  };
}
function countTo(el, to, dur, prefix) {
  const t0 = performance.now();
  const step = (t) => {
    if (!el.isConnected) return;
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = `${prefix}${fmt(k === 1 ? to : Math.round(to * (1 - (1 - k) ** 3)))}`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/** Reveal G: centred header, winner cards with halo. `e` = ms already elapsed (reload resumes). */
function revealG(rv, x, e) {
  const u = esc(x.short);
  const name = x.name;
  const title = x.sup ? `${ic('star')}${esc(name)}` : esc(name);
  const money = x.give
    ? `<span class="gprize">${esc(x.prize)}</span>`
    : `<span class="gamt">${fmt(x.amount)}</span><span class="gcur">${esc(x.label)}</span>`;
  rv.className = `rv rv-g k-${x.sup ? 'super' : x.give ? 'giveaway' : 'normal'}`;
  rv.innerHTML = `<div class="card gh"><span class="ghtop"><span class="ttl4">${title}</span><span class="gcount" id="gcount">${ic('crown')}<b id="gcn">0</b> <span id="gcl">gagnant</span></span></span>
      <span class="ghmoney">${money}</span>${x.sup ? '<span class="gl"></span>' : ''}</div>
    <div class="gcs ${x.k > 5 ? 'compact' : ''}" id="cards"></div>`;
  const solo = x.k === 1;
  sizeG(rv, x, solo);
  const tl = revealGTimeline(x.sup ? 'super' : 'normal', x.k);
  const shown = new Set();
  const addCard = (i, instant) => {
    const w = x.W[i];
    const el = document.createElement('div');
    el.className = `gc ${solo ? 'solo' : ''} ${instant ? 'still' : ''}`;
    const val = x.give
      ? ''
      : `<span class="gv" id="gv${i}"><span class="v">+ 0</span><small>${u}</small></span>`;
    el.innerHTML = solo
      ? `${avatar(w)}<span class="gcol"><span class="gn">${esc(w.display_name)}</span>${x.give ? `<span class="glot">${esc(x.prize)}</span>` : val}</span>`
      : `${avatar(w)}<span class="gn">${esc(w.display_name)}</span>${x.give ? '<span class="gv on glot1">gagne le lot</span>' : val}`;
    $('cards').append(el);
    wireImages(el);
    fitCard(el, i, x, solo);
    shown.add(i);
    const n = $('gcn');
    n.textContent = String(shown.size);
    $('gcl').textContent = shown.size > 1 ? 'gagnants' : 'gagnant';
    if (!instant) {
      n.classList.remove('bump');
      void n.offsetWidth;
      n.classList.add('bump');
    }
  };
  /** The individual amount only once its card is in place, then it counts up. */
  const showGain = (i, instant, dur) => {
    const g = $(`gv${i}`);
    if (!g) return;
    g.classList.add('on');
    const v = g.querySelector('.v');
    if (instant) v.textContent = `+ ${fmt(x.W[i].amount)}`;
    else countTo(v, x.W[i].amount, dur, '+ ');
  };
  x.W.forEach((_, i) => {
    const at = tl.cards[i] - e;
    if (at <= 0) addCard(i, true);
    else later(() => addCard(i, false), at);
  });
  if (x.give) return;
  if (x.sup) {
    // SUPER: every card first (no amount), a short pause, then all the gains together.
    const at = tl.gains[0] - e;
    if (at <= 0) x.W.forEach((_, i) => showGain(i, true));
    else later(() => x.W.forEach((_, i) => showGain(i, false, tl.gainMs)), at);
  } else
    x.W.forEach((_, i) => {
      const at = tl.gains[i] - e;
      if (at <= 0) showGain(i, true);
      else later(() => showGain(i, false, tl.gainMs), at);
    });
}
/**
 * Width of Reveal G: the real content's (cards with their final gain), 280–380 px. Computed once at
 * the start: the block never moves while the cards arrive.
 */
function sizeG(rv, x, solo) {
  const u = esc(x.short);
  const m = document.createElement('div');
  m.className = `gcs ${x.k > 5 ? 'compact' : ''}`;
  m.style.cssText =
    'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none';
  m.innerHTML = x.W.map((w) => {
    const val = x.give
      ? ''
      : `<span class="gv on"><span class="v">+ ${fmt(w.amount)}</span><small>${u}</small></span>`;
    return solo
      ? `<div class="gc solo" style="width:max-content;animation:none">${avatar(w)}<span class="gcol"><span class="gn" style="overflow:visible">${esc(w.display_name)}</span>${x.give ? `<span class="glot">${esc(x.prize)}</span>` : val}</span></div>`
      : `<div class="gc" style="width:max-content;animation:none">${avatar(w)}<span class="gn" style="flex:none;overflow:visible">${esc(w.display_name)}</span>${x.give ? '<span class="gv on glot1">gagne le lot</span>' : val}</div>`;
  }).join('');
  rv.append(m);
  const cards = Math.max(0, ...[...m.children].map((c) => c.offsetWidth));
  m.remove();
  const gh = rv.querySelector('.gh');
  const head = Math.max(...[...gh.children].map((c) => c.scrollWidth)) + 30;
  // Compact: as wide as the real content, 240–330 px (no wide empty card).
  rv.style.width = `${Math.round(Math.min(330, Math.max(240, cards + 4, head)))}px`;
}
/**
 * The pseudo is the only flexible part: normal size if it fits, then smaller, « … » last. The gain
 * keeps the room of its final value from the start (counting up never pushes anything).
 */
function fitCard(el, i, x, solo) {
  const g = el.querySelector('.gv .v');
  if (g && !x.give) {
    const gv = g.parentElement;
    const t = g.textContent;
    g.textContent = `+ ${fmt(x.W[i].amount)}`;
    gv.style.minWidth = `${gv.offsetWidth}px`;
    g.textContent = t;
  }
  const nm = el.querySelector('.gn');
  const compact = !!el.closest('.compact');
  let size = solo ? 22 : compact ? 16 : 18;
  const min = solo ? 14 : compact ? 12 : 13;
  nm.style.fontSize = `${size}px`;
  // Cards have their natural width: the pseudo only shrinks when the card reached its maximum and
  // the pseudo really overflows (never a size step lost on a pseudo that fits).
  const over = () => nm.scrollWidth > nm.clientWidth;
  while (size > min && over()) {
    size -= 1;
    nm.style.fontSize = `${size}px`;
  }
}
/** Long pseudo under the FULL roulette: smaller until it fits (28 → 16 px), « … » only in the end. */
function fitName(who) {
  const nm = who.querySelector('.nm');
  const crown = who.querySelector('svg');
  let size = 28;
  const apply = () => {
    who.style.fontSize = `${size}px`;
    if (crown)
      crown.style.width =
        crown.style.height = `${Math.max(16, Math.round(size * 0.78))}px`;
  };
  apply();
  const over = () => who.scrollWidth > who.parentElement.clientWidth;
  while (size > 16 && over()) {
    size -= 1;
    apply();
  }
  if (over()) nm.classList.add('clip');
}
/** FULL OSEILLE compact roulette (264 px frame, 212 px window, 56 px pictures). */
function revealFull(rv, x, e) {
  const win = x.W[0];
  const others = x.pool
    .filter((p) => p.viewer_id !== win.viewer_id)
    .sort(() => Math.random() - 0.5);
  const N = 40;
  const WI = 34;
  const items = Array.from({ length: N }, (_, i) =>
    i === WI || !others.length ? win : others[i % others.length],
  );
  rv.className = 'rv rv-full2 k-full';
  rv.innerHTML = `<div class="f2" id="f2"><span class="t-full">${ic('crown')} Full oseille</span><span class="famt2">${fmt(x.amount)}</span><span class="fcur">${esc(x.label)}</span>
    <div class="reel2" id="reel"><div class="trk" id="trk">${items.map((p) => avatar(p)).join('')}</div><span class="frame"></span></div><div class="fw2" id="fwin"></div></div>`;
  wireImages(rv);
  const reel = $('reel');
  const trk = $('trk');
  const STEP = 56 + 12;
  const pos = (i) => reel.clientWidth / 2 - (i * STEP + 28);
  const T = FULL_TIMELINE;
  const nameHtml = () =>
    `<span class="rafle pop">Rafle tout</span><span class="who pop" style="animation-delay:.12s">${ic('crown')}<span class="nm">${esc(win.display_name)}</span></span>`;
  const done = (instant) => {
    trk.style.transform = `translateX(${pos(WI)}px)`;
    trk.children[WI].classList.add('won');
    reel.classList.add('done');
    $('f2').classList.add('won');
    const show = () => {
      $('fwin').innerHTML = nameHtml();
      fitName($('fwin').querySelector('.who'));
    };
    if (instant) show();
    else later(show, T.name);
  };
  // Reload after the spin started: no replayed suspense, the outcome directly (never a spoiler: the
  // reveal already started on Core's clock).
  if (e > T.start) {
    rv.querySelector('.famt2').style.animation = 'none';
    return done(true);
  }
  trk.style.transform = `translateX(${pos(2)}px)`;
  later(() => {
    trk.animate(
      [
        { filter: 'blur(0px)' },
        { filter: 'blur(1.4px)', offset: 0.14 },
        { filter: 'blur(0px)', offset: 0.55 },
        { filter: 'blur(0px)' },
      ],
      { duration: T.spin },
    );
    const a = trk.animate(
      [
        { transform: `translateX(${pos(2)}px)` },
        { transform: `translateX(${pos(WI) - 18}px)` },
      ],
      {
        duration: T.spin,
        easing: 'cubic-bezier(.2,.62,.1,1)',
        fill: 'forwards',
      },
    );
    a.onfinish = () => {
      const b = trk.animate(
        [
          { transform: `translateX(${pos(WI) - 18}px)` },
          { transform: `translateX(${pos(WI)}px)` },
        ],
        {
          duration: T.settle,
          easing: 'cubic-bezier(.4,0,.2,1)',
          fill: 'forwards',
        },
      );
      b.onfinish = () => {
        a.cancel();
        b.cancel();
        done(false);
      };
    };
  }, T.start - e);
}
function reveal(r) {
  clearReveal();
  const rv = $('rv');
  rv.style.width = ''; // Reveal G sets its own width; FULL has a fixed one (264 px)
  const x = ctx(r);
  if (!x.k) {
    rv.innerHTML = '';
    return;
  }
  const e = Math.max(0, now() - Date.parse(r.reveal_at));
  if (r.reveal.is_full) revealFull(rv, x, e);
  else revealG(rv, x, e);
  void rv.offsetWidth;
  rv.classList.add('in');
}

// ================================================================================================
// Applying Core's snapshot (the only input of the overlay)
// ================================================================================================
let exitTimer = 0;
// --- end of the countdown (visual only: Core already closed the entries at closes_at) ------------
let timeupOn = false;
let timeupTimers = [];
/** 0 stays visible, then a short red « temps écoulé » with a small shake, then « Tirage en cours ». */
function startTimeup() {
  timeupOn = true;
  tb.classList.add('timeup');
  paintTimer();
  timeupTimers = [
    setTimeout(() => tb.classList.add('timeup-red'), 380),
    setTimeout(() => endTimeup(true), 380 + 640),
  ];
}
function endTimeup(toDrawing) {
  timeupTimers.forEach(clearTimeout);
  timeupTimers = [];
  if (!timeupOn) return;
  timeupOn = false;
  tb.classList.remove('timeup', 'timeup-red');
  if (toDrawing && phase === 'drawing') tb.classList.add('drawing');
  paintTimer();
}
// --- pause: the ring stops where it is (any running transition is cut) ----------------------------
let ringFrozen = false;
function freezeRing() {
  const fg = $('ringFg');
  if (!fg) return;
  const at = getComputedStyle(fg).strokeDashoffset;
  fg.style.transition = 'none';
  fg.style.strokeDashoffset = at;
  ringFrozen = true;
}
function unfreezeRing() {
  ringFrozen = false;
  const fg = $('ringFg');
  if (!fg) return;
  void fg.getBoundingClientRect();
  fg.style.transition = '';
}
function setPhase(p, prev, r) {
  if (timeupOn && p !== 'drawing') endTimeup(false);
  tb.classList.remove(
    ...STATE.filter(
      (c) => c !== 'is-hot' && !(timeupOn && c.startsWith('timeup')),
    ),
  );
  clearTimeout(exitTimer);
  if (p === 'paused') freezeRing();
  else if (ringFrozen) unfreezeRing();
  if (p === 'idle') {
    // End of a round seen live: the block fades out, then everything is cleared.
    if (['result', 'empty', 'cancel', 'exit'].includes(prev)) {
      tb.classList.add('exit');
      $('rv').classList.add('out');
      exitTimer = setTimeout(clearAll, 450);
    } else clearAll();
    return;
  }
  tb.classList.add('on');
  if (p === 'announce') tb.classList.add('announce');
  if (p === 'paused') tb.classList.add('paused');
  if (['drawing', 'result', 'empty', 'cancel', 'exit'].includes(p)) flushFeed();
  if (p === 'drawing') {
    // Seen live at the real end of the countdown: 0, then the short « temps écoulé ». A manual
    // « Tirer maintenant » or a reload goes straight to the drawing.
    const ended = r && Date.parse(r.closes_at) - now() <= 400;
    if (!hydrating && ended && ['running', 'announce'].includes(prev))
      startTimeup();
    else if (!timeupOn) tb.classList.add('drawing');
  }
  if (p === 'empty') tb.classList.add('empty');
  if (p === 'cancel') tb.classList.add('cancel');
  if (p === 'result') {
    tb.classList.add('result');
    if (revealedId !== r.raffle_id) {
      revealedId = r.raffle_id;
      reveal(r);
    }
  }
  if (p === 'exit') {
    tb.classList.add('exit', revealedId === r.raffle_id ? 'result' : 'empty');
    $('rv').classList.add('out');
  }
  if (p !== 'result' && p !== 'exit') {
    clearReveal();
    $('rv').innerHTML = '';
    $('rv').className = 'rv';
  }
}
function clearAll() {
  tb.classList.remove(...STATE);
  clearReveal();
  $('rv').innerHTML = '';
  $('rv').className = 'rv';
  $('rv').style.width = '';
  flushFeed();
}
function apply() {
  const r = round();
  const prev = phase;
  phase = phaseOf(r, now());
  if (r && r.raffle_id !== builtId && phase !== 'idle') {
    clearTimeout(exitTimer);
    clearAll();
    builtId = r.raffle_id;
    revealedId = null;
    // The opening animation only for a round seen opening live (never on a reload).
    buildOpen(r, phase === 'announce' && !hydrating);
    setPhase(phase, 'idle', r);
  } else if (r && builtId === r.raffle_id) {
    const hint = hintHtml();
    if ($('hint').innerHTML !== hint) $('hint').innerHTML = hint;
    const msg = snap?.labels?.empty_message ?? 'Aucun participant cette fois !';
    if ($('emptymsg').textContent !== msg) $('emptymsg').textContent = msg;
    paintPeople(r, false);
    if (phase !== prev) setPhase(phase, prev, r);
  } else if (phase !== prev) setPhase(phase, prev, r);
  // New entries only (Core's seq): the first read after a load just primes the cursor.
  const fresh = feed.take(r?.entries_tail);
  if (['announce', 'running', 'paused'].includes(phase)) fresh.forEach(enqueue);
  if (r) maybePlaySound(r);
  paintTimer();
  hydrating = false;
  document.documentElement.dataset.phase = phase;
}

let pollTimer = 0;
async function poll() {
  clearTimeout(pollTimer);
  const t0 = Date.now();
  try {
    const res = await fetch('/raffle-lab/snapshot', {
      headers: { 'x-raffle-token': token },
      cache: 'no-store',
    });
    if (res.ok) {
      snap = await res.json();
      receivedAt = (t0 + Date.now()) / 2;
      const estimate = serverNow(snap, receivedAt, Date.now()) - Date.now();
      if (clockOffset === null || Math.abs(estimate - clockOffset) > 150)
        clockOffset = estimate;
      apply();
    }
  } catch {
    /* Studio unreachable: keep the current picture, retry */
  }
  pollTimer = setTimeout(poll, phase === 'idle' ? POLL_IDLE_MS : POLL_LIVE_MS);
}
setInterval(() => {
  if (!snap) return;
  // Core's deadlines between two reads (e.g. cancel_until, overlay end): the phase follows the clock.
  const p = phaseOf(round(), now());
  if (p !== phase) apply();
  else paintTimer();
}, 200);
void poll();
