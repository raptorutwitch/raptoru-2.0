import { randomUUID } from 'node:crypto';
import type { CmdStepAckRequest } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import { access, type Actor } from '../lab-moderation/store.js';
import type { Rendered, RenderedMessage } from './decide.js';
import { CommandsError } from './model.js';

// Commands V2 (Lab) — durable steps (phase C). Core is the source of truth; the Lab Twitch adapter
// (LeCroupier_) only executes. Same pattern as the Sound Lab queue: channel lock, sweep, claim under a
// lease with a fresh attempt_id, ACK bound to that attempt_id, never a regression of a final state.
//
// - One step in flight per channel, handed out in channel order (FIFO, seq_global): the chat messages
//   of a channel keep their order, and step N+1 of an invocation only starts once N is final.
// - « Sortie chat réelle » OFF (default): nothing is handed out; queued steps wait, then expire.
// - A Twitch send is not idempotent: a step is sent only after its `running` ACK; a running step whose
//   outcome is not proven (lease over, timeout) becomes `unknown` and is never retried. A step that
//   certainly was not sent (claimed, lease over; or a `failed` ACK marked retryable) goes back to the
//   queue, with backoff, at most MAX attempts, never after its expiry.

export const STEP_RULES = {
  /** A chat answer older than this is pointless: expired, never sent (audited default: 60 s). */
  ttlMs: 60_000,
  /** Claimed, not yet running. */
  claimLeaseMs: 15_000,
  /** Running: covers the Helix request timeout (10 s) and the final ACK. */
  sendLeaseMs: 20_000,
  maxAttempts: 3,
  backoffBaseMs: 2_000,
  backoffMaxMs: 20_000,
};
export type StepRules = typeof STEP_RULES;

export type StepStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unknown'
  | 'expired'
  | 'cancelled'
  | 'skipped';
const FINAL: StepStatus[] = [
  'succeeded',
  'failed',
  'unknown',
  'expired',
  'cancelled',
  'skipped',
];

interface StepError {
  code: string;
  message: string;
  retryable?: boolean;
  retry_after_ms?: number;
}

export interface StepDraft {
  kind: 'reply' | 'action' | 'refusal';
  type: 'chat' | 'module';
  params: Record<string, unknown>;
  on_error: 'stop' | 'continue';
  /** Created final, never handed to the executor (unsupported in phase C). */
  skip?: StepError;
}

const chatParams = (m: RenderedMessage) => ({
  mode: m.mode,
  text: m.text,
  reply_to: m.reply_to,
});

/**
 * Steps of an accepted invocation, in execution order (reply before or after the actions). Silent
 * messages are not in `rendered` (nothing to send). Unsupported in phase C, recorded as `skipped`:
 * /me (Send Chat Message has no /me; only IRC has it — no second chat connection, no rewrite) and
 * module actions (executed by their module, never by Commands V2 yet).
 */
export function draftSteps(r: Rendered): StepDraft[] {
  const reply: StepDraft[] = r.reply
    ? [
        {
          kind: 'reply',
          type: 'chat',
          params: chatParams(r.reply),
          on_error: 'stop',
        },
      ]
    : [];
  const actions: StepDraft[] = r.actions.map((a) =>
    a.type === 'module'
      ? {
          kind: 'action',
          type: 'module',
          params: { action_id: a.id, module: a.module, operation: a.operation },
          on_error: a.on_error,
          skip: {
            code: 'module_not_executed',
            message: 'module actions are not executed by Commands V2 (phase C)',
          },
        }
      : {
          kind: 'action',
          type: 'chat',
          params: { action_id: a.id, ...chatParams(a) },
          on_error: a.on_error,
        },
  );
  return (r.reply_first ? [...reply, ...actions] : [...actions, ...reply]).map(
    (d) =>
      d.type === 'chat' && d.params.mode === 'me'
        ? {
            ...d,
            skip: {
              code: 'me_unsupported',
              message:
                'Twitch Send Chat Message does not support /me (IRC only): not sent',
            },
          }
        : d,
  );
}

interface StepRow {
  step_id: string;
  seq_global: number;
  invocation_id: string;
  channel_id: string;
  seq: number;
  idempotency_key: string;
  executor: string;
  kind: StepDraft['kind'];
  type: StepDraft['type'];
  params: Record<string, unknown>;
  on_error: 'stop' | 'continue';
  status: StepStatus;
  executor_id: string | null;
  attempt_id: string | null;
  lease_expires_at: Date | null;
  available_at: Date;
  expires_at: Date;
  attempt_count: number;
  error: StepError | null;
  twitch_message_id: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
export const stepView = (r: StepRow) => ({
  step_id: r.step_id,
  invocation_id: r.invocation_id,
  seq: r.seq,
  idempotency_key: r.idempotency_key,
  executor: r.executor,
  kind: r.kind,
  type: r.type,
  params: r.params,
  on_error: r.on_error,
  status: r.status,
  executor_id: r.executor_id,
  attempt_id: r.attempt_id,
  lease_expires_at: iso(r.lease_expires_at),
  available_at: iso(r.available_at)!,
  expires_at: iso(r.expires_at)!,
  attempt_count: r.attempt_count,
  error: r.error,
  twitch_message_id: r.twitch_message_id,
  created_at: iso(r.created_at)!,
  updated_at: iso(r.updated_at)!,
  started_at: iso(r.started_at),
  finished_at: iso(r.finished_at),
});
export type StepView = ReturnType<typeof stepView>;

/** Writes the steps of one invocation (inside the admission transaction). */
export async function insertSteps(
  q: Queryable,
  s: {
    invocationId: string;
    channelId: string;
    now: Date;
    ttlMs: number;
    drafts: StepDraft[];
  },
) {
  const expires = new Date(s.now.getTime() + s.ttlMs);
  let seq = 0;
  for (const d of s.drafts) {
    seq++;
    await q.query(
      `insert into cmd_steps (step_id, invocation_id, channel_id, seq, idempotency_key, executor, kind, type,
         params, on_error, status, available_at, expires_at, error, created_at, updated_at, finished_at)
       values ($1, $2, $3, $4, $5, 'twitch_chat', $6, $7, $8, $9, $10, $11, $12, $13, $11, $11, $14)`,
      [
        randomUUID(),
        s.invocationId,
        s.channelId,
        seq,
        `${s.invocationId}:${seq}`,
        d.kind,
        d.type,
        JSON.stringify(d.params),
        d.on_error,
        d.skip ? 'skipped' : 'queued',
        s.now,
        expires,
        d.skip ? JSON.stringify(d.skip) : null,
        d.skip ? s.now : null,
      ],
    );
  }
  return seq;
}

/** The executor polls every second while idle: silent for longer than this = absent. */
export const EXECUTOR_ABSENT_AFTER_MS = 5_000;

export class CommandSteps {
  readonly rules: StepRules;
  /**
   * Last step request per channel (any answer, output OFF included). Visibility only, never used by
   * the queue. ponytail: in memory — a Core restart shows « absent » until the next poll (≤ 1 s).
   */
  private readonly lastClaim = new Map<
    string,
    { at: Date; executor_id: string }
  >();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    rules: Partial<StepRules> = {},
  ) {
    this.rules = { ...STEP_RULES, ...rules };
  }

  // --- « Sortie chat réelle » ---------------------------------------------------------------------

  async output(channelId: string) {
    const row = (
      await this.db.query<{
        chat_output: boolean;
        chat_output_updated_at: Date | null;
        chat_output_updated_by: string | null;
      }>(
        'select chat_output, chat_output_updated_at, chat_output_updated_by from cmd_channels where channel_id = $1',
        [channelId],
      )
    )[0];
    const enabled = row?.chat_output ?? false;
    const last = this.lastClaim.get(channelId) ?? null;
    const present =
      !!last &&
      this.clock.now().getTime() - last.at.getTime() <=
        EXECUTOR_ABSENT_AFTER_MS;
    return {
      enabled,
      updated_at: iso(row?.chat_output_updated_at ?? null),
      updated_by: row?.chat_output_updated_by ?? null,
      executor: {
        present,
        last_claim_at: iso(last?.at ?? null),
        executor_id: last?.executor_id ?? null,
      },
      /** Output ON but nobody asks for steps: they wait, then expire unsent. */
      executor_absent: enabled && !present,
    };
  }

  /** Streamer only (Studio). Turning it OFF never touches a step already handed out. */
  async setOutput(channelId: string, actor: Actor, enabled: boolean) {
    await this.db.tx(async (q) => {
      if ((await access(q, channelId, actor)).role !== 'broadcaster')
        throw new CommandsError(403, 'streamer_only', { action: 'output' });
      await q.query(
        `insert into cmd_channels (channel_id, chat_output, chat_output_updated_at, chat_output_updated_by)
         values ($1, $2, $3, $4)
         on conflict (channel_id) do update set chat_output = excluded.chat_output,
           chat_output_updated_at = excluded.chat_output_updated_at, chat_output_updated_by = excluded.chat_output_updated_by`,
        [channelId, enabled, this.clock.now(), `${actor.via}:${actor.id}`],
      );
    });
    return this.output(channelId);
  }

  // --- executor ------------------------------------------------------------------------------------

  /** Next step of the channel, or why there is none. Never hands out anything while the output is OFF. */
  async claim(channelId: string, executorId: string) {
    this.lastClaim.set(channelId, {
      at: this.clock.now(),
      executor_id: executorId,
    });
    return this.db.tx(async (q) => {
      const channel = await this.lock(q, channelId);
      if (!channel) return { step: null, reason: 'no_channel' as const };
      const now = this.clock.now();
      await this.sweep(q, channelId, now);
      if (!channel.chat_output)
        return { step: null, reason: 'output_off' as const };
      const busy = await q.query(
        `select 1 from cmd_steps where channel_id = $1 and status in ('claimed', 'running') limit 1`,
        [channelId],
      );
      if (busy.length) return { step: null, reason: 'busy' as const };
      const next = (
        await q.query<StepRow>(
          `select * from cmd_steps where channel_id = $1 and status = 'queued'
           order by seq_global limit 1 for update skip locked`,
          [channelId],
        )
      )[0];
      if (!next) return { step: null, reason: 'empty' as const };
      // Head of line waits for its backoff: a later message never overtakes it.
      if (new Date(next.available_at) > now)
        return {
          step: null,
          reason: 'backoff' as const,
          retry_in_ms: new Date(next.available_at).getTime() - now.getTime(),
        };
      const rows = await q.query<StepRow>(
        `update cmd_steps set status = 'claimed', executor_id = $2, attempt_id = $3, lease_expires_at = $4,
           attempt_count = attempt_count + 1, error = null, updated_at = $5
         where step_id = $1 returning *`,
        [
          next.step_id,
          executorId,
          randomUUID(),
          new Date(now.getTime() + this.rules.claimLeaseMs),
          now,
        ],
      );
      return { step: stepView(rows[0]!), reason: null };
    });
  }

  async ack(channelId: string, stepId: string, a: CmdStepAckRequest) {
    return this.db.tx(async (q) => {
      if (!(await this.lock(q, channelId)))
        throw new CommandsError(404, 'step_not_found');
      const now = this.clock.now();
      await this.sweep(q, channelId, now);
      const cur = (
        await q.query<StepRow>(
          'select * from cmd_steps where step_id = $1 and channel_id = $2 for update',
          [stepId, channelId],
        )
      )[0];
      if (!cur) throw new CommandsError(404, 'step_not_found');
      const final = FINAL.includes(cur.status);
      // An older attempt (or another executor) never changes the step — final or not.
      if (
        cur.attempt_id !== a.attempt_id ||
        cur.executor_id !== a.executor_id
      ) {
        if (final && (await this.wasFinalAttempt(q, cur, a)))
          return { step: stepView(cur), replayed: true };
        // Late proof of a send already marked unknown (lease over): recorded, still never resent.
        if (
          cur.status === 'unknown' &&
          a.event === 'succeeded' &&
          (await this.lastAttempt(q, cur)) === a.attempt_id
        ) {
          const rows = await q.query<StepRow>(
            `update cmd_steps set status = 'succeeded', error = null, twitch_message_id = $2, updated_at = $3
             where step_id = $1 returning *`,
            [cur.step_id, a.twitch_message_id ?? null, now],
          );
          return { step: stepView(rows[0]!), replayed: false };
        }
        throw new CommandsError(409, 'stale_attempt', {
          status: cur.status,
        });
      }
      const set = async (
        status: StepStatus,
        extra: { error?: StepError | null; twitch?: string | null } = {},
      ) => {
        const done = FINAL.includes(status);
        const rows = await q.query<StepRow>(
          `update cmd_steps set status = $2, error = $3, twitch_message_id = coalesce($4, twitch_message_id),
             updated_at = $5, finished_at = case when $6 then $5::timestamptz else finished_at end,
             attempt_id = case when $6 or $2 = 'queued' then null else attempt_id end,
             lease_expires_at = case when $6 or $2 = 'queued' then null else lease_expires_at end,
             last_attempt_id = case when $6 then attempt_id else last_attempt_id end
           where step_id = $1 returning *`,
          [
            cur.step_id,
            status,
            extra.error ? JSON.stringify(extra.error) : null,
            extra.twitch ?? null,
            now,
            done,
          ],
        );
        if (done && status !== 'succeeded') await this.cascade(q, cur, now);
        return rows[0]!;
      };
      let row: StepRow;
      switch (a.event) {
        case 'running':
          if (cur.status === 'running')
            return { step: stepView(cur), replayed: true };
          if (cur.status !== 'claimed') throw invalid(cur.status, a.event);
          // Too old to be worth sending: the executor sends only a step answered `running`.
          if (new Date(cur.expires_at) <= now) {
            row = await set('expired', {
              error: { code: 'expired', message: 'expired before the send' },
            });
            break;
          }
          row = (
            await q.query<StepRow>(
              `update cmd_steps set status = 'running', started_at = $2, lease_expires_at = $3, updated_at = $2
               where step_id = $1 returning *`,
              [
                cur.step_id,
                now,
                new Date(now.getTime() + this.rules.sendLeaseMs),
              ],
            )
          )[0]!;
          break;
        case 'succeeded':
          if (cur.status !== 'running') throw invalid(cur.status, a.event);
          row = await set('succeeded', { twitch: a.twitch_message_id ?? null });
          break;
        case 'unknown':
          if (cur.status !== 'claimed' && cur.status !== 'running')
            throw invalid(cur.status, a.event);
          row = await set('unknown', {
            error: a.error ?? {
              code: 'execution_unknown',
              message: 'the send may have happened: never retried',
            },
          });
          break;
        case 'failed': {
          if (cur.status !== 'claimed' && cur.status !== 'running')
            throw invalid(cur.status, a.event);
          const error = a.error ?? {
            code: 'failed',
            message: 'the executor reported a failure',
            retryable: false,
          };
          const delay = Math.min(
            this.rules.backoffMaxMs,
            Math.max(
              error.retry_after_ms ?? 0,
              this.rules.backoffBaseMs * 2 ** (cur.attempt_count - 1),
            ),
          );
          const at = new Date(now.getTime() + delay);
          if (
            error.retryable &&
            cur.attempt_count < this.rules.maxAttempts &&
            at < new Date(cur.expires_at)
          ) {
            await set('queued', { error });
            row = (
              await q.query<StepRow>(
                `update cmd_steps set available_at = $2, executor_id = null where step_id = $1 returning *`,
                [cur.step_id, at],
              )
            )[0]!;
          } else row = await set('failed', { error });
          break;
        }
      }
      return { step: stepView(row), replayed: false };
    });
  }

  /** Debug / diagnostic: the steps of the channel, newest first. Team only. */
  async list(
    channelId: string,
    reader: Actor,
    opts: {
      status?: StepStatus | null;
      invocationId?: string | null;
      limit: number;
    },
  ) {
    return this.db.tx(async (q) => {
      if ((await access(q, channelId, reader)).role === 'viewer')
        throw new CommandsError(403, 'team_only', { role: 'viewer' });
      const rows = await q.query<StepRow>(
        `select * from cmd_steps where channel_id = $1 and ($2::text is null or status = $2)
           and ($3::uuid is null or invocation_id = $3)
         order by seq_global desc limit $4`,
        [channelId, opts.status ?? null, opts.invocationId ?? null, opts.limit],
      );
      const counts = await q.query<{ status: StepStatus; n: number }>(
        'select status, count(*)::int as n from cmd_steps where channel_id = $1 group by status',
        [channelId],
      );
      return {
        output: await this.outputOf(q, channelId),
        counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
        steps: rows.map(stepView),
      };
    });
  }

  // --- helpers -------------------------------------------------------------------------------------

  private async lock(q: Queryable, channelId: string) {
    return (
      await q.query<{ chat_output: boolean }>(
        'select chat_output from cmd_channels where channel_id = $1 for update',
        [channelId],
      )
    )[0];
  }

  private async outputOf(q: Queryable, channelId: string) {
    return (
      (
        await q.query<{ chat_output: boolean }>(
          'select chat_output from cmd_channels where channel_id = $1',
          [channelId],
        )
      )[0]?.chat_output ?? false
    );
  }

  /** The ACK replays the event that closed the step with this very attempt: idempotent answer. */
  private async lastAttempt(q: Queryable, cur: StepRow) {
    return (
      await q.query<{ last_attempt_id: string | null }>(
        'select last_attempt_id from cmd_steps where step_id = $1',
        [cur.step_id],
      )
    )[0]?.last_attempt_id;
  }

  private async wasFinalAttempt(
    q: Queryable,
    cur: StepRow,
    a: CmdStepAckRequest,
  ) {
    return (
      (await this.lastAttempt(q, cur)) === a.attempt_id &&
      ((a.event === 'succeeded' && cur.status === 'succeeded') ||
        (a.event === 'unknown' && cur.status === 'unknown') ||
        (a.event === 'failed' && cur.status === 'failed'))
    );
  }

  /** A failed / unknown / expired step with on_error = stop cancels the rest of its invocation. */
  private async cascade(
    q: Queryable,
    s: Pick<StepRow, 'invocation_id' | 'seq' | 'on_error'>,
    now: Date,
  ) {
    if (s.on_error !== 'stop') return;
    await q.query(
      `update cmd_steps set status = 'cancelled', updated_at = $3, finished_at = $3,
         error = '{"code":"previous_step_failed","message":"an earlier step of this invocation did not succeed"}'::jsonb
       where invocation_id = $1 and seq > $2 and status = 'queued'`,
      [s.invocation_id, s.seq, now],
    );
  }

  /**
   * Abandoned or stale work, never turned into a success:
   * - queued past its expiry → expired (never sent);
   * - claimed (never confirmed running: certainly not sent), lease over → queued again (or expired);
   * - running, lease over, no final ACK → unknown (it may have been sent: never retried).
   */
  private async sweep(q: Queryable, channelId: string, now: Date) {
    const expired = await q.query<StepRow>(
      `update cmd_steps set status = 'expired', updated_at = $2, finished_at = $2,
         attempt_id = null, lease_expires_at = null,
         error = '{"code":"expired","message":"not sent before its expiry"}'::jsonb
       where channel_id = $1 and (status = 'queued' or (status = 'claimed' and lease_expires_at < $2))
         and expires_at <= $2
       returning *`,
      [channelId, now],
    );
    await q.query(
      `update cmd_steps set status = 'queued', updated_at = $2, attempt_id = null, lease_expires_at = null,
         executor_id = null,
         error = '{"code":"claim_lease_expired","message":"claimed but never started: not sent","retryable":true}'::jsonb
       where channel_id = $1 and status = 'claimed' and lease_expires_at < $2`,
      [channelId, now],
    );
    const unknown = await q.query<StepRow>(
      `update cmd_steps set status = 'unknown', updated_at = $2, finished_at = $2,
         last_attempt_id = attempt_id, attempt_id = null, lease_expires_at = null,
         error = '{"code":"send_lease_expired","message":"no outcome before the lease ended: may have been sent, never retried"}'::jsonb
       where channel_id = $1 and status = 'running' and lease_expires_at < $2
       returning *`,
      [channelId, now],
    );
    for (const s of [...expired, ...unknown]) await this.cascade(q, s, now);
  }
}

const invalid = (from: StepStatus, event: string) =>
  new CommandsError(409, 'invalid_transition', { from, event });
