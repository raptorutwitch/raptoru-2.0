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

/**
 * THE abbreviated balance of the extension (every module): 6 K \u00b7 125 K \u00b7 1 M \u00b7 6,1 M \u00b7 6,25 M. `digits` significant
 * digits (3 by default, 2 in a fixed 40 px box), French comma, narrow no-break space before the unit. Truncated, never
 * rounded up: a balance is never shown above what the viewer really has. The exact value stays in the title / aria.
 */
export function formatCompactAmount(value, { digits = 3 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '\u2014';
  const amount = Math.max(0, Math.trunc(numeric));
  if (amount < 1_000) return String(amount);
  const [divisor, unit] = amount < 1_000_000 ? [1_000, 'K'] : [1_000_000, 'M'];
  const decimals = Math.max(0, digits - String(Math.trunc(amount / divisor)).length);
  // Integer division, no float truncation (1 230 000 / 1e6 * 100 is 122.99\u2026).
  const scaled = Math.floor(amount / (divisor / 10 ** decimals)) / 10 ** decimals;
  const text = scaled.toLocaleString('fr-FR', { maximumFractionDigits: decimals }).replace(/[\u00a0 ]/g, '\u202f');
  return `${text}\u202f${unit}`;
}

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
