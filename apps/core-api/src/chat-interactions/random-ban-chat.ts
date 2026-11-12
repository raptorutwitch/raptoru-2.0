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
import { waitText, type RbQuote } from '../random-ban/pricing.js';
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
// Progressive price (docs/mini-jeux/SPEC_RANDOM_BAN_V2.md § 2, shared with the extension): a bare `!rb` buys at the
// normal price only; above it, Core answers the buyer's price and nothing is debited, and `!rb <montant>` (« 30000 »,
// « 30 000 », « 30k ») buys at the current price if it is ≤ that amount. The confirmation is the amount itself: no
// state kept between the two messages, never more than the amount typed.

const COMMAND =
  /^!rb(?:\s+(\d{1,3}(?:[ \u00a0\u202f.]\d{3})+|\d+(?:[.,]\d+)?\s?k|\d+))?$/i;

/** « 30000 », « 30 000 », « 30.000 », « 30k », « 7,5k » → Jetons (null: not an amount). */
export function rbAmount(raw: string): number | null {
  const t = raw.toLowerCase().replace(/\s/g, '');
  const n = t.endsWith('k')
    ? Math.round(Number(t.slice(0, -1).replace(',', '.')) * 1000)
    : Number(t.replace(/[.]/g, ''));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

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
    // `!rb` alone or with an amount: `!rb salut`, `Salut !rb`… are not commands (nothing paid, no answer).
    const m = COMMAND.exec(msg.text.trim());
    if (!m) return { outcome: 'ignored' };
    const typed = m[1] ? rbAmount(m[1]) : null;
    if (m[1] && typed === null) return { outcome: 'ignored' };
    const name = msg.chatter.display_name;
    const answer = (key: string, body: string) =>
      this.db.tx((q) => this.say(q, msg.channel_id, key, `@${name} - ${body}`));
    const key = `rb:msg:${msg.message_id}`;
    if (!(await liveForPaid(this.db, this.economy))) {
      await answer(
        key,
        'Random Ban disponible uniquement pendant le live · rien n’a été débité.',
      );
      return { outcome: STREAM_OFFLINE };
    }
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
          // A bare `!rb` agrees to the normal price only (Studio's « Prix de !rb »).
          ceiling: typed ?? 'normal',
        });
        if (!created) return { replayed: true };
        // No success message: the Random Ban itself (its animation, the timeout) is the answer.
        return { replayed: false };
      });
      return out.replayed
        ? { outcome: 'rb_replayed', replayed: true }
        : { outcome: 'rb_queued', replayed: false };
    } catch (e) {
      if (e instanceof RbError && e.code === 'price_changed') {
        const quote = e.details.quote as RbQuote;
        await answer(key, this.priceLine(quote, typed !== null));
        return { outcome: 'rb_quote' };
      }
      if (e instanceof RbError && e.code === 'viewer_blocked') {
        await answer(
          key,
          'Random Ban indisponible pour ton compte · rien n’a été débité.',
        );
        return { outcome: 'rb_refused' };
      }
      if (e instanceof RbError && e.code === 'viewer_cooldown') {
        await answer(
          key,
          `Délai personnel : encore ${waitText(Number(e.details.wait_ms ?? 0))} avant ton prochain Random Ban · rien n’a été débité.`,
        );
        return { outcome: 'rb_refused' };
      }
      if (e instanceof RbError && e.code === 'rb_paused') {
        await answer(
          key,
          'Random Ban en pause pour le moment · rien n’a été débité.',
        );
        return { outcome: 'rb_refused' };
      }
      if (e instanceof RbError && e.code === 'too_many_pending') {
        await answer(
          key,
          `Tu as déjà ${e.details.max_pending} Random Ban en attente · rien n’a été débité.`,
        );
        return { outcome: 'rb_refused' };
      }
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

  /** The buyer's price above the normal one: what to type to confirm it (nothing debited). */
  private priceLine(quote: RbQuote, risen: boolean) {
    const now = Date.parse(quote.server_now);
    const drop =
      quote.next_price !== null && quote.next_drop_at
        ? ` · ${fmt(quote.next_price)} dans ${waitText(Date.parse(quote.next_drop_at) - now)}`
        : '';
    return `${risen ? 'Le prix a changé : ' : ''}Random Ban à ${fmt(quote.price)} Jetons pour toi (série${drop}). Tape !rb ${quote.price} pour confirmer · rien n’a été débité.`;
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
