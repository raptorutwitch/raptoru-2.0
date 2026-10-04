import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CmdConfig } from '@raptoru/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import {
  type Category,
  type CommandItem,
  changes,
  counts,
  cooldownShort,
  groups,
  insertAt,
  type ListResponse,
  type ListUi,
  NO_CATEGORY,
  previewText,
  quotaShort,
  reapply,
  stateOf,
  variableMissing,
  VARIABLES,
  visible,
  whoSentence,
  whoShort,
} from '../../web/src/commands-model.js';
import { commandsApi, commandsRelay } from '../src/commands/relay.js';
import type { LabCoreCall } from '../src/lab-moderation/proxy.js';

// Commands V2 in Studio (phase D): the relay (Studio → Lab Core, Studio actor, nothing decided), the
// real Core behind it (PGlite) driven like the « Commandes » tab does, and the tab's view model.

const CH = '900100';
const STUDIO = { id: 'studio', role: 'broadcaster', via: 'studio' };

// ------------------------------------------------------------------ relay alone (fake Core)
describe('Studio commands relay', () => {
  const calls: { path: string; body?: unknown }[] = [];
  const fake: LabCoreCall = (async (path: string, body?: unknown) => {
    calls.push({ path, body });
    return { ok: true };
  }) as LabCoreCall;
  const call = commandsApi(fake);
  const go = (
    method: string,
    path: string,
    body: Record<string, unknown> = {},
  ) => call(method, new URL(path, 'http://studio'), body);
  beforeEach(() => (calls.length = 0));

  it('maps each page call to its Core route and signs every write as the Studio operator', async () => {
    await go('GET', '/api/commands');
    await go('POST', '/api/commands', {
      config: { name: 'x' },
      actor: { id: 'evil', role: 'broadcaster', via: 'extension' },
    });
    await go(
      'POST',
      '/api/commands/0b6f5d7c-1111-4222-8333-444455556666/update',
      { expected_version: 3, changes: { listed: false } },
    );
    await go('POST', '/api/commands/categories/cat-1a2b3c4d/update', {
      name: 'Fun',
    });
    await go('POST', '/api/commands/categories/order', { order: ['a', 'b'] });
    await go('POST', '/api/commands/test', {
      message: '!x',
      viewer: { id: '1' },
    });
    await go('GET', '/api/commands/invocations?command_id=abc&limit=20&evil=1');
    expect(calls).toEqual([
      { path: `/v1/lab/commands/${CH}`, body: undefined },
      {
        path: `/v1/lab/commands/${CH}`,
        body: { actor: STUDIO, config: { name: 'x' } },
      },
      {
        path: `/v1/lab/commands/${CH}/0b6f5d7c-1111-4222-8333-444455556666/update`,
        body: {
          actor: STUDIO,
          expected_version: 3,
          changes: { listed: false },
        },
      },
      {
        path: `/v1/lab/commands/${CH}/categories/cat-1a2b3c4d/update`,
        body: { actor: STUDIO, name: 'Fun' },
      },
      {
        path: `/v1/lab/commands/${CH}/categories/order`,
        body: { actor: STUDIO, order: ['a', 'b'] },
      },
      {
        path: `/v1/lab/commands/${CH}/test`,
        body: { actor: STUDIO, message: '!x', viewer: { id: '1' } },
      },
      {
        path: `/v1/lab/commands/${CH}/invocations?command_id=abc&limit=20`,
        body: undefined,
      },
    ]);
    expect(await go('POST', '/api/commands/whatever')).toEqual({
      status: 404,
      body: { error: 'not_found' },
    });
  });

  let server: Server | null = null;
  afterEach(() => server?.close());
  it('HTTP: Studio header required; Core errors keep their status and body (409 with the current version)', async () => {
    const relay = commandsRelay((async () => {
      throw Object.assign(new Error('version_conflict'), {
        status: 409,
        body: { error: 'version_conflict', current_version: 4 },
      });
    }) as LabCoreCall);
    server = createServer(
      (req, res) => void relay(req, res, new URL(req.url ?? '/', 'http://x')),
    );
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/api/commands`)).status).toBe(403);
    const r = await fetch(
      `${base}/api/commands/0b6f5d7c-1111-4222-8333-444455556666/update`,
      {
        method: 'POST',
        headers: { 'x-raptoru-studio': '1' },
        body: JSON.stringify({ expected_version: 3, changes: {} }),
      },
    );
    expect([r.status, await r.json()]).toEqual([
      409,
      { error: 'version_conflict', current_version: 4 },
    ]);
  });
});

// ------------------------------------------------------------------ relay → real Core (what the tab does)
describe('Studio « Commandes » against the real Core', () => {
  let db: Db;
  let svc: CommandsService;
  let api: ReturnType<typeof commandsApi>;
  const SYSTEM: SystemCommandDef = {
    module: 'raffle',
    key: 'raffle.join',
    defaults_version: 1,
    locked_fields: ['name', 'actions'],
    defaults: {
      name: 'ticket',
      aliases: [],
      description: 'Participer à la tombola',
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
    svc = new CommandsService(db, clock, {
      reserved,
      systemCommands: [SYSTEM],
    });
    const routes = commandsRoutes(
      svc,
      new CommandsAdmission(db, clock, { reserved }),
      new CommandSteps(db, clock),
    );
    const core = (async (path: string, body?: unknown) => {
      const url = new URL(path, 'http://lab');
      const route = routes.find(
        (r) =>
          r.method === (body === undefined ? 'GET' : 'POST') &&
          r.pattern.test(url.pathname),
      )!;
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
          throw Object.assign(
            new Error(String((e.body as { error: string }).error)),
            { status: e.status, body: e.body },
          );
        throw e;
      }
    }) as LabCoreCall;
    api = commandsApi(core);
  });
  const go = async <T = Record<string, unknown>>(
    method: string,
    path: string,
    body: Record<string, unknown> = {},
  ) => {
    try {
      const r = await api(method, new URL(path, 'http://studio'), body);
      return { status: r.status, body: r.body as T };
    } catch (e) {
      const err = e as { status: number; body: T };
      return { status: err.status, body: err.body };
    }
  };
  const list = async () =>
    (await go<ListResponse>('GET', '/api/commands')).body;
  const create = (config: Partial<CmdConfig>) =>
    go<CommandItem>('POST', '/api/commands', {
      config: {
        reply: { mode: 'normal', text: 'Salut !', to: 'none' },
        cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'viewer' },
        ...config,
      },
    });
  const ui = (o: Partial<ListUi> = {}): ListUi => ({
    side: 'all',
    cat: 'all',
    group: true,
    q: '',
    ...o,
  });

  it('categories: create, rename, recolour, reorder, delete — the list groups by them, « Sans catégorie » last', async () => {
    const a = await go<{ category_id: string }>(
      'POST',
      '/api/commands/categories',
      { name: 'Infos', icon: 'help', color: '#a855f7' },
    );
    const b = await go<{ category_id: string }>(
      'POST',
      '/api/commands/categories',
      { name: 'Fun', icon: 'sparkles', color: '#f2c65f' },
    );
    await create({ name: 'discord', category: a.body.category_id });
    await create({ name: 'hug', category: b.body.category_id });
    await create({ name: 'lurk' });
    await go('POST', `/api/commands/categories/${b.body.category_id}/update`, {
      name: 'Délires',
      color: '#22c55e',
    });
    await go('POST', '/api/commands/categories/order', {
      order: [b.body.category_id, a.body.category_id],
    });
    const l = await list();
    const g = groups(
      visible(l.commands, l.categories, ui()),
      l.categories,
      ui(),
    );
    expect(
      g.map(([k, rows]) => [k!.name, rows.map((r) => r.c.config.name)]),
    ).toEqual([
      ['Délires', ['hug']],
      ['Infos', ['discord']],
      ['Sans catégorie', ['lurk']],
    ]);
    // A chosen category: only it, no group title; grouping off: one flat list.
    expect(
      groups(
        visible(l.commands, l.categories, ui({ cat: a.body.category_id })),
        l.categories,
        ui({ cat: a.body.category_id }),
      ),
    ).toMatchObject([[null, [{ c: { config: { name: 'discord' } } }]]]);
    expect(
      groups(
        visible(l.commands, l.categories, ui({ group: false })),
        l.categories,
        ui({ group: false }),
      )[0]![0],
    ).toBeNull();
    await go('POST', `/api/commands/categories/${b.body.category_id}/delete`);
    const after = await list();
    expect(after.categories.map((k) => k.name)).toEqual(['Infos']);
    expect(
      after.commands.find((c) => c.config.name === 'hug')!.config.category,
    ).toBeNull();
  });

  it('create and edit (aliases, access, cooldown, quota) with expected_version; a 409 is re-applied, never overwritten', async () => {
    const c = (await create({ name: 'hug' })).body;
    const draft: CmdConfig = {
      ...c.config,
      aliases: ['calin'],
      audience: {
        groups: ['vips', 'subs'],
        allow: ['aouh'],
        deny: ['trollman'],
      },
      cooldown: { enabled: true, seconds: 300, unit: 'min', scope: 'global' },
      quota: { enabled: true, max: 3, window: 'live', scope: 'viewer' },
    };
    const saved = await go<CommandItem>(
      'POST',
      `/api/commands/${c.command_id}/update`,
      { expected_version: c.version, changes: changes(c.config, draft) },
    );
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(2);
    const row = (await list()).commands[0]!;
    expect([
      whoShort(row.config.audience),
      cooldownShort(row.config.cooldown),
      quotaShort(row.config.quota),
    ]).toEqual([
      'VIP + Abonnés + aouh · sauf trollman',
      '5 min global',
      '3 / live par personne',
    ]);
    // Someone else saves meanwhile: my stale save is refused with the current version…
    await go('POST', `/api/commands/${c.command_id}/update`, {
      expected_version: 2,
      changes: { description: 'Changée ailleurs' },
    });
    const mine: CmdConfig = {
      ...saved.body.config,
      reply: { mode: 'announce', text: 'Câlin !', to: 'none' },
    };
    const stale = await go<{ error: string; current: CommandItem }>(
      'POST',
      `/api/commands/${c.command_id}/update`,
      { expected_version: 2, changes: changes(saved.body.config, mine) },
    );
    expect(stale).toMatchObject({
      status: 409,
      body: { error: 'version_conflict', current: { version: 3 } },
    });
    // …the tab re-applies my change on top of it, and saves again explicitly.
    const r = reapply(saved.body.config, mine, stale.body.current.config);
    expect(r.draft).toMatchObject({
      description: 'Changée ailleurs',
      reply: { mode: 'announce' },
    });
    expect(r.both).toEqual([]);
    const again = await go<CommandItem>(
      'POST',
      `/api/commands/${c.command_id}/update`,
      {
        expected_version: 3,
        changes: changes(stale.body.current.config, r.draft),
      },
    );
    expect(again.body).toMatchObject({
      version: 4,
      config: { description: 'Changée ailleurs', reply: { mode: 'announce' } },
    });
  });

  it('a word already taken or reserved is refused by Core; a reserved word shadowing a command is shown « à vérifier »', async () => {
    await create({ name: 'hug' });
    expect(await create({ name: 'calin', aliases: ['hug'] })).toMatchObject({
      status: 409,
      body: { error: 'word_taken' },
    });
    expect(await create({ name: 'join' })).toMatchObject({
      status: 409,
      body: { error: 'word_reserved' },
    });
    // A command created before the module claimed its word (e.g. an older alias): kept, flagged.
    const plain = new CommandsService(
      db,
      new FakeClock(new Date('2026-10-04T18:00:00Z')),
    );
    await plain.create(
      CH,
      { id: 'studio', role: 'broadcaster', via: 'studio' },
      {
        name: 'participer',
        aliases: ['join'],
        reply: { mode: 'normal', text: 'ok', to: 'none' },
      },
    );
    const l = await list();
    const p = l.commands.find((c) => c.config.name === 'participer')!;
    expect(stateOf(p)).toMatchObject({ key: 'reserved', tone: 'bad' });
    expect(counts(l.commands, l.categories, ui()).check).toBe(1);
    expect(l.reserved_words).toEqual([{ word: 'join', module: 'raffle' }]);
  });

  it('system command: locked fields refused, reset to the module defaults, never deleted', async () => {
    await svc.syncSystem(CH);
    const sys = (await list()).commands.find((c) => c.kind === 'system')!;
    expect(sys).toMatchObject({
      owner_module: 'raffle',
      locked_fields: ['name', 'actions'],
    });
    expect(
      await go('POST', `/api/commands/${sys.command_id}/update`, {
        expected_version: sys.version,
        changes: { name: 'billet' },
      }),
    ).toMatchObject({
      status: 422,
      body: { error: 'field_locked', field: 'name' },
    });
    await go('POST', `/api/commands/${sys.command_id}/update`, {
      expected_version: sys.version,
      changes: { listed: false },
    });
    expect(
      await go('POST', `/api/commands/${sys.command_id}/delete`, {
        expected_version: 2,
      }),
    ).toMatchObject({ status: 422, body: { error: 'system_command' } });
    const reset = await go<CommandItem>(
      'POST',
      `/api/commands/${sys.command_id}/reset`,
      { expected_version: 2 },
    );
    expect(reset.body).toMatchObject({ version: 3, config: { listed: true } });
  });

  it('« Tester »: Core decides (accepted / refused, checks, rendering), nothing written', async () => {
    const c = (
      await create({
        name: 'hug',
        args: [{ name: 'cible', type: 'mention', required: true }],
        reply: {
          mode: 'normal',
          text: '{display_name} → {target}',
          to: 'none',
        },
      })
    ).body;
    const viewer = {
      id: '900101',
      login: 'pixelmamie',
      display_name: 'PixelMamie',
      role: 'viewer',
      badges: [],
    };
    const ok = await go<{
      decision: string;
      rendered: { reply: { text: string } };
      checks: unknown[];
    }>('POST', '/api/commands/test', { message: '!hug @Aouh', viewer });
    expect(ok.body).toMatchObject({
      decision: 'accepted',
      rendered: { reply: { text: 'PixelMamie → Aouh' } },
    });
    expect(ok.body.checks.length).toBeGreaterThan(5);
    expect(
      (await go('POST', '/api/commands/test', { message: '!hug', viewer }))
        .body,
    ).toMatchObject({ decision: 'rejected', reason: 'invalid_arguments' });
    expect(
      (
        await go<{ invocations: unknown[] }>(
          'GET',
          `/api/commands/invocations?command_id=${c.command_id}`,
        )
      ).body.invocations,
    ).toEqual([]);
  });

  it('history: who changed what (before → after)', async () => {
    const c = (await create({ name: 'hug' })).body;
    await go('POST', `/api/commands/${c.command_id}/update`, {
      expected_version: 1,
      changes: { listed: false },
    });
    const h = await go<{
      entries: {
        action: string;
        changes: { field: string; before: unknown; after: unknown }[];
      }[];
    }>('GET', `/api/commands/${c.command_id}/history`);
    expect(h.body.entries[0]).toMatchObject({
      action: 'update',
      changes: [{ field: 'listed', before: true, after: false }],
    });
  });
});

// ------------------------------------------------------------------ view model (wording, filters, variables)
describe('Commands tab view model', () => {
  const cat = (id: string, name: string, position: number): Category => ({
    category_id: id,
    name,
    icon: 'chat',
    color: '#000000',
    position,
  });
  const cmd = (
    name: string,
    o: Partial<CmdConfig> = {},
    extra: Partial<CommandItem> = {},
  ): CommandItem =>
    ({
      command_id: name,
      kind: 'custom',
      owner_module: null,
      system_key: null,
      locked_fields: [],
      defaults_version: null,
      version: 1,
      updated_at: '',
      updated_by: 'studio:studio',
      issues: [],
      config: {
        name,
        aliases: [],
        description: '',
        category: null,
        appearance: { icon: 'chat', color: '#000000' },
        enabled: true,
        listed: true,
        audience: { groups: ['everyone'], allow: [], deny: [] },
        cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'viewer' },
        quota: { enabled: false, max: 4, window: 'hour', scope: 'global' },
        reply: { mode: 'normal', text: 'x', to: 'none' },
        args: [],
        actions: [],
        reply_first: false,
        when: 'always',
        refuse: { mode: 'silent', text: '' },
        team_lock: false,
        ...o,
      },
      ...extra,
    }) as CommandItem;

  it('state filters and the category filter are separate; counters follow the category and the search', () => {
    const cats = [cat('fun', 'Fun', 0)];
    const all = [
      cmd('hug', { category: 'fun', aliases: ['calin'] }),
      cmd('lurk', { category: 'fun', enabled: false }),
      cmd('brb', { listed: false }),
      cmd('old', { category: 'gone' }),
    ];
    const u = (o: Partial<ListUi>): ListUi => ({
      side: 'all',
      cat: 'all',
      group: true,
      q: '',
      ...o,
    });
    expect(
      visible(all, cats, u({ side: 'off' })).map((x) => x.c.config.name),
    ).toEqual(['lurk']);
    expect(
      visible(all, cats, u({ side: 'hidden' })).map((x) => x.c.config.name),
    ).toEqual(['brb']);
    expect(
      visible(all, cats, u({ cat: 'none' })).map((x) => x.c.config.name),
    ).toEqual(['brb', 'old']);
    expect(visible(all, cats, u({ q: '!cal' }))).toEqual([
      { c: all[0], via: 'calin' },
    ]);
    expect(counts(all, cats, u({ cat: 'fun' }))).toMatchObject({
      all: 2,
      off: 1,
      hidden: 0,
    });
    // An unknown category id counts as « Sans catégorie ».
    const g = groups(visible(all, cats, u({})), cats, u({}));
    expect(g.map(([k, l]) => [k!.name, l.length])).toEqual([
      ['Fun', 2],
      [NO_CATEGORY.name, 2],
    ]);
  });

  it('access wording: no implicit exemption for the streamer', () => {
    expect(whoShort({ groups: [], allow: ['aouh'], deny: [] })).toBe(
      'Uniquement aouh',
    );
    expect(whoShort({ groups: [], allow: [], deny: [] })).toBe('Personne');
    expect(whoSentence({ groups: ['mods'], allow: [], deny: [] })).toContain(
      'le streamer aussi n’y a accès que s’il en fait partie',
    );
    expect(whoSentence({ groups: ['everyone'], allow: [], deny: [] })).toBe(
      'Tout le monde, streamer compris.',
    );
  });

  it('state: the switch is only « enabled »; problems are secondary, worst first', () => {
    expect(stateOf(cmd('a', { enabled: false }))).toMatchObject({ key: 'off' });
    expect(
      stateOf(
        cmd(
          'a',
          {},
          {
            issues: [
              {
                code: 'last_send_failed',
                status: 'unknown',
                error: 'timeout',
                at: '',
              },
            ],
          },
        ),
      ),
    ).toMatchObject({ key: 'send', label: 'Envoi incertain' });
    expect(
      stateOf(cmd('a', {}, { issues: [{ code: 'me_unsupported' }] })),
    ).toMatchObject({ key: 'me', tone: 'warn' });
  });

  it('variables: Core’s list only; incompatible ones disabled; inserted at the caret', () => {
    expect(VARIABLES.map((v) => v[0])).toEqual([
      '{display_name}',
      '{user}',
      '{target}',
      '{amount}',
      '{args}',
      '{count}',
    ]);
    expect(variableMissing({ args: [] }, 'mention')).toBe(true);
    expect(
      variableMissing(
        { args: [{ name: 'c', type: 'mention', required: true }] },
        'mention',
      ),
    ).toBe(false);
    expect(insertAt('Salut!', 5, 5, '{display_name}')).toEqual({
      text: 'Salut {display_name}!',
      caret: 20,
    });
    expect(
      previewText({ mode: 'normal', text: 'Câlin à {target}', to: 'author' }),
    ).toBe('@PixelMamie Câlin à Aouh');
  });

  it('a 409 keeps my edits on top of the current version and names the fields changed on both sides', () => {
    const base = cmd('a').config;
    const mine = { ...base, description: 'moi', listed: false };
    const theirs = { ...base, description: 'eux', enabled: false };
    const r = reapply(base, mine, theirs);
    expect(r.draft).toMatchObject({
      description: 'moi',
      listed: false,
      enabled: false,
    });
    expect(r.both).toEqual(['description']);
  });
});
