import { z } from 'zod';

// Défis et succès (raptoru.fr lot 5, docs/CHALLENGES.md). Studio writes the definitions, the Core counts and rewards,
// the site only reads. The metric list is the Core's (CHALLENGE_METRICS in core-api); the schema only checks the shape.

export const ChallengeId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/);
const Slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);

export const ChallengeReward = z.discriminatedUnion('kind', [
  /** An existing catalogue item (title, badge, frame, banner) of the Boutique cosmétique. */
  z.strictObject({
    kind: z.literal('reward'),
    reward_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/),
  }),
  /** Jetons, through the same award as the other modules (one Wallet operation per award key). */
  z.strictObject({
    kind: z.literal('jetons'),
    amount: z.number().int().min(1).max(1_000_000),
  }),
]);
export type ChallengeReward = z.infer<typeof ChallengeReward>;

const Instant = z.iso.datetime({ offset: true });

/** Create / edit body (Studio). Once activated, only the texts may change (title, description, category, icon). */
export const ChallengeInput = z.strictObject({
  challenge_id: ChallengeId,
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).default(''),
  category: Slug.default('general'),
  icon: z
    .string()
    .regex(/^[a-z0-9_-]{1,32}$/)
    .nullable()
    .default(null),
  metric: z.string().regex(/^[a-z0-9_]{1,48}$/),
  target: z.number().int().min(1).max(1_000_000_000),
  period: z.enum(['once', 'week', 'month']).default('once'),
  starts_at: Instant.nullable().default(null),
  ends_at: Instant.nullable().default(null),
  retroactive: z.boolean().default(false),
  visibility: z.enum(['public', 'secret']).default('public'),
  reward: ChallengeReward.nullable().default(null),
});
export type ChallengeInput = z.infer<typeof ChallengeInput>;

export const ChallengeStatusChange = z.strictObject({
  status: z.enum(['active', 'suspended', 'archived']),
});

export const ChallengeRevoke = z.strictObject({
  period_key: z.string().regex(/^(all|w\d{4}-\d{2}-\d{2}|m\d{4}-\d{2})$/),
  viewer: z.string().regex(/^\d{1,32}$/),
  reason: z.string().trim().min(3).max(200),
});
