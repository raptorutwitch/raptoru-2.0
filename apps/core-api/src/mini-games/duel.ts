import { randomUUID } from 'node:crypto';
import type { LabChatMessage } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import { lockWallet } from '../lab-moderation/store.js';
import { creditCurrency, currency } from '../raffle-lab/currencies.js';
import * as D from './duel-rules.js';
import type { Rng } from './rules.js';
import type { TwitchUser } from './twitch-login.js';

// Duel V1 (Lab) — the service (docs/DUEL_PARITY.md § 6). Two viewers, identified by their Twitch User ID. A
// challenge stores both IDs, the stake and the result fixed at creation (never drawn again). The acceptance is ONE
// transaction: challenge row lock, both wallets locked in ID order, balances and cap checked, loser debited and
// winner credited (two ledger rows, sum zero), LeCroupier_ answer. Deny, cancel and expiry never touch a wallet.

export type DuelOutcome =
  | 'ignored'
  | 'duel_challenged'
  | 'duel_resolved'
  | 'duel_denied'
  | 'duel_cancelled'
  | 'duel_refused';

/** The typed login → the Twitch account (exact), or null: refused, nothing moves. */
export type TargetResolver = (
  login: string,
  msg: LabChatMessage,
) => Promise<TwitchUser | null>;

interface DuelRow {
  duel_id: string;
  challenger_id: string;
  challenger_name: string;
  target_id: string;
  target_name: string;
  bet: string | number;
  challenger_wins: boolean;
}

export class DuelService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly rng: Rng,
    private readonly resolveTarget: TargetResolver,
  ) {}

  async chat(
    msg: LabChatMessage,
    cmd: D.DuelCommand,
  ): Promise<{ outcome: DuelOutcome; replayed?: boolean }> {
    if (cmd.kind === 'challenge') return this.challenge(msg, cmd);
    return this.db.tx(async (q) => {
      const now = this.clock.now();
      await this.expire(q, msg.channel_id, now);
      // A resent accept / deny / cancel: the challenge it ended stays ended, nothing more.
      const ended = await q.query(
        'select 1 from mini_game_duels where channel_id = $1 and end_message_id = $2',
        [msg.channel_id, msg.message_id],
      );
      if (ended.length) return { outcome: 'ignored' as const, replayed: true };
      const who = cmd.kind === 'cancel' ? 'challenger_id' : 'target_id';
      const duel = (
        await q.query<DuelRow>(
          `select duel_id, challenger_id, challenger_name, target_id, target_name, bet, challenger_wins
           from mini_game_duels where channel_id = $1 and ${who} = $2 and status = 'pending' for update`,
          [msg.channel_id, msg.chatter.id],
        )
      )[0];
      if (!duel) return { outcome: 'ignored' as const };
      if (cmd.kind === 'accept') return this.accept(q, msg, duel, now);
      const status = cmd.kind === 'deny' ? 'denied' : 'cancelled';
      await this.end(q, duel.duel_id, status, msg.message_id, now);
      await this.say(
        q,
        msg.channel_id,
        now,
        `mg:duel:${duel.duel_id}:end`,
        cmd.kind === 'deny' ? 'denied' : 'cancelled',
        {
          target: duel.target_name,
          challenger: duel.challenger_name,
        },
      );
      return {
        outcome:
          cmd.kind === 'deny'
            ? ('duel_denied' as const)
            : ('duel_cancelled' as const),
      };
    });
  }

  /** `!duel <login> [bet]`: resolves the target (outside the transaction), then creates the challenge. */
  private async challenge(
    msg: LabChatMessage,
    cmd: Extract<D.DuelCommand, { kind: 'challenge' }>,
  ): Promise<{ outcome: DuelOutcome; replayed?: boolean }> {
    const login = cmd.target;
    if (!login) return { outcome: 'ignored' };
    const user = msg.chatter.display_name;
    let target: TwitchUser | null = null;
    if (login !== msg.chatter.login.toLowerCase())
      try {
        target = await this.resolveTarget(login, msg);
      } catch {
        target = null; // Twitch could not be asked: uncertain → refused
      }
    return this.db.tx(async (q) => {
      const now = this.clock.now();
      const replay = await q.query(
        'select 1 from mini_game_duels where channel_id = $1 and challenge_message_id = $2',
        [msg.channel_id, msg.message_id],
      );
      if (replay.length)
        return { outcome: 'duel_challenged' as const, replayed: true };
      const refuse = async (
        key: keyof typeof D.DUEL_TEXTS,
        vars: Record<string, string> = {},
      ) => {
        await this.say(
          q,
          msg.channel_id,
          now,
          `mg:msg:${msg.message_id}:refusal`,
          key,
          { user, ...vars },
        );
        return { outcome: 'duel_refused' as const };
      };
      // Self: the same login typed, or the same Twitch account behind another login.
      if (
        login === msg.chatter.login.toLowerCase() ||
        target?.id === msg.chatter.id
      )
        return refuse('self');
      if (!target) return refuse('unknown_target', { target: login });
      await this.expire(q, msg.channel_id, now);
      const recent = await q.query(
        `select 1 from mini_game_duels where channel_id = $1 and status = 'resolved' and ended_at > $3
           and (challenger_id = $2 or target_id = $2) limit 1`,
        [
          msg.channel_id,
          msg.chatter.id,
          new Date(now.getTime() - D.DUEL_RULES.cooldownMs),
        ],
      );
      if (recent.length) return { outcome: 'ignored' as const }; // cooldown: silent
      const wallet = await lockWallet(q, msg.channel_id, msg.chatter.id, now);
      const busy = await q.query<{ challenger_id: string }>(
        `select challenger_id from mini_game_duels where channel_id = $1 and status = 'pending'
           and (challenger_id = $2 or target_id = $3)`,
        [msg.channel_id, msg.chatter.id, target.id],
      );
      if (busy.some((b) => b.challenger_id === msg.chatter.id))
        return refuse('pending');
      if (busy.length)
        return refuse('target_busy', { target: target.display_name });
      const bet = D.resolveDuelBet(cmd.arg, wallet.tokens);
      if ('refused' in bet)
        return bet.refused === 'insufficient'
          ? refuse('insufficient')
          : { outcome: 'ignored' as const };
      const duelId = randomUUID();
      // Unique indexes (one pending per challenger / per target) settle a race with another challenge.
      const created = await q.query(
        `insert into mini_game_duels (duel_id, channel_id, challenge_message_id, challenger_id, challenger_name,
           target_id, target_login, target_name, bet, challenger_wins, status, created_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, $12)
         on conflict do nothing returning duel_id`,
        [
          duelId,
          msg.channel_id,
          msg.message_id,
          msg.chatter.id,
          user,
          target.id,
          target.login.toLowerCase(),
          target.display_name,
          bet.amount,
          this.rng() < 0.5,
          now,
          new Date(now.getTime() + D.DUEL_RULES.expiresMs),
        ],
      );
      if (!created.length)
        return refuse('target_busy', { target: target.display_name });
      await this.say(
        q,
        msg.channel_id,
        now,
        `mg:duel:${duelId}:invite`,
        bet.amount ? 'challenge_bet' : 'challenge_free',
        {
          target: target.display_name,
          challenger: user,
          points: String(bet.amount),
        },
      );
      return { outcome: 'duel_challenged' as const };
    });
  }

  /** The target accepts: one transaction, all or nothing (§ 6). */
  private async accept(
    q: Queryable,
    msg: LabChatMessage,
    duel: DuelRow,
    now: Date,
  ) {
    const bet = Number(duel.bet);
    const [winnerId, loserId] = duel.challenger_wins
      ? [duel.challenger_id, duel.target_id]
      : [duel.target_id, duel.challenger_id];
    const names: Record<string, string> = {
      [duel.challenger_id]: duel.challenger_name,
      [duel.target_id]: duel.target_name,
    };
    if (bet > 0) {
      // Both wallets locked in a stable order (by Twitch ID): two duels never wait on each other.
      const balances: Record<string, number> = {};
      for (const id of [duel.challenger_id, duel.target_id].sort())
        balances[id] = (await lockWallet(q, msg.channel_id, id, now)).tokens;
      const short = [duel.challenger_id, duel.target_id].find(
        (id) => balances[id]! < bet,
      );
      const cap = (await currency(q, 'tokens'))?.max_balance ?? Infinity;
      const overCap = [duel.challenger_id, duel.target_id].some(
        (id) => balances[id]! + bet > cap,
      );
      if (short || overCap) {
        await this.end(q, duel.duel_id, 'refused', msg.message_id, now);
        if (short)
          await this.say(
            q,
            msg.channel_id,
            now,
            `mg:duel:${duel.duel_id}:end`,
            'insufficient_at_accept',
            {
              user: names[short]!,
              points: String(bet),
            },
          );
        return { outcome: 'duel_refused' as const };
      }
      await q.query(
        'update lab_wallets set tokens = $3, updated_at = $4 where channel_id = $1 and viewer_id = $2',
        [msg.channel_id, loserId, balances[loserId]! - bet, now],
      );
      await creditCurrency(q, now, {
        channelId: msg.channel_id,
        viewerId: winnerId,
        currencyId: 'tokens',
        amount: bet,
      });
      for (const [viewer, amount, side] of [
        [loserId, -bet, 'loser'],
        [winnerId, bet, 'winner'],
      ] as const)
        await q.query(
          `insert into lab_wallet_ledger (channel_id, viewer_id, kind, currency, amount, module_id, actor, reason, created_at)
           values ($1, $2, 'mini_game', 'tokens', $3, null, 'system', $4, $5)`,
          [
            msg.channel_id,
            viewer,
            amount,
            `mg:duel:${duel.duel_id}:${side}`,
            now,
          ],
        );
    }
    await q.query(
      `update mini_game_duels set status = 'resolved', ended_at = $2, end_message_id = $3, winner_id = $4, loser_id = $5
       where duel_id = $1`,
      [duel.duel_id, now, msg.message_id, winnerId, loserId],
    );
    await this.say(
      q,
      msg.channel_id,
      now,
      `mg:duel:${duel.duel_id}:result`,
      bet > 0 ? 'points_won' : 'win',
      {
        winner: names[winnerId]!,
        loser: names[loserId]!,
        points: String(bet),
      },
    );
    return { outcome: 'duel_resolved' as const };
  }

  /** Pending challenges past their 2 minutes: expired, silently, nothing moves. */
  private async expire(q: Queryable, channelId: string, now: Date) {
    await q.query(
      `update mini_game_duels set status = 'expired', ended_at = expires_at
       where channel_id = $1 and status = 'pending' and expires_at <= $2`,
      [channelId, now],
    );
  }

  private async end(
    q: Queryable,
    duelId: string,
    status: string,
    messageId: string,
    now: Date,
  ) {
    await q.query(
      'update mini_game_duels set status = $2, ended_at = $3, end_message_id = $4 where duel_id = $1',
      [duelId, status, now, messageId],
    );
  }

  private say(
    q: Queryable,
    channelId: string,
    now: Date,
    key: string,
    text: keyof typeof D.DUEL_TEXTS,
    vars: Record<string, string>,
  ) {
    return insertWordGameSteps(q, {
      channelId,
      now,
      origin: 'mini_game',
      drafts: [
        { idempotencyKey: key, mode: 'normal', text: D.duelText(text, vars) },
      ],
    });
  }
}
