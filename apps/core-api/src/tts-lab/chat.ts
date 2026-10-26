import type { LabChatMessage } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db } from '../db/db.js';
import { LabWalletError } from '../lab-moderation/store.js';
import {
  TtsLabError409,
  TtsLabUnavailableError,
  type TtsLabService,
} from './tts-lab-service.js';

// `!tts <message>` in the chat (docs/CHAT_COMMANDS.md): the extension's own TTS purchase (TtsLabService.admit, the
// same tiers, controls, cooldowns, random cast, moderation and refunds), paid by the chat author's Twitch identity,
// once per Twitch message (idempotency key = the message id: a replayed event replays the same TTS, never a 2nd
// debit). `!tts` alone answers the price of the shortest message (free, nothing admitted). Any other form (the
// command inside a sentence, `!ttsx`) is ignored. Answers go to the durable chat queue (cmd_steps).

/** `!tts` then nothing, or a whitespace then the message (kept as typed; a @mention in it is only text). */
const COMMAND = /^!tts(?:\s+([\s\S]*))?$/i;

/** One help answer per viewer at most every 30 s (it is free: no spam through the bot). */
export const TTS_HELP_COOLDOWN_MS = 30_000;

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/\s/g, ' ');

/** Same wording as the extension's TTS refusals (shared/tts-v2.js, TTS_ERRORS). */
const REFUSALS: Record<string, string> = {
  tts_disabled: 'TTS désactivé.',
  tts_paused: 'TTS en pause · rien n’a été débité.',
  message_too_long: 'Message trop long.',
  message_unreadable: 'Rien à lire dans ce message.',
  viewer_blocked: 'TTS indisponible pour ton compte.',
  global_pause: 'Raptoru en pause · rien n’a été débité.',
  message_blocked: 'Mot interdit dans le message · rien n’a été débité.',
  viewer_busy: 'Ton TTS précédent n’est pas encore terminé.',
  queue_full: 'File pleine · réessaie bientôt.',
  studio_offline: 'TTS indisponible pour le moment.',
  player_offline: 'TTS indisponible pour le moment.',
};

const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return s >= 60
    ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
    : `${s} s`;
};

export class TtsChat {
  private readonly helped = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly tts: TtsLabService,
  ) {}

  async chat(
    msg: LabChatMessage,
  ): Promise<{ outcome: string; replayed?: boolean }> {
    const m = COMMAND.exec(msg.text.trim());
    if (!m) return { outcome: 'ignored' };
    const name = msg.chatter.display_name;
    const text = (m[1] ?? '').trim();
    const say = (body: string) => this.reply(msg, `@${name} - ${body}`);

    if (!text) {
      const now = this.clock.now().getTime();
      const last = this.helped.get(msg.chatter.id) ?? 0;
      if (now - last < TTS_HELP_COOLDOWN_MS)
        return { outcome: 'tts_help_throttled' };
      if (this.helped.size > 5000) this.helped.clear();
      this.helped.set(msg.chatter.id, now);
      const { rules } = await this.tts.publicConfig();
      // The price of the shortest message: the first tier, as the extension quotes it.
      const price =
        rules.tiers.find((t) => t.min <= 1 && (t.max === null || t.max >= 1))
          ?.price ?? rules.base_price;
      await say(`Écris ton message après la commande - ${fmt(price)} Jetons`);
      return { outcome: 'tts_help' };
    }

    try {
      const out = await this.tts.admit({
        idempotency_key: `chat:${msg.message_id}`,
        channel_id: msg.channel_id,
        viewer: { id: msg.chatter.id, display_name: name },
        lab_session_id: 'chat',
        text,
        payment_method: 'tokens',
      });
      // No success message when it plays next: the voice is the answer. Said only when it waits (behind other TTS, or
      // held for the moderation's review), so the viewer knows it was not lost.
      const position = out.queue.position ?? 0;
      if (out.interaction.review_status === 'pending')
        await say('TTS en attente de validation.');
      else if (position >= 2) await say(`TTS en file, position ${position}.`);
      return {
        outcome: out.replayed ? 'tts_replayed' : 'tts_queued',
        replayed: out.replayed,
      };
    } catch (e) {
      if (e instanceof LabWalletError && e.code === 'insufficient_tokens') {
        const needed = Number(e.details.needed);
        const balance = Number(e.details.balance ?? 0);
        await say(
          `Il te faut ${fmt(needed)} Jetons pour utiliser TTS. Solde : ${fmt(balance)} Jetons (il te manque ${fmt(Math.max(0, needed - balance))}).`,
        );
        return { outcome: 'tts_refused' };
      }
      if (e instanceof TtsLabError409 || e instanceof TtsLabUnavailableError) {
        const code = e.code;
        const retry =
          e instanceof TtsLabError409 ? Number(e.details.retry_after_ms) : NaN;
        const text =
          code === 'viewer_cooldown' && Number.isFinite(retry)
            ? `Prochain TTS dans ${mmss(retry)} · rien n’a été débité.`
            : code === 'idempotency_conflict'
              ? null
              : (REFUSALS[code] ?? 'TTS indisponible pour le moment.');
        if (text) await say(text);
        return { outcome: 'tts_refused' };
      }
      if (e instanceof LabWalletError) {
        await say(
          'Portefeuille momentanément indisponible · rien n’a été débité.',
        );
        return { outcome: 'tts_refused' };
      }
      throw e;
    }
  }

  /** One answer per Twitch message (a replayed event writes nothing new). */
  private reply(msg: LabChatMessage, text: string) {
    return this.db.tx((q) =>
      insertWordGameSteps(q, {
        channelId: msg.channel_id,
        now: this.clock.now(),
        // ponytail: no 'tts' origin in cmd_steps yet (a migration): the chat modules' generic one; add 'tts' with the
        // next migration if Studio ever needs to tell them apart.
        origin: 'mini_game',
        drafts: [
          { idempotencyKey: `tts:msg:${msg.message_id}`, mode: 'normal', text },
        ],
      }),
    );
  }
}
