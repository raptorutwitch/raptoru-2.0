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
import {
  FREE_GAMES as BOOK_FREE_GAMES,
  LINES as BOOK_LINES,
  PAYS as BOOK_PAYS,
  playRound as playBook,
  SCATTER_PAYS as BOOK_SCATTER,
  STRIPS as BOOK_STRIPS,
  type BookRound,
  type BookTest,
} from './book.js';
import { generateCoffre, type CoffreScript } from './coffre.js';
import { CasinoError, ROUND_ID } from './errors.js';
import { bonusSteps, CasinoFeed, POS } from './feed.js';
import { cryptoIntRng, floatFrom, type IntRng } from './rng.js';
import {
  ALL_IN_MAX_WIN,
  BET_STEP,
  colorOf,
  ORDER,
  playable,
  rouletteError,
  rouletteLimit,
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
export { CasinoError, ROUND_ID };

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
  book_open: {
    label: 'Machine à émotes ouverte',
    unit: '0 / 1',
    default: 1,
    min: 0,
    max: 1,
  },
  blackjack_open: {
    label: 'Blackjack ouvert',
    unit: '0 / 1',
    default: 1,
    min: 0,
    max: 1,
    help: 'fermé : plus de place ni de mise ; une manche déjà engagée se termine et se paie normalement.',
  },
  book_min_bet: {
    label: 'Machine à émotes : mise minimum',
    unit: 'Jetons',
    default: 20,
    min: 10,
    max: 10_000,
  },
  book_max_bet: {
    label: 'Machine à émotes : mise maximum',
    unit: 'Jetons',
    default: 1_000,
    min: 10,
    max: 10_000,
    help: 'le gain d’un tour (tours gratuits compris) est payé jusqu’au « gain maximum par partie » : au-delà de « gain maximum ÷ 1 000 », ce plafond retire du RTP (docs/CASINO.md § 13).',
  },
  bj_main_min: {
    label: 'Blackjack : mise principale minimum',
    unit: 'Jetons',
    default: 100,
    min: 10,
    max: 100_000,
    help: 'en multiples de 10 ; aucun maximum fixe : c’est le gain possible qui est borné (ligne suivante).',
  },
  bj_max_win: {
    label: 'Blackjack : gain net possible maximum par manche',
    unit: 'Jetons',
    default: 1_000_000,
    min: 10_000,
    max: 30_000_000,
    help: 'pire cas compté avant la donne : 3 splits + 4 doubles gagnés (8 × la mise) + le meilleur pari banque. Une mise qui pourrait le dépasser est refusée avec la mise maximale possible ; jamais un gain réduit.',
  },
  bj_side_max_return: {
    label: 'Blackjack : retour maximum des paris banque par manche',
    unit: 'Jetons',
    default: 100_000,
    min: 1_000,
    max: 10_000_000,
  },
  bj_announce: {
    label: 'Blackjack : proposer l’annonce d’une nouvelle table',
    unit: '0 / 1',
    // Désactivée par défaut depuis l'ouverture libre des tables (mandat d'Antoni du 21/11, docs/CASINO.md § 18).
    default: 0,
    min: 0,
    max: 1,
    help: 'le joueur qui ouvre une table peut, d’un clic, faire annoncer la table par LeCroupier_ (jamais automatique).',
  },
  bj_reactions: {
    label: 'Blackjack : réactions des joueurs (émotes)',
    unit: '0 / 1',
    default: 1,
    min: 0,
    max: 1,
    help: 'un joueur assis peut faire apparaître une émote au-dessus de sa place (6 émotes fixes, aucun texte libre, une toutes les 2 s au plus). 0 : le bouton disparaît des tables.',
  },
  bj_dealer_reactions: {
    label: 'Blackjack : réactions de la banque',
    unit: '0 / 1',
    default: 1,
    min: 0,
    max: 1,
    help: 'de temps en temps, une courte bulle de la banque (blackjack, banque qui saute, gros gain…), au plus une par manche, jamais à chaque manche. Aucune IA.',
  },
  bj_announce_gap_s: {
    label: 'Blackjack : délai minimum entre deux annonces de table',
    unit: 's',
    default: 600,
    min: 60,
    max: 86_400,
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
  roulette_all_in_max_win: {
    label:
      'Roulette : gain maximum d’un ALL-IN (0 = ALL-IN limité au plafond par tour)',
    unit: 'Jetons',
    default: 0,
    min: 0,
    max: ALL_IN_MAX_WIN,
    help: 'au-dessus de 0 : une mise qui engage TOUT le solde peut dépasser la mise totale maximum par tour ; ce montant remplace alors le gain maximum par partie (refus avant le tirage au-delà, jamais un gain réduit). Les mises ordinaires gardent leur plafond (docs/CASINO.md § 4).',
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
const ACTIVE_MS = { slot: 9_000, roulette: 13_000, book: 9_000 } as const;
/** A Coffre nobody advanced for this long is shown as finished to spectators (the player left). */
const COFFRE_STALE_MS = 180_000;
const COFFRE_FINISHED_SHOWN_MS = 8_000;

export type Game = 'slot' | 'roulette' | 'book' | 'blackjack';
export interface CasinoViewer {
  id: string;
  display_name: string;
}

export interface RoundRow {
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
  outcome: SlotOutcome | RouletteOutcome | BookOutcome;
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
/** The emote machine: the whole round (base spin, the feature's symbol and every free spin), drawn at once. */
export type BookOutcome = BookRound;
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
  /** The spectators' feed: each player's revealed stages, in order (feed.ts). */
  readonly feed: CasinoFeed;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly economy: EconomyPort,
    private readonly settings: ModuleSettings,
  ) {
    this.feed = new CasinoFeed(db, clock);
  }

  private get lab() {
    return this.labEnvironment ?? this.economy.mode !== 'canonical';
  }
  /** The Lab (scenarios, the simulated live) — never Production. */
  isLab() {
    return this.lab;
  }

  setting(q: Queryable, channelId: string, key: SettingKey) {
    return this.settings.get(q, channelId, `${CASINO_MODULE}.${key}`);
  }

  /** Every `casino.*` setting in one read (a spin used to read them one by one, under its lock). */
  private async values(q: Queryable, channelId: string) {
    const all = await this.settings.getMany(
      q,
      channelId,
      Object.keys(CASINO_SETTINGS).map((k) => `${CASINO_MODULE}.${k}`),
    );
    return (key: SettingKey) => all.get(`${CASINO_MODULE}.${key}`)!;
  }

  async limits(q: Queryable, channelId: string) {
    const v = await this.values(q, channelId);
    const slotMin = v('slot_min_bet');
    const slotMax = v('slot_max_bet');
    const rouletteMax = v('roulette_max_total');
    const maxWin = v('max_win');
    const allInMaxWin = v('roulette_all_in_max_win');
    const shareCooldown = v('share_cooldown_s');
    const announce = v('announce');
    const announceMinX = v('announce_min_x');
    const bookMin = v('book_min_bet');
    return {
      book_min_bet: bookMin,
      book_max_bet: Math.max(bookMin, v('book_max_bet')),
      bj_main_min: Math.ceil(v('bj_main_min') / 10) * 10,
      bj_max_win: v('bj_max_win'),
      bj_side_max_return: v('bj_side_max_return'),
      bj_announce: v('bj_announce') === 1,
      bj_announce_gap_s: v('bj_announce_gap_s'),
      bj_reactions: v('bj_reactions') === 1,
      bj_dealer_reactions: v('bj_dealer_reactions') === 1,
      slot_min_bet: slotMin,
      slot_max_bet: Math.max(slotMin, slotMax),
      roulette_max_total: rouletteMax,
      roulette_step: BET_STEP,
      max_win: maxWin,
      // 0: no exception (ALL-IN = up to the per-spin maximum); else never below the ordinary win cap.
      roulette_all_in_max_win:
        allInMaxWin > 0 ? Math.max(allInMaxWin, maxWin) : 0,
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
    const [v, live] = await Promise.all([
      this.values(q, channelId),
      this.live(q, channelId),
    ]);
    const open = v('open');
    const slot = v('slot_open');
    const roulette = v('roulette_open');
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
        book: reason === null && v('book_open') === 1,
        blackjack: reason === null && v('blackjack_open') === 1,
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

  /** The emote machine. `test`: a Lab scenario (forced BONUS, symbol, expansion) — refused outside the Lab. */
  async spinBook(
    channelId: string,
    viewer: CasinoViewer,
    req: { key: string; bet: unknown; test?: unknown },
  ) {
    if (req.test != null && !this.lab) throw new CasinoError(403, 'lab_only');
    return this.play(
      channelId,
      viewer,
      'book',
      req.key,
      req.bet,
      (req.test ?? null) as BookTest | null,
    );
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
    test: BookTest | null = null,
  ) {
    if (!/^[A-Za-z0-9_:-]{8,128}$/.test(key ?? ''))
      throw new CasinoError(400, 'idempotency_key_required');
    const requestHash = hashOf([
      game,
      viewer.id,
      stake ?? null,
      ...(test ? [test] : []),
    ]);
    try {
      const res = await this.db.tx(async (q) => {
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
        let outcome: SlotOutcome | RouletteOutcome | BookOutcome;
        if (game === 'book') {
          if (
            typeof stake !== 'number' ||
            !Number.isSafeInteger(stake) ||
            stake % 10 !== 0
          )
            throw new CasinoError(400, 'invalid_bet');
          if (stake < lim.book_min_bet)
            throw new CasinoError(409, 'below_min', { min: lim.book_min_bet });
          if (stake > lim.book_max_bet)
            throw new CasinoError(409, 'above_max', { max: lim.book_max_bet });
          bet = stake;
        } else if (game === 'slot') {
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
          // The shape first (the per-spin maximum is checked with the balance, below: an ALL-IN may pass it).
          const err = rouletteError(stake, Number.MAX_SAFE_INTEGER);
          if (err)
            throw new CasinoError(400, err, {
              max: lim.roulette_max_total,
              step: BET_STEP,
            });
          bet = stakeOf(stake as RouletteBets);
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
        // The round's win cap: the ordinary one, or an ALL-IN's (the whole balance, above the per-spin maximum).
        let cap = lim.max_win;
        let most = cap; // the most this round can pay
        if (game === 'roulette') {
          const bets = stake as RouletteBets;
          const r = rouletteLimit(bets, balance, lim);
          if (r.refusal)
            throw new CasinoError(409, r.refusal, {
              max: lim.roulette_max_total,
              max_win: r.cap,
              balance,
            });
          cap = r.cap;
          most = r.best;
        }
        if (balance < bet)
          throw new CasinoError(409, 'insufficient_tokens', {
            balance,
            needed: bet,
          });
        // The wallet's own cap (the Lab's; the canonical one is 10^12): checked before the draw with the largest
        // possible win, never after it (a drawn win is never thrown away).
        if (balance - bet + most > hold.maxBalance)
          throw new CasinoError(409, 'balance_cap', {
            max_balance: hold.maxBalance,
          });
        // The draw (Core only).
        if (game === 'book') {
          const r = playBook(this.rng, bet, test);
          raw = r.payout;
          outcome = r;
        } else if (game === 'slot') {
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
        const payout = Math.min(raw, cap);
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
        // The spectators see the stake now; the result only once the player's screen showed it (feed.ts).
        await this.feed.start(q, row);
        return {
          round: this.ownView(row),
          balance: balance - bet + payout,
          replayed: false,
        };
      });
      if (!res.replayed) this.feed.wake(channelId);
      return res;
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
      : row.game === 'book'
        ? `🏆 ${row.viewer_name} réussit un ${xs(x)} à la machine à émotes : +${fmt(row.payout)} Jetons !`
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
   * The player's screen has shown a stage of their OWN round (display only: no Jeton, never a draw): `stage` =
   * result (the reels stopped / the ball settled) | coffre (the Coffre opened) | step (respin `step` played) | end.
   * The spectators receive it now (feed.ts: never before); the Coffre's progress is kept for the reconnection (another
   * device resumes there). Monotonic and idempotent. (`step` alone, older clients: -1 = opened, `done` = the end.)
   */
  async progress(
    channelId: string,
    viewer: CasinoViewer,
    req: {
      round_id: unknown;
      stage?: unknown;
      step?: unknown;
      done?: unknown;
      fast?: unknown;
      of?: unknown;
    },
  ) {
    if (typeof req.round_id !== 'string' || !ROUND_ID.test(req.round_id))
      throw new CasinoError(400, 'invalid_round');
    const step =
      typeof req.step === 'number' &&
      Number.isInteger(req.step) &&
      req.step >= -1 &&
      req.step <= 500
        ? req.step
        : null;
    if (req.stage === 'skip')
      return this.skip(channelId, viewer, req.round_id, req.of, step);
    let pos: number;
    if (req.stage === 'result') pos = POS.result;
    else if (req.stage === 'coffre') pos = POS.coffre;
    else if (req.stage === 'end') pos = POS.end;
    else if (req.stage === 'step' && step !== null && step >= 0)
      pos = POS.step(step);
    else if (req.stage === undefined && step !== null)
      pos =
        req.done === true ? POS.end : step < 0 ? POS.coffre : POS.step(step);
    else throw new CasinoError(400, 'invalid_step');
    const now = this.clock.now();
    const out = await this.db.tx(async (q) => {
      const r = (
        await q.query<RoundRow>(
          'select * from casino_rounds where round_id = $1 and channel_id = $2 and viewer_id = $3',
          [req.round_id, channelId, viewer.id],
        )
      )[0];
      if (!r) throw new CasinoError(404, 'round_not_found');
      // The bonus (the Coffre's respins, the emote machine's free spins): its steps, or null.
      const steps = bonusSteps(r);
      if (
        (pos === POS.coffre && steps === null) ||
        (pos > POS.coffre &&
          pos < POS.end &&
          (steps === null || pos - POS.step(0) >= steps))
      )
        throw new CasinoError(400, 'invalid_step');
      if (steps !== null && pos >= POS.coffre) {
        const shown =
          pos === POS.coffre ? -1 : pos === POS.end ? steps : pos - POS.step(0);
        await q.query(
          `update casino_rounds set progress_step = greatest(progress_step, $2), progress_at = $3,
             finished_at = case when $4 and finished_at is null then $3 else finished_at end
           where round_id = $1`,
          [r.round_id, shown, now, pos === POS.end],
        );
      } else if (steps === null && pos >= POS.result)
        await q.query(
          'update casino_rounds set finished_at = coalesce(finished_at, $2) where round_id = $1',
          [r.round_id, now],
        );
      const pub = await this.feed.publish(q, r, pos, req.fast === true);
      const after = (
        await q.query<{ progress_step: number; finished_at: Date | null }>(
          'select progress_step, finished_at from casino_rounds where round_id = $1',
          [r.round_id],
        )
      )[0]!;
      return {
        progress_step: after.progress_step,
        finished: !!after.finished_at,
        published: pub.last,
        wrote: pub.wrote,
      };
    });
    if (out.wrote) this.feed.wake(channelId);
    return {
      progress_step: out.progress_step,
      finished: out.finished,
      published: out.published,
    };
  }

  /**
   * The player pressed Passer on an animation of their round: its spectators jump to the same end. Only for a stage
   * already public (nothing is revealed by it), once per stage.
   */
  private async skip(
    channelId: string,
    viewer: CasinoViewer,
    roundId: string,
    of: unknown,
    step: number | null,
  ) {
    const need =
      of === 'result'
        ? POS.result
        : of === 'coffre'
          ? POS.coffre
          : of === 'end'
            ? POS.end
            : of === 'step' && step !== null && step >= 0
              ? POS.step(step)
              : null;
    if (need === null) throw new CasinoError(400, 'invalid_step');
    const at = of === 'step' ? `step:${step}` : String(of);
    const wrote = await this.db.tx(async (q) => {
      const r = (
        await q.query<RoundRow>(
          'select * from casino_rounds where round_id = $1 and channel_id = $2 and viewer_id = $3',
          [roundId, channelId, viewer.id],
        )
      )[0];
      if (!r) throw new CasinoError(404, 'round_not_found');
      return this.feed.skip(q, r, need, at);
    });
    if (wrote) this.feed.wake(channelId);
    return { skipped: wrote };
  }

  /** The roulette bets the player is placing (spectators see them; never debited: the spin re-checks everything). */
  async draft(channelId: string, viewer: CasinoViewer, bets: unknown) {
    if (!bets || typeof bets !== 'object' || Array.isArray(bets))
      throw new CasinoError(400, 'invalid_bets');
    const entries = Object.entries(bets as Record<string, unknown>);
    if (entries.length > 60) throw new CasinoError(400, 'too_many_bets');
    const clean: Record<string, number> = {};
    let total = 0;
    for (const [id, v] of entries) {
      if (!Object.hasOwn(SPOTS, id)) throw new CasinoError(400, 'unknown_spot');
      if (
        typeof v !== 'number' ||
        !Number.isSafeInteger(v) ||
        v < BET_STEP ||
        v % BET_STEP !== 0
      )
        throw new CasinoError(400, 'invalid_amount');
      clean[id] = v;
      total += v;
    }
    const [lim, av] = await Promise.all([
      this.limits(this.db, channelId),
      this.availability(this.db, channelId),
    ]);
    if (total > lim.roulette_max_total) {
      // An ALL-IN being placed: shown only if it is the whole balance (as the spin will require).
      const { tokens } = await this.economy.balances(
        this.db,
        channelId,
        viewer.id,
      );
      if (!lim.roulette_all_in_max_win || total !== playable(tokens))
        throw new CasinoError(400, 'above_max');
    }
    if (!av.games.roulette)
      throw new CasinoError(409, av.reason ?? 'game_closed');
    await this.feed.draft(channelId, viewer, clean, total);
    return { ok: true };
  }

  /** The game the player has open (slot | roulette | null): spectators follow them from one to the other. */
  async presence(channelId: string, viewer: CasinoViewer, game: unknown) {
    if (
      game !== null &&
      game !== 'slot' &&
      game !== 'roulette' &&
      game !== 'book' &&
      game !== 'blackjack'
    )
      throw new CasinoError(400, 'invalid_game');
    return this.feed.presence(channelId, viewer, game);
  }

  /** A spectator follows a player: the revealed stages after their cursor (long-poll). Public, anonymous too. */
  watch(channelId: string, player: unknown, after: number, waitMs: number) {
    if (typeof player !== 'string')
      throw new CasinoError(400, 'invalid_player');
    return this.feed.watch(channelId, player, after, waitMs);
  }

  /** « Regarder les parties en direct »: who is playing now (long-poll on its changes). Public, anonymous too. */
  livePlayers(channelId: string, after: number, waitMs: number) {
    return this.feed.live(channelId, after, waitMs);
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
    const [availability, limits, live] = await Promise.all([
      this.availability(q, channelId),
      this.limits(q, channelId),
      this.feed.live(channelId, -1, 0),
    ]);
    let me: Record<string, unknown> | null = null;
    if (viewer) {
      const w = await this.economy.balances(q, channelId, viewer.id);
      // A Coffre this viewer has not finished watching (closed tab, other device): resumed where it was.
      // A bonus this viewer has not finished watching (closed tab, other device): resumed where it was — the Coffre on
      // the fruit machine, the free spins on the emote machine (each screen takes its own).
      const unfinishedOf = async (game: 'slot' | 'book') =>
        (
          await q.query<RoundRow>(
            `select * from casino_rounds where channel_id = $1 and viewer_id = $2 and game = $3 and finished_at is null
               and created_at > $4 and outcome->$5 <> 'null'::jsonb
             order by created_at desc limit 1`,
            [
              channelId,
              viewer.id,
              game,
              new Date(this.clock.now().getTime() - 86_400_000),
              game === 'slot' ? 'coffre' : 'feature',
            ],
          )
        )[0];
      const unfinished = await unfinishedOf('slot');
      const unfinishedBook = await unfinishedOf('book');
      const lastShare = (
        await q.query<{ at: Date | null }>(
          'select max(shared_at) as at from casino_rounds where channel_id = $1 and viewer_id = $2',
          [channelId, viewer.id],
        )
      )[0]?.at;
      me = {
        balance: w.tokens,
        resume: unfinished ? this.ownView(unfinished) : null,
        resume_book: unfinishedBook ? this.ownView(unfinishedBook) : null,
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
        // The emote machine (display only: the Core draws every round).
        book: {
          strips: BOOK_STRIPS,
          lines: BOOK_LINES,
          pays: BOOK_PAYS,
          scatter_pays: BOOK_SCATTER,
          free_games: BOOK_FREE_GAMES,
        },
      },
      players: live.players,
      live_cursor: live.cursor,
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
        steps: bonusSteps(r),
        // the result only once the round shows it (no spoiler in the list)
        payout: phase === 'result' ? r.payout : null,
      });
      if (out.length >= 12) break;
    }
    return out;
  }

  /**
   * One round: its player's whole round (the Replay, a resumed Coffre); another viewer's only once its end is public
   * (feed.ts) — before, its stake alone (never a result ahead of the player's screen).
   */
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
    const mine = !!viewer && viewer.id === r.viewer_id;
    const ended =
      mine ||
      (
        await this.db.query(
          'select 1 from casino_feed where round_id = $1 and pos = $2',
          [r.round_id, POS.end],
        )
      ).length > 0 ||
      now - r.created_at.getTime() > 30 * 60_000;
    return {
      round: ended
        ? { ...publicView(r), mine, phase: phaseOf(r, now) ?? 'done' }
        : {
            round_id: r.round_id,
            game: r.game,
            viewer_name: r.viewer_name,
            bet: r.bet,
            created_at: r.created_at.toISOString(),
            mine: false,
            revealed: false,
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
    const game =
      o.game === 'slot' ||
      o.game === 'roulette' ||
      o.game === 'book' ||
      o.game === 'blackjack'
        ? o.game
        : null;
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
  if (r.game === 'blackjack') return null; // a table is followed by its own spectator view
  if (r.game === 'roulette')
    return age < ACTIVE_MS.roulette ? (age < 8_000 ? 'draw' : 'result') : null;
  const coffre = bonusSteps(r) !== null;
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
  const book = r.game === 'book' ? (r.outcome as BookOutcome) : null;
  const bj =
    r.game === 'blackjack'
      ? (r.outcome as unknown as {
          table: number;
          round: number;
          outcome: string;
          dealer: number;
        })
      : null;
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
    ...(book
      ? {
          lines: book.base.eval.lines.length,
          feature: book.feature
            ? {
                symbol: book.feature.symbol,
                games: book.feature.games,
                win: book.feature.total,
              }
            : null,
        }
      : {}),
    ...(bj ? { table: bj.table, round: bj.round, dealer: bj.outcome } : {}),
  };
}

/** LeCroupier_'s share message, from the real round. Short; losses too, never as a win. */
export function shareText(r: {
  game: Game;
  viewer_name: string;
  bet: number;
  payout: number;
  capped: boolean;
  outcome: SlotOutcome | RouletteOutcome | BookOutcome;
}): string {
  const name = r.viewer_name;
  if (r.game === 'blackjack') {
    const net = r.payout - r.bet;
    return net > 0
      ? `🃏 ${name} gagne +${fmt(net)} Jetons au Blackjack (mises ${fmt(r.bet)}) !`
      : net === 0
        ? `🃏 ${name} récupère sa mise au Blackjack (${fmt(r.bet)} Jetons).`
        : `🃏 ${name} laisse ${fmt(-net)} Jetons à la banque au Blackjack.`;
  }
  if (r.game === 'book') {
    const o = r.outcome as BookOutcome;
    const cap = r.capped ? ' (gain plafonné)' : '';
    if (o.feature)
      return `🎰 ${name} déclenche ${o.feature.games} tours gratuits à la machine à émotes : +${fmt(r.payout)} Jetons (${xs(r.payout / r.bet)} la mise)${cap} !`;
    if (r.payout > 0)
      return `🎰 ${name} gagne ${fmt(r.payout)} Jetons à la machine à émotes (mise ${fmt(r.bet)}, ${xs(r.payout / r.bet)})${cap}.`;
    return `🎰 ${name} a tenté ${fmt(r.bet)} Jetons à la machine à émotes… pas de gain cette fois.`;
  }
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
