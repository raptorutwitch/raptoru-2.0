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
    'progression_history',
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

  it('a progression failure never undoes the presence cycle (the Jetons of that interval): its own savepoint', async () => {
    await svc.updateSettings(CH, { enabled: true });
    await db.query(
      'alter table progression_ledger rename to progression_ledger_off',
    );
    try {
      await db.tx(async (q) => {
        await q.query(
          `insert into stream_days (day, opened_at) values ('2026-11-03', $1)`,
          [T0],
        ); // stands for the cycle's own writes (loyalty credits…)
        await svc.presenceListener.validated(q, {
          streamId: 's1',
          seconds: 120,
          viewerIds: ['1'],
          at: T0,
        });
      });
    } finally {
      await db.query(
        'alter table progression_ledger_off rename to progression_ledger',
      );
    }
    expect(
      (await db.query(`select 1 from stream_days where day = '2026-11-03'`))
        .length,
    ).toBe(1);
    expect(await xp('1')).toBe(0);
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
  const rules = DEFAULT_PROGRESSION_RULES;
  const row = (over: Record<string, unknown>) => ({
    twitch_user_id: null,
    login: 'x',
    level: 10,
    watch_seconds: 0,
    messages: 0,
    ...over,
  });
  const studio = { id: 'studio' };

  it('every row is kept; attached by the exact Twitch id first, else by the ONE account of a pseudo; the rest waits and is attached later', async () => {
    // « old_name » is held by two accounts in the Core (a renamed viewer and the new owner of the name).
    for (const [id, login] of [
      ['3', 'old_name'],
      ['4', 'old_name'],
      ['5', 'cid'],
    ])
      await db.query(
        'insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $2)',
        [id, login],
      );
    const req = {
      source: 'wizebot' as const,
      rows: [
        row({ twitch_user_id: '1', login: 'ana_old', level: 30 }), // exact id: ana, renamed since
        row({ login: 'bob', level: 12 }), // by its one account
        row({ login: 'old_name' }), // two accounts: ambiguous
        row({ login: 'inconnu', level: 7, watch_seconds: 600 }), // unknown today: waits
        row({ twitch_user_id: '777', login: 'jamais_vu' }), // an id the Core never saw: Twitch's own id
        row({ login: 'cid' }), // cid by pseudo…
        row({ twitch_user_id: '5', login: 'cid_alt' }), // …and cid again by id: one account, two rows → conflict
      ],
    };
    const dry = await svc.importHistory(CH, { ...req, dry_run: true }, studio);
    expect(dry).toEqual({
      dry_run: true,
      would_import: 3,
      already: 0,
      by_id: 2,
      by_login: 1,
      unresolved: ['inconnu'],
      ambiguous: ['old_name'],
      conflicts: ['cid', 'cid_alt'],
    });
    // A dry run writes nothing, not even the history.
    expect(await xp('1')).toBe(0);
    expect(await svc.importStatus(CH)).toMatchObject({
      imported: 0,
      pending: 0,
    });
    expect(await svc.importHistory(CH, req, studio)).toMatchObject({
      imported: 3,
      already: 0,
      by_id: 2,
      by_login: 1,
    });
    expect(await svc.importStatus(CH)).toMatchObject({
      imported: 3,
      pending: 1,
      ambiguous: 1,
      conflict: 2,
    });
    expect(await xp('1')).toBe(xpForLevel(30, rules));
    expect(await xp('777')).toBe(xpForLevel(10, rules));
    for (const id of ['3', '4', '5']) expect(await xp(id)).toBe(0);
    expect((await svc.history(CH, '1')).sources).toMatchObject([
      { source: 'wizebot', login: 'ana_old', level: 30, attachedBy: 'id' },
    ]);
    // « inconnu » comes to the stream: the stored row is attached, with its first reading — no WizeBot needed.
    await db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ('6', 'inconnu', 'Inconnu')`,
    );
    expect(
      await svc.importHistory(CH, { source: 'wizebot', rows: [] }, studio),
    ).toMatchObject({ imported: 1, by_login: 1, unresolved: [] });
    expect((await svc.viewer(CH, '6')).imported).toEqual({
      source: 'wizebot',
      level: 7,
      watchMinutes: 10,
      messages: 0,
    });
  });

  it('a stored reading is never replaced by an older one, and an imported one never changes', async () => {
    const at = (d: number) => new Date(T0.getTime() + d * 86_400_000);
    const send = (level: number, when: Date, login = 'zed') =>
      svc.importHistory(
        CH,
        {
          source: 'wizebot',
          measured_at: when.toISOString(),
          rows: [row({ login, level })],
        },
        studio,
      );
    await send(5, at(0));
    await send(3, at(-1)); // older: ignored
    await db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ('8', 'zed', 'Zed')`,
    );
    await svc.importHistory(CH, { source: 'wizebot', rows: [] }, studio);
    expect((await svc.viewer(CH, '8')).imported?.level).toBe(5);
    expect(await send(50, at(1))).toMatchObject({ imported: 0, already: 1 });
    expect((await svc.viewer(CH, '8')).imported?.level).toBe(5);
    expect(await xp('8')).toBe(xpForLevel(5, rules));
  });

  it('a second run never resets the XP earned since; the undo removes only the import, never what was earned', async () => {
    await svc.updateSettings(CH, { enabled: true });
    const req = {
      source: 'wizebot' as const,
      rows: [
        row({
          twitch_user_id: '1',
          login: 'ana',
          level: 30,
          watch_seconds: 360_000,
          messages: 5000,
        }),
      ],
    };
    await presence(['1'], T0); // 2 XP before the import
    await svc.importHistory(CH, req, studio);
    await presence(['1'], new Date(T0.getTime() + 1)); // 2 XP earned after it
    const before = await xp('1');
    expect(before).toBe(xpForLevel(30, rules) + 4);
    expect(await svc.importHistory(CH, req, studio)).toMatchObject({
      imported: 0,
      already: 1,
    });
    expect(await xp('1')).toBe(before);
    const v = await svc.viewer(CH, '1');
    expect(v.imported).toEqual({
      source: 'wizebot',
      level: 30,
      watchMinutes: 6000,
      messages: 5000,
    });
    // Imported history + what the Core counted since (4 minutes of presence).
    expect(v.totals).toEqual({ watchMinutes: 6004, messages: 5000 });
    expect(await svc.revertImport(CH, 'wizebot')).toEqual({ removed: 1 });
    expect(await xp('1')).toBe(4); // what the Core measured stays
    expect((await svc.viewer(CH, '1')).imported).toBeNull();
    expect(await svc.importStatus(CH)).toMatchObject({
      imported: 0,
      pending: 1,
    });
    // Imported again after the undo: back exactly, the earned XP still on top.
    await svc.importHistory(CH, req, studio);
    expect(await xp('1')).toBe(xpForLevel(30, rules) + 4);
  });
});

describe('WizeBot history: identity rules, automatic and manual attachment', () => {
  const rules = DEFAULT_PROGRESSION_RULES;
  const studio = { id: 'inst-1', name: 'Studio' };
  const row = (over: Record<string, unknown>) => ({
    twitch_user_id: null,
    id_source: null,
    login: 'x',
    level: 10,
    watch_seconds: 0,
    messages: 0,
    ...over,
  });
  const send = (rows: ReturnType<typeof row>[]) =>
    svc.importHistory(CH, { source: 'wizebot', rows }, studio);

  it('the Wallet rules: a legacy pair is kept unless the pseudo has another holder today; several holders are never decided', async () => {
    await db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ('20', 'repris', 'Repris')`,
    );
    const out = await send([
      row({ login: 'bob', twitch_user_id: '2', id_source: 'legacy' }), // the Core agrees: attached by id
      row({ login: 'repris', twitch_user_id: '21', id_source: 'legacy' }), // pseudo reassigned since: never decided
      row({ login: 'parti', twitch_user_id: '22', id_source: 'legacy' }), // renamed / gone from the Core: its id
      row({ login: 'ana', id_source: 'ambiguous' }), // the legacy data saw two holders of « ana »
    ]);
    expect(out).toMatchObject({
      imported: 2,
      by_id: 2,
      ambiguous: ['ana', 'repris'],
    });
    expect(await xp('2')).toBe(xpForLevel(10, rules));
    expect(await xp('20')).toBe(0);
    expect(await xp('1')).toBe(0);
  });

  it('a viewer seen again (presence, chat, sign-in on the site) gets their waiting history; the XP earned since stays', async () => {
    await svc.updateSettings(CH, { enabled: true });
    await send([
      row({ login: 'retour', level: 8, watch_seconds: 6000 }),
      row({ login: 'bavard', level: 4 }),
      row({ login: 'zoe', level: 6 }),
    ]);
    expect(await svc.importStatus(CH)).toMatchObject({ pending: 3 });
    // Presence: the viewer comes back for the first time since the import.
    await db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ('10', 'retour', 'Retour')`,
    );
    await presence(['10'], T0);
    expect(await xp('10')).toBe(xpForLevel(8, rules) + 2);
    expect((await svc.viewer(CH, '10')).totals.watchMinutes).toBe(102);
    // A replayed cycle: nothing more.
    await presence(['10'], T0);
    expect(await xp('10')).toBe(xpForLevel(8, rules) + 2);
    // Chat.
    await live();
    await db.query(
      `insert into viewers (twitch_user_id, login, display_name) values ('12', 'bavard', 'Bavard')`,
    );
    expect(
      await svc.onMessage(
        msg('12', 'coucou tout le monde', { login: 'bavard' }),
      ),
    ).toBe('xp');
    expect(await xp('12')).toBe(xpForLevel(4, rules) + 5);
    // Sign-in on raptoru.fr: the site's verified pair joins the directory; attached once.
    expect(
      await svc.identify(CH, {
        viewer: '11',
        login: 'zoe',
        display_name: 'Zoe',
      }),
    ).toEqual({ attached: 1 });
    expect(
      await svc.identify(CH, {
        viewer: '11',
        login: 'zoe',
        display_name: 'Zoe',
      }),
    ).toEqual({ attached: 0 });
    expect(await xp('11')).toBe(xpForLevel(6, rules));
    expect(await svc.importStatus(CH)).toMatchObject({
      imported: 3,
      pending: 0,
    });
  });

  it('Studio decides an uncertain row: attached once, journaled; never a second history for a viewer', async () => {
    for (const [id, login] of [
      ['3', 'old_name'],
      ['4', 'old_name'],
    ])
      await db.query(
        'insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $2)',
        [id, login],
      );
    await send([
      row({ login: 'old_name', level: 9 }),
      row({ login: 'autre', level: 3 }),
    ]);
    const waiting = await svc.waiting(CH, 'old');
    expect(waiting).toMatchObject([
      { login: 'old_name', status: 'ambiguous', candidates: ['3', '4'] },
    ]);
    const attach = (login: string, viewer: string) =>
      svc.attachManually(
        CH,
        { source: 'wizebot', login, viewer, reason: 'vérifié avec le viewer' },
        studio,
      );
    expect(await attach('old_name', '3')).toEqual({
      attached: true,
      viewer: '3',
      level: 9,
    });
    expect(await xp('3')).toBe(xpForLevel(9, rules));
    await expect(attach('old_name', '4')).rejects.toMatchObject({
      code: 'already_attached',
    });
    await expect(attach('autre', '3')).rejects.toMatchObject({
      code: 'viewer_has_history',
    });
    await expect(attach('autre', '404')).rejects.toMatchObject({
      code: 'unknown_viewer',
    });
    expect((await svc.history(CH, '3')).sources).toMatchObject([
      { login: 'old_name', attachedBy: 'manual' },
    ]);
    // The automatic run never undoes a decision.
    await send([]);
    expect(await xp('3')).toBe(xpForLevel(9, rules));
  });
});

describe('WizeBot read by the Core', () => {
  it('the simulation and the import read the same export in one transaction; an unreadable export changes nothing', async () => {
    let data: unknown = {
      measured_at: '2026-10-30T10:00:00.000Z',
      rows: [
        {
          twitch_user_id: '1',
          id_source: 'wizebot',
          login: 'ana',
          level: 20,
          watch_seconds: 600,
          messages: 3,
        },
        { login: 'bob', level: 5 },
        { login: 'nouveau', level: 2 },
      ],
    };
    const s2 = new ProgressionService(db, clock, () => CH, {
      wizebotExport: async () => data,
    });
    const dry = await s2.importFromWizebot(CH, true, { id: 'studio' });
    expect(dry).toMatchObject({
      read: 3,
      dry_run: true,
      would_import: 2,
      unresolved: ['nouveau'],
    });
    expect(await s2.importStatus(CH)).toMatchObject({
      imported: 0,
      pending: 0,
    });
    expect(
      await s2.importFromWizebot(CH, false, { id: 'studio' }),
    ).toMatchObject({ read: 3, imported: 2 });
    expect(await s2.importStatus(CH)).toMatchObject({
      imported: 2,
      pending: 1,
      lastMeasuredAt: '2026-10-30T10:00:00.000Z',
    });
    data = { rows: 'nope' };
    await expect(
      s2.importFromWizebot(CH, false, { id: 'studio' }),
    ).rejects.toMatchObject({
      code: 'wizebot_unavailable',
    });
  });
});

describe('Studio: manual XP', () => {
  const adjust = (
    viewer: string,
    mode: 'add' | 'remove' | 'set_xp' | 'set_level',
    value: number,
    request_id = randomUUID(),
  ) =>
    svc.adjust(
      CH,
      { viewer, mode, value, reason: 'test manuel', request_id },
      { id: 'inst-1', name: 'Studio' },
    );

  it('add, remove, set the XP or the level; journaled with the reason; a repeated click is one adjustment; never below zero', async () => {
    const id = randomUUID();
    expect(await adjust('1', 'add', 100, id)).toEqual({
      changed: true,
      xp: 100,
      level: levelForXp(100, DEFAULT_PROGRESSION_RULES),
    });
    expect(await adjust('1', 'add', 100, id)).toMatchObject({
      changed: false,
      xp: 100,
    });
    await expect(adjust('1', 'remove', 101)).rejects.toMatchObject({
      code: 'below_zero',
    });
    expect(await adjust('1', 'remove', 40)).toMatchObject({ xp: 60 });
    const five = xpForLevel(5, DEFAULT_PROGRESSION_RULES);
    expect(await adjust('1', 'set_level', 5)).toEqual({
      changed: true,
      xp: five,
      level: 5,
    });
    expect((await svc.viewer(CH, '1')).level).toBe(5);
    expect(await adjust('1', 'set_xp', 0)).toMatchObject({ xp: 0, level: 1 });
    expect((await svc.viewer(CH, '1')).level).toBe(1);
    await expect(adjust('404', 'add', 1)).rejects.toMatchObject({
      code: 'unknown_viewer',
    });
    const journal = (await svc.history(CH, '1')).movements;
    expect(journal.map((m) => [m.kind, m.amount])).toEqual([
      ['correction', -five],
      ['grant', five - 60],
      ['correction', -40],
      ['grant', 100],
    ]);
    expect(journal[0]).toMatchObject({
      actor: 'Studio',
      reason: 'set_xp 0 — test manuel',
    });
  });

  it('two removals at once never take the XP below zero', async () => {
    await adjust('2', 'add', 100);
    const out = await Promise.allSettled([
      adjust('2', 'remove', 60),
      adjust('2', 'remove', 60),
    ]);
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(await xp('2')).toBe(40);
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
    // By presence time (and by messages): imported history + counted by the Core.
    await db.query(
      "update progression_accounts set imported_watch_seconds = 36000, imported_messages = 7 where twitch_user_id = '2'",
    );
    expect(
      (await svc.leaderboard(CH, 10, 'watch')).entries.map((e) => [
        e.twitchUserId,
        e.watchMinutes,
      ]),
    ).toEqual([
      ['2', 610],
      ['1', 20],
    ]);
    expect(
      (await svc.leaderboard(CH, 10, 'messages')).entries.map((e) => [
        e.twitchUserId,
        e.messages,
      ]),
    ).toEqual([['2', 7]]);
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
