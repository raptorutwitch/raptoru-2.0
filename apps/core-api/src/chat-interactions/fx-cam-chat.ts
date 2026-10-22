import {
  FX_CAM,
  type FxCamEffectId,
  type LabChatMessage,
} from '@raptoru/schemas';
import type { ChannelPointsService } from '../channel-points/service.js';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db, Queryable } from '../db/db.js';
import type { EconomyPort } from '../economy/economy.js';
import {
  assertNotGloballyPaused,
  GlobalPauseError,
  LabWalletError,
} from '../lab-moderation/store.js';
import type { ChatPrices } from './prices.js';

// `!fxcam <effet>` in the chat (docs/CHAT_COMMANDS.md): a SECOND way to pay the FX Cam of the channel points reward —
// the same action, Studio job, effects player, expiry and results (channel-points/service.ts), paid in Jetons:
// - only the exact ids of the catalog (FX_CAM.effects, case ignored); `!fxcam` alone or an unknown id: the list, free;
//   any extra word: not a command;
// - refused BEFORE any debit when Studio does not poll its jobs, Raptoru is paused, the channel points automations
//   are OFF or no enabled rule offers FX Cam;
// - the redemption (source « chat »), its job and the debit are ONE transaction; the same Twitch message again pays
//   nothing;
// - « en file » only at purchase; refunded once in Jetons when the action FAILED for sure (Studio absent, refused,
//   not run); never when its outcome is unknown (the effect may have played).

const COMMAND = /^!fxcam(?:\s+(\S+))?$/i;
const EFFECTS: readonly string[] = FX_CAM.effects;
/** One help answer per viewer at most every 30 s (it is free). */
export const FX_CAM_HELP_COOLDOWN_MS = 30_000;

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/\s/g, ' ');

export class FxCamChat {
  private readonly helped = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly channelPoints: ChannelPointsService,
    private readonly economy: EconomyPort,
    private readonly prices: ChatPrices,
  ) {
    channelPoints.onChanged((channelId) => this.settle(channelId));
  }

  async chat(
    msg: LabChatMessage,
  ): Promise<{ outcome: string; replayed?: boolean }> {
    const m = COMMAND.exec(msg.text.trim());
    if (!m) return { outcome: 'ignored' };
    const name = msg.chatter.display_name;
    const price = await this.prices.price(msg.channel_id, 'fx_cam');
    const key = `fx:msg:${msg.message_id}`;
    const answer = (body: string) =>
      this.db.tx((q) => this.say(q, msg.channel_id, key, `@${name} — ${body}`));
    const typed = m[1]?.toLowerCase();
    if (!typed || !EFFECTS.includes(typed)) {
      const now = this.clock.now().getTime();
      if (
        now - (this.helped.get(msg.chatter.id) ?? 0) <
        FX_CAM_HELP_COOLDOWN_MS
      )
        return { outcome: 'fx_help_throttled' };
      if (this.helped.size > 5000) this.helped.clear();
      this.helped.set(msg.chatter.id, now);
      await answer(
        `${typed ? `Effet « ${typed} » inconnu. ` : ''}Effets FX Cam : ${EFFECTS.join(', ')} — ${fmt(price)} Jetons (ex. !fxcam ${EFFECTS[0]}).`,
      );
      return { outcome: 'fx_help' };
    }
    const effect = typed as FxCamEffectId;
    const unavailable = () =>
      answer('FX Cam indisponible pour le moment · rien n’a été débité.');
    if (!this.channelPoints.studioReady(msg.channel_id)) {
      await unavailable();
      return { outcome: 'fx_unavailable' };
    }
    try {
      const out = await this.db.tx(async (q) => {
        await assertNotGloballyPaused(q, msg.channel_id);
        const admitted = await this.channelPoints.admitChatFxCam(q, {
          channel_id: msg.channel_id,
          message_id: msg.message_id,
          user: {
            id: msg.chatter.id,
            login: msg.chatter.login,
            display_name: name,
          },
          effect,
        });
        if (admitted.refused) return 'unavailable' as const;
        if (!admitted.created) return 'replayed' as const;
        await this.economy.debit(q, this.clock.now(), {
          channelId: msg.channel_id,
          viewer: { id: msg.chatter.id, display_name: name },
          currency: 'tokens',
          amount: price,
          module: 'fx_cam',
          interactionId: admitted.jobId,
        });
        await this.say(
          q,
          msg.channel_id,
          key,
          `@${name} — 📸 FX Cam « ${effect} » en file (${fmt(price)} Jetons).`,
        );
        return 'queued' as const;
      });
      if (out === 'unavailable') {
        await unavailable();
        return { outcome: 'fx_unavailable' };
      }
      return out === 'replayed'
        ? { outcome: 'fx_replayed', replayed: true }
        : { outcome: 'fx_queued', replayed: false };
    } catch (e) {
      if (e instanceof LabWalletError && e.code === 'insufficient_tokens') {
        const needed = Number(e.details.needed);
        const balance = Number(e.details.balance ?? 0);
        await answer(
          `Il te faut ${fmt(needed)} Jetons pour utiliser FX Cam. Solde : ${fmt(balance)} Jetons (il te manque ${fmt(Math.max(0, needed - balance))}).`,
        );
        return { outcome: 'fx_refused' };
      }
      if (e instanceof GlobalPauseError) {
        await answer('Raptoru en pause · rien n’a été débité.');
        return { outcome: 'fx_refused' };
      }
      if (e instanceof LabWalletError) {
        await answer(
          'Portefeuille momentanément indisponible · rien n’a été débité.',
        );
        return { outcome: 'fx_refused' };
      }
      throw e;
    }
  }

  /**
   * Chat FX Cam purchases whose action ended: FAILED for sure → the Jetons back once (keyed by the job), with one chat
   * message; UNKNOWN (may have played) → never refunded, marked « à vérifier ». The redemption's `reason` records the
   * decision, so it is taken once.
   */
  async settle(channelId: string) {
    const ended = await this.db.query<{
      redemption_id: string;
      job_id: string;
      user_name: string;
    }>(
      `select redemption_id, job_id, user_name from cp_redemptions
       where channel_id = $1 and source = 'chat' and status = 'failed' and reason is null
       order by received_at limit 50`,
      [channelId],
    );
    for (const r of ended)
      await this.db.tx(async (q) => {
        const row = (
          await q.query<{ results: { status: string; error?: string }[] }>(
            `select results from cp_redemptions where channel_id = $1 and source = 'chat' and redemption_id = $2
               and status = 'failed' and reason is null for update`,
            [channelId, r.redemption_id],
          )
        )[0];
        if (!row) return; // decided meanwhile by another call
        const certain = row.results.every((x) => x.status === 'failed');
        if (!certain) {
          await this.mark(q, channelId, r.redemption_id, 'jetons_to_verify');
          return;
        }
        const back = await this.economy.refund(
          q,
          this.clock.now(),
          r.job_id,
          'fx_cam',
          `!fxcam sans effet (${row.results[0]?.error ?? 'échec'})`.slice(
            0,
            200,
          ),
        );
        await this.mark(q, channelId, r.redemption_id, 'jetons_refunded');
        if (back.amount > 0)
          await this.say(
            q,
            channelId,
            `fx:refund:${r.job_id}`,
            `@${r.user_name} — FX Cam impossible pour le moment · ${fmt(back.amount)} Jetons remboursés.`,
          );
      });
  }

  private mark(q: Queryable, channelId: string, id: string, reason: string) {
    return q.query(
      `update cp_redemptions set reason = $3 where channel_id = $1 and source = 'chat' and redemption_id = $2`,
      [channelId, id, reason],
    );
  }

  /** One chat message per key (a replayed event or a second settle writes nothing new). */
  private say(q: Queryable, channelId: string, key: string, text: string) {
    return insertWordGameSteps(q, {
      channelId,
      now: this.clock.now(),
      // ponytail: no 'fx_cam' origin in cmd_steps yet (a migration): the chat modules' generic one.
      origin: 'mini_game',
      drafts: [{ idempotencyKey: key, mode: 'normal', text }],
    });
  }
}
