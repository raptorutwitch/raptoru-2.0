// The Halloween rules card (apps/studio/web/src/halloween.ts): what the streamer types becomes what the Core stores.
import { describe, expect, it } from 'vitest';
import { rulesFromInputs } from '../../web/src/halloween.js';

describe('Halloween rules typed in Studio', () => {
  it('seconds and euros are stored in ms and cents; empty Prime / resub = the sub’s amount (null)', () => {
    const r = rulesFromInputs({
      viewer_gap_ms: '2',
      donation_min_cents: '1.5',
      donation_per_euro: '3',
      prime_reward: '',
      resub_reward: '7',
      bits_step: '-5',
      presence_every_min: 'abc',
    });
    expect(r).toMatchObject({
      viewer_gap_ms: 2000,
      donation_min_cents: 150,
      donation_per_euro: 3,
      prime_reward: null,
      resub_reward: 7,
      bits_step: 0,
      presence_every_min: 0,
    });
    expect(r).not.toHaveProperty('conversion_rate');
  });
});
