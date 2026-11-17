// Ported unchanged from the validated casino prototype (prototypes/casino-v8 · ball.js); docs/CASINO.md.
// Display only: every result comes from the Core.
// La bille de la roulette : une VRAIE petite simulation physique (inertie, frottements, chute de la piste, déflecteurs,
// barrettes des cases, rebonds en hauteur), calculée d'avance puis rejouée image par image.
//
// Le résultat ne vient JAMAIS de la simulation : il est tiré avant (shared/table.js, mêmes règles, mêmes probabilités).
// Comment la bille finit-elle quand même dans la bonne case ? Le cylindre (la partie qui tourne) est identique d'une case
// à l'autre : mêmes barrettes, mêmes picots, tous les 360/37°. Décaler le cylindre d'un nombre ENTIER de cases ne change
// donc rien à la physique, seulement les numéros peints. On simule une fois, on regarde dans quelle case physique la bille
// s'arrête, puis on tourne la peinture du cylindre du bon nombre de cases pour que cette case porte le numéro tiré.
// Le décalage est appliqué à l'ouverture de la roue (elle apparaît à ce moment-là) : aucun saut visible.
//
// Repère : angles en radians, sens horaire depuis le haut (comme le SVG de shared/wheel.js) ; longueurs en unités du
// SVG (le cylindre fait 104 de rayon). La bille tourne en sens inverse du cylindre.


const N = 37;
const STEP = (2 * Math.PI) / N;
const TAU = 2 * Math.PI;

/** La géométrie (doit correspondre au dessin de shared/wheel.js). */
const GEO = {
  ball: 3.9, // rayon de la bille
  track: 112.3, // piste de lancement (bord extérieur fixe)
  diamond: 106.3, // les 8 déflecteurs en losange, fixes
  diamondHit: 5.9, // distance de contact bille ↔ losange
  rotor: 103, // au-dessous : la bille est sur le cylindre
  peg: 100, // picots au bout des barrettes : le haut des barrettes
  pocketTop: 96, // haut des cases (bout des barrettes)
  rest: 77, // fond d'une case : là où la bille se pose
  fretH: 1.4, // hauteur des barrettes : au-dessus, la bille les survole
};
const DIAMONDS = Array.from({ length: 8 }, (_, k) => k * (TAU / 8) + TAU / 16);

const FPS = 60;
const SUB = 10; // 600 pas par seconde : pas de bille qui traverse un obstacle
const DT = 1 / (FPS * SUB);

/** Petit générateur reproductible (mulberry32) : une graine = une trajectoire. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wrap = (a) => ((a % TAU) + TAU) % TAU;

/**
 * Une trajectoire complète. Renvoie les images (60 par seconde) : t, angle du cylindre, angle de la bille, rayon,
 * hauteur ; les chocs (pour le son) ; la case PHYSIQUE d'arrivée (indice sur le cylindre, avant décalage).
 */
function simulate(seed) {
  const rnd = seeded(seed);
  const R = (a, b) => a + (b - a) * rnd();
  // Le cylindre : lancé doucement, il ralentit à peine.
  let theta = R(0, TAU);
  const wr0 = R(1.7, 2.5);
  const wrDecel = wr0 * R(0.045, 0.07);
  // La bille : 2 tours/s environ, en sens inverse.
  let phi = R(0, TAU);
  let w = -R(11.8, 13.2);
  let rho = GEO.track;
  let vr = 0;
  let z = 0;
  let vz = 0;
  const wCrit = R(5.7, 6.4); // sous cette vitesse, la piste ne retient plus la bille
  const k = { roll: R(0.85, 1.1), air: R(0.0085, 0.0105), apron: R(1.6, 2.2), rotor: R(0.6, 1), visc: R(0.15, 0.3) };
  let onTrack = true;
  let diamondCool = 0;
  let captured = null; // { t, pocket, psi } : la bille est posée
  let still = 0;
  const frames = [];
  const events = [];
  let lastHit = -1;
  const hit = (t, kind, v) => {
    if (t - lastHit < 0.03 && kind !== 'diamond') return;
    lastHit = t;
    events.push({ t, kind, v: Math.min(1, v) });
  };

  let t = 0;
  const maxT = 10;
  const after = 0.75; // le cylindre continue un peu avec la bille dedans
  for (let i = 0; ; i++) {
    const wr = Math.max(0.4, wr0 - wrDecel * t);
    if (i % SUB === 0) frames.push(t, theta, phi, rho, z);
    if (captured && t >= captured.t + after) break;
    if (t > maxT) return null;
    theta += wr * DT;
    t += DT;

    if (captured) {
      // Posée : elle suit le cylindre, recentrée en douceur au fond de la case.
      const u = Math.min(1, (t - captured.t) / 0.3);
      const e = u * u * (3 - 2 * u);
      const psi = captured.psi + (captured.pocket * STEP - captured.psi) * e;
      phi = theta + captured.base + psi; // base : un nombre entier de tours, pour que l'angle reste continu
      rho = captured.rho + (GEO.rest - captured.rho) * e;
      z = 0;
      continue;
    }

    const L0phi = phi;
    const onRotor = rho <= GEO.rotor;
    let ar;
    if (!onRotor) {
      // Partie fixe : frottement de roulement + air ; la bille « tient » sur la piste tant qu'elle va assez vite.
      const mag = Math.abs(w);
      const dec = (onTrack ? k.roll + k.air * mag * mag : k.apron + k.air * mag * mag) * DT;
      w = Math.sign(w) * Math.max(0, mag - dec);
      ar = (onTrack ? 0.15 : 0.22) * (w * w - wCrit * wCrit) * rho;
      if (onTrack) {
        if (ar >= 0) {
        rho = GEO.track;
        vr = 0;
        ar = 0;
      }
        else onTrack = false;
      }
    } else {
      // Sur le cylindre : la bille frotte contre LUI (vitesse relative), et la pente la ramène vers le centre.
      let rel = w - wr;
      if (z <= 0) {
        const d = (k.rotor + k.visc * Math.abs(rel)) * DT;
        rel = Math.abs(rel) <= d ? 0 : rel - Math.sign(rel) * d;
        if (rho < GEO.pocketTop && Math.abs(rel) < 1.2) {
          // Presque arrêtée, le fond arrondi de la case la recentre (petit ressort amorti).
          const psi = wrap(phi - theta);
          const f = psi / STEP - Math.round(psi / STEP); // -0,5 … 0,5 autour du centre de la case
          rel += (-38 * f * STEP - 2.2 * rel) * DT;
        }
      }
      w = wr + rel;
      ar = 0.035 * w * w * rho - 190;
    }
    // Moment cinétique : en descendant la pente fixe vers le cylindre, la bille accélère (et inversement). Sur le
    // cylindre, ce sont les parois des cases qui la guident.
    if (!onRotor) w += ((-2 * vr * w) / rho) * DT;
    vr += ar * DT;
    rho += vr * DT;
    phi += w * DT;

    // Hauteur : rebonds sur le fond.
    if (z > 0 || vz > 0) {
      vz -= 1500 * DT;
      z += vz * DT;
      if (z <= 0) {
        z = 0;
        if (vz < -14) hit(t, 'floor', -vz / 120);
        vz = vz < -14 ? -vz * 0.38 : 0;
      }
    }

    // Murs : la piste dehors, le fond des cases dedans.
    if (rho > GEO.track) {
      rho = GEO.track;
      vr = Math.min(0, -0.3 * vr);
    }
    if (rho < GEO.rest) {
      rho = GEO.rest;
      vr = Math.max(0, -0.3 * vr);
    }

    // Les 8 losanges (fixes). Ils sont obliques : la bille ne repart pas en arrière, elle ricoche — elle perd de la
    // vitesse, saute, et part vers le centre (le plus souvent) ou remonte vers la piste.
    if (!onTrack && t > diamondCool && z < 2.5 && rho > GEO.rotor - 2 && rho < GEO.diamond + GEO.diamondHit) {
      for (const a of DIAMONDS) {
        const dx = rho * Math.sin(phi) - GEO.diamond * Math.sin(a);
        const dy = -rho * Math.cos(phi) + GEO.diamond * Math.cos(a);
        if (Math.hypot(dx, dy) >= GEO.diamondHit) continue;
        const da = Math.atan2(Math.sin(phi - a), Math.cos(phi - a)); // côté du losange où se trouve la bille
        if (da * w > 0) continue; // elle s'en éloigne déjà
        const speed = Math.abs(w) * rho;
        w *= R(0.6, 0.85);
        vr = R(-1, 0.3) * 0.4 * speed;
        vz = Math.min(110, vz + speed * R(0.1, 0.2));
        phi = a + Math.sign(da || -w) * (GEO.diamondHit / rho) * 1.02;
        phi += Math.round((L0phi - phi) / TAU) * TAU;
        diamondCool = t + 0.12;
        hit(t, 'diamond', speed / 600);
        break;
      }
    }

    if (rho <= GEO.rotor + 0.5 && z < 2.6) {
      // Les barrettes entre les cases (jusqu'aux picots du bord) : la bille rebondit dessus, ou les survole.
      if (rho - GEO.ball < GEO.peg && z < GEO.fretH) {
        const psi = wrap(phi - theta);
        const u = psi / STEP + 0.5; // une case = [n, n+1[ ; barrettes aux entiers
        const f = u - Math.floor(u);
        const h = GEO.ball / rho / STEP;
        const rel = w - wr;
        if ((f < h && rel < 0) || (f > 1 - h && rel > 0)) {
          const v = Math.abs(rel) * rho;
          if (v > 230 && rnd() < 0.75) {
            // Rapide : elle accroche le haut de la barrette et la survole, en perdant de la vitesse.
            w = wr + rel * R(0.5, 0.72);
            z = GEO.fretH + 0.05;
            vz = Math.min(130, Math.max(vz, v * R(0.14, 0.22)));
          } else {
            // Plus lente : elle rebondit en arrière ; parfois, même lente, elle ressaute par-dessus la suivante.
            phi += (f < h ? h - f : 1 - h - f) * STEP;
            w = wr - R(0.25, 0.45) * rel;
            const pop = v > 55 && rnd() < 0.22 ? R(0.5, 0.75) : R(0.08, 0.2);
            vz = Math.min(130, vz + v * pop);
          }
          vr += R(-0.05, 0.12) * v;
          if (v > 25) hit(t, 'fret', v / 300);
        }
      }
    }

    // Posée ? Au fond d'une case, sans sauter, presque immobile par rapport au cylindre, pendant un instant.
    const rel = w - wr;
    if (rho < GEO.pocketTop - 6 && z === 0 && Math.abs(rel) < 0.18 && Math.abs(vr) < 18) still += DT;
    else still = 0;
    if (still > 0.3) {
      const psi = wrap(phi - theta);
      const kk = Math.round(psi / STEP);
      const pocket = kk % N;
      const cpsi = psi - (kk - pocket) * STEP; // près du centre de SA case (36,9 → -0,1 pour le 0)
      captured = { t, pocket, psi: cpsi, base: phi - theta - cpsi, rho };
      hit(t, 'settle', 0.4);
    }
  }
  return { frames: Float64Array.from(frames), events, pocket: captured.pocket, settleT: captured.t, duration: frames[frames.length - 5] };
}

/**
 * La trajectoire pour une case tirée (indice dans l'ordre de la roue). `seed` : facultatif (sinon aléatoire).
 * Renvoie { frames, events, duration, settleT, offset } : offset = décalage (radians, multiple d'une case) à ajouter à
 * l'angle du cylindre pour que la case d'arrivée porte le bon numéro.
 */
function plan(pocket, seed) {
  let s = seed === undefined ? Math.floor(Math.random() * 2 ** 31) : seed;
  for (let tries = 0; tries < 40; tries++, s = (s * 1103515245 + 12345) >>> 0) {
    const sim = simulate(s);
    // Trop court ou trop long : on en prend une autre (le résultat, lui, ne change pas).
    // Et au moins deux chocs sur les barrettes : la bille ne « glisse » jamais simplement dans sa case.
    if (!sim || sim.settleT < 4.2 || sim.settleT > 8.5 || sim.events.filter((e) => e.kind === 'fret').length < 2) continue;
    sim.offset = (((sim.pocket - pocket) % N) + N) % N * STEP;
    sim.seed = s;
    return sim;
  }
  return null;
}

/** L'état à l'instant t (interpolé) : { theta, phi, rho, z }. */
function at(sim, t) {
  const f = sim.frames;
  const n = f.length / 5;
  const x = Math.max(0, Math.min(n - 1, t * FPS));
  const i = Math.min(n - 2, Math.floor(x));
  const u = x - i;
  const g = (k) => f[i * 5 + k] + (f[(i + 1) * 5 + k] - f[i * 5 + k]) * u;
  return { theta: g(1) + sim.offset, phi: g(2), rho: g(3), z: g(4) };
}

/** La case (indice) sous la bille pour un état donné. */
const pocketAt = (s) => Math.round(wrap(s.phi - s.theta) / STEP) % N;

export const ArcadeBall = { N, STEP, GEO, DIAMONDS, simulate, plan, at, pocketAt, FPS };
