import type { LabChatMessage } from '@raptoru/schemas';
import { liveForPaid, STREAM_OFFLINE } from '../stream/live-gate.js';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import {
  assertNotGloballyPaused,
  GlobalPauseError,
  LabWalletError,
} from '../lab-moderation/store.js';
import {
  refusalText,
  sayRefusal,
  type RbRefusal,
} from '../random-ban/refusal.js';
import { RbError, type RandomBanService } from '../random-ban/service.js';

// `!rb` in the chat (docs/CHAT_COMMANDS.md): a SECOND way to pay the same Random Ban as the channel points reward —
// the same request, executor, target search, immunities, timeout, animation and result (random-ban/service.ts), paid in
// Jetons by the chat author:
// - refused BEFORE any debit when Raptoru is paused or the Twitch executor is not there (no request, nothing paid);
// - the request (source « chat », reference = the Twitch message id) and the debit are ONE transaction: a refused
//   debit (balance) leaves no request; the same message delivered again finds its request and pays nothing;
// - « en file » is all the chat is told at purchase: never a success before the executor's result;
// - refunded in Jetons, once, when the request ends without anything done (refund « needed »: executor absent or
//   lost, missing scope, Twitch refusal); an « uncertain » one (the timeout may have happened) is never refunded
//   automatically — it stays « à vérifier » like the channel points one.
// V5 (13/11/2026): a fixed price (Studio's « Prix de Random Ban », shared with the extension) and the buyer's personal
// charges, shared with the extension and the channel points (random-ban/pricing.ts). Refusals: one short line, at most
// one per viewer every 5 minutes (random-ban/refusal.ts); nothing is ever debited by a refused `!rb`.

const COMMAND = /^!rb$/i;

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/\s/g, ' ');

export class RandomBanChat {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly randomBan: RandomBanService,
    private readonly economy: EconomyPort,
  ) {
    randomBan.onResult((channelId) => this.settle(channelId));
  }

  async chat(
    msg: LabChatMessage,
  ): Promise<{ outcome: string; replayed?: boolean }> {
    // `!rb` alone: `!rb salut`, `Salut !rb`… are not commands (nothing paid, no answer).
    if (!COMMAND.test(msg.text.trim())) return { outcome: 'ignored' };
    const name = msg.chatter.display_name;
    const refuse = (body: string) =>
      this.db.tx((q) =>
        sayRefusal(q, {
          channelId: msg.channel_id,
          viewerId: msg.chatter.id,
          ref: msg.message_id,
          text: `@${name} - ${body[0]!.toUpperCase()}${body.slice(1)} · rien n’a été débité.`,
          now: this.clock.now(),
        }),
      );
    if (!(await liveForPaid(this.db, this.economy))) {
      await refuse('Random Ban disponible uniquement pendant le live');
      return { outcome: STREAM_OFFLINE };
    }
    if (!this.randomBan.executorReady(msg.channel_id)) {
      await refuse('Random Ban indisponible pour le moment');
      return { outcome: 'rb_unavailable' };
    }
    try {
      const out = await this.db.tx(async (q) => {
        await assertNotGloballyPaused(q, msg.channel_id);
        const { created } = await this.randomBan.buy(q, this.economy, {
          channel_id: msg.channel_id,
          source: 'chat',
          source_ref: msg.message_id,
          // The Studio simulator never times anyone out (the real search only), like a channel points test.
          mode: msg.source === 'simulator' ? 'dry_run' : 'real',
          buyer: {
            id: msg.chatter.id,
            login: msg.chatter.login,
            name,
          },
          // The fixed price (Studio's « Prix de Random Ban »): the chat never shows another one.
          ceiling: 'any',
        });
        if (!created) return { replayed: true };
        // No success message: the Random Ban itself (its animation, the timeout) is the answer.
        return { replayed: false };
      });
      return out.replayed
        ? { outcome: 'rb_replayed', replayed: true }
        : { outcome: 'rb_queued', replayed: false };
    } catch (e) {
      if (
        e instanceof RbError &&
        [
          'no_charge',
          'viewer_cooldown',
          'viewer_blocked',
          'rb_paused',
          'rb_busy',
        ].includes(e.code)
      ) {
        await refuse(
          refusalText(e.code as RbRefusal, Number(e.details.wait_ms ?? 0)),
        );
        return { outcome: 'rb_refused' };
      }
      if (e instanceof RbError && e.code === 'too_many_pending') {
        await refuse(`déjà ${e.details.max_pending} Random Ban en attente`);
        return { outcome: 'rb_refused' };
      }
      if (e instanceof LabWalletError && e.code === 'insufficient_tokens') {
        const needed = Number(e.details.needed);
        const balance = Number(e.details.balance ?? 0);
        await refuse(
          `il te faut ${fmt(needed)} Jetons (solde : ${fmt(balance)})`,
        );
        return { outcome: 'rb_refused' };
      }
      if (e instanceof GlobalPauseError) {
        await refuse('Raptoru en pause');
        return { outcome: 'rb_refused' };
      }
      if (e instanceof LabWalletError) {
        await refuse('portefeuille momentanément indisponible');
        return { outcome: 'rb_refused' };
      }
      throw e;
    }
  }

  /**
   * Every chat Random Ban that ended with nothing done gets its Jetons back, once (the refund is keyed by the request;
   * the request then owes nothing), with one chat message. Called after each executor result and each sweep.
   */
  async settle(channelId: string) {
    const owed = await this.db.query<{
      request_id: string;
      buyer_name: string;
      error: string | null;
      status: string;
    }>(
      `select request_id, buyer_name, error, status from rb_requests
       where channel_id = $1 and source in ('chat', 'extension') and refund = 'needed' order by seq limit 50`,
      [channelId],
    );
    for (const r of owed)
      await this.db.tx(async (q) => {
        const locked = await q.query(
          `select 1 from rb_requests where request_id = $1 and refund = 'needed' for update`,
          [r.request_id],
        );
        if (!locked.length) return; // settled meanwhile by another call
        const back = await this.economy.refund(
          q,
          this.clock.now(),
          r.request_id,
          'random_ban',
          `Random Ban sans effet (${r.error ?? 'échec'})`.slice(0, 200),
        );
        await this.randomBan.markRefunded(q, r.request_id);
        if (back.amount > 0)
          await this.say(
            q,
            channelId,
            `rb:refund:${r.request_id}`,
            r.status === 'canceled'
              ? `@${r.buyer_name} - Random Ban annulé par la modération · ${fmt(back.amount)} Jetons remboursés.`
              : `@${r.buyer_name} - Random Ban impossible pour le moment · ${fmt(back.amount)} Jetons remboursés.`,
          );
      });
  }

  /**
   * Audit 09/11 (P2): what is still owed on every channel, from the 15 s sweep. settle() above runs after an executor
   * result only: a Core restart (or a failed settle) between the request's end and its refund left the Jetons owed until
   * some other Random Ban ended. Idempotent (row lock + keyed refund): a second pass moves nothing.
   */
  async settleAll() {
    const channels = await this.db.query<{ channel_id: string }>(
      `select distinct channel_id from rb_requests where source in ('chat', 'extension') and refund = 'needed'`,
    );
    for (const c of channels) await this.settle(c.channel_id);
  }

  /** One chat message per key (a replayed event or a second settle writes nothing new). */
  private say(q: Queryable, channelId: string, key: string, text: string) {
    return insertWordGameSteps(q, {
      channelId,
      now: this.clock.now(),
      // ponytail: no 'random_ban' origin in cmd_steps yet (a migration): the chat modules' generic one.
      origin: 'mini_game',
      drafts: [{ idempotencyKey: key, mode: 'normal', text }],
    });
  }
}
