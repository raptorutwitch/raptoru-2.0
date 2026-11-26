// LAB ONLY — glisser-déposer du catalogue Chaos : le geste de la Soundboard (shared/soundboard-view.js, validé), repris
// à l'identique sans toucher à son fichier : appui long de 300 ms (bouger de plus de 10 px avant = clic ou défilement,
// jamais un déplacement), positions relevées au départ, la carte suit le doigt, seules les cartes entre l'origine et
// la destination glissent d'une place, emplacement de destination en pointillés, défilement automatique aux bords,
// Échap ou pointercancel annulent sans rien écrire, le clic qui suit le lâcher est ignoré (jamais d'achat accidentel).
// Destination : soundboardDropSlot (même marge de 12 %, pas d'aller-retour autour d'une frontière).
// ponytail: copie du geste plutôt qu'extraction ; extraire dans shared/ le jour où la Soundboard doit être modifiée.
import { soundboardDropSlot } from '../../shared/soundboard-model.js';

const DELAY_MS = 300;
const SLOP_PX = 10;

/**
 * grid : la grille (position: relative) ; scroller : le conteneur qui défile ; items() : les cartes visibles dans
 * l'ordre ; idOf(card) ; onDrop(visibleIds, from, to) : enregistre et renvoie le nouvel ordre visible.
 */
export function createReorder({ document, grid, scroller, items, idOf, onDrop, exclude = '.ix-tile__fav' }) {
  let pending = null;
  let session = null;
  let justDropped = false;
  const win = document.defaultView;

  const track = (move, up, cancel) => {
    win.addEventListener('pointermove', move, { passive: false });
    win.addEventListener('pointerup', up);
    win.addEventListener('pointercancel', cancel);
    return () => {
      win.removeEventListener('pointermove', move);
      win.removeEventListener('pointerup', up);
      win.removeEventListener('pointercancel', cancel);
    };
  };
  const clearPending = () => {
    if (!pending) return;
    win.clearTimeout(pending.timer);
    pending.detach();
    pending.item.classList.remove('is-pressing');
    pending = null;
  };

  function layout() {
    const s = session;
    const box = grid.getBoundingClientRect();
    const x = s.pointerX - box.left;
    const y = s.pointerY - box.top;
    const o = s.slots[s.from];
    s.item.style.transform = `translate(${x - s.grabX - o.left}px, ${y - s.grabY - o.top}px) scale(1.03)`;
    const target = soundboardDropSlot(s.slots, x, y, s.target);
    if (target === s.target) return;
    s.target = target;
    s.cards.forEach((card, i) => {
      if (i === s.from) return;
      const next = i > s.from && i <= target ? i - 1 : i < s.from && i >= target ? i + 1 : i;
      card.style.transform = next === i ? '' : `translate(${s.slots[next].left - s.slots[i].left}px, ${s.slots[next].top - s.slots[i].top}px)`;
    });
    s.marker.style.transform = `translate(${s.slots[target].left}px, ${s.slots[target].top}px)`;
  }

  function autoScroll() {
    const s = session;
    if (!s) return;
    const box = scroller.getBoundingClientRect();
    const edge = Math.min(36, box.height / 4);
    const step = s.pointerY < box.top + edge ? -7 : s.pointerY > box.bottom - edge ? 7 : 0;
    if (step) {
      const before = scroller.scrollTop;
      scroller.scrollTop += step;
      if (scroller.scrollTop !== before) layout();
    }
    s.frame = win.requestAnimationFrame(autoScroll);
  }

  const onKey = (event) => {
    if (event.key !== 'Escape' || !session) return;
    event.preventDefault();
    event.stopPropagation();
    finish(false);
  };

  function finish(commit) {
    clearPending();
    const s = session;
    if (!s) return;
    session = null;
    s.detach();
    win.cancelAnimationFrame(s.frame);
    win.removeEventListener('keydown', onKey, true);
    s.marker.remove();
    justDropped = true;
    win.setTimeout(() => {
      justDropped = false;
    }, 0);
    if (!s.item.isConnected) return;
    const dropped = s.item.getBoundingClientRect();
    grid.classList.add('is-settling');
    for (const card of s.cards) card.style.transform = '';
    if (commit && s.target !== s.from) {
      const next = onDrop(s.visibleIds, s.from, s.target);
      const byId = new Map(s.cards.map((c) => [idOf(c), c]));
      // Les mêmes nœuds, remis dans le nouvel ordre : aucune reconstruction, aucun flash.
      grid.append(...next.map((id) => byId.get(id)).filter(Boolean));
    }
    const landed = s.item.getBoundingClientRect();
    s.item.style.transform = `translate(${dropped.left - landed.left}px, ${dropped.top - landed.top}px)`;
    void s.item.offsetWidth;
    grid.classList.remove('is-settling', 'is-dragging');
    s.item.classList.remove('is-dragging');
    s.item.style.transform = '';
  }

  function begin(p) {
    if (pending !== p || session) return;
    p.detach();
    pending = null;
    p.item.classList.remove('is-pressing');
    const cards = items();
    const from = cards.indexOf(p.item);
    if (from < 0) return;
    const box = grid.getBoundingClientRect();
    const slots = cards.map((c) => {
      const r = c.getBoundingClientRect();
      return { left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height };
    });
    const marker = document.createElement('div');
    marker.className = 'ix-drop-slot';
    marker.setAttribute('aria-hidden', 'true');
    marker.style.width = `${slots[from].width}px`;
    marker.style.height = `${slots[from].height}px`;
    marker.style.transform = `translate(${slots[from].left}px, ${slots[from].top}px)`;
    grid.append(marker);
    grid.classList.add('is-dragging');
    p.item.classList.add('is-dragging');
    session = {
      item: p.item,
      cards,
      slots,
      from,
      target: from,
      marker,
      pointerId: p.pointerId,
      grabX: p.x - box.left - slots[from].left,
      grabY: p.y - box.top - slots[from].top,
      pointerX: p.lastX ?? p.x,
      pointerY: p.lastY ?? p.y,
      visibleIds: cards.map(idOf),
      frame: 0,
      detach: () => {},
    };
    const s = session;
    win.addEventListener('keydown', onKey, true);
    s.detach = track(
      (e) => {
        if (e.pointerId !== s.pointerId) return;
        e.preventDefault();
        s.pointerX = e.clientX;
        s.pointerY = e.clientY;
        layout();
      },
      (e) => {
        if (e.pointerId === s.pointerId) finish(true);
      },
      (e) => {
        if (e.pointerId === s.pointerId) finish(false);
      },
    );
    layout();
    s.frame = win.requestAnimationFrame(autoScroll);
    win.navigator?.vibrate?.(8);
  }

  function onDown(event) {
    const item = event.target.closest?.('.ix-tile');
    if (!item || !grid.contains(item) || session || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    if (event.target.closest(exclude)) return;
    clearPending();
    const p = { item, pointerId: event.pointerId ?? 1, x: event.clientX, y: event.clientY, lastX: null, lastY: null, timer: 0, detach: () => {} };
    pending = p;
    item.classList.add('is-pressing');
    p.detach = track(
      (e) => {
        if (e.pointerId !== p.pointerId || pending !== p) return;
        p.lastX = e.clientX;
        p.lastY = e.clientY;
        if (Math.hypot(p.lastX - p.x, p.lastY - p.y) > SLOP_PX) clearPending();
      },
      (e) => {
        if (e.pointerId === p.pointerId && pending === p) clearPending();
      },
      (e) => {
        if (e.pointerId === p.pointerId && pending === p) clearPending();
      },
    );
    p.timer = win.setTimeout(() => begin(p), DELAY_MS);
  }

  // Tactile : une fois le glisser commencé, le doigt déplace la carte, pas la page (sinon pointercancel).
  const onTouchMove = (event) => {
    if (session && event.cancelable) event.preventDefault();
  };
  // Le clic qui suit le lâcher n'ouvre pas la fiche ; l'appui long n'ouvre pas le menu contextuel.
  const onClick = (event) => {
    if (!justDropped) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const onContext = (event) => {
    if (pending || session) event.preventDefault();
  };
  grid.addEventListener('pointerdown', onDown);
  grid.addEventListener('touchmove', onTouchMove, { passive: false });
  grid.addEventListener('click', onClick, true);
  grid.addEventListener('contextmenu', onContext);

  return {
    dragging: () => Boolean(session),
    cancel: () => finish(false),
    destroy() {
      finish(false);
      clearPending();
      grid.removeEventListener('pointerdown', onDown);
      grid.removeEventListener('touchmove', onTouchMove);
      grid.removeEventListener('click', onClick, true);
      grid.removeEventListener('contextmenu', onContext);
    },
  };
}
