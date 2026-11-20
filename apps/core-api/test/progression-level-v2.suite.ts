import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LabChatMessage } from '@raptoru/schemas';
import { CommandSteps } from '../src/commands/steps.js';
import type { Db } from '../src/db/db.js';
import {
  normalizeWizebotLevel,
  ProgressionService,
} from '../src/progression/service.js';
import { FakeClock } from './helpers.js';

// Level Up V2 (docs/PROGRESSION.md): 1 000 XP per level, the frozen WizeBot normalization (exponent 0.7, once, audited,
// native XP kept), a level-up event only for a real gain (presence, chat), the viewers' notification modes and the
// delivery to Studio's OBS source (one notice per viewer, the channel's sound cooldown, never an old notice).
// Run twice: on PGlite (progression-level-v2.test.ts) and on a real Postgres (….integration.test.ts).

const CH = '83603689';
const T0 = new Date('2026-11-02T20:00:00Z');
const studio = { id: 'inst-1', name: 'Studio' };
const LOGINS: Record<string, string> = {
  '1': 'ana',
  '2': 'bob',
  '3': 'cid',
  '4': 'dan',
  '5': 'eve',
  '6': 'fay',
};

export function levelV2Suite(freshDb: () => Promise<Db>) {
  let db: Db;
  let clock: FakeClock;
  let svc: ProgressionService;

  beforeEach(async () => {
    db = await freshDb();
    clock = new FakeClock(T0);
    svc = new ProgressionService(db, clock, () => CH);
    for (const [id, login] of Object.entries(LOGINS))
      await db.query(
        'insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $2)',
        [id, login],
      );
    await db.query(
      `insert into stream_days (day, opened_at) values ('2026-11-02', $1) on conflict do nothing`,
      [T0],
    );
    await db.query(
      `insert into stream_sessions (stream_id, stream_day, started_at) values ('s1', '2026-11-02', $1)`,
      [T0],
    );
    await svc.updateSettings(CH, { enabled: true });
  });

  const xp = async (id: string) =>
    Number(
      (
        await db.query<{ xp: string }>(
          'select xp from progression_accounts where twitch_user_id = $1',
          [id],
        )
      )[0]?.xp ?? 0,
    );
  const level = async (id: string) => (await svc.viewer(CH, id)).level;
  let cycleSeq = 0;
  /** One validated presence interval of `seconds` (1 XP per minute). */
  const presence = (ids: string[], seconds: number) =>
    db.tx((q) =>
      svc.presenceListener.validated(q, {
        streamId: 's1',
        seconds,
        viewerIds: ids,
        at: new Date(T0.getTime() + ++cycleSeq),
      }),
    );
  const msg = (id: string, text: string) =>
    ({
      channel_id: CH,
      message_id: randomUUID(),
      text,
      // The chatter's real pseudo (the directory follows the chat: a rename is today's name).
      chatter: {
        id,
        login: LOGINS[id] ?? 'x',
        display_name: LOGINS[id] ?? 'X',
        role: 'viewer',
      },
      source: 'twitch',
    }) as LabChatMessage;
  const importRows = (rows: [string | null, string, number][]) =>
    svc.importHistory(
      CH,
      {
        source: 'wizebot',
        rows: rows.map(([id, login, lvl]) => ({
          twitch_user_id: id,
          id_source: id ? ('wizebot' as const) : null,
          login,
          level: lvl,
          watch_seconds: 0,
          messages: 0,
        })),
      },
      studio,
    );
  const events = async () =>
    db.query<{
      twitch_user_id: string;
      from_level: number;
      to_level: number;
      status: string;
    }>(
      'select twitch_user_id, from_level, to_level, status from progression_level_events order by id',
    );
  const activate = () => svc.activateLevelV2(CH, studio);

  describe('the frozen WizeBot normalization', () => {
    it('monotone, 1 stays 1, the max becomes 50, a single level gives 1; the real data points', () => {
      const n = { exponent: 0.7, max_level: 135, target_max: 50 };
      let prev = 0;
      for (let L = 1; L <= 300; L++) {
        const v = normalizeWizebotLevel(L, n);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
      expect(
        [1, 2, 3, 5, 10, 20, 50, 74, 100, 121, 135].map((L) =>
          normalizeWizebotLevel(L, n),
        ),
      ).toEqual([1, 2, 3, 5, 8, 13, 25, 33, 40, 46, 50]);
      expect(normalizeWizebotLevel(7, { ...n, max_level: 1 })).toBe(1);
      expect(normalizeWizebotLevel(10, { ...n, exponent: 1 })).toBe(4); // proportional, for the record
    });
  });

  describe('activation: 1 000 XP per level, histories normalized, native XP kept, once', () => {
    it('normalizes the attached histories, keeps the XP earned and adjusted since, audits, never twice', async () => {
      await importRows([
        ['1', 'ana', 135],
        ['2', 'bob', 74],
        ['3', 'cid', 10],
        ['4', 'dan', 2],
        [null, 'late', 74], // pending: attached later, with the same frozen parameters
      ]);
      await presence(['1'], 600); // ana earns 10 XP before the activation
      await svc.adjust(
        CH,
        {
          viewer: '2',
          mode: 'add',
          value: 300,
          reason: 'test',
          request_id: 'adj-0000-bob1',
        },
        studio,
      );
      await presence(['5'], 3000); // eve: no WizeBot history, 50 XP earned
      const weekBefore = await svc.leaderboard(CH, 10, 'xp', 'week');
      const out = await activate();
      expect(out).toMatchObject({
        applied: true,
        version: 1,
        maxWizebotLevel: 135,
      });
      expect([await xp('1'), await level('1')]).toEqual([49_010, 50]); // 1 000 × 49 + 10 earned
      expect([await xp('2'), await level('2')]).toEqual([32_300, 33]); // 74 → 33, + 300 adjusted
      expect([await xp('3'), await level('3')]).toEqual([7000, 8]);
      expect([await xp('4'), await level('4')]).toEqual([1000, 2]);
      expect([await xp('5'), await level('5')]).toEqual([50, 1]); // XP kept, read on the new scale
      // Audit and provenance.
      const h = await svc.history(CH, '2');
      expect(h.normalization).toMatchObject({
        version: 1,
        wizebotLevel: 74,
        previousLevel: 74,
        nativeXp: 300,
        newLevel: 33,
        newXp: 32_300,
      });
      expect(h.movements[0]).toMatchObject({
        kind: 'normalization',
        actor: 'Studio',
      });
      // Never an announced level-up, never in a period.
      expect((await events()).filter((e) => e.status !== 'skipped')).toEqual(
        [],
      );
      const earned = (b: typeof weekBefore) =>
        b.entries.map((e) => [
          e.twitchUserId,
          e.xp,
          e.watchMinutes,
          e.messages,
        ]);
      expect(earned(await svc.leaderboard(CH, 10, 'xp', 'week'))).toEqual(
        earned(weekBefore),
      );
      // Once only.
      await expect(activate()).rejects.toMatchObject({
        code: 'already_applied',
      });
      expect(await xp('1')).toBe(49_010);
      // The curve is locked; the other rules still change.
      await expect(
        svc.updateSettings(CH, { rules: { curve_base: 500 } }),
      ).rejects.toMatchObject({ code: 'level_curve_locked' });
      await svc.updateSettings(CH, { rules: { message_xp: 6 } });
      // A history attached months later: the same frozen normalization (74 → 33), never a notification.
      await db.query(
        `insert into viewers (twitch_user_id, login, display_name) values ('7', 'late', 'Late')`,
      );
      await svc.identify(CH, {
        viewer: '7',
        login: 'late',
        display_name: 'Late',
      });
      expect([await xp('7'), await level('7')]).toEqual([32_000, 33]);
      expect((await events()).filter((e) => e.twitch_user_id === '7')).toEqual(
        [],
      );
    });

    it('the global ranking: XP first, then the WizeBot level for equal XP (the history decides, never an arbitrary id)', async () => {
      // 121 and 120 both normalize to 46 (same XP): 121 stays ahead.
      await importRows([
        ['2', 'bob', 120],
        ['1', 'ana', 121],
        ['3', 'cid', 135],
      ]);
      await activate();
      const board = await svc.leaderboard(CH, 10);
      expect(board.entries.map((e) => [e.twitchUserId, e.level])).toEqual([
        ['3', 50],
        ['1', 46],
        ['2', 46],
      ]);
    });

    it('the undo puts the previous curve and XP back (audit kept); refused once a history was attached since', async () => {
      await importRows([
        ['1', 'ana', 20],
        [null, 'max_pending', 135], // the max is frozen over EVERY history, attached or not
      ]);
      await svc.updateSettings(CH, { rules: { message_xp: 5 } });
      const before = [await xp('1'), await level('1')];
      await activate();
      expect(await level('1')).toBe(13);
      expect((await svc.settings(CH)).rules).toMatchObject({
        xp_per_minute: 1,
        message_xp: 3,
        message_cooldown_s: 60,
      });
      expect(await svc.revertLevelV2(CH)).toEqual({
        reverted: true,
        movements: 1,
      });
      expect([await xp('1'), await level('1')]).toEqual(before);
      expect((await svc.settings(CH)).rules.message_xp).toBe(5); // the pace before
      expect(
        (await svc.history(CH, '1')).normalization?.revertedAt,
      ).not.toBeNull();
      // Activated again after the undo: the same result, the audit row current again.
      await activate();
      expect(await level('1')).toBe(13);
      expect((await svc.history(CH, '1')).normalization?.revertedAt).toBeNull();
      // Refused once a history was attached after the activation (its XP was counted on the new scale).
      clock.current = new Date(T0.getTime() + 60_000);
      await importRows([['2', 'bob', 5]]);
      await expect(svc.revertLevelV2(CH)).rejects.toMatchObject({
        code: 'imports_since_activation',
      });
    });
  });

  describe('level-ups and their notifications', () => {
    const fixedNow = async () => {
      await activate(); // no history: everybody on 1 000 XP per level
      await svc.updateSettings(CH, { rules: { level_up_sound: true } });
    };

    it('999 → 1 000 XP is one level-up; the rest carried; several levels at once: one event with the final level; a replay none', async () => {
      await fixedNow();
      await presence(['1'], 999 * 60);
      expect([await xp('1'), await level('1')]).toEqual([999, 1]);
      expect(await events()).toEqual([]);
      await presence(['1'], 60);
      expect([await xp('1'), await level('1')]).toEqual([1000, 2]);
      await presence(['1'], 2500 * 60); // 3 500: level 4, 500 carried
      expect([await xp('1'), await level('1')]).toEqual([3500, 4]);
      expect((await events()).map((e) => [e.from_level, e.to_level])).toEqual([
        [1, 2],
        [2, 4],
      ]);
      // The same cycle again: nothing.
      await db.tx((q) =>
        svc.presenceListener.validated(q, {
          streamId: 's1',
          seconds: 2500 * 60,
          viewerIds: ['1'],
          at: new Date(T0.getTime() + cycleSeq),
        }),
      );
      expect((await events()).length).toBe(2);
      // A Studio adjustment crossing levels: no event.
      await svc.adjust(
        CH,
        {
          viewer: '1',
          mode: 'add',
          value: 5000,
          reason: 'test',
          request_id: 'adj-0000-ana1',
        },
        studio,
      );
      expect((await events()).length).toBe(2);
    });
  });

  describe('the first extension’s sound choices (Supabase ext_viewer_preferences)', () => {
    const row = (
      id: string | null,
      on: boolean,
      at: string,
      channel = CH,
      login = 'x',
    ) => ({
      channel_id: channel,
      twitch_user_id: id,
      twitch_login: login,
      level_up_sfx_opt_in: on,
      updated_at: at,
    });
    const rows = [
      row('1', true, '2026-10-01T10:00:00Z', CH, 'ana'),
      row('2', false, '2026-10-02T10:00:00Z', CH, 'bob'),
      row('3', true, '2026-10-01T10:00:00Z', CH, 'cid'),
      row('3', false, '2026-10-05T10:00:00Z', CH, 'cid'), // the newest row of one viewer wins
      row('4', true, '2026-10-03T10:00:00Z', CH, 'dan'),
      row('5', true, '2026-10-03T10:00:00Z', '999', 'eve'), // another channel
      row(null, true, '2026-10-03T10:00:00Z', CH, 'ghost'), // no Twitch id: never attached by pseudo
    ];

    it('dry run first (nothing written); then on / off kept, the newest row, a choice made since in the extension always wins', async () => {
      await svc.setViewerPrefs(CH, '4', { level_up_sound: false }); // dan chose in Raptoru 2.0's extension
      const dry = await svc.importViewerPrefs(CH, { dry_run: true, rows });
      expect(dry).toEqual({
        dry_run: true,
        rows: 7,
        sound_on: 1,
        sound_off: 2,
        unchanged: 0,
        kept_extension_choice: 1,
        other_channel: 1,
        duplicates: 1,
        no_identity: ['ghost'],
      });
      expect((await svc.viewerPrefs(CH, '1')).chosen).toBe(false); // nothing written
      const real = await svc.importViewerPrefs(CH, { dry_run: false, rows });
      expect({ ...real, dry_run: true }).toEqual(dry);
      expect(await svc.viewerPrefs(CH, '1')).toMatchObject({
        level_up_sound: true,
        source: 'legacy',
      });
      expect((await svc.viewerPrefs(CH, '2')).level_up_sound).toBe(false);
      expect((await svc.viewerPrefs(CH, '3')).level_up_sound).toBe(false);
      expect(await svc.viewerPrefs(CH, '4')).toMatchObject({
        level_up_sound: false,
        source: 'extension',
      });
      // Imported again: nothing changes; never a sound, never an announcement.
      const again = await svc.importViewerPrefs(CH, { dry_run: false, rows });
      expect(again).toMatchObject({ sound_on: 0, sound_off: 0, unchanged: 3 });
      expect(await events()).toEqual([]);
      // Ana changes her mind in the extension: a later import never brings the old choice back.
      await svc.setViewerPrefs(CH, '1', { level_up_sound: false });
      expect(
        (await svc.importViewerPrefs(CH, { dry_run: false, rows }))
          .kept_extension_choice,
      ).toBe(2);
      expect((await svc.viewerPrefs(CH, '1')).level_up_sound).toBe(false);
    });
  });

  describe('chat announcements (LeCroupier_, real Twitch announcements, the commands outbox)', () => {
    const steps = async () =>
      (
        await db.query<{ params: unknown; origin: string; key: string }>(
          `select params, origin, idempotency_key as key from cmd_steps where channel_id = $1 order by seq_global`,
          [CH],
        )
      ).map((r) => {
        const p = (
          typeof r.params === 'string' ? JSON.parse(r.params) : r.params
        ) as { text: string; mode: string; color?: string };
        // The word joiner that keeps a pseudo from mentioning its viewer is shown as « ⁀ » here.
        return {
          text: p.text.replaceAll('⁠', '⁀'),
          mode: p.mode,
          color: p.color ?? null,
          origin: r.origin,
        };
      });
    const texts = async () => (await steps()).map((s) => s.text);
    const chatOutput = (on: boolean) =>
      db.query(
        `insert into cmd_channels (channel_id, chat_output) values ($1, $2)
         on conflict (channel_id) do update set chat_output = $2`,
        [CH, on],
      );
    const chatOn = async () => {
      await activate();
      await svc.updateSettings(CH, { rules: { level_up_chat: true } });
      await chatOutput(true);
    };
    const at = (ms: number) => {
      clock.current = new Date(T0.getTime() + ms);
    };
    const toXp = (viewer: string, value: number, id: string) =>
      svc.adjust(
        CH,
        { viewer, mode: 'set_xp', value, reason: 'test', request_id: id },
        studio,
      );
    /** Viewer `id` one XP short of the next level, then one real chat message: a real level-up now. */
    const levelUp = async (id: string, xpNow: number, ms: number) => {
      at(ms);
      await toXp(id, xpNow, `adj-0000-${id}-${ms}`);
      expect(await svc.onMessage(msg(id, `bonsoir tout le monde ${ms}`))).toBe(
        'xp',
      );
    };
    const title = async (viewer: string, id: string, label: string) => {
      await svc.upsertReward(CH, {
        reward_id: id,
        kind: 'title',
        label,
        description: '',
        rarity: 'common',
        category: 'general',
        unlock_level: null,
        active: true,
        sort: 0,
      });
      await svc.grant(
        CH,
        { reward_id: id, viewers: [viewer], source: 'manual', reference: null },
        { id: 'studio' },
      );
      await svc.equip(CH, { viewer, title_id: id, badge_ids: [] });
    };

    it('the defaults: a real announcement « 🚀 LEVEL UP — {liste} », 5 min of grouping, the channel colour; the first V2 text reads as it', async () => {
      // The first V2 stored its own text (one line per viewer, with a mention): it reads as the announcement.
      await db.query(
        `update progression_settings set rules = rules || '{"level_up_chat_text": "@{pseudo} vient d’atteindre le niveau {niveau} !", "level_up_chat_interval_s": 30}'::jsonb
         where channel_id = $1`,
        [CH],
      );
      const { rules } = await svc.settings(CH);
      expect([
        rules.level_up_chat_text,
        rules.level_up_chat_interval_s,
        rules.level_up_chat_color,
      ]).toEqual(['🚀 LEVEL UP — {liste}', 30, 'primary']);
      // A text without {liste} is refused; the colour is one of Twitch's five.
      await expect(
        svc.updateSettings(CH, { rules: { level_up_chat_text: 'GG !' } }),
      ).rejects.toThrow();
      await expect(
        svc.updateSettings(CH, {
          rules: { level_up_chat_color: 'red' as never },
        }),
      ).rejects.toThrow();
      // A window under 30 s is refused (Twitch's limits: never a flood).
      await expect(
        svc.updateSettings(CH, { rules: { level_up_chat_interval_s: 5 } }),
      ).rejects.toThrow();
    });

    it('a text changed in Studio is the NEXT announcement’s text — read at each announcement (no cache, no restart), kept exactly as typed', async () => {
      await chatOn();
      await levelUp('1', 999, 0);
      at(300_000);
      await svc.tick();
      // Antoni's text of 20/11/2026, saved as Studio sends it.
      await svc.updateSettings(CH, {
        rules: { level_up_chat_text: '🚀 Level UP - {liste} !' },
      });
      expect((await svc.settings(CH)).rules.level_up_chat_text).toBe(
        '🚀 Level UP - {liste} !',
      );
      await levelUp('2', 999, 400_000);
      at(700_000);
      await svc.tick();
      expect(await texts()).toEqual([
        '🚀 LEVEL UP — a⁀na (2)',
        '🚀 Level UP - b⁀ob (2) !',
      ]);
    });

    it('Studio’s test: ONE real « [TEST] » announcement (the channel text and colour, an optional title of the catalogue) — no XP, no level, no event, no reward; refused without the chat output', async () => {
      await activate();
      const count = async (table: string) =>
        Number(
          (
            await db.query<{ n: string }>(
              `select count(*) as n from ${table} where channel_id = $1`,
              [CH],
            )
          )[0]!.n,
        );
      await chatOutput(false);
      await expect(
        svc.testLevelUpChat(CH, 'Raptoru_', 25),
      ).rejects.toMatchObject({ status: 409, code: 'chat_output_off' });
      expect(await steps()).toEqual([]);
      await chatOutput(true);
      await title('1', 'loup-garou', 'Loup-Garou');
      await svc.updateSettings(CH, {
        rules: { level_up_chat_color: 'purple' },
      });
      const before = {
        events: await count('progression_level_events'),
        ledger: await count('progression_ledger'),
        grants: await count('progression_grants'),
      };
      expect(
        (await svc.testLevelUpChat(CH, 'Raptoru_', 25)).text.replaceAll(
          '⁠',
          '⁀',
        ),
      ).toBe('[TEST] 🚀 LEVEL UP — R⁀aptoru_ (25)');
      at(1000); // a second click (the same millisecond is the same test: written once)
      await svc.testLevelUpChat(CH, 'Raptoru_', 57, 'loup-garou');
      await expect(
        svc.testLevelUpChat(CH, 'Raptoru_', 57, 'inconnu'),
      ).rejects.toMatchObject({ status: 404, code: 'title_not_found' });
      expect(await steps()).toEqual([
        {
          text: '[TEST] 🚀 LEVEL UP — R⁀aptoru_ (25)',
          mode: 'announce',
          color: 'purple',
          origin: 'module:level_up',
        },
        {
          text: '[TEST] 🚀 LEVEL UP — R⁀aptoru_ [Loup-Garou] (57)',
          mode: 'announce',
          color: 'purple',
          origin: 'module:level_up',
        },
      ]);
      expect({
        events: await count('progression_level_events'),
        ledger: await count('progression_ledger'),
        grants: await count('progression_grants'),
      }).toEqual(before);
      expect(await xp('1')).toBe(0);
    });

    it('one window of 5 min: ONE announcement for everyone of the window, at its end — a viewer climbing twice once, at the highest; titles only when equipped; a replay or an adjustment never', async () => {
      await chatOn();
      await title('2', 'loup-garou', 'Loup-Garou');
      await levelUp('1', 999, 0); // ana → 2, opens the window
      await levelUp('4', 1999, 30_000); // dan → 3
      await levelUp('2', 999, 60_000); // bob → 2 (equipped title)
      await levelUp('4', 2999, 200_000); // dan again → 4
      at(299_000);
      await svc.tick();
      expect(await steps()).toEqual([]); // the window is still open
      await toXp('3', 9000, 'adj-0000-cid9'); // an adjustment: never announced
      at(300_000);
      await svc.tick();
      expect(await steps()).toEqual([
        {
          text: '🚀 LEVEL UP — a⁀na (2) · d⁀an (4) · b⁀ob [Loup-Garou] (2)',
          mode: 'announce',
          color: 'primary',
          origin: 'module:level_up',
        },
      ]);
      const chat = Object.fromEntries(
        (await svc.levelUps(CH))
          .filter((e) => e.twitchUserId === '4')
          .map((e) => [e.toLevel, e.chat.status]),
      );
      expect(chat).toEqual({ 3: 'merged', 4: 'sent' });
      // Nothing more, whatever runs again.
      at(400_000);
      await svc.tick();
      await svc.tick();
      expect((await steps()).length).toBe(1);
    });

    it('the limits: 8 pseudos and 450 characters at most; the rest in the next one, a minute later at least; never twice', async () => {
      await chatOn();
      for (let i = 7; i <= 16; i++)
        await db.query(
          'insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $2)',
          [String(i), `viewer${i}`],
        );
      const ids = Array.from({ length: 10 }, (_, k) => String(k + 7));
      at(0);
      await presence(ids, 1000 * 60);
      at(300_000);
      await svc.tick();
      expect(await texts()).toEqual([
        `🚀 LEVEL UP — ${ids
          .slice(0, 8)
          .map((i) => `v⁀iewer${i} (2)`)
          .join(' · ')}`,
      ]);
      at(330_000);
      await svc.tick();
      expect((await steps()).length).toBe(1); // within a minute of the last: waits
      at(360_000);
      await svc.tick();
      expect((await texts()).at(-1)).toBe(
        '🚀 LEVEL UP — v⁀iewer15 (2) · v⁀iewer16 (2)',
      );
      // Long titles: the line stays under 450 characters, the others wait (never cut in the middle of a name).
      for (const i of ids)
        await title(
          i,
          `long-${i}`,
          `Un très long titre numéro ${i} !!!`.padEnd(40, '.'),
        );
      at(400_000);
      await presence(ids, 1000 * 60);
      at(700_000);
      await svc.tick();
      const line = (await texts()).at(-1)!;
      expect(line.length).toBeLessThanOrEqual(450);
      expect(line.split(' · ').length).toBeLessThan(8);
      const sent = (await svc.levelUps(CH)).filter(
        (e) => e.chat.status === 'sent',
      );
      expect(new Set(sent.map((e) => e.id)).size).toBe(sent.length);
    });

    it('never a silent loss: the output or the announcements off, or too late after the window — a state and a reason for each', async () => {
      await chatOn();
      await svc.setViewerPrefs(CH, '1', { level_up_sound: false });
      await levelUp('1', 999, 0);
      at(300_000);
      await svc.tick(); // sound off: announced all the same
      await chatOutput(false);
      await levelUp('2', 999, 400_000);
      await chatOutput(true);
      await svc.updateSettings(CH, { rules: { level_up_chat: false } });
      await levelUp('3', 999, 500_000);
      await svc.updateSettings(CH, { rules: { level_up_chat: true } });
      // A level-up whose announcement could not go out within 2 min after its window (no tick, no activity).
      await levelUp('5', 999, 600_000);
      at(600_000 + 300_000 + 121_000);
      await svc.tick();
      expect(await texts()).toEqual(['🚀 LEVEL UP — a⁀na (2)']);
      const why = Object.fromEntries(
        (await svc.levelUps(CH)).map((e) => [
          e.twitchUserId,
          [e.chat.status, e.chat.reason],
        ]),
      );
      expect(why).toEqual({
        '1': ['sent', null],
        '2': ['skipped', 'chat_output_off'],
        '3': ['skipped', 'chat_off'],
        '5': ['expired', 'too_old'],
      });
    });

    it('the same level-up delivered three times at once: one event, one announcement; the tick and a message at once: one', async () => {
      await chatOn();
      await presence(['1'], 999 * 60);
      const when = new Date(T0.getTime() + 999_999);
      const cycle = () =>
        db.tx((q) =>
          svc.presenceListener.validated(q, {
            streamId: 's1',
            seconds: 60,
            viewerIds: ['1'],
            at: when,
          }),
        );
      await Promise.allSettled([cycle(), cycle(), cycle()]);
      expect((await events()).length).toBe(1);
      at(300_000);
      await Promise.allSettled([
        svc.tick(),
        svc.tick(),
        svc.onMessage(msg('2', 'salut la team ça va')),
      ]);
      expect((await steps()).length).toBe(1);
    });

    it('LeCroupier_ cannot announce (missing scope): the same text once as a plain message, never a loop', async () => {
      await chatOn();
      await levelUp('1', 999, 0);
      at(300_000);
      await svc.tick();
      const outbox = new CommandSteps(db, clock);
      const s = (await outbox.claim(CH, 'bot')).step!;
      await outbox.ack(CH, s.step_id, {
        executor_id: 'bot',
        attempt_id: s.attempt_id!,
        event: 'failed',
        error: { code: 'missing_scope', message: 'no scope', retryable: false },
      });
      expect((await steps()).map((x) => [x.mode, x.text])).toEqual([
        ['announce', '🚀 LEVEL UP — a⁀na (2)'],
        ['normal', '🚀 LEVEL UP — a⁀na (2)'],
      ]);
      const p = (await outbox.claim(CH, 'bot')).step!;
      await outbox.ack(CH, p.step_id, {
        executor_id: 'bot',
        attempt_id: p.attempt_id!,
        event: 'failed',
        error: { code: 'forbidden', message: 'no', retryable: false },
      });
      expect((await steps()).length).toBe(2);
    });
  });

  describe('the sound, just before its announcement (one per announcement, the banner level_up_sound_lead_s later)', () => {
    const outbox = () => new CommandSteps(db, clock);
    const chatOn = async (sound = true) => {
      await activate();
      await svc.updateSettings(CH, {
        rules: { level_up_chat: true, level_up_sound: sound },
      });
      await db.query(
        `insert into cmd_channels (channel_id, chat_output) values ($1, true)
         on conflict (channel_id) do update set chat_output = true`,
        [CH],
      );
    };
    const at = (ms: number) => {
      clock.current = new Date(T0.getTime() + ms);
    };
    const levelUp = async (id: string, xpNow: number, ms: number) => {
      at(ms);
      await svc.adjust(
        CH,
        {
          viewer: id,
          mode: 'set_xp',
          value: xpNow,
          reason: 'test',
          request_id: `adj-0000-${id}-${ms}`,
        },
        studio,
      );
      expect(await svc.onMessage(msg(id, `bonsoir tout le monde ${ms}`))).toBe(
        'xp',
      );
    };
    /** LeCroupier_ asks for the next step: null while none is due. */
    const take = async () => (await outbox().claim(CH, 'bot')).step;
    /** LeCroupier_ sends `s` and reports `event` (Twitch's answer). */
    const send = async (
      s: NonNullable<Awaited<ReturnType<typeof take>>>,
      event: 'succeeded' | 'failed' | 'unknown',
      retryable = false,
    ) => {
      const o = outbox();
      const base = { executor_id: 'bot', attempt_id: s.attempt_id! };
      await o.ack(CH, s.step_id, { ...base, event: 'running' });
      await o.ack(
        CH,
        s.step_id,
        event === 'succeeded'
          ? { ...base, event }
          : {
              ...base,
              event,
              error: { code: 'twitch_error', message: 'no', retryable },
            },
      );
    };
    const obs = async () => (await svc.claimLevelUps(CH, 'obs-1')).notices;
    const sound = async (viewer: string) =>
      (await svc.levelUps(CH))
        .filter((e) => e.twitchUserId === viewer)
        .map((e) => [e.status, e.reason]);
    const last = async () => (await svc.announcements(CH))[0]!;

    it('three viewers in one window, one with the sound on: nothing before the window ends; then ONE sound on OBS, the banner 3 s after it — never before; never twice', async () => {
      await chatOn();
      await svc.setViewerPrefs(CH, '2', { level_up_sound: false });
      await svc.setViewerPrefs(CH, '3', { level_up_sound: true });
      await levelUp('1', 999, 0); // no choice known
      await levelUp('2', 999, 10_000); // turned off
      await levelUp('3', 999, 20_000); // turned on
      expect(await obs()).toEqual([]); // recorded, grouped: nothing yet
      at(300_000);
      await svc.tick();
      expect(await take()).toBeNull(); // the announcement waits for its sound
      at(301_000);
      expect(await obs()).toMatchObject([
        { sound: true, test: false, names: 3 },
      ]);
      expect(await obs()).toEqual([]); // once: a reconnected source gets nothing more
      at(303_999);
      expect(await take()).toBeNull(); // never before the 3 s
      at(304_000);
      const s = (await take())!;
      expect(s.params).toMatchObject({ mode: 'announce' });
      await send(s, 'succeeded');
      expect(await obs()).toEqual([]);
      await svc.tick();
      expect(await last()).toMatchObject({
        sound: { status: 'played' },
        announce: { status: 'sent' },
        names: 3,
      });
      const a = await last();
      expect(Date.parse(a.announcedAt!) - Date.parse(a.playedAt!)).toBe(3000);
      expect(await sound('1')).toEqual([['skipped', 'viewer_no_sound']]);
      expect(await sound('2')).toEqual([['skipped', 'viewer_no_sound']]);
      expect(await sound('3')).toEqual([['delivered', null]]);
    });

    it('nobody named turned the sound on: the banner at once, silent (no waiting)', async () => {
      await chatOn();
      await levelUp('1', 999, 0);
      at(300_000);
      await svc.tick();
      await send((await take())!, 'succeeded');
      expect(await obs()).toEqual([]);
      await svc.tick();
      expect(await last()).toMatchObject({
        sound: { status: 'silent' },
        announce: { status: 'sent' },
      });
    });

    it('no OBS source before the banner leaves: no sound after it, ever (missed); a source that comes back plays nothing', async () => {
      await chatOn();
      await svc.setViewerPrefs(CH, '1', { level_up_sound: true });
      await levelUp('1', 999, 0);
      at(300_000);
      await svc.tick();
      at(306_000); // 3 s of lead + 3 s for the OBS source
      const s = (await take())!;
      expect(await obs()).toEqual([]); // LeCroupier_ took it: too late for the sound
      await send(s, 'succeeded');
      expect(await obs()).toEqual([]);
      expect(await sound('1')).toEqual([['skipped', 'no_obs_source']]);
      expect((await last()).sound).toMatchObject({
        status: 'missed',
        reason: 'no_obs_source',
      });
    });

    it('Twitch busy then OK (a retry), or a replayed acknowledgement: the sound once, never replayed; the outcome recorded, a failure too', async () => {
      await chatOn();
      await svc.setViewerPrefs(CH, '1', { level_up_sound: true });
      await svc.setViewerPrefs(CH, '2', { level_up_sound: true });
      await levelUp('1', 999, 0);
      at(300_000);
      await svc.tick();
      at(301_000);
      expect(await obs()).toHaveLength(1);
      at(304_000);
      await send((await take())!, 'failed', true); // retryable: waits a few seconds
      at(310_000);
      const s = (await take())!;
      await send(s, 'succeeded');
      await outbox().ack(CH, s.step_id, {
        executor_id: 'bot',
        attempt_id: s.attempt_id!,
        event: 'succeeded',
      }); // the bot's journal reports it again: nothing more
      expect(await obs()).toEqual([]);
      await svc.tick();
      expect((await last()).announce.status).toBe('sent');
      // A banner Twitch refuses: recorded on the announcement and its level-ups (never silent).
      await levelUp('2', 999, 400_000);
      at(700_000);
      await svc.tick();
      at(701_000);
      expect(await obs()).toHaveLength(1);
      at(704_000);
      await send((await take())!, 'failed');
      await svc.tick();
      expect((await last()).announce).toMatchObject({
        status: 'failed',
        reason: 'failed',
      });
      expect(
        (await svc.levelUps(CH)).find((e) => e.twitchUserId === '2')?.chat,
      ).toMatchObject({ status: 'skipped', reason: 'announcement_failed' });
    });

    it('the lead from Studio (0 to 5 s); the channel sound off or the viewer turning it off: the banner at once; one sound at most per 60 s between announcements', async () => {
      await chatOn();
      for (const id of ['1', '2', '3', '4', '5'])
        await svc.setViewerPrefs(CH, id, { level_up_sound: true });
      await expect(
        svc.updateSettings(CH, { rules: { level_up_sound_lead_s: 6 } }),
      ).rejects.toThrow();
      await svc.updateSettings(CH, { rules: { level_up_sound_lead_s: 0 } });
      await levelUp('1', 999, 0);
      at(300_000);
      await svc.tick();
      at(301_000);
      expect(await obs()).toHaveLength(1);
      await send((await take())!, 'succeeded'); // lead 0: right away
      await svc.updateSettings(CH, { rules: { level_up_sound_lead_s: 5 } });
      await levelUp('2', 999, 400_000);
      at(700_000);
      await svc.tick();
      at(700_500);
      expect(await obs()).toHaveLength(1);
      at(705_499);
      expect(await take()).toBeNull();
      at(705_500);
      await send((await take())!, 'succeeded');
      // The viewer turns it off before the window ends: silent, at once.
      await levelUp('3', 999, 800_000);
      await svc.setViewerPrefs(CH, '3', { level_up_sound: false });
      at(1_100_000);
      await svc.tick();
      await send((await take())!, 'succeeded');
      expect(await obs()).toEqual([]);
      expect(await sound('3')).toEqual([['skipped', 'viewer_no_sound']]);
      // The channel's sound off: the banner at once, silent.
      await svc.updateSettings(CH, { rules: { level_up_sound: false } });
      await levelUp('4', 999, 1_200_000);
      at(1_500_000);
      await svc.tick();
      await send((await take())!, 'succeeded');
      expect(await sound('4')).toEqual([['skipped', 'sound_off']]);
      // The cooldown: measured between the announcements' own times (60 s apart at least: never dropped by a clock).
      await svc.updateSettings(CH, {
        rules: { level_up_sound: true, level_up_sound_cooldown_s: 120 },
      });
      await levelUp('5', 999, 1_520_000);
      at(1_820_000);
      await svc.tick();
      expect((await last()).sound).toMatchObject({ status: 'waiting' });
    });

    it('the announcements off: no announcement, no sound (recorded); the first extension’s imported « on » plays before the next banner', async () => {
      await chatOn();
      await svc.updateSettings(CH, { rules: { level_up_chat: false } });
      await svc.setViewerPrefs(CH, '1', { level_up_sound: true });
      await levelUp('1', 999, 0);
      expect(await sound('1')).toEqual([['skipped', 'no_announcement']]);
      await svc.updateSettings(CH, { rules: { level_up_chat: true } });
      await svc.importViewerPrefs(CH, {
        dry_run: false,
        rows: [
          {
            channel_id: CH,
            twitch_user_id: '2',
            twitch_login: 'bob',
            level_up_sfx_opt_in: true,
            updated_at: '2026-10-01T10:00:00Z',
          },
        ],
      });
      await levelUp('2', 999, 100_000);
      at(400_000);
      await svc.tick();
      at(400_500);
      expect(await obs()).toHaveLength(1);
      expect(await sound('2')).toEqual([['delivered', null]]);
    });

    it('Studio’s test announcement: the same circuit — the sound first (whatever the channel switch), the banner 3 s after; no XP, no level-up event', async () => {
      await chatOn(false);
      const before = await events();
      const t = await svc.testLevelUpChat(CH, 'Raptoru', 25);
      expect(await take()).toBeNull(); // waits for its sound
      at(1_000);
      expect(await obs()).toMatchObject([
        { id: t.announcement, sound: true, test: true },
      ]);
      at(3_999);
      expect(await take()).toBeNull();
      at(4_000);
      await send((await take())!, 'succeeded');
      expect(await obs()).toEqual([]);
      await svc.tick();
      expect(await last()).toMatchObject({
        test: true,
        sound: { status: 'played' },
        announce: { status: 'sent' },
      });
      expect(await events()).toEqual(before);
      expect(await xp('1')).toBe(0);
    });
  });

  describe('Studio tools: the sound list, the pseudos from Twitch', () => {
    it('« Viewers avec son activé »: only who turned it on (the extension or the imported choice), with the source and the date; never who made no choice or turned it off', async () => {
      clock.current = new Date('2026-11-15T10:00:00Z');
      await svc.setViewerPrefs(CH, '1', { level_up_sound: true });
      await svc.setViewerPrefs(CH, '2', { level_up_sound: false });
      await svc.importViewerPrefs(CH, {
        dry_run: false,
        rows: [
          {
            channel_id: CH,
            twitch_user_id: '3',
            twitch_login: 'cid',
            level_up_sfx_opt_in: true,
            updated_at: '2026-10-05T10:00:00Z',
          },
          {
            channel_id: CH,
            twitch_user_id: '4',
            twitch_login: 'dan',
            level_up_sfx_opt_in: false,
            updated_at: '2026-10-05T10:00:00Z',
          },
        ],
      });
      expect(await svc.soundViewers(CH)).toEqual({
        count: 2,
        viewers: [
          {
            twitchUserId: '1',
            displayName: 'ana',
            login: 'ana',
            source: 'extension',
            changedAt: '2026-11-15T10:00:00.000Z',
          },
          {
            twitchUserId: '3',
            displayName: 'cid',
            login: 'cid',
            source: 'legacy',
            changedAt: '2026-10-05T10:00:00.000Z',
          },
        ],
      });
      // Turned off in the extension: out of the list at once.
      await svc.setViewerPrefs(CH, '3', { level_up_sound: false });
      expect((await svc.soundViewers(CH)).count).toBe(1);
    });

    it('the pseudos from Twitch by the stable id: added when missing, renamed, an unknown id left as it is; never an XP, level or attachment change', async () => {
      // A WizeBot history attached by its exact id, an account the directory never saw (the digits of the rankings).
      await importRows([
        ['77', 'ancien_pseudo', 12],
        ['88', 'compte_supprime', 8],
      ]);
      await presence(['1'], 60);
      const rank = async () =>
        Object.fromEntries(
          (await svc.leaderboard(CH)).entries.map((e) => [
            e.twitchUserId,
            [e.displayName, e.login],
          ]),
        );
      // No directory row: the exact id's WizeBot pseudo (never a pseudo that only looks alike), no login.
      expect(await rank()).toMatchObject({
        '77': ['ancien_pseudo', null],
        '88': ['compte_supprime', null],
      });
      await expect(svc.refreshNames(CH)).rejects.toMatchObject({
        code: 'twitch_unavailable',
      });
      const before = await db.query(
        'select twitch_user_id, xp, level from progression_accounts order by twitch_user_id',
      );
      const asked: string[][] = [];
      svc.userLookup = async (ids) => {
        asked.push(ids);
        return [
          {
            id: '77',
            login: 'nouveau_pseudo',
            display_name: 'Nouveau_Pseudo',
            profile_image_url: '',
          },
          {
            id: '1',
            login: 'ana_2',
            display_name: 'Ana_2',
            profile_image_url: '',
          },
        ].filter((u) => ids.includes(u.id));
      };
      expect(await svc.refreshNames(CH)).toMatchObject({
        checked: 3,
        added: 1,
        updated: 1,
        unresolved: 1,
      });
      expect(asked).toEqual([['1', '77', '88']]);
      expect(await rank()).toMatchObject({
        '1': ['Ana_2', 'ana_2'],
        '77': ['Nouveau_Pseudo', 'nouveau_pseudo'],
        '88': ['compte_supprime', null],
      });
      expect(svc.namesStatus()).toMatchObject({ unresolved: 1 });
      expect(
        await db.query(
          'select twitch_user_id, xp, level from progression_accounts order by twitch_user_id',
        ),
      ).toEqual(before);
      // Run again: nothing to change.
      expect(await svc.refreshNames(CH)).toMatchObject({
        added: 0,
        updated: 0,
      });
    });

    it('a renamed viewer chatting: today’s pseudo, by the stable id', async () => {
      await svc.onMessage({
        ...msg('2', 'salut tout le monde'),
        chatter: {
          id: '2',
          login: 'bobby',
          display_name: 'Bobby',
          role: 'viewer',
        },
      } as LabChatMessage);
      expect(
        (
          await db.query<{ login: string }>(
            `select login from viewers where twitch_user_id = '2'`,
          )
        )[0]!.login,
      ).toBe('bobby');
    });
  });

  describe('chat XP anti-farming', () => {
    const at = (ms: number) => {
      clock.current = new Date(T0.getTime() + ms);
    };
    it('a real sentence once per cooldown; never the same text again, a stretched or letter-poor one, a command, a bot', async () => {
      expect(await svc.onMessage(msg('1', 'salut tout le monde'))).toBe('xp');
      expect(await svc.onMessage(msg('1', 'ça va ?'))).toBe('cooldown');
      at(61_000);
      expect(await svc.onMessage(msg('1', 'Salut TOUT le monde !!'))).toBe(
        'repeated',
      );
      expect(await svc.onMessage(msg('1', 'saluuuut tout le mooonde'))).toBe(
        'repeated',
      );
      expect(await svc.onMessage(msg('1', 'aaaaaaaaaa'))).toBe('too_short');
      expect(await svc.onMessage(msg('1', '?????????'))).toBe('too_short');
      expect(await svc.onMessage(msg('1', '!rb @bob'))).toBe('command');
      expect(await svc.onMessage(msg('1', 'gg pour la partie'))).toBe('xp');
      // The repeat window (10 min) passed: the same text earns again.
      at(61_000 + 11 * 60_000);
      expect(await svc.onMessage(msg('1', 'salut tout le monde'))).toBe('xp');
      expect(await xp('1')).toBe(9); // 3 rewarded messages × 3 XP
      expect((await svc.viewer(CH, '1')).messages).toBe(9); // every message counted
      // Presence: 1 XP per validated minute — 60 XP an hour present, 240 at most chatting (60 + 60 × 3).
      await presence(['1'], 60 * 60);
      expect(await xp('1')).toBe(69);
      // New rates in Studio: only what comes next; what was earned stays.
      await svc.updateSettings(CH, {
        rules: { message_xp: 10, xp_per_minute: 2 },
      });
      expect(await xp('1')).toBe(69);
      at(61_000 + 11 * 60_000 + 61_000);
      expect(await svc.onMessage(msg('1', 'une nouvelle phrase'))).toBe('xp');
      expect(await xp('1')).toBe(79);
      const bot = {
        ...msg('2', 'bienvenue sur le stream'),
        chatter: {
          id: '2',
          login: 'StreamElements',
          display_name: 'StreamElements',
          role: 'viewer',
        },
      } as LabChatMessage;
      expect(await svc.onMessage(bot)).toBe('excluded');
    });
  });

  describe('level badges (one every 10 levels; every 25 since 20/11/2026)', () => {
    const badge = (lvl: number, active = true) =>
      svc.upsertReward(CH, {
        reward_id: `niveau-${lvl}`,
        kind: 'badge',
        label: `Niveau ${lvl}`,
        description: '',
        rarity: 'common',
        category: 'niveau',
        unlock_level: lvl,
        active,
        sort: lvl,
      });
    const owned = async (id: string) =>
      (await svc.viewer(CH, id)).inventory
        .filter((i) => i.kind === 'badge')
        .map((i) => i.id);
    const setLevel = (viewer: string, value: number, id: string) =>
      svc.adjust(
        CH,
        { viewer, mode: 'set_level', value, reason: 'test', request_id: id },
        studio,
      );

    it('the activation gives every viewer the badges of the RECALCULATED level; never twice; a missing badge is just absent', async () => {
      await importRows([
        ['1', 'ana', 135], // → 50
        ['2', 'bob', 20], // → 13
        ['3', 'cid', 5], // → 5
      ]);
      await activate();
      for (const lvl of [10, 20, 30, 40, 50]) await badge(lvl);
      expect(await owned('1')).toEqual([
        'niveau-10',
        'niveau-20',
        'niveau-30',
        'niveau-40',
        'niveau-50',
      ]);
      expect(await owned('2')).toEqual(['niveau-10']);
      expect(await owned('3')).toEqual([]);
      // Created again (Studio saves the form twice): still one grant each.
      await badge(10);
      const grants = await db.query(
        `select 1 from progression_grants where reward_id = 'niveau-10'`,
      );
      expect(grants.length).toBe(2);
      // No badge configured at 60: reaching it gives nothing, and fails nothing.
      await setLevel('1', 61, 'adj-0000-ana6');
      expect((await owned('1')).length).toBe(5);
    });

    it('a real level-up to 10 gives the badge (no announcement needed); an older badge can be shown; a badge switched off disappears from the profile', async () => {
      await activate();
      await badge(10);
      await badge(20);
      await setLevel('1', 10, 'adj-0000-ana1');
      await svc.adjust(
        CH,
        {
          viewer: '2',
          mode: 'set_xp',
          value: 8_999,
          reason: 'test',
          request_id: 'adj-0000-bob9',
        },
        studio,
      );
      await presence(['2'], 60); // 9 000: level 10
      expect(await owned('2')).toEqual(['niveau-10']);
      await setLevel('1', 25, 'adj-0000-ana2');
      expect(await owned('1')).toEqual(['niveau-10', 'niveau-20']);
      // Ana prefers the first one: she shows it (raptoru.fr's equip, up to 3 badges).
      await svc.equip(CH, {
        viewer: '1',
        title_id: null,
        badge_ids: ['niveau-10'],
      });
      const row = (await svc.leaderboard(CH, 10)).entries.find(
        (e) => e.twitchUserId === '1',
      );
      expect(row?.badges.map((b) => b.id)).toEqual(['niveau-10']);
      expect(row?.badges[0]?.image).toBeNull(); // no image yet: the site shows the label
      await expect(
        svc.equip(CH, {
          viewer: '3',
          title_id: null,
          badge_ids: ['niveau-10'],
        }),
      ).rejects.toMatchObject({ code: 'badge_not_owned' });
      // Studio switches the badge off: kept in the inventory history, gone from the profile and the rankings.
      await badge(10, false);
      expect((await svc.viewer(CH, '1')).equipped.badges).toEqual([]);
      const status = await svc.levelV2Status(CH);
      expect(
        status.levelBadges.map((b) => [b.level, b.active, b.owners]),
      ).toEqual([
        [10, false, 2],
        [20, true, 1],
      ]);
    });
  });

  describe('the simulation of the activation', () => {
    it('the exact numbers of the activation, nothing written', async () => {
      await importRows([
        ['1', 'ana', 135],
        ['2', 'bob', 74],
        [null, 'late', 40], // unresolved: listed, never given to a guessed viewer
      ]);
      await presence(['5'], 3000);
      await badge10();
      await svc.updateSettings(CH, {
        rules: { level_up_chat: true, level_up_sound: true },
      });
      const xpBefore = [await xp('1'), await xp('2'), await xp('5')];
      const sim = await svc.simulateLevelV2(CH, studio);
      expect(sim).toMatchObject({
        dry_run: true,
        applied: true,
        accounts: 3,
        changed: 2,
      });
      expect(sim.levelsAfter.max).toBe(50);
      expect(sim.levelRewardsGiven).toBe(2); // ana and bob reach 10 on the new scale
      expect(sim.rates).toEqual({
        xp_per_minute: 1,
        message_xp: 3,
        message_cooldown_s: 60,
      });
      expect(sim.variations[0]).toMatchObject({
        name: 'ana',
        wizebot: 135,
        before: 135,
        after: 50,
      });
      expect(sim.levelRewards).toEqual([
        {
          id: 'niveau-10',
          kind: 'badge',
          label: 'Niveau 10',
          level: 10,
          owners: 2,
          ownersBefore: 0,
        },
      ]);
      expect(sim.unresolved).toMatchObject({ pending: 1 });
      expect(sim.unresolved.sample).toEqual([
        { login: 'late', status: 'pending', level: 40, candidates: 0 },
      ]);
      // Nothing written: XP, the model, the audit, the grants.
      expect([await xp('1'), await xp('2'), await xp('5')]).toEqual(xpBefore);
      expect((await svc.settings(CH)).rules.level_model).toBe('curve');
      expect(
        (await db.query('select 1 from progression_normalizations')).length,
      ).toBe(0);
      const real = await activate();
      expect(real).toMatchObject({
        accounts: sim.accounts,
        changed: sim.changed,
        levelRewardsGiven: sim.levelRewardsGiven,
      });
      expect(real.levelsAfter).toEqual(sim.levelsAfter);
      // The migration's level-ups are not real ones: no sound, no chat line.
      expect(await events()).toEqual([]);
      expect(
        (await db.query('select 1 from cmd_steps where channel_id = $1', [CH]))
          .length,
      ).toBe(0);
    });
    const badge10 = () =>
      svc.upsertReward(CH, {
        reward_id: 'niveau-10',
        kind: 'badge',
        label: 'Niveau 10',
        description: '',
        rarity: 'common',
        category: 'niveau',
        unlock_level: 10,
        active: true,
        sort: 10,
      });
  });

  describe('concurrency', () => {
    it('the same presence cycle delivered twice at once: one movement, one level-up event', async () => {
      await activate();
      await svc.updateSettings(CH, { rules: { level_up_sound: true } });
      await presence(['1'], 999 * 60);
      const at = new Date(T0.getTime() + 999_999);
      const cycle = () =>
        db.tx((q) =>
          svc.presenceListener.validated(q, {
            streamId: 's1',
            seconds: 60,
            viewerIds: ['1'],
            at,
          }),
        );
      await Promise.allSettled([cycle(), cycle(), cycle()]);
      expect(await xp('1')).toBe(1000);
      expect((await events()).length).toBe(1);
    });
  });

  describe('1 000 XP per level, badges every 25 levels (20/11/2026)', () => {
    const badge = (lvl: number) =>
      svc.upsertReward(CH, {
        reward_id: `palier-${lvl}`,
        kind: 'badge',
        label: `Niveau ${lvl}`,
        description: '',
        rarity: 'common',
        category: 'niveau',
        unlock_level: lvl,
        active: true,
        sort: lvl,
      });
    const owned = async (id: string) =>
      (await svc.viewer(CH, id)).inventory
        .filter((i) => i.kind === 'badge')
        .map((i) => i.id)
        .sort();

    it('a big real gain: several levels at once, the surplus kept, ONE event at the final level; a replay counts nothing', async () => {
      await activate();
      await svc.adjust(
        CH,
        {
          viewer: '1',
          mode: 'set_xp',
          value: 999,
          reason: 'test',
          request_id: 'adj-0000-big1',
        },
        studio,
      );
      const cycle = {
        streamId: 's1',
        seconds: 3_001 * 60 + 30,
        viewerIds: ['1'],
        at: new Date(T0.getTime() + 77),
      };
      await db.tx((q) => svc.presenceListener.validated(q, cycle));
      expect(await xp('1')).toBe(999 + 3_002); // 4 001: 1 XP per minute, rounded
      expect(await level('1')).toBe(5); // 1 + floor(4 001 / 1 000): 1 XP kept towards 6
      // The same presence reading again (a replay): nothing more.
      await db.tx((q) => svc.presenceListener.validated(q, cycle));
      expect(await xp('1')).toBe(4_001);
      expect((await events()).map((e) => [e.from_level, e.to_level])).toEqual([
        [1, 5],
      ]);
    });

    it('the paliers 25, 50, 75, 100 … and past 1 000: the badge exactly at its level (24/25, 49/50, 74/75, 99/100, 999/1 000/1 025), never announced by an adjustment', async () => {
      await activate();
      for (const lvl of [25, 50, 75, 100, 1000, 1025]) await badge(lvl);
      const cases: [string, number, string[]][] = [
        ['1', 24, []],
        ['2', 25, ['palier-25']],
        ['3', 49, ['palier-25']],
        ['4', 50, ['palier-25', 'palier-50']],
        ['5', 74, ['palier-25', 'palier-50']],
        ['6', 75, ['palier-25', 'palier-50', 'palier-75']],
      ];
      for (const [id, lvl] of cases)
        await svc.adjust(
          CH,
          {
            viewer: id,
            mode: 'set_level',
            value: lvl,
            reason: 'test',
            request_id: `adj-0000-pal-${id}`,
          },
          studio,
        );
      for (const [id, lvl, want] of cases) {
        expect(await level(id)).toBe(lvl);
        expect(await owned(id)).toEqual(want);
      }
      const step = async (id: string, lvl: number, key: string) =>
        svc.adjust(
          CH,
          {
            viewer: id,
            mode: 'set_level',
            value: lvl,
            reason: 'test',
            request_id: key,
          },
          studio,
        );
      await step('1', 99, 'adj-0000-pal-99');
      expect(await owned('1')).toEqual(['palier-25', 'palier-50', 'palier-75']);
      await step('1', 100, 'adj-0000-pal-100');
      expect(await owned('1')).toContain('palier-100');
      await step('1', 999, 'adj-0000-pal-999');
      expect(await owned('1')).not.toContain('palier-1000');
      await step('1', 1025, 'adj-0000-pal-1025');
      expect(await level('1')).toBe(1025);
      expect(await xp('1')).toBe(1_024_000);
      expect(await owned('1')).toEqual(
        [25, 50, 75, 100, 1000, 1025].map((l) => `palier-${l}`).sort(),
      );
      // Administrative moves (a future restoration included): badges yes, announcements never.
      expect(await events()).toEqual([]);
    });
  });
}
