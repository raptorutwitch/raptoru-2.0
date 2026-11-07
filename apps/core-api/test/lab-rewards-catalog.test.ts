import { CpRewardsSync, CpRuleInput } from '@raptoru/schemas';
import { describe, expect, it } from 'vitest';
import { channelPointsRoutes } from '../src/http/channel-points-routes.js';
import { LAB_REWARDS, loadLabRewards } from '../src/lab/rewards-catalog.js';
import { CpError } from '../src/channel-points/service.js';

const has = (routes: { pattern: RegExp }[], path: string) =>
  routes.some((r) => r.pattern.test(path));

describe('Lab rewards catalogue', () => {
  it('obeys the real contracts of the list and of the rules', () => {
    const rewards = LAB_REWARDS.map(({ actions, ...r }) => r);
    expect(() =>
      CpRewardsSync.parse({ channel_id: '900100', rewards }),
    ).not.toThrow();
    for (const r of LAB_REWARDS) {
      expect(r.id.startsWith('lab-')).toBe(true);
      expect(() =>
        CpRuleInput.parse({ enabled: true, actions: r.actions }),
      ).not.toThrow();
    }
  });

  it('keeps a rule that already exists', async () => {
    const synced: unknown[] = [];
    const saved: string[] = [];
    const cp = {
      syncRewards: async (s: unknown) => synced.push(s),
      saveRule: async (_: string, id: string) => {
        if (id === 'lab-creepy') throw new CpError(409, 'version_conflict');
        saved.push(id);
      },
    };
    const out = await loadLabRewards(cp as never, '900100');
    expect(synced).toHaveLength(1);
    expect(saved).not.toContain('lab-creepy');
    expect(out).toEqual({
      rewards: LAB_REWARDS.length,
      rules: LAB_REWARDS.length - 1,
    });
  });

  it('exists only on the Lab Core', () => {
    const cp = {} as never;
    expect(
      has(
        channelPointsRoutes(cp, { channelId: '900100' }),
        '/v1/studio/channel-points/900100/lab-catalog',
      ),
    ).toBe(false);
    expect(
      has(channelPointsRoutes(cp), '/v1/lab/channel-points/900100/lab-catalog'),
    ).toBe(true);
  });
});
