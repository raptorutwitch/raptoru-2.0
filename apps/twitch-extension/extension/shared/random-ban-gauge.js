// Mini-jeux › Random Ban V5 — the charges gauge, in the game's top bar above the Sniper and the Launch button. One
// segment per charge (3 by default), the recharging one filling CONTINUOUSLY, the time before the next charge. The price
// is on the Launch button, never here. At rest: the segments, and only while one recharges a small clock and its m:ss
// (nothing when the reserve is full). The details (charges, next one, full, how it works) are in a tooltip, hidden at
// rest: mouse hover (closed on leaving), keyboard focus / Enter / Escape, a tap (closed by another tap or a tap
// elsewhere), always kept inside the extension's window. The counts are always the Core's (chargesModel).

import { chargesModel, waitText } from './random-ban-model.js';

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createChargesGauge(document, { reducedMotion = false } = {}) {
  const node = document.createElement('div');
  node.className = 'rbg';
  node.innerHTML = `<button type="button" class="rbg__btn" data-g="btn" aria-describedby="rbg-tip" aria-expanded="false" aria-label="Tes charges Random Ban">
      <span class="rbg__label" aria-hidden="true">Charges</span>
      <span class="rbg__cells" data-g="cells"></span>
      <span class="rbg__next" data-g="next" hidden><svg class="rbg__clock" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.6V8l2.4 1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span data-g="time"></span></span>
    </button>
    <div class="rbg__tip" id="rbg-tip" role="tooltip" data-g="tip" hidden></div>`;
  const $ = (k) => node.querySelector(`[data-g="${k}"]`);
  let cellsOf = 0;
  let pinned = false; // opened by a tap, a click or Enter: stays until closed (another tap, a tap elsewhere, Escape)
  let hovered = false; // a mouse over the gauge (never a touch: a finger has no hover)
  let model = null;

  const tipHtml = (m) =>
    `<b>${m.available} charge${m.available > 1 ? 's' : ''} sur ${m.max}</b>
     ${
       m.available < m.max
         ? `<span>Prochaine charge dans ${esc(waitText(m.next_in_ms))}</span>${
             m.full_in_ms > m.next_in_ms ? `<span>Toutes rechargées dans ${esc(waitText(m.full_in_ms))}</span>` : ''
           }`
         : '<span>Réserve pleine</span>'
     }
     <small>Un Random Ban lancé utilise une charge, ici, avec !rb ou les points de chaîne. Une charge revient toutes les ${Math.round(
       m.recharge_ms / 60_000,
     )} min, même extension fermée. Un refus ou un remboursement ne coûte rien.</small>`;
  /** Keeps the open tooltip inside the window (narrow panels, the mobile view): shifted, never cut. */
  const place = () => {
    const tip = $('tip');
    tip.style.setProperty('--dx', '0px');
    const view = document.defaultView;
    const r = tip.getBoundingClientRect();
    const w = view?.innerWidth || document.documentElement.clientWidth || 0;
    if (!w || !r.width) return;
    const m = 6;
    const dx = r.left < m ? m - r.left : r.right > w - m ? w - m - r.right : 0;
    tip.style.setProperty('--dx', `${Math.round(dx)}px`);
  };
  const show = (open) => {
    const tip = $('tip');
    const was = !tip.hidden;
    tip.hidden = !open;
    $('btn').setAttribute('aria-expanded', String(open));
    if (open && model) tip.innerHTML = tipHtml(model);
    if (open && !was) place();
  };
  const sync = () => show(pinned || hovered);
  const btn = $('btn');
  const onEnter = (e) => {
    if (e.pointerType !== 'mouse') return;
    hovered = true;
    sync();
  };
  const onLeave = (e) => {
    if (e.pointerType !== 'mouse') return;
    hovered = false;
    pinned = false; // leaving with the mouse always closes, even after a click
    sync();
  };
  const onClick = () => {
    pinned = !pinned;
    if (!pinned) hovered = false;
    sync();
  };
  const onFocus = () => {
    // Keyboard only (a tap also focuses the button: its click decides).
    if (btn.matches?.(':focus-visible')) {
      pinned = true;
      sync();
    }
  };
  const onBlur = () => {
    pinned = false;
    sync();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !$('tip').hidden) {
      e.stopPropagation();
      pinned = false;
      hovered = false;
      sync();
    }
  };
  // A tap or a click anywhere else closes it (never left stuck on a phone).
  const onOutside = (e) => {
    if ($('tip').hidden || node.contains(e.target)) return;
    pinned = false;
    hovered = false;
    sync();
  };
  const on = [
    [btn, 'pointerenter', onEnter],
    [btn, 'pointerleave', onLeave],
    [btn, 'focus', onFocus],
    [btn, 'blur', onBlur],
    [btn, 'click', onClick],
    [btn, 'keydown', onKey],
    [document, 'pointerdown', onOutside],
  ];
  for (const [el, ev, fn] of on) el.addEventListener(ev, fn);

  return {
    node,
    /** Returns the model (`stale`: a charge came back by now — read the Core again). Null: no charge limit. */
    update(state, readAt, now = Date.now()) {
      const m = chargesModel(state?.charges, readAt, now, { reducedMotion });
      node.hidden = !m;
      model = m;
      if (!m) return null;
      if (cellsOf !== m.max) {
        cellsOf = m.max;
        $('cells').innerHTML = Array.from({ length: m.max }, () => '<span class="rbg__cell"><i></i></span>').join('');
      }
      [...$('cells').children].forEach((cell, i) => {
        const f = Math.max(0, Math.min(1, m.level - i));
        cell.classList.toggle('is-full', f >= 1);
        cell.classList.toggle('is-filling', f > 0 && f < 1);
        cell.firstChild.style.transform = `scaleX(${Math.max(0.001, f).toFixed(4)})`;
      });
      node.classList.toggle('is-empty', m.available < 1);
      // Only while a charge comes back: the clock and its time (the full reserve needs no words).
      $('next').hidden = m.available >= m.max;
      $('time').textContent = m.available < m.max ? mmss(m.next_in_ms) : '';
      $('next').title = m.available < m.max ? 'Prochaine charge' : '';
      btn.setAttribute(
        'aria-label',
        m.available < m.max
          ? `Charges : ${m.available} sur ${m.max}. Prochaine dans ${waitText(m.next_in_ms, { seconds: false })}.`
          : `Charges : ${m.available} sur ${m.max}, réserve pleine.`,
      );
      if (!$('tip').hidden) $('tip').innerHTML = tipHtml(m);
      return m;
    },
    destroy() {
      for (const [el, ev, fn] of on) el.removeEventListener(ev, fn);
    },
  };
}
