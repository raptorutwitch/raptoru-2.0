// Chaos V2 : contrats partagés entre le moteur natif (apps/chaos-engine), Studio et, plus tard, le Core et l'extension.
// Le registre des effets est UN fichier, ./chaos-registry.json, embarqué par le moteur et validé ici (aucune seconde
// déclaration des effets). Contrat complet : docs/chaos/CONTRATS_MOTEUR.md.
import { z } from 'zod';

export const CHAOS_PROTOCOL = 2;

export const CHAOS_COMMANDS = [
  'hello',
  'ping',
  'describe',
  'status',
  'diagnostics',
  'targets.list',
  'effect.request',
  'effect.cancel',
  'stop_all',
  'config.get',
  'config.set',
  'config.reset',
  'preset.set',
  'preset.delete',
  'shutdown',
] as const;
export type ChaosCommand = (typeof CHAOS_COMMANDS)[number];

/** Qui demande un effet : tracé de bout en bout (le Core, l'extension et les points de chaîne ne règlent jamais un paramètre non exposé). */
export const CHAOS_SOURCES = [
  'studio',
  'core',
  'extension',
  'channel_points',
  'test',
] as const;
export const CHAOS_POLICIES = ['queue', 'replace', 'reject', 'extend'] as const;

/** Événements d'état d'une demande (nom publié : `effect.<état>`). Le futur Core s'y abonne pour débiter / rembourser. */
export const CHAOS_EFFECT_EVENTS = [
  'accepted',
  'queued',
  'started',
  'extended',
  'ended',
  'failed',
  'canceled',
  'expired',
  'rejected',
  'merged',
  'duplicate',
] as const;

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/);
const transitionSide = z
  .object({
    kind: z.enum(['ramp', 'cut']).optional(),
    duration_ms: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

/** Corps d'une commande effect.request (validé par Studio avant envoi, puis par le moteur). */
export const chaosEffectRequestSchema = z
  .object({
    request_id: id,
    effect: z.string().regex(/^[a-z][a-z0-9_.]{0,40}$/),
    variant: z.string().max(40).optional(),
    preset: z.string().max(40).optional(),
    params: z
      .record(z.string(), z.union([z.number(), z.string(), z.boolean()]))
      .optional(),
    duration_ms: z.number().int().positive().optional(),
    transition: z
      .object({ in: transitionSide.optional(), out: transitionSide.optional() })
      .strict()
      .optional(),
    priority: z.number().int().min(-100).max(100).optional(),
    policy: z.enum(CHAOS_POLICIES).optional(),
    source: z
      .object({
        kind: z.enum(CHAOS_SOURCES),
        ref: z.string().max(120).optional(),
      })
      .strict(),
    target: z
      .union([
        z
          .object({
            kind: z.literal('window'),
            hwnd: z.number().int().positive(),
            follow_foreground: z.boolean().optional(),
          })
          .strict(),
        z
          .object({
            kind: z.literal('foreground'),
            follow_foreground: z.boolean().optional(),
          })
          .strict(),
        // Écran entier (défaut du retournement : Windows retourne l'affichage, souris inversée, vrai curseur).
        z
          .object({
            kind: z.literal('monitor'),
            device: z
              .string()
              .regex(/^\\\\\.\\DISPLAY\d{1,2}$/)
              .optional(),
            hwnd: z.number().int().positive().optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();
export type ChaosEffectRequest = z.infer<typeof chaosEffectRequestSchema>;

// ---------- Registre ----------
const paramBase = {
  id: z.string().min(1),
  label: z.string().optional(),
  help: z.string().optional(),
  exposed: z.boolean().optional(),
};
export const chaosParamSchema = z.discriminatedUnion('type', [
  z.object({
    ...paramBase,
    type: z.literal('number'),
    min: z.number(),
    max: z.number(),
    default: z.number(),
    unit: z.string().optional(),
    animatable: z.boolean().optional(),
    neutral: z.number().optional(),
  }),
  z.object({
    ...paramBase,
    type: z.literal('enum'),
    values: z.array(z.string()).min(1),
    default: z.string(),
  }),
  z.object({ ...paramBase, type: z.literal('bool'), default: z.boolean() }),
  z.object({
    ...paramBase,
    type: z.literal('color'),
    default: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  z.object({
    ...paramBase,
    type: z.literal('string'),
    default: z.string(),
    max_length: z.number().int().positive().optional(),
  }),
]);
const transitionDef = z.object({
  kind: z.enum(['ramp', 'cut']),
  duration_ms: z.number().int().min(0).optional(),
  curve: z.string().optional(),
  kinds: z.array(z.enum(['ramp', 'cut'])).optional(),
});
export const CHAOS_INPUT_EFFECTS = ['invert_xy'] as const;
export const chaosEffectDefSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_.]{0,40}$/),
  version: z.number().int().positive(),
  label: z.string(),
  description: z.string(),
  family: z.string(),
  slot: z.string(),
  internal: z.boolean(),
  on_conflict: z.enum(CHAOS_POLICIES),
  /** Transformation d'entrée (couche Entrées) appliquée quand la cible est l'écran entier. */
  input: z.enum(CHAOS_INPUT_EFFECTS).optional(),
  gpu: z.object({
    primitive: z.string(),
    cost: z.string(),
    passes: z.number().int().min(0),
  }),
  duration: z.object({ default_ms: z.number().int().positive() }),
  params: z.array(chaosParamSchema),
  variants: z.array(
    z.object({
      id: z.string(),
      label: z.string().optional(),
      params: z.record(z.string(), z.unknown()),
    }),
  ),
  transitions: z.object({ in: transitionDef, out: transitionDef }),
  stop_conditions: z
    .array(z.string())
    .refine(
      (s) => s.includes('stop_all'),
      'stop_all doit toujours arrêter un effet',
    ),
});
export const chaosRegistrySchema = z.object({
  schema: z.literal('raptoru.chaos.registry'),
  version: z.number().int().positive(),
  engine_limits: z.object({
    min_duration_ms: z.number().int().positive(),
    max_duration_ms: z.number().int().positive(),
    max_active_effects: z.number().int().positive(),
    max_queue: z.number().int().positive(),
    queue_ttl_ms: z.number().int().positive(),
    max_rotation_deg_per_s: z.number().positive(),
    max_transition_ms: z.number().int().positive(),
  }),
  families: z.record(z.string(), z.object({ label: z.string() })),
  input_effects: z
    .record(
      z.enum(CHAOS_INPUT_EFFECTS),
      z.object({
        label: z.string(),
        description: z.string(),
        scope: z.literal('monitor'),
      }),
    )
    .optional(),
  slots: z.record(
    z.string(),
    z.object({
      label: z.string(),
      order: z.number().int(),
      max_active: z.number().int().positive(),
      requires_capture: z.boolean().optional(),
    }),
  ),
  effects: z.array(chaosEffectDefSchema).min(1),
});
export type ChaosRegistry = z.infer<typeof chaosRegistrySchema>;
export type ChaosEffectDef = z.infer<typeof chaosEffectDefSchema>;
export type ChaosParam = z.infer<typeof chaosParamSchema>;

// ---------- Messages ----------
export interface ChaosResponse {
  v: 2;
  type: 'response';
  id: string | null;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}
export interface ChaosEvent {
  v: 2;
  type: 'event';
  event: string;
  t_ms: number;
  [k: string]: unknown;
}
/** Vue publique d'une demande (réponses, événements effect.*, status). */
export interface ChaosEffectView {
  request_id: string;
  effect: string;
  effect_version: number;
  state: 'queued' | 'starting' | 'active' | 'exiting' | 'finished';
  source: { kind: (typeof CHAOS_SOURCES)[number]; ref: string | null };
  priority: number;
  target: Record<string, unknown>;
  resolved: {
    params: Record<string, unknown>;
    duration_ms: number;
    transition: Record<
      'in' | 'out',
      { kind: string; duration_ms: number; curve: string }
    >;
    adjusted: string[];
  };
  started: boolean;
  running_ms?: number;
  remaining_ms?: number;
  outcome?: string;
  reason?: string;
  visible_ms?: number;
}
