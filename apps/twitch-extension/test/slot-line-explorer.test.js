import { describe, expect, it } from 'vitest';
import { ArcadeSlotsView as View } from '../extension/shared/casino/reels.js';

// Explorer les lignes d'un tour (§ 9 du retour d'Antoni, 21/11/2026, puis mandat du 21/11 E : directement sur les
// symboles des rouleaux) : survol souris, toucher (épinglé), clic ailleurs, alterner entre les lignes d'un même symbole,
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
// The V line pays through [0,0] (shared with « Haut ») and [1,1] (shared with « Milieu »).
const SHARED = [
  ...STEPS,
  {
    kind: 'line',
    line: 2,
    cells: [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    win: 60,
    symbol: 'cerise',
    count: 3,
    wilds: [],
  },
];

function setup({
  unsure = () => false,
  steps = STEPS,
  idle = () => true,
} = {}) {
  let wins = steps;
  let shown = null; // le texte de la pastille montrée, ou null (état du tour)
  const view = {
    el: { reels: true },
    cellAt: (t) => t?.pos ?? null, // a cell on the reels: [reel, visible row]
    wins: () => wins,
    isRunning: () => false,
    exploring: () => shown !== null,
    explore: (path, counted = null, text = '') =>
      (shown = path || counted?.length ? { text, path, counted } : null),
  };
  const chips = [0, 1].map((i) => {
    const attrs = {};
    const cls = new Set();
    const c = {
      dataset: { lstep: String(i) },
      setAttribute: (k, v) => (attrs[k] = v),
      classList: { toggle: (k, on) => (on ? cls.add(k) : cls.delete(k)) },
      lit: () => cls.has('lit'),
      attrs,
    };
    c.closest = (sel) => (sel.includes('lstep') ? c : null);
    c.contains = () => false;
    return c;
  });
  const plate = { querySelectorAll: () => chips };
  const handlers = {};
  const where = (t) =>
    t === plate ? 'plate' : t === view.el ? 'reels' : 'root';
  const on = (target, ev, fn) => (handlers[`${where(target)}:${ev}`] = fn);
  const ex = View.explorer(view, {
    plate,
    root: {},
    on,
    lines: LINES,
    label: (st) => LINES[st.line].name,
    unsure,
    idle,
  });
  let stopped = 0;
  const fire = (key, target, extra = {}) =>
    handlers[key]({
      target,
      stopPropagation: () => (stopped += 1),
      ...extra,
    });
  const outside = { closest: () => null };
  return {
    ex,
    fire,
    chips,
    outside,
    shown: () => shown,
    stopped: () => stopped,
    setWins: (w) => (wins = w),
  };
}
const cell = (r, row) => ({ pos: [r, row], closest: () => null });

describe('ArcadeSlotsView.explorer', () => {
  it('one chip per combination, none for a single combination', () => {
    const { ex } = setup();
    expect(ex.html(STEPS.slice(0, 1))).toBe('');
    const html = ex.html(STEPS);
    expect(html.match(/class="lchip"/g)).toHaveLength(2);
    expect(html).toContain('+1 210');
  });

  it('mouse hover shows a line (only its counted cells, no traced path; name and win); leaving returns to the round', () => {
    const s = setup();
    s.ex.html(STEPS);
    s.fire('plate:pointerover', s.chips[1], { pointerType: 'mouse' });
    expect(s.shown()).toMatchObject({
      text: 'Milieu +1 210',
      path: null,
      counted: STEPS[1].cells,
    });
    expect(s.chips[1].lit()).toBe(true);
    s.fire('plate:pointerout', s.chips[1], {
      pointerType: 'mouse',
      relatedTarget: null,
    });
    expect(s.shown()).toBeNull();
    expect(s.chips[1].lit()).toBe(false);
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

  it('on the reels, mouse: hovering a paying symbol shows its line; a symbol that paid nothing shows nothing', () => {
    const s = setup();
    s.ex.html(STEPS);
    s.fire('reels:pointerover', cell(2, 1), { pointerType: 'mouse' });
    expect(s.shown()).toMatchObject({
      text: 'Milieu +1 210',
      path: null,
      counted: STEPS[1].cells,
    });
    s.fire('reels:pointerout', cell(2, 1), {
      pointerType: 'mouse',
      relatedTarget: cell(3, 1), // (the 4th symbol of that row did not pay)
    });
    expect(s.shown()).toBeNull();
    s.fire('reels:pointerover', cell(3, 1), { pointerType: 'mouse' });
    expect(s.shown()).toBeNull();
  });

  it('on the reels, touch: a tap pins the line; more taps on a shared symbol cycle its lines (n/N); elsewhere clears', () => {
    const s = setup({ steps: SHARED });
    s.ex.html(SHARED);
    s.fire('reels:click', cell(0, 0));
    expect(s.shown().text).toBe('Haut +40 · 1/2');
    s.fire('reels:click', cell(0, 0));
    expect(s.shown()).toMatchObject({
      text: 'V +60 · 2/2',
      counted: SHARED[2].cells,
    });
    s.fire('reels:click', cell(0, 0));
    expect(s.shown().text).toBe('Haut +40 · 1/2');
    expect(s.stopped()).toBe(3); // never « Passer » (a touch on the glass)
    s.fire('reels:click', cell(4, 2)); // paid nothing: back to the round
    expect(s.shown()).toBeNull();
  });

  it('on the reels, mouse: the hover shows the 1st line, a click the next one; one line: a 2nd click releases it', () => {
    const s = setup({ steps: SHARED });
    s.ex.html(SHARED);
    s.fire('reels:pointerover', cell(1, 1), { pointerType: 'mouse' });
    expect(s.shown().text).toBe('Milieu +1 210 · 1/2');
    s.fire('reels:click', cell(1, 1));
    expect(s.shown().text).toBe('V +60 · 2/2');
    // pinned: hovering another symbol changes nothing
    s.fire('reels:pointerover', cell(1, 0), { pointerType: 'mouse' });
    expect(s.shown().text).toBe('V +60 · 2/2');
    const one = setup();
    one.ex.html(STEPS);
    one.fire('reels:pointerover', cell(1, 0), { pointerType: 'mouse' });
    one.fire('reels:click', cell(1, 0));
    expect(one.shown().text).toBe('Haut +40');
    one.fire('reels:click', cell(1, 0));
    expect(one.shown()).toBeNull();
  });

  it('on the reels: nothing while the round is still being played or shown (the glass keeps « Passer »)', () => {
    let busy = true;
    const s = setup({ idle: () => !busy });
    s.ex.html(STEPS);
    s.fire('reels:click', cell(0, 0));
    expect(s.shown()).toBeNull();
    expect(s.stopped()).toBe(0);
    busy = false;
    s.fire('reels:click', cell(0, 0));
    expect(s.shown().text).toBe('Haut +40');
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
