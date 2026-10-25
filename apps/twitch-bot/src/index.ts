import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { BOT_INSTANCE_HEADER, TWITCH_OAUTH_PROFILES } from '@raptoru/schemas';
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
import {
  createRandomBanExecutor,
  fileRbJournal,
  helixRbTwitch,
} from './random-ban-executor.js';
import {
  createCautionExecutor,
  fileCautionJournal,
  helixCautionTwitch,
} from './caution-executor.js';
import { createCpTwitchActionsExecutor } from './cp-twitch-actions-executor.js';
import {
  createVotekickExecutor,
  helixVotekickTwitch,
} from './votekick-executor.js';
import { fileRbJournal as fileVotekickJournal } from './random-ban-executor.js';
import { botFlags, createInstanceLease } from './instance-lease.js';
import { installConsole } from './log.js';
import { createBotRuntime } from './runtime.js';
import { fileTokenStore, TwitchAuth } from './twitch/auth.js';
import { superviseTwitchAuth } from './twitch/auth-supervision.js';
import { runEventSub } from './twitch/eventsub.js';
import { createHelix, type Helix } from './twitch/helix.js';
import { coreRefusal } from './lab-chat-ingest.js';

// Safety switch: the bot only connects to Twitch when explicitly enabled. Chat commands and the
// presence tracker are separate opt-ins (see config.ts).
if (process.env.TWITCH_ENABLED !== 'true') {
  console.log(
    '[twitch-bot] Twitch disabled (TWITCH_ENABLED is not "true"): not connecting.',
  );
  process.exit(0);
}

const config = loadConfig();
// Persistent logs (plan post-live lot 2): UTC time + level on every line, configured secrets and token shapes masked.
installConsole([config.BOT_SECRET, config.TWITCH_CLIENT_SECRET]);
const consumers = new Set<() => void>();

// Single active production bot (instance-lease.ts): nothing touches Twitch — not even a token refresh — before this
// instance holds the Core's lease. Without it: standby (logged), retried every 15 s.
const startedAt = new Date().toISOString();
const instanceId = (
  config.BOT_INSTANCE_ID ??
  `${config.BOT_HOST}-${hostname()}-${process.pid}`.replace(
    /[^A-Za-z0-9._:-]/g,
    '-',
  )
).slice(0, 128);
// Every Core call names this instance: with a live lease, the Core refuses the bot routes to a non-holder.
const botHeaders = { [BOT_INSTANCE_HEADER]: instanceId };
const health: {
  bot: { connected(): boolean } | null;
  broadcaster: { connected(): boolean } | null;
  broadcasterToken: boolean | null;
} = { bot: null, broadcaster: null, broadcasterToken: null };
const probe = (read: () => boolean | null): boolean | null => {
  try {
    return read();
  } catch {
    return null;
  }
};
const lease = createInstanceLease({
  call: async (path, body) => {
    const res = await fetch(new URL(path, config.CORE_API_URL), {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${config.BOT_SECRET}`,
        'content-type': 'application/json',
        ...botHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return {
      status: res.status,
      body: (await res.json().catch(() => null)) as unknown,
    };
  },
  // Container health check (Dockerfile): touched each time the Core answers the lease, holder or standby.
  ...(config.BOT_ALIVE_FILE
    ? {
        alive: () =>
          void writeFile(
            config.BOT_ALIVE_FILE!,
            new Date().toISOString(),
          ).catch(() => {}),
      }
    : {}),
  instanceId,
  // Development only (config.ts refuses it outside a local Core): a Core without the lease API lets the bot start.
  optional: config.BOT_LEASE_OPTIONAL === 'true',
  report: () => ({
    host: config.BOT_HOST,
    version: (
      process.env.SOURCE_COMMIT ||
      process.env.BOT_VERSION ||
      'dev'
    ).slice(0, 64),
    startedAt,
    // A failing probe reads « unknown » (null): reporting health must never cost the lease (the renewal would fail and
    // the instance stop itself).
    health: {
      eventSubBot: probe(() => health.bot?.connected() ?? false),
      eventSubBroadcaster: probe(() =>
        health.broadcaster ? health.broadcaster.connected() : null,
      ),
      broadcasterToken: health.broadcasterToken,
    },
    flags: botFlags(config),
  }),
});

/**
 * Stops every consumer at once, frees the lease (≤ 3 s), then exits with `code`. Every caller awaits the SAME stop,
 * which never hands back control: code after `await shutdown(…)` never runs (as with the former synchronous exit).
 */
let exiting: Promise<never> | null = null;
function shutdown(code: number, release = true): Promise<never> {
  exiting ??= (async () => {
    for (const stop of consumers) stop();
    if (release) await lease.release();
    process.exit(code);
  })() as Promise<never>;
  return exiting;
}
function authorizationLost(account: string, reason: string): void {
  console.error(
    `[twitch-bot] ${account}: ${reason}; consumers stopped, reauthorization required`,
  );
  void shutdown(78);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    console.log(`[twitch-bot] ${signal}: clean stop, lease released`);
    void shutdown(0);
  });

console.log(
  `[twitch-bot] instance ${instanceId} (${config.BOT_HOST}): waiting for the lease before connecting to Twitch`,
);
await lease.acquire();
// Another instance named holder: this one stops at once (no release: the lease is not its own) and exits 75; the
// supervisor (Docker / run-production.ps1) restarts it, in standby.
lease.keep((reason) => {
  console.error(
    reason.kind === 'lost'
      ? `[instance] bail perdu au profit de ${reason.holder.instanceId} (${reason.holder.host}) : arrêt immédiat de cette instance`
      : '[instance] bail non renouvelé à temps (Core injoignable ?) : arrêt de sécurité avant son expiration — une autre instance pourra le prendre',
  );
  void shutdown(75, false);
});
consumers.add(() => lease.stop());
const auth = new TwitchAuth({
  clientId: config.TWITCH_CLIENT_ID,
  clientSecret: config.TWITCH_CLIENT_SECRET,
  store: fileTokenStore(config.TWITCH_TOKEN_FILE),
  requiredScopes: requiredScopes({
    ...config,
    // This entry point does not run the Lab adapters; the main Core's chat games and alerts (lot 8) need the same
    // capabilities as the Lab adapter's. Random Ban's rights are never required at startup: its executor tells Core
    // what is missing (Core refuses what cannot be served) instead of stopping the bot.
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
  await shutdown(1);
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
  core: createCoreClient(
    config.CORE_API_URL,
    config.BOT_SECRET,
    fetch,
    botHeaders,
  ),
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
      ...botHeaders,
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
          // The Lab adapter's error shape: its retry rules (transient 5xx / 408 / 429, and 409 not_lease_holder while
          // the bot lease changes hands) apply unchanged.
          if (r.status < 200 || r.status >= 300)
            throw coreRefusal(r.status, r.body);
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
health.bot = botSocket;
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
// Random Ban V2 (RANDOM_BAN): the executor reads the moderators, the bans and the subscriptions with the broadcaster's
// Helix; it needs no broadcaster EventSub connection.
const randomBanOn = config.RANDOM_BAN === 'true';
// Caution (CAUTION): the list of bans with the broadcaster's Helix too (no EventSub connection).
const cautionOn = config.CAUTION === 'true';
// Votekick V2 (VOTEKICK): the moderators and the bans with the broadcaster's Helix too (no EventSub connection).
const votekickOn = config.VOTEKICK === 'true';
// Points de chaîne Twitch side (CP_TWITCH_ACTIONS): redemption statuses and Raptoru's reward, broadcaster's Helix.
const cpActionsOn = config.CP_TWITCH_ACTIONS === 'true';
let rbBroadcaster: { helix: Helix; scopes: string[] } | null = null;
if (
  loyaltyOn ||
  pointsOn ||
  randomBanOn ||
  cautionOn ||
  votekickOn ||
  cpActionsOn
) {
  let broadcasterReady = false;
  const broadcasterAuth = new TwitchAuth({
    clientId: config.TWITCH_CLIENT_ID,
    clientSecret: config.TWITCH_CLIENT_SECRET,
    store: fileTokenStore(config.TWITCH_BROADCASTER_TOKEN_FILE),
    // Random Ban's rights are checked by its executor (told to Core), never required here.
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
    health.broadcasterToken = true;
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
    rbBroadcaster = {
      helix: broadcasterHelix,
      scopes: broadcasterAuth.status().scopes,
    };
    const core = createCoreClient(
      config.CORE_API_URL,
      config.BOT_SECRET,
      fetch,
      botHeaders,
    );
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
    // Random Ban alone subscribes to nothing: no socket (Twitch closes an unused one).
    if (events || points) {
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
            await events.eventSub.notification(
              type,
              event,
              messageId,
              timestamp,
            );
        },
        log: events?.eventSub.log,
        revocation: (_type, reason) => authorizationLost('raptoru_', reason),
      });
      consumers.add(() => broadcasterSocket.stop());
      health.broadcaster = broadcasterSocket;
    }
    if (events) {
      // Tier reconciliation: full snapshot at startup, then every 6 hours (chained, never overlapping).
      const snapshotLoop = async () => {
        await events.syncSubscriptions();
        setTimeout(snapshotLoop, 6 * 60 * 60 * 1000);
      };
      await snapshotLoop();
    }
    console.log(
      `[twitch-bot] broadcaster events on: ${[loyaltyOn ? 'loyalty (subs, gifts, cheers, follows)' : '', pointsOn ? 'Points de chaîne (read only)' : '', randomBanOn ? 'Random Ban reads' : ''].filter(Boolean).join(' + ')}`,
    );
  } catch (error) {
    health.broadcasterToken = broadcasterReady;
    console.error(
      `[twitch-bot] broadcaster events OFF: ${(error as Error).message}`,
    );
  }
}

// Random Ban V2 (docs/RANDOM_BAN_V2.md, RANDOM_BAN=true): the Twitch executor of the requests the main Core queues
// (channel points rule, Studio's dry runs), the same as the Lab adapter's, on /v1/bot/random-ban with the bot secret.
// Core serializes (one Random Ban at a time per channel); without the broadcaster token it cannot search and says so.
if (randomBanOn) {
  const rb = rbBroadcaster;
  const randomBan = createRandomBanExecutor({
    core: coreCall,
    base: '/v1/bot/random-ban',
    channelId: config.TWITCH_BROADCASTER_ID,
    broadcasterId: config.TWITCH_BROADCASTER_ID,
    // Stable across restarts: a journaled timeout is reported with the same executor id.
    executorId: `bot-${status.userId}`,
    login: status.login ?? 'LeCroupier_',
    botScopes: status.scopes,
    broadcasterScopes: rb?.scopes ?? null,
    twitch: helixRbTwitch(
      coreHelix,
      rb?.helix ?? null,
      config.TWITCH_BROADCASTER_ID,
      status.userId!,
    ),
    journal: fileRbJournal(config.RANDOM_BAN_JOURNAL_FILE),
  });
  consumers.add(() => randomBan.stop());
  console.log(
    `[random-ban] exécuteur prêt (Core principal) — recherche : ${randomBan.ready.canSearch ? 'oui' : 'non'}, timeout : ${randomBan.ready.canTimeout ? 'oui' : 'non'}${randomBan.ready.missing.length ? ` (manque : ${randomBan.ready.missing.join(', ')})` : ''}`,
  );
  void randomBan.run();
}

// Caution (docs/CAUTION.md, CAUTION=true): the Twitch executor of the main Core's cautions, on /v1/bot/caution with the
// bot secret. Core debits only after this executor's fresh read; it unbans only once Core said « proceed ».
if (cautionOn) {
  const bh = rbBroadcaster;
  const caution = createCautionExecutor({
    core: coreCall,
    base: '/v1/bot/caution',
    channelId: config.TWITCH_BROADCASTER_ID,
    broadcasterId: config.TWITCH_BROADCASTER_ID,
    // Stable across restarts: a journaled release is reported with the same executor id.
    executorId: `bot-${status.userId}`,
    login: status.login ?? 'LeCroupier_',
    botScopes: status.scopes,
    broadcasterScopes: bh?.scopes ?? null,
    twitch: helixCautionTwitch(
      coreHelix,
      bh?.helix ?? null,
      config.TWITCH_BROADCASTER_ID,
      status.userId!,
    ),
    journal: fileCautionJournal(config.CAUTION_JOURNAL_FILE),
  });
  consumers.add(() => caution.stop());
  console.log(
    `[caution] exécuteur prêt (Core principal) — lecture : ${caution.ready.canRead ? 'oui' : 'non'}, levée : ${caution.ready.canRelease ? 'oui' : 'non'}${caution.ready.missing.length ? ` (manque : ${caution.ready.missing.join(', ')})` : ''}`,
  );
  void caution.run();
}

// Votekick V2 (docs/VOTEKICK_V2.md, VOTEKICK=true): the Twitch executor of the main Core's votes, on /v1/bot/votekick with
// the bot secret. It reads the target and the moderators; it times out only the user Core names, once (journal first).
if (votekickOn) {
  const bh = rbBroadcaster;
  const votekick = createVotekickExecutor({
    core: coreCall,
    base: '/v1/bot/votekick',
    channelId: config.TWITCH_BROADCASTER_ID,
    broadcasterId: config.TWITCH_BROADCASTER_ID,
    // Stable across restarts: a journaled timeout is reported with the same executor id.
    executorId: `bot-${status.userId}`,
    login: status.login ?? 'LeCroupier_',
    botScopes: status.scopes,
    broadcasterScopes: bh?.scopes ?? null,
    twitch: helixVotekickTwitch(
      coreHelix,
      bh?.helix ?? null,
      config.TWITCH_BROADCASTER_ID,
      status.userId!,
    ),
    journal: fileVotekickJournal(config.VOTEKICK_JOURNAL_FILE),
  });
  consumers.add(() => votekick.stop());
  console.log(
    `[votekick] exécuteur prêt (Core principal) — lecture : ${votekick.ready.canRead ? 'oui' : 'non'}, timeout : ${votekick.ready.canTimeout ? 'oui' : 'non'}${votekick.ready.missing.length ? ` (manque : ${votekick.ready.missing.join(', ')})` : ''}`,
  );
  void votekick.run();
}

// Points de chaîne, Twitch side (docs/SPOTIFY_V2.md § 7, CP_TWITCH_ACTIONS=true): the redemption statuses (refunds) and
// Raptoru's reward, decided by the main Core, run once here with the broadcaster's token.
if (cpActionsOn) {
  const bh = rbBroadcaster;
  const broadcasterId = config.TWITCH_BROADCASTER_ID;
  const cpActions = createCpTwitchActionsExecutor({
    core: coreCall,
    base: '/v1/bot/channel-points/twitch-actions',
    channelId: broadcasterId,
    scopes: bh?.scopes ?? null,
    twitch: bh
      ? {
          updateRedemptionStatus: (rewardId, redemptionId, s) =>
            bh.helix.updateRedemptionStatus(
              broadcasterId,
              rewardId,
              redemptionId,
              s,
            ),
          createCustomReward: (reward) =>
            bh.helix.createCustomReward(broadcasterId, reward),
        }
      : null,
  });
  consumers.add(() => cpActions.stop());
  console.log(
    `[cp-twitch] exécuteur prêt (Core principal) — gestion des récompenses : ${cpActions.ready.canManage ? 'oui' : 'non (droit channel:manage:redemptions absent)'}`,
  );
  void cpActions.run();
}
