import { z } from 'zod';

const Env = z.object({
  CORE_API_URL: z.url(),
  BOT_SECRET: z.string().min(16),
  TWITCH_CLIENT_ID: z.string().min(1),
  // User token of the bot account (scopes: user:read:chat, user:write:chat).
  TWITCH_USER_ACCESS_TOKEN: z.string().min(1),
  TWITCH_BOT_USER_ID: z.string().regex(/^\d+$/),
  TWITCH_BROADCASTER_ID: z.string().regex(/^\d+$/),
  STREAM_SYNC_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
});

export type BotConfig = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const result = Env.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`invalid twitch-bot environment: ${fields}`);
  }
  return result.data;
}
