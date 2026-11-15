import { randomUUID } from 'node:crypto';
import {
  type CmdConfig,
  type CmdGroup,
  type CmdTestRequest,
  keywordMatcher,
  type LabChatMessage,
} from '@raptoru/schemas';
import type { z } from 'zod';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import { type BroadcasterOf, chatRole } from '../lab-chat/broadcaster.js';
import { access, activeBlock, type Actor } from '../lab-moderation/store.js';
import { nominalStreamDay, streamDayWindow } from '../stream/stream-day.js';
import {
  decide,
  type Decision,
  type DecideUsage,
  type DecideViewer,
  refusalMessage,
  syntax,
} from './decide.js';
import {
  draftSteps,
  insertSounds,
  insertSteps,
  STEP_RULES,
  type StepDraft,
} from './steps.js';
import { checkConfig, CommandsError, isKeywordTrigger } from './model.js';
import type { ReservedWords } from './service.js';
import { latestChannelSession } from '../stream/channel-sessions.js';

// Commands V2 (Lab) — admission (phase B). A chat message that names a command (name or alias) is
// decided by `decide()` and recorded in cmd_invocations, accepted or refused. Nothing is executed and
// nothing is sent from here: an accepted invocation is `dispatched` into durable steps (steps.ts), sent
// by the Lab Twitch adapter only while « Sortie chat réelle » is ON.
// « Tester la commande » runs the exact same evaluation, without writing anything.
// A « keywords » command (config.trigger) is launched by a message that CONTAINS one of its expressions, without « ! »:
// the channel's active keyword rules are kept compiled in memory (keywordRules: no query for a message that matches
// none), re-read on every configuration change of this process (keywordRulesChanged) and at most every 30 s anyway.
// A matching message is then decided in the same transaction as a command, on the configuration read again under the
// lock (the cache only filters). One message = at most ONE Commands invocation (the « !word » command first, otherwise
// the first keyword command, by name, that accepts it); a keyword refusal is never answered in the chat, and a viewer
// outside the audience is not even recorded (a sentence of the chat is not a use of the command).
//
// Atomicity: the command row is locked (`for update`) while the counters are read and the invocation
// written, so two messages of the same command (aliases included: same command_id) are decided one
// after the other — a quota or a cooldown is never exceeded. The same Twitch message is admitted once
// (unique channel + source + message id).

/** Whether a viewer follows the channel. null = unknown. Never a real Helix call in the Lab. */
export interface FollowerProvider {
  /** Name shown in the decision details (« unknown », « test »…). */
  name: string;
  isFollower(channelId: string, viewerId: string): Promise<boolean | null>;
}

/**
 * Until the real Helix provider exists: always unknown. A badge (sub, VIP, mod, streamer) is never a
 * proof of follow; only an explicit answer (the test's `follower`) gives true / false.
 */
export const unknownFollowers: FollowerProvider = {
  name: 'unknown',
  isFollower: async () => null,
};

export interface AdmissionDeps {
  reserved?: ReservedWords;
  followers?: FollowerProvider;
  /** Expiry of the chat steps (default STEP_RULES.ttlMs). */
  stepTtlMs?: number;
  /**
   * The real Twitch user id of the channel's broadcaster (canonical: the Lab Core's configuration,
   * BONK_LAB_CHANNEL_TWITCH_ID = the bot's TWITCH_BROADCASTER_ID). A Lab channel id (900100) is not a
   * Twitch id: without this, the real streamer would never be recognised.
   */
  broadcasterOf?: BroadcasterOf;
}

/** ponytail: fixed gap between two refusal answers to the same viewer; make it a setting if asked. */
const REFUSAL_ANSWER_GAP_MS = 60_000;

interface ChatterIn {
  id: string;
  login: string;
  display_name: string;
  role: 'broadcaster' | 'moderator' | 'viewer';
  badges: string[];
  follower?: boolean;
}

interface CommandRow {
  command_id: string;
  version: number;
  config: unknown;
}

export interface InvocationView {
  invocation_id: string;
  command_id: string;
  command_version: number;
  source: 'twitch' | 'simulator';
  source_message_id: string;
  trigger: string;
  viewer_id: string;
  viewer_login: string;
  viewer_display_name: string;
  viewer_role: DecideViewer['role'];
  viewer_groups: CmdGroup[];
  follower: boolean | null;
  raw_args: string;
  args: Record<string, unknown>;
  live: boolean;
  decision: 'accepted' | 'rejected';
  reason: string | null;
  reason_detail: Record<string, unknown> | null;
  rendered: unknown;
  status: 'simulated' | 'dispatched' | 'rejected';
  created_at: string;
  /** Its durable steps (what was sent, failed, expired…), in order. */
  steps: {
    seq: number;
    kind: string;
    status: string;
    error: string | null;
    twitch_message_id: string | null;
    finished_at: string | null;
  }[];
}

/** What the chat module answers the router (and the bot's ingress, through it). */
type ChatOutcome = { outcome: string; replayed?: boolean } & Record<
  string,
  unknown
>;

interface Evaluation {
  decision: Decision;
  viewer: DecideViewer;
  live: boolean;
  now: Date;
  followerSource: string;
}

interface KeywordRule {
  command_id: string;
  match: (text: string) => string | null;
}

/**
 * Generation of each channel's command configurations in this process: CommandsService bumps it after every write, so a
 * changed expression, a command switched on or off or deleted is followed at the next message, without a restart.
 */
const generations = new Map<string, number>();
export function keywordRulesChanged(channelId: string) {
  generations.set(channelId, (generations.get(channelId) ?? 0) + 1);
}
/** ponytail: another process' change (none today: one Core per database) is followed within this delay. */
const RULES_MAX_AGE_MS = 30_000;

/** Keyword refusals worth a line in the journal: the viewer passed the audience (a chat sentence of anyone is not). */
const RECORDED_KEYWORD_REFUSALS = new Set([
  'invalid_arguments',
  'cooldown',
  'quota',
]);

/** « !hug @x » → { word: 'hug', rest: '@x' }; anything else is not a command. */
export function splitCommand(text: string) {
  const m = /^!([A-Za-z0-9_]{1,25})(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? { word: m[1]!.toLowerCase(), rest: (m[2] ?? '').trim() } : null;
}

export class CommandsAdmission {
  private readonly followers: FollowerProvider;
  /** The channel's active keyword commands, compiled (a filter only: a match is decided on the configuration read again). */
  private readonly rules = new Map<
    string,
    { gen: number; at: number; list: KeywordRule[] }
  >();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly deps: AdmissionDeps = {},
  ) {
    this.followers = deps.followers ?? unknownFollowers;
  }

  /**
   * Lab chat module (every message, plain ones included): « !word » of a command first; otherwise the keyword commands.
   * A message that launches nothing is `ignored`.
   */
  async chat(msg: LabChatMessage): Promise<ChatOutcome> {
    const cmd = splitCommand(msg.text);
    if (cmd) {
      const out = await this.exactCommand(msg, cmd);
      if (out.outcome !== 'ignored') return out;
    }
    return this.keywordCommand(msg);
  }

  /** « !word » (name or alias) of a « command » trigger. */
  private async exactCommand(
    msg: LabChatMessage,
    cmd: { word: string; rest: string },
  ): Promise<ChatOutcome> {
    return this.db.tx(async (q) => {
      // Channel lock first (same order as the configuration and the step queue): admissions of a
      // channel are serialized, so its steps are written in arrival order.
      await q.query(
        'select 1 from cmd_channels where channel_id = $1 for update',
        [msg.channel_id],
      );
      if (await this.reservedBy(q, msg.channel_id, cmd.word))
        return { outcome: 'ignored' };
      const command = (
        await q.query<CommandRow>(
          `select c.command_id, c.version, c.config from cmd_triggers t join cmd_commands c using (command_id)
           where t.channel_id = $1 and t.word = $2 and c.deleted_at is null for update of c`,
          [msg.channel_id, cmd.word],
        )
      )[0];
      // A keyword command is launched by its expressions only (its name is just its name).
      if (!command || isKeywordTrigger(command.config as CmdConfig))
        return { outcome: 'ignored' };
      const prior = (
        await q.query<{
          invocation_id: string;
          decision: string;
          reason: string | null;
        }>(
          `select invocation_id, decision, reason from cmd_invocations
           where channel_id = $1 and source = $2 and source_message_id = $3`,
          [msg.channel_id, msg.source, msg.message_id],
        )
      )[0];
      if (prior)
        return {
          outcome: 'rejected',
          reason: 'duplicate_message',
          replayed: true,
          invocation_id: prior.invocation_id,
          original: { decision: prior.decision, reason: prior.reason },
        };
      const ev = await this.evaluate(
        q,
        msg.channel_id,
        cmd.word,
        cmd.rest,
        { ...msg.chatter, badges: msg.chatter.badges ?? [] },
        // Twitch reply: only a real Twitch message has a parent id (the simulator's has none).
        msg.source === 'twitch' ? msg.message_id : null,
        command,
      );
      return this.record(q, msg, command, cmd.word, ev, true);
    });
  }

  /**
   * A message that contains an expression of a keyword command (no « ! » needed). No query when the message matches no
   * active rule. Under the channel lock, the matching commands are read again (fresh configuration and version) and
   * decided in name order: the first accepted one is the message's invocation; otherwise the first refusal worth
   * recording (cooldown, quota, missing value). Never a refusal answer in the chat.
   */
  private async keywordCommand(msg: LabChatMessage): Promise<ChatOutcome> {
    const hits = (await this.keywordRules(msg.channel_id)).filter(
      (r) => r.match(msg.text) !== null,
    );
    if (!hits.length) return { outcome: 'ignored' };
    return this.db.tx(async (q) => {
      await q.query(
        'select 1 from cmd_channels where channel_id = $1 for update',
        [msg.channel_id],
      );
      const prior = (
        await q.query<{
          invocation_id: string;
          decision: string;
          reason: string | null;
        }>(
          `select invocation_id, decision, reason from cmd_invocations
           where channel_id = $1 and source = $2 and source_message_id = $3`,
          [msg.channel_id, msg.source, msg.message_id],
        )
      )[0];
      if (prior)
        return {
          outcome: 'rejected',
          reason: 'duplicate_message',
          replayed: true,
          invocation_id: prior.invocation_id,
          original: { decision: prior.decision, reason: prior.reason },
        };
      const rows = await q.query<CommandRow>(
        `select command_id, version, config from cmd_commands
         where channel_id = $1 and command_id = any($2::uuid[]) and deleted_at is null
         order by name for update`,
        [msg.channel_id, hits.map((h) => h.command_id)],
      );
      const chatter = { ...msg.chatter, badges: msg.chatter.badges ?? [] };
      let refused: {
        command: CommandRow;
        found: string;
        ev: Evaluation;
      } | null = null;
      for (const command of rows) {
        let cfg: CmdConfig;
        try {
          cfg = checkConfig(command.config);
        } catch {
          continue;
        }
        if (!cfg.trigger || !isKeywordTrigger(cfg)) continue;
        const found = keywordMatcher(cfg.trigger)(msg.text);
        if (!found) continue;
        const ev = await this.evaluate(
          q,
          msg.channel_id,
          cfg.name,
          '',
          chatter,
          msg.source === 'twitch' ? msg.message_id : null,
          command,
        );
        if (ev.decision.decision === 'accepted')
          return this.record(q, msg, command, found, ev, false);
        if (!refused && RECORDED_KEYWORD_REFUSALS.has(ev.decision.reason ?? ''))
          refused = { command, found, ev };
      }
      return refused
        ? this.record(q, msg, refused.command, refused.found, refused.ev, false)
        : { outcome: 'ignored' };
    });
  }

  /** The channel's enabled keyword commands, compiled; read again after a change in this process, or after 30 s. */
  private async keywordRules(channelId: string): Promise<KeywordRule[]> {
    const gen = generations.get(channelId) ?? 0;
    const now = Date.now();
    const cached = this.rules.get(channelId);
    if (cached && cached.gen === gen && now - cached.at < RULES_MAX_AGE_MS)
      return cached.list;
    const rows = await this.db.query<{ command_id: string; config: unknown }>(
      `select command_id, config from cmd_commands
       where channel_id = $1 and deleted_at is null and enabled and config->'trigger'->>'mode' = 'keywords'`,
      [channelId],
    );
    const list = rows.flatMap((r) => {
      try {
        const cfg = checkConfig(r.config);
        return cfg.trigger
          ? [{ command_id: r.command_id, match: keywordMatcher(cfg.trigger) }]
          : [];
      } catch {
        return [];
      }
    });
    this.rules.set(channelId, { gen, at: now, list });
    return list;
  }

  /** Records a decided invocation: the row, its chat steps (or its refusal answer) and its sounds. */
  private async record(
    q: Queryable,
    msg: LabChatMessage,
    command: CommandRow,
    /** The word typed (« !word ») or the expression found (keywords). */
    trigger: string,
    ev: Evaluation,
    answerRefusal: boolean,
  ): Promise<ChatOutcome> {
    const d = ev.decision;
    const id = randomUUID();
    await q.query(
      `insert into cmd_invocations (invocation_id, channel_id, command_id, command_version, source,
         source_message_id, trigger, viewer_id, viewer_login, viewer_display_name, viewer_role,
         viewer_groups, follower, raw_args, args, live, decision, reason, reason_detail, rendered,
         status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
      [
        id,
        msg.channel_id,
        command.command_id,
        command.version,
        msg.source,
        msg.message_id,
        trigger,
        ev.viewer.id,
        ev.viewer.login,
        ev.viewer.display_name,
        ev.viewer.role,
        ev.viewer.groups,
        ev.viewer.follower,
        d.raw_args,
        JSON.stringify(d.args),
        ev.live,
        d.decision,
        d.reason,
        d.reason ? JSON.stringify({ message: d.message, ...d.detail }) : null,
        d.rendered ? JSON.stringify(d.rendered) : null,
        d.decision === 'accepted' ? 'dispatched' : 'rejected',
        ev.now,
      ],
    );
    // Phase C: the answer becomes durable steps (executed only while « Sortie chat réelle » is ON).
    const refusal =
      d.rendered || !answerRefusal
        ? null
        : refusalMessage(command.config, d, ev.viewer.display_name);
    const drafts: StepDraft[] = d.rendered
      ? draftSteps(d.rendered)
      : refusal &&
          !(await this.recentRefusal(
            q,
            command.command_id,
            ev.viewer.id,
            ev.now,
          ))
        ? [
            {
              kind: 'refusal',
              type: 'chat',
              params: { mode: 'normal', text: refusal, reply_to: null },
              on_error: 'stop',
            },
          ]
        : [];
    const steps = await insertSteps(q, {
      invocationId: id,
      channelId: msg.channel_id,
      now: ev.now,
      ttlMs: this.deps.stepTtlMs ?? STEP_RULES.ttlMs,
      drafts,
    });
    // The « sound » actions: Studio's OBS sound source plays them (not chat steps).
    await insertSounds(q, {
      invocationId: id,
      channelId: msg.channel_id,
      now: ev.now,
      ttlMs: this.deps.stepTtlMs ?? STEP_RULES.ttlMs,
      sounds: (d.rendered?.actions ?? []).flatMap((a) =>
        a.type === 'sound' ? [{ action_id: a.id, sound: a.sound }] : [],
      ),
    });
    return {
      outcome: d.decision,
      reason: d.reason,
      message: d.message,
      invocation_id: id,
      steps,
    };
  }

  /**
   * « Tester la commande »: the same evaluation as a real message; nothing written, nothing sent — the streamer is
   * recognised by identity here too (Studio's « Streamer » viewer is the channel's id: `channel_id` of the list). With
   * `command_id` of a keyword command: the message is checked against its expressions.
   */
  async test(channelId: string, req: z.infer<typeof CmdTestRequest>) {
    return this.db.tx(async (q) => {
      await this.teamOnly(q, channelId, req.actor);
      const viewer = req.viewer;
      const picked = req.command_id
        ? (
            await q.query<CommandRow>(
              'select command_id, version, config from cmd_commands where channel_id = $1 and command_id = $2 and deleted_at is null',
              [channelId, req.command_id],
            )
          )[0]
        : undefined;
      if (picked && isKeywordTrigger(picked.config as CmdConfig)) {
        const cfg = picked.config as CmdConfig;
        const found = keywordMatcher(cfg.trigger!)(req.message);
        const ev = await this.evaluate(
          q,
          channelId,
          cfg.name,
          '',
          viewer,
          null,
          picked,
        );
        const decision: Decision = found
          ? ev.decision
          : {
              decision: 'rejected',
              reason: 'no_keyword',
              message: 'Ce message ne contient aucune de ses expressions.',
              detail: { keywords: cfg.trigger!.keywords },
              checks: [{ check: 'no_keyword', ok: false }],
              raw_args: '',
              args: {},
              rendered: null,
            };
        return {
          command_id: picked.command_id,
          command_version: picked.version,
          trigger: found,
          viewer: ev.viewer,
          live: ev.live,
          follower_source: ev.followerSource,
          ...decision,
          simulated: true,
        };
      }
      const cmd = splitCommand(req.message);
      if (!cmd)
        throw new CommandsError(422, 'not_a_command', {
          message: 'the message must start with « ! » and a command word',
        });
      const found = (
        await q.query<CommandRow>(
          `select c.command_id, c.version, c.config from cmd_triggers t join cmd_commands c using (command_id)
           where t.channel_id = $1 and t.word = $2 and c.deleted_at is null`,
          [channelId, cmd.word],
        )
      )[0];
      // « !name » of a keyword command launches nothing (as in the chat).
      const command =
        found && !isKeywordTrigger(found.config as CmdConfig) ? found : null;
      const ev = await this.evaluate(
        q,
        channelId,
        cmd.word,
        cmd.rest,
        viewer,
        null,
        command,
      );
      return {
        command_id: command?.command_id ?? null,
        command_version: command?.version ?? null,
        trigger: cmd.word,
        viewer: ev.viewer,
        live: ev.live,
        follower_source: ev.followerSource,
        ...ev.decision,
        simulated: true,
      };
    });
  }

  /** Diagnostic: the recorded invocations (accepted and refused), newest first. Team only. */
  async invocations(
    channelId: string,
    reader: Actor,
    commandId: string | null,
    limit: number,
  ) {
    return this.db.tx(async (q) => {
      await this.teamOnly(q, channelId, reader);
      const rows = await q.query<InvocationView & { created_at: Date }>(
        `select invocation_id, command_id, command_version, source, source_message_id, trigger, viewer_id,
           viewer_login, viewer_display_name, viewer_role, viewer_groups, follower, raw_args, args, live,
           decision, reason, reason_detail, rendered, status, created_at,
           coalesce((select json_agg(json_build_object('seq', s.seq, 'kind', s.kind, 'status', s.status,
               'error', s.error->>'code', 'twitch_message_id', s.twitch_message_id, 'finished_at', s.finished_at)
               order by s.seq) from cmd_steps s where s.invocation_id = i.invocation_id), '[]'::json) as steps
         from cmd_invocations i where channel_id = $1 and ($2::uuid is null or command_id = $2)
         order by seq desc limit $3`,
        [channelId, commandId, limit],
      );
      return {
        invocations: rows.map((r) => ({
          ...r,
          created_at: new Date(r.created_at).toISOString(),
        })),
      };
    });
  }

  /**
   * Public projection (extension « Commandes » for viewers, phase F): listed, enabled, not deleted
   * commands to type (a keyword command is not one: never listed, its expressions never shown), grouped by the streamer's categories in their order (« Sans catégorie » last), with only
   * what a viewer needs — never an id, a person's login (allowed / excluded), a right, a lock, the
   * history or an execution detail. `live` + `when` tell whether a command can be used right now.
   */
  async publicList(channelId: string) {
    const rows = await this.db.query<{ config: CmdConfig }>(
      `select config from cmd_commands where channel_id = $1 and deleted_at is null and listed and enabled
         and coalesce(config->'trigger'->>'mode', 'command') = 'command'
       order by name`,
      [channelId],
    );
    const categories = await this.db.query<{
      category_id: string;
      name: string;
      icon: string;
      color: string;
    }>(
      'select category_id, name, icon, color from cmd_categories where channel_id = $1 order by position, name',
      [channelId],
    );
    // The channel's stream session, as Tombola sees it (stream/channel-sessions.ts, ASTRA-P1-007).
    const session = await latestChannelSession(this.db, channelId);
    const live = Boolean(session && !session.ended_at);
    // A word a module owns (e.g. Tombola's !join) never launches a command: not shown as an alias.
    const reserved = new Set(
      ((await this.deps.reserved?.(this.db, channelId)) ?? []).map(
        (w) => w.word,
      ),
    );
    const view = (c: CmdConfig) => ({
      name: c.name,
      aliases: c.aliases.filter((a) => !reserved.has(a)),
      description: c.description,
      appearance: c.appearance,
      syntax: syntax(c),
      /** Who: the groups, and whether some people are allowed on top (never who). */
      audience: {
        groups: c.audience.groups,
        named_people:
          c.audience.allow.length + (c.audience.allow_ids?.length ?? 0) > 0,
      },
      cooldown: c.cooldown.enabled
        ? { seconds: c.cooldown.seconds, scope: c.cooldown.scope }
        : null,
      quota: c.quota.enabled
        ? { max: c.quota.max, window: c.quota.window, scope: c.quota.scope }
        : null,
      when: c.when,
      available_now: c.when === 'always' || (c.when === 'live') === live,
    });
    const known = new Set(categories.map((k) => k.category_id));
    return {
      live,
      categories: categories
        .map((k) => ({
          name: k.name,
          icon: k.icon,
          color: k.color,
          commands: rows
            .filter((r) => r.config.category === k.category_id)
            .map((r) => view(r.config)),
        }))
        .filter((k) => k.commands.length),
      uncategorized: rows
        .filter((r) => !r.config.category || !known.has(r.config.category))
        .map((r) => view(r.config)),
    };
  }

  // --- the shared evaluation -----------------------------------------------------------------------

  private async evaluate(
    q: Queryable,
    channelId: string,
    word: string,
    rest: string,
    chatter: ChatterIn,
    messageId: string | null,
    command: CommandRow | null,
  ): Promise<Evaluation> {
    const now = this.clock.now();
    const reserved = await this.reservedBy(q, channelId, word);
    // Only a real Twitch message carries its message id here (see chat()): its source.
    const viewer = await this.viewer(
      q,
      channelId,
      chatter,
      messageId === null ? 'simulator' : 'twitch',
    );
    const session = await latestChannelSession(q, channelId);
    const live = Boolean(session && !session.ended_at);
    const usage = command
      ? await this.usage(
          q,
          command,
          viewer.decide.id,
          now,
          session?.started_at ?? null,
        )
      : EMPTY_USAGE;
    // A viewer blocked « everywhere » by the moderation launches no command (a module block names its module only).
    const blocked = command
      ? Boolean(await activeBlock(q, channelId, viewer.decide.id, 'all', now))
      : false;
    const decision: Decision = decide({
      command,
      reservedBy: reserved,
      trigger: word,
      rawArgs: rest,
      viewer: viewer.decide,
      live,
      now,
      usage,
      messageId,
      blocked,
    });
    if (
      decision.reason === 'access_denied' ||
      decision.reason === 'follower_status_unknown'
    )
      decision.detail.follower_source = viewer.followerSource;
    return {
      decision,
      viewer: viewer.decide,
      live,
      now,
      followerSource: viewer.followerSource,
    };
  }

  /**
   * Effective role and groups. « Streamer » is decided by identity only: the viewer's user id is the
   * channel's own id or its real Twitch broadcaster id. A claimed role or badge never makes a streamer.
   */
  private async viewer(
    q: Queryable,
    channelId: string,
    c: ChatterIn,
    source: 'twitch' | 'simulator',
  ) {
    const claimed = chatRole(channelId, c, this.deps.broadcasterOf, source);
    const role = (
      await access(q, channelId, { id: c.id, role: claimed, via: 'extension' })
    ).role as DecideViewer['role'];
    let follower: boolean | null;
    let followerSource: string;
    if (c.follower !== undefined) {
      follower = c.follower;
      followerSource = 'test';
    } else {
      follower = await this.followers.isFollower(channelId, c.id);
      followerSource = this.followers.name;
    }
    const groups: CmdGroup[] = ['everyone'];
    if (follower) groups.push('followers');
    if (c.badges.includes('subscriber') || c.badges.includes('founder'))
      groups.push('subs');
    if (c.badges.includes('vip')) groups.push('vips');
    if (role === 'moderator' || role === 'supermod') groups.push('mods');
    if (role === 'supermod') groups.push('supermods');
    if (role === 'broadcaster') groups.push('broadcaster');
    return {
      decide: {
        id: c.id,
        login: c.login.toLowerCase(),
        display_name: c.display_name,
        role,
        groups,
        follower,
      } satisfies DecideViewer,
      followerSource,
    };
  }

  /**
   * Counters of the command (aliases share them: same command_id), accepted uses only. Windows: hour =
   * the last 60 minutes; day = the stream day (16:00 Paris reset); live = since the start of the current
   * live (offline: of the last one); total = since the command exists.
   */
  private async usage(
    q: Queryable,
    command: CommandRow,
    viewerId: string,
    now: Date,
    lastLiveStart: Date | null,
  ): Promise<DecideUsage> {
    const cfg = command.config as Partial<CmdConfig>;
    const w = cfg.quota?.window;
    const since =
      w === 'hour'
        ? new Date(now.getTime() - 3_600_000)
        : w === 'day'
          ? streamDayWindow(nominalStreamDay(now)).start
          : w === 'live'
            ? (lastLiveStart ?? now)
            : null;
    const r = (
      await q.query<{
        last_viewer: Date | null;
        last_global: Date | null;
        window_viewer: number;
        window_global: number;
        total: number;
      }>(
        `select max(created_at) filter (where viewer_id = $2) as last_viewer,
           max(created_at) as last_global,
           count(*) filter (where viewer_id = $2 and ($3::timestamptz is null or created_at >= $3))::int as window_viewer,
           count(*) filter (where $3::timestamptz is null or created_at >= $3)::int as window_global,
           count(*)::int as total
         from cmd_invocations where command_id = $1 and decision = 'accepted'`,
        [command.command_id, viewerId, since],
      )
    )[0]!;
    return {
      lastViewerAt: r.last_viewer ? new Date(r.last_viewer) : null,
      lastGlobalAt: r.last_global ? new Date(r.last_global) : null,
      windowViewer: Number(r.window_viewer),
      windowGlobal: Number(r.window_global),
      total: Number(r.total),
    };
  }

  /**
   * One refusal answer per command and viewer per minute: a viewer hammering a command on cooldown
   * never makes the bot spam the chat (the refusals are still all recorded).
   */
  private async recentRefusal(
    q: Queryable,
    commandId: string,
    viewerId: string,
    now: Date,
  ) {
    const r = await q.query(
      `select 1 from cmd_steps s join cmd_invocations i using (invocation_id)
       where s.kind = 'refusal' and i.command_id = $1 and i.viewer_id = $2 and s.created_at > $3 limit 1`,
      [commandId, viewerId, new Date(now.getTime() - REFUSAL_ANSWER_GAP_MS)],
    );
    return r.length > 0;
  }

  private async reservedBy(q: Queryable, channelId: string, word: string) {
    if (!this.deps.reserved) return null;
    return (
      (await this.deps.reserved(q, channelId)).find((r) => r.word === word)
        ?.module ?? null
    );
  }

  private async teamOnly(q: Queryable, channelId: string, a: Actor) {
    if ((await access(q, channelId, a)).role === 'viewer')
      throw new CommandsError(403, 'team_only', { role: 'viewer' });
  }
}

const EMPTY_USAGE: DecideUsage = {
  lastViewerAt: null,
  lastGlobalAt: null,
  windowViewer: 0,
  windowGlobal: 0,
  total: 0,
};
