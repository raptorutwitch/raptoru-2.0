import { describe, expect, it } from 'vitest';
import { inFilter, pageStates } from '../../web/src/module-states.ts';
import type { Check } from '../../web/src/readiness.ts';

const check = (id: string, level: Check['level'], state: string): Check => ({
  id,
  label: id,
  level,
  state,
  why: '',
  consequence: null,
  fix: null,
});
const host = (id: string, intention: 'on' | 'off', observed: string) => ({
  id,
  status: { intention, observed, summary: '' },
});

describe('the state of a module page', () => {
  it('comes from the readiness check, or from the Core for a host module', () => {
    const s = pageStates(
      [check('tts', 'error', 'Lecteur absent'), check('cp', 'off', 'Coupés')],
      [
        host('random_ban', 'on', 'waiting'),
        host('coffre_mystere', 'off', 'ready'),
      ],
    );
    expect(s.get('tts')).toEqual({ level: 'error', text: 'Lecteur absent' });
    expect(s.get('channel-points')?.level).toBe('off');
    expect(s.get('random-ban')?.level).toBe('warn');
    // OFF on purpose is never read as ready, whatever the module observes.
    expect(s.get('coffre-mystere')).toEqual({ level: 'off', text: 'Fermé' });
  });

  it('a module nothing reads has no state: never an invented one', () => {
    expect(pageStates([], null).get('tombola')).toBeUndefined();
    expect(inFilter(undefined, 'all')).toBe(true);
    expect(inFilter(undefined, 'attention')).toBe(false);
  });

  it('filters', () => {
    expect(inFilter({ level: 'error', text: '' }, 'attention')).toBe(true);
    expect(inFilter({ level: 'unknown', text: '' }, 'attention')).toBe(true);
    expect(inFilter({ level: 'ok', text: '' }, 'on')).toBe(true);
    expect(inFilter({ level: 'off', text: '' }, 'off')).toBe(true);
    expect(inFilter({ level: 'off', text: '' }, 'on')).toBe(false);
  });
});
