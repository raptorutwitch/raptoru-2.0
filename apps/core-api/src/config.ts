import { z } from 'zod';

const Env = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    BOT_SECRET: z.string().min(16),
    STUDIO_SECRET: z.string().min(16),
    // Only a fake provider exists before the StreamElements cutover: no real jetons can move.
    DAILY_CREDIT_PROVIDER: z.enum(['dev-fake']).default('dev-fake'),
    /** Daily claims credited into the Core Wallet. Off: claims are real, zero Wallet write. */
    DAILY_WALLET_CREDITS: z.enum(['true', 'false']).default('false'),
    // Economy of the paying modules: the Lab test wallet (default) or the canonical Wallet. Canonical is refused at
    // start unless economy/activation.ts selectEconomy accepts it (opening imports applied, modules proven…).
    ECONOMY_MODE: z.enum(['lab', 'canonical']).default('lab'),
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
    // Lot 9: freshness of the alerts' animation (seconds since the Twitch event). Absent = off (no value chosen yet):
    // every alert is animated whatever its delay. Never touches a gain (Roue du Sub, Loyalty).
    ALERTS_MAX_AGE_SECONDS: z.coerce.number().int().positive().optional(),
    // Twitch app (client credentials, read-only Get Users): viewer names and Tombola avatars. Optional.
    TWITCH_APP_CLIENT_ID: z.string().min(1).optional(),
    TWITCH_APP_CLIENT_SECRET: z.string().min(1).optional(),
    // Caution (docs/CAUTION.md): `!caution` / `oui` / `non` answered by this Core. OFF until the cutover: SAMMI still
    // answers `!caution` in production (both on = two quotes, two debits).
    CAUTION_CHAT: z.enum(['true', 'false']).default('false'),
    // Votekick V2 (docs/VOTEKICK_V2.md): `!votekick` / `!kick` / `!save` answered by this Core. OFF by default.
    VOTEKICK_CHAT: z.enum(['true', 'false']).default('false'),
    // Spotify V2 (docs/SPOTIFY_V2.md): `!song`, `!songqueue`, `!mysong`, `!songcancel`, `!songremove`, `!songskip`
    // answered by this Core. OFF by default (the song requests themselves follow the channel points rule).
    SPOTIFY_CHAT: z.enum(['true', 'false']).default('false'),
    // Bonk Twitch emotes on /v1/ext: the HTTPS OAuth redirect registered on that same Twitch app
    // (…/v1/ext/emotes/oauth/callback). Absent = no linking. Needs the app and EXT_TOKEN_KEY.
    EXT_TWITCH_REDIRECT_URI: z
      .string()
      .url()
      .refine((u) => u.startsWith('https://'), 'https only')
      .optional(),
    // Delivery tooling (docs/CICD.md): bearer token of the read-only GET /v1/ops/status. Absent = no such route.
    OPS_TOKEN: z.string().min(32).optional(),
    // The commit this image was built from (Coolify passes it as SOURCE_COMMIT): reported by /v1/ops/status.
    SOURCE_COMMIT: z.string().optional(),
    // Viewer OAuth tokens encrypted at rest (AES-256-GCM): 32 random bytes, base64.
    EXT_TOKEN_KEY: z
      .string()
      .refine((k) => Buffer.from(k, 'base64').length === 32, '32 bytes, base64')
      .optional(),
  })
  .superRefine((env, ctx) => {
    if (!env.EXT_TWITCH_REDIRECT_URI) return;
    for (const key of [
      'EXT_TOKEN_KEY',
      'TWITCH_APP_CLIENT_ID',
      'TWITCH_APP_CLIENT_SECRET',
    ] as const)
      if (!env[key])
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'required by EXT_TWITCH_REDIRECT_URI',
        });
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
