import { z } from 'zod';
import { loadTwitchAppConfig } from './config.js';
import {
  CP_READ_SCOPE,
  createChannelPointsEvents,
} from './channel-points-events.js';
import { ALERTS_MODES, createLabAlertsIngest } from './lab-alerts-ingest.js';
import { createLabChatIngest } from './lab-chat-ingest.js';
import {
  createLabChatOutput,
  createRateLimiter,
  fileJournal,
} from './lab-chat-output.js';
import {
  createRandomBanExecutor,
  fileRbJournal,
} from './random-ban-executor.js';
import { AuthError, fileTokenStore, TwitchAuth } from './twitch/auth.js';
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
});

/** Unusable Twitch token: Studio's supervision shows it and does not restart (EXIT_AUTH in ingress.ts). */
const EXIT_AUTH = 78;

const env = Env.parse(process.env);
const app = loadTwitchAppConfig();
const auth = new TwitchAuth({
  clientId: app.TWITCH_CLIENT_ID,
  clientSecret: app.TWITCH_CLIENT_SECRET,
  store: fileTokenStore(app.TWITCH_TOKEN_FILE),
  requiredScopes: ['user:read:chat'],
});
try {
  await auth.init();
} catch (error) {
  console.error(`[lab-chat] Twitch auth unusable: ${(error as Error).message}`);
  // Twitch unreachable is not final (Studio restarts the adapter); a refused token is.
  process.exit(auth.status().state === 'failed' ? EXIT_AUTH : 1);
}
const status = auth.status();
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
});
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
console.log(
  `[lab-chat] reading the chat of ${app.TWITCH_BROADCASTER_ID} as ${status.login} → Lab channel ${env.LAB_CHAT_CHANNEL_ID}`,
);
console.log(
  `[lab-alerts] événements Twitch réels : ${env.LAB_ALERTS_MODE.toUpperCase()}`,
);
// Every (re)connection re-subscribes, then re-reads the real stream state (a missed online / offline
// event while disconnected is caught up).
runEventSub({
  ...ingest.handlers,
  async subscribe(sessionId) {
    await ingest.handlers.subscribe(sessionId);
    await ingest
      .syncStream()
      .catch((e) =>
        console.error('[lab-chat] stream sync failed', (e as Error).message),
      );
  },
});
// Points de chaîne V1 (read only): Twitch requires the BROADCASTER's authorization for the redemption events, which
// LeCroupier_'s token cannot carry — so a broadcaster-token connection carrying ONLY this subscription, opened only
// when that token holds channel:read:redemptions (Antoni's explicit authorization). Core's master switch (OFF by
// default) decides whether anything is executed. Never run beside the production bot's broadcaster connection.
const points = await (async () => {
  // Stored scopes first, without any network call: a token without the scope is never validated nor refreshed
  // (a refresh rewrites the token file) by this adapter.
  const stored = await fileTokenStore(app.TWITCH_BROADCASTER_TOKEN_FILE)
    .load()
    .catch(() => null);
  if (!stored?.scopes?.includes(CP_READ_SCOPE)) {
    console.log(
      `[channel-points] réception désactivée : le jeton broadcaster n'a pas ${CP_READ_SCOPE}`,
    );
    return null;
  }
  const pointsAuth = new TwitchAuth({
    clientId: app.TWITCH_CLIENT_ID,
    clientSecret: app.TWITCH_CLIENT_SECRET,
    store: fileTokenStore(app.TWITCH_BROADCASTER_TOKEN_FILE),
    requiredScopes: [CP_READ_SCOPE],
  });
  try {
    await pointsAuth.init();
    if (pointsAuth.status().userId !== app.TWITCH_BROADCASTER_ID)
      throw new Error('broadcaster token of another account');
  } catch (error) {
    console.log(
      `[channel-points] réception désactivée : jeton broadcaster sans ${CP_READ_SCOPE} (${(error as Error).message})`,
    );
    return null;
  }
  const broadcasterHelix = createHelix({
    clientId: app.TWITCH_CLIENT_ID,
    getAccessToken: () => pointsAuth.getAccessToken(),
    handleUnauthorized: (rejected) => pointsAuth.handleUnauthorized(rejected),
  });
  const events = createChannelPointsEvents({
    channelId: env.LAB_ALERTS_CHANNEL_ID ?? env.LAB_CHAT_CHANNEL_ID,
    broadcasterId: app.TWITCH_BROADCASTER_ID,
    postRedemption: (body) => lab('/v1/lab/channel-points/redemptions', body),
    postRewards: (body) => lab('/v1/lab/channel-points/rewards', body),
    subscribe: (type, condition, sessionId, version) =>
      broadcasterHelix.subscribe(type, condition, sessionId, version),
    getCustomRewards: () =>
      broadcasterHelix.getCustomRewards(app.TWITCH_BROADCASTER_ID),
  });
  runEventSub({
    async subscribe(sessionId) {
      await events.subscribe(sessionId);
      void events.syncRewards();
    },
    async notification(type, event) {
      await events.handle(type, event);
    },
  });
  console.log(
    '[channel-points] réception des récompenses active (lecture seule)',
  );
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
    ingest.close();
    points?.events.close();
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
  const bh = points?.helix ?? null;
  const rbChannel = env.LAB_ALERTS_CHANNEL_ID ?? env.LAB_CHAT_CHANNEL_ID;
  const randomBan = createRandomBanExecutor({
    core: labCall,
    channelId: rbChannel,
    broadcasterId: app.TWITCH_BROADCASTER_ID,
    executorId: `lab-chat-${status.userId}`,
    login: status.login ?? 'LeCroupier_',
    botScopes: status.scopes,
    broadcasterScopes: points?.scopes ?? null,
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
  console.log(
    `[random-ban] exécuteur prêt — recherche : ${randomBan.ready.canSearch ? 'oui' : 'non'}, timeout : ${randomBan.ready.canTimeout ? 'oui' : 'non'}${randomBan.ready.missing.length ? ` (manque : ${randomBan.ready.missing.join(', ')})` : ''}`,
  );
  void randomBan.run();
}
// Hourly token validation (required by Twitch).
setInterval(
  () => {
    auth.validate().catch((error) => {
      console.error(
        `[lab-chat] token validation failed${error instanceof AuthError ? ` (${error.code})` : ''}`,
      );
      if (auth.status().state === 'failed') process.exit(EXIT_AUTH);
    });
  },
  60 * 60 * 1000,
);
