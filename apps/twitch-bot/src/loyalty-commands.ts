import type { AdminOp, Viewer } from '@raptoru/schemas';
import type { CoreClient } from './core-client.js';

// Loyalty chat commands: parse the chat syntax and resolve the target's Twitch identity, then
// forward a structured intent to Core, which decides and returns the reply. No wallet logic here.

export type LoyaltyCommand =
  | { kind: 'balance' }
  | { kind: 'give'; target: string; amount: number }
  | {
      kind: 'admin';
      op: AdminOp;
      target: string;
      amount: number;
      reason?: string;
    }
  | { kind: 'usage'; text: string };

const BALANCE = new Set(['!solde', '!balance', '!compte']);
const GIVE = new Set(['!give', '!trade']);
const LOGIN = /^@?([a-z0-9_]{3,25})$/i;

const USAGE_GIVE = 'usage : !give @pseudo montant';
const USAGE_ADMIN = 'usage : !wallet add|remove|set @pseudo montant [motif]';

/** Accepts `!give @Pseudo 500` and `!give 500 @Pseudo`. */
export function parseLoyaltyCommand(text: string): LoyaltyCommand | null {
  const [head, ...args] = text.trim().split(/\s+/);
  const command = head?.toLowerCase() ?? '';
  if (BALANCE.has(command)) return { kind: 'balance' };

  if (GIVE.has(command)) {
    const amountToken = args.find(
      (a) => /^[+-]?\d+([.,]\d+)?[a-z]*$/i.test(a) && !a.startsWith('@'),
    );
    const targetToken = args.find((a) => a !== amountToken && LOGIN.test(a));
    if (
      !amountToken ||
      !targetToken ||
      !/^\d+$/.test(amountToken) ||
      Number(amountToken) < 1
    ) {
      return { kind: 'usage', text: USAGE_GIVE };
    }
    return {
      kind: 'give',
      target: LOGIN.exec(targetToken)![1]!.toLowerCase(),
      amount: Number(amountToken),
    };
  }

  if (command === '!wallet') {
    const op = args[0]?.toLowerCase();
    if (op !== 'add' && op !== 'remove' && op !== 'set')
      return { kind: 'usage', text: USAGE_ADMIN };
    const rest = args.slice(1);
    const pattern = op === 'set' ? /^-?\d+$/ : /^\d+$/;
    const amountIndex = rest.findIndex((a) => pattern.test(a));
    const targetIndex = rest.findIndex(
      (a, i) => i !== amountIndex && LOGIN.test(a),
    );
    if (
      amountIndex < 0 ||
      targetIndex < 0 ||
      amountIndex > 1 ||
      targetIndex > 1
    )
      return { kind: 'usage', text: USAGE_ADMIN };
    const amount = Number(rest[amountIndex]);
    if (op !== 'set' && amount < 1) return { kind: 'usage', text: USAGE_ADMIN };
    const reason = rest.slice(2).join(' ').trim();
    return {
      kind: 'admin',
      op,
      target: LOGIN.exec(rest[targetIndex]!)![1]!.toLowerCase(),
      amount,
      ...(reason ? { reason: reason.slice(0, 200) } : {}),
    };
  }
  return null;
}

export interface LoyaltyMessage {
  messageId: string;
  text: string;
  chatter: Viewer;
  /** Twitch identities of the users @mentioned in the message (EventSub fragments). */
  mentions: Viewer[];
}

export async function handleLoyaltyMessage(
  message: LoyaltyMessage,
  deps: {
    core: Pick<CoreClient, 'walletBalance' | 'walletTransfer' | 'walletAdmin'>;
    say: (text: string) => Promise<void>;
    /** Fallback when the target was typed without a real @mention. */
    lookupLogin: (login: string) => Promise<Viewer | null>;
    log?: (...args: unknown[]) => void;
  },
): Promise<void> {
  const command = parseLoyaltyCommand(message.text);
  if (!command) return;
  const name = message.chatter.displayName;
  if (command.kind === 'usage') return deps.say(`@${name} — ${command.text}`);

  try {
    if (command.kind === 'balance') {
      return await deps.say(
        (await deps.core.walletBalance({ viewer: message.chatter })).message,
      );
    }
    const target =
      message.mentions.find((m) => m.login.toLowerCase() === command.target) ??
      (await deps.lookupLogin(command.target));
    if (!target)
      return await deps.say(
        `@${name} — viewer « ${command.target} » introuvable.`,
      );

    const reply =
      command.kind === 'give'
        ? await deps.core.walletTransfer({
            requestId: message.messageId,
            from: message.chatter,
            to: target,
            amount: command.amount,
          })
        : await deps.core.walletAdmin({
            requestId: message.messageId,
            actor: message.chatter,
            target,
            op: command.op,
            amount: command.amount,
            ...(command.reason ? { reason: command.reason } : {}),
          });
    await deps.say(reply.message);
  } catch (error) {
    (deps.log ?? console.error)('[twitch-bot] loyalty command failed', error);
    await deps.say(
      `⚠️ @${name} — portefeuille momentanément indisponible, réessaie dans un instant.`,
    );
  }
}
