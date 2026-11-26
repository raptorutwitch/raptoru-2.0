import { createHash, randomUUID } from 'node:crypto';
import type {
  ChaosAckRequest,
  ChaosChoice,
  ChaosCreditConstraints,
  ChaosHeartbeat,
  ChaosModerationCommand,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import {
  deferrableRefund,
  labEconomy,
  type EconomyPort,
} from '../economy/economy.js';
import {
  activeBlock,
  actorName,
  audit,
  countGlobalRefusal,
  GlobalPauseError,
  globalState,
  LabWalletError,
  personalCooldownMs,
  seeViewer,
  SYSTEM,
  type Actor,
  type LabRole,
} from '../lab-moderation/store.js';
import type {
  ModuleSettings,
  SettingSpec,
} from '../module-settings/service.js';
import { liveForPaid, STREAM_OFFLINE } from '../stream/live-gate.js';
import {
  EFFECTS,
  ENGINE,
  SLOTS,
  durationRange,
  effectById,
  engineRequest,
  normalizeChoice,
  presetOf,
  rangePrice,
  type Choice,
  type Effect,
  type Preset,
} from './catalog.js';

// Chaos V2 lot 2 — the Core's `chaos` module (docs/chaos/CONTRAT_LOT2.md). The Core owns the catalogue, the price, the
// rules, the queue, the payment and every refund; Studio only plays (claim → lease → ACK) and the extension only asks.
// Same transactional model as Soundboard V2 (sound-lab-service.ts): the channel row lock serializes admissions, claims,
// ACKs, sweeps and moderation; the idempotent purchase is looked up before anything is debited; the debit (EconomyPort)
// commits with the request; a refund is a conditional update (`refund_status = 'none'`) plus the economy's own once-only
// key — never twice. Nothing is enabled by default: `chaos.enabled` = 0 and the Core's CHAOS_EXTENSION = off.

export const CHAOS_RULES = Object.freeze({
  /** Waiting requests per channel (purchases « à charges » apart). */
  queueMax: 3,
  /** Never claimed within this delay → expired, refunded. */
  queueTtlMs: 180_000,
  /** Same viewer, same effect: after its end. */
  viewerCooldownMs: 60_000,
  /** Purchases « à charges » (Un clignement): pending cap, gap between two, sliding minute for the whole channel. */
  burst: { maxPending: 10, gapMs: 500, perMinute: 20 },
  /** Studio heartbeat freshness required to admit or claim. */
  heartbeatFreshMs: 10_000,
  /** A claimed attempt has this long to report `started` (extended by the heartbeat's `inflight`). */
  leaseMs: 30_000,
  /** A claim is never extended beyond this (a stuck Studio still ends in a refund). */
  claimMaxMs: 120_000,
  /** Started: its duration plus this margin before `unknown_end`. */
  startedMarginMs: 15_000,
  /** Stopped by moderation before this share of its duration: refunded by default. */
  stopRefundBelow: 0.25,
  mineLimit: 20,
  recentLimit: 30,
});

/** Studio › Paramètres des modules (integers only): the switch and the interruption policy. */
export const CHAOS_SETTINGS: Record<string, SettingSpec> = {
  'chaos.enabled': {
    label: 'Chaos : achats d’effets depuis l’extension',
    unit: '0 / 1',
    default: 0,
    min: 0,
    max: 1,
    help: '0 = fermé (défaut) ; la Production demande aussi CHAOS_EXTENSION côté Core',
  },
  'chaos.interrupted_refund_below': {
    label:
      'Chaos : effet interrompu par une panne remboursé s’il a joué moins de',
    unit: '% de sa durée',
    default: 50,
    min: 0,
    max: 100,
    advanced: true,
  },
};

/** Engine / Studio ends that are breakdowns: the interruption policy applies (refunded under a share of the duration). */
const BREAKDOWNS = new Set([
  'target_lost',
  'capture_lost',
  'display_changed',
  'shutdown',
  'engine_exit',
  'unknown_end',
  // Studio's own codes after a start (its restart, an engine error reported as raw text in `reason`).
  'studio_restart',
  'engine_error',
]);
const FINAL = ['ended', 'failed', 'canceled', 'expired'] as const;
type Status = 'queued' | 'claimed' | 'started' | (typeof FINAL)[number];
type Payment = 'jetons' | 'credit' | 'gift';

/** A business refusal: its HTTP status, a stable code, details (retry_after_ms, price…). */
export class ChaosError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string = code,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

interface Row {
  id: string;
  seq: number | string;
  channel_id: string;
  viewer_id: string;
  viewer_name: string;
  idempotency_key: string;
  request_hash: string;
  effect: string;
  preset: string | null;
  level: string | null;
  choice: Choice;
  engine_request: Record<string, unknown>;
  duration_ms: number;
  price: number;
  payment: Payment;
  credit_id: string | null;
  charged: boolean;
  priority: number;
  status: Status;
  code: string | null;
  reason: string | null;
  refund_status: 'none' | 'refunded';
  refunded_at: Date | null;
  refund_reason: string | null;
  actor: string | null;
  created_at: Date;
  expires_at: Date;
  studio_instance_id: string | null;
  attempt_id: string | null;
  claimed_at: Date | null;
  lease_expires_at: Date | null;
  started_at: Date | null;
  ended_at: Date | null;
  played_ms: number | null;
  stop_requested_at: Date | null;
  stop_refund: boolean | null;
  stop_reason: string | null;
}

interface CreditRow {
  id: string;
  channel_id: string;
  viewer_id: string;
  viewer_name: string | null;
  effect_id: string;
  constraints: ChaosCreditConstraints;
  source_kind: string;
  source_actor_id: string | null;
  reason: string;
  granted_at: Date;
  expires_at: Date | null;
  state: string;
  request_id: string | null;
}

interface Studio {
  studio_instance_id: string;
  engine_ready: boolean;
  safety_max_ms: number;
  safe_mode: boolean;
  effects: Record<string, { enabled?: boolean }>;
}

export interface ChaosViewer {
  id: string;
  display_name: string;
}

type Block = { code: string; message?: string } & Record<string, unknown>;
type Outcome = {
  kind: 'now' | 'queue' | 'burst';
  position?: number;
  eta_s?: number;
};

const ms = (d: Date | null) => (d ? new Date(d).getTime() : null);
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const hasReason = (r: string | null | undefined) =>
  String(r ?? '').trim().length >= 3;
const isFinal = (s: Status) => (FINAL as readonly string[]).includes(s);

/** Remaining milliseconds of a request that holds a place in its slot (claimed: its whole duration). */
const remainingMs = (r: Row, now: number) =>
  r.status === 'started'
    ? Math.max(0, ms(r.started_at)! + r.duration_ms - now)
    : r.duration_ms;

export class ChaosService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** Economic side of the purchase, inside its transaction (the Lab test wallet unless the canonical Wallet). */
    private readonly economy: EconomyPort = labEconomy,
    private readonly settings: ModuleSettings,
  ) {
    settings.register(CHAOS_SETTINGS);
  }

  // --- reads shared by the rules -------------------------------------------------------------------------------

  /** The channel's row lock: every write of the module takes it first. Returns the purchases' state. */
  private async lock(q: Queryable, channelId: string) {
    await q.query(
      'insert into chaos_channels (channel_id) values ($1) on conflict (channel_id) do nothing',
      [channelId],
    );
    return (
      await q.query<{ state: 'open' | 'paused' }>(
        'select state from chaos_channels where channel_id = $1 for update',
        [channelId],
      )
    )[0]!.state;
  }

  private async channelState(q: Queryable, channelId: string) {
    return (
      (
        await q.query<{ state: 'open' | 'paused' }>(
          'select state from chaos_channels where channel_id = $1',
          [channelId],
        )
      )[0]?.state ?? 'open'
    );
  }

  /**
   * Production's hard switch (CHAOS_EXTENSION ≠ off, set by the public frontier): without it nothing is sold or played
   * on the canonical economy, whatever `chaos.enabled` says. The Lab test wallet is never gated by it.
   */
  productionApproved = false;

  /** Chaos open on this channel: `chaos.enabled` = 1 (and, on the canonical economy, CHAOS_EXTENSION ≠ off). */
  async enabled(q: Queryable, channelId: string) {
    if (this.economy.mode === 'canonical' && !this.productionApproved)
      return false;
    return (await this.settings.get(q, channelId, 'chaos.enabled')) === 1;
  }

  /** The freshest Studio of the channel (heartbeat within 10 s), or null. */
  private async studio(
    q: Queryable,
    channelId: string,
  ): Promise<Studio | null> {
    const since = new Date(
      this.clock.now().getTime() - CHAOS_RULES.heartbeatFreshMs,
    );
    return (
      (
        await q.query<Studio>(
          `select studio_instance_id, engine_ready, safety_max_ms, safe_mode, effects from chaos_studios
           where channel_id = $1 and last_seen >= $2 order by last_seen desc limit 1`,
          [channelId, since],
        )
      )[0] ?? null
    );
  }

  /** The duration ceiling of this live: Studio's Safety (its default while no Studio is there). */
  private capS(studio: Studio | null) {
    return studio ? studio.safety_max_ms / 1000 : ENGINE.safetyDurationS;
  }

  private async openRows(q: Queryable, channelId: string) {
    return q.query<Row>(
      `select * from chaos_requests where channel_id = $1 and status in ('queued', 'claimed', 'started')
       order by priority desc, seq`,
      [channelId],
    );
  }

  private async byId(q: Queryable, id: string) {
    return (
      (
        await q.query<Row>('select * from chaos_requests where id = $1', [id])
      )[0] ?? null
    );
  }

  /** A viewer's charges of a preset « à charges » now: they come back one every `rechargeS` (computed, never ticked). */
  private async chargesOf(
    q: Queryable,
    channelId: string,
    viewerId: string,
    e: Effect,
    p: Preset,
    now: number,
  ) {
    const def = p.charges!;
    const step = def.rechargeS * 1000;
    const row = (
      await q.query<{ n: number; at: Date }>(
        'select n, at from chaos_charges where channel_id = $1 and viewer_id = $2 and effect = $3 and preset = $4',
        [channelId, viewerId, e.id, p.id],
      )
    )[0];
    const st = row ? { n: row.n, at: ms(row.at)! } : { n: def.max, at: now };
    const gained = Math.max(0, Math.floor((now - st.at) / step));
    const n = Math.min(def.max, st.n + gained);
    const at = n >= def.max ? now : st.at + gained * step;
    return {
      n,
      max: def.max,
      next_s:
        n >= def.max ? null : Math.max(1, Math.ceil((at + step - now) / 1000)),
      at,
    };
  }

  private async setCharges(
    q: Queryable,
    channelId: string,
    viewerId: string,
    effect: string,
    preset: string,
    n: number,
    at: number,
  ) {
    await q.query(
      `insert into chaos_charges (channel_id, viewer_id, effect, preset, n, at) values ($1, $2, $3, $4, $5, $6)
       on conflict (channel_id, viewer_id, effect, preset) do update set n = excluded.n, at = excluded.at`,
      [channelId, viewerId, effect, preset, n, new Date(at)],
    );
  }

  /** A charge back (a purchase « à charges » that never played), never above the maximum. */
  private async giveCharge(q: Queryable, r: Row, now: number) {
    const e = effectById(r.effect);
    const p = e && presetOf(e, { style: r.preset });
    if (!e || !p?.charges) return;
    const ch = await this.chargesOf(q, r.channel_id, r.viewer_id, e, p, now);
    await this.setCharges(
      q,
      r.channel_id,
      r.viewer_id,
      e.id,
      p.id,
      Math.min(ch.max, ch.n + 1),
      ch.at,
    );
  }

  /** The end of the last played request of this effect (this viewer's, or anybody's): the delays start there. */
  private async lastEnded(
    q: Queryable,
    channelId: string,
    effect: string,
    viewerId: string | null,
  ) {
    return ms(
      (
        await q.query<{ at: Date | null }>(
          `select max(ended_at) as at from chaos_requests where channel_id = $1 and effect = $2
             and status = 'ended' and not charged and ($3::text is null or viewer_id = $3)`,
          [channelId, effect, viewerId],
        )
      )[0]?.at ?? null,
    );
  }

  /** What a credit leaves out of this setting, or null. */
  private static creditMismatch(credit: CreditRow, e: Effect, c: Choice) {
    const k = credit.constraints ?? {};
    if (credit.effect_id !== e.id) return 'credit_other_effect';
    if (k.max_duration_ms && c.duration * 1000 > k.max_duration_ms)
      return 'credit_duration';
    if (k.levels?.length && !k.levels.includes(c.level ?? ''))
      return 'credit_level';
    if (k.presets?.length && !k.presets.includes(c.style ?? ''))
      return 'credit_preset';
    return null;
  }

  // --- the rules: one evaluation for the quote and the purchase ------------------------------------------------

  /**
   * Price, outcome and the first refusal for this viewer and this setting, in the contract's order (§ 1): module closed /
   * suspended, global pause, live, viewer block, personal cooldown, Studio not ready, effect disabled in Studio, soft
   * mode, duration, delays, queue / charges, balance (quote only: the purchase lets the debit decide).
   */
  private async evaluate(
    q: Queryable,
    channelId: string,
    viewer: ChaosViewer | null,
    input: { effect: string; choice: ChaosChoice; credit_id?: string },
    o: { balance: boolean },
  ) {
    const e = effectById(input.effect);
    if (!e) throw new ChaosError(404, 'unknown_effect', 'unknown effect');
    const now = this.clock.now();
    const t = now.getTime();
    const studio = await this.studio(q, channelId);
    const capS = this.capS(studio);
    const c = normalizeChoice(e, input.choice, capS);
    const preset = presetOf(e, c);
    let block: Block | null = null;
    const refuse = (code: string, extra: Record<string, unknown> = {}) => {
      block ??= { code, ...extra };
    };

    if (!(await this.enabled(q, channelId))) refuse('disabled');
    if ((await this.channelState(q, channelId)) === 'paused') refuse('paused');
    if ((await globalState(q, channelId)).paused) refuse('global_pause');
    if (!(await liveForPaid(q, this.economy))) refuse(STREAM_OFFLINE);
    if (viewer) {
      if (await activeBlock(q, channelId, viewer.id, 'chaos', now))
        refuse('viewer_blocked');
      const imposed = await personalCooldownMs(
        q,
        channelId,
        viewer.id,
        'chaos',
        now,
      );
      if (imposed > 0) refuse('viewer_cooldown', { retry_after_ms: imposed });
    }
    if (!studio || !studio.engine_ready) refuse('studio_offline');
    else if (studio.effects?.[e.id]?.enabled !== true)
      refuse('effect_disabled');
    if (studio?.safe_mode && e.photosensitive) refuse('safe_mode');
    // Duration: the raw ask against the range of this live (the normalization would only clamp it).
    const range = durationRange(
      e,
      normalizeChoice(e, input.choice, ENGINE.maxDurationS),
      capS,
    );
    if (!range.fixed && Number(input.choice.duration) > range.max)
      refuse('duration_out_of_range', { max_s: range.max });

    // An effect credit pays instead of the Jetons (its own limits).
    let credit: CreditRow | null = null;
    if (input.credit_id) {
      credit =
        (
          await q.query<CreditRow>(
            `select * from chaos_effect_credits where id = $1 and channel_id = $2 and viewer_id = $3 and state = 'available'
               and (expires_at is null or expires_at > $4)`,
            [input.credit_id, channelId, viewer?.id ?? '', now],
          )
        )[0] ?? null;
      if (!credit) refuse('credit_unavailable');
      else {
        const why = ChaosService.creditMismatch(credit, e, c);
        if (why) refuse('credit_mismatch', { detail: why });
      }
    }
    const charged = !input.credit_id && !!preset?.charges;
    const open = await this.openRows(q, channelId);
    const charges =
      charged && viewer
        ? await this.chargesOf(q, channelId, viewer.id, e, preset!, t)
        : null;

    if (!charged) {
      if (viewer) {
        const mine = await this.lastEnded(q, channelId, e.id, viewer.id);
        if (mine !== null && mine + CHAOS_RULES.viewerCooldownMs > t)
          refuse('cooldown', {
            retry_after_ms: mine + CHAOS_RULES.viewerCooldownMs - t,
          });
      }
      if (e.globalCooldown) {
        const any = await this.lastEnded(q, channelId, e.id, null);
        if (any !== null && any + e.globalCooldown * 1000 > t)
          refuse('global_cooldown', {
            retry_after_ms: any + e.globalCooldown * 1000 - t,
          });
      }
    }
    const outcome = this.outcome(open, e, charged, t, studio);
    if (charged) {
      const pending = open.filter(
        (r) => r.charged && (r.status === 'queued' || r.status === 'claimed'),
      ).length;
      const recent = (
        await q.query<{ n: number | string }>(
          `select count(*) as n from chaos_requests where channel_id = $1 and charged and started_at > $2`,
          [channelId, new Date(t - 60_000)],
        )
      )[0]!;
      if (charges && charges.n < 1)
        refuse('no_charge', { next_s: charges.next_s });
      if (pending >= CHAOS_RULES.burst.maxPending) refuse('burst_full');
      if (Number(recent.n) + pending >= CHAOS_RULES.burst.perMinute)
        refuse('burst_rate');
    } else {
      const waiting = open.filter((r) => r.status === 'queued' && !r.charged);
      if (viewer) {
        const playing = open.find(
          (r) =>
            r.viewer_id === viewer.id &&
            r.effect === e.id &&
            !r.charged &&
            r.status === 'started',
        );
        if (playing) refuse('mine_active');
        if (
          open.some(
            (r) =>
              r.viewer_id === viewer.id &&
              !r.charged &&
              r.payment !== 'gift' &&
              (r.status === 'queued' || r.status === 'claimed'),
          )
        )
          refuse('one_waiting');
      }
      if (outcome.kind === 'queue' && waiting.length >= CHAOS_RULES.queueMax)
        refuse('queue_full');
    }
    const priced = rangePrice(e, c);
    const price = credit ? 0 : priced.total;
    if (o.balance && viewer && !credit && price > 0) {
      const tokens = (await this.economy.balances(q, channelId, viewer.id))
        .tokens;
      if (tokens < price)
        refuse('insufficient_funds', { balance: tokens, needed: price });
    }
    return {
      e,
      c,
      preset,
      price,
      full_price: priced.total,
      share: priced.share,
      range: priced.range,
      block: block as Block | null,
      charged,
      charges,
      credit,
      outcome,
      capS,
    };
  }

  /** Starts now, or waits (position, estimated wait): the engine's slots, Safety's active cap, one effect at a time. */
  private outcome(
    open: Row[],
    e: Effect,
    charged: boolean,
    now: number,
    studio: Studio | null,
  ): Outcome {
    const active = open.filter(
      (r) => r.status === 'claimed' || r.status === 'started',
    );
    const queued = open.filter((r) => r.status === 'queued');
    const slotOf = (r: Row) => effectById(r.effect)?.slot;
    const canStart =
      !!studio &&
      active.length < ENGINE.safetyMaxActive &&
      active.filter((r) => slotOf(r) === e.slot).length <
        (SLOTS[e.slot]?.capacity ?? 1) &&
      !active.some((r) => r.effect === e.id);
    if (charged) {
      const ahead = queued.filter((r) => r.charged);
      if (!ahead.length && canStart && !queued.some((r) => r.effect === e.id))
        return { kind: 'now' };
      return {
        kind: 'burst',
        position: ahead.length + 1,
        eta_s: this.eta(
          open,
          e,
          queued.filter((r) => r.effect === e.id),
          now,
        ),
      };
    }
    const waiting = queued.filter((r) => !r.charged);
    if (
      canStart &&
      !waiting.some((r) => slotOf(r) === e.slot) &&
      !queued.some((r) => r.charged && r.effect === e.id)
    )
      return { kind: 'now' };
    return {
      kind: 'queue',
      position: waiting.length + 1,
      eta_s: this.eta(open, e, waiting, now),
    };
  }

  /** Estimated wait (s) before an effect can start behind `ahead` (the fake Core's estimate, model.js `eta`). */
  private eta(open: Row[], e: Effect, ahead: Row[], now: number) {
    const slotOf = (r: Row) => effectById(r.effect)?.slot;
    const active = open.filter(
      (r) => r.status === 'claimed' || r.status === 'started',
    );
    const lanes = active
      .filter((r) => slotOf(r) === e.slot)
      .map((r) => remainingMs(r, now));
    while (lanes.length < (SLOTS[e.slot]?.capacity ?? 1)) lanes.push(0);
    for (const r of ahead.filter((x) => slotOf(x) === e.slot)) {
      lanes.sort((a, b) => a - b);
      lanes[0]! += r.duration_ms;
    }
    lanes.sort((a, b) => a - b);
    let wait = lanes[0]!;
    for (const r of [...active, ...ahead].filter((x) => x.effect === e.id))
      wait = Math.max(wait, remainingMs(r, now));
    if (active.length >= ENGINE.safetyMaxActive)
      wait = Math.max(
        wait,
        Math.min(...active.map((r) => remainingMs(r, now))),
      );
    return Math.max(0, Math.ceil(wait / 1000));
  }

  // --- viewer: quote, purchase, state --------------------------------------------------------------------------

  async quote(
    channelId: string,
    viewer: ChaosViewer | null,
    input: { effect: string; choice: ChaosChoice; credit_id?: string },
  ) {
    const x = await this.evaluate(this.db, channelId, viewer, input, {
      balance: true,
    });
    return {
      price: x.price,
      full_price: x.full_price,
      range: x.range,
      share: x.share,
      choice: x.c,
      engine_request: engineRequest(x.e, x.c),
      outcome: x.outcome,
      ...(x.block ? { block: x.block } : {}),
      ...(x.charges
        ? {
            charges: {
              n: x.charges.n,
              max: x.charges.max,
              next_s: x.charges.next_s,
            },
          }
        : {}),
      ...(x.credit ? { credit: this.creditView(x.credit) } : {}),
      cap_s: x.capS,
    };
  }

  /**
   * The purchase (contract § 2.2): channel lock, the intent looked up (same key + same content → the same answer,
   * `duplicate`; same key, other content → `idempotency_conflict`), every refusal before any debit, then in the SAME
   * transaction the request, the credit or the charge consumed and the Jetons debited. A refusal keeps nothing.
   */
  async buy(
    channelId: string,
    req: {
      viewer: ChaosViewer;
      idempotency_key: string;
      effect: string;
      choice: ChaosChoice;
      expected_price: number;
      credit_id?: string;
    },
  ) {
    try {
      return await this.buyTx(channelId, req);
    } catch (e) {
      if (!(e instanceof GlobalPauseError)) throw e;
      await countGlobalRefusal(this.db, channelId, this.clock.now());
      throw new ChaosError(409, 'global_pause', e.message);
    }
  }

  private async buyTx(
    channelId: string,
    req: Parameters<ChaosService['buy']>[1],
  ) {
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          'chaos',
          req.effect,
          req.choice,
          req.expected_price,
          req.credit_id ?? null,
        ]),
      )
      .digest('hex');
    return this.db.tx(async (q) => {
      await this.lock(q, channelId);
      const prior = (
        await q.query<Row>(
          'select * from chaos_requests where channel_id = $1 and viewer_id = $2 and idempotency_key = $3',
          [channelId, req.viewer.id, req.idempotency_key],
        )
      )[0];
      if (prior) {
        if (prior.request_hash !== hash)
          throw new ChaosError(
            409,
            'idempotency_conflict',
            'idempotency key already used for another purchase',
          );
        return {
          ok: true as const,
          request: this.view(prior, this.clock.now().getTime(), req.viewer.id),
          duplicate: true,
        };
      }
      await this.sweep(q, channelId);
      const x = await this.evaluate(q, channelId, req.viewer, req, {
        balance: false,
      });
      // The global pause is counted outside the transaction, like the other modules.
      if (x.block?.code === 'global_pause') throw new GlobalPauseError();
      if (x.block)
        throw new ChaosError(
          x.block.code === 'studio_offline' ? 503 : 409,
          x.block.code,
          x.block.code,
          x.block,
        );
      if (req.expected_price !== x.price)
        throw new ChaosError(409, 'price_changed', 'the price changed', {
          price: x.price,
        });
      const now = this.clock.now();
      const id = randomUUID();
      const payment: Payment = x.credit ? 'credit' : 'jetons';
      const engine = engineRequest(x.e, x.c);
      await q.query(
        `insert into chaos_requests (id, channel_id, viewer_id, viewer_name, idempotency_key, request_hash, effect, preset,
           level, choice, engine_request, duration_ms, price, payment, credit_id, charged, priority, status, created_at,
           expires_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 0, 'queued', $17, $18, $17)`,
        [
          id,
          channelId,
          req.viewer.id,
          req.viewer.display_name,
          req.idempotency_key,
          hash,
          x.e.id,
          x.c.style,
          x.c.level,
          JSON.stringify(x.c),
          JSON.stringify(engine),
          engine.duration_ms,
          x.price,
          payment,
          x.credit?.id ?? null,
          x.charged,
          now,
          new Date(now.getTime() + CHAOS_RULES.queueTtlMs),
        ],
      );
      if (x.credit) {
        // Consumed once: a concurrent use of the same credit finds it gone and rolls this purchase back.
        const used = await q.query(
          `update chaos_effect_credits set state = 'used', request_id = $3, updated_at = $4
           where id = $1 and viewer_id = $2 and state = 'available' returning 1`,
          [x.credit.id, req.viewer.id, id, now],
        );
        if (!used.length)
          throw new ChaosError(
            409,
            'credit_unavailable',
            'credit already used',
          );
        await this.creditEvent(
          q,
          x.credit.id,
          channelId,
          'used',
          req.viewer.id,
          null,
          id,
          now,
        );
      }
      if (x.charged && x.charges)
        await this.setCharges(
          q,
          channelId,
          req.viewer.id,
          x.e.id,
          x.preset!.id,
          x.charges.n - 1,
          x.charges.n >= x.charges.max ? now.getTime() : x.charges.at,
        );
      await seeViewer(
        q,
        channelId,
        req.viewer.id,
        req.viewer.display_name,
        now,
      );
      if (payment === 'jetons' && x.price > 0)
        try {
          await this.economy.debit(q, now, {
            channelId,
            viewer: req.viewer,
            currency: 'tokens',
            amount: x.price,
            module: 'chaos',
            interactionId: id,
          });
        } catch (e) {
          if (e instanceof LabWalletError && e.code === 'insufficient_tokens')
            throw new ChaosError(
              409,
              'insufficient_funds',
              'not enough Jetons',
              e.details,
            );
          throw e;
        }
      const row = (await this.byId(q, id))!;
      return {
        ok: true as const,
        request: this.view(row, now.getTime(), req.viewer.id),
        duplicate: false,
        outcome: x.outcome,
      };
    });
  }

  /** What the extension needs to draw the module (contract § 2.4), for one viewer (or anonymous). */
  async state(channelId: string, viewer: ChaosViewer | null) {
    const q = this.db;
    const now = this.clock.now();
    const t = now.getTime();
    const [enabled, cs, global, live, studio] = await Promise.all([
      this.enabled(q, channelId),
      this.channelState(q, channelId),
      globalState(q, channelId),
      liveForPaid(q, this.economy),
      this.studio(q, channelId),
    ]);
    const status =
      cs === 'paused' || global.paused
        ? 'paused'
        : !live
          ? 'offline'
          : !studio || !studio.engine_ready
            ? 'engine_down'
            : 'open';
    const open = await this.openRows(q, channelId);
    const views = this.views(open, t, viewer?.id ?? null);
    const mine = viewer
      ? (
          await q.query<Row>(
            'select * from chaos_requests where channel_id = $1 and viewer_id = $2 order by seq desc limit $3',
            [channelId, viewer.id, CHAOS_RULES.mineLimit],
          )
        ).map((r) => views.get(r.id) ?? this.view(r, t, viewer.id))
      : [];
    // Delays per effect (this viewer's, and the channel's for Flash).
    const cooldowns = new Map<string, number>();
    if (viewer)
      for (const r of await q.query<{ effect: string; at: Date }>(
        `select effect, max(ended_at) as at from chaos_requests where channel_id = $1 and viewer_id = $2
           and status = 'ended' and not charged group by effect`,
        [channelId, viewer.id],
      ))
        cooldowns.set(r.effect, ms(r.at)! + CHAOS_RULES.viewerCooldownMs);
    const globals = new Map<string, number>();
    for (const e of EFFECTS.filter((x) => x.globalCooldown)) {
      const at = await this.lastEnded(q, channelId, e.id, null);
      if (at !== null) globals.set(e.id, at + e.globalCooldown! * 1000);
    }
    const effects: Record<
      string,
      { available: boolean; reason?: string; until?: string }
    > = {};
    for (const e of EFFECTS) {
      const until = Math.max(cooldowns.get(e.id) ?? 0, globals.get(e.id) ?? 0);
      const reason = !enabled
        ? 'disabled'
        : status === 'paused'
          ? global.paused
            ? 'global_pause'
            : 'paused'
          : status === 'offline'
            ? STREAM_OFFLINE
            : status === 'engine_down'
              ? 'studio_offline'
              : studio?.effects?.[e.id]?.enabled !== true
                ? 'effect_disabled'
                : studio.safe_mode && e.photosensitive
                  ? 'safe_mode'
                  : until > t
                    ? (cooldowns.get(e.id) ?? 0) > t
                      ? 'cooldown'
                      : 'global_cooldown'
                    : null;
      effects[e.id] = reason
        ? {
            available: false,
            reason,
            ...(reason === 'cooldown' || reason === 'global_cooldown'
              ? { until: new Date(until).toISOString() }
              : {}),
          }
        : { available: true };
    }
    const charges: Record<
      string,
      { n: number; max: number; next_s: number | null }
    > = {};
    if (viewer)
      for (const e of EFFECTS)
        for (const p of e.presets ?? [])
          if (p.charges) {
            const ch = await this.chargesOf(q, channelId, viewer.id, e, p, t);
            charges[`${e.id}:${p.id}`] = {
              n: ch.n,
              max: ch.max,
              next_s: ch.next_s,
            };
          }
    const credits = viewer
      ? (
          await q.query<CreditRow>(
            `select * from chaos_effect_credits where channel_id = $1 and viewer_id = $2 and state = 'available'
               and (expires_at is null or expires_at > $3) order by granted_at desc`,
            [channelId, viewer.id, now],
          )
        ).map((c) => this.creditView(c))
      : [];
    const creditLog = viewer
      ? (
          await q.query<{
            credit_id: string;
            effect_id: string;
            kind: string;
            reason: string | null;
            request_id: string | null;
            at: Date;
          }>(
            `select e.credit_id, c.effect_id, e.kind, e.reason, e.request_id, e.at from chaos_effect_credit_events e
               join chaos_effect_credits c on c.id = e.credit_id
             where c.channel_id = $1 and c.viewer_id = $2 order by e.id desc limit 20`,
            [channelId, viewer.id],
          )
        ).map((l) => ({ ...l, at: iso(l.at) }))
      : [];
    const list = (pred: (r: Row) => boolean) =>
      open.filter(pred).map((r) => views.get(r.id)!);
    return {
      enabled,
      status,
      cap_s: this.capS(studio),
      safe_mode: !!studio?.safe_mode,
      queue_max: CHAOS_RULES.queueMax,
      burst_max: CHAOS_RULES.burst.maxPending,
      effects,
      active: list((r) => r.status === 'claimed' || r.status === 'started'),
      queue: list((r) => r.status === 'queued' && !r.charged),
      burst: list((r) => r.status === 'queued' && r.charged),
      mine,
      credits,
      credit_log: creditLog,
      charges,
    };
  }

  /** The Hub's line: whether the module is offered and this live's ceiling. */
  async summary(channelId: string) {
    const [enabled, studio] = await Promise.all([
      this.enabled(this.db, channelId),
      this.studio(this.db, channelId),
    ]);
    return { enabled, cap_s: this.capS(studio) };
  }

  /** Views of the open requests with their position, estimated wait, remaining time and progress. */
  private views(open: Row[], t: number, me: string | null) {
    const out = new Map<string, ReturnType<ChaosService['view']>>();
    const waiting = open.filter((r) => r.status === 'queued' && !r.charged);
    const burst = open.filter((r) => r.status === 'queued' && r.charged);
    for (const r of open) {
      const line = r.charged ? burst : waiting;
      const i = line.indexOf(r);
      const e = effectById(r.effect);
      out.set(
        r.id,
        this.view(
          r,
          t,
          me,
          r.status === 'queued' && e
            ? { position: i + 1, eta_s: this.eta(open, e, line.slice(0, i), t) }
            : {},
        ),
      );
    }
    return out;
  }

  /** A request as the extension and moderation show it (contract § 2.4 View). */
  private view(
    r: Row,
    t: number,
    me: string | null,
    extra: { position?: number; eta_s?: number } = {},
  ) {
    const started = ms(r.started_at);
    return {
      id: r.id,
      effect: r.effect,
      preset: r.preset,
      level: r.level,
      choice: r.choice,
      duration_ms: r.duration_ms,
      price: r.price,
      payment: r.payment,
      charged: r.charged,
      status: r.status,
      code: r.code,
      reason: r.reason,
      refund_status: r.refund_status,
      viewer_name: r.viewer_name,
      mine: me !== null && r.viewer_id === me,
      created_at: iso(r.created_at),
      started_at: iso(r.started_at),
      ended_at: iso(r.ended_at),
      ...(r.status === 'queued'
        ? {
            ...extra,
            expires_in_s: Math.max(
              0,
              Math.ceil((ms(r.expires_at)! - t) / 1000),
            ),
          }
        : {}),
      ...(r.status === 'started' && started !== null
        ? {
            remaining_s: Math.max(
              0,
              Math.ceil((started + r.duration_ms - t) / 1000),
            ),
            progress: Math.min(1, Math.max(0, (t - started) / r.duration_ms)),
          }
        : {}),
    };
  }

  /** The moderation's view: the viewer, who acted, the refund. */
  private modView(
    r: Row,
    t: number,
    extra: { position?: number; eta_s?: number } = {},
  ) {
    return {
      ...this.view(r, t, null, extra),
      viewer_id: r.viewer_id,
      actor: r.actor,
      played_ms: r.played_ms,
      refunded_at: iso(r.refunded_at),
      refund_reason: r.refund_reason,
      refundable:
        isFinal(r.status) && r.refund_status === 'none' && r.payment !== 'gift',
    };
  }

  private creditView(c: CreditRow) {
    return {
      id: c.id,
      viewer_id: c.viewer_id,
      viewer_name: c.viewer_name,
      effect: c.effect_id,
      constraints: c.constraints ?? {},
      source_kind: c.source_kind,
      reason: c.reason,
      granted_at: iso(c.granted_at),
      expires_at: iso(c.expires_at),
      state: c.state,
      request_id: c.request_id,
    };
  }

  // --- Studio: heartbeat, claim, ACK, STOP ALL -----------------------------------------------------------------

  /**
   * Studio's state every 3 s. The leases of what it still holds (`inflight`) are extended; `stop` lists what it holds
   * that must stop (stopped by moderation, removed, refunded, or late).
   */
  async heartbeat(channelId: string, h: ChaosHeartbeat) {
    return this.db.tx(async (q) => {
      await this.lock(q, channelId);
      const now = this.clock.now();
      await q.query(
        `insert into chaos_studios (studio_instance_id, channel_id, engine_ready, safety_max_ms, safe_mode, effects, last_seen)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (studio_instance_id) do update set channel_id = excluded.channel_id, engine_ready = excluded.engine_ready,
           safety_max_ms = excluded.safety_max_ms, safe_mode = excluded.safe_mode, effects = excluded.effects,
           last_seen = excluded.last_seen`,
        [
          h.studio_instance_id,
          channelId,
          h.engine_ready,
          h.safety_max_ms,
          h.safe_mode,
          JSON.stringify(h.effects),
          now,
        ],
      );
      const inflight = [...new Set(h.inflight)];
      if (inflight.length) {
        // Claimed: 30 s more to start, never beyond claimMaxMs after the claim. Started: at least 15 s more.
        await q.query(
          `update chaos_requests set lease_expires_at = least($4::timestamptz, claimed_at + make_interval(secs => $5)),
             updated_at = $3
           where channel_id = $1 and id = any($2::uuid[]) and status = 'claimed' and studio_instance_id = $6`,
          [
            channelId,
            inflight,
            now,
            new Date(now.getTime() + CHAOS_RULES.leaseMs),
            CHAOS_RULES.claimMaxMs / 1000,
            h.studio_instance_id,
          ],
        );
        await q.query(
          `update chaos_requests set lease_expires_at = greatest(lease_expires_at, $4::timestamptz), updated_at = $3
           where channel_id = $1 and id = any($2::uuid[]) and status = 'started' and studio_instance_id = $5`,
          [
            channelId,
            inflight,
            now,
            new Date(now.getTime() + CHAOS_RULES.startedMarginMs),
            h.studio_instance_id,
          ],
        );
      }
      await this.sweep(q, channelId);
      const stop = inflight.length
        ? (
            await q.query<{ id: string; reason: string }>(
              `select id, coalesce(stop_reason, code, status) as reason from chaos_requests
               where channel_id = $1 and id = any($2::uuid[])
                 and (status in ('ended', 'failed', 'canceled', 'expired') or stop_requested_at is not null)`,
              [channelId, inflight],
            )
          ).map((r) => ({ id: r.id, reason: r.reason }))
        : [];
      // `enabled`: Chaos open on this channel (a pause still counts): Studio starts its engine (idle) on it.
      return {
        ok: true as const,
        stop,
        enabled: await this.enabled(q, channelId),
      };
    });
  }

  /** The oldest waiting request whose effect can start now (`startable`), handed to this Studio with a 30 s lease. */
  async claim(channelId: string, studioId: string, startable: string[]) {
    return this.db.tx(async (q) => {
      const state = await this.lock(q, channelId);
      await this.sweep(q, channelId);
      const studio = await this.studio(q, channelId);
      if (
        !studio ||
        studio.studio_instance_id !== studioId ||
        !studio.engine_ready ||
        state !== 'open' ||
        !(await this.enabled(q, channelId))
      )
        return { item: null };
      const now = this.clock.now();
      // What Studio can no longer play (effect turned off, soft mode for a light effect) never will: refunded now.
      for (const r of await q.query<Row>(
        `select * from chaos_requests where channel_id = $1 and status = 'queued' order by priority desc, seq`,
        [channelId],
      )) {
        const e = effectById(r.effect);
        const why =
          studio.effects?.[r.effect]?.enabled !== true
            ? 'effect_disabled'
            : studio.safe_mode && e?.photosensitive
              ? 'safe_mode'
              : null;
        if (why)
          await this.fail(
            q,
            r.id,
            why,
            'Studio ne peut plus jouer cet effet',
            now,
          );
      }
      const can = new Set(startable);
      const lastEnd = new Map<string, number>();
      for (const r of await q.query<{ effect: string; at: Date }>(
        `select effect, max(ended_at) as at from chaos_requests where channel_id = $1 and ended_at is not null
           group by effect`,
        [channelId],
      ))
        lastEnd.set(r.effect, ms(r.at)!);
      const next = (
        await q.query<Row>(
          `select * from chaos_requests where channel_id = $1 and status = 'queued' order by priority desc, seq limit 50`,
          [channelId],
        )
      ).find(
        (r) =>
          can.has(r.effect) &&
          // Purchases « à charges »: one after the other, a short gap after the previous end.
          (!r.charged ||
            (lastEnd.get(r.effect) ?? 0) + CHAOS_RULES.burst.gapMs <=
              now.getTime()),
      );
      if (!next) return { item: null };
      const attempt = randomUUID();
      const lease = new Date(now.getTime() + CHAOS_RULES.leaseMs);
      await q.query(
        `update chaos_requests set status = 'claimed', studio_instance_id = $2, attempt_id = $3, claimed_at = $4,
           lease_expires_at = $5, updated_at = $4 where id = $1 and status = 'queued'`,
        [next.id, studioId, attempt, now, lease],
      );
      return {
        item: {
          id: next.id,
          attempt_id: attempt,
          effect: next.effect,
          engine_request: next.engine_request,
          duration_ms: next.duration_ms,
          lease_expires_at: lease.toISOString(),
        },
      };
    });
  }

  /**
   * Studio's outcome for its attempt. Idempotent; a final state never goes back; another attempt → attempt_mismatch.
   * Never started (refused, no frame, error…) → failed, refunded in full. Started then a breakdown → the interruption
   * policy (refunded under a share of the duration, the reason recorded). A late `started` on a request already
   * removed or refunded is recorded and stopped (heartbeat `stop`), never charged again.
   */
  async ack(channelId: string, requestId: string, a: ChaosAckRequest) {
    return this.db.tx(async (q) => {
      const found = await this.byId(q, requestId);
      if (!found || found.channel_id !== channelId)
        throw new ChaosError(404, 'request_not_found');
      await this.lock(q, channelId);
      await q.query('select 1 from chaos_requests where id = $1 for update', [
        requestId,
      ]);
      const cur = (await this.byId(q, requestId))!;
      if (
        cur.attempt_id !== a.attempt_id ||
        cur.studio_instance_id !== a.studio_instance_id
      )
        throw new ChaosError(
          409,
          'attempt_mismatch',
          'this attempt does not own the request',
        );
      const now = this.clock.now();
      const t = now.getTime();
      const elapsed = () =>
        Math.min(
          cur.duration_ms,
          Math.max(
            0,
            a.played_ms ?? (cur.started_at ? t - ms(cur.started_at)! : 0),
          ),
        );
      switch (a.event) {
        case 'started':
          if (cur.started_at !== null) break; // replay
          if (cur.status === 'claimed') {
            await q.query(
              `update chaos_requests set status = 'started', started_at = $2, lease_expires_at = $3, updated_at = $2
               where id = $1 and status = 'claimed'`,
              [
                requestId,
                now,
                new Date(t + cur.duration_ms + CHAOS_RULES.startedMarginMs),
              ],
            );
            break;
          }
          // Removed / failed / expired meanwhile: it is on screen anyway — recorded, stopped, never charged again.
          await q.query(
            `update chaos_requests set started_at = $2, stop_requested_at = coalesce(stop_requested_at, $2),
               stop_reason = coalesce(stop_reason, 'late_start'), updated_at = $2 where id = $1`,
            [requestId, now],
          );
          break;
        case 'ended': {
          if (cur.status !== 'started' && cur.status !== 'claimed') break; // final already: accepted, ignored
          const played = elapsed();
          await q.query(
            `update chaos_requests set status = 'ended', started_at = coalesce(started_at, $3), ended_at = $2,
               played_ms = $4, code = $5, reason = $6, updated_at = $2 where id = $1 and status in ('claimed', 'started')`,
            [
              requestId,
              now,
              new Date(t - played),
              played,
              a.code ?? null,
              a.reason ?? null,
            ],
          );
          if (a.code && BREAKDOWNS.has(a.code))
            await this.interrupted(q, cur, played, a.code);
          break;
        }
        case 'failed': {
          if (isFinal(cur.status)) break;
          if (cur.status === 'claimed' && cur.started_at === null) {
            await this.fail(
              q,
              requestId,
              a.code ?? 'engine_refused',
              a.reason ?? null,
              now,
            );
            break;
          }
          // Failed after its start: a breakdown, the interruption policy.
          const played = elapsed();
          const code = a.code ?? 'engine_exit';
          await q.query(
            `update chaos_requests set status = 'ended', ended_at = $2, played_ms = $3, code = $4, reason = $5,
               updated_at = $2 where id = $1 and status = 'started'`,
            [requestId, now, played, code, a.reason ?? null],
          );
          await this.interrupted(q, cur, played, code);
          break;
        }
      }
      return this.modView((await this.byId(q, requestId))!, t);
    });
  }

  /** Studio's STOP ALL: what waits or was handed out is removed and refunded; what plays is stopped (25 % rule). */
  async stopAll(channelId: string, studioId: string) {
    return this.db.tx(async (q) => {
      await this.lock(q, channelId);
      await this.sweep(q, channelId);
      const actor: Actor = { id: studioId, role: 'broadcaster', via: 'studio' };
      return this.stopEverything(
        q,
        channelId,
        actor,
        'broadcaster',
        'Studio : tout arrêter',
        {
          waiting: true,
        },
      );
    });
  }

  // --- refunds -------------------------------------------------------------------------------------------------

  /**
   * At most once (conditional update, then the economy's own once-only key): the Jetons debited, or the effect credit
   * used (given back as a credit, never Jetons), and the charge of a purchase « à charges » that never played. Audited.
   */
  private async refund(
    q: Queryable,
    id: string,
    actor: Actor,
    reason: string,
    role?: LabRole,
  ): Promise<boolean> {
    const now = this.clock.now();
    const r = (
      await q.query<Row>(
        `update chaos_requests set refund_status = 'refunded', refunded_at = $2, refund_reason = $3, updated_at = $2
         where id = $1 and refund_status = 'none' and payment <> 'gift' returning *`,
        [id, now, reason],
      )
    )[0];
    if (!r) return false;
    let amount = 0;
    if (r.payment === 'credit' && r.credit_id) {
      const back = await q.query(
        `update chaos_effect_credits set state = 'available', request_id = null, updated_at = $3
         where id = $1 and request_id = $2 and state = 'used' returning 1`,
        [r.credit_id, id, now],
      );
      if (back.length)
        await this.creditEvent(
          q,
          r.credit_id,
          r.channel_id,
          'restored',
          actorName(actor),
          reason,
          id,
          now,
        );
    } else if (r.price > 0)
      amount = (await this.economy.refund(q, now, id, actorName(actor), reason))
        .amount;
    if (r.charged && !r.started_at) await this.giveCharge(q, r, now.getTime());
    await audit(q, now, {
      channelId: r.channel_id,
      actor,
      role,
      module: 'chaos',
      action: 'refund',
      viewerId: r.viewer_id,
      interactionId: id,
      reason,
      before: { refund_status: 'none' },
      after: { refund_status: 'refunded', payment: r.payment, amount },
    });
    return true;
  }

  /** Never started: failed and refunded in full, automatically (an economic refusal leaves it to moderation). */
  private async fail(
    q: Queryable,
    id: string,
    code: string,
    reason: string | null,
    now: Date,
  ) {
    const done = await q.query(
      `update chaos_requests set status = 'failed', code = $2, reason = $3, updated_at = $4
       where id = $1 and status in ('queued', 'claimed') returning 1`,
      [id, code, reason, now],
    );
    if (done.length)
      await deferrableRefund(q, () => this.refund(q, id, SYSTEM, code));
  }

  /** Started then a breakdown: refunded when it played less than the setting's share of its duration. */
  private async interrupted(
    q: Queryable,
    r: Row,
    playedMs: number,
    code: string,
  ) {
    const pct = await this.settings.get(
      q,
      r.channel_id,
      'chaos.interrupted_refund_below',
    );
    const refund = playedMs < (pct / 100) * r.duration_ms;
    const share = Math.round((playedMs / r.duration_ms) * 100);
    await q.query(
      `update chaos_requests set reason = coalesce(reason || ' · ', '') || $2 where id = $1`,
      [
        r.id,
        `${code} à ${share} % : ${refund ? 'remboursé' : `non remboursé (joué au moins ${pct} %)`}`,
      ],
    );
    if (refund)
      await deferrableRefund(q, () =>
        this.refund(q, r.id, SYSTEM, `interrupted:${code}`),
      );
  }

  // --- sweep ---------------------------------------------------------------------------------------------------

  /**
   * Overdue work, under the channel lock: never claimed in 180 s → expired, refunded; claimed, lease over, never started
   * → failed `no_ack`, refunded; started, no end after its duration + 15 s → ended `unknown_end` (it played: not
   * refunded automatically, moderation can). A communication error never costs Jetons.
   */
  private async sweep(q: Queryable, channelId: string) {
    const now = this.clock.now();
    for (const r of await q.query<{ id: string }>(
      `update chaos_requests set status = 'expired', code = 'queue_expired', reason = 'Jamais démarré en 3 min',
         updated_at = $2 where channel_id = $1 and status = 'queued' and expires_at < $2 returning id`,
      [channelId, now],
    ))
      await deferrableRefund(q, () =>
        this.refund(q, r.id, SYSTEM, 'queue_expired'),
      );
    for (const r of await q.query<{ id: string }>(
      `update chaos_requests set status = 'failed', code = 'no_ack', reason = 'Démarrage jamais confirmé',
         updated_at = $2 where channel_id = $1 and status = 'claimed' and lease_expires_at < $2 returning id`,
      [channelId, now],
    ))
      await deferrableRefund(q, () => this.refund(q, r.id, SYSTEM, 'no_ack'));
    await q.query(
      `update chaos_requests set status = 'ended', code = 'unknown_end', reason = 'Fin jamais confirmée',
         ended_at = $2, played_ms = duration_ms, updated_at = $2
       where channel_id = $1 and status = 'started' and lease_expires_at < $2`,
      [channelId, now],
    );
  }

  /** Time-driven (every 5 s, and at the Core's start): every channel with overdue work, each under its own lock. */
  async sweepExpired(): Promise<number> {
    const channels = await this.db.query<{ channel_id: string }>(
      `select distinct channel_id from chaos_requests
       where (status = 'queued' and expires_at < $1) or (status in ('claimed', 'started') and lease_expires_at < $1)`,
      [this.clock.now()],
    );
    for (const { channel_id } of channels)
      await this.db.tx(async (q) => {
        await this.lock(q, channel_id);
        await this.sweep(q, channel_id);
      });
    return channels.length;
  }

  // --- moderation (D4, inside the moderation transaction, after the permission check) --------------------------

  /** Permission(s) of a command (lab-moderation/store.ts PERMISSIONS). */
  static needs(cmd: ChaosModerationCommand): string[] {
    switch (cmd.action) {
      case 'stop':
        return ['queue.stop', ...(cmd.refund === true ? ['refund'] : [])];
      case 'cancel':
        return ['queue.cancel', ...(cmd.refund ? ['refund'] : [])];
      case 'refund':
        return ['refund.manual'];
      case 'pause':
        return [cmd.paused ? 'module.pause' : 'module.resume'];
      case 'stop_all':
        return ['queue.stop'];
      case 'gift':
        return ['chaos.gift'];
      case 'credit_grant':
      case 'credit_revoke':
        return ['chaos.credits'];
    }
  }

  /** Stops a started request now (ended, `stopped_by_*`): refunded by choice, or by default under 25 % played. */
  private async stopStarted(
    q: Queryable,
    r: Row,
    refund: boolean | undefined,
    reason: string | null,
    actor: Actor,
    role: LabRole,
    code: string,
  ) {
    const now = this.clock.now();
    const played = Math.min(
      r.duration_ms,
      Math.max(0, now.getTime() - (ms(r.started_at) ?? now.getTime())),
    );
    const give = refund ?? played < CHAOS_RULES.stopRefundBelow * r.duration_ms;
    const done = await q.query(
      `update chaos_requests set status = 'ended', ended_at = $2, played_ms = $3, code = $4, reason = $5, actor = $6,
         stop_requested_at = $2, stop_refund = $7, stop_reason = $5, updated_at = $2
       where id = $1 and status = 'started' returning 1`,
      [r.id, now, played, code, reason ?? code, actorName(actor), give],
    );
    if (!done.length) return false;
    const refunded = give
      ? await this.refund(q, r.id, actor, reason ?? code, role)
      : false;
    await audit(q, now, {
      channelId: r.channel_id,
      actor,
      role,
      module: 'chaos',
      action: 'stop',
      viewerId: r.viewer_id,
      interactionId: r.id,
      reason,
      before: { status: r.status },
      after: { status: 'ended', played_ms: played, refund: give, refunded },
    });
    return refunded;
  }

  /** Removes a request not started yet (canceled): refunded unless the moderator chose otherwise (with a reason). */
  private async cancelWaiting(
    q: Queryable,
    r: Row,
    refund: boolean,
    reason: string | null,
    actor: Actor,
    role: LabRole,
    code = 'canceled_by_moderator',
  ) {
    const now = this.clock.now();
    const done = await q.query(
      `update chaos_requests set status = 'canceled', code = $2, reason = $3, actor = $4, updated_at = $5,
         stop_requested_at = case when status = 'claimed' then $5 else stop_requested_at end
       where id = $1 and status in ('queued', 'claimed') returning 1`,
      [r.id, code, reason ?? code, actorName(actor), now],
    );
    if (!done.length) return false;
    const refunded = refund
      ? await this.refund(q, r.id, actor, reason ?? code, role)
      : false;
    await audit(q, now, {
      channelId: r.channel_id,
      actor,
      role,
      module: 'chaos',
      action: 'cancel',
      viewerId: r.viewer_id,
      interactionId: r.id,
      reason,
      before: { status: r.status },
      after: { status: 'canceled', refund, refunded },
    });
    return refunded;
  }

  private async stopEverything(
    q: Queryable,
    channelId: string,
    actor: Actor,
    role: LabRole,
    reason: string,
    o: { waiting: boolean },
  ) {
    const open = await this.openRows(q, channelId);
    let stopped = 0;
    let canceled = 0;
    for (const r of open)
      if (r.status === 'started') {
        await this.stopStarted(
          q,
          r,
          undefined,
          reason,
          actor,
          role,
          actor.via === 'studio' ? 'stopped_by_studio' : 'stopped_by_moderator',
        );
        stopped += 1;
      } else if (r.status === 'claimed' || o.waiting) {
        await this.cancelWaiting(
          q,
          r,
          true,
          reason,
          actor,
          role,
          actor.via === 'studio' ? 'studio_stop_all' : 'canceled_by_moderator',
        );
        canceled += 1;
      }
    return { ok: true as const, stopped, canceled };
  }

  private requireReason(
    paid: boolean,
    refund: boolean | undefined,
    reason: string | null | undefined,
  ) {
    if (refund === false && paid && !hasReason(reason))
      throw new ChaosError(
        409,
        'reason_required',
        'a reason is required without refund',
      );
  }

  async applyModeration(
    q: Queryable,
    channelId: string,
    cmd: ChaosModerationCommand,
    actor: Actor,
    role: LabRole,
  ): Promise<Record<string, unknown>> {
    await this.lock(q, channelId);
    await this.sweep(q, channelId);
    const now = this.clock.now();
    const reason = 'reason' in cmd ? cmd.reason?.trim() || null : null;
    const row = async (id: string) => {
      const r = await this.byId(q, id);
      if (!r || r.channel_id !== channelId)
        throw new ChaosError(404, 'request_not_found');
      return r;
    };
    switch (cmd.action) {
      case 'stop':
      case 'cancel': {
        const r = await row(cmd.id);
        const paid = r.payment !== 'gift';
        this.requireReason(paid, cmd.refund, reason);
        if (r.status === 'started') {
          // A request removed while it starts is stopped, with the refund that was wanted.
          const refunded = await this.stopStarted(
            q,
            r,
            cmd.refund,
            reason,
            actor,
            role,
            'stopped_by_moderator',
          );
          return { ok: true, status: 'ended', refunded, started: true };
        }
        if (r.status === 'queued' || r.status === 'claimed') {
          const refunded = await this.cancelWaiting(
            q,
            r,
            cmd.refund ?? true,
            reason,
            actor,
            role,
          );
          return { ok: true, status: 'canceled', refunded };
        }
        throw new ChaosError(409, 'not_open', 'this request is already over');
      }
      case 'refund': {
        const r = await row(cmd.id);
        if (!isFinal(r.status))
          throw new ChaosError(409, 'not_terminal', 'stop or remove it first');
        if (r.payment === 'gift')
          throw new ChaosError(
            409,
            'nothing_to_refund',
            'a gift costs nothing',
          );
        if (!(await this.refund(q, r.id, actor, reason!, role)))
          throw new ChaosError(409, 'already_refunded', 'already refunded');
        return { ok: true, refunded: true };
      }
      case 'pause': {
        const before = await this.channelState(q, channelId);
        const state = cmd.paused ? 'paused' : 'open';
        await q.query(
          'update chaos_channels set state = $2, updated_at = $3, updated_by = $4 where channel_id = $1',
          [channelId, state, now, actorName(actor)],
        );
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'chaos',
          action: cmd.paused ? 'module_paused' : 'module_active',
          reason,
          before: { state: before },
          after: { state },
        });
        return { ok: true, module_state: cmd.paused ? 'paused' : 'active' };
      }
      case 'stop_all': {
        // « Tout arrêter »: what plays stops (25 % rule) and what was handed out is removed; purchases are suspended, the
        // queue waits (it expires refunded if nobody reopens).
        const out = await this.stopEverything(
          q,
          channelId,
          actor,
          role,
          reason ?? 'Tout arrêter',
          {
            waiting: false,
          },
        );
        await q.query(
          `update chaos_channels set state = 'paused', updated_at = $2, updated_by = $3 where channel_id = $1`,
          [channelId, now, actorName(actor)],
        );
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'chaos',
          action: 'stop_all',
          reason,
          after: {
            stopped: out.stopped,
            canceled: out.canceled,
            state: 'paused',
          },
        });
        return { ...out, module_state: 'paused' };
      }
      case 'gift': {
        const e = effectById(cmd.effect);
        if (!e) throw new ChaosError(404, 'unknown_effect');
        if (!(await this.enabled(q, channelId)))
          throw new ChaosError(409, 'disabled', 'Chaos is closed');
        const c = normalizeChoice(
          e,
          cmd.choice,
          this.capS(await this.studio(q, channelId)),
        );
        const engine = engineRequest(e, c);
        const id = randomUUID();
        await q.query(
          `insert into chaos_requests (id, channel_id, viewer_id, viewer_name, idempotency_key, request_hash, effect, preset,
             level, choice, engine_request, duration_ms, price, payment, charged, priority, status, actor, reason,
             created_at, expires_at, updated_at)
           values ($1, $2, $3, $4, $5, 'gift', $6, $7, $8, $9, $10, $11, 0, 'gift', false, 1, 'queued', $12, $13, $14, $15, $14)`,
          [
            id,
            channelId,
            actor.id,
            actor.display_name ?? 'Modération',
            `gift:${id}`,
            e.id,
            c.style,
            c.level,
            JSON.stringify(c),
            JSON.stringify(engine),
            engine.duration_ms,
            actorName(actor),
            reason,
            now,
            new Date(now.getTime() + CHAOS_RULES.queueTtlMs),
          ],
        );
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'chaos',
          action: 'gift',
          interactionId: id,
          reason,
          after: { effect: e.id, choice: c },
        });
        return {
          ok: true,
          request: this.modView((await this.byId(q, id))!, now.getTime()),
        };
      }
      case 'credit_grant': {
        const e = effectById(cmd.effect);
        if (!e) throw new ChaosError(404, 'unknown_effect');
        const id = randomUUID();
        const name =
          cmd.viewer_name ??
          (
            await q.query<{ display_name: string }>(
              'select display_name from lab_viewers where channel_id = $1 and viewer_id = $2',
              [channelId, cmd.viewer_id],
            )
          )[0]?.display_name ??
          null;
        await q.query(
          `insert into chaos_effect_credits (id, channel_id, viewer_id, viewer_name, effect_id, constraints, source_kind,
             source_actor_id, reason, granted_at, expires_at, state, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'available', $10)`,
          [
            id,
            channelId,
            cmd.viewer_id,
            name,
            e.id,
            JSON.stringify(cmd.constraints),
            actor.via === 'studio' || role === 'broadcaster'
              ? 'streamer'
              : 'moderator',
            actor.id,
            cmd.reason,
            now,
            cmd.expires_at ? new Date(cmd.expires_at) : null,
          ],
        );
        await this.creditEvent(
          q,
          id,
          channelId,
          'granted',
          actorName(actor),
          cmd.reason,
          null,
          now,
        );
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'chaos',
          action: 'credit_grant',
          viewerId: cmd.viewer_id,
          reason: cmd.reason,
          after: { credit_id: id, effect: e.id, constraints: cmd.constraints },
        });
        return { ok: true, credit_id: id };
      }
      case 'credit_revoke': {
        const done = await q.query<{ viewer_id: string }>(
          `update chaos_effect_credits set state = 'revoked', updated_at = $3
           where id = $1 and channel_id = $2 and state = 'available' returning viewer_id`,
          [cmd.credit_id, channelId, now],
        );
        if (!done.length)
          throw new ChaosError(
            409,
            'credit_unavailable',
            'this credit is no longer available',
          );
        await this.creditEvent(
          q,
          cmd.credit_id,
          channelId,
          'revoked',
          actorName(actor),
          cmd.reason,
          null,
          now,
        );
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'chaos',
          action: 'credit_revoke',
          viewerId: done[0]!.viewer_id,
          reason: cmd.reason,
          after: { credit_id: cmd.credit_id, state: 'revoked' },
        });
        return { ok: true };
      }
    }
  }

  /** D4 overview key `chaos`: purchases' state, playing, waiting, charges' queue, recent, credits not used yet. */
  async moderationView(channelId: string) {
    const q = this.db;
    const t = this.clock.now().getTime();
    const [state, enabled, open, recent, credits] = await Promise.all([
      this.channelState(q, channelId),
      this.enabled(q, channelId),
      this.openRows(q, channelId),
      q.query<Row>(
        'select * from chaos_requests where channel_id = $1 order by seq desc limit $2',
        [channelId, CHAOS_RULES.recentLimit],
      ),
      q.query<CreditRow>(
        `select * from chaos_effect_credits where channel_id = $1 and state = 'available' order by granted_at desc limit 100`,
        [channelId],
      ),
    ]);
    const views = this.views(open, t, null);
    const mod = (r: Row) => {
      const v = views.get(r.id);
      return {
        ...this.modView(r, t),
        ...(v && 'position' in v
          ? { position: v.position, eta_s: v.eta_s }
          : {}),
      };
    };
    return {
      module_state: state === 'paused' ? 'paused' : 'active',
      enabled,
      queue_max: CHAOS_RULES.queueMax,
      burst_max: CHAOS_RULES.burst.maxPending,
      active: open
        .filter((r) => r.status === 'claimed' || r.status === 'started')
        .map(mod),
      queue: open.filter((r) => r.status === 'queued' && !r.charged).map(mod),
      burst: open.filter((r) => r.status === 'queued' && r.charged).map(mod),
      recent: recent.map(mod),
      credits_pending: credits.map((c) => this.creditView(c)),
    };
  }

  private async creditEvent(
    q: Queryable,
    creditId: string,
    channelId: string,
    kind: string,
    actor: string,
    reason: string | null,
    requestId: string | null,
    now: Date,
  ) {
    await q.query(
      `insert into chaos_effect_credit_events (credit_id, channel_id, kind, actor, reason, request_id, at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [creditId, channelId, kind, actor, reason, requestId, now],
    );
  }
}
