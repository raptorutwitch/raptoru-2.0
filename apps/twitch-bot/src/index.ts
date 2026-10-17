import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { broadcasterScopes, loadConfig, requiredScopes } from './config.js';
import { createChannelPointsEvents } from './channel-points-events.js';
import { createCoreClient } from './core-client.js';
import { createBroadcasterEvents } from './loyalty-events.js';
import { fileOutbox } from './loyalty-outbox.js';
import { createBotRuntime } from './runtime.js';
import { AuthError, fileTokenStore, TwitchAuth } from './twitch/auth.js';
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
const auth = new TwitchAuth({
  clientId: config.TWITCH_CLIENT_ID,
  clientSecret: config.TWITCH_CLIENT_SECRET,
  store: fileTokenStore(config.TWITCH_TOKEN_FILE),
  requiredScopes: requiredScopes(config),
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

runEventSub(runtime.eventSub);

// Helix repair loop: chained timeouts, a sync never overlaps the previous one.
const syncLoop = async () => {
  await runtime.streams
    .sync()
    .catch((error) => console.error('[twitch-bot] stream sync failed', error));
  setTimeout(syncLoop, config.STREAM_SYNC_INTERVAL_MS);
};
await syncLoop();

// Hourly token validation (required by Twitch). Lost scopes or a dead refresh token stop the
// presence tracker cleanly instead of letting it fail every cycle.
const validateLoop = () =>
  setTimeout(
    async () => {
      try {
        await auth.validate();
      } catch (error) {
        if (error instanceof AuthError && auth.status().state === 'failed') {
          console.error(
            `[twitch-bot] Twitch auth lost (${error.code}): presence tracker stopped`,
          );
          runtime.presence?.stop();
          return;
        }
        console.error(
          '[twitch-bot] token validation failed, will retry',
          (error as Error).message,
        );
      }
      validateLoop();
    },
    60 * 60 * 1000,
  );
validateLoop();

// Loyalty Twitch events (opt-in): a separate broadcaster token and EventSub connection. Without a
// valid broadcaster token they stay off; presence keeps running.
// Broadcaster EventSub connection (separate broadcaster token): loyalty events and / or Points de chaîne
// redemptions, both opt-in. One connection for both; each module keeps its own subscriptions and checks.
const loyaltyOn = config.LOYALTY_TWITCH_EVENTS === 'true';
const pointsOn = config.CHANNEL_POINTS_EVENTS === 'true';
if (loyaltyOn || pointsOn) {
  const broadcasterAuth = new TwitchAuth({
    clientId: config.TWITCH_CLIENT_ID,
    clientSecret: config.TWITCH_CLIENT_SECRET,
    store: fileTokenStore(config.TWITCH_BROADCASTER_TOKEN_FILE),
    requiredScopes: broadcasterScopes(config),
  });
  try {
    await broadcasterAuth.init();
    if (broadcasterAuth.status().userId !== config.TWITCH_BROADCASTER_ID) {
      throw new Error(
        'broadcaster token does not belong to TWITCH_BROADCASTER_ID',
      );
    }
    const broadcasterHelix = createHelix({
      clientId: config.TWITCH_CLIENT_ID,
      getAccessToken: () => broadcasterAuth.getAccessToken(),
      handleUnauthorized: (rejected) =>
        broadcasterAuth.handleUnauthorized(rejected),
    });
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
          postRewards: (body) => core.channelPointsRewards(body),
          subscribe: (type, condition, sessionId, version) =>
            broadcasterHelix.subscribe(type, condition, sessionId, version),
          getCustomRewards: () =>
            broadcasterHelix.getCustomRewards(config.TWITCH_BROADCASTER_ID),
        })
      : null;
    events?.resumePending(); // events a previous run could not deliver to Core
    runEventSub({
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
    });
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
    runtime.presence?.stop();
    process.exit(0);
  });
}
