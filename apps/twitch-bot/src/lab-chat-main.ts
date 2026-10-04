import { z } from 'zod';
import { loadTwitchAppConfig } from './config.js';
import { createLabChatIngest } from './lab-chat-ingest.js';
import {
  createLabChatOutput,
  createRateLimiter,
  fileJournal,
} from './lab-chat-output.js';
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
const ingest = createLabChatIngest({
  lab,
  labChannelId: env.LAB_CHAT_CHANNEL_ID,
  broadcasterId: app.TWITCH_BROADCASTER_ID,
  tokenUserId: status.userId!,
  subscribe: (type, condition, sessionId) =>
    helix.subscribe(type, condition, sessionId),
  getStream: () => helix.getStream(app.TWITCH_BROADCASTER_ID),
});
console.log(
  `[lab-chat] reading the chat of ${app.TWITCH_BROADCASTER_ID} as ${status.login} → Lab channel ${env.LAB_CHAT_CHANNEL_ID}`,
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
