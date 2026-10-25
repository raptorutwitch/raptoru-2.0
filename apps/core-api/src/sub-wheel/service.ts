import { randomInt, randomUUID } from 'node:crypto';
import {
  type AlertEventInput,
  type LoyaltyEvent,
  SUB_WHEEL,
  subWheelAmount,
  subWheelLayout,
  type SwAnimationReport,
  type SwAwardStatus,
  type SwGrantInput,
  type SwMode,
  type SwRedrawInput,
  type SwReviewDecision,
  type SwStatus,
  type SwTestRequest,
} from '@raptoru/schemas';
import { liveChannelSession } from '../stream/channel-sessions.js';
import { activeSession } from '../stream/stream-sessions.js';
import {
  adoptOrphans,
  findProof,
  findRenewal,
  lastCertainMonth,
  lockViewer,
  type MonthSource,
  readMode,
  recordProof,
  type SwEvidence,
} from './rights.js';
import {
  autoRights,
  type Candidate,
  type PresenceMode,
  presenceOf,
  requestedRights,
} from './draws.js';
import {
  flagSameMonth,
  openReviews,
  possibleDuplicates,
  recheckAfterConfirmation,
  underReview,
} from './review.js';
import type { Clock } from '../clock.js';
import { insertAnnouncement } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import { type EconomyPort, occurredBeforeCutover } from '../economy/economy.js';
import {
  type Actor,
  actorName,
  assertAllowed,
  LabForbiddenError,
  LabWalletError,
} from '../lab-moderation/store.js';
import { CurrencyCreditError } from '../raffle-lab/currencies.js';

// Roue du Sub (docs/SUB_WHEEL.md) — the ONE implementation (Lab Core, production Core). Core decides: one wheel per
// admissible event (a sub, a resub or a Prime, never a gift) — the dedup key is the alert event (EventSub chat
// notification id: a redelivery is the same event); the segment is drawn here (crypto, uniform, the legacy layout of
// the months) and the gain computed and recorded ONCE, before any animation. Studio only shows that result. A failed
// animation never draws again nor changes the gain.
// Gains (Phase 2 lot 5): recorded « pending ». With the canonical Wallet as the runtime's economy, a gain decided by a
// spin admitted from then on is credited in the SAME transaction as the spin (key move:sub_wheel:<spin id>: a
// redelivered event, a replay, two Cores never pay twice; a refused credit stays « pending » with its reason). A gain
// pending from before (the StreamElements era) is never credited automatically: reconciled by hand, or paid by an
// explicit award(). With any other economy nothing is credited (SAMMI / StreamElements keep paying the live wheel).
// The switch is OFF by default: a real sub is then recorded « ignored » (nothing drawn, nothing owed).

export class SwError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Readable details for the caller (e.g. how many rights the viewer can still use). */
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

interface Row {
  spin_id: string;
  channel_id: string;
  source: 'twitch' | 'simulation' | 'test' | 'manual' | 'reconcile';
  event_key: string;
  alert_id: string | null;
  type: 'sub' | 'resub';
  viewer_id: string | null;
  viewer_login: string | null;
  viewer_name: string;
  tier: 1 | 2 | 3;
  months: number;
  status: SwStatus;
  reason: string | null;
  segment: number | null;
  amount: number | string | null;
  award_status: SwAwardStatus;
  award_ref: string | null;
  award_note: string | null;
  award_updated_at: Date | null;
  animation_consumer: string | null;
  animation_lease_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  shown_at: Date | null;
  // V2 (null on V1 rows).
  queue: 'auto' | 'manual' | null;
  sub_month: number | null;
  month_source: MonthSource | null;
  acquired_at: Date | null;
  confirmed_at: Date | null;
  drawn_at: Date | null;
  requested_at?: Date | null;
  requested_by?: string | null;
  requested_via?: string | null;
  /** RV2-2: the draw this exceptional new draw follows (null otherwise). */
  redraw_of?: string | null;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export const spinView = (r: Row) => ({
  spin_id: r.spin_id,
  source: r.source,
  type: r.type,
  viewer: { id: r.viewer_id, login: r.viewer_login, name: r.viewer_name },
  tier: r.tier,
  months: r.months,
  status: r.status,
  reason: r.reason,
  segment: r.segment,
  amount: r.amount === null ? null : Number(r.amount),
  award: {
    status: r.award_status,
    ref: r.award_ref,
    note: r.award_note,
    updated_at: iso(r.award_updated_at),
  },
  created_at: iso(r.created_at),
  shown_at: iso(r.shown_at),
  /** RV2-2: an exceptional new draw — the draw it follows. */
  redraw_of: r.redraw_of ?? null,
  // V2 right (null on V1 rows): its queue, its month and how sure it is.
  right: {
    queue: r.queue ?? null,
    sub_month: r.sub_month ?? null,
    month_source: r.month_source ?? null,
    acquired_at: iso(r.acquired_at ?? null),
    drawn_at: iso(r.drawn_at ?? null),
  },
});

/** Twitch tier → wheel tier (legacy: Prime and unknown are T1). */
const tierOf = (t: AlertEventInput['tier']): 1 | 2 | 3 =>
  t === '2000' ? 2 : t === '3000' ? 3 : 1;

/**
 * The chat announcement waits this long after the end of the animation (the result is seen on stream first): the
 * channel's setting (`sw_settings.announce_delay_s`, Studio, broadcaster only), this by default.
 */
export const SW_ANNOUNCE_DELAY_MS = 8_000;
/** Bounds of that setting (seconds), as the database checks them. */
export const SW_ANNOUNCE_DELAY_MAX_S = 60;

/** RV2-2: the viewer's rights it can use now (owed or requested, not « À vérifier »): a grant waits for them. */
async function usableRights(q: Queryable, channelId: string, viewerId: string) {
  return Number(
    (
      await q.query<{ n: number }>(
        `select count(*)::int as n from sw_spins s where s.channel_id = $1 and s.viewer_id = $2
           and s.status in ('owed', 'requested')
           and not exists (select 1 from sw_spin_reviews v where v.spin_id = s.spin_id
             and v.status in ('open', 'unresolved'))`,
        [channelId, viewerId],
      )
    )[0]!.n,
  );
}

export class SubWheelService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** Tests only: a deterministic draw (default: crypto). */
    private readonly draw: (n: number) => number = (n) => randomInt(n),
    /** The runtime's economy: gains are credited only when it is the canonical Wallet. */
    private readonly economy: EconomyPort | null = null,
    /**
     * Lab Core only: the gains are also credited on the Lab test wallet (test data, its own ledger kind, one row per
     * spin). Never set by the main Core.
     */
    private readonly options: { labCredits?: boolean } = {},
  ) {}

  private get canonical() {
    return this.economy?.mode === 'canonical';
  }

  /** Who pays a decided gain: the canonical Wallet, or — Lab Core only — the Lab test wallet. */
  private get paying() {
    return (
      this.canonical ||
      (this.options.labCredits === true && this.economy?.mode === 'lab')
    );
  }

  /**
   * Credits a pending gain of a LOCKED spin row, in the caller's transaction. Zero → awarded without any movement;
   * no Twitch ID → stays pending (beneficiary unknown); a refused credit → stays pending with its reason (strict: the
   * refusal is the caller's error instead). Never marked awarded without the Wallet movement.
   */
  private async credit(q: Queryable, r: Row, strict: boolean): Promise<Row> {
    const now = this.now();
    const mark = async (
      status: SwAwardStatus,
      ref: string | null,
      note: string | null,
    ) => {
      await q.query(
        `update sw_spins set award_status = $2, award_ref = $3, award_note = $4, award_updated_at = $5, updated_at = $5
         where spin_id = $1`,
        [r.spin_id, status, ref, note, now],
      );
      return (
        await q.query<Row>('select * from sw_spins where spin_id = $1', [
          r.spin_id,
        ])
      )[0]!;
    };
    const amount = Number(r.amount);
    if (amount === 0)
      return mark('awarded', null, 'gain nul : aucun mouvement');
    if (!r.viewer_id) {
      if (strict) throw new SwError(409, 'beneficiary_unknown');
      return mark('pending', null, 'bénéficiaire sans Twitch ID : à régler');
    }
    await q.query('savepoint sub_wheel_credit');
    try {
      const { ledgerId } = await this.economy!.move(q, now, {
        channelId: r.channel_id,
        viewerId: r.viewer_id,
        currency: 'tokens',
        amount,
        kind: 'sub_wheel',
        key: r.spin_id,
        moduleId: 'sub_wheel',
      });
      await q.query('release savepoint sub_wheel_credit');
      return mark('awarded', `wallet_transactions:${ledgerId}`, null);
    } catch (e) {
      await q.query('rollback to savepoint sub_wheel_credit');
      if (!(e instanceof LabWalletError || e instanceof CurrencyCreditError))
        throw e;
      if (strict) throw new SwError(409, 'credit_refused');
      return mark('pending', null, `crédit refusé : ${e.code}`.slice(0, 200));
    }
  }

  /**
   * The winner announcement in chat (« 🎡 Roue du Sub : @Pseudo gagne X Jetons ! »), on LeCroupier_'s durable queue,
   * once per spin (its key): only a real viewer's spin — a Twitch sub, a spin granted by hand (« Accorder un tour »)
   * or a reconciled one — whose gain is credited and whose wheel was SHOWN — sent the channel's announcement delay after
   * the end of the animation (or at once when the credit comes later). Tests, simulations, zero gains, unpaid gains and failed
   * animations: nothing.
   */
  private async announce(q: Queryable, r: Row, delayMs: number) {
    const amount = Number(r.amount);
    if (
      !(
        r.source === 'twitch' ||
        r.source === 'manual' ||
        r.source === 'reconcile'
      ) ||
      r.status !== 'shown' ||
      r.award_status !== 'awarded' ||
      !(amount > 0)
    )
      return;
    const n = amount.toLocaleString('fr-FR').replace(/\s/g, ' ');
    await insertAnnouncement(q, {
      channelId: r.channel_id,
      now: this.now(),
      origin: 'sub_wheel',
      drafts: [
        {
          idempotencyKey: `sub_wheel:win:${r.spin_id}`,
          mode: 'normal',
          text: `🎡 @${r.viewer_name} remporte ${n} ${amount >= 2 ? 'jetons' : 'jeton'} à la Roue du Sub !`,
          delayMs,
        },
      ],
    });
  }

  private now() {
    return this.clock.now();
  }

  private presence?: Promise<PresenceMode>;
  /**
   * The production schema (main Core) has the Daily's stream sessions and the chatters presence (tracked); the
   * dedicated Lab database (Studio's Lab Core) has neither: there, the live is the Lab session (« Simuler début de
   * stream ») and the presence is the Lab's explicit simulator (lab_sim, Lab-only table). Read once (a schema never
   * loses them).
   */
  presenceMode(q: Queryable = this.db) {
    this.presence ??= q
      .query<{ tracked: boolean; lab: boolean }>(
        `select to_regclass('stream_sessions') is not null and to_regclass('presence_viewer_streams') is not null
           as tracked, to_regclass('lab_sw_presence') is not null as lab`,
      )
      .then((r): PresenceMode =>
        r[0]?.tracked ? 'tracked' : r[0]?.lab ? 'lab_sim' : 'none',
      )
      .catch((e: unknown) => {
        this.presence = undefined; // a failed read is never remembered
        throw e;
      });
    return this.presence;
  }

  /** The live in progress: its key (the Daily's stream id, or the Lab session id), else null. */
  async liveKey(q: Queryable, channelId: string): Promise<string | null> {
    return (await this.presenceMode(q)) === 'tracked'
      ? ((await activeSession(q))?.streamId ?? null)
      : ((await liveChannelSession(q, channelId))?.session_id ?? null);
  }

  private async liveNow(q: Queryable, channelId: string) {
    return (await this.liveKey(q, channelId)) !== null;
  }

  async settings(channelId: string) {
    const r = (
      await this.db.query<{
        enabled: boolean;
        updated_at: Date;
        mode: SwMode;
        recovery_enabled: boolean;
        invitations_enabled: boolean;
        announce_delay_s: number;
      }>(
        `select enabled, updated_at, mode, recovery_enabled, invitations_enabled, announce_delay_s from sw_settings
         where channel_id = $1`,
        [channelId],
      )
    )[0];
    return {
      enabled: r?.enabled ?? false,
      updated_at: iso(r?.updated_at ?? null),
      mode: r?.mode ?? ('v1' as SwMode),
      recovery_enabled: r?.recovery_enabled ?? false,
      invitations_enabled: r?.invitations_enabled ?? false,
      announce_delay_s: r
        ? Number(r.announce_delay_s)
        : SW_ANNOUNCE_DELAY_MS / 1000,
      // Lab Core: the Lab's simulators exist (presence, events), and the gains pay the Lab test wallet.
      lab: (await this.presenceMode()) === 'lab_sim',
    };
  }

  /** Natural invitations (R9): the broadcaster only, OFF by default, journaled. */
  async setInvitations(channelId: string, enabled: boolean, actor: string) {
    await this.db.tx(async (q) => {
      const now = this.now();
      const before = (
        await q.query<{ invitations_enabled: boolean }>(
          'select invitations_enabled from sw_settings where channel_id = $1 for update',
          [channelId],
        )
      )[0];
      await q.query(
        `insert into sw_settings (channel_id, enabled, updated_at, invitations_enabled) values ($1, false, $2, $3)
         on conflict (channel_id) do update set invitations_enabled = $3, updated_at = $2`,
        [channelId, now, enabled],
      );
      await this.audit(q, {
        channelId,
        actor,
        role: 'broadcaster',
        action: 'sw_invitations',
        before: { invitations_enabled: before?.invitations_enabled ?? false },
        after: { invitations_enabled: enabled },
      });
    });
    return this.settings(channelId);
  }

  /**
   * The winner announcement's delay after the end of the animation (0–60 s): the broadcaster only (Studio), journaled.
   * Applies to the wheels ending from now on (an announcement already scheduled keeps its time).
   */
  async setAnnounceDelay(channelId: string, seconds: number, actor: string) {
    if (
      !Number.isInteger(seconds) ||
      seconds < 0 ||
      seconds > SW_ANNOUNCE_DELAY_MAX_S
    )
      throw new SwError(400, 'invalid_announce_delay');
    await this.db.tx(async (q) => {
      const now = this.now();
      const before = (
        await q.query<{ announce_delay_s: number }>(
          'select announce_delay_s from sw_settings where channel_id = $1 for update',
          [channelId],
        )
      )[0];
      await q.query(
        `insert into sw_settings (channel_id, enabled, updated_at, announce_delay_s) values ($1, false, $2, $3)
         on conflict (channel_id) do update set announce_delay_s = $3, updated_at = $2`,
        [channelId, now, seconds],
      );
      await this.audit(q, {
        channelId,
        actor,
        role: 'broadcaster',
        action: 'sw_announce_delay',
        before: {
          announce_delay_s: before
            ? Number(before.announce_delay_s)
            : SW_ANNOUNCE_DELAY_MS / 1000,
        },
        after: { announce_delay_s: seconds },
      });
    });
    return this.settings(channelId);
  }

  /**
   * V2 mode (decision A: the broadcaster only — the callers are the broadcaster's Studio routes). `v2` (V2 draws) comes
   * with lot R3: refused until then. Never rewrites a right: rights acquired in v2_acquire stay owed in v1.
   */
  async setMode(channelId: string, mode: SwMode, actor: string) {
    await this.db.tx(async (q) => {
      const now = this.now();
      const before = (
        await q.query<{ mode: SwMode }>(
          'select mode from sw_settings where channel_id = $1 for update',
          [channelId],
        )
      )[0];
      await q.query(
        `insert into sw_settings (channel_id, enabled, updated_at, mode) values ($1, false, $2, $3)
         on conflict (channel_id) do update set mode = $3, updated_at = $2`,
        [channelId, now, mode],
      );
      await this.audit(q, {
        channelId,
        actor,
        role: 'broadcaster',
        action: 'sw_mode',
        before: { mode: before?.mode ?? 'v1' },
        after: { mode },
      });
    });
    return this.settings(channelId);
  }

  /** One line of the moderation journal (module sub_wheel, § 9). */
  private async audit(
    q: Queryable,
    e: {
      channelId: string;
      actor: string;
      role: string;
      action: string;
      viewerId?: string | null;
      spinId?: string | null;
      reason?: string | null;
      before?: unknown;
      after?: unknown;
    },
  ) {
    await q.query(
      `insert into lab_moderation_audit (channel_id, created_at, actor, role, module_id, action, viewer_id,
         interaction_id, reason, before, after)
       values ($1, $2, $3, $4, 'sub_wheel', $5, $6, $7, $8, $9, $10)`,
      [
        e.channelId,
        this.now(),
        e.actor.slice(0, 64),
        e.role,
        e.action,
        e.viewerId ?? null,
        e.spinId ?? null,
        e.reason ?? null,
        e.before === undefined ? null : JSON.stringify(e.before),
        e.after === undefined ? null : JSON.stringify(e.after),
      ],
    );
  }

  /** R-7: the Core checks the effective role and the lab_staff grants (Moderation V2 rules); Studio = broadcaster. */
  private async allow(
    q: Queryable,
    channelId: string,
    actor: Actor,
    permission: 'subwheel.draw' | 'subwheel.grant',
  ) {
    try {
      return await assertAllowed(q, channelId, actor, permission);
    } catch (e) {
      if (e instanceof LabForbiddenError) throw new SwError(403, 'forbidden');
      throw e;
    }
  }

  /** The switch (persistent; OFF by default). */
  async setEnabled(channelId: string, enabled: boolean) {
    await this.db.query(
      `insert into sw_settings (channel_id, enabled, updated_at) values ($1, $2, $3)
       on conflict (channel_id) do update set enabled = $2, updated_at = $3`,
      [channelId, enabled, this.now()],
    );
    return this.settings(channelId);
  }

  /** One spin, decided once (insert or nothing: the same event key is the same spin). */
  private async admit(
    q: Queryable,
    s: {
      channel_id: string;
      source: Row['source'];
      event_key: string;
      alert_id: string | null;
      type: 'sub' | 'resub';
      viewer: { id: string | null; login: string | null; name: string };
      tier: 1 | 2 | 3;
      months: number;
      enabled: boolean;
      /** Twitch time of the event (cutover boundary). */
      occurred_at?: string;
    },
  ) {
    const now = this.now();
    const segment = s.enabled
      ? this.draw(subWheelLayout(s.months).length)
      : null;
    const created = await q.query(
      `insert into sw_spins (spin_id, channel_id, source, event_key, alert_id, type, viewer_id, viewer_login,
         viewer_name, tier, months, status, reason, segment, amount, award_status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
       on conflict (channel_id, event_key) do nothing returning spin_id`,
      [
        randomUUID(),
        s.channel_id,
        s.source,
        s.event_key.slice(0, 200),
        s.alert_id,
        s.type,
        s.viewer.id,
        s.viewer.login,
        s.viewer.name.slice(0, 64),
        s.tier,
        s.months,
        s.enabled ? 'queued' : 'ignored',
        s.enabled ? null : 'disabled',
        segment,
        segment === null ? null : subWheelAmount(s.months, s.tier, segment),
        !s.enabled ? 'none' : s.source === 'twitch' ? 'pending' : 'test',
        now,
      ],
    );
    const row = (
      await q.query<Row>(
        'select * from sw_spins where channel_id = $1 and event_key = $2 for update',
        [s.channel_id, s.event_key.slice(0, 200)],
      )
    )[0]!;
    // A redelivered event finds the existing spin and pays nothing more.
    if (!created.length) return { row, created: false };
    return { row: await this.payDrawn(q, row, s.occurred_at), created: true };
  }

  /**
   * A gain decided now, on the canonical Wallet: credited with the draw (one transaction, key move:sub_wheel:<spin id>).
   * A sub of the previous economy reaching Core late (outbox resumed after the cutover): never paid here.
   */
  private async payDrawn(q: Queryable, row: Row, occurredAt?: string | null) {
    if (row.award_status !== 'pending' || !this.paying) return row;
    // The economic cutover concerns the canonical Wallet only (the Lab test wallet has none).
    if (
      this.canonical &&
      occurredAt &&
      (await occurredBeforeCutover(q, occurredAt))
    ) {
      const now = this.now();
      await q.query(
        `update sw_spins set award_note = $2, award_updated_at = $3, updated_at = $3 where spin_id = $1`,
        [row.spin_id, 'avant la bascule : à rapprocher', now],
      );
      return (
        await q.query<Row>('select * from sw_spins where spin_id = $1', [
          row.spin_id,
        ])
      )[0]!;
    }
    return this.credit(q, row, false);
  }

  /**
   * A Twitch alert event (after the alerts queue took it). Only a sub or a resub (Prime included) from Twitch; gifts
   * never spin (historical rule). Idempotent: a redelivered event is the same spin (also repairs a spin missed when
   * the first reception failed after the alert was committed).
   * V2 (R1): the mode is read under a share lock in the same transaction as the decision; the event is a proof
   * (chat_notification) of a right. v1: today's V1 spin, plus its proof and its month. v2_acquire: the right is kept
   * (owed) and V1 still draws it at once when the wheel is on, through draw().
   */
  async fromAlert(
    e: AlertEventInput,
    alertId: string | null,
    /** Lot 9: the alert is too old to animate (freshness filter): the gain stays, the wheel is not shown. */
    stale = false,
  ) {
    if (e.source !== 'twitch' || (e.type !== 'sub' && e.type !== 'resub'))
      return null;
    if (!e.actor) return null;
    const type = e.type;
    const actor = e.actor;
    // A new sub is the viewer's first month; a resub carries its cumulative months (the V1 layout rule).
    const v1Months = type === 'sub' ? 1 : Math.max(1, e.months ?? 1);
    const ev: SwEvidence | null = actor.id
      ? {
          channelId: e.channel_id,
          source: 'chat_notification',
          sourceEventId: e.source_event_id,
          occurredAt: e.occurred_at ?? null,
          viewer: {
            id: actor.id,
            login: actor.login ?? null,
            name: actor.display_name,
          },
          type,
          tier: tierOf(e.tier),
          // Only a resub's cumulative months are certain (a Prime re-up can arrive as a « sub »).
          months:
            type === 'resub' && e.months && e.months >= 1 ? e.months : null,
          isGift: false,
          alertId,
        }
      : null;
    return spinView(
      await this.db.tx(async (q) => {
        const { mode, enabled } = await readMode(q, e.channel_id);
        if (ev) {
          await lockViewer(q, ev.channelId, ev.viewer.id);
          if (mode !== 'v1')
            // A chat notice always gets its right (never an orphan proof).
            return (await this.acquireInTx(q, ev, {
              drawNow: mode === 'v2_acquire' && enabled,
              v1Months,
              stale,
            }))!;
          const proof = await findProof(q, ev);
          // A right kept in v2_acquire (mode switched back since): this notice draws it (never a second right).
          const kept = proof
            ? null
            : await findRenewal<Row>(q, ev).then((r) =>
                r && (r.status === 'owed' || r.status === 'requested')
                  ? r
                  : null,
              );
          if (kept)
            return this.attach(q, kept, ev, {
              drawNow: enabled,
              v1Months,
              stale,
            });
        }
        const { row, created } = await this.admit(q, {
          channel_id: e.channel_id,
          source: 'twitch',
          event_key: `alert:${e.source}:${e.source_event_id}`,
          alert_id: alertId,
          type,
          viewer: {
            id: actor.id ?? null,
            login: actor.login ?? null,
            name: actor.display_name,
          },
          tier: tierOf(e.tier),
          months: v1Months,
          enabled,
          occurred_at: e.occurred_at,
        });
        const r = ev ? await this.identifyV1(q, row, created, ev) : row;
        if (ev) await adoptOrphans(q, ev, r);
        return stale ? this.tooLate(q, r) : r;
      }),
    );
  }

  /** Lot 9: a wheel too old to animate: skipped, its gain kept. */
  private async tooLate(q: Queryable, row: Row) {
    if (row.status !== 'queued') return row;
    return (
      await q.query<Row>(
        `update sw_spins set status = 'skipped', reason = 'too_late', updated_at = $2
         where spin_id = $1 returning *`,
        [row.spin_id, this.now()],
      )
    )[0]!;
  }

  /**
   * v1: the proof of a V1 spin, and the month of a spin created now (§ 4.3: a row from before is never rewritten). A
   * resub's month is certain unless another right already holds it (a V1 duplicate: left to the detector).
   */
  private async identifyV1(
    q: Queryable,
    row: Row,
    created: boolean,
    ev: SwEvidence,
  ) {
    await recordProof(q, row.spin_id, ev, this.now());
    if (!created) return row;
    const taken =
      ev.months !== null &&
      (
        await q.query(
          `select 1 from sw_spins where channel_id = $1 and viewer_id = $2 and spin_id <> $3 and status <> 'merged'
           and ((month_source = 'twitch' and sub_month = $4)
             or (month_source is null and source = 'twitch' and type = 'resub' and months = $4))`,
          [ev.channelId, ev.viewer.id, row.spin_id, ev.months],
        )
      ).length > 0;
    const month =
      ev.months !== null && !taken
        ? { sub_month: ev.months, month_source: 'twitch' as const }
        : await this.estimate(q, ev);
    const identified = (
      await q.query<Row>(
        `update sw_spins set sub_month = $2, month_source = $3, acquired_at = created_at,
           drawn_at = case when segment is not null then created_at end
         where spin_id = $1 returning *`,
        [row.spin_id, month.sub_month, month.month_source],
      )
    )[0]!;
    // R2: a right kept from v2_acquire with this month becomes « À vérifier » (the V1 spin is never blocked).
    await flagSameMonth(q, identified, this.now());
    return identified;
  }

  /** § 5.2: the last certain month + 1, else 1 (no history). */
  private async estimate(q: Queryable, ev: SwEvidence) {
    const last = await lastCertainMonth(
      q,
      ev.channelId,
      ev.viewer.id,
      ev.occurredAt,
    );
    return last === null
      ? { sub_month: 1, month_source: 'estimated_no_history' as const }
      : { sub_month: last + 1, month_source: 'estimated' as const };
  }

  /**
   * § 4.1: one right per renewal, under the viewer lock. A redelivered proof returns its right; otherwise the right of
   * the same renewal (the V1 spin of this notice, a certain month, a complementary proof within 10 min) or a new owed
   * right. drawNow (v2_acquire, wheel on): a NEW chat notice draws an owed right at once, like V1, through draw().
   */
  private async acquireInTx(
    q: Queryable,
    ev: SwEvidence,
    o: { drawNow: boolean; v1Months: number; stale: boolean },
  ): Promise<Row | null> {
    const proof = await findProof(q, ev);
    // A redelivered proof: its right, or none for an orphan proof of v1 (never turned into a right).
    if (proof)
      return proof.spin_id === null
        ? null
        : (
            await q.query<Row>(
              'select * from sw_spins where spin_id = $1 for update',
              [proof.spin_id],
            )
          )[0]!;
    const notice = ev.source === 'chat_notification';
    const eventKey = `${notice ? 'alert' : ev.source}:twitch:${ev.sourceEventId}`;
    const found =
      (notice
        ? (
            await q.query<Row>(
              'select * from sw_spins where channel_id = $1 and event_key = $2 for update',
              [ev.channelId, eventKey.slice(0, 200)],
            )
          )[0]
        : undefined) ?? (await findRenewal<Row>(q, ev));
    if (found) return this.attach(q, found, ev, o);
    const now = this.now();
    const month =
      ev.months !== null
        ? { sub_month: ev.months, month_source: 'twitch' as const }
        : await this.estimate(q, ev);
    // Acquired in live → auto queue, else manual (decision 3).
    const live = await this.liveNow(q, ev.channelId);
    const row = (
      await q.query<Row>(
        `insert into sw_spins (spin_id, channel_id, source, event_key, alert_id, type, viewer_id, viewer_login,
           viewer_name, tier, months, status, award_status, created_at, updated_at, queue, sub_month, month_source,
           acquired_at)
         values ($1, $2, 'twitch', $3, $4, $5, $6, $7, $8, $9, $10, 'owed', 'none', $11, $11, $12, $13, $14, $11)
         returning *`,
        [
          randomUUID(),
          ev.channelId,
          eventKey.slice(0, 200),
          ev.alertId ?? null,
          ev.type,
          ev.viewer.id,
          ev.viewer.login,
          ev.viewer.name.slice(0, 64),
          ev.tier,
          // The layout: V1's when V1 draws it now (the same wheel as today), else the right's month.
          notice && o.drawNow ? o.v1Months : month.sub_month,
          now,
          live ? 'auto' : 'manual',
          month.sub_month,
          month.month_source,
        ],
      )
    )[0]!;
    await recordProof(q, row.spin_id, ev, now);
    if (notice) await adoptOrphans(q, ev, row);
    let out = row;
    if (notice && o.drawNow) {
      out = await this.drawLocked(q, row.spin_id, ev.occurredAt);
      if (o.stale) out = await this.tooLate(q, out);
    }
    // R2: no reliable proof joins it to a right of the same month: the undrawn one of the two is « À vérifier ». After
    // the V1-like draw, so that the notice is drawn as V1 would (the other right is the one blocked).
    await flagSameMonth(q, out, now);
    return out;
  }

  /**
   * A new proof of an existing right: recorded; a certain month confirms an estimated right (§ 5.2 — a drawn right
   * keeps its gain, only its month is corrected); a new chat notice takes the orphan proofs of its renewal and draws the
   * right when drawNow and it is still owed, on the V1 wheel (sub 1, resub its cumulative months), whatever the estimate.
   */
  private async attach(
    q: Queryable,
    row: Row,
    ev: SwEvidence,
    o: { drawNow: boolean; v1Months: number; stale: boolean },
  ): Promise<Row> {
    const now = this.now();
    let r = row;
    if (
      ev.months !== null &&
      (r.month_source === 'estimated' ||
        r.month_source === 'estimated_no_history')
    ) {
      const open = r.status === 'owed' || r.status === 'requested';
      r = (
        await q.query<Row>(
          `update sw_spins set sub_month = $2, month_source = 'twitch', confirmed_at = $3, updated_at = $3,
             months = case when $4::boolean then $2 else months end
           where spin_id = $1 returning *`,
          [r.spin_id, ev.months, now, open],
        )
      )[0]!;
      await recheckAfterConfirmation(q, r, now);
    }
    if (!r.alert_id && ev.alertId)
      r = (
        await q.query<Row>(
          'update sw_spins set alert_id = $2 where spin_id = $1 returning *',
          [r.spin_id, ev.alertId],
        )
      )[0]!;
    await recordProof(q, r.spin_id, ev, now);
    if (ev.source === 'chat_notification') await adoptOrphans(q, ev, r);
    if (!o.drawNow || ev.source !== 'chat_notification' || r.status !== 'owed')
      return r;
    // « À vérifier »: the notice is kept as a proof, the right stays blocked (no path bypasses a review).
    if (await underReview(q, r.spin_id)) return r;
    if (r.months !== o.v1Months)
      await q.query(
        'update sw_spins set months = $2, updated_at = $3 where spin_id = $1',
        [r.spin_id, o.v1Months, now],
      );
    const drawn = await this.drawLocked(q, r.spin_id, ev.occurredAt);
    return o.stale ? this.tooLate(q, drawn) : drawn;
  }

  /**
   * draw() — the ONLY code that draws and credits a right (§ 4.1): the row locked, refused unless owed / requested
   * (a right V1 already drew, or drawn by another path, is never drawn again), the same wallet key as V1.
   */
  private async drawLocked(
    q: Queryable,
    spinId: string,
    occurredAt: string | null,
  ): Promise<Row> {
    const r = (
      await q.query<Row>(
        'select * from sw_spins where spin_id = $1 for update',
        [spinId],
      )
    )[0];
    if (!r) throw new SwError(404, 'spin_not_found');
    if (r.status !== 'owed' && r.status !== 'requested')
      throw new SwError(409, 'not_owed');
    if (await underReview(q, spinId)) throw new SwError(409, 'needs_review');
    const segment = this.draw(subWheelLayout(r.months).length);
    const now = this.now();
    const row = (
      await q.query<Row>(
        `update sw_spins set status = 'queued', reason = null, segment = $2, amount = $3, award_status = $4,
           drawn_at = $5, updated_at = $5
         where spin_id = $1 returning *`,
        [
          spinId,
          segment,
          subWheelAmount(r.months, r.tier, segment),
          r.source === 'test' || r.source === 'simulation' ? 'test' : 'pending',
          now,
        ],
      )
    )[0]!;
    return this.payDrawn(q, row, occurredAt);
  }

  /** draw() on one right (lot R3 wires the V2 draws to it; no route in R1). */
  async drawRight(spinId: string) {
    return spinView(await this.db.tx((q) => this.drawLocked(q, spinId, null)));
  }

  /**
   * A proof from another source (subscribe, resub message: wired by lot R2). Never drawn here (only a chat notice
   * draws, like V1). v1: never a right outside V1. The proof joins the right of its renewal, else it is kept orphan
   * (no right; the chat notice of the same renewal takes it). v2_acquire: the right is kept owed.
   * null: no right (an orphan proof).
   */
  async acquire(ev: SwEvidence) {
    if (ev.isGift) return null;
    return this.db.tx(async (q) => {
      const { mode } = await readMode(q, ev.channelId);
      await lockViewer(q, ev.channelId, ev.viewer.id);
      const o = { drawNow: false, v1Months: 1, stale: false };
      if (mode !== 'v1') {
        const row = await this.acquireInTx(q, ev, o);
        return row && spinView(row);
      }
      const proof = await findProof(q, ev);
      if (proof)
        return proof.spin_id === null
          ? null
          : spinView(
              (
                await q.query<Row>(
                  'select * from sw_spins where spin_id = $1',
                  [proof.spin_id],
                )
              )[0]!,
            );
      const found = await findRenewal<Row>(q, ev);
      if (found) return spinView(await this.attach(q, found, ev, o));
      await recordProof(q, null, ev, this.now());
      return null;
    });
  }

  /**
   * R2: channel.subscribe (sub) and channel.subscription.message (resub) as forwarded to the loyalty route — the EventSub
   * message id is the proof's identity, the Twitch time its time, Twitch's cumulative months (when the bot sends them)
   * its certain month. Gifted subs never spin (historical rule). Called AFTER the loyalty transaction, in its own.
   */
  async acquireFromLoyalty(channelId: string, e: LoyaltyEvent) {
    if (e.type !== 'sub' && e.type !== 'resub') return null;
    if (e.type === 'sub' && e.isGift) return null;
    return this.acquire({
      channelId,
      source: e.type === 'sub' ? 'subscribe' : 'message',
      sourceEventId: e.eventId,
      occurredAt: e.occurredAt ?? null,
      viewer: {
        id: e.viewer.twitchUserId,
        login: e.viewer.login,
        name: e.viewer.displayName,
      },
      type: e.type,
      tier: e.tier === 't3' ? 3 : e.tier === 't2' ? 2 : 1,
      months: e.type === 'resub' ? (e.cumulativeMonths ?? null) : null,
      isGift: false,
    });
  }

  /**
   * § 6 detection only (the recovery is lot R3b): the rights credited twice for the same CERTAIN month of a viewer —
   * every awarded right after the first one of that month. Read-only.
   */
  async certainDuplicates(channelId: string) {
    return (
      await this.db.query<{
        spin_id: string;
        duplicate_of: string;
        viewer_id: string;
        month: number | string;
        amount: number | string;
      }>(
        `select spin_id, duplicate_of, viewer_id, m as month, amount from (
           select spin_id, viewer_id, amount, m,
             first_value(spin_id) over w as duplicate_of, row_number() over w as n
           from (
             select spin_id, viewer_id, amount, created_at,
               case when month_source = 'twitch' then sub_month
                    when month_source is null and source = 'twitch' and type = 'resub' then months end as m
             from sw_spins
             where channel_id = $1 and viewer_id is not null and award_status = 'awarded' and status <> 'merged'
           ) c
           where m is not null
           window w as (partition by viewer_id, m order by created_at, spin_id)
         ) d where n > 1 order by viewer_id, month`,
        [channelId],
      )
    ).map((d) => ({ ...d, month: Number(d.month), amount: Number(d.amount) }));
  }

  /** Studio « Tester »: a wheel shown with a « test » gain (never attributable), switch ON or OFF. */
  async test(
    channelId: string,
    t: SwTestRequest,
    linked?: { event_key: string; alert_id: string | null },
  ) {
    const months = t.months ?? 1;
    const { row } = await this.admit(this.db, {
      channel_id: channelId,
      source: linked ? 'simulation' : 'test',
      event_key: linked?.event_key ?? `test:${randomUUID()}`,
      alert_id: linked?.alert_id ?? null,
      type: months > 1 ? 'resub' : 'sub',
      viewer: { id: null, login: null, name: t.name ?? 'Test Studio' },
      tier: t.tier ?? 1,
      months,
      enabled: true,
    });
    return spinView(row);
  }

  /** Animations left behind: never shown late, never handed twice. */
  private async sweep(q: Queryable, channelId: string) {
    const now = this.now();
    await q.query(
      `update sw_spins set status = 'failed', reason = 'animation_not_confirmed', animation_lease_expires_at = null,
         updated_at = $2
       where channel_id = $1 and status = 'playing' and animation_lease_expires_at < $2`,
      [channelId, now],
    );
    await q.query(
      `update sw_spins set status = 'skipped', reason = 'too_late', updated_at = $2
       where channel_id = $1 and status = 'queued' and coalesce(drawn_at, created_at) < $3`,
      [channelId, now, new Date(now.getTime() - SUB_WHEEL.animationMaxAgeMs)],
    );
  }

  /**
   * The next wheel to show: one at a time, in order, once its sub alert ended (or after SUB_WHEEL.afterAlertMaxMs, the
   * alerts source being absent / slow). The result travels with it: Studio never draws.
   */
  async claimAnimation(channelId: string, consumerId: string) {
    return this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        `sub_wheel:${channelId}`,
      ]);
      await this.sweep(q, channelId);
      const playing = await q.query(
        `select 1 from sw_spins where channel_id = $1 and status = 'playing'`,
        [channelId],
      );
      if (playing.length) return { spin: null };
      const now = this.now();
      // A wheel already decided first (V1 / v2_acquire, or drawn before a restart), then — mode v2 — the next right.
      const r =
        (
          await q.query<Row>(
            `select * from sw_spins s where s.channel_id = $1 and s.status = 'queued' and (s.alert_id is null
             or exists (select 1 from alert_items a where a.alert_id = s.alert_id
               and a.status in ('completed', 'failed', 'expired'))
             or s.created_at <= $2)
           order by s.seq limit 1 for update`,
            [channelId, new Date(now.getTime() - SUB_WHEEL.afterAlertMaxMs)],
          )
        )[0] ?? (await this.drawNextRight(q, channelId, now));
      if (!r) return { spin: null };
      await q.query(
        `update sw_spins set status = 'playing', animation_consumer = $2, animation_lease_expires_at = $3,
           updated_at = $4 where spin_id = $1`,
        [
          r.spin_id,
          consumerId,
          new Date(now.getTime() + SUB_WHEEL.animationLeaseMs),
          now,
        ],
      );
      return {
        spin: {
          spin_id: r.spin_id,
          name: r.viewer_name,
          type: r.type,
          tier: r.tier,
          months: r.months,
          layout: subWheelLayout(r.months),
          segment: r.segment!,
          amount: Number(r.amount),
        },
      };
    });
  }

  /**
   * Mode v2, wheel on (decision 11: off = draws paused, no right lost): the next right, drawn now by draw() — manual
   * requests, then the automatic queue (draws.ts). The player claiming is the condition « player available »: nothing
   * is drawn without a wheel to show it. A right taken meanwhile or put under review is skipped, never a 500.
   */
  private async drawNextRight(
    q: Queryable,
    channelId: string,
    now: Date,
  ): Promise<Row | undefined> {
    const { mode, enabled } = await readMode(q, channelId);
    if (mode !== 'v2' || !enabled) return undefined;
    const tryEach = async (list: Candidate[]) => {
      for (const c of list)
        try {
          return await this.drawLocked(
            q,
            c.spin_id,
            c.first_at ? new Date(c.first_at).toISOString() : null,
          );
        } catch (e) {
          if (
            e instanceof SwError &&
            (e.code === 'not_owed' || e.code === 'needs_review')
          )
            continue;
          throw e;
        }
      return undefined;
    };
    const presence = await this.presenceMode(q);
    return (
      (await tryEach(await requestedRights(q, channelId, now, presence))) ??
      (await tryEach(await autoRights(q, channelId, now, presence)))
    );
  }

  /**
   * « Tirer » (subWheelDraw): an owed right goes to `requested`, drawn by the next wheel (before the automatic queue).
   * Idempotent; a right under review, drawn or merged is refused. Nothing is drawn or credited here.
   */
  async requestDraw(spinId: string, actor: Actor) {
    return this.db.tx(async (q) => {
      const r = (
        await q.query<Row>(
          'select * from sw_spins where spin_id = $1 for update',
          [spinId],
        )
      )[0];
      if (!r) throw new SwError(404, 'spin_not_found');
      const role = await this.allow(q, r.channel_id, actor, 'subwheel.draw');
      if (r.status === 'requested') return spinView(r);
      if (r.status !== 'owed') throw new SwError(409, 'not_owed');
      if (await underReview(q, spinId)) throw new SwError(409, 'needs_review');
      const now = this.now();
      const by = actorName(actor);
      const row = (
        await q.query<Row>(
          `update sw_spins set status = 'requested', requested_at = $2, requested_by = $3, requested_via = $4,
             updated_at = $2
           where spin_id = $1 returning *`,
          [
            spinId,
            now,
            by.slice(0, 64),
            actor.via === 'extension' ? 'moderator' : 'studio',
          ],
        )
      )[0]!;
      await this.audit(q, {
        channelId: r.channel_id,
        actor: by,
        role,
        action: 'sw_draw_request',
        viewerId: r.viewer_id,
        spinId,
        before: { status: 'owed' },
        after: { status: 'requested' },
      });
      return spinView(row);
    });
  }

  /**
   * « Accorder un tour » (subWheelGrant): a manual right, owed, in the manual queue — drawn only once someone asks
   * (subWheelDraw). Its wheel and tier are the grant's; it claims no subscription month (never a review, never an
   * estimate's history). The key makes a retried grant the same right. RV2-2: never a new right while the viewer can
   * use one of its own (owed or already requested, not « À vérifier »): those are drawn instead (« Tirer » / « !roue
   * oui »), refused `rights_available` with their count.
   */
  async grant(channelId: string, actor: Actor, g: SwGrantInput) {
    return this.db.tx(async (q) => {
      const role = await this.allow(q, channelId, actor, 'subwheel.grant');
      await lockViewer(q, channelId, g.viewer.id);
      const now = this.now();
      const by = actorName(actor);
      const eventKey = `grant:${g.key}`;
      const retried = (
        await q.query<Row>(
          'select * from sw_spins where channel_id = $1 and event_key = $2',
          [channelId, eventKey],
        )
      )[0];
      if (retried) {
        if (retried.viewer_id !== g.viewer.id || retried.source !== 'manual')
          throw new SwError(409, 'grant_key_reused');
        return spinView(retried);
      }
      const usable = await usableRights(q, channelId, g.viewer.id);
      if (usable) throw new SwError(409, 'rights_available', { usable });
      const created = (
        await q.query<Row>(
          `insert into sw_spins (spin_id, channel_id, source, event_key, type, viewer_id, viewer_login, viewer_name,
             tier, months, status, award_status, created_at, updated_at, queue, acquired_at, granted_by, grant_note)
           values ($1, $2, 'manual', $3, $4, $5, $6, $7, $8, $9, 'owed', 'none', $10, $10, 'manual', $10, $11, $12)
           on conflict (channel_id, event_key) do nothing returning *`,
          [
            randomUUID(),
            channelId,
            eventKey,
            g.months > 1 ? 'resub' : 'sub',
            g.viewer.id,
            g.viewer.login ?? null,
            g.viewer.name.slice(0, 64),
            g.tier,
            g.months,
            now,
            by.slice(0, 64),
            g.note,
          ],
        )
      )[0];
      const row =
        created ??
        (
          await q.query<Row>(
            'select * from sw_spins where channel_id = $1 and event_key = $2',
            [channelId, eventKey],
          )
        )[0]!;
      if (row.viewer_id !== g.viewer.id || row.source !== 'manual')
        throw new SwError(409, 'grant_key_reused');
      if (!created) return spinView(row);
      await q.query(
        `insert into sw_spin_sources (spin_id, channel_id, source, source_event_id, viewer_id, occurred_at, tier,
           is_gift, received_at)
         values ($1, $2, 'manual', $3, $4, $5, $6, false, $5)
         on conflict (channel_id, source, source_event_id) do nothing`,
        [row.spin_id, channelId, g.key, g.viewer.id, now, g.tier],
      );
      await this.audit(q, {
        channelId,
        actor: by,
        role,
        action: 'sw_grant',
        viewerId: g.viewer.id,
        spinId: row.spin_id,
        reason: g.note,
        after: {
          status: 'owed',
          queue: 'manual',
          months: g.months,
          tier: g.tier,
        },
      });
      return spinView(row);
    });
  }

  /**
   * RV2-2 « Relancer un tirage »: an exceptional NEW draw after a real draw (shown or failed), decided by the broadcaster
   * alone. A new right of its own (source manual, linked by `redraw_of`, its own economic key: paid once), requested at
   * once — drawn at the next wheel, live or not, whenever the player is there. The Studio key makes a repeated click
   * the same new draw; one pending new draw per original draw (the row lock here, a unique index in the database);
   * tests, simulations and pending rights are never re-drawn. Journaled (`sw_redraw`) with the reason.
   */
  async redraw(channelId: string, actor: Actor, r: SwRedrawInput) {
    return this.db.tx(async (q) => {
      const role = await this.allow(q, channelId, actor, 'subwheel.grant');
      if (role !== 'broadcaster') throw new SwError(403, 'broadcaster_only');
      const original = (
        await q.query<Row>(
          'select * from sw_spins where spin_id = $1 and channel_id = $2 for update',
          [r.spin_id, channelId],
        )
      )[0];
      if (!original) throw new SwError(404, 'spin_not_found');
      const eventKey = `redraw:${r.key}`;
      const retried = (
        await q.query<Row>(
          'select * from sw_spins where channel_id = $1 and event_key = $2',
          [channelId, eventKey],
        )
      )[0];
      if (retried) {
        if (retried.redraw_of !== r.spin_id)
          throw new SwError(409, 'redraw_key_reused');
        return spinView(retried);
      }
      if (
        !['twitch', 'manual', 'reconcile'].includes(original.source) ||
        !original.viewer_id
      )
        throw new SwError(409, 'not_redrawable');
      if (original.status !== 'shown' && original.status !== 'failed')
        throw new SwError(409, 'not_drawn_yet');
      const pending = (
        await q.query<{ spin_id: string }>(
          `select spin_id from sw_spins where redraw_of = $1 and status in ('owed', 'requested', 'queued', 'playing')`,
          [r.spin_id],
        )
      )[0];
      if (pending)
        throw new SwError(409, 'redraw_pending', { spin_id: pending.spin_id });
      await lockViewer(q, channelId, original.viewer_id);
      const now = this.now();
      const by = actorName(actor).slice(0, 64);
      const row = (
        await q.query<Row>(
          `insert into sw_spins (spin_id, channel_id, source, event_key, type, viewer_id, viewer_login, viewer_name,
             tier, months, status, award_status, created_at, updated_at, queue, acquired_at, granted_by, grant_note,
             requested_at, requested_by, requested_via, redraw_of)
           values ($1, $2, 'manual', $3, $4, $5, $6, $7, $8, $9, 'requested', 'none', $10, $10, 'manual', $10, $11, $12,
             $10, $11, 'studio', $13)
           returning *`,
          [
            randomUUID(),
            channelId,
            eventKey,
            original.type,
            original.viewer_id,
            original.viewer_login,
            original.viewer_name,
            original.tier,
            original.months,
            now,
            by,
            r.note,
            r.spin_id,
          ],
        )
      )[0]!;
      await q.query(
        `insert into sw_spin_sources (spin_id, channel_id, source, source_event_id, viewer_id, occurred_at, tier,
           is_gift, received_at)
         values ($1, $2, 'manual', $3, $4, $5, $6, false, $5)
         on conflict (channel_id, source, source_event_id) do nothing`,
        [row.spin_id, channelId, r.key, original.viewer_id, now, original.tier],
      );
      await this.audit(q, {
        channelId,
        actor: by,
        role,
        action: 'sw_redraw',
        viewerId: original.viewer_id,
        spinId: row.spin_id,
        reason: r.note,
        before: {
          redraw_of: r.spin_id,
          status: original.status,
          amount: original.amount === null ? null : Number(original.amount),
          award_status: original.award_status,
        },
        after: { status: 'requested', queue: 'manual' },
      });
      return spinView(row);
    });
  }

  /**
   * RV2-2 Studio « Droits »: viewers found by their pseudo (login or display name), the ones the wheel knows first,
   * then the ones the channel knows (Daily / presence `viewers`, when the table exists). At most 8.
   */
  async searchViewers(channelId: string, query: string) {
    const q = query.trim().replace(/^@+/, '').toLowerCase();
    if (q.length < 2) return [];
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const found = new Map<
      string,
      { id: string; login: string | null; name: string }
    >();
    const wheel = await this.db.query<{
      viewer_id: string;
      viewer_login: string | null;
      viewer_name: string;
    }>(
      `select distinct on (viewer_id) viewer_id, viewer_login, viewer_name from sw_spins
       where channel_id = $1 and viewer_id is not null and source in ('twitch', 'manual', 'reconcile')
         and (lower(coalesce(viewer_login, '')) like $2 or lower(viewer_name) like $2)
       order by viewer_id, created_at desc limit 8`,
      [channelId, like],
    );
    for (const w of wheel)
      found.set(w.viewer_id, {
        id: w.viewer_id,
        login: w.viewer_login,
        name: w.viewer_name,
      });
    const known = (
      await this.db.query<{ ok: boolean }>(
        "select to_regclass('public.viewers') is not null as ok",
      )
    )[0]!.ok;
    if (known && found.size < 8)
      for (const v of await this.db.query<{
        twitch_user_id: string;
        login: string;
        display_name: string;
      }>(
        `select twitch_user_id, login, display_name from viewers
         where lower(login) like $1 or lower(display_name) like $1
         order by (lower(login) = $2) desc, login limit 8`,
        [like, q],
      ))
        if (found.size < 8 && !found.has(v.twitch_user_id))
          found.set(v.twitch_user_id, {
            id: v.twitch_user_id,
            login: v.login,
            name: v.display_name,
          });
    return [...found.values()];
  }

  /**
   * RV2-2 Studio « Droits »: one viewer — what it can use now (owed, requested, « À vérifier », on the wheel), its real
   * draws (gain, credit, exceptional new draws) and the gains credited so far. Tests and simulations are left out.
   */
  async viewerAdmin(channelId: string, viewerId: string) {
    const rows = await this.db.query<Row & { blocked: boolean }>(
      `select s.*, exists (select 1 from sw_spin_reviews v where v.spin_id = s.spin_id
           and v.status in ('open', 'unresolved')) as blocked
       from sw_spins s where s.channel_id = $1 and s.viewer_id = $2 and s.source in ('twitch', 'manual', 'reconcile')
       order by s.created_at desc limit 500`,
      [channelId, viewerId],
    );
    const known = (
      await this.db.query<{ ok: boolean }>(
        "select to_regclass('public.viewers') is not null as ok",
      )
    )[0]!.ok;
    const v = known
      ? (
          await this.db.query<{ login: string; display_name: string }>(
            'select login, display_name from viewers where twitch_user_id = $1',
            [viewerId],
          )
        )[0]
      : undefined;
    const last = rows[0];
    const drawn = rows.filter(
      (r) => r.status === 'shown' || r.status === 'failed',
    );
    const pendingRedraw = new Set(
      rows
        .filter(
          (r) =>
            r.redraw_of &&
            ['owed', 'requested', 'queued', 'playing'].includes(r.status),
        )
        .map((r) => r.redraw_of!),
    );
    const owed = rows.filter((r) => r.status === 'owed' && !r.blocked);
    const requested = rows.filter(
      (r) => r.status === 'requested' && !r.blocked,
    );
    const sum = (list: Row[]) =>
      list.reduce((t, r) => t + Number(r.amount ?? 0), 0);
    return {
      viewer: {
        id: viewerId,
        login: v?.login ?? last?.viewer_login ?? null,
        name: v?.display_name ?? last?.viewer_name ?? viewerId,
      },
      counts: {
        available: owed.length,
        requested: requested.length,
        blocked: rows.filter(
          (r) => r.blocked && (r.status === 'owed' || r.status === 'requested'),
        ).length,
        drawing: rows.filter(
          (r) => r.status === 'queued' || r.status === 'playing',
        ).length,
        draws: drawn.length,
      },
      gains: {
        awarded: sum(drawn.filter((r) => r.award_status === 'awarded')),
        pending: sum(drawn.filter((r) => r.award_status === 'pending')),
      },
      // « Accorder une roue »: only when it has no right of its own to use (grant refuses it otherwise).
      can_grant: owed.length + requested.length === 0,
      rights: rows
        .filter((r) =>
          ['owed', 'requested', 'queued', 'playing'].includes(r.status),
        )
        .reverse()
        .map((r) => ({
          ...spinView(r),
          blocked: r.blocked,
          requested_via: r.requested_via ?? null,
        })),
      draws: drawn.slice(0, 20).map((r) => ({
        ...spinView(r),
        redraw_pending: pendingRedraw.has(r.spin_id),
      })),
    };
  }

  /**
   * The rights not drawn yet (Studio, lot R4 shows them): requests first, then each queue in order, with the viewer's
   * presence (present / absent / unknown) and whether a review blocks it.
   */
  async rights(channelId: string) {
    const rows = await this.db.query<
      Row & { blocked: boolean; sources: string[] }
    >(
      `select s.*, exists (select 1 from sw_spin_reviews v where v.spin_id = s.spin_id
           and v.status in ('open', 'unresolved')) as blocked,
         (select coalesce(json_agg(p.source order by p.id), '[]') from sw_spin_sources p
           where p.spin_id = s.spin_id) as sources
       from sw_spins s where s.channel_id = $1 and s.status in ('owed', 'requested')
       order by case s.status when 'requested' then 0 else 1 end, s.requested_at, s.queue, s.acquired_at, s.seq
       limit 500`,
      [channelId],
    );
    const presence = await presenceOf(
      this.db,
      await this.presenceMode(),
      channelId,
      [...new Set(rows.flatMap((r) => (r.viewer_id ? [r.viewer_id] : [])))],
      this.now(),
    );
    return rows.map((r) => ({
      ...spinView(r),
      requested_by: r.requested_by ?? null,
      requested_via: r.requested_via ?? null,
      blocked: r.blocked,
      // Where the right comes from (chat_notification, subscribe, message, manual…).
      sources: r.sources,
      presence: r.viewer_id
        ? (presence.get(r.viewer_id) ?? 'unknown')
        : 'unknown',
    }));
  }

  /**
   * « À vérifier » decided by a human (R4; subWheelGrant: the broadcaster, supermods, moderators granted it):
   * distinct — two months, the blocked right is drawable again · merge — the blocked right was the same month: merged
   * into the other one, never drawn nor credited (only possible while it is not drawn and owes no gain; its row and its
   * proofs stay) · unresolved — left blocked, decided later. Both rights and the review locked: one decision only.
   */
  async resolveReview(
    reviewId: number,
    actor: Actor,
    decision: SwReviewDecision,
    note: string,
  ) {
    return this.db.tx(async (q) => {
      const v = (
        await q.query<{
          id: number;
          channel_id: string;
          viewer_id: string;
          spin_id: string;
          other_spin_id: string;
          status: string;
        }>('select * from sw_spin_reviews where id = $1 for update', [reviewId])
      )[0];
      if (!v) throw new SwError(404, 'review_not_found');
      const role = await this.allow(q, v.channel_id, actor, 'subwheel.grant');
      if (v.status !== 'open' && v.status !== 'unresolved')
        throw new SwError(409, 'review_closed');
      if (decision === 'unresolved' && v.status === 'unresolved')
        return { review_id: v.id, status: v.status };
      const rows = await q.query<Row>(
        'select * from sw_spins where spin_id = any($1::uuid[]) order by spin_id for update',
        [[v.spin_id, v.other_spin_id]],
      );
      const suspect = rows.find((r) => r.spin_id === v.spin_id)!;
      const other = rows.find((r) => r.spin_id === v.other_spin_id)!;
      const now = this.now();
      const by = actorName(actor).slice(0, 64);
      if (decision === 'merge') {
        if (
          (suspect.status !== 'owed' && suspect.status !== 'requested') ||
          suspect.award_status !== 'none'
        )
          throw new SwError(409, 'not_mergeable');
        if (other.status === 'merged') throw new SwError(409, 'not_mergeable');
        await q.query(
          `update sw_spins set status = 'merged', merged_into = $2, updated_at = $3 where spin_id = $1`,
          [suspect.spin_id, other.spin_id, now],
        );
        // Its other reviews have no object any more (the right is merged): closed the same way, kept.
        await q.query(
          `update sw_spin_reviews set status = 'merged', resolved_at = $2, resolved_by = $3
           where spin_id = $1 and status in ('open', 'unresolved')`,
          [suspect.spin_id, now, by],
        );
      } else
        await q.query(
          `update sw_spin_reviews set status = $2, resolved_at = $3, resolved_by = $4 where id = $1`,
          [v.id, decision, now, by],
        );
      await this.audit(q, {
        channelId: v.channel_id,
        actor: by,
        role,
        action: `sw_review_${decision}`,
        viewerId: v.viewer_id,
        spinId: suspect.spin_id,
        reason: note,
        before: { review: v.status, status: suspect.status },
        after: {
          review: decision === 'merge' ? 'merged' : decision,
          status: decision === 'merge' ? 'merged' : suspect.status,
          ...(decision === 'merge' ? { merged_into: other.spin_id } : {}),
        },
      });
      return {
        review_id: v.id,
        status: decision === 'merge' ? 'merged' : decision,
      };
    });
  }

  /** « Possible doublon »: informative pairs (review.ts), never blocking. */
  async possibleDuplicates(channelId: string) {
    return possibleDuplicates(this.db, channelId);
  }

  /** The team's view of the rights (extension moderation, R8): « Tirer » or « Accorder » holders only. */
  async rightsFor(channelId: string, actor: Actor) {
    await this.db.tx(async (q) => {
      try {
        await this.allow(q, channelId, actor, 'subwheel.draw');
      } catch {
        await this.allow(q, channelId, actor, 'subwheel.grant');
      }
    });
    return this.rights(channelId);
  }

  /**
   * One viewer's own tours (R8: « !roue », the extension) — identity from Twitch, never an argument: the caller passes
   * the verified viewer id. Counts per queue and the tours themselves (month, tier, state), nothing of anyone else.
   */
  async viewerRights(channelId: string, viewerId: string) {
    const rows = await this.db.query<
      Row & { blocked: boolean; sources: string[] }
    >(
      `select s.*, exists (select 1 from sw_spin_reviews v where v.spin_id = s.spin_id
           and v.status in ('open', 'unresolved')) as blocked,
         (select coalesce(json_agg(p.source order by p.id), '[]') from sw_spin_sources p
           where p.spin_id = s.spin_id) as sources
       from sw_spins s where s.channel_id = $1 and s.viewer_id = $2 and s.status in ('owed', 'requested', 'queued',
         'playing')
       order by s.acquired_at nulls last, s.created_at limit 100`,
      [channelId, viewerId],
    );
    const settings = await this.settings(channelId);
    const presence = (
      await presenceOf(
        this.db,
        await this.presenceMode(),
        channelId,
        [viewerId],
        this.now(),
      )
    ).get(viewerId)!;
    const owed = rows.filter((r) => r.status === 'owed' && !r.blocked);
    return {
      mode: settings.mode,
      enabled: settings.enabled,
      live: (await this.liveKey(this.db, channelId)) !== null,
      presence,
      counts: {
        auto: owed.filter((r) => r.queue === 'auto').length,
        manual: owed.filter((r) => r.queue !== 'auto').length,
        requested: rows.filter((r) => r.status === 'requested').length,
        blocked: rows.filter((r) => r.blocked).length,
        drawing: rows.filter(
          (r) => r.status === 'queued' || r.status === 'playing',
        ).length,
      },
      // « !roue oui » / the extension's button: possible now (otherwise why, in plain words, on the caller's side).
      can_accept:
        settings.mode === 'v2' &&
        settings.enabled &&
        owed.some((r) => r.queue !== 'auto'),
      rights: rows.map((r) => ({
        spin_id: r.spin_id,
        status: r.status,
        queue: r.queue,
        tier: r.tier,
        months: r.months,
        sub_month: r.sub_month,
        month_source: r.month_source,
        blocked: r.blocked,
        requested_via: r.requested_via ?? null,
        acquired_at: iso(r.acquired_at ?? r.created_at),
      })),
    };
  }

  /**
   * The viewer accepts its tours (R8 « !roue oui », R9 chat answer, extension button), in the caller's transaction:
   * every manual owed tour not under review goes to `requested` (by the viewer, waiting for its presence); nothing is
   * drawn nor credited here — draw() does it at display time. Idempotent (already requested: nothing more). Only in
   * mode v2, wheel on. Returns how many tours it asked.
   */
  async acceptInTx(
    q: Queryable,
    channelId: string,
    viewer: { id: string; login: string },
    via: 'command' | 'chat_accept' | 'extension',
  ): Promise<{ requested: number; reason: string | null }> {
    const { mode, enabled } = await readMode(q, channelId);
    if (mode !== 'v2') return { requested: 0, reason: 'mode' };
    if (!enabled) return { requested: 0, reason: 'disabled' };
    await lockViewer(q, channelId, viewer.id);
    const now = this.now();
    const rows = await q.query<{ spin_id: string }>(
      `update sw_spins s set status = 'requested', requested_at = $3, requested_by = $4, requested_via = $5,
         updated_at = $3
       where s.channel_id = $1 and s.viewer_id = $2 and s.status = 'owed' and s.queue is distinct from 'auto'
         and not exists (select 1 from sw_spin_reviews v where v.spin_id = s.spin_id
           and v.status in ('open', 'unresolved'))
       returning s.spin_id`,
      [channelId, viewer.id, now, viewer.login.slice(0, 64), via],
    );
    return { requested: rows.length, reason: null };
  }

  async viewerAccept(
    channelId: string,
    viewer: { id: string; login: string },
    via: 'command' | 'extension',
  ) {
    return this.db.tx((q) => this.acceptInTx(q, channelId, viewer, via));
  }

  // --- Lab simulators (Lab database only: the tables exist nowhere else) -------------------------------------------

  private async labOnly() {
    if ((await this.presenceMode()) !== 'lab_sim')
      throw new SwError(404, 'lab_only');
  }

  /** The simulated chatters readings: ON/OFF, and each viewer present or absent. */
  async labPresence(channelId: string) {
    await this.labOnly();
    const feed = (
      await this.db.query<{ readings: boolean }>(
        'select readings from lab_sw_presence_feed where channel_id = $1',
        [channelId],
      )
    )[0];
    const viewers = await this.db.query<{
      viewer_id: string;
      display_name: string;
      present: boolean;
    }>(
      'select viewer_id, display_name, present from lab_sw_presence where channel_id = $1 order by display_name',
      [channelId],
    );
    return {
      readings: feed?.readings ?? false,
      live: (await this.liveKey(this.db, channelId)) !== null,
      viewers,
    };
  }

  async setLabPresence(
    channelId: string,
    p: {
      readings?: boolean;
      viewers?: { id: string; name: string; present: boolean }[];
    },
  ) {
    await this.labOnly();
    await this.db.tx(async (q) => {
      const now = this.now();
      if (p.readings !== undefined)
        await q.query(
          `insert into lab_sw_presence_feed (channel_id, readings, updated_at) values ($1, $2, $3)
           on conflict (channel_id) do update set readings = $2, updated_at = $3`,
          [channelId, p.readings, now],
        );
      for (const v of p.viewers ?? [])
        await q.query(
          `insert into lab_sw_presence (channel_id, viewer_id, display_name, present, updated_at)
           values ($1, $2, $3, $4, $5)
           on conflict (channel_id, viewer_id) do update set display_name = $3, present = $4, updated_at = $5`,
          [channelId, v.id, v.name.slice(0, 64), v.present, now],
        );
    });
    return this.labPresence(channelId);
  }

  // --- R7: subscriptions active without any event heard (detection only) ---------------------------------------

  /**
   * Helix « Get Broadcaster Subscriptions » after an interruption (R7, simplified 21/10/2026): a viewer who is now a
   * PAID subscriber (never a gift), absent from the known state, with no proof of any source since the previous
   * snapshot, is DETECTED — never a tour: an active subscription proves no paid month (decision of 21/10/2026; no
   * reconstruction of past months). The detection is an orphan proof (source reconcile): kept for the history, shown
   * to the broadcaster (who may grant a tour by hand), joined to the real event's tour if Twitch delivers it later,
   * never turned into a tour by itself. The first snapshot is the baseline. Mode v1: nothing.
   */
  async reconcile(
    channelId: string,
    added: { id: string; login: string; name: string; tier: 1 | 2 | 3 }[],
    since: Date,
    fetchedAt: Date,
  ) {
    let detected = 0;
    for (const v of added)
      await this.db.tx(async (q) => {
        const { mode } = await readMode(q, channelId);
        if (mode === 'v1') return;
        await lockViewer(q, channelId, v.id);
        const heard = await q.query(
          `select 1 from sw_spin_sources where channel_id = $1 and viewer_id = $2
             and coalesce(occurred_at, received_at) >= $3 limit 1`,
          [channelId, v.id, since],
        );
        if (heard.length) return;
        const ev: SwEvidence = {
          channelId,
          source: 'reconcile',
          sourceEventId: `snapshot:${fetchedAt.toISOString()}:${v.id}`,
          occurredAt: fetchedAt.toISOString(),
          viewer: { id: v.id, login: v.login, name: v.name },
          type: 'sub',
          tier: v.tier,
          months: null,
          isGift: false,
        };
        if (await findProof(q, ev)) return;
        await recordProof(q, null, ev, this.now());
        detected++;
      });
    return { detected };
  }

  /** R7 detections still without a tour (Studio, informative): who, when, which tier — the last 30 days. */
  async subscriptionDetections(channelId: string) {
    return this.db.query<{
      viewer_id: string;
      detected_at: Date;
      tier: number;
    }>(
      `select viewer_id, occurred_at as detected_at, tier from sw_spin_sources
       where channel_id = $1 and source = 'reconcile' and spin_id is null
         and occurred_at > $2
       order by occurred_at desc limit 50`,
      [channelId, new Date(this.now().getTime() - 30 * 86_400_000)],
    );
  }

  /** The Lab simulators answer in the Lab database only (the routes are also mounted in-process on the main Core). */
  async assertLab() {
    await this.labOnly();
  }

  async reportAnimation(spinId: string, a: SwAnimationReport) {
    return this.db.tx(async (q) => {
      const r = (
        await q.query<Row>(
          'select * from sw_spins where spin_id = $1 for update',
          [spinId],
        )
      )[0];
      if (!r) throw new SwError(404, 'spin_not_found');
      if (r.animation_consumer !== a.consumer_id)
        throw new SwError(409, 'not_current_consumer');
      if (r.status !== 'playing') return { status: r.status };
      const status = a.event === 'completed' ? 'shown' : 'failed';
      await q.query(
        `update sw_spins set status = $2, reason = $3, shown_at = $4, animation_lease_expires_at = null,
           updated_at = $5 where spin_id = $1`,
        [
          spinId,
          status,
          status === 'shown'
            ? null
            : (a.error ?? 'animation_failed').slice(0, 200),
          status === 'shown' ? this.now() : null,
          this.now(),
        ],
      );
      const delay = (
        await q.query<{ announce_delay_s: number }>(
          'select announce_delay_s from sw_settings where channel_id = $1',
          [r.channel_id],
        )
      )[0];
      await this.announce(
        q,
        { ...r, status },
        delay ? Number(delay.announce_delay_s) * 1000 : SW_ANNOUNCE_DELAY_MS,
      );
      return { status };
    });
  }

  /** A pending gain settled outside Raptoru (reconciliation) or cancelled: noted, never credited by Raptoru. */
  async settleByHand(
    spinId: string,
    u: { status: 'manual' | 'cancelled'; note: string },
  ) {
    return this.db.tx(async (q) => {
      const r = (
        await q.query<Row>(
          'select * from sw_spins where spin_id = $1 for update',
          [spinId],
        )
      )[0];
      if (!r) throw new SwError(404, 'spin_not_found');
      if (r.award_status === 'awarded')
        throw new SwError(409, 'already_awarded');
      if (r.award_status !== 'pending')
        throw new SwError(409, 'award_not_pending');
      // On the canonical Wallet a gain is paid by award() only: « credited by hand » would be a second, unlinked path.
      if (u.status === 'manual' && this.canonical)
        throw new SwError(409, 'manual_settlement_disabled');
      await q.query(
        `update sw_spins set award_status = $2, award_note = $3, award_updated_at = $4, updated_at = $4
         where spin_id = $1`,
        [spinId, u.status, u.note, this.now()],
      );
      return spinView(
        (
          await q.query<Row>('select * from sw_spins where spin_id = $1', [
            spinId,
          ])
        )[0]!,
      );
    });
  }

  /**
   * Pays ONE pending gain on the canonical Wallet (retry of a refused credit, or a gain from before the switch that the
   * team decides to pay): the spin row locked, the same key as the automatic credit, the status changed only with the
   * movement. Already awarded → 409 already_awarded (never a second credit).
   */
  async award(spinId: string) {
    if (!this.canonical) throw new SwError(409, 'economy_not_canonical');
    return this.db.tx(async (q) => {
      const r = (
        await q.query<Row>(
          'select * from sw_spins where spin_id = $1 for update',
          [spinId],
        )
      )[0];
      if (!r) throw new SwError(404, 'spin_not_found');
      if (r.award_status === 'awarded')
        throw new SwError(409, 'already_awarded');
      if (r.award_status !== 'pending')
        throw new SwError(409, 'award_not_pending');
      const paid = await this.credit(q, r, true);
      // Wheel already shown, gain paid only now: announced at once.
      await this.announce(q, paid, 0);
      return spinView(paid);
    });
  }

  async state(channelId: string) {
    await this.db.tx((q) => this.sweep(q, channelId));
    const recent = await this.db.query<Row>(
      'select * from sw_spins where channel_id = $1 order by created_at desc limit 20',
      [channelId],
    );
    const counts = (
      await this.db.query<{
        waiting: string | number;
        pending: string | number;
        owed: string | number | null;
        rights_auto: string | number;
        rights_manual: string | number;
      }>(
        `select count(*) filter (where status in ('queued', 'playing')) as waiting,
           count(*) filter (where award_status = 'pending') as pending,
           sum(amount) filter (where award_status = 'pending') as owed,
           count(*) filter (where status in ('owed', 'requested') and queue = 'auto') as rights_auto,
           count(*) filter (where status in ('owed', 'requested') and queue = 'manual') as rights_manual
         from sw_spins where channel_id = $1`,
        [channelId],
      )
    )[0]!;
    return {
      settings: await this.settings(channelId),
      waiting: Number(counts.waiting),
      pending_awards: {
        count: Number(counts.pending),
        total: Number(counts.owed ?? 0),
      },
      // V2: rights kept, not drawn yet, per queue.
      rights: {
        auto: Number(counts.rights_auto),
        manual: Number(counts.rights_manual),
      },
      // R2: rights « À vérifier » (blocked), with both rights and their proofs (shown by lot R4).
      reviews: await openReviews(this.db, channelId),
      recent: recent.map(spinView),
    };
  }
}
