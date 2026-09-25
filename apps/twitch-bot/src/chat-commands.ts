import type { Viewer } from '@raptoru/schemas';
import type { CoreClient } from './core-client.js';

// Chat is only a transport: the bot forwards identity + intent, Core decides and writes the reply.

export interface ChatMessage {
  messageId: string;
  text: string;
  chatter: Viewer;
}

export const CORE_UNAVAILABLE_MESSAGE =
  '⚠️ Daily momentanément indisponible, réessaie dans un instant.';

export function parseCommand(text: string): 'daily' | 'streak' | null {
  const first = text.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (first === '!daily') return 'daily';
  if (first === '!streak') return 'streak';
  return null;
}

export async function handleChatMessage(
  message: ChatMessage,
  deps: {
    core: CoreClient;
    say: (text: string) => Promise<void>;
    log?: (...args: unknown[]) => void;
  },
): Promise<void> {
  const command = parseCommand(message.text);
  if (!command) return;

  let reply: string;
  try {
    reply =
      command === 'daily'
        ? (
            await deps.core.dailyClaim({
              viewer: message.chatter,
              requestId: message.messageId,
            })
          ).message
        : (await deps.core.dailyStreak({ viewer: message.chatter })).message;
  } catch (error) {
    (deps.log ?? console.error)(`[twitch-bot] !${command} failed`, error);
    reply = CORE_UNAVAILABLE_MESSAGE;
  }
  await deps.say(reply);
}
