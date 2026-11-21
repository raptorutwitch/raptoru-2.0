import { describe, expect, it } from 'vitest';
import { ArcadeSlotsView as View } from '../extension/shared/casino/reels.js';

// Explorer les lignes d'un tour (§ 9 du retour d'Antoni, 21/11/2026) : survol souris, toucher (épinglé), clic ailleurs,
// table des gains. La vue et le DOM sont simulés : seule la logique de l'explorateur est vérifiée ici (le rendu réel est
// vérifié dans le banc, cadre réel de l'extension).

const LINES = [
  { name: 'Haut', rows: [0, 0, 0, 0, 0] },
  { name: 'Milieu', rows: [1, 1, 1, 1, 1] },
  { name: 'V', rows: [0, 1, 2, 1, 0] },
];
const STEPS = [
  {
    kind: 'line',
    line: 0,
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    win: 40,
    symbol: 'cerise',
    count: 3,
    wilds: [],
  },
  {
    kind: 'line',
    line: 1,
    cells: [
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    win: 1210,
    symbol: 'sept',
    count: 3,
    wilds: [],
  },
];

function setup({ unsure = () => false } = {}) {
  let wins = STEPS;
  let shown = null; // le texte de la pastille montrée, ou null (état du tour)
  const view = {
    wins: () => wins,
    isRunning: () => false,
    exploring: () => shown !== null,
    explore: (path, counted = null, text = '') =>
      (shown = path || counted?.length ? { text, path, counted } : null),
  };
  const chips = [0, 1].map((i) => {
    const attrs = {};
    const c = {
      dataset: { lstep: String(i) },
      setAttribute: (k, v) => (attrs[k] = v),
      attrs,
    };
    c.closest = (sel) => (sel.includes('lstep') ? c : null);
    c.contains = () => false;
    return c;
  });
  const plate = { querySelectorAll: () => chips };
  const handlers = {};
  const on = (target, ev, fn) =>
    (handlers[`${target === plate ? 'plate' : 'root'}:${ev}`] = fn);
  const ex = View.explorer(view, {
    plate,
    root: {},
    on,
    lines: LINES,
    label: (st) => LINES[st.line].name,
    unsure,
  });
  const fire = (key, target, extra = {}) =>
    handlers[key]({ target, stopPropagation() {}, ...extra });
  const outside = { closest: () => null };
  return {
    ex,
    fire,
    chips,
    outside,
    shown: () => shown,
    setWins: (w) => (wins = w),
  };
}

describe('ArcadeSlotsView.explorer', () => {
  it('one chip per combination, none for a single combination', () => {
    const { ex } = setup();
    expect(ex.html(STEPS.slice(0, 1))).toBe('');
    const html = ex.html(STEPS);
    expect(html.match(/class="lchip"/g)).toHaveLength(2);
    expect(html).toContain('+1 210');
  });

  it('mouse hover shows a line (its path, counted cells, name and win); leaving returns to the round', () => {
    const s = setup();
    s.ex.html(STEPS);
    s.fire('plate:pointerover', s.chips[1], { pointerType: 'mouse' });
    expect(s.shown()).toMatchObject({
      text: 'Milieu +1 210',
      path: [
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 1],
        [4, 1],
      ],
      counted: STEPS[1].cells,
    });
    s.fire('plate:pointerout', s.chips[1], {
      pointerType: 'mouse',
      relatedTarget: null,
    });
    expect(s.shown()).toBeNull();
  });

  it('touch: a tap pins (aria-pressed), a hover elsewhere comes back to it, a tap outside clears', () => {
    const s = setup();
    s.ex.html(STEPS);
    s.fire('plate:pointerover', s.chips[0], { pointerType: 'touch' }); // (a touch never "hovers")
    expect(s.shown()).toBeNull();
    s.fire('plate:click', s.chips[0]);
    expect(s.shown().text).toBe('Haut +40');
    expect(s.chips[0].attrs['aria-pressed']).toBe('true');
    s.fire('plate:pointerover', s.chips[1], { pointerType: 'mouse' });
    expect(s.shown().text).toBe('Milieu +1 210');
    s.fire('plate:pointerout', s.chips[1], {
      pointerType: 'mouse',
      relatedTarget: null,
    });
    expect(s.shown().text).toBe('Haut +40');
    s.fire('root:click', s.outside);
    expect(s.shown()).toBeNull();
    expect(s.chips[0].attrs['aria-pressed']).toBe('false');
  });

  it('a second tap on the same chip unpins it', () => {
    const s = setup();
    s.ex.html(STEPS);
    s.fire('plate:click', s.chips[1]);
    s.fire('plate:click', s.chips[1]);
    expect(s.shown()).toBeNull();
    expect(s.chips[1].attrs['aria-pressed']).toBe('false');
  });

  it('chips of a round no longer on the reels do nothing', () => {
    const s = setup();
    s.ex.html(STEPS);
    s.setWins([...STEPS]);
    s.fire('plate:focusin', s.chips[0]);
    expect(s.shown()).toBeNull();
  });

  it('paytable probe: a line that paid shows its win; one that did not says so only when certain', () => {
    const s = setup();
    s.ex.probe(1);
    expect(s.shown().text).toBe('Milieu +1 210');
    s.ex.probe(2);
    expect(s.shown()).toMatchObject({
      text: 'V · rien ce tour',
      counted: null,
    });
    const free = setup({ unsure: () => true });
    free.ex.probe(2);
    expect(free.shown().text).toBe('V');
    const rest = setup();
    rest.setWins(null); // reels at rest, no round marked
    rest.ex.probe(2);
    expect(rest.shown().text).toBe('V');
  });
});
