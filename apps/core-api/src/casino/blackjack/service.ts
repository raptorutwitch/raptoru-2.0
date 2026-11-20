import { randomUUID } from 'node:crypto';
import type { Clock } from '../../clock.js';
import { insertAnnouncement } from '../../commands/steps.js';
import type { Db, Queryable } from '../../db/db.js';
import type { EconomyPort } from '../../economy/economy.js';
import {
  activeBlock,
  assertNotGloballyPaused,
  GlobalPauseError,
  LabWalletError,
} from '../../lab-moderation/store.js';
import { avatarUrls } from '../../raffle-lab/avatars.js';
import { CasinoError } from '../errors.js';
import { cryptoIntRng, type IntRng } from '../rng.js';
import type { CasinoService, CasinoViewer } from '../service.js';
import {
  act,
  BjError,
  clearBets,
  insure,
  leave,
  newTable,
  placeBets,
  resume,
  runDue,
  seatOf,
  sit,
  TABLE_SEATS,
  TIMING,
  view,
  type Ctx,
  type Rig,
  type TableState,
  type TableView,
  type Timing,
} from './engine.js';
import type { BlackjackLimits } from './paytable.js';

// Blackjack (docs/CASINO.md § 12) — the Core's multiplayer tables. One row per table (`casino_bj_tables`): its whole
// state (seats, hands, the shoe, the pending step), changed ONLY under that row's lock, in one transaction with the
// Wallet movements the change asked for (keys `casino:bj:…`: a replay applies nothing more). The extension sends
// intents and reads a redacted view (the hole card and the shoe's order never leave the Core).
//
// - Timers: each table saves its one pending step (`next_at`); `tick()` runs the due ones (every 250 ms in the Core).
//   After a restart they run late: a past decision is a STAND, a past insurance a « no », betting closes with the ready.
// - Tables: created on demand under the channel's lobby lock (two first players at once → ONE table n°1); up to
//   MAX_TABLES; a full table (10) opens the next one. An empty table keeps its identity and runs no step.
// - One player = one table at a time (checked under the lobby lock).
// - Presence: the screen polls its table; a player unseen for PRESENT_MS counts as disconnected (never blocks a deal,
//   auto-declines insurance; never seen for 90 s outside a round = seat freed). In memory: one Core process (Production).
// - Results are paid once per round and written to casino_rounds (game 'blackjack', one row per player).

export const MAX_TABLES = 8;
const PRESENT_MS = 25_000;
const WAIT_MAX_MS = 20_000;
/** A table creator may announce it in the chat within this delay, once. */
const ANNOUNCE_WINDOW_MS = 600_000;

export interface TableRow {
  table_id: string;
  channel_id: string;
  table_no: number;
  state: TableState;
  version: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  announced_at: Date | null;
}
type Move = { user: string; amount: number; key: string; why: string };

export class BlackjackService {
  rng: IntRng = cryptoIntRng;
  timing: Timing = TIMING;
  private readonly seen = new Map<string, number>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private ticking = false;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly economy: EconomyPort,
    private readonly casino: CasinoService,
  ) {}

  // --- Presence and live updates ------------------------------------------------------------------------------------
  private touch(channelId: string, user: string) {
    this.seen.set(`${channelId}:${user}`, this.clock.now().getTime());
  }
  private connected(channelId: string) {
    const now = this.clock.now().getTime();
    return (user: string) =>
      now - (this.seen.get(`${channelId}:${user}`) ?? 0) < PRESENT_MS;
  }
  private wake(tableId: string) {
    const w = this.waiters.get(tableId);
    if (!w) return;
    this.waiters.delete(tableId);
    for (const f of w) f();
  }

  async limits(q: Queryable, channelId: string): Promise<BlackjackLimits> {
    const l = await this.casino.limits(q, channelId);
    return {
      step: 10,
      mainMin: l.bj_main_min,
      sideMin: 10,
      maxWin: l.bj_max_win,
      sideMaxReturn: l.bj_side_max_return,
    };
  }

  // --- Reading ------------------------------------------------------------------------------------------------------
  private async rows(q: Queryable, channelId: string) {
    return q.query<TableRow>(
      'select * from casino_bj_tables where channel_id = $1 order by table_no',
      [channelId],
    );
  }
  private where(rows: TableRow[], user: string) {
    return rows.find((r) =>
      r.state.seats.some((s) => s?.user === user && s.status === 'seated'),
    );
  }

  /** The lobby: every table, its taken seats, and where this viewer sits. */
  async tables(channelId: string, viewer: CasinoViewer | null) {
    if (viewer) this.touch(channelId, viewer.id);
    const rows = await this.rows(this.db, channelId);
    const mine = viewer ? this.where(rows, viewer.id) : undefined;
    return {
      tables: rows.map((r) => ({
        id: r.table_id,
        no: r.table_no,
        players: r.state.seats.filter(Boolean).length,
        seats: TABLE_SEATS,
        taken: r.state.seats.map(Boolean),
        // Who sits there (public at the table): a spectator following a player opens that player's table.
        users: r.state.seats.filter(Boolean).map((x) => x!.user),
        phase: r.state.phase,
        round: r.state.round,
      })),
      mine: mine?.table_id ?? null,
    };
  }

  /** A table's view for this viewer (null: a spectator). Long-poll: waits up to `waitMs` for a state after `after`. */
  async state(
    channelId: string,
    tableId: string,
    viewer: CasinoViewer | null,
    after = -1,
    waitMs = 0,
  ): Promise<{ state: TableView }> {
    if (!/^[0-9a-f-]{36}$/.test(tableId))
      throw new CasinoError(400, 'invalid_table');
    if (viewer) this.touch(channelId, viewer.id);
    const read = async () => {
      const r = (
        await this.db.query<TableRow>(
          'select * from casino_bj_tables where table_id = $1 and channel_id = $2',
          [tableId, channelId],
        )
      )[0];
      if (!r) throw new CasinoError(404, 'no_table');
      return r;
    };
    let r = await read();
    const wait = Math.min(Math.max(waitMs, 0), WAIT_MAX_MS);
    if (wait > 0 && r.state.seq <= after) {
      await new Promise<void>((ok) => {
        const set = this.waiters.get(tableId) ?? new Set();
        const done = () => {
          clearTimeout(timer);
          set.delete(done);
          ok();
        };
        const timer = setTimeout(done, wait);
        set.add(done);
        this.waiters.set(tableId, set);
      });
      r = await read();
    }
    return { state: await this.viewOf(channelId, r, viewer?.id ?? null) };
  }
  private async viewOf(channelId: string, r: TableRow, viewer: string | null) {
    const L = await this.limits(this.db, channelId);
    const v = view(r.state, viewer, {
      now: this.clock.now().getTime(),
      T: this.timing,
      L,
      connected: this.connected(channelId),
    });
    // Twitch pictures from the Core's cache (a missing one: the screen draws its fallback).
    const ids = v.seats.filter((s) => s && !s.avatar).map((s) => s!.user);
    if (ids.length) {
      const urls = await avatarUrls(this.db, ids);
      for (const s of v.seats)
        if (s && !s.avatar) s.avatar = urls.get(s.user) ?? null;
    }
    return v;
  }

  // --- Changing a table: one transaction (row lock, wallets, movements, save) ----------------------------------------
  private async mutate<T>(
    channelId: string,
    tableId: string,
    actors: string[],
    fn: (t: TableState, ctx: Ctx, row: TableRow) => T,
    q0?: Queryable,
  ): Promise<T> {
    const run = async (q: Queryable) => {
      const row = (
        await q.query<TableRow>(
          'select * from casino_bj_tables where table_id = $1 and channel_id = $2 for update',
          [tableId, channelId],
        )
      )[0];
      if (!row) throw new CasinoError(404, 'no_table');
      const now = this.clock.now();
      const t = row.state;
      // The wallets this change may move: the actors, and everyone in the round (a settlement credits them all).
      const users = [
        ...new Set([
          ...actors,
          ...t.seats
            .filter((s) => s && (s.inRound || s.bet))
            .map((s) => s!.user),
        ]),
      ].sort();
      const hold = users.length
        ? await this.economy.hold(q, now, channelId, users, 'tokens')
        : {
            balances: new Map<string, number>(),
            maxBalance: Number.MAX_SAFE_INTEGER,
          };
      const bal = new Map(users.map((u) => [u, hold.balances.get(u) ?? 0]));
      const moves: Move[] = [];
      const ctx: Ctx = {
        now: now.getTime(),
        int: (n) => this.rng.int(n),
        T: this.timing,
        L: await this.limits(q, channelId),
        balance: (u) => bal.get(u) ?? 0,
        debit: (u, amount, key, why) => {
          if ((bal.get(u) ?? 0) < amount)
            throw new BjError('insufficient_tokens', {
              balance: bal.get(u) ?? 0,
              needed: amount,
            });
          bal.set(u, (bal.get(u) ?? 0) - amount);
          moves.push({ user: u, amount: -amount, key, why });
        },
        credit: (u, amount, key, why) => {
          bal.set(u, (bal.get(u) ?? 0) + amount);
          moves.push({ user: u, amount, key, why });
        },
        connected: this.connected(channelId),
        maxBalance: hold.maxBalance,
      };
      const before = t.history.length
        ? t.history[t.history.length - 1]!.round
        : 0;
      const res = fn(t, ctx, row);
      for (const m of moves)
        await this.economy.move(q, now, {
          channelId,
          viewerId: m.user,
          currency: 'tokens',
          amount: m.amount,
          kind: 'mini_game',
          key: `casino:bj:${m.key}`,
          moduleId: 'casino',
        });
      // A round just settled: one history row per player (the viewer's casino history, Studio's figures).
      const last = t.history[t.history.length - 1];
      if (last && last.round !== before)
        await this.recordRound(q, row, last, now);
      await q.query(
        `update casino_bj_tables set state = $2, version = version + 1, next_at = $3, updated_at = $4
         where table_id = $1`,
        [tableId, JSON.stringify(t), t.next ? new Date(t.next.at) : null, now],
      );
      return res;
    };
    try {
      const out = q0 ? await run(q0) : await this.db.tx(run);
      this.wake(tableId);
      return out;
    } catch (e) {
      throw mapped(e);
    }
  }
  private async recordRound(
    q: Queryable,
    row: TableRow,
    h: TableState['history'][number],
    now: Date,
  ) {
    for (const p of h.players) {
      if (!p.staked) continue;
      await q.query(
        `insert into casino_rounds (round_id, channel_id, viewer_id, viewer_name, game, idempotency_key, request_hash,
           bet, raw_payout, payout, capped, outcome, economy, created_at, finished_at)
         values ($1, $2, $3, $4, 'blackjack', $5, 'blackjack', $6, $7, $7, false, $8, $9, $10, $10)
         on conflict (channel_id, viewer_id, idempotency_key) do nothing`,
        [
          randomUUID(),
          row.channel_id,
          p.user,
          p.name.slice(0, 64),
          `bj:${row.table_id}:${h.round}`,
          p.staked,
          p.staked + p.net,
          JSON.stringify({
            table: row.table_no,
            table_id: row.table_id,
            round: h.round,
            outcome: h.outcome,
            dealer: h.dealer,
            player: p,
          }),
          this.economy.mode,
          now,
        ],
      );
    }
  }

  /** New bets and seats need the casino open, the game open, no pause, no block; an engaged round always finishes. */
  private async assertOpen(
    q: Queryable,
    channelId: string,
    viewer: CasinoViewer,
  ) {
    const av = await this.casino.availability(q, channelId);
    if (!av.open) throw new CasinoError(409, av.reason!);
    if (!av.games.blackjack) throw new CasinoError(409, 'game_closed');
    await assertNotGloballyPaused(q, channelId);
    if (await activeBlock(q, channelId, viewer.id, 'all', this.clock.now()))
      throw new CasinoError(409, 'viewer_blocked');
  }

  // --- The lobby: sit down (creating the first table if needed, atomically) ------------------------------------------
  async join(
    channelId: string,
    viewer: CasinoViewer,
    req: { table_id?: unknown; seat?: unknown },
  ) {
    const tableId = req.table_id == null ? null : String(req.table_id);
    if (tableId !== null && !/^[0-9a-f-]{36}$/.test(tableId))
      throw new CasinoError(400, 'invalid_table');
    const seat = req.seat == null ? null : Number(req.seat);
    if (
      seat !== null &&
      !(Number.isInteger(seat) && seat >= 0 && seat < TABLE_SEATS)
    )
      throw new CasinoError(400, 'bad_seat');
    this.touch(channelId, viewer.id);
    let touched: string | null = null;
    try {
      const out = await this.db.tx(async (q) => {
        // The lobby lock: seats and table creation one at a time per channel (never two tables n°1).
        await q.query('select pg_advisory_xact_lock(hashtext($1))', [
          `casino:bj:lobby:${channelId}`,
        ]);
        const rows = await this.rows(q, channelId);
        const mine = this.where(rows, viewer.id);
        if (mine)
          return {
            table: mine.table_id,
            seat: seatOf(mine.state, viewer.id),
            already: true,
            created: false,
          };
        // Left during a round still being played: back to THAT seat and hand.
        const left = rows.find((r) =>
          r.state.seats.some(
            (s) => s?.user === viewer.id && s.status === 'left',
          ),
        );
        if (left) {
          touched = left.table_id;
          const i = await this.mutate(
            channelId,
            left.table_id,
            [],
            (t) => resume(t, viewer.id),
            q,
          );
          return {
            table: left.table_id,
            seat: i,
            resumed: true,
            created: false,
          };
        }
        await this.assertOpen(q, channelId, viewer);
        const count = (r: TableRow) => r.state.seats.filter(Boolean).length;
        let target: TableRow | undefined;
        if (tableId) {
          target = rows.find((r) => r.table_id === tableId);
          if (!target) throw new CasinoError(404, 'no_table');
          if (count(target) >= TABLE_SEATS)
            throw new CasinoError(409, 'table_full');
        } else {
          // The fullest table with a free seat (a full table opens the next one).
          target = rows
            .filter((r) => count(r) < TABLE_SEATS)
            .sort((a, b) => count(b) - count(a) || a.table_no - b.table_no)[0];
        }
        let created = false;
        if (!target) {
          if (rows.length >= MAX_TABLES)
            throw new CasinoError(409, 'casino_full');
          const no = rows.length
            ? Math.max(...rows.map((r) => r.table_no)) + 1
            : 1;
          const id = randomUUID();
          const now = this.clock.now();
          target = (
            await q.query<TableRow>(
              `insert into casino_bj_tables (table_id, channel_id, table_no, state, created_by, created_by_name,
                 created_at, updated_at, economy)
               values ($1, $2, $3, $4, $5, $6, $7, $7, $8) returning *`,
              [
                id,
                channelId,
                no,
                JSON.stringify(newTable(id, no, (n) => this.rng.int(n))),
                viewer.id,
                viewer.display_name.slice(0, 64),
                now,
                this.economy.mode,
              ],
            )
          )[0]!;
          created = true;
        }
        const avatar =
          (await avatarUrls(q, [viewer.id])).get(viewer.id) ?? null;
        touched = target.table_id;
        const r = await this.mutate(
          channelId,
          target.table_id,
          [],
          (t, ctx) => sit(t, ctx, viewer.id, viewer.display_name, avatar, seat),
          q,
        );
        return {
          table: target.table_id,
          seat: r.seat,
          nextRound: r.nextRound,
          created,
          no: target.table_no,
        };
      });
      return out;
    } catch (e) {
      throw mapped(e);
    } finally {
      if (touched) this.wake(touched);
    }
  }

  private async myTable(channelId: string, viewer: CasinoViewer) {
    const rows = await this.rows(this.db, channelId);
    const t = this.where(rows, viewer.id);
    if (!t) throw new CasinoError(409, 'not_seated');
    return t.table_id;
  }

  async bet(
    channelId: string,
    viewer: CasinoViewer,
    req: { main?: unknown; side?: unknown; ready?: unknown },
  ) {
    this.touch(channelId, viewer.id);
    const tableId = await this.myTable(channelId, viewer);
    const side =
      req.side && typeof req.side === 'object'
        ? (req.side as Record<string, unknown>)
        : {};
    try {
      const out = await this.db.tx(async (q) => {
        await this.assertOpen(q, channelId, viewer);
        return this.mutate(
          channelId,
          tableId,
          [viewer.id],
          (t, ctx) => {
            const r = placeBets(t, ctx, viewer.id, {
              main: req.main,
              side,
              ready: req.ready === true,
            });
            // The wallet's own cap, checked before the deal with the largest possible return (a settlement never fails).
            if (
              ctx.balance(viewer.id) + r.reserved + ctx.L.maxWin >
              (ctx.maxBalance ?? Infinity)
            )
              throw new BjError('balance_cap', { max_balance: ctx.maxBalance });
            return r;
          },
          q,
        );
      });
      this.wake(tableId);
      return out;
    } catch (e) {
      throw mapped(e);
    }
  }
  async clear(channelId: string, viewer: CasinoViewer) {
    this.touch(channelId, viewer.id);
    const tableId = await this.myTable(channelId, viewer);
    return this.mutate(channelId, tableId, [viewer.id], (t, ctx) =>
      clearBets(t, ctx, viewer.id),
    );
  }
  async act(
    channelId: string,
    viewer: CasinoViewer,
    req: { type?: unknown; token?: unknown; action_id?: unknown },
  ) {
    this.touch(channelId, viewer.id);
    const tableId = await this.myTable(channelId, viewer);
    const actionId =
      typeof req.action_id === 'string'
        ? req.action_id.slice(0, 128)
        : undefined;
    return this.mutate(channelId, tableId, [viewer.id], (t, ctx) =>
      act(t, ctx, viewer.id, { type: req.type, token: req.token, actionId }),
    );
  }
  async insure(
    channelId: string,
    viewer: CasinoViewer,
    req: { stake?: unknown; even?: unknown; action_id?: unknown },
  ) {
    this.touch(channelId, viewer.id);
    const tableId = await this.myTable(channelId, viewer);
    const actionId =
      typeof req.action_id === 'string'
        ? req.action_id.slice(0, 128)
        : undefined;
    return this.mutate(channelId, tableId, [viewer.id], (t, ctx) =>
      insure(t, ctx, viewer.id, {
        stake: req.stake ?? 0,
        even: req.even === true,
        actionId,
      }),
    );
  }
  async leave(channelId: string, viewer: CasinoViewer) {
    const rows = await this.rows(this.db, channelId);
    const t = this.where(rows, viewer.id);
    if (!t) return { ok: true, already: true };
    this.seen.delete(`${channelId}:${viewer.id}`);
    return this.mutate(channelId, t.table_id, [viewer.id], (s, ctx) =>
      leave(s, ctx, viewer.id),
    );
  }

  /**
   * The table's creator may tell the chat (once, within 10 min of the creation, explicit click only). LeCroupier_ posts
   * through the existing message queue; at most one table announcement per channel every `bj_announce_gap_s`.
   */
  async announce(channelId: string, viewer: CasinoViewer, tableId: unknown) {
    if (typeof tableId !== 'string' || !/^[0-9a-f-]{36}$/.test(tableId))
      throw new CasinoError(400, 'invalid_table');
    const lim = await this.casino.limits(this.db, channelId);
    if (!lim.bj_announce) throw new CasinoError(409, 'announce_off');
    return this.db
      .tx(async (q) => {
        await q.query('select pg_advisory_xact_lock(hashtext($1))', [
          `casino:bj:announce:${channelId}`,
        ]);
        const r = (
          await q.query<TableRow>(
            'select * from casino_bj_tables where table_id = $1 and channel_id = $2 for update',
            [tableId, channelId],
          )
        )[0];
        if (!r) throw new CasinoError(404, 'no_table');
        const now = this.clock.now();
        if (r.created_by !== viewer.id)
          throw new CasinoError(403, 'not_creator');
        if (r.announced_at)
          return { ok: true, announced: false, already: true };
        if (now.getTime() - r.created_at.getTime() > ANNOUNCE_WINDOW_MS)
          throw new CasinoError(409, 'announce_expired');
        const last = (
          await q.query<{ at: Date }>(
            'select max(announced_at) as at from casino_bj_tables where channel_id = $1',
            [channelId],
          )
        )[0]?.at;
        if (
          last &&
          now.getTime() - new Date(last).getTime() <
            lim.bj_announce_gap_s * 1000
        )
          throw new CasinoError(429, 'announce_cooldown');
        const written = await insertAnnouncement(q, {
          channelId,
          now,
          origin: 'module:casino',
          drafts: [
            {
              idempotencyKey: `module:casino:bj-table:${tableId}`,
              mode: 'announce',
              text: `🃏 Une table de Blackjack vient d'ouvrir au Casino ! Jusqu'à 10 joueurs peuvent la rejoindre depuis l'extension Raptoru 2.0.`,
            },
          ],
        });
        if (!written) throw new CasinoError(503, 'chat_unavailable');
        await q.query(
          'update casino_bj_tables set announced_at = $2 where table_id = $1',
          [tableId, now],
        );
        return { ok: true, announced: true };
      })
      .catch((e) => {
        throw mapped(e);
      });
  }

  /** Lab only: force the next deal's card values (scenarios). */
  async rig(channelId: string, viewer: CasinoViewer, rig: unknown) {
    if (!this.casino.isLab()) throw new CasinoError(403, 'lab_only');
    const tableId = await this.myTable(channelId, viewer);
    return this.mutate(channelId, tableId, [], (t) => {
      t.rig = (rig ?? null) as Rig | null;
      return { ok: true };
    });
  }

  /** The Core's ticker: run every table's due steps (deal pacing, decisions, the dealer, the next round). */
  async tick() {
    if (this.ticking) return 0;
    this.ticking = true;
    try {
      const due = await this.db.query<{ table_id: string; channel_id: string }>(
        'select table_id, channel_id from casino_bj_tables where next_at <= $1 order by next_at limit 20',
        [this.clock.now()],
      );
      for (const d of due)
        await this.mutate(d.channel_id, d.table_id, [], (t, ctx) => {
          for (let k = 0; k < 20 && runDue(t, ctx); k++);
        }).catch((e: Error) =>
          console.error(
            '[casino] blackjack tick failed',
            d.table_id,
            e.message,
          ),
        );
      return due.length;
    } finally {
      this.ticking = false;
    }
  }

  /** Studio: the tables, their players and round. */
  async adminTables(channelId: string) {
    const rows = await this.rows(this.db, channelId);
    return rows.map((r) => ({
      id: r.table_id,
      no: r.table_no,
      phase: r.state.phase,
      round: r.state.round,
      players: r.state.seats.filter(Boolean).map((s) => ({
        id: s!.user,
        name: s!.name,
        in_round: s!.inRound,
        status: s!.status,
      })),
      next_at: r.state.next ? new Date(r.state.next.at).toISOString() : null,
      created_at: r.created_at.toISOString(),
    }));
  }
}

function mapped(e: unknown): unknown {
  if (e instanceof CasinoError) return e;
  if (e instanceof BjError) {
    const status =
      e.code === 'not_seated' ? 409 : e.code.startsWith('bad_') ? 400 : 409;
    return new CasinoError(status, e.code, e.details);
  }
  if (e instanceof LabWalletError)
    return new CasinoError(409, e.code, {
      ...((e as unknown as { details?: Record<string, unknown> }).details ??
        {}),
    });
  if (e instanceof GlobalPauseError)
    return new CasinoError(409, 'global_pause');
  return e;
}
