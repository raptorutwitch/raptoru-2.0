import type { LabChatMessage, LabStreamEvent } from '@raptoru/schemas';

// Lab chat ingress — ONE entry for every chat message of the Lab (single Twitch adapter or the Studio
// simulator) and for the stream state. Core routes each message to every Lab module that handles chat
// commands; each module decides on its own (command, alias, role) and answers `ignored` otherwise.
// Today: the Tombola, Commands V2 and the Jeu des mots. Tomorrow: TTS (!canceltts…), global commands,
// moderation test commands… are added here as modules — never a second Twitch connection, token or
// process per module. A plain message (not starting with « ! ») only goes to the modules that read the
// whole chat (`plainText`: the Jeu des mots); the others keep receiving commands only.

export interface LabChatModule {
  name: string;
  /** Also receives the plain messages (not starting with « ! »). */
  plainText?: boolean;
  chat?(msg: LabChatMessage): Promise<{ outcome: string; replayed?: boolean }>;
  stream?(ev: LabStreamEvent): Promise<unknown>;
}

export class LabChatRouter {
  constructor(private readonly modules: LabChatModule[]) {}

  /** Every module sees the message; the answer lists the modules that handled it. */
  async message(msg: LabChatMessage) {
    const handled: { module: string; outcome: string; replayed?: boolean }[] =
      [];
    const command = msg.text.trimStart().startsWith('!');
    for (const m of this.modules) {
      if (!m.chat || (!command && !m.plainText)) continue;
      const out = await m.chat(msg);
      if (out.outcome !== 'ignored') handled.push({ module: m.name, ...out });
    }
    return { handled };
  }

  /** Stream state (offline → live / live → offline) for every module that follows it. */
  async stream(ev: LabStreamEvent) {
    const modules: Record<string, unknown> = {};
    for (const m of this.modules)
      if (m.stream) modules[m.name] = await m.stream(ev);
    return { ok: true, modules };
  }
}
