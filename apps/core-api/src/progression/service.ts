import {
  DEFAULT_PROGRESSION_RULES,
  type LabChatMessage,
  type ProgressionRules,
  ProgressionRulesSchema,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import type { LabChatModule } from '../lab-chat/router.js';
import type {
  PresenceListener,
  ValidatedPresence,
} from '../presence/presence-service.js';
import { liveChannelSession } from '../stream/channel-sessions.js';

// Progression native (docs/PROGRESSION.md) — replaces WizeBot's levels. The Core is the source of truth:
// - XP from VALIDATED presence (the presence tracker's intervals: seen in two consecutive chatters readings, credited
//   exactly once inside the cycle transaction) and from chat messages (one rewarded message per cooldown, a minimum
//   length, never a command, bots and the broadcaster excluded, live only) — no lurker detection is claimed beyond
//   what the chatters list shows;
// - every movement in an append-only ledger with a unique key (a redelivered message or cycle never pays twice);
// - the level derives from the XP (curve in the rules); reaching a level grants the catalogue's rewards for it;
// - titles and badges: a catalogue, an inventory (kept when revoked), what is equipped (owned and not revoked only).
// OFF by default: nothing is counted before the channel turns it on.

export class ProgressionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface Actor {
  id: string;
  name?: string;
}

/** Total XP to reach `level` (level 1 = 0 XP). */
export function xpForLevel(level: number, rules: ProgressionRules) {
  return level <= 1
    ? 0
    : Math.round(rules.curve_base * (level - 1) ** rules.curve_exponent);
}

/** The level of an XP total (the highest level whose threshold it reached). */
export function levelForXp(xp: number, rules: ProgressionRules) {
  let level = Math.max(
    1,
    Math.floor(
      (Math.max(0, xp) / rules.curve_base) ** (1 / rules.curve_exponent),
    ) + 1,
  );
  while (level > 1 && xpForLevel(level, rules) > xp) level--;
  while (xpForLevel(level + 1, rules) <= xp) level++;
  return level;
}

type Settings = { enabled: boolean; rules: ProgressionRules };

interface AccountRow {
  twitch_user_id: string;
  xp: string | number;
  level: number;
  watch_seconds: string | number;
  messages: string | number;
  imported_watch_seconds: string | number;
  imported_messages: string | number;
  imported_level: number | null;
  last_message_xp_at: Date | null;
}

export class ProgressionService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** The channel whose viewers earn (the broadcaster); null: nothing is counted. */
    private readonly channelOf: () => string | null,
    /**
     * The Lab Core: its viewers are `lab_viewers` (per channel, no login: the lowercased name stands for it) and its
     * live is the Lab session; the main Core: `viewers` (Twitch logins) and the Daily's stream sessions.
     */
    private readonly o: { lab?: boolean } = {},
  ) {}

  /** The channel's viewer directory as `(twitch_user_id, login, display_name)` (channel ids are digits only). */
  private dir(channelId: string) {
    if (!this.o.lab) return 'viewers';
    if (!/^[0-9]{1,32}$/.test(channelId))
      throw new ProgressionError(400, 'invalid_channel');
    return `(select viewer_id as twitch_user_id, lower(display_name) as login, display_name from lab_viewers
      where channel_id = '${channelId}')`;
  }

  private now() {
    return this.clock.now();
  }

  // --- settings ----------------------------------------------------------------------------------------------------

  async settings(channelId: string, q: Queryable = this.db): Promise<Settings> {
    const r = (
      await q.query<{ enabled: boolean; rules: Partial<ProgressionRules> }>(
        'select enabled, rules from progression_settings where channel_id = $1',
        [channelId],
      )
    )[0];
    return {
      enabled: r?.enabled ?? false,
      rules: { ...DEFAULT_PROGRESSION_RULES, ...(r?.rules ?? {}) },
    };
  }

  async updateSettings(
    channelId: string,
    patch: { enabled?: boolean; rules?: Partial<ProgressionRules> },
  ) {
    return this.db.tx(async (q) => {
      const cur = await this.settings(channelId, q);
      const rules = ProgressionRulesSchema.parse({
        ...cur.rules,
        ...(patch.rules ?? {}),
      });
      const enabled = patch.enabled ?? cur.enabled;
      await q.query(
        `insert into progression_settings (channel_id, enabled, rules, updated_at) values ($1, $2, $3, $4)
         on conflict (channel_id) do update set enabled = $2, rules = $3, updated_at = $4`,
        [channelId, enabled, JSON.stringify(rules), this.now()],
      );
      // A new curve: every level follows it (XP is never changed).
      if (patch.rules) await this.relevelAll(q, channelId, rules);
      return { enabled, rules };
    });
  }

  private async relevelAll(
    q: Queryable,
    channelId: string,
    rules: ProgressionRules,
  ) {
    const rows = await q.query<{ twitch_user_id: string; xp: string | number }>(
      'select twitch_user_id, xp from progression_accounts where channel_id = $1',
      [channelId],
    );
    for (const r of rows) {
      const level = levelForXp(Number(r.xp), rules);
      await q.query(
        'update progression_accounts set level = $3 where channel_id = $1 and twitch_user_id = $2 and level <> $3',
        [channelId, r.twitch_user_id, level],
      );
      await this.grantLevelRewards(q, channelId, r.twitch_user_id, level);
    }
  }

  // --- XP ----------------------------------------------------------------------------------------------------------

  /**
   * One XP movement, once (its key). In the caller's transaction. Returns false when the key was already recorded.
   * `extra` adds to the counters (watched seconds, messages) with the same exactly-once guarantee.
   */
  private async move(
    q: Queryable,
    channelId: string,
    viewerId: string,
    m: {
      kind: 'presence' | 'message' | 'import' | 'grant' | 'correction';
      amount: number;
      key: string;
      actor: string;
      reason?: string | null;
      watchSeconds?: number;
      messages?: number;
      messageXpAt?: Date;
    },
    rules: ProgressionRules,
  ) {
    const now = this.now();
    const inserted = await q.query(
      `insert into progression_ledger (channel_id, twitch_user_id, kind, amount, key, actor, reason, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (channel_id, key) do nothing returning id`,
      [
        channelId,
        viewerId,
        m.kind,
        m.amount,
        m.key.slice(0, 200),
        m.actor.slice(0, 64),
        m.reason ?? null,
        now,
      ],
    );
    if (!inserted.length) return false;
    const acc = (
      await q.query<AccountRow>(
        `insert into progression_accounts (channel_id, twitch_user_id, xp, level, watch_seconds, messages,
           last_message_xp_at, updated_at)
         values ($1, $2, greatest(0, $3::bigint), 1, $4, $5, $6, $7)
         on conflict (channel_id, twitch_user_id) do update set
           xp = greatest(0, progression_accounts.xp + $3::bigint),
           watch_seconds = progression_accounts.watch_seconds + $4,
           messages = progression_accounts.messages + $5,
           last_message_xp_at = coalesce($6, progression_accounts.last_message_xp_at),
           updated_at = $7
         returning *`,
        [
          channelId,
          viewerId,
          m.amount,
          m.watchSeconds ?? 0,
          m.messages ?? 0,
          m.messageXpAt ?? null,
          now,
        ],
      )
    )[0]!;
    const level = levelForXp(Number(acc.xp), rules);
    if (level !== acc.level)
      await q.query(
        'update progression_accounts set level = $3 where channel_id = $1 and twitch_user_id = $2',
        [channelId, viewerId, level],
      );
    if (level > acc.level)
      await this.grantLevelRewards(q, channelId, viewerId, level);
    return true;
  }

  /** Viewers excluded by login (bots, from the rules) and the broadcaster. */
  private async eligible(
    q: Queryable,
    channelId: string,
    ids: string[],
    rules: ProgressionRules,
  ) {
    if (!ids.length) return [];
    const excluded = new Set(
      (
        await q.query<{ id: string }>(
          `select twitch_user_id as id from ${this.dir(channelId)} d where twitch_user_id = any($1::text[]) and login = any($2::text[])`,
          [ids, rules.excluded_logins],
        )
      ).map((r) => r.id),
    );
    return ids.filter((id) => id !== channelId && !excluded.has(id));
  }

  /** The presence tracker's listener: XP for each validated interval (inside the cycle transaction). */
  readonly presenceListener: PresenceListener = {
    validated: async (q: Queryable, interval: ValidatedPresence) => {
      const channelId = this.channelOf();
      if (!channelId) return;
      const s = await this.settings(channelId, q);
      if (!s.enabled || interval.seconds <= 0) return;
      const amount = Math.round(
        (interval.seconds / 60) * s.rules.xp_per_minute,
      );
      const cycle = `${interval.streamId}:${interval.at.getTime()}`;
      for (const id of await this.eligible(
        q,
        channelId,
        interval.viewerIds,
        s.rules,
      ))
        await this.move(
          q,
          channelId,
          id,
          {
            kind: 'presence',
            amount,
            key: `presence:${cycle}:${id}`,
            actor: 'presence',
            watchSeconds: interval.seconds,
          },
          s.rules,
        );
    },
  };

  private async live(q: Queryable, channelId: string) {
    if (this.o.lab) return (await liveChannelSession(q, channelId)) !== null;
    return (
      (
        await q.query(
          'select 1 from stream_sessions where ended_at is null limit 1',
        )
      ).length > 0
    );
  }

  /** A chat message: counted once, XP when it passes the anti-spam rules. Never blocks the chat (errors swallowed). */
  async onMessage(msg: LabChatMessage) {
    const channelId = msg.channel_id;
    if (channelId !== this.channelOf()) return 'ignored';
    return this.db.tx(async (q) => {
      const s = await this.settings(channelId, q);
      if (!s.enabled) return 'off';
      const text = msg.text.trim();
      if (text.startsWith('!')) return 'command';
      if (
        msg.chatter.role === 'broadcaster' ||
        s.rules.excluded_logins.includes(msg.chatter.login.toLowerCase())
      )
        return 'excluded';
      if (s.rules.live_only && !(await this.live(q, channelId)))
        return 'offline';
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        `xp:${channelId}:${msg.chatter.id}`,
      ]);
      if (this.o.lab)
        await q.query(
          `insert into lab_viewers (channel_id, viewer_id, display_name, first_seen, last_seen) values ($1, $2, $3, $4, $4)
           on conflict (channel_id, viewer_id) do update set display_name = $3, last_seen = $4`,
          [channelId, msg.chatter.id, msg.chatter.display_name, this.now()],
        );
      else
        await q.query(
          `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $3) on conflict do nothing`,
          [
            msg.chatter.id,
            msg.chatter.login.toLowerCase(),
            msg.chatter.display_name,
          ],
        );
      const acc = (
        await q.query<{ last_message_xp_at: Date | null }>(
          'select last_message_xp_at from progression_accounts where channel_id = $1 and twitch_user_id = $2',
          [channelId, msg.chatter.id],
        )
      )[0];
      const now = this.now();
      const ready =
        !acc?.last_message_xp_at ||
        now.getTime() - new Date(acc.last_message_xp_at).getTime() >=
          s.rules.message_cooldown_s * 1000;
      const long = [...text].length >= s.rules.message_min_chars;
      const amount = ready && long ? s.rules.message_xp : 0;
      // Every message is counted once (the counter WizeBot showed); only a rewarded one moves the cooldown.
      const done = await this.move(
        q,
        channelId,
        msg.chatter.id,
        {
          kind: 'message',
          amount,
          key: `msg:${msg.message_id}`,
          actor: 'chat',
          messages: 1,
          messageXpAt: amount > 0 ? now : undefined,
        },
        s.rules,
      );
      return !done
        ? 'replayed'
        : amount > 0
          ? 'xp'
          : ready
            ? 'too_short'
            : 'cooldown';
    });
  }

  /** The chat router's module: reads every plain message, never answers, never takes a message from another module. */
  readonly chatModule: LabChatModule = {
    name: 'progression',
    plainText: true,
    chat: async (msg) => {
      try {
        await this.onMessage(msg);
      } catch (e) {
        console.error('[progression] message ignored', (e as Error).message);
      }
      return { outcome: 'ignored' };
    },
  };

  // --- rewards: catalogue, inventory, equipped -----------------------------------------------------------------------

  async catalog(channelId: string, all = false) {
    return this.db.query(
      `select reward_id, kind, label, description, rarity, category, unlock_level, active, sort from progression_rewards
       where channel_id = $1 and ($2 or active) order by kind, sort, unlock_level nulls last, label`,
      [channelId, all],
    );
  }

  async upsertReward(
    channelId: string,
    r: {
      reward_id: string;
      kind: 'title' | 'badge';
      label: string;
      description: string;
      rarity: string;
      category: string;
      unlock_level: number | null;
      active: boolean;
      sort: number;
    },
  ) {
    return this.db.tx(async (q) => {
      const prior = (
        await q.query<{ kind: string }>(
          'select kind from progression_rewards where channel_id = $1 and reward_id = $2',
          [channelId, r.reward_id],
        )
      )[0];
      if (prior && prior.kind !== r.kind)
        throw new ProgressionError(409, 'kind_locked');
      const now = this.now();
      await q.query(
        `insert into progression_rewards (channel_id, reward_id, kind, label, description, rarity, category, unlock_level,
           active, sort, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         on conflict (channel_id, reward_id) do update set label = $4, description = $5, rarity = $6, category = $7,
           unlock_level = $8, active = $9, sort = $10, updated_at = $11`,
        [
          channelId,
          r.reward_id,
          r.kind,
          r.label,
          r.description,
          r.rarity,
          r.category,
          r.unlock_level,
          r.active,
          r.sort,
          now,
        ],
      );
      // A level reward: every viewer already at that level gets it now (never a second copy).
      if (r.unlock_level !== null && r.active) {
        const ids = await q.query<{ id: string }>(
          'select twitch_user_id as id from progression_accounts where channel_id = $1 and level >= $2',
          [channelId, r.unlock_level],
        );
        for (const { id } of ids)
          await this.insertGrant(
            q,
            channelId,
            id,
            r.reward_id,
            'level',
            `level:${r.unlock_level}`,
            'progression',
            false,
          );
      }
      return r;
    });
  }

  /** Returns true when the viewer now owns it (new or restored). `restore`: a revoked grant comes back (manual). */
  private async insertGrant(
    q: Queryable,
    channelId: string,
    viewerId: string,
    rewardId: string,
    source: 'level' | 'event' | 'manual' | 'import',
    reference: string | null,
    by: string,
    restore: boolean,
  ) {
    const now = this.now();
    const r = await q.query<{ revoked_at: Date | null; fresh: boolean }>(
      `insert into progression_grants (channel_id, twitch_user_id, reward_id, source, reference, granted_by, granted_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (channel_id, twitch_user_id, reward_id) do update set
         revoked_at = case when $8 then null else progression_grants.revoked_at end,
         revoked_by = case when $8 then null else progression_grants.revoked_by end,
         revoke_reason = case when $8 then null else progression_grants.revoke_reason end,
         source = case when $8 and progression_grants.revoked_at is not null then excluded.source
           else progression_grants.source end,
         granted_at = case when $8 and progression_grants.revoked_at is not null then excluded.granted_at
           else progression_grants.granted_at end
       returning revoked_at, (xmax = 0) as fresh`,
      [
        channelId,
        viewerId,
        rewardId,
        source,
        reference,
        by.slice(0, 64),
        now,
        restore,
      ],
    );
    return r[0]?.revoked_at === null;
  }

  private async grantLevelRewards(
    q: Queryable,
    channelId: string,
    viewerId: string,
    level: number,
  ) {
    const rewards = await q.query<{ reward_id: string; unlock_level: number }>(
      `select reward_id, unlock_level from progression_rewards
       where channel_id = $1 and active and unlock_level is not null and unlock_level <= $2`,
      [channelId, level],
    );
    for (const r of rewards)
      await this.insertGrant(
        q,
        channelId,
        viewerId,
        r.reward_id,
        'level',
        `level:${r.unlock_level}`,
        'progression',
        false,
      );
  }

  /** Studio / an event: grant one reward to viewers. Idempotent; a revoked grant is restored (a deliberate re-grant). */
  async grant(
    channelId: string,
    req: {
      reward_id: string;
      viewers: string[];
      source: 'event' | 'manual';
      reference: string | null;
    },
    actor: Actor,
  ) {
    return this.db.tx(async (q) => {
      const reward = (
        await q.query<{ active: boolean }>(
          'select active from progression_rewards where channel_id = $1 and reward_id = $2',
          [channelId, req.reward_id],
        )
      )[0];
      if (!reward) throw new ProgressionError(404, 'unknown_reward');
      if (!reward.active) throw new ProgressionError(409, 'reward_inactive');
      const ids = [...new Set(req.viewers)];
      const known = new Set(
        (
          await q.query<{ id: string }>(
            `select twitch_user_id as id from ${this.dir(channelId)} d where twitch_user_id = any($1::text[])`,
            [ids],
          )
        ).map((r) => r.id),
      );
      const granted: string[] = [];
      for (const id of ids)
        if (
          known.has(id) &&
          (await this.insertGrant(
            q,
            channelId,
            id,
            req.reward_id,
            req.source,
            req.reference,
            actor.name ?? actor.id,
            true,
          ))
        )
          granted.push(id);
      return {
        reward_id: req.reward_id,
        granted,
        unknown: ids.filter((id) => !known.has(id)),
      };
    });
  }

  /** Revoke (kept in the inventory as revoked, with who and why); unequipped at once. */
  async revoke(
    channelId: string,
    req: { reward_id: string; viewer: string; reason: string },
    actor: Actor,
  ) {
    return this.db.tx(async (q) => {
      const r = await q.query(
        `update progression_grants set revoked_at = $4, revoked_by = $5, revoke_reason = $6
         where channel_id = $1 and twitch_user_id = $2 and reward_id = $3 and revoked_at is null returning id`,
        [
          channelId,
          req.viewer,
          req.reward_id,
          this.now(),
          (actor.name ?? actor.id).slice(0, 64),
          req.reason,
        ],
      );
      if (!r.length) throw new ProgressionError(404, 'not_owned');
      await q.query(
        `update progression_equipped set title_id = case when title_id = $3 then null else title_id end,
           badge_ids = array_remove(badge_ids, $3), updated_at = $4
         where channel_id = $1 and twitch_user_id = $2`,
        [channelId, req.viewer, req.reward_id, this.now()],
      );
      return { revoked: true };
    });
  }

  /** The viewer's choice (raptoru.fr): a title and up to 3 badges among what they own (not revoked, active). */
  async equip(
    channelId: string,
    req: { viewer: string; title_id: string | null; badge_ids: string[] },
  ) {
    return this.db.tx(async (q) => {
      const wanted = [
        ...new Set([...(req.title_id ? [req.title_id] : []), ...req.badge_ids]),
      ];
      const owned = new Map(
        (
          await q.query<{ reward_id: string; kind: string }>(
            `select g.reward_id, r.kind from progression_grants g join progression_rewards r using (channel_id, reward_id)
             where g.channel_id = $1 and g.twitch_user_id = $2 and g.revoked_at is null and r.active
               and g.reward_id = any($3::text[])`,
            [channelId, req.viewer, wanted],
          )
        ).map((r) => [r.reward_id, r.kind]),
      );
      if (req.title_id && owned.get(req.title_id) !== 'title')
        throw new ProgressionError(403, 'title_not_owned');
      const badges = [...new Set(req.badge_ids)];
      if (badges.some((b) => owned.get(b) !== 'badge'))
        throw new ProgressionError(403, 'badge_not_owned');
      await q.query(
        `insert into progression_equipped (channel_id, twitch_user_id, title_id, badge_ids, updated_at) values ($1, $2, $3, $4, $5)
         on conflict (channel_id, twitch_user_id) do update set title_id = $3, badge_ids = $4, updated_at = $5`,
        [channelId, req.viewer, req.title_id, badges, this.now()],
      );
      return { title_id: req.title_id, badge_ids: badges };
    });
  }

  // --- WizeBot import (idempotent, reversible) ------------------------------------------------------------------------

  /**
   * Starts each viewer at their WizeBot level: XP = the curve's threshold of that level (once per viewer: key
   * import:wizebot:<id>); WizeBot's watchtime and messages kept apart as imported history. A login is resolved through
   * the Core's viewers (unknown ones are returned, to import again later — never guessed).
   */
  async importHistory(
    channelId: string,
    req: {
      source: 'wizebot';
      rows: {
        twitch_user_id: string | null;
        login: string | null;
        level: number;
        watch_seconds: number;
        messages: number;
      }[];
    },
    actor: Actor,
  ) {
    return this.db.tx(async (q) => {
      const s = await this.settings(channelId, q);
      const logins = req.rows
        .filter((r) => !r.twitch_user_id && r.login)
        .map((r) => r.login!);
      const byLogin = new Map(
        (
          await q.query<{ id: string; login: string }>(
            `select twitch_user_id as id, login from ${this.dir(channelId)} d where login = any($1::text[])`,
            [logins],
          )
        ).map((r) => [r.login, r.id]),
      );
      let imported = 0;
      let already = 0;
      const unresolved: string[] = [];
      for (const row of req.rows) {
        const id =
          row.twitch_user_id ??
          (row.login ? byLogin.get(row.login) : undefined);
        if (!id) {
          if (row.login) unresolved.push(row.login);
          continue;
        }
        const ok = await this.move(
          q,
          channelId,
          id,
          {
            kind: 'import',
            amount: xpForLevel(row.level, s.rules),
            key: `import:${req.source}:${id}`,
            actor: actor.name ?? actor.id,
            reason: `${req.source} niveau ${row.level}`,
          },
          s.rules,
        );
        if (!ok) {
          already++;
          continue;
        }
        await q.query(
          `update progression_accounts set imported_level = $3, imported_watch_seconds = $4, imported_messages = $5
           where channel_id = $1 and twitch_user_id = $2`,
          [channelId, id, row.level, row.watch_seconds, row.messages],
        );
        imported++;
      }
      return { imported, already, unresolved };
    });
  }

  /** Undo an import: its ledger rows go, every account is recomputed from what remains. Rewards granted stay. */
  async revertImport(channelId: string, source: 'wizebot') {
    return this.db.tx(async (q) => {
      const s = await this.settings(channelId, q);
      const gone = await q.query(
        `delete from progression_ledger where channel_id = $1 and kind = 'import' and key like $2 returning twitch_user_id`,
        [channelId, `import:${source}:%`],
      );
      await q.query(
        `update progression_accounts a set xp = coalesce((select greatest(0, sum(amount)) from progression_ledger l
           where l.channel_id = a.channel_id and l.twitch_user_id = a.twitch_user_id), 0),
           imported_level = null, imported_watch_seconds = 0, imported_messages = 0
         where a.channel_id = $1`,
        [channelId],
      );
      await this.relevelAll(q, channelId, s.rules);
      return { removed: gone.length };
    });
  }

  /** Studio: viewers by pseudo (login or Twitch name, prefix) or id, with their level. */
  async searchViewers(channelId: string, text: string) {
    const q = text.trim().toLowerCase().replace(/^@/, '').slice(0, 25);
    // A pseudo has no LIKE wildcard: anything else is dropped from the prefix (nothing left: no search).
    const prefix = q.replace(/[^a-z0-9_ -]/g, '');
    if (!prefix) return [];
    return this.db.query(
      `select v.twitch_user_id, v.login, v.display_name, coalesce(a.level, 1) as level, coalesce(a.xp, 0)::bigint as xp
       from ${this.dir(channelId)} v left join progression_accounts a on a.channel_id = $1 and a.twitch_user_id = v.twitch_user_id
       where v.twitch_user_id = $2 or v.login like $3 or lower(v.display_name) like $3
       order by (v.login = $2) desc, a.xp desc nulls last, v.login limit 20`,
      [channelId, q, `${prefix.replace(/_/g, '\\_')}%`],
    );
  }

  // --- public reads (raptoru.fr) ---------------------------------------------------------------------------------------

  async leaderboard(channelId: string, limit = 100) {
    const s = await this.settings(channelId);
    const rows = await this.db.query<{
      twitch_user_id: string;
      login: string | null;
      display_name: string | null;
      xp: string | number;
      level: number;
    }>(
      `select a.twitch_user_id, v.login, v.display_name, a.xp, a.level from progression_accounts a
       left join ${this.dir(channelId)} v using (twitch_user_id)
       where a.channel_id = $1 and a.xp > 0 order by a.xp desc, a.twitch_user_id limit $2`,
      [channelId, Math.min(limit, 500)],
    );
    return {
      enabled: s.enabled,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        twitchUserId: r.twitch_user_id,
        login: r.login,
        displayName: r.display_name ?? r.login ?? r.twitch_user_id,
        level: r.level,
        xp: Number(r.xp),
      })),
    };
  }

  async viewer(channelId: string, viewerId: string) {
    const s = await this.settings(channelId);
    const acc = (
      await this.db.query<AccountRow & { rank: string | number }>(
        `select * from (select a.*, row_number() over (order by a.xp desc, a.twitch_user_id) as rank
           from progression_accounts a where a.channel_id = $1 and a.xp > 0) x where twitch_user_id = $2`,
        [channelId, viewerId],
      )
    )[0];
    const inventory = await this.db.query<{
      reward_id: string;
      kind: string;
      label: string;
      description: string;
      rarity: string;
      category: string;
      source: string;
      reference: string | null;
      granted_at: Date;
    }>(
      `select g.reward_id, r.kind, r.label, r.description, r.rarity, r.category, g.source, g.reference, g.granted_at
       from progression_grants g join progression_rewards r using (channel_id, reward_id)
       where g.channel_id = $1 and g.twitch_user_id = $2 and g.revoked_at is null and r.active
       order by r.kind, r.sort, g.granted_at`,
      [channelId, viewerId],
    );
    const eq = (
      await this.db.query<{ title_id: string | null; badge_ids: string[] }>(
        'select title_id, badge_ids from progression_equipped where channel_id = $1 and twitch_user_id = $2',
        [channelId, viewerId],
      )
    )[0];
    const owned = new Set(inventory.map((i) => i.reward_id));
    const xp = Number(acc?.xp ?? 0);
    const level = acc?.level ?? 1;
    return {
      enabled: s.enabled,
      twitchUserId: viewerId,
      level,
      xp,
      rank: acc ? Number(acc.rank) : null,
      levelXp: xpForLevel(level, s.rules),
      nextLevelXp: xpForLevel(level + 1, s.rules),
      watchMinutes: Math.floor(Number(acc?.watch_seconds ?? 0) / 60),
      messages: Number(acc?.messages ?? 0),
      imported: acc?.imported_level
        ? {
            source: 'wizebot',
            level: acc.imported_level,
            watchMinutes: Math.floor(Number(acc.imported_watch_seconds) / 60),
            messages: Number(acc.imported_messages),
          }
        : null,
      equipped: {
        title: eq?.title_id && owned.has(eq.title_id) ? eq.title_id : null,
        badges: (eq?.badge_ids ?? []).filter((b) => owned.has(b)),
      },
      inventory: inventory.map((i) => ({
        id: i.reward_id,
        kind: i.kind,
        label: i.label,
        description: i.description,
        rarity: i.rarity,
        category: i.category,
        source: i.source,
        reference: i.reference,
        grantedAt: new Date(i.granted_at).toISOString(),
      })),
    };
  }
}
