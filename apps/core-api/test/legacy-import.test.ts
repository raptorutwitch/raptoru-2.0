import { describe, expect, it } from 'vitest';
import {
  applyLegacyImport,
  buildLegacyImport,
} from '../src/daily/legacy-import.js';
import { claimAt, count, goLive, paris, setup, viewer } from './helpers.js';

describe('legacy history import', () => {
  const players = [
    {
      twitch_user_id: '111',
      login: 'wenuyr',
      display_name: 'Wenuyr',
      total_daily: 59,
      current_streak: 27,
      best_streak: 34,
      last_daily_stream: '2026-08-09_16h30',
    },
    {
      twitch_user_id: '222',
      login: 'wordsonly',
      display_name: 'WordsOnly',
      total_daily: 0,
      current_streak: 0,
      best_streak: 0,
      last_daily_stream: null,
    },
  ];
  const at = (iso: string) => new Date(iso);
  const events = [
    {
      id: 1,
      twitch_user_id: '__daily_stream__',
      pseudo: '__stream_marker__',
      stream_id: '2026-08-08_16h30',
      streak_at_time: 0,
      total_at_time: 0,
      reward_at_time: 0,
      created_at: at('2026-08-08T18:00:00Z'),
    },
    {
      id: 2,
      twitch_user_id: '111',
      pseudo: 'Wenuyr',
      stream_id: '2026-08-08_16h30#317',
      streak_at_time: 26,
      total_at_time: 58,
      reward_at_time: 2000,
      created_at: at('2026-08-08T18:05:00Z'),
    },
    {
      id: 3,
      twitch_user_id: '__daily_stream__',
      pseudo: '__stream_marker__',
      stream_id: '2026-08-09_16h30',
      streak_at_time: 0,
      total_at_time: 0,
      reward_at_time: 0,
      created_at: at('2026-08-09T18:00:00Z'),
    },
    {
      id: 4,
      twitch_user_id: '111',
      pseudo: 'Wenuyr',
      stream_id: '2026-08-09_16h30',
      streak_at_time: 27,
      total_at_time: 59,
      reward_at_time: 2000,
      created_at: at('2026-08-09T18:05:00Z'),
    },
    {
      id: 5,
      twitch_user_id: '111',
      pseudo: 'Wenuyr',
      stream_id: 'v2|2026-08-09T18:00:00Z|318|2026-08-09_16h30',
      streak_at_time: 28,
      total_at_time: 60,
      reward_at_time: 2000,
      created_at: at('2026-08-09T19:00:00Z'),
    },
    {
      id: 6,
      twitch_user_id: '333',
      pseudo: 'Ghost',
      stream_id: '2026-08-09_16h30',
      streak_at_time: 1,
      total_at_time: 1,
      reward_at_time: 500,
      created_at: at('2026-08-09T18:10:00Z'),
    },
    {
      id: 7,
      twitch_user_id: 'abc',
      pseudo: 'Broken',
      stream_id: '2026-08-09_16h30',
      streak_at_time: 1,
      total_at_time: 1,
      reward_at_time: 500,
      created_at: null,
    },
    {
      id: 8,
      twitch_user_id: '111',
      pseudo: 'Wenuyr',
      stream_id: 'garbage',
      streak_at_time: 1,
      total_at_time: 1,
      reward_at_time: 0,
      created_at: null,
    },
  ];

  it('normalises the three legacy key formats, dedupes and reports anomalies', () => {
    const plan = buildLegacyImport(players, events);
    expect(plan.streamDays.map((d) => d.day)).toEqual([
      '2026-08-08',
      '2026-08-09',
    ]);
    expect(
      plan.claims.map((c) => [c.twitchUserId, c.streamDay, c.streakAfter]),
    ).toEqual([
      ['111', '2026-08-08', 26],
      ['111', '2026-08-09', 27],
      ['333', '2026-08-09', 1],
    ]);
    expect(plan.stats).toContainEqual({
      twitchUserId: '111',
      totalDaily: 59,
      currentStreak: 27,
      bestStreak: 34,
      lastClaimDay: '2026-08-09',
    });
    expect(plan.stats.find((s) => s.twitchUserId === '222')).toBeUndefined();
    expect(plan.warnings).toHaveLength(4); // duplicate, orphan viewer, non-numeric id, garbage key
  });

  it('is idempotent and Core continues the imported streak', async () => {
    const core = await setup();
    const plan = buildLegacyImport(players, events);
    await core.db.tx((q) => applyLegacyImport(q, plan));
    await core.db.tx((q) => applyLegacyImport(q, plan));
    expect(await count(core.db, 'daily_claims')).toBe(3);
    expect(await count(core.db, 'daily_stats')).toBe(2);

    // Next real stream after the import: Wenuyr's streak 27 continues.
    await goLive(core, 's1', paris('2026-09-24', 20));
    const res = await claimAt(
      core,
      viewer('111', 'Wenuyr'),
      paris('2026-09-24', 21),
    );
    expect(res.status).toMatchObject({
      currentStreak: 28,
      totalDaily: 60,
      bestStreak: 34,
    });
    expect(res.reward).toBe(2000);
    expect((await core.daily.history('111')).map((h) => h.source)).toEqual([
      'chat',
      'import',
      'import',
    ]);
  });
});
