import { CASINO_SETTINGS, type CasinoService } from '../casino/service.js';
import type { ModuleDefinition } from './kit.js';

// Casino (docs/CASINO.md) on the module host: its bounded settings (Studio › Casino, module-settings) and its supervision
// for the Control Center. The games themselves are the casino's own routes (casino-routes.ts), reached through the
// extension façade's `/casino/*` door: a spin pays a bet chosen by the viewer and records a round, which the host's
// fixed-price viewer actions do not cover. Its switch is its own setting `casino.open` (closed by default).

export function casinoModule(casino: CasinoService): ModuleDefinition {
  const def: ModuleDefinition = {
    id: 'casino',
    label: 'Casino',
    description:
      'Machine à sous (et son Coffre) et roulette européenne dans l’extension, en Jetons, pendant le live.',
    category: 'jeux',
    capabilities: ['settings', 'supervision'],
    settings: CASINO_SETTINGS,
    async enabled(ctx, q, channelId) {
      return (await ctx.setting(q, channelId, 'open')) === 1;
    },
    async status(ctx, channelId) {
      const q = ctx.db;
      const av = await casino.availability(q, channelId);
      const open = (await ctx.setting(q, channelId, 'open')) === 1;
      const recent = (
        await q.query<{ n: number | string }>(
          'select count(*) as n from casino_rounds where channel_id = $1 and created_at > $2',
          [channelId, new Date(ctx.clock.now().getTime() - 3_600_000)],
        )
      )[0];
      const n = Number(recent?.n ?? 0);
      return {
        intention: open ? 'on' : 'off',
        observed: !open
          ? 'unknown'
          : av.reason === 'not_approved'
            ? 'waiting'
            : av.open
              ? 'ready'
              : 'waiting',
        summary: !open
          ? 'Casino fermé (Studio › Casino).'
          : av.reason === 'not_approved'
            ? 'Ouvert dans Studio, mais pas autorisé sur ce Core (CASINO_EXTENSION).'
            : av.open
              ? 'Ouvert aux viewers pendant le live.'
              : 'Ouvert, mais rien ne se joue hors live.',
        reasons:
          av.reason === 'stream_offline'
            ? ['Aucun live ouvert sur la chaîne.']
            : av.reason === 'not_approved'
              ? ['Variable CASINO_EXTENSION du Core : off.']
              : [],
        activity: n ? `${n} partie${n > 1 ? 's' : ''} la dernière heure` : null,
      };
    },
  };
  return def;
}
