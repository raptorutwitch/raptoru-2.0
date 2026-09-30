import { createHash, randomUUID } from 'node:crypto';
import type {
  TtsLabAckRequest,
  TtsLabAdmitRequest,
  TtsLabAdmitResponse,
  TtsLabError,
  TtsLabHeartbeat,
  TtsLabInteraction,
  TtsLabModerationRequest,
  TtsLabModuleState,
  TtsLabQueueInfo,
  TtsLabStatus,
  TtsLabViewerState,
} from '@raptoru/schemas';
import type { LabModerationCommand } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import {
  activeBlock,
  actorName,
  assertAllowed,
  audit,
  clearBlock,
  debit,
  setBlock,
  refundDebit,
  SYSTEM,
  type Actor,
  type LabRole,
} from '../lab-moderation/store.js';
import type { Db, Queryable } from '../db/db.js';
import { pickCast, VOICE_RATES } from './cast.js';
import {
  DEFAULT_TTS_RULES,
  editableRules,
  overrideFromEditable,
  TTS_RULE_LIMITS,
  validateEditableRules,
  type EditableTtsRules,
  estimateDurationMs,
  normalizeMessage,
  publicRules,
  quote,
  resolveTtsRules,
  type TtsRules,
} from './rules.js';

// TTS V2, Lab slice. Same contract family as the Bonk / Soundboard Labs: Core owns validation,
// pricing, the cast, the authoritative interaction, its durable order and its status; Studio only
// plays and acknowledges. Test only: the payment is a simulated snapshot (real_debited = 0) with a
// traced, at-most-once refund. This module imports nothing from Wallet, Loyalty or stats.
//
// Legacy guarantees kept: server validation, atomic admission, durable queue, capacity checked
// before any payment, cooldown started at the real audio start, one attempt per TTS (never replayed),
// automatic refund when a paid TTS can never be read, no refund twice.

export class TtsLabError409 extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
/** Studio or its player not ready: refused before admission (nothing stored, nothing paid). */
export class TtsLabUnavailableError extends Error {
  constructor(readonly code: 'studio_offline' | 'player_offline') {
    super(code);
  }
}
export class TtsLabNotFoundError extends Error {}

/** Future lexical moderation: `review` is accepted but flagged, `reject` refuses before payment. */
export type TtsMessageFilter = (
  text: string,
) => { verdict: 'ok' } | { verdict: 'reject'; code: string; message: string };

const SIMULATED_CURRENCY = { tokens: 'jetons_lab', credits: 'credits_tts_lab' };
const OPEN: TtsLabStatus[] = ['queued', 'starting', 'playing'];
const TERMINAL: TtsLabStatus[] = [
  'completed',
  'failed',
  'execution_unknown',
  'cancelled',
];

interface Row {
  interaction_id: string;
  idempotency_key: string;
  request_hash: string;
  channel_id: string;
  viewer_id: string;
  viewer_display_name: string;
  message: string;
  length: number;
  tier_id: string;
  character_id: string;
  voice_profile_id: string;
  voice_category: 'normal' | 'japanese' | 'variant';
  estimated_duration_ms: number;
  estimated_weight: number;
  cooldown_seconds: number;
  created_at: Date;
  channel_sequence: number | string;
  payment_method: 'tokens' | 'credits';
  simulated_cost: number;
  simulated_currency: string;
  refund_status: 'none' | 'refunded';
  refunded_at: Date | null;
  status: TtsLabStatus;
  lab_session_id: string;
  expires_at: Date;
  error: TtsLabError | null;
  studio_instance_id: string | null;
  attempt_id: string | null;
  lease_expires_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
}

const SELECT = `select i.*, d.studio_instance_id, d.attempt_id, d.lease_expires_at, d.started_at, d.completed_at
  from tts_lab_interactions i left join tts_lab_deliveries d using (interaction_id)`;
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const err = (code: string, message: string): TtsLabError => ({
  code,
  message,
  retryable: false,
});

function toInteraction(r: Row): TtsLabInteraction {
  return {
    interaction_id: r.interaction_id,
    idempotency_key: r.idempotency_key,
    source: 'extension_lab',
    channel_id: r.channel_id,
    viewer_id: r.viewer_id,
    viewer_display_name: r.viewer_display_name,
    type: 'tts',
    message: r.message,
    length: r.length,
    tier_id: r.tier_id,
    cast: {
      character_id: r.character_id,
      voice_profile_id: r.voice_profile_id,
      voice_category: r.voice_category,
    },
    estimated_duration_ms: r.estimated_duration_ms,
    estimated_weight: r.estimated_weight,
    cooldown_seconds: r.cooldown_seconds,
    created_at: iso(r.created_at)!,
    channel_sequence: Number(r.channel_sequence),
    test_mode: true,
    payment_mode: 'simulated',
    payment_method: r.payment_method,
    simulated_cost: r.simulated_cost,
    simulated_currency: r.simulated_currency,
    real_debited: 0,
    refund_status: r.refund_status,
    refunded_at: iso(r.refunded_at),
    status: r.status,
    lab_session_id: r.lab_session_id,
    expires_at: iso(r.expires_at)!,
    error: r.error,
    delivery: {
      studio_instance_id: r.studio_instance_id,
      attempt_id: r.attempt_id,
      lease_expires_at: iso(r.lease_expires_at),
      started_at: iso(r.started_at),
      completed_at: iso(r.completed_at),
    },
  };
}

export class TtsLabService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** Injectable for tests (cast draw). */
    private readonly random: () => number = Math.random,
    private readonly filter: TtsMessageFilter = () => ({ verdict: 'ok' }),
  ) {}

  // --- settings --------------------------------------------------------------------------------------

  private async settingsRow(q: Queryable) {
    await q.query(
      `insert into tts_lab_settings (id, module_state, rules, updated_at) values (true, 'active', null, $1)
       on conflict (id) do nothing`,
      [this.clock.now()],
    );
    const row = (
      await q.query<{ module_state: TtsLabModuleState; rules: unknown }>(
        'select module_state, rules from tts_lab_settings where id',
      )
    )[0]!;
    return { moduleState: row.module_state, rules: resolveTtsRules(row.rules) };
  }

  /** Public rules + module state (extension quote, Studio panel). */
  async publicConfig() {
    const s = await this.settingsRow(this.db);
    return { module_state: s.moduleState, rules: publicRules(s.rules) };
  }

  // --- readiness ---------------------------------------------------------------------------------------

  async heartbeat(h: TtsLabHeartbeat) {
    await this.db.query(
      `insert into tts_lab_studios (studio_instance_id, player_ready, last_seen) values ($1, $2, $3)
       on conflict (studio_instance_id) do update set player_ready = excluded.player_ready, last_seen = excluded.last_seen`,
      [h.studio_instance_id, h.player_ready, this.clock.now()],
    );
    const s = await this.settingsRow(this.db);
    return {
      ok: true as const,
      module_state: s.moduleState,
      rules: { transition_gap_ms: s.rules.transition_gap_ms },
    };
  }

  private async playerState(
    q: Queryable,
    rules: TtsRules,
    studioId: string | null = null,
  ) {
    const since = new Date(
      this.clock.now().getTime() - rules.heartbeat_fresh_ms,
    );
    const studio = (
      await q.query<{ player_ready: boolean }>(
        'select player_ready from tts_lab_studios where last_seen >= $1 and ($2::text is null or studio_instance_id = $2) order by last_seen desc limit 1',
        [since, studioId],
      )
    )[0];
    return !studio
      ? 'studio_offline'
      : studio.player_ready
        ? 'ready'
        : 'player_offline';
  }

  // --- admission ---------------------------------------------------------------------------------------

  async admit(req: TtsLabAdmitRequest): Promise<TtsLabAdmitResponse> {
    const { text, length } = normalizeMessage(req.text);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify(['tts', text, req.payment_method, req.lab_session_id]),
      )
      .digest('hex');
    return this.db.tx(async (q) => {
      // Channel row lock: serializes admissions (sequence, capacity, per-viewer rules, last character).
      await q.query(
        'insert into tts_lab_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
        [req.channel_id],
      );
      const channel = (
        await q.query<{ last_character_id: string | null }>(
          'select last_character_id from tts_lab_channels where channel_id = $1 for update',
          [req.channel_id],
        )
      )[0]!;
      // Idempotency first: a retry (double click, network retry, refresh) returns the same TTS.
      const prior = (
        await q.query<Row>(
          `${SELECT} where i.channel_id = $1 and i.viewer_id = $2 and i.idempotency_key = $3`,
          [req.channel_id, req.viewer.id, req.idempotency_key],
        )
      )[0];
      if (prior) {
        if (prior.request_hash !== requestHash)
          throw new TtsLabError409(
            'idempotency_conflict',
            'idempotency key already used for another message',
          );
        const { rules } = await this.settingsRow(q);
        return {
          interaction: toInteraction(prior),
          queue: await this.queueInfo(q, req.channel_id, prior, rules),
          replayed: true,
        };
      }
      const { moduleState, rules } = await this.settingsRow(q);
      // Everything below refuses BEFORE any payment is recorded (nothing is stored on refusal).
      if (moduleState === 'disabled')
        throw new TtsLabError409('tts_disabled', 'TTS disabled');
      if (moduleState === 'paused')
        throw new TtsLabError409('tts_paused', 'TTS paused by moderation');
      if (!length) throw new TtsLabError409('empty_message', 'empty message');
      if (length > rules.max_chars)
        throw new TtsLabError409('message_too_long', 'message too long', {
          max_chars: rules.max_chars,
        });
      if (!/[\p{L}\p{N}]/u.test(text))
        throw new TtsLabError409('message_unreadable', 'nothing to read');
      const filtered = this.filter(text);
      if (filtered.verdict === 'reject')
        throw new TtsLabError409(filtered.code, filtered.message);

      await this.sweep(q, req.channel_id);
      const now = this.clock.now();
      const viewer = (
        await q.query<{
          blocked: boolean;
          blocked_until: Date | null;
          cooldown_until: Date | null;
        }>(
          'select blocked, blocked_until, cooldown_until from tts_lab_viewers where channel_id = $1 and viewer_id = $2',
          [req.channel_id, req.viewer.id],
        )
      )[0];
      if (
        (viewer?.blocked &&
          (!viewer.blocked_until || viewer.blocked_until > now)) ||
        (await activeBlock(q, req.channel_id, req.viewer.id, 'tts', now))
      )
        throw new TtsLabError409(
          'viewer_blocked',
          'TTS unavailable for this viewer',
        );
      if (viewer?.cooldown_until && viewer.cooldown_until > now)
        throw new TtsLabError409('viewer_cooldown', 'cooldown active', {
          retry_after_ms: viewer.cooldown_until.getTime() - now.getTime(),
        });
      const mine = (
        await q.query<{ n: string }>(
          `select count(*) as n from tts_lab_interactions where channel_id = $1 and viewer_id = $2 and status = any($3)`,
          [req.channel_id, req.viewer.id, OPEN],
        )
      )[0]!;
      if (Number(mine.n) >= rules.max_per_viewer)
        throw new TtsLabError409(
          'viewer_busy',
          'your previous TTS is still waiting or playing',
        );
      const player = await this.playerState(q, rules);
      if (player !== 'ready') throw new TtsLabUnavailableError(player);
      const waiting = (
        await q.query<{ n: string; w: string | null }>(
          `select count(*) as n, sum(estimated_weight) as w from tts_lab_interactions
           where channel_id = $1 and status in ('queued', 'starting')`,
          [req.channel_id],
        )
      )[0]!;
      const q0 = quote(length, rules);
      const cast = pickCast(
        length,
        rules,
        this.random,
        channel.last_character_id,
      );
      const duration = estimateDurationMs(
        length,
        VOICE_RATES[cast.voice_profile_id] ?? 1,
        rules,
      );
      if (Number(waiting.n) >= rules.max_waiting_global)
        throw new TtsLabError409('queue_full', 'TTS queue full', {
          max_waiting: rules.max_waiting_global,
        });
      if (
        rules.max_waiting_weight_ms !== null &&
        Number(waiting.w ?? 0) + duration > rules.max_waiting_weight_ms
      )
        throw new TtsLabError409('queue_full', 'TTS queue full (duration)', {
          max_waiting_weight_ms: rules.max_waiting_weight_ms,
        });

      const seq = (
        await q.query<{ last_sequence: string }>(
          'update tts_lab_channels set last_sequence = last_sequence + 1, last_character_id = $2 where channel_id = $1 returning last_sequence',
          [req.channel_id, cast.character_id],
        )
      )[0]!.last_sequence;
      const id = randomUUID();
      // Payment (simulated) and admission are one transaction: queued ⇔ paid, never one without the other.
      await q.query(
        `insert into tts_lab_interactions (interaction_id, idempotency_key, request_hash, source, channel_id, viewer_id,
           viewer_display_name, type, message, length, tier_id, character_id, voice_profile_id, voice_category,
           estimated_duration_ms, estimated_weight, cooldown_seconds, created_at, channel_sequence, test_mode, payment_mode,
           payment_method, simulated_cost, simulated_currency, real_debited, refund_status, status, lab_session_id,
           expires_at, error, updated_at)
         values ($1, $2, $3, 'extension_lab', $4, $5, $6, 'tts', $7, $8, $9, $10, $11, $12, $13, $13, $14, $15, $16,
           true, 'simulated', $17, $18, $19, 0, 'none', 'queued', $20, $21, null, $15)`,
        [
          id,
          req.idempotency_key,
          requestHash,
          req.channel_id,
          req.viewer.id,
          req.viewer.display_name,
          text,
          length,
          q0.tier_id,
          cast.character_id,
          cast.voice_profile_id,
          cast.voice_category,
          duration,
          q0.cooldown_seconds,
          now,
          Number(seq),
          req.payment_method,
          req.payment_method === 'credits' ? q0.credit_cost : q0.price,
          SIMULATED_CURRENCY[req.payment_method],
          req.lab_session_id,
          new Date(now.getTime() + rules.expires_after_ms),
        ],
      );
      // Lab test wallet: debited in the same transaction (refused → nothing admitted, nothing stored).
      await debit(q, now, {
        channelId: req.channel_id,
        viewerId: req.viewer.id,
        currency: req.payment_method === 'credits' ? 'credits_tts' : 'tokens',
        amount: req.payment_method === 'credits' ? q0.credit_cost : q0.price,
        module: 'tts',
        interactionId: id,
      });
      const row = (await this.row(q, id))!;
      return {
        interaction: toInteraction(row),
        queue: await this.queueInfo(q, req.channel_id, row, rules),
        replayed: false,
      };
    });
  }

  // --- queue view ----------------------------------------------------------------------------------------

  private async openRows(q: Queryable, channelId: string) {
    return q.query<Row>(
      `${SELECT} where i.channel_id = $1 and i.status = any($2) order by i.channel_sequence`,
      [channelId, OPEN],
    );
  }

  /** Remaining time of what is in flight + estimates of everything queued ahead, + breathing gaps. */
  private async queueInfo(
    q: Queryable,
    channelId: string,
    row: Row,
    rules: TtsRules,
  ): Promise<TtsLabQueueInfo> {
    if (row.status !== 'queued') return { position: null, wait_ms: null };
    const open = await this.openRows(q, channelId);
    const now = this.clock.now().getTime();
    let wait = 0;
    let ahead = 0;
    for (const r of open) {
      if (r.interaction_id === row.interaction_id) break;
      ahead += 1;
      const elapsed =
        r.status === 'playing' && r.started_at
          ? now - new Date(r.started_at).getTime()
          : 0;
      wait +=
        Math.max(0, r.estimated_weight - elapsed) + rules.transition_gap_ms;
    }
    return { position: ahead + 1, wait_ms: wait };
  }

  /** What the extension needs before and after buying (availability, cooldown, own current TTS). */
  async viewerState(
    channelId: string,
    viewerId: string,
  ): Promise<TtsLabViewerState> {
    return this.db.tx(async (q) => {
      await q.query(
        'insert into tts_lab_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
        [channelId],
      );
      await q.query(
        'select 1 from tts_lab_channels where channel_id = $1 for update',
        [channelId],
      );
      const { moduleState, rules } = await this.settingsRow(q);
      await this.sweep(q, channelId);
      const now = this.clock.now();
      const open = await this.openRows(q, channelId);
      const waiting = open.filter(
        (r) => r.status === 'queued' || r.status === 'starting',
      );
      const viewer = (
        await q.query<{
          blocked: boolean;
          blocked_until: Date | null;
          cooldown_until: Date | null;
        }>(
          'select blocked, blocked_until, cooldown_until from tts_lab_viewers where channel_id = $1 and viewer_id = $2',
          [channelId, viewerId],
        )
      )[0];
      const latest = (
        await q.query<Row>(
          `${SELECT} where i.channel_id = $1 and i.viewer_id = $2 order by i.created_at desc limit 1`,
          [channelId, viewerId],
        )
      )[0];
      let wait = 0;
      for (const r of open) {
        const elapsed =
          r.status === 'playing' && r.started_at
            ? now.getTime() - new Date(r.started_at).getTime()
            : 0;
        wait +=
          Math.max(0, r.estimated_weight - elapsed) + rules.transition_gap_ms;
      }
      const waitingWeight = waiting.reduce((s, r) => s + r.estimated_weight, 0);
      return {
        module_state: moduleState,
        player_offline: (await this.playerState(q, rules)) !== 'ready',
        queue_full:
          waiting.length >= rules.max_waiting_global ||
          (rules.max_waiting_weight_ms !== null &&
            waitingWeight >= rules.max_waiting_weight_ms),
        blocked:
          (!!viewer?.blocked &&
            (!viewer.blocked_until || viewer.blocked_until > now)) ||
          !!(await activeBlock(q, channelId, viewerId, 'tts', now)),
        // Busy = as many open TTS as the configured limit per viewer (legacy: 1).
        viewer_busy:
          open.filter((r) => r.viewer_id === viewerId).length >=
          rules.max_per_viewer,
        cooldown_remaining_ms: viewer?.cooldown_until
          ? Math.max(0, viewer.cooldown_until.getTime() - now.getTime())
          : 0,
        queue_length: open.length,
        queue_wait_ms: wait,
        current: latest
          ? {
              interaction: toInteraction(latest),
              queue: await this.queueInfo(q, channelId, latest, rules),
            }
          : null,
      };
    });
  }

  /** Queue inspection (Studio panel / future moderation): in flight, waiting, recent history. */
  async queue(channelId: string) {
    const { moduleState, rules } = await this.settingsRow(this.db);
    const state = await this.viewerState(channelId, '0');
    const open = (await this.openRows(this.db, channelId)).map(toInteraction);
    const recent = (
      await this.db.query<Row>(
        `${SELECT} where i.channel_id = $1 order by i.channel_sequence desc limit 20`,
        [channelId],
      )
    ).map(toInteraction);
    return {
      module_state: moduleState,
      player_offline: state.player_offline,
      queue_full: state.queue_full,
      current:
        open.find((i) => i.status === 'starting' || i.status === 'playing') ??
        null,
      waiting: open.filter((i) => i.status === 'queued'),
      wait_ms: state.queue_wait_ms,
      recent,
      rules: publicRules(rules),
    };
  }

  async get(interactionId: string): Promise<TtsLabInteraction> {
    const row = await this.row(this.db, interactionId);
    if (!row) throw new TtsLabNotFoundError(interactionId);
    return toInteraction(row);
  }

  // --- execution (Studio worker) ---------------------------------------------------------------------------

  /** Next TTS to read, strictly one at a time and in order. Paused / disabled: nothing is handed out. */
  async claim(
    studioInstanceId: string,
    channelId: string,
  ): Promise<TtsLabInteraction | null> {
    return this.db.tx(async (q) => {
      await q.query(
        'insert into tts_lab_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
        [channelId],
      );
      await q.query(
        'select 1 from tts_lab_channels where channel_id = $1 for update',
        [channelId],
      );
      const { moduleState, rules } = await this.settingsRow(q);
      await this.sweep(q, channelId);
      if (moduleState !== 'active') return null;
      if ((await this.playerState(q, rules, studioInstanceId)) !== 'ready')
        return null;
      const open = await this.openRows(q, channelId);
      if (open.some((r) => r.status === 'starting' || r.status === 'playing'))
        return null;
      const next = open.find((r) => r.status === 'queued');
      if (!next) return null;
      const now = this.clock.now();
      await q.query(
        `insert into tts_lab_deliveries (interaction_id, studio_instance_id, attempt_id, lease_expires_at) values ($1, $2, $3, $4)`,
        [
          next.interaction_id,
          studioInstanceId,
          randomUUID(),
          new Date(now.getTime() + rules.claim_lease_ms),
        ],
      );
      await q.query(
        `update tts_lab_interactions set status = 'starting', updated_at = $2 where interaction_id = $1`,
        [next.interaction_id, now],
      );
      return toInteraction((await this.row(q, next.interaction_id))!);
    });
  }

  /** Player outcome for the current attempt. Idempotent; never regresses a final state. */
  async ack(
    interactionId: string,
    a: TtsLabAckRequest,
  ): Promise<TtsLabInteraction> {
    return this.db.tx(async (q) => {
      const channel = (
        await q.query<{ channel_id: string }>(
          'select channel_id from tts_lab_interactions where interaction_id = $1',
          [interactionId],
        )
      )[0];
      if (!channel) throw new TtsLabNotFoundError(interactionId);
      await q.query(
        'select 1 from tts_lab_channels where channel_id = $1 for update',
        [channel.channel_id],
      );
      await q.query(
        'select 1 from tts_lab_interactions where interaction_id = $1 for update',
        [interactionId],
      );
      const cur = (await this.row(q, interactionId))!;
      if (
        cur.attempt_id !== a.attempt_id ||
        cur.studio_instance_id !== a.studio_instance_id
      )
        throw new TtsLabError409(
          'attempt_mismatch',
          'this attempt does not own the interaction',
        );
      const { rules } = await this.settingsRow(q);
      const now = this.clock.now();
      const set = (status: TtsLabStatus, error: TtsLabError | null) =>
        q.query(
          'update tts_lab_interactions set status = $2, error = $3, updated_at = $4 where interaction_id = $1',
          [interactionId, status, error ? JSON.stringify(error) : null, now],
        );
      // Cancelled by moderation meanwhile: the player's late ACKs are accepted and ignored.
      if (cur.status === 'cancelled') return toInteraction(cur);
      const invalid = (what: string) =>
        new TtsLabError409(
          'invalid_transition',
          `cannot ${what} from ${cur.status}`,
        );
      switch (a.event) {
        case 'started':
          if (cur.started_at !== null) break;
          if (cur.status !== 'starting') throw invalid('start');
          await q.query(
            'update tts_lab_deliveries set started_at = $2, lease_expires_at = $3 where interaction_id = $1',
            [
              interactionId,
              now,
              new Date(
                now.getTime() +
                  cur.estimated_duration_ms * rules.playing_lease_factor +
                  rules.playing_lease_margin_ms,
              ),
            ],
          );
          await set('playing', null);
          // Cooldown starts at the real audio start (legacy onstart), not at the purchase.
          await q.query(
            `insert into tts_lab_viewers (channel_id, viewer_id, cooldown_until, updated_at) values ($1, $2, $3, $4)
             on conflict (channel_id, viewer_id) do update set cooldown_until = excluded.cooldown_until, updated_at = excluded.updated_at`,
            [
              cur.channel_id,
              cur.viewer_id,
              new Date(now.getTime() + cur.cooldown_seconds * 1000),
              now,
            ],
          );
          break;
        case 'completed':
          if (cur.status === 'completed') break;
          if (cur.status !== 'playing') throw invalid('complete');
          await q.query(
            'update tts_lab_deliveries set completed_at = $2 where interaction_id = $1',
            [interactionId, now],
          );
          await set('completed', null);
          break;
        case 'failed':
          if (TERMINAL.includes(cur.status)) break;
          await set(
            'failed',
            err(
              a.error?.code ?? 'playback_failed',
              a.error?.message ?? 'the player reported a failure',
            ),
          );
          // Never started (voice missing, player error before audio): it can never be read → refund.
          if (cur.started_at === null)
            await this.refund(q, interactionId, SYSTEM, 'failed_before_start');
          break;
        case 'execution_unknown':
          if (TERMINAL.includes(cur.status)) break;
          await set(
            'execution_unknown',
            err(
              a.error?.code ?? 'execution_unknown',
              a.error?.message ?? 'outcome not provable',
            ),
          );
          break;
      }
      return toInteraction((await this.row(q, interactionId))!);
    });
  }

  // --- refunds & moderation --------------------------------------------------------------------------------

  /**
   * At most once (conditional update + unique ledger entry): the interaction becomes « refunded »
   * and the Lab test wallet gets back exactly what was debited for it. Audited.
   */
  private async refund(
    q: Queryable,
    interactionId: string,
    actor: Actor,
    reason: string,
    role?: LabRole,
  ): Promise<boolean> {
    const now = this.clock.now();
    const done = await q.query<{
      channel_id: string;
      viewer_id: string;
      simulated_cost: number;
      payment_method: string;
    }>(
      `update tts_lab_interactions set refund_status = 'refunded', refunded_at = $2, updated_at = $2
       where interaction_id = $1 and refund_status = 'none' returning channel_id, viewer_id, simulated_cost, payment_method`,
      [interactionId, now],
    );
    if (!done.length) return false;
    const back = await refundDebit(
      q,
      now,
      interactionId,
      actorName(actor),
      reason,
    );
    await audit(q, now, {
      channelId: done[0]!.channel_id,
      actor,
      role,
      module: 'tts',
      action: 'refund',
      viewerId: done[0]!.viewer_id,
      interactionId,
      reason,
      before: { refund_status: 'none' },
      after: {
        refund_status: 'refunded',
        amount: back.amount,
        currency: back.currency,
      },
    });
    return true;
  }

  /** Unified audit trail (every module), most recent first. */
  async auditTrail(channelId: string, limit = 50) {
    return this.db.query(
      `select id, created_at, actor, role, module_id, action, viewer_id, interaction_id, reason, before, after
       from lab_moderation_audit where channel_id = $1 order by id desc limit $2`,
      [channelId, limit],
    );
  }

  /** Legacy entry (Studio TTS card / extension pause): same code path as Moderation V2. */
  async moderate(channelId: string, m: TtsLabModerationRequest) {
    const actor: Actor = { id: m.actor, role: 'broadcaster', via: 'studio' };
    const cmd: LabModerationCommand =
      m.action === 'pause' || m.action === 'resume' || m.action === 'disable'
        ? {
            action: 'module_state',
            module: 'tts',
            state:
              m.action === 'pause'
                ? 'paused'
                : m.action === 'disable'
                  ? 'disabled'
                  : 'active',
            waiting: 'keep',
          }
        : m.action === 'stop_current'
          ? { action: 'stop_current', module: 'tts', refund: m.refund }
          : m.action === 'purge'
            ? { action: 'purge', module: 'tts', refund: m.refund }
            : m.action === 'cancel'
              ? {
                  action: 'cancel',
                  module: 'tts',
                  interaction_id: m.interaction_id,
                  refund: m.refund,
                }
              : m.action === 'refund'
                ? {
                    action: 'refund',
                    module: 'tts',
                    interaction_id: m.interaction_id,
                  }
                : m.action === 'block_viewer'
                  ? {
                      action: 'block_viewer',
                      viewer_id: m.viewer_id,
                      module: 'tts',
                      duration_s: m.until
                        ? Math.max(
                            1,
                            Math.round(
                              (Date.parse(m.until) -
                                this.clock.now().getTime()) /
                                1000,
                            ),
                          )
                        : null,
                    }
                  : m.action === 'unblock_viewer'
                    ? {
                        action: 'unblock_viewer',
                        viewer_id: m.viewer_id,
                        module: 'tts',
                      }
                    : m.until
                      ? {
                          action: 'viewer_cooldown',
                          viewer_id: m.viewer_id,
                          module: 'tts',
                          mode: 'replace',
                          seconds: Math.max(
                            0,
                            Math.round(
                              (Date.parse(m.until) -
                                this.clock.now().getTime()) /
                                1000,
                            ),
                          ),
                        }
                      : {
                          action: 'viewer_cooldown',
                          viewer_id: m.viewer_id,
                          module: 'tts',
                          mode: 'clear',
                          seconds: 0,
                        };
    return this.db.tx((q) =>
      this.applyModeration(q, channelId, cmd, actor, 'broadcaster'),
    );
  }

  /**
   * Moderation V2 commands that belong to the TTS (called inside the moderation transaction, after
   * the permission check). Current (starting / playing) and waiting (queued) are distinct: a purge
   * never touches the TTS being read. Nothing is refunded unless asked (legacy).
   */
  async applyModeration(
    q: Queryable,
    channelId: string,
    cmd: LabModerationCommand,
    actor: Actor,
    role: LabRole,
  ) {
    await q.query(
      'insert into tts_lab_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
      [channelId],
    );
    await q.query(
      'select 1 from tts_lab_channels where channel_id = $1 for update',
      [channelId],
    );
    const { moduleState } = await this.settingsRow(q);
    const now = this.clock.now();
    const reason = 'reason' in cmd ? (cmd.reason ?? null) : null;
    const open = await this.openRows(q, channelId);
    const current = open.filter(
      (r) => r.status === 'starting' || r.status === 'playing',
    );
    const waiting = open.filter((r) => r.status === 'queued');
    const cancel = async (rows: Row[], refund: boolean, code: string) => {
      const out: { interaction_id: string; refunded: boolean }[] = [];
      for (const r of rows) {
        const updated = await q.query(
          `update tts_lab_interactions set status = 'cancelled', error = $2, updated_at = $3 where interaction_id = $1 and status = any($4) returning 1`,
          [
            r.interaction_id,
            JSON.stringify(err(code, 'cancelled by moderation')),
            now,
            OPEN,
          ],
        );
        if (!updated.length) continue;
        const refunded = refund
          ? await this.refund(q, r.interaction_id, actor, code, role)
          : false;
        out.push({ interaction_id: r.interaction_id, refunded });
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'tts',
          action: code === 'stopped_by_moderator' ? 'stop' : 'cancel',
          viewerId: r.viewer_id,
          interactionId: r.interaction_id,
          reason,
          before: { status: r.status },
          after: { status: 'cancelled', refund },
        });
      }
      return out;
    };
    switch (cmd.action) {
      case 'module_state': {
        await q.query(
          'update tts_lab_settings set module_state = $1, updated_at = $2 where id',
          [cmd.state, now],
        );
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'tts',
          action: `module_${cmd.state}`,
          reason,
          before: { state: moduleState },
          after: { state: cmd.state, waiting: cmd.waiting ?? 'keep' },
        });
        const cancelled =
          (cmd.waiting ?? 'keep') === 'keep'
            ? []
            : await cancel(
                waiting,
                cmd.waiting === 'cancel_refund',
                'purged_by_moderator',
              );
        return { ok: true, module_state: cmd.state, cancelled };
      }
      case 'stop_current':
        if (!current.length)
          throw new TtsLabError409('nothing_playing', 'no TTS is being read');
        return {
          ok: true,
          cancelled: await cancel(current, cmd.refund, 'stopped_by_moderator'),
        };
      case 'purge': {
        const cancelled = await cancel(
          waiting,
          cmd.refund,
          'purged_by_moderator',
        );
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'tts',
          action: 'purge',
          reason,
          before: { waiting: waiting.length },
          after: { waiting: 0, refund: cmd.refund, count: cancelled.length },
        });
        return { ok: true, cancelled };
      }
      case 'cancel': {
        const row = open.find((r) => r.interaction_id === cmd.interaction_id);
        if (!row)
          throw new TtsLabError409(
            'not_open',
            'only a waiting or playing TTS can be cancelled',
          );
        const code =
          row.status === 'queued'
            ? 'cancelled_by_moderator'
            : 'stopped_by_moderator';
        return { ok: true, cancelled: await cancel([row], cmd.refund, code) };
      }
      case 'refund': {
        const row = await this.row(q, cmd.interaction_id);
        if (!row || row.channel_id !== channelId)
          throw new TtsLabNotFoundError(cmd.interaction_id);
        if (!TERMINAL.includes(row.status))
          throw new TtsLabError409('not_terminal', 'cancel it first');
        if (
          !(await this.refund(
            q,
            row.interaction_id,
            actor,
            reason ?? 'moderator_refund',
            role,
          ))
        )
          throw new TtsLabError409('already_refunded', 'already refunded');
        return { ok: true, refunded: true };
      }
      case 'viewer_cooldown': {
        const cur = (
          await q.query<{ cooldown_until: Date | null }>(
            'select cooldown_until from tts_lab_viewers where channel_id = $1 and viewer_id = $2',
            [channelId, cmd.viewer_id],
          )
        )[0]?.cooldown_until;
        const base =
          cmd.mode === 'add' && cur && cur > now
            ? cur.getTime()
            : now.getTime();
        const until =
          cmd.mode === 'clear'
            ? null
            : new Date(base + (cmd.seconds ?? 0) * 1000);
        await q.query(
          `insert into tts_lab_viewers (channel_id, viewer_id, cooldown_until, updated_at) values ($1, $2, $3, $4)
           on conflict (channel_id, viewer_id) do update set cooldown_until = excluded.cooldown_until, updated_at = excluded.updated_at`,
          [channelId, cmd.viewer_id, until, now],
        );
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'tts',
          action: `cooldown_${cmd.mode}`,
          viewerId: cmd.viewer_id,
          reason,
          before: { until: cur && cur > now ? cur.toISOString() : null },
          after: { until: until?.toISOString() ?? null },
        });
        return { ok: true, until: until?.toISOString() ?? null };
      }
      case 'block_viewer':
      case 'unblock_viewer': {
        // Legacy entry only (Moderation V2 handles blocks for every module itself).
        const until =
          cmd.action === 'block_viewer' && cmd.duration_s
            ? new Date(now.getTime() + cmd.duration_s * 1000)
            : null;
        const before =
          cmd.action === 'block_viewer'
            ? await setBlock(q, now, {
                channelId,
                viewerId: cmd.viewer_id,
                module: cmd.module,
                until,
                reason,
                actor: actorName(actor),
              })
            : await clearBlock(q, channelId, cmd.viewer_id, cmd.module);
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: cmd.module,
          action: cmd.action,
          viewerId: cmd.viewer_id,
          reason,
          before: { blocked: Boolean(before) },
          after: {
            blocked: cmd.action === 'block_viewer',
            until: until?.toISOString() ?? null,
          },
        });
        return { ok: true };
      }
      default:
        throw new TtsLabError409(
          'unsupported',
          `${cmd.action} is not a TTS command`,
        );
    }
  }

  // --- configuration (Studio: TTS → Configuration) -----------------------------------------------------------

  async rulesView() {
    const { moduleState, rules } = await this.settingsRow(this.db);
    const stored =
      (
        await this.db.query<{ rules: unknown }>(
          'select rules from tts_lab_settings where id',
        )
      )[0]?.rules ?? null;
    return {
      module_state: moduleState,
      rules: editableRules(rules),
      defaults: editableRules(DEFAULT_TTS_RULES),
      customized: stored !== null,
      limits: TTS_RULE_LIMITS,
    };
  }

  /** Validated, stored, audited; the next quote / admission uses it at once (no restart). */
  async updateRules(
    edited: EditableTtsRules,
    actor: Actor,
    reason: string | null,
    reset = false,
  ) {
    const errors = reset ? [] : validateEditableRules(edited);
    if (errors.length)
      throw new TtsLabError409('invalid_rules', errors[0]!, { errors });
    return this.db.tx(async (q) => {
      const role = await assertAllowed(q, '900100', actor, 'config.tts');
      const { rules: before } = await this.settingsRow(q);
      const override = reset ? null : overrideFromEditable(edited);
      await q.query(
        'update tts_lab_settings set rules = $1, updated_at = $2 where id',
        [override === null ? null : JSON.stringify(override), this.clock.now()],
      );
      const { rules: after } = await this.settingsRow(q);
      await audit(q, this.clock.now(), {
        channelId: '900100',
        actor,
        role,
        module: 'tts',
        action: reset ? 'config_reset' : 'config_update',
        reason,
        before: editableRules(before),
        after: editableRules(after),
      });
      return { ok: true, rules: editableRules(after) };
    });
  }

  /** TTS rows for the moderation cockpit: current, waiting (with position / wait) and recent. */
  async moderationQueue(channelId: string) {
    const q0 = await this.queue(channelId);
    const debits = await this.db.query<{ interaction_id: string }>(
      `select interaction_id from lab_wallet_ledger where channel_id = $1 and kind = 'debit' and module_id = 'tts' and created_at > now() - interval '2 days'`,
      [channelId],
    );
    const paid = new Set(debits.map((d) => d.interaction_id));
    const view = (i: TtsLabInteraction) => ({
      ...i,
      paid: paid.has(i.interaction_id),
      refundable: TERMINAL.includes(i.status) && i.refund_status === 'none',
    });
    return {
      ...q0,
      current: q0.current ? view(q0.current) : null,
      waiting: q0.waiting.map(view),
      recent: q0.recent.map(view),
    };
  }

  async viewerInteractions(channelId: string, viewerId: string, limit = 10) {
    return (
      await this.db.query<Row>(
        `${SELECT} where i.channel_id = $1 and i.viewer_id = $2 order by i.created_at desc limit $3`,
        [channelId, viewerId, limit],
      )
    ).map(toInteraction);
  }

  // --- helpers ----------------------------------------------------------------------------------------------

  /**
   * Expired or abandoned work, never turned into a success:
   * - queued, never claimed, past expires_at → failed(expired) + refund (it was never read);
   * - claimed or playing, lease over, no final ACK → execution_unknown (it may have been heard).
   */
  private async sweep(q: Queryable, channelId: string): Promise<void> {
    const now = this.clock.now();
    const expired = await q.query<{ interaction_id: string }>(
      `update tts_lab_interactions i set status = 'failed', updated_at = $2,
         error = '{"code":"expired","message":"not started before expiry","retryable":false}'::jsonb
       where channel_id = $1 and status = 'queued' and expires_at < $2
         and not exists (select 1 from tts_lab_deliveries d where d.interaction_id = i.interaction_id)
       returning interaction_id`,
      [channelId, now],
    );
    for (const e of expired)
      await this.refund(q, e.interaction_id, SYSTEM, 'expired');
    await q.query(
      `update tts_lab_interactions i set status = 'execution_unknown', updated_at = $2,
         error = '{"code":"lease_expired","message":"no player proof before the lease ended","retryable":false}'::jsonb
       from tts_lab_deliveries d
       where d.interaction_id = i.interaction_id and i.channel_id = $1
         and i.status in ('starting', 'playing') and d.lease_expires_at < $2`,
      [channelId, now],
    );
  }

  private async row(q: Queryable, id: string) {
    return (
      (await q.query<Row>(`${SELECT} where i.interaction_id = $1`, [id]))[0] ??
      null
    );
  }

  static isTerminal(status: TtsLabStatus) {
    return TERMINAL.includes(status);
  }
}
