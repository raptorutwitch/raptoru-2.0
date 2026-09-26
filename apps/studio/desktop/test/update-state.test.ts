import { describe, expect, it } from 'vitest';
import {
  initialUpdateState,
  nextUpdateState,
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
    });
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
