import { createHash, randomUUID } from 'node:crypto';
import type { Clock } from '../clock.js';
import { insertAnnouncement } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import {
  activeBlock,
  assertNotGloballyPaused,
  GlobalPauseError,
  LabWalletError,
} from '../lab-moderation/store.js';
import type { ModuleSettings } from '../module-settings/service.js';
import { liveChannelSession } from '../stream/channel-sessions.js';
import { activeSession } from '../stream/stream-sessions.js';
import { generateCoffre, type CoffreScript } from './coffre.js';
import { cryptoIntRng, floatFrom, type IntRng } from './rng.js';
import {
  BET_STEP,
  colorOf,
  ORDER,
  rouletteError,
  settleRoulette,
  SPOTS,
  stakeOf,
  type RouletteBets,
} from './roulette.js';
import {
  drawStops,
  evaluate,
  slotTable,
  windowAt,
  type SlotEval,
} from './slot.js';

// Casino (docs/CASINO.md) — the Core's side of the extension's slot machine and roulette. The Core checks the balance
// and the bet, draws, computes the win, debits the bet and credits the win (canonical Wallet in Production, the Lab test
// wallet in the Lab) and records the round, in ONE transaction; the extension receives the round and only animates it.
//
// - One intent = one key (the client's Idempotency-Key): a resent spin returns the same round, never a second debit.
// - One viewer's spins one at a time (advisory lock): two tabs cannot overdraw.
// - Live only: Production follows the canonical live (stream_sessions, Twitch through the bot); the Lab follows its
//   simulated live (Studio › Simulation › « Simuler début / fin »), so that the closed casino can be tried too.
// - The Coffre is drawn whole at the trigger and paid with the spin: watching it (manual, Rapide, Auto, a reload, another
//   device) never changes a Jeton; its progress is stored for the reconnection and the spectators.
// - A per-round win cap (casino.max_win), shown in the rules and on a capped round — never a silent change.

export const CASINO_MODULE = 'casino';
/** A round id: a UUID, strictly (a malformed one never reaches PostgreSQL). */
export const ROUND_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The module's bounded settings (Studio › Casino; module-settings), stored as `casino.<key>`. */
export const CASINO_SETTINGS = {
  open: {
    label: 'Casino ouvert aux viewers',
    unit: '0 / 1',
    default: 0,
    min: 0,
    max: 1,
    help: 'fermé : aucune nouvelle partie (l’historique reste lisible). En Production, la variable CASINO_EXTENSION du Core doit aussi l’autoriser.',
  },
  slot_open: {
    label: 'Machine à sous ouverte',
    unit: '0 / 1',
    default: 1,
    min: 0,
    max: 1,
  },
  roulette_open: {
    label: 'Roulette ouverte',
    unit: '0 / 1',
    default: 1,
    min: 0,
    max: 1,
  },
  slot_min_bet: {
    label: 'Machine : mise minimum',
    unit: 'Jetons',
    default: 20,
    min: 20,
    max: 10_000,
  },
  slot_max_bet: {
    label: 'Machine : mise maximum',
    unit: 'Jetons',
    default: 10_000,
    min: 20,
    max: 10_000,
    help: 'règle validée : 20 à 10 000. Au-delà de « gain maximum ÷ 1 000 », le plafond de gain retire du RTP (docs/CASINO.md § 5).',
  },
  roulette_max_total: {
    label: 'Roulette : mise totale maximum par tour',
    unit: 'Jetons',
    default: 100_000,
    min: 20,
    max: 100_000,
  },
  max_win: {
    label: 'Gain maximum par partie',
    unit: 'Jetons',
    default: 1_000_000,
    min: 1_000,
    max: 30_000_000,
    help: 'machine : un gain plus grand est payé à ce montant et marqué « plafonné » ; roulette : une mise qui pourrait le dépasser est refusée avant le tirage.',
  },
  share_cooldown_s: {
    label: 'Partage dans le chat : délai par viewer',
    unit: 's',
    default: 300,
    min: 30,
    max: 3600,
  },
  announce: {
    label: 'Annonces automatiques des gains exceptionnels',
    unit: '0 / 1',
    default: 1,
    min: 0,
    max: 1,
  },
  announce_min_x: {
    label: 'Annonce automatique à partir de',
    unit: '× la mise',
    default: 500,
    min: 50,
    max: 100_000,
    help: 'et toujours la grille pleine (GRAND) ; au plus une annonce toutes les 2 minutes.',
  },
} as const;
type SettingKey = keyof typeof CASINO_SETTINGS;

/** Channel-wide pace of LeCroupier_'s casino messages. */
const SHARE_CHANNEL_GAP_MS = 30_000;
/** A share is for a recent round only. */
const SHARE_MAX_AGE_MS = 86_400_000;
/** The refusals Studio shows (« transactions bloquées »): availability, money, the Core's own failures. */
const NOTED_REFUSALS = new Set([
  'insufficient_tokens',
  'stream_offline',
  'casino_closed',
  'game_closed',
  'not_approved',
  'viewer_blocked',
  'global_pause',
  'above_max_win',
  'balance_cap',
  'economy_unavailable',
  'casino_unavailable',
]);
const ANNOUNCE_GAP_MS = 120_000;
/** How long a round stays « en cours » for spectators (its animation), unless the Coffre is still being watched. */
const ACTIVE_MS = { slot: 9_000, roulette: 13_000 } as const;
/** A Coffre nobody advanced for this long is shown as finished to spectators (the player left). */
const COFFRE_STALE_MS = 180_000;
const COFFRE_FINISHED_SHOWN_MS = 8_000;

export type Game = 'slot' | 'roulette';
export interface CasinoViewer {
  id: string;
  display_name: string;
}

export class CasinoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

interface RoundRow {
  round_id: string;
  channel_id: string;
  viewer_id: string;
  viewer_name: string;
  game: Game;
  idempotency_key: string;
  request_hash: string;
  bet: number;
  raw_payout: number;
  payout: number;
  capped: boolean;
  outcome: SlotOutcome | RouletteOutcome;
  economy: 'lab' | 'canonical';
  progress_step: number;
  progress_at: Date | null;
  finished_at: Date | null;
  shared_at: Date | null;
  announced: boolean;
  created_at: Date;
}

export interface SlotOutcome {
  stops: number[];
  grid: string[][];
  lines: SlotEval['lines'];
  scatter: SlotEval['scatter'];
  line_win: number;
  coffre: (CoffreScript & { win: number }) | null;
}
export interface RouletteOutcome {
  bets: RouletteBets;
  pocket: number;
  number: number;
  color: string;
  wins: { id: string; amount: number; gross: number }[];
  /** The ball's visual seed (shared/ball.js): the same flight for the player, the spectators and the Replay. */
  seed: number;
}

const hashOf = (x: unknown) =>
  createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fmt = (n: number) =>
  Math.round(n)
    .toLocaleString('fr-FR')
    .replace(/[\s\u202f\u00a0]/g, '\u00a0');
const xs = (n: number) =>
  `×${(Math.round(n * 10) / 10).toLocaleString('fr-FR')}`;
const COLOR_FR: Record<string, string> = {
  red: 'rouge',
  black: 'noir',
  green: 'vert',
};

export class CasinoService {
  /** Production's hard switch (CASINO_EXTENSION ≠ off): without it the canonical economy never plays. */
  productionApproved = false;
  /**
   * The Core's environment, set by the real servers (public-frontier: CORE_ENVIRONMENT === 'lab'): only the Lab plays
   * without CASINO_EXTENSION and follows the simulated live — whatever the economy. Unset (tests, the demo): the economy
   * decides (the Lab test wallet never moves a real Jeton).
   */
  labEnvironment: boolean | null = null;
  /** The game's draws (crypto); a test may replace them. */
  rng: IntRng = cryptoIntRng;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly economy: EconomyPort,
    private readonly settings: ModuleSettings,
  ) {}

  private get lab() {
    return this.labEnvironment ?? this.economy.mode !== 'canonical';
  }

  setting(q: Queryable, channelId: string, key: SettingKey) {
    return this.settings.get(q, channelId, `${CASINO_MODULE}.${key}`);
  }

  async limits(q: Queryable, channelId: string) {
    const [
      slotMin,
      slotMax,
      rouletteMax,
      maxWin,
      shareCooldown,
      announce,
      announceMinX,
    ] = await Promise.all([
      this.setting(q, channelId, 'slot_min_bet'),
      this.setting(q, channelId, 'slot_max_bet'),
      this.setting(q, channelId, 'roulette_max_total'),
      this.setting(q, channelId, 'max_win'),
      this.setting(q, channelId, 'share_cooldown_s'),
      this.setting(q, channelId, 'announce'),
      this.setting(q, channelId, 'announce_min_x'),
    ]);
    return {
      slot_min_bet: slotMin,
      slot_max_bet: Math.max(slotMin, slotMax),
      roulette_max_total: rouletteMax,
      roulette_step: BET_STEP,
      max_win: maxWin,
      share_cooldown_s: shareCooldown,
      announce: announce === 1,
      announce_min_x: announceMinX,
    };
  }

  /** The live the casino follows: canonical in Production, the simulated one in the Lab. */
  async live(q: Queryable, channelId: string): Promise<boolean> {
    return this.lab
      ? !!(await liveChannelSession(q, channelId))
      : !!(await activeSession(q));
  }

  /** Open or closed, and why (the extension shows it; a spin re-checks it in its transaction). */
  async availability(q: Queryable, channelId: string) {
    const [open, slot, roulette, live] = await Promise.all([
      this.setting(q, channelId, 'open'),
      this.setting(q, channelId, 'slot_open'),
      this.setting(q, channelId, 'roulette_open'),
      this.live(q, channelId),
    ]);
    const reason =
      !this.lab && !this.productionApproved
        ? 'not_approved'
        : open !== 1
          ? 'casino_closed'
          : !live
            ? 'stream_offline'
            : null;
    return {
      open: reason === null,
      reason,
      live,
      games: {
        slot: reason === null && slot === 1,
        roulette: reason === null && roulette === 1,
      },
      economy: this.economy.mode,
    };
  }

  // --- Play -----------------------------------------------------------------------------------------------------

  async spinSlot(
    channelId: string,
    viewer: CasinoViewer,
    req: { key: string; bet: unknown },
  ) {
    return this.play(channelId, viewer, 'slot', req.key, req.bet);
  }

  async spinRoulette(
    channelId: string,
    viewer: CasinoViewer,
    req: { key: string; bets: unknown },
  ) {
    return this.play(channelId, viewer, 'roulette', req.key, req.bets);
  }

  private async play(
    channelId: string,
    viewer: CasinoViewer,
    game: Game,
    key: string,
    stake: unknown,
  ) {
    if (!/^[A-Za-z0-9_:-]{8,128}$/.test(key ?? ''))
      throw new CasinoError(400, 'idempotency_key_required');
    const requestHash = hashOf([game, viewer.id, stake ?? null]);
    try {
      return await this.db.tx(async (q) => {
        // One viewer's spins one at a time: a resent intent waits for the first and replays it.
        await q.query('select pg_advisory_xact_lock(hashtext($1))', [
          `casino:${channelId}:${viewer.id}`,
        ]);
        const prior = (
          await q.query<RoundRow>(
            'select * from casino_rounds where channel_id = $1 and viewer_id = $2 and idempotency_key = $3',
            [channelId, viewer.id, key],
          )
        )[0];
        if (prior) {
          if (prior.request_hash !== requestHash)
            throw new CasinoError(409, 'idempotency_conflict');
          const w = await this.economy.balances(q, channelId, viewer.id);
          return {
            round: this.ownView(prior),
            balance: w.tokens,
            replayed: true,
          };
        }
        const now = this.clock.now();
        // Everything below refuses BEFORE any payment.
        const av = await this.availability(q, channelId);
        if (!av.open) throw new CasinoError(409, av.reason!);
        if (!av.games[game]) throw new CasinoError(409, 'game_closed');
        await assertNotGloballyPaused(q, channelId);
        if (await activeBlock(q, channelId, viewer.id, 'all', now))
          throw new CasinoError(409, 'viewer_blocked');
        const lim = await this.limits(q, channelId);
        const roundId = randomUUID();
        let bet: number;
        let raw: number;
        let outcome: SlotOutcome | RouletteOutcome;
        if (game === 'slot') {
          if (typeof stake !== 'number' || !Number.isSafeInteger(stake))
            throw new CasinoError(400, 'invalid_bet');
          if (stake < lim.slot_min_bet)
            throw new CasinoError(409, 'below_min', {
              min: lim.slot_min_bet,
            });
          if (stake > lim.slot_max_bet)
            throw new CasinoError(409, 'above_max', {
              max: lim.slot_max_bet,
            });
          bet = stake;
        } else {
          const err = rouletteError(stake, lim.roulette_max_total);
          if (err)
            throw new CasinoError(err === 'above_max' ? 409 : 400, err, {
              max: lim.roulette_max_total,
              step: BET_STEP,
            });
          const bets = stake as RouletteBets;
          bet = stakeOf(bets);
          // A bet that could win more than the cap is refused here (never a capped roulette result).
          let best = 0;
          for (let n = 0; n <= 36; n++)
            best = Math.max(best, settleRoulette(bets, n).gross);
          if (best > lim.max_win)
            throw new CasinoError(409, 'above_max_win', {
              max_win: lim.max_win,
            });
        }
        // The wallet: locked, read; never below 0.
        const hold = await this.economy.hold(
          q,
          now,
          channelId,
          [viewer.id],
          'tokens',
        );
        const balance = hold.balances.get(viewer.id) ?? 0;
        if (balance < bet)
          throw new CasinoError(409, 'insufficient_tokens', {
            balance,
            needed: bet,
          });
        // The wallet's own cap (the Lab's; the canonical one is 10^12): checked before the draw with the largest
        // possible win, never after it (a drawn win is never thrown away).
        if (balance - bet + lim.max_win > hold.maxBalance)
          throw new CasinoError(409, 'balance_cap', {
            max_balance: hold.maxBalance,
          });
        // The draw (Core only).
        if (game === 'slot') {
          const stops = drawStops(this.rng);
          const grid = windowAt(stops);
          const ev = evaluate(grid, bet);
          let coffre: SlotOutcome['coffre'] = null;
          if (ev.scatter.count >= 3) {
            const cells = ev.scatter.cells.map(([r, row]) => r * 3 + row);
            const s = generateCoffre(
              ev.scatter.count,
              floatFrom(this.rng),
              cells,
            );
            coffre = { ...s, win: Math.floor(s.total * bet) };
          }
          raw = ev.total + (coffre?.win ?? 0);
          outcome = {
            stops,
            grid,
            lines: ev.lines,
            scatter: ev.scatter,
            line_win: ev.total,
            coffre,
          };
        } else {
          const bets = stake as RouletteBets;
          const pocket = this.rng.int(ORDER.length);
          const number = ORDER[pocket]!;
          const r = settleRoulette(bets, number);
          raw = r.gross;
          outcome = {
            bets: { ...bets },
            pocket,
            number,
            color: colorOf(number),
            wins: r.wins,
            seed: this.rng.int(2 ** 31),
          };
        }
        const payout = Math.min(raw, lim.max_win);
        // Pay: the bet, then the win — two movements of the canonical ledger (or the Lab's), keyed by the round.
        await this.economy.move(q, now, {
          channelId,
          viewerId: viewer.id,
          currency: 'tokens',
          amount: -bet,
          kind: 'mini_game',
          key: `casino:${roundId}:bet`,
          moduleId: CASINO_MODULE,
        });
        if (payout > 0)
          await this.economy.move(q, now, {
            channelId,
            viewerId: viewer.id,
            currency: 'tokens',
            amount: payout,
            kind: 'mini_game',
            key: `casino:${roundId}:win`,
            moduleId: CASINO_MODULE,
          });
        const row = (
          await q.query<RoundRow>(
            `insert into casino_rounds (round_id, channel_id, viewer_id, viewer_name, game, idempotency_key,
               request_hash, bet, raw_payout, payout, capped, outcome, economy, created_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning *`,
            [
              roundId,
              channelId,
              viewer.id,
              viewer.display_name.slice(0, 64),
              game,
              key,
              requestHash,
              bet,
              raw,
              payout,
              payout < raw,
              JSON.stringify(outcome),
              this.economy.mode,
              now,
            ],
          )
        )[0]!;
        await this.maybeAnnounce(q, channelId, row, lim, now);
        return {
          round: this.ownView(row),
          balance: balance - bet + payout,
          replayed: false,
        };
      });
    } catch (e) {
      const err = this.mapped(e);
      if (NOTED_REFUSALS.has(err.code))
        await this.noteRefusal(channelId, viewer, game, err).catch(() => {});
      throw err;
    }
  }

  private mapped(e: unknown): CasinoError {
    if (e instanceof CasinoError) return e;
    if (e instanceof LabWalletError)
      return new CasinoError(409, e.code, {
        ...((e as unknown as { details?: Record<string, unknown> }).details ??
          {}),
      });
    if (e instanceof GlobalPauseError)
      return new CasinoError(409, 'global_pause');
    // The same key from another viewer, or a concurrent insert of this intent: never a 500, never a payment.
    if ((e as { code?: string }).code === '23505')
      return new CasinoError(409, 'idempotency_conflict');
    if ((e as { name?: string }).name === 'CurrencyCreditError')
      return new CasinoError(409, 'economy_unavailable');
    console.error('[casino] spin failed', e);
    return new CasinoError(503, 'casino_unavailable');
  }

  /** A refused or failed spin, for Studio (« transactions bloquées »): counts and the last ones, nothing paid. */
  private async noteRefusal(
    channelId: string,
    viewer: CasinoViewer,
    game: Game,
    err: CasinoError,
  ) {
    await this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        `casino:${channelId}:refusals`,
      ]);
      const cur = (await this.state<Refusals>(q, channelId, 'refusals')) ?? {
        counts: {},
        last: [],
      };
      cur.counts[err.code] = (cur.counts[err.code] ?? 0) + 1;
      cur.last.unshift({
        at: this.clock.now().toISOString(),
        viewer: viewer.display_name,
        game,
        code: err.code,
      });
      cur.last = cur.last.slice(0, 40);
      await this.setState(q, channelId, 'refusals', cur);
    });
  }

  /**
   * LeCroupier_ announces the exceptional rounds by himself (a GRAND, or ≥ announce_min_x × the bet), at most one every
   * 2 minutes, in the spin's transaction (alone in a savepoint: a refused message never refuses the spin).
   */
  private async maybeAnnounce(
    q: Queryable,
    channelId: string,
    row: RoundRow,
    lim: Awaited<ReturnType<CasinoService['limits']>>,
    now: Date,
  ) {
    if (!lim.announce) return;
    const coffre =
      row.game === 'slot' ? (row.outcome as SlotOutcome).coffre : null;
    const x = row.payout / row.bet;
    if (!(coffre?.full || x >= lim.announce_min_x)) return;
    await q.query('select pg_advisory_xact_lock(hashtext($1))', [
      `casino:${channelId}:announce`,
    ]);
    const last = await this.state<{ at: string }>(q, channelId, 'announced');
    if (last && now.getTime() - Date.parse(last.at) < ANNOUNCE_GAP_MS) return;
    const text = coffre?.full
      ? `🏆 ${row.viewer_name} remplit le Coffre du Raptor et décroche le GRAND : +${fmt(row.payout)} Jetons à la machine à sous !`
      : row.game === 'slot'
        ? `🏆 ${row.viewer_name} réussit un ${xs(x)} à la machine à sous : +${fmt(row.payout)} Jetons !`
        : `🏆 ${row.viewer_name} rafle +${fmt(row.payout)} Jetons à la roulette (${xs(x)}) !`;
    const written = await insertAnnouncement(q, {
      channelId,
      now,
      origin: `module:${CASINO_MODULE}`,
      drafts: [
        {
          idempotencyKey: `module:${CASINO_MODULE}:auto:${row.round_id}`,
          mode: 'announce',
          text,
        },
      ],
    });
    if (!written) return;
    await this.setState(q, channelId, 'announced', { at: now.toISOString() });
    await q.query(
      'update casino_rounds set announced = true where round_id = $1',
      [row.round_id],
    );
    row.announced = true;
  }

  /**
   * The player watched the Coffre up to `step` (display only: no Jeton, never a draw). Monotonic; `done` once the end
   * was shown. Stored for the reconnection (another device resumes there) and for the spectators.
   */
  async progress(
    channelId: string,
    viewer: CasinoViewer,
    req: { round_id: unknown; step: unknown; done?: unknown },
  ) {
    if (typeof req.round_id !== 'string' || !ROUND_ID.test(req.round_id))
      throw new CasinoError(400, 'invalid_round');
    if (
      typeof req.step !== 'number' ||
      !Number.isInteger(req.step) ||
      req.step < -1 ||
      req.step > 64
    )
      throw new CasinoError(400, 'invalid_step');
    const now = this.clock.now();
    const done = req.done === true;
    const r = (
      await this.db.query<{ progress_step: number; finished_at: Date | null }>(
        `update casino_rounds set progress_step = greatest(progress_step, $4), progress_at = $5,
           finished_at = case when $6 and finished_at is null then $5 else finished_at end
         where round_id = $1 and channel_id = $2 and viewer_id = $3
         returning progress_step, finished_at`,
        [req.round_id, channelId, viewer.id, req.step, now, done],
      )
    )[0];
    if (!r) throw new CasinoError(404, 'round_not_found');
    return { progress_step: r.progress_step, finished: !!r.finished_at };
  }

  /**
   * Share a round in the chat (LeCroupier_): the viewer's OWN round, once, at most one every `share_cooldown_s` per
   * viewer and one every 30 s on the channel. The Core writes the text from the real round (never the client's).
   */
  async share(channelId: string, viewer: CasinoViewer, roundId: unknown) {
    if (typeof roundId !== 'string' || !ROUND_ID.test(roundId))
      throw new CasinoError(400, 'invalid_round');
    return this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', [
        `casino:${channelId}:share`,
      ]);
      const row = (
        await q.query<RoundRow>(
          'select * from casino_rounds where round_id = $1 and channel_id = $2',
          [roundId, channelId],
        )
      )[0];
      if (!row || row.viewer_id !== viewer.id)
        throw new CasinoError(404, 'round_not_found');
      if (row.shared_at) return { shared: true, already: true };
      const now = this.clock.now();
      // The chat only hears the casino while it plays: open, during the live, no global pause, the viewer not
      // blocked, a recent round.
      const avail = await this.availability(q, channelId);
      if (avail.reason) throw new CasinoError(409, avail.reason);
      await assertNotGloballyPaused(q, channelId).catch((e: unknown) => {
        throw this.mapped(e);
      });
      if (await activeBlock(q, channelId, viewer.id, 'all', now))
        throw new CasinoError(409, 'viewer_blocked');
      if (now.getTime() - row.created_at.getTime() > SHARE_MAX_AGE_MS)
        throw new CasinoError(409, 'share_too_old');
      const lim = await this.limits(q, channelId);
      const mine = (
        await q.query<{ at: Date }>(
          `select max(shared_at) as at from casino_rounds where channel_id = $1 and viewer_id = $2`,
          [channelId, viewer.id],
        )
      )[0]?.at;
      if (mine && now.getTime() - mine.getTime() < lim.share_cooldown_s * 1000)
        throw new CasinoError(429, 'share_cooldown', {
          retry_in_s: Math.ceil(
            (lim.share_cooldown_s * 1000 - (now.getTime() - mine.getTime())) /
              1000,
          ),
        });
      const any = await this.state<{ at: string }>(q, channelId, 'shared');
      if (any && now.getTime() - Date.parse(any.at) < SHARE_CHANNEL_GAP_MS)
        throw new CasinoError(429, 'share_busy', {
          retry_in_s: Math.ceil(
            (SHARE_CHANNEL_GAP_MS - (now.getTime() - Date.parse(any.at))) /
              1000,
          ),
        });
      const text = shareText(row);
      const written = await insertAnnouncement(q, {
        channelId,
        now,
        origin: `module:${CASINO_MODULE}`,
        drafts: [
          {
            idempotencyKey: `module:${CASINO_MODULE}:share:${row.round_id}`,
            mode: 'normal',
            text,
          },
        ],
      });
      if (!written) throw new CasinoError(503, 'chat_unavailable');
      await q.query(
        'update casino_rounds set shared_at = $2 where round_id = $1',
        [row.round_id, now],
      );
      await this.setState(q, channelId, 'shared', { at: now.toISOString() });
      return { shared: true, already: false, text };
    });
  }

  // --- Reads ----------------------------------------------------------------------------------------------------

  /** What the extension shows (any viewer, anonymous too): availability, limits, the tables, the rounds in progress. */
  async viewerState(channelId: string, viewer: CasinoViewer | null) {
    const q = this.db;
    const [availability, limits, active] = await Promise.all([
      this.availability(q, channelId),
      this.limits(q, channelId),
      this.active(channelId),
    ]);
    let me: Record<string, unknown> | null = null;
    if (viewer) {
      const w = await this.economy.balances(q, channelId, viewer.id);
      // A Coffre this viewer has not finished watching (closed tab, other device): resumed where it was.
      const unfinished = (
        await q.query<RoundRow>(
          `select * from casino_rounds where channel_id = $1 and viewer_id = $2 and game = 'slot'
             and finished_at is null and outcome->'coffre' <> 'null'::jsonb and created_at > $3
           order by created_at desc limit 1`,
          [
            channelId,
            viewer.id,
            new Date(this.clock.now().getTime() - 86_400_000),
          ],
        )
      )[0];
      const lastShare = (
        await q.query<{ at: Date | null }>(
          'select max(shared_at) as at from casino_rounds where channel_id = $1 and viewer_id = $2',
          [channelId, viewer.id],
        )
      )[0]?.at;
      me = {
        balance: w.tokens,
        resume: unfinished ? this.ownView(unfinished) : null,
        share_ready_in_s: lastShare
          ? Math.max(
              0,
              Math.ceil(
                (limits.share_cooldown_s * 1000 -
                  (this.clock.now().getTime() - lastShare.getTime())) /
                  1000,
              ),
            )
          : 0,
      };
    }
    return {
      availability,
      limits,
      tables: {
        slot: slotTable(),
        roulette: { order: ORDER, spots: Object.keys(SPOTS) },
      },
      active,
      me,
      server_now: this.clock.now().toISOString(),
    };
  }

  /** The rounds being played now (spectators): light entries, the result never before its animation. */
  async active(channelId: string) {
    const now = this.clock.now().getTime();
    const rows = await this.db.query<RoundRow>(
      `select * from casino_rounds where channel_id = $1 and created_at > $2 order by created_at desc limit 40`,
      [channelId, new Date(now - 15 * 60_000)],
    );
    const out = [];
    for (const r of rows) {
      const phase = phaseOf(r, now);
      if (!phase) continue;
      out.push({
        round_id: r.round_id,
        game: r.game,
        viewer_name: r.viewer_name,
        bet: r.bet,
        phase,
        started_at: r.created_at.toISOString(),
        progress_step: r.progress_step,
        steps:
          r.game === 'slot'
            ? ((r.outcome as SlotOutcome).coffre?.steps.length ?? null)
            : null,
        // the result only once the round shows it (no spoiler in the list)
        payout: phase === 'result' ? r.payout : null,
      });
      if (out.length >= 12) break;
    }
    return out;
  }

  /** One round, public (spectators, Replay): the whole draw, the player's progress, the server's time. */
  async round(
    channelId: string,
    roundId: unknown,
    viewer: CasinoViewer | null,
  ) {
    if (typeof roundId !== 'string' || !ROUND_ID.test(roundId))
      throw new CasinoError(400, 'invalid_round');
    const r = (
      await this.db.query<RoundRow>(
        'select * from casino_rounds where round_id = $1 and channel_id = $2',
        [roundId, channelId],
      )
    )[0];
    if (!r) throw new CasinoError(404, 'round_not_found');
    const now = this.clock.now().getTime();
    return {
      round: {
        ...publicView(r),
        mine: !!viewer && viewer.id === r.viewer_id,
        phase: phaseOf(r, now) ?? 'done',
      },
      server_now: new Date(now).toISOString(),
    };
  }

  /** The viewer's own history (newest first), light rows; the Replay fetches one round. */
  async history(
    channelId: string,
    viewer: CasinoViewer,
    o: { game?: unknown; limit?: number },
  ) {
    const game = o.game === 'slot' || o.game === 'roulette' ? o.game : null;
    const limit = Math.min(Math.max(o.limit ?? 50, 1), 100);
    const rows = await this.db.query<RoundRow>(
      `select * from casino_rounds where channel_id = $1 and viewer_id = $2 and ($3::text is null or game = $3)
       order by created_at desc limit $4`,
      [channelId, viewer.id, game, limit],
    );
    const stats = (
      await this.db.query<{
        n: string;
        staked: string;
        won: string;
        best: string;
      }>(
        `select count(*) as n, coalesce(sum(bet), 0) as staked, coalesce(sum(payout), 0) as won,
           coalesce(max(payout), 0) as best
         from casino_rounds where channel_id = $1 and viewer_id = $2 and ($3::text is null or game = $3)`,
        [channelId, viewer.id, game],
      )
    )[0]!;
    return {
      rounds: rows.map(lightView),
      stats: {
        rounds: Number(stats.n),
        staked: Number(stats.staked),
        won: Number(stats.won),
        best: Number(stats.best),
      },
    };
  }

  // --- Studio ---------------------------------------------------------------------------------------------------

  /** Studio › Casino: state, limits, today's figures, rounds in progress, the last rounds and the refused ones. */
  async adminState(channelId: string) {
    const q = this.db;
    const since = new Date(this.clock.now().getTime() - 86_400_000);
    const [availability, limits, active, recent, totals, refusals] =
      await Promise.all([
        this.availability(q, channelId),
        this.limits(q, channelId),
        this.active(channelId),
        q.query<RoundRow>(
          'select * from casino_rounds where channel_id = $1 order by created_at desc limit 60',
          [channelId],
        ),
        q.query<{
          game: Game;
          n: string;
          staked: string;
          paid: string;
          capped: string;
          players: string;
        }>(
          `select game, count(*) as n, coalesce(sum(bet), 0) as staked, coalesce(sum(payout), 0) as paid,
             count(*) filter (where capped) as capped, count(distinct viewer_id) as players
           from casino_rounds where channel_id = $1 and created_at > $2 group by game`,
          [channelId, since],
        ),
        this.state<Refusals>(q, channelId, 'refusals'),
      ]);
    return {
      availability,
      limits,
      production_approved: this.productionApproved,
      active,
      day: totals.map((t) => ({
        game: t.game,
        rounds: Number(t.n),
        staked: Number(t.staked),
        paid: Number(t.paid),
        net_house: Number(t.staked) - Number(t.paid),
        capped: Number(t.capped),
        players: Number(t.players),
      })),
      recent: recent.map((r) => ({
        ...lightView(r),
        viewer_id: r.viewer_id,
        viewer_name: r.viewer_name,
        economy: r.economy,
        idempotency_key: r.idempotency_key,
        raw_payout: r.raw_payout,
        shared: !!r.shared_at,
        announced: r.announced,
        progress_step: r.progress_step,
        finished: !!r.finished_at,
      })),
      refusals: refusals ?? { counts: {}, last: [] },
    };
  }

  /** One round as Studio sees it (technical detail: the whole outcome, the Wallet keys). */
  async adminRound(channelId: string, roundId: string) {
    const r = await this.round(channelId, roundId, null);
    return {
      ...r,
      wallet_keys: [`casino:${roundId}:bet`, `casino:${roundId}:win`],
    };
  }

  // --- module_state (refusals, the channel's last messages) ----------------------------------------------------

  private async state<T>(q: Queryable, channelId: string, key: string) {
    const r = (
      await q.query<{ value: T }>(
        'select value from module_state where channel_id = $1 and module_id = $2 and key = $3',
        [channelId, CASINO_MODULE, key],
      )
    )[0];
    return r ? r.value : null;
  }
  private async setState(
    q: Queryable,
    channelId: string,
    key: string,
    value: unknown,
  ) {
    await q.query(
      `insert into module_state (channel_id, module_id, key, value, updated_at) values ($1, $2, $3, $4, $5)
       on conflict (channel_id, module_id, key) do update set value = $4, updated_at = $5`,
      [channelId, CASINO_MODULE, key, JSON.stringify(value), this.clock.now()],
    );
  }

  /** The player's own view of a round (its key, its progress). */
  private ownView(r: RoundRow) {
    return { ...publicView(r), mine: true };
  }
}

interface Refusals {
  counts: Record<string, number>;
  last: { at: string; viewer: string; game: Game; code: string }[];
}

/** Where a round is for spectators (null: over). */
function phaseOf(r: RoundRow, now: number): 'draw' | 'bonus' | 'result' | null {
  const age = now - r.created_at.getTime();
  if (r.game === 'roulette')
    return age < ACTIVE_MS.roulette ? (age < 8_000 ? 'draw' : 'result') : null;
  const coffre = (r.outcome as SlotOutcome).coffre;
  if (!coffre)
    return age < ACTIVE_MS.slot ? (age < 4_000 ? 'draw' : 'result') : null;
  if (r.finished_at)
    return now - r.finished_at.getTime() < COFFRE_FINISHED_SHOWN_MS
      ? 'result'
      : null;
  const last = (r.progress_at ?? r.created_at).getTime();
  if (now - last > COFFRE_STALE_MS) return null;
  return age < 3_000 ? 'draw' : 'bonus';
}

function publicView(r: RoundRow) {
  return {
    round_id: r.round_id,
    game: r.game,
    viewer_name: r.viewer_name,
    bet: r.bet,
    payout: r.payout,
    raw_payout: r.raw_payout,
    capped: r.capped,
    net: r.payout - r.bet,
    outcome: r.outcome,
    created_at: r.created_at.toISOString(),
    progress_step: r.progress_step,
    finished: !!r.finished_at,
    shared: !!r.shared_at,
  };
}

function lightView(r: RoundRow) {
  const slot = r.game === 'slot' ? (r.outcome as SlotOutcome) : null;
  const roul = r.game === 'roulette' ? (r.outcome as RouletteOutcome) : null;
  const best = slot?.lines.slice().sort((a, b) => b.win - a.win)[0];
  return {
    round_id: r.round_id,
    game: r.game,
    bet: r.bet,
    payout: r.payout,
    net: r.payout - r.bet,
    capped: r.capped,
    created_at: r.created_at.toISOString(),
    shared: !!r.shared_at,
    ...(slot
      ? {
          best: best ? { symbol: best.symbol, count: best.count } : null,
          lines: slot.lines.length,
          coffre: slot.coffre
            ? {
                k: slot.coffre.k,
                total: slot.coffre.total,
                win: slot.coffre.win,
                full: slot.coffre.full,
                jackpots: slot.coffre.jackpots,
              }
            : null,
        }
      : {}),
    ...(roul ? { number: roul.number, color: roul.color } : {}),
  };
}

/** LeCroupier_'s share message, from the real round. Short; losses too, never as a win. */
export function shareText(r: {
  game: Game;
  viewer_name: string;
  bet: number;
  payout: number;
  capped: boolean;
  outcome: SlotOutcome | RouletteOutcome;
}): string {
  const name = r.viewer_name;
  if (r.game === 'roulette') {
    const o = r.outcome as RouletteOutcome;
    const where = `le ${o.number} ${COLOR_FR[o.color] ?? ''}`.trim();
    if (r.payout > r.bet)
      return `🎡 ${name} : ${where} tombe, +${fmt(r.payout - r.bet)} Jetons à la roulette (mise ${fmt(r.bet)}) !`;
    if (r.payout > 0)
      return `🎡 ${name} : ${where} tombe, ${fmt(r.payout)} Jetons récupérés sur ${fmt(r.bet)} misés à la roulette.`;
    return `🎡 ${name} : ${where} tombe… ${fmt(r.bet)} Jetons perdus à la roulette.`;
  }
  const o = r.outcome as SlotOutcome;
  const cap = r.capped ? ' (gain plafonné)' : '';
  if (o.coffre)
    return `🎰 ${name} ouvre le Coffre du Raptor${o.coffre.full ? ' et remplit la grille — GRAND !' : ''} : +${fmt(r.payout)} Jetons (${xs(r.payout / r.bet)} la mise)${cap} !`;
  if (r.payout > 0)
    return `🎰 ${name} gagne ${fmt(r.payout)} Jetons à la machine à sous (mise ${fmt(r.bet)}, ${xs(r.payout / r.bet)})${cap}.`;
  return `🎰 ${name} a tenté ${fmt(r.bet)} Jetons à la machine à sous… pas de gain cette fois.`;
}
