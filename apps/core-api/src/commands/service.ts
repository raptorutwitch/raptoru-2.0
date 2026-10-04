import { randomUUID } from 'node:crypto';
import {
  type CmdConfig,
  CmdTeamRights,
  type CmdField,
  type CmdTeamRole,
  type LabRole,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import { access, type Actor } from '../lab-moderation/store.js';
import {
  assertTeamMayChange,
  checkConfig,
  CommandsError,
  DEFAULT_TEAM_RIGHTS,
  defaultConfig,
  diffConfig,
  type FieldChange,
  same,
} from './model.js';

// Commands V2 (Lab) — configuration (phase A). Core is the source of truth: every mutation locks the
// channel, checks the version the caller read, validates the whole configuration, applies the team
// rights field by field, keeps the trigger words unique per channel (names and aliases, disabled
// commands included; reserved words of the modules refused) and writes the exact before / after.
// No admission, no queue, no execution here (phases B / C).

/** A word owned by a module (e.g. Tombola's « !join »): never usable by Commands V2. */
export interface ReservedWord {
  word: string;
  module: string;
}
export type ReservedWords = (
  q: Queryable,
  channelId: string,
) => Promise<ReservedWord[]>;

/** A command provided by a module: stable key, locked fields, versioned defaults. */
export interface SystemCommandDef {
  module: string;
  key: string;
  defaults_version: number;
  defaults: CmdConfig;
  locked_fields: CmdField[];
}

export interface CommandsDeps {
  reserved?: ReservedWords;
  systemCommands?: SystemCommandDef[];
}

export interface CommandView {
  command_id: string;
  kind: 'custom' | 'system';
  owner_module: string | null;
  system_key: string | null;
  locked_fields: CmdField[];
  defaults_version: number | null;
  version: number;
  config: CmdConfig;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

export interface HistoryEntry {
  id: number;
  command_id: string | null;
  version: number | null;
  action: 'create' | 'update' | 'delete' | 'reset' | 'system_sync' | 'rights';
  actor_id: string;
  actor_login: string | null;
  actor_role: LabRole | 'system';
  via: Actor['via'];
  changes: { field: string; before: unknown; after: unknown }[];
  created_at: string;
}

interface Row {
  command_id: string;
  kind: 'custom' | 'system';
  owner_module: string | null;
  system_key: string | null;
  locked_fields: CmdField[];
  defaults: CmdConfig | null;
  defaults_version: number | null;
  version: number;
  config: CmdConfig;
  created_at: Date;
  updated_at: Date;
  updated_by: string;
}

const COLS =
  'command_id, kind, owner_module, system_key, locked_fields, defaults, defaults_version, version, config, created_at, updated_at, updated_by';

const view = (r: Row): CommandView => ({
  command_id: r.command_id,
  kind: r.kind,
  owner_module: r.owner_module,
  system_key: r.system_key,
  locked_fields: r.locked_fields,
  defaults_version: r.defaults_version,
  version: r.version,
  config: r.config,
  created_at: new Date(r.created_at).toISOString(),
  updated_at: new Date(r.updated_at).toISOString(),
  updated_by: r.updated_by,
});

const label = (a: Actor) => `${a.via}:${a.id}`;

export class CommandsService {
  private readonly systemDefs: SystemCommandDef[];

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly deps: CommandsDeps = {},
  ) {
    this.systemDefs = deps.systemCommands ?? [];
    for (const d of this.systemDefs) {
      checkConfig(d.defaults);
      if (
        !d.defaults.actions.some(
          (a) => a.type === 'module' && a.module === d.module,
        )
      )
        throw new Error(`system command ${d.key}: no protected module action`);
    }
  }

  // --- reads (team only; Studio = streamer) --------------------------------------------------------

  async list(channelId: string, reader: Actor) {
    return this.db.tx(async (q) => {
      await this.teamRole(q, channelId, reader);
      const rows = await q.query<Row>(
        `select ${COLS} from cmd_commands where channel_id = $1 and deleted_at is null order by name`,
        [channelId],
      );
      // A module may claim a word after a command took it (e.g. a Tombola alias added later):
      // shown, never silently resolved.
      const reserved = await this.reserved(q, channelId);
      const now = this.clock.now().getTime();
      // Accepted uses over 30 days, and the outcome of the last chat step sent for each command.
      const uses = new Map(
        (
          await q.query<{ command_id: string; n: number }>(
            `select command_id, count(*)::int as n from cmd_invocations
             where channel_id = $1 and decision = 'accepted' and created_at > $2 group by command_id`,
            [channelId, new Date(now - 30 * 86_400_000)],
          )
        ).map((u) => [u.command_id, Number(u.n)]),
      );
      const last = new Map(
        (
          await q.query<{
            command_id: string;
            status: string;
            code: string | null;
            at: Date;
          }>(
            `select distinct on (i.command_id) i.command_id, s.status, s.error->>'code' as code, s.finished_at as at
             from cmd_steps s join cmd_invocations i using (invocation_id)
             where s.channel_id = $1 and s.type = 'chat' and s.status in ('succeeded', 'failed', 'unknown', 'expired')
             order by i.command_id, s.seq_global desc`,
            [channelId],
          )
        ).map((l) => [l.command_id, l]),
      );
      return {
        commands: rows.map((r) => {
          const shadowed = reserved.filter(
            (w) =>
              w.word === r.config.name || r.config.aliases.includes(w.word),
          );
          const l = last.get(r.command_id);
          const me =
            r.config.reply.mode === 'me' ||
            r.config.actions.some((a) => a.type === 'chat' && a.mode === 'me');
          // What needs the streamer's attention, worst first (the UI only words it).
          const issues = [
            ...shadowed.map((w) => ({
              code: 'word_reserved' as const,
              word: w.word,
              module: w.module,
            })),
            ...(l && l.status !== 'succeeded'
              ? [
                  {
                    code: 'last_send_failed' as const,
                    status: l.status,
                    error: l.code,
                    at: new Date(l.at).toISOString(),
                  },
                ]
              : []),
            ...(me ? [{ code: 'me_unsupported' as const }] : []),
          ];
          return {
            ...view(r),
            shadowed_words: shadowed,
            uses_30d: uses.get(r.command_id) ?? 0,
            issues,
          };
        }),
        reserved_words: reserved,
        categories: await this.categoryRows(q, channelId),
      };
    });
  }

  async get(channelId: string, commandId: string, reader: Actor) {
    return this.db.tx(async (q) => {
      await this.teamRole(q, channelId, reader);
      return view(await this.row(q, channelId, commandId));
    });
  }

  async history(
    channelId: string,
    commandId: string | null,
    reader: Actor,
    limit = 50,
  ) {
    return this.db.tx(async (q) => {
      await this.teamRole(q, channelId, reader);
      const rows = await q.query<HistoryEntry & { created_at: Date }>(
        `select id, command_id, version, action, actor_id, actor_login, actor_role, via, changes, created_at
         from cmd_history where channel_id = $1 and ($2::uuid is null or command_id = $2)
         order by id desc limit $3`,
        [channelId, commandId, limit],
      );
      return {
        entries: rows.map((r) => ({
          ...r,
          created_at: new Date(r.created_at).toISOString(),
        })),
      };
    });
  }

  async rights(channelId: string, reader: Actor) {
    return this.db.tx(async (q) => {
      await this.teamRole(q, channelId, reader);
      return {
        moderator: await this.rightsOf(q, channelId, 'moderator'),
        supermod: await this.rightsOf(q, channelId, 'supermod'),
      };
    });
  }

  // --- categories (the streamer's; the team reads them) ----------------------------------------------

  async categories(channelId: string, reader: Actor) {
    return this.db.tx(async (q) => {
      await this.teamRole(q, channelId, reader);
      return { categories: await this.categoryRows(q, channelId) };
    });
  }

  async createCategory(
    channelId: string,
    actor: Actor,
    c: { name: string; icon: string; color: string },
  ) {
    return this.db.tx(async (q) => {
      await this.lockChannel(q, channelId);
      await this.streamerOnly(q, channelId, actor, 'categories');
      await this.assertCategoryName(q, channelId, c.name, null);
      const now = this.clock.now();
      const id = `cat-${randomUUID().slice(0, 8)}`;
      await q.query(
        `insert into cmd_categories (channel_id, category_id, name, icon, color, position, created_at, updated_at, updated_by)
         values ($1, $2, $3, $4, $5,
           (select coalesce(max(position) + 1, 0) from cmd_categories where channel_id = $1), $6, $6, $7)`,
        [channelId, id, c.name.trim(), c.icon, c.color, now, label(actor)],
      );
      return {
        category_id: id,
        categories: await this.categoryRows(q, channelId),
      };
    });
  }

  async updateCategory(
    channelId: string,
    actor: Actor,
    categoryId: string,
    patch: { name?: string; icon?: string; color?: string },
  ) {
    return this.db.tx(async (q) => {
      await this.lockChannel(q, channelId);
      await this.streamerOnly(q, channelId, actor, 'categories');
      const cur = (await this.categoryRows(q, channelId)).find(
        (c) => c.category_id === categoryId,
      );
      if (!cur) throw new CommandsError(404, 'category_not_found');
      if (patch.name !== undefined)
        await this.assertCategoryName(q, channelId, patch.name, categoryId);
      await q.query(
        `update cmd_categories set name = $3, icon = $4, color = $5, updated_at = $6, updated_by = $7
         where channel_id = $1 and category_id = $2`,
        [
          channelId,
          categoryId,
          patch.name?.trim() ?? cur.name,
          patch.icon ?? cur.icon,
          patch.color ?? cur.color,
          this.clock.now(),
          label(actor),
        ],
      );
      return { categories: await this.categoryRows(q, channelId) };
    });
  }

  /** Its commands are kept, « Sans catégorie » (each change logged like any update). */
  async deleteCategory(channelId: string, actor: Actor, categoryId: string) {
    return this.db.tx(async (q) => {
      await this.lockChannel(q, channelId);
      const role = await this.streamerOnly(q, channelId, actor, 'categories');
      const gone = await q.query(
        'delete from cmd_categories where channel_id = $1 and category_id = $2 returning category_id',
        [channelId, categoryId],
      );
      if (!gone.length) throw new CommandsError(404, 'category_not_found');
      const rows = await q.query<Row>(
        `select ${COLS} from cmd_commands where channel_id = $1 and deleted_at is null and config->>'category' = $2
         order by name for update`,
        [channelId, categoryId],
      );
      for (const cur of rows) {
        const after = { ...cur.config, category: null };
        await this.write(
          q,
          channelId,
          cur,
          after,
          actor,
          role,
          'update',
          diffConfig(cur.config, after),
        );
      }
      // Positions stay 0..n-1.
      await q.query(
        `update cmd_categories c set position = o.n - 1 from (
           select category_id, row_number() over (order by position, name) as n from cmd_categories where channel_id = $1
         ) o where c.channel_id = $1 and c.category_id = o.category_id`,
        [channelId],
      );
      return {
        moved: rows.length,
        categories: await this.categoryRows(q, channelId),
      };
    });
  }

  async orderCategories(channelId: string, actor: Actor, order: string[]) {
    return this.db.tx(async (q) => {
      await this.lockChannel(q, channelId);
      await this.streamerOnly(q, channelId, actor, 'categories');
      const ids = (await this.categoryRows(q, channelId)).map(
        (c) => c.category_id,
      );
      if (
        order.length !== ids.length ||
        new Set(order).size !== ids.length ||
        order.some((id) => !ids.includes(id))
      )
        throw new CommandsError(422, 'invalid_order', {
          message: 'the order must list every category once',
          categories: ids,
        });
      for (const [i, id] of order.entries())
        await q.query(
          'update cmd_categories set position = $3 where channel_id = $1 and category_id = $2',
          [channelId, id, i],
        );
      return { categories: await this.categoryRows(q, channelId) };
    });
  }

  // --- mutations -----------------------------------------------------------------------------------

  async create(channelId: string, actor: Actor, partial: Partial<CmdConfig>) {
    return this.db.tx(async (q) => {
      await this.lockChannel(q, channelId);
      const role = await this.teamRole(q, channelId, actor);
      if (!partial.name)
        throw new CommandsError(422, 'invalid_config', {
          issues: ['name: required'],
        });
      const base = defaultConfig(partial.name);
      const after = checkConfig({ ...base, ...partial });
      if (after.actions.some((a) => a.type === 'module'))
        throw new CommandsError(422, 'module_action_reserved', {
          message: 'a module action belongs to a system command',
        });
      const changes = diffConfig(base, after);
      if (role !== 'broadcaster') {
        const rights = await this.rightsOf(q, channelId, role);
        if (!rights.rights.create)
          throw new CommandsError(403, 'not_delegated', {
            right: 'create',
            role,
          });
        assertTeamMayChange(role, rights.rights, changes, after, true);
      }
      await this.assertWordsFree(q, channelId, null, after);
      await this.assertCategory(q, channelId, after.category);
      const id = randomUUID();
      const now = this.clock.now();
      await q.query(
        `insert into cmd_commands (command_id, channel_id, kind, name, enabled, listed, config, version,
           created_at, created_by, updated_at, updated_by)
         values ($1, $2, 'custom', $3, $4, $5, $6, 1, $7, $8, $7, $8)`,
        [
          id,
          channelId,
          after.name,
          after.enabled,
          after.listed,
          JSON.stringify(after),
          now,
          label(actor),
        ],
      );
      await this.writeTriggers(q, channelId, id, after);
      await this.log(
        q,
        channelId,
        id,
        1,
        'create',
        actor,
        role,
        [
          { field: 'name', before: null, after: after.name },
          ...changes.filter((c) => c.field !== 'name'),
        ],
        after,
      );
      return view(await this.row(q, channelId, id));
    });
  }

  async update(
    channelId: string,
    commandId: string,
    actor: Actor,
    expectedVersion: number,
    changes: Partial<CmdConfig>,
  ) {
    return this.db.tx(async (q) => {
      await this.lockChannel(q, channelId);
      const role = await this.teamRole(q, channelId, actor);
      const cur = await this.row(q, channelId, commandId);
      this.assertVersion(cur, expectedVersion);
      const after = checkConfig({ ...cur.config, ...changes });
      const diff = diffConfig(cur.config, after);
      if (!diff.length) return view(cur);
      this.assertUnlocked(cur, diff);
      this.assertActions(cur, after);
      if (role !== 'broadcaster') {
        if (cur.config.team_lock)
          throw new CommandsError(403, 'command_locked', { role });
        const rights = await this.rightsOf(q, channelId, role);
        assertTeamMayChange(role, rights.rights, diff, after);
      }
      if (diff.some((c) => c.field === 'name' || c.field === 'aliases'))
        await this.assertWordsFree(q, channelId, commandId, after);
      if (diff.some((c) => c.field === 'category'))
        await this.assertCategory(q, channelId, after.category);
      return this.write(q, channelId, cur, after, actor, role, 'update', diff);
    });
  }

  /** Soft delete: history kept, words released. System commands cannot be deleted. */
  async remove(
    channelId: string,
    commandId: string,
    actor: Actor,
    expectedVersion: number,
  ) {
    return this.db.tx(async (q) => {
      await this.lockChannel(q, channelId);
      const role = await this.teamRole(q, channelId, actor);
      const cur = await this.row(q, channelId, commandId);
      this.assertVersion(cur, expectedVersion);
      if (cur.kind === 'system')
        throw new CommandsError(422, 'system_command', {
          message: 'a module command cannot be deleted (disable it instead)',
        });
      if (role !== 'broadcaster') {
        if (cur.config.team_lock)
          throw new CommandsError(403, 'command_locked', { role });
        const rights = await this.rightsOf(q, channelId, role);
        if (!rights.rights.remove)
          throw new CommandsError(403, 'not_delegated', {
            right: 'remove',
            role,
          });
      }
      const now = this.clock.now();
      await q.query(
        `update cmd_commands set deleted_at = $3, deleted_by = $4, enabled = false, version = version + 1,
           updated_at = $3, updated_by = $4 where command_id = $1 and channel_id = $2`,
        [commandId, channelId, now, label(actor)],
      );
      await q.query('delete from cmd_triggers where command_id = $1', [
        commandId,
      ]);
      await this.log(
        q,
        channelId,
        commandId,
        cur.version + 1,
        'delete',
        actor,
        role,
        [{ field: 'name', before: cur.config.name, after: null }],
        null,
      );
      return { ok: true, command_id: commandId };
    });
  }

  /** Back to the module defaults (system commands, streamer only). */
  async reset(
    channelId: string,
    commandId: string,
    actor: Actor,
    expectedVersion: number,
  ) {
    return this.db.tx(async (q) => {
      await this.lockChannel(q, channelId);
      const role = await this.teamRole(q, channelId, actor);
      if (role !== 'broadcaster')
        throw new CommandsError(403, 'streamer_only', {
          action: 'reset',
          role,
        });
      const cur = await this.row(q, channelId, commandId);
      this.assertVersion(cur, expectedVersion);
      if (cur.kind !== 'system' || !cur.defaults)
        throw new CommandsError(422, 'not_a_system_command');
      const after = checkConfig(cur.defaults);
      const diff = diffConfig(cur.config, after);
      if (!diff.length) return view(cur);
      if (diff.some((c) => c.field === 'name' || c.field === 'aliases'))
        await this.assertWordsFree(q, channelId, commandId, after);
      return this.write(q, channelId, cur, after, actor, role, 'reset', diff);
    });
  }

  async setRights(
    channelId: string,
    actor: Actor,
    role: CmdTeamRole,
    expectedVersion: number,
    rights: CmdTeamRights,
  ) {
    return this.db.tx(async (q) => {
      await this.lockChannel(q, channelId);
      const by = await this.teamRole(q, channelId, actor);
      if (by !== 'broadcaster')
        throw new CommandsError(403, 'streamer_only', {
          action: 'rights',
          role: by,
        });
      const cur = await this.rightsOf(q, channelId, role);
      if (cur.version !== expectedVersion)
        throw new CommandsError(409, 'version_conflict', {
          current_version: cur.version,
          current: cur.rights,
        });
      const parsed = CmdTeamRights.safeParse(rights);
      if (!parsed.success)
        throw new CommandsError(422, 'invalid_rights', {
          issues: parsed.error.issues.map(
            (i) => `${i.path.join('.')}: ${i.message}`,
          ),
        });
      const next = parsed.data;
      const changes = (Object.keys(next) as (keyof CmdTeamRights)[])
        .filter((k) => !same(next[k], cur.rights[k]))
        .map((k) => ({
          field: `${role}.${k}`,
          before: cur.rights[k],
          after: next[k],
        }));
      if (!changes.length) return cur;
      const now = this.clock.now();
      await q.query(
        `insert into cmd_team_rights (channel_id, role, rights, version, updated_at, updated_by)
         values ($1, $2, $3, 1, $4, $5)
         on conflict (channel_id, role) do update set rights = excluded.rights,
           version = cmd_team_rights.version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        [channelId, role, JSON.stringify(next), now, label(actor)],
      );
      await q.query(
        `insert into cmd_history (channel_id, command_id, version, action, actor_id, actor_login, actor_role, via, changes, snapshot, created_at)
         values ($1, null, $2, 'rights', $3, $4, $5, $6, $7, $8, $9)`,
        [
          channelId,
          cur.version + 1,
          actor.id,
          actor.login ?? null,
          by,
          actor.via,
          JSON.stringify(changes),
          JSON.stringify({ role, rights: next }),
          now,
        ],
      );
      return this.rightsOf(q, channelId, role);
    });
  }

  /**
   * Creates the module commands that do not exist yet; when a module ships newer defaults, its
   * locked fields follow them and the streamer's adaptations of the other fields are kept.
   */
  async syncSystem(channelId: string) {
    return this.db.tx(async (q) => {
      await this.lockChannel(q, channelId);
      const system: Actor = {
        id: 'commands',
        role: 'broadcaster',
        via: 'system',
      };
      const out: {
        key: string;
        outcome: 'created' | 'upgraded' | 'unchanged' | 'word_taken';
      }[] = [];
      for (const d of this.systemDefs) {
        const cur = (
          await q.query<Row>(
            `select ${COLS} from cmd_commands where channel_id = $1 and system_key = $2`,
            [channelId, d.key],
          )
        )[0];
        if (!cur) {
          try {
            await this.assertWordsFree(q, channelId, null, d.defaults);
          } catch (e) {
            if (e instanceof CommandsError && e.status === 409) {
              out.push({ key: d.key, outcome: 'word_taken' });
              continue;
            }
            throw e;
          }
          const id = randomUUID();
          const now = this.clock.now();
          await q.query(
            `insert into cmd_commands (command_id, channel_id, kind, owner_module, system_key, locked_fields,
               defaults, defaults_version, name, enabled, listed, config, version, created_at, created_by, updated_at, updated_by)
             values ($1, $2, 'system', $3, $4, $5, $6, $7, $8, $9, $10, $6, 1, $11, $12, $11, $12)`,
            [
              id,
              channelId,
              d.module,
              d.key,
              d.locked_fields,
              JSON.stringify(d.defaults),
              d.defaults_version,
              d.defaults.name,
              d.defaults.enabled,
              d.defaults.listed,
              now,
              `system:${d.module}`,
            ],
          );
          await this.writeTriggers(q, channelId, id, d.defaults);
          await this.log(
            q,
            channelId,
            id,
            1,
            'system_sync',
            system,
            'system',
            [],
            d.defaults,
          );
          out.push({ key: d.key, outcome: 'created' });
          continue;
        }
        if ((cur.defaults_version ?? 0) >= d.defaults_version) {
          out.push({ key: d.key, outcome: 'unchanged' });
          continue;
        }
        const after = { ...cur.config };
        for (const f of d.locked_fields) {
          if (f.startsWith('audience.')) {
            const sub = f.slice('audience.'.length) as
              'groups' | 'allow' | 'deny';
            after.audience = {
              ...after.audience,
              [sub]: d.defaults.audience[sub],
            };
          } else
            (after as Record<string, unknown>)[f] =
              d.defaults[f as keyof CmdConfig];
        }
        const checked = checkConfig(after);
        await q.query(
          `update cmd_commands set defaults = $3, defaults_version = $4, locked_fields = $5 where command_id = $1 and channel_id = $2`,
          [
            cur.command_id,
            channelId,
            JSON.stringify(d.defaults),
            d.defaults_version,
            d.locked_fields,
          ],
        );
        const diff = diffConfig(cur.config, checked);
        await this.write(
          q,
          channelId,
          { ...cur, locked_fields: d.locked_fields },
          checked,
          system,
          'system',
          'system_sync',
          diff,
        );
        out.push({ key: d.key, outcome: 'upgraded' });
      }
      return { system: out };
    });
  }

  // --- helpers -------------------------------------------------------------------------------------

  private async lockChannel(q: Queryable, channelId: string) {
    await q.query(
      'insert into cmd_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
      [channelId],
    );
    await q.query(
      'select 1 from cmd_channels where channel_id = $1 for update',
      [channelId],
    );
  }

  /** Effective role (Studio = streamer). Viewers never read nor change the configuration. */
  private async teamRole(q: Queryable, channelId: string, a: Actor) {
    const acc = await access(q, channelId, a);
    if (acc.role === 'viewer')
      throw new CommandsError(403, 'team_only', { role: 'viewer' });
    return acc.role as Exclude<LabRole, 'viewer'>;
  }

  private async streamerOnly(
    q: Queryable,
    channelId: string,
    a: Actor,
    action: string,
  ) {
    const role = await this.teamRole(q, channelId, a);
    if (role !== 'broadcaster')
      throw new CommandsError(403, 'streamer_only', { action, role });
    return role;
  }

  private async categoryRows(q: Queryable, channelId: string) {
    const rows = await q.query<{
      category_id: string;
      name: string;
      icon: string;
      color: string;
      position: number;
      updated_at: Date;
      updated_by: string;
    }>(
      `select category_id, name, icon, color, position, updated_at, updated_by from cmd_categories
       where channel_id = $1 order by position, name`,
      [channelId],
    );
    return rows.map((r) => ({
      ...r,
      position: Number(r.position),
      updated_at: new Date(r.updated_at).toISOString(),
    }));
  }

  private async assertCategoryName(
    q: Queryable,
    channelId: string,
    name: string,
    self: string | null,
  ) {
    const taken = await q.query(
      `select 1 from cmd_categories where channel_id = $1 and lower(name) = lower($2)
         and ($3::text is null or category_id <> $3)`,
      [channelId, name.trim(), self],
    );
    if (taken.length)
      throw new CommandsError(409, 'category_name_taken', {
        name: name.trim(),
      });
  }

  /** A command's category must exist on the channel (null = « Sans catégorie »). */
  private async assertCategory(
    q: Queryable,
    channelId: string,
    categoryId: string | null,
  ) {
    if (categoryId === null) return;
    const ok = await q.query(
      'select 1 from cmd_categories where channel_id = $1 and category_id = $2',
      [channelId, categoryId],
    );
    if (!ok.length)
      throw new CommandsError(422, 'unknown_category', {
        category: categoryId,
      });
  }

  private async rightsOf(q: Queryable, channelId: string, role: CmdTeamRole) {
    const row = (
      await q.query<{ rights: CmdTeamRights; version: number }>(
        'select rights, version from cmd_team_rights where channel_id = $1 and role = $2',
        [channelId, role],
      )
    )[0];
    return row
      ? { rights: CmdTeamRights.parse(row.rights), version: row.version }
      : { rights: structuredClone(DEFAULT_TEAM_RIGHTS[role]), version: 0 };
  }

  private async row(q: Queryable, channelId: string, commandId: string) {
    if (!/^[0-9a-f-]{36}$/.test(commandId))
      throw new CommandsError(404, 'command_not_found');
    const r = (
      await q.query<Row>(
        `select ${COLS} from cmd_commands where command_id = $1 and channel_id = $2 and deleted_at is null for update`,
        [commandId, channelId],
      )
    )[0];
    if (!r) throw new CommandsError(404, 'command_not_found');
    return r;
  }

  private assertVersion(cur: Row, expected: number) {
    if (cur.version !== expected)
      throw new CommandsError(409, 'version_conflict', {
        current_version: cur.version,
        current: view(cur),
      });
  }

  private assertUnlocked(cur: Row, diff: FieldChange[]) {
    const locked = diff.find((c) => cur.locked_fields.includes(c.field));
    if (locked)
      throw new CommandsError(422, 'field_locked', {
        field: locked.field,
        module: cur.owner_module,
      });
  }

  /** Custom commands never hold a module action; a system command keeps its own, untouched. */
  private assertActions(cur: Row, after: CmdConfig) {
    const modules = (c: CmdConfig) =>
      c.actions.filter((a) => a.type === 'module');
    if (cur.kind === 'custom' && after.actions.some((a) => a.type === 'module'))
      throw new CommandsError(422, 'module_action_reserved');
    if (cur.kind === 'system' && !same(modules(after), modules(cur.config)))
      throw new CommandsError(422, 'module_action_protected', {
        module: cur.owner_module,
      });
  }

  private async reserved(q: Queryable, channelId: string) {
    return this.deps.reserved ? this.deps.reserved(q, channelId) : [];
  }

  /** Name and aliases free on the channel (other commands, disabled ones included) and not reserved. */
  private async assertWordsFree(
    q: Queryable,
    channelId: string,
    commandId: string | null,
    c: CmdConfig,
  ) {
    const words = [c.name, ...c.aliases];
    const reserved = await this.reserved(q, channelId);
    const hit = reserved.find((r) => words.includes(r.word));
    if (hit)
      throw new CommandsError(409, 'word_reserved', {
        word: hit.word,
        module: hit.module,
      });
    const taken = await q.query<{
      word: string;
      command_id: string;
      name: string;
    }>(
      `select t.word, t.command_id, c.name from cmd_triggers t join cmd_commands c using (command_id)
       where t.channel_id = $1 and t.word = any($2) and ($3::uuid is null or t.command_id <> $3)`,
      [channelId, words, commandId],
    );
    if (taken.length)
      throw new CommandsError(409, 'word_taken', {
        word: taken[0]!.word,
        command_id: taken[0]!.command_id,
        command: taken[0]!.name,
      });
  }

  private async writeTriggers(
    q: Queryable,
    channelId: string,
    commandId: string,
    c: CmdConfig,
  ) {
    await q.query('delete from cmd_triggers where command_id = $1', [
      commandId,
    ]);
    await q.query(
      `insert into cmd_triggers (channel_id, word, command_id, kind) values ($1, $2, $3, 'name')`,
      [channelId, c.name, commandId],
    );
    for (const a of c.aliases)
      await q.query(
        `insert into cmd_triggers (channel_id, word, command_id, kind) values ($1, $2, $3, 'alias')`,
        [channelId, a, commandId],
      );
  }

  private async write(
    q: Queryable,
    channelId: string,
    cur: Row,
    after: CmdConfig,
    actor: Actor,
    role: LabRole | 'system',
    action: 'update' | 'reset' | 'system_sync',
    diff: FieldChange[],
  ) {
    const now = this.clock.now();
    await q.query(
      `update cmd_commands set config = $3, name = $4, enabled = $5, listed = $6, version = version + 1,
         updated_at = $7, updated_by = $8 where command_id = $1 and channel_id = $2`,
      [
        cur.command_id,
        channelId,
        JSON.stringify(after),
        after.name,
        after.enabled,
        after.listed,
        now,
        label(actor),
      ],
    );
    if (diff.some((c) => c.field === 'name' || c.field === 'aliases'))
      await this.writeTriggers(q, channelId, cur.command_id, after);
    await this.log(
      q,
      channelId,
      cur.command_id,
      cur.version + 1,
      action,
      actor,
      role,
      diff,
      after,
    );
    return view(await this.row(q, channelId, cur.command_id));
  }

  private async log(
    q: Queryable,
    channelId: string,
    commandId: string,
    version: number,
    action: 'create' | 'update' | 'delete' | 'reset' | 'system_sync',
    actor: Actor,
    role: LabRole | 'system',
    changes: FieldChange[],
    snapshot: CmdConfig | null,
  ) {
    await q.query(
      `insert into cmd_history (channel_id, command_id, version, action, actor_id, actor_login, actor_role, via, changes, snapshot, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        channelId,
        commandId,
        version,
        action,
        actor.id,
        actor.login ?? null,
        role,
        actor.via,
        JSON.stringify(changes),
        snapshot ? JSON.stringify(snapshot) : null,
        this.clock.now(),
      ],
    );
  }
}
