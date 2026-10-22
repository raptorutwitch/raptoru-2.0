// Currencies in compact Extension surfaces (Panel, Mobile, Video): one rule everywhere.
// The amount comes first; the unit follows in the currency's own colour: the Jetons coin (same icon as the
// wallet, named « Jetons » for screen readers and on hover — never the abbreviation « Je »), « Cr » for every
// Crédits; amount + unit stay on one line and shrink a little when the box is too narrow — the number is never cut.

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

// Jetons coin, as in the wallet; sized on the unit's own font size.
const TOKEN_ICON = '<svg viewBox="0 0 24 24" width="1.15em" height="1.15em" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.18em"><circle cx="12" cy="12" r="8"/><path d="M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4M12 7.5v1.5M12 15.5V17"/></svg>';

/** The unit alone, in the currency's colour (to follow an amount). */
export function unitHtml(currency) {
  const u = currencyUnit(currency);
  if (u.tone === 'tokens')
    return `<span class="cur-u" data-tone="tokens" style="color:${u.color}" role="img" aria-label="Jetons" title="Jetons">${TOKEN_ICON}</span>`;
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
