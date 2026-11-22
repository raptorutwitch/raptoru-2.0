import { AsyncLocalStorage } from 'node:async_hooks';

// Chatbox Raptoru (docs/CHATBOX.md § 6.3): the chat message a module is answering. The chat router runs every module
// inside this context; the chat steps written meanwhile (cmd_steps.params.trigger) remember the message and the
// command word that caused them, whatever the module — so the chatbox can show or hide LeCroupier_'s answer to each
// command without ever reading its text. No migration: `params` is the step's free JSON.

export interface ChatTrigger {
  message_id: string;
  /** The command word typed (`rb` for « !rb »), lower case; null for a plain message. */
  command: string | null;
}

const als = new AsyncLocalStorage<ChatTrigger>();

export const withTrigger = <T>(t: ChatTrigger, fn: () => Promise<T>) =>
  als.run(t, fn);

export const currentTrigger = (): ChatTrigger | null => als.getStore() ?? null;

/** `!` followed by a letter or a digit; `!!!!!`, `!?!?`, `! salut` are never commands. */
export function commandWord(text: string): string | null {
  const m = /^\s*!([\p{L}\p{N}][\p{L}\p{N}_]*)/u.exec(text);
  return m ? m[1]!.toLowerCase() : null;
}

/** A chat step's params with the current trigger (unchanged outside a chat message). */
export function withTriggerParams<T extends object>(params: T): T {
  const t = currentTrigger();
  return t ? { ...params, trigger: t } : params;
}
