import type { LabChatMessage } from '@raptoru/schemas';
import type { Clock } from '../clock.js';
import { insertWordGameSteps } from '../commands/steps.js';
import type { Db } from '../db/db.js';
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
// The previous `!wallet add|remove|set` (bot, `staff_roles`) is unchanged — see the commands inventory.

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
  ) {}

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
    // A viewer never gets this far: refused without asking Twitch anything (Core re-checks the permission anyway).
    if (author.role === 'viewer')
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

    try {
      const out = (await this.moderation.act(msg.channel_id, {
        actor: {
          id: author.id,
          login: author.login,
          display_name: author.display_name,
          role: author.role,
          via: 'chat',
        },
        command: {
          action: 'wallet_adjust',
          viewer_id: target.id,
          currency: 'tokens',
          delta: cmd.sign * cmd.amount,
          reason: cmd.reason ?? 'commande chat',
        },
        idempotency_key: `chat:${msg.message_id}`,
      })) as { applied: number; wallet?: { tokens?: number } | null };
      const applied = Math.abs(Number(out.applied));
      const balance = Number(out.wallet?.tokens ?? NaN);
      const after = Number.isFinite(balance)
        ? ` (solde : ${fmt(balance)})`
        : '';
      const partial =
        applied < cmd.amount ? ` sur ${fmt(cmd.amount)} demandés` : '';
      return reply(
        cmd.sign > 0 ? 'wallet_credited' : 'wallet_debited',
        cmd.sign > 0
          ? `${fmt(applied)} Jetons crédités à @${target.name}${partial}${after}.`
          : `${fmt(applied)} Jetons retirés à @${target.name}${partial}${after}.`,
      );
    } catch (e) {
      if (e instanceof LabForbiddenError)
        return reply(
          'wallet_forbidden',
          'permission « Portefeuille » requise.',
        );
      const code = (e as Partial<LabModerationError>).code;
      if (code === 'self_adjust_forbidden')
        return reply(
          'wallet_self',
          'impossible de modifier ton propre portefeuille.',
        );
      if (code === 'nothing_to_debit')
        return reply(
          'wallet_nothing',
          `le solde de @${target.name} est déjà à 0 · rien n’a été retiré.`,
        );
      if (code === 'wallet_full')
        return reply(
          'wallet_full',
          `le solde de @${target.name} est au maximum · rien n’a été crédité.`,
        );
      if (e instanceof LabWalletError)
        return reply(
          'wallet_unavailable',
          'Portefeuille momentanément indisponible · rien n’a été fait.',
        );
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
