import { randomUUID } from 'node:crypto';
import {
  RaffleConfig,
  type LabModerationCommand,
  type LabRaffleJoinRequest,
  type RaffleChatMessage,
  type RaffleCommand,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import {
  access,
  activeBlock,
  actorName,
  assertAccess,
  assertNotGloballyPaused,
  audit,
  countGlobalRefusal,
  GlobalPauseError,
  moduleState,
  seeViewer,
  setModuleState,
  SYSTEM,
  touchStaff,
  type Actor,
  type LabRole,
} from '../lab-moderation/store.js';
import { avatarUrls } from './avatars.js';
import {
  creditCurrency,
  currency,
  CurrencyCreditError,
  listCurrencies,
  type LabCurrency,
} from './currencies.js';
import {
  autoWinners,
  BASE_JOIN_COMMANDS,
  DEFAULT_RAFFLE_CONFIG,
  randomJackpot,
  RaffleConfigError,
  revealMs,
  split,
  validateConfig,
} from './rules.js';

// Tombola V2 (Lab). Core is the single source of truth: the round and its phases, its reward and
// currency, the entries and their source, the draw, the payouts, the cancellation, the stream session,
// the configuration and the audit. Studio, the extension, the overlay and the chat adapter only send
// intentions and display what Core answers.
//
// Phases (explicit state machine, every transition checked):
//   opening → open ⇄ paused → drawing → revealing → revealed → finished      (+ cancelled)
// Time-driven transitions (end of the announcement, closes_at, end of « Tirage en cours », end of the
// overlay reveal, end of the result display) are taken by Core itself: on every read / write (inside
// the transaction, with the round locked) and on the Lab Core tick. They are stamped at their
// scheduled time, so a late tick or a Core restart reaches exactly the same state. « closing » is not
// a stored state: at closes_at, inscriptions close and the draw happens in the same transaction.

export class RaffleLabError409 extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type RaffleStatus =
  | 'opening'
  | 'open'
  | 'paused'
  | 'drawing'
  | 'revealing'
  | 'revealed'
  | 'cancelled'
  | 'finished';
export const RUNNING: RaffleStatus[] = [
  'opening',
  'open',
  'paused',
  'drawing',
  'revealing',
  'revealed',
];
/** Allowed transitions. Anything else is refused (`invalid_transition`). */
export const TRANSITIONS: Record<RaffleStatus, RaffleStatus[]> = {
  opening: ['open', 'paused', 'drawing', 'cancelled'],
  open: ['paused', 'drawing', 'cancelled'],
  paused: ['open', 'drawing', 'cancelled'],
  drawing: ['revealing'],
  revealing: ['revealed'],
  revealed: ['finished'],
  cancelled: [],
  finished: [],
};
const BEFORE_DRAW: RaffleStatus[] = ['opening', 'open', 'paused'];

/** Settings frozen at the opening of a round (a later Studio change never alters a running round). */
interface RoundSettings {
  display: RaffleConfig['display'];
  full: RaffleConfig['full'];
  winners_custom: number;
}

interface RaffleRow {
  raffle_id: string;
  channel_id: string;
  status: RaffleStatus;
  kind: 'normal' | 'super' | 'giveaway';
  is_full: boolean;
  currency_id: string | null;
  jackpot: string | number;
  prize: string | null;
  winners_mode: 'auto' | 'custom';
  winners_count: number;
  duration_s: number;
  opened_at: Date;
  open_at: Date;
  ends_at: Date;
  paused_at: Date | null;
  paused_remaining_ms: number | null;
  closed_at: Date | null;
  drawn_at: Date | null;
  reveal_at: Date | null;
  reveal_end_at: Date | null;
  viewer_result_at: Date | null;
  overlay_end_at: Date | null;
  viewer_idle_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  finished_at: Date | null;
  opened_by: string;
  session_id: string | null;
  display: RoundSettings | null;
  phase_changed_at: Date;
}
interface EntryRow {
  entry_id: string;
  viewer_id: string;
  viewer_display_name: string;
  source: 'chat' | 'extension' | 'manual';
  command: string | null;
  created_at: Date;
  removed_at: Date | null;
  removed_by: string | null;
  removed_reason: string | null;
  added_by: string | null;
  seq: string | number;
}
interface WinnerRow {
  raffle_id: string;
  viewer_id: string;
  viewer_display_name: string;
  amount: string | number;
  position: number;
  currency_id: string | null;
  payout_status: 'pending' | 'paid' | 'failed' | 'none';
  ledger_id: string | number | null;
  paid_at: Date | null;
  failure: string | null;
  attempts: number;
}

const iso = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString() : null;
const ms = (d: Date | null | undefined) => (d ? new Date(d).getTime() : 0);
const at = (base: Date, plusMs: number) => new Date(base.getTime() + plusMs);
const settingsOf = (r: RaffleRow): RoundSettings =>
  r.display ?? {
    display: DEFAULT_RAFFLE_CONFIG.display,
    full: DEFAULT_RAFFLE_CONFIG.full,
    winners_custom: r.winners_count,
  };

export class RaffleLabService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    /** Injectable for tests (jackpot, SUPER / FULL rolls, winners). */
    private readonly random: () => number = Math.random,
  ) {}

  // --- configuration -----------------------------------------------------------------------------------

  async config(q: Queryable, channelId: string): Promise<RaffleConfig> {
    const row = (
      await q.query<{ config: unknown }>(
        'select config from lab_raffle_settings where channel_id = $1',
        [channelId],
      )
    )[0];
    if (!row) return structuredClone(DEFAULT_RAFFLE_CONFIG);
    // A configuration saved by an older Core keeps working: missing keys take their default.
    return RaffleConfig.parse({
      ...DEFAULT_RAFFLE_CONFIG,
      ...(row.config as object),
    });
  }

  private joinCommands(c: RaffleConfig) {
    return [...BASE_JOIN_COMMANDS, ...c.join_aliases];
  }

  // --- stream session (simulated in the Lab) ------------------------------------------------------------

  private async liveSession(q: Queryable, channelId: string) {
    return (
      (
        await q.query<{ session_id: string; started_at: Date; source: string }>(
          'select session_id, started_at, source from lab_stream_sessions where channel_id = $1 and ended_at is null',
          [channelId],
        )
      )[0] ?? null
    );
  }

  /** The session the viewer history shows: the live one, else the last one. */
  private async currentSession(q: Queryable, channelId: string) {
    return (
      (
        await q.query<{
          session_id: string;
          started_at: Date;
          ended_at: Date | null;
          source: string;
        }>(
          'select session_id, started_at, ended_at, source from lab_stream_sessions where channel_id = $1 order by (ended_at is null) desc, started_at desc limit 1',
          [channelId],
        )
      )[0] ?? null
    );
  }

  private async startSession(
    q: Queryable,
    channelId: string,
    actor: Actor,
    role: LabRole,
    now: Date,
    reason: string | null,
  ) {
    const id = randomUUID();
    await q.query(
      `insert into lab_stream_sessions (session_id, channel_id, started_at, source, started_by) values ($1, $2, $3, 'simulated', $4)`,
      [id, channelId, now, actorName(actor)],
    );
    await audit(q, now, {
      channelId,
      actor,
      role,
      module: 'raffle',
      action: 'stream_start',
      reason,
      after: { session_id: id, source: 'simulated' },
    });
    return id;
  }

  // --- state machine ---------------------------------------------------------------------------------------

  private async running(q: Queryable, channelId: string) {
    return (
      (
        await q.query<RaffleRow>(
          `select * from lab_raffles where channel_id = $1 and status = any($2::text[]) for update`,
          [channelId, RUNNING],
        )
      )[0] ?? null
    );
  }

  private async setStatus(
    q: Queryable,
    r: RaffleRow,
    to: RaffleStatus,
    when: Date,
    extra: Record<string, unknown> = {},
  ) {
    if (!TRANSITIONS[r.status].includes(to))
      throw new RaffleLabError409(
        'invalid_transition',
        `Tombola: ${r.status} → ${to} is not allowed`,
      );
    const cols = Object.keys(extra);
    await q.query(
      `update lab_raffles set status = $2, phase_changed_at = $3${cols.map((c, i) => `, ${c} = $${i + 4}`).join('')} where raffle_id = $1`,
      [r.raffle_id, to, when, ...cols.map((c) => extra[c])],
    );
    Object.assign(r, extra, { status: to, phase_changed_at: when });
  }

  /**
   * Takes every time-driven transition that is due (round locked by the caller's transaction).
   * Returns the running round after it (null when there is none any more).
   */
  private async advance(
    q: Queryable,
    channelId: string,
  ): Promise<RaffleRow | null> {
    const r = await this.running(q, channelId);
    if (!r) return null;
    const now = this.clock.now().getTime();
    for (let guard = 0; guard < 6; guard++) {
      if (r.status === 'opening' && now >= ms(r.open_at))
        await this.setStatus(q, r, 'open', r.open_at);
      else if (r.status === 'open' && now >= ms(r.ends_at))
        await this.draw(q, r, new Date(r.ends_at), SYSTEM, 'broadcaster', null);
      else if (r.status === 'drawing' && now >= ms(r.reveal_at))
        await this.setStatus(q, r, 'revealing', r.reveal_at!);
      else if (r.status === 'revealing' && now >= ms(r.reveal_end_at))
        await this.setStatus(q, r, 'revealed', r.reveal_end_at!);
      else if (r.status === 'revealed' && now >= ms(r.overlay_end_at))
        await this.setStatus(q, r, 'finished', r.overlay_end_at!, {
          finished_at: r.overlay_end_at,
        });
      else break;
    }
    return RUNNING.includes(r.status) ? r : null;
  }

  /**
   * Commits the due transitions on their own, before an action: an action refused afterwards (entry
   * after closes_at, nothing to draw…) rolls back its own transaction only, never the draw.
   */
  async settle(channelId: string) {
    await this.db.tx((q) => this.advance(q, channelId));
  }

  /** Lab Core tick: advances every running round (the draw happens at closes_at, even unread). */
  async tick(): Promise<number> {
    const channels = (
      await this.db.query<{ channel_id: string }>(
        `select distinct channel_id from lab_raffles where status = any($1::text[])`,
        [RUNNING],
      )
    ).map((c) => c.channel_id);
    for (const c of channels) await this.db.tx((q) => this.advance(q, c));
    return channels.length;
  }

  private async activeEntries(q: Queryable, raffleId: string) {
    return q.query<EntryRow>(
      'select * from lab_raffle_entries where raffle_id = $1 and removed_at is null order by seq',
      [raffleId],
    );
  }

  /**
   * Closes the inscriptions and draws (closes_at reached or « Tirer maintenant »): winners, exact
   * split, payouts in the chosen currency, then the reveal timeline. One transaction.
   */
  private async draw(
    q: Queryable,
    r: RaffleRow,
    when: Date,
    actor: Actor,
    role: LabRole,
    reason: string | null,
  ) {
    const s = settingsOf(r);
    const entries = await this.activeEntries(q, r.raffle_id);
    const n = entries.length;
    const money = r.kind !== 'giveaway';
    // FULL OSEILLE: decided at the draw only (never announced at the opening), normal rounds only.
    const full =
      r.kind === 'normal' &&
      n > 0 &&
      s.full.enabled &&
      this.random() * 100 < s.full.chance_pct;
    const k = full
      ? 1
      : r.winners_mode === 'custom'
        ? Math.min(s.winners_custom, n)
        : autoWinners(n, this.random);
    const pool = [...entries];
    const picked: EntryRow[] = [];
    while (pool.length && picked.length < k)
      picked.push(pool.splice(Math.floor(this.random() * pool.length), 1)[0]!);
    const parts = money ? split(Number(r.jackpot), picked.length) : [];
    for (const [i, w] of picked.entries())
      await q.query(
        `insert into lab_raffle_winners (raffle_id, viewer_id, viewer_display_name, amount, ledger_id, position, currency_id, payout_status)
         values ($1, $2, $3, $4, null, $5, $6, $7)`,
        [
          r.raffle_id,
          w.viewer_id,
          w.viewer_display_name,
          money ? parts[i]! : 0,
          i + 1,
          money ? r.currency_id : null,
          money ? 'pending' : 'none',
        ],
      );
    if (money)
      for (const w of picked)
        await this.pay(q, r.raffle_id, r.channel_id, w.viewer_id, when);
    const d = s.display;
    const reveal = revealMs(r.kind, full, picked.length);
    const revealAt = at(when, d.drawing_s * 1000);
    const revealEnd = at(revealAt, reveal);
    const viewerResult = at(revealEnd, d.stream_margin_s * 1000);
    const overlayEnd = at(
      revealAt,
      Math.max(
        (full
          ? d.result_full_s
          : r.kind === 'super'
            ? d.result_super_s
            : r.kind === 'giveaway'
              ? d.result_giveaway_s
              : d.result_normal_s) * 1000,
        reveal + 3000,
      ),
    );
    await this.setStatus(q, r, 'drawing', when, {
      is_full: full,
      winners_count: picked.length,
      closed_at: when,
      drawn_at: when,
      paused_at: null,
      paused_remaining_ms: null,
      reveal_at: revealAt,
      reveal_end_at: revealEnd,
      viewer_result_at: viewerResult,
      overlay_end_at: overlayEnd,
      viewer_idle_at: at(viewerResult, d.extension_idle_return_s * 1000),
    });
    const winners = await this.winnerRows(q, [r.raffle_id]);
    await audit(q, when, {
      channelId: r.channel_id,
      actor,
      role,
      module: 'raffle',
      action: 'raffle_draw',
      interactionId: r.raffle_id,
      reason,
      before: { participants: n, jackpot: Number(r.jackpot), kind: r.kind },
      after: {
        raffle_id: r.raffle_id,
        full,
        winners: winners.map((w) => ({
          viewer_id: w.viewer_id,
          amount: Number(w.amount),
          payout: w.payout_status,
        })),
      },
    });
  }

  /**
   * Pays one winner (inside the draw / retry transaction). Exactly once: the winner row is locked,
   * a paid winner is never paid again, and the ledger keeps at most one Tombola credit per winner
   * and round (unique index). A refused credit (balance cap, currency unavailable…) is recorded as
   * a failure, visible in moderation, and can be retried.
   */
  private async pay(
    q: Queryable,
    raffleId: string,
    channelId: string,
    viewerId: string,
    now: Date,
  ) {
    const w = (
      await q.query<WinnerRow>(
        'select * from lab_raffle_winners where raffle_id = $1 and viewer_id = $2 for update',
        [raffleId, viewerId],
      )
    )[0];
    if (!w || w.payout_status === 'paid' || w.payout_status === 'none')
      return w;
    const already = (
      await q.query<{ id: number }>(
        `select id from lab_wallet_ledger where raffle_id = $1 and viewer_id = $2 and kind = 'raffle_win'`,
        [raffleId, viewerId],
      )
    )[0];
    if (already) {
      await q.query(
        `update lab_raffle_winners set payout_status = 'paid', ledger_id = $3, failure = null where raffle_id = $1 and viewer_id = $2`,
        [raffleId, viewerId, already.id],
      );
      return w;
    }
    try {
      await creditCurrency(q, now, {
        channelId,
        viewerId,
        currencyId: w.currency_id!,
        amount: Number(w.amount),
      });
    } catch (e) {
      if (!(e instanceof CurrencyCreditError)) throw e;
      await q.query(
        `update lab_raffle_winners set payout_status = 'failed', failure = $3, attempts = attempts + 1 where raffle_id = $1 and viewer_id = $2`,
        [raffleId, viewerId, `${e.code}: ${e.message}`],
      );
      return w;
    }
    const ledger = (
      await q.query<{ id: number }>(
        `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, module_id, interaction_id, actor, reason, created_at, raffle_id)
         values ($1, $2, 'raffle_win', $3, $4, 'raffle', null, 'system', null, $5, $6) returning id`,
        [channelId, viewerId, w.currency_id, Number(w.amount), now, raffleId],
      )
    )[0]!;
    await q.query(
      `update lab_raffle_winners set payout_status = 'paid', ledger_id = $3, paid_at = $4, failure = null, attempts = attempts + 1
       where raffle_id = $1 and viewer_id = $2`,
      [raffleId, viewerId, ledger.id, now],
    );
    return w;
  }

  // --- entries (extension, chat, manual) ----------------------------------------------------------------

  private async admit(
    q: Queryable,
    p: {
      channelId: string;
      viewerId: string;
      displayName: string;
      source: 'chat' | 'extension' | 'manual';
      command: string | null;
      idempotencyKey: string;
      addedBy?: string;
    },
  ) {
    const now = this.clock.now();
    const r = await this.advance(q, p.channelId);
    if (p.source !== 'manual') {
      await assertNotGloballyPaused(q, p.channelId);
      const state = await moduleState(q, 'raffle');
      if (state === 'disabled')
        throw new RaffleLabError409('module_disabled', 'Tombola disabled');
      if (state === 'paused')
        throw new RaffleLabError409(
          'raffle_paused',
          'Tombola paused by moderation',
        );
      if (await activeBlock(q, p.channelId, p.viewerId, 'raffle', now))
        throw new RaffleLabError409(
          'viewer_blocked',
          'Tombola unavailable for this viewer',
        );
    }
    if (!r || !BEFORE_DRAW.includes(r.status))
      throw new RaffleLabError409('raffle_closed', 'no open Tombola');
    if (r.status === 'paused')
      throw new RaffleLabError409('round_paused', 'the Tombola is paused');
    if (
      p.source === 'extension' &&
      !(await this.config(q, p.channelId)).extension_button
    )
      throw new RaffleLabError409(
        'extension_join_disabled',
        'entry from the extension is disabled',
      );
    const prior = (
      await q.query<EntryRow>(
        'select * from lab_raffle_entries where raffle_id = $1 and viewer_id = $2',
        [r.raffle_id, p.viewerId],
      )
    )[0];
    if (prior) {
      if (prior.removed_at && p.source !== 'manual')
        throw new RaffleLabError409(
          'entry_removed',
          'removed from this Tombola by moderation',
        );
      if (prior.removed_at) {
        await q.query(
          'update lab_raffle_entries set removed_at = null, removed_by = null, removed_reason = null, added_by = $2 where entry_id = $1',
          [prior.entry_id, p.addedBy ?? null],
        );
        return {
          raffle_id: r.raffle_id,
          entry_id: prior.entry_id,
          joined: true,
          replayed: false,
          source: prior.source,
        };
      }
      // One entry per viewer, whatever the source: the first one is kept.
      return {
        raffle_id: r.raffle_id,
        entry_id: prior.entry_id,
        joined: true,
        replayed: true,
        source: prior.source,
      };
    }
    const id = randomUUID();
    await q.query(
      `insert into lab_raffle_entries (entry_id, raffle_id, channel_id, viewer_id, viewer_display_name, idempotency_key, created_at, source, command, added_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        r.raffle_id,
        p.channelId,
        p.viewerId,
        p.displayName,
        p.idempotencyKey,
        now,
        p.source,
        p.command,
        p.addedBy ?? null,
      ],
    );
    await seeViewer(q, p.channelId, p.viewerId, p.displayName, now);
    return {
      raffle_id: r.raffle_id,
      entry_id: id,
      joined: true,
      replayed: false,
      source: p.source,
    };
  }

  private async withPauseCount<T>(channelId: string, fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof GlobalPauseError)) throw e;
      await countGlobalRefusal(this.db, channelId, this.clock.now());
      throw new RaffleLabError409('global_pause', e.message);
    }
  }

  /** Free entry from the extension (one per viewer and per round). A retry answers « already in ». */
  async join(req: LabRaffleJoinRequest) {
    await this.settle(req.channel_id);
    return this.withPauseCount(req.channel_id, () =>
      this.db.tx((q) =>
        this.admit(q, {
          channelId: req.channel_id,
          viewerId: req.viewer.id,
          displayName: req.viewer.display_name,
          source: 'extension',
          command: null,
          idempotencyKey: req.idempotency_key,
        }),
      ),
    );
  }

  /**
   * One chat message (Twitch adapter or Studio simulator): an entry command (« !join », « !enter »,
   * Studio aliases) joins; a cancel command cancels when Core finds the author is a moderator or
   * above; anything else is ignored. A message is handled once (replays answer the same outcome).
   */
  async chat(msg: RaffleChatMessage) {
    const word = (msg.text.trim().split(/\s+/)[0] ?? '').toLowerCase();
    const cfg = await this.db.tx((q) => this.config(q, msg.channel_id));
    const isJoin = this.joinCommands(cfg).includes(word);
    const isCancel = cfg.cancel_commands.includes(word);
    if (!isJoin && !isCancel) return { outcome: 'ignored' };
    const prior = (
      await this.db.query<{ outcome: string }>(
        'select outcome from lab_raffle_chat where channel_id = $1 and message_id = $2',
        [msg.channel_id, msg.message_id],
      )
    )[0];
    if (prior) return { outcome: prior.outcome, replayed: true };
    await this.settle(msg.channel_id);
    let outcome: string;
    try {
      if (isJoin) {
        const out = await this.withPauseCount(msg.channel_id, () =>
          this.db.tx((q) =>
            this.admit(q, {
              channelId: msg.channel_id,
              viewerId: msg.chatter.id,
              displayName: msg.chatter.display_name,
              source: 'chat',
              command: word,
              idempotencyKey: `chat:${msg.message_id}`,
            }),
          ),
        );
        outcome = out.replayed ? 'already_joined' : 'joined';
      } else {
        await this.act(msg.channel_id, {
          actor: {
            id: msg.chatter.id,
            login: msg.chatter.login,
            display_name: msg.chatter.display_name,
            // A « broadcaster » badge counts only for the channel's own account.
            role:
              msg.chatter.role === 'broadcaster' &&
              msg.chatter.id !== msg.channel_id
                ? 'viewer'
                : msg.chatter.role,
            via: 'extension',
          },
          command: { action: 'cancel', reason: `commande chat ${word}` },
        });
        outcome = 'cancelled';
      }
    } catch (e) {
      const code = (e as { code?: string; permission?: string }).permission
        ? 'forbidden'
        : (e as { code?: string }).code;
      if (!code) throw e;
      outcome = code;
    }
    await this.db.query(
      'insert into lab_raffle_chat (channel_id, message_id, outcome, created_at) values ($1, $2, $3, $4) on conflict do nothing',
      [msg.channel_id, msg.message_id, outcome, this.clock.now()],
    );
    return { outcome };
  }

  // --- commands (Studio, moderation console, chat cancel) ----------------------------------------------

  /** Permission a Tombola command needs (decision D7). */
  static needs(cmd: RaffleCommand): string {
    switch (cmd.action) {
      case 'cancel':
      case 'remove_participant':
        return 'raffle.moderate';
      case 'config':
      case 'stream_start':
      case 'stream_end':
        return 'raffle.config';
      default:
        return 'raffle.manage';
    }
  }

  async act(channelId: string, req: { actor: Actor; command: RaffleCommand }) {
    await this.settle(channelId);
    return this.db.tx(async (q) => {
      const now = this.clock.now();
      await touchStaff(q, channelId, req.actor, now);
      const acc = await access(q, channelId, req.actor);
      assertAccess(acc, RaffleLabService.needs(req.command));
      return this.apply(q, channelId, req.command, req.actor, acc.role);
    });
  }

  private async apply(
    q: Queryable,
    channelId: string,
    cmd: RaffleCommand,
    actor: Actor,
    role: LabRole,
  ): Promise<Record<string, unknown>> {
    const now = this.clock.now();
    const reason = 'reason' in cmd ? (cmd.reason ?? null) : null;
    const r = await this.advance(q, channelId);
    const log = (
      action: string,
      extra: Partial<Parameters<typeof audit>[2]> = {},
    ) =>
      audit(q, now, {
        channelId,
        actor,
        role,
        module: 'raffle',
        action,
        reason,
        interactionId: r?.raffle_id ?? null,
        ...extra,
      });
    const needRound = (allowed: RaffleStatus[]) => {
      if (!r || !allowed.includes(r.status))
        throw new RaffleLabError409(
          r ? 'invalid_phase' : 'no_open_raffle',
          r
            ? `not possible while the Tombola is ${r.status}`
            : 'no open Tombola',
        );
      return r;
    };
    switch (cmd.action) {
      case 'launch':
        return this.launch(
          q,
          channelId,
          actor,
          role,
          now,
          { kind: cmd.kind },
          reason,
        );
      case 'extend': {
        const cur = needRound(BEFORE_DRAW);
        const before = {
          closes_at: iso(cur.ends_at),
          duration_s: cur.duration_s,
        };
        if (cur.status === 'paused')
          await q.query(
            'update lab_raffles set paused_remaining_ms = paused_remaining_ms + $2, duration_s = duration_s + $3 where raffle_id = $1',
            [cur.raffle_id, cmd.seconds * 1000, cmd.seconds],
          );
        else
          await q.query(
            'update lab_raffles set ends_at = ends_at + make_interval(secs => $2), duration_s = duration_s + $2 where raffle_id = $1',
            [cur.raffle_id, cmd.seconds],
          );
        const after = (
          await q.query<RaffleRow>(
            'select * from lab_raffles where raffle_id = $1',
            [cur.raffle_id],
          )
        )[0]!;
        await log('raffle_extend', {
          before,
          after: {
            closes_at: iso(after.ends_at),
            duration_s: after.duration_s,
            added_s: cmd.seconds,
          },
        });
        return { ok: true, closes_at: iso(after.ends_at) };
      }
      case 'pause': {
        const cur = needRound(['opening', 'open']);
        const remaining = Math.max(0, ms(cur.ends_at) - now.getTime());
        await this.setStatus(q, cur, 'paused', now, {
          paused_at: now,
          paused_remaining_ms: remaining,
        });
        await log('raffle_pause', { after: { remaining_ms: remaining } });
        return { ok: true, remaining_ms: remaining };
      }
      case 'resume': {
        const cur = needRound(['paused']);
        const ends = at(now, cur.paused_remaining_ms ?? 0);
        await this.setStatus(q, cur, 'open', now, {
          ends_at: ends,
          paused_at: null,
          paused_remaining_ms: null,
        });
        await log('raffle_resume', {
          after: { closes_at: ends.toISOString() },
        });
        return { ok: true, closes_at: ends.toISOString() };
      }
      case 'draw_now': {
        const cur = needRound(BEFORE_DRAW);
        await this.draw(q, cur, now, actor, role, reason);
        return {
          ok: true,
          raffle_id: cur.raffle_id,
          winners: await this.publicWinners(q, cur.raffle_id),
        };
      }
      case 'cancel': {
        const cur = needRound(BEFORE_DRAW);
        const was = cur.status;
        await this.setStatus(q, cur, 'cancelled', now, {
          cancelled_at: now,
          cancelled_by: actorName(actor),
          cancel_reason: reason,
          closed_at: now,
          finished_at: now,
          paused_at: null,
          paused_remaining_ms: null,
        });
        const n = (await this.activeEntries(q, cur.raffle_id)).length;
        await log('raffle_cancel', {
          before: { status: was, participants: n },
          after: { status: 'cancelled' },
        });
        return { ok: true, raffle_id: cur.raffle_id };
      }
      case 'add_participant': {
        const cur = needRound(['opening', 'open']);
        // A global / module pause does not stop a deliberate moderation entry; an individual
        // Tombola block does, unless the moderator explicitly forces it (audited).
        const block = await activeBlock(
          q,
          channelId,
          cmd.viewer_id,
          'raffle',
          now,
        );
        if (block && !cmd.force)
          throw new RaffleLabError409(
            'viewer_blocked',
            'this viewer is blocked from the Tombola: confirm to force the entry',
          );
        const out = await this.admit(q, {
          channelId,
          viewerId: cmd.viewer_id,
          displayName: cmd.display_name,
          source: 'manual',
          command: null,
          idempotencyKey: `manual:${cur.raffle_id}:${cmd.viewer_id}`,
          addedBy: actorName(actor),
        });
        if (out.replayed)
          throw new RaffleLabError409(
            'already_joined',
            'already in this Tombola',
          );
        await log('raffle_add_participant', {
          viewerId: cmd.viewer_id,
          after: {
            display_name: cmd.display_name,
            forced_over_block: !!block,
            ...(block
              ? { block_until: block.until ? iso(block.until) : null }
              : {}),
          },
        });
        return { ok: true, entry_id: out.entry_id };
      }
      case 'remove_participant': {
        const cur = needRound(BEFORE_DRAW);
        const done = await q.query<{
          entry_id: string;
          viewer_display_name: string;
          source: string;
        }>(
          `update lab_raffle_entries set removed_at = $3, removed_by = $4, removed_reason = $5
           where raffle_id = $1 and viewer_id = $2 and removed_at is null returning entry_id, viewer_display_name, source`,
          [cur.raffle_id, cmd.viewer_id, now, actorName(actor), reason],
        );
        if (!done.length)
          throw new RaffleLabError409(
            'not_a_participant',
            'not in this Tombola',
          );
        await log('raffle_remove_participant', {
          viewerId: cmd.viewer_id,
          before: {
            display_name: done[0]!.viewer_display_name,
            source: done[0]!.source,
          },
        });
        return { ok: true };
      }
      case 'retry_payout': {
        const w = (
          await q.query<WinnerRow & { channel_id: string }>(
            `select w.*, r.channel_id from lab_raffle_winners w join lab_raffles r on r.raffle_id = w.raffle_id
             where w.raffle_id = $1 and w.viewer_id = $2 and r.channel_id = $3`,
            [cmd.raffle_id, cmd.viewer_id, channelId],
          )
        )[0];
        if (!w)
          throw new RaffleLabError409(
            'not_a_winner',
            'not a winner of this Tombola',
          );
        if (w.payout_status === 'paid')
          throw new RaffleLabError409('already_paid', 'already paid');
        if (w.payout_status === 'none')
          throw new RaffleLabError409(
            'nothing_to_pay',
            'nothing to pay (giveaway)',
          );
        await this.pay(q, cmd.raffle_id, channelId, cmd.viewer_id, now);
        const after = (await this.winnerRows(q, [cmd.raffle_id])).find(
          (x) => x.viewer_id === cmd.viewer_id,
        )!;
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'raffle',
          action: 'raffle_retry_payout',
          reason,
          interactionId: cmd.raffle_id,
          viewerId: cmd.viewer_id,
          before: { payout: w.payout_status, failure: w.failure },
          after: {
            payout: after.payout_status,
            ledger_id:
              after.ledger_id === null ? null : Number(after.ledger_id),
            failure: after.failure,
          },
        });
        return {
          ok: after.payout_status === 'paid',
          payout_status: after.payout_status,
          failure: after.failure,
        };
      }
      case 'config': {
        try {
          validateConfig(cmd.config);
        } catch (e) {
          if (e instanceof RaffleConfigError)
            throw new RaffleLabError409('invalid_config', e.message);
          throw e;
        }
        for (const id of [
          cmd.config.currency_id,
          cmd.config.super.currency_id,
        ]) {
          const c = await currency(q, id);
          if (!c || !c.available)
            throw new RaffleLabError409(
              'invalid_config',
              `currency ${id} is not available`,
            );
        }
        const before = await this.config(q, channelId);
        await q.query(
          `insert into lab_raffle_settings (channel_id, config, updated_at, updated_by) values ($1, $2, $3, $4)
           on conflict (channel_id) do update set config = excluded.config, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          [channelId, JSON.stringify(cmd.config), now, actorName(actor)],
        );
        await log('raffle_config', {
          interactionId: null,
          before,
          after: cmd.config,
        });
        return { ok: true, config: cmd.config };
      }
      case 'stream_start': {
        if (await this.liveSession(q, channelId))
          throw new RaffleLabError409(
            'stream_already_live',
            'a stream session is already live',
          );
        return {
          ok: true,
          session_id: await this.startSession(
            q,
            channelId,
            actor,
            role,
            now,
            reason,
          ),
        };
      }
      case 'stream_end': {
        const live = await this.liveSession(q, channelId);
        if (!live)
          throw new RaffleLabError409(
            'no_live_stream',
            'no live stream session',
          );
        await q.query(
          'update lab_stream_sessions set ended_at = $2, ended_by = $3 where session_id = $1',
          [live.session_id, now, actorName(actor)],
        );
        await log('stream_end', {
          interactionId: null,
          after: { session_id: live.session_id },
        });
        return { ok: true, session_id: live.session_id };
      }
    }
  }

  /**
   * Opens a round with the current configuration. SUPER: forced by Studio, or rolled (1 in N). The
   * reward is decided now (and shown); FULL OSEILLE is decided at the draw only.
   */
  private async launch(
    q: Queryable,
    channelId: string,
    actor: Actor,
    role: LabRole,
    now: Date,
    opts: {
      kind: 'auto' | 'super';
      fixed?: { jackpot: number; duration_s: number; winners: number };
    },
    reason: string | null,
  ) {
    if (await this.running(q, channelId))
      throw new RaffleLabError409(
        'raffle_already_open',
        'a Tombola is already running',
      );
    await assertNotGloballyPaused(q, channelId).catch(() => {
      throw new RaffleLabError409('global_pause', 'Raptoru is paused');
    });
    if ((await moduleState(q, 'raffle')) === 'disabled')
      throw new RaffleLabError409('module_disabled', 'Tombola disabled');
    const c = await this.config(q, channelId);
    const session =
      (await this.liveSession(q, channelId))?.session_id ??
      (await this.startSession(
        q,
        channelId,
        actor,
        role,
        now,
        'session ouverte avec la Tombola',
      ));
    let kind: 'normal' | 'super' | 'giveaway';
    if (opts.fixed) kind = 'normal';
    else if (opts.kind === 'super') kind = 'super';
    else if (c.amount_mode === 'giveaway') kind = 'giveaway';
    else if (c.super.enabled && this.random() < 1 / c.super.one_in)
      kind = 'super';
    else kind = 'normal';
    const currencyId =
      kind === 'giveaway'
        ? null
        : kind === 'super'
          ? c.super.currency_id
          : c.currency_id;
    if (currencyId) {
      const cur = await currency(q, currencyId);
      if (!cur || !cur.available)
        throw new RaffleLabError409(
          'currency_unavailable',
          `currency ${currencyId} is not available`,
        );
    }
    const jackpot = opts.fixed
      ? opts.fixed.jackpot
      : kind === 'giveaway'
        ? 0
        : kind === 'super'
          ? c.super.jackpot
          : c.amount_mode === 'fixed'
            ? c.fixed_amount
            : randomJackpot(c.random, this.random);
    if (kind !== 'giveaway' && jackpot <= 0)
      throw new RaffleLabError409(
        'invalid_amount',
        'the reward must be above 0',
      );
    const duration = opts.fixed?.duration_s ?? c.duration_s;
    const openAt = at(now, c.display.intro_s * 1000);
    const id = randomUUID();
    const winnersMode = opts.fixed ? 'custom' : c.winners_mode;
    const winnersCustom = opts.fixed?.winners ?? c.winners_custom;
    const settings: RoundSettings = {
      display: c.display,
      full: c.full,
      winners_custom: winnersCustom,
    };
    const status: RaffleStatus = c.display.intro_s > 0 ? 'opening' : 'open';
    await q.query(
      `insert into lab_raffles (raffle_id, channel_id, status, jackpot, winners_count, opened_at, ends_at, opened_by, kind, currency_id, prize,
         winners_mode, duration_s, open_at, session_id, display, phase_changed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $6)`,
      [
        id,
        channelId,
        status,
        jackpot,
        winnersMode === 'custom' ? winnersCustom : 0,
        now,
        at(openAt, duration * 1000),
        actorName(actor),
        kind,
        currencyId,
        kind === 'giveaway' ? c.prize : null,
        winnersMode,
        duration,
        openAt,
        session,
        JSON.stringify(settings),
      ],
    );
    await audit(q, now, {
      channelId,
      actor,
      role,
      module: 'raffle',
      action: 'raffle_open',
      interactionId: id,
      reason,
      after: {
        raffle_id: id,
        kind,
        jackpot,
        currency_id: currencyId,
        prize: kind === 'giveaway' ? c.prize : null,
        duration_s: duration,
        winners: winnersMode === 'custom' ? winnersCustom : 'auto',
        closes_at: at(openAt, duration * 1000).toISOString(),
      },
    });
    return { ok: true, raffle_id: id, kind, jackpot, currency_id: currencyId };
  }

  /** D4 console commands (moderation transaction, permission already checked). */
  async applyModeration(
    q: Queryable,
    channelId: string,
    cmd: LabModerationCommand,
    actor: Actor,
    role: LabRole,
  ) {
    const now = this.clock.now();
    const reason = 'reason' in cmd ? (cmd.reason ?? null) : null;
    switch (cmd.action) {
      case 'module_state': {
        const before = await moduleState(q, 'raffle');
        await setModuleState(q, 'raffle', cmd.state, now, actor.id);
        await audit(q, now, {
          channelId,
          actor,
          role,
          module: 'raffle',
          action: `module_${cmd.state}`,
          reason,
          before: { state: before },
          after: { state: cmd.state },
        });
        return { ok: true, module_state: cmd.state };
      }
      // The minimal console commands now open a V2 round (fixed reward) and draw it.
      case 'raffle_open':
        await this.advance(q, channelId);
        return this.launch(
          q,
          channelId,
          actor,
          role,
          now,
          {
            kind: 'auto',
            fixed: {
              jackpot: cmd.jackpot,
              duration_s: cmd.duration_s,
              winners: cmd.winners,
            },
          },
          reason,
        );
      case 'raffle_close':
      case 'raffle_draw': {
        const r = await this.advance(q, channelId);
        if (!r || !BEFORE_DRAW.includes(r.status))
          throw new RaffleLabError409(
            'nothing_to_draw',
            'no Tombola waiting for its draw',
          );
        await this.draw(q, r, now, actor, role, reason);
        return {
          ok: true,
          raffle_id: r.raffle_id,
          winners: await this.publicWinners(q, r.raffle_id),
        };
      }
      default:
        throw new RaffleLabError409(
          'unsupported',
          `${cmd.action} does not apply to the Tombola`,
        );
    }
  }

  // --- read models -----------------------------------------------------------------------------------

  private async winnerRows(q: Queryable, ids: string[]) {
    if (!ids.length) return [];
    return q.query<WinnerRow>(
      'select * from lab_raffle_winners where raffle_id = any($1::uuid[]) order by raffle_id, position',
      [ids],
    );
  }

  private async publicWinners(q: Queryable, raffleId: string) {
    return (await this.winnerRows(q, [raffleId])).map((w) => ({
      viewer_id: w.viewer_id,
      display_name: w.viewer_display_name,
      amount: Number(w.amount),
      position: w.position,
      payout_status: w.payout_status,
      ledger_id: w.ledger_id === null ? null : Number(w.ledger_id),
    }));
  }

  private currencyView(c: LabCurrency | undefined) {
    return c
      ? {
          id: c.currency_id,
          label: c.label,
          short_label: c.short_label,
          icon: c.icon,
        }
      : null;
  }

  /** Round fields everyone may see (FULL and the winners are added by the callers when due). */
  private roundBase(r: RaffleRow, currencies: LabCurrency[], now: number) {
    const remaining =
      r.status === 'paused'
        ? (r.paused_remaining_ms ?? 0)
        : BEFORE_DRAW.includes(r.status)
          ? Math.max(0, ms(r.ends_at) - now)
          : 0;
    return {
      raffle_id: r.raffle_id,
      status: r.status,
      kind: r.kind,
      amount: Number(r.jackpot),
      currency: this.currencyView(
        currencies.find((c) => c.currency_id === r.currency_id),
      ),
      prize: r.prize,
      opened_at: iso(r.opened_at)!,
      open_at: iso(r.open_at)!,
      closes_at: iso(r.ends_at)!,
      duration_ms: r.duration_s * 1000,
      remaining_ms: remaining,
      paused: r.status === 'paused',
      cancelled_at: iso(r.cancelled_at),
    };
  }

  private async entryViews(q: Queryable, entries: EntryRow[]) {
    const avatars = await avatarUrls(
      q,
      entries.map((e) => e.viewer_id),
    );
    return entries.map((e) => ({
      seq: Number(e.seq),
      viewer_id: e.viewer_id,
      display_name: e.viewer_display_name,
      source: e.source,
      avatar_url: avatars.get(e.viewer_id) ?? null,
      created_at: iso(e.created_at)!,
    }));
  }

  /** The round an overlay / the Studio live view shows now (running, or cancelled during its display). */
  private async shownRound(
    q: Queryable,
    channelId: string,
  ): Promise<RaffleRow | null> {
    const r = await this.advance(q, channelId);
    if (r) return r;
    const last = (
      await q.query<RaffleRow>(
        'select * from lab_raffles where channel_id = $1 order by opened_at desc limit 1',
        [channelId],
      )
    )[0];
    if (
      last?.status === 'cancelled' &&
      this.clock.now().getTime() <
        ms(last.cancelled_at) + settingsOf(last).display.cancelled_s * 1000
    )
      return last;
    return null;
  }

  /**
   * OBS overlay (and Studio preview) snapshot: everything to (re)draw the single source at any time,
   * reload included. The winners and FULL only from the start of the reveal; the participant pool
   * (roulette) with them.
   */
  async snapshot(channelId: string) {
    return this.db.tx(async (q) => {
      const now = this.clock.now();
      const cfg = await this.config(q, channelId);
      const currencies = await listCurrencies(q);
      const r = await this.shownRound(q, channelId);
      const base = {
        server_time: now.toISOString(),
        module_state: await moduleState(q, 'raffle'),
        overlay_hint: cfg.overlay_hint,
        join_feedback_ms: cfg.display.join_feedback_ms,
      };
      if (!r) return { ...base, round: null };
      const entries = await this.activeEntries(q, r.raffle_id);
      const views = await this.entryViews(q, entries);
      const revealed = r.reveal_at !== null && now.getTime() >= ms(r.reveal_at);
      const winners = revealed ? await this.winnerRows(q, [r.raffle_id]) : [];
      const byId = new Map(views.map((v) => [v.viewer_id, v]));
      const avatars = revealed
        ? await avatarUrls(
            q,
            winners.map((w) => w.viewer_id),
          )
        : new Map<string, string>();
      return {
        ...base,
        round: {
          ...this.roundBase(r, currencies, now.getTime()),
          participants: entries.length,
          recent: views.slice(-5).reverse(),
          entries_tail: views.slice(-20),
          cancel_until:
            r.status === 'cancelled'
              ? new Date(
                  ms(r.cancelled_at) + settingsOf(r).display.cancelled_s * 1000,
                ).toISOString()
              : null,
          reveal_at: iso(r.reveal_at),
          reveal: revealed
            ? {
                is_full: r.is_full,
                reveal_ms: ms(r.reveal_end_at) - ms(r.reveal_at),
                reveal_end_at: iso(r.reveal_end_at),
                overlay_end_at: iso(r.overlay_end_at),
                winners: winners.map((w) => ({
                  position: w.position,
                  viewer_id: w.viewer_id,
                  display_name: w.viewer_display_name,
                  source: byId.get(w.viewer_id)?.source ?? 'extension',
                  avatar_url: avatars.get(w.viewer_id) ?? null,
                  amount: Number(w.amount),
                })),
                pool: views.slice(0, 40),
              }
            : null,
        },
      };
    });
  }

  /**
   * What one viewer may see (extension). Never a spoiler: the result (winners, FULL) only from
   * `viewer_result_at` (end of the overlay reveal + the stream margin); until then « Tirage en cours ».
   */
  async viewerState(channelId: string, viewerId: string | null) {
    return this.db.tx(async (q) => {
      const now = this.clock.now();
      const t = now.getTime();
      const cfg = await this.config(q, channelId);
      const currencies = await listCurrencies(q);
      await this.advance(q, channelId);
      const last = (
        await q.query<RaffleRow>(
          'select * from lab_raffles where channel_id = $1 order by opened_at desc limit 1',
          [channelId],
        )
      )[0];
      const common = {
        server_time: now.toISOString(),
        module_state: await moduleState(q, 'raffle'),
        extension_button: cfg.extension_button,
        join_command: '!join',
        history: await this.viewerHistory(
          q,
          channelId,
          viewerId,
          currencies,
          t,
        ),
      };
      if (!last) return { ...common, phase: 'idle' as const, round: null };
      const entries = await this.activeEntries(q, last.raffle_id);
      const mine = viewerId
        ? entries.find((e) => e.viewer_id === viewerId)
        : undefined;
      const round = {
        ...this.roundBase(last, currencies, t),
        participants: entries.length,
        counts: {
          chat: entries.filter((e) => e.source === 'chat').length,
          extension: entries.filter((e) => e.source === 'extension').length,
          manual: entries.filter((e) => e.source === 'manual').length,
        },
        joined: !!mine,
        my_source: mine?.source ?? null,
      };
      let phase:
        'idle' | 'open' | 'paused' | 'drawing' | 'result' | 'cancelled';
      if (last.status === 'cancelled')
        phase =
          t <
          ms(last.cancelled_at) +
            settingsOf(last).display.extension_idle_return_s * 1000
            ? 'cancelled'
            : 'idle';
      else if (last.status === 'opening' || last.status === 'open')
        phase = 'open';
      else if (last.status === 'paused') phase = 'paused';
      else if (t < ms(last.viewer_result_at)) phase = 'drawing';
      else if (t < ms(last.viewer_idle_at)) phase = 'result';
      else phase = 'idle';
      if (phase === 'idle') return { ...common, phase, round: null };
      if (phase === 'open' || phase === 'paused')
        return {
          ...common,
          phase,
          round: { ...round, list: await this.entryViews(q, entries) },
        };
      if (phase === 'cancelled' || phase === 'drawing')
        return {
          ...common,
          phase,
          round: { ...round, result_at: iso(last.viewer_result_at) },
        };
      const winners = await this.winnerRows(q, [last.raffle_id]);
      const avatars = await avatarUrls(
        q,
        winners.map((w) => w.viewer_id),
      );
      const me = viewerId
        ? winners.find((w) => w.viewer_id === viewerId)
        : undefined;
      return {
        ...common,
        phase,
        round: {
          ...round,
          is_full: last.is_full,
          winners: winners.map((w) => ({
            position: w.position,
            viewer_id: w.viewer_id,
            display_name: w.viewer_display_name,
            avatar_url: avatars.get(w.viewer_id) ?? null,
            amount: Number(w.amount),
          })),
          won: !!me,
          my_gain: me ? Number(me.amount) : 0,
          idle_at: iso(last.viewer_idle_at),
        },
      };
    });
  }

  /** Viewer history: the Tombolas of the current stream session whose result viewers may see. */
  private async viewerHistory(
    q: Queryable,
    channelId: string,
    viewerId: string | null,
    currencies: LabCurrency[],
    t: number,
  ) {
    const session = await this.currentSession(q, channelId);
    if (!session) return [];
    const rows = await q.query<RaffleRow>(
      `select * from lab_raffles where session_id = $1 and status in ('drawing', 'revealing', 'revealed', 'finished', 'cancelled')
       order by opened_at desc limit 30`,
      [session.session_id],
    );
    const visible = rows.filter(
      (r) => r.status === 'cancelled' || t >= ms(r.viewer_result_at),
    );
    const wins = await this.winnerRows(
      q,
      visible.map((r) => r.raffle_id),
    );
    const counts = await this.participantCounts(
      q,
      visible.map((r) => r.raffle_id),
    );
    return visible.map((r) => {
      const w = wins.filter((x) => x.raffle_id === r.raffle_id);
      return {
        raffle_id: r.raffle_id,
        at: iso(r.drawn_at ?? r.cancelled_at)!,
        status: r.status === 'cancelled' ? 'cancelled' : 'done',
        kind: r.kind,
        is_full: r.status === 'cancelled' ? false : r.is_full,
        amount: Number(r.jackpot),
        currency: this.currencyView(
          currencies.find((c) => c.currency_id === r.currency_id),
        ),
        prize: r.prize,
        participants: counts.get(r.raffle_id) ?? 0,
        winners: w.map((x) => ({
          display_name: x.viewer_display_name,
          amount: Number(x.amount),
        })),
        me: !!viewerId && w.some((x) => x.viewer_id === viewerId),
      };
    });
  }

  private async participantCounts(q: Queryable, ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    return new Map(
      (
        await q.query<{ raffle_id: string; n: string | number }>(
          'select raffle_id, count(*) as n from lab_raffle_entries where raffle_id = any($1::uuid[]) and removed_at is null group by raffle_id',
          [ids],
        )
      ).map((r) => [r.raffle_id, Number(r.n)]),
    );
  }

  /**
   * Full round card (team only: Studio, moderation console): state, reward, timeline, entries with
   * their source and removals, winners with their payout (expected amount, ledger movement, status,
   * date, failure), and the audit trail of this round.
   */
  async round(channelId: string, raffleId: string) {
    return this.db.tx(async (q) => {
      await this.advance(q, channelId);
      const r = (
        await q.query<RaffleRow>(
          'select * from lab_raffles where raffle_id = $1 and channel_id = $2',
          [raffleId, channelId],
        )
      )[0];
      if (!r)
        throw new RaffleLabError409('raffle_not_found', 'no such Tombola');
      const now = this.clock.now().getTime();
      const currencies = await listCurrencies(q);
      const all = await q.query<EntryRow>(
        'select * from lab_raffle_entries where raffle_id = $1 order by seq',
        [raffleId],
      );
      const avatars = await avatarUrls(
        q,
        all.map((e) => e.viewer_id),
      );
      const winners = await this.winnerRows(q, [raffleId]);
      const ledger = winners.length
        ? await q.query<{
            id: number;
            viewer_id: string;
            amount: string | number;
            currency: string;
            created_at: Date;
          }>(
            `select id, viewer_id, amount, currency, created_at from lab_wallet_ledger where raffle_id = $1 and kind = 'raffle_win'`,
            [raffleId],
          )
        : [];
      const trail = await q.query<{
        created_at: Date;
        actor: string;
        role: string;
        action: string;
        viewer_id: string | null;
        reason: string | null;
        before: unknown;
        after: unknown;
      }>(
        `select created_at, actor, role, action, viewer_id, reason, before, after from lab_moderation_audit
         where channel_id = $1 and module_id = 'raffle' and interaction_id = $2 order by id`,
        [channelId, raffleId],
      );
      return {
        ...this.roundBase(r, currencies, now),
        is_full: r.reveal_at ? r.is_full : null,
        winners_mode: r.winners_mode,
        opened_by: r.opened_by,
        session_id: r.session_id,
        timeline: {
          opened_at: iso(r.opened_at),
          open_at: iso(r.open_at),
          closes_at: iso(r.ends_at),
          closed_at: iso(r.closed_at),
          drawn_at: iso(r.drawn_at),
          reveal_at: iso(r.reveal_at),
          reveal_end_at: iso(r.reveal_end_at),
          viewer_result_at: iso(r.viewer_result_at),
          overlay_end_at: iso(r.overlay_end_at),
          cancelled_at: iso(r.cancelled_at),
          finished_at: iso(r.finished_at),
        },
        cancelled_by: r.cancelled_by,
        cancel_reason: r.cancel_reason,
        entries: all.map((e) => ({
          viewer_id: e.viewer_id,
          display_name: e.viewer_display_name,
          source: e.source,
          command: e.command,
          avatar_url: avatars.get(e.viewer_id) ?? null,
          created_at: iso(e.created_at),
          added_by: e.added_by,
          removed_at: iso(e.removed_at),
          removed_by: e.removed_by,
          removed_reason: e.removed_reason,
        })),
        winners: winners.map((w) => {
          const l = ledger.find((x) => x.viewer_id === w.viewer_id);
          return {
            position: w.position,
            viewer_id: w.viewer_id,
            display_name: w.viewer_display_name,
            expected: Number(w.amount),
            currency: this.currencyView(
              currencies.find((c) => c.currency_id === w.currency_id),
            ),
            payout_status: w.payout_status,
            ledger_id: l ? Number(l.id) : null,
            credited: l ? Number(l.amount) : 0,
            paid_at: iso(w.paid_at),
            attempts: w.attempts,
            failure: w.failure,
          };
        }),
        audit: trail.map((a) => ({ ...a, created_at: iso(a.created_at) })),
      };
    });
  }

  /** Studio history: every round (all sessions), newest first. */
  async history(channelId: string, limit = 30) {
    return this.db.tx(async (q) => {
      await this.advance(q, channelId);
      const currencies = await listCurrencies(q);
      const rows = await q.query<RaffleRow>(
        'select * from lab_raffles where channel_id = $1 order by opened_at desc limit $2',
        [channelId, limit],
      );
      const wins = await this.winnerRows(
        q,
        rows.map((r) => r.raffle_id),
      );
      const counts = await this.participantCounts(
        q,
        rows.map((r) => r.raffle_id),
      );
      const now = this.clock.now().getTime();
      return rows.map((r) => {
        const w = wins.filter((x) => x.raffle_id === r.raffle_id);
        return {
          ...this.roundBase(r, currencies, now),
          is_full: r.reveal_at ? r.is_full : null,
          session_id: r.session_id,
          participants: counts.get(r.raffle_id) ?? 0,
          winners: w.map((x) => ({
            viewer_id: x.viewer_id,
            display_name: x.viewer_display_name,
            amount: Number(x.amount),
            payout_status: x.payout_status,
          })),
          payouts: {
            paid: w.filter((x) => x.payout_status === 'paid').length,
            failed: w.filter((x) => x.payout_status === 'failed').length,
          },
        };
      });
    });
  }

  /** Studio: configuration, registered currencies, stream session. */
  async settings(channelId: string) {
    return this.db.tx(async (q) => ({
      config: await this.config(q, channelId),
      currencies: (await listCurrencies(q)).map((c) => ({
        ...this.currencyView(c)!,
        available: c.available,
      })),
      stream: await this.liveSession(q, channelId).then((s) =>
        s
          ? {
              session_id: s.session_id,
              started_at: iso(s.started_at),
              source: s.source,
            }
          : null,
      ),
      base_join_commands: [...BASE_JOIN_COMMANDS],
    }));
  }

  /**
   * Minimal-console shape (extension façade, D4 overview) computed from the V2 model, until those
   * surfaces use the V2 read models: open / drawn / cancelled, jackpot, participants, history.
   */
  async state(channelId: string, viewerId: string | null = null) {
    return this.db.tx(async (q) => {
      await this.advance(q, channelId);
      const cur = (
        await q.query<RaffleRow>(
          'select * from lab_raffles where channel_id = $1 order by opened_at desc limit 1',
          [channelId],
        )
      )[0];
      const legacy = (r: RaffleRow) =>
        BEFORE_DRAW.includes(r.status)
          ? 'open'
          : r.status === 'cancelled'
            ? 'cancelled'
            : 'drawn';
      const view = (r: RaffleRow, participants: number) => ({
        raffle_id: r.raffle_id,
        status: legacy(r),
        phase: r.status,
        kind: r.kind,
        jackpot: Number(r.jackpot),
        winners_count: r.winners_count,
        opened_at: iso(r.opened_at)!,
        ends_at: iso(r.ends_at)!,
        closed_at: iso(r.closed_at),
        drawn_at: iso(r.drawn_at),
        opened_by: r.opened_by,
        participants,
      });
      const entries = cur ? await this.activeEntries(q, cur.raffle_id) : [];
      const drawn = await q.query<RaffleRow>(
        `select * from lab_raffles where channel_id = $1 and drawn_at is not null order by drawn_at desc limit 10`,
        [channelId],
      );
      const counts = await this.participantCounts(
        q,
        drawn.map((d) => d.raffle_id),
      );
      const wins = await this.winnerRows(
        q,
        drawn.map((d) => d.raffle_id),
      );
      const history = drawn.map((d) => ({
        ...view(d, counts.get(d.raffle_id) ?? 0),
        winners: wins
          .filter((w) => w.raffle_id === d.raffle_id)
          .map((w) => ({
            viewer_id: w.viewer_id,
            display_name: w.viewer_display_name,
            amount: Number(w.amount),
            ledger_id: w.ledger_id === null ? null : Number(w.ledger_id),
          })),
      }));
      const recent = await q.query<EntryRow & { raffle_id: string }>(
        'select * from lab_raffle_entries where channel_id = $1 and removed_at is null order by created_at desc limit 20',
        [channelId],
      );
      return {
        module_state: await moduleState(q, 'raffle'),
        current: cur ? view(cur, entries.length) : null,
        joined:
          !!viewerId &&
          !!cur &&
          BEFORE_DRAW.includes(cur.status) &&
          entries.some((e) => e.viewer_id === viewerId),
        participants: entries.map((e) => ({
          viewer_id: e.viewer_id,
          display_name: e.viewer_display_name,
          created_at: iso(e.created_at)!,
          source: e.source,
        })),
        last_draw: history[0] ?? null,
        history,
        recent_entries: recent.map((e) => ({
          interaction_id: e.entry_id,
          raffle_id: e.raffle_id,
          viewer_id: e.viewer_id,
          viewer_display_name: e.viewer_display_name,
          created_at: iso(e.created_at)!,
          status: 'completed',
          simulated_cost: 0,
          payment_method: 'tokens',
          tickets: 1,
          source: e.source,
        })),
      };
    });
  }
}
