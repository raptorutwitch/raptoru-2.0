import {
  DEFAULT_PROGRESSION_RULES,
  type LabChatMessage,
} from '@raptoru/schemas';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/db.js';
import { progressionRoutes } from '../src/http/progression-routes.js';
import {
  levelForXp,
  ProgressionService,
  xpForLevel,
} from '../src/progression/service.js';
import { createTestDb, FakeClock } from './helpers.js';

// Progression native (docs/PROGRESSION.md): XP from validated presence and chat (anti-spam, live only, exactly once),
// levels from a curve, level rewards, an inventory kept apart from what is equipped, grant / revoke / equip, the WizeBot
// import (idempotent, reversible). PGlite.

const CH = '83603689';
const T0 = new Date('2026-11-02T20:00:00Z');
let db: Db;
let clock: FakeClock;
let svc: ProgressionService;

beforeEach(async () => {
  db = await createTestDb();
  for (const t of [
    'progression_equipped',
    'progression_grants',
    'progression_rewards',
    'progression_ledger',
    'progression_accounts',
    'progression_settings',
    'stream_sessions',
    'stream_days',
    'viewers',
  ])
    await db.query(`delete from ${t}`);
  clock = new FakeClock(T0);
  svc = new ProgressionService(db, clock, () => CH);
  for (const [id, login] of [
    ['1', 'ana'],
    ['2', 'bob'],
    ['9', 'lecroupier_'],
  ])
    await db.query(
      'insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $2)',
      [id, login],
    );
});

const live = async () => {
  await db.query(
    `insert into stream_days (day, opened_at) values ('2026-11-02', $1) on conflict do nothing`,
    [T0],
  );
  await db.query(
    `insert into stream_sessions (stream_id, stream_day, started_at) values ('s1', '2026-11-02', $1)`,
    [T0],
  );
};
const msg = (
  id: string,
  text: string,
  over: Partial<LabChatMessage['chatter']> = {},
): LabChatMessage =>
  ({
    channel_id: CH,
    message_id: randomUUID(),
    text,
    chatter: {
      id,
      login: id === '1' ? 'ana' : 'bob',
      display_name: 'X',
      role: 'viewer',
      ...over,
    },
    source: 'twitch',
  }) as LabChatMessage;
const xp = async (id: string) =>
  Number(
    (
      await db.query<{ xp: string }>(
        'select xp from progression_accounts where channel_id = $1 and twitch_user_id = $2',
        [CH, id],
      )
    )[0]?.xp ?? 0,
  );
const presence = (viewerIds: string[], at: Date, seconds = 120) =>
  db.tx((q) =>
    svc.presenceListener.validated(q, {
      streamId: 's1',
      seconds,
      viewerIds,
      at,
    }),
  );

describe('the level curve', () => {
  it('level 1 at 0 XP; level ↔ XP consistent around every threshold', () => {
    const r = DEFAULT_PROGRESSION_RULES;
    expect(xpForLevel(1, r)).toBe(0);
    for (const L of [2, 3, 10, 50, 135, 300]) {
      expect(levelForXp(xpForLevel(L, r), r)).toBe(L);
      expect(levelForXp(xpForLevel(L, r) - 1, r)).toBe(L - 1);
    }
    expect(levelForXp(0, r)).toBe(1);
  });
});

describe('XP sources', () => {
  it('OFF by default: nothing counted; ON: validated presence pays per minute, once per interval; bots never', async () => {
    await presence(['1'], T0);
    expect(await xp('1')).toBe(0);
    await svc.updateSettings(CH, { enabled: true });
    await presence(['1', '9', CH], T0);
    await presence(['1', '9', CH], T0); // the same interval again
    expect(await xp('1')).toBe(2); // 120 s × 1 XP / min
    expect(await xp('9')).toBe(0); // lecroupier_ (excluded login)
    expect(await xp(CH)).toBe(0); // the broadcaster
    const v = await svc.viewer(CH, '1');
    expect(v).toMatchObject({ level: 1, xp: 2, watchMinutes: 2, messages: 0 });
  });

  it('chat: live only, never a command, a minimum length, one rewarded message per cooldown; a replayed message counts once', async () => {
    await svc.updateSettings(CH, { enabled: true });
    expect(await svc.onMessage(msg('1', 'salut tout le monde'))).toBe(
      'offline',
    );
    await live();
    expect(await svc.onMessage(msg('1', '!daily'))).toBe('command');
    expect(await svc.onMessage(msg('1', 'ok'))).toBe('too_short');
    const m = msg('1', 'bonjour à tous');
    expect(await svc.onMessage(m)).toBe('xp');
    expect(await svc.onMessage(m)).toBe('replayed');
    expect(await svc.onMessage(msg('1', 'encore un message'))).toBe('cooldown');
    clock.current = new Date(T0.getTime() + 61_000);
    expect(await svc.onMessage(msg('1', 'et de nouveau'))).toBe('xp');
    expect(
      await svc.onMessage(msg('9', 'je suis un bot', { login: 'lecroupier_' })),
    ).toBe('excluded');
    expect(
      await svc.onMessage(
        msg(CH, 'le streamer parle', { role: 'broadcaster' }),
      ),
    ).toBe('excluded');
    expect(await xp('1')).toBe(10);
    expect((await svc.viewer(CH, '1')).messages).toBe(4); // every non-command message, once each
  });

  it('the chat module never blocks the chat and never takes a message', async () => {
    const out = await svc.chatModule.chat!(msg('1', 'x'));
    expect(out).toEqual({ outcome: 'ignored' });
  });
});

describe('levels, rewards, inventory', () => {
  const reward = (
    reward_id: string,
    kind: 'title' | 'badge',
    unlock_level: number | null = null,
  ) =>
    svc.upsertReward(CH, {
      reward_id,
      kind,
      label: reward_id,
      description: '',
      rarity: 'common',
      category: 'general',
      unlock_level,
      active: true,
      sort: 0,
    });

  it('reaching a level grants its rewards; a level reward created later reaches those already there', async () => {
    await svc.updateSettings(CH, {
      enabled: true,
      rules: { curve_base: 1, curve_exponent: 1 },
    }); // level = XP + 1
    await reward('veteran', 'title', 3);
    await presence(['1'], T0, 120); // 2 XP → level 3
    expect(
      (await svc.viewer(CH, '1')).inventory.map((i) => [i.id, i.source]),
    ).toEqual([['veteran', 'level']]);
    await reward('pioneer', 'badge', 2);
    expect(
      (await svc.viewer(CH, '1')).inventory.map((i) => i.id).sort(),
    ).toEqual(['pioneer', 'veteran']);
  });

  it('grant (event or manual), equip only what is owned, revoke unequips and keeps the row; a deliberate re-grant restores, a level never does', async () => {
    await svc.updateSettings(CH, {
      enabled: true,
      rules: { curve_base: 1, curve_exponent: 1 },
    });
    await reward('citrouille', 'badge');
    await reward('roi-halloween', 'title');
    await reward('lvl2', 'title', 2);
    const g = await svc.grant(
      CH,
      {
        reward_id: 'citrouille',
        viewers: ['1', '2', '404'],
        source: 'event',
        reference: 'halloween-2026',
      },
      { id: 'studio' },
    );
    expect(g).toEqual({
      reward_id: 'citrouille',
      granted: ['1', '2'],
      unknown: ['404'],
    });
    // Same grant again: nothing more (idempotent).
    expect(
      (
        await svc.grant(
          CH,
          {
            reward_id: 'citrouille',
            viewers: ['1'],
            source: 'event',
            reference: 'halloween-2026',
          },
          { id: 'studio' },
        )
      ).granted,
    ).toEqual(['1']);
    await expect(
      svc.equip(CH, { viewer: '1', title_id: 'roi-halloween', badge_ids: [] }),
    ).rejects.toMatchObject({ code: 'title_not_owned' });
    await svc.grant(
      CH,
      {
        reward_id: 'roi-halloween',
        viewers: ['1'],
        source: 'manual',
        reference: null,
      },
      { id: 'studio' },
    );
    await svc.equip(CH, {
      viewer: '1',
      title_id: 'roi-halloween',
      badge_ids: ['citrouille'],
    });
    expect((await svc.viewer(CH, '1')).equipped).toEqual({
      title: 'roi-halloween',
      badges: ['citrouille'],
    });
    // A badge given as a title is refused.
    await expect(
      svc.equip(CH, { viewer: '1', title_id: 'citrouille', badge_ids: [] }),
    ).rejects.toMatchObject({ code: 'title_not_owned' });
    await svc.revoke(
      CH,
      { reward_id: 'citrouille', viewer: '1', reason: 'erreur' },
      { id: 'studio' },
    );
    let v = await svc.viewer(CH, '1');
    expect(v.equipped).toEqual({ title: 'roi-halloween', badges: [] });
    expect(v.inventory.map((i) => i.id)).toEqual(['roi-halloween']); // other titles kept
    await expect(
      svc.revoke(
        CH,
        { reward_id: 'citrouille', viewer: '1', reason: 'x' },
        { id: 'studio' },
      ),
    ).rejects.toMatchObject({ code: 'not_owned' });
    // A level reward revoked by hand is not granted again by the level.
    await presence(['2'], T0, 60); // bob: 1 XP → level 2 → lvl2
    await svc.revoke(
      CH,
      { reward_id: 'lvl2', viewer: '2', reason: 'test' },
      { id: 'studio' },
    );
    await presence(['2'], new Date(T0.getTime() + 1), 60);
    expect((await svc.viewer(CH, '2')).inventory.map((i) => i.id)).toEqual([
      'citrouille',
    ]);
    // A deliberate re-grant restores it.
    await svc.grant(
      CH,
      {
        reward_id: 'citrouille',
        viewers: ['1'],
        source: 'manual',
        reference: null,
      },
      { id: 'studio' },
    );
    v = await svc.viewer(CH, '1');
    expect(v.inventory.map((i) => i.id).sort()).toEqual([
      'citrouille',
      'roi-halloween',
    ]);
  });
});

describe('WizeBot import', () => {
  it('starts each viewer at their WizeBot level (once), resolves logins through the viewers, lists the unknown; undo is exact', async () => {
    const rules = DEFAULT_PROGRESSION_RULES;
    const req = {
      source: 'wizebot' as const,
      rows: [
        {
          twitch_user_id: '1',
          login: null,
          level: 30,
          watch_seconds: 360_000,
          messages: 5000,
        },
        {
          twitch_user_id: null,
          login: 'bob',
          level: 12,
          watch_seconds: 7200,
          messages: 40,
        },
        {
          twitch_user_id: null,
          login: 'inconnu',
          level: 5,
          watch_seconds: 0,
          messages: 0,
        },
      ],
    };
    await svc.updateSettings(CH, { enabled: true });
    await presence(['1'], T0); // 2 XP measured by the Core
    const out = await svc.importHistory(CH, req, { id: 'studio' });
    expect(out).toEqual({ imported: 2, already: 0, unresolved: ['inconnu'] });
    expect(await xp('1')).toBe(xpForLevel(30, rules) + 2);
    expect((await svc.viewer(CH, '1')).level).toBe(30);
    expect((await svc.viewer(CH, '2')).imported).toEqual({
      source: 'wizebot',
      level: 12,
      watchMinutes: 120,
      messages: 40,
    });
    // Again: nothing more.
    expect(await svc.importHistory(CH, req, { id: 'studio' })).toEqual({
      imported: 0,
      already: 2,
      unresolved: ['inconnu'],
    });
    // Undo: only what the Core measured stays.
    expect(await svc.revertImport(CH, 'wizebot')).toEqual({ removed: 2 });
    expect(await xp('1')).toBe(2);
    expect((await svc.viewer(CH, '1')).imported).toBeNull();
  });
});

describe('public reads and routes', () => {
  it('the ranking by XP; a curve change re-levels without touching XP; the site route exists only with its token', async () => {
    await svc.updateSettings(CH, { enabled: true });
    await presence(['1', '2'], T0, 600);
    await presence(['1'], new Date(T0.getTime() + 1), 600);
    const board = await svc.leaderboard(CH);
    expect(board.entries.map((e) => [e.rank, e.twitchUserId, e.xp])).toEqual([
      [1, '1', 20],
      [2, '2', 10],
    ]);
    await svc.updateSettings(CH, {
      rules: { curve_base: 1, curve_exponent: 1 },
    });
    expect((await svc.viewer(CH, '1')).level).toBe(21);
    expect(await xp('1')).toBe(20);
    const withSite = progressionRoutes(svc, {
      channelId: CH,
      production: true,
      site: true,
    });
    const without = progressionRoutes(svc, {
      channelId: CH,
      production: true,
      site: false,
    });
    expect(withSite.some((r) => r.auth === 'site')).toBe(true);
    expect(without.some((r) => r.auth === 'site')).toBe(false);
    expect(
      withSite.filter((r) => r.auth === 'public').map((r) => r.method),
    ).toEqual(['GET', 'GET', 'GET']);
    // Studio: a viewer by pseudo prefix or id, with the level; a LIKE wildcard is inert.
    expect(
      (await svc.searchViewers(CH, '@An')).map(
        (r) => (r as { login: string }).login,
      ),
    ).toEqual(['ana']);
    expect(await svc.searchViewers(CH, '%')).toEqual([]);
    expect(
      (await svc.searchViewers(CH, '2')).map(
        (r) => (r as { login: string }).login,
      ),
    ).toEqual(['bob']);
    const detail = withSite.find((r) =>
      r.pattern.test('/v1/studio/progression/viewers/123'),
    );
    expect(detail?.auth).toBe('studio_installation');
  });
});
