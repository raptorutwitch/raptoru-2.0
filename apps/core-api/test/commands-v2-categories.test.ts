import type { CmdConfig } from '@raptoru/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandsAdmission } from '../src/commands/admission.js';
import { CommandsError } from '../src/commands/model.js';
import { raffleReservedWords } from '../src/commands/reserved.js';
import { CommandsService } from '../src/commands/service.js';
import { CommandSteps } from '../src/commands/steps.js';
import type { Db } from '../src/db/db.js';
import { commandsRoutes } from '../src/http/commands-routes.js';
import { HttpError } from '../src/http/server.js';
import type { Actor } from '../src/lab-moderation/store.js';
import { RaffleLabService } from '../src/raffle-lab/raffle-lab-service.js';
import { createTestDb, FakeClock } from './helpers.js';

// Commands V2 — phase D (Studio): the streamer's categories, and what the Studio list reads from Core
// (30-day usage, issues, the steps of each invocation).

const CH = '900100';
const STUDIO: Actor = { id: 'studio', role: 'broadcaster', via: 'studio' };
const MOD: Actor = { id: '501', role: 'moderator', via: 'extension' };

let db: Db;
let clock: FakeClock;
let svc: CommandsService;
let adm: CommandsAdmission;
let steps: CommandSteps;

beforeEach(async () => {
  db = await createTestDb();
  clock = new FakeClock(new Date('2026-10-04T18:00:00Z'));
  const reserved = raffleReservedWords(new RaffleLabService(db, clock));
  svc = new CommandsService(db, clock, { reserved });
  adm = new CommandsAdmission(db, clock, { reserved });
  steps = new CommandSteps(db, clock);
});

async function fails(p: Promise<unknown>, status: number, code: string) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(CommandsError);
  expect([(e as CommandsError).status, (e as CommandsError).code]).toEqual([
    status,
    code,
  ]);
}
const make = (over: Partial<CmdConfig> = {}) =>
  svc.create(CH, STUDIO, {
    name: 'hug',
    reply: { mode: 'normal', text: 'Câlin !', to: 'none' },
    cooldown: { enabled: false, seconds: 30, unit: 's', scope: 'viewer' },
    ...over,
  });
const cat = (name: string, icon = 'chat', color = '#a855f7') =>
  svc.createCategory(CH, STUDIO, { name, icon, color });

describe('Commands V2 — categories', () => {
  it('none by default (never hard-coded); a new command is « Sans catégorie »', async () => {
    expect(await svc.categories(CH, STUDIO)).toEqual({ categories: [] });
    expect((await make()).config.category).toBeNull();
  });

  it('create, rename, recolour, reorder: positions follow the streamer', async () => {
    const infos = await cat('Infos', 'help', '#a855f7');
    const fun = await cat('Fun', 'sparkles', '#f2c65f');
    await cat('Modération', 'shield', '#ef4444');
    expect(
      (await svc.categories(CH, STUDIO)).categories.map((c) => [
        c.name,
        c.position,
      ]),
    ).toEqual([
      ['Infos', 0],
      ['Fun', 1],
      ['Modération', 2],
    ]);
    await svc.updateCategory(CH, STUDIO, fun.category_id, {
      name: 'Délires',
      color: '#22c55e',
    });
    const all = (await svc.categories(CH, STUDIO)).categories;
    const ids = all.map((c) => c.category_id);
    await svc.orderCategories(CH, STUDIO, [ids[2]!, ids[0]!, ids[1]!]);
    expect(
      (await svc.categories(CH, STUDIO)).categories.map((c) => [
        c.name,
        c.icon,
        c.color,
      ]),
    ).toEqual([
      ['Modération', 'shield', '#ef4444'],
      ['Infos', 'help', '#a855f7'],
      ['Délires', 'sparkles', '#22c55e'],
    ]);
    expect(infos.category_id).toMatch(/^cat-[0-9a-f]{8}$/);
  });

  it('refuses a duplicate name (case ignored), an incomplete order, an unknown category', async () => {
    const a = await cat('Infos');
    await fails(cat('infos'), 409, 'category_name_taken');
    await cat('Fun');
    await fails(
      svc.orderCategories(CH, STUDIO, [a.category_id]),
      422,
      'invalid_order',
    );
    await fails(make({ category: 'cat-nope' }), 422, 'unknown_category');
    await fails(
      svc.updateCategory(CH, STUDIO, 'cat-nope', { name: 'X' }),
      404,
      'category_not_found',
    );
  });

  it('a command belongs to a category or to none; deleting it moves its commands (logged)', async () => {
    const fun = await cat('Fun');
    const c = await make({ category: fun.category_id });
    expect(c.config.category).toBe(fun.category_id);
    const out = await svc.deleteCategory(CH, STUDIO, fun.category_id);
    expect(out).toMatchObject({ moved: 1, categories: [] });
    const after = await svc.get(CH, c.command_id, STUDIO);
    expect(after).toMatchObject({ version: 2, config: { category: null } });
    expect(
      (await svc.history(CH, c.command_id, STUDIO)).entries[0],
    ).toMatchObject({
      action: 'update',
      changes: [{ field: 'category', before: fun.category_id, after: null }],
    });
  });

  it('streamer only for changes; the team reads them; viewers never', async () => {
    await db.query(
      `insert into lab_staff (channel_id, viewer_id, role, granted_by, created_at, grants)
       values ($1, '502', 'supermod', 'studio:antoni', now(), '{}')`,
      [CH],
    );
    await cat('Infos');
    expect((await svc.categories(CH, MOD)).categories).toHaveLength(1);
    await fails(
      svc.createCategory(
        CH,
        { id: '502', role: 'moderator', via: 'extension' },
        {
          name: 'X',
          icon: 'chat',
          color: '#000000',
        },
      ),
      403,
      'streamer_only',
    );
    await fails(
      svc.categories(CH, { id: '503', role: 'viewer', via: 'extension' }),
      403,
      'team_only',
    );
  });

  it('the public list gives each command its category (name, icon, colour come from the list)', async () => {
    const fun = await cat('Fun', 'sparkles', '#f2c65f');
    await make({ category: fun.category_id });
    await make({ name: 'other' });
    expect(await adm.publicList(CH)).toMatchObject({
      categories: [
        {
          category_id: fun.category_id,
          name: 'Fun',
          icon: 'sparkles',
          color: '#f2c65f',
        },
      ],
      commands: [
        { name: 'hug', category_id: fun.category_id },
        { name: 'other', category_id: null },
      ],
    });
  });

  it('HTTP routes: list / create / update / order / delete', async () => {
    const routes = commandsRoutes(svc, adm, steps);
    const call = async (
      method: 'GET' | 'POST',
      path: string,
      body?: unknown,
    ) => {
      const url = new URL(path, 'http://lab');
      const route = routes.find(
        (r) => r.method === method && r.pattern.test(url.pathname),
      )!;
      try {
        return {
          status: 200,
          body: (await route.handle({
            params: route.pattern.exec(url.pathname)!.slice(1),
            url,
            body,
          })) as {
            categories: { category_id: string; name: string }[];
          },
        };
      } catch (e) {
        if (e instanceof HttpError)
          return { status: e.status, body: e.body as never };
        throw e;
      }
    };
    const B = `/v1/lab/commands/${CH}/categories`;
    await call('POST', B, {
      actor: STUDIO,
      name: 'Infos',
      icon: 'help',
      color: '#a855f7',
    });
    const { body } = await call('POST', B, {
      actor: STUDIO,
      name: 'Fun',
      icon: 'sparkles',
      color: '#f2c65f',
    });
    const [i, f] = body.categories.map((c) => c.category_id);
    await call('POST', `${B}/${f}/update`, { actor: STUDIO, name: 'Jeux' });
    await call('POST', `${B}/order`, { actor: STUDIO, order: [f, i] });
    expect((await call('GET', B)).body.categories.map((c) => c.name)).toEqual([
      'Jeux',
      'Infos',
    ]);
    await call('POST', `${B}/${i}/delete`, { actor: STUDIO });
    expect((await call('GET', B)).body.categories.map((c) => c.name)).toEqual([
      'Jeux',
    ]);
    expect(
      (
        await call('POST', B, {
          actor: STUDIO,
          name: '',
          icon: 'x',
          color: 'red',
        })
      ).status,
    ).toBe(400);
  });
});

describe('Commands V2 — what the Studio list reads', () => {
  const say = (text: string, id: string) =>
    adm.chat({
      channel_id: CH,
      message_id: id,
      text,
      chatter: { id: '700', login: 'v', display_name: 'V', role: 'viewer' },
      source: 'twitch',
    });

  it('30-day usage, categories, and the issues (reserved word, last send failed, /me)', async () => {
    const fun = await cat('Fun');
    const c = await make({ category: fun.category_id });
    await make({
      name: 'moi',
      reply: { mode: 'me', text: 'danse', to: 'none' },
    });
    await say('!hug', 'a');
    await say('!hug', 'b');
    await steps.setOutput(CH, STUDIO, true);
    const s = (await steps.claim(CH, 'bot')).step!;
    await steps.ack(CH, s.step_id, {
      executor_id: 'bot',
      attempt_id: s.attempt_id!,
      event: 'running',
    });
    await steps.ack(CH, s.step_id, {
      executor_id: 'bot',
      attempt_id: s.attempt_id!,
      event: 'unknown',
      error: { code: 'timeout', message: 'maybe sent', retryable: false },
    });
    const list = await svc.list(CH, STUDIO);
    expect(list.categories.map((x) => x.name)).toEqual(['Fun']);
    const hug = list.commands.find((x) => x.command_id === c.command_id)!;
    expect(hug).toMatchObject({
      uses_30d: 2,
      issues: [
        { code: 'last_send_failed', status: 'unknown', error: 'timeout' },
      ],
    });
    expect(list.commands.find((x) => x.config.name === 'moi')!.issues).toEqual([
      { code: 'me_unsupported' },
    ]);
    // The next send of the same command succeeds: no more issue.
    const s2 = (await steps.claim(CH, 'bot')).step!;
    await steps.ack(CH, s2.step_id, {
      executor_id: 'bot',
      attempt_id: s2.attempt_id!,
      event: 'running',
    });
    await steps.ack(CH, s2.step_id, {
      executor_id: 'bot',
      attempt_id: s2.attempt_id!,
      event: 'succeeded',
      twitch_message_id: 'm',
    });
    expect(
      (await svc.list(CH, STUDIO)).commands.find(
        (x) => x.command_id === c.command_id,
      )!.issues,
    ).toEqual([]);
  });

  it('each invocation lists its steps (sent, failed, expired…)', async () => {
    await make();
    await say('!hug', 'a');
    const inv = (await adm.invocations(CH, STUDIO, null, 10)).invocations[0]!;
    expect(inv.steps).toMatchObject([
      { seq: 1, kind: 'reply', status: 'queued', error: null },
    ]);
  });
});
