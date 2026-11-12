import type { ModuleStatsService } from '../module-stats/service.js';
import type { Route } from './server.js';

// Statistiques des modules (raptoru.fr lot 4): the site token only — the site shows a viewer their OWN totals. Public:
// Random Ban's channel totals only (Antoni's decision of 12/11, docs/mini-jeux/SPEC § 7) — aggregates, never a viewer.
export function moduleStatsRoutes(
  svc: ModuleStatsService,
  o: { channelId: string },
): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/v1\/site\/modules\/viewers\/([0-9]{1,32})$/,
      auth: 'site',
      handle: ({ params }) => svc.viewer(o.channelId, params[0]!),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/site\/modules\/random-ban\/public$/,
      auth: 'site',
      handle: () => svc.randomBanPublic(o.channelId),
    },
  ];
}
