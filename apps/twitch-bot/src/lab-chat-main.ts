import { z } from 'zod';
import { loadTwitchAppConfig } from './config.js';
import { createLabChatIngest } from './lab-chat-ingest.js';
import { AuthError, fileTokenStore, TwitchAuth } from './twitch/auth.js';
import { runEventSub } from './twitch/eventsub.js';
import { createHelix } from './twitch/helix.js';

// Lab chat ingestion: Twitch chat + stream state → local Lab Core (routed there to every Lab module).
// Started by Raptoru Studio only when its « Ingestion chat Twitch » switch is ON (OFF by default);
// never by the production bot. Reads the chat (scope user:read:chat), writes nothing to it, decides
// nothing: Core does.

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
});

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
  process.exit(1);
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
// Hourly token validation (required by Twitch).
setInterval(
  () => {
    auth.validate().catch((error) => {
      console.error(
        `[lab-chat] token validation failed${error instanceof AuthError ? ` (${error.code})` : ''}`,
      );
      if (auth.status().state === 'failed') process.exit(1);
    });
  },
  60 * 60 * 1000,
);
