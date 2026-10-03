import { randomUUID } from 'node:crypto';
import type { CmdConfig } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandsError } from '../src/commands/model.js';
import { raffleReservedWords } from '../src/commands/reserved.js';
import {
  CommandsService,
  type SystemCommandDef,
} from '../src/commands/service.js';
import type { Db } from '../src/db/db.js';
import { selectMigrations } from '../src/db/migration-scopes.js';
import { commandsRoutes } from '../src/http/commands-routes.js';
import { HttpError } from '../src/http/server.js';
import type { Actor } from '../src/lab-moderation/store.js';
import { RaffleLabService } from '../src/raffle-lab/raffle-lab-service.js';
import { count, createTestDb, FakeClock } from './helpers.js';

const CH = '900100';
const STUDIO: Actor = { id: 'antoni', role: 'broadcaster', via: 'studio' };
const MOD: Actor = {
  id: '501',
  login: 'aouh',
  role: 'moderator',
  via: 'extension',
};
const SUPER: Actor = {
  id: '502',
  login: 'mod_hugo',
  role: 'moderator',
  via: 'extension',
};
const VIEWER: Actor = { id: '503', role: 'viewer', via: 'extension' };

let db: Db;
let clock: FakeClock;
let svc: CommandsService;

async function fails(p: Promise<unknown>, status: number, code: string) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e, `expected ${status} ${code}`).toBeInstanceOf(CommandsError);
  expect([(e as CommandsError).status, (e as CommandsError).code]).toEqual([
    status,
    code,
  ]);
  return e as CommandsError;
}

const discord = (over: Partial<CmdConfig> = {}): Partial<CmdConfig> => ({
  name: 'discord',
  reply: { mode: 'normal', text: 'Rejoins le Discord !', to: 'none' },
  ...over,
});

beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(new Date('2026-10-04T18:00:00Z'));
  svc = new CommandsService(db, clock, {
    reserved: raffleReservedWords(new RaffleLabService(db, clock)),
  });
  await db.query(
    `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at, grants)
     values ($1, '502', 'supermod', 'studio:antoni', now(), '{}')`,
    [CH],
  );
});

describe('Commands V2 — persistence and migration', () => {
  it('starts empty: no legacy command, alias, history or rights row is imported', async () => {
    for (const t of [
      'cmd_commands',
      'cmd_triggers',
      'cmd_history',
      'cmd_team_rights',
      'cmd_channels',
    ])
      expect(await count(db, t), t).toBe(0);
    expect((await svc.list(CH, STUDIO)).commands).toEqual([]);
  });

  it('the commands_v2 migration is Lab only (never on the production path)', () => {
    const files = [
      '20261010120000_raffle_round_labels.sql',
      '20261011120000_commands_v2.sql',
    ];
    expect(selectMigrations(files, 'prod')).not.toContain(
      '20261011120000_commands_v2.sql',
    );
    expect(selectMigrations(files, 'lab')).toContain(
      '20261011120000_commands_v2.sql',
    );
  });
});

describe('Commands V2 — create / update / delete', () => {
  it('creates with defaults, stable id, words and a create history entry', async () => {
    const c = await svc.create(CH, STUDIO, discord({ aliases: ['dc'] }));
    expect(c.version).toBe(1);
    expect(c.kind).toBe('custom');
    expect(c.config.audience).toEqual({
      groups: ['everyone'],
      allow: [],
      deny: [],
    });
    expect(c.config.cooldown).toEqual({
      enabled: true,
      seconds: 30,
      unit: 's',
      scope: 'viewer',
    });
    expect(c.config.quota.enabled).toBe(false);
    const words = await db.query<{ word: string; kind: string }>(
      'select word, kind from cmd_triggers order by word',
    );
    expect(words).toEqual([
      { word: 'dc', kind: 'alias' },
      { word: 'discord', kind: 'name' },
    ]);
    const h = (await svc.history(CH, c.command_id, STUDIO)).entries;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({
      action: 'create',
      actor_role: 'broadcaster',
      via: 'studio',
      version: 1,
    });
  });

  it('renaming keeps the identity; history holds the exact before / after of each field', async () => {
    const c = await svc.create(CH, STUDIO, discord());
    const u = await svc.update(CH, c.command_id, STUDIO, 1, {
      name: 'serveur',
      aliases: ['dc'],
      listed: false,
    });
    expect(u.command_id).toBe(c.command_id);
    expect(u.version).toBe(2);
    const last = (await svc.history(CH, c.command_id, STUDIO)).entries[0]!;
    expect(last).toMatchObject({ action: 'update', version: 2 });
    expect(last.changes).toEqual([
      { field: 'name', before: 'discord', after: 'serveur' },
      { field: 'aliases', before: [], after: ['dc'] },
      { field: 'listed', before: true, after: false },
    ]);
    // The old name is free again, the new words are taken.
    await svc.create(CH, STUDIO, discord());
    await fails(
      svc.create(CH, STUDIO, discord({ name: 'dc' })),
      409,
      'word_taken',
    );
  });

  it('an update that changes nothing keeps the version', async () => {
    const c = await svc.create(CH, STUDIO, discord());
    const u = await svc.update(CH, c.command_id, STUDIO, 1, { listed: true });
    expect(u.version).toBe(1);
    expect(await count(db, 'cmd_history')).toBe(1);
  });

  it('optimistic locking: a stale version is refused with the current state (409)', async () => {
    const c = await svc.create(CH, STUDIO, discord());
    await svc.update(CH, c.command_id, STUDIO, 1, { listed: false });
    const e = await fails(
      svc.update(CH, c.command_id, MOD, 1, { enabled: false }),
      409,
      'version_conflict',
    );
    expect(e.details.current_version).toBe(2);
    expect((e.details.current as { config: CmdConfig }).config.listed).toBe(
      false,
    );
  });

  it('two concurrent edits from the same version: exactly one wins, the other gets 409', async () => {
    const c = await svc.create(CH, STUDIO, discord());
    const results = await Promise.allSettled([
      svc.update(CH, c.command_id, STUDIO, 1, { description: 'A' }),
      svc.update(CH, c.command_id, STUDIO, 1, { description: 'B' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect((rejected.reason as CommandsError).code).toBe('version_conflict');
    expect((await svc.get(CH, c.command_id, STUDIO)).version).toBe(2);
  });

  it('soft delete: gone from the list, words released, history kept; a stale delete is refused', async () => {
    const c = await svc.create(CH, STUDIO, discord({ aliases: ['dc'] }));
    await fails(
      svc.remove(CH, c.command_id, STUDIO, 7),
      409,
      'version_conflict',
    );
    await svc.remove(CH, c.command_id, STUDIO, 1);
    expect((await svc.list(CH, STUDIO)).commands).toEqual([]);
    await fails(svc.get(CH, c.command_id, STUDIO), 404, 'command_not_found');
    expect(await count(db, 'cmd_triggers')).toBe(0);
    const row = (
      await db.query<{ deleted_at: Date | null }>(
        'select deleted_at from cmd_commands',
      )
    )[0]!;
    expect(row.deleted_at).not.toBeNull();
    expect(
      (await svc.history(CH, c.command_id, STUDIO)).entries.map(
        (e) => e.action,
      ),
    ).toEqual(['delete', 'create']);
    await svc.create(CH, STUDIO, discord({ aliases: ['dc'] }));
  });
});

describe('Commands V2 — words', () => {
  it('a name or an alias belongs to one command per channel, disabled commands included', async () => {
    await svc.create(CH, STUDIO, discord({ aliases: ['dc'], enabled: false }));
    await fails(
      svc.create(CH, STUDIO, discord({ name: 'dc' })),
      409,
      'word_taken',
    );
    const other = await svc.create(CH, STUDIO, discord({ name: 'liens' }));
    const e = await fails(
      svc.update(CH, other.command_id, STUDIO, 1, { aliases: ['discord'] }),
      409,
      'word_taken',
    );
    expect(e.details).toMatchObject({ word: 'discord', command: 'discord' });
    // Another channel is independent.
    await svc.create('900200', STUDIO, discord({ aliases: ['dc'] }));
  });

  it('an alias equal to the name, or repeated, is refused', async () => {
    await fails(
      svc.create(CH, STUDIO, discord({ aliases: ['discord'] })),
      422,
      'invalid_config',
    );
    await fails(
      svc.create(CH, STUDIO, discord({ aliases: ['dc', 'dc'] })),
      422,
      'invalid_config',
    );
  });

  it("Tombola's chat words are reserved (read from Tombola, never modified)", async () => {
    const before = await db.query('select * from lab_raffle_settings');
    const e = await fails(
      svc.create(CH, STUDIO, discord({ name: 'join' })),
      409,
      'word_reserved',
    );
    expect(e.details).toEqual({ word: 'join', module: 'raffle' });
    await fails(
      svc.create(CH, STUDIO, discord({ aliases: ['annuletombola'] })),
      409,
      'word_reserved',
    );
    expect(await db.query('select * from lab_raffle_settings')).toEqual(before);
    expect(
      (await svc.list(CH, STUDIO)).reserved_words.map((w) => w.word),
    ).toEqual(['join', 'enter', 'annuletombola']);
  });
});

describe('Commands V2 — configuration rules', () => {
  it('audience: groups add up; « everyone » is exclusive; allow / deny never overlap; unknown group refused', async () => {
    const c = await svc.create(
      CH,
      STUDIO,
      discord({
        audience: {
          groups: ['vips', 'subs'],
          allow: ['aouh'],
          deny: ['trollman'],
        },
      }),
    );
    expect(c.config.audience.groups).toEqual(['vips', 'subs']);
    await fails(
      svc.create(
        CH,
        STUDIO,
        discord({
          name: 'a',
          audience: { groups: ['everyone', 'vips'], allow: [], deny: [] },
        }),
      ),
      422,
      'invalid_config',
    );
    await fails(
      svc.create(
        CH,
        STUDIO,
        discord({
          name: 'b',
          audience: { groups: [], allow: ['aouh'], deny: ['aouh'] },
        }),
      ),
      422,
      'invalid_config',
    );
    await fails(
      svc.create(
        CH,
        STUDIO,
        discord({
          name: 'c',
          audience: { groups: ['admins'], allow: [], deny: [] },
        } as unknown as Partial<CmdConfig>),
      ),
      422,
      'invalid_config',
    );
    // Only specific people (no group) is a valid state.
    await svc.create(
      CH,
      STUDIO,
      discord({
        name: 'd',
        audience: { groups: [], allow: ['aouh'], deny: [] },
      }),
    );
  });

  it('cooldown and quota are two distinct objects, both can be on', async () => {
    const c = await svc.create(
      CH,
      STUDIO,
      discord({
        cooldown: { enabled: true, seconds: 300, unit: 'min', scope: 'viewer' },
        quota: { enabled: true, max: 4, window: 'hour', scope: 'global' },
      }),
    );
    expect(c.config.cooldown.seconds).toBe(300);
    expect(c.config.quota).toEqual({
      enabled: true,
      max: 4,
      window: 'hour',
      scope: 'global',
    });
    await fails(
      svc.create(
        CH,
        STUDIO,
        discord({
          name: 'x',
          cooldown: {
            enabled: true,
            seconds: 90,
            unit: 'min',
            scope: 'global',
          },
        }),
      ),
      422,
      'invalid_config',
    );
    await fails(
      svc.create(
        CH,
        STUDIO,
        discord({
          name: 'y',
          quota: { enabled: true, max: 3, window: 'week', scope: 'global' },
        } as unknown as Partial<CmdConfig>),
      ),
      422,
      'invalid_config',
    );
  });

  it('variables and addressing are checked against the arguments', async () => {
    const hug = (over: Partial<CmdConfig>) => discord({ name: 'hug', ...over });
    const e = await fails(
      svc.create(
        CH,
        STUDIO,
        hug({ reply: { mode: 'me', text: 'câlin à {target}', to: 'none' } }),
      ),
      422,
      'invalid_config',
    );
    expect(e.details.issues).toEqual([
      'reply: {target} needs a @pseudo argument',
    ]);
    await fails(
      svc.create(
        CH,
        STUDIO,
        hug({ reply: { mode: 'me', text: 'salut {nope}', to: 'none' } }),
      ),
      422,
      'invalid_config',
    );
    await fails(
      svc.create(
        CH,
        STUDIO,
        hug({ reply: { mode: 'normal', text: 'hey', to: 'target' } }),
      ),
      422,
      'invalid_config',
    );
    await fails(
      svc.create(
        CH,
        STUDIO,
        hug({ reply: { mode: 'reply', text: 'hey', to: 'author' } }),
      ),
      422,
      'invalid_config',
    );
    const ok = await svc.create(
      CH,
      STUDIO,
      hug({
        args: [{ name: 'cible', type: 'mention', required: true }],
        reply: {
          mode: 'me',
          text: '{display_name} fait un câlin à {target}',
          to: 'target',
        },
      }),
    );
    expect(ok.config.reply.to).toBe('target');
  });

  it('a chat action is persisted (typed, versioned); a module action is refused on a custom command', async () => {
    const c = await svc.create(
      CH,
      STUDIO,
      discord({
        actions: [
          {
            type: 'chat',
            v: 1,
            id: randomUUID(),
            on_error: 'continue',
            mode: 'announce',
            text: 'Bienvenue !',
            to: 'none',
          },
        ],
      }),
    );
    expect(c.config.actions[0]).toMatchObject({
      type: 'chat',
      v: 1,
      mode: 'announce',
    });
    await fails(
      svc.create(
        CH,
        STUDIO,
        discord({
          name: 'z',
          actions: [
            {
              type: 'module',
              v: 1,
              id: randomUUID(),
              on_error: 'stop',
              module: 'raffle',
              operation: 'join',
            },
          ],
        }),
      ),
      422,
      'module_action_reserved',
    );
    await fails(
      svc.create(
        CH,
        STUDIO,
        discord({
          name: 'w',
          actions: [{ type: 'sound', v: 1 }] as unknown as CmdConfig['actions'],
        }),
      ),
      422,
      'invalid_config',
    );
  });
});

describe('Commands V2 — team rights (enforced by Core)', () => {
  it('viewers can neither read nor change the configuration', async () => {
    const c = await svc.create(CH, STUDIO, discord());
    await fails(svc.list(CH, VIEWER), 403, 'team_only');
    await fails(
      svc.update(CH, c.command_id, VIEWER, 1, { enabled: false }),
      403,
      'team_only',
    );
  });

  it('moderator (defaults): toggle, reply, cooldown ≥ 10 s — nothing else', async () => {
    const c = await svc.create(CH, STUDIO, discord());
    let v = (await svc.update(CH, c.command_id, MOD, 1, { enabled: false }))
      .version;
    v = (
      await svc.update(CH, c.command_id, MOD, v, {
        reply: { mode: 'me', text: 'Discord !', to: 'author' },
      })
    ).version;
    v = (
      await svc.update(CH, c.command_id, MOD, v, {
        cooldown: { enabled: true, seconds: 60, unit: 'min', scope: 'global' },
      })
    ).version;
    await fails(
      svc.update(CH, c.command_id, MOD, v, {
        cooldown: { enabled: true, seconds: 5, unit: 's', scope: 'global' },
      }),
      422,
      'cooldown_below_minimum',
    );
    await fails(
      svc.update(CH, c.command_id, MOD, v, {
        cooldown: { enabled: false, seconds: 60, unit: 'min', scope: 'global' },
      }),
      422,
      'cooldown_below_minimum',
    );
    for (const changes of [
      { aliases: ['dc'] },
      { listed: false },
      { quota: { enabled: true, max: 2, window: 'live', scope: 'viewer' } },
      { audience: { groups: ['subs'], allow: [], deny: [] } },
      { audience: { groups: ['everyone'], allow: [], deny: ['trollman'] } },
      { name: 'disco' },
      { when: 'live' },
    ] as Partial<CmdConfig>[]) {
      const e = await fails(
        svc.update(CH, c.command_id, MOD, v, changes),
        403,
        'field_not_delegated',
      );
      expect(e.details.role).toBe('moderator');
    }
    await fails(
      svc.create(CH, MOD, discord({ name: 'nouvelle' })),
      403,
      'not_delegated',
    );
    await fails(svc.remove(CH, c.command_id, MOD, v), 403, 'not_delegated');
    const h = (await svc.history(CH, c.command_id, MOD)).entries[0]!;
    expect(h).toMatchObject({
      actor_id: '501',
      actor_login: 'aouh',
      actor_role: 'moderator',
      via: 'extension',
    });
  });

  it('supermod (defaults): aliases, audience, exclusions, quota, listed, simple create, delete — not the structure', async () => {
    const c = await svc.create(CH, STUDIO, discord());
    let v = (await svc.update(CH, c.command_id, SUPER, 1, { aliases: ['dc'] }))
      .version;
    v = (
      await svc.update(CH, c.command_id, SUPER, v, {
        audience: {
          groups: ['vips', 'subs'],
          allow: ['aouh'],
          deny: ['trollman'],
        },
      })
    ).version;
    v = (
      await svc.update(CH, c.command_id, SUPER, v, {
        quota: { enabled: true, max: 4, window: 'hour', scope: 'global' },
        listed: false,
      })
    ).version;
    for (const changes of [
      { name: 'disco' },
      { args: [{ name: 'x', type: 'text', required: false }] },
      { when: 'live' },
      { team_lock: true },
      { refuse: { mode: 'explain', text: '' } },
    ] as Partial<CmdConfig>[])
      await fails(
        svc.update(CH, c.command_id, SUPER, v, changes),
        403,
        'field_not_delegated',
      );
    const created = await svc.create(
      CH,
      SUPER,
      discord({ name: 'calin', description: 'Un câlin' }),
    );
    await fails(
      svc.create(CH, SUPER, discord({ name: 'avance', when: 'live' })),
      403,
      'field_not_delegated',
    );
    await svc.remove(CH, created.command_id, SUPER, 1);
  });

  it('the streamer changes everything; a locked command is read-only for the team', async () => {
    const c = await svc.create(CH, STUDIO, discord());
    const u = await svc.update(CH, c.command_id, STUDIO, 1, {
      name: 'disco',
      when: 'live',
      team_lock: true,
      args: [{ name: 'msg', type: 'text', required: false }],
      refuse: { mode: 'custom', text: 'Réservé.' },
    });
    expect(u.version).toBe(2);
    await fails(
      svc.update(CH, c.command_id, SUPER, 2, { enabled: false }),
      403,
      'command_locked',
    );
    await fails(svc.remove(CH, c.command_id, SUPER, 2), 403, 'command_locked');
  });

  it('bounds and rights are set by the streamer only, versioned, and recorded', async () => {
    const rights = (await svc.rights(CH, STUDIO)).moderator;
    expect(rights.version).toBe(0);
    await fails(
      svc.setRights(CH, SUPER, 'moderator', 0, rights.rights),
      403,
      'streamer_only',
    );
    const next = {
      ...rights.rights,
      cooldown: { allowed: true, min_seconds: 60 },
      aliases: true,
    };
    expect(
      (await svc.setRights(CH, STUDIO, 'moderator', 0, next)).version,
    ).toBe(1);
    await fails(
      svc.setRights(CH, STUDIO, 'moderator', 0, next),
      409,
      'version_conflict',
    );
    await fails(
      svc.setRights(CH, STUDIO, 'moderator', 1, {
        ...next,
        volume: { allowed: true, min: 80, max: 20 },
      }),
      422,
      'invalid_rights',
    );
    const c = await svc.create(CH, STUDIO, discord());
    await fails(
      svc.update(CH, c.command_id, MOD, 1, {
        cooldown: { enabled: true, seconds: 45, unit: 's', scope: 'viewer' },
      }),
      422,
      'cooldown_below_minimum',
    );
    await svc.update(CH, c.command_id, MOD, 1, { aliases: ['dc'] });
    const h = (await svc.history(CH, null, STUDIO)).entries.find(
      (e) => e.action === 'rights',
    )!;
    expect(h.changes).toEqual([
      { field: 'moderator.aliases', before: false, after: true },
      {
        field: 'moderator.cooldown',
        before: { allowed: true, min_seconds: 10 },
        after: { allowed: true, min_seconds: 60 },
      },
    ]);
  });
});

describe('Commands V2 — system commands', () => {
  const join = (v: number, text: string): SystemCommandDef => ({
    module: 'testmod',
    key: 'testmod.go',
    defaults_version: v,
    locked_fields: ['actions', 'name'],
    defaults: {
      ...(discord({ name: 'go' }) as CmdConfig),
      aliases: [],
      description: '',
      category: 'general',
      appearance: { icon: 'cube', color: '#ec4899' },
      enabled: true,
      listed: true,
      audience: { groups: ['everyone'], allow: [], deny: [] },
      cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'viewer' },
      quota: { enabled: false, max: 4, window: 'hour', scope: 'global' },
      reply: { mode: 'silent', text: '', to: 'none' },
      args: [],
      actions: [
        {
          type: 'module',
          v: 1,
          id: '11111111-1111-4111-8111-111111111111',
          on_error: 'stop',
          module: 'testmod',
          operation: text,
        },
      ],
      reply_first: false,
      when: 'always',
      refuse: { mode: 'silent', text: '' },
      team_lock: false,
    },
  });

  it('is created by its module with locked fields; the core action and locked fields stay protected', async () => {
    const sys = new CommandsService(db, clock, {
      systemCommands: [join(1, 'go')],
    });
    expect((await sys.syncSystem(CH)).system).toEqual([
      { key: 'testmod.go', outcome: 'created' },
    ]);
    expect((await sys.syncSystem(CH)).system).toEqual([
      { key: 'testmod.go', outcome: 'unchanged' },
    ]);
    const c = (await sys.list(CH, STUDIO)).commands[0]!;
    expect(c).toMatchObject({
      kind: 'system',
      owner_module: 'testmod',
      system_key: 'testmod.go',
      locked_fields: ['actions', 'name'],
    });
    await fails(
      sys.update(CH, c.command_id, STUDIO, 1, { name: 'partir' }),
      422,
      'field_locked',
    );
    await fails(
      sys.update(CH, c.command_id, STUDIO, 1, { actions: [] }),
      422,
      'field_locked',
    );
    await fails(sys.remove(CH, c.command_id, STUDIO, 1), 422, 'system_command');
    // Adaptations of the free fields are allowed (streamer, and team within its rights).
    let v = (
      await sys.update(CH, c.command_id, STUDIO, 1, {
        aliases: ['go2'],
        cooldown: { enabled: true, seconds: 60, unit: 'min', scope: 'viewer' },
      })
    ).version;
    v = (await sys.update(CH, c.command_id, MOD, v, { enabled: false }))
      .version;
    // Reset: back to the module defaults (streamer only).
    await fails(sys.reset(CH, c.command_id, MOD, v), 403, 'streamer_only');
    const r = await sys.reset(CH, c.command_id, STUDIO, v);
    expect(r.config).toEqual(join(1, 'go').defaults);
    expect(
      (await sys.history(CH, c.command_id, STUDIO)).entries[0],
    ).toMatchObject({ action: 'reset' });
  });

  it('a newer module version updates the locked fields and keeps the adaptations', async () => {
    const v1 = new CommandsService(db, clock, {
      systemCommands: [join(1, 'go')],
    });
    await v1.syncSystem(CH);
    const c = (await v1.list(CH, STUDIO)).commands[0]!;
    await v1.update(CH, c.command_id, STUDIO, 1, { aliases: ['go2'] });
    const v2 = new CommandsService(db, clock, {
      systemCommands: [join(2, 'go_v2')],
    });
    expect((await v2.syncSystem(CH)).system).toEqual([
      { key: 'testmod.go', outcome: 'upgraded' },
    ]);
    const after = await v2.get(CH, c.command_id, STUDIO);
    expect(after.defaults_version).toBe(2);
    expect(after.config.aliases).toEqual(['go2']);
    expect(after.config.actions[0]).toMatchObject({ operation: 'go_v2' });
    expect(
      (await v2.history(CH, c.command_id, STUDIO)).entries[0],
    ).toMatchObject({ action: 'system_sync', actor_role: 'system' });
  });
});

describe('Commands V2 — HTTP routes', () => {
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const url = new URL(path, 'http://lab');
    const route = commandsRoutes(svc).find(
      (r) => r.method === method && r.pattern.test(url.pathname),
    );
    if (!route) throw new Error(`no route ${method} ${path}`);
    try {
      return {
        status: 200,
        body: await route.handle({
          params: route.pattern.exec(url.pathname)!.slice(1),
          url,
          body,
        }),
      };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: e.body };
      throw e;
    }
  };

  it('create → update → conflict → delete, errors mapped to HTTP statuses', async () => {
    const created = await call('POST', `/v1/lab/commands/${CH}`, {
      actor: STUDIO,
      config: discord(),
    });
    expect(created.status).toBe(200);
    const id = (created.body as { command_id: string }).command_id;
    expect(
      (
        await call('POST', `/v1/lab/commands/${CH}/${id}/update`, {
          actor: STUDIO,
          expected_version: 1,
          changes: { listed: false },
        })
      ).status,
    ).toBe(200);
    const stale = await call('POST', `/v1/lab/commands/${CH}/${id}/update`, {
      actor: STUDIO,
      expected_version: 1,
      changes: { listed: true },
    });
    expect(stale.status).toBe(409);
    expect((stale.body as { error: string }).error).toBe('version_conflict');
    expect(
      (await call('GET', `/v1/lab/commands/${CH}/${id}/history`)).status,
    ).toBe(200);
    expect(
      (await call('GET', `/v1/lab/commands/${CH}?as=503&as_role=viewer`))
        .status,
    ).toBe(403);
    expect(
      (
        await call(
          'GET',
          `/v1/lab/commands/${CH}/rights?as=501&as_role=moderator`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call('POST', `/v1/lab/commands/${CH}`, {
          actor: STUDIO,
          config: { name: 'BAD NAME' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/v1/lab/commands/${CH}/${id}/delete`, {
          actor: STUDIO,
          expected_version: 2,
        })
      ).status,
    ).toBe(200);
  });
});
