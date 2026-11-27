import { describe, expect, it } from 'vitest';
import {
  initialUpdateState,
  nextUpdateState,
  notesText,
  shouldAutoCheck,
  updateBlockReason,
  type UpdateState,
} from '../src/update-state.js';

const apply = (
  state: UpdateState,
  events: Parameters<typeof nextUpdateState>[1][],
) => events.reduce(nextUpdateState, state);

describe('update-state', () => {
  it('starts idle at the current version', () => {
    expect(initialUpdateState('1.2.3')).toEqual({
      status: 'idle',
      currentVersion: '1.2.3',
      latestVersion: null,
      percent: null,
      message: null,
      notes: null,
    });
  });

  it('notes: the GitHub release body (HTML) becomes short plain text, changes only, never markup', () => {
    const html =
      '<p>Raptoru Studio 0.1.46 (source abc).</p><p>Changements Studio depuis la release précédente :</p><ul>' +
      '<li>feat(studio): Casino « Dernières parties » grouped by player &amp; history</li>' +
      '<li>fix(chaos): an unconfirmed end is a breakdown</li>' +
      '<li>merge: feat/x into main</li><li>test(chaos): end to end</li>' +
      '<li>feat(ext): <img src=x onerror=alert(1)>Tombola bubble</li></ul>';
    expect(notesText(html)).toBe(
      [
        '• Casino « Dernières parties » grouped by player & history',
        '• An unconfirmed end is a breakdown',
        '• Tombola bubble',
      ].join('\n'),
    );
    expect(notesText('Changements :\n- fix(a): one\n- feat: two', 1)).toBe(
      '• One\n… et 1 autre(s)',
    );
    expect(notesText([{ note: '- feat(x): arr' }])).toBe('• Arr');
    expect(notesText('Mise à jour Raptoru Studio.')).toBeNull();
    expect(notesText(null)).toBeNull();
  });

  it('available carries the notes; downloaded keeps them; the periodic check leaves an offered version alone', () => {
    const offered = apply(initialUpdateState('1.2.3'), [
      { type: 'checking' },
      { type: 'available', version: '1.3.0', notes: '• A' },
    ]);
    expect(offered.notes).toBe('• A');
    expect(shouldAutoCheck(offered)).toBe(false);
    const ready = apply(offered, [
      { type: 'progress', percent: 50 },
      { type: 'downloaded', version: '1.3.0' },
    ]);
    expect(ready.notes).toBe('• A');
    expect(shouldAutoCheck(ready)).toBe(false);
    expect(
      shouldAutoCheck(
        apply(ready, [{ type: 'checking' }, { type: 'not-available' }]),
      ),
    ).toBe(true);
    expect(shouldAutoCheck(initialUpdateState('1.2.3'))).toBe(true);
    expect(
      shouldAutoCheck(apply(ready, [{ type: 'error', message: 'x' }])),
    ).toBe(true);
  });

  it('checking then not-available: no version, no message', () => {
    const state = apply(initialUpdateState('1.2.3'), [
      { type: 'checking' },
      { type: 'not-available' },
    ]);
    expect(state).toMatchObject({
      status: 'not-available',
      latestVersion: null,
      percent: null,
    });
  });

  it('checking then available keeps the current version and adds the latest one', () => {
    const state = apply(initialUpdateState('1.2.3'), [
      { type: 'checking' },
      { type: 'available', version: '1.3.0' },
    ]);
    expect(state).toEqual({
      status: 'available',
      currentVersion: '1.2.3',
      latestVersion: '1.3.0',
      percent: null,
      message: null,
      notes: null,
    });
  });

  it('the full happy path: available -> progress ticks -> downloaded', () => {
    const state = apply(initialUpdateState('1.2.3'), [
      { type: 'available', version: '1.3.0' },
      { type: 'progress', percent: 0 },
      { type: 'progress', percent: 42 },
      { type: 'progress', percent: 100 },
      { type: 'downloaded', version: '1.3.0' },
    ]);
    expect(state).toEqual({
      status: 'downloaded',
      currentVersion: '1.2.3',
      latestVersion: '1.3.0',
      percent: 100,
      message: null,
      notes: null,
    });
  });

  it('an error clears no other field and carries its message', () => {
    const mid = apply(initialUpdateState('1.2.3'), [
      { type: 'available', version: '1.3.0' },
      { type: 'progress', percent: 50 },
    ]);
    const state = nextUpdateState(mid, {
      type: 'error',
      message: 'ECONNREFUSED',
    });
    expect(state).toEqual({
      status: 'error',
      currentVersion: '1.2.3',
      latestVersion: '1.3.0',
      percent: 50,
      message: 'ECONNREFUSED',
      notes: null,
    });
  });

  it('unsupported (dev build) carries an explanatory message', () => {
    const state = nextUpdateState(initialUpdateState('1.2.3'), {
      type: 'unsupported',
      message: 'dev build',
    });
    expect(state).toMatchObject({
      status: 'unsupported',
      message: 'dev build',
    });
  });

  it('a new check from a stale error/downloaded state resets message and percent', () => {
    const stale = apply(initialUpdateState('1.2.3'), [
      { type: 'available', version: '1.3.0' },
      { type: 'progress', percent: 77 },
      { type: 'error', message: 'boom' },
    ]);
    const state = nextUpdateState(stale, { type: 'checking' });
    expect(state.status).toBe('checking');
    expect(state.message).toBeNull();
  });
});

describe('updateBlockReason (local test builds, 23/10)', () => {
  it('official versions check GitHub as before', () => {
    expect(updateBlockReason('0.1.7', true)).toBeNull();
    expect(updateBlockReason('0.2.10', true)).toBeNull();
  });
  it('a test build (prerelease) never checks: explicit message, no GitHub error', () => {
    expect(updateBlockReason('0.1.7-sup.2', true)).toContain(
      'Version de test 0.1.7-sup.2',
    );
  });
  it('development run: unchanged message', () => {
    expect(updateBlockReason('0.1.6', false)).toContain('non packagée');
  });
});
