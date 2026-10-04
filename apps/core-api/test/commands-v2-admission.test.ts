import { randomUUID } from 'node:crypto';
import type { CmdConfig, LabChatMessage } from '@raptoru/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandsAdmission } from '../src/commands/admission.js';
import { MAX_MESSAGE, sanitize } from '../src/commands/decide.js';
import { raffleReservedWords } from '../src/commands/reserved.js';
import { CommandsService } from '../src/commands/service.js';
import { CommandSteps } from '../src/commands/steps.js';
import type { Db } from '../src/db/db.js';
import { commandsRoutes } from '../src/http/commands-routes.js';
import { HttpError } from '../src/http/server.js';
import { LabChatRouter } from '../src/lab-chat/router.js';
import type { Actor } from '../src/lab-moderation/store.js';
import { RaffleLabService } from '../src/raffle-lab/raffle-lab-service.js';
import { count, createTestDb, FakeClock, MINUTE } from './helpers.js';

const CH = '900100';
const STUDIO: Actor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const T0 = new Date('2026-10-04T18:00:00Z'); // 20:00 Paris

let db: Db;
let clock: FakeClock;
let svc: CommandsService;
let adm: CommandsAdmission;
let raffle: RaffleLabService;
beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(T0);
  raffle = new RaffleLabService(db, clock);
  const reserved = raffleReservedWords(raffle);
  svc = new CommandsService(db, clock, { reserved });
  // Default follower provider: always unknown (no Helix provider yet).
  adm = new CommandsAdmission(db, clock, { reserved });
  await db.query(
    `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at, grants)
     values ($1, '502', 'supermod', 'studio:antoni', now(), '{}')`,
    [CH],
  );
});

/** A command, cooldown off unless asked. */
const make = (over: Partial<CmdConfig> = {}) =>
  svc.create(CH, STUDIO, {
    name: 'hug',
    reply: { mode: 'normal', text: 'Câlin de {display_name} !', to: 'none' },
    cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'viewer' },
    ...over,
  });

interface Who {
  id?: string;
  login?: string;
  role?: 'broadcaster' | 'moderator' | 'viewer';
  badges?: string[];
}
let seq = 0;
const msg = (
  text: string,
  who: Who = {},
  id = `m-${++seq}`,
): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter: {
    id: who.id ?? '700',
    login: who.login ?? 'pixelmamie',
    display_name: who.login ? who.login.toUpperCase() : 'PixelMamie',
    role: who.role ?? 'viewer',
    badges: who.badges ?? [],
  },
  source: 'twitch',
});
const say = (text: string, who?: Who, id?: string) =>
  adm.chat(msg(text, who, id));
const ALICE: Who = { id: '701', login: 'alice' };
const BOB: Who = { id: '702', login: 'bob' };
const STREAMER: Who = { id: CH, login: 'raptoru_', role: 'broadcaster' };
const AOUH: Who = { id: '501', login: 'aouh', role: 'moderator' };
const HUGO: Who = { id: '502', login: 'mod_hugo', role: 'moderator' }; // Lab supermod

const tester = (message: string, who: Who = {}, follower?: boolean) =>
  adm.test(CH, {
    actor: { id: 'antoni', role: 'broadcaster', via: 'studio' },
    message,
    viewer: {
      id: who.id ?? '700',
      login: who.login ?? 'pixelmamie',
      display_name: who.login ? who.login.toUpperCase() : 'PixelMamie',
      role: who.role ?? 'viewer',
      badges: who.badges ?? [],
      ...(follower === undefined ? {} : { follower }),
    },
  });

const rows = () =>
  db.query<{
    trigger: string;
    viewer_id: string;
    decision: string;
    reason: string | null;
    status: string;
    rendered: { reply: { text: string } | null } | null;
  }>('select * from cmd_invocations order by seq');

describe('Commands V2 admission — identification', () => {
  it('ignores what is not a Commands V2 command; the test explains « not_found »', async () => {
    await make();
    expect(await say('salut !hug')).toEqual({ outcome: 'ignored' });
    expect(await say('!nope')).toEqual({ outcome: 'ignored' });
    expect(await count(db, 'cmd_invocations')).toBe(0);
    expect(await tester('!nope')).toMatchObject({
      decision: 'rejected',
      reason: 'not_found',
      command_id: null,
    });
  });

  it('refuses a disabled command (recorded with its reason)', async () => {
    await make({ enabled: false });
    expect(await say('!hug')).toMatchObject({
      outcome: 'rejected',
      reason: 'disabled',
    });
    expect(await rows()).toMatchObject([
      { decision: 'rejected', reason: 'disabled', status: 'rejected' },
    ]);
  });

  it('refuses outside the availability (live only / offline only)', async () => {
    await make({ when: 'live' });
    expect(await say('!hug')).toMatchObject({ reason: 'unavailable' });
    await db.query(
      `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
       values ($1, $2, $3, 'simulated', 'test')`,
      [randomUUID(), CH, T0],
    );
    expect(await say('!hug')).toMatchObject({ outcome: 'accepted' });
  });

  it('refuses a stored configuration that became invalid (unknown variable) — invalid_config', async () => {
    const c = await make();
    await db.query(
      `update cmd_commands set config = jsonb_set(config, '{reply,text}', '"Salut {foo}"') where command_id = $1`,
      [c.command_id],
    );
    const out = await tester('!hug');
    expect(out).toMatchObject({ reason: 'invalid_config' });
    expect(JSON.stringify(out.detail)).toContain('unknown variable {foo}');
  });
});

describe('Commands V2 admission — audience', () => {
  it('one group: subs only', async () => {
    await make({ audience: { groups: ['subs'], allow: [], deny: [] } });
    expect(await say('!hug', ALICE)).toMatchObject({
      reason: 'access_denied',
    });
    expect(
      await say('!hug', { ...ALICE, badges: ['subscriber'] }),
    ).toMatchObject({ outcome: 'accepted' });
  });

  it('several groups add up (VIP or sub)', async () => {
    await make({ audience: { groups: ['subs', 'vips'], allow: [], deny: [] } });
    expect(await say('!hug', { ...BOB, badges: ['vip'] })).toMatchObject({
      outcome: 'accepted',
    });
    expect(await say('!hug', { ...ALICE, badges: ['founder'] })).toMatchObject({
      outcome: 'accepted',
    });
    expect(await say('!hug', { id: '703', login: 'carl' })).toMatchObject({
      reason: 'access_denied',
    });
  });

  it('supermods group: a supermod (Lab staff) passes, a plain moderator and the streamer do not', async () => {
    await make({ audience: { groups: ['supermods'], allow: [], deny: [] } });
    expect(await say('!hug', AOUH)).toMatchObject({ reason: 'access_denied' });
    expect(await say('!hug', HUGO)).toMatchObject({ outcome: 'accepted' });
    expect(await say('!hug', STREAMER)).toMatchObject({
      reason: 'access_denied',
    });
  });

  it('no implicit streamer exemption: « only Aouh » refuses the streamer', async () => {
    await make({ audience: { groups: [], allow: ['aouh'], deny: [] } });
    expect(await say('!hug', AOUH)).toMatchObject({ outcome: 'accepted' });
    expect(await say('!hug', STREAMER)).toMatchObject({
      reason: 'access_denied',
    });
    expect(await tester('!hug', STREAMER)).toMatchObject({
      decision: 'rejected',
      reason: 'access_denied',
    });
  });

  it('the streamer uses a command through the « broadcaster » group (own account only)', async () => {
    await make({ audience: { groups: ['broadcaster'], allow: [], deny: [] } });
    expect(await say('!hug', STREAMER)).toMatchObject({ outcome: 'accepted' });
    // A « broadcaster » badge on another account does not count.
    expect(
      await say('!hug', { id: '666', login: 'faker', role: 'broadcaster' }),
    ).toMatchObject({ reason: 'access_denied' });
    expect(await say('!hug', HUGO)).toMatchObject({ reason: 'access_denied' });
  });

  it('no implicit team exemption: mods and supermods follow the groups', async () => {
    await make({ audience: { groups: ['subs'], allow: [], deny: [] } });
    expect(await say('!hug', AOUH)).toMatchObject({ reason: 'access_denied' });
    expect(await say('!hug', HUGO)).toMatchObject({ reason: 'access_denied' });
  });

  it('everyone allows every user, the streamer included; deny applies to the streamer too', async () => {
    await make({
      audience: { groups: ['everyone'], allow: [], deny: ['raptoru_'] },
    });
    expect(await say('!hug', ALICE)).toMatchObject({ outcome: 'accepted' });
    expect(await say('!hug', AOUH)).toMatchObject({ outcome: 'accepted' });
    expect(await say('!hug', STREAMER)).toMatchObject({
      reason: 'denied_user',
    });
  });

  it('an allowed person passes without the group', async () => {
    await make({ audience: { groups: ['mods'], allow: ['alice'], deny: [] } });
    expect(await say('!hug', ALICE)).toMatchObject({ outcome: 'accepted' });
    expect(await say('!hug', BOB)).toMatchObject({ reason: 'access_denied' });
  });

  it('an excluded person is refused, even inside the groups (deny wins)', async () => {
    await make({
      audience: { groups: ['everyone'], allow: [], deny: ['bob'] },
    });
    expect(
      await say('!hug', { ...BOB, badges: ['subscriber', 'vip'] }),
    ).toMatchObject({ reason: 'denied_user' });
    expect(await say('!hug', ALICE)).toMatchObject({ outcome: 'accepted' });
  });

  it('a badge is never a proof of follow: VIP, sub, mod, streamer → follower unknown', async () => {
    await make({ audience: { groups: ['followers'], allow: [], deny: [] } });
    for (const who of [
      { ...ALICE, badges: ['vip'] },
      { ...ALICE, badges: ['subscriber'] },
      { ...AOUH, badges: ['moderator'] },
      { ...STREAMER, badges: ['broadcaster'] },
    ]) {
      expect(await say('!hug', who)).toMatchObject({
        outcome: 'rejected',
        reason: 'follower_status_unknown',
      });
      expect(await tester('!hug', who)).toMatchObject({
        reason: 'follower_status_unknown',
        viewer: { follower: null },
        detail: { follower_source: 'unknown' },
      });
    }
  });

  it('an explicit follower answer decides: true accepted, false refused, unknown explained', async () => {
    await make({ audience: { groups: ['followers'], allow: [], deny: [] } });
    expect(await tester('!hug', BOB, true)).toMatchObject({
      decision: 'accepted',
      follower_source: 'test',
    });
    expect(await tester('!hug', BOB, false)).toMatchObject({
      reason: 'access_denied',
      detail: { follower_source: 'test' },
    });
    expect(await tester('!hug', BOB)).toMatchObject({
      reason: 'follower_status_unknown',
      message: 'Impossible de savoir si BOB suit la chaîne.',
    });
  });

  it('followers + another group: the other group still lets in', async () => {
    await make({
      audience: { groups: ['followers', 'vips'], allow: [], deny: [] },
    });
    expect(await say('!hug', { ...ALICE, badges: ['vip'] })).toMatchObject({
      outcome: 'accepted',
    });
    expect(await say('!hug', BOB)).toMatchObject({
      reason: 'follower_status_unknown',
    });
  });
});

describe('Commands V2 admission — the real broadcaster of the channel (Lab channel ≠ Twitch id)', () => {
  // The Lab channel is 900100; its real Twitch broadcaster is another id (the Lab Core's configuration).
  const REAL = '83603689';
  const RAPTORU: Who = {
    id: REAL,
    login: 'raptoru_',
    role: 'broadcaster',
    badges: ['broadcaster', 'subscriber'],
  };
  const CROUPIER: Who = {
    id: '1239040922',
    login: 'lecroupier_',
    role: 'moderator',
    badges: ['moderator'],
  };
  const AOUH_MOD: Who = {
    id: '501',
    login: 'aouh',
    role: 'moderator',
    badges: ['moderator'],
  };
  const FAKE: Who = {
    id: '666',
    login: 'faker',
    role: 'broadcaster',
    badges: ['broadcaster'],
  };
  const VIEW: Who = { id: '700', login: 'pixelmamie' };
  let real: CommandsAdmission;
  beforeEach(() => {
    real = new CommandsAdmission(db, clock, {
      reserved: raffleReservedWords(raffle),
      broadcasterOf: () => REAL,
    });
  });
  const sayAs = (who: Who) => real.chat(msg('!hug', who));
  const testAs = (who: Who) =>
    real.test(CH, {
      actor: { id: 'antoni', role: 'broadcaster', via: 'studio' },
      message: '!hug',
      viewer: {
        id: who.id!,
        login: who.login!,
        display_name: who.login!.toUpperCase(),
        role: who.role ?? 'viewer',
        badges: who.badges ?? [],
      },
    });

  it('« Streamer » group: only the real broadcaster passes (by user id), never a role or a badge', async () => {
    await make({ audience: { groups: ['broadcaster'], allow: [], deny: [] } });
    expect(await sayAs(RAPTORU)).toMatchObject({ outcome: 'accepted' });
    expect((await testAs(RAPTORU)).viewer).toMatchObject({
      role: 'broadcaster',
      groups: expect.arrayContaining(['broadcaster']),
    });
    for (const who of [VIEW, AOUH_MOD, CROUPIER, FAKE])
      expect(await sayAs(who), who.login).toMatchObject({
        outcome: 'rejected',
        reason: 'access_denied',
      });
    // Even without the badge / role in the message, the identity decides.
    expect(
      await sayAs({ ...RAPTORU, role: 'viewer', badges: [] }),
    ).toMatchObject({ outcome: 'accepted' });
    // Without the configuration, the real broadcaster is not recognised (the bug this guards).
    expect(await adm.chat(msg('!hug', RAPTORU))).toMatchObject({
      outcome: 'rejected',
      reason: 'access_denied',
    });
  });

  it('allow still works, deny still wins, « Tout le monde » unchanged, no implicit streamer bypass', async () => {
    await make({
      name: 'aouhonly',
      audience: { groups: [], allow: ['aouh'], deny: [] },
    });
    await make({
      name: 'nostreamer',
      audience: { groups: ['everyone'], allow: [], deny: ['raptoru_'] },
    });
    await make({
      name: 'mods',
      audience: { groups: ['mods'], allow: [], deny: [] },
    });
    const as = (text: string, who: Who) => real.chat(msg(text, who));
    expect(await as('!aouhonly', AOUH_MOD)).toMatchObject({
      outcome: 'accepted',
    });
    expect(await as('!aouhonly', RAPTORU)).toMatchObject({
      reason: 'access_denied',
    });
    expect(await as('!nostreamer', RAPTORU)).toMatchObject({
      reason: 'denied_user',
    });
    expect(await as('!nostreamer', VIEW)).toMatchObject({
      outcome: 'accepted',
    });
    expect(await as('!mods', RAPTORU)).toMatchObject({
      reason: 'access_denied',
    });
  });

  it('« Tester » (Studio simulator) and the real admission take the same decision', async () => {
    await make({ audience: { groups: ['broadcaster'], allow: [], deny: [] } });
    for (const who of [RAPTORU, VIEW, AOUH_MOD, CROUPIER, FAKE]) {
      const t = await testAs(who);
      const r = await sayAs(who);
      expect(
        [r.outcome === 'accepted' ? null : r.reason, r.message],
        who.login,
      ).toEqual([t.reason, t.message]);
    }
  });
});

describe('Commands V2 admission — arguments and variables', () => {
  const hug = () =>
    make({
      args: [{ name: 'cible', type: 'mention', required: true }],
      reply: {
        mode: 'normal',
        text: '{display_name} fait un câlin à {target} ({count})',
        to: 'none',
      },
    });

  it('refuses a missing required argument, with the syntax', async () => {
    await hug();
    expect(await tester('!hug')).toMatchObject({
      reason: 'invalid_arguments',
      detail: { arg: 'cible', error: 'missing', syntax: '!hug @cible' },
    });
    expect(await tester('!hug pixel')).toMatchObject({
      reason: 'invalid_arguments',
      detail: { error: 'not_a_mention' },
    });
  });

  it('renders the variables with a valid target, frozen in the invocation', async () => {
    await hug();
    expect(await say('!hug @Bob')).toMatchObject({ outcome: 'accepted' });
    expect(await say('!hug @Alice', ALICE)).toMatchObject({
      outcome: 'accepted',
    });
    const r = await rows();
    expect(r.map((x) => x.rendered?.reply?.text)).toEqual([
      'PixelMamie fait un câlin à Bob (1)',
      'ALICE fait un câlin à Alice (2)',
    ]);
  });

  it('renders {user} {args} {amount}, the addressee and the Twitch reply', async () => {
    await make({
      args: [
        { name: 'nb', type: 'number', required: true },
        { name: 'mot', type: 'text', required: false },
      ],
      reply: {
        mode: 'reply',
        text: '{user} donne {amount} ({args})',
        to: 'none',
      },
      actions: [
        {
          id: randomUUID(),
          type: 'chat',
          v: 1,
          on_error: 'continue',
          mode: 'me',
          text: 'merci',
          to: 'author',
        },
      ],
    });
    const out = await tester('!hug 12 pour toi');
    expect(out).toMatchObject({
      decision: 'accepted',
      args: { nb: 12, mot: 'pour toi' },
      rendered: {
        reply: { mode: 'reply', text: 'pixelmamie donne 12 (12 pour toi)' },
        actions: [{ type: 'chat', mode: 'me', text: '@PixelMamie merci' }],
      },
    });
    await say('!hug 3', {}, 'tw-77');
    expect((await rows())[0]!.rendered).toMatchObject({
      reply: { reply_to: 'tw-77' },
    });
    expect(await tester('!hug douze')).toMatchObject({
      detail: { error: 'not_a_number' },
    });
  });

  it('refuses cleanly a variable without value (optional target absent)', async () => {
    await make({
      args: [{ name: 'cible', type: 'mention', required: false }],
      reply: { mode: 'normal', text: 'Coucou {target}', to: 'none' },
    });
    expect(await tester('!hug')).toMatchObject({
      reason: 'invalid_arguments',
      detail: { variable: 'target' },
    });
    expect(await tester('!hug @x')).toMatchObject({ decision: 'accepted' });
  });

  it('sanitizes: one line, never a chat command, at most 500 characters', async () => {
    expect(sanitize('/ban\nquelqu’un')).toBe('ban quelqu’un');
    expect(sanitize('.timeout x')).toBe('timeout x');
    await make({
      args: [{ name: 'mot', type: 'text', required: true }],
      reply: { mode: 'normal', text: `{args} ${'x'.repeat(200)}`, to: 'none' },
    });
    const out = await tester(`!hug ${'y'.repeat(400)}`);
    expect(out.rendered!.reply!.text).toHaveLength(MAX_MESSAGE);
    expect(out.rendered!.reply!.text.endsWith('…')).toBe(true);
  });
});

describe('Commands V2 admission — cooldown and quota', () => {
  const cd = (scope: 'viewer' | 'global') =>
    make({ cooldown: { enabled: true, seconds: 30, unit: 's', scope } });
  const quota = (
    window: 'hour' | 'live' | 'day' | 'total',
    scope: 'viewer' | 'global',
    max = 1,
  ) => make({ quota: { enabled: true, max, window, scope } });

  it('viewer cooldown: per person', async () => {
    await cd('viewer');
    expect(await say('!hug', ALICE)).toMatchObject({ outcome: 'accepted' });
    clock.advance(10_000);
    expect(await say('!hug', ALICE)).toMatchObject({ reason: 'cooldown' });
    expect(await tester('!hug', ALICE)).toMatchObject({
      detail: { remaining_s: 20, scope: 'viewer' },
    });
    expect(await say('!hug', BOB)).toMatchObject({ outcome: 'accepted' });
    clock.advance(20_000);
    expect(await say('!hug', ALICE)).toMatchObject({ outcome: 'accepted' });
  });

  it('global cooldown: everybody waits; a refused use does not restart it', async () => {
    await cd('global');
    expect(await say('!hug', ALICE)).toMatchObject({ outcome: 'accepted' });
    clock.advance(20_000);
    expect(await say('!hug', BOB)).toMatchObject({ reason: 'cooldown' });
    clock.advance(10_000);
    expect(await say('!hug', BOB)).toMatchObject({ outcome: 'accepted' });
  });

  it('viewer quota (total): per person', async () => {
    await quota('total', 'viewer', 2);
    expect(await say('!hug', ALICE)).toMatchObject({ outcome: 'accepted' });
    expect(await say('!hug', ALICE)).toMatchObject({ outcome: 'accepted' });
    expect(await say('!hug', ALICE)).toMatchObject({
      reason: 'quota',
      message: 'Maximum atteint : 2 sur 2 au total pour toi.',
    });
    expect(await say('!hug', BOB)).toMatchObject({ outcome: 'accepted' });
    clock.advance(400 * 24 * 60 * MINUTE);
    expect(await say('!hug', ALICE)).toMatchObject({ reason: 'quota' });
  });

  it('global quota, hour window: the last 60 minutes', async () => {
    await quota('hour', 'global');
    expect(await say('!hug', ALICE)).toMatchObject({ outcome: 'accepted' });
    clock.advance(59 * MINUTE);
    expect(await say('!hug', BOB)).toMatchObject({ reason: 'quota' });
    clock.advance(2 * MINUTE);
    expect(await say('!hug', BOB)).toMatchObject({ outcome: 'accepted' });
  });

  it('day window: the stream day (reset 16:00 Paris)', async () => {
    await quota('day', 'global');
    expect(await say('!hug')).toMatchObject({ outcome: 'accepted' });
    clock.set(new Date('2026-10-05T13:59:00Z')); // 15:59 Paris: same stream day
    expect(await say('!hug')).toMatchObject({ reason: 'quota' });
    clock.set(new Date('2026-10-05T14:00:00Z')); // 16:00 Paris: new day
    expect(await say('!hug')).toMatchObject({ outcome: 'accepted' });
  });

  it('live window: since the start of the current live', async () => {
    await quota('live', 'global');
    const s1 = randomUUID();
    await db.query(
      `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
       values ($1, $2, $3, 'simulated', 'test')`,
      [s1, CH, T0],
    );
    clock.advance(MINUTE);
    expect(await say('!hug')).toMatchObject({ outcome: 'accepted' });
    expect(await say('!hug')).toMatchObject({ reason: 'quota' });
    clock.advance(MINUTE);
    await db.query(
      'update lab_stream_sessions set ended_at = $2 where session_id = $1',
      [s1, clock.now()],
    );
    clock.advance(MINUTE);
    await db.query(
      `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by)
       values ($1, $2, $3, 'simulated', 'test')`,
      [randomUUID(), CH, clock.now()],
    );
    expect(await say('!hug')).toMatchObject({ outcome: 'accepted' });
  });

  it('cooldown and quota together: the cooldown is checked first', async () => {
    await make({
      cooldown: { enabled: true, seconds: 60, unit: 's', scope: 'viewer' },
      quota: { enabled: true, max: 2, window: 'hour', scope: 'viewer' },
    });
    await say('!hug');
    expect(await say('!hug')).toMatchObject({ reason: 'cooldown' });
    clock.advance(MINUTE);
    expect(await say('!hug')).toMatchObject({ outcome: 'accepted' });
    clock.advance(MINUTE);
    expect(await say('!hug')).toMatchObject({ reason: 'quota' });
  });

  it('an alias shares the counters of its command', async () => {
    await make({
      aliases: ['calin'],
      cooldown: { enabled: true, seconds: 30, unit: 's', scope: 'global' },
    });
    expect(await say('!hug', ALICE)).toMatchObject({ outcome: 'accepted' });
    expect(await say('!CALIN', BOB)).toMatchObject({ reason: 'cooldown' });
    expect((await rows()).map((r) => r.trigger)).toEqual(['hug', 'calin']);
  });

  it('concurrent admissions never exceed the quota', async () => {
    await quota('total', 'global', 3);
    const out = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        say('!hug', { id: String(800 + i), login: `v${i}` }),
      ),
    );
    expect(out.filter((o) => o.outcome === 'accepted')).toHaveLength(3);
    expect(out.filter((o) => o.reason === 'quota')).toHaveLength(9);
  });
});

describe('Commands V2 admission — records, test, isolation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('dedupes the same Twitch message (redelivery): admitted once, not counted twice', async () => {
    await make({
      quota: { enabled: true, max: 5, window: 'total', scope: 'global' },
    });
    const first = await say('!hug', ALICE, 'tw-1');
    expect(await say('!hug', ALICE, 'tw-1')).toEqual({
      outcome: 'rejected',
      reason: 'duplicate_message',
      replayed: true,
      invocation_id: first.invocation_id,
      original: { decision: 'accepted', reason: null },
    });
    expect(await count(db, 'cmd_invocations')).toBe(1);
  });

  it('keeps the history of accepted and refused invocations (team only)', async () => {
    const c = await make({
      audience: { groups: ['subs'], allow: [], deny: [] },
    });
    await say('!hug', ALICE);
    await say('!hug', { ...BOB, badges: ['subscriber'] });
    const h = await adm.invocations(CH, STUDIO, c.command_id, 50);
    expect(
      h.invocations.map((i) => [
        i.viewer_login,
        i.decision,
        i.reason,
        i.status,
      ]),
    ).toEqual([
      ['bob', 'accepted', null, 'dispatched'],
      ['alice', 'rejected', 'access_denied', 'rejected'],
    ]);
    expect(h.invocations[1]!.reason_detail).toMatchObject({
      message: 'ALICE n’a pas accès à cette commande.',
    });
    await expect(
      adm.invocations(
        CH,
        { id: '503', role: 'viewer', via: 'extension' },
        null,
        50,
      ),
    ).rejects.toMatchObject({ code: 'team_only' });
  });

  it('« Tester » takes the same decision as the admission and writes nothing', async () => {
    await make({
      audience: { groups: ['subs'], allow: [], deny: ['bob'] },
      quota: { enabled: true, max: 1, window: 'total', scope: 'viewer' },
      args: [{ name: 'cible', type: 'mention', required: true }],
      reply: { mode: 'normal', text: 'Câlin à {target}', to: 'none' },
    });
    const sub = { ...ALICE, badges: ['subscriber'] };
    const cases: [string, Who][] = [
      ['!hug @x', ALICE],
      ['!hug @x', BOB],
      ['!hug', sub],
      ['!hug @x', sub],
      ['!hug @x', sub],
    ];
    for (const [text, who] of cases) {
      const before = await count(db, 'cmd_invocations');
      const t = await tester(text, who);
      expect(await count(db, 'cmd_invocations')).toBe(before);
      const real = await say(text, who);
      expect([
        real.outcome === 'accepted' ? null : real.reason,
        real.message,
      ]).toEqual([t.reason, t.message]);
    }
    expect((await rows()).map((r) => r.reason)).toEqual([
      'access_denied',
      'denied_user',
      'invalid_arguments',
      null,
      'quota',
    ]);
  });

  it('Core never calls Twitch itself: the answer is dispatched as durable steps', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await make();
    expect(await say('!hug')).toMatchObject({ outcome: 'accepted' });
    expect(fetch).not.toHaveBeenCalled();
    expect((await rows())[0]!.status).toBe('dispatched');
  });

  it('Tombola keeps its words: !join goes to Tombola only, !hug to Commands only', async () => {
    await make();
    await expect(make({ name: 'join' })).rejects.toMatchObject({
      code: 'word_reserved',
    });
    const router = new LabChatRouter([
      { name: 'raffle', chat: (m) => raffle.chat(m) },
      { name: 'commands', chat: (m) => adm.chat(m) },
    ]);
    const join = await router.message(msg('!join'));
    expect(join.handled.map((h) => h.module)).toEqual(['raffle']);
    const hug = await router.message(msg('!hug'));
    expect(hug.handled).toEqual([
      expect.objectContaining({ module: 'commands', outcome: 'accepted' }),
    ]);
    expect(await tester('!join')).toMatchObject({
      reason: 'reserved',
      detail: { module: 'raffle' },
    });
  });
});

describe('Commands V2 admission — routes and public list', () => {
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const url = new URL(path, 'http://lab');
    const route = commandsRoutes(svc, adm, new CommandSteps(db, clock)).find(
      (r) => r.method === method && r.pattern.test(url.pathname),
    );
    if (!route) throw new Error(`no route ${method} ${path}`);
    try {
      return {
        status: 200,
        body: (await route.handle({
          params: route.pattern.exec(url.pathname)!.slice(1),
          url,
          body,
        })) as Record<string, unknown>,
      };
    } catch (e) {
      if (e instanceof HttpError)
        return { status: e.status, body: e.body as Record<string, unknown> };
      throw e;
    }
  };

  it('POST /test, GET /invocations, GET /public', async () => {
    const c = await make({ description: 'Un câlin', aliases: ['calin'] });
    await make({ name: 'secret', listed: false });
    const off = await make({ name: 'off', enabled: false });
    const gone = await make({ name: 'gone' });
    await svc.remove(CH, gone.command_id, STUDIO, gone.version);
    const t = await call('POST', `/v1/lab/commands/${CH}/test`, {
      actor: { id: 'antoni', role: 'broadcaster', via: 'studio' },
      message: '!hug',
      viewer: {
        id: '700',
        login: 'pixelmamie',
        display_name: 'PixelMamie',
        role: 'viewer',
      },
    });
    expect(t).toMatchObject({
      status: 200,
      body: { decision: 'accepted', simulated: true },
    });
    expect(
      await call('POST', `/v1/lab/commands/${CH}/test`, {
        actor: { id: 'antoni', role: 'broadcaster', via: 'studio' },
        message: 'bonjour',
        viewer: {
          id: '700',
          login: 'pixelmamie',
          display_name: 'P',
          role: 'viewer',
        },
      }),
    ).toMatchObject({ status: 422, body: { error: 'not_a_command' } });
    await say('!hug');
    const inv = await call(
      'GET',
      `/v1/lab/commands/${CH}/invocations?command_id=${c.command_id}`,
    );
    expect((inv.body.invocations as unknown[]).length).toBe(1);
    expect(
      await call(
        'GET',
        `/v1/lab/commands/${CH}/invocations?as=503&as_role=viewer`,
      ),
    ).toMatchObject({ status: 403 });
    const pub = await call('GET', `/v1/lab/commands/${CH}/public`);
    expect(pub.body).toEqual({
      live: false,
      categories: [],
      uncategorized: [
        {
          name: 'hug',
          aliases: ['calin'],
          description: 'Un câlin',
          appearance: { icon: 'chat', color: '#8b5cf6' },
          syntax: '!hug',
          audience: { groups: ['everyone'], named_people: false },
          cooldown: null,
          quota: null,
          when: 'always',
          available_now: true,
        },
      ],
    });
    expect(off.config.enabled).toBe(false);
  });
});
