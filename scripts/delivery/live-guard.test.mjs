// node --test scripts/delivery/live-guard.test.mjs — the « never during a live » decision.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decide } from './live-guard.mjs';

const s = (name, live) => ({ name, live });

describe('live guard decision', () => {
  it('any source live blocks, whatever the others say (and whatever the arbitration)', () => {
    for (const sources of [
      [s('core-session', true), s('core-helix', false), s('obs', false)],
      [s('core-session', false), s('core-helix', null), s('obs', true)],
    ]) {
      assert.equal(decide(sources).verdict, 'LIVE');
      assert.equal(decide(sources, { allowSingle: true }).ok, false);
    }
  });

  it('two sources definitely offline: offline', () => {
    const d = decide([s('core-session', false), s('core-helix', false)]);
    assert.deepEqual([d.verdict, d.ok], ['OFFLINE', true]);
  });

  it('one offline source and the others unknown: unknown (blocked) unless explicitly accepted', () => {
    const one = [s('core-session', false), s('core-helix', null)];
    assert.deepEqual([decide(one).verdict, decide(one).ok], ['UNKNOWN', false]);
    const accepted = decide(one, { allowSingle: true });
    assert.equal(accepted.ok, true);
    assert.match(accepted.reason, /SEULEMENT/);
  });

  it('nothing known: unknown, even with the arbitration', () => {
    const none = [s('core-session', null), s('core-helix', null)];
    assert.equal(decide(none).ok, false);
    assert.equal(decide(none, { allowSingle: true }).ok, false);
    assert.equal(decide([]).verdict, 'UNKNOWN');
  });
});
