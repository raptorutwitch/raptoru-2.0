import type { Clock } from '../clock.js';
import type { Db, Queryable } from '../db/db.js';
import { CasinoError } from './errors.js';
import type {
  CasinoViewer,
  Game,
  RouletteOutcome,
  RoundRow,
  SlotOutcome,
} from './service.js';

// Casino spectators (docs/CASINO.md § 6) — the public feed of each player's session. A spectator follows a PLAYER (not
// a round): every round of theirs, its bonus, the next one, the other game. One rule keeps the result hidden: a stage
// enters the feed only once the player's screen has shown it (the player's client says so: progress), or once its
// animation is overdue (a closed tab never blocks the spectators). The spin itself writes « start » (the stake, never
// the result). The data of a stage is only what that stage reveals: a Coffre's next respins are never sent ahead.
//
// Reading: the rows after a cursor (seq), long-poll (one request waiting per spectator, woken by the writes of this
// process and by a shared one-query-per-second check per channel for the others). A new spectator, or one whose cursor
// is lost, gets a snapshot: the stages of the player's current round, to rejoin it where it is.

/** The order of a round's stages (one feed row each: a resent progress never doubles an animation). */
export const POS = {
  start: 0,
  result: 1,
  coffre: 2,
  step: (i: number) => 10 + i,
  end: 900,
} as const;
/** After this, a stage the player's client never confirmed is published anyway (its animation is over). */
const OVERDUE_MS = { slot: 9_000, roulette: 14_000, coffre: 7_000 } as const;
/** A player is « en jeu » while the feed heard from them recently (presence beats every minute while a game is open). */
const PRESENT_MS = 150_000;
const WAIT_MAX_MS = 25_000;
const CHECK_EVERY_MS = 1_000;
/** While a spectator waits, the overdue stages are looked at this often (a closed tab never blocks them long). */
const RECHECK_MS = 3_000;
const SETTLE_EVERY_MS = 1_000;
/** A woken read waits this long: a spin's start, result and end, written a few ms apart, leave in one answer. */
const COALESCE_MS = 25;
/** A result published this long after its spin was delayed on its way; its moment is then the spin + ANSWER_MS. */
const RESULT_QUEUED_MS = 1_500;
const ANSWER_MS = 300;
const PRUNE_EVERY_MS = 10 * 60_000;
const KEEP_MS = 6 * 3_600_000;
const DRAFT_GAP_MS = 150;
const PRESENCE_GAP_MS = 20_000;

export type FeedKind =
  | 'start'
  | 'result'
  | 'coffre'
  | 'step'
  | 'end'
  | 'draft'
  | 'presence'
  | 'skip';
interface FeedRow {
  seq: number;
  viewer_id: string;
  viewer_name: string;
  round_id: string | null;
  game: Game | null;
  kind: FeedKind;
  pos: number | null;
  data: Record<string, unknown>;
  fast: boolean;
  at: Date;
}
interface Stage {
  pos: number;
  kind: FeedKind;
  data: Record<string, unknown>;
}

const COLS =
  'seq::int as seq, viewer_id, viewer_name, round_id, game, kind, pos, data, fast, at';

/** A round's stages after its start, each with only what it reveals. */
export function stagesOf(r: RoundRow): Stage[] {
  if (r.game === 'roulette') {
    const o = r.outcome as RouletteOutcome;
    return [
      {
        pos: POS.result,
        kind: 'result',
        data: {
          bets: o.bets,
          pocket: o.pocket,
          number: o.number,
          color: o.color,
          wins: o.wins,
          seed: o.seed,
          payout: r.payout,
        },
      },
      { pos: POS.end, kind: 'end', data: { payout: r.payout, bet: r.bet } },
    ];
  }
  const o = r.outcome as SlotOutcome;
  const c = o.coffre;
  const result: Stage = {
    pos: POS.result,
    kind: 'result',
    data: {
      stops: o.stops,
      grid: o.grid,
      lines: o.lines,
      scatter: o.scatter,
      line_win: o.line_win,
      coffre: c ? { k: c.k } : null,
    },
  };
  const end = (extra: Record<string, unknown>): Stage => ({
    pos: POS.end,
    kind: 'end',
    data: {
      payout: r.payout,
      raw_payout: r.raw_payout,
      capped: r.capped,
      bet: r.bet,
      line_win: o.line_win,
      ...extra,
    },
  });
  if (!c) return [result, end({ coffre: null })];
  return [
    result,
    { pos: POS.coffre, kind: 'coffre', data: { k: c.k, start: c.start } },
    ...c.steps.map((st, i) => ({
      pos: POS.step(i),
      kind: 'step' as const,
      data: { i, ...st },
    })),
    end({
      coffre: {
        total: c.total,
        full: c.full,
        filled: c.filled,
        jackpots: c.jackpots,
        cols: c.cols,
        doubler: c.doubler,
        win: c.win,
        paid: r.capped ? Math.max(0, r.payout - o.line_win) : c.win,
      },
    }),
  ];
}

const wire = (r: FeedRow) => ({
  seq: r.seq,
  kind: r.kind,
  round_id: r.round_id,
  game: r.game,
  pos: r.pos,
  data: r.data,
  fast: r.fast,
  viewer_name: r.viewer_name,
  at: r.at.toISOString(),
});

export class CasinoFeed {
  private waiters = new Map<string, Set<() => void>>();
  private checks = new Map<
    string,
    { timer: ReturnType<typeof setInterval>; last: number }
  >();
  private pruned = new Map<string, number>();
  private settled = new Map<string, number>();
  private lastWrite = new Map<string, number>();
  private lastGame = new Map<string, Game | null>();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  // --- Writes ---------------------------------------------------------------------------------------------------

  /** The spin (in its transaction): the stake, never the result. The caller wakes the readers after the commit. */
  async start(q: Queryable, r: RoundRow) {
    const o = r.outcome as RouletteOutcome;
    await q.query(
      `insert into casino_feed (channel_id, viewer_id, viewer_name, round_id, game, kind, pos, data, fast, at)
       values ($1, $2, $3, $4, $5, 'start', 0, $6, false, $7) on conflict do nothing`,
      [
        r.channel_id,
        r.viewer_id,
        r.viewer_name,
        r.round_id,
        r.game,
        JSON.stringify(
          r.game === 'roulette' ? { bet: r.bet, bets: o.bets } : { bet: r.bet },
        ),
        r.created_at,
      ],
    );
  }

  /**
   * Publishes the round's stages up to `target` (in order, each once): the player's screen has shown them. Returns
   * the last stage now public. A round without a Coffre ends with its result.
   */
  async publish(q: Queryable, r: RoundRow, target: number, fast: boolean) {
    await q.query('select pg_advisory_xact_lock(hashtext($1))', [
      `casino-feed:${r.round_id}`,
    ]);
    const stages = stagesOf(r);
    const coffre = stages.some((s) => s.kind === 'coffre');
    const upTo = !coffre && target >= POS.result ? POS.end : target;
    const done = Number(
      (
        await q.query<{ pos: number | null }>(
          'select max(pos) as pos from casino_feed where round_id = $1',
          [r.round_id],
        )
      )[0]?.pos ?? -1,
    );
    const now = this.clock.now();
    // The player's animation starts as the spin's answer arrives (the result is posted then). A result reaching the Core
    // more than 1.5 s after its spin met a queue on the way (a busy server), not a later start: its moment is the spin's,
    // plus the usual answer time — spectators join the player's timeline instead of replaying it late.
    const created = r.created_at.getTime();
    const resultAt =
      now.getTime() - created > RESULT_QUEUED_MS
        ? new Date(created + ANSWER_MS)
        : now;
    let wrote = false;
    if (done < POS.start) await this.start(q, r);
    for (const st of stages) {
      if (st.pos <= done || st.pos > upTo) continue;
      await q.query(
        `insert into casino_feed (channel_id, viewer_id, viewer_name, round_id, game, kind, pos, data, fast, at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict do nothing`,
        [
          r.channel_id,
          r.viewer_id,
          r.viewer_name,
          r.round_id,
          r.game,
          st.kind,
          st.pos,
          JSON.stringify(st.data),
          fast,
          st.pos === POS.result ? resultAt : now,
        ],
      );
      wrote = true;
    }
    return { wrote, last: Math.max(done, upTo) };
  }

  /**
   * Passer: the player jumped to the end of the animation of stage `need` (`at` names it). Written only when that stage
   * is already public, once; it carries no data (what it shows is already public). Returns whether it was written.
   */
  async skip(q: Queryable, r: RoundRow, need: number, at: string) {
    await q.query('select pg_advisory_xact_lock(hashtext($1))', [
      `casino-feed:${r.round_id}`,
    ]);
    const rows = await q.query<{ pos: number | null; skipped: boolean }>(
      `select max(pos) as pos, bool_or(kind = 'skip' and data->>'at' = $2) as skipped
       from casino_feed where round_id = $1`,
      [r.round_id, at],
    );
    const pub =
      rows[0]?.pos === null || rows[0]?.pos === undefined
        ? -1
        : Number(rows[0].pos);
    if (pub < need || rows[0]?.skipped) return false;
    await q.query(
      `insert into casino_feed (channel_id, viewer_id, viewer_name, round_id, game, kind, pos, data, fast, at)
       values ($1, $2, $3, $4, $5, 'skip', null, $6, true, $7)`,
      [
        r.channel_id,
        r.viewer_id,
        r.viewer_name,
        r.round_id,
        r.game,
        JSON.stringify({ at }),
        this.clock.now(),
      ],
    );
    return true;
  }

  /** The roulette bets being placed (display only: never debited, never a round). The latest replaces the previous. */
  async draft(
    channelId: string,
    viewer: CasinoViewer,
    bets: Record<string, number>,
    total: number,
  ) {
    const k = `${channelId}:${viewer.id}:draft`;
    const now = this.clock.now().getTime();
    if (now - (this.lastWrite.get(k) ?? 0) < DRAFT_GAP_MS)
      throw new CasinoError(429, 'rate_limited');
    this.lastWrite.set(k, now);
    await this.replace(channelId, viewer, 'draft', 'roulette', {
      bets,
      total,
    });
  }

  /** The game the player has open (or none): spectators follow them from one game to the other. */
  async presence(channelId: string, viewer: CasinoViewer, game: Game | null) {
    const k = `${channelId}:${viewer.id}:presence`;
    const now = this.clock.now().getTime();
    const prev = this.lastWrite.get(k);
    // The same game again within a few seconds: nothing new to tell (an open game's heartbeat is a minute).
    if (prev && now - prev < PRESENCE_GAP_MS && this.lastGame.get(k) === game)
      return { ok: true, kept: true };
    this.lastWrite.set(k, now);
    this.lastGame.set(k, game);
    await this.replace(channelId, viewer, 'presence', game, { game });
    return { ok: true, kept: false };
  }

  private async replace(
    channelId: string,
    viewer: CasinoViewer,
    kind: 'draft' | 'presence',
    game: Game | null,
    data: Record<string, unknown>,
  ) {
    await this.db.tx(async (q) => {
      await q.query(
        'delete from casino_feed where channel_id = $1 and viewer_id = $2 and kind = $3',
        [channelId, viewer.id, kind],
      );
      await q.query(
        `insert into casino_feed (channel_id, viewer_id, viewer_name, round_id, game, kind, pos, data, fast, at)
         values ($1, $2, $3, null, $4, $5, null, $6, false, $7)`,
        [
          channelId,
          viewer.id,
          viewer.display_name.slice(0, 64),
          game,
          kind,
          JSON.stringify(data),
          this.clock.now(),
        ],
      );
    });
    this.wake(channelId);
    void this.prune(channelId);
  }

  /** Stages whose animation is over but that the player's client never confirmed (a closed tab): published now. */
  async settle(channelId: string, viewerId?: string) {
    const now = this.clock.now().getTime();
    // At most once a second per channel and player: every spectator's read would ask it again.
    const key = `${channelId}:${viewerId ?? '*'}`;
    if (now - (this.settled.get(key) ?? -Infinity) < SETTLE_EVERY_MS) return;
    this.settled.set(key, now);
    const rows = await this.db.query<
      RoundRow & { fpos: number | null; fat: Date | null }
    >(
      `select r.*, f.pos as fpos, f.at as fat from casino_rounds r
         left join lateral (select pos, at from casino_feed where round_id = r.round_id order by pos desc limit 1) f on true
       where r.channel_id = $1 and ($2::text is null or r.viewer_id = $2) and r.created_at > $3
       order by r.created_at desc limit 20`,
      [channelId, viewerId ?? null, new Date(now - 30 * 60_000)],
    );
    let wrote = false;
    for (const r of rows) {
      const pos = r.fpos === null ? -1 : Number(r.fpos);
      if (pos >= POS.coffre) continue; // a Coffre waits for its player (manual relaunch), never for a clock
      const coffre = r.game === 'slot' && !!(r.outcome as SlotOutcome).coffre;
      let target = -1;
      if (pos < POS.result && now - r.created_at.getTime() > OVERDUE_MS[r.game])
        target = POS.result;
      if (
        coffre &&
        pos === POS.result &&
        r.fat &&
        now - r.fat.getTime() > OVERDUE_MS.coffre
      )
        target = POS.coffre;
      if (target < 0) continue;
      const res = await this.db.tx((q) => this.publish(q, r, target, false));
      wrote ||= res.wrote;
    }
    if (wrote) this.wake(channelId);
  }

  // --- Reads ----------------------------------------------------------------------------------------------------

  /**
   * One player’s feed after `after` (long-poll up to `waitMs`). `after` < 0: a snapshot of the player's current round
   * (to rejoin it) and the channel's cursor. Every event carries its seq: the client drops what it already played.
   */
  async watch(
    channelId: string,
    playerId: string,
    after: number,
    waitMs: number,
  ) {
    if (!/^\d{1,32}$/.test(playerId))
      throw new CasinoError(400, 'invalid_player');
    // Real time for the wait (the data's clock may be a test's).
    const deadline = Date.now() + Math.min(Math.max(waitMs, 0), WAIT_MAX_MS);
    for (;;) {
      await this.settle(channelId, playerId);
      const read =
        after >= 0
          ? await this.after(channelId, playerId, after)
          : await this.snapshot(channelId, playerId);
      const left = deadline - Date.now();
      if (read.events.length || after < 0 || left <= 0)
        return {
          ...read,
          player: await this.player(channelId, playerId),
          server_now: this.clock.now().toISOString(),
        };
      await this.waitChange(channelId, Math.min(left, RECHECK_MS));
      await new Promise((ok) => setTimeout(ok, COALESCE_MS));
    }
  }

  private async after(channelId: string, playerId: string, after: number) {
    const rows = await this.db.query<FeedRow>(
      `select ${COLS} from casino_feed where channel_id = $1 and viewer_id = $2 and seq > $3 order by seq limit 100`,
      [channelId, playerId, after],
    );
    if (rows.length)
      return { events: rows.map(wire), cursor: rows.at(-1)!.seq, reset: false };
    // A cursor ahead of this database (another Core, a rebuild): start again from a snapshot.
    if (after > (await this.cursor(channelId)))
      return this.snapshot(channelId, playerId);
    return { events: [], cursor: after, reset: false };
  }

  /** The player's current round (its public stages), their open game and their bets being placed. */
  private async snapshot(channelId: string, playerId: string) {
    const now = this.clock.now().getTime();
    const cursor = await this.cursor(channelId);
    const start = (
      await this.db.query<{ seq: number; at: Date }>(
        `select seq::int as seq, at from casino_feed where channel_id = $1 and viewer_id = $2 and kind = 'start'
         order by seq desc limit 1`,
        [channelId, playerId],
      )
    )[0];
    let rows: FeedRow[] = [];
    if (start && now - start.at.getTime() < 30 * 60_000) {
      rows = await this.db.query<FeedRow>(
        `select ${COLS} from casino_feed where channel_id = $1 and viewer_id = $2 and seq >= $3 order by seq limit 200`,
        [channelId, playerId, start.seq],
      );
      // A round over for a while: only where the player is now (no old result shown as the current one).
      const ended = rows.find((r) => r.kind === 'end');
      if (ended && now - ended.at.getTime() > 20_000)
        rows = rows.filter((r) => !r.round_id);
    }
    const loose = await this.db.query<FeedRow>(
      `select ${COLS} from casino_feed where channel_id = $1 and viewer_id = $2 and kind in ('presence', 'draft')`,
      [channelId, playerId],
    );
    const seen = new Set(rows.map((r) => r.seq));
    const events = [...rows, ...loose.filter((r) => !seen.has(r.seq))]
      .sort((a, b) => a.seq - b.seq)
      .map(wire);
    return { events, cursor, reset: true };
  }

  private async player(channelId: string, playerId: string) {
    const rows = await this.db.query<FeedRow>(
      `select ${COLS} from casino_feed where channel_id = $1 and viewer_id = $2 and kind <> 'draft'
       order by seq desc limit 40`,
      [channelId, playerId],
    );
    return this.describe(playerId, rows);
  }

  private describe(playerId: string, rows: FeedRow[]) {
    const now = this.clock.now().getTime();
    if (!rows.length)
      return {
        id: playerId,
        name: null,
        game: null,
        state: 'away' as const,
        round_id: null,
        bet: null,
        since: new Date(0).toISOString(),
      };
    const presence = rows.find((r) => r.kind === 'presence');
    const stage = rows.find((r) => r.round_id);
    const lastAt = Math.max(...rows.map((r) => r.at.getTime()));
    const open = presence ? (presence.data.game as Game | null) : null;
    const inRound = !!stage && stage.kind !== 'end';
    const recent = now - lastAt < PRESENT_MS;
    const state =
      inRound && recent
        ? stage.kind === 'coffre' || stage.kind === 'step'
          ? ('bonus' as const)
          : ('playing' as const)
        : open && recent
          ? ('idle' as const)
          : ('away' as const);
    return {
      id: playerId,
      name: rows[0]!.viewer_name,
      game: open ?? (inRound ? stage.game : null),
      state,
      round_id: inRound ? stage.round_id : null,
      bet: inRound
        ? (rows.find((r) => r.round_id === stage.round_id && r.kind === 'start')
            ?.data.bet ?? null)
        : null,
      since: new Date(lastAt).toISOString(),
    };
  }

  /** The players in a game now (« Regarder les parties en direct »), long-poll on their changes. */
  async live(channelId: string, after: number, waitMs: number) {
    const deadline = Date.now() + Math.min(Math.max(waitMs, 0), WAIT_MAX_MS);
    for (;;) {
      await this.settle(channelId);
      const now = this.clock.now().getTime();
      const rows = await this.db.query<FeedRow>(
        `select ${COLS} from casino_feed where channel_id = $1 and kind <> 'draft' and at > $2
         order by seq desc limit 400`,
        [channelId, new Date(now - PRESENT_MS)],
      );
      const version = rows[0]?.seq ?? 0;
      const left = deadline - Date.now();
      if (version !== after || left <= 0) {
        const by = new Map<string, FeedRow[]>();
        for (const r of rows)
          by.set(r.viewer_id, [...(by.get(r.viewer_id) ?? []), r]);
        const players = [...by.entries()]
          .map(([id, list]) => this.describe(id, list))
          .filter((p) => p.state !== 'away')
          .sort((a, b) => b.since.localeCompare(a.since))
          .slice(0, 24);
        return {
          players,
          cursor: version,
          server_now: new Date(now).toISOString(),
        };
      }
      await this.waitChange(channelId, Math.min(left, RECHECK_MS));
      await new Promise((ok) => setTimeout(ok, COALESCE_MS));
    }
  }

  // --- Waiting: this process's writes wake at once; another Core's within a second (one query per channel) ------------

  async cursor(channelId: string) {
    return Number(
      (
        await this.db.query<{ seq: number | null }>(
          'select max(seq)::int as seq from casino_feed where channel_id = $1',
          [channelId],
        )
      )[0]?.seq ?? 0,
    );
  }

  wake(channelId: string) {
    for (const w of [...(this.waiters.get(channelId) ?? [])]) w();
  }

  private waitChange(channelId: string, ms: number) {
    return new Promise<void>((resolve) => {
      const set = this.waiters.get(channelId) ?? new Set();
      this.waiters.set(channelId, set);
      const done = () => {
        clearTimeout(timer);
        set.delete(done);
        if (!set.size) this.stopCheck(channelId);
        resolve();
      };
      const timer = setTimeout(done, ms);
      timer.unref?.();
      set.add(done);
      this.startCheck(channelId);
    });
  }

  private startCheck(channelId: string) {
    if (this.checks.has(channelId)) return;
    const c = {
      timer: undefined as unknown as ReturnType<typeof setInterval>,
      last: -1,
    };
    this.checks.set(channelId, c);
    void this.cursor(channelId).then(
      (v) => (c.last = v),
      () => {},
    );
    c.timer = setInterval(() => {
      void this.cursor(channelId).then(
        (v) => {
          if (c.last >= 0 && v !== c.last) this.wake(channelId);
          c.last = v;
        },
        () => {},
      );
    }, CHECK_EVERY_MS);
    c.timer.unref?.();
  }

  private stopCheck(channelId: string) {
    const c = this.checks.get(channelId);
    if (!c) return;
    clearInterval(c.timer);
    this.checks.delete(channelId);
  }

  /** The feed is short-lived: rows older than a few hours go (at most every ten minutes per channel). */
  async prune(channelId: string) {
    const now = this.clock.now().getTime();
    if (now - (this.pruned.get(channelId) ?? 0) < PRUNE_EVERY_MS) return;
    this.pruned.set(channelId, now);
    await this.db
      .query('delete from casino_feed where channel_id = $1 and at < $2', [
        channelId,
        new Date(now - KEEP_MS),
      ])
      .catch(() => {});
  }
}
