// Mini-jeux › Random Ban V4 — the price recovery gauge, compact (in the game's top bar). The five tiers as marks, a
// fill sliding back toward the normal price CONTINUOUSLY, the time before the next drop. The price itself is on the
// Launch button; the details (price, tier, next drop, normal price) are in a tooltip opened by hover, focus or tap.
// The amounts are always the Core's (recoveryModel): the gauge only shows the time passing between two reads.

import { priceShort, priceText, recoveryModel, waitText } from './random-ban-model.js';

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createPriceGauge(document) {
  const node = document.createElement('div');
  node.className = 'rbg';
  node.innerHTML = `<button type="button" class="rbg__btn" data-g="btn" aria-describedby="rbg-tip" aria-expanded="false" aria-label="Récupération de ton prix">
      <span class="rbg__bar"><span class="rbg__fill" data-g="fill"></span><span class="rbg__marks" data-g="marks"></span></span>
      <span class="rbg__next" data-g="next"></span>
    </button>
    <div class="rbg__tip" id="rbg-tip" role="tooltip" data-g="tip" hidden></div>`;
  const $ = (k) => node.querySelector(`[data-g="${k}"]`);
  let marksSig = '';
  let pinned = false; // opened by a tap / Enter: stays until closed
  let model = null;

  const tipHtml = (m) =>
    `<b>Ton prix : ${esc(priceText(m.price))}</b>
     <span>Palier ${m.level + 1} sur ${m.tiers.length}${m.level ? '' : ' · tarif normal'}</span>
     ${
       m.level
         ? `<span>${esc(priceText(m.next_price))} dans ${esc(waitText(m.next_in_ms))}</span><span>Tarif normal (${esc(priceShort(m.tiers[0]))}) dans ${esc(waitText(m.normal_in_ms))}</span>`
         : ''
     }
     <small>Chaque lancer monte ton prix d’un palier (jusqu’à ${esc(priceShort(m.tiers[m.tiers.length - 1]))}). Un palier revient toutes les 5 min sans nouveau lancer.</small>`;
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
    /** Returns the model (`stale`: the Core's price has dropped by now — read it again). */
    update(state, readAt, now = Date.now()) {
      const p = state?.price;
      node.hidden = !p;
      if (!p) return null;
      const m = recoveryModel(p, state.tiers, readAt, now, state.step_ms);
      model = m;
      node.classList.toggle('is-up', m.level > 0);
      const sig = m.marks.map((x) => `${x.amount}:${x.current}`).join(',');
      if (sig !== marksSig) {
        marksSig = sig;
        $('marks').innerHTML = m.marks
          .map(
            (x) =>
              `<span class="rbg__mark${x.current ? ' is-on' : ''}" style="--at:${x.at}"><i></i><b>${esc(priceShort(x.amount).replace(/\s/g, ''))}</b></span>`,
          )
          .join('');
      }
      $('fill').style.transform = `scaleX(${Math.max(0.001, m.fill).toFixed(4)})`;
      $('next').textContent = m.level ? `↓ ${mmss(m.next_in_ms)}` : 'normal';
      btn.setAttribute(
        'aria-label',
        m.level
          ? `Ton prix : ${priceText(m.price)}. ${priceText(m.next_price)} dans ${waitText(m.next_in_ms, { seconds: false })}.`
          : `Ton prix : ${priceText(m.price)}, tarif normal.`,
      );
      if (!$('tip').hidden) $('tip').innerHTML = tipHtml(m);
      return m;
    },
    destroy() {
      for (const [el, ev, fn] of on) el.removeEventListener(ev, fn);
    },
  };
}
