import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { TWITCH_OAUTH_PROFILES, missingTwitchScopes } from '@raptoru/schemas';
import { loadTwitchAppConfig } from './config.js';
import {
  CP_READ_SCOPE,
  canReadChannelPoints,
  createChannelPointsEvents,
  type CpOutboxEvent,
} from './channel-points-events.js';
import {
  ALERTS_MODES,
  type AlertOutboxEvent,
  createLabAlertsIngest,
} from './lab-alerts-ingest.js';
import { fileOutbox, memoryOutbox } from './loyalty-outbox.js';
import { createLabChatIngest } from './lab-chat-ingest.js';
import {
  createLabChatOutput,
  createRateLimiter,
  fileJournal,
} from './lab-chat-output.js';
import {
  createRandomBanExecutor,
  fileRbJournal,
  RB_SCOPES,
} from './random-ban-executor.js';
import {
  createCautionExecutor,
  fileCautionJournal,
  helixCautionTwitch,
} from './caution-executor.js';
import { fileTokenStore, TwitchAuth } from './twitch/auth.js';
import { superviseTwitchAuth } from './twitch/auth-supervision.js';
import { runEventSub } from './twitch/eventsub.js';
import { createHelix } from './twitch/helix.js';

// Lab chat ingestion: Twitch chat + stream state → local Lab Core (routed there to every Lab module).
// Started by Raptoru Studio only when its « Ingestion chat Twitch » switch is ON (OFF by default);
// never by the production bot. Reads the chat (scope user:read:chat) and decides nothing: Core does.
// Commands V2 output (phase C): when the token holds user:write:chat, the same process executes the
// steps Core hands out — Core hands out nothing while Studio's « Sortie chat réelle » is OFF (default).

const Env = z.object({
  LAB_CHAT_CORE_URL: z
    .url()
    .refine((u) => /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(u), {
      message: 'local Lab Core only',
    }),
  LAB_CHAT_SECRET: z.string().min(32),
  LAB_CHAT_CHANNEL_ID: z
    .string()
    .regex(/^\d{1,32}$/)
    .default('900100'),
  /** Messages per 30 s (Twitch: 20 regular account, 100 moderator). Default: the safe 20. */
  LAB_CHAT_OUTPUT_RATE: z.coerce.number().int().min(1).max(100).default(20),
  /** Twitch alerts (Studio « Événements Twitch réels »): off (default) / test (log only) / active (Lab queue). */
  LAB_ALERTS_MODE: z.enum(ALERTS_MODES).default('off'),
  /** Alerts channel of the Lab Core (Studio's alerts runtime); default: the Lab channel. */
  LAB_ALERTS_CHANNEL_ID: z
    .string()
    .regex(/^\d{1,32}$/)
    .optional(),
  /** Helix stream-state repair period (same setting and default as the main bot). */
  STREAM_SYNC_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
  /** Channel points redemptions not yet answered by the Lab Core (durable, resumed at start). */
  LAB_CHANNEL_POINTS_OUTBOX_FILE: z
    .string()
    .min(1)
    .default(
      fileURLToPath(
        new URL('../.lab-channel-points-outbox.json', import.meta.url),
      ),
    ),
  /** Alerts received from Twitch and not yet answered by the Lab Core (durable, resumed at start). */
  LAB_ALERTS_OUTBOX_FILE: z
    .string()
    .min(1)
    .default(
      fileURLToPath(new URL('../.lab-alerts-outbox.json', import.meta.url)),
    ),
});

/** Unusable Twitch token: Studio's supervision shows it and does not restart (EXIT_AUTH in ingress.ts). */
const EXIT_AUTH = 78;
const consumers = new Set<() => void>();
function authorizationLost(account: string, reason: string): never {
  console.error(
    `[lab-chat] ${account}: ${reason}; consumers stopped, reauthorization required`,
  );
  for (const stop of consumers) stop();
  process.exit(EXIT_AUTH);
}

const env = Env.parse(process.env);
const app = loadTwitchAppConfig();
const auth = new TwitchAuth({
  clientId: app.TWITCH_CLIENT_ID,
  clientSecret: app.TWITCH_CLIENT_SECRET,
  store: fileTokenStore(app.TWITCH_TOKEN_FILE),
  requiredScopes: ['user:read:chat'],
  expectedUserId: TWITCH_OAUTH_PROFILES.bot.expectedUserId,
  onFailure: (code) => authorizationLost('LeCroupier_', code),
});
try {
  await auth.init();
} catch (error) {
  console.error(`[lab-chat] Twitch auth unusable: ${(error as Error).message}`);
  // Twitch unreachable is not final (Studio restarts the adapter); a refused token is.
  process.exit(auth.status().state === 'failed' ? EXIT_AUTH : 1);
}
const status = auth.status();
const botValidation = superviseTwitchAuth(
  auth,
  (reason) => authorizationLost('LeCroupier_', reason),
  {
    log: (message) => console.error(`[lab-chat] ${message}`),
  },
);
consumers.add(() => botValidation.stop());
const helix = createHelix({
  clientId: app.TWITCH_CLIENT_ID,
  getAccessToken: () => auth.getAccessToken(),
  handleUnauthorized: (rejected) => auth.handleUnauthorized(rejected),
});
const lab = async (path: string, body: unknown) => {
  const res = await fetch(new URL(path, env.LAB_CHAT_CORE_URL), {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${env.LAB_CHAT_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const out = (await res.json()) as unknown;
  if (!res.ok) throw new Error(`lab_core_${res.status}`);
  return out;
};
/** Lab Core call with its HTTP status (the output executor reads 409 answers). */
const labCall = async (path: string, body: unknown) => {
  const res = await fetch(new URL(path, env.LAB_CHAT_CORE_URL), {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${env.LAB_CHAT_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, body: (await res.json()) as unknown };
};
const alerts = createLabAlertsIngest({
  mode: env.LAB_ALERTS_MODE,
  channelId: env.LAB_ALERTS_CHANNEL_ID ?? env.LAB_CHAT_CHANNEL_ID,
  broadcasterId: app.TWITCH_BROADCASTER_ID,
  tokenUserId: status.userId!,
  scopes: status.scopes,
  lab,
  // ACTIVE only: written before it is sent, removed once the Lab Core answered (a sub is also a wheel gain).
  outbox:
    env.LAB_ALERTS_MODE === 'active'
      ? fileOutbox<AlertOutboxEvent>(env.LAB_ALERTS_OUTBOX_FILE)
      : memoryOutbox<AlertOutboxEvent>(),
});
// What a previous run received and the Lab Core never answered: sent again (same ids, Core deduplicates).
void alerts.resumePending();
const ingest = createLabChatIngest({
  lab,
  labChannelId: env.LAB_CHAT_CHANNEL_ID,
  broadcasterId: app.TWITCH_BROADCASTER_ID,
  tokenUserId: status.userId!,
  subscribe: (type, condition, sessionId, version) =>
    helix.subscribe(type, condition, sessionId, version),
  alerts,
  getStream: () => helix.getStream(app.TWITCH_BROADCASTER_ID),
});
consumers.add(() => ingest.close());
console.log(
  `[lab-chat] reading the chat of ${app.TWITCH_BROADCASTER_ID} as ${status.login} → Lab channel ${env.LAB_CHAT_CHANNEL_ID}`,
);
console.log(
  `[lab-alerts] événements Twitch réels : ${env.LAB_ALERTS_MODE.toUpperCase()}`,
);
// Every (re)connection re-subscribes, then re-reads the real stream state (a missed online / offline
// event while disconnected is caught up).
const botSocket = runEventSub({
  ...ingest.handlers,
  revocation: (_type, reason) => authorizationLost('LeCroupier_', reason),
  async subscribe(sessionId) {
    await ingest.handlers.subscribe(sessionId);
    await ingest
      .syncStream()
      .catch((e) =>
        console.error('[lab-chat] stream sync failed', (e as Error).message),
      );
  },
});
consumers.add(() => botSocket.stop());
// The broadcaster token serves two independent modules: Points de chaîne (read OR manage redemptions)
// and Random Ban's moderation/subscription reads. Only Points de chaîne opens a second EventSub socket.
// Never run beside the production bot's broadcaster consumer.
const broadcaster = await (async () => {
  // Stored scopes first: do not validate/refresh a token that serves neither module.
  const stored = await fileTokenStore(app.TWITCH_BROADCASTER_TOKEN_FILE)
    .load()
    .catch(() => null);
  const canPoints = canReadChannelPoints(stored?.scopes ?? []);
  const canRandomBan =
    stored &&
    missingTwitchScopes(stored.scopes, RB_SCOPES.broadcaster).length === 0;
  if (!canPoints && !canRandomBan) {
    console.log(
      '[channel-points] réception désactivée : droits broadcaster absents (Points de chaîne / Random Ban)',
    );
    return null;
  }
  let broadcasterReady = false;
  const pointsAuth = new TwitchAuth({
    clientId: app.TWITCH_CLIENT_ID,
    clientSecret: app.TWITCH_CLIENT_SECRET,
    store: fileTokenStore(app.TWITCH_BROADCASTER_TOKEN_FILE),
    requiredScopes: [
      ...(canPoints ? [CP_READ_SCOPE] : []),
      ...(canRandomBan ? RB_SCOPES.broadcaster : []),
    ],
    expectedUserId: TWITCH_OAUTH_PROFILES.broadcaster.expectedUserId,
    onFailure: (code) => {
      // Missing/rejected broadcaster authorization at startup only disables its modules.
      if (broadcasterReady) authorizationLost('raptoru_', code);
    },
  });
  try {
    await pointsAuth.init();
    if (pointsAuth.status().userId !== app.TWITCH_BROADCASTER_ID)
      throw new Error('broadcaster token of another account');
    broadcasterReady = true;
  } catch (error) {
    console.log(
      `[lab-chat] broadcaster indisponible (${(error as Error).message})`,
    );
    return null;
  }
  const broadcasterHelix = createHelix({
    clientId: app.TWITCH_CLIENT_ID,
    getAccessToken: () => pointsAuth.getAccessToken(),
    handleUnauthorized: (rejected) => pointsAuth.handleUnauthorized(rejected),
  });
  const validation = superviseTwitchAuth(
    pointsAuth,
    (reason) => authorizationLost('raptoru_', reason),
    {
      log: (message) => console.error(`[lab-chat] broadcaster: ${message}`),
    },
  );
  consumers.add(() => validation.stop());
  const events = canPoints
    ? createChannelPointsEvents({
        channelId: env.LAB_ALERTS_CHANNEL_ID ?? env.LAB_CHAT_CHANNEL_ID,
        broadcasterId: app.TWITCH_BROADCASTER_ID,
        postRedemption: (body) =>
          lab('/v1/lab/channel-points/redemptions', body),
        postRedemptionUpdate: (body) =>
          lab('/v1/lab/channel-points/redemptions/status', body),
        outbox: fileOutbox<CpOutboxEvent>(env.LAB_CHANNEL_POINTS_OUTBOX_FILE),
        postRewards: (body) => lab('/v1/lab/channel-points/rewards', body),
        subscribe: (type, condition, sessionId, version) =>
          broadcasterHelix.subscribe(type, condition, sessionId, version),
        getCustomRewards: () =>
          broadcasterHelix.getCustomRewards(app.TWITCH_BROADCASTER_ID),
      })
    : null;
  if (events) {
    consumers.add(() => events.close());
    void events.resumePending();
    const socket = runEventSub({
      async subscribe(sessionId) {
        await events.subscribe(sessionId);
        void events.syncRewards();
      },
      async notification(type, event) {
        await events.handle(type, event);
      },
      revocation: (_type, reason) => authorizationLost('raptoru_', reason),
    });
    consumers.add(() => socket.stop());
    console.log(
      '[channel-points] connexion prête ; abonnement aux récompenses en attente',
    );
  }
  // Random Ban V2 reads the moderators, the bans and the subscriptions with this same broadcaster connection.
  return {
    events,
    helix: broadcasterHelix,
    scopes: pointsAuth.status().scopes,
  };
})();
// Stopping (Studio OFF / closing): chat retries in memory are dropped explicitly, never persisted.
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    for (const stop of consumers) stop();
    process.exit(0);
  });
// Lost stream transitions (Core down when the event came) are repaired from Helix, like the main bot's
// loop: chained timers, never overlapping.
const reconcileLoop = async () => {
  await ingest
    .reconcileStream()
    .catch((e) =>
      console.error('[lab-chat] stream repair failed', (e as Error).message),
    );
  setTimeout(() => void reconcileLoop(), env.STREAM_SYNC_INTERVAL_MS);
};
setTimeout(() => void reconcileLoop(), env.STREAM_SYNC_INTERVAL_MS);
// Commands V2 output executor: only with a token allowed to write (the switch itself lives in Core).
if (status.scopes.includes('user:write:chat')) {
  const output = createLabChatOutput({
    core: labCall,
    channelId: env.LAB_CHAT_CHANNEL_ID,
    executorId: `lab-chat-${status.userId}`,
    scopes: status.scopes,
    send: {
      chat: (text, replyTo) =>
        helix.sendChat(
          app.TWITCH_BROADCASTER_ID,
          status.userId!,
          text,
          replyTo,
        ),
      announce: (text) =>
        helix.sendAnnouncement(app.TWITCH_BROADCASTER_ID, status.userId!, text),
    },
    journal: fileJournal(app.LAB_CHAT_JOURNAL_FILE),
    limiter: createRateLimiter({
      max: env.LAB_CHAT_OUTPUT_RATE,
      windowMs: 30_000,
    }),
  });
  consumers.add(() => output.stop());
  console.log(
    `[lab-chat] output executor ready (${env.LAB_CHAT_OUTPUT_RATE} msg / 30 s); Core decides « Sortie chat réelle »`,
  );
  void output.run();
} else
  console.log(
    '[lab-chat] output executor off: the token lacks user:write:chat (nothing can be sent)',
  );
// Random Ban V2 (docs/RANDOM_BAN_V2.md): the Twitch executor of the Random Ban requests Core queues (the channel
// points rule; Studio's dry runs). It always tells Core what its tokens allow; it times out only with LeCroupier_'s
// moderator:manage:banned_users, and searches only with the broadcaster's moderation:read + channel:read:subscriptions.
{
  const bh = broadcaster?.helix ?? null;
  const rbChannel = env.LAB_ALERTS_CHANNEL_ID ?? env.LAB_CHAT_CHANNEL_ID;
  const randomBan = createRandomBanExecutor({
    core: labCall,
    channelId: rbChannel,
    broadcasterId: app.TWITCH_BROADCASTER_ID,
    executorId: `lab-chat-${status.userId}`,
    login: status.login ?? 'LeCroupier_',
    botScopes: status.scopes,
    broadcasterScopes: broadcaster?.scopes ?? null,
    twitch: {
      chattersPage: async (after) => {
        const p = await helix.getChattersPage(
          app.TWITCH_BROADCASTER_ID,
          status.userId!,
          after,
        );
        return {
          chatters: p.chatters.map((c) => ({
            id: c.twitchUserId,
            login: c.login,
            name: c.displayName,
          })),
          cursor: p.cursor,
        };
      },
      moderators: (ids) =>
        bh
          ? bh.getModeratorIds(app.TWITCH_BROADCASTER_ID, ids)
          : Promise.reject(new Error('broadcaster_token_absent')),
      bans: (ids) =>
        bh
          ? bh.getBans(app.TWITCH_BROADCASTER_ID, ids)
          : Promise.reject(new Error('broadcaster_token_absent')),
      follows: (id) => helix.isFollower(app.TWITCH_BROADCASTER_ID, id),
      subscribers: (ids) =>
        bh
          ? bh.getSubscriberIds(app.TWITCH_BROADCASTER_ID, ids)
          : Promise.reject(new Error('broadcaster_token_absent')),
      ban: (id, duration, reason) =>
        helix.timeoutUser(
          app.TWITCH_BROADCASTER_ID,
          status.userId!,
          id,
          duration,
          reason,
        ),
    },
    journal: fileRbJournal(app.LAB_RANDOM_BAN_JOURNAL_FILE),
  });
  consumers.add(() => randomBan.stop());
  console.log(
    `[random-ban] exécuteur prêt — recherche : ${randomBan.ready.canSearch ? 'oui' : 'non'}, timeout : ${randomBan.ready.canTimeout ? 'oui' : 'non'}${randomBan.ready.missing.length ? ` (manque : ${randomBan.ready.missing.join(', ')})` : ''}`,
  );
  void randomBan.run();
}
// Caution (docs/CAUTION.md): the Twitch executor of the Lab Core's cautions — the lookup and the unban with
// LeCroupier_'s token, the list of bans with the broadcaster's. A Studio simulator message is a dry run (Core never
// hands it a release).
{
  const cautionChannel = env.LAB_ALERTS_CHANNEL_ID ?? env.LAB_CHAT_CHANNEL_ID;
  const caution = createCautionExecutor({
    core: labCall,
    channelId: cautionChannel,
    broadcasterId: app.TWITCH_BROADCASTER_ID,
    executorId: `lab-chat-${status.userId}`,
    login: status.login ?? 'LeCroupier_',
    botScopes: status.scopes,
    broadcasterScopes: broadcaster?.scopes ?? null,
    twitch: helixCautionTwitch(
      helix,
      broadcaster?.helix ?? null,
      app.TWITCH_BROADCASTER_ID,
      status.userId!,
    ),
    journal: fileCautionJournal(app.LAB_CAUTION_JOURNAL_FILE),
  });
  consumers.add(() => caution.stop());
  console.log(
    `[caution] exécuteur prêt — lecture : ${caution.ready.canRead ? 'oui' : 'non'}, levée : ${caution.ready.canRelease ? 'oui' : 'non'}${caution.ready.missing.length ? ` (manque : ${caution.ready.missing.join(', ')})` : ''}`,
  );
  void caution.run();
}
