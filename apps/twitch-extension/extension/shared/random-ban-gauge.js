// Mini-jeux › Random Ban V5 — the charges gauge, in the game's top bar above the Sniper and the Launch button. One
// segment per charge (3 by default), the recharging one filling CONTINUOUSLY, the time before the next charge. The price
// is on the Launch button, never here; the details (charges, next one, full, how it works) are in a tooltip opened by
// hover, focus or tap. The counts are always the Core's (chargesModel): the gauge only shows the time passing.

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
      <span class="rbg__next" data-g="next"></span>
    </button>
    <div class="rbg__tip" id="rbg-tip" role="tooltip" data-g="tip" hidden></div>`;
  const $ = (k) => node.querySelector(`[data-g="${k}"]`);
  let cellsOf = 0;
  let pinned = false; // opened by a tap / Enter: stays until closed
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
  const show = (open) => {
    $('tip').hidden = !open;
    $('btn').setAttribute('aria-expanded', String(open));
    if (open && model) $('tip').innerHTML = tipHtml(model);
  };
  const onEnter = () => show(true);
  const onLeave = () => {
    if (!pinned) show(false);
  };
  const onClick = () => {
    pinned = !pinned;
    show(pinned);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !$('tip').hidden) {
      e.stopPropagation();
      pinned = false;
      show(false);
    }
  };
  const btn = $('btn');
  const on = [
    [btn, 'mouseenter', onEnter],
    [btn, 'mouseleave', onLeave],
    [btn, 'focus', onEnter],
    [btn, 'blur', onLeave],
    [btn, 'click', onClick],
    [btn, 'keydown', onKey],
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
      $('next').textContent = m.available < m.max ? `+1 ${mmss(m.next_in_ms)}` : `${m.available}/${m.max}`;
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
