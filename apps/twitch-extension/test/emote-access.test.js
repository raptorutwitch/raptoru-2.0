import { describe, expect, it } from 'vitest';
import {
  createEmoteAccess,
  EMOTE_RETRY_AFTER_ERROR_MS,
} from '../extension/shared/emote-access.js';

// 23/11: a failed catalog read redrew Bonk, whose draw (ensure) retried at once — a request loop as fast as the network
// (found when the mobile bench froze on Bonk: its local Core answers the catalog with an immediate refusal).
describe('the emote catalog after a failure', () => {
  const flush = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };
  function setup(emotes) {
    const state = { twitch_user_id: '42', emotes: { connected: true } };
    let access = null;
    access = createEmoteAccess({
      document: null,
      window: { addEventListener() {}, removeEventListener() {} },
      client: { emotes },
      getState: () => state,
      applyState: () => {},
      redraw: () => access.ensure(), // what Bonk does: each draw ensures the catalog
      refreshHost: async () => {},
      following: () => false,
    });
    return access;
  }

  it('drawing Bonk again does not retry at once (no request loop)', async () => {
    let calls = 0;
    const access = setup(async () => {
      calls += 1;
      throw Object.assign(new Error('not_available'), {
        code: 'not_available',
      });
    });
    access.ensure();
    await flush();
    expect(calls).toBe(1);
    expect(access.error).toMatch(/Impossible/);
    access.ensure();
    await flush();
    expect(calls).toBe(1);
    expect(EMOTE_RETRY_AFTER_ERROR_MS).toBeGreaterThanOrEqual(10_000);
  });

  it('an explicit reload still asks again', async () => {
    let calls = 0;
    const access = setup(async () => {
      calls += 1;
      throw new Error('down');
    });
    access.ensure();
    await flush();
    await access.load({ force: true });
    await flush();
    expect(calls).toBe(2);
  });
});
