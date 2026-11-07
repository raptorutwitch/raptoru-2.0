import type { Queryable } from '../db/db.js';
import { DUEL_RULES } from '../mini-games/duel-rules.js';
import { MINI_GAME_RULES } from '../mini-games/rules.js';
import type { ModuleSettings } from '../module-settings/service.js';
import { liveChannelSession } from '../stream/channel-sessions.js';
import type { ModuleDefinition } from './kit.js';

// Démonstration C (architecture socle): a HISTORICAL module — Roulette, Slot and Duel (docs/ROULETTE_SLOT_PARITY.md,
// docs/DUEL_PARITY.md) — joins the host WITHOUT being rewritten: its service, its chat, its switch « Mini-jeux », its
// plays and its texts stay where they are. It gains the H10 settings (stakes, delays, Duel cap: defaults = what it
// applied until now; never the odds or the gains) and the shared supervision. Production and Lab alike.

const s = (seconds: number) => seconds * 1000;

export const miniGames: ModuleDefinition = {
  id: 'mini_games',
  label: 'Mini-jeux',
  description:
    'Roulette, Slot et Duel dans le chat : mises et délais réglables (les chances et les gains ne changent pas).',
  category: 'jeux',
  capabilities: ['settings', 'supervision'],
  settings: {
    roulette_min_bet: {
      label: 'Mise minimale de !roulette',
      unit: 'Jetons',
      default: MINI_GAME_RULES.roulette.minBet,
      min: 1,
      max: 10_000,
    },
    roulette_cooldown_s: {
      label: 'Délai entre deux !roulette d’un même viewer',
      unit: 's',
      default: MINI_GAME_RULES.roulette.cooldownMs / 1000,
      min: 0,
      max: 600,
    },
    slot_min_bet: {
      label: 'Mise de !slots (et minimum)',
      unit: 'Jetons',
      default: MINI_GAME_RULES.slot.minBet,
      min: 1,
      max: 10_000,
      help: '« !slots » sans montant mise exactement cette valeur',
    },
    slot_cooldown_s: {
      label: 'Délai entre deux !slots d’un même viewer',
      unit: 's',
      default: MINI_GAME_RULES.slot.cooldownMs / 1000,
      min: 0,
      max: 600,
    },
    duel_max_bet: {
      label: 'Mise maximale d’un duel',
      unit: 'Jetons',
      default: DUEL_RULES.maxBet,
      min: 100,
      max: 1_000_000,
      help: 'une mise plus haute est ramenée à ce plafond',
    },
    duel_cooldown_s: {
      label: 'Délai entre deux défis d’un même viewer',
      unit: 's',
      default: DUEL_RULES.cooldownMs / 1000,
      min: 0,
      max: 600,
      advanced: true,
    },
  },
  // Its own switch (Studio « Mini-jeux », mini_game_channels): the host reads it, never a second one.
  async enabled(ctx, q, channelId) {
    return (
      (
        await q.query<{ enabled: boolean }>(
          'select enabled from mini_game_channels where channel_id = $1',
          [channelId],
        )
      )[0]?.enabled ?? false
    );
  },
  async status(ctx, channelId) {
    const q = ctx.db;
    const on = await miniGames.enabled!(ctx, q, channelId);
    const live = !!(await liveChannelSession(q, channelId));
    const last = (
      await q.query<{ n: number | string; at: Date | null }>(
        `select count(*) as n, max(created_at) as at from mini_game_plays
          where channel_id = $1 and created_at > $2`,
        [channelId, new Date(ctx.clock.now().getTime() - 3_600_000)],
      )
    )[0];
    const plays = Number(last?.n ?? 0);
    return {
      intention: on ? 'on' : 'off',
      // The same reader as the games (liveChannelSession): off live, nothing is played (and the viewer is told so).
      observed: on ? (live ? 'ready' : 'waiting') : 'unknown',
      summary: !on
        ? 'Interrupteur « Mini-jeux » coupé.'
        : live
          ? 'Ouverts dans le chat.'
          : 'Allumés, mais rien ne se joue hors live.',
      reasons: !on
        ? ['Interrupteur et essais : page « Simulation ».']
        : !live
          ? ['Aucun live ouvert sur la chaîne.']
          : [],
      activity: plays
        ? `${plays} partie${plays > 1 ? 's' : ''} la dernière heure`
        : null,
    };
  },
};

/** What the games apply now (the service reads it in its transaction). */
export interface MiniGameLimits {
  rouletteMinBet: number;
  rouletteCooldownMs: number;
  slotMinBet: number;
  slotCooldownMs: number;
  duelMaxBet: number;
  duelCooldownMs: number;
}

export type MiniGameLimitsReader = (
  q: Queryable,
  channelId: string,
) => Promise<MiniGameLimits>;

/** Without settings (older wiring, unit tests): the historical values. */
export const DEFAULT_MINI_GAME_LIMITS: MiniGameLimits = {
  rouletteMinBet: MINI_GAME_RULES.roulette.minBet,
  rouletteCooldownMs: MINI_GAME_RULES.roulette.cooldownMs,
  slotMinBet: MINI_GAME_RULES.slot.minBet,
  slotCooldownMs: MINI_GAME_RULES.slot.cooldownMs,
  duelMaxBet: DUEL_RULES.maxBet,
  duelCooldownMs: DUEL_RULES.cooldownMs,
};

/** The reader over the host's settings (the same ModuleSettings the host registered `mini_games.*` on). */
export function miniGameLimits(settings: ModuleSettings): MiniGameLimitsReader {
  return async (q, ch) => {
    const get = (k: string) => settings.get(q, ch, `mini_games.${k}`);
    return {
      rouletteMinBet: await get('roulette_min_bet'),
      rouletteCooldownMs: s(await get('roulette_cooldown_s')),
      slotMinBet: await get('slot_min_bet'),
      slotCooldownMs: s(await get('slot_cooldown_s')),
      duelMaxBet: await get('duel_max_bet'),
      duelCooldownMs: s(await get('duel_cooldown_s')),
    };
  };
}
