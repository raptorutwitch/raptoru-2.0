import { randomUUID } from 'node:crypto';
import type { ChallengeInput, ChallengeReward } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import { CosmeticError } from '../cosmetics/service.js';
import type { Db, Queryable } from '../db/db.js';
import type { Actor } from '../progression/service.js';
import { CHALLENGE_METRICS, metricOf } from './metrics.js';

// Défis et succès (raptoru.fr lot 5, docs/CHALLENGES.md).
// - Studio writes definitions (draft → active ⇄ suspended → archived). Once activated, the condition is frozen.
// - The Core counts: `evaluate` recounts each active challenge's metric from its source table over the challenge's
//   window (or the current / previous week or month), diffs it against challenge_progress and writes only the changes,
//   with a log line each (before → after). It runs on a timer, after an activation and on demand (Studio). A read never
//   counts anything: the site reads challenge_progress as it is.
// - Completion: the first time the value reaches the target. The completion date is when the Core SAW it (never an
//   invented event date). A later drop (a refund) is logged as `below_target`, the completion and its reward stay.
// - Rewards: one challenge_awards row per (challenge, period, viewer) — the primary key forbids a second one — paid by
//   the cosmetic shop's idempotent award (`challenges:<award_key>`); a crash between the two is replayed safely.

export class ChallengeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** The cosmetic shop's award (an item or Jetons, once per key): the only way a challenge pays. */
export interface ChallengeAwarder {
  award(
    channelId: string,
    req: {
      module: string;
      key: string;
      viewer: string;
      viewer_name: string;
      item:
        | { kind: 'reward'; reward_id: string }
        | { kind: 'jetons'; amount: number };
      reference: string | null;
    },
  ): Promise<{ awarded: boolean; replayed: boolean }>;
}
/** Taking an item back (an admin correction). */
export interface ChallengeRevoker {
  revokeIn(
    q: Queryable,
    channelId: string,
    req: { reward_id: string; viewer: string; reason: string },
    actor: Actor,
  ): Promise<unknown>;
}

interface DefRow {
  channel_id: string;
  challenge_id: string;
  version: number;
  title: string;
  description: string;
  category: string;
  icon: string | null;
  metric: string;
  target: string | number;
  period: 'once' | 'week' | 'month';
  starts_at: Date | null;
  ends_at: Date | null;
  retroactive: boolean;
  visibility: 'public' | 'secret';
  reward: ChallengeReward | null;
  status: 'draft' | 'active' | 'suspended' | 'archived';
  activated_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_by: string;
  updated_at: Date;
}

export interface Problem {
  field: string;
  code: string;
  message: string;
}

const TABLES = [
  'challenge_defs',
  'challenge_progress',
  'challenge_awards',
  'challenge_runs',
  'challenge_log',
];
const LOCKED: (keyof ChallengeInput)[] = [
  'metric',
  'target',
  'period',
  'starts_at',
  'ends_at',
  'retroactive',
  'reward',
];
/** After this delay past its end, a challenge is final: not recounted any more. */
const END_GRACE_MS = 24 * 3600_000;
const MAX_ATTEMPTS = 50;

const iso = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString() : null;
const num = (v: unknown) => Number(v ?? 0);
const time = (d: Date | string | null) =>
  d === null ? null : new Date(d).getTime();

export function defView(d: DefRow) {
  return {
    challenge_id: d.challenge_id,
    version: d.version,
    title: d.title,
    description: d.description,
    category: d.category,
    icon: d.icon,
    metric: d.metric,
    target: num(d.target),
    period: d.period,
    starts_at: iso(d.starts_at),
    ends_at: iso(d.ends_at),
    retroactive: d.retroactive,
    visibility: d.visibility,
    reward: d.reward,
    status: d.status,
    activated_at: iso(d.activated_at),
    created_by: d.created_by,
    created_at: iso(d.created_at),
    updated_by: d.updated_by,
    updated_at: iso(d.updated_at),
  };
}

interface Window {
  key: string;
  from: Date | null;
  to: Date | null;
  /** period metrics: the stats row to read. */
  period?: { kind: 'week' | 'month'; start: string };
}

/** Tables read when present: names (production: viewers; the Lab: lab_viewers) and the excluded accounts. */
const OPTIONAL = ['viewers', 'lab_viewers', 'loyalty_exclusions'];

export class ChallengeService {
  /** The public tables this database has (read once the challenge tables exist). */
  private tables: Set<string> | null = null;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly awarder: ChallengeAwarder,
    private readonly revoker: ChallengeRevoker,
  ) {}

  private now() {
    return this.clock.now();
  }

  /** The tables exist (migration applied). Absent: every route answers 503, the timer does nothing. */
  async available() {
    if (this.tables) return true;
    const r = await this.db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])`,
      [[...TABLES, ...OPTIONAL, ...CHALLENGE_METRICS.flatMap((m) => m.tables)]],
    );
    const found = new Set(r.map((x) => x.table_name));
    if (!TABLES.every((t) => found.has(t))) return false;
    this.tables = found;
    return true;
  }

  private has(table: string) {
    return !!this.tables?.has(table);
  }

  /** The metric's source tables exist in this database (the Lab has no canonical Wallet, Daily…). */
  metricReady(key: string) {
    const m = metricOf(key);
    return !!m && m.tables.every((t) => this.has(t));
  }

  /** A viewer's shown name: `<alias>.name` joined on `<col>` (production: viewers; the Lab: lab_viewers, channel $1). */
  private nameJoin(col: string) {
    if (this.has('viewers'))
      return {
        join: `left join viewers nv on nv.twitch_user_id = ${col}`,
        name: 'coalesce(nv.display_name, nv.login)',
      };
    if (this.has('lab_viewers'))
      return {
        join: `left join lab_viewers nv on nv.channel_id = $1 and nv.viewer_id = ${col}`,
        name: 'nv.display_name',
      };
    return { join: '', name: 'null::text' };
  }

  private async need() {
    if (!(await this.available()))
      throw new ChallengeError(503, 'challenges_unavailable');
  }

  // --- definitions (Studio) -----------------------------------------------------------------------------------------

  /** Server-side rules of a definition. `forActivation`: also what must hold to go live now. */
  async problems(
    channelId: string,
    d: ChallengeInput,
    forActivation = false,
    q: Queryable = this.db,
  ): Promise<Problem[]> {
    const out: Problem[] = [];
    const p = (field: string, code: string, message: string) =>
      out.push({ field, code, message });
    const m = metricOf(d.metric);
    if (!m) p('metric', 'unknown_metric', 'Cette métrique n’existe pas.');
    else if (!this.metricReady(m.key))
      p(
        'metric',
        'metric_unavailable',
        `« ${m.label} » n’a pas sa source sur ce Core (${m.tables.filter((t) => !this.has(t)).join(', ')}).`,
      );
    const start = d.starts_at ? Date.parse(d.starts_at) : null;
    const end = d.ends_at ? Date.parse(d.ends_at) : null;
    if (start !== null && end !== null && end <= start)
      p('ends_at', 'ends_before_start', 'La fin doit être après le début.');
    if (forActivation && end !== null && end <= this.now().getTime())
      p('ends_at', 'already_ended', 'Ce défi est déjà terminé.');
    if (m?.granularity === 'period' && d.period === 'once') {
      if (!d.retroactive || start !== null || end !== null)
        p(
          'period',
          'period_metric_window',
          `« ${m.label} » n’existe qu’en totaux par semaine, par mois ou à vie : un défi unique doit être rétroactif et sans dates.`,
        );
    }
    if (d.reward?.kind === 'reward') {
      const r = (
        await q.query<{ status: string; active: boolean; kind: string }>(
          'select status, active, kind from progression_rewards where channel_id = $1 and reward_id = $2',
          [channelId, d.reward.reward_id],
        )
      )[0];
      if (!r)
        p(
          'reward',
          'unknown_item',
          'Cet objet n’existe pas dans le catalogue.',
        );
      else if (!r.active || r.status === 'draft')
        p(
          'reward',
          'item_unavailable',
          'Cet objet est un brouillon ou désactivé : publie-le avant de l’offrir.',
        );
    }
    return out;
  }

  async list(channelId: string) {
    await this.need();
    const defs = await this.db.query<
      DefRow & {
        participants: string;
        completed: string;
        pending: string;
        failed: string;
        granted: string;
      }
    >(
      `select d.*,
         (select count(distinct viewer_id) from challenge_progress p
           where p.channel_id = d.channel_id and p.challenge_id = d.challenge_id and p.value > 0) as participants,
         (select count(*) from challenge_progress p
           where p.channel_id = d.channel_id and p.challenge_id = d.challenge_id and p.completed_at is not null) as completed,
         (select count(*) filter (where status = 'pending') from challenge_awards a
           where a.channel_id = d.channel_id and a.challenge_id = d.challenge_id) as pending,
         (select count(*) filter (where status = 'failed') from challenge_awards a
           where a.channel_id = d.channel_id and a.challenge_id = d.challenge_id) as failed,
         (select count(*) filter (where status = 'granted') from challenge_awards a
           where a.channel_id = d.channel_id and a.challenge_id = d.challenge_id) as granted
       from challenge_defs d where d.channel_id = $1
       order by case d.status when 'active' then 0 when 'suspended' then 1 when 'draft' then 2 else 3 end, d.created_at`,
      [channelId],
    );
    const runs = await this.runs(channelId, 1);
    return {
      challenges: defs.map((d) => ({
        ...defView(d),
        stats: {
          participants: num(d.participants),
          completed: num(d.completed),
          awards: {
            pending: num(d.pending),
            failed: num(d.failed),
            granted: num(d.granted),
          },
        },
      })),
      last_run: runs[0] ?? null,
    };
  }

  /** What Studio offers: the metrics (with their historical limit) and the catalogue items a challenge may give. */
  async meta(channelId: string) {
    await this.need();
    const firsts = await Promise.all(
      CHALLENGE_METRICS.map(async (m) =>
        this.metricReady(m.key)
          ? iso(
              (
                await this.db.query<{ at: Date | null }>(m.first, [channelId])
              )[0]?.at,
            )
          : null,
      ),
    );
    const items = await this.db.query<{
      reward_id: string;
      kind: string;
      label: string;
      rarity: string | null;
      status: string;
      active: boolean;
    }>(
      `select reward_id, kind, label, rarity, status, active from progression_rewards
       where channel_id = $1 and status <> 'draft' and active order by kind, label`,
      [channelId],
    );
    return {
      metrics: CHALLENGE_METRICS.map((m, i) => ({
        key: m.key,
        label: m.label,
        unit: m.unit,
        source: m.source,
        granularity: m.granularity,
        history: m.history,
        /** false: its source is not on this Core (the Lab has no canonical Wallet, no Daily). */
        available: this.metricReady(m.key),
        first_record_at: firsts[i],
      })),
      items,
    };
  }

  private async def(q: Queryable, channelId: string, id: string, lock = false) {
    const d = (
      await q.query<DefRow>(
        `select * from challenge_defs where channel_id = $1 and challenge_id = $2${lock ? ' for update' : ''}`,
        [channelId, id],
      )
    )[0];
    if (!d) throw new ChallengeError(404, 'unknown_challenge');
    return d;
  }

  async create(channelId: string, input: ChallengeInput, actor: string) {
    await this.need();
    // Studio's own paths (/challenges/meta, /runs, /run, /preview).
    if (['meta', 'runs', 'run', 'preview'].includes(input.challenge_id))
      throw new ChallengeError(400, 'reserved_id');
    const problems = await this.problems(channelId, input);
    if (problems.some((p) => p.code === 'unknown_metric'))
      throw new ChallengeError(400, 'invalid_challenge', { problems });
    const now = this.now();
    const r = await this.db.query<DefRow>(
      `insert into challenge_defs (channel_id, challenge_id, title, description, category, icon, metric, target, period,
         starts_at, ends_at, retroactive, visibility, reward, status, created_by, created_at, updated_by, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, 'draft', $15, $16, $15, $16)
       on conflict (channel_id, challenge_id) do nothing returning *`,
      [
        channelId,
        input.challenge_id,
        input.title,
        input.description,
        input.category,
        input.icon,
        input.metric,
        input.target,
        input.period,
        input.starts_at,
        input.ends_at,
        input.retroactive,
        input.visibility,
        input.reward ? JSON.stringify(input.reward) : null,
        actor,
        now,
      ],
    );
    if (!r.length) throw new ChallengeError(409, 'challenge_exists');
    return { challenge: defView(r[0]!), problems };
  }

  /** A draft changes freely; a published challenge keeps its condition (only the texts and visibility change). */
  async update(channelId: string, input: ChallengeInput, actor: string) {
    await this.need();
    return this.db.tx(async (q) => {
      const d = await this.def(q, channelId, input.challenge_id, true);
      if (d.status === 'archived')
        throw new ChallengeError(409, 'challenge_archived');
      if (d.status !== 'draft') {
        const current = this.inputOf(d);
        const changed = LOCKED.filter(
          (k) => JSON.stringify(current[k]) !== JSON.stringify(input[k]),
        );
        if (changed.length)
          throw new ChallengeError(409, 'condition_locked', {
            fields: changed,
          });
      }
      const problems = await this.problems(channelId, input, false, q);
      if (problems.some((p) => p.code === 'unknown_metric'))
        throw new ChallengeError(400, 'invalid_challenge', { problems });
      const now = this.now();
      const r = await q.query<DefRow>(
        `update challenge_defs set title = $3, description = $4, category = $5, icon = $6, metric = $7, target = $8,
           period = $9, starts_at = $10, ends_at = $11, retroactive = $12, visibility = $13, reward = $14::jsonb,
           version = version + 1, updated_by = $15, updated_at = $16
         where channel_id = $1 and challenge_id = $2 returning *`,
        [
          channelId,
          input.challenge_id,
          input.title,
          input.description,
          input.category,
          input.icon,
          input.metric,
          input.target,
          input.period,
          input.starts_at,
          input.ends_at,
          input.retroactive,
          input.visibility,
          input.reward ? JSON.stringify(input.reward) : null,
          actor,
          now,
        ],
      );
      if (d.status !== 'draft')
        await this.log(q, channelId, null, d.challenge_id, {
          kind: 'admin',
          detail: { action: 'edit_texts', version: r[0]!.version },
          actor,
        });
      return { challenge: defView(r[0]!), problems };
    });
  }

  async remove(channelId: string, id: string) {
    await this.need();
    return this.db.tx(async (q) => {
      const d = await this.def(q, channelId, id, true);
      if (d.status !== 'draft') throw new ChallengeError(409, 'not_a_draft');
      await q.query(
        'delete from challenge_defs where channel_id = $1 and challenge_id = $2',
        [channelId, id],
      );
      return { deleted: true };
    });
  }

  inputOf(d: DefRow): ChallengeInput {
    return {
      challenge_id: d.challenge_id,
      title: d.title,
      description: d.description,
      category: d.category,
      icon: d.icon,
      metric: d.metric,
      target: num(d.target),
      period: d.period,
      starts_at: iso(d.starts_at),
      ends_at: iso(d.ends_at),
      retroactive: d.retroactive,
      visibility: d.visibility,
      reward: d.reward,
    };
  }

  async setStatus(
    channelId: string,
    id: string,
    status: 'active' | 'suspended' | 'archived',
    actor: string,
  ) {
    await this.need();
    const changed = await this.db.tx(async (q) => {
      const d = await this.def(q, channelId, id, true);
      const allowed: Record<string, string[]> = {
        draft: ['active', 'archived'],
        active: ['suspended', 'archived'],
        suspended: ['active', 'archived'],
        archived: [],
      };
      if (d.status === status) return { def: d, from: d.status };
      if (!allowed[d.status]!.includes(status))
        throw new ChallengeError(409, 'invalid_transition', {
          from: d.status,
          to: status,
        });
      if (status === 'active') {
        const problems = await this.problems(
          channelId,
          this.inputOf(d),
          true,
          q,
        );
        if (problems.length)
          throw new ChallengeError(409, 'invalid_challenge', { problems });
      }
      const now = this.now();
      const r = await q.query<DefRow>(
        `update challenge_defs set status = $3, activated_at = case when $3 = 'active' then coalesce(activated_at, $4)
           else activated_at end, updated_by = $5, updated_at = $4
         where channel_id = $1 and challenge_id = $2 returning *`,
        [channelId, id, status, now, actor],
      );
      await this.log(q, channelId, null, id, {
        kind: 'admin',
        detail: { action: 'status', from: d.status, to: status },
        actor,
      });
      return { def: r[0]!, from: d.status };
    });
    // Going live (first time or resumed): count now, so a retroactive challenge is completed at once.
    const run =
      status === 'active' && changed.from !== 'active'
        ? await this.run(channelId, {
            trigger: 'activation',
            actor,
            only: id,
          })
        : null;
    return { challenge: defView(changed.def), run };
  }

  // --- counting -----------------------------------------------------------------------------------------------------

  /** The windows a challenge counts now: 'all', or the current and the previous week / month (late events). */
  private async windows(q: Queryable, d: DefRow): Promise<Window[]> {
    const now = this.now();
    const m = metricOf(d.metric)!;
    const effStart = d.retroactive
      ? d.starts_at
      : new Date(Math.max(time(d.starts_at) ?? 0, time(d.activated_at) ?? 0));
    if (d.period === 'once')
      return [{ key: 'all', from: effStart, to: d.ends_at }];
    const out: Window[] = [];
    for (const offset of [1, 0]) {
      const r = (
        await q.query<{ start: string; from_at: Date; to_at: Date }>(
          `with b as (select (date_trunc($2::text, $1::timestamptz at time zone 'Europe/Paris')
               - ($3::int * ('1 ' || $2::text)::interval))::date as d)
           select to_char(d, 'YYYY-MM-DD') as start,
             d::timestamp at time zone 'Europe/Paris' as from_at,
             (d + ('1 ' || $2::text)::interval) at time zone 'Europe/Paris' as to_at from b`,
          [now, d.period, offset],
        )
      )[0]!;
      const from = new Date(r.from_at);
      const to = new Date(r.to_at);
      if (d.ends_at && from >= d.ends_at) continue;
      if (d.starts_at && to <= d.starts_at) continue;
      if (m.granularity === 'period') {
        // Only whole periods exist: a non-retroactive challenge starts with the first period after its activation.
        if (!d.retroactive && d.activated_at && from < d.activated_at) continue;
        if (d.starts_at && from < d.starts_at) continue;
      }
      out.push({
        key: d.period === 'week' ? `w${r.start}` : `m${r.start.slice(0, 7)}`,
        from: effStart && effStart > from ? effStart : from,
        to: d.ends_at && d.ends_at < to ? d.ends_at : to,
        period: { kind: d.period, start: r.start },
      });
    }
    return out;
  }

  /** The metric's value per viewer over a window, excluded accounts (bots, tests) removed. */
  private async count(
    q: Queryable,
    channelId: string,
    metric: string,
    w: Window,
  ): Promise<Map<string, number>> {
    const m = metricOf(metric)!;
    let sql: string;
    let params: unknown[];
    if (m.granularity === 'exact') {
      sql = m.exact!;
      params = [channelId, w.from, w.to];
    } else if (w.period) {
      sql = m.period!;
      params = [channelId, w.period.kind, w.period.start];
    } else {
      sql = m.lifetime!;
      params = [channelId];
    }
    const rows = await q.query<{ viewer_id: string; n: string | number }>(
      `select x.viewer_id, x.n from (${sql}) x
       where x.viewer_id is not null and x.n > 0
         ${this.has('loyalty_exclusions') ? 'and not exists (select 1 from loyalty_exclusions e where e.twitch_user_id = x.viewer_id)' : ''}`,
      params,
    );
    return new Map(rows.map((r) => [r.viewer_id, num(r.n)]));
  }

  /** Dry run for Studio: who would count / complete if this definition went live now. Writes nothing. */
  async preview(channelId: string, input: ChallengeInput) {
    await this.need();
    const problems = await this.problems(channelId, input, true);
    if (
      problems.some(
        (p) =>
          p.code === 'unknown_metric' ||
          p.code === 'metric_unavailable' ||
          p.code === 'period_metric_window',
      )
    )
      return { problems, windows: [], eligible: null };
    const now = this.now();
    const d = {
      ...input,
      channel_id: channelId,
      target: input.target,
      starts_at: input.starts_at ? new Date(input.starts_at) : null,
      ends_at: input.ends_at ? new Date(input.ends_at) : null,
      activated_at: now,
      status: 'active',
    } as unknown as DefRow;
    const wins = await this.windows(this.db, d);
    const out = [];
    for (const w of wins) {
      const counts = await this.count(this.db, channelId, input.metric, w);
      const top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      const names = await this.names(
        channelId,
        top.map(([v]) => v),
      );
      out.push({
        period_key: w.key,
        from: iso(w.from),
        to: iso(w.to),
        participants: counts.size,
        completing: [...counts.values()].filter((n) => n >= input.target)
          .length,
        top: top.map(([v, n]) => ({
          viewer: v,
          name: names.get(v) ?? v,
          value: n,
        })),
      });
    }
    return { problems, windows: out };
  }

  private async names(channelId: string, ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const n = this.nameJoin('x.id');
    const rows = await this.db.query<{ id: string; name: string | null }>(
      `select x.id, ${n.name} as name from unnest($2::text[]) as x(id) ${n.join} where $1::text is not null`,
      [channelId, ids],
    );
    return new Map(rows.map((r) => [r.id, r.name ?? r.id]));
  }

  private async log(
    q: Queryable,
    channelId: string,
    runId: string | null,
    challengeId: string,
    e: {
      kind: string;
      period_key?: string | null;
      viewer?: string | null;
      before?: number | null;
      after?: number | null;
      detail?: unknown;
      actor?: string | null;
    },
  ) {
    await q.query(
      `insert into challenge_log (channel_id, run_id, challenge_id, period_key, viewer_id, kind, before, after, detail,
         actor, at) values ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
      [
        channelId,
        runId,
        challengeId,
        e.period_key ?? null,
        e.viewer ?? null,
        e.kind,
        e.before ?? null,
        e.after ?? null,
        e.detail === undefined ? null : JSON.stringify(e.detail),
        e.actor ?? null,
        this.now(),
      ],
    );
  }

  /**
   * Recounts one challenge in one transaction, its definition row locked: two runs at once are serialized, the second
   * sees the first's writes and changes nothing. Returns what moved.
   */
  private async evaluateOne(channelId: string, id: string, runId: string) {
    return this.db.tx(async (q) => {
      const d = await this.def(q, channelId, id, true);
      const out = { periods: 0, changed: 0, completed: 0, below: 0 };
      if (d.status !== 'active' || !this.metricReady(d.metric)) return out;
      const now = this.now();
      if (d.starts_at && d.starts_at > now) return out;
      if (d.ends_at && now.getTime() > d.ends_at.getTime() + END_GRACE_MS)
        return out;
      const target = num(d.target);
      for (const w of await this.windows(q, d)) {
        out.periods++;
        const counts = await this.count(q, channelId, d.metric, w);
        const existing = new Map(
          (
            await q.query<{
              viewer_id: string;
              value: string | number;
              completed_at: Date | null;
            }>(
              `select viewer_id, value, completed_at from challenge_progress
               where channel_id = $1 and challenge_id = $2 and period_key = $3`,
              [channelId, id, w.key],
            )
          ).map((r) => [r.viewer_id, r]),
        );
        const viewers = new Set([...counts.keys(), ...existing.keys()]);
        const rows: { v: string; value: number; done: boolean }[] = [];
        const logs: {
          kind: string;
          v: string;
          before: number | null;
          after: number;
        }[] = [];
        for (const v of viewers) {
          const after = counts.get(v) ?? 0;
          const prev = existing.get(v);
          const before = prev ? num(prev.value) : null;
          if (before === after || (before === null && after === 0)) continue;
          const wasDone = !!prev?.completed_at;
          const done = wasDone || after >= target;
          rows.push({ v, value: after, done });
          logs.push({ kind: 'progress', v, before, after });
          if (!wasDone && done) {
            logs.push({ kind: 'completed', v, before, after });
            out.completed++;
          }
          if (wasDone && after < target && (before ?? 0) >= target) {
            logs.push({ kind: 'below_target', v, before, after });
            out.below++;
          }
        }
        if (!rows.length) continue;
        out.changed += rows.length;
        await q.query(
          `insert into challenge_progress as p (channel_id, challenge_id, period_key, viewer_id, value, target, version,
             completed_at, updated_at)
           select $1, $2, $3, u.v, u.value, $4, $5, case when u.done then $6::timestamptz end, $6
           from unnest($7::text[], $8::bigint[], $9::boolean[]) as u(v, value, done)
           on conflict (channel_id, challenge_id, period_key, viewer_id) do update set value = excluded.value,
             target = excluded.target, completed_at = coalesce(p.completed_at, excluded.completed_at),
             version = case when p.completed_at is null then excluded.version else p.version end,
             updated_at = excluded.updated_at`,
          [
            channelId,
            id,
            w.key,
            target,
            d.version,
            now,
            rows.map((r) => r.v),
            rows.map((r) => r.value),
            rows.map((r) => r.done),
          ],
        );
        await q.query(
          `insert into challenge_log (channel_id, run_id, challenge_id, period_key, viewer_id, kind, before, after, at)
           select $1, $2::uuid, $3, $4, u.v, u.kind, u.before, u.after, $5
           from unnest($6::text[], $7::text[], $8::bigint[], $9::bigint[]) as u(v, kind, before, after)`,
          [
            channelId,
            runId,
            id,
            w.key,
            now,
            logs.map((l) => l.v),
            logs.map((l) => l.kind),
            logs.map((l) => l.before),
            logs.map((l) => l.after),
          ],
        );
        const completedNow = logs
          .filter((l) => l.kind === 'completed')
          .map((l) => l.v);
        if (d.reward && completedNow.length)
          await q.query(
            `insert into challenge_awards (channel_id, challenge_id, period_key, viewer_id, version, reward, award_key,
               status, created_at)
             select $1, $2, $3, v, $4, $5::jsonb, $2 || ':' || $3 || ':' || v, 'pending', $6
             from unnest($7::text[]) as v
             on conflict do nothing`,
            [
              channelId,
              id,
              w.key,
              d.version,
              JSON.stringify(d.reward),
              now,
              completedNow,
            ],
          );
      }
      return out;
    });
  }

  /** Pays the awards not paid yet (pending, or failed earlier) of live challenges. Safe to run twice at once. */
  private async payAwards(channelId: string, runId: string, only?: string) {
    const open = await this.db.query<{
      challenge_id: string;
      period_key: string;
      viewer_id: string;
      award_key: string;
      reward: ChallengeReward;
      status: string;
      error: string | null;
      name: string | null;
    }>(
      `select a.challenge_id, a.period_key, a.viewer_id, a.award_key, a.reward, a.status, a.error,
         ${this.nameJoin('a.viewer_id').name} as name
       from challenge_awards a join challenge_defs d using (channel_id, challenge_id)
       ${this.nameJoin('a.viewer_id').join}
       where a.channel_id = $1 and a.status in ('pending', 'failed') and a.attempts < $2 and d.status = 'active'
         and ($3::text is null or a.challenge_id = $3)
       order by a.created_at limit 500`,
      [channelId, MAX_ATTEMPTS, only ?? null],
    );
    let granted = 0;
    let failed = 0;
    for (const a of open) {
      let error: string | null = null;
      try {
        await this.awarder.award(channelId, {
          module: 'challenges',
          key: a.award_key,
          viewer: a.viewer_id,
          viewer_name: (a.name ?? a.viewer_id).slice(0, 64),
          item: a.reward,
          reference: `défi ${a.challenge_id}`.slice(0, 80),
        });
      } catch (e) {
        error =
          e instanceof CosmeticError
            ? e.code
            : e instanceof Error
              ? e.message.slice(0, 200)
              : 'error';
      }
      await this.db.tx(async (q) => {
        const r = await q.query(
          `update challenge_awards set status = $5, attempts = attempts + 1, error = $6,
             granted_at = case when $5 = 'granted' then $7::timestamptz else granted_at end
           where channel_id = $1 and challenge_id = $2 and period_key = $3 and viewer_id = $4
             and status in ('pending', 'failed') returning 1`,
          [
            channelId,
            a.challenge_id,
            a.period_key,
            a.viewer_id,
            error ? 'failed' : 'granted',
            error,
            this.now(),
          ],
        );
        // One log line per change of state (a failure repeated each minute is not logged again).
        if (r.length && (!error || a.status !== 'failed' || a.error !== error))
          await this.log(q, channelId, runId, a.challenge_id, {
            kind: error ? 'award_failed' : 'award_granted',
            period_key: a.period_key,
            viewer: a.viewer_id,
            detail: { reward: a.reward, ...(error ? { error } : {}) },
          });
      });
      if (error) failed++;
      else granted++;
    }
    return { granted, failed };
  }

  /** One full pass (timer, activation, Studio's « Recompter »): recount, then pay. Replayable at will. */
  async run(
    channelId: string,
    o: {
      trigger: 'auto' | 'manual' | 'activation';
      actor?: string;
      only?: string;
    },
  ) {
    await this.need();
    const runId = randomUUID();
    await this.db.query(
      `insert into challenge_runs (run_id, channel_id, trigger, actor, started_at, status)
       values ($1, $2, $3, $4, $5, 'running')`,
      [runId, channelId, o.trigger, o.actor ?? null, this.now()],
    );
    const summary = {
      challenges: 0,
      periods: 0,
      changed: 0,
      completed: 0,
      below_target: 0,
      awards_granted: 0,
      awards_failed: 0,
    };
    try {
      const ids = (
        await this.db.query<{ challenge_id: string }>(
          `select challenge_id from challenge_defs where channel_id = $1 and status = 'active'
             and ($2::text is null or challenge_id = $2) order by challenge_id`,
          [channelId, o.only ?? null],
        )
      ).map((r) => r.challenge_id);
      for (const id of ids) {
        const r = await this.evaluateOne(channelId, id, runId);
        summary.challenges++;
        summary.periods += r.periods;
        summary.changed += r.changed;
        summary.completed += r.completed;
        summary.below_target += r.below;
      }
      const paid = await this.payAwards(channelId, runId, o.only);
      summary.awards_granted = paid.granted;
      summary.awards_failed = paid.failed;
      await this.db.query(
        `update challenge_runs set status = 'done', finished_at = $2, summary = $3::jsonb where run_id = $1`,
        [runId, this.now(), JSON.stringify(summary)],
      );
      return { run_id: runId, ...summary };
    } catch (e) {
      await this.db.query(
        `update challenge_runs set status = 'failed', finished_at = $2, summary = $3::jsonb, error = $4
         where run_id = $1`,
        [
          runId,
          this.now(),
          JSON.stringify(summary),
          (e instanceof Error ? e.message : String(e)).slice(0, 300),
        ],
      );
      throw e;
    }
  }

  /** The timer: nothing when the tables are absent or nothing is live (production today). Errors are logged by runs. */
  async tick(channelId: string) {
    if (!(await this.available())) return null;
    const live = await this.db.query(
      `select 1 from challenge_defs where channel_id = $1 and status = 'active' limit 1`,
      [channelId],
    );
    if (!live.length) return null;
    return this.run(channelId, { trigger: 'auto' });
  }

  // --- Studio reads and corrections ---------------------------------------------------------------------------------

  async runs(channelId: string, limit = 20) {
    await this.need();
    return (
      await this.db.query<{
        run_id: string;
        trigger: string;
        actor: string | null;
        started_at: Date;
        finished_at: Date | null;
        status: string;
        summary: unknown;
        error: string | null;
      }>(
        'select * from challenge_runs where channel_id = $1 order by started_at desc limit $2',
        [channelId, limit],
      )
    ).map((r) => ({
      run_id: r.run_id,
      trigger: r.trigger,
      actor: r.actor,
      started_at: iso(r.started_at),
      finished_at: iso(r.finished_at),
      status: r.status,
      summary: r.summary,
      error: r.error,
    }));
  }

  async detail(channelId: string, id: string) {
    await this.need();
    const d = await this.def(this.db, channelId, id);
    const [progress, awards, log] = await Promise.all([
      this.db.query<{
        period_key: string;
        viewer_id: string;
        value: string;
        target: string;
        version: number;
        completed_at: Date | null;
        updated_at: Date;
        name: string | null;
      }>(
        `select p.*, ${this.nameJoin('p.viewer_id').name} as name from challenge_progress p
         ${this.nameJoin('p.viewer_id').join}
         where p.channel_id = $1 and p.challenge_id = $2
         order by p.period_key desc, p.value desc, p.viewer_id limit 200`,
        [channelId, id],
      ),
      this.db.query<{
        period_key: string;
        viewer_id: string;
        version: number;
        reward: unknown;
        status: string;
        attempts: number;
        error: string | null;
        created_at: Date;
        granted_at: Date | null;
        revoked_at: Date | null;
        revoke_reason: string | null;
        name: string | null;
      }>(
        `select a.*, ${this.nameJoin('a.viewer_id').name} as name from challenge_awards a
         ${this.nameJoin('a.viewer_id').join}
         where a.channel_id = $1 and a.challenge_id = $2 order by a.created_at desc limit 200`,
        [channelId, id],
      ),
      this.db.query<{
        id: string;
        run_id: string | null;
        period_key: string | null;
        viewer_id: string | null;
        kind: string;
        before: string | null;
        after: string | null;
        detail: unknown;
        actor: string | null;
        at: Date;
        name: string | null;
      }>(
        `select l.*, ${this.nameJoin('l.viewer_id').name} as name from challenge_log l
         ${this.nameJoin('l.viewer_id').join}
         where l.channel_id = $1 and l.challenge_id = $2 order by l.id desc limit 100`,
        [channelId, id],
      ),
    ]);
    return {
      challenge: defView(d),
      progress: progress.map((p) => ({
        period_key: p.period_key,
        viewer: p.viewer_id,
        name: p.name ?? p.viewer_id,
        value: num(p.value),
        target: num(p.target),
        version: p.version,
        completed_at: iso(p.completed_at),
        updated_at: iso(p.updated_at),
      })),
      awards: awards.map((a) => ({
        period_key: a.period_key,
        viewer: a.viewer_id,
        name: a.name ?? a.viewer_id,
        version: a.version,
        reward: a.reward,
        status: a.status,
        attempts: a.attempts,
        error: a.error,
        created_at: iso(a.created_at),
        granted_at: iso(a.granted_at),
        revoked_at: iso(a.revoked_at),
        revoke_reason: a.revoke_reason,
      })),
      log: log.map((l) => ({
        id: num(l.id),
        run_id: l.run_id,
        period_key: l.period_key,
        viewer: l.viewer_id,
        name: l.viewer_id ? (l.name ?? l.viewer_id) : null,
        kind: l.kind,
        before: l.before === null ? null : num(l.before),
        after: l.after === null ? null : num(l.after),
        detail: l.detail,
        actor: l.actor,
        at: iso(l.at),
      })),
    };
  }

  /**
   * Admin correction: an item given by a challenge is taken back (with a reason), the award marked revoked — and never
   * given again by a later recount (its row stays). Jetons are not reversed here: a Wallet adjustment does it.
   */
  async revoke(
    channelId: string,
    id: string,
    req: { period_key: string; viewer: string; reason: string },
    actor: string,
  ) {
    await this.need();
    return this.db.tx(async (q) => {
      const a = (
        await q.query<{ status: string; reward: ChallengeReward }>(
          `select status, reward from challenge_awards
           where channel_id = $1 and challenge_id = $2 and period_key = $3 and viewer_id = $4 for update`,
          [channelId, id, req.period_key, req.viewer],
        )
      )[0];
      if (!a) throw new ChallengeError(404, 'unknown_award');
      if (a.status === 'revoked') return { revoked: true, replayed: true };
      if (a.reward.kind !== 'reward')
        throw new ChallengeError(409, 'jetons_not_revocable');
      if (a.status === 'granted')
        await this.revoker.revokeIn(
          q,
          channelId,
          {
            reward_id: a.reward.reward_id,
            viewer: req.viewer,
            reason: req.reason,
          },
          { id: actor, name: actor },
        );
      await q.query(
        `update challenge_awards set status = 'revoked', revoked_at = $5, revoked_by = $6, revoke_reason = $7
         where channel_id = $1 and challenge_id = $2 and period_key = $3 and viewer_id = $4`,
        [
          channelId,
          id,
          req.period_key,
          req.viewer,
          this.now(),
          actor,
          req.reason,
        ],
      );
      await this.log(q, channelId, null, id, {
        kind: 'award_revoked',
        period_key: req.period_key,
        viewer: req.viewer,
        detail: { reason: req.reason, was: a.status },
        actor,
      });
      return { revoked: true, replayed: false };
    });
  }

  // --- the site (read only) -----------------------------------------------------------------------------------------

  /**
   * raptoru.fr: the live catalogue (public challenges; a secret one only once this viewer completed it), this viewer's
   * progress for the current period and their completed challenges. One pass over stored rows, nothing recounted.
   */
  async site(channelId: string, viewerId: string | null) {
    await this.need();
    const now = this.now();
    const keys = (
      await this.db.query<{ w: string; m: string }>(
        `select 'w' || to_char(date_trunc('week', $1::timestamptz at time zone 'Europe/Paris'), 'YYYY-MM-DD') as w,
           'm' || to_char(date_trunc('month', $1::timestamptz at time zone 'Europe/Paris'), 'YYYY-MM') as m`,
        [now],
      )
    )[0]!;
    const current = (period: string) =>
      period === 'week' ? keys.w : period === 'month' ? keys.m : 'all';
    const defs = await this.db.query<
      DefRow & {
        item_kind: string | null;
        item_label: string | null;
        item_rarity: string | null;
        item_image: string | null;
        completions: string;
      }
    >(
      `select d.*, r.kind as item_kind, r.label as item_label, r.rarity as item_rarity, r.image_id as item_image,
         (select count(*) from challenge_progress p where p.channel_id = d.channel_id
           and p.challenge_id = d.challenge_id and p.completed_at is not null) as completions
       from challenge_defs d
       left join progression_rewards r on r.channel_id = d.channel_id and r.reward_id = d.reward->>'reward_id'
       where d.channel_id = $1 and d.status <> 'draft'
       order by d.category, d.activated_at, d.challenge_id`,
      [channelId],
    );
    const mine = viewerId
      ? await this.db.query<{
          challenge_id: string;
          period_key: string;
          value: string;
          target: string;
          completed_at: Date | null;
          award_status: string | null;
        }>(
          `select p.challenge_id, p.period_key, p.value, p.target, p.completed_at, a.status as award_status
           from challenge_progress p left join challenge_awards a using (channel_id, challenge_id, period_key, viewer_id)
           where p.channel_id = $1 and p.viewer_id = $2`,
          [channelId, viewerId],
        )
      : [];
    const rewardOf = (d: (typeof defs)[number]) =>
      !d.reward
        ? null
        : d.reward.kind === 'jetons'
          ? { kind: 'jetons', amount: d.reward.amount }
          : {
              kind: d.item_kind ?? 'item',
              reward_id: d.reward.reward_id,
              label: d.item_label,
              rarity: d.item_rarity,
              image: d.item_image,
            };
    const runs = await this.db.query<{ finished_at: Date }>(
      `select finished_at from challenge_runs where channel_id = $1 and status = 'done'
       order by finished_at desc limit 1`,
      [channelId],
    );
    let secretHidden = 0;
    const challenges = [];
    const completed = [];
    for (const d of defs) {
      const rows = mine.filter((p) => p.challenge_id === d.challenge_id);
      const done = rows.filter((p) => p.completed_at);
      for (const p of done)
        completed.push({
          challenge_id: d.challenge_id,
          title: d.title,
          category: d.category,
          icon: d.icon,
          period_key: p.period_key,
          completed_at: iso(p.completed_at),
          reward: rewardOf(d),
          reward_status: p.award_status,
        });
      if (d.status === 'archived') continue;
      if (d.visibility === 'secret' && !done.length) {
        secretHidden++;
        continue;
      }
      const key = current(d.period);
      const cur = rows.find((p) => p.period_key === key);
      const state =
        d.status === 'suspended'
          ? 'suspended'
          : d.starts_at && d.starts_at > now
            ? 'upcoming'
            : d.ends_at && d.ends_at <= now
              ? 'ended'
              : 'active';
      challenges.push({
        challenge_id: d.challenge_id,
        title: d.title,
        description: d.description,
        category: d.category,
        icon: d.icon,
        metric: d.metric,
        metric_label: metricOf(d.metric)?.label ?? d.metric,
        unit: metricOf(d.metric)?.unit ?? '',
        target: num(d.target),
        period: d.period,
        period_key: key,
        starts_at: iso(d.starts_at),
        ends_at: iso(d.ends_at),
        retroactive: d.retroactive,
        secret: d.visibility === 'secret',
        state,
        reward: rewardOf(d),
        completions: num(d.completions),
        me: viewerId
          ? {
              value: cur ? num(cur.value) : 0,
              completed_at: iso(cur?.completed_at),
              reward_status: cur?.award_status ?? null,
              times_completed: done.length,
            }
          : null,
      });
    }
    completed.sort((a, b) =>
      (b.completed_at ?? '').localeCompare(a.completed_at ?? ''),
    );
    return {
      challenges,
      completed: viewerId ? completed : null,
      secret_hidden: secretHidden,
      updated_at: iso(runs[0]?.finished_at),
    };
  }
}
