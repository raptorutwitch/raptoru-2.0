import type {
  LabChatMessage,
  WalletChatAdminRequest,
  WalletChatResponse,
} from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db } from '../db/db.js';
import { chatRole, type BroadcasterOf } from '../lab-chat/broadcaster.js';
import type { LoginLookup } from '../mini-games/twitch-login.js';
import { LabForbiddenError, LabWalletError } from '../lab-moderation/store.js';
import type {
  LabModerationError,
  LabModerationService,
} from '../lab-moderation/service.js';

// Portefeuille in the chat (post-live 11/11, docs/RAPPORT_POST_LIVE.md): the moderators' Jetons commands lost with the
// StreamElements migration, back in the canonical economy.
//   !addpoints @pseudo montant [motif]      alias !crediter
//   !removepoints @pseudo montant [motif]   alias !debiter
// Nothing of its own: the command is ONE call to the moderation's `wallet_adjust` — the action the extension's
// « Portefeuille » sends — so both apply exactly the same rules:
// - permission « Portefeuille » (D4 `wallet.admin`: the broadcaster, the supermods, the moderators granted it), decided
//   by Core from the Twitch role the bot read in the badges — never from the text;
// - the target is the Twitch account of that EXACT login (Helix « Get Users »; else a single known viewer): never an
//   approximation, never the author by default; unknown or ambiguous → nothing done;
// - an integer amount of 1 to 1 000 000 Jetons per command; a removal never goes below 0 (the economy takes at most
//   what is there and says how much);
// - once per Twitch message (the message id is the idempotency key: a redelivered message changes nothing);
// - audited (actor, role, reason, before / after, ledger line), like every moderation action.
// « broadcaster » is granted by identity only (lab-chat/broadcaster.ts), never by a badge; a moderator's badge alone gives
// nothing here: Core then reads the team (lab_staff: supermod, or the « Portefeuille » grant).
// The historical `!wallet add|remove|set` (bot → /v1/bot/wallet/admin) comes here too (`legacy`): add / remove are the
// same `wallet_adjust`; `set` stays the Wallet's atomic set, for the broadcaster only (wallet/chat.ts).

export { ADMIN_WALLET_WORDS } from '../commands/reserved.js';
const ADD = new Set(['!addpoints', '!crediter']);
const REMOVE = new Set(['!removepoints', '!debiter']);
const LOGIN = /^@?([a-z0-9_]{3,25})$/i;
/** Per command: a typo of a few zeros never moves a fortune (the extension's dialog allows more, explicitly). */
export const CHAT_ADJUST_MAX = 1_000_000;

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/\s/g, ' ');

export type AdminWalletCommand =
  | {
      kind: 'adjust';
      sign: 1 | -1;
      login: string;
      amount: number;
      reason?: string;
    }
  | { kind: 'usage'; sign: 1 | -1 }
  | { kind: 'too_much'; sign: 1 | -1 };

/** `!addpoints @Pseudo 500 motif…` or `!addpoints 500 @Pseudo motif…`; anything else is a usage reply. */
export function parseAdminWallet(text: string): AdminWalletCommand | null {
  const [head, ...args] = text.trim().split(/\s+/);
  const word = (head ?? '').toLowerCase();
  const sign = ADD.has(word) ? 1 : REMOVE.has(word) ? -1 : 0;
  if (!sign) return null;
  const [a, b] = args;
  const pair =
    a && b && LOGIN.test(a) && /^\d+$/.test(b)
      ? { login: a, amount: b }
      : a && b && /^\d+$/.test(a) && LOGIN.test(b)
        ? { login: b, amount: a }
        : null;
  if (!pair) return { kind: 'usage', sign };
  const amount = Number(pair.amount);
  if (amount < 1) return { kind: 'usage', sign };
  // Digits only (checked above): any huge number is « too much », never a usage error.
  if (amount > CHAT_ADJUST_MAX) return { kind: 'too_much', sign };
  const reason = args.slice(2).join(' ').trim().slice(0, 180);
  return {
    kind: 'adjust',
    sign,
    login: LOGIN.exec(pair.login)![1]!.toLowerCase(),
    amount,
    ...(reason ? { reason } : {}),
  };
}

const usage = (sign: 1 | -1) =>
  sign > 0
    ? 'usage : !addpoints @pseudo montant [motif]'
    : 'usage : !removepoints @pseudo montant [motif]';

export class WalletAdminChat {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly moderation: Pick<LabModerationService, 'act'>,
    /** Exact login → Twitch account (Helix). Null: only a single viewer already known by that login. */
    private readonly lookup: LoginLookup | null,
    /** The channel's real Twitch broadcaster (absent: the channel id itself, like every chat module). */
    private readonly broadcasterOf?: BroadcasterOf,
  ) {}

  /** The streamer of this channel, by identity. */
  isBroadcaster(channelId: string, userId: string): boolean {
    return (this.broadcasterOf?.(channelId) ?? channelId) === userId;
  }

  /**
   * `!wallet add|remove @x N [motif]` (historical syntax, bot → /v1/bot/wallet/admin): the target was resolved by the bot
   * (real @mention or exact Helix login). The route carries no badge: the broadcaster by identity, anyone else is read
   * from the team (supermod, or a moderator granted « Portefeuille ») — removing someone from the team revokes it.
   */
  async legacy(
    channelId: string,
    req: WalletChatAdminRequest,
  ): Promise<WalletChatResponse> {
    const say = (body: string) => ({
      message: `@${req.actor.displayName} - ${body}`,
      result: null,
    });
    if (req.op === 'set' || req.amount < 1)
      return say('usage : !wallet add|remove @pseudo montant [motif]');
    if (req.amount > CHAT_ADJUST_MAX)
      return say(
        `${fmt(CHAT_ADJUST_MAX)} Jetons au plus par commande · rien n’a été fait.`,
      );
    const out = await this.apply(
      channelId,
      {
        id: req.actor.twitchUserId,
        login: req.actor.login,
        display_name: req.actor.displayName,
        role: this.isBroadcaster(channelId, req.actor.twitchUserId)
          ? 'broadcaster'
          : 'moderator',
      },
      {
        id: req.target.twitchUserId,
        login: req.target.login,
        name: req.target.displayName,
      },
      req.op === 'add' ? 1 : -1,
      req.amount,
      req.reason,
      `chat-wallet:${req.requestId}`,
    );
    return say(out.text);
  }

  async chat(
    msg: LabChatMessage,
  ): Promise<{ outcome: string; replayed?: boolean }> {
    const cmd = parseAdminWallet(msg.text);
    if (!cmd) return { outcome: 'ignored' };
    const author = msg.chatter;
    const reply = async (outcome: string, body: string) => {
      await this.db.tx((q) =>
        insertWordGameSteps(q, {
          channelId: msg.channel_id,
          now: this.clock.now(),
          // ponytail: the chat modules' generic origin (a 'wallet' origin in cmd_steps would be a migration).
          origin: 'mini_game',
          drafts: [
            {
              idempotencyKey: `wallet-admin:${msg.message_id}`,
              mode: 'normal',
              text: `@${author.display_name} - ${body}`,
            },
          ],
        }),
      );
      return { outcome };
    };
    // The streamer by identity only; a claimed « broadcaster » that is not him is a viewer (lab-chat/broadcaster.ts).
    const role = chatRole(
      msg.channel_id,
      author,
      this.broadcasterOf,
      msg.source === 'simulator' ? 'simulator' : 'twitch',
    );
    // A viewer never gets this far: refused without asking Twitch anything (Core re-checks the permission anyway).
    if (role === 'viewer')
      return reply(
        'wallet_forbidden',
        'commande réservée à l’équipe de modération.',
      );
    if (cmd.kind === 'usage') return reply('wallet_usage', usage(cmd.sign));
    if (cmd.kind === 'too_much')
      return reply(
        'wallet_too_much',
        `${fmt(CHAT_ADJUST_MAX)} Jetons au plus par commande · rien n’a été fait.`,
      );

    let target: Awaited<ReturnType<WalletAdminChat['resolve']>>;
    try {
      target = await this.resolve(cmd.login);
    } catch {
      return reply(
        'wallet_lookup_failed',
        `Twitch ne répond pas : « ${cmd.login} » non vérifié · rien n’a été fait.`,
      );
    }
    if (!target)
      return reply(
        'wallet_unknown',
        `viewer « ${cmd.login} » introuvable · rien n’a été fait.`,
      );
    if (target === AMBIGUOUS)
      return reply(
        'wallet_ambiguous',
        `plusieurs comptes connus pour « ${cmd.login} » · rien n’a été fait.`,
      );
    const out = await this.apply(
      msg.channel_id,
      { ...author, role },
      { ...target, login: cmd.login },
      cmd.sign,
      cmd.amount,
      cmd.reason,
      `chat:${msg.message_id}`,
    );
    return reply(out.outcome, out.text);
  }

  /** The one adjustment of both syntaxes: the moderation's `wallet_adjust`, its rules, its audit, its key. */
  private async apply(
    channelId: string,
    actor: {
      id: string;
      login: string;
      display_name: string;
      role: 'broadcaster' | 'moderator' | 'viewer';
    },
    target: { id: string; login: string; name: string },
    sign: 1 | -1,
    amount: number,
    reason: string | undefined,
    key: string,
  ): Promise<{ outcome: string; text: string }> {
    // A viewer never seen by the Wallet gets his real name in the directory (else the Wallet would file him under his
    // numeric id). Never overwrites a known row.
    await this.db
      .query(
        `insert into viewers (twitch_user_id, login, display_name) values ($1, $2, $3)
         on conflict (twitch_user_id) do nothing`,
        [target.id, target.login, target.name],
      )
      .catch(() => undefined);
    try {
      const out = (await this.moderation.act(channelId, {
        actor: { ...actor, via: 'chat' },
        command: {
          action: 'wallet_adjust',
          viewer_id: target.id,
          currency: 'tokens',
          delta: sign * amount,
          reason: reason ?? 'commande chat',
        },
        idempotency_key: key,
      })) as { applied: number; wallet?: { tokens?: number } | null };
      const applied = Math.abs(Number(out.applied));
      const balance = Number(out.wallet?.tokens ?? NaN);
      const after = Number.isFinite(balance)
        ? ` (solde : ${fmt(balance)})`
        : '';
      const partial = applied < amount ? ` sur ${fmt(amount)} demandés` : '';
      return sign > 0
        ? {
            outcome: 'wallet_credited',
            text: `${fmt(applied)} Jetons crédités à @${target.name}${partial}${after}.`,
          }
        : {
            outcome: 'wallet_debited',
            text: `${fmt(applied)} Jetons retirés à @${target.name}${partial}${after}.`,
          };
    } catch (e) {
      if (e instanceof LabForbiddenError)
        return {
          outcome: 'wallet_forbidden',
          text: 'permission « Portefeuille » requise.',
        };
      const code = (e as Partial<LabModerationError>).code;
      if (code === 'self_adjust_forbidden')
        return {
          outcome: 'wallet_self',
          text: 'impossible de modifier ton propre portefeuille.',
        };
      if (code === 'nothing_to_debit')
        return {
          outcome: 'wallet_nothing',
          text: `le solde de @${target.name} est déjà à 0 · rien n’a été retiré.`,
        };
      if (code === 'wallet_full')
        return {
          outcome: 'wallet_full',
          text: `le solde de @${target.name} est au maximum · rien n’a été crédité.`,
        };
      if (e instanceof LabWalletError)
        return {
          outcome: 'wallet_unavailable',
          text: 'Portefeuille momentanément indisponible · rien n’a été fait.',
        };
      throw e;
    }
  }

  /** The account of this exact login: Twitch first; else a single viewer already known by it. */
  async resolve(
    login: string,
  ): Promise<{ id: string; name: string } | typeof AMBIGUOUS | null> {
    if (this.lookup) {
      const u = await this.lookup(login);
      return u ? { id: u.id, name: u.display_name || u.login } : null;
    }
    const rows = await this.db
      .query<{ id: string; name: string }>(
        `select twitch_user_id as id, coalesce(display_name, login) as name from viewers where lower(login) = $1`,
        [login],
      )
      .catch(() => [] as { id: string; name: string }[]);
    if (rows.length > 1) return AMBIGUOUS;
    return rows[0] ?? null;
  }
}

const AMBIGUOUS = Symbol('ambiguous');
