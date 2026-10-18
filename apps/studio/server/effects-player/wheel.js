/* global document, window, Audio, performance, requestAnimationFrame, setTimeout */
// Roue du Sub (docs/SUB_WHEEL.md) — the legacy wheel of Alerte_system.html (« ROUE — SYSTEME ISOLE »), copied as it is:
// layout colours, SVG, spin, WebAudio sounds, counter, « +N jetons », slide in / out, timings. What changes:
// - the result comes from Core (segment drawn and gain recorded BEFORE the animation): the page never draws;
// - the layout comes with it (the same legacy buildWheelLayout, in @raptoru/schemas), the shown amount is checked
//   against the recorded one (a mismatch fails: the screen never shows another gain);
// - the two mp3 are Studio's copies; no SAMMI (no setVariable, no wait on SAMMI): the effects player reports the end.

const WHEEL_TIER_COEFS = { 1: 1, 2: 2, 3: 3 };
const WHEEL_RARE_THRESHOLD = 3000;
const WHEEL_JACKPOT = 10000;

// Couleurs par valeur de base
function wheelColor(val) {
  if (val >= 25000) return '#d4af37';
  if (val >= 10000) return '#c0932a';
  if (val >= 5000) return '#8a2be2';
  if (val >= 3000) return '#8a3a8a';
  if (val >= 2000) return '#b54a4a';
  if (val >= 1500) return '#c95a3f';
  if (val >= 1000) return '#c97a3f';
  if (val >= 750) return '#b8a23f';
  if (val >= 500) return '#7ba23f';
  if (val >= 300) return '#4a8c4a';
  if (val >= 200) return '#2d8a87';
  return '#3a6ea5';
}

// Couleur de la bande multiplicateur
function multColor(mult) {
  if (mult >= 5) return '#ff4444';
  if (mult >= 3) return '#ff9900';
  return '#00cfff'; // ×2
}

let WHEEL_LAYOUT = [];
let wheelAudioCtx = null;
let wheelTotalRotation = Math.random() * 360;

function wheelAudio() {
  if (!wheelAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    wheelAudioCtx = new Ctx();
  }
  if (wheelAudioCtx.state === 'suspended') wheelAudioCtx.resume();
  return wheelAudioCtx;
}

function wheelTickSound(step) {
  const ctx = wheelAudio();
  const baseFreq = 600;
  const freq = baseFreq * Math.pow(2, (step || 0) / 12);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.12, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.09);

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;
  gain2.gain.setValueAtTime(0.05, ctx.currentTime);
  gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
  osc2.connect(gain2).connect(ctx.destination);
  osc2.start();
  osc2.stop(ctx.currentTime + 0.07);
}

function wheelSegmentStopSound() {
  const ctx = wheelAudio();
  const t = ctx.currentTime;
  // Chorus 1 : grave (340 Hz, désaccord 4 Hz)
  [340, 344].forEach((freq) => {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.19);
  });
  // Chorus 2 : aigu (500 Hz, désaccord 3 Hz) — décalé de 70ms
  [500, 503].forEach((freq) => {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t + 0.07);
    g.gain.linearRampToValueAtTime(0.07, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.21);
    o.connect(g).connect(ctx.destination);
    o.start(t + 0.07);
    o.stop(t + 0.22);
  });
}

function wheelSpinTickSound() {
  const ctx = wheelAudio();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 1800;
  gain.gain.setValueAtTime(0.06, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.04);
}

function wheelWinSound(isJackpot) {
  const ctx = wheelAudio();
  if (isJackpot) {
    const melody = [523, 659, 784, 1047, 1319, 1568];
    const peak = 0.18;
    melody.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const start = ctx.currentTime + i * 0.08;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.02);
      gain.gain.setValueAtTime(peak, start + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.75);
    });
    [523, 784, 1047].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const tStart = ctx.currentTime + melody.length * 0.08 + 0.05;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, tStart);
      gain.gain.linearRampToValueAtTime(0.1 - i * 0.02, tStart + 0.04);
      gain.gain.setValueAtTime(0.1 - i * 0.02, tStart + 0.4);
      gain.gain.exponentialRampToValueAtTime(0.001, tStart + 1.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(tStart);
      osc.stop(tStart + 1.2);
    });
  } else {
    const freqs = [523, 659, 784, 1047];
    const peak = 0.14;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const start = ctx.currentTime + i * 0.07;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.6);
    });
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1047;
    const tStart = ctx.currentTime + freqs.length * 0.07 + 0.02;
    gain.gain.setValueAtTime(0, tStart);
    gain.gain.linearRampToValueAtTime(0.1, tStart + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, tStart + 0.75);
    osc.connect(gain).connect(ctx.destination);
    osc.start(tStart);
    osc.stop(tStart + 0.8);
  }
}

// Legacy signature kept as it is (the page never reads coef here).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildWheelSVG(coef) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('wheelSvg');
  svg.innerHTML = '';
  const cx = 196,
    cy = 196,
    r = 172,
    rOuter = 179;

  // Fond noir opaque derrière la roue (le container est transparent)
  const bgCircle = document.createElementNS(svgNS, 'circle');
  bgCircle.setAttribute('cx', cx);
  bgCircle.setAttribute('cy', cy);
  bgCircle.setAttribute('r', rOuter + 6);
  bgCircle.setAttribute('fill', '#0d0d10');
  svg.appendChild(bgCircle);
  const segCount = WHEEL_LAYOUT.length;
  const segAngle = 360 / segCount;

  // Anneau extérieur de base
  const outerRing = document.createElementNS(svgNS, 'circle');
  outerRing.setAttribute('cx', cx);
  outerRing.setAttribute('cy', cy);
  outerRing.setAttribute('r', rOuter + 4);
  outerRing.setAttribute('fill', '#1a1a1a');
  outerRing.setAttribute('stroke', '#d4af37');
  outerRing.setAttribute('stroke-width', '3');
  svg.appendChild(outerRing);

  WHEEL_LAYOUT.forEach((seg, i) => {
    const { val, mult } = seg;
    const startDeg = i * segAngle - 90;
    const endDeg = (i + 1) * segAngle - 90;
    const startRad = (startDeg * Math.PI) / 180;
    const endRad = (endDeg * Math.PI) / 180;

    // ── Segment principal
    const x1 = cx + r * Math.cos(startRad),
      y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad),
      y2 = cy + r * Math.sin(endRad);
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute(
      'd',
      `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`,
    );
    path.setAttribute('fill', wheelColor(val));
    path.setAttribute('stroke', '#1a1a1a');
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);

    // ── Bande extérieure colorée si multiplicateur > 1
    if (mult > 1) {
      const ox1 = cx + rOuter * Math.cos(startRad),
        oy1 = cy + rOuter * Math.sin(startRad);
      const ox2 = cx + rOuter * Math.cos(endRad),
        oy2 = cy + rOuter * Math.sin(endRad);
      const ix1 = cx + (r + 2) * Math.cos(startRad),
        iy1 = cy + (r + 2) * Math.sin(startRad);
      const ix2 = cx + (r + 2) * Math.cos(endRad),
        iy2 = cy + (r + 2) * Math.sin(endRad);
      const band = document.createElementNS(svgNS, 'path');
      band.setAttribute(
        'd',
        `M ${ix1} ${iy1} A ${r + 2} ${r + 2} 0 0 1 ${ix2} ${iy2} L ${ox2} ${oy2} A ${rOuter} ${rOuter} 0 0 0 ${ox1} ${oy1} Z`,
      );
      band.setAttribute('fill', multColor(mult));
      band.setAttribute('opacity', '0.88');
      svg.appendChild(band);

      // Label ×N sur la bande extérieure
      const midDegB = (i + 0.5) * segAngle - 90;
      const midRadB = (midDegB * Math.PI) / 180;
      const bR = (r + rOuter) / 2;
      const btx = cx + bR * Math.cos(midRadB);
      const bty = cy + bR * Math.sin(midRadB);
      const btext = document.createElementNS(svgNS, 'text');
      btext.setAttribute('x', btx);
      btext.setAttribute('y', bty);
      btext.setAttribute('fill', '#fff');
      btext.setAttribute('font-size', '11');
      btext.setAttribute('font-weight', '900');
      btext.setAttribute(
        'font-family',
        "'Helvetica Neue', Helvetica, Arial, sans-serif",
      );
      btext.setAttribute('text-anchor', 'middle');
      btext.setAttribute('dominant-baseline', 'middle');
      btext.setAttribute(
        'transform',
        `rotate(${(i + 0.5) * segAngle}, ${btx}, ${bty})`,
      );
      btext.setAttribute('paint-order', 'stroke');
      btext.setAttribute('stroke', '#000');
      btext.setAttribute('stroke-width', '2');
      btext.textContent = `×${mult}`;
      svg.appendChild(btext);
    }

    // ── Texte montant + mult sur le segment
    const midDeg = (i + 0.5) * segAngle - 90;
    const midRad = (midDeg * Math.PI) / 180;
    const textR = r * 0.68;
    const tx = cx + textR * Math.cos(midRad);
    const ty = cy + textR * Math.sin(midRad);
    const rot = (i + 0.5) * segAngle;

    // Montant
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', tx);
    text.setAttribute('y', mult > 1 ? ty - 6 : ty);
    text.setAttribute('fill', '#fff');
    const fs =
      val >= 10000 ? '16' : val >= 5000 ? '18' : val >= 1000 ? '19' : '20';
    text.setAttribute('font-size', fs);
    text.setAttribute('font-weight', '900');
    text.setAttribute(
      'font-family',
      "'Helvetica Neue', Helvetica, Arial, sans-serif",
    );
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('transform', `rotate(${rot}, ${tx}, ${ty})`);
    text.setAttribute('paint-order', 'stroke');
    text.setAttribute('stroke', '#000');
    text.setAttribute('stroke-width', '3');
    text.setAttribute('stroke-linejoin', 'round');
    text.textContent = val >= 1000 ? val / 1000 + 'k' : val;
    svg.appendChild(text);

    // Sous-label ×N sur le segment si mult > 1
    if (mult > 1) {
      const mtext = document.createElementNS(svgNS, 'text');
      mtext.setAttribute('x', tx);
      mtext.setAttribute('y', ty + 10);
      mtext.setAttribute('fill', multColor(mult));
      mtext.setAttribute('font-size', '11');
      mtext.setAttribute('font-weight', '900');
      mtext.setAttribute(
        'font-family',
        "'Helvetica Neue', Helvetica, Arial, sans-serif",
      );
      mtext.setAttribute('text-anchor', 'middle');
      mtext.setAttribute('dominant-baseline', 'middle');
      mtext.setAttribute('transform', `rotate(${rot}, ${tx}, ${ty})`);
      mtext.setAttribute('paint-order', 'stroke');
      mtext.setAttribute('stroke', '#000');
      mtext.setAttribute('stroke-width', '2');
      mtext.textContent = `×${mult}`;
      svg.appendChild(mtext);
    }
  });
}

function spinWheel(targetSegment) {
  return new Promise((resolve) => {
    const wheel = document.getElementById('wheelSvg');
    const segAngle = 360 / WHEEL_LAYOUT.length;
    const duration = 2000 + Math.random() * 3000;
    const extraRotations = Math.max(2, Math.round(6 - (duration - 2000) / 600));
    const bezier =
      duration < 3200
        ? 'cubic-bezier(0.05, 0.85, 0.15, 1.0)'
        : 'cubic-bezier(0.2, 0.55, 0.3, 0.99)';

    const currentMod = ((wheelTotalRotation % 360) + 360) % 360;
    const targetAngle =
      (360 - (targetSegment * segAngle + segAngle / 2) + 360) % 360;
    let delta = (targetAngle - currentMod + 360) % 360;
    if (delta < segAngle) delta += 360;
    const totalDelta = delta + 360 * extraRotations;
    wheelTotalRotation += totalDelta;

    wheel.style.transition = `transform ${duration}ms ${bezier}`;
    wheel.style.transform = `rotate(${wheelTotalRotation}deg)`;

    const startTime = performance.now();
    const startRot = wheelTotalRotation - totalDelta;
    let lastBoundary = -1;

    function tickLoop() {
      const elapsed = performance.now() - startTime;
      if (elapsed >= duration) {
        resolve();
        return;
      }
      const ease = 1 - Math.pow(1 - elapsed / duration, 3);
      const boundary = Math.floor((startRot + totalDelta * ease) / segAngle);
      if (boundary !== lastBoundary) {
        wheelSpinTickSound();
        lastBoundary = boundary;
      }
      requestAnimationFrame(tickLoop);
    }
    requestAnimationFrame(tickLoop);
  });
}

function pseudoToColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++)
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return {
    solid: `hsl(${hue},78%,58%)`,
    dim: `hsla(${hue},78%,58%,0.4)`,
    glow: `hsla(${hue},78%,58%,0.22)`,
  };
}

function wheelWait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** The wheel DOM of the legacy page (once, inside the player's stage). */
function ensureWheel(stage) {
  if (document.getElementById('wheelContainer')) return;
  const holder = document.createElement('div');
  holder.innerHTML = WHEEL_HTML;
  stage.append(holder.firstElementChild);
}

/**
 * Plays one recorded spin. `spin`: { name, type, tier, months, layout, segment, amount }; `sounds`: { incr, fin }
 * (media URLs). Resolves once the wheel slid out; throws when it cannot play (nothing is redrawn).
 */
export async function playWheel(stage, spin, sounds) {
  ensureWheel(stage);
  const { type = 'resub', tier = 1, months = 0 } = spin;
  const pseudo = String(spin.name || 'Viewer');
  WHEEL_LAYOUT = spin.layout;
  const tierNum = parseInt(tier, 10) || 1;
  const tierCoef = WHEEL_TIER_COEFS[tierNum] || 1;
  const segIdx = Number(spin.segment);
  const seg = WHEEL_LAYOUT[segIdx];
  if (!seg) throw new Error('segment_out_of_range');
  const baseAmt = seg.val * seg.mult; // valeur du segment avec son propre mult
  const amount = baseAmt * tierCoef; // × coef Tier par dessus
  if (amount !== Number(spin.amount)) throw new Error('amount_mismatch');
  const isRare = baseAmt >= WHEEL_RARE_THRESHOLD;
  const isJackpot = baseAmt >= WHEEL_JACKPOT;
  const coef = tierCoef; // coef affiché dans le hub (Tier uniquement)

  try {
    const container = document.getElementById('wheelContainer');
    const wheel = document.getElementById('wheelSvg');
    const wrapper = document.getElementById('wheelSpinWrapper');
    const result = document.getElementById('wheelResult');

    buildWheelSVG(coef);
    wheel.style.transition = 'none';

    const hubMultEl = document.getElementById('wheelHubMultHtml');
    if (coef > 1) {
      hubMultEl.textContent = '×' + coef;
      hubMultEl.style.display = '';
      hubMultEl.classList.remove('hub-mult-pulse');
      void hubMultEl.offsetWidth;
      hubMultEl.classList.add('hub-mult-pulse');
    } else {
      hubMultEl.style.display = 'none';
      hubMultEl.classList.remove('hub-mult-pulse');
    }

    const clr = pseudoToColor(pseudo);
    container.style.setProperty('--wheel-color', clr.solid);
    container.style.setProperty('--wheel-color-dim', clr.dim);
    container.style.setProperty('--wheel-glow', clr.glow);

    wrapper.classList.remove('glow-normal', 'glow-jackpot');
    result.className = 'wheel-result';
    result.textContent = '';

    const m = parseInt(months, 10) || 0;
    const monthLabel = m > 0 ? `${m}` : type === 'subgift' ? 'Gift' : '–';

    // Bandeau : pseudo au centre, mois gauche, tier droite
    document.getElementById('wheelPseudo').textContent = pseudo;
    document.getElementById('wheelMonth').textContent = monthLabel;
    document.getElementById('wheelTier').textContent = `T${tierNum}`;

    // Adapter la taille du pseudo si trop long
    const pseudoEl = document.getElementById('wheelPseudo');
    const pLen = pseudo.length;
    pseudoEl.style.fontSize = pLen > 18 ? '13px' : pLen > 12 ? '15px' : '18px';
    // wheelMult/wheelMultSep supprimés du bandeau v2

    container.style.transition = 'none';
    container.style.opacity = '1';
    container.style.transform = 'translateY(110%)';
    void container.offsetWidth;
    container.style.transition =
      'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
    container.style.transform = 'translateY(0)';
    await wheelWait(650);

    await spinWheel(segIdx);

    wheelSegmentStopSound();
    if (isJackpot) wrapper.classList.add('glow-jackpot');
    else if (isRare) wrapper.classList.add('glow-normal');

    if (isJackpot) result.classList.add('jackpot');
    result.classList.remove('depop', 'tick', 'show', 'hide');
    void result.offsetWidth;
    result.classList.add('tick');
    result.textContent = `+${baseAmt}`;
    wheelTickSound(0);
    await wheelWait(500);

    // === COMPTEUR LINÉAIRE PAR PALIERS (1s chacun) ===
    if (coef > 1) {
      const palierDuration = 1000; // 1s par palier
      const counterSteps = 40;
      const stepDelay = palierDuration / counterSteps;

      // Durée totale du compteur
      const totalDuration = palierDuration * (coef - 1);

      // Son d'incrément : offset aléatoire (on suppose ~4s de son, ajuste si besoin)
      const incrAudio = new Audio(sounds.incr);
      incrAudio.loop = false;
      incrAudio.volume = 0.425;
      // Offset aléatoire pour varier la portion jouée
      const maxOffset = Math.max(0, 4 - totalDuration / 1000 - 0.2);
      incrAudio.currentTime = Math.random() * maxOffset;
      incrAudio.play().catch(() => {});

      result.classList.remove('tick', 'depop');
      void result.offsetWidth;
      result.classList.add('tick');

      // Compteur de baseAmt → amount en palierDuration * (coef-1) ms
      for (let s = 1; s <= counterSteps * (coef - 1); s++) {
        const progress = s / (counterSteps * (coef - 1));
        const val = Math.round(baseAmt + (amount - baseAmt) * progress);
        result.textContent = `+${val}`;
        await wheelWait(stepDelay);
      }
      result.textContent = `+${amount}`;

      // Son de fin d'abord, puis fade de l'incrément par dessus
      const finAudio = new Audio(sounds.fin);
      finAudio.volume = 0.45;
      finAudio.play().catch(() => {});

      // Petit délai puis fade out de l'incrément
      await wheelWait(80);
      const fadeSteps = 12;
      const fadeDelay = 200 / fadeSteps;
      for (let f = fadeSteps - 1; f >= 0; f--) {
        incrAudio.volume = 0.425 * (f / fadeSteps);
        await wheelWait(fadeDelay);
      }
      incrAudio.pause();
      incrAudio.currentTime = 0;

      // Laisser le son de fin respirer avant le reveal
      await wheelWait(440);
    }

    // Affichage final
    result.classList.remove('tick', 'depop');
    void result.offsetWidth;
    result.classList.add('depop');
    await wheelWait(60);
    result.classList.remove('depop');
    void result.offsetWidth;
    result.textContent = `+${amount} jetons`;
    result.classList.add('tick');

    wheelWinSound(isJackpot);
    await wheelWait(1200);

    result.classList.remove('show');
    result.classList.add('hide');
    wrapper.classList.remove('glow-normal', 'glow-jackpot');
    document.getElementById('wheelHubMultHtml').style.display = 'none';
    container.style.transition =
      'transform 0.5s cubic-bezier(0.55, 0, 1, 0.45)';
    container.style.transform = 'translateY(110%)';

    await wheelWait(500);
    result.classList.remove('hide');
  } catch (e) {
    const container = document.getElementById('wheelContainer');
    if (container) container.style.transform = 'translateY(110%)';
    throw e;
  }
}

// The legacy wheel markup (Alerte_system.html), copied as it is.
const WHEEL_HTML =
  '<div class="wheel-container" id="wheelContainer">\n        <div class="wheel-banner">\n            <div class="wheel-banner-top">\n                <!-- Gauche : mois -->\n                <div class="wb-left">\n                    <span class="wb-month-label">mois</span>\n                    <span class="wb-month" id="wheelMonth">–</span>\n                </div>\n\n                <!-- Centre : pseudo seul -->\n                <div class="wb-center">\n                    <span class="wb-pseudo-center" id="wheelPseudo"></span>\n                </div>\n\n                <!-- Droite : tier -->\n                <div class="wb-right">\n                    <span class="wb-tier-label">tier</span>\n                    <span class="wb-tier" id="wheelTier">T1</span>\n                </div>\n            </div>\n        </div>\n        <div class="wheel-stage">\n            <div class="wheel-pointer"></div>\n            <div class="wheel-spin-wrapper" id="wheelSpinWrapper">\n                <svg class="wheel-svg" id="wheelSvg" viewBox="0 0 392 392"></svg>\n            </div>\n            \n            <div class="wheel-hub-html" id="wheelHubHtml">\n                <svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">\n                    <circle cx="70" cy="70" r="66" fill="rgba(0,0,0,0.4)" stroke="var(--wheel-color, #d4af37)" stroke-width="2"/>\n                    <circle cx="70" cy="70" r="58" fill="none" stroke="#d4af37" stroke-width="3"/>\n                    <circle cx="70" cy="70" r="55" fill="#13110b" stroke="#000000" stroke-width="2"/>\n                    <circle cx="70" cy="70" r="48" fill="none" stroke="rgba(255,215,0,0.25)" stroke-width="1"/>\n                    \n                    <text id="wheelHubMultHtml" x="70" y="72" fill="#ffd86b" font-size="44" font-weight="900"\n                        font-family="\'Helvetica Neue\',Helvetica,Arial,sans-serif"\n                        text-anchor="middle" dominant-baseline="central"\n                        paint-order="stroke" stroke="#000000" stroke-width="6" stroke-linejoin="round"\n                        style="display:none"></text>\n                </svg>\n            </div>\n            <div class="wheel-result" id="wheelResult"></div>\n        </div>\n    </div>';
