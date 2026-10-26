import type { LabChatMessage, LabStreamEvent } from '@raptoru/schemas';

// Lab chat ingress — ONE entry for every chat message of the Lab (single Twitch adapter or the Studio
// simulator) and for the stream state. Core routes each message to every Lab module that handles chat
// commands; each module decides on its own (command, alias, role) and answers `ignored` otherwise.
// Today: the Tombola, Commands V2 and the Jeu des mots. Tomorrow: TTS (!canceltts…), global commands,
// moderation test commands… are added here as modules — never a second Twitch connection, token or
// process per module. A plain message (not starting with « ! ») only goes to the modules that read the
// whole chat (`plainText`: the Jeu des mots); the others keep receiving commands only.
// One plain message answers ONE question: the modules that read a viewer's « oui » / « non » to a question they asked
// (`answers`: Caution's quote, the Roue du Sub's invitation) see it in order, and the first one that takes it keeps
// it — the next ones never see it. Never a single « oui » paying a caution AND accepting a wheel invitation.

export interface LabChatModule {
  name: string;
  /** Also receives the plain messages (not starting with « ! »). */
  plainText?: boolean;
  /**
   * Reads a viewer's answer (« oui » / « non ») to a question it asked. A plain message one of these modules took
   * (any outcome but `ignored`) is not given to the next ones: their order in the router is the priority.
   */
  answers?: boolean;
  chat?(msg: LabChatMessage): Promise<{ outcome: string; replayed?: boolean }>;
  stream?(ev: LabStreamEvent): Promise<unknown>;
}

type Handled = { module: string; outcome: string; replayed?: boolean };

/** A received chat message, as Studio's « Simulation » chat shows it (memory only, never persisted). */
export interface LabChatEntry {
  seq: number;
  channel_id: string;
  message_id: string;
  received_at: string;
  source: LabChatMessage['source'];
  chatter: { id: string; display_name: string; role: string };
  text: string;
  /** The modules that handled it, with their outcome. */
  handled: Handled[];
  /** A module refused it (e.g. credit_failed): the adapter may send it again. */
  error?: string;
}

/** Received messages kept in memory for Studio's chat view (the last ones only). */
export const LAB_CHAT_RECENT_MAX = 100;

export class LabChatRouter {
  private readonly log: LabChatEntry[] = [];
  private seq = 0;

  constructor(private readonly modules: LabChatModule[]) {}

  /** Every module sees the message; the answer lists the modules that handled it. */
  async message(msg: LabChatMessage) {
    // Reception time, before the modules: their answers (cmd_steps) are always later than the message.
    const receivedAt = new Date().toISOString();
    const handled: Handled[] = [];
    let error: string | undefined;
    const command = msg.text.trimStart().startsWith('!');
    /** The module that took this plain message as the answer to its question (one answer, one question). */
    let answeredBy: string | null = null;
    try {
      for (const m of this.modules) {
        if (!m.chat || (!command && !m.plainText)) continue;
        if (m.answers && !command && answeredBy) continue;
        const out = await m.chat(msg);
        if (out.outcome === 'ignored') continue;
        handled.push({ module: m.name, ...out });
        if (m.answers && !command) answeredBy = m.name;
      }
    } catch (e) {
      error = (e as { code?: string }).code ?? 'error';
      throw e;
    } finally {
      this.remember(msg, receivedAt, handled, error);
    }
    return { handled };
  }

  /** One entry per message id: a resent message updates its entry (never a duplicate). */
  private remember(
    msg: LabChatMessage,
    receivedAt: string,
    handled: Handled[],
    error?: string,
  ) {
    const prior = this.log.find(
      (e) => e.channel_id === msg.channel_id && e.message_id === msg.message_id,
    );
    if (prior) {
      if (handled.length || !prior.handled.length) prior.handled = handled;
      if (error) prior.error = error;
      else delete prior.error;
      return;
    }
    this.log.push({
      seq: ++this.seq,
      channel_id: msg.channel_id,
      message_id: msg.message_id,
      received_at: receivedAt,
      source: msg.source,
      chatter: {
        id: msg.chatter.id,
        display_name: msg.chatter.display_name,
        role: msg.chatter.role,
      },
      text: msg.text,
      handled,
      ...(error ? { error } : {}),
    });
    if (this.log.length > LAB_CHAT_RECENT_MAX)
      this.log.splice(0, this.log.length - LAB_CHAT_RECENT_MAX);
  }

  /** The channel's last received messages, oldest first (read only). */
  recent(channelId: string) {
    return {
      messages: this.log.filter((e) => e.channel_id === channelId),
    };
  }

  /** Stream state (offline → live / live → offline) for every module that follows it. */
  async stream(ev: LabStreamEvent) {
    const modules: Record<string, unknown> = {};
    for (const m of this.modules)
      if (m.stream) modules[m.name] = await m.stream(ev);
    return { ok: true, modules };
  }
}
