import { randomUUID } from 'node:crypto';
import {
  type CpAckRequest,
  type CpAction,
  CpAction as CpActionSchema,
  type CpActionResult,
  type CpEffectReport,
  type CpRedemptionInput,
  type CpRedemptionStatus,
  type CpRedemptionUpdate,
  type CpRewardsSync,
  type CpRuleInput,
  resolveColorCam,
  type FxCamEffectId,
  resolveFxCam,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import { type EconomyPort, labEconomy } from '../economy/economy.js';
import type { RandomBanService } from '../random-ban/service.js';
import type { SoundLabService } from '../sound-lab/sound-lab-service.js';

// Points de chaîne V1 (docs/CHANNEL_POINTS_V1.md) — the ONE implementation, served to the Lab Core and to the
// production Core (same pattern as the alerts). A Twitch redemption (read only) is recorded once (dedup by its Twitch
// id), checked against the channel's master switch (OFF by default) and the reward's rule, then executed:
// - sound actions: admitted at once into the Soundboard queue (its player, moderation and pause apply), paid by the
//   channel points (no wallet debit);
// - OBS actions: one job for Studio (the only one that talks to OBS), one job in flight per channel, a lease; a job
//   claimed but never started is offered again (3 attempts); a started job is NEVER replayed (expired if its lease ends
//   without a report: it may have run).
// - effect sounds (P0.1): in the same Studio job; Studio hands them to its effects player and reports them « playing »
//   once the player started them (the job ends at once: the next redemption may overlap), then their end through
//   effectReport. No end within CP_RULES.effectEndMs → unknown (never replayed).
// - credits (phase 2 lot 4): Crédits TTS / Soundboard granted in the reception's own transaction, through the runtime
//   economy (key cp:<source>:<redemption>:<index>: once per redemption, even redelivered). Granted for a late
//   redemption too (the viewer's points are spent); a simulation grants nothing. Twitch « canceled » (points given
//   back) takes them back, never below 0 (docs/ECONOMY_MIGRATION.md § 14).
// Raptoru never fulfils or cancels a redemption on Twitch (only the app that created a reward may; docs § 2).

export const CP_RULES = {
  claimLeaseMs: 15_000,
  /** Lease of a running job: its temporary actions' durations plus this margin. */
  runMarginMs: 15_000,
  maxAttempts: 3,
  /** A real redemption older than this at reception is not executed (late after an outage / reconnection). */
  maxAgeMs: 120_000,
  /** An effect reported playing whose end is not reported within this delay is « unknown » (Studio gone…). */
  effectEndMs: 120_000,
} as const;

export class CpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

type Result = {
  index: number;
  type: CpAction['type'];
  status: 'pending' | 'done' | 'failed' | 'unknown';
  error?: string;
  /** Sound actions: the Soundboard interaction, and where it stands until its player reports the end. */
  sound_interaction_id?: string;
  progress?: 'queued' | 'playing';
  /** Effect actions reported playing: their end must be reported before this instant. */
  effect_deadline?: string;
  /** Random Ban: its request (docs/RANDOM_BAN_V2.md), followed until it ends; then what happened, in plain French. */
  random_ban_id?: string;
  detail?: string;
  /** Credits actions: what was granted, and what a Twitch cancellation took back. */
  granted?: number;
  reversed?: number;
};

/** A result update: final (ok / error / unknown) or, for a sound still in the Soundboard, its progress only. */
type ResultUpdate = CpActionResult & {
  unknown?: boolean;
  progress?: 'queued' | 'playing';
  sound_interaction_id?: string;
  random_ban_id?: string;
  detail?: string;
};

/** Soundboard status → this action's result (« done » only when the player reported the sound ended). */
const SOUND_FINAL: Record<string, (error: string | null) => ResultUpdate> = {
  completed: () => ({ index: 0, ok: true }),
  failed: (e) => ({ index: 0, ok: false, error: e ?? 'failed' }),
  cancelled: () => ({ index: 0, ok: false, error: 'stopped_by_moderation' }),
  execution_unknown: () => ({
    index: 0,
    ok: false,
    unknown: true,
    error: 'playback_not_confirmed',
  }),
};

interface RedemptionRow {
  channel_id: string;
  source: string;
  redemption_id: string;
  reward_id: string;
  reward_title: string;
  reward_cost: number;
  user_id: string;
  user_login: string;
  user_name: string;
  user_input: string | null;
  twitch_status: string | null;
  redeemed_at: Date;
  received_at: Date;
  status: CpRedemptionStatus;
  reason: string | null;
  actions: CpAction[];
  results: Result[];
  job_id: string | null;
}

interface JobRow {
  job_id: string;
  channel_id: string;
  source: string;
  redemption_id: string;
  actions: { index: number; action: CpAction }[];
  status: 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'expired';
  consumer_id: string | null;
  attempt_id: string | null;
  attempts: number;
  lease_expires_at: Date | null;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export const redemptionView = (r: RedemptionRow) => ({
  source: r.source,
  redemption_id: r.redemption_id,
  reward: { id: r.reward_id, title: r.reward_title, cost: r.reward_cost },
  user: { id: r.user_id, login: r.user_login, display_name: r.user_name },
  user_input: r.user_input,
  twitch_status: r.twitch_status,
  redeemed_at: iso(r.redeemed_at),
  received_at: iso(r.received_at),
  status: r.status,
  reason: r.reason,
  actions: r.actions,
  results: r.results,
});

/** Overall status from the per-action results. */
function overall(results: Result[]): CpRedemptionStatus {
  if (results.some((r) => r.status === 'pending')) return 'pending';
  const ok = results.filter((r) => r.status === 'done').length;
  if (ok === results.length) return 'done';
  return ok === 0 ? 'failed' : 'partial';
}

/**
 * FX Cam (docs/EFFECTS_PLAYER.md § 11): the effect the viewer typed, resolved against the allowed list at reception
 * (none: the action fails here, nothing reaches Studio). Only the resolved id travels: never the viewer's text.
 */
function withViewerText(a: CpAction, text: string | undefined): CpAction {
  if (a.type !== 'interaction') return a;
  if (a.interaction === 'fx_cam') {
    const effect = resolveFxCam(text);
    return {
      type: a.type,
      interaction: a.interaction,
      ...(effect ? { effect } : {}),
    };
  }
  // Couleur Cam (§ 12): same rule; « aléatoire » is drawn here, so the history shows the colour really applied.
  if (a.interaction === 'color_cam') {
    const color = resolveColorCam(text);
    return {
      type: a.type,
      interaction: a.interaction,
      ...(color ? { color } : {}),
    };
  }
  return a;
}

/** A viewer-text interaction whose text matched nothing: its readable code (fails in Core, never sent to Studio). */
const unresolved = (a: CpAction) =>
  a.type !== 'interaction'
    ? null
    : a.interaction === 'fx_cam' && !a.effect
      ? 'fx_cam_unknown'
      : a.interaction === 'color_cam' && !a.color
        ? 'color_cam_unknown'
        : null;

/** A finished Random Ban → this action's result (null while it runs). */
function randomBanResult(
  index: number,
  rb: NonNullable<Awaited<ReturnType<RandomBanService['outcome']>>>,
): ResultUpdate | null {
  const minutes = rb.duration_s ? `${rb.duration_s / 60} min` : '';
  const refund =
    rb.refund === 'needed'
      ? ' — remboursement nécessaire (non effectué : récompense créée par SAMMI)'
      : rb.refund === 'to_verify'
        ? ' — vérifier sur Twitch avant tout remboursement'
        : '';
  switch (rb.status) {
    case 'confirmed':
      return {
        index,
        ok: true,
        detail: `${rb.target?.name} en timeout ${minutes}${rb.target?.id === rb.buyer.id ? ' (CSC)' : ''}`,
      };
    case 'simulated':
      return {
        index,
        ok: true,
        detail: `simulation : ${rb.target?.name ?? '—'} aurait eu ${minutes} (aucun timeout)`,
      };
    case 'flop':
      return { index, ok: true, detail: 'flop : aucun follower éligible' };
    case 'failed':
      return { index, ok: false, error: `${rb.error ?? 'échec'}${refund}` };
    case 'uncertain':
      return {
        index,
        ok: false,
        unknown: true,
        error: `${rb.error ?? 'résultat incertain'}${refund}`,
      };
    default:
      return null;
  }
}

/** Credits names as the viewer sees them. */
const CREDITS_LABEL = {
  credits_tts: 'Crédits TTS',
  credits_soundboard: 'Crédits Soundboard',
} as const;

/** Actions run by Studio (OBS, effects player); Soundboard sounds are admitted by Core itself. */
const obsAction = (a: CpAction) =>
  a.type !== 'sound' &&
  a.type !== 'credits' &&
  !(a.type === 'interaction' && a.interaction === 'random_ban');

export class ChannelPointsService {
  /** When Studio last asked for a job, per channel (memory: a status, not a record). */
  private readonly studioSeen = new Map<string, number>();
  private readonly changedListeners: ((channelId: string) => Promise<void>)[] =
    [];

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** The Soundboard of this Core (sound actions); absent → sound actions fail explicitly. */
    private readonly sound?: SoundLabService,
    /** Random Ban V2: the « random_ban » interaction (absent → it fails explicitly). */
    private readonly randomBan?: RandomBanService,
    /** Credits actions: the runtime economy (the Lab test wallet unless the launcher passes the canonical one). */
    private readonly economy: EconomyPort = labEconomy,
  ) {
    randomBan?.onResult((channelId, requestId) =>
      this.settleRandomBans(channelId, requestId),
    );
  }

  /**
   * Grants one credits action inside the reception's transaction, alone in a savepoint: a refusal (currency
   * unavailable, cap) is this action's failure, never the redemption's.
   */
  private async grantCredits(
    q: Queryable,
    now: Date,
    e: CpRedemptionInput,
    index: number,
    a: Extract<CpAction, { type: 'credits' }>,
  ): Promise<Result> {
    const label = CREDITS_LABEL[a.currency];
    if (e.source === 'simulation')
      return {
        index,
        type: a.type,
        status: 'done',
        detail: `simulation : +${a.amount} ${label} (aucun crédit)`,
      };
    await q.query('savepoint cp_credits');
    try {
      await this.economy.move(q, now, {
        channelId: e.channel_id,
        viewerId: e.user.id,
        currency: a.currency,
        amount: a.amount,
        kind: 'channel_points',
        key: `cp:${e.source}:${e.redemption_id}:${index}`,
      });
      await q.query('release savepoint cp_credits');
      return {
        index,
        type: a.type,
        status: 'done',
        granted: a.amount,
        detail: `+${a.amount} ${label}`,
      };
    } catch (err) {
      await q.query('rollback to savepoint cp_credits');
      const x = err as { code?: string; details?: { reason?: unknown } };
      return {
        index,
        type: a.type,
        status: 'failed',
        error: String(
          x.details?.reason ?? x.code ?? (err as Error).message,
        ).slice(0, 200),
      };
    }
  }

  // --- settings, rewards, rules (Studio configuration) -----------------------------------------------------------

  async settings(channelId: string) {
    const row = (
      await this.db.query<{ enabled: boolean; updated_at: Date }>(
        'select enabled, updated_at from cp_settings where channel_id = $1',
        [channelId],
      )
    )[0];
    return {
      enabled: row?.enabled ?? false,
      updated_at: iso(row?.updated_at ?? null),
    };
  }

  /** The master switch (persistent; OFF by default). */
  async setEnabled(channelId: string, enabled: boolean, actor: string) {
    await this.db.query(
      `insert into cp_settings (channel_id, enabled, updated_at, updated_by) values ($1, $2, $3, $4)
       on conflict (channel_id) do update set enabled = $2, updated_at = $3, updated_by = $4`,
      [channelId, enabled, this.clock.now(), actor.slice(0, 64)],
    );
    return this.settings(channelId);
  }

  /** The rewards Twitch lists (read only): upserted; a reward gone from Twitch keeps its rule but is marked unseen. */
  async syncRewards(s: CpRewardsSync) {
    const now = this.clock.now();
    await this.db.tx(async (q) => {
      for (const r of s.rewards)
        await q.query(
          `insert into cp_rewards (channel_id, reward_id, title, cost, prompt, is_enabled, user_input_required, source,
             last_seen_at) values ($1, $2, $3, $4, $5, $6, $7, 'twitch_api', $8)
           on conflict (channel_id, reward_id) do update set title = $3, cost = $4, prompt = $5, is_enabled = $6,
             user_input_required = $7, source = 'twitch_api', last_seen_at = $8`,
          [
            s.channel_id,
            r.id,
            r.title,
            r.cost,
            r.prompt ?? null,
            r.is_enabled && !r.is_paused,
            r.user_input_required ?? false,
            now,
          ],
        );
      // Listed before, absent now: deleted on Twitch (rule kept, shown as missing).
      await q.query(
        `update cp_rewards set is_enabled = null where channel_id = $1 and source = 'twitch_api'
           and not (reward_id = any($2::text[]))`,
        [s.channel_id, s.rewards.map((r) => r.id)],
      );
    });
    return { synced: s.rewards.length };
  }

  async rewards(channelId: string) {
    const rows = await this.db.query<{
      reward_id: string;
      title: string;
      cost: number;
      prompt: string | null;
      is_enabled: boolean | null;
      user_input_required: boolean;
      source: string;
      last_seen_at: Date;
      rule_enabled: boolean | null;
      rule_actions: CpAction[] | null;
      rule_version: number | null;
    }>(
      `select w.reward_id, w.title, w.cost, w.prompt, w.is_enabled, w.user_input_required, w.source, w.last_seen_at,
         r.enabled as rule_enabled, r.actions as rule_actions, r.version as rule_version
       from cp_rewards w left join cp_rules r on r.channel_id = w.channel_id and r.reward_id = w.reward_id
       where w.channel_id = $1 order by w.cost, w.title`,
      [channelId],
    );
    return rows.map((r) => ({
      id: r.reward_id,
      title: r.title,
      cost: r.cost,
      prompt: r.prompt,
      /** true enabled on Twitch · false disabled / paused · null no longer listed by Twitch (or never listed). */
      twitch_enabled: r.is_enabled,
      user_input_required: r.user_input_required,
      listed_by_twitch: r.source === 'twitch_api',
      last_seen_at: iso(r.last_seen_at),
      rule: r.rule_actions
        ? {
            enabled: r.rule_enabled!,
            actions: r.rule_actions,
            version: r.rule_version!,
          }
        : null,
    }));
  }

  /** Create / replace a reward's rule (known rewards only; optimistic version check). */
  async saveRule(channelId: string, rewardId: string, input: CpRuleInput) {
    return this.db.tx(async (q) => {
      const known = await q.query(
        'select 1 from cp_rewards where channel_id = $1 and reward_id = $2',
        [channelId, rewardId],
      );
      if (!known.length) throw new CpError(404, 'unknown_reward');
      const prior = (
        await q.query<{ version: number }>(
          'select version from cp_rules where channel_id = $1 and reward_id = $2 for update',
          [channelId, rewardId],
        )
      )[0];
      if ((prior?.version ?? undefined) !== input.expected_version)
        throw new CpError(409, 'version_conflict');
      const version = (prior?.version ?? 0) + 1;
      await q.query(
        `insert into cp_rules (channel_id, reward_id, enabled, actions, version, updated_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (channel_id, reward_id) do update set enabled = $3, actions = $4, version = $5, updated_at = $6`,
        [
          channelId,
          rewardId,
          input.enabled,
          JSON.stringify(input.actions),
          version,
          this.clock.now(),
        ],
      );
      return { enabled: input.enabled, actions: input.actions, version };
    });
  }

  // --- redemptions ----------------------------------------------------------------------------------------------

  /**
   * One redemption: recorded once, decided, executed. A redelivery (same source + Twitch id) changes nothing and
   * answers the first decision. `source: simulation` = a Studio test of a rule: it ignores the master switch and the
   * age check (an explicit click), never the rule.
   */
  async receive(e: CpRedemptionInput) {
    const now = this.clock.now();
    const decided = await this.db.tx(async (q) => {
      await q.query(
        `insert into cp_settings (channel_id, enabled, updated_at) values ($1, false, $2)
         on conflict (channel_id) do nothing`,
        [e.channel_id, now],
      );
      // Channel lock: serializes receptions and claims of a channel.
      const settings = (
        await q.query<{ enabled: boolean }>(
          'select enabled from cp_settings where channel_id = $1 for update',
          [e.channel_id],
        )
      )[0]!;
      const prior = (
        await q.query<RedemptionRow>(
          'select * from cp_redemptions where channel_id = $1 and source = $2 and redemption_id = $3',
          [e.channel_id, e.source, e.redemption_id],
        )
      )[0];
      if (prior)
        return { duplicate: true as const, row: prior, sounds: [] as never[] };
      // The reward as seen in this redemption (kept for the Studio list, even when Twitch's list is not readable).
      await q.query(
        `insert into cp_rewards (channel_id, reward_id, title, cost, prompt, source, last_seen_at)
         values ($1, $2, $3, $4, $5, 'redemption', $6)
         on conflict (channel_id, reward_id) do update set title = $3, cost = $4, last_seen_at = $6`,
        [
          e.channel_id,
          e.reward.id,
          e.reward.title,
          e.reward.cost,
          e.reward.prompt ?? null,
          now,
        ],
      );
      const rule = (
        await q.query<{ enabled: boolean; actions: unknown[] }>(
          'select enabled, actions from cp_rules where channel_id = $1 and reward_id = $2',
          [e.channel_id, e.reward.id],
        )
      )[0];
      const real = e.source === 'twitch';
      const reason = !rule
        ? 'no_rule'
        : !rule.enabled
          ? 'rule_disabled'
          : real && !settings.enabled
            ? 'automations_off'
            : real &&
                now.getTime() - new Date(e.redeemed_at).getTime() >
                  CP_RULES.maxAgeMs
              ? 'late'
              : null;
      // Actions frozen at reception (a later edit of the rule never changes this redemption). Late: only its credits
      // (the points are spent; an OBS effect or a sound minutes later would surprise the stream).
      const actions =
        reason && reason !== 'late'
          ? []
          : rule!.actions
              .map((a) => withViewerText(CpActionSchema.parse(a), e.user_input))
              .filter((a) => !reason || a.type === 'credits');
      const results: Result[] = [];
      for (const [index, a] of actions.entries()) {
        const error = unresolved(a);
        results.push(
          error
            ? { index, type: a.type, status: 'failed', error }
            : a.type !== 'credits'
              ? { index, type: a.type, status: 'pending' }
              : e.twitch_status === 'canceled'
                ? {
                    index,
                    type: a.type,
                    status: 'failed',
                    error: 'canceled_on_twitch',
                  }
                : await this.grantCredits(q, now, e, index, a),
        );
      }
      const obs = actions
        .map((action, index) => ({ index, action }))
        .filter(
          (x) => obsAction(x.action) && results[x.index]!.status === 'pending',
        );
      const jobId = obs.length ? randomUUID() : null;
      await q.query(
        `insert into cp_redemptions (channel_id, source, redemption_id, reward_id, reward_title, reward_cost, user_id,
           user_login, user_name, user_input, twitch_status, redeemed_at, received_at, status, reason, actions, results,
           job_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          e.channel_id,
          e.source,
          e.redemption_id,
          e.reward.id,
          e.reward.title,
          e.reward.cost,
          e.user.id,
          e.user.login,
          e.user.display_name,
          e.user_input?.trim() ? e.user_input : null,
          e.twitch_status ?? null,
          new Date(e.redeemed_at),
          now,
          !actions.length ? 'ignored' : overall(results),
          reason,
          JSON.stringify(actions),
          JSON.stringify(results),
          jobId,
        ],
      );
      if (jobId)
        await q.query(
          `insert into cp_jobs (job_id, channel_id, source, redemption_id, actions, status, created_at)
           values ($1, $2, $3, $4, $5, 'queued', $6)`,
          [
            jobId,
            e.channel_id,
            e.source,
            e.redemption_id,
            JSON.stringify(obs),
            now,
          ],
        );
      return {
        duplicate: false as const,
        row: null,
        sounds: actions
          .map((action, index) => ({ index, action }))
          .filter((x) => x.action.type === 'sound'),
        randomBans: actions
          .map((action, index) => ({ index, action }))
          .filter(
            (x) =>
              x.action.type === 'interaction' &&
              x.action.interaction === 'random_ban',
          ),
      };
    });
    if (decided.duplicate)
      return {
        outcome: 'duplicate' as const,
        redemption: redemptionView(decided.row),
      };
    // Sounds: after the commit (the Soundboard has its own transaction); a refusal is this action's failure.
    for (const { index, action } of decided.sounds) {
      let error: string | undefined;
      let interaction: string | undefined;
      try {
        if (!this.sound) throw new Error('soundboard_unavailable');
        const admitted = await this.sound.admitChannelPoints({
          idempotency_key: `cp:${e.source}:${e.redemption_id}:${index}`.slice(
            0,
            64,
          ),
          channel_id: e.channel_id,
          viewer: { id: e.user.id, display_name: e.user.display_name },
          sound_id: (action as { sound_id: string }).sound_id,
        });
        interaction = admitted.interaction.interaction_id;
      } catch (err) {
        error = String(
          (err as { code?: string }).code ?? (err as Error).message,
        ).slice(0, 200);
      }
      // Admitted is NOT played: the action stays pending (« en file ») until the Soundboard player reports the end.
      await this.setResults(e.channel_id, e.source, e.redemption_id, [
        error
          ? { index, ok: false, error }
          : {
              index,
              ok: false,
              progress: 'queued',
              sound_interaction_id: interaction,
            },
      ]);
    }
    // Random Ban: one request per action (dedup by the redemption), executed by the Twitch executor; a Studio test
    // (simulation) is a dry run — the real search, never a timeout.
    for (const { index } of decided.randomBans) {
      let update: ResultUpdate;
      try {
        if (!this.randomBan) throw new Error('random_ban_unavailable');
        const request = await this.randomBan.request({
          channel_id: e.channel_id,
          source: 'channel_points',
          source_ref: `${e.source}:${e.redemption_id}:${index}`,
          mode: e.source === 'simulation' ? 'dry_run' : 'real',
          buyer: {
            id: e.user.id,
            login: e.user.login,
            name: e.user.display_name,
          },
        });
        update = {
          index,
          ok: false,
          progress: 'queued',
          random_ban_id: request.request_id,
        };
      } catch (err) {
        update = { index, ok: false, error: (err as Error).message };
      }
      await this.setResults(e.channel_id, e.source, e.redemption_id, [update]);
    }
    const row = await this.redemption(e.channel_id, e.source, e.redemption_id);
    return { outcome: row.status, redemption: redemptionView(row) };
  }

  /**
   * Twitch changed a redemption's status (fulfilled / canceled from the reward queue). Recorded; on « canceled » (Twitch
   * gave the points back) the credits it granted are taken back once, at most what the viewer still holds (never below
   * 0): the rest is shown « à rapprocher ». Unknown redemption → nothing (no credit was granted for it here).
   */
  async update(u: CpRedemptionUpdate) {
    const now = this.clock.now();
    return this.db.tx(async (q) => {
      await q.query(
        'select 1 from cp_settings where channel_id = $1 for update',
        [u.channel_id],
      );
      const row = (
        await q.query<RedemptionRow>(
          'select * from cp_redemptions where channel_id = $1 and source = $2 and redemption_id = $3 for update',
          [u.channel_id, u.source, u.redemption_id],
        )
      )[0];
      if (!row) return { outcome: 'unknown_redemption' as const };
      if (row.twitch_status === 'canceled')
        return { outcome: 'duplicate' as const };
      const results = [...row.results];
      if (u.twitch_status === 'canceled')
        for (const [i, r] of results.entries()) {
          const a = row.actions[r.index];
          if (a?.type !== 'credits' || !r.granted || r.reversed !== undefined)
            continue;
          const held =
            (
              await this.economy.hold(
                q,
                now,
                row.channel_id,
                [row.user_id],
                a.currency,
              )
            ).balances.get(row.user_id) ?? 0;
          const back = Math.min(r.granted, held);
          if (back > 0)
            await this.economy.move(q, now, {
              channelId: row.channel_id,
              viewerId: row.user_id,
              currency: a.currency,
              amount: -back,
              kind: 'channel_points',
              key: `cp:${row.source}:${row.redemption_id}:${r.index}:reversal`,
            });
          const label = CREDITS_LABEL[a.currency];
          results[i] = {
            ...r,
            reversed: back,
            detail:
              back === r.granted
                ? `+${r.granted} ${label}, repris : redemption annulée sur Twitch`
                : `+${r.granted} ${label}, ${back} repris (annulée sur Twitch) — ${r.granted - back} déjà dépensés : à rapprocher`,
          };
        }
      await q.query(
        'update cp_redemptions set twitch_status = $4, results = $5 where channel_id = $1 and source = $2 and redemption_id = $3',
        [
          u.channel_id,
          u.source,
          u.redemption_id,
          u.twitch_status,
          JSON.stringify(results),
        ],
      );
      return { outcome: 'recorded' as const };
    });
  }

  private async redemption(
    channelId: string,
    source: string,
    id: string,
    q: Queryable = this.db,
  ) {
    return (
      await q.query<RedemptionRow>(
        'select * from cp_redemptions where channel_id = $1 and source = $2 and redemption_id = $3',
        [channelId, source, id],
      )
    )[0]!;
  }

  /** Merges action results into a redemption and recomputes its status. */
  private async setResults(
    channelId: string,
    source: string,
    id: string,
    results: ResultUpdate[],
    q: Queryable = this.db,
  ) {
    const row = (
      await q.query<RedemptionRow>(
        'select * from cp_redemptions where channel_id = $1 and source = $2 and redemption_id = $3 for update',
        [channelId, source, id],
      )
    )[0];
    if (!row || row.status === 'ignored') return;
    const merged = row.results.map((r) => {
      const n = results.find((x) => x.index === r.index);
      if (!n || r.status !== 'pending') return r;
      if (n.playing && n.ok)
        return {
          ...r,
          progress: 'playing' as const,
          effect_deadline: new Date(
            this.clock.now().getTime() + CP_RULES.effectEndMs,
          ).toISOString(),
        };
      if (n.progress)
        return {
          ...r,
          progress: n.progress,
          ...(n.sound_interaction_id
            ? { sound_interaction_id: n.sound_interaction_id }
            : {}),
          ...(n.random_ban_id ? { random_ban_id: n.random_ban_id } : {}),
        };
      return n.unknown
        ? { ...r, status: 'unknown' as const, error: n.error }
        : n.ok
          ? {
              index: r.index,
              type: r.type,
              status: 'done' as const,
              ...(r.sound_interaction_id
                ? { sound_interaction_id: r.sound_interaction_id }
                : {}),
              ...(r.random_ban_id ? { random_ban_id: r.random_ban_id } : {}),
              ...(n.detail ? { detail: n.detail } : {}),
            }
          : { ...r, status: 'failed' as const, error: n.error ?? 'failed' };
    });
    await q.query(
      'update cp_redemptions set results = $4, status = $5 where channel_id = $1 and source = $2 and redemption_id = $3',
      [channelId, source, id, JSON.stringify(merged), overall(merged)],
    );
  }

  /**
   * Pending sound actions follow their Soundboard interaction: queued / playing, then done only when the player
   * reported `completed`; failed (expired, refused by the player, moderation stop) or unknown (no end report).
   */
  private async settleSounds(channelId: string) {
    // The Soundboard's own expiry rule first (the Lab Core only runs it when a player claims): a sound nobody played
    // within 2 min becomes « expired » instead of staying « en attente » for ever.
    await this.sound?.sweepExpired().catch(() => 0);
    const rows = await this.db.query<RedemptionRow>(
      `select * from cp_redemptions where channel_id = $1 and status = 'pending'
         and results::text like '%sound_interaction_id%' order by received_at desc limit 50`,
      [channelId],
    );
    for (const row of rows) {
      const updates: ResultUpdate[] = [];
      for (const r of row.results) {
        if (r.status !== 'pending' || !r.sound_interaction_id) continue;
        const sound = (
          await this.db.query<{ status: string; code: string | null }>(
            "select status, error->>'code' as code from sound_lab_interactions where interaction_id = $1",
            [r.sound_interaction_id],
          )
        )[0];
        if (!sound) continue;
        const final = SOUND_FINAL[sound.status];
        if (final) updates.push({ ...final(sound.code), index: r.index });
        else {
          const progress = sound.status === 'executing' ? 'playing' : 'queued';
          if (progress !== r.progress)
            updates.push({ index: r.index, ok: false, progress });
        }
      }
      if (updates.length)
        await this.setResults(
          channelId,
          row.source,
          row.redemption_id,
          updates,
        );
    }
  }

  /** Effects reported playing whose end never came (Studio closed, player gone): unknown, never replayed. */
  private async settleEffects(channelId: string) {
    const rows = await this.db.query<RedemptionRow>(
      `select * from cp_redemptions where channel_id = $1 and status = 'pending'
         and results::text like '%effect_deadline%' order by received_at desc limit 50`,
      [channelId],
    );
    const now = this.clock.now().getTime();
    for (const row of rows) {
      const late = row.results.filter(
        (r) =>
          r.status === 'pending' &&
          r.effect_deadline &&
          new Date(r.effect_deadline).getTime() < now,
      );
      if (late.length)
        await this.setResults(
          channelId,
          row.source,
          row.redemption_id,
          late.map((r) => ({
            index: r.index,
            ok: false,
            unknown: true,
            error: 'playback_not_confirmed',
          })),
        );
    }
  }

  /**
   * The end of an effect Studio started for a job (after the job's `completed`). Only the job's consumer, only an
   * effect action still pending; a late or repeated report changes nothing (the first final result stays).
   */
  async effectReport(jobId: string, r: CpEffectReport) {
    let channel: string | null = null;
    const out = await this.db.tx(async (q) => {
      const job = (
        await q.query<JobRow>('select * from cp_jobs where job_id = $1', [
          jobId,
        ])
      )[0];
      if (!job) throw new CpError(404, 'job_not_found');
      channel = job.channel_id;
      if (job.consumer_id !== r.consumer_id)
        throw new CpError(409, 'not_current_attempt');
      const action = job.actions.find((x) => x.index === r.index);
      if (
        action?.action.type !== 'effect_sound' &&
        action?.action.type !== 'effect_video' &&
        action?.action.type !== 'interaction'
      )
        throw new CpError(409, 'not_an_effect');
      const row = await this.redemption(
        job.channel_id,
        job.source,
        job.redemption_id,
        q,
      );
      if (row.results.find((x) => x.index === r.index)?.status !== 'pending')
        return { status: 'already_final' as const };
      await this.setResults(
        job.channel_id,
        job.source,
        job.redemption_id,
        [
          r.event === 'completed'
            ? { index: r.index, ok: true }
            : r.event === 'unknown'
              ? {
                  index: r.index,
                  ok: false,
                  unknown: true,
                  error: r.error ?? 'playback_not_confirmed',
                }
              : { index: r.index, ok: false, error: r.error ?? 'failed' },
        ],
        q,
      );
      return { status: 'recorded' as const };
    });
    if (channel) await this.tellChanged(channel);
    return out;
  }

  // --- OBS jobs (Studio) ------------------------------------------------------------------------------------------

  /** Settles abandoned jobs: never started → offered again (3 attempts); started → expired, never replayed. */
  private async sweep(q: Queryable, channelId: string) {
    const now = this.clock.now();
    const stale = await q.query<JobRow>(
      `select * from cp_jobs where channel_id = $1 and status in ('claimed', 'running') and lease_expires_at < $2`,
      [channelId, now],
    );
    for (const j of stale) {
      if (j.status === 'claimed' && j.attempts < CP_RULES.maxAttempts) {
        await q.query(
          `update cp_jobs set status = 'queued', attempt_id = null, lease_expires_at = null, consumer_id = null
           where job_id = $1`,
          [j.job_id],
        );
        continue;
      }
      const why =
        j.status === 'claimed'
          ? 'never_started'
          : 'started_without_report: may have run, not replayed';
      await q.query(
        `update cp_jobs set status = 'expired', ended_at = $2, failure = $3, attempt_id = null,
           lease_expires_at = null where job_id = $1`,
        [j.job_id, now, why],
      );
      await this.setResults(
        channelId,
        j.source,
        j.redemption_id,
        j.actions.map((a) => ({
          index: a.index,
          ok: false,
          error: j.status === 'claimed' ? 'studio_absent' : 'execution_unknown',
          unknown: j.status === 'running',
        })),
        q,
      );
    }
  }

  /** Studio asked for a job within the last 15 s: an OBS action bought now will be run (memory: this Core only). */
  studioReady(channelId: string) {
    const at = this.studioSeen.get(channelId);
    return at !== undefined && this.clock.now().getTime() - at < 15_000;
  }

  /** Told after each Studio report or claim (outside its transaction): the chat purchases follow their result. */
  onChanged(fn: (channelId: string) => Promise<void>) {
    this.changedListeners.push(fn);
  }

  private async tellChanged(channelId: string) {
    for (const fn of this.changedListeners)
      await fn(channelId).catch((e) =>
        console.error('[channel-points] chat settle failed', channelId, e),
      );
  }

  /**
   * `!fxcam <effet>` paid in Jetons from the chat (chat-interactions/fx-cam-chat.ts), in the CALLER's transaction (its
   * debit commits or rolls back with it): recorded like a redemption of the FX Cam reward — source « chat », the
   * Twitch message id as redemption id — with the same action and Studio job, so the same engine runs and follows it.
   * Refused when the channel points automations are OFF or no enabled rule offers FX Cam (the interaction is not on);
   * `created` false: this message is already recorded (nothing new, nothing to pay).
   */
  async admitChatFxCam(
    q: Queryable,
    p: {
      channel_id: string;
      message_id: string;
      user: { id: string; login: string; display_name: string };
      effect: FxCamEffectId;
    },
  ): Promise<
    | { refused: 'unavailable' }
    | { refused?: undefined; created: boolean; jobId: string }
  > {
    const now = this.clock.now();
    await q.query(
      `insert into cp_settings (channel_id, enabled, updated_at) values ($1, false, $2)
       on conflict (channel_id) do nothing`,
      [p.channel_id, now],
    );
    // Same channel lock as a reception: chat purchases and redemptions are serialized.
    const settings = (
      await q.query<{ enabled: boolean }>(
        'select enabled from cp_settings where channel_id = $1 for update',
        [p.channel_id],
      )
    )[0]!;
    const prior = (
      await q.query<{ job_id: string }>(
        `select job_id from cp_redemptions where channel_id = $1 and source = 'chat' and redemption_id = $2`,
        [p.channel_id, p.message_id],
      )
    )[0];
    if (prior) return { created: false, jobId: prior.job_id };
    const rule = (
      await q.query<{ reward_id: string; title: string | null }>(
        `select r.reward_id, w.title from cp_rules r
           left join cp_rewards w on w.channel_id = r.channel_id and w.reward_id = r.reward_id
         where r.channel_id = $1 and r.enabled and r.actions @> '[{"type":"interaction","interaction":"fx_cam"}]'
         order by r.reward_id limit 1`,
        [p.channel_id],
      )
    )[0];
    if (!settings.enabled || !rule) return { refused: 'unavailable' };
    const action: CpAction = {
      type: 'interaction',
      interaction: 'fx_cam',
      effect: p.effect,
    };
    const jobId = randomUUID();
    await q.query(
      `insert into cp_redemptions (channel_id, source, redemption_id, reward_id, reward_title, reward_cost, user_id,
         user_login, user_name, user_input, twitch_status, redeemed_at, received_at, status, reason, actions, results,
         job_id) values ($1, 'chat', $2, $3, $4, 0, $5, $6, $7, $8, null, $9, $9, 'pending', null, $10, $11, $12)`,
      [
        p.channel_id,
        p.message_id,
        rule.reward_id,
        `!fxcam (chat) · ${rule.title ?? 'FX Cam'}`.slice(0, 200),
        p.user.id,
        p.user.login,
        p.user.display_name,
        p.effect,
        now,
        JSON.stringify([action]),
        JSON.stringify([{ index: 0, type: action.type, status: 'pending' }]),
        jobId,
      ],
    );
    await q.query(
      `insert into cp_jobs (job_id, channel_id, source, redemption_id, actions, status, created_at)
       values ($1, $2, 'chat', $3, $4, 'queued', $5)`,
      [
        jobId,
        p.channel_id,
        p.message_id,
        JSON.stringify([{ index: 0, action }]),
        now,
      ],
    );
    return { created: true, jobId };
  }

  /** The next OBS job for this Studio (one in flight per channel), or null. */
  async claim(channelId: string, consumerId: string) {
    this.studioSeen.set(channelId, this.clock.now().getTime());
    await this.settleSounds(channelId);
    await this.settleEffects(channelId);
    const out = await this.db.tx(async (q) => {
      await q.query(
        `insert into cp_settings (channel_id, enabled, updated_at) values ($1, false, $2)
         on conflict (channel_id) do nothing`,
        [channelId, this.clock.now()],
      );
      await q.query(
        'select 1 from cp_settings where channel_id = $1 for update',
        [channelId],
      );
      await this.sweep(q, channelId);
      const busy = await q.query(
        "select 1 from cp_jobs where channel_id = $1 and status in ('claimed', 'running')",
        [channelId],
      );
      if (busy.length) return null;
      const next = (
        await q.query<JobRow>(
          "select * from cp_jobs where channel_id = $1 and status = 'queued' order by seq limit 1",
          [channelId],
        )
      )[0];
      if (!next) return null;
      const now = this.clock.now();
      const attempt = randomUUID();
      await q.query(
        `update cp_jobs set status = 'claimed', consumer_id = $2, attempt_id = $3, attempts = attempts + 1,
           claimed_at = $4, lease_expires_at = $5 where job_id = $1`,
        [
          next.job_id,
          consumerId,
          attempt,
          now,
          new Date(now.getTime() + CP_RULES.claimLeaseMs),
        ],
      );
      const redemption = await this.redemption(
        channelId,
        next.source,
        next.redemption_id,
        q,
      );
      return {
        job_id: next.job_id,
        attempt_id: attempt,
        actions: next.actions,
        redemption: {
          reward_title: redemption.reward_title,
          user_name: redemption.user_name,
        },
      };
    });
    await this.tellChanged(channelId);
    return out;
  }

  /** Studio's report for its attempt (idempotent; a late report after the job ended is refused with 409). */
  async ack(jobId: string, a: CpAckRequest) {
    let channel: string | null = null;
    const out = await this.db.tx(async (q) => {
      const head = (
        await q.query<{ channel_id: string }>(
          'select channel_id from cp_jobs where job_id = $1',
          [jobId],
        )
      )[0];
      if (!head) throw new CpError(404, 'job_not_found');
      channel = head.channel_id;
      await q.query(
        'select 1 from cp_settings where channel_id = $1 for update',
        [head.channel_id],
      );
      const job = (
        await q.query<JobRow>('select * from cp_jobs where job_id = $1', [
          jobId,
        ])
      )[0]!;
      if (job.attempt_id !== a.attempt_id || job.consumer_id !== a.consumer_id)
        throw new CpError(409, 'not_current_attempt');
      const now = this.clock.now();
      if (a.event === 'started') {
        if (job.status === 'running') return { status: job.status };
        if (job.status !== 'claimed') throw new CpError(409, 'job_ended');
        const hold = job.actions.reduce(
          (t, x) =>
            t + ('duration_ms' in x.action ? (x.action.duration_ms ?? 0) : 0),
          0,
        );
        await q.query(
          `update cp_jobs set status = 'running', started_at = $2, lease_expires_at = $3 where job_id = $1`,
          [jobId, now, new Date(now.getTime() + hold + CP_RULES.runMarginMs)],
        );
        return { status: 'running' };
      }
      if (job.status !== 'running' && job.status !== 'claimed')
        throw new CpError(409, 'job_ended');
      const final = a.event === 'completed' ? 'completed' : 'failed';
      await q.query(
        `update cp_jobs set status = $2, ended_at = $3, failure = $4, attempt_id = null, lease_expires_at = null
         where job_id = $1`,
        [jobId, final, now, a.error ?? null],
      );
      const given = new Map((a.results ?? []).map((r) => [r.index, r]));
      await this.setResults(
        job.channel_id,
        job.source,
        job.redemption_id,
        job.actions.map(
          (x) =>
            given.get(x.index) ?? {
              index: x.index,
              ok: false,
              error: a.error ?? 'not_reported',
            },
        ),
        q,
      );
      return { status: final };
    });
    if (channel) await this.tellChanged(channel);
    return out;
  }

  /**
   * Random Ban actions follow their request until it ends (Random Ban's own history holds the details): at each
   * Studio read, and for one request as soon as the executor reports its result.
   */
  private async settleRandomBans(channelId: string, requestId?: string) {
    if (!this.randomBan) return;
    const rows = await this.db.query<RedemptionRow>(
      `select * from cp_redemptions where channel_id = $1 and status = 'pending'
         and results::text like '%random_ban_id%' and ($2::text is null or results @> $3::jsonb)
         order by received_at desc limit 50`,
      [
        channelId,
        requestId ?? null,
        JSON.stringify([{ random_ban_id: requestId ?? '' }]),
      ],
    );
    for (const row of rows)
      for (const r of row.results) {
        if (r.status !== 'pending' || !r.random_ban_id) continue;
        if (requestId && r.random_ban_id !== requestId) continue;
        const rb = await this.randomBan.outcome(r.random_ban_id);
        const update = rb && randomBanResult(r.index, rb);
        if (update)
          await this.setResults(channelId, row.source, row.redemption_id, [
            update,
          ]);
      }
  }

  /** The Studio tab: switch, rewards with their rule, recent redemptions, jobs in flight, Soundboard sounds. */
  async state(channelId: string) {
    await this.settleSounds(channelId);
    await this.settleEffects(channelId);
    await this.settleRandomBans(channelId);
    const recent = await this.db.query<RedemptionRow>(
      'select * from cp_redemptions where channel_id = $1 order by received_at desc limit 30',
      [channelId],
    );
    const inFlight = await this.db.query<{ n: number | string }>(
      "select count(*) as n from cp_jobs where channel_id = $1 and status in ('queued', 'claimed', 'running')",
      [channelId],
    );
    const sounds = this.sound
      ? (await this.sound.config()).sounds.map((s) => ({
          id: s.id,
          label: s.label,
          enabled: s.enabled,
        }))
      : [];
    return {
      settings: await this.settings(channelId),
      rewards: await this.rewards(channelId),
      recent: recent.map(redemptionView),
      jobs_waiting: Number(inFlight[0]!.n),
      sounds,
    };
  }
}
