import { beforeAll, describe, expect, it } from 'vitest';

// Votekick V2 overlay model (votekick-overlay/model.js, a classic script): the legacy event contract, late and
// repeated events, session changes, the timer and the verdict screens.

let M;
beforeAll(async () => {
  await import('../votekick-overlay/model.js');
  M = globalThis.VotekickModel;
});

const NOW = 1_000_000;
function run(events, now = NOW) {
  let state = M.createState();
  const effects = [];
  for (const e of events) {
    const out = M.reduce(state, e, now);
    state = out.state;
    effects.push(out.effect);
  }
  return { state, effects };
}
const live = (session, seq, yes, no, extra = {}) => ({
  action: 'live',
  session,
  seq,
  yes,
  no,
  target: '@Viewer2',
  initiator: 'viewer1',
  ends: NOW + 60_000,
  ...extra,
});

describe('votekick overlay model', () => {
  it('a vote opens once, then only its numbers update (nothing restarts)', () => {
    const { state, effects } = run([
      live('s1', 1, 1, 0),
      live('s1', 2, 2, 0),
      live('s1', 3, 2, 1),
    ]);
    expect(effects).toEqual(['open', 'update', 'update']);
    expect(state).toMatchObject({
      phase: 'live',
      target: 'Viewer2',
      kick: 2,
      save: 1,
    });
  });

  it('an older or repeated event of the session is ignored', () => {
    const { state, effects } = run([
      live('s1', 1, 1, 0),
      live('s1', 3, 4, 1),
      live('s1', 2, 2, 0), // late
      live('s1', 3, 4, 1), // repeated
    ]);
    expect(effects).toEqual(['open', 'update', 'ignore', 'ignore']);
    expect(state.kick).toBe(4);
  });

  it('legacy SAMMI events without `seq` still apply in order', () => {
    const { state, effects } = run([
      { action: 'live', session: 'x', yes: 1, no: 0 },
      { action: 'update', session: 'x', yes: 2, no: 0 },
      { action: 'result', session: 'x', outcome: 'no_quorum' },
      { action: 'clear' },
    ]);
    expect(effects).toEqual(['open', 'update', 'result', 'clear']);
    expect(state.phase).toBe('hidden');
  });

  it('after the verdict, a late update of that session never reopens it', () => {
    const { state, effects } = run([
      live('s1', 1, 1, 0),
      {
        action: 'result',
        session: 's1',
        seq: 5,
        outcome: 'target_timeout',
        minutes: 8,
      },
      live('s1', 4, 9, 9),
      { action: 'result', session: 's1', seq: 5, outcome: 'target_timeout' },
    ]);
    expect(effects).toEqual(['open', 'result', 'ignore', 'ignore']);
    expect(state).toMatchObject({ phase: 'result', minutes: 8 });
  });

  it('a new session opens fresh (counts reset); an old verdict never covers it', () => {
    const { state, effects } = run([
      live('s1', 1, 5, 2),
      { action: 'result', session: 's1', seq: 2, outcome: 'target_timeout' },
      live('s2', 1, 1, 0),
      { action: 'result', session: 's0', seq: 9, outcome: 'backfire' },
    ]);
    expect(effects).toEqual(['open', 'result', 'open', 'ignore']);
    expect(state).toMatchObject({
      phase: 'live',
      session: 's2',
      kick: 1,
      save: 0,
    });
  });

  it('a clear when nothing is shown does nothing; numbers are sanitised', () => {
    const { effects } = run([{ action: 'clear' }]);
    expect(effects).toEqual(['ignore']);
    const { state } = run([live('s', 1, '-3', 'abc')]);
    expect(state).toMatchObject({ kick: 0, save: 0 });
  });

  it('timer: seconds rounded up, ring fraction, urgent in the last 10 s', () => {
    expect(M.timer(NOW + 60_000, NOW)).toEqual({
      seconds: 60,
      fraction: 1,
      urgent: false,
      over: false,
    });
    expect(M.timer(NOW + 9_500, NOW)).toMatchObject({
      seconds: 10,
      urgent: true,
    });
    expect(M.timer(NOW - 1, NOW)).toEqual({
      seconds: 0,
      fraction: 0,
      urgent: false,
      over: true,
    });
  });

  it('verdict screens: Perfect, Backfire, coin flips, mute, saved, tie, cancelled', () => {
    const v = (outcome, extra = {}) =>
      M.verdict({
        target: 'cible',
        initiator: 'init',
        kick: 0,
        save: 0,
        minutes: 16,
        muteSeconds: 0,
        outcome,
        ...extra,
      });
    expect(v('target_timeout_perfect')).toMatchObject({
      tone: 'gold',
      stamp: 'Perfect',
      badge: '×2',
      who: '@cible',
    });
    expect(v('backfire')).toMatchObject({
      tone: 'kick',
      who: '@init',
      badge: '×2',
    });
    expect(v('coinflip_target')).toMatchObject({
      fx: 'coin',
      coinSide: 'kick',
      who: '@cible',
    });
    expect(v('coinflip_initiator')).toMatchObject({
      fx: 'coin',
      coinSide: 'save',
      who: '@init',
    });
    expect(v('broadcaster_muted', { muteSeconds: 110 }).detail).toBe(
      'Mute · 1 min 50 s',
    );
    // The broadcaster muted after his own Backfire: named, not the target (legacy page showed the target).
    expect(v('broadcaster_muted', { punished: 'raptoru_' }).who).toBe(
      '@raptoru_',
    );
    expect(v('no_timeout', { kick: 2, save: 5 })).toMatchObject({
      tone: 'save',
      stamp: 'Sauvé',
    });
    expect(v('no_timeout', { kick: 3, save: 3 }).stamp).toBe('Égalité');
    expect(v('no_quorum').stamp).toBe('Annulé');
  });

  it('kick share: 0.5 with no vote', () => {
    expect(M.kickShare(0, 0)).toBe(0.5);
    expect(M.kickShare(3, 1)).toBe(0.75);
  });
});
