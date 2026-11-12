import { describe, expect, it } from 'vitest';
import {
  installDblclickGuard,
  isGuardedTarget,
  onGuardedDblclick,
} from '../extension/shared/dblclick-guard.js';

// Double-clic → plein écran (AUDIT § 9): the Twitch helper listens to `dblclick` bubbling on `document`. The guard on
// <html> stops it for OUR controls only — an empty area keeps the full screen the viewer may want.

/** A tiny element: `closest` by tag / role / data attribute, a parent chain (enough for the guard). */
function el(tag, attrs = {}, parent = null) {
  const node = {
    tagName: tag.toUpperCase(),
    attrs,
    parent,
    closest(selector) {
      for (let n = node; n; n = n.parent)
        if (
          selector.split(',').some((raw) => {
            const s = raw.trim();
            const attr = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(s);
            if (attr)
              return (
                attr[1] in n.attrs &&
                (attr[2] === undefined || n.attrs[attr[1]] === attr[2])
              );
            const withHref = /^([a-z]+)\[href\]$/.exec(s);
            if (withHref)
              return (
                n.tagName === withHref[1].toUpperCase() && 'href' in n.attrs
              );
            return n.tagName === s.toUpperCase();
          })
        )
          return n;
      return null;
    },
  };
  return node;
}
const event = (target) => {
  const e = { target, stopped: false, prevented: false };
  e.stopPropagation = () => (e.stopped = true);
  e.preventDefault = () => (e.prevented = true);
  return e;
};

describe('double-click guard', () => {
  const body = el('body');
  const panel = el('div', { class: 'panel' }, body);

  it('a button, an icon inside a button, a role="button" tile: stopped (never reaches the Twitch helper)', () => {
    const button = el('button', {}, panel);
    const icon = el('span', {}, button);
    const tile = el('div', { role: 'button' }, panel);
    for (const t of [button, icon, tile]) {
      const e = event(t);
      onGuardedDblclick(e);
      expect(e.stopped && e.prevented, t.tagName).toBe(true);
    }
  });

  it('an empty area, a text: untouched (the full screen stays possible)', () => {
    for (const t of [body, panel, el('p', {}, panel)]) {
      const e = event(t);
      onGuardedDblclick(e);
      expect(e.stopped || e.prevented).toBe(false);
    }
  });

  it('a link without href is not a control; an opt-in zone is', () => {
    expect(isGuardedTarget(el('a', {}, panel))).toBe(false);
    expect(isGuardedTarget(el('a', { href: '#' }, panel))).toBe(true);
    expect(
      isGuardedTarget(el('div', { 'data-guard-dblclick': '' }, panel)),
    ).toBe(true);
  });

  it('installed once per surface, on <html>, in the bubbling phase (below document)', () => {
    const calls = [];
    const root = {
      dataset: {},
      addEventListener: (type, fn, opts) => calls.push({ type, fn, opts }),
    };
    const doc = { documentElement: root };
    installDblclickGuard(doc);
    installDblclickGuard(doc);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: 'dblclick', fn: onGuardedDblclick });
    expect(calls[0].opts).toBeUndefined(); // not capture: the inner handlers (Bonk) still run first
  });
});
