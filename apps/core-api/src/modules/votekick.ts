import type { Queryable } from '../db/db.js';
import type { ModuleSettings } from '../module-settings/service.js';
import { VOTEKICK } from '@raptoru/schemas';
import type { ModuleDefinition } from './kit.js';

// Votekick V2 (docs/VOTEKICK_V2.md) on the module host — an ADAPTER, not a rewrite (architecture/MIGRATIONS.md): the
// engine, the votes, the ballots, the mute, the overlay, the vote duration (votekick_settings, its own Studio screen)
// stay where they are. It gains the H10 settings named by the audit (D.3 « Essentiels »: the initiator's delay, the
// sanction range; defaults = the SAMMI rules) and the shared supervision. The quorum and the coin flip stay rules (H10:
// never the odds). Its switch is the Core's VOTEKICK_CHAT (deployment flag): read-only here.

export interface VotekickLimits {
  initiatorCooldownMs: number;
  minMinutes: number;
  maxMinutes: number;
}

/** Without settings (older wiring, tests): the SAMMI rules. */
export const DEFAULT_VOTEKICK_LIMITS: VotekickLimits = {
  initiatorCooldownMs: VOTEKICK.initiatorCooldownMs,
  minMinutes: VOTEKICK.minMinutes,
  maxMinutes: VOTEKICK.maxMinutes,
};

/** The reader over the host's settings (the same ModuleSettings the host registered `votekick.*` on). */
export function votekickLimits(settings: ModuleSettings) {
  return async (q: Queryable, ch: string): Promise<VotekickLimits> => ({
    initiatorCooldownMs:
      (await settings.get(q, ch, 'votekick.initiator_cooldown_min')) * 60_000,
    minMinutes: await settings.get(q, ch, 'votekick.sanction_min_minutes'),
    maxMinutes: await settings.get(q, ch, 'votekick.sanction_max_minutes'),
  });
}

/** What the adapter reads of the running service (no copy of its state). */
export interface VotekickProbe {
  executorReady(channelId: string): boolean;
}

export function votekickModule(
  service: VotekickProbe,
  o: { chat: boolean },
): ModuleDefinition {
  return {
    id: 'votekick',
    label: 'Votekick',
    description:
      'Votes du chat pour exclure un viewer quelques minutes (!votekick, !kick, !save) : délais et durées réglables, les règles du vote ne changent pas.',
    category: 'communaute',
    capabilities: ['settings', 'supervision'],
    settings: {
      initiator_cooldown_min: {
        label: 'Délai avant qu’un viewer relance un votekick',
        unit: 'min',
        default: VOTEKICK.initiatorCooldownMs / 60_000,
        min: 1,
        max: 1_440,
      },
      sanction_min_minutes: {
        label: 'Exclusion la plus courte',
        unit: 'min',
        default: VOTEKICK.minMinutes,
        min: 1,
        max: 60,
        help: 'avec 3 votes ; doublée pour un « Perfect » ou un « Backfire »',
      },
      sanction_max_minutes: {
        label: 'Exclusion la plus longue',
        unit: 'min',
        default: VOTEKICK.maxMinutes,
        min: 1,
        max: 240,
        help: 'atteinte vers 20 votes ; si elle est plus courte que la plus courte, les deux sont inversées',
      },
    },
    // Its switch is a deployment flag (VOTEKICK_CHAT on the main Core; always on in the Lab): read, never written here.
    async enabled() {
      return o.chat;
    },
    async status(ctx, channelId) {
      const ready = service.executorReady(channelId);
      const last = (
        await ctx.db.query<{ n: number | string }>(
          `select count(*) as n from votekick_votes where channel_id = $1 and created_at > $2`,
          [channelId, new Date(ctx.clock.now().getTime() - 3_600_000)],
        )
      )[0];
      const n = Number(last?.n ?? 0);
      return {
        intention: 'on',
        observed: ready ? 'ready' : 'waiting',
        summary: ready
          ? 'Le bot lit Twitch : les votes peuvent sanctionner.'
          : 'Le bot ne s’est pas signalé : un vote ne sanctionnerait personne.',
        reasons: ready
          ? []
          : ['Exécuteur Twitch (bot) silencieux depuis plus de 15 s.'],
        activity: n ? `${n} vote${n > 1 ? 's' : ''} la dernière heure` : null,
      };
    },
  };
}
