import type { CmdConfig } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandsAdmission } from '../../../core-api/src/commands/admission.js';
import {
  CommandsService,
  type SystemCommandDef,
} from '../../../core-api/src/commands/service.js';
import { CommandSteps } from '../../../core-api/src/commands/steps.js';
import type { Db } from '../../../core-api/src/db/db.js';
import { commandsRoutes } from '../../../core-api/src/http/commands-routes.js';
import { HttpError } from '../../../core-api/src/http/server.js';
import { createTestDb, FakeClock } from '../../../core-api/test/helpers.js';
import { LabEbs } from '../src/extension-lab/lab-ebs.js';
import { EXTENSION_DIR } from '../src/index.js';
import type { LabCoreCall } from '../src/lab-moderation/proxy.js';

// Commands V2 — phase E: the extension's « Modération › Commandes » through the Lab EBS façade. The
// caller is the identity of the extension token (never the Studio operator, never a request field);
// Core resolves the role (mod / supermod via Lab staff / the channel's broadcaster) and applies the
// team rights field by field, the bounds, the locks and the versions.

type Json = Record<string, unknown>;
const CH = '900100';
const token = (role: string) => ({
  authorization: `Bearer lab.${Buffer.from(JSON.stringify({ role, identity_shared: true })).toString('base64url')}`,
});
const VIEWER = token('viewer');
const MOD = token('moderator'); // Lab identity 900102 (lab_modo)
const BOSS = token('broadcaster'); // Lab identity 900100 = the Lab channel's own account
const STUDIO = {
  id: 'studio',
  role: 'broadcaster' as const,
  via: 'studio' as const,
};

let db: Db;
let svc: CommandsService;
let lab: LabEbs;
const SYSTEM: SystemCommandDef = {
  module: 'raffle',
  key: 'raffle.ticket',
  defaults_version: 1,
  locked_fields: ['name', 'actions'],
  defaults: {
    name: 'ticket',
    aliases: [],
    description: 'Participer',
    category: null,
    appearance: { icon: 'ticket', color: '#ec4899' },
    enabled: true,
    listed: true,
    audience: { groups: ['everyone'], allow: [], deny: [] },
    cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'viewer' },
    quota: { enabled: false, max: 4, window: 'hour', scope: 'global' },
    reply: { mode: 'silent', text: '', to: 'none' },
    args: [],
    actions: [
      {
        id: '7d1c4f5e-1111-4222-8333-444455556666',
        type: 'module',
        v: 1,
        on_error: 'stop',
        module: 'raffle',
        operation: 'join',
      },
    ],
    reply_first: false,
    when: 'always',
    refuse: { mode: 'silent', text: '' },
    team_lock: false,
  },
};

beforeEach(async () => {
  db = await createTestDb();
  const clock = new FakeClock(new Date('2026-10-04T18:00:00Z'));
  const reserved = async () => [{ word: 'join', module: 'raffle' }];
  svc = new CommandsService(db, clock, { reserved, systemCommands: [SYSTEM] });
  const adm = new CommandsAdmission(db, clock, { reserved });
  const routes = commandsRoutes(svc, adm, new CommandSteps(db, clock));
  const core = (async (path: string, body?: unknown) => {
    const url = new URL(path, 'http://lab');
    const route = routes.find(
      (r) =>
        r.method === (body === undefined ? 'GET' : 'POST') &&
        r.pattern.test(url.pathname),
    );
    if (!route)
      throw Object.assign(new Error('not_found'), {
        status: 404,
        body: { error: 'not_found' },
      });
    try {
      return JSON.parse(
        JSON.stringify(
          await route.handle({
            params: route.pattern.exec(url.pathname)!.slice(1),
            url,
            body,
          }),
        ),
      );
    } catch (e) {
      if (e instanceof HttpError)
        throw Object.assign(new Error(String((e.body as Json).error)), {
          status: e.status,
          body: e.body,
        });
      throw e;
    }
  }) as LabCoreCall;
  lab = await LabEbs.create(EXTENSION_DIR);
  lab.connectLab(core);
});

const call = async (
  h: { authorization: string },
  method: 'GET' | 'POST',
  path: string,
  body?: Json,
) => {
  const r = await lab.handle(method, `/commands/v2/${path}`, body, h);
  return { status: r.status, body: r.body as Json };
};
const supermod = () =>
  db.query(
    `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at, grants) values ($1, '900102', 'supermod', 'studio:studio', now(), '{}')`,
    [CH],
  );
const make = (o: Partial<CmdConfig> = {}) =>
  svc.create(CH, STUDIO, {
    name: 'hug',
    reply: { mode: 'normal', text: 'Câlin !', to: 'none' },
    cooldown: { enabled: true, seconds: 30, unit: 's', scope: 'viewer' },
    ...o,
  });
type Cmd = { command_id: string; version: number; config: CmdConfig };

describe('Extension « Modération › Commandes » — identity and role (Core decides)', () => {
  it('broadcaster, supermod, moderator get their own role and rights; a viewer is refused', async () => {
    expect((await call(BOSS, 'GET', 'me')).body).toMatchObject({
      role: 'broadcaster',
      rights: null,
    });
    expect((await call(MOD, 'GET', 'me')).body).toMatchObject({
      role: 'moderator',
      rights: {
        toggle: true,
        aliases: false,
        create: false,
        cooldown: { allowed: true, min_seconds: 10 },
      },
    });
    await supermod();
    expect((await call(MOD, 'GET', 'me')).body).toMatchObject({
      role: 'supermod',
      rights: { aliases: true, create: true, remove: true },
    });
    expect(await call(VIEWER, 'GET', 'me')).toMatchObject({
      status: 403,
      body: { error: 'team_only' },
    });
    expect(await call(VIEWER, 'GET', 'list')).toMatchObject({ status: 403 });
  });

  it('every write is signed with the token identity — a request field can never change it', async () => {
    const c = await make();
    const r = await call(MOD, 'POST', `commands/${c.command_id}/update`, {
      expected_version: 1,
      changes: { enabled: false },
      actor: { id: 'studio', role: 'broadcaster', via: 'studio' },
    });
    expect(r.status).toBe(200);
    const h = await svc.history(CH, c.command_id, STUDIO);
    expect(h.entries[0]).toMatchObject({
      actor_id: '900102',
      actor_role: 'moderator',
      via: 'extension',
    });
    // Escalation attempt through a field the role may not change: refused by Core.
    expect(
      await call(MOD, 'POST', `commands/${c.command_id}/update`, {
        expected_version: 2,
        changes: { aliases: ['calin'] },
        actor: STUDIO,
      }),
    ).toMatchObject({
      status: 403,
      body: { error: 'field_not_delegated', field: 'aliases' },
    });
  });
});

describe('Extension « Modération › Commandes » — rights applied by Core', () => {
  it('moderator: toggle, reply and cooldown ≥ its minimum; not aliases, audience, quota, listed', async () => {
    const c = (await make()) as Cmd;
    const up = (version: number, changes: Partial<CmdConfig>) =>
      call(MOD, 'POST', `commands/${c.command_id}/update`, {
        expected_version: version,
        changes,
      });
    expect(await up(1, { enabled: false })).toMatchObject({
      status: 200,
      body: { version: 2 },
    });
    expect(
      await up(2, {
        reply: { mode: 'announce', text: 'Câlin général !', to: 'none' },
      }),
    ).toMatchObject({ status: 200 });
    expect(
      await up(3, {
        cooldown: { enabled: true, seconds: 5, unit: 's', scope: 'viewer' },
      }),
    ).toMatchObject({
      status: 422,
      body: { error: 'cooldown_below_minimum', min_seconds: 10 },
    });
    expect(
      await up(3, {
        cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'viewer' },
      }),
    ).toMatchObject({ status: 422, body: { error: 'cooldown_below_minimum' } });
    expect(
      await up(3, {
        cooldown: { enabled: true, seconds: 60, unit: 'min', scope: 'global' },
      }),
    ).toMatchObject({ status: 200 });
    for (const changes of [
      { audience: { groups: ['vips'], allow: [], deny: [] } },
      { quota: { enabled: true, max: 3, window: 'hour', scope: 'global' } },
      { listed: false },
    ] as Partial<CmdConfig>[])
      expect(await up(4, changes)).toMatchObject({
        status: 403,
        body: { error: 'field_not_delegated' },
      });
  });

  it('a right removed in Studio is refused at once (toggle forbidden)', async () => {
    const c = await make();
    const cur = await svc.rights(CH, STUDIO);
    await svc.setRights(CH, STUDIO, 'moderator', cur.moderator.version, {
      ...cur.moderator.rights,
      toggle: false,
    });
    expect((await call(MOD, 'GET', 'me')).body).toMatchObject({
      rights: { toggle: false },
    });
    expect(
      await call(MOD, 'POST', `commands/${c.command_id}/update`, {
        expected_version: 1,
        changes: { enabled: false },
      }),
    ).toMatchObject({
      status: 403,
      body: { error: 'field_not_delegated', field: 'enabled' },
    });
  });

  it('supermod: audience (groups, allow, deny), quota, listed', async () => {
    await supermod();
    const c = await make();
    const r = await call(MOD, 'POST', `commands/${c.command_id}/update`, {
      expected_version: 1,
      changes: {
        audience: {
          groups: ['vips', 'subs'],
          allow: ['aouh'],
          deny: ['trollman'],
        },
        quota: { enabled: true, max: 3, window: 'live', scope: 'viewer' },
        listed: false,
      },
    });
    expect(r).toMatchObject({
      status: 200,
      body: { config: { listed: false, quota: { window: 'live' } } },
    });
  });

  it('a command locked by the streamer is read-only for the team, not for the streamer', async () => {
    await supermod();
    const c = await make({ team_lock: true });
    expect(
      await call(MOD, 'POST', `commands/${c.command_id}/update`, {
        expected_version: 1,
        changes: { enabled: false },
      }),
    ).toMatchObject({ status: 403, body: { error: 'command_locked' } });
    expect(
      await call(BOSS, 'POST', `commands/${c.command_id}/update`, {
        expected_version: 1,
        changes: { enabled: false },
      }),
    ).toMatchObject({ status: 200 });
  });

  it('creation: refused to a moderator, allowed to a supermod (existing category, simple reply)', async () => {
    const cat = await svc.createCategory(CH, STUDIO, {
      name: 'Fun',
      icon: 'sparkles',
      color: '#f2c65f',
    });
    const config = {
      name: 'salut',
      description: 'Dire bonjour',
      category: cat.category_id,
      reply: { mode: 'normal', text: 'Salut {display_name} !', to: 'none' },
    };
    expect(await call(MOD, 'POST', 'commands', { config })).toMatchObject({
      status: 403,
      body: { error: 'not_delegated', right: 'create' },
    });
    await supermod();
    const out = await call(MOD, 'POST', 'commands', { config });
    expect(out).toMatchObject({
      status: 200,
      body: { config: { name: 'salut', category: cat.category_id } },
    });
  });

  it('deletion: refused to a moderator, allowed to a supermod (soft delete); never a system command', async () => {
    const c = await make();
    expect(
      await call(MOD, 'POST', `commands/${c.command_id}/delete`, {
        expected_version: 1,
      }),
    ).toMatchObject({
      status: 403,
      body: { error: 'not_delegated', right: 'remove' },
    });
    await supermod();
    expect(
      await call(MOD, 'POST', `commands/${c.command_id}/delete`, {
        expected_version: 1,
      }),
    ).toMatchObject({ status: 200 });
    expect((await call(MOD, 'GET', 'list')).body.commands).toEqual([]);
    await svc.syncSystem(CH);
    const sys = ((await call(BOSS, 'GET', 'list')).body.commands as Cmd[])[0]!;
    expect(
      await call(BOSS, 'POST', `commands/${sys.command_id}/delete`, {
        expected_version: 1,
      }),
    ).toMatchObject({ status: 422, body: { error: 'system_command' } });
  });

  it('system command: its locked fields are refused even to the streamer from the extension', async () => {
    await svc.syncSystem(CH);
    const sys = (
      (await call(BOSS, 'GET', 'list')).body.commands as (Cmd & {
        kind: string;
        locked_fields: string[];
      })[]
    )[0]!;
    expect(sys).toMatchObject({
      kind: 'system',
      locked_fields: ['name', 'actions'],
    });
    expect(
      await call(BOSS, 'POST', `commands/${sys.command_id}/update`, {
        expected_version: 1,
        changes: { name: 'billet' },
      }),
    ).toMatchObject({ status: 422, body: { error: 'field_locked' } });
  });
});

describe('Extension « Modération › Commandes » — list, conflicts, concurrency, activity', () => {
  it('the list carries categories, reserved words and issues (a reserved word shadowing a command)', async () => {
    const plain = new CommandsService(
      db,
      new FakeClock(new Date('2026-10-04T18:00:00Z')),
    );
    await plain.create(CH, STUDIO, {
      name: 'participer',
      aliases: ['join'],
      reply: { mode: 'normal', text: 'ok', to: 'none' },
    });
    const l = (await call(MOD, 'GET', 'list')).body as Json & {
      commands: { issues: unknown[] }[];
    };
    expect(l.reserved_words).toEqual([{ word: 'join', module: 'raffle' }]);
    expect(l.commands[0]!.issues).toEqual([
      { code: 'word_reserved', word: 'join', module: 'raffle' },
    ]);
  });

  it('409: a change made meanwhile in Studio is never overwritten; the current version comes back', async () => {
    const c = await make();
    await svc.update(CH, c.command_id, STUDIO, 1, {
      description: 'Changée dans Studio',
    });
    const r = await call(MOD, 'POST', `commands/${c.command_id}/update`, {
      expected_version: 1,
      changes: { reply: { mode: 'normal', text: 'Autre', to: 'none' } },
    });
    expect(r).toMatchObject({
      status: 409,
      body: {
        error: 'version_conflict',
        current: { version: 2, config: { description: 'Changée dans Studio' } },
      },
    });
    expect((await svc.get(CH, c.command_id, STUDIO)).config.reply.text).toBe(
      'Câlin !',
    );
  });

  it('activity of the command: its uses and refusals (reason, sends) and its last changes', async () => {
    const c = await make({
      audience: { groups: ['subs'], allow: [], deny: [] },
    });
    const adm = new CommandsAdmission(
      db,
      new FakeClock(new Date('2026-10-04T18:00:00Z')),
    );
    await adm.chat({
      channel_id: CH,
      message_id: 'm1',
      text: '!hug',
      chatter: { id: '700', login: 'v', display_name: 'V', role: 'viewer' },
      source: 'twitch',
    });
    await svc.update(CH, c.command_id, STUDIO, 1, { listed: false });
    const a = (await call(MOD, 'GET', `commands/${c.command_id}/activity`))
      .body as Json & { invocations: Json[]; changes: Json[] };
    expect(a.invocations).toMatchObject([
      { decision: 'rejected', reason: 'access_denied', steps: [] },
    ]);
    expect(a.changes[0]).toMatchObject({
      action: 'update',
      changes: [{ field: 'listed' }],
    });
    expect(
      await call(VIEWER, 'GET', `commands/${c.command_id}/activity`),
    ).toMatchObject({ status: 403 });
  });
});
