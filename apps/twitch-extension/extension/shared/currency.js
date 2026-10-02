// Currencies in compact Extension surfaces (Panel, Mobile, Video): one rule everywhere.
// The amount comes first; the unit is the short canonical label in the currency's own colour
// (Jetons → « Je », every Crédits → « Cr »); amount + unit stay on one line and shrink a little when
// the box is too narrow — the number is never cut.

const UNITS = Object.freeze({
  tokens: Object.freeze({ short: 'Je', color: 'var(--jdm-token, #f0c86e)' }),
  credits: Object.freeze({ short: 'Cr', color: 'var(--jdm-credit, #8acbff)' }),
});

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Core currency ({ id, label, short_label }) → { tone, short, color }. */
export function currencyUnit(currency) {
  const id = String(currency?.id ?? '');
  const tone = id === 'tokens' ? 'tokens' : id.startsWith('credits') ? 'credits' : null;
  if (tone) return { tone, ...UNITS[tone] };
  return { tone: 'other', short: currency?.short_label || currency?.label || '', color: 'currentColor' };
}

/** Amount with no-break thousands separators (never « 17 » / « 000 » on two lines). */
export const fmtAmount = (n) => Number(n).toLocaleString('fr-FR').replace(/[\u202f\u00a0 ]/g, '\u00a0');

/** The unit alone, in the currency's colour (to follow an amount). */
export function unitHtml(currency) {
  const u = currencyUnit(currency);
  return `<span class="cur-u" data-tone="${u.tone}" style="color:${u.color}">${esc(u.short)}</span>`;
}

/** « 17 000 Cr » as one unbreakable group (`sign` e.g. « + »). */
export function moneyHtml(amount, currency, { sign = '' } = {}) {
  return `<span class="cur-amt">${sign}${fmtAmount(amount)}&nbsp;${unitHtml(currency)}</span>`;
}

/**
 * Every amount group of `root` matching `selector` gets smaller until it fits its box (down to `min`
 * of its size): never a wrap, never out of the card.
 */
export function fitMoney(root, selector, min = 0.6) {
  const win = root.ownerDocument?.defaultView;
  if (!win) return;
  for (const a of root.querySelectorAll(selector)) {
    a.style.fontSize = '';
    const box = a.parentElement?.clientWidth ?? 0;
    if (!box) continue;
    let size = parseFloat(win.getComputedStyle(a).fontSize);
    const floor = size * min;
    while (a.scrollWidth > box && size > floor) {
      size -= 1;
      a.style.fontSize = `${size}px`;
    }
  }
}
