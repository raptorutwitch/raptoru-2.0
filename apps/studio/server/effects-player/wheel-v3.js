/* global document, window, Audio, performance, requestAnimationFrame, setTimeout, setInterval, clearInterval */
// Roue du Sub V3 (docs/SUB_WHEEL_V3.md § 13), the validated mock-up (prototypes/sub-wheel-v3/roue.html, iteration 6)
// made real: the Arcade wheel (12 lamps, amounts on the parts, pointer at 3 o'clock, the tier alone at the hub), ONE band
// under it — the viewer (picture, pseudo, months, equipped title) during the draw, then ONLY the gain — and the
// historical sounds (wheel.js's synths, the two mp3). It shows the draw Core recorded: it never draws, never computes a
// gain, and refuses to play when the recorded amount does not match its own part (`amount_mismatch`).
import {
  wheelSegmentStopSound,
  wheelSpinTickSound,
  wheelTickSound,
  wheelWinSound,
} from './wheel.js';

/** Three palettes (four colours per value level; the jackpot gold is common): the same one for the same viewer. */
const PALETTES = [
  {
    seg: ['#6b2c5c', '#d8604e', '#e8904a'],
    base: '#24101f',
    band: ['#3d1735', '#220a1e'],
  },
  {
    seg: ['#1b4d40', '#7ea85a', '#2fae74'],
    base: '#0e2620',
    band: ['#173f33', '#0b1f19'],
  },
  {
    seg: ['#2f3577', '#5b7fc4', '#3fb3c8'],
    base: '#101731',
    band: ['#1d2856', '#0d1431'],
  },
];
/** Casino chips: bronze (Prime / T1), ruby (T2), gold (T3). */
const TIER_COLOR = { 1: '#d08a58', 2: '#d65a7c', 3: '#f2c04e' };
const T = {
  intro: 450,
  spin: 2400,
  land: 250,
  reveal: 420,
  mult: 300,
  count: { 1: 800, 2: 900, 3: 1200 },
  breathe: 250,
  hold: 1300,
  holdJackpot: 1900,
  out: 400,
};
const AVATAR = /^https:\/\/static-cdn\.jtvnw\.net\/[^\s"'<>()]+$/;

/** FNV-1a of the Twitch id: the same palette for the same viewer, never a random one per show. */
export function paletteOf(id) {
  let h = 0x811c9dc5;
  for (const c of String(id ?? ''))
    h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h % PALETTES.length;
}
const money = (n) =>
  new Intl.NumberFormat('fr-FR')
    .format(n)
    .replace(/\s/g, String.fromCharCode(160));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const CSS = `
@font-face{font-family:'SW3 Lilita';src:url('/effects/fonts/lilita-one-latin.woff2') format('woff2');font-weight:400;font-display:block}
@font-face{font-family:'SW3 Rubik';src:url('/effects/fonts/rubik-latin.woff2') format('woff2');font-weight:300 900;font-display:block}
.sw3{position:absolute;right:300px;bottom:24px;z-index:50;display:flex;flex-direction:column;align-items:center;visibility:hidden;--cream:#fff3df;--lamp:#ffe3a3;--gold:#f4c55a}
.sw3.in{visibility:visible}
.sw3.inline{position:relative;right:auto;bottom:auto}
.sw3 .wheel,.sw3 .band{opacity:0;transition:transform .5s cubic-bezier(.25,1.25,.5,1),opacity .3s}
.sw3 .wheel{transform:translateY(40px) rotate(-120deg) scale(.85)}
.sw3 .band{transform:translateY(24px)}
.sw3.in .wheel,.sw3.in .band{opacity:1;transform:none}
.sw3.out .wheel,.sw3.out .band{opacity:0;transition:transform .38s ease-in,opacity .38s ease-in}
.sw3.out .wheel{transform:scale(.9)}
.sw3.out .band{transform:translateY(14px)}
.sw3 .wheel{position:relative;flex:none;width:330px;height:330px}
.sw3 .rot{position:absolute;inset:20px;will-change:transform}
.sw3 .rot svg,.sw3 .rim{display:block}
.sw3 .rim{position:absolute;inset:0}
.sw3 .glow{position:absolute;inset:0;z-index:1;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 66%,rgba(255,222,160,.6) 80%,transparent 94%);-webkit-mask:radial-gradient(closest-side,transparent 87%,#000 88%,#000 98%,transparent 99%);mask:radial-gradient(closest-side,transparent 87%,#000 88%,#000 98%,transparent 99%);mix-blend-mode:screen;animation:sw3-glow 6s linear infinite}
.sw3.spinning .glow{animation-duration:1.3s}
@keyframes sw3-glow{to{transform:rotate(-360deg)}}
.sw3 .hl{fill:transparent}.sw3 .hl.on{fill:rgba(255,243,223,.22)}
.sw3 .lbl{transition:opacity .3s}.sw3.landed .lbl:not(.on){opacity:.4}
.sw3 .ptr{position:absolute;right:-16px;top:50%;z-index:3;width:48px;height:38px;margin-top:-19px;transform-origin:39px 50%;background:linear-gradient(180deg,#ffe39a,#e0a634);clip-path:polygon(0 50%,66% 0,100% 14%,100% 86%,66% 100%);filter:drop-shadow(0 3px 4px rgba(0,0,0,.55))}
.sw3 .ptr::after{content:'';position:absolute;right:9px;top:50%;width:11px;height:11px;margin-top:-5.5px;border-radius:50%;background:var(--cream)}
.sw3 .ptr.flick{animation:sw3-flick .13s ease-out}
@keyframes sw3-flick{from{transform:rotate(-20deg)}}
.sw3 .hub{position:absolute;left:50%;top:50%;z-index:2;width:96px;height:96px;margin:-48px 0 0 -48px;display:grid;place-items:center;border-radius:50%;background:repeating-conic-gradient(var(--tc) 0 21deg,var(--cream) 21deg 30deg);box-shadow:0 0 0 4px var(--base),0 8px 18px rgba(0,0,0,.5);transition:transform .3s cubic-bezier(.3,1.8,.5,1)}
.sw3 .hub::before{content:'';position:absolute;inset:9px;border-radius:50%;background:radial-gradient(circle at 50% 30%,rgba(255,255,255,.35),transparent 60%),var(--tc);box-shadow:inset 0 0 0 2px rgba(0,0,0,.25)}
.sw3 .hub b{position:relative;font:400 34px/1 'SW3 Lilita',sans-serif;color:#2a1024}
.sw3 .hub b.prime{font-size:19px}
.sw3.has-mult .hub{transform:scale(1.14)}
.sw3 .lamp{fill:#5b4a52;animation:sw3-idle 1.6s steps(1) infinite}
.sw3 .lamp.odd{animation-delay:-.8s}
.sw3.spinning .lamp{animation:sw3-spin .3s steps(1) infinite}
.sw3.spinning .lamp.odd{animation-delay:-.15s}
.sw3.final .lamp{animation:sw3-win .5s steps(1) infinite}
.sw3.final.jackpot .lamp{animation:sw3-gold .22s steps(1) infinite}
.sw3.final.jackpot .lamp.odd{animation-delay:-.11s}
@keyframes sw3-idle{0%{fill:#c9a77a}50%{fill:#5b4a52}}
@keyframes sw3-spin{0%{fill:var(--lamp)}50%{fill:#5b4a52}}
@keyframes sw3-win{0%{fill:var(--lamp)}50%{fill:#9b8a7a}}
@keyframes sw3-gold{0%{fill:#ffd45c}50%{fill:var(--lamp)}}
.sw3 .band{position:relative;width:360px;height:88px;margin-top:8px;border-radius:20px;background:linear-gradient(180deg,var(--band1),var(--band2));box-shadow:0 0 0 3px var(--cream),0 14px 30px rgba(0,0,0,.5);transition:box-shadow .35s}
.sw3 .state{position:absolute;inset:0;display:flex;align-items:center;transition:opacity .25s,transform .32s cubic-bezier(.3,1.3,.5,1)}
.sw3 .st-id{gap:16px;padding:0 18px 0 16px}
.sw3 .pp{position:relative;flex:none;width:58px;height:58px}
.sw3 .ava{width:100%;height:100%;display:grid;place-items:center;border-radius:50%;background:linear-gradient(135deg,var(--s2),var(--s1)) center/cover;color:#fff;font:400 28px 'SW3 Lilita',sans-serif;box-shadow:0 0 0 3px var(--cream)}
.sw3 .mo{position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);white-space:nowrap;padding:1px 8px;border-radius:999px;background:var(--gold);color:#3a2104;font:800 12px/1.4 'SW3 Rubik',sans-serif;box-shadow:0 0 0 2px var(--band2)}
.sw3 .txt{min-width:0;flex:1;display:flex;flex-direction:column;justify-content:center;gap:4px}
.sw3 .name{font:800 24px/1.15 'SW3 Rubik',sans-serif;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sw3 .ttl{align-self:flex-start;max-width:100%;padding:1px 9px 2px;border-radius:8px;background:rgba(0,0,0,.42);font:700 16px/1.3 'SW3 Rubik',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sw3 .st-res{justify-content:center;gap:10px;opacity:0;transform:scale(.82)}
.sw3 .val{font:400 50px/1 'SW3 Lilita',sans-serif;color:var(--cream);font-variant-numeric:tabular-nums;text-shadow:0 2px 0 rgba(0,0,0,.35)}
.sw3 .mult{display:none;padding:2px 10px;border-radius:999px;background:var(--tc);color:#2a1024;font:400 24px/1.2 'SW3 Lilita',sans-serif}
.sw3 .unit{display:none;align-self:flex-end;margin-bottom:18px;font:800 14px 'SW3 Rubik',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--gold)}
.sw3.reveal .st-id{opacity:0;transform:translateY(-14px);transition-duration:.16s}
.sw3.reveal .st-res{opacity:1;transform:none;transition-delay:.16s}
.sw3.has-mult .mult{display:inline-block;animation:sw3-pop .3s cubic-bezier(.3,1.8,.5,1)}
.sw3.counting .val{animation:sw3-pulse .14s ease-in-out infinite alternate}
.sw3.final .mult{display:none}.sw3.final .unit{display:inline}
.sw3.final .val{background:linear-gradient(180deg,#fff6dc,#f4c55a 70%,#e3a32e);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none;filter:drop-shadow(0 2px 0 rgba(0,0,0,.4))}
.sw3.final.jackpot .band{box-shadow:0 0 0 3px var(--gold),0 0 34px rgba(244,197,90,.55),0 14px 30px rgba(0,0,0,.5)}
.sw3.final.jackpot .val{filter:drop-shadow(0 0 10px rgba(244,197,90,.7))}
.sw3 .fx{position:absolute;left:50%;top:50%;width:0;height:0}
.sw3 .fx i{position:absolute;left:0;top:0;width:var(--s,8px);height:var(--s,8px);border-radius:2px;background:var(--pc,#f2d77c);opacity:0;animation:sw3-burst var(--d,1s) cubic-bezier(.15,.7,.3,1) forwards}
@keyframes sw3-burst{0%{opacity:1;transform:translate(-50%,-50%) rotate(0) scale(1)}100%{opacity:0;transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) rotate(var(--r,0deg)) scale(.4)}}
@keyframes sw3-pop{from{transform:scale(.3)}}
@keyframes sw3-pulse{to{transform:scale(1.035)}}
`;

function ensureStyles() {
  if (document.getElementById('sw3-style')) return;
  const style = document.createElement('style');
  style.id = 'sw3-style';
  style.textContent = CSS;
  document.head.append(style);
  // The titles are drawn by the Core's own stylesheet (the same as raptoru.fr), relayed by Studio on this origin.
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/cosmetics/style.css';
  document.head.append(link);
}

function wheelSVG(layout, levels, pal) {
  const a = 360 / layout.length;
  const pt = (r, deg) => {
    const t = ((deg - 90) * Math.PI) / 180;
    return [150 + r * Math.cos(t), 150 + r * Math.sin(t)].map((v) =>
      v.toFixed(1),
    );
  };
  let segs = '',
    hls = '',
    lbls = '';
  layout.forEach((p, i) => {
    const [x1, y1] = pt(150, i * a - a / 2),
      [x2, y2] = pt(150, i * a + a / 2);
    const d = `M150 150L${x1} ${y1}A150 150 0 0 1 ${x2} ${y2}Z`;
    const jp = levels[i] === 3;
    segs += `<path d="${d}" fill="${jp ? 'url(#sw3jp)' : pal.seg[levels[i]]}" stroke="${pal.base}" stroke-width="3"/>`;
    hls += `<path class="hl" data-pos="${i}" d="${d}"/>`;
    // Along the radius, read from the centre outwards: at 3 o'clock (the pointer) the amount is horizontal.
    const [x, y] = pt(95, i * a);
    const text = money(p.val * p.mult);
    const fs =
      (text.length >= 7 ? 20 : text.length === 6 ? 22 : 24) + (jp ? 2 : 0);
    lbls += `<text class="lbl" data-pos="${i}" x="${x}" y="${y}" transform="rotate(${i * a - 90} ${x} ${y})" text-anchor="middle" dominant-baseline="central" font-family="'SW3 Lilita', sans-serif" font-size="${fs}" fill="${jp ? '#3a2104' : '#fff'}" ${jp ? '' : `stroke="${pal.base}" stroke-width="5" paint-order="stroke" stroke-linejoin="round"`}>${text}</text>`;
  });
  return `<svg viewBox="0 0 300 300" width="100%" height="100%"><defs><linearGradient id="sw3jp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde49a"/><stop offset=".55" stop-color="#f4c55a"/><stop offset="1" stop-color="#df9d2c"/></linearGradient></defs>${segs}<g>${hls}</g>${lbls}</svg>`;
}
function rimSVG(pal) {
  let s = '';
  for (let i = 0; i < 12; i++) {
    const t = ((i * 30 + 15 - 90) * Math.PI) / 180;
    s += `<circle class="lamp ${i % 2 ? 'odd' : ''}" cx="${(165 + 155 * Math.cos(t)).toFixed(1)}" cy="${(165 + 155 * Math.sin(t)).toFixed(1)}" r="5.5"/>`;
  }
  return `<svg class="rim" viewBox="0 0 330 330"><circle cx="165" cy="165" r="155" fill="none" stroke="${pal.base}" stroke-width="18"/><circle cx="165" cy="165" r="163.5" fill="none" stroke="#fff3df" stroke-width="3"/>${s}</svg>`;
}

/** The value level of each part (0 small, 1 medium, 2 good, 3 jackpot), from the distinct amounts of the wheel. */
function levelsOf(layout) {
  const values = layout.map((p) => p.val * p.mult);
  const distinct = [...new Set(values)].sort((x, y) => x - y);
  return values.map((v) => {
    const i = distinct.indexOf(v);
    return i === distinct.length - 1 ? 3 : Math.min(i, 2);
  });
}

/** The equipped title, as Studio and raptoru.fr draw it (classes rc-title / rc-grad / rc-fx-*, variables --rc-*). */
function titleEl(t) {
  const style = t.style && typeof t.style === 'object' ? t.style : {};
  const el = document.createElement('span');
  const effect =
    typeof style.effect === 'string' && /^[a-z]{1,16}$/.test(style.effect)
      ? style.effect
      : 'none';
  el.className =
    'rc-title' +
    (style.gradient ? ' rc-grad' : '') +
    (effect !== 'none' ? ` rc-fx-${effect}` : '');
  const hex = (v) =>
    typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
  const set = (k, v) => v && el.style.setProperty(k, v);
  set('--rc-color', hex(style.color));
  if (style.gradient) {
    set('--rc-from', hex(style.gradient.from));
    set('--rc-to', hex(style.gradient.to));
    if (Number.isInteger(style.gradient.angle))
      set('--rc-angle', `${style.gradient.angle}deg`);
  }
  set('--rc-weight', style.weight === 'normal' ? '400' : '700');
  el.textContent = String(t.label ?? '').slice(0, 40);
  return el;
}

function flick(el) {
  el.classList.remove('flick');
  void el.offsetWidth;
  el.classList.add('flick');
}

function spinTo(root, pos) {
  const el = root.querySelector('.rot'),
    ptr = root.querySelector('.ptr');
  const a = 30;
  let rot = Math.random() * 360;
  // The winning part stops exactly at 3 o'clock (screen angle 90°): its amount is horizontal there.
  const want = (((90 - pos * a) % 360) + 360) % 360,
    cur = ((rot % 360) + 360) % 360;
  let d = (want - cur + 360) % 360;
  if (d < 90) d += 360;
  const from = rot,
    to = rot + d + 1080,
    peak = to + 4,
    split = 0.87;
  el.style.transform = `rotate(${rot}deg)`;
  let last = Math.floor((from + a / 2) / a),
    lastSnd = 0;
  return new Promise((res) => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / T.spin);
      if (t < split)
        rot = from + (peak - from) * (1 - Math.pow(1 - t / split, 4));
      else {
        const u = (t - split) / (1 - split);
        rot = peak + (to - peak) * u * u * (3 - 2 * u);
      }
      el.style.transform = `rotate(${rot}deg)`;
      const b = Math.floor((rot + a / 2) / a);
      if (b !== last) {
        last = b;
        flick(ptr);
        if (now - lastSnd > 28) {
          wheelSpinTickSound();
          lastSnd = now;
        }
      }
      if (t < 1) requestAnimationFrame(step);
      else res();
    };
    requestAnimationFrame(step);
  });
}

function count(el, from, to, dur, sounds) {
  const incr = new Audio(sounds.incr);
  incr.volume = 0.425;
  incr.play().catch(() => {});
  return new Promise((res) => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur),
        e = 1 - Math.pow(1 - t, 2.2);
      el.textContent = money(
        t < 1 ? Math.round((from + (to - from) * e) / 10) * 10 : to,
      );
      if (t < 1) return requestAnimationFrame(step);
      const fin = new Audio(sounds.fin);
      fin.volume = 0.45;
      fin.play().catch(() => {});
      // The counter's sound fades out under the end sound (as the legacy wheel does).
      setTimeout(() => {
        let k = 12;
        const id = setInterval(() => {
          incr.volume = Math.max(0, 0.425 * (--k / 12));
          if (k <= 0) {
            clearInterval(id);
            incr.pause();
          }
        }, 200 / 12);
      }, 80);
      res();
    };
    requestAnimationFrame(step);
  });
}

function burst(root, colors, jackpot) {
  const box = root.querySelector('.band .fx');
  box.innerHTML = '';
  for (let i = 0; i < (jackpot ? 32 : 14); i++) {
    const ang = Math.PI + Math.random() * Math.PI,
      dist = (jackpot ? 150 : 100) * (0.5 + Math.random() * 0.7),
      s = 6 + Math.random() * 6;
    const e = document.createElement('i');
    e.style.cssText = `--dx:${(Math.cos(ang) * dist * 1.5).toFixed(0)}px;--dy:${(Math.sin(ang) * dist).toFixed(0)}px;--pc:${colors[i % colors.length]};--s:${s.toFixed(1)}px;height:${(s * 0.6).toFixed(1)}px;--d:${(0.8 + Math.random() * 0.6).toFixed(2)}s;--r:${Math.round(Math.random() * 540)}deg`;
    box.append(e);
  }
}

/**
 * Plays one recorded V3 draw. `spin`: { name, viewer_id, tier, months, layout, segment, lot, coef, amount, avatar?,
 * title? }; `sounds`: { incr, fin }. Resolves once it left the screen; throws (nothing shown) when the draw does not
 * add up — the screen never shows another gain than the one Core recorded.
 */
export async function playWheel(stage, spin, sounds, place = {}) {
  const layout = spin.layout;
  const segment = Number(spin.segment);
  const part = Array.isArray(layout) ? layout[segment] : null;
  const tier = [1, 2, 3].includes(Number(spin.tier)) ? Number(spin.tier) : 1;
  const coef = Number(spin.coef ?? tier);
  if (!part || layout.length !== 12) throw new Error('segment_out_of_range');
  const lot = part.val * part.mult;
  if (Number(spin.lot ?? lot) !== lot || lot * coef !== Number(spin.amount))
    throw new Error('amount_mismatch');
  ensureStyles();
  await document.fonts?.load?.("50px 'SW3 Lilita'").catch(() => null);
  const pal = PALETTES[paletteOf(spin.viewer_id ?? spin.name)];
  const levels = levelsOf(layout);
  const name = String(spin.name || 'Viewer');
  const months = Math.max(1, Number(spin.months) || 1);
  const root = document.createElement('div');
  // `inline`: Studio's preview places it in its own box (OBS: bottom right of the canvas, like the legacy wheel).
  root.className = place.inline ? 'sw3 inline' : 'sw3';
  root.style.cssText = `--tc:${TIER_COLOR[tier]};--base:${pal.base};--band1:${pal.band[0]};--band2:${pal.band[1]};--s1:${pal.seg[1]};--s2:${pal.seg[2]}`;
  root.innerHTML = `<div class="wheel"><div class="rot">${wheelSVG(layout, levels, pal)}</div>${rimSVG(pal)}<div class="glow"></div><div class="ptr"></div>
      <div class="hub"><b></b></div></div>
    <div class="band">
      <div class="state st-id"><div class="pp"><div class="ava"></div><span class="mo"></span></div><div class="txt"><div class="name"></div></div></div>
      <div class="state st-res"><strong class="val"></strong><span class="mult"></span><span class="unit">jetons</span></div>
      <div class="fx"></div></div>`;
  // Only Twitch's own words and pictures, as text / checked URL: nothing a viewer typed becomes markup.
  const hub = root.querySelector('.hub b');
  if (spin.prime) {
    hub.textContent = 'PRIME';
    hub.classList.add('prime');
  } else hub.textContent = `T${tier}`;
  root.querySelector('.mo').textContent = `${months} mois`;
  root.querySelector('.name').textContent = name;
  root.querySelector('.mult').textContent = `×${coef}`;
  const ava = root.querySelector('.ava');
  if (typeof spin.avatar === 'string' && AVATAR.test(spin.avatar))
    ava.style.backgroundImage = `url("${spin.avatar}")`;
  else ava.textContent = name[0]?.toUpperCase() ?? '?';
  if (spin.title && typeof spin.title === 'object' && spin.title.label) {
    const line = document.createElement('div');
    line.className = 'ttl';
    line.append(titleEl(spin.title));
    root.querySelector('.txt').append(line);
  }
  stage.append(root);
  const val = root.querySelector('.val');
  const jackpot = levels[segment] === 3;
  try {
    void root.offsetWidth;
    root.classList.add('in');
    const n = root.querySelector('.name');
    for (let fs = 24; n.scrollWidth > n.clientWidth && fs > 15;)
      n.style.fontSize = `${--fs}px`;
    await wait(T.intro);
    root.classList.add('spinning');
    await spinTo(root, segment);
    root.classList.remove('spinning');
    root.classList.add('landed');
    wheelSegmentStopSound();
    root
      .querySelectorAll(`[data-pos="${segment}"]`)
      .forEach((e) => e.classList.add('on'));
    await wait(T.land);
    // One band: the viewer leaves, then the gain takes its place (never both).
    val.textContent = coef === 1 ? '0' : money(lot);
    root.classList.add('reveal');
    wheelTickSound(0);
    await wait(T.reveal);
    if (coef === 1) {
      root.classList.add('counting');
      await count(val, 0, lot, T.count[1], sounds);
    } else {
      root.classList.add('has-mult');
      wheelTickSound(0);
      await wait(T.mult);
      root.classList.add('counting');
      await count(val, lot, lot * coef, T.count[coef] ?? 1200, sounds);
    }
    root.classList.remove('counting');
    await wait(T.breathe);
    val.textContent = '+' + money(lot * coef);
    root.classList.add('final');
    if (jackpot) root.classList.add('jackpot');
    if (levels[segment] >= 2)
      burst(
        root,
        jackpot
          ? ['#f4c55a', '#fde49a', '#fff3df', pal.seg[2]]
          : [pal.seg[2], pal.seg[1], '#fff3df'],
        jackpot,
      );
    wheelWinSound(jackpot);
    await wait(jackpot ? T.holdJackpot : T.hold);
    root.classList.add('out');
    await wait(T.out);
  } finally {
    root.remove();
  }
}

// Test hook (Lab): the palette chosen for an id, without playing.
if (typeof window !== 'undefined') window.__sw3PaletteOf = paletteOf;
