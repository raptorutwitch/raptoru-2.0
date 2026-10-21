import { z } from 'zod';

// Single active production bot (docs/PLAN_POST_LIVE_2026-10-21.md, lot 1): wherever it runs (VPS container, PC), a bot
// instance connects to Twitch only while it holds the Core's lease, renewed with its health. Never a secret in here.

export const BOT_LEASE_TTL_SECONDS = 45;
export const BOT_LEASE_RENEW_SECONDS = 15;

/** Booleans only, never a value: a flag name → on / off (or a mode such as ALERTS_MODE). */
export const BotFlags = z
  .record(
    z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/),
    z.union([z.boolean(), z.string().regex(/^[a-z_]{1,16}$/)]),
  )
  .refine((f) => Object.keys(f).length <= 32, 'too many flags');
export type BotFlags = z.infer<typeof BotFlags>;

/** What the bot knows of its own connections (null: not used by this configuration). */
export const BotHealth = z.object({
  eventSubBot: z.boolean().nullable(),
  eventSubBroadcaster: z.boolean().nullable(),
  broadcasterToken: z.boolean().nullable(),
});
export type BotHealth = z.infer<typeof BotHealth>;

export const BotLeaseRequest = z.object({
  instanceId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  host: z.string().regex(/^[a-z0-9-]{1,32}$/),
  version: z.string().min(1).max(64),
  startedAt: z.iso.datetime({ offset: true }),
  health: BotHealth,
  flags: BotFlags,
});
export type BotLeaseRequest = z.infer<typeof BotLeaseRequest>;

export const BotLeaseHolder = z.object({
  instanceId: z.string(),
  host: z.string(),
  since: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type BotLeaseHolder = z.infer<typeof BotLeaseHolder>;

export const BotLeaseResponse = z.object({
  granted: z.boolean(),
  holder: BotLeaseHolder,
  ttlSeconds: z.number().int().positive(),
  renewSeconds: z.number().int().positive(),
});
export type BotLeaseResponse = z.infer<typeof BotLeaseResponse>;

export const BotReleaseRequest = z.object({
  instanceId: BotLeaseRequest.shape.instanceId,
});
export type BotReleaseRequest = z.infer<typeof BotReleaseRequest>;

/** Studio's view (GET /v1/studio/status/bot). */
export const BotStatus = z.object({
  now: z.iso.datetime({ offset: true }),
  /** active: a live lease · stale: the last holder stopped renewing · none: no bot ever seen. */
  state: z.enum(['active', 'stale', 'none']),
  active: z
    .object({
      instanceId: z.string(),
      host: z.string(),
      version: z.string(),
      startedAt: z.iso.datetime({ offset: true }),
      since: z.iso.datetime({ offset: true }),
      lastSeenAt: z.iso.datetime({ offset: true }),
      expiresAt: z.iso.datetime({ offset: true }),
      health: BotHealth,
      flags: BotFlags,
    })
    .nullable(),
  /** Other instances refused recently (waiting for the lease): normally none. */
  standby: z.array(
    z.object({
      instanceId: z.string(),
      host: z.string(),
      version: z.string(),
      lastSeenAt: z.iso.datetime({ offset: true }),
    }),
  ),
});
export type BotStatus = z.infer<typeof BotStatus>;

/** Sent by the bot on every Core call: while a live lease exists, the Core refuses the bot routes to anyone else. */
export const BOT_INSTANCE_HEADER = 'x-raptoru-bot-instance';
