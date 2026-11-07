import type { WordGameState } from '@raptoru/schemas';
import type { ModuleDefinition } from './kit.js';

// Supervision adapters of historical modules (architecture/MIGRATIONS.md, strategy B « état seulement »): the module keeps
// its engine, its switch, its settings and its screens; the host only READS what really works, so the Control Center
// and the « Modules du socle » page tell it like every other module. Nothing here writes or executes anything.

const hourAgo = (now: Date) => new Date(now.getTime() - 3_600_000);
const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

/** Random Ban (docs/RANDOM_BAN*.md): `!rb` has no switch of its own; it works only while the bot's executor reports. */
export function randomBanModule(service: {
  executorReady(channelId: string): boolean;
}): ModuleDefinition {
  return {
    id: 'random_ban',
    label: 'Random Ban',
    description:
      'Un viewer paie pour exclure un viewer au hasard (!rb) : le prix se règle dans Points de chaîne.',
    category: 'interactions',
    capabilities: ['supervision'],
    async status(ctx, channelId) {
      const ready = service.executorReady(channelId);
      const n = Number(
        (
          await ctx.db.query<{ n: number | string }>(
            'select count(*) as n from rb_requests where channel_id = $1 and created_at > $2',
            [channelId, hourAgo(ctx.clock.now())],
          )
        )[0]?.n ?? 0,
      );
      return {
        intention: 'on',
        observed: ready ? 'ready' : 'waiting',
        summary: ready
          ? 'Le bot peut chercher et exclure : !rb fonctionne.'
          : 'Le bot ne s’est pas signalé : !rb serait refusé (aucun Jeton débité).',
        reasons: ready
          ? []
          : [
              'Exécuteur Random Ban du bot silencieux depuis plus de 15 s (RANDOM_BAN côté bot ?).',
            ],
        activity: n
          ? `${plural(n, 'demande', 'demandes')} la dernière heure`
          : null,
      };
    },
  };
}

/** Jeu des mots (docs/WORD_GAME*.md): its durable switch (H8), the live, the next word — its service's own state. */
export function wordGameModule(service: {
  state(channelId: string): Promise<WordGameState>;
}): ModuleDefinition {
  return {
    id: 'word_game',
    label: 'Jeu des mots',
    description:
      'Des mots à trouver dans le chat pendant le live : interrupteur et intervalle dans sa page.',
    category: 'jeux',
    capabilities: ['supervision'],
    async enabled(ctx, q, channelId) {
      return (await service.state(channelId)).enabled;
    },
    async status(ctx, channelId) {
      const s = await service.state(channelId);
      return {
        intention: s.enabled ? 'on' : 'off',
        observed: s.running
          ? 'ready'
          : s.enabled && !s.live
            ? 'waiting'
            : 'unknown',
        summary: s.running
          ? 'Des mots tombent dans le chat.'
          : s.stopped
            ? 'Arrêté pour ce live.'
            : s.live
              ? 'Coupé.'
              : 'Allumé, mais rien ne tombe hors live.',
        reasons:
          s.enabled && !s.live ? ['Aucun live ouvert sur la chaîne.'] : [],
        activity: s.active.length
          ? plural(s.active.length, 'mot en jeu', 'mots en jeu')
          : null,
      };
    },
  };
}

/** Boutique Halloween (docs/HALLOWEEN*.md): its switch, and Studio's overlay engine seen within 10 s. */
export const eventShopModule: ModuleDefinition = {
  id: 'event_shop',
  label: 'Boutique d’événement',
  description:
    'Les achats de l’événement (Halloween) dans l’extension et le chat, joués par l’overlay de Studio.',
  category: 'interactions',
  capabilities: ['supervision'],
  async enabled(ctx, q, channelId) {
    return (
      (
        await q.query<{ enabled: boolean }>(
          'select enabled from event_shop_settings where channel_id = $1',
          [channelId],
        )
      )[0]?.enabled ?? false
    );
  },
  async status(ctx, channelId) {
    const now = ctx.clock.now();
    const engine = (
      await ctx.db.query<{ n: number | string }>(
        'select count(*) as n from event_shop_studios where channel_id = $1 and engine_ready and seen_at > $2',
        [channelId, new Date(now.getTime() - 10_000)],
      )
    )[0];
    const ready = Number(engine?.n ?? 0) > 0;
    return {
      intention: 'on',
      observed: ready ? 'ready' : 'waiting',
      summary: ready
        ? 'L’overlay de Studio est prêt à jouer les achats.'
        : 'Aucun overlay prêt : un achat ne serait pas joué.',
      reasons: ready
        ? []
        : [
            'Overlay de l’événement absent ou pas prêt depuis plus de 10 s (source OBS, Studio).',
          ],
    };
  },
};
