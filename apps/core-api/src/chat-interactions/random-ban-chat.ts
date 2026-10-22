import type { LabChatMessage } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import {
  assertNotGloballyPaused,
  GlobalPauseError,
  LabWalletError,
} from '../lab-moderation/store.js';
import type { RandomBanService } from '../random-ban/service.js';
import type { ChatPrices } from './prices.js';

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

const COMMAND = /^!rb$/i;

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/\s/g, ' ');

export class RandomBanChat {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly randomBan: RandomBanService,
    private readonly economy: EconomyPort,
    private readonly prices: ChatPrices,
  ) {
    randomBan.onResult((channelId) => this.settle(channelId));
  }

  async chat(
    msg: LabChatMessage,
  ): Promise<{ outcome: string; replayed?: boolean }> {
    // `!rb` alone: `!rb salut`, `Salut !rb`… are not commands (nothing paid, no answer).
    if (!COMMAND.test(msg.text.trim())) return { outcome: 'ignored' };
    const name = msg.chatter.display_name;
    const price = await this.prices.price(msg.channel_id, 'random_ban');
    const answer = (key: string, body: string) =>
      this.db.tx((q) => this.say(q, msg.channel_id, key, `@${name} — ${body}`));
    const key = `rb:msg:${msg.message_id}`;
    if (!this.randomBan.executorReady(msg.channel_id)) {
      await answer(
        key,
        'Random Ban indisponible pour le moment · rien n’a été débité.',
      );
      return { outcome: 'rb_unavailable' };
    }
    try {
      const out = await this.db.tx(async (q) => {
        await assertNotGloballyPaused(q, msg.channel_id);
        const { request, created } = await this.randomBan.requestIfNew(
          {
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
          },
          q,
        );
        if (!created) return { replayed: true };
        await this.economy.debit(q, this.clock.now(), {
          channelId: msg.channel_id,
          viewer: { id: msg.chatter.id, display_name: name },
          currency: 'tokens',
          amount: price,
          module: 'random_ban',
          interactionId: request.request_id,
        });
        await this.say(
          q,
          msg.channel_id,
          key,
          `@${name} — 🎲 Random Ban en file (${fmt(price)} Jetons). Résultat dans un instant.`,
        );
        return { replayed: false };
      });
      return out.replayed
        ? { outcome: 'rb_replayed', replayed: true }
        : { outcome: 'rb_queued', replayed: false };
    } catch (e) {
      if (e instanceof LabWalletError && e.code === 'insufficient_tokens') {
        const needed = Number(e.details.needed);
        const balance = Number(e.details.balance ?? 0);
        await answer(
          key,
          `Il te faut ${fmt(needed)} Jetons pour utiliser Random Ban. Solde : ${fmt(balance)} Jetons (il te manque ${fmt(Math.max(0, needed - balance))}).`,
        );
        return { outcome: 'rb_refused' };
      }
      if (e instanceof GlobalPauseError) {
        await answer(key, 'Raptoru en pause · rien n’a été débité.');
        return { outcome: 'rb_refused' };
      }
      if (e instanceof LabWalletError) {
        await answer(
          key,
          'Portefeuille momentanément indisponible · rien n’a été débité.',
        );
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
    }>(
      `select request_id, buyer_name, error from rb_requests
       where channel_id = $1 and source = 'chat' and refund = 'needed' order by seq limit 50`,
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
          `!rb sans effet (${r.error ?? 'échec'})`.slice(0, 200),
        );
        await this.randomBan.markRefunded(q, r.request_id);
        if (back.amount > 0)
          await this.say(
            q,
            channelId,
            `rb:refund:${r.request_id}`,
            `@${r.buyer_name} — Random Ban impossible pour le moment · ${fmt(back.amount)} Jetons remboursés.`,
          );
      });
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
