import type { Queryable } from '../db/db.js';
import { type ModuleDefinition, ModuleError } from './kit.js';

// Démonstration B (architecture socle, Lab only): a cross-surface module — a viewer pays Jetons in the extension to open
// a fictional chest; a (fictional) OBS player shows it; Studio sets the price and sees the activity; moderators refund
// a paid opening. The module writes ONLY its own logic below; payment, idempotency, live rule (H1), pause, blocks,
// journal, refund of the original debit, catalog, routes and screens come from the host.
// The content is fictional and pays nothing back: no prize table, no money out (H10: odds never set from Studio).

const ITEMS = [
  'plume fictive',
  'clé fictive',
  'carte fictive',
  'pièce fictive',
];
/** A chest the player has not shown after this delay is failed and refunded once (same rule as H2). */
export const COFFRE_SHOW_MS = 120_000;

async function waiting(q: Queryable, channelId: string) {
  return q.query<{ activity_id: string; created_at: Date }>(
    `select activity_id, created_at from module_activity
     where channel_id = $1 and module_id = 'coffre_mystere' and status = 'queued' order by created_at`,
    [channelId],
  );
}

export const coffreMystere: ModuleDefinition = {
  id: 'coffre_mystere',
  label: 'Coffre mystère',
  description:
    'Un coffre fictif à ouvrir avec des Jetons depuis l’extension, montré par un lecteur OBS fictif (démonstration du socle, Lab uniquement).',
  category: 'jeux',
  labOnly: true,
  capabilities: [
    'settings',
    'viewer',
    'wallet',
    'live',
    'history',
    'moderation',
    'supervision',
  ],
  expireQueuedMs: COFFRE_SHOW_MS,
  settings: {
    prix: {
      label: 'Prix d’un coffre',
      unit: 'Jetons',
      default: 100,
      min: 10,
      max: 10_000,
    },
    limite_par_viewer: {
      label: 'Coffres en attente par viewer',
      unit: 'coffres',
      default: 2,
      min: 1,
      max: 10,
      advanced: true,
    },
  },
  moderation: {
    visible: true,
    refund: 'moderator',
    note: 'Un coffre payé peut être remboursé par un modérateur (le débit d’origine, une fois), avec un motif.',
  },
  viewer: {
    ouvrir: {
      label: 'Ouvrir un coffre',
      price: (ctx, q, channelId) => ctx.setting(q, channelId, 'prix'),
      async run(ctx, q, { channelId, viewer, activityId }) {
        const limit = await ctx.setting(q, channelId, 'limite_par_viewer');
        const mine = await q.query(
          `select 1 from module_activity where channel_id = $1 and module_id = 'coffre_mystere' and viewer_id = $2
             and status = 'queued' and activity_id <> $3`,
          [channelId, viewer.id, activityId],
        );
        if (mine.length >= limit)
          throw new ModuleError(409, 'too_many_waiting', { limit });
        // A fixed rotation (no randomness to tune): the content is decided now, shown by the player later. The shared
        // counter under the module's lock (two viewers buying at once never lose an opening).
        await ctx.lock(q, channelId, 'opened');
        const n =
          ((await ctx.state.get<number>(q, channelId, 'opened')) ?? 0) + 1;
        await ctx.state.set(q, channelId, 'opened', n);
        return { status: 'queued', result: { item: ITEMS[n % ITEMS.length] } };
      },
    },
  },
  async viewerState(ctx, channelId, viewer) {
    const opened =
      (await ctx.state.get<number>(ctx.db, channelId, 'opened')) ?? 0;
    return { opened_total: opened, viewer: viewer?.display_name ?? null };
  },
  async status(ctx, channelId) {
    const w = await waiting(ctx.db, channelId);
    const late = w.filter(
      (r) =>
        ctx.clock.now().getTime() - new Date(r.created_at).getTime() >
        COFFRE_SHOW_MS / 2,
    );
    return {
      intention: 'on',
      observed: late.length ? 'waiting' : 'ready',
      summary: w.length
        ? `${w.length} coffre(s) à montrer`
        : 'Aucun coffre en attente',
      reasons: late.length
        ? [
            'Aucun lecteur ne prend les coffres (plus d’une minute d’attente) : en Lab, le lecteur fictif de Studio.',
          ]
        : [],
      activity: w.length ? `${w.length} en attente` : null,
    };
  },
};
