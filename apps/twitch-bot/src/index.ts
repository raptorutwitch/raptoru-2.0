import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { TWITCH_OAUTH_PROFILES } from '@raptoru/schemas';
import { broadcasterScopes, loadConfig, requiredScopes } from './config.js';
import {
  type CpOutboxEvent,
  createChannelPointsEvents,
} from './channel-points-events.js';
import { createCoreClient } from './core-client.js';
import { createBroadcasterEvents } from './loyalty-events.js';
import { fileOutbox, memoryOutbox } from './loyalty-outbox.js';
import { createCoreChatBridge } from './core-chat-bridge.js';
import type { AlertOutboxEvent } from './lab-alerts-ingest.js';
import { fileJournal } from './lab-chat-output.js';
import { createBotRuntime } from './runtime.js';
import { fileTokenStore, TwitchAuth } from './twitch/auth.js';
import { superviseTwitchAuth } from './twitch/auth-supervision.js';
import { runEventSub } from './twitch/eventsub.js';
import { createHelix } from './twitch/helix.js';

// Safety switch: the bot only connects to Twitch when explicitly enabled. Chat commands and the
// presence tracker are separate opt-ins (see config.ts).
if (process.env.TWITCH_ENABLED !== 'true') {
  console.log(
    '[twitch-bot] Twitch disabled (TWITCH_ENABLED is not "true"): not connecting.',
  );
  process.exit(0);
}

const config = loadConfig();
const consumers = new Set<() => void>();
function authorizationLost(account: string, reason: string): never {
  console.error(
    `[twitch-bot] ${account}: ${reason}; consumers stopped, reauthorization required`,
  );
  for (const stop of consumers) stop();
  process.exit(78);
}
const auth = new TwitchAuth({
  clientId: config.TWITCH_CLIENT_ID,
  clientSecret: config.TWITCH_CLIENT_SECRET,
  store: fileTokenStore(config.TWITCH_TOKEN_FILE),
  requiredScopes: requiredScopes({
    ...config,
    // This entry point does not run the Lab adapters or Random Ban executor; the main Core's chat games and alerts
    // (lot 8) need the same capabilities as the Lab adapter's.
    LAB_CHAT_INGEST:
      config.CHAT_GAMES === 'true' || config.ALERTS_MODE !== 'off'
        ? 'true'
        : 'false',
    LAB_CHAT_OUTPUT:
      config.CHAT_GAMES === 'true' && config.CHAT_GAMES_OUTPUT === 'true'
        ? 'true'
        : 'false',
    LAB_ALERTS_FOLLOW: config.ALERTS_FOLLOW,
    RANDOM_BAN: 'false',
  }),
  expectedUserId: TWITCH_OAUTH_PROFILES.bot.expectedUserId,
  onFailure: (code) => authorizationLost('LeCroupier_', code),
});
try {
  await auth.init();
} catch (error) {
  console.error(
    `[twitch-bot] Twitch auth unusable: ${(error as Error).message}`,
  );
  process.exit(1);
}
const status = auth.status();
console.log(
  `[twitch-bot] token ok for ${status.login} (${status.userId}), expires ${status.expiresAt}, refresh ${status.hasRefreshToken ? 'available' : 'missing'} · chat commands ${config.DAILY_CHAT_COMMANDS} · presence shadow ${config.PRESENCE_SHADOW}`,
);

const runtime = createBotRuntime({
  config,
  tokenUserId: status.userId!,
  helix: createHelix({
    clientId: config.TWITCH_CLIENT_ID,
    getAccessToken: () => auth.getAccessToken(),
    handleUnauthorized: (rejected) => auth.handleUnauthorized(rejected),
  }),
  core: createCoreClient(config.CORE_API_URL, config.BOT_SECRET),
  workerId: `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
});

consumers.add(() => runtime.presence?.stop());
// Lot 8: chat games and real alerts of the main Core, on this same connection (core-chat-bridge.ts). Both OFF by
// default: nothing more is subscribed or forwarded.
const coreHelix = createHelix({
  clientId: config.TWITCH_CLIENT_ID,
  getAccessToken: () => auth.getAccessToken(),
  handleUnauthorized: (rejected) => auth.handleUnauthorized(rejected),
});
const coreCall = async (path: string, body: unknown) => {
  const res = await fetch(new URL(path, config.CORE_API_URL), {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${config.BOT_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, body: (await res.json()) as unknown };
};
const bridge =
  config.CHAT_GAMES === 'true' || config.ALERTS_MODE !== 'off'
    ? createCoreChatBridge({
        post: async (path, body) => {
          const r = await coreCall(path, body);
          // The Lab adapter's error shape: its retry rules (transient 5xx / 408 / 429) apply unchanged.
          if (r.status < 200 || r.status >= 300)
            throw new Error(`lab_core_${r.status}`);
          return r.body;
        },
        call: coreCall,
        channelId: config.TWITCH_BROADCASTER_ID,
        broadcasterId: config.TWITCH_BROADCASTER_ID,
        tokenUserId: status.userId!,
        scopes: status.scopes,
        games: config.CHAT_GAMES === 'true',
        alertsMode: config.ALERTS_MODE,
        alertsOutbox:
          config.ALERTS_MODE === 'active'
            ? fileOutbox<AlertOutboxEvent>(config.ALERTS_OUTBOX_FILE)
            : memoryOutbox<AlertOutboxEvent>(),
        runtimeChat:
          config.DAILY_CHAT_COMMANDS === 'true' ||
          config.LOYALTY_CHAT_COMMANDS === 'true',
        subscribe: (type, condition, sessionId, version) =>
          coreHelix.subscribe(type, condition, sessionId, version),
        getStream: () => coreHelix.getStream(config.TWITCH_BROADCASTER_ID),
        ...(config.CHAT_GAMES_OUTPUT === 'true' &&
        status.scopes.includes('user:write:chat')
          ? {
              output: {
                send: {
                  chat: (text: string, replyTo: string | null) =>
                    coreHelix.sendChat(
                      config.TWITCH_BROADCASTER_ID,
                      status.userId!,
                      text,
                      replyTo,
                    ),
                  announce: (text: string) =>
                    coreHelix.sendAnnouncement(
                      config.TWITCH_BROADCASTER_ID,
                      status.userId!,
                      text,
                    ),
                },
                journal: fileJournal(config.CHAT_GAMES_JOURNAL_FILE),
                ratePer30s: config.CHAT_GAMES_OUTPUT_RATE,
              },
            }
          : {}),
      })
    : null;
// Lot 9: the alerts reception for Studio (mode, subscriptions, outbox), every minute and after each (re)connection.
// Best effort: a Core without the route (older) or unreachable changes nothing here.
const reportReception = () =>
  bridge
    ? coreCall('/v1/bot/alerts/status', bridge.receptionReport()).catch(
        () => undefined,
      )
    : Promise.resolve(undefined);
if (bridge) {
  consumers.add(() => bridge.close());
  const reception = setInterval(() => void reportReception(), 60_000);
  consumers.add(() => clearInterval(reception));
  void bridge.resumePending(); // alerts a previous run could not deliver to Core
  void bridge.run();
  console.log(
    `[twitch-bot] main Core: chat games ${config.CHAT_GAMES}, alerts ${config.ALERTS_MODE}, chat answers ${config.CHAT_GAMES_OUTPUT}`,
  );
}
const botSocket = runEventSub({
  ...runtime.eventSub,
  async subscribe(sessionId) {
    await runtime.eventSub.subscribe(sessionId);
    await bridge?.subscribe(sessionId);
    void reportReception();
  },
  async notification(type, event, messageId, timestamp) {
    await runtime.eventSub.notification(type, event, messageId, timestamp);
    await bridge?.notification(type, event, messageId, timestamp);
  },
  revocation: (_type, reason) => authorizationLost('LeCroupier_', reason),
});
consumers.add(() => botSocket.stop());
const botValidation = superviseTwitchAuth(
  auth,
  (reason) => authorizationLost('LeCroupier_', reason),
  {
    log: (message) => console.error(`[twitch-bot] ${message}`),
  },
);
consumers.add(() => botValidation.stop());

// Helix repair loop: chained timeouts, a sync never overlaps the previous one.
const syncLoop = async () => {
  await runtime.streams
    .sync()
    .catch((error) => console.error('[twitch-bot] stream sync failed', error));
  // Chat games: a stream transition the main Core did not receive is sent again (Tombola stream sessions).
  await bridge
    ?.reconcileStream()
    .catch((error) =>
      console.error('[twitch-bot] chat games stream repair failed', error),
    );
  setTimeout(syncLoop, config.STREAM_SYNC_INTERVAL_MS);
};
await syncLoop();

// Loyalty Twitch events (opt-in): a separate broadcaster token and EventSub connection. Without a
// valid broadcaster token they stay off; presence keeps running.
// Broadcaster EventSub connection (separate broadcaster token): loyalty events and / or Points de chaîne
// redemptions, both opt-in. One connection for both; each module keeps its own subscriptions and checks.
const loyaltyOn = config.LOYALTY_TWITCH_EVENTS === 'true';
const pointsOn = config.CHANNEL_POINTS_EVENTS === 'true';
if (loyaltyOn || pointsOn) {
  let broadcasterReady = false;
  const broadcasterAuth = new TwitchAuth({
    clientId: config.TWITCH_CLIENT_ID,
    clientSecret: config.TWITCH_CLIENT_SECRET,
    store: fileTokenStore(config.TWITCH_BROADCASTER_TOKEN_FILE),
    // Random Ban is not wired in this production entry point; do not require its scopes here.
    requiredScopes: broadcasterScopes({ ...config, RANDOM_BAN: 'false' }),
    expectedUserId: TWITCH_OAUTH_PROFILES.broadcaster.expectedUserId,
    onFailure: (code) => {
      // An unavailable optional broadcaster token at startup must not take chat/presence down.
      if (broadcasterReady) authorizationLost('raptoru_', code);
    },
  });
  try {
    await broadcasterAuth.init();
    if (broadcasterAuth.status().userId !== config.TWITCH_BROADCASTER_ID) {
      throw new Error(
        'broadcaster token does not belong to TWITCH_BROADCASTER_ID',
      );
    }
    broadcasterReady = true;
    const broadcasterHelix = createHelix({
      clientId: config.TWITCH_CLIENT_ID,
      getAccessToken: () => broadcasterAuth.getAccessToken(),
      handleUnauthorized: (rejected) =>
        broadcasterAuth.handleUnauthorized(rejected),
    });
    const broadcasterValidation = superviseTwitchAuth(
      broadcasterAuth,
      (reason) => authorizationLost('raptoru_', reason),
      {
        log: (message) => console.error(`[twitch-bot] broadcaster: ${message}`),
      },
    );
    consumers.add(() => broadcasterValidation.stop());
    const core = createCoreClient(config.CORE_API_URL, config.BOT_SECRET);
    const events = loyaltyOn
      ? createBroadcasterEvents({
          core,
          subscribe: (type, condition, sessionId, version) =>
            broadcasterHelix.subscribe(type, condition, sessionId, version),
          listEnabledSubscriptions: () =>
            broadcasterHelix.listEnabledSubscriptions(),
          getSubscriptionsPage: (after) =>
            broadcasterHelix.getSubscriptionsPage(
              config.TWITCH_BROADCASTER_ID,
              after,
            ),
          broadcasterId: config.TWITCH_BROADCASTER_ID,
          outbox: fileOutbox(config.LOYALTY_OUTBOX_FILE),
        })
      : null;
    // Points de chaîne V1: read only; Core's master switch (OFF by default) decides whether anything runs.
    const points = pointsOn
      ? createChannelPointsEvents({
          channelId: config.TWITCH_BROADCASTER_ID,
          broadcasterId: config.TWITCH_BROADCASTER_ID,
          postRedemption: (body) => core.channelPointsRedemption(body),
          postRedemptionUpdate: (body) =>
            core.channelPointsRedemptionUpdate(body),
          postRewards: (body) => core.channelPointsRewards(body),
          outbox: fileOutbox<CpOutboxEvent>(config.CHANNEL_POINTS_OUTBOX_FILE),
          subscribe: (type, condition, sessionId, version) =>
            broadcasterHelix.subscribe(type, condition, sessionId, version),
          getCustomRewards: () =>
            broadcasterHelix.getCustomRewards(config.TWITCH_BROADCASTER_ID),
        })
      : null;
    events?.resumePending(); // events a previous run could not deliver to Core
    void points?.resumePending(); // redemptions a previous run could not deliver to Core
    if (points) consumers.add(() => points.close());
    const broadcasterSocket = runEventSub({
      async subscribe(sessionId) {
        if (events) await events.eventSub.subscribe(sessionId);
        if (points) {
          await points.subscribe(sessionId);
          void points.syncRewards();
        }
      },
      async notification(type, event, messageId, timestamp) {
        if (points && (await points.handle(type, event))) return;
        if (events)
          await events.eventSub.notification(type, event, messageId, timestamp);
      },
      log: events?.eventSub.log,
      revocation: (_type, reason) => authorizationLost('raptoru_', reason),
    });
    consumers.add(() => broadcasterSocket.stop());
    if (events) {
      // Tier reconciliation: full snapshot at startup, then every 6 hours (chained, never overlapping).
      const snapshotLoop = async () => {
        await events.syncSubscriptions();
        setTimeout(snapshotLoop, 6 * 60 * 60 * 1000);
      };
      await snapshotLoop();
    }
    console.log(
      `[twitch-bot] broadcaster events on: ${[loyaltyOn ? 'loyalty (subs, gifts, cheers, follows)' : '', pointsOn ? 'Points de chaîne (read only)' : ''].filter(Boolean).join(' + ')}`,
    );
  } catch (error) {
    console.error(
      `[twitch-bot] broadcaster events OFF: ${(error as Error).message}`,
    );
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    for (const stop of consumers) stop();
    process.exit(0);
  });
}
