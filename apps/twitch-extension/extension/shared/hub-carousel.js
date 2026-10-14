// Hub « Pop Premium » : carousel horizontal aimanté (classes rh-*, feuille hub.css).
// Une seule carte DOM par module ; la boucle infinie vient d'un écart calculé modulo le nombre
// de modules (aucun clone). Mouvement amorti exponentiel : jamais de rebond, même en rafale.
// Purement visuel : la liste des modules, leurs états et l'ouverture viennent de l'intégration.

const SVG_NS = 'http://www.w3.org/2000/svg';

export const HUB_ICON_PATHS = Object.freeze({
  tts: '<path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3.5V16.5H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 10h8M8 13h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  soundboard: '<path d="M4.5 9.6v4.8h3.2l4.3 3.7V5.9L7.7 9.6Z" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M15.3 9.4a3.6 3.6 0 0 1 0 5.2M17.9 6.9a7.2 7.2 0 0 1 0 10.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  // Bonk : une emote (visage) projetée à l'écran — traînée de vitesse et étincelles d'impact.
  bonk: '<circle cx="14" cy="12" r="8.3" fill="currentColor"/><circle cx="11.4" cy="10.4" r="1.35" fill="#1a1030"/><circle cx="16.6" cy="10.4" r="1.35" fill="#1a1030"/><path d="M10.6 13.8c1.9 2.1 4.9 2.1 6.8 0" fill="none" stroke="#1a1030" stroke-width="1.7" stroke-linecap="round"/><path d="M1.2 9h3M.6 12.5h3.2M1.2 16h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M22.4 5.4l1.2-1.2M23 9.8l1.1-.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  raffle_join: '<path d="M4 7.5h16v3a1.5 1.5 0 0 0 0 3v3H4v-3a1.5 1.5 0 0 0 0-3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 7.5v9" stroke="currentColor" stroke-width="1.6" stroke-dasharray="1.6 2"/>',
  // Commandes : une bulle de chat avec « ! ».
  commands: '<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 8v4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="14.6" r="1.2" fill="currentColor"/>',
  moderation: '<path d="M12 3.5 19 6v5.5c0 4.2-3 7.5-7 9-4-1.5-7-4.8-7-9V6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  module: '<rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 12h6M12 9v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  chevL: '<path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  chevR: '<path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  arrow: '<path d="M5 12h12m-4.5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  grid: '<path d="M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 8v4.5l3 1.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  trophy: '<path d="M8 4.5h8v4a4 4 0 0 1-8 0Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 6H5a3 3 0 0 0 3 3.5M16 6h3a3 3 0 0 1-3 3.5M12 12.5V16M9 19.5h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
});

// Motifs de fond propres à chaque module (discrets, blancs sur la couleur du module).
const MOTIFS = Object.freeze({
  tts: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 40c10-10 10-26 0-36"/><path d="M30 46c16-16 16-40 0-56"/><path d="M182 40c-10-10-10-26 0-36"/><path d="M170 46c-16-16-16-40 0-56"/><path d="M40 118h40M50 128h24M130 108h34M138 118h22"/></g>',
  soundboard: `<g fill="currentColor">${[14, 26, 18, 40, 30, 52, 22, 36, 48, 28, 16, 38, 24, 44, 20, 12]
    .map((h, i) => `<rect x="${8 + i * 12}" y="${140 - h}" width="6" height="${h}" rx="3"/>`).join('')}</g>`,
  bonk: `<g stroke="currentColor" stroke-width="2.4" stroke-linecap="round">${Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const r2 = 76 + (i % 2) * 14;
    return `<path d="M${(100 + Math.cos(a) * 58).toFixed(1)} ${(72 + Math.sin(a) * 58).toFixed(1)}L${(100 + Math.cos(a) * r2).toFixed(1)} ${(72 + Math.sin(a) * r2).toFixed(1)}"/>`;
  }).join('')}</g>`,
  raffle_join: `<g fill="currentColor">${[[18, 22, 20], [160, 18, -25], [30, 118, -15], [168, 110, 30], [70, 12, 40], [128, 128, -35], [8, 70, 10], [186, 64, -10]]
    .map(([x, y, r]) => `<rect x="${x}" y="${y}" width="16" height="9" rx="2" transform="rotate(${r} ${x + 8} ${y + 4})"/>`).join('')}</g>`,
  moderation: `<g fill="none" stroke="currentColor" stroke-width="1.6">${Array.from({ length: 5 }, (_, r) => Array.from({ length: 7 }, (_, c) => `<path d="M${14 + c * 30 + (r % 2) * 15} ${10 + r * 30}l9 5v10l-9 5-9-5V${15 + r * 30}Z"/>`).join('')).join('')}</g>`,
});

export function hubIcon(document, name, className = 'rh-icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  svg.innerHTML = HUB_ICON_PATHS[name] || HUB_ICON_PATHS.module;
  return svg;
}

function motif(document, name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 145');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'rh-motif');
  svg.innerHTML = MOTIFS[name] || '';
  return svg;
}

/**
 * Monte le carousel dans `stage`, les dots de position dans `rail` et le lanceur dans `popover`.
 * modules : [{ id, label, description, icon, color, color2, chip: { text, tone } | null, off, badge }]
 * onOpen(id) : ouverture du module actif ; onSelect(id) : mémorisation de la sélection.
 * rail : reçoit les dots de position ; launcherHost : reçoit le bouton grille (lanceur « Tous »).
 */
export function createHubCarousel({
  document = globalThis.document,
  stage,
  rail,
  popover,
  launcherHost = null,
  modules,
  selectedId = null,
  onSelect = null,
  onOpen = null,
}) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const n = modules.length;
  const track = make('div', 'rh-car');
  track.tabIndex = 0;
  track.setAttribute('role', 'listbox');
  track.setAttribute('aria-roledescription', 'carousel');
  track.setAttribute('aria-label', 'Modules');
  const prev = make('button', 'rh-nav rh-nav--prev');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Module précédent');
  prev.append(hubIcon(document, 'chevL'));
  const next = make('button', 'rh-nav rh-nav--next');
  next.type = 'button';
  next.setAttribute('aria-label', 'Module suivant');
  next.append(hubIcon(document, 'chevR'));
  stage.append(track, prev, next);

  const cards = modules.map((mod, i) => {
    const card = make('div', `rh-card${mod.off ? ' is-off' : ''}`);
    card.dataset.i = String(i);
    card.dataset.module = mod.id;
    card.setAttribute('role', 'option');
    card.setAttribute('aria-label', `${mod.label}${mod.chip ? ` · ${mod.chip.text}` : ''}${mod.corner ? ` · ${mod.corner.getAttribute('aria-label')}` : ''}`);
    card.style.setProperty('--m', mod.color);
    card.style.setProperty('--m2', mod.color2);
    const art = make('div', 'rh-art');
    const orb = make('span', 'rh-orb');
    orb.append(hubIcon(document, mod.icon));
    if (mod.badge) {
      const badge = make('span', 'rh-badge', String(mod.badge));
      badge.setAttribute('aria-label', `${mod.badge} notification${mod.badge > 1 ? 's' : ''}`);
      orb.append(badge);
    }
    art.append(orb);
    const body = make('div', 'rh-body');
    if (mod.chip) {
      const chip = make('span', `rh-chip rh-chip--${mod.chip.tone || 'neutral'}`, mod.chip.text);
      body.append(chip);
    }
    const cta = make('span', 'rh-cta', mod.off ? 'Indisponible' : 'Ouvrir');
    if (!mod.off) cta.append(hubIcon(document, 'arrow'));
    body.append(make('div', 'rh-name', mod.label), make('div', 'rh-desc', mod.description), cta);
    card.append(motif(document, mod.icon), art, body);
    // Optional corner element (viewer restriction pill): absolute, never changes the card size.
    if (mod.corner) card.append(mod.corner);
    track.append(card);
    return card;
  });

  const startIndex = Math.max(0, modules.findIndex((mod) => mod.id === selectedId));
  let pos = startIndex;
  let target = startIndex;
  let raf = 0;
  let cw = 200;
  let gap = 190;
  let side = 1;
  const index = () => ((Math.round(target) % n) + n) % n;
  // Écart signé le plus court entre la carte i et la position courante (boucle).
  const offset = (i) => {
    let d = (i - pos) % n;
    if (d < -n / 2) d += n;
    if (d >= n / 2) d -= n;
    return d;
  };

  const railButtons = [];
  const popButtons = [];
  const paint = () => {
    for (const card of cards) {
      const d = offset(Number(card.dataset.i));
      const a = Math.abs(d);
      const scale = 1 - Math.min(a, 1) * 0.14 - Math.max(0, a - 1) * 0.06;
      const x = d * gap - Math.sign(d) * Math.max(0, a - 1) * cw * 0.1;
      const fade = Math.max(0, Math.min(1, side + 0.9 - a));
      card.style.transform = `translate3d(${x.toFixed(1)}px,0,0) scale(${scale.toFixed(3)})`;
      card.style.opacity = fade.toFixed(3);
      card.style.zIndex = String(100 - Math.round(a * 10));
      card.style.filter = `brightness(${(1 - Math.min(a, 1) * 0.28).toFixed(3)}) saturate(${(1 - Math.min(a, 1) * 0.12).toFixed(3)})`;
      card.style.visibility = fade <= 0 ? 'hidden' : 'visible';
      const active = a < 0.5;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-selected', String(active));
    }
    const current = index();
    railButtons.forEach((button, i) => {
      button.classList.toggle('is-on', i === current);
      button.setAttribute('aria-current', String(i === current));
    });
    popButtons.forEach((button, i) => button.classList.toggle('is-on', i === current));
    // Couleur de l'aura douce derrière la carte active (hub.css, .rh-car::before).
    track.style.setProperty('--rh-glow', modules[current].color);
  };
  // Amorti exponentiel indépendant de la fréquence d'images : départ vif, arrivée douce,
  // jamais de dépassement ; des clics en rafale font simplement glisser plus loin.
  const animate = () => {
    onSelect?.(modules[index()].id);
    if (raf) return;
    let last = performance.now();
    const step = (now) => {
      // L'horodatage d'image peut précéder `last` au premier pas : jamais de pas négatif (recul).
      const dt = Math.max(0, Math.min(50, now - last));
      last = now;
      pos += (target - pos) * (1 - Math.exp(-dt / 105));
      if (Math.abs(target - pos) < 0.001) {
        pos = target;
        raf = 0;
        paint();
        return;
      }
      paint();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  const go = (delta) => {
    target += delta;
    animate();
  };
  const goTo = (i) => {
    let d = (i - index()) % n;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    go(d);
  };
  const open = (i) => {
    if (!modules[i].off) onOpen?.(modules[i].id);
  };

  // Dimensions : la carte active occupe la largeur utile ; la vidéo montre plus de voisines.
  const measure = () => {
    const w = track.clientWidth;
    const h = track.clientHeight;
    if (!w || !h) return;
    const wide = w > 460;
    // Largeur large réglable par un profil de densité CSS (--rh-card-w) ; 176 px sinon.
    const wideCw = parseFloat(document.defaultView?.getComputedStyle(track)?.getPropertyValue('--rh-card-w')) || 176;
    cw = wide ? wideCw : w > 340 ? Math.min(224, w - 150) : Math.min(200, w - 110);
    side = Math.max(1, Math.min(wide ? 2 : 1, Math.floor((n - 1) / 2)));
    const ch = Math.max(180, Math.min(h - 18, Math.round(cw * 1.52)));
    gap = cw * 0.5 + cw * 0.86 * 0.5 + 12;
    track.style.setProperty('--rh-cw', `${cw}px`);
    track.style.setProperty('--rh-ch', `${ch}px`);
    paint();
  };

  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  track.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(index()); }
  });
  // Glisser (souris / tactile) puis aimantation ; un simple clic sélectionne ou ouvre.
  let drag = null;
  track.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, pos, t: performance.now(), lastX: event.clientX, v: 0, moved: false, card: event.target.closest('.rh-card') };
  });
  track.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      try { track.setPointerCapture(event.pointerId); } catch { /* capture facultative */ }
      cancelAnimationFrame(raf);
      raf = 0;
    }
    const now = performance.now();
    drag.v = (event.clientX - drag.lastX) / Math.max(1, now - drag.t);
    drag.lastX = event.clientX;
    drag.t = now;
    pos = drag.pos - dx / gap;
    paint();
  });
  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      if (!d.card) return;
      const i = Number(d.card.dataset.i);
      if (i === index()) open(i);
      else goTo(i);
      return;
    }
    const fling = Math.max(-1, Math.min(1, Math.round(-d.v * 2.2)));
    target = Math.round(pos) + (Math.abs(pos - Math.round(pos)) < 0.15 ? fling : 0);
    animate();
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  // Molette horizontale / trackpad : suit le geste puis s'aimante.
  let wheelIdle = 0;
  // Molette verticale sur le carousel : une carte par cran. Un verrou absorbe la suite du
  // geste (inertie de trackpad, molette libre) ; il tombe après une courte pause, ou après
  // un délai pour une molette à crans afin que des crans rapprochés avancent quand même.
  const notch = { acc: 0, lockedAt: 0, lastAt: 0 };
  const verticalStep = (event) => {
    const now = performance.now();
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1;
    const dy = event.deltaY * unit;
    const discrete = event.deltaMode !== 0 || Math.abs(dy) >= 50;
    const idle = now - notch.lastAt;
    notch.lastAt = now;
    if (notch.lockedAt && (idle >= 150 || (discrete && now - notch.lockedAt >= 280))) notch.lockedAt = 0;
    if (notch.lockedAt) return;
    if (idle >= 150 || Math.sign(dy) !== Math.sign(notch.acc)) notch.acc = 0;
    notch.acc += dy;
    if (Math.abs(notch.acc) < 40) return;
    go(notch.acc > 0 ? 1 : -1);
    notch.acc = 0;
    notch.lockedAt = now;
  };
  // Écouté sur la scène (cartes + flèches) : le curseur peut être n'importe où sur le carousel.
  stage.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.shiftKey || !event.deltaY || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    verticalStep(event);
  }, { passive: false });
  track.addEventListener('wheel', (event) => {
    const dx = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (!dx) return;
    event.preventDefault();
    cancelAnimationFrame(raf);
    raf = 0;
    pos += dx / (gap * 1.6);
    target = pos;
    paint();
    clearTimeout(wheelIdle);
    wheelIdle = setTimeout(() => {
      target = Math.round(pos);
      animate();
    }, 120);
  }, { passive: false });

  // Dots de position (repère visuel seulement) + lanceur « Tous ».
  rail.setAttribute('aria-hidden', 'true');
  modules.forEach((mod, i) => {
    const dot = make('span', 'rh-pos');
    dot.style.setProperty('--m', mod.color);
    rail.append(dot);
    railButtons.push(dot);
    const tile = make('button', 'rh-all__item');
    tile.type = 'button';
    tile.style.setProperty('--m', mod.color);
    tile.style.setProperty('--m2', mod.color2);
    tile.setAttribute('aria-label', `${mod.label}${mod.chip ? ` · ${mod.chip.text}` : ''}`);
    const tileIcon = make('span', 'rh-all__icon');
    tileIcon.append(hubIcon(document, mod.icon));
    if (mod.chip) tileIcon.append(make('span', `rh-all__pip rh-all__pip--${mod.chip.tone || 'neutral'}`));
    tile.append(tileIcon, make('span', 'rh-all__name', mod.label));
    // Raccourci : un module ouvrable s'ouvre directement (sa carte reste sélectionnée au retour) ;
    // un module indisponible est seulement amené devant, comme avant.
    tile.addEventListener('click', (event) => {
      event.stopPropagation();
      setPopover(false);
      if (mod.off) return goTo(i);
      onSelect?.(mod.id);
      open(i);
    });
    popover.append(tile);
    popButtons.push(tile);
  });
  const allButton = make('button', 'rh-all-toggle');
  allButton.type = 'button';
  allButton.setAttribute('aria-haspopup', 'dialog');
  allButton.setAttribute('aria-label', 'Voir tous les modules');
  allButton.title = 'Voir tous les modules';
  allButton.append(hubIcon(document, 'grid'));
  const setPopover = (open) => {
    popover.hidden = !open;
    allButton.classList.toggle('is-open', open);
    allButton.setAttribute('aria-expanded', String(open));
  };
  allButton.addEventListener('click', (event) => {
    event.stopPropagation();
    setPopover(popover.hidden);
  });
  popover.addEventListener('click', (event) => event.stopPropagation());
  (launcherHost || rail).append(allButton);
  setPopover(false);
  // « Tous » se ferme sur un clic à côté ou avec Échap (sans remonter jusqu'au tiroir).
  const onOutside = (event) => {
    if (popover.hidden || popover.contains(event.target) || allButton.contains(event.target)) return;
    setPopover(false);
  };
  const onEscape = (event) => {
    if (event.key !== 'Escape' || popover.hidden) return;
    event.stopPropagation();
    setPopover(false);
    allButton.focus({ preventScroll: true });
  };
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onEscape, true);

  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
  resize?.observe(track);
  requestAnimationFrame(measure);
  paint();

  return {
    get selectedId() { return modules[index()]?.id ?? null; },
    closePopover: () => setPopover(false),
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(wheelIdle);
      resize?.disconnect();
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onEscape, true);
    },
  };
}
