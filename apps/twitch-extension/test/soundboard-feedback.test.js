import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_MS,
  createSoundboardFeedback,
} from '../extension/shared/soundboard-feedback.js';

// The Soundboard's feedback after a send, alone (extracted from ui.js): its texts and roles, its own timer, the latest
// outcome wins, leaving clears it. A minimal fake DOM and fake timers.

function fakeDocument() {
  const make = (tag) => {
    const node = {
      tag,
      className: '',
      textContent: '',
      hidden: false,
      attrs: {},
      children: [],
      classList: {
        add: (c) => (node.className = `${node.className} ${c}`.trim()),
      },
      setAttribute: (k, v) => (node.attrs[k] = v),
      append: (...kids) => node.children.push(...kids),
    };
    return node;
  };
  return { createElement: make };
}
const text = (node) =>
  (node.textContent || '') + node.children.map(text).join(' ');

function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => (pending.set(next, { fn, ms }), next++),
    clearTimeout: (id) => pending.delete(id),
    pending,
    fire: () => {
      const all = [...pending.values()];
      pending.clear();
      all.forEach((t) => t.fn());
    },
  };
}

function setup(reason = '') {
  const timers = fakeTimers();
  let removed = 0;
  const root = { querySelector: () => ({ remove: () => removed++ }) };
  const feedback = createSoundboardFeedback({
    document: fakeDocument(),
    root: () => root,
    reasonFor: () => reason,
    timers,
  });
  return { feedback, timers, removed: () => removed };
}

describe('Soundboard feedback', () => {
  it('nothing to say: an empty hidden toast (the slot keeps its place)', () => {
    const { feedback } = setup();
    const toast = feedback.overlay();
    expect(toast.hidden).toBe(true);
    expect(toast.attrs['aria-hidden']).toBe('true');
  });

  it('success: a polite status « Envoyé au stream », removed by itself after its duration', () => {
    const { feedback, timers, removed } = setup();
    feedback.set('success');
    const toast = feedback.overlay();
    expect(toast.attrs.role).toBe('status');
    expect(toast.attrs['aria-live']).toBe('polite');
    expect(text(toast)).toContain('Envoyé au stream');
    expect([...timers.pending.values()][0].ms).toBe(FEEDBACK_MS.success);
    timers.fire();
    expect(removed()).toBe(1);
    expect(feedback.overlay().hidden).toBe(true);
  });

  it('refusal: an assertive alert « Non envoyé », with the reason only when one is known (and longer then)', () => {
    const known = setup('Solde insuffisant');
    known.feedback.set('error', { code: 'insufficient_balance' });
    const toast = known.feedback.overlay();
    expect(toast.attrs.role).toBe('alert');
    expect(toast.attrs['aria-live']).toBe('assertive');
    expect(text(toast)).toContain('Non envoyé');
    expect(text(toast)).toContain('Solde insuffisant');
    expect([...known.timers.pending.values()][0].ms).toBe(
      FEEDBACK_MS.errorWithReason,
    );
    const unknown = setup('');
    unknown.feedback.set('error', new Error('TypeError: x is undefined'));
    expect(text(unknown.feedback.overlay())).not.toContain('TypeError');
    expect([...unknown.timers.pending.values()][0].ms).toBe(FEEDBACK_MS.error);
  });

  it('the latest outcome wins (one timer at a time); leaving the module clears it', () => {
    const { feedback, timers } = setup();
    feedback.set('error', {});
    feedback.set('success');
    expect(timers.pending.size).toBe(1);
    expect(text(feedback.overlay())).toContain('Envoyé au stream');
    feedback.clear();
    expect(timers.pending.size).toBe(0);
    expect(feedback.overlay().hidden).toBe(true);
  });
});
