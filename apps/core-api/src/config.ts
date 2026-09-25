import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  BOT_SECRET: z.string().min(16),
  STUDIO_SECRET: z.string().min(16),
  // Only a fake provider exists before the StreamElements cutover: no real jetons can move.
  DAILY_CREDIT_PROVIDER: z.enum(['dev-fake']).default('dev-fake'),
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
