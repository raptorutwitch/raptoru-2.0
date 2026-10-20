import {
  type AlertOutboxEvent,
  type AlertsMode,
  createLabAlertsIngest,
} from './lab-alerts-ingest.js';
import { createLabChatIngest, type LabCorePost } from './lab-chat-ingest.js';
import {
  createLabChatOutput,
  createRateLimiter,
  type LabChatOutputDeps,
  type SendJournal,
} from './lab-chat-output.js';
import type { Outbox } from './loyalty-outbox.js';
import type { HelixStream } from './stream-watch.js';

// Production bot → main Core (lot 8): the chat games and the real Twitch alerts, with the Lab adapter's modules
// UNCHANGED (lab-chat-ingest.ts, lab-alerts-ingest.ts, lab-chat-output.ts). The main Core serves the same contracts
// under /v1/bot/… (bot secret) instead of /v1/lab/… (Studio secret): only the path prefix differs. Everything rides
// on the bot's existing EventSub connection (LeCroupier_'s token) — never a second consumer of a subscription:
// stream.online / offline and channel.chat.message are subscribed once, by the runtime or here.
// - games: every chat message → /v1/bot/chat (Tombola, Commands V2, Jeu des mots, Roulette / Slot / Duel; the Core
//   deduplicates by message id), the stream state → /v1/bot/stream;
// - alerts: chat notices (sub, resub, gifts, raid…), cheers, follows → /v1/bot/alerts/events through the durable
//   outbox (written before it is sent, resumed at start; Core deduplicates by the Twitch id; the Twitch time travels
//   as occurred_at for the StreamElements cutoff);
// - output: the chat answers (claim / ACK, journal), sent only while Core's « Sortie chat réelle » is ON.

/** /v1/lab/<rest> (the Lab adapter's paths) → /v1/bot/<rest> (the main Core's bot doors). */
export const botPath = (path: string) =>
  path.replace(/^\/v1\/lab\//, '/v1/bot/');

export interface CoreChatBridgeDeps {
  /** POST to the main Core with the bot secret; throws `lab_core_<status>` on a non-2xx answer. */
  post: LabCorePost;
  /** Same POST, with its status (the output executor reads 409 answers). */
  call: LabChatOutputDeps['core'];
  channelId: string;
  broadcasterId: string;
  tokenUserId: string;
  scopes: string[];
  games: boolean;
  alertsMode: AlertsMode;
  alertsOutbox: Outbox<AlertOutboxEvent>;
  /** The runtime already subscribes channel.chat.message (chat commands on): not subscribed twice. */
  runtimeChat: boolean;
  subscribe(
    type: string,
    condition: Record<string, string>,
    sessionId: string,
    version?: string,
  ): Promise<void>;
  getStream(): Promise<HelixStream | null>;
  /** Chat answers (Commands V2, games): absent = no executor (nothing can be sent). */
  output?: {
    send: LabChatOutputDeps['send'];
    journal: SendJournal;
    ratePer30s: number;
  };
  log?: (...args: unknown[]) => void;
}

export function createCoreChatBridge(d: CoreChatBridgeDeps) {
  const log = d.log ?? console.log;
  const post: LabCorePost = (path, body) => d.post(botPath(path), body);
  const alerts = createLabAlertsIngest({
    mode: d.alertsMode,
    channelId: d.channelId,
    broadcasterId: d.broadcasterId,
    tokenUserId: d.tokenUserId,
    scopes: d.scopes,
    lab: post,
    outbox: d.alertsOutbox,
    log,
  });
  const ingest = d.games
    ? createLabChatIngest({
        lab: post,
        labChannelId: d.channelId,
        broadcasterId: d.broadcasterId,
        tokenUserId: d.tokenUserId,
        // Subscriptions are made below (once), never by the ingest itself.
        subscribe: async () => {},
        alerts,
        getStream: d.getStream,
        log,
      })
    : null;
  const output =
    d.games && d.output
      ? createLabChatOutput({
          core: (path, body) => d.call(botPath(path), body),
          channelId: d.channelId,
          executorId: `bot-chat-${d.tokenUserId}`,
          scopes: d.scopes,
          send: d.output.send,
          journal: d.output.journal,
          limiter: createRateLimiter({
            max: d.output.ratePer30s,
            windowMs: 30_000,
          }),
          log,
        })
      : null;
  const alertsOn = d.alertsMode !== 'off';
  // Lot 9: the alert subscriptions of the last (re)connection, for the reception report Studio shows.
  let subscribed: string[] = [];
  let refused: string[] = [];

  return {
    /** Added to the runtime's subscriptions on every (re)connection. */
    async subscribe(sessionId: string) {
      if ((d.games || alertsOn) && !d.runtimeChat)
        await d.subscribe(
          'channel.chat.message',
          { broadcaster_user_id: d.broadcasterId, user_id: d.tokenUserId },
          sessionId,
        );
      // An alert source refused (missing scope, not moderator) never takes the chat down with it.
      subscribed = [];
      refused = [];
      for (const s of alerts.subscriptions())
        try {
          await d.subscribe(s.type, s.condition, sessionId, s.version);
          subscribed.push(s.type);
          log(`[alerts] abonnement ${s.type} créé`);
        } catch (error) {
          refused.push(s.type);
          log(`[alerts] abonnement ${s.type} refusé`, (error as Error).message);
        }
      if (ingest)
        await ingest
          .syncStream()
          .catch((e) =>
            log('[chat-games] stream sync failed', (e as Error).message),
          );
    },
    /** Every notification of the bot's connection (after the runtime's own handling). Never throws. */
    async notification(
      type: string,
      event: Record<string, unknown>,
      messageId: string,
      timestamp: string,
    ) {
      if (ingest)
        return ingest.handlers.notification(type, event, messageId, timestamp);
      if (!alertsOn) return;
      try {
        if (
          type === 'channel.chat.notification' ||
          type === 'channel.follow' ||
          (type === 'channel.chat.message' && event.cheer)
        )
          await alerts.handle(type, event, messageId, timestamp);
      } catch (error) {
        log(`[alerts] ${type} non transmis`, (error as Error).message);
      }
    },
    /** At start: alerts a previous run left unanswered (same ids: Core deduplicates). */
    resumePending: () => alerts.resumePending(),
    /** Periodic repair of a lost stream transition (games only). */
    reconcileStream: () => ingest?.reconcileStream() ?? Promise.resolve(false),
    run: () => output?.run(),
    alertsPending: () => alerts.pending(),
    /** Lot 9: the alerts reception, reported to the main Core (POST /v1/bot/alerts/status) for Studio. */
    receptionReport: () => ({
      channel_id: d.channelId,
      mode: d.alertsMode,
      subscriptions: subscribed,
      refused,
      pending: alerts.pending(),
    }),
    close() {
      output?.stop();
      if (ingest) ingest.close();
      else alerts.close();
    },
  };
}
export type CoreChatBridge = ReturnType<typeof createCoreChatBridge>;
