import type {
  LabChatMessage,
  MiniGamePlay,
  MiniGamesState,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import { lockWallet } from '../lab-moderation/store.js';
import { creditCurrency, currency } from '../raffle-lab/currencies.js';
import * as R from './rules.js';

// Roulette and Slot V1 (Lab) — the service (docs/ROULETTE_SLOT_PARITY.md § 6). One chat message = one
// transaction under the viewer's wallet lock: replay check, cooldown, bet and balance, draw, ONE balance
// change, ONE ledger row (mini_game, key mg:<channel>:<message_id>), ONE play row, ONE LeCroupier_ answer
// (cmd_steps origin mini_game). All or nothing. Refusals (invalid bet, cooldown…) are silent and write
// nothing. Studio's switch « Mini-jeux » (OFF by default) gates everything.

export type MiniGameOutcome = 'ignored' | 'mini_game_played';

/** Why a game command did not play (silent for the viewer; returned for the tests and the logs). */
export type MiniGameSkip =
  'disabled' | 'cooldown' | R.BetRefusal | 'balance_cap';

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
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly rng: R.Rng = R.cryptoRng,
  ) {}

  /** One chat message: only `!roulette` / `!slots` (and aliases) play; everything else is ignored. */
  async chat(msg: LabChatMessage): Promise<{
    outcome: MiniGameOutcome;
    replayed?: boolean;
    skipped?: MiniGameSkip;
  }> {
    const cmd = R.parseCommand(msg.text);
    if (!cmd) return { outcome: 'ignored' };
    if (!(await this.enabled(this.db, msg.channel_id)))
      return { outcome: 'ignored', skipped: 'disabled' };
    const rules = R.MINI_GAME_RULES[cmd.game];
    return this.db.tx(async (q) => {
      const now = this.clock.now();
      // The wallet lock first: the same viewer's games (and a resent message) are serialized here.
      const wallet = await lockWallet(q, msg.channel_id, msg.chatter.id, now);
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
      const bet = R.resolveBet(cmd.game, cmd.arg, wallet.tokens);
      if ('refused' in bet)
        return { outcome: 'ignored' as const, skipped: bet.refused };
      // A win that the Lab wallet could not hold is refused before the draw (never a drawn-then-lost win).
      const tokens = await currency(q, 'tokens');
      const best = R.netGain(cmd.game, bet.amount, true);
      if (tokens && wallet.tokens + best > tokens.max_balance)
        return { outcome: 'ignored' as const, skipped: 'balance_cap' as const };
      const d = R.draw(cmd.game, this.rng);
      const delta = R.netGain(cmd.game, bet.amount, d.won);
      let balanceAfter: number;
      if (delta > 0)
        balanceAfter = await creditCurrency(q, now, {
          channelId: msg.channel_id,
          viewerId: msg.chatter.id,
          currencyId: 'tokens',
          amount: delta,
        });
      else {
        balanceAfter = wallet.tokens + delta;
        await q.query(
          'update lab_wallets set tokens = $3, updated_at = $4 where channel_id = $1 and viewer_id = $2',
          [msg.channel_id, msg.chatter.id, balanceAfter, now],
        );
      }
      const key = `mg:${msg.channel_id}:${msg.message_id}`;
      const ledger = Number(
        (
          await q.query<{ id: number }>(
            `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, module_id, actor, reason, created_at)
             values ($1, $2, 'mini_game', 'tokens', $3, null, 'system', $4, $5) returning id`,
            [msg.channel_id, msg.chatter.id, delta, key, now],
          )
        )[0]!.id,
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
