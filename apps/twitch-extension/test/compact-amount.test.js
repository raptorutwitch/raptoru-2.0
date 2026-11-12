import { describe, expect, it } from 'vitest';
import { formatCompactAmount } from '../extension/shared/currency.js';
import {
  formatCompactBalance,
  formatWalletValue,
} from '../extension/shared/ui-primitives.js';

const N = ' '; // narrow no-break space (unit and thousands)

describe('abbreviated balances (12/11 report: « 6000 K » instead of « 6 M »)', () => {
  it('the examples asked for', () => {
    expect(formatCompactAmount(6_000)).toBe(`6${N}K`);
    expect(formatCompactAmount(125_000)).toBe(`125${N}K`);
    expect(formatCompactAmount(1_000_000)).toBe(`1${N}M`);
    expect(formatCompactAmount(6_000_000)).toBe(`6${N}M`);
    expect(formatCompactAmount(6_100_000)).toBe(`6,1${N}M`);
    expect(formatCompactAmount(6_250_000)).toBe(`6,25${N}M`);
  });

  it('truncated, never above the real balance', () => {
    expect(formatCompactAmount(999)).toBe('999');
    expect(formatCompactAmount(1_999)).toBe(`1,99${N}K`);
    expect(formatCompactAmount(999_999)).toBe(`999${N}K`);
    expect(formatCompactAmount(1_230_000)).toBe(`1,23${N}M`); // float trap: 1.23 * 100 = 122.99…
    expect(formatCompactAmount(12_345_678)).toBe(`12,3${N}M`);
    expect(formatCompactAmount(1_234_567_890)).toBe(`1${N}234${N}M`);
  });

  it('the fixed 40 px box keeps 2 digits; the wallet face 3', () => {
    expect(formatCompactBalance(6_250_000)).toBe(`6,2${N}M`);
    expect(formatCompactBalance(985_400)).toBe(`985${N}K`);
    expect(formatCompactBalance(1_250)).toBe(`1,2${N}K`);
    expect(formatWalletValue(6_250_000)).toBe(`6,25${N}M`);
  });

  it('unknown / negative values', () => {
    expect(formatCompactAmount(null)).toBe('0');
    expect(formatCompactAmount(undefined)).toBe('—');
    expect(formatCompactAmount('x')).toBe('—');
    expect(formatCompactAmount(-5)).toBe('0');
  });
});

describe('header balance: a gain between two reads is shown (« +40 »)', () => {
  function fakeDocument() {
    const make = (tag) => {
      const n = {
        tag,
        children: [],
        parent: null,
        className: '',
        textContent: '',
        dataset: {},
        attrs: {},
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute: (k, v) => (n.attrs[k] = v),
        addEventListener() {},
        append: (...c) =>
          c.forEach((x) => {
            if (typeof x === 'object') {
              x.parent = n;
              n.children.push(x);
            }
          }),
        replaceChildren: () => (n.children = []),
        remove: () => {
          if (n.parent)
            n.parent.children = n.parent.children.filter((x) => x !== n);
        },
        querySelector: (sel) =>
          n.children.find((x) => `.${x.className}` === sel) ?? null,
      };
      return n;
    };
    return { createElement: make };
  }
  const gainOf = (sw) =>
    sw.root.querySelector('.rl-cswitch__gain')?.textContent ?? null;

  it('first read: nothing; a gain: +N exact under 1 000; a spend: nothing', async () => {
    const { createCurrencySwitch, resetShownBalances } =
      await import('../extension/shared/ui-primitives.js');
    resetShownBalances();
    const document = fakeDocument();
    const header = () => createCurrencySwitch({ document, variant: 'balance' });
    const a = header();
    a.sync({ method: 'tokens', amounts: { tokens: 125_000 } });
    expect(gainOf(a)).toBeNull();
    const b = header(); // the header is rebuilt at each redraw
    b.sync({ method: 'tokens', amounts: { tokens: 125_040 } });
    expect(gainOf(b)).toBe('+40');
    const c = header();
    c.sync({ method: 'tokens', amounts: { tokens: 100_040 } });
    expect(gainOf(c)).toBeNull();
    const d = header();
    d.sync({ method: 'tokens', amounts: { tokens: 6_100_040 } });
    expect(gainOf(d)).toBe(`+6${N}M`);
    const label = createCurrencySwitch({ document, variant: 'label' }); // payment switch: never
    label.sync({ method: 'tokens', amounts: { tokens: 9_000_000 } });
    expect(gainOf(label)).toBeNull();
  });
});
