import { randomUUID } from 'node:crypto';
import {
  type CmdConfig,
  CmdDelegateRequest,
  type LabChatMessage,
} from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandsAdmission } from '../src/commands/admission.js';
import { CommandsService } from '../src/commands/service.js';
import type { Db } from '../src/db/db.js';
import type { Actor } from '../src/lab-moderation/store.js';
import { createTestDb, FakeClock } from './helpers.js';

// Commandes Chat V2.1 (docs/COMMANDS_V2_STATUS.md): every role allowed by a command (the streamer by identity, VIP,
// moderators, supermods), the keyword triggers (a message that contains an expression, once per message) and the
// delegated editors (config.editors: on / off and expressions only, checked by Core at every change).

const CH = '83603689'; // a Production-like channel: its id IS the streamer's Twitch id
const STREAMER_ID = '83603689';
const STUDIO: Actor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const STUDIO_ACTOR = {
  id: 'antoni',
  role: 'broadcaster',
  via: 'studio',
} as const;
const T0 = new Date('2026-11-15T20:00:00Z');
const SOUND = '0123456789abcdef';

let db: Db;
let clock: FakeClock;
let svc: CommandsService;
let adm: CommandsAdmission;
beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(T0);
  svc = new CommandsService(db, clock);
  adm = new CommandsAdmission(db, clock, {
    broadcasterOf: () => STREAMER_ID,
  });
  // 602 is a supermod of the channel (Studio › Équipe); 601 a plain moderator.
  await db.query(
    `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at, grants)
     values ($1, '602', 'supermod', 'studio:antoni', now(), '{}')`,
    [CH],
  );
});

const sound = () => ({
  type: 'sound' as const,
  v: 1 as const,
  id: randomUUID(),
  on_error: 'continue' as const,
  sound: SOUND,
  label: 'Gros lot',
});
const make = (over: Partial<CmdConfig> = {}) =>
  svc.create(CH, STUDIO, {
    name: 'groslot',
    reply: { mode: 'silent', text: '', to: 'none' },
    actions: [sound()],
    cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'viewer' },
    ...over,
  });
const audience = (
  groups: CmdConfig['audience']['groups'],
  more: Partial<CmdConfig['audience']> = {},
): CmdConfig['audience'] => ({ groups, allow: [], deny: [], ...more });

interface Who {
  id: string;
  login: string;
  role?: 'broadcaster' | 'moderator' | 'viewer';
  badges?: string[];
}
const STREAMER: Who = {
  id: STREAMER_ID,
  login: 'raptoru_',
  role: 'broadcaster',
  badges: ['broadcaster', 'subscriber'],
};
const VIP: Who = { id: '301', login: 'luna', badges: ['vip'] };
const MOD: Who = {
  id: '601',
  login: 'modo',
  role: 'moderator',
  badges: ['moderator'],
};
const SUPERMOD: Who = {
  id: '602',
  login: 'super',
  role: 'moderator',
  badges: ['moderator'],
};
const AOUH: Who = { id: '501', login: 'aouh' };
const BOB: Who = { id: '702', login: 'bob' };

let seq = 0;
const msg = (text: string, who: Who, id = `m-${++seq}`): LabChatMessage => ({
  channel_id: CH,
  message_id: id,
  text,
  chatter: {
    id: who.id,
    login: who.login,
    display_name: who.login,
    role: who.role ?? 'viewer',
    badges: who.badges ?? [],
  },
  source: 'twitch',
});
const say = async (text: string, who: Who, id?: string) =>
  (await adm.chat(msg(text, who, id))) as {
    outcome: string;
    reason?: string | null;
  };
const sounds = async () =>
  Number(
    (await db.query<{ n: string }>('select count(*) as n from cmd_sounds'))[0]!
      .n,
  );
const invocations = async () =>
  db.query<{ trigger: string; decision: string; reason: string | null }>(
    'select trigger, decision, reason from cmd_invocations order by seq',
  );

describe('roles: each allowed role uses the command, without its pseudo in a list', () => {
  it('« Streamer »: the broadcaster (by identity) uses it; a viewer claiming the broadcaster badge never does', async () => {
    await make({ audience: audience(['broadcaster']) });
    expect(await say('!groslot', STREAMER)).toMatchObject({
      outcome: 'accepted',
    });
    expect(await sounds()).toBe(1);
    const fake = await say('!groslot', {
      id: '999',
      login: 'faker',
      role: 'broadcaster',
      badges: ['broadcaster'],
    });
    expect(fake).toMatchObject({
      outcome: 'rejected',
      reason: 'access_denied',
    });
    expect(await sounds()).toBe(1);
  });

  it('a Lab channel (900100) recognises the real streamer through its Twitch id, never its fictional channel id from Twitch', async () => {
    const lab = new CommandsAdmission(db, clock, {
      broadcasterOf: () => STREAMER_ID,
    });
    await svc.create('900100', STUDIO, {
      name: 'labcmd',
      reply: { mode: 'normal', text: 'ok', to: 'none' },
      audience: audience(['broadcaster']),
    });
    const at = (who: Who) =>
      lab.chat({ ...msg('!labcmd', who), channel_id: '900100' });
    expect(await at(STREAMER)).toMatchObject({ outcome: 'accepted' });
    expect(
      await at({ id: '900100', login: 'x', role: 'broadcaster' }),
    ).toMatchObject({ outcome: 'rejected', reason: 'access_denied' });
  });

  it('« VIP », « Modérateurs », « Supermodos »: each one alone, and the refusals of the others', async () => {
    await make({ name: 'vip', audience: audience(['vips']) });
    await make({ name: 'mods', audience: audience(['mods']) });
    await make({ name: 'supers', audience: audience(['supermods']) });
    const r = async (word: string, who: Who) =>
      (await say(`!${word}`, who)).outcome;
    expect(await r('vip', VIP)).toBe('accepted');
    expect(await r('vip', BOB)).toBe('rejected');
    expect(await r('vip', MOD)).toBe('rejected');
    expect(await r('mods', MOD)).toBe('accepted');
    expect(await r('mods', SUPERMOD)).toBe('accepted'); // a supermod is a moderator too
    expect(await r('mods', VIP)).toBe('rejected');
    expect(await r('supers', SUPERMOD)).toBe('accepted');
    expect(await r('supers', MOD)).toBe('rejected');
    // No implicit exemption: the streamer is not a moderator group member (« Streamer » is its own group).
    expect(await r('mods', STREAMER)).toBe('rejected');
  });

  it('several groups are OR, never AND; viewers by Twitch id add up; « Exclure » wins', async () => {
    await make({
      audience: audience(['vips', 'broadcaster'], {
        allow_ids: [{ id: AOUH.id, name: 'Aouh' }],
        deny: ['luna'],
      }),
    });
    expect((await say('!groslot', STREAMER)).outcome).toBe('accepted');
    expect((await say('!groslot', AOUH)).outcome).toBe('accepted');
    expect(
      (await say('!groslot', { ...VIP, login: 'other_vip', id: '302' }))
        .outcome,
    ).toBe('accepted');
    expect(await say('!groslot', VIP)).toMatchObject({ reason: 'denied_user' });
    expect(await say('!groslot', MOD)).toMatchObject({
      reason: 'access_denied',
    });
    expect(await say('!groslot', BOB)).toMatchObject({
      reason: 'access_denied',
    });
    expect(await sounds()).toBe(3);
  });

  it('the observed case: « Streamer » works; a per-person cooldown refuses the streamer silently (journal: cooldown)', async () => {
    await make({
      audience: audience(['broadcaster']),
      cooldown: { enabled: true, seconds: 300, unit: 'min', scope: 'viewer' },
    });
    expect((await say('!groslot', STREAMER)).outcome).toBe('accepted');
    clock.current = new Date(T0.getTime() + 160_000);
    expect(await say('!groslot', STREAMER)).toMatchObject({
      reason: 'cooldown',
    });
    expect(await invocations()).toMatchObject([
      { decision: 'accepted' },
      { decision: 'rejected', reason: 'cooldown' },
    ]);
  });

  it('« Tester » as « Streamer » (the channel id the list gives Studio) is the real streamer: accepted, the real cooldown shows', async () => {
    const c = await make({
      audience: audience(['broadcaster']),
      cooldown: { enabled: true, seconds: 300, unit: 'min', scope: 'viewer' },
    });
    // Studio's « Streamer » viewer: the channel id of the list (identity), not the Lab's 900100.
    const streamerId = (await svc.list(CH, STUDIO)).channel_id;
    const test = () =>
      adm.test(CH, {
        actor: STUDIO_ACTOR,
        message: '!groslot',
        command_id: c.command_id,
        viewer: {
          id: streamerId,
          login: 'raptoru_',
          display_name: 'Raptoru_',
          role: 'broadcaster',
          badges: ['broadcaster'],
        },
      });
    expect(await test()).toMatchObject({
      decision: 'accepted',
      viewer: { role: 'broadcaster' },
    });
    await say('!groslot', STREAMER);
    expect(await test()).toMatchObject({ reason: 'cooldown' });
    // A fictional id claiming « Streamer » is refused, in the test as in the chat.
    expect(
      await adm.test(CH, {
        actor: STUDIO_ACTOR,
        message: '!groslot',
        viewer: {
          id: '900100',
          login: 'raptoru_',
          display_name: 'Raptoru_',
          role: 'broadcaster',
          badges: ['broadcaster'],
        },
      }),
    ).toMatchObject({ reason: 'access_denied' });
  });

  it('a viewer blocked « everywhere » by the moderation launches no command', async () => {
    await make({ audience: audience(['everyone']) });
    await db.query(
      `insert into lab_viewer_blocks (channel_id, viewer_id, module_id, until, reason, actor, created_at)
       values ($1, $2, 'all', null, 'test', 'test', $3)`,
      [CH, BOB.id, clock.now()],
    );
    expect(await say('!groslot', BOB)).toMatchObject({ reason: 'blocked' });
    expect((await say('!groslot', AOUH)).outcome).toBe('accepted');
  });
});

/** Aouh's « ao »: only her (by Twitch id), the sound only. */
const ao = (over: Partial<CmdConfig> = {}) =>
  make({
    name: 'ao',
    audience: audience([], { allow_ids: [{ id: AOUH.id, name: 'Aouh' }] }),
    trigger: { mode: 'keywords', keywords: ['ao', 'gros lot'], match: 'word' },
    ...over,
  });

describe('keyword triggers: a message that contains an expression', () => {
  it('Aouh writes « ao » in a sentence → one sound; without the word → nothing; Bob → nothing, not even a journal line', async () => {
    await ao();
    expect(await say("Franchement ao c'est trop drôle", AOUH)).toMatchObject({
      outcome: 'accepted',
    });
    expect(await sounds()).toBe(1);
    expect(await say('chaos total, aouh', AOUH)).toMatchObject({
      outcome: 'ignored',
    });
    expect(await say('AO !', BOB)).toMatchObject({ outcome: 'ignored' });
    expect(await sounds()).toBe(1);
    expect(await invocations()).toEqual([
      { trigger: 'ao', decision: 'accepted', reason: null },
    ]);
  });

  it('several expressions in one message → ONE use; a replayed message → none', async () => {
    await ao();
    await say('ao ao, le gros lot ! ao', AOUH, 'tw-1');
    await say('ao ao, le gros lot ! ao', AOUH, 'tw-1');
    expect(await sounds()).toBe(1);
    expect(await invocations()).toHaveLength(1);
  });

  it('the cooldown holds: refused (journal: cooldown), no sound, never a refusal answer in the chat', async () => {
    await ao({
      cooldown: { enabled: true, seconds: 30, unit: 's', scope: 'viewer' },
      refuse: { mode: 'explain', text: '' },
    });
    expect((await say('ao', AOUH)).outcome).toBe('accepted');
    clock.current = new Date(T0.getTime() + 5_000);
    expect(await say('encore ao', AOUH)).toMatchObject({ reason: 'cooldown' });
    expect(await sounds()).toBe(1);
    expect(
      await db.query("select 1 from cmd_steps where kind = 'refusal'"),
    ).toEqual([]);
    clock.current = new Date(T0.getTime() + 31_000);
    expect((await say('ao', AOUH)).outcome).toBe('accepted');
  });

  it('« n’importe où » finds it inside a word; « !ao » (its name) launches nothing; an exact command takes its own message', async () => {
    await ao({
      trigger: { mode: 'keywords', keywords: ['ao'], match: 'anywhere' },
    });
    await svc.create(CH, STUDIO, {
      name: 'hug',
      reply: { mode: 'normal', text: 'câlin', to: 'none' },
    });
    expect((await say('chaos', AOUH)).outcome).toBe('accepted');
    clock.current = new Date(T0.getTime() + 1_000);
    expect((await say('!hug ao', AOUH)).outcome).toBe('accepted');
    expect((await invocations()).map((i) => i.trigger)).toEqual(['ao', 'hug']);
  });

  it('a change is followed at the next message (no restart): new expression on, old one off, off, deleted', async () => {
    const c = await ao();
    expect((await say('ao', AOUH)).outcome).toBe('accepted');
    const v2 = await svc.update(CH, c.command_id, STUDIO, c.version, {
      trigger: { mode: 'keywords', keywords: ['bingo'], match: 'word' },
    });
    expect((await say('ao', AOUH)).outcome).toBe('ignored');
    expect((await say('BINGO', AOUH)).outcome).toBe('accepted');
    const v3 = await svc.update(CH, c.command_id, STUDIO, v2.version, {
      enabled: false,
    });
    expect((await say('bingo', AOUH)).outcome).toBe('ignored');
    await svc.remove(CH, c.command_id, STUDIO, v3.version);
    expect((await say('bingo', AOUH)).outcome).toBe('ignored');
  });

  it('a plain message that matches no expression costs no query', async () => {
    await ao();
    await say('bonjour', BOB); // the rules are read once
    let queries = 0;
    const real = db.query.bind(db);
    db.query = (async (...a: Parameters<Db['query']>) => {
      queries++;
      return real(...a);
    }) as Db['query'];
    const realTx = db.tx.bind(db);
    db.tx = (async (fn: Parameters<Db['tx']>[0]) => {
      queries++;
      return realTx(fn);
    }) as Db['tx'];
    for (let i = 0; i < 20; i++) await say(`message ${i} sans rien`, BOB);
    expect(queries).toBe(0);
    db.query = real;
    db.tx = realTx;
  });

  it('the public list (extension) shows the commands to type, never a keyword command nor its expressions', async () => {
    await ao();
    await make({ name: 'hug', audience: audience(['everyone']) });
    const pub = await adm.publicList(CH);
    expect(pub.uncategorized.map((c) => c.name)).toEqual(['hug']);
    expect(JSON.stringify(pub)).not.toContain('gros lot');
  });

  it('a keyword command takes no argument nor {args}', async () => {
    await expect(
      ao({ args: [{ name: 'x', type: 'text', required: false }] }),
    ).rejects.toMatchObject({ code: 'invalid_config' });
    await expect(
      ao({ reply: { mode: 'normal', text: 'vu : {args}', to: 'none' } }),
    ).rejects.toMatchObject({ code: 'invalid_config' });
  });
});

const AOUH_ACTOR = {
  id: AOUH.id,
  login: 'aouh',
  display_name: 'Aouh',
  role: 'viewer' as const,
  via: 'extension' as const,
};
const BOB_ACTOR = {
  ...AOUH_ACTOR,
  id: BOB.id,
  login: 'bob',
  display_name: 'Bob',
};

describe('delegated editors: on / off and expressions only, checked by Core', () => {
  it('no command is editable by default; the streamer names Aouh; she sees only hers, as an editor sees it', async () => {
    const c = await ao();
    expect(await svc.delegated(CH, AOUH.id)).toEqual({ commands: [] });
    const v2 = await svc.update(CH, c.command_id, STUDIO, c.version, {
      editors: [{ id: AOUH.id, name: 'Aouh' }],
    });
    const mine = await svc.delegated(CH, AOUH.id);
    expect(mine.commands).toEqual([
      {
        command_id: c.command_id,
        version: v2.version,
        name: 'ao',
        enabled: true,
        trigger: {
          mode: 'keywords',
          keywords: ['ao', 'gros lot'],
          match: 'word',
        },
        editable: ['enabled', 'keywords'],
        updated_at: expect.any(String),
      },
    ]);
    // Nothing else of the command reaches the editor (no sound, audience, delays, other editors).
    expect(JSON.stringify(mine)).not.toMatch(
      /allow_ids|sound|cooldown|editors/,
    );
    expect(await svc.delegated(CH, BOB.id)).toEqual({ commands: [] });
  });

  it('Aouh changes an expression: the new one works, the old one no longer; off → nothing; on again → it works', async () => {
    const c = await ao({ editors: [{ id: AOUH.id, name: 'Aouh' }] });
    const v2 = await svc.delegateUpdate(CH, c.command_id, {
      actor: AOUH_ACTOR,
      expected_version: c.version,
      keywords: ['ouaf'],
    });
    expect(v2.trigger.keywords).toEqual(['ouaf']);
    expect((await say('ao', AOUH)).outcome).toBe('ignored');
    expect((await say('ouaf ouaf', AOUH)).outcome).toBe('accepted');
    const v3 = await svc.delegateUpdate(CH, c.command_id, {
      actor: AOUH_ACTOR,
      expected_version: v2.version,
      enabled: false,
    });
    clock.current = new Date(T0.getTime() + 60_000);
    expect((await say('ouaf', AOUH)).outcome).toBe('ignored');
    await svc.delegateUpdate(CH, c.command_id, {
      actor: AOUH_ACTOR,
      expected_version: v3.version,
      enabled: true,
    });
    expect((await say('ouaf', AOUH)).outcome).toBe('accepted');
    // The history keeps each change, with Aouh as an « editor » from the extension.
    const h = await svc.history(CH, c.command_id, STUDIO);
    expect(h.entries.slice(0, 3)).toMatchObject([
      {
        actor_id: AOUH.id,
        actor_role: 'editor',
        via: 'extension',
        changes: [{ field: 'enabled' }],
      },
      { actor_role: 'editor', changes: [{ field: 'enabled' }] },
      { actor_role: 'editor', changes: [{ field: 'trigger' }] },
    ]);
    // The sound, the audience and everything else are untouched.
    const now = await svc.get(CH, c.command_id, STUDIO);
    expect(now.config.actions).toEqual(c.config.actions);
    expect(now.config.audience).toEqual(c.config.audience);
  });

  it('only the listed fields exist: a sound, a volume, an audience, a cooldown or an editor in the request is refused', () => {
    const base = { actor: AOUH_ACTOR, expected_version: 1 };
    for (const extra of [
      { actions: [] },
      { sound: SOUND },
      { volume: 100 },
      { audience: audience(['everyone']) },
      { cooldown: { enabled: false } },
      { editors: [{ id: BOB.id, name: 'Bob' }] },
      { trigger: { mode: 'command', keywords: [], match: 'word' } },
      { changes: { enabled: false } },
    ])
      expect(CmdDelegateRequest.safeParse({ ...base, ...extra }).success).toBe(
        false,
      );
    expect(
      CmdDelegateRequest.safeParse({ ...base, enabled: false }).success,
    ).toBe(true);
  });

  it('another viewer cannot edit it (not found); the streamer takes back control (no editor → not found)', async () => {
    const c = await ao({ editors: [{ id: AOUH.id, name: 'Aouh' }] });
    await expect(
      svc.delegateUpdate(CH, c.command_id, {
        actor: BOB_ACTOR,
        expected_version: c.version,
        enabled: false,
      }),
    ).rejects.toMatchObject({ status: 404 });
    // An actor claiming a role changes nothing: the editor list decides.
    await expect(
      svc.delegateUpdate(CH, c.command_id, {
        actor: { ...BOB_ACTOR, role: 'moderator' },
        expected_version: c.version,
        keywords: ['x'],
      }),
    ).rejects.toMatchObject({ status: 404 });
    const v2 = await svc.update(CH, c.command_id, STUDIO, c.version, {
      editors: [],
    });
    await expect(
      svc.delegateUpdate(CH, c.command_id, {
        actor: AOUH_ACTOR,
        expected_version: v2.version,
        enabled: false,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await svc.get(CH, c.command_id, STUDIO)).config.enabled).toBe(true);
  });

  it('a « !name » command: on / off only, its trigger cannot be switched to expressions', async () => {
    const c = await make({ editors: [{ id: AOUH.id, name: 'Aouh' }] });
    expect((await svc.delegated(CH, AOUH.id)).commands[0]!.editable).toEqual([
      'enabled',
    ]);
    await expect(
      svc.delegateUpdate(CH, c.command_id, {
        actor: AOUH_ACTOR,
        expected_version: c.version,
        keywords: ['ao'],
      }),
    ).rejects.toMatchObject({ status: 403, code: 'field_not_delegated' });
    await svc.delegateUpdate(CH, c.command_id, {
      actor: AOUH_ACTOR,
      expected_version: c.version,
      enabled: false,
    });
  });

  it('no lost update: a stale version is refused (409) with the editor’s view only; concurrent saves → one wins', async () => {
    const c = await ao({ editors: [{ id: AOUH.id, name: 'Aouh' }] });
    const results = await Promise.allSettled([
      svc.delegateUpdate(CH, c.command_id, {
        actor: AOUH_ACTOR,
        expected_version: c.version,
        keywords: ['un'],
      }),
      svc.delegateUpdate(CH, c.command_id, {
        actor: AOUH_ACTOR,
        expected_version: c.version,
        keywords: ['deux'],
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({
      status: 409,
      code: 'version_conflict',
    });
    expect(JSON.stringify(lost.reason.details)).not.toMatch(
      /allow_ids|sound|cooldown/,
    );
    // The team cannot name editors (streamer only).
    await db.query(
      `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at, grants)
       values ($1, '603', 'supermod', 'studio:antoni', now(), '{}')`,
      [CH],
    );
    const cur = await svc.get(CH, c.command_id, STUDIO);
    await expect(
      svc.update(
        CH,
        c.command_id,
        { id: '603', role: 'moderator', via: 'extension' },
        cur.version,
        { editors: [{ id: BOB.id, name: 'Bob' }] },
      ),
    ).rejects.toMatchObject({ status: 403, code: 'field_not_delegated' });
  });
});
