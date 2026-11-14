import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LabChatMessage } from '@raptoru/schemas';
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

export function levelV2Suite(freshDb: () => Promise<Db>) {
  let db: Db;
  let clock: FakeClock;
  let svc: ProgressionService;

  beforeEach(async () => {
    db = await freshDb();
    clock = new FakeClock(T0);
    svc = new ProgressionService(db, clock, () => CH);
    for (const [id, login] of [
      ['1', 'ana'],
      ['2', 'bob'],
      ['3', 'cid'],
      ['4', 'dan'],
      ['5', 'eve'],
      ['6', 'fay'],
    ])
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
      chatter: { id, login: 'x', display_name: 'X', role: 'viewer' },
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
      const before = [await xp('1'), await level('1')];
      await activate();
      expect(await level('1')).toBe(13);
      expect(await svc.revertLevelV2(CH)).toEqual({
        reverted: true,
        movements: 1,
      });
      expect([await xp('1'), await level('1')]).toEqual(before);
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
      await svc.updateSettings(CH, { rules: { level_up_notifications: true } });
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

    it('modes: absent = off (recorded, never shown); written; with sound; chat XP crosses a level too', async () => {
      await fixedNow();
      expect(await svc.viewerPrefs(CH, '1')).toEqual({
        level_up_notify: 'off',
        level_up_sfx_opt_in: false,
      });
      await svc.setViewerPrefs(CH, '2', { level_up_notify: 'text' });
      await svc.setViewerPrefs(CH, '3', { level_up_sfx_opt_in: true }); // the first extension's switch = sound
      expect((await svc.viewerPrefs(CH, '3')).level_up_notify).toBe('sound');
      await presence(['1', '2'], 1000 * 60);
      await svc.adjust(
        CH,
        {
          viewer: '3',
          mode: 'set_xp',
          value: 995,
          reason: 'test',
          request_id: 'adj-0000-cid1',
        },
        studio,
      );
      expect(await svc.onMessage(msg('3', 'bonsoir à tous'))).toBe('xp'); // 995 + 5 = 1 000
      expect((await events()).map((e) => [e.twitch_user_id, e.status])).toEqual(
        [
          ['1', 'skipped'],
          ['2', 'pending'],
          ['3', 'pending'],
        ],
      );
      const { notices } = await svc.claimLevelUps(CH, 'obs-1');
      expect(notices.map((n) => [n.twitchUserId, n.level, n.sound])).toEqual([
        ['2', 2, false],
        ['3', 2, true],
      ]);
      // Delivered once: nothing more.
      expect((await svc.claimLevelUps(CH, 'obs-1')).notices).toEqual([]);
    });

    it('the sound cooldown (whole channel) never hides a notice; one notice per viewer; an old one expires; notifications off', async () => {
      await fixedNow();
      for (const id of ['1', '2', '3'])
        await svc.setViewerPrefs(CH, id, { level_up_notify: 'sound' });
      await presence(['1'], 1000 * 60);
      expect((await svc.claimLevelUps(CH, 'obs')).notices[0]).toMatchObject({
        twitchUserId: '1',
        sound: true,
      });
      clock.current = new Date(T0.getTime() + 60_000);
      await presence(['2'], 1000 * 60);
      expect((await svc.claimLevelUps(CH, 'obs')).notices[0]).toMatchObject({
        twitchUserId: '2',
        sound: false,
      }); // within 5 min
      clock.current = new Date(T0.getTime() + 6 * 60_000);
      // Two level-ups of one viewer waiting: one notice, the final level.
      await presence(['3'], 1000 * 60);
      await presence(['3'], 1000 * 60);
      const n = (await svc.claimLevelUps(CH, 'obs')).notices;
      expect(n.map((x) => [x.twitchUserId, x.level, x.sound])).toEqual([
        ['3', 3, true],
      ]);
      // Too old (2 min by default): expired, never shown late.
      await presence(['1'], 1000 * 60);
      clock.current = new Date(clock.current.getTime() + 3 * 60_000);
      expect((await svc.claimLevelUps(CH, 'obs')).notices).toEqual([]);
      // The channel's notifications off: skipped.
      await svc.updateSettings(CH, {
        rules: { level_up_notifications: false },
      });
      await presence(['2'], 1000 * 60);
      expect((await events()).at(-1)?.status).toBe('skipped');
      const last = await svc.levelUps(CH);
      expect(last[0]).toMatchObject({
        status: 'skipped',
        reason: 'notifications_off',
      });
      expect(last.find((e) => e.status === 'expired')?.reason).toBe('too_old');
      expect(last.filter((e) => e.status === 'merged').length).toBe(1);
    });
  });

  describe('concurrency', () => {
    it('the same presence cycle delivered twice at once: one movement, one level-up event', async () => {
      await activate();
      await svc.updateSettings(CH, { rules: { level_up_notifications: true } });
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
}
