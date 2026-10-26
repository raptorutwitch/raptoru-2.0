import type {
  LabChatMessage,
  MiniGamePlay,
  MiniGamesState,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import { type EconomyPort, labEconomy } from '../economy/economy.js';
import { liveChannelSession } from '../stream/channel-sessions.js';
import { DuelService, type DuelOutcome } from './duel.js';
import { parseDuelCommand } from './duel-rules.js';
import * as R from './rules.js';
import type { LoginLookup, TwitchUser } from './twitch-login.js';

// Roulette and Slot V1 (Lab) — the service (docs/ROULETTE_SLOT_PARITY.md § 6). One chat message = one
// transaction under the viewer's wallet lock: replay check, cooldown, bet and balance, draw, ONE balance
// change, ONE ledger row (mini_game, key mg:<channel>:<message_id>), ONE play row, ONE LeCroupier_ answer
// (cmd_steps origin mini_game). All or nothing. Refusals (invalid bet, cooldown…) are silent and write
// nothing. Studio's switch « Mini-jeux » (OFF by default) gates everything. Off live (no open session of the channel,
// the chat games' single reader liveChannelSession), nothing is played: no bet, no debit, no gain, no Duel step; one
// short answer per viewer at most every OFFLINE_NOTICE_MS, the other attempts silent.

export type MiniGameOutcome = 'ignored' | 'mini_game_played' | DuelOutcome;

/** Why a game command did not play (silent for the viewer; returned for the tests and the logs). */
export type MiniGameSkip =
  'disabled' | 'offline' | 'cooldown' | R.BetRefusal | 'balance_cap';

/** Off live: at most one answer per viewer in this window (the other attempts are silent). */
export const OFFLINE_NOTICE_MS = 60_000;

interface PlayRow {
  message_id: string;
  game: 'roulette' | 'slot';
  viewer_id: string;
  viewer_display_name: string;
  bet: string | number;
  all_in: boolean;
  symbols: string[] | null;
  won: boolean;
  delta: string | number;
  balance_after: string | number;
  created_at: Date;
}

const toPlay = (r: PlayRow): MiniGamePlay => ({
  message_id: r.message_id,
  game: r.game,
  viewer_id: r.viewer_id,
  viewer_display_name: r.viewer_display_name,
  bet: Number(r.bet),
  all_in: r.all_in,
  symbols: r.symbols,
  won: r.won,
  delta: Number(r.delta),
  balance_after: Number(r.balance_after),
  created_at: new Date(r.created_at).toISOString(),
});

export class MiniGamesService {
  /** Duel V1: the simulator's identities seen in this Core (login → account), memory only. */
  private readonly simulatorIdentities = new Map<string, TwitchUser>();
  private readonly duels: DuelService;
  /** Off live: when each viewer was last told (memory only; a restart may tell once more). */
  private readonly offlineNotified = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly rng: R.Rng = R.cryptoRng,
    /** Helix « Get Users » by login (Lab app credentials); null = not configured. */
    private readonly lookupLogin: LoginLookup | null = null,
    /** Bets, gains and Duel stakes (Lab wallet by default; the canonical Wallet once P1-001 lot 2 wires it). */
    private readonly economy: EconomyPort = labEconomy,
  ) {
    this.duels = new DuelService(
      db,
      clock,
      rng,
      (login, msg) => this.resolveTarget(login, msg),
      economy,
    );
  }

  /**
   * The Duel target, by exact login (docs/DUEL_PARITY.md § 3): a real-chat message only through Helix; a simulator
   * message first among the simulator identities (never a real Twitch homonym), then Helix. Null = refused.
   */
  private async resolveTarget(
    login: string,
    msg: LabChatMessage,
  ): Promise<TwitchUser | null> {
    if (msg.source === 'simulator') {
      const lab = this.simulatorIdentities.get(login);
      if (lab) return lab;
    }
    return this.lookupLogin ? this.lookupLogin(login) : null;
  }

  /**
   * One chat message: `!roulette` / `!slots` (and aliases) play, `!duel` / `!accept` / `!deny` / `!cancelduel` run
   * the Duel; everything else is ignored. Every simulator message teaches its identity (for the Duel target).
   */
  async chat(msg: LabChatMessage): Promise<{
    outcome: MiniGameOutcome;
    replayed?: boolean;
    skipped?: MiniGameSkip;
  }> {
    if (
      msg.source === 'simulator' &&
      /^[a-z0-9_]{1,25}$/i.test(msg.chatter.login)
    )
      this.simulatorIdentities.set(msg.chatter.login.toLowerCase(), {
        id: msg.chatter.id,
        login: msg.chatter.login.toLowerCase(),
        display_name: msg.chatter.display_name,
      });
    const duel = parseDuelCommand(msg.text);
    if (duel) {
      if (!(await this.enabled(this.db, msg.channel_id)))
        return { outcome: 'ignored', skipped: 'disabled' };
      // Every Duel command: a challenge pending when the live ends can no longer be accepted (it simply expires).
      if (await this.offLive(msg))
        return { outcome: 'ignored', skipped: 'offline' };
      return this.duels.chat(msg, duel);
    }
    const cmd = R.parseCommand(msg.text);
    if (!cmd) return { outcome: 'ignored' };
    if (!(await this.enabled(this.db, msg.channel_id)))
      return { outcome: 'ignored', skipped: 'disabled' };
    if (await this.offLive(msg))
      return { outcome: 'ignored', skipped: 'offline' };
    const rules = R.MINI_GAME_RULES[cmd.game];
    return this.db.tx(async (q) => {
      const now = this.clock.now();
      // The wallet lock first (economy port): the same viewer's games (and a resent message) are serialized here.
      const hold = await this.economy.hold(
        q,
        now,
        msg.channel_id,
        [msg.chatter.id],
        'tokens',
      );
      const tokens = hold.balances.get(msg.chatter.id)!;
      const played = await q.query(
        'select 1 from mini_game_plays where channel_id = $1 and message_id = $2',
        [msg.channel_id, msg.message_id],
      );
      if (played.length)
        return { outcome: 'mini_game_played' as const, replayed: true };
      const last = (
        await q.query<{ created_at: Date }>(
          `select created_at from mini_game_plays where channel_id = $1 and viewer_id = $2 and game = $3
           order by created_at desc limit 1`,
          [msg.channel_id, msg.chatter.id, cmd.game],
        )
      )[0];
      if (
        last &&
        now.getTime() - new Date(last.created_at).getTime() < rules.cooldownMs
      )
        return { outcome: 'ignored' as const, skipped: 'cooldown' as const };
      const bet = R.resolveBet(cmd.game, cmd.arg, tokens);
      if ('refused' in bet)
        return { outcome: 'ignored' as const, skipped: bet.refused };
      // A win that the wallet could not hold is refused before the draw (never a drawn-then-lost win).
      const best = R.netGain(cmd.game, bet.amount, true);
      if (tokens + best > hold.maxBalance)
        return { outcome: 'ignored' as const, skipped: 'balance_cap' as const };
      const d = R.draw(cmd.game, this.rng);
      const delta = R.netGain(cmd.game, bet.amount, d.won);
      // ONE balance change and its ledger row (key unique per message), in this transaction.
      const { balanceAfter, ledgerId: ledger } = await this.economy.move(
        q,
        now,
        {
          channelId: msg.channel_id,
          viewerId: msg.chatter.id,
          currency: 'tokens',
          amount: delta,
          kind: 'mini_game',
          key: `mg:${msg.channel_id}:${msg.message_id}`,
        },
      );
      await q.query(
        `insert into mini_game_plays (channel_id, message_id, game, viewer_id, viewer_display_name, bet, all_in,
           symbols, won, delta, balance_after, ledger_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          msg.channel_id,
          msg.message_id,
          cmd.game,
          msg.chatter.id,
          msg.chatter.display_name,
          bet.amount,
          bet.allIn,
          d.symbols,
          d.won,
          delta,
          balanceAfter,
          ledger,
          now,
        ],
      );
      await insertWordGameSteps(q, {
        channelId: msg.channel_id,
        now,
        origin: 'mini_game',
        drafts: [
          {
            idempotencyKey: `mg:msg:${msg.message_id}`,
            mode: 'normal',
            text: R.resultText({
              game: cmd.game,
              won: d.won,
              allIn: bet.allIn,
              user: msg.chatter.display_name,
              bet: bet.amount,
              delta,
              balanceAfter,
              symbols: d.symbols,
            }),
          },
        ],
      });
      return { outcome: 'mini_game_played' as const };
    });
  }

  /**
   * True off live: the command is refused before anything is read or written in a wallet. The viewer is told once per
   * OFFLINE_NOTICE_MS (one answer per Twitch message: a resent message writes nothing new).
   */
  private async offLive(msg: LabChatMessage) {
    if (await liveChannelSession(this.db, msg.channel_id)) return false;
    const now = this.clock.now().getTime();
    const key = `${msg.channel_id}:${msg.chatter.id}`;
    if (now - (this.offlineNotified.get(key) ?? -Infinity) < OFFLINE_NOTICE_MS)
      return true;
    if (this.offlineNotified.size > 5000) this.offlineNotified.clear();
    this.offlineNotified.set(key, now);
    await this.db.tx((q) =>
      insertWordGameSteps(q, {
        channelId: msg.channel_id,
        now: this.clock.now(),
        origin: 'mini_game',
        drafts: [
          {
            idempotencyKey: `mg:offline:${msg.message_id}`,
            mode: 'normal',
            text: `@${msg.chatter.display_name} - les mini-jeux sont disponibles pendant le live.`,
          },
        ],
      }),
    );
    return true;
  }

  private async enabled(q: Queryable, channelId: string) {
    return (
      (
        await q.query<{ enabled: boolean }>(
          'select enabled from mini_game_channels where channel_id = $1',
          [channelId],
        )
      )[0]?.enabled ?? false
    );
  }

  /** Studio switch « Mini-jeux ». */
  async setEnabled(channelId: string, enabled: boolean) {
    await this.db.query(
      `insert into mini_game_channels (channel_id, enabled, updated_at) values ($1, $2, $3)
       on conflict (channel_id) do update set enabled = excluded.enabled, updated_at = excluded.updated_at`,
      [channelId, enabled, this.clock.now()],
    );
    return this.state(channelId);
  }

  /** Read only: the switch and the last plays (Studio). */
  async state(channelId: string): Promise<MiniGamesState> {
    const recent = await this.db.query<PlayRow>(
      `select message_id, game, viewer_id, viewer_display_name, bet, all_in, symbols, won, delta, balance_after, created_at
       from mini_game_plays where channel_id = $1 order by created_at desc, message_id desc limit 10`,
      [channelId],
    );
    return {
      channel_id: channelId,
      enabled: await this.enabled(this.db, channelId),
      recent: recent.map(toPlay),
    };
  }
}
