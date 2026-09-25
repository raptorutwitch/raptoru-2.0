import type { Viewer } from '@raptoru/schemas';
import { handleChatMessage } from './chat-commands.js';
import type { BotConfig } from './config.js';
import type { CoreClient } from './core-client.js';
import { handleLoyaltyMessage } from './loyalty-commands.js';
import { PresenceWorker } from './presence/presence-worker.js';
import { createStreamWatcher, type HelixStream } from './stream-watch.js';
import type { EventSubHandlers } from './twitch/eventsub.js';
import type { Helix } from './twitch/helix.js';

export interface BotRuntimeDeps {
  config: BotConfig;
  /** Owner of the user token: chat sender and Get Chatters moderator. */
  tokenUserId: string;
  helix: Pick<
    Helix,
    | 'getStream'
    | 'getChattersPage'
    | 'getUserByLogin'
    | 'sendChatMessage'
    | 'subscribe'
  >;
  core: CoreClient;
  workerId: string;
  log?: (...args: unknown[]) => void;
}

interface ChatFragment {
  type?: string;
  mention?: { user_id?: string; user_login?: string; user_name?: string };
}

/** Twitch identities of the users @mentioned in a channel.chat.message event. */
function mentionsOf(event: Record<string, unknown>): Viewer[] {
  const fragments = (
    (event.message as { fragments?: ChatFragment[] } | undefined)?.fragments ??
    []
  ).filter(
    (f) => f.type === 'mention' && f.mention?.user_id && f.mention.user_login,
  );
  return fragments.map((f) => ({
    twitchUserId: String(f.mention!.user_id),
    login: String(f.mention!.user_login),
    displayName: String(f.mention!.user_name || f.mention!.user_login),
  }));
}

/**
 * Wires Twitch events to Core. Features are opt-in and independent: without DAILY_CHAT_COMMANDS
 * nor LOYALTY_CHAT_COMMANDS the bot neither subscribes to chat nor can send a chat message;
 * without PRESENCE_SHADOW no presence worker exists.
 */
export function createBotRuntime({
  config,
  tokenUserId,
  helix,
  core,
  workerId,
  log = console.log,
}: BotRuntimeDeps) {
  const broadcaster = config.TWITCH_BROADCASTER_ID;
  const dailyChat = config.DAILY_CHAT_COMMANDS === 'true';
  const loyaltyChat = config.LOYALTY_CHAT_COMMANDS === 'true';
  const chat = dailyChat || loyaltyChat;

  let liveStateAgeSeconds: () => number | null = () => null;
  const presence =
    config.PRESENCE_SHADOW === 'true'
      ? new PresenceWorker({
          core,
          workerId,
          getPage: (after, signal) =>
            helix.getChattersPage(broadcaster, tokenUserId, after, signal),
          liveStateAgeSeconds: () => liveStateAgeSeconds(),
          log,
        })
      : null;

  const streams = createStreamWatcher({
    core,
    getStream: () => helix.getStream(broadcaster),
    listener: presence
      ? { live: (id) => presence.start(id), offline: () => presence.stop() }
      : undefined,
  });
  liveStateAgeSeconds = streams.liveStateAgeSeconds;

  const say = chat
    ? (text: string) => helix.sendChatMessage(broadcaster, tokenUserId, text)
    : null;

  const eventSub: EventSubHandlers = {
    async subscribe(sessionId) {
      await helix.subscribe(
        'stream.online',
        { broadcaster_user_id: broadcaster },
        sessionId,
      );
      await helix.subscribe(
        'stream.offline',
        { broadcaster_user_id: broadcaster },
        sessionId,
      );
      if (chat) {
        await helix.subscribe(
          'channel.chat.message',
          { broadcaster_user_id: broadcaster, user_id: tokenUserId },
          sessionId,
        );
      }
      log(
        `[twitch-bot] EventSub subscriptions created (daily chat: ${dailyChat ? 'on' : 'off'}, loyalty chat: ${loyaltyChat ? 'on' : 'off'})`,
      );
    },
    async notification(type, event) {
      try {
        if (type === 'stream.online')
          await streams.online(event as unknown as HelixStream);
        else if (type === 'stream.offline') await streams.offline();
        else if (type === 'channel.chat.message' && say) {
          if (event.chatter_user_id === tokenUserId) return;
          const message = {
            messageId: String(event.message_id),
            text: String(
              (event.message as { text?: string } | undefined)?.text ?? '',
            ),
            chatter: {
              twitchUserId: String(event.chatter_user_id),
              login: String(event.chatter_user_login),
              displayName: String(event.chatter_user_name),
            },
          };
          if (dailyChat) await handleChatMessage(message, { core, say });
          if (loyaltyChat) {
            await handleLoyaltyMessage(
              { ...message, mentions: mentionsOf(event) },
              {
                core,
                say,
                lookupLogin: (login) => helix.getUserByLogin(login),
              },
            );
          }
        }
      } catch (error) {
        log(`[twitch-bot] ${type} handling failed`, error);
      }
    },
  };

  return { eventSub, streams, presence };
}
