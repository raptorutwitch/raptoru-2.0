// Mini-jeux › Random Ban V3 — the price recovery gauge. The five tiers as marks, the price where it stands, a fill
// that slides back toward the normal price CONTINUOUSLY (redrawn several times a second, eased by CSS). The amounts are
// always the Core's (recoveryModel): the gauge only shows the time passing between two reads.

import { priceShort, priceText, recoveryModel, waitText } from './random-ban-model.js';

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function createPriceGauge(document) {
  const node = document.createElement('div');
  node.className = 'rbg';
  node.innerHTML = `<div class="rbg__top">
      <span class="rbg__label">Ton prix</span>
      <strong class="rbg__price" data-g="price">—</strong>
    </div>
    <div class="rbg__bar" role="meter" aria-label="Récupération du prix" aria-valuemin="0" aria-valuemax="100" data-g="meter">
      <div class="rbg__fill" data-g="fill"></div>
      <div class="rbg__marks" data-g="marks"></div>
    </div>
    <div class="rbg__next" data-g="next"></div>`;
  const $ = (k) => node.querySelector(`[data-g="${k}"]`);
  let marksSig = '';
  let lastLabel = '';

  return {
    node,
    /** Returns the model (`stale`: the Core's price has dropped by now — read it again). */
    update(state, readAt, now = Date.now()) {
      const p = state?.price;
      if (!p) {
        $('price').textContent = '—';
        return null;
      }
      const m = recoveryModel(p, state.tiers, readAt, now, state.step_ms);
      $('price').textContent = priceText(m.price).replace(' Jetons', '');
      node.classList.toggle('is-up', m.level > 0);
      const sig = m.marks.map((x) => `${x.amount}:${x.current}`).join(',');
      if (sig !== marksSig) {
        marksSig = sig;
        $('marks').innerHTML = m.marks
          .map(
            (x, i) =>
              `<span class="rbg__mark${x.current ? ' is-on' : ''}${i === 0 ? ' is-first' : ''}${i === m.marks.length - 1 ? ' is-last' : ''}" style="--at:${x.at}"><i></i><b>${priceShort(x.amount)}</b></span>`,
          )
          .join('');
      }
      $('fill').style.transform = `scaleX(${Math.max(0.001, m.fill).toFixed(4)})`;
      $('meter').setAttribute('aria-valuenow', String(Math.round(m.fill * 100)));
      const label = m.level
        ? `${priceShort(m.next_price)} dans ${mmss(m.next_in_ms)}${m.level > 1 ? ` · normal dans ${mmss(m.normal_in_ms)}` : ''}`
        : 'Tarif normal · chaque lancer monte d’un palier';
      $('next').textContent = label;
      // Screen readers: the step, not every second.
      const said = m.level ? `Ton prix : ${priceText(m.price)}, ${priceText(m.next_price)} dans ${waitText(m.next_in_ms, { seconds: false })}.` : `Ton prix : ${priceText(m.price)}, tarif normal.`;
      if (said.split(',')[0] !== lastLabel) {
        lastLabel = said.split(',')[0];
        $('meter').setAttribute('aria-valuetext', said);
      }
      return m;
    },
  };
}
