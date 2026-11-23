import { afterEach, describe, expect, it } from 'vitest';
import {
  __diag,
  diagMark,
  scrub,
  startDiagnostic,
} from '../extension/shared/diagnostic.js';

// Mobile diagnostic (audit 23/11): inert without the package flag; with it, records errors and rejected promises.
function fakeWindow() {
  const listeners = {};
  const doc = {
    listeners: {},
    addEventListener(t, fn) {
      this.listeners[t] = fn;
    },
    body: null,
  };
  return {
    listeners,
    document: doc,
    innerWidth: 393,
    innerHeight: 484,
    addEventListener(t, fn) {
      listeners[t] = fn;
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
}

afterEach(() => __diag.reset());

describe('mobile diagnostic', () => {
  it('does nothing without the package flag (ordinary viewers)', () => {
    const win = {
      document: {},
      addEventListener() {
        throw new Error('must not listen');
      },
    };
    expect(startDiagnostic({ buildId: 'production-x' }, win)).toBe(false);
    expect(startDiagnostic({ diagnostics: 'yes' }, win)).toBe(false);
    diagMark('casino', 'slot : chargement');
    expect(__diag.journal).toHaveLength(0);
  });

  it('with the flag: errors, rejected promises and casino steps are recorded', () => {
    const win = fakeWindow();
    expect(
      startDiagnostic(
        { diagnostics: true, buildId: 'production-abc-diag' },
        win,
      ),
    ).toBe(true);
    win.listeners.error({
      target: win,
      message: 'TypeError: x is undefined',
      filename:
        'https://abc.ext-twitch.tv/abc/1.0/hash/shared/casino/slot.js?x=1',
      lineno: 90,
      colno: 3,
    });
    win.listeners.unhandledrejection({
      reason: Object.assign(new Error('boom'), { name: 'TypeError' }),
    });
    diagMark('casino', 'slot : monté');
    const text = __diag.journal.map((j) => `${j.kind} ${j.text}`).join('\n');
    expect(text).toMatch(
      /erreur TypeError: x is undefined @ https:\/\/…\/abc\/1\.0\/hash\/shared\/casino\/slot\.js:90:3/,
    );
    expect(text).toMatch(/promesse TypeError: boom/);
    expect(text).toMatch(/étape casino · slot : monté/);
    expect(text).not.toContain('?x=1');
  });

  it('never shows a token, an opaque id or URL parameters', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiNDIifQ.c2lnbmF0dXJl';
    expect(scrub(`Bearer ${jwt}`)).toBe('Bearer [jeton masqué]');
    expect(scrub('id 0123456789abcdef0123456789abcdef01')).toBe('id [masqué]');
    expect(
      scrub('https://core.raptoru.fr/v1/ext/casino/state?token=abc#x'),
    ).toBe('https://…/v1/ext/casino/state');
  });
});
