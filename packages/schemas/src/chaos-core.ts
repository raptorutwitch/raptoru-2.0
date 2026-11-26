import { z } from 'zod';

// Chaos V2 lot 2 — the Core's `chaos` module (docs/chaos/CONTRAT_LOT2.md § 2.4): what the extension (through the
// façade), Studio (execution) and the D4 console (moderation) send. Re-exported by lab-moderation.ts. The choice is only
// shape-checked here: the Core normalizes it with the catalogue (apps/core-api/src/chaos/catalog.ts).

const Id = z.string().regex(/^\d{1,32}$/);
export const ChaosEffectId = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const StudioInstance = z.string().min(1).max(64);
const Reason = z.string().trim().max(200).optional();
const Motive = z.string().trim().min(3).max(200);

/** A sheet's setting `{ style, level, duration, opts }` (catalog.js), bounded: the Core normalizes it. */
export const ChaosChoice = z.object({
  style: z.string().max(40).nullable().optional(),
  level: z.string().max(40).nullable().optional(),
  duration: z.number().nullable().optional(),
  opts: z
    .record(
      z.string().max(32),
      z.union([
        z.number(),
        z.boolean(),
        z.string().max(32),
        z.tuple([z.number(), z.number()]),
      ]),
    )
    .refine((o) => Object.keys(o).length <= 16, 'too many options')
    .optional(),
});
export type ChaosChoice = z.infer<typeof ChaosChoice>;

export const ChaosQuoteBody = z.object({
  effect: ChaosEffectId,
  choice: ChaosChoice.default({}),
  credit_id: z.uuid().optional(),
});
export const ChaosBuyBody = ChaosQuoteBody.extend({
  expected_price: z.number().int().min(0).max(10_000_000),
});
const LabViewer = z.strictObject({
  id: Id,
  display_name: z.string().min(1).max(64),
});
/** Lab / façade (in-process) admission: the verified viewer and the client's Idempotency-Key in the body. */
export const ChaosLabBuyRequest = ChaosBuyBody.extend({
  viewer: LabViewer,
  idempotency_key: z.string().min(8).max(128),
});
export const ChaosLabQuoteRequest = ChaosQuoteBody.extend({
  viewer: LabViewer.nullable().optional(),
});

export const ChaosHeartbeat = z.object({
  studio_instance_id: StudioInstance,
  channel_id: Id.optional(),
  engine_ready: z.boolean(),
  safety_max_ms: z.number().int().min(1000).max(60_000),
  safe_mode: z.boolean(),
  effects: z
    .record(ChaosEffectId, z.object({ enabled: z.boolean() }))
    .refine((o) => Object.keys(o).length <= 32, 'too many effects'),
  inflight: z.array(z.uuid()).max(64).default([]),
});
export type ChaosHeartbeat = z.infer<typeof ChaosHeartbeat>;

export const ChaosClaimRequest = z.object({
  studio_instance_id: StudioInstance,
  channel_id: Id.optional(),
  startable: z.array(ChaosEffectId).max(32),
});

export const ChaosAckRequest = z.object({
  studio_instance_id: StudioInstance,
  attempt_id: z.uuid(),
  event: z.enum(['started', 'ended', 'failed']),
  code: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,39}$/)
    .optional(),
  /** Studio may send an engine's raw error text (`engine_error`): kept, cut to 200 characters. */
  reason: z
    .string()
    .max(4000)
    .transform((s) => s.slice(0, 200))
    .optional(),
  played_ms: z.number().int().min(0).max(600_000).optional(),
});
export type ChaosAckRequest = z.infer<typeof ChaosAckRequest>;

export const ChaosStopAllRequest = z.object({
  studio_instance_id: StudioInstance,
  channel_id: Id.optional(),
});

/** What an effect credit covers (EXTENSION_INTERACTIONS.md § 8): a duration at most, some levels, some presets. */
export const ChaosCreditConstraints = z.strictObject({
  max_duration_ms: z.number().int().min(1000).max(60_000).optional(),
  levels: z.array(z.string().max(40)).max(8).optional(),
  presets: z.array(z.string().max(40)).max(12).optional(),
});
export type ChaosCreditConstraints = z.infer<typeof ChaosCreditConstraints>;

/**
 * D4 commands of the FX section, carried by the moderation actions endpoint in the Tombola's envelope:
 * `{ action: 'chaos', command: <one of these> }`. Without refund, a reason is required (checked by the Core).
 */
export const ChaosModerationCommand = z.discriminatedUnion('action', [
  /** Stop an effect playing; without `refund`, refunded when it played less than 25 %. */
  z.strictObject({
    action: z.literal('stop'),
    id: z.uuid(),
    refund: z.boolean().optional(),
    reason: Reason,
  }),
  /** Remove a request not started yet (refunded by default). Started meanwhile: stopped instead. */
  z.strictObject({
    action: z.literal('cancel'),
    id: z.uuid(),
    refund: z.boolean().default(true),
    reason: Reason,
  }),
  /** Refund a finished request afterwards (once). */
  z.strictObject({ action: z.literal('refund'), id: z.uuid(), reason: Motive }),
  /** « Ouverts / Suspendus ». */
  z.strictObject({
    action: z.literal('pause'),
    paused: z.boolean(),
    reason: Reason,
  }),
  /** « Tout arrêter »: what plays stops (25 % rule), what waits is removed and refunded, purchases are suspended. */
  z.strictObject({ action: z.literal('stop_all'), reason: Reason }),
  /** « Offrir un effet »: free, before the queue. */
  z.strictObject({
    action: z.literal('gift'),
    effect: ChaosEffectId,
    choice: ChaosChoice.default({}),
    reason: Reason,
  }),
  z.strictObject({
    action: z.literal('credit_grant'),
    viewer_id: Id,
    viewer_name: z.string().min(1).max(64).optional(),
    effect: ChaosEffectId,
    constraints: ChaosCreditConstraints.default({}),
    reason: Motive,
    expires_at: z.iso.datetime().optional(),
  }),
  z.strictObject({
    action: z.literal('credit_revoke'),
    credit_id: z.uuid(),
    reason: Motive,
  }),
]);
export type ChaosModerationCommand = z.infer<typeof ChaosModerationCommand>;
