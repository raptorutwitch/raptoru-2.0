import { CAUTION } from '@raptoru/schemas';
import type { Queryable } from '../db/db.js';
import type { ModuleSettings } from '../module-settings/service.js';
import type { ModuleDefinition } from './kit.js';

// Caution (docs/CAUTION.md) on the module host — an ADAPTER (architecture/MIGRATIONS.md): the quote, the « oui » / « non »,
// the ONE debit, the untimeout by the bot, the refunds, the end of the streamer's mute stay in its service. It gains the
// H10 prices (the rates; defaults = the SAMMI rule and the decision of 27/10) and the shared supervision. A quote keeps
// the price it announced: the rate is read when it is made, never after. Its switch is CAUTION_CHAT (read-only here).

export interface CautionRates {
  pricePerMinute: number;
  mutePricePer10s: number;
}

export const DEFAULT_CAUTION_RATES: CautionRates = {
  pricePerMinute: CAUTION.pricePerMinute,
  mutePricePer10s: CAUTION.mutePricePer10s,
};

export function cautionRates(settings: ModuleSettings) {
  return async (q: Queryable, ch: string): Promise<CautionRates> => ({
    pricePerMinute: await settings.get(q, ch, 'caution.price_per_minute'),
    mutePricePer10s: await settings.get(q, ch, 'caution.mute_price_per_10s'),
  });
}

export interface CautionProbe {
  executorReady(channelId: string): boolean;
}

export function cautionModule(
  service: CautionProbe,
  o: { chat: boolean },
): ModuleDefinition {
  return {
    id: 'caution',
    label: 'Caution',
    description:
      'Un viewer paie la caution d’un autre pour lever son exclusion (!caution, devis puis « oui ») : tarifs réglables.',
    category: 'communaute',
    capabilities: ['settings', 'supervision'],
    settings: {
      price_per_minute: {
        label: 'Prix par minute d’exclusion restante',
        unit: 'Jetons',
        default: CAUTION.pricePerMinute,
        min: 100,
        max: 100_000,
        help: 'chaque minute commencée compte ; un devis garde son prix',
      },
      mute_price_per_10s: {
        label: 'Prix par 10 s de sourdine du streamer',
        unit: 'Jetons',
        default: CAUTION.mutePricePer10s,
        min: 10,
        max: 10_000,
        help: 'Votekick ou Random Ban contre le streamer',
      },
    },
    async enabled() {
      return o.chat;
    },
    async status(ctx, channelId) {
      const ready = service.executorReady(channelId);
      const open = (
        await ctx.db.query<{ n: number | string }>(
          `select count(*) as n from caution_requests where channel_id = $1 and created_at > $2`,
          [channelId, new Date(ctx.clock.now().getTime() - 3_600_000)],
        )
      )[0];
      const n = Number(open?.n ?? 0);
      return {
        intention: 'on',
        observed: ready ? 'ready' : 'waiting',
        summary: ready
          ? 'Le bot lit Twitch : une caution payée lève vraiment l’exclusion.'
          : 'Le bot ne s’est pas signalé : aucune caution ne serait honorée.',
        reasons: ready
          ? []
          : ['Exécuteur Twitch (bot) silencieux depuis plus de 15 s.'],
        activity: n
          ? `${n} demande${n > 1 ? 's' : ''} la dernière heure`
          : null,
      };
    },
  };
}
