import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  BOT_SECRET: z.string().min(16),
  STUDIO_SECRET: z.string().min(16),
  // Only a fake provider exists before the StreamElements cutover: no real jetons can move.
  DAILY_CREDIT_PROVIDER: z.enum(['dev-fake']).default('dev-fake'),
  /** Daily claims credited into the Core Wallet. Off: claims are real, zero Wallet write. */
  DAILY_WALLET_CREDITS: z.enum(['true', 'false']).default('false'),
  // Loyalty Engine. Preview computes and stores rewards without any Wallet write. The two credit
  // flags are the only way to write Jetons from loyalty rewards: never enable them before cutover.
  LOYALTY_PREVIEW: z.enum(['true', 'false']).default('false'),
  LOYALTY_PASSIVE_CREDITS: z.enum(['true', 'false']).default('false'),
  LOYALTY_EVENT_CREDITS: z.enum(['true', 'false']).default('false'),
  // The channel this Core serves (Twitch broadcaster id / login): viewer frontier and Studio cockpit.
  TWITCH_CHANNEL_ID: z
    .string()
    .regex(/^\d{1,32}$/)
    .optional(),
  TWITCH_CHANNEL_LOGIN: z.string().min(1).max(64).default('raptoru_'),
  // Twitch Extension secret (base64, from the developer console): enables /v1/ext/*. Absent = off.
  TWITCH_EXTENSION_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9+/]{20,}={0,2}$/)
    .optional(),
  // Shown to the extension; payment stays simulated whatever this says (Lab test wallet).
  CORE_ENVIRONMENT: z.enum(['staging']).default('staging'),
  // Twitch app (client credentials, read-only Get Users): viewer names and Tombola avatars. Optional.
  TWITCH_APP_CLIENT_ID: z.string().min(1).optional(),
  TWITCH_APP_CLIENT_SECRET: z.string().min(1).optional(),
});

export type CoreConfig = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const result = Env.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`invalid core-api environment: ${fields}`);
  }
  return result.data;
}
