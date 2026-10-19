import { randomInt, randomUUID } from 'node:crypto';
import {
  type AlertEventInput,
  SUB_WHEEL,
  subWheelAmount,
  subWheelLayout,
  type SwAnimationReport,
  type SwAwardStatus,
  type SwStatus,
  type SwTestRequest,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import { LabWalletError } from '../lab-moderation/store.js';
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
  ) {
    super(code);
  }
}

interface Row {
  spin_id: string;
  channel_id: string;
  source: 'twitch' | 'simulation' | 'test';
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
});

/** Twitch tier → wheel tier (legacy: Prime and unknown are T1). */
const tierOf = (t: AlertEventInput['tier']): 1 | 2 | 3 =>
  t === '2000' ? 2 : t === '3000' ? 3 : 1;

export class SubWheelService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** Tests only: a deterministic draw (default: crypto). */
    private readonly draw: (n: number) => number = (n) => randomInt(n),
    /** The runtime's economy: gains are credited only when it is the canonical Wallet. */
    private readonly economy: EconomyPort | null = null,
  ) {}

  private get canonical() {
    return this.economy?.mode === 'canonical';
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

  private now() {
    return this.clock.now();
  }

  async settings(channelId: string) {
    const r = (
      await this.db.query<{ enabled: boolean; updated_at: Date }>(
        'select enabled, updated_at from sw_settings where channel_id = $1',
        [channelId],
      )
    )[0];
    return {
      enabled: r?.enabled ?? false,
      updated_at: iso(r?.updated_at ?? null),
    };
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
    // A gain decided now, on the canonical Wallet: credited with the spin (one transaction). A redelivered event finds
    // the existing spin and pays nothing more.
    return created.length && row.award_status === 'pending' && this.canonical
      ? this.credit(q, row, false)
      : row;
  }

  /**
   * A Twitch alert event (after the alerts queue took it). Only a sub or a resub (Prime included) from Twitch; gifts
   * never spin (historical rule). Idempotent: a redelivered event is the same spin (also repairs a spin missed when
   * the first reception failed after the alert was committed).
   */
  async fromAlert(e: AlertEventInput, alertId: string | null) {
    if (e.source !== 'twitch' || (e.type !== 'sub' && e.type !== 'resub'))
      return null;
    if (!e.actor) return null;
    const enabled = (await this.settings(e.channel_id)).enabled;
    const type = e.type;
    const actor = e.actor;
    return spinView(
      await this.db.tx((q) =>
        this.admit(q, {
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
          // A new sub is the viewer's first month; a resub carries its cumulative months.
          months: type === 'sub' ? 1 : Math.max(1, e.months ?? 1),
          enabled,
        }),
      ),
    );
  }

  /** Studio « Tester »: a wheel shown with a « test » gain (never attributable), switch ON or OFF. */
  async test(
    channelId: string,
    t: SwTestRequest,
    linked?: { event_key: string; alert_id: string | null },
  ) {
    const months = t.months ?? 1;
    return spinView(
      await this.admit(this.db, {
        channel_id: channelId,
        source: linked ? 'simulation' : 'test',
        event_key: linked?.event_key ?? `test:${randomUUID()}`,
        alert_id: linked?.alert_id ?? null,
        type: months > 1 ? 'resub' : 'sub',
        viewer: { id: null, login: null, name: t.name ?? 'Test Studio' },
        tier: t.tier ?? 1,
        months,
        enabled: true,
      }),
    );
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
       where channel_id = $1 and status = 'queued' and created_at < $3`,
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
      const r = (
        await q.query<Row>(
          `select * from sw_spins s where s.channel_id = $1 and s.status = 'queued' and (s.alert_id is null
             or exists (select 1 from alert_items a where a.alert_id = s.alert_id
               and a.status in ('completed', 'failed', 'expired'))
             or s.created_at <= $2)
           order by s.seq limit 1 for update`,
          [channelId, new Date(now.getTime() - SUB_WHEEL.afterAlertMaxMs)],
        )
      )[0];
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
      return spinView(await this.credit(q, r, true));
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
      }>(
        `select count(*) filter (where status in ('queued', 'playing')) as waiting,
           count(*) filter (where award_status = 'pending') as pending,
           sum(amount) filter (where award_status = 'pending') as owed
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
      recent: recent.map(spinView),
    };
  }
}
