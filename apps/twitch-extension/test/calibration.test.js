import { describe, expect, it, vi } from 'vitest';
import { createCalibrationSource } from '../calibration/adapter.js';
import { CAPTURED_AT } from '../calibration/fixtures.js';
import { createClient } from '../extension/shared/api.js';

// Calibration build (docs/TWITCH_GEOMETRY_CALIBRATION_2026-10.md): the real client answered by local
// fixtures only — never the network, never an action.
function client(now = Date.now(), clock = () => now) {
  const fetchImpl = vi.fn();
  const api = createClient({
    getToken: () => null,
    apiBase: '',
    demoMode: true,
    fixtureCall: createCalibrationSource(now, clock),
    fetchImpl,
  });
  return { api, fetchImpl };
}

describe('calibration fixtures', () => {
  it('serves the five modules, the moderator view and an open Tombola, without any request', async () => {
    const now = Date.parse(CAPTURED_AT) + 86_400_000;
    let t = now;
    const { api, fetchImpl } = client(now, () => t);
    const session = await api.session();
    expect(session.modules.map((m) => m.id)).toEqual([
      'tts',
      'soundboard',
      'bonk',
      'raffle_join',
    ]);
    expect(session).toMatchObject({
      role: 'moderator',
      moderation_v2: true,
      viewer_login: 'Mod_Test',
    });
    const raffle = (await api.raffleState()).raffle_v2;
    expect(raffle.phase).toBe('open');
    // Dates rebased on the load; the 60 s round loops instead of closing.
    expect(raffle.round.remaining_ms).toBe(60_000);
    t = now + 45_000;
    expect((await api.raffleState()).raffle_v2.round.remaining_ms).toBe(15_000);
    t = now + 75_000;
    const later = (await api.raffleState()).raffle_v2;
    expect(later.phase).toBe('open');
    expect(later.round.remaining_ms).toBe(45_000);
    expect(Date.parse(later.round.closes_at)).toBe(t + 45_000);
    expect(raffle.round.list.map((e) => e.display_name)).toContain('Viewer_A');
    expect((await api.ttsState()).tts_v2.rules.tiers.length).toBeGreaterThan(0);
    expect((await api.modV2('overview')).tts.waiting.length).toBeGreaterThan(0);
    expect((await api.modV2('viewers/1002')).display_name).toBe('Viewer_B');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses every action (payment, Tombola, moderation)', async () => {
    const { api, fetchImpl } = client();
    for (const act of [
      () => api.spendTokens('soundboard', { sound_id: 'son-01' }),
      () => api.joinRaffle(),
      () => api.modV2Act({ action: 'purge', module: 'tts' }),
      () => api.startEmoteOAuth(),
    ])
      await expect(act()).rejects.toMatchObject({ code: 'not_available' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('contains no real name, account or URL', async () => {
    const { FIXTURES } = await import('../calibration/fixtures.js');
    const text = JSON.stringify(FIXTURES);
    expect(text).not.toMatch(/raptoru|https?:\/\/|83603689/i);
  });
});
