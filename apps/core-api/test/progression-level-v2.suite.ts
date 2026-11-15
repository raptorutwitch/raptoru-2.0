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

    it('the sound: none when no choice is known; only for a viewer who turned it on (here or in the first extension)', async () => {
      await fixedNow();
      expect(await svc.viewerPrefs(CH, '1')).toEqual({
        level_up_sound: false,
        level_up_sfx_opt_in: false,
        chosen: false,
        source: null,
      });
      await svc.setViewerPrefs(CH, '2', { level_up_sound: false });
      await svc.setViewerPrefs(CH, '3', { level_up_sfx_opt_in: true }); // the first extension's switch: same meaning
      expect(await svc.viewerPrefs(CH, '3')).toMatchObject({
        level_up_sound: true,
        chosen: true,
        source: 'extension',
      });
      await presence(['1', '2'], 1000 * 60);
      await svc.adjust(
        CH,
        {
          viewer: '3',
          mode: 'set_xp',
          value: 997,
          reason: 'test',
          request_id: 'adj-0000-cid1',
        },
        studio,
      );
      expect(await svc.onMessage(msg('3', 'bonsoir à tous'))).toBe('xp'); // 997 + 3 = 1 000
      expect((await events()).map((e) => [e.twitch_user_id, e.status])).toEqual(
        [
          ['1', 'skipped'], // no choice known: no sound
          ['2', 'skipped'],
          ['3', 'pending'],
        ],
      );
      const { notices } = await svc.claimLevelUps(CH, 'obs-1');
      expect(notices.map((n) => [n.twitchUserId, n.level, n.sound])).toEqual([
        ['3', 2, true],
      ]);
      // Played once: nothing more.
      expect((await svc.claimLevelUps(CH, 'obs-1')).notices).toEqual([]);
      expect(
        (await svc.levelUps(CH)).find((e) => e.twitchUserId === '1')?.reason,
      ).toBe('viewer_no_sound');
    });

    it('one sound per level-up; at most one per 60 s; one per viewer; never late; the viewer or the channel turning it off', async () => {
      await fixedNow();
      for (const id of ['1', '2', '3'])
        await svc.setViewerPrefs(CH, id, { level_up_sound: true });
      await presence(['1'], 1000 * 60);
      expect((await svc.claimLevelUps(CH, 'obs')).notices).toMatchObject([
        { twitchUserId: '1', sound: true },
      ]);
      clock.current = new Date(T0.getTime() + 30_000);
      await presence(['2'], 1000 * 60);
      expect((await svc.claimLevelUps(CH, 'obs')).notices).toEqual([]); // within 60 s: no sound at all
      clock.current = new Date(T0.getTime() + 2 * 60_000);
      // Two level-ups of one viewer waiting: one sound.
      await presence(['3'], 1000 * 60);
      await presence(['3'], 1000 * 60);
      const n = (await svc.claimLevelUps(CH, 'obs')).notices;
      expect(n.map((x) => [x.twitchUserId, x.level, x.sound])).toEqual([
        ['3', 3, true],
      ]);
      // Too old (2 min by default): expired, never played late.
      clock.current = new Date(T0.getTime() + 5 * 60_000);
      await presence(['1'], 1000 * 60);
      clock.current = new Date(clock.current.getTime() + 3 * 60_000);
      expect((await svc.claimLevelUps(CH, 'obs')).notices).toEqual([]);
      // The viewer turned it off between the level-up and the sound: nothing.
      clock.current = new Date(clock.current.getTime() + 60_000);
      await presence(['2'], 1000 * 60);
      await svc.setViewerPrefs(CH, '2', { level_up_sound: false });
      expect((await svc.claimLevelUps(CH, 'obs')).notices).toEqual([]);
      // The channel's sound off: skipped at once.
      await svc.updateSettings(CH, { rules: { level_up_sound: false } });
      await presence(['3'], 1000 * 60);
      const last = await svc.levelUps(CH);
      expect(last[0]).toMatchObject({ status: 'skipped', reason: 'sound_off' });
      const reasons = last.map((e) => e.reason);
      expect(reasons).toContain('sound_cooldown');
      expect(reasons).toContain('too_old');
      expect(reasons).toContain('viewer_no_sound');
      expect(last.filter((e) => e.status === 'merged').length).toBe(1);
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

    it('an imported « on » plays the sound of the next real level-up', async () => {
      await activate();
      await svc.updateSettings(CH, { rules: { level_up_sound: true } });
      await svc.importViewerPrefs(CH, { dry_run: false, rows });
      await presence(['1', '2'], 1000 * 60);
      expect(
        (await svc.claimLevelUps(CH, 'obs')).notices.map((n) => n.twitchUserId),
      ).toEqual(['1']);
    });
  });

  describe('chat announcements (LeCroupier_, the commands outbox)', () => {
    const steps = async () =>
      (
        await db.query<{ params: unknown; origin: string; key: string }>(
          `select params, origin, idempotency_key as key from cmd_steps where channel_id = $1 order by created_at, seq`,
          [CH],
        )
      ).map((r) => ({
        text: (typeof r.params === 'string' ? JSON.parse(r.params) : r.params)
          .text as string,
        origin: r.origin,
      }));
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

    it('one level-up: one line with the text of the channel; a replay writes nothing; an adjustment never', async () => {
      await chatOn();
      await presence(['1'], 1000 * 60);
      expect(await steps()).toEqual([
        {
          text: '@ana vient d’atteindre le niveau 2 !',
          origin: 'module:level_up',
        },
      ]);
      await db.tx((q) =>
        svc.presenceListener.validated(q, {
          streamId: 's1',
          seconds: 1000 * 60,
          viewerIds: ['1'],
          at: new Date(T0.getTime() + cycleSeq),
        }),
      );
      at(60_000);
      await toXp('1', 9000, 'adj-0000-ana9');
      expect((await steps()).length).toBe(1);
      // The text is the channel's (Studio): {pseudo} and {niveau} replaced.
      await svc.updateSettings(CH, {
        rules: { level_up_chat_text: 'GG {pseudo}, niveau {niveau} !' },
      });
      await presence(['2'], 1000 * 60);
      expect((await steps()).at(-1)?.text).toBe('GG bob, niveau 2 !');
      await expect(
        svc.updateSettings(CH, {
          rules: { level_up_chat_text: 'GG {pseudo}' },
        }),
      ).rejects.toThrow();
    });

    it('several viewers in one presence cycle: ONE grouped line; one viewer climbing two levels: once, at the final level', async () => {
      await chatOn();
      await toXp('4', 1500, 'adj-0000-dan1');
      await presence(['1', '2', '3', '4'], 1000 * 60);
      expect((await steps()).map((x) => x.text)).toEqual([
        'Montées de niveau : @ana (niveau 2), @bob (niveau 2), @cid (niveau 2), @dan (niveau 3) !',
      ]);
    });

    it('the interval: a level-up within 30 s waits and goes out grouped with the next; an old one is dropped', async () => {
      await chatOn();
      await presence(['1'], 1000 * 60); // T0: sent
      await toXp('2', 997, 'adj-0000-bob1');
      await toXp('3', 997, 'adj-0000-cid1');
      at(10_000);
      expect(await svc.onMessage(msg('2', 'bonsoir tout le monde'))).toBe('xp');
      at(15_000);
      expect(await svc.onMessage(msg('3', 'salut la team'))).toBe('xp');
      expect((await steps()).length).toBe(1); // both wait
      at(40_000);
      await presence(['5'], 60); // the next activity flushes
      expect((await steps()).map((x) => x.text)).toEqual([
        '@ana vient d’atteindre le niveau 2 !',
        'Montées de niveau : @bob (niveau 2), @cid (niveau 2) !',
      ]);
      // A level-up waiting longer than level_up_max_age_s (2 min): dropped, never sent late.
      at(50_000);
      await presence(['6'], 1000 * 60);
      at(50_000 + 3 * 60_000);
      await presence(['5'], 60);
      expect((await steps()).length).toBe(2);
      const fay = (await svc.levelUps(CH)).find((e) => e.twitchUserId === '6');
      expect(fay?.chat).toMatchObject({ status: 'expired', reason: 'too_old' });
    });

    it('the chat line does not depend on the sound choice; « Sortie chat réelle » off or the announcements off: nothing queued', async () => {
      await chatOn();
      await svc.setViewerPrefs(CH, '1', { level_up_sound: false });
      await presence(['1'], 1000 * 60);
      await chatOutput(false);
      at(60_000);
      await presence(['2'], 1000 * 60);
      await chatOutput(true);
      await svc.updateSettings(CH, { rules: { level_up_chat: false } });
      at(120_000);
      await presence(['3'], 1000 * 60);
      expect((await steps()).map((x) => x.text)).toEqual([
        '@ana vient d’atteindre le niveau 2 !', // sound off: announced all the same
      ]);
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
      });
    });

    it('the same level-up delivered three times at once: one event, one chat line', async () => {
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
      expect((await steps()).length).toBe(1);
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

  describe('level badges (one every 10 levels)', () => {
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
}
