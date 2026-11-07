import { describe, expect, it } from 'vitest';
import { labCoreChoice } from '../src/runtime/main-lab-core.ts';

describe('the Core the Lab runs on', () => {
  it('is the main Core by default', () => {
    expect(labCoreChoice({})).toBe('main');
  });
  it('keeps a way back to the historical Lab, and an installer (no apps/core-api) stays on it', () => {
    expect(labCoreChoice({ STUDIO_LAB_CORE: 'legacy' })).toBe('legacy');
    expect(labCoreChoice({ RAPTORU_PACKAGED: '1' })).toBe('legacy');
  });
});
