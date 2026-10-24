import { describe, expect, it } from 'vitest';
import {
  createCpTwitchActionsExecutor,
  CP_MANAGE_SCOPE,
} from '../src/cp-twitch-actions-executor.js';
import { HelixError } from '../src/twitch/helix.js';

// Points de chaîne, Twitch side (docs/SPOTIFY_V2.md § 7): each action of the main Core run ONCE — done, failed (Twitch
// refused it, or the right is missing: nothing sent), unknown (no answer / 429 / 5xx); never resent.

const STATUS = {
  kind: 'redemption_status' as const,
  action_id: '00000000-0000-4000-8000-000000000001',
  attempt_id: '00000000-0000-4000-8000-0000000000a1',
  reward_id: 'reward-song',
  redemption_id: 'red-1',
  status: 'CANCELED' as const,
};
const CREATE = {
  kind: 'reward_create' as const,
  action_id: '00000000-0000-4000-8000-000000000002',
  attempt_id: '00000000-0000-4000-8000-0000000000a2',
  reward: {
    title: 'Choisi la prochaine musique !',
    cost: 1000,
    prompt: 'Titre + artiste',
    is_user_input_required: true,
  },
};

function harness(
  action: unknown,
  twitch: { fail?: unknown } = {},
  scopes: string[] | null = [CP_MANAGE_SCOPE],
) {
  const posts: { path: string; body: unknown }[] = [];
  const calls: string[] = [];
  let handed = false;
  const ex = createCpTwitchActionsExecutor({
    core: async (path, body) => {
      posts.push({ path, body });
      if (path.endsWith('/claim')) {
        const a = handed ? null : action;
        handed = true;
        return { status: 200, body: { action: a } };
      }
      return { status: 200, body: {} };
    },
    base: '/v1/bot/channel-points/twitch-actions',
    channelId: '83603689',
    scopes,
    twitch: {
      updateRedemptionStatus: async (reward, redemption, status) => {
        calls.push(`status ${reward} ${redemption} ${status}`);
        if (twitch.fail) throw twitch.fail;
      },
      createCustomReward: async (reward) => {
        calls.push(`create ${reward.title}`);
        if (twitch.fail) throw twitch.fail;
        return 'new-reward-id';
      },
    },
    pause: async () => {},
    log: () => {},
  });
  const reports = () =>
    posts.filter((p) => p.path.endsWith('/report')).map((p) => p.body);
  return { ex, calls, reports };
}

describe('Points de chaîne Twitch actions executor', () => {
  it('a refund applied: one call, reported done; nothing more to claim', async () => {
    const h = harness(STATUS);
    expect(await h.ex.tick()).toBe('worked');
    expect(await h.ex.tick()).toBe('idle');
    expect(h.calls).toEqual(['status reward-song red-1 CANCELED']);
    expect(h.reports()).toEqual([
      { attempt_id: STATUS.attempt_id, outcome: 'done', http_status: 200 },
    ]);
  });

  it("Twitch refuses (400: not this app's reward, already fulfilled…): failed, never resent", async () => {
    const h = harness(STATUS, { fail: new HelixError(400, 'not manageable') });
    await h.ex.tick();
    expect(h.reports()[0]).toMatchObject({
      outcome: 'failed',
      http_status: 400,
    });
    expect(h.calls).toHaveLength(1);
  });

  it('no answer, 429 or 5xx: unknown (it may have applied), never resent', async () => {
    for (const fail of [
      new HelixError(503, 'down'),
      new HelixError(429, 'slow down'),
      new Error('ETIMEDOUT'),
    ]) {
      const h = harness(STATUS, { fail });
      await h.ex.tick();
      expect(h.reports()[0]).toMatchObject({ outcome: 'unknown' });
      expect(h.calls).toHaveLength(1);
    }
  });

  it('the right is missing (or no broadcaster token): failed, nothing sent to Twitch', async () => {
    for (const scopes of [['channel:read:redemptions'], null]) {
      const h = harness(STATUS, {}, scopes);
      await h.ex.tick();
      expect(h.calls).toEqual([]);
      expect(h.reports()[0]).toMatchObject({
        outcome: 'failed',
        error: `missing_scope:${CP_MANAGE_SCOPE}`,
      });
    }
  });

  it("creating Raptoru's reward: its id reported", async () => {
    const h = harness(CREATE);
    await h.ex.tick();
    expect(h.calls).toEqual(['create Choisi la prochaine musique !']);
    expect(h.reports()[0]).toMatchObject({
      outcome: 'done',
      reward_id: 'new-reward-id',
    });
  });
});
