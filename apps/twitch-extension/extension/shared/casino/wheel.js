// Ported unchanged from the validated casino prototype (prototypes/casino-v8 · wheel.js); docs/CASINO.md.
// Display only: every result comes from the Core.
// La roue européenne (dessin de la V5) et sa bille. La case est DÉJÀ tirée (shared/table.js) ; shared/ball.js calcule
// une trajectoire physique qui finit dedans, et on la rejoue ici image par image : la bille tourne à contre-sens sur la
// piste, ralentit, quitte la piste, ricoche sur les losanges, rebondit sur les barrettes et se pose — n'importe où sur
// la roue (plus de repère en haut : c'est la bille qui montre le numéro). Normal ≈ 5,5 à 6,5 s ; Passer : 0,45 s.
// Rapide : aucune rotation, la roue apparaît déjà arrêtée sur le résultat.
import { ArcadeTable } from './table.js';
import { ArcadeBall } from './ball.js';

const T = ArcadeTable;
const B = ArcadeBall;
const N = T.ORDER.length;
const STEP = 360 / N;
const COLORS = { red: '#d9334c', black: '#1b1528', green: '#17b374' };
const DEG = 180 / Math.PI;
const rad = (deg) => (deg * Math.PI) / 180;
const pt = (r, deg) => [r * Math.sin(rad(deg)), -r * Math.cos(rad(deg))];
const f = (n) => n.toFixed(2);
const G = B.GEO;

function wedge(i, r0, r1) {
  const a0 = (i - 0.5) * STEP;
  const a1 = (i + 0.5) * STEP;
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 0 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 0 0 ${f(x3)} ${f(y3)}Z`;
}

function build(svg) {
  let sectors = '';
  let seps = '';
  let pegs = '';
  let labels = '';
  for (let i = 0; i < N; i++) {
    const n = T.ORDER[i];
    sectors += `<path class="sec" data-i="${i}" data-n="${n}" d="${wedge(i, 56, 96)}" fill="${COLORS[T.color(n)]}"/>`;
    const [a, b] = pt(98, (i - 0.5) * STEP);
    const [c, d] = pt(56, (i - 0.5) * STEP);
    seps += `<line x1="${f(a)}" y1="${f(b)}" x2="${f(c)}" y2="${f(d)}"/>`;
    const [px, py] = pt(G.peg, (i - 0.5) * STEP);
    pegs += `<circle cx="${f(px)}" cy="${f(py)}" r="2"/>`;
    const [lx, ly] = pt(86, i * STEP);
    labels += `<text x="${f(lx)}" y="${f(ly)}" transform="rotate(${f(i * STEP)} ${f(lx)} ${f(ly)})">${n}</text>`;
  }
  let lights = '';
  for (let i = 0; i < 20; i++) {
    const [bx, by] = pt(118.4, i * 18 + 9);
    lights += `<circle class="bulb" style="--d:${(i % 4) * 0.15}s" cx="${f(bx)}" cy="${f(by)}" r="1.7"/>`;
  }
  // Les 8 losanges fixes : ce sont eux que la bille heurte en quittant la piste.
  const diamonds = B.DIAMONDS.map((a) => `<path transform="rotate(${f(a * DEG)})" d="M0 ${f(-G.diamond - 2.7)}L1.8 ${f(-G.diamond)}L0 ${f(-G.diamond + 2.7)}L-1.8 ${f(-G.diamond)}Z"/>`).join('');
  let spokes = '';
  for (let i = 0; i < 8; i++) {
    const [x, y] = pt(50, i * 45);
    spokes += `<line x1="0" y1="0" x2="${f(x)}" y2="${f(y)}"/>`;
  }
  svg.setAttribute('viewBox', '-122 -122 244 244');
  svg.innerHTML = `<defs>
    <radialGradient id="rwRim" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#ffe59a"/><stop offset=".6" stop-color="#d99a14"/><stop offset="1" stop-color="#7a4a00"/></radialGradient>
    <radialGradient id="rwHub" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff2b8"/><stop offset=".5" stop-color="#f0a800"/><stop offset="1" stop-color="#6e3d00"/></radialGradient>
    <radialGradient id="rwShine" cx="35%" cy="25%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".5" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></radialGradient>
    <radialGradient id="rwBowl" r="50%"><stop offset=".84" stop-color="#1a0f2e"/><stop offset=".93" stop-color="#2a1a44"/><stop offset="1" stop-color="#120a22"/></radialGradient>
    <radialGradient id="rwBall" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e9e4f2"/><stop offset="1" stop-color="#8d86a0"/></radialGradient>
    <linearGradient id="rwDia" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#e2ad3a"/><stop offset="1" stop-color="#8a5a10"/></linearGradient>
  </defs>
  <circle r="120.6" fill="url(#rwBowl)" stroke="#3a2466" stroke-width="1.6"/>
  <circle class="trackline" r="${G.track + G.ball + 0.4}"/>
  <g class="bulbs">${lights}</g>
  <g class="diamonds">${diamonds}</g>
  <g class="wheel-rot">
    <circle r="104" fill="url(#rwRim)"/>
    <circle r="97.5" fill="#0e0a18"/>
    <g class="secs">${sectors}</g>
    <g class="seps">${seps}</g>
    <g class="labels">${labels}</g>
    <g class="pegs">${pegs}</g>
    <circle r="56" fill="#140d24" stroke="#d99a14" stroke-width="2"/>
    <g class="spokes">${spokes}</g>
    <circle r="21" fill="url(#rwHub)" stroke="#7a4a00" stroke-width="1.5"/>
    <text class="hub-t" y="4">R</text>
  </g>
  <circle r="97" fill="url(#rwShine)" pointer-events="none"/>
  <g class="ballg" opacity="0"><path class="trail"/><ellipse class="bsh" rx="${G.ball}" ry="${G.ball * 0.8}"/><circle class="ball" r="${G.ball}" fill="url(#rwBall)" stroke="rgba(0,0,0,.35)" stroke-width=".5"/></g>`;
}

function create(rootEl, { audio } = {}) {
  const svg = rootEl.querySelector('svg');
  build(svg);
  const rot = svg.querySelector('.wheel-rot');
  const ballG = svg.querySelector('.ballg');
  const ball = svg.querySelector('.ball');
  const shadow = svg.querySelector('.bsh');
  const trail = svg.querySelector('.trail');
  let running = null;

  const setRotor = (a) => rot.setAttribute('transform', `rotate(${(a * DEG).toFixed(3)})`);
  /** La bille : angle absolu (rad), rayon, hauteur (elle grossit un peu et son ombre s'écarte quand elle saute). */
  function setBall(phi, rho, z = 0, tail = null) {
    const x = rho * Math.sin(phi);
    const y = -rho * Math.cos(phi);
    ball.setAttribute('cx', x.toFixed(2));
    ball.setAttribute('cy', y.toFixed(2));
    ball.setAttribute('r', (G.ball * (1 + z * 0.06)).toFixed(2));
    shadow.setAttribute('cx', (x + 0.6 + z * 0.55).toFixed(2));
    shadow.setAttribute('cy', (y + 1 + z * 0.85).toFixed(2));
    shadow.setAttribute('opacity', Math.max(0.12, 0.5 - z * 0.05).toFixed(2));
    // Sur la piste, à pleine vitesse : une courte traînée (flou de mouvement), jamais une ligne dessinée.
    if (tail && Math.abs(tail.phi - phi) > 0.12) {
      const x0 = rho * Math.sin(tail.phi);
      const y0 = -rho * Math.cos(tail.phi);
      trail.setAttribute('d', `M${x0.toFixed(2)} ${y0.toFixed(2)}A${rho.toFixed(2)} ${rho.toFixed(2)} 0 0 ${phi > tail.phi ? 1 : 0} ${x.toFixed(2)} ${y.toFixed(2)}`);
      trail.setAttribute('opacity', Math.min(0.3, (Math.abs(tail.phi - phi) - 0.12) * 0.5).toFixed(2));
    } else trail.setAttribute('opacity', '0');
  }

  function clear() {
    svg.querySelectorAll('.sec.hit').forEach((s) => s.classList.remove('hit'));
    rootEl.classList.remove('won', 'lost');
  }
  function finish(result) {
    rootEl.dataset.landAt = String(Date.now()); // the ball settled on screen (read by the Lab's timing checks)
    running = null;
    rootEl.classList.remove('spinning');
    trail.setAttribute('opacity', '0');
    const hit = svg.querySelector(`.sec[data-i="${result.pocket}"]`);
    if (hit) hit.classList.add('hit');
    rootEl.classList.add(result.net > 0 ? 'won' : 'lost');
    if (audio) audio.wheelStop(result.net > 0);
  }

  /** Le résultat tout de suite : roue arrêtée à un angle quelconque, bille au fond de la case tirée. */
  function showNow(result) {
    clear();
    const a = Math.random() * 2 * Math.PI;
    setRotor(a);
    setBall(a + result.pocket * B.STEP, G.rest);
    ballG.setAttribute('opacity', '1');
    finish(result);
    return Promise.resolve();
  }

  function spin(result, opts = {}) {
    if (opts.fast) return showNow(result);
    clear();
    // The Core's visual seed: the same flight for the player, the spectators and the Replay (docs/CASINO.md).
    const sim = B.plan(result.pocket, result.seed);
    if (!sim) return showNow(result); // jamais vu : 40 essais de suite hors des bornes de durée
    rootEl.classList.add('spinning');
    if (audio) audio.wheelStart();
    const end = B.at(sim, sim.duration);
    // La bille d'avant disparaît (le croupier la reprend) ; le cylindre prend sa position de départ.
    ballG.setAttribute('opacity', '0');
    setRotor(B.at(sim, 0).theta);
    return new Promise((resolve) => {
      // `elapsed` (s): a spectator joins the player's flight where it is (the same ball, at the same time).
      const elapsed = Math.max(0, (opts.elapsed ?? 0) / 1000);
      const t0 = performance.now() - elapsed * 1000;
      let lastT = elapsed;
      let ev = 0;
      let skipFrom = null;
      running = {
        skip() {
          if (!skipFrom) skipFrom = { t: (performance.now() - t0) / 1000, s: B.at(sim, lastT) };
        },
      };
      let shownAt = 0;
      const frame = (ts) => {
        if (!shownAt) rootEl.dataset.startAt = String((shownAt = Date.now())); // the first frame on screen (Lab timing checks)
        const t = Math.max(0, (ts - t0) / 1000);
        let s;
        let done;
        if (skipFrom) {
          // Passer : tout rejoint l'état final en 0,45 s (le cylindre continue dans son sens, la bille va à sa case).
          const u = Math.min(1, (t - skipFrom.t) / 0.45);
          const e = 1 - (1 - u) ** 3;
          const a = skipFrom.s;
          const psiA = a.phi - a.theta;
          let psiB = end.phi - end.theta;
          psiB += Math.round((psiA - psiB) / (2 * Math.PI)) * 2 * Math.PI;
          const theta = a.theta + (end.theta - a.theta) * e;
          s = { theta, phi: theta + psiA + (psiB - psiA) * e, rho: a.rho + (end.rho - a.rho) * e, z: a.z * (1 - e) };
          done = u >= 1;
        } else {
          s = B.at(sim, t);
          done = t >= sim.duration;
          // Les chocs entendus (losanges, barrettes, rebonds), au moment où ils se produisent.
          while (ev < sim.events.length && sim.events[ev].t <= t) {
            const e = sim.events[ev++];
            if (audio && e.t > lastT - 0.05) audio.ballHit(e.kind, e.v);
          }
        }
        if (done) s = end;
        setRotor(s.theta);
        const tail = !skipFrom && !done && s.rho > G.peg ? B.at(sim, Math.max(0, t - 0.05)) : null;
        setBall(s.phi, s.rho, s.z, tail);
        ballG.setAttribute('opacity', String(Math.min(1, t / 0.15)));
        lastT = t;
        if (done) {
          finish(result);
          resolve();
        } else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  return { svg, spin, clear, skip: () => running && running.skip(), isRunning: () => !!running };
}

export const ArcadeWheel = { create, COLORS };
